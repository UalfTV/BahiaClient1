'use strict';

// ============================================================
// BahiaClient — Voice chat (game view)
// ============================================================
// Corre dentro del game view. Habla directo con el backend
// (`/voice/*`). Avisa al launcher cuando cambia el estado de
// voz (para que actualice Discord RPC) vía `bcIPC.notifyHost`.
//
// v3 — fixes #200:
//   · ensureMic() cae a device default si el mic guardado ya no
//     existe (OverconstrainedError / NotFoundError).
//   · switchMicDevice() revierte selectedMicId si falla.
//   · voiceCreatePeer() agrega oniceconnectionstatechange para
//     limpiar peers muertos, y perfect negotiation (polite /
//     makingOffer) para colisiones de offer.
//   · voiceHandleSignal() queuea ICE candidates que llegan antes
//     de tener remoteDescription, y hace rollback cuando cede
//     una colisión como peer "polite".
//
// v2 — fixes previos:
//   · ensureMic respeta state.muted al capturar.
//   · voiceSyncPeers ignora tu propio nick si el backend te
//     incluye en la lista de peers.
//   · pc.ontrack cae a new MediaStream([ev.track]) si el SDP
//     remoto no asocia un stream.
//   · voiceCreatePeer limpia del map si createOffer falla.
//   · voiceJoin loggea warning si el backend rechaza el join.
//   · beforeunload usa fetch(..., { keepalive: true }).
//
// Necesita:
//   · window.__bcBackend con { url, key } (inyectado por el launcher)
//   · ?roomId=... y ?nick=... en el URL del game view
//   · Los elementos de UI (voice-btn, voice-panel, voice-mic-select,
//     voice-spk-select, voice-mute-btn, voice-strip, voices-list,
//     voice-panel-body) que ya están en game/index.html
// ============================================================

(function () {

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  function getParam(name) {
    const m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  const roomId = getParam('roomId');
  const myNick = getParam('nick') || 'Player';

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const state = {
    joined: false,
    roomId: null,
    nick: myNick,
    localStream: null,
    peers: new Map(),
    muted: false,
    peersTimer: null,
    signalTimer: null,
    heartbeatTimer: null,
  };

  let availableMics = [];
  let availableSpeakers = [];
  let selectedMicId = null;
  let selectedSpeakerId = null;
  try { selectedMicId = localStorage.getItem('bc_mic_id') || null; } catch(e){}
  try { selectedSpeakerId = localStorage.getItem('bc_speaker_id') || null; } catch(e){}

  function getBackend() {
    const b = window.__bcBackend;
    if (!b || !b.url) return null;
    return { url: String(b.url).replace(/\/+$/, ''), key: b.key || '' };
  }

  async function backendFetch(path, opts) {
    const be = getBackend();
    if (!be) return null;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(be.url + path, Object.assign({}, opts, {
        headers: Object.assign({ 'Content-Type': 'application/json', 'x-bc-key': be.key }, (opts && opts.headers) || {}),
        signal: ctrl.signal,
      }));
      clearTimeout(to);
      let data = null;
      try { data = await res.json(); } catch(_){}
      return res.ok ? data : null;
    } catch (e) {
      console.warn('[voice] fetch error:', path, e.message);
      return null;
    }
  }

  function notifyLauncher() {
    try {
      window.bcIPC?.notifyHost?.('voice-state', {
        joined: state.joined,
        muted: state.muted,
        peerCount: state.peers.size,
      });
    } catch (e) {}
  }

  function isVoiceSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
  }

  async function refreshVoiceDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      const looksLocked = devices.some(d => (d.kind === 'audioinput' || d.kind === 'audiooutput') && !d.label);
      if (looksLocked && navigator.mediaDevices.getUserMedia) {
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
          tmp.getTracks().forEach(t => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch (e) { console.warn('[voice] no se pudo desbloquear la lista de dispositivos:', e.message); }
      }
      availableMics = devices.filter(d => d.kind === 'audioinput');
      availableSpeakers = devices.filter(d => d.kind === 'audiooutput');

      const micSelect = $('voice-mic-select');
      const spkSelect = $('voice-spk-select');

      if (micSelect) {
        if (!availableMics.length) {
          micSelect.innerHTML = '<option>Sin micrófonos</option>';
        } else {
          micSelect.innerHTML = availableMics.map((d, i) => {
            const label = d.label || `Micrófono ${i + 1}`;
            const sel = (selectedMicId && d.deviceId === selectedMicId) ? ' selected' : '';
            return `<option value="${d.deviceId}"${sel}>${esc(label)}</option>`;
          }).join('');
          if (!selectedMicId && availableMics[0]) selectedMicId = availableMics[0].deviceId;
        }
      }

      if (spkSelect) {
        if (!availableSpeakers.length) {
          spkSelect.innerHTML = '<option>Salida por defecto</option>';
        } else {
          spkSelect.innerHTML = availableSpeakers.map((d, i) => {
            const label = d.label || `Salida ${i + 1}`;
            const sel = (selectedSpeakerId && d.deviceId === selectedSpeakerId) ? ' selected' : '';
            return `<option value="${d.deviceId}"${sel}>${esc(label)}</option>`;
          }).join('');
          if (!selectedSpeakerId && availableSpeakers[0]) selectedSpeakerId = availableSpeakers[0].deviceId;
        }
      }
    } catch (e) { console.warn('[voice] enumerateDevices falló:', e.message); }
  }

  async function onMicChange(deviceId) {
    if (!deviceId) return;
    selectedMicId = deviceId;
    try { localStorage.setItem('bc_mic_id', deviceId); } catch(e){}
    if (state.joined) {
      await switchMicDevice(deviceId);
    } else if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
    }
  }

  async function switchMicDevice(deviceId) {
    // FIX #200b: guardar el id previo para poder revertir si falla.
    const prevId = selectedMicId;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const newTrack = newStream.getAudioTracks()[0];
      newTrack.enabled = !state.muted;
      for (const [, peer] of state.peers) {
        try {
          const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
          if (sender) await sender.replaceTrack(newTrack);
        } catch (e) { console.warn('[voice] replaceTrack falló:', e.message); }
      }
      if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = newStream;
    } catch (e) {
      // FIX #200b: si el cambio de mic falla (device desenchufado, permiso
      // revocado en caliente, ID rotado por el OS), revertir la selección
      // para que el dropdown no quede mostrando un device que no está
      // activo. Sin esto el usuario veía "mic X" en la UI pero seguía
      // transmitiendo con el anterior (o con nada).
      console.error('[voice] switchMicDevice falló:', e);
      selectedMicId = prevId;
      try {
        if (prevId) localStorage.setItem('bc_mic_id', prevId);
        else localStorage.removeItem('bc_mic_id');
      } catch(_){}
      await refreshVoiceDevices();
    }
  }

  function onSpeakerChange(deviceId) {
    if (!deviceId) return;
    selectedSpeakerId = deviceId;
    try { localStorage.setItem('bc_speaker_id', deviceId); } catch(e){}
    for (const [, peer] of state.peers) {
      if (peer.audio && typeof peer.audio.setSinkId === 'function') {
        peer.audio.setSinkId(deviceId).catch(e => console.warn('[voice] setSinkId falló:', e.message));
      }
    }
  }

  async function ensureMic() {
    if (state.localStream) return state.localStream;
    if (!isVoiceSupported()) throw new Error('WebRTC no soportado');
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    };
    if (selectedMicId) constraints.audio.deviceId = { exact: selectedMicId };
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // FIX #200a: si el device guardado ya no existe (desenchufado, ID
      // rotado por el OS tras un reinicio, permisos cambiados), tiramos
      // OverconstrainedError o NotFoundError. Antes esto reventaba la
      // entrada a la voz sin forma de recuperarse sin borrar localStorage
      // a mano. Ahora caemos a device default y limpiamos la selección.
      if (selectedMicId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        console.warn('[voice] mic guardado no disponible, usando default');
        selectedMicId = null;
        try { localStorage.removeItem('bc_mic_id'); } catch(_){}
        delete constraints.audio.deviceId;
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } else {
        throw e;
      }
    }
    // FIX v2: aplicar el estado de mute actual al track recién capturado.
    state.localStream.getAudioTracks().forEach(t => { t.enabled = !state.muted; });
    return state.localStream;
  }

  function updateVoiceUI() {
    const btn = $('voice-btn');
    const icon = $('voice-btn-icon');
    const count = $('voice-btn-count');
    const strip = $('voice-strip');
    const muteBtn = $('voice-mute-btn');
    const muteIcon = $('voice-mute-icon');
    const muteText = $('voice-mute-text');

    if (!btn) return;

    btn.classList.remove('live', 'mute');
    if (state.joined) {
      btn.classList.add(state.muted ? 'mute' : 'live');
      if (icon) icon.className = state.muted ? 'ti ti-microphone-off' : 'ti ti-microphone';
      if (count) { count.textContent = state.peers.size + 1; count.style.display = ''; }
      if (strip) strip.style.display = 'flex';
      if (muteIcon) muteIcon.className = state.muted ? 'ti ti-microphone-off' : 'ti ti-microphone';
      if (muteText) muteText.textContent = state.muted ? 'Activar' : 'Mutear';
      if (muteBtn) muteBtn.classList.toggle('mute', state.muted);
    } else {
      if (icon) icon.className = 'ti ti-microphone';
      if (count) count.style.display = 'none';
      if (strip) strip.style.display = 'none';
    }

    const peersList = $('voices-list');
    const items = [];
    if (state.nick) items.push({ nick: state.nick, self: true, muted: state.muted });
    for (const [, p] of state.peers) items.push({ nick: p.nick, self: false, muted: p.muted });
    if (peersList) peersList.innerHTML = items.map(p =>
      `<span class="vp ${p.muted ? 'muted' : ''}">${p.self ? '<i class="ti ti-user"></i>' : ''}${esc(p.nick)}${p.muted ? ' <i class="ti ti-microphone-off"></i>' : ''}</span>`
    ).join('');

    const body = $('voice-panel-body');
    if (!body) return;
    if (state.joined) {
      body.innerHTML =
        `<div class="voice-peers">${items.map(p => `<div class="voice-peer ${p.self ? 'self' : ''} ${p.muted ? 'muted' : ''}"><span class="vdot"></span><span class="vname">${esc(p.nick)}${p.self ? ' (vos)' : ''}</span>${p.muted ? '<i class="ti ti-microphone-off" style="color:#f59e0b;font-size:12px"></i>' : ''}</div>`).join('')}</div>` +
        `<div class="voice-actions"><button class="fb p" onclick="voiceToggleMute()">${state.muted ? 'Activar mic' : 'Mutear'}</button><button class="fb danger" onclick="voiceLeave()">Salir</button></div>`;
    } else {
      body.innerHTML =
        `<div class="voice-hint">Entrá a un chat de voz para hablar con otros usuarios de BahiaClient.</div>` +
        `<div class="voice-actions" style="margin-top:10px"><button class="fb p" onclick="voiceJoin()">Unirse</button></div>`;
    }
  }

  function positionVoicePanel() {
    const p = $('voice-panel');
    const btn = $('voice-btn');
    if (!p || !btn) return;
    const r = btn.getBoundingClientRect();
    const panelW = 290;
    let left = r.right - panelW;
    left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
    p.style.top = (r.bottom + 8) + 'px';
    p.style.left = left + 'px';
  }

  function toggleVoicePanel() {
    const p = $('voice-panel');
    if (!p) return;
    if (p.parentElement !== document.body) document.body.appendChild(p);
    p.classList.toggle('on');
    const open = p.classList.contains('on');
    if (open) positionVoicePanel();
    if (open) refreshVoiceDevices();
    updateVoiceUI();
  }

  async function voiceJoin() {
    if (state.joined) return;
    if (!getBackend()) { console.warn('[voice] backend no configurado'); return; }
    if (!roomId) { console.warn('[voice] no hay roomId en el URL'); return; }
    if (!isVoiceSupported()) { alert('Tu sistema no soporta captura de audio.'); return; }
    try { await ensureMic(); } catch (e) { alert('No se pudo acceder al micrófono: ' + (e.message || e)); return; }
    await refreshVoiceDevices();
    state.nick = myNick;
    state.roomId = roomId;
    state.joined = true;
    const joinRes = await backendFetch('/voice/join', {
      method: 'POST',
      body: JSON.stringify({ nick: state.nick, roomId: state.roomId, muted: state.muted }),
    });
    // FIX v2: si el backend rechaza el join, avisar. Seguimos "joined"
    // localmente (el heartbeat va a reintentar), pero al menos queda
    // registro en consola de por qué no hay peers.
    if (!joinRes) console.warn('[voice] backend no confirmó /voice/join; se reintentará por heartbeat');
    state.peersTimer = setInterval(voiceSyncPeers, 4000);
    state.signalTimer = setInterval(voicePollSignals, 2000);
    state.heartbeatTimer = setInterval(() => {
      backendFetch('/voice/join', {
        method: 'POST',
        body: JSON.stringify({ nick: state.nick, roomId: state.roomId, muted: state.muted }),
      });
    }, 8000);
    voiceSyncPeers();
    updateVoiceUI();
    notifyLauncher();
  }

  async function voiceLeave() {
    if (!state.joined) return;
    try {
      await backendFetch('/voice/leave', { method: 'POST', body: JSON.stringify({ nick: state.nick }) });
    } catch (e) {}
    for (const [, p] of state.peers) {
      try { p.pc.close(); } catch (e) {}
      try { p.audio.remove(); } catch (e) {}
    }
    state.peers.clear();
    if (state.localStream) {
      state.localStream.getTracks().forEach(t => t.stop());
      state.localStream = null;
    }
    clearInterval(state.peersTimer);
    clearInterval(state.signalTimer);
    clearInterval(state.heartbeatTimer);
    state.peersTimer = state.signalTimer = state.heartbeatTimer = null;
    state.joined = false;
    state.roomId = null;
    updateVoiceUI();
    notifyLauncher();
  }

  function voiceToggleMute() {
    if (!state.localStream) return;
    state.muted = !state.muted;
    state.localStream.getAudioTracks().forEach(t => { t.enabled = !state.muted; });
    if (state.roomId && state.nick) {
      backendFetch('/voice/join', {
        method: 'POST',
        body: JSON.stringify({ nick: state.nick, roomId: state.roomId, muted: state.muted }),
      });
    }
    updateVoiceUI();
    notifyLauncher();
  }

  // FIX #200c: helper para limpiar un peer. Centraliza el teardown de
  // pc + audio + Map entry + UI refresh, y se usa desde 3 lugares
  // (sync, iceconnectionstatechange, createOffer catch) que antes cada
  // uno repetía el cleanup a mano.
  function voiceRemovePeer(nk) {
    const p = state.peers.get(nk);
    if (!p) return;
    try { p.pc.close(); } catch (e) {}
    try { p.audio.remove(); } catch (e) {}
    state.peers.delete(nk);
    updateVoiceUI();
  }

  async function voiceSyncPeers() {
    if (!state.joined) return;
    const data = await backendFetch(
      '/voice/peers?roomId=' + encodeURIComponent(state.roomId) + '&nick=' + encodeURIComponent(state.nick),
      { method: 'GET' }
    );
    if (!data || !data.peers) return;
    const myNk = state.nick.toLowerCase();
    const seen = new Set();
    for (const peer of data.peers) {
      if (!peer || !peer.nick) continue;
      const nk = peer.nick.toLowerCase();
      // FIX v2: ignorar si el backend nos incluye a nosotros mismos.
      if (nk === myNk) continue;
      seen.add(nk);
      if (!state.peers.has(nk)) voiceCreatePeer(peer.nick, myNk < nk);
      else state.peers.get(nk).muted = !!peer.muted;
    }
    for (const [nk] of state.peers) {
      if (!seen.has(nk)) voiceRemovePeer(nk);
    }
    updateVoiceUI();
    notifyLauncher();
  }

  async function voiceCreatePeer(remoteNick, iAmOfferer) {
    const nk = remoteNick.toLowerCase();
    if (state.peers.has(nk)) return state.peers.get(nk);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);

    // FIX #200c: metadata extendida para perfect negotiation y ICE queue.
    const entry = {
      pc, audio,
      nick: remoteNick,
      muted: false,
      // ICE queue: si un candidate llega antes de tener remoteDescription
      // (offer/answer), addIceCandidate tira InvalidStateError y el
      // candidate se pierde silenciosamente → conexión cuelga en
      // "checking" para siempre. Con la cola, se aplican apenas llega
      // el remote description.
      pendingIce: [],
      hasRemote: false,
      // Perfect negotiation: el "polite" (quien NO ofertó) cede ante
      // colisiones. Sin esto, dos peers ofertando al mismo tiempo
      // pueden tirar "setLocalDescription called with wrong state" y
      // dejar la conexión trabada.
      polite: !iAmOfferer,
      makingOffer: false,
    };
    state.peers.set(nk, entry);

    if (state.localStream) state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream));

    pc.ontrack = (ev) => {
      // FIX v2: si el SDP remoto no asocia un MediaStream, ev.streams
      // viene vacío y el audio queda mudo.
      const stream = (ev.streams && ev.streams[0]) ? ev.streams[0] : new MediaStream([ev.track]);
      audio.srcObject = stream;
      if (selectedSpeakerId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(selectedSpeakerId).catch(() => {});
      }
      audio.play().catch(e => console.warn('[voice] autoplay bloqueado:', e.message));
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        backendFetch('/voice/signal', {
          method: 'POST',
          body: JSON.stringify({
            from: state.nick, to: remoteNick, type: 'ice',
            payload: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
          }),
        });
      }
    };

    // FIX #200c: auto-cleanup. Si el ICE falla (NAT simétrico, peer se
    // fue sin leave, red cambió), el PC queda en estado 'failed' y el
    // peer huérfano en el Map. Sin esto, voiceSyncPeers lo veía ya
    // existente y NUNCA lo recreaba → el peer quedaba mudo para siempre.
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === 'failed' || st === 'closed') {
        voiceRemovePeer(nk);
      }
    };

    if (iAmOfferer) {
      try {
        entry.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        backendFetch('/voice/signal', {
          method: 'POST',
          body: JSON.stringify({
            from: state.nick, to: remoteNick, type: 'offer',
            payload: { sdp: pc.localDescription.sdp, type: pc.localDescription.type },
          }),
        });
      } catch (e) {
        // FIX v2: limpiar si createOffer falla.
        console.warn('[voice] createOffer falló para', remoteNick, '— limpiando peer:', e.message);
        voiceRemovePeer(nk);
        return;
      } finally {
        entry.makingOffer = false;
      }
    }
    updateVoiceUI();
    return entry;
  }

  // FIX #200d: aplicar ICE candidates encolados cuando llegue el
  // remoteDescription. Se llama después de setRemoteDescription en
  // voiceHandleSignal (offer y answer).
  async function voiceFlushPendingIce(entry) {
    if (!entry || !entry.hasRemote || !entry.pendingIce.length) return;
    const queued = entry.pendingIce.splice(0);
    for (const cand of queued) {
      try { await entry.pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
    }
  }

  async function voicePollSignals() {
    if (!state.joined) return;
    const data = await backendFetch('/voice/poll?nick=' + encodeURIComponent(state.nick), { method: 'GET' });
    if (!data || !data.messages) return;
    for (const msg of data.messages) {
      try { await voiceHandleSignal(msg); } catch (e) {}
    }
  }

  async function voiceHandleSignal(msg) {
    const { from, type, payload } = msg;
    if (!from || !type) return;
    const nk = from.toLowerCase();
    if (nk === state.nick.toLowerCase()) return; // por si el backend se autorresponde

    let entry = state.peers.get(nk);
    if (!entry) {
      await voiceCreatePeer(from, false);
      entry = state.peers.get(nk);
      if (!entry) return;
    }
    const pc = entry.pc;

    if (type === 'offer') {
      // FIX #200c: perfect negotiation. Si ya estamos en medio de un
      // offer nuestro y no somos "polite", ignoramos el offer entrante
      // (nuestro peer ganará la negociación). Si somos polite, cedemos
      // haciendo rollback de nuestro offer local y procesamos el suyo.
      const collision = entry.makingOffer || pc.signalingState !== 'stable';
      if (collision && !entry.polite) return;

      try {
        if (collision && entry.polite && pc.signalingState === 'have-local-offer') {
          try { await pc.setLocalDescription({ type: 'rollback' }); } catch (_) {}
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        entry.hasRemote = true;
        // FIX #200d: flushear ICE queue ahora que tenemos remote desc.
        await voiceFlushPendingIce(entry);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        backendFetch('/voice/signal', {
          method: 'POST',
          body: JSON.stringify({
            from: state.nick, to: from, type: 'answer',
            payload: { sdp: pc.localDescription.sdp, type: pc.localDescription.type },
          }),
        });
      } catch (e) {
        console.warn('[voice] handle offer failed:', e.message);
      }
    } else if (type === 'answer') {
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          entry.hasRemote = true;
          await voiceFlushPendingIce(entry);
        }
      } catch (e) {
        console.warn('[voice] handle answer failed:', e.message);
      }
    } else if (type === 'ice') {
      // FIX #200d: queuear si todavía no hay remote description.
      if (!entry.hasRemote) {
        entry.pendingIce.push(payload);
        return;
      }
      try { await pc.addIceCandidate(new RTCIceCandidate(payload)); } catch (e) {}
    }
  }

  document.addEventListener('click', (e) => {
    const w = $('voice-widget');
    const p = $('voice-panel');
    if (!w || !p) return;
    // FIX v2: e.target.isConnected evita que el panel se cierre cuando
    // el click borra el nodo (ej. botón Mutear → re-render → target
    // detached → p.contains(target) = false).
    if (!e.target.isConnected) return;
    if (p.classList.contains('on') && !w.contains(e.target) && !p.contains(e.target)) {
      p.classList.remove('on');
    }
  });

  window.addEventListener('resize', () => {
    const p = $('voice-panel');
    if (p && p.classList.contains('on')) positionVoicePanel();
  });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      refreshVoiceDevices();
    });
  }

  window.addEventListener('beforeunload', () => {
    if (state.joined) {
      // FIX v2: fetch normal es cancelado por el navegador durante
      // beforeunload. keepalive: true garantiza el envío (payload
      // < 64 KB). No usamos sendBeacon porque no permite headers
      // custom (x-bc-key).
      const be = getBackend();
      if (be) {
        try {
          fetch(be.url + '/voice/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bc-key': be.key },
            body: JSON.stringify({ nick: state.nick }),
            keepalive: true,
          });
        } catch (e) {}
      }
    }
  });

  window.toggleVoicePanel = toggleVoicePanel;
  window.onMicChange = onMicChange;
  window.onSpeakerChange = onSpeakerChange;
  window.voiceJoin = voiceJoin;
  window.voiceLeave = voiceLeave;
  window.voiceToggleMute = voiceToggleMute;
  window.updateVoiceUI = updateVoiceUI;

  refreshVoiceDevices();
  updateVoiceUI();
  notifyLauncher();

  console.log('[voice] cargado (game view) v3');
})();