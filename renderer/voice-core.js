'use strict';

// ============================================================
// BahiaClient — Voice Client (core reutilizable)
// Instanciable. Vive en el launcher.
// ============================================================
// v2 — fixes #201:
//   · leave() usa fetch(..., { keepalive: true }) para que el POST
//     a /voice/leave sobreviva al cierre del launcher. Con _fetch()
//     normal (AbortController + timeout), Chromium cancelaba el
//     request durante el teardown y el backend dejaba el peer
//     colgado hasta el timeout del heartbeat (~30s).
//   · destroy() fuerza el keepalive leave sin pasar por las
//     validaciones de leave(), y es idempotente.
// ============================================================

(function () {

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const FETCH_TIMEOUT_MS = 8000;
  const PEER_POLL_MS     = 4000;
  const SIGNAL_POLL_MS   = 2000;
  const HEARTBEAT_MS     = 8000;
  const MAX_SEEN_MSG_IDS = 500;

  class BCVoiceClient {
    constructor({ nick, channelId, channelLabel, getBackend, onStateChange }) {
      this.nick = nick;
      this.channelId = channelId || null;
      this.channelLabel = channelLabel || channelId || '';
      this.getBackend = getBackend || (() => null);
      this.onStateChange = onStateChange || (() => {});

      this.joined = false;
      this.muted = false;
      this.localStream = null;
      this.peers = new Map();
      this.peersTimer = null;
      this.signalTimer = null;
      this.heartbeatTimer = null;
      this.micId = null;
      this.speakerId = null;

      // FIX #2 (v1): evita join() concurrente.
      this._joining = false;
      // FIX #2 (v1): evita leave()+join() intercalados.
      this._leaving = false;
      // FIX #201b: evita doble keepalive leave desde destroy()+leave().
      this._leaveSent = false;

      // FIX #12 (v1): dedupe de mensajes de señal.
      this._seenMsgIds = new Set();
      this._seenMsgOrder = [];

      // FIX #9 (v1): evita re-emitir si nada cambió.
      this._lastEmitHash = '';

      try { this.micId = localStorage.getItem('bc_mic_id') || null; } catch(e){}
      try { this.speakerId = localStorage.getItem('bc_speaker_id') || null; } catch(e){}
    }

    // ─── helpers ────────────────────────────────────────────
    _stateHash() {
      const peers = [...this.peers.values()]
        .map(p => p.nick + ':' + (p.muted ? 'm' : 'u'))
        .sort()
        .join(',');
      return [
        this.joined ? '1' : '0',
        this.muted ? '1' : '0',
        this.channelId || '',
        peers,
      ].join('|');
    }

    _emit(force) {
      const hash = this._stateHash();
      if (!force && hash === this._lastEmitHash) return;
      this._lastEmitHash = hash;
      try {
        this.onStateChange({
          joined: this.joined,
          muted: this.muted,
          peerCount: this.peers.size,
          channelId: this.channelId,
          channelLabel: this.channelLabel,
          peers: [...this.peers.values()].map(p => ({ nick: p.nick, muted: p.muted })),
        });
      } catch(e){}
    }

    // FIX #8 (v1): retry opcional para endpoints críticos.
    async _fetch(path, opts, retries = 0) {
      const be = this.getBackend();
      if (!be || !be.url) return null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          const res = await fetch(be.url + path, Object.assign({}, opts, {
            headers: Object.assign(
              { 'Content-Type': 'application/json', 'x-bc-key': be.key || '' },
              (opts && opts.headers) || {}
            ),
            signal: ctrl.signal,
          }));
          clearTimeout(to);
          let data = null;
          try { data = await res.json(); } catch(_){}
          if (res.ok) return data;
          if (res.status >= 500 && attempt < retries) {
            await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
            continue;
          }
          return null;
        } catch (e) {
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
            continue;
          }
          console.warn('[voice] fetch', path, e.message);
          return null;
        }
      }
      return null;
    }

    // FIX #201a: variante "fire-and-forget" sin AbortController.
    // Se usa solo para /voice/leave durante teardown. El keepalive
    // permite que Chromium mantenga el request vivo aunque la página
    // se esté cerrando. No pasar `signal` — son mutuamente excluyentes
    // en la práctica (si el signal aborta, el request muere aunque
    // tenga keepalive).
    _sendLeaveKeepalive() {
      if (this._leaveSent) return;
      this._leaveSent = true;
      const be = this.getBackend();
      if (!be || !be.url) return;
      try {
        const url = String(be.url).replace(/\/+$/, '') + '/voice/leave';
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bc-key': be.key || '' },
          body: JSON.stringify({ nick: this.nick }),
          keepalive: true,
        }).catch(() => {});
      } catch (e) {
        // En teardown, fetch puede tirar synchronously; lo ignoramos.
      }
    }

    _rememberMsg(id) {
      if (!id) return true;
      if (this._seenMsgIds.has(id)) return false;
      this._seenMsgIds.add(id);
      this._seenMsgOrder.push(id);
      while (this._seenMsgOrder.length > MAX_SEEN_MSG_IDS) {
        const old = this._seenMsgOrder.shift();
        this._seenMsgIds.delete(old);
      }
      return true;
    }

    // ─── devices ────────────────────────────────────────────
    async refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], speakers: [] };
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();

        // FIX #5 (v1): NO pedir getUserMedia por abrir el panel.
        const hasLabels = devices.some(d =>
          (d.kind === 'audioinput' || d.kind === 'audiooutput') && d.label
        );
        if (!hasLabels && !this.localStream) {
          let granted = false;
          try {
            if (navigator.permissions?.query) {
              const perm = await navigator.permissions.query({ name: 'microphone' });
              granted = perm && perm.state === 'granted';
            }
          } catch(e){}
          if (granted) {
            try {
              const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
              tmp.getTracks().forEach(t => t.stop());
              devices = await navigator.mediaDevices.enumerateDevices();
            } catch(e){}
          }
        }
        return {
          mics:     devices.filter(d => d.kind === 'audioinput'),
          speakers: devices.filter(d => d.kind === 'audiooutput'),
        };
      } catch(e){ return { mics: [], speakers: [] }; }
    }

    async setMic(deviceId) {
      // FIX #10 (v1): revertir micId si getUserMedia falla.
      const prevId = this.micId;
      this.micId = deviceId;
      try { localStorage.setItem('bc_mic_id', deviceId); } catch(e){}
      if (!this.joined) return;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          },
          video: false,
        });
        const track = newStream.getAudioTracks()[0];
        track.enabled = !this.muted;
        for (const [, peer] of this.peers) {
          try {
            const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) await sender.replaceTrack(track);
          } catch(e){}
        }
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = newStream;
      } catch(e) {
        console.warn('[voice] setMic failed, revirtiendo:', e.message);
        this.micId = prevId;
        try {
          if (prevId) localStorage.setItem('bc_mic_id', prevId);
          else localStorage.removeItem('bc_mic_id');
        } catch(_){}
        throw e;
      }
    }

    setSpeaker(deviceId) {
      this.speakerId = deviceId;
      try { localStorage.setItem('bc_speaker_id', deviceId); } catch(e){}
      for (const [, peer] of this.peers) {
        if (peer.audio && typeof peer.audio.setSinkId === 'function') {
          peer.audio.setSinkId(deviceId).catch(() => {});
        }
      }
    }

    async ensureMic() {
      if (this.localStream) return this.localStream;
      const constraints = {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      };
      if (this.micId) constraints.audio.deviceId = { exact: this.micId };
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // FIX #6 (v1): si el device guardado ya no existe, caer a default.
        if (this.micId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
          console.warn('[voice] mic guardado no disponible, usando default');
          this.micId = null;
          try { localStorage.removeItem('bc_mic_id'); } catch(_){}
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw e;
        }
      }
      // FIX #7 (v1): aplicar muted al track (persiste entre rejoins).
      this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
      return this.localStream;
    }

    // ─── lifecycle ──────────────────────────────────────────
    async join(newChannelId, newChannelLabel) {
      // FIX #2 (v1): anti doble-click / reentry.
      if (this._joining) return;
      if (this._leaving) {
        for (let i = 0; i < 20 && this._leaving; i++) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      this._joining = true;
      try {
        if (this.joined) await this.leave();
        if (newChannelId) {
          this.channelId = newChannelId;
          this.channelLabel = newChannelLabel || newChannelId;
        }
        if (!this.channelId) throw new Error('no channelId');
        if (!this.nick) throw new Error('no nick');

        await this.ensureMic();

        // FIX #1 (v1): NO marcar joined hasta que el server confirme.
        const res = await this._fetch('/voice/join', {
          method: 'POST',
          body: JSON.stringify({ nick: this.nick, roomId: this.channelId, muted: this.muted }),
        }, 2);

        if (res === null) {
          if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
          }
          throw new Error('no se pudo conectar al server de voz');
        }

        this.joined = true;
        // FIX #201b: resetear el flag en un join exitoso, para que un
        // leave posterior (o destroy) sí mande el keepalive.
        this._leaveSent = false;

        this.peersTimer = setInterval(() => {
          this._syncPeers().catch(()=>{});
        }, PEER_POLL_MS);
        this.signalTimer = setInterval(() => {
          this._pollSignals().catch(()=>{});
        }, SIGNAL_POLL_MS);
        this.heartbeatTimer = setInterval(() => {
          if (!this.joined) return;
          this._fetch('/voice/join', {
            method: 'POST',
            body: JSON.stringify({ nick: this.nick, roomId: this.channelId, muted: this.muted }),
          });
        }, HEARTBEAT_MS);

        await this._syncPeers();
        this._emit(true);
      } finally {
        this._joining = false;
      }
    }

    async leave() {
      if (this._leaving) return;
      this._leaving = true;
      try {
        const wasActive = this.joined || this.peers.size > 0 || !!this.localStream;
        if (!wasActive) return;

        // marcar ya como no-joined para cortar heartbeats/polls
        this.joined = false;
        clearInterval(this.peersTimer);    this.peersTimer = null;
        clearInterval(this.signalTimer);   this.signalTimer = null;
        clearInterval(this.heartbeatTimer); this.heartbeatTimer = null;

        // FIX #201a: keepalive en vez de _fetch. El AbortController de
        // _fetch cancela el POST durante el teardown del renderer (close
        // del launcher, alt+F4, pagehide). Con keepalive: true el request
        // sobrevive al unload y el backend limpia el peer al toque.
        this._sendLeaveKeepalive();

        for (const [, p] of this.peers) {
          try { p.pc.close(); } catch(e){}
          try { p.audio.remove(); } catch(e){}
        }
        this.peers.clear();

        if (this.localStream) {
          this.localStream.getTracks().forEach(t => t.stop());
          this.localStream = null;
        }

        this._seenMsgIds.clear();
        this._seenMsgOrder.length = 0;

        this._emit(true);
      } finally {
        this._leaving = false;
      }
    }

    toggleMute() {
      // FIX #7 (v1): permitir toggle aunque no haya stream (pre-config).
      this.muted = !this.muted;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
      }
      if (this.joined) {
        this._fetch('/voice/join', {
          method: 'POST',
          body: JSON.stringify({ nick: this.nick, roomId: this.channelId, muted: this.muted }),
        });
      }
      this._emit();
    }

    // ─── peers ──────────────────────────────────────────────
    async _syncPeers() {
      if (!this.joined) return;
      const data = await this._fetch(
        '/voice/peers?roomId=' + encodeURIComponent(this.channelId) +
        '&nick=' + encodeURIComponent(this.nick),
        { method: 'GET' }
      );
      if (!data || !data.peers) return;
      const seen = new Set();
      const myNk = this.nick.toLowerCase();
      for (const peer of data.peers) {
        if (!peer || !peer.nick) continue;
        const nk = peer.nick.toLowerCase();
        // FIX #11 (v1): ignorar si el server me devuelve a mí mismo.
        if (nk === myNk) continue;
        seen.add(nk);
        if (!this.peers.has(nk)) {
          await this._createPeer(peer.nick, myNk < nk);
        } else {
          this.peers.get(nk).muted = !!peer.muted;
        }
      }
      for (const [nk, p] of this.peers) {
        if (!seen.has(nk)) {
          try { p.pc.close(); } catch(e){}
          try { p.audio.remove(); } catch(e){}
          this.peers.delete(nk);
        }
      }
      this._emit();
    }

    async _createPeer(remoteNick, iAmOfferer) {
      const nk = remoteNick.toLowerCase();
      if (this.peers.has(nk)) return this.peers.get(nk);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);

      const entry = {
        pc, audio,
        nick: remoteNick,
        muted: false,
        // FIX #4 (v1): queue de ICE hasta tener remote description.
        pendingIce: [],
        hasRemote: false,
        // FIX #3 (v1): perfect negotiation — polite cede en colisión.
        polite: !iAmOfferer,
        makingOffer: false,
      };
      this.peers.set(nk, entry);

      if (this.localStream) {
        this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
      }

      pc.ontrack = (ev) => {
        if (ev.streams && ev.streams[0]) {
          audio.srcObject = ev.streams[0];
          if (this.speakerId && typeof audio.setSinkId === 'function') {
            audio.setSinkId(this.speakerId).catch(() => {});
          }
          audio.play().catch(() => {});
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this._fetch('/voice/signal', {
            method: 'POST',
            body: JSON.stringify({
              from: this.nick,
              to: remoteNick,
              type: 'ice',
              payload: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
            }),
          }, 1);
        }
      };

      // FIX #13 (v1): auto-cleanup de peers muertos.
      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'failed' || st === 'closed') {
          this._removePeer(nk);
        }
      };

      if (iAmOfferer) {
        try {
          entry.makingOffer = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await this._fetch('/voice/signal', {
            method: 'POST',
            body: JSON.stringify({
              from: this.nick,
              to: remoteNick,
              type: 'offer',
              payload: { sdp: pc.localDescription.sdp, type: pc.localDescription.type },
            }),
          }, 1);
        } catch(e) {
          console.warn('[voice] createOffer failed, limpiando peer:', e.message);
          this._removePeer(nk);
          return;
        } finally {
          entry.makingOffer = false;
        }
      }

      this._emit();
      return entry;
    }

    _removePeer(nk) {
      const p = this.peers.get(nk);
      if (!p) return;
      try { p.pc.close(); } catch(e){}
      try { p.audio.remove(); } catch(e){}
      this.peers.delete(nk);
      this._emit();
    }

    async _flushPendingIce(entry) {
      if (!entry.hasRemote || !entry.pendingIce.length) return;
      const queued = entry.pendingIce.splice(0);
      for (const cand of queued) {
        try { await entry.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){}
      }
    }

    // ─── signals ────────────────────────────────────────────
    async _pollSignals() {
      if (!this.joined) return;
      const data = await this._fetch(
        '/voice/poll?nick=' + encodeURIComponent(this.nick),
        { method: 'GET' }
      );
      if (!data || !data.messages) return;
      for (const msg of data.messages) {
        // FIX #12 (v1): dedupe.
        const msgId = msg.id ||
          (String(msg.from) + '|' + String(msg.type) + '|' +
           JSON.stringify(msg.payload || {}).slice(0, 64));
        if (!this._rememberMsg(msgId)) continue;
        try {
          await this._handleSignal(msg);
        } catch(e) {
          console.warn('[voice] signal error:', e.message);
        }
      }
    }

    async _handleSignal(msg) {
      const { from, type, payload } = msg;
      if (!from || !type) return;
      const nk = String(from).toLowerCase();
      if (nk === this.nick.toLowerCase()) return;

      let entry = this.peers.get(nk);
      if (!entry) {
        // no existía: lo creamos como "no offerer" (polite).
        await this._createPeer(from, false);
        entry = this.peers.get(nk);
        if (!entry) return;
      }
      const pc = entry.pc;

      if (type === 'offer') {
        // FIX #3 (v1): perfect negotiation.
        const collision = entry.makingOffer || pc.signalingState !== 'stable';
        if (collision && !entry.polite) {
          // somos impolite → ignoramos su offer y seguimos con el nuestro.
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          entry.hasRemote = true;
          await this._flushPendingIce(entry);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this._fetch('/voice/signal', {
            method: 'POST',
            body: JSON.stringify({
              from: this.nick,
              to: from,
              type: 'answer',
              payload: { sdp: pc.localDescription.sdp, type: pc.localDescription.type },
            }),
          }, 1);
        } catch(e) {
          console.warn('[voice] handle offer failed:', e.message);
        }
      } else if (type === 'answer') {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            entry.hasRemote = true;
            await this._flushPendingIce(entry);
          }
        } catch(e) {
          console.warn('[voice] handle answer failed:', e.message);
        }
      } else if (type === 'ice') {
        // FIX #4 (v1): queuear si todavía no hay remote description.
        if (!entry.hasRemote) {
          entry.pendingIce.push(payload);
          return;
        }
        try { await entry.pc.addIceCandidate(new RTCIceCandidate(payload)); } catch(e){}
      }
    }

    // ─── cleanup ────────────────────────────────────────────
    // FIX #201b: destroy total e idempotente. Si el cliente todavía
    // está joined, forzamos un keepalive leave sin pasar por las
    // validaciones de leave() (que pueden haber sido saltadas si el
    // join falló a medias y _leaving quedó en estado raro). El flag
    // _leaveSent evita doble send si leave() ya se llamó antes.
    async destroy() {
      try {
        // Cortar todos los timers primero, así nada re-entra.
        this.joined = false;
        clearInterval(this.peersTimer);    this.peersTimer = null;
        clearInterval(this.signalTimer);   this.signalTimer = null;
        clearInterval(this.heartbeatTimer); this.heartbeatTimer = null;

        // Red de seguridad: si por lo que sea leave() no llegó a mandar
        // el keepalive, lo mandamos acá. Idempotente por _leaveSent.
        this._sendLeaveKeepalive();

        // Teardown local de peers y stream.
        for (const [, p] of this.peers) {
          try { p.pc.close(); } catch(e){}
          try { p.audio.remove(); } catch(e){}
        }
        this.peers.clear();

        if (this.localStream) {
          this.localStream.getTracks().forEach(t => t.stop());
          this.localStream = null;
        }

        this._seenMsgIds.clear();
        this._seenMsgOrder.length = 0;
        this._emit(true);
      } catch (e) {
        console.warn('[voice-core] destroy:', e.message);
      } finally {
        // Desvincular callback para evitar emisiones post-destroy.
        this.onStateChange = () => {};
      }
    }
  }

  window.BCVoiceClient = BCVoiceClient;
  console.log('[voice-core] cargado v2');
})();