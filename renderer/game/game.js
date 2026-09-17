'use strict';

// ==== BC-GAME-EVENTS ====
window.BCGameEvents = window.BCGameEvents || {
  _listeners: {},
  on: function(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
    return () => { this._listeners[evt] = this._listeners[evt].filter(f => f !== fn); };
  },
  emit: function(evt, data) {
    const fns = this._listeners[evt] || [];
    for (const fn of fns) { try { fn(data); } catch(e) { console.error('[BCGameEvents]', evt, e); } }
  }
};
(function () {

  var PROXY = {
    WebSocketUrl: 'wss://node-haxball.onrender.com/',
    HttpUrl: 'https://node-haxball.onrender.com/rs/',
  };

  var AUTH_KEY = 'bc_haxball_auth';

  function getParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  var roomId = getParam('roomId');
  var roomPass = getParam('pass') || null;
  var nick = getParam('nick') || 'Player';

  // ============================================================
  // Marca de cliente (checkmark de "usa BahiaClient")
  // ------------------------------------------------------------
  // Vamos dos caracteres invisibles (zero-width space + word joiner) pegados
  // al final del nombre que mandamos a la sala. Viaja como parte del nombre
  // real en el protocolo de Haxball, así que cualquiera en la sala —tenga
  // BahiaClient o no— recibe ese nombre "con la marca puesta". Nosotros la
  // detectamos y la mostramos como check; a un cliente vanilla simplemente
  // no le hace nada raro (son caracteres invisibles, no rompen el nombre).
  var BC_MARK = '\u200B\u2060';

  function bcHasMark(name) {
    return typeof name === 'string' && name.indexOf(BC_MARK) !== -1;
  }
  function bcCleanName(name) {
    if (typeof name !== 'string') return name;
    return name.split(BC_MARK).join('');
  }
  function bcBadgeHTML(name) {
    return bcHasMark(name)
      ? '<span class="bc-verified" title="Juega con BahiaClient">&#10003;</span>'
      : '';
  }

  var $scoreboard = document.getElementById('bc-scoreboard');
  var $scoreRed = document.getElementById('bc-score-red');
  var $scoreBlue = document.getElementById('bc-score-blue');
  var $time = document.getElementById('bc-time');
  var $topright = document.getElementById('bc-topright');
  var $btnMenu = document.getElementById('bc-btn-menu');
  var $btnSound = document.getElementById('bc-btn-sound');
  var $chatWrap = document.getElementById('bc-chat-wrap');
  var $chat = document.getElementById('bc-chat');
  var $chatText = document.getElementById('bc-chat-text');
  var $modal = document.getElementById('bc-menu-modal');
  var $modalBk = document.getElementById('bc-modal-backdrop');
  var $modalTitle = document.getElementById('bc-modal-title');
  var $modalRec = document.getElementById('bc-modal-rec');
  var $modalLink = document.getElementById('bc-modal-link');
  var $modalLeave = document.getElementById('bc-modal-leave');
  var $listRed = document.getElementById('bc-list-red');
  var $listSpec = document.getElementById('bc-list-spec');
  var $listBlue = document.getElementById('bc-list-blue');
  var $infoTime = document.getElementById('bc-info-timelimit');
  var $infoScore = document.getElementById('bc-info-scorelimit');

  // FIX #1: helper para addEventListener null-safe.
  // Antes: si UNA sola de estas IDs faltaba, todo el IIFE crasheaba
  // silenciosamente y game.js quedaba muerto.
  function _safeOn(el, ev, fn, opts) {
    if (!el) { console.warn('[game] falta elemento para listener:', ev); return; }
    el.addEventListener(ev, fn, opts);
  }

  // ------------------------------------------------------------
  // INFO EDITABLE
  // ------------------------------------------------------------
  (function transformInfoToInputs(){
    if(!document.getElementById('bc-info-input-style')){
      var st = document.createElement('style');
      st.id = 'bc-info-input-style';
      st.textContent = [
        '.bc-info-input{',
        '  width:64px;padding:4px 8px;',
        '  background:rgba(0,0,0,.35);',
        '  border:1px solid rgba(255,255,255,.08);',
        '  border-radius:6px;',
        '  color:#eef2f8;font-family:inherit;font-size:14px;font-weight:600;',
        '  outline:none;',
        '  transition:border-color .15s, background .15s, box-shadow .15s;',
        '  -moz-appearance:textfield;',
        '}',
        '.bc-info-input::-webkit-outer-spin-button,',
        '.bc-info-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
        '.bc-info-input:focus{',
        '  border-color:rgba(125,211,252,.55);',
        '  background:rgba(0,0,0,.55);',
        '  box-shadow:0 0 0 3px rgba(125,211,252,.14);',
        '}',
        '.bc-info-input:disabled{',
        '  background:transparent;border-color:transparent;',
        '  color:#a8b0bc;cursor:default;opacity:.85;',
        '}'
      ].join('\n');
      document.head.appendChild(st);
    }

    function toNumberInput(el){
      if(!el || el.tagName === 'INPUT') return el;
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.id = el.id;
      inp.className = (el.className || '') + ' bc-info-input';
      inp.min = '0';
      inp.max = '99';
      inp.placeholder = '-';
      el.parentNode.replaceChild(inp, el);
      return inp;
    }

    $infoTime  = toNumberInput($infoTime);
    $infoScore = toNumberInput($infoScore);
  })();
  var $infoStadium = document.getElementById('bc-info-stadium');
  var $status = document.getElementById('bc-status');
  var $statusTitle = document.getElementById('bc-status-title');
  var $statusDesc = document.getElementById('bc-status-desc');

  var modalOpen = false;
  var _userClosedModal = false;
  var currentRoom = null;
  var adminBound = false;

  var _domCache = Object.create(null);
  // FIX #8: si el nodo cacheado no está conectado, reemplazar. Si el id
  // no existe todavía, borrar la entrada para no acumular nulls.
  function _dom(id){
    var el = _domCache[id];
    if (el && el.isConnected) return el;
    el = document.getElementById(id);
    if (el) _domCache[id] = el;
    else delete _domCache[id];
    return el;
  }

  var _tbEls = null;
  function _getTbEls(){
    if (_tbEls) return _tbEls;
    _tbEls = {
      tb:        document.getElementById('bc-modal-admin'),
      startBtn:  document.getElementById('bc-btn-start'),
      stopBtn:   document.getElementById('bc-btn-stop'),
      pBtn:      document.getElementById('bc-btn-pause'),
      pickBtn:   document.getElementById('bc-btn-pickstadium'),
      autoBtn:   document.getElementById('bc-btn-autoteams'),
      lockBtn:   document.getElementById('bc-btn-lockteams'),
      resetBtn:  document.getElementById('bc-btn-reset')
    };
    return _tbEls;
  }

  var STATUS_STEPS = ['Iniciando...', 'Obteniendo credenciales...', 'Cargando imagenes...', 'Conectando a la sala...', 'Iniciando renderer...'];

  function setStatus(title, desc) {
    $status.classList.remove('hidden');
    $statusTitle.style.color = '';
    $statusTitle.textContent = title || 'Cargando...';
    $statusDesc.textContent = desc || '';

    var idx = STATUS_STEPS.indexOf(title);
    var stepsEl = document.getElementById('bc-status-steps');
    if (stepsEl && idx >= 0) {
      var dots = stepsEl.children;
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('done', i <= idx);
      }
    }
  }

  function hideStatus() {
    $status.classList.add('hidden');
  }

  function setError(title, desc) {
    $status.classList.remove('hidden');
    $statusTitle.style.color = 'var(--bc-bad)';
    $statusTitle.textContent = title || 'Error';
    $statusDesc.textContent = desc || '';
  }

  var Sound = (function () {
    var ctx = null;
    var buffers = {};
    var gainNode = null;
    var enabled = true;
    var volume = 0.35;

    function ensureCtx() {
      if (ctx) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = ctx.createGain();
        gainNode.gain.value = volume;
        gainNode.connect(ctx.destination);
      } catch (e) {}
    }

    function load(name, url) {
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          return new Promise(function (res, rej) {
            ensureCtx();
            if (!ctx) { rej(new Error('no ctx')); return; }
            ctx.decodeAudioData(buf, res, rej);
          });
        })
        .then(function (b) { buffers[name] = b; })
        .catch(function (e) { console.warn('[sound] fail', name, e.message); });
    }

    function play(name) {
      if (!enabled) return;
      ensureCtx();
      if (!ctx || !buffers[name]) return;
      try {
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () { });
        var s = ctx.createBufferSource();
        s.buffer = buffers[name];
        s.connect(gainNode);
        s.start(0);
      } catch (e) {}
    }

    return {
      preload: function () {
        load('chat', 'assets/sounds/chat.ogg');
        load('goal', 'assets/sounds/goal.ogg');
        load('highlight', 'assets/sounds/highlight.wav');
        load('join', 'assets/sounds/join.ogg');
        load('kick', 'assets/sounds/kick.ogg');
        load('leave', 'assets/sounds/leave.ogg');
        load('crowd', 'assets/sounds/crowd.ogg');
      },
      play: play,
      toggle: function () { enabled = !enabled; return enabled; },
      isEnabled: function () { return enabled; },
      setVolume: function (v) { volume = Math.max(0, Math.min(1, v)); if (gainNode) gainNode.gain.value = volume; },
      getVolume: function () { return volume; }
    };
  })();

  function pushChat(nick, message, team, kind, verified) {
    var row = document.createElement('div');
    row.className = 'msg' + (kind ? ' ' + kind : '');
    if (kind === 'system' || kind === 'warn' || kind === 'news' || kind === 'join' || kind === 'leave') {
      row.textContent = message;
    } else {
      if (team === 'red' || team === 'blue') {
        var dot = document.createElement('span');
        dot.className = 'team-dot ' + team;
        row.appendChild(dot);
      }
      if (verified) {
        var vb = document.createElement('span');
        vb.className = 'bc-verified';
        vb.title = 'Juega con BahiaClient';
        vb.textContent = '\u2713';
        row.appendChild(vb);
      }
      var ns = document.createElement('span');
      ns.className = 'nick' + (team === 'red' ? ' red' : team === 'blue' ? ' blue' : '');
      ns.textContent = nick + ':';
      row.appendChild(ns);
      row.appendChild(document.createTextNode(' ' + message));
    }
    $chat.appendChild(row);
    while ($chat.childNodes.length > 100) $chat.removeChild($chat.firstChild);
    $chat.classList.remove('empty');
    $chat.classList.remove('hidden-by-timer');
    if (!_chatScrollScheduled) {
      _chatScrollScheduled = true;
      requestAnimationFrame(function () {
        _chatScrollScheduled = false;
        $chat.scrollTop = $chat.scrollHeight;
      });
    }
  }

  var _chatScrollScheduled = false;

  (function setupChatDragResize() {
    var STORAGE_KEY = 'bc_chat_rect_v1';
    var wrap = document.getElementById('bc-chat-wrap');
    var dragHandle = document.getElementById('bc-chat-drag');
    if (!wrap || !dragHandle) return;

    function saveRect() {
      try {
        var r = wrap.getBoundingClientRect();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          left:   Math.round(r.left),
          top:    Math.round(r.top),
          width:  Math.round(Math.min(r.width,  window.innerWidth  - 20)),
          height: Math.round(Math.min(r.height, window.innerHeight - 20)),
        }));
      } catch (e) {}
    }

    function applyRect(rect) {
      wrap.style.left = rect.left + 'px';
      wrap.style.top = rect.top + 'px';
      wrap.style.width = rect.width + 'px';
      wrap.style.height = rect.height + 'px';
      wrap.style.bottom = 'auto';
      wrap.style.transform = 'none';
    }

    function loadRect() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        var r = JSON.parse(raw);
        if (r.width > window.innerWidth) r.width = window.innerWidth - 40;
        if (r.height > window.innerHeight) r.height = window.innerHeight - 40;
        if (r.left < 0) r.left = 0;
        if (r.top < 0) r.top = 0;
        if (r.left + r.width > window.innerWidth) r.left = window.innerWidth - r.width;
        if (r.top + r.height > window.innerHeight) r.top = window.innerHeight - r.height;
        return r;
      } catch (e) { return null; }
    }

    var saved = loadRect();
    if (saved) applyRect(saved);

    // Botón de ocultar chat
    var $hideBtn = document.getElementById('bc-chat-hide');
    if ($hideBtn) {
      $hideBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        wrap.classList.add('hidden-by-user');
        try { localStorage.setItem('bc_chat_hidden', '1'); } catch(e){}
      });
    }
    try {
      if (localStorage.getItem('bc_chat_hidden') === '1') wrap.classList.add('hidden-by-user');
    } catch(e){}

    var dragState = null;
    dragHandle.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      var r = wrap.getBoundingClientRect();
      dragState = { offsetX: ev.clientX - r.left, offsetY: ev.clientY - r.top, width: r.width, height: r.height };
      wrap.classList.add('dragging');
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    });

    function onDragMove(ev) {
      if (!dragState) return;
      var left = ev.clientX - dragState.offsetX;
      var top = ev.clientY - dragState.offsetY;
      left = Math.max(0, Math.min(window.innerWidth - dragState.width, left));
      top = Math.max(0, Math.min(window.innerHeight - dragState.height, top));
      wrap.style.left = left + 'px';
      wrap.style.top = top + 'px';
    }

    function onDragEnd() {
      dragState = null;
      wrap.classList.remove('dragging');
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      saveRect();
    }

    var resizeState = null;
    var handles = document.querySelectorAll('.bc-resize-handle');
    handles.forEach(function (h) {
      h.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var r = wrap.getBoundingClientRect();
        resizeState = {
          dir: h.dataset.dir, startX: ev.clientX, startY: ev.clientY,
          startWidth: r.width, startHeight: r.height, startLeft: r.left, startTop: r.top
        };
        wrap.classList.add('resizing');
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEnd);
      });
    });

    function onResizeMove(ev) {
      if (!resizeState) return;
      var dx = ev.clientX - resizeState.startX;
      var dy = ev.clientY - resizeState.startY;
      var dir = resizeState.dir;
      var w = resizeState.startWidth;
      var h = resizeState.startHeight;
      var left = resizeState.startLeft;
      var top = resizeState.startTop;
      var MIN_W = 340;
      var MIN_H = 140;

      if (dir.indexOf('e') >= 0) {
        w = Math.max(MIN_W, resizeState.startWidth + dx);
        if (left + w > window.innerWidth) w = window.innerWidth - left;
      }
      if (dir.indexOf('w') >= 0) {
        var nw = Math.max(MIN_W, resizeState.startWidth - dx);
        if (resizeState.startLeft - (nw - resizeState.startWidth) < 0) {
          nw = resizeState.startWidth + resizeState.startLeft;
        }
        left = resizeState.startLeft + (resizeState.startWidth - nw);
        w = nw;
      }
      if (dir.indexOf('s') >= 0) {
        h = Math.max(MIN_H, resizeState.startHeight + dy);
        if (top + h > window.innerHeight) h = window.innerHeight - top;
      }
      if (dir.indexOf('n') >= 0) {
        var nh = Math.max(MIN_H, resizeState.startHeight - dy);
        if (resizeState.startTop - (nh - resizeState.startHeight) < 0) {
          nh = resizeState.startHeight + resizeState.startTop;
        }
        top = resizeState.startTop + (resizeState.startHeight - nh);
        h = nh;
      }
      wrap.style.width = w + 'px';
      wrap.style.height = h + 'px';
      wrap.style.left = left + 'px';
      wrap.style.top = top + 'px';
    }

    function onResizeEnd() {
      resizeState = null;
      wrap.classList.remove('resizing');
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);
      saveRect();
    }

    window.addEventListener('resize', function () {
      var r = wrap.getBoundingClientRect();
      var maxW = window.innerWidth - 20;
      var maxH = window.innerHeight - 20;
      var w = Math.min(r.width, maxW);
      var h = Math.min(r.height, maxH);
      var newLeft = Math.min(Math.max(r.left, 0), window.innerWidth - w);
      var newTop  = Math.min(Math.max(r.top,  0), window.innerHeight - h);
      wrap.style.width  = w + 'px';
      wrap.style.height = h + 'px';
      wrap.style.left   = newLeft + 'px';
      wrap.style.top    = newTop  + 'px';
      saveRect();
    });
  })();

  window.__bcPushChat = pushChat;
  window.__bcSoundPlay = function (n) { try { Sound.play(n); } catch (e) {} };

  // BahiaClient: expuesto para que el launcher pueda desconectarnos
  // limpiamente antes de destruir la webview (botón "Volver").
  window.bcLeaveRoom = function() {
    try { if (currentRoom) currentRoom.leave(); } catch (e) {}
  };

  function getTeamId(p) {
    if (!p || !p.team) return 0;
    if (typeof p.team === 'number') return p.team;
    if (typeof p.team.id === 'number') return p.team.id;
    return 0;
  }

  function isPlayerAdmin(p) {
    return !!(p && (p.isAdmin === true || p.zE === true));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pingClass(ping) {
    if (typeof ping !== 'number') return '';
    if (ping >= 200) return 'bad';
    if (ping >= 100) return 'warn';
    return '';
  }

  function playerRowHTML(p, teamClass) {
    var rawName = p.name || 'Player';
    var name = bcCleanName(rawName);
    var badge = bcBadgeHTML(rawName);
    var ping = p.ping;
    var admin = isPlayerAdmin(p) ? '<span class="admin-mark">*</span>' : '';
    return (
      '<div class="bc-player-row ' + teamClass + '" data-player-id="' + p.id + '">' +
      '<span class="team-dot"></span>' +
      '<span class="name">' + escapeHtml(name) + '</span>' + badge + admin +
      '<span class="ping ' + pingClass(ping) + '">' + (typeof ping === 'number' ? ping : '') + '</span>' +
      '</div>'
    );
  }

  var _lastTeamsHash = '';

  function renderTeams(room) {
    if (!room || !room.players) return;
    var red = [], spec = [], blue = [];
    for (var i = 0; i < room.players.length; i++) {
      var p = room.players[i];
      if (!p) continue;
      var tid = getTeamId(p);
      if (tid === 1) red.push(p);
      else if (tid === 2) blue.push(p);
      else spec.push(p);
    }
    red.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    spec.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    blue.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    var hr = '', hs = '', hb = '';
    for (var j = 0; j < red.length; j++) hr += playerRowHTML(red[j], 'red');
    for (var k = 0; k < spec.length; k++) hs += playerRowHTML(spec[k], 'spec');
    for (var l = 0; l < blue.length; l++) hb += playerRowHTML(blue[l], 'blue');

    var hash = hr + '|' + hs + '|' + hb;
    if (hash === _lastTeamsHash) return;
    _lastTeamsHash = hash;

    if ($listRed) $listRed.innerHTML = hr || '<div class="bc-team-empty">Nadie en rojo</div>';
    if ($listSpec) $listSpec.innerHTML = hs || '<div class="bc-team-empty">Nadie mirando</div>';
    if ($listBlue) $listBlue.innerHTML = hb || '<div class="bc-team-empty">Nadie en azul</div>';

    var headRed = document.querySelector('.bc-team-head.red');
    var headSpec = document.querySelector('.bc-team-head.spec');
    var headBlue = document.querySelector('.bc-team-head.blue');
    if (headRed) headRed.innerHTML = 'Red <span class="bc-team-count">' + red.length + '</span>';
    if (headSpec) headSpec.innerHTML = 'Spectators <span class="bc-team-count">' + spec.length + '</span>';
    if (headBlue) headBlue.innerHTML = 'Blue <span class="bc-team-count">' + blue.length + '</span>';
  }

  function renderInfo(room) {
    if (!room) return;
    var inGame = false;
    try { inGame = !!(room && room.state && room.state.i); } catch (e) {}
    var editable = canAdmin() && !inGame;

    if ($infoTime) {
      if (document.activeElement !== $infoTime) {
        $infoTime.value = room.timeLimit != null ? room.timeLimit : '';
      }
      $infoTime.disabled = !editable;
      $infoTime.title = inGame ? 'Cambiable solo con el partido detenido' : (canAdmin() ? '' : 'Solo admins');
    }
    if ($infoScore) {
      if (document.activeElement !== $infoScore) {
        $infoScore.value = room.scoreLimit != null ? room.scoreLimit : '';
      }
      $infoScore.disabled = !editable;
      $infoScore.title = inGame ? 'Cambiable solo con el partido detenido' : (canAdmin() ? '' : 'Solo admins');
    }
    if ($infoStadium) $infoStadium.textContent = (room.stadium && room.stadium.name) || '-';
    if ($modalTitle) $modalTitle.textContent = room.name || 'Sala';
  }

  function renderModal(room) {
    if (!room) return;
    renderTeams(room);
    renderInfo(room);
  }

  function openModal() {
    if (modalOpen) return;
    modalOpen = true;
    _userClosedModal = false;
    $modal.classList.add('on');
    if (currentRoom) renderModal(currentRoom);
    if (typeof refreshAdminToolbar === 'function') refreshAdminToolbar();
  }

  function closeModal(force) {
    if (!modalOpen) return;
    var state = computeClientState();
    if (!force) {
      if (state === 'closed') return;
      _userClosedModal = true;
    }
    modalOpen = false;
    $modal.classList.remove('on');
    if (typeof hideCtxMenu === 'function') hideCtxMenu();
  }

  function toggleModal() { if (modalOpen) closeModal(); else openModal(); }

  // ============================================================
  // MAQUINA DE ESTADOS
  // ============================================================

  var _lastClientState = null;
  var _lastPlayersHash = '';

  function computeClientState() {
    var isLive = false;
    try { isLive = !!(currentRoom && currentRoom.state && currentRoom.state.i); } catch (e) { isLive = false; }
    if (!isLive) return 'closed';
    var isPlayer = false;
    try {
      var me = currentRoom.getPlayer ? currentRoom.getPlayer(currentRoom.currentPlayerId) : null;
      if (me && me.disc) isPlayer = true;
      else if (me && getTeamId(me) !== 0) isPlayer = true;
    } catch (e) {}
    return isPlayer ? 'live_player' : 'live_spec';
  }

  function applyClientState() {
    var state = computeClientState();
    var playersHash = '';
    try {
      if (currentRoom && currentRoom.players) {
        var pl = currentRoom.players;
        for (var pi = 0; pi < pl.length; pi++) playersHash += pl[pi].id + ':' + getTeamId(pl[pi]) + ',';
      }
    } catch (e) {}
    var prev = _lastClientState;
    var changed = state !== prev || playersHash !== _lastPlayersHash;
    _lastClientState = state;
    _lastPlayersHash = playersHash;
    window.__bcClientState = state;
    window.__bcMatchRunning = state !== 'closed';
    window.__bcInGame = state === 'live_player';

    if (!changed) { refreshAdminToolbar(); return; }

    var bg = _dom('bc-nogame-bg');
    var sb = _dom('bc-scoreboard');
    var gc = _dom('game-container');

    if (state === 'closed') {
      if (bg && !bg.classList.contains('on')) bg.classList.add('on');
      if (sb && !sb.classList.contains('nogame')) sb.classList.add('nogame');
      if (gc) gc.style.display = 'none';
    } else {
      if (bg && bg.classList.contains('on')) bg.classList.remove('on');
      if (sb && sb.classList.contains('nogame')) sb.classList.remove('nogame');
      if (gc) gc.style.display = '';
    }

    if (state === 'closed' || state === 'live_spec') {
      if (!modalOpen && !_userClosedModal) openModal();
    }
    if (state === 'closed' && prev && prev !== 'closed') {
      _userClosedModal = false;
      if (!modalOpen) openModal();
    }
    if (changed) {
      console.log('[state]', prev, '->', state);
      if (modalOpen && currentRoom) renderInfo(currentRoom);
    }
    refreshAdminToolbar();
  }

  function amIHost() {
    if (!currentRoom) return false;
    try { return currentRoom.isHost === true; } catch (e) { return false; }
  }

  function amIAdmin() {
    if (!currentRoom) return false;
    try {
      var me = currentRoom.getPlayer ? currentRoom.getPlayer(currentRoom.currentPlayerId) : null;
      if (!me) return false;
      return (me.isAdmin === true || me.zE === true);
    } catch (e) { return false; }
  }

  function canAdmin() { return amIHost() || amIAdmin(); }

  function refreshAdminToolbar() {
    var els = _getTbEls();
    var tb = els.tb;
    if (!tb) return;
    var admin = canAdmin();
    var want = admin ? 'flex' : 'none';
    if (tb.style.display !== want) tb.style.display = want;

    var inGame = false;
    try { inGame = !!(currentRoom && currentRoom.state && currentRoom.state.i); } catch (e) {}

    if (els.startBtn) els.startBtn.style.display = (admin && !inGame) ? '' : 'none';
    if (els.stopBtn)  els.stopBtn.style.display  = (admin && inGame)  ? '' : 'none';
    if (els.pBtn)     els.pBtn.style.display     = (admin && inGame)  ? '' : 'none';
    if (els.pickBtn)  els.pickBtn.style.display  = admin ? '' : 'none';
    if (els.autoBtn)  els.autoBtn.style.display  = admin ? '' : 'none';
    if (els.lockBtn)  els.lockBtn.style.display  = admin ? '' : 'none';
    if (els.resetBtn) els.resetBtn.style.display = admin ? '' : 'none';

    if (els.lockBtn && currentRoom && currentRoom.state) {
      var locked = false;
      try { locked = currentRoom.state.vW === true; } catch (e) {}
      els.lockBtn.textContent = locked ? 'Unlock teams' : 'Lock teams';
    }
    if (els.pBtn && inGame && currentRoom && typeof currentRoom.isGamePaused === 'function') {
      try { els.pBtn.textContent = currentRoom.isGamePaused() ? 'Resume' : 'Pause'; }
      catch (e) { els.pBtn.textContent = 'Pause'; }
    } else if (els.pBtn) els.pBtn.textContent = 'Pause';
  }

    function updateScoreboard(room) {
    if (!room) return;
    const gs = room.state && room.state.gameState;
    if (!gs) return;

    const redScore = (typeof gs.redScore === 'number') ? gs.redScore
                   : (typeof gs.scoreRed === 'number') ? gs.scoreRed : 0;
    const blueScore = (typeof gs.blueScore === 'number') ? gs.blueScore
                    : (typeof gs.scoreBlue === 'number') ? gs.scoreBlue : 0;

    const rEl = document.getElementById('bc-score-red');
    const bEl = document.getElementById('bc-score-blue');
    const tEl = document.getElementById('bc-time');

    if (rEl && rEl.textContent !== String(redScore)) rEl.textContent = String(redScore);
    if (bEl && bEl.textContent !== String(blueScore)) bEl.textContent = String(blueScore);

    // HaxBall: el cronómetro CUENTA HACIA ARRIBA desde 00:00 hasta timeLimit.
    // FIX: el campo real de la clase GameState de node-haxball es
    // `timeElapsed`, NO `time` (ese campo no existe -> siempre undefined
    // -> el reloj quedaba pegado en 00:00). Además ya viene en SEGUNDOS
    // como float (se incrementa 1/60 por tick), no en milisegundos.
    // Confirmado contra el mapeo de propiedades de la clase en api.js:
    // ["ext","pauseGameTickCounter","timeElapsed","blueScore","redScore", ...]
    const totalSecs = Math.floor((typeof gs.timeElapsed === 'number') ? gs.timeElapsed : 0);

    const mm = String(Math.floor(totalSecs / 60)).padStart(2, '0');
    const ss = String(totalSecs % 60).padStart(2, '0');
    const txt = mm + ':' + ss;

    if (tEl && tEl.textContent !== txt) {
      tEl.textContent = txt;
      const timeLimitMin = (typeof room.timeLimit === 'number') ? room.timeLimit : 0;
      const remainingSecs = timeLimitMin > 0 ? (timeLimitMin * 60 - totalSecs) : Infinity;
      if (remainingSecs <= 30 && remainingSecs > 0) tEl.classList.add('urgent');
      else tEl.classList.remove('urgent');
    }

    const sb = document.getElementById('bc-scoreboard');
    if (sb) {
      sb.classList.toggle('red-leading',  redScore > blueScore);
      sb.classList.toggle('blue-leading', blueScore > redScore);
    }
  }

  function bindAdmin() {
    if (adminBound) return;
    adminBound = true;
    function $id(x) { return document.getElementById(x); }
    var sBtn = $id('bc-btn-start');
    var xBtn = $id('bc-btn-stop');
    var pBtn = $id('bc-btn-pause');
    var pick = $id('bc-btn-pickstadium');
    var auto = $id('bc-btn-autoteams');
    var lock = $id('bc-btn-lockteams');
    var reset = $id('bc-btn-reset');

    if (sBtn) {
      sBtn.addEventListener('click', function () {
        if (!currentRoom) return;
        try {
          if (typeof currentRoom.startGame !== 'function') return;
          currentRoom.startGame();
          setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 50);
          setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 300);
          setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 800);
        } catch (e) { console.error('[admin] startGame:', e); }
      });
    }
    if (xBtn) {
      xBtn.addEventListener('click', function () {
        if (!currentRoom) return;
        try {
          if (typeof currentRoom.stopGame !== 'function') return;
          currentRoom.stopGame();
          setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 50);
          setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 300);
          setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 800);
        } catch (e) { console.error('[admin] stopGame:', e); }
      });
    }
    if (pBtn) {
      pBtn.addEventListener('click', function () {
        if (!currentRoom) return;
        try {
          if (typeof currentRoom.pauseGame !== 'function') return;
          var paused = false;
          if (typeof currentRoom.isGamePaused === 'function') paused = currentRoom.isGamePaused();
          currentRoom.pauseGame(!paused);
          setTimeout(function () { refreshAdminToolbar(); }, 100);
        } catch (e) { console.error('[admin] pauseGame:', e); }
      });
    }
    if (pick) {
      pick.addEventListener('click', function () {
        if (!currentRoom || !E || !E.Utils) return;
        try {
          bcStadiumPicker().then(function (pick) {
            if (!pick) return;
            var st = null;
            var label = '?';
            try {
              st = parseStadiumFromFile(pick.text);
              label = (st && st.name) || pick.name || '.hbs';
            } catch (err) {
              console.error('[admin] parseStadium', err);
              pushChat(null, 'Error al parsear .hbs: ' + err.message, null, 'warn');
              return;
            }
            if (!st) return;
            try {
              if (typeof currentRoom.setCurrentStadium === 'function') currentRoom.setCurrentStadium(st);
              else if (typeof currentRoom.setStadium === 'function') currentRoom.setStadium(st);
              pushChat(null, 'Mapa cambiado: ' + label, null, 'system');
            } catch (e) {
              console.error('[admin] stadium:', e);
              pushChat(null, 'Error al cambiar mapa: ' + e.message, null, 'warn');
            }
            var refreshAfterMap = function () {
              refreshAdminToolbar();
              if (currentRoom) { _lastTeamsHash = ''; renderModal(currentRoom); }
            };
            setTimeout(refreshAfterMap, 150);
            setTimeout(refreshAfterMap, 600);
            setTimeout(refreshAfterMap, 1500);
          });
        } catch (e) { console.error('[admin] stadium:', e); }
      });
    }
    if (auto) {
      auto.addEventListener('click', function () {
        if (!currentRoom) return;
        try {
          if (typeof currentRoom.autoTeams !== 'function') return;
          currentRoom.autoTeams();
          var refreshAll = function () {
            refreshAdminToolbar();
            applyClientState();
            if (currentRoom) { _lastTeamsHash = ''; renderModal(currentRoom); }
          };
          setTimeout(refreshAll, 100);
          setTimeout(refreshAll, 300);
          setTimeout(refreshAll, 700);
          setTimeout(refreshAll, 1200);
        } catch (e) { console.error('[admin] autoTeams:', e); }
      });
    }
    if (lock) {
      lock.addEventListener('click', function () {
        if (!currentRoom) return;
        try {
          if (typeof currentRoom.lockTeams !== 'function') return;
          var locked = false;
          if (currentRoom.state) locked = currentRoom.state.vW === true;
          currentRoom.lockTeams(!locked);
          setTimeout(refreshAdminToolbar, 100);
        } catch (e) { console.error('[admin] lockTeams:', e); }
      });
    }
    if (reset) {
      reset.addEventListener('click', function () {
        if (!currentRoom) return;
        try {
          if (typeof currentRoom.stopGame === 'function') currentRoom.stopGame();
          var players = currentRoom.players || [];
          for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (!p || typeof p.id !== 'number') continue;
            try { currentRoom.setPlayerTeam(p.id, 0); }
            catch (e) { console.error('[admin] reset setPlayerTeam', p.id, e); }
          }
          pushChat(null, 'Reset: todos a spectator', null, 'system');
          setTimeout(function () {
            refreshAdminToolbar(); applyClientState();
            if (currentRoom) renderModal(currentRoom);
          }, 100);
          setTimeout(function () {
            refreshAdminToolbar(); applyClientState();
            if (currentRoom) renderModal(currentRoom);
          }, 400);
        } catch (e) { console.error('[admin] reset:', e); }
      });
    }
    console.log('[admin] bindAdmin OK');
  }

  var _infoInputsBound = false;

  function bindInfoInputs() {
    if (_infoInputsBound) return;
    _infoInputsBound = true;

    function commitTime() {
      if (!currentRoom || !canAdmin()) return;
      if (currentRoom.state && currentRoom.state.i) {
        pushChat(null, 'Time limit: cambialo con el partido detenido', null, 'warn');
        if (currentRoom) renderInfo(currentRoom);
        return;
      }
      var v = parseInt($infoTime.value, 10);
      if (isNaN(v) || v < 0) { renderInfo(currentRoom); return; }
      if (v === currentRoom.timeLimit) return;
      try {
        if (typeof currentRoom.setTimeLimit === 'function') {
          currentRoom.setTimeLimit(v);
          pushChat(null, 'Time limit: ' + v, null, 'system');
        }
      } catch (e) { console.error('[admin] setTimeLimit', e); }
      setTimeout(function(){ if (currentRoom) renderInfo(currentRoom); }, 200);
    }

    function commitScore() {
      if (!currentRoom || !canAdmin()) return;
      if (currentRoom.state && currentRoom.state.i) {
        pushChat(null, 'Score limit: cambialo con el partido detenido', null, 'warn');
        if (currentRoom) renderInfo(currentRoom);
        return;
      }
      var v = parseInt($infoScore.value, 10);
      if (isNaN(v) || v < 0) { renderInfo(currentRoom); return; }
      if (v === currentRoom.scoreLimit) return;
      try {
        if (typeof currentRoom.setScoreLimit === 'function') {
          currentRoom.setScoreLimit(v);
          pushChat(null, 'Score limit: ' + v, null, 'system');
        }
      } catch (e) { console.error('[admin] setScoreLimit', e); }
      setTimeout(function(){ if (currentRoom) renderInfo(currentRoom); }, 200);
    }

    if ($infoTime) {
      $infoTime.addEventListener('change', commitTime);
      $infoTime.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); this.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); if (currentRoom) renderInfo(currentRoom); this.blur(); }
      });
    }
    if ($infoScore) {
      $infoScore.addEventListener('change', commitScore);
      $infoScore.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); this.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); if (currentRoom) renderInfo(currentRoom); this.blur(); }
      });
    }
    console.log('[info] bindInfoInputs OK');
  }

  var _ctxTargetId = null;
  var _ctxMenuEl = null;

  function hideCtxMenu() {
    if (_ctxMenuEl) _ctxMenuEl.classList.remove('on');
    _ctxTargetId = null;
  }

  function showCtxMenu(x, y, playerId, playerName) {
    if (!_ctxMenuEl) return;
    _ctxTargetId = playerId;
    var nameEl = document.getElementById('bc-ctx-name');
    if (nameEl) nameEl.textContent = playerName;
    _ctxMenuEl.style.left = x + 'px';
    _ctxMenuEl.style.top = y + 'px';
    _ctxMenuEl.classList.add('on');
    try {
      var targetPlayer = currentRoom && currentRoom.getPlayer ? currentRoom.getPlayer(playerId) : null;
      var targetIsAdmin = targetPlayer && (targetPlayer.isAdmin === true || targetPlayer.zE === true);
      var adminItem = _ctxMenuEl.querySelector('.bc-ctx-item[data-action="admin"]');
      if (adminItem) adminItem.textContent = targetIsAdmin ? 'Quitar admin' : 'Dar admin';
    } catch (e) {}
    var rect = _ctxMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) _ctxMenuEl.style.left = window.innerWidth - rect.width - 8 + 'px';
    if (rect.bottom > window.innerHeight) _ctxMenuEl.style.top = window.innerHeight - rect.height - 8 + 'px';
  }

  function doKickPlayer(id, isBan, isBanIP) {
    if (!currentRoom) return;
    var p = currentRoom.getPlayer ? currentRoom.getPlayer(id) : null;
    var targetName = p && p.name ? bcCleanName(p.name) : '#' + id;
    var verb = isBanIP ? 'Ban IP' : isBan ? 'Ban' : 'Kick';
    bcPrompt(verb + ' a ' + targetName, 'Razon (opcional). Dejalo vacio para aplicar sin razon.', {
      placeholder: 'Ej: spam, insultos, cheating...',
      okLabel: verb, danger: isBan || isBanIP, maxLength: 200
    }).then(function (reason) {
      if (reason === null) return;
      reason = String(reason).trim();
      try {
        currentRoom.kickPlayer(id, reason, !!isBan);
        pushChat(null, verb + ' a ' + targetName + (reason ? ' (' + reason + ')' : ''), null, 'warn');
      } catch (e) { console.error('[ctx] kickPlayer', e); }
    });
  }

  var _bcDialogBackdrop = null;

  function _bcEnsureDialog() {
    if (_bcDialogBackdrop) return _bcDialogBackdrop;
    _bcDialogBackdrop = document.createElement('div');
    _bcDialogBackdrop.id = 'bc-dialog-backdrop';
    _bcDialogBackdrop.style.display = 'none';
    document.body.appendChild(_bcDialogBackdrop);
    return _bcDialogBackdrop;
  }

  function _bcBuildDialog(opts, isInput) {
    var bd = _bcEnsureDialog();
    bd.innerHTML = '';
    bd.style.display = 'flex';
    var dlg = document.createElement('div');
    dlg.id = 'bc-dialog';
    var h = document.createElement('div');
    h.className = 'bc-dialog-title';
    h.textContent = opts.title || '';
    dlg.appendChild(h);
    if (opts.message) {
      var m = document.createElement('div');
      m.className = 'bc-dialog-msg';
      m.textContent = opts.message;
      dlg.appendChild(m);
    }
    var input = null;
    if (isInput) {
      input = document.createElement('input');
      input.type = opts.password ? 'password' : 'text';
      input.placeholder = opts.placeholder || '';
      input.value = opts.defaultValue || '';
      if (opts.maxLength) input.maxLength = opts.maxLength;
      dlg.appendChild(input);
    }
    var actions = document.createElement('div');
    actions.className = 'bc-dialog-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
    actions.appendChild(cancelBtn);
    var okBtn = document.createElement('button');
    okBtn.className = opts.danger ? 'bc-dialog-danger' : 'bc-dialog-ok';
    okBtn.textContent = opts.okLabel || 'Aceptar';
    actions.appendChild(okBtn);
    dlg.appendChild(actions);
    bd.appendChild(dlg);
    return { bd: bd, input: input, ok: okBtn, cancel: cancelBtn, dlg: dlg };
  }

  function bcStadiumPicker() {
    return new Promise(function (resolve) {
      var bd = _bcEnsureDialog();
      bd.innerHTML = '';
      bd.style.display = 'flex';
      var dlg = document.createElement('div');
      dlg.id = 'bc-dialog';
      dlg.className = 'bc-dialog-wide';
      var h = document.createElement('div');
      h.className = 'bc-dialog-title';
      h.textContent = 'Cargar mapa';
      dlg.appendChild(h);
      var sub = document.createElement('div');
      sub.className = 'bc-dialog-msg';
      sub.textContent = 'Elegí un archivo .hbs de tu PC.';
      dlg.appendChild(sub);
      var loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'bc-dialog-ok bc-stadium-load';
      loadBtn.textContent = '📁  Seleccionar archivo .hbs';
      loadBtn.addEventListener('click', function () {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.hbs,.json,application/json,text/plain';
        inp.style.display = 'none';
        inp.addEventListener('change', function () {
          var f = inp.files && inp.files[0];
          if (!f) return;
          // FIX #6: límite de tamaño — evita freezear el tab con archivos enormes
          var MAX_HBS_BYTES = 5 * 1024 * 1024;
          if (f.size > MAX_HBS_BYTES) {
            pushChat(null, 'El archivo supera los 5 MB. Elegí un .hbs más chico.', null, 'warn');
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            cleanup();
            resolve({ type: 'file', text: String(reader.result || ''), name: f.name });
          };
          reader.onerror = function () { pushChat(null, 'No se pudo leer el archivo', null, 'warn'); };
          reader.readAsText(f);
        });
        document.body.appendChild(inp);
        inp.click();
        setTimeout(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); }, 60000);
      });
      dlg.appendChild(loadBtn);
      var actions = document.createElement('div');
      actions.className = 'bc-dialog-actions';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancelar';
      cancelBtn.addEventListener('click', function () { cleanup(); resolve(null); });
      actions.appendChild(cancelBtn);
      dlg.appendChild(actions);
      bd.appendChild(dlg);
      function cleanup() {
        bd.style.display = 'none';
        bd.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); cleanup(); resolve(null); }
      }
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { loadBtn.focus(); }, 30);
    });
  }

  function parseStadiumFromFile(text) {
    if (!text || typeof text !== 'string') throw new Error('Archivo vacio');
    try {
      if (E && E.Utils) {
        if (typeof E.Utils.parseStadium === 'function') return E.Utils.parseStadium(text);
        if (typeof E.Utils.parseStadiumFile === 'function') return E.Utils.parseStadiumFile(text);
        if (typeof E.Utils.parseStadiumString === 'function') return E.Utils.parseStadiumString(text);
      }
    } catch (e) { console.warn('[stadium] parser de API fallo, probando JSON5', e); }
    if (typeof JSON5 !== 'undefined' && JSON5.parse) return JSON5.parse(text);
    return JSON.parse(text);
  }

  function bcPrompt(title, message, opts) {
    opts = opts || {};
    opts.title = title;
    opts.message = message;
    return new Promise(function (resolve) {
      var r = _bcBuildDialog(opts, true);
      function close(val) {
        r.bd.style.display = 'none';
        r.bd.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); close(null); }
        else if (ev.key === 'Enter') { ev.stopPropagation(); close(r.input.value); }
      }
      r.ok.addEventListener('click', function () { close(r.input.value); });
      r.cancel.addEventListener('click', function () { close(null); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { r.input.focus(); r.input.select(); }, 30);
    });
  }

  function bcConfirm(title, message, opts) {
    opts = opts || {};
    opts.title = title;
    opts.message = message;
    return new Promise(function (resolve) {
      var r = _bcBuildDialog(opts, false);
      function close(val) {
        r.bd.style.display = 'none';
        r.bd.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); close(false); }
        else if (ev.key === 'Enter') { ev.stopPropagation(); close(true); }
      }
      r.ok.addEventListener('click', function () { close(true); });
      r.cancel.addEventListener('click', function () { close(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { r.ok.focus(); }, 30);
    });
  }

  var _ctxBound = false;

  function bindCtxMenu() {
    if (_ctxBound) return;
    _ctxMenuEl = _dom('bc-ctx-menu');
    if (!_ctxMenuEl) return;
    _ctxBound = true;
    var items = _ctxMenuEl.querySelectorAll('.bc-ctx-item');
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        item.addEventListener('click', function () {
          var action = item.dataset.action;
          var id = _ctxTargetId;
          if (typeof id !== 'number' || isNaN(id) || !currentRoom) { hideCtxMenu(); return; }
          try {
            if (action === 'red') currentRoom.setPlayerTeam(id, 1);
            else if (action === 'blue') currentRoom.setPlayerTeam(id, 2);
            else if (action === 'spec') currentRoom.setPlayerTeam(id, 0);
            else if (action === 'admin') {
              var p = currentRoom.getPlayer(id);
              var isAdm = p && (p.isAdmin === true || p.zE === true);
              currentRoom.setPlayerAdmin(id, !isAdm);
            }
            else if (action === 'kick') doKickPlayer(id, false);
            else if (action === 'ban') doKickPlayer(id, true);
            else if (action === 'banip') doKickPlayer(id, true, true);
          } catch (e) { console.error('[ctx]', e); }
          hideCtxMenu();
        });
      })(items[i]);
    }
    document.addEventListener('click', function (ev) {
      if (_ctxMenuEl && !_ctxMenuEl.contains(ev.target)) hideCtxMenu();
    });
  }

  document.addEventListener('contextmenu', function (ev) {
    if (!canAdmin()) return;
    var row = ev.target.closest('.bc-player-row');
    if (!row) { hideCtxMenu(); return; }
    ev.preventDefault();
    var pid = parseInt(row.dataset.playerId, 10);
    if (typeof pid !== 'number' || isNaN(pid) || !currentRoom) return;
    if (pid === currentRoom.currentPlayerId) return;
    var p = currentRoom.getPlayer ? currentRoom.getPlayer(pid) : null;
    var name = p && p.name ? bcCleanName(p.name) : '#' + pid;
    showCtxMenu(ev.clientX, ev.clientY, pid, name);
  });

  // FIX #1: null-safe listeners a nivel módulo.
  _safeOn($btnMenu, 'click', toggleModal);

  _safeOn($modalBk, 'click', function (ev) {
    var chatWrap = document.getElementById('bc-chat-wrap');
    if (chatWrap && chatWrap.contains(ev.target)) return;
    var state = computeClientState();
    if (state === 'closed' || state === 'live_spec') {
      pushChat(null, state === 'closed' ? 'Esperando a que arranque el partido...' : 'Estas mirando el partido.', null, 'system');
      return;
    }
    closeModal();
  });

  var $modalClose = document.getElementById('bc-modal-close');
  _safeOn($modalClose, 'click', function (ev) {
    ev.stopPropagation();
    var state = computeClientState();
    if (state === 'closed' || state === 'live_spec') {
      pushChat(null, state === 'closed' ? 'Esperando a que arranque el partido...' : 'Estas mirando el partido.', null, 'system');
      return;
    }
    closeModal();
  });

  _safeOn($btnSound, 'click', function () {
    var on = Sound.toggle();
    if ($btnSound) $btnSound.classList.toggle('on', on);
  });

  var SETTINGS_KEY = 'bc_game_settings_v1';
  // FIX #2: zoom en % (100 = 1.0x). Antes era 100, que pisaba el 2.6
  // inicial del renderer en applySettings(). Ahora 260 = 2.6x.
  var defaultSettings = { volume: 35, zoom: 260, quality: 100, showFps: false, showPing: false, chatOpacity: 45, chatFontSize: 14 };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, defaultSettings);
      return Object.assign({}, defaultSettings, JSON.parse(raw));
    } catch (e) { return Object.assign({}, defaultSettings); }
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var gameSettings = loadSettings();
  document.documentElement.style.setProperty('--bc-chat-opacity', (gameSettings.chatOpacity / 100).toFixed(2));
  document.documentElement.style.setProperty('--bc-chat-fontsize', gameSettings.chatFontSize + 'px');

  var $settingsPanel = document.getElementById('bc-settings-panel');
  var $btnSettings = document.getElementById('bc-btn-settings');
  var $setVolume = document.getElementById('bc-set-volume');
  var $setVolumeVal = document.getElementById('bc-set-volume-val');
  var $setZoom = document.getElementById('bc-set-zoom');
  var $setZoomVal = document.getElementById('bc-set-zoom-val');
  var $setQuality = document.getElementById('bc-set-quality');
  var $setQualityVal = document.getElementById('bc-set-quality-val');
  var $setShowFps = document.getElementById('bc-set-showfps');
  var $setChatOpacity = document.getElementById('bc-set-chat-opacity');
  var $setChatOpacityVal = document.getElementById('bc-set-chat-opacity-val');
  var $setChatFontSize = document.getElementById('bc-set-chat-fontsize');
  var $setChatFontSizeVal = document.getElementById('bc-set-chat-fontsize-val');
  var $setResetChat = document.getElementById('bc-set-reset-chat');
  var $setResetAll = document.getElementById('bc-set-reset-all');

  // ============================================================
  // FPS/PING OVERLAY
  // ============================================================

  var _perfLoopRaf = null;
  var _perfFrames = 0;
  var _perfLast = performance.now();
  var _perfFps = 0;
  var _perfPing = 0;
  var _perfHooked = false;
  var _perfHookTimer = null;
  var _hookPingTries = 0;

  function setupPerfOverlay(){
    var el = document.getElementById('bc-perf-overlay');
    if(!el) return;

    function loop(){
      _perfFrames++;
      var now = performance.now();
      if(now - _perfLast >= 500){
        _perfFps = Math.round(_perfFrames * 1000 / (now - _perfLast));
        _perfFrames = 0;
        _perfLast = now;
        updatePerfDisplay();
      }
      _perfLoopRaf = requestAnimationFrame(loop);
    }

    function hookPing(){
      if(_perfHooked) return;
      var room = window.__bcRoom;
      if(!room){ _perfHookTimer = setTimeout(hookPing, 300); return; }
      var orig = room.onPingChange;
      if(typeof orig === 'function'){
        // FIX #4: si ya estaba wrapped (por nosotros o por el renderer), no reintentar
        if(orig.__bcPerfHooked){
          _perfHooked = true;
          return;
        }
        var wrapped = function(raw, median, max){
          _perfPing = Math.round(median || raw || 0);
          updatePerfDisplay();
          return orig(raw, median, max);
        };
        wrapped.__bcPerfHooked = true;
        room.onPingChange = wrapped;
        _perfHooked = true;
      } else {
        // FIX #4: retry acotado (20 × 300ms = 6s) en vez de infinito
        if(_hookPingTries < 20){
          _hookPingTries++;
          _perfHookTimer = setTimeout(hookPing, 300);
        } else {
          _perfHooked = true;
        }
      }
    }

    _perfLoopRaf = requestAnimationFrame(loop);
    hookPing();
    updatePerfDisplay();
  }

  function updatePerfDisplay(){
    var el = document.getElementById('bc-perf-overlay');
    if(!el) return;

    var show = false;
    try { show = localStorage.getItem('bc_perf_overlay') === '1'; } catch(e){}
    el.style.display = show ? 'flex' : 'none';
    if(!show) return;

    var fpsEl = document.getElementById('bc-perf-fps');
    var pingEl = document.getElementById('bc-perf-ping');
    var fpsW = document.getElementById('bc-perf-fps-wrap');
    var pingW = document.getElementById('bc-perf-ping-wrap');

    if(fpsEl) fpsEl.textContent = _perfFps || '–';
    if(pingEl) pingEl.textContent = _perfPing || '–';

    if(fpsW){
      fpsW.classList.remove('pf-good', 'pf-warn', 'pf-bad');
      if(_perfFps >= 120) fpsW.classList.add('pf-good');
      else if(_perfFps >= 60) fpsW.classList.add('pf-warn');
      else if(_perfFps > 0) fpsW.classList.add('pf-bad');
    }
    if(pingW){
      pingW.classList.remove('pf-good', 'pf-warn', 'pf-bad');
      if(_perfPing > 0){
        if(_perfPing <= 60) pingW.classList.add('pf-good');
        else if(_perfPing <= 120) pingW.classList.add('pf-warn');
        else pingW.classList.add('pf-bad');
      }
    }
  }

  // ============================================================
  // SETTINGS — tabs y hooks
  // ============================================================

  function applySettings() {
    if (window.__bcSetVolume) window.__bcSetVolume(gameSettings.volume / 100);

    if (window.__bcRenderer && window.__bcRenderer.setZoom) {
      var c = document.getElementById('game-canvas');
      if (c) {
        window.__bcRenderer.zoomCoeff = gameSettings.zoom / 100;
        window.__bcRenderer.setZoom(c.width / 2, c.height / 2, gameSettings.zoom / 100);
      }
    }
    if (window.__bcRenderer) {
      if (!window.__bcRenderer.targetFPS) window.__bcRenderer.targetFPS = 0; // FULL FPS: sin límite artificial
      window.__bcRenderer.resolutionScale = gameSettings.quality / 100;
      window.__bcRenderer.showFPS = false;
      window.__bcRenderer.showNetGraph = false;
    }
    document.documentElement.style.setProperty('--bc-chat-opacity', (gameSettings.chatOpacity / 100).toFixed(2));
    document.documentElement.style.setProperty('--bc-chat-fontsize', gameSettings.chatFontSize + 'px');
    updatePerfDisplay();
  }

  function syncUI() {
    if ($setVolume) { $setVolume.value = gameSettings.volume; $setVolumeVal.textContent = gameSettings.volume + '%'; }
    if ($setZoom) { $setZoom.value = gameSettings.zoom; $setZoomVal.textContent = (gameSettings.zoom / 100).toFixed(2) + 'x'; }
    if ($setQuality) { $setQuality.value = gameSettings.quality; $setQualityVal.textContent = gameSettings.quality + '%'; }
    if ($setChatOpacity) { $setChatOpacity.value = gameSettings.chatOpacity; $setChatOpacityVal.textContent = gameSettings.chatOpacity + '%'; }
    if ($setChatFontSize) { $setChatFontSize.value = gameSettings.chatFontSize; $setChatFontSizeVal.textContent = gameSettings.chatFontSize + 'px'; }
    if ($setShowFps) {
      var perfOn = false;
      try { perfOn = localStorage.getItem('bc_perf_overlay') === '1'; } catch(e){}
      $setShowFps.checked = perfOn;
    }
  }

  function openSettings() {
    syncUI();
    $settingsPanel.classList.add('on');
    $btnSettings.classList.add('on');
  }

  function closeSettings() {
    $settingsPanel.classList.remove('on');
    $btnSettings.classList.remove('on');
  }

  function toggleSettings() {
    if ($settingsPanel.classList.contains('on')) closeSettings();
    else openSettings();
  }

  window.bcSetTab = function(tab){
    document.querySelectorAll('.bc-set-tab').forEach(function(t){
      t.classList.toggle('on', t.dataset.setTab === tab);
    });
    var g = document.getElementById('bc-set-pane-game');
    var c = document.getElementById('bc-set-pane-custom');
    if (g) g.style.display = tab === 'game' ? '' : 'none';
    if (c) c.style.display = tab === 'custom' ? '' : 'none';
  };

  document.addEventListener('click', function(e){
    var card = e.target.closest('.bc-custom-card');
    if (!card) return;
    var cat = card.dataset.cat;
    closeSettings();
    setTimeout(function(){
      if (window.BCReskinUI && window.BCReskinUI.open) window.BCReskinUI.open(cat);
    }, 150);
  });

  _safeOn($btnSettings, 'click', function (ev) {
    ev.stopPropagation();
    toggleSettings();
  });

  document.addEventListener('click', function (ev) {
    if (!$settingsPanel || !$settingsPanel.classList.contains('on')) return;
    if ($settingsPanel.contains(ev.target)) return;
    if ($btnSettings && $btnSettings.contains(ev.target)) return;
    closeSettings();
  });

  syncUI();
  // applySettings() se llama desde onOpen() cuando el renderer existe.
  // No programamos un timeout ciego — si el join tarda más que el
  // timeout, la config nunca se aplicaba.

  if ($setVolume) {
    $setVolume.addEventListener('input', function () {
      gameSettings.volume = parseInt(this.value, 10);
      $setVolumeVal.textContent = gameSettings.volume + '%';
      saveSettings(gameSettings);
      applySettings();
    });
  }
  if ($setZoom) {
    $setZoom.addEventListener('input', function () {
      gameSettings.zoom = parseInt(this.value, 10);
      $setZoomVal.textContent = (gameSettings.zoom / 100).toFixed(2) + 'x';
      saveSettings(gameSettings);
      applySettings();
    });
  }
  if ($setChatOpacity) {
    $setChatOpacity.addEventListener('input', function () {
      gameSettings.chatOpacity = parseInt(this.value, 10);
      $setChatOpacityVal.textContent = gameSettings.chatOpacity + '%';
      saveSettings(gameSettings);
      applySettings();
    });
  }
  if ($setChatFontSize) {
    $setChatFontSize.addEventListener('input', function () {
      gameSettings.chatFontSize = parseInt(this.value, 10);
      $setChatFontSizeVal.textContent = gameSettings.chatFontSize + 'px';
      saveSettings(gameSettings);
      applySettings();
    });
  }
  if ($setQuality) {
    $setQuality.addEventListener('input', function () {
      gameSettings.quality = parseInt(this.value, 10);
      $setQualityVal.textContent = gameSettings.quality + '%';
      saveSettings(gameSettings);
      applySettings();
    });
  }
  if ($setShowFps) {
    $setShowFps.addEventListener('change', function () {
      gameSettings.showFps = this.checked;
      try { localStorage.setItem('bc_perf_overlay', this.checked ? '1' : '0'); } catch(e){}
      saveSettings(gameSettings);
      updatePerfDisplay();
    });
  }
  if ($setResetChat) {
    $setResetChat.addEventListener('click', function () {
      try { localStorage.removeItem('bc_chat_rect_v1'); } catch (e) {}
      var wrap = document.getElementById('bc-chat-wrap');
      if (wrap) {
        wrap.style.left = '';
        wrap.style.top = '';
        wrap.style.width = '';
        wrap.style.height = '';
        wrap.style.bottom = '16px';
        wrap.style.transform = 'translateX(-50%)';
      }
      closeSettings();
      pushChat(null, 'Posicion del chat restaurada', null, 'system');
    });
  }
  if ($setResetAll) {
    $setResetAll.addEventListener('click', function () {
      bcConfirm('Resetear ajustes', 'Se van a borrar todos los ajustes y la posicion del chat. La pagina se va a recargar.', { okLabel: 'Resetear', danger: true })
        .then(function (ok) {
          if (!ok) return;
          try {
            localStorage.removeItem(SETTINGS_KEY);
            localStorage.removeItem('bc_chat_rect_v1');
          } catch (e) {}
          location.reload();
        });
    });
  }

  window.__bcSetVolume = function (v) {
    if (Sound && typeof Sound.setVolume === 'function') Sound.setVolume(v);
  };

  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }
    if (ev.key === 'Escape') {
      var state = computeClientState();
      if (modalOpen && state === 'live_player') closeModal();
      return;
    }
    if (ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); toggleModal(); }
  });

  _safeOn($modalLink, 'click', function () {
    if (!roomId) return;
    var url = 'https://www.haxball.com/play?c=' + roomId;
    try { navigator.clipboard.writeText(url); } catch (e) {}
    pushChat(null, 'Link copiado: ' + url, null, 'news');
  });

  _safeOn($modalLeave, 'click', function () {
    if (!currentRoom) return;
    bcConfirm('Salir de la sala', 'Vas a desconectarte de la sala actual.', { okLabel: 'Salir', danger: true })
      .then(function (ok) {
        if (!ok) return;
        try { currentRoom.leave(); } catch (e) {}
        closeModal(true);
      });
  });

  _safeOn($modalRec, 'click', function () {
    if (!currentRoom) return;
    try {
      if (currentRoom.isRecording && currentRoom.isRecording()) {
        var data = currentRoom.stopRecording();
        $modalRec.classList.remove('bc-active');
        pushChat(null, 'Grabacion detenida', null, 'news');
        if (data) {
          var blob = new Blob([data], { type: 'application/octet-stream' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'replay.hbr2';
          a.click();
        }
      } else {
        var ok = currentRoom.startRecording && currentRoom.startRecording();
        if (ok) {
          $modalRec.classList.add('bc-active');
          pushChat(null, 'Grabando...', null, 'news');
        }
      }
    } catch (e) { pushChat(null, 'Error: ' + e.message, null, 'warn'); }
  });

  var keyMap = {
    ArrowUp: 1, w: 1, W: 1,
    ArrowDown: 2, s: 2, S: 2,
    ArrowLeft: 4, a: 4, A: 4,
    ArrowRight: 8, d: 8, D: 8,
    x: 16, X: 16, ' ': 16
  };

  var keysHeld = {};

  function computeKeyState() {
    var s = 0;
    for (var k in keysHeld) {
      if (keysHeld[k] && keyMap[k] !== undefined) s |= keyMap[k];
    }
    return s;
  }

  var _lastKeyState = -1;

  function sendKeys() {
    if (!currentRoom) return;
    var s = computeKeyState();
    if (s === _lastKeyState) return;
    _lastKeyState = s;
    try {
      if (typeof currentRoom.setKeyState === 'function') currentRoom.setKeyState(s);
    } catch (e) {}
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
    if (keyMap[ev.key] !== undefined) {
      ev.preventDefault();
      keysHeld[ev.key] = true;
      sendKeys();
    }
  });

  document.addEventListener('keyup', function (ev) {
    if (keyMap[ev.key] !== undefined) {
      ev.preventDefault();
      keysHeld[ev.key] = false;
      sendKeys();
    }
  });

  window.addEventListener('blur', function () {
    keysHeld = {};
    sendKeys();
  });

  function loadAuth() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveAuth(key, obj) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify({ key: key, obj: obj })); } catch (e) {}
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
      img.src = src;
    });
  }

  if (!roomId) {
    setError('Falta roomId', 'Agrega ?roomId=XXX&nick=TuNick');
    return;
  }

  setStatus('Iniciando...');

  var API;
  try {
    API = abcHaxballAPI(window, { proxy: PROXY });
  } catch (e) {
    setError('Error API', e.message);
    return;
  }

  var E = API;
  // Exponemos el enum GamePlayState para que stats-reporter.js
  // (que corre en otro scope) pueda saber si el partido está en
  // curso al entrar a mitad de partido. Valores confirmados:
  // { BeforeKickOff: 0, Playing: 1, AfterGoal: 2, Ending: 3 }
  window.__bcGamePlayState = API.GamePlayState;

  if (!E || !E.Room || !E.Utils) {
    setError('API incompleta');
    return;
  }

  if (typeof window.BCOriginalRenderer !== 'function') {
    setError('Falta renderer.js');
    return;
  }

  setStatus('Obteniendo credenciales...');

  var authPromise;
  var saved = loadAuth();

  if (saved && saved.key) {
    // FIX #9: guard por si authFromKey no es función en versiones viejas
    var authFromKeyFn = (E.Utils && typeof E.Utils.authFromKey === 'function')
      ? E.Utils.authFromKey.bind(E.Utils)
      : null;
    if (authFromKeyFn) {
      authPromise = authFromKeyFn(saved.key).catch(function () {
        return E.Utils.generateAuth().then(function (pair) {
          saveAuth(pair[0], pair[1]);
          return pair[1];
        });
      });
    } else {
      authPromise = E.Utils.generateAuth().then(function (pair) {
        saveAuth(pair[0], pair[1]);
        return pair[1];
      });
    }
  } else {
    authPromise = E.Utils.generateAuth().then(function (pair) {
      saveAuth(pair[0], pair[1]);
      return pair[1];
    });
  }

  var handlers = {
    onPlayerJoin: function (p) {
      if (window.BCGameEvents) window.BCGameEvents.emit('playerJoin', { player: p });
      pushChat(null, (p && p.name ? bcCleanName(p.name) : 'Alguien') + ' se conecto', null, 'join');
      Sound.play('join');
      refreshAdminToolbar();
    },
    onPlayerLeave: function (p, reason, isBanned, byId) {
      if (window.BCGameEvents) window.BCGameEvents.emit('playerLeave', { player: p, reason: reason, isBanned: isBanned, byId: byId });

      var isMe = !!(currentRoom && p && p.id === currentRoom.currentPlayerId);
      var byName = null;
      try {
        if (byId != null && currentRoom && currentRoom.getPlayer) {
          var byP = currentRoom.getPlayer(byId);
          if (byP && byP.name) byName = bcCleanName(byP.name);
        }
      } catch (e) {}

      var wasKickedOrBanned = (byId != null) || isBanned;

      if (isMe && wasKickedOrBanned) {
        // FIX KICK/BAN: guardamos la razon real (la que escribio el admin)
        // para que onClose la pueda mostrar en vez del mensaje generico.
        window.__bcLastKickInfo = {
          isBanned: !!isBanned,
          reason: (typeof reason === 'string' && reason) ? reason : null,
          byName: byName
        };
        var selfVerb = isBanned ? 'Te banearon de la sala' : 'Te expulsaron de la sala';
        var selfExtra = (byName ? (' (' + byName + ')') : '') + (reason ? ': ' + reason : '');
        setError(selfVerb, selfExtra || 'Sin motivo especificado.');
        pushChat(null, selfVerb + selfExtra, null, 'warn');
        Sound.play('leave');
        refreshAdminToolbar();
        return;
      }

      var name = (p && p.name) ? bcCleanName(p.name) : 'Alguien';
      var line;
      if (wasKickedOrBanned) {
        var verb = isBanned ? 'fue baneado' : 'fue expulsado';
        var extra = (byName ? ' por ' + byName : '') + (reason ? (': ' + reason) : '');
        line = name + ' ' + verb + extra;
      } else {
        line = name + ' se desconecto';
      }
      pushChat(null, line, null, 'leave');
      Sound.play('leave');
      refreshAdminToolbar();
    },
    onPlayerChat: function (playerOrId, msg) {
      var p = typeof playerOrId === 'object' && playerOrId ? playerOrId
        : (currentRoom && currentRoom.getPlayer) ? currentRoom.getPlayer(playerOrId) : null;
      var rawName = p && p.name ? p.name : (typeof playerOrId === 'number' ? '#' + playerOrId : '?');
      var name = bcCleanName(rawName);
      var verified = bcHasMark(rawName);
      var tid = getTeamId(p);
      var team = tid === 1 ? 'red' : tid === 2 ? 'blue' : 'spec';
      pushChat(name, msg, team, null, verified);
      Sound.play('chat');
    },
     onTeamGoal: function (team) {
      var name = team === 1 ? 'rojo' : team === 2 ? 'azul' : '?';
      pushChat(null, 'Gol del equipo ' + name + '!', null, 'warn');
      try { updateScoreboard(currentRoom); } catch (e) {}
      var sbEl = document.getElementById('bc-scoreboard');
      if (sbEl) {
        sbEl.classList.remove('goal-flash-red', 'goal-flash-blue');
        void sbEl.offsetWidth;
        sbEl.classList.add(team === 1 ? 'goal-flash-red' : 'goal-flash-blue');
      }
      Sound.play('goal');
      if (window.BCGameEvents) window.BCGameEvents.emit('goal', { teamId: team });
    },
    onGameStart: function () {
      if (window.BCGameEvents) window.BCGameEvents.emit('gameStart', {});
      pushChat(null, 'Arranca el partido', null, 'system');
      Sound.play('highlight');
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 50);
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 300);
    },
    onGameEnd: function () {
      if (window.BCGameEvents) window.BCGameEvents.emit('gameEnd', {});
      window.__bcMatchRunning = false;
      window.__bcInGame = false;
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 50);
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 300);
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 1000);
    },
    onGameStop: function () {
      if (window.BCGameEvents) window.BCGameEvents.emit('gameStop', {});
      window.__bcMatchRunning = false;
      window.__bcInGame = false;
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 50);
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 300);
      setTimeout(function () { applyClientState(); refreshAdminToolbar(); }, 1000);
    },
    onKickOff: function () {
      if (window.BCGameEvents) window.BCGameEvents.emit('kickOff', {});
      window.__bcMatchRunning = true;
      window.__bcInGame = true;
      refreshAdminToolbar();
      applyClientState();
    },
    onPlayerTeamChange: function () {
      if (window.BCGameEvents) window.BCGameEvents.emit('playerTeamChange', {});
      refreshAdminToolbar();
      if (currentRoom) renderModal(currentRoom);
      setTimeout(function () { applyClientState(); if (currentRoom) renderModal(currentRoom); }, 50);
      setTimeout(function () { applyClientState(); if (currentRoom) renderModal(currentRoom); }, 200);
    },
    onPlayerAdminChange: function () {
      refreshAdminToolbar();
      if (currentRoom) { _lastTeamsHash = ''; renderModal(currentRoom); }
      setTimeout(function () { if (currentRoom) { _lastTeamsHash = ''; renderModal(currentRoom); } }, 150);
    },
    onPingData: function () {}
  };

  authPromise.then(async function (auth) {
    setStatus('Cargando imagenes...');
    var imgs;
    try {
      imgs = await Promise.all([
        loadImage('assets/grass.png'),
        loadImage('assets/concrete.png'),
        loadImage('assets/concrete2.png'),
        loadImage('assets/typing.png')
      ]);
    } catch (e) {
      setError('Error imagenes', e.message);
      return;
    }

    setStatus('Conectando a la sala...');
    var canvas = document.getElementById('game-canvas');

    var joinConfig = {
      storage: {
        player_name: nick + BC_MARK,
        avatar: null,
        geo: { lat: -38.7183, lon: -62.2661, flag: 'ar' }
      },
      onOpen: function (r) {
        currentRoom = r;
        window.__bcRoom = r;

        bindAdmin();
        bindCtxMenu();
        bindInfoInputs();

        try {
          if (r.config) { for (var _h in handlers) r.config[_h] = handlers[_h]; }
        } catch (e) {}

        setStatus('Iniciando renderer...');
        var rendererObj;
        try {
          rendererObj = new window.BCOriginalRenderer(E, {
            canvas: canvas,
            paintGame: true,
            images: { grass: imgs[0], concrete: imgs[1], concrete2: imgs[2], typing: imgs[3] },
            onRequestAnimationFrame: function () {}
          });
        } catch (e) {
          setError('Error renderer', e.message);
          return;
        }

        rendererObj.targetFPS = 0; // FULL FPS: sin límite artificial
        rendererObj.resolutionScale = 1.0;
        // [FIX FPS/CALIDAD] En Intel iGPUs viejas (i3 tipo PC de gobierno)
        // WebGPU suele terminar corriendo por una capa de traducción (o
        // directamente cae a software) y anda peor y más inestable que
        // WebGL, que tiene drivers mucho más maduros ahí. Lo forzamos off.
        rendererObj.webGPU = false;
        // [FIX LINEAS] antialias=false + generalLineWidth/discLineWidth=1
        // es lo que hacía que las líneas se vean "raras"/dentadas, sobre
        // todo con resolutionScale bajo. forceFXAA es antialiasing barato
        // (no MSAA), casi no pega en el fps, y grosor 2/3 ya se ve prolijo
        // sin volver a los 3/4 originales que consumían más fill-rate.
        rendererObj.antialias = true;
        rendererObj.showFPS = false;
        rendererObj.showInputLag = false;
        rendererObj.showNetGraph = false;
        rendererObj.showAvatars = false;
        rendererObj.showChatIndicators = false;
        rendererObj.showPlayerIds = false;
        rendererObj.drawBackground = true;
        rendererObj.showVertices = false;
        rendererObj.showInvisibleSegments = false;
        rendererObj.squarePlayers = false;
        rendererObj.currentPlayerDistinction = true;
        rendererObj.generalLineWidth = 2;
        rendererObj.discLineWidth = 3;
        rendererObj.followPlayerId = r.currentPlayerId;
        rendererObj.followMode = true;
        rendererObj.restrictCameraOrigin = true;
        // FIX #2: NO setear zoom inicial acá — applySettings() lo va a
        // pisar con gameSettings.zoom/100. El default ahora es 260 (=2.6x)
        // para preservar el zoom que antes se seteaba acá.
        // rendererObj.setZoom(canvas.width / 2, canvas.height / 2, 2.6);

        r.setRenderer(rendererObj);
        window.__bcRenderer = rendererObj;

        try { applySettings(); } catch(e){ console.warn('[game] applySettings falló:', e.message); }

        $scoreboard.classList.add('on');
        $topright.classList.add('on');
        $chatWrap.classList.add('on');
        hideStatus();

        pushChat(null, 'Conectado a ' + (r.name || 'la sala'), null, 'system');

        // 👇 avisar al launcher que estamos adentro
        try {
          if (window.bcIPC && window.bcIPC.notifyHost) {
            window.bcIPC.notifyHost('bc-ready', {
              roomId: r.id || null,
              roomName: r.name || null,
            });
          }
        } catch(e){}

        applyClientState();
        setTimeout(applyClientState, 200);
        setTimeout(applyClientState, 1000);
        setTimeout(applyClientState, 3000);

        // Scoreboard: refresca cada 250ms. Suficiente resolución para
        // que el cronómetro cambie de segundo sin parpadear y para
        // capturar goles casi instantáneos.
        setInterval(function () {
          if (currentRoom) updateScoreboard(currentRoom);
        }, 250);

        // FIX #5: cleanup del interval por múltiples vías
        var _stateCheckInterval = setInterval(function () {
          if (window.__bcDisconnected || !currentRoom || !window.__bcRenderer) {
            clearInterval(_stateCheckInterval);
            window.__bcStateInterval = null;
            return;
          }
          applyClientState();
        }, 2000);
        window.__bcStateInterval = _stateCheckInterval;

        Sound.preload();

        setupPerfOverlay();

        // FIX #3/#7: no tocar r.E (objeto compartido del API) ni volver
        // a escribir r.config — ya fue seteado arriba desde joinConfig.
        // Antes esto pisaba handlers entre Room instances y corrompía
        // el API global.

        var $chatWrapEl = document.getElementById('bc-chat-wrap');

        function openChatInput() {
          if (!$chatWrapEl) return;
          $chatWrapEl.classList.remove('hidden-by-user');
          $chatWrapEl.classList.add('input-open');
          $chat.classList.remove('hidden-by-timer');
          setTimeout(function () { $chatText.focus(); }, 10);
        }

        function closeChatInput() {
          if (!$chatWrapEl) return;
          $chatWrapEl.classList.remove('input-open');
          $chatText.value = '';
          $chatText.blur();
        }

        document.addEventListener('keydown', function (ev) {
          if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
          if (ev.key === 'Enter' || ev.key === 't' || ev.key === 'T') {
            if ((ev.key === 'T' || ev.key === 't') && $chatWrapEl && $chatWrapEl.classList.contains('input-open')) return;
            ev.preventDefault();
            openChatInput();
          }
        });

        $chat.addEventListener('click', function () { openChatInput(); });

        // Comandos LOCALES del cliente. Se manejan acá y nunca se
        // mandan al servidor (a diferencia de /extrapolation en el
        // haxball original, que el server no necesita ver: es 100%
        // client-side, ajusta cuánto "adivina" tu propio renderer).
        function tryLocalCommand(raw) {
          var m = /^\/extrapolation(?:\s+(-?\d+))?\s*$/i.exec(raw);
          if (!m) return false;

          var rend = window.__bcRenderer;
          if (!rend) {
            pushChat(null, 'El renderer todavía no está listo.', null, 'system');
            return true;
          }

          if (m[1] === undefined) {
            pushChat(null, 'Extrapolation actual: ' + (rend.extrapolation || 0) + ' ms. Uso: /extrapolation <ms>', null, 'system');
            return true;
          }

          var ms = parseInt(m[1], 10);
          ms = Math.max(-1000, Math.min(10000, ms));
          try {
            rend.extrapolation = ms;
            try { localStorage.setItem('bc_extrapolation_ms', String(ms)); } catch (e) {}
            pushChat(null, 'Extrapolation ajustada a ' + ms + ' ms.', null, 'system');
          } catch (e) {
            pushChat(null, 'No se pudo aplicar extrapolation: ' + e.message, null, 'system');
          }
          return true;
        }

        // Restaurar el valor guardado la última vez, apenas el renderer exista.
        (function restoreExtrapolation() {
          var saved = null;
          try { saved = localStorage.getItem('bc_extrapolation_ms'); } catch (e) {}
          if (saved == null) return;
          var apply = function () {
            if (window.__bcRenderer) window.__bcRenderer.extrapolation = parseInt(saved, 10);
            else setTimeout(apply, 200);
          };
          apply();
        })();

        $chatText.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            var msg = $chatText.value.trim();
            if (!msg) { closeChatInput(); return; }
            $chatText.value = '';
            if (msg.charAt(0) === '/' && tryLocalCommand(msg)) { closeChatInput(); return; }
            if (r.sendChat) { try { r.sendChat(msg); } catch (e) {} }
            closeChatInput();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeChatInput();
          }
        });
      },
      onClose: function (reason) {
        window.__bcDisconnected = true;

        // FIX #5: cortar el interval acá también
        try { if (window.__bcStateInterval) { clearInterval(window.__bcStateInterval); window.__bcStateInterval = null; } } catch(e){}

        // [FIX KICK/PASSWORD] Antes esto leía reason.a1/reason.a2 a mano,
        // que son nombres de propiedad minificados de UNA build puntual de
        // node-haxball. Como el <script> carga @latest, cualquier update de
        // la librería puede cambiar esos nombres y "code" queda undefined
        // para SIEMPRE — que es exactamente lo que hacía que nunca se
        // detecte ni el kick ni la sala con contraseña (siempre caía al
        // mensaje genérico "La sala se cerro" sin ofrecer reintentar).
        // Ahora sacamos el código de los ErrorCodes reales que expone la
        // propia API (E.Errors.ErrorCodes), probamos varios nombres de
        // propiedad conocidos, y si ninguno pega, hacemos fallback por
        // texto (reason.toString() / el mensaje ya viene en inglés desde
        // Errors.Language). Así no depende de una sola forma del objeto.
        var EC = (E && E.Errors && E.Errors.ErrorCodes) || {};

        // [DEBUG] si el problema de contrasena persiste, este log dice
        // exactamente que forma tiene "reason" y que code detecta -
        // mandamelo y lo afino con el dato real en vez de adivinar.
        try { console.debug('[bc] onClose reason=', reason, 'typeof=', typeof reason); } catch(e){}

        var code = null;
        if (typeof reason === 'number') code = reason;
        else if (reason) {
          if (typeof reason.code === 'number') code = reason.code;
          else if (typeof reason.errorCode === 'number') code = reason.errorCode;
          else if (typeof reason.a1 === 'number') code = reason.a1;
        }

        var rawText = '';
        try { rawText = String((reason && reason.toString) ? reason.toString() : (reason || '')); } catch (e) {}
        var text = rawText.toLowerCase();

        // 👇 avisar al launcher que salimos
        try {
          if (window.bcIPC && window.bcIPC.notifyHost) {
            window.bcIPC.notifyHost('bc-exit', { code: code, msg: rawText || null });
          }
        } catch(e){}

        var msgs = {};
        msgs[EC.ConnectionClosed != null ? EC.ConnectionClosed : 1] = 'Se corto la conexion. Reintenta.';
        msgs[EC.RoomClosed        != null ? EC.RoomClosed        : 3]  = 'La sala se cerro.';
        msgs[EC.RoomFull          != null ? EC.RoomFull          : 4]  = 'La sala esta llena.';
        msgs[EC.WrongPassword     != null ? EC.WrongPassword     : 5]  = 'Contrasena incorrecta.';
        msgs[EC.BannedBefore      != null ? EC.BannedBefore      : 6]  = 'Estas baneado de esa sala.';
        msgs[EC.FailedHost        != null ? EC.FailedHost        : 8]  = 'No se pudo conectar al host. La sala puede estar cerrada.';
        // "Kicked" no está confirmado en todas las versiones de ErrorCodes;
        // el nombre real en la libreria vendorizada es KickedNow.
        var KICKED_CODE = (EC.KickedNow != null) ? EC.KickedNow : 12;
        msgs[KICKED_CODE] = 'Te expulsaron de la sala.';

        // [FIX] Si onPlayerLeave ya nos dio el motivo real (lo que escribio
        // el admin), lo priorizamos por sobre el mensaje generico de arriba.
        var kickInfo = window.__bcLastKickInfo || null;

        var isWrongPassword = code === (EC.WrongPassword != null ? EC.WrongPassword : 5)
          || text.indexOf('wrong password') !== -1 || text.indexOf('contrase') !== -1;
        var isKicked = code === KICKED_CODE
          || text.indexOf('kick') !== -1 || text.indexOf('expuls') !== -1;
        var isBanned = code === (EC.BannedBefore != null ? EC.BannedBefore : 6)
          || text.indexOf('banned') !== -1 || text.indexOf('banead') !== -1;

        var msg = (code != null && msgs[code]) ? msgs[code]
          : isWrongPassword ? 'Contrasena incorrecta.'
          : isKicked ? 'Te expulsaron de la sala.'
          : isBanned ? 'Estas baneado de esa sala.'
          : 'La sala se cerro' + (rawText ? ': ' + rawText : '');
        if (code != null) msg += ' (codigo ' + code + ')';

        // [FIX] Si tenemos el motivo real de onPlayerLeave, lo mostramos
        // en vez del texto generico "Te expulsaron"/"Estas baneado".
        if (kickInfo && (isKicked || isBanned || kickInfo.isBanned)) {
          var verb = kickInfo.isBanned ? 'Te banearon de la sala' : 'Te expulsaron de la sala';
          msg = verb + (kickInfo.byName ? ' (' + kickInfo.byName + ')' : '') +
                (kickInfo.reason ? ': ' + kickInfo.reason : ': sin motivo especificado');
          window.__bcLastKickInfo = null;
        }

        if (isWrongPassword) {
          bcPrompt('Sala con contrasena', 'Esta sala tiene contrasena. Ingresala para reconectar:', {
            placeholder: 'Contrasena', password: true, okLabel: 'Conectar', maxLength: 100
          }).then(function (p) {
            if (p) {
              location.replace(location.pathname + '?roomId=' + encodeURIComponent(roomId) + '&nick=' + encodeURIComponent(nick) + '&pass=' + encodeURIComponent(p));
            } else {
              setError('Desconectado', msg);
            }
          });
          return;
        }
        setError('Desconectado', msg);
      },
      config: {
        onPlayerJoin: handlers.onPlayerJoin,
        onPlayerLeave: handlers.onPlayerLeave,
        onPlayerChat: handlers.onPlayerChat,
        onTeamGoal: handlers.onTeamGoal,
        onGameStart: handlers.onGameStart,
        onGameEnd: handlers.onGameEnd,
        onGameStop: handlers.onGameStop,
        onKickOff: handlers.onKickOff,
        onPlayerTeamChange: handlers.onPlayerTeamChange,
        onPlayerAdminChange: handlers.onPlayerAdminChange,
        onPingData: handlers.onPingData,
        onAnnouncement: function (msg, color, style, sound) {
          if (typeof msg !== 'string' || msg.length < 2) return;
          if (window.__bcPushChat) window.__bcPushChat(null, msg, null, 'system');
        }
      }
    };

    try {
      E.Room.join({ id: roomId, password: roomPass, token: null, authObj: auth }, joinConfig);
    } catch (e) {
      setError('No se pudo iniciar', e.message);
    }
  }).catch(function (err) {
    setError('Error auth', err && err.message ? err.message : String(err));
  });

  // ============================================================
  // DRAG & DROP de jugadores entre equipos
  // ============================================================

  (function setupTeamDragDrop() {
    var teamsEl = document.getElementById('bc-modal-teams');
    if (!teamsEl) return;

    var dragState = null;
    var ghostEl = null;

    function getTeamColAt(x, y) {
      var cols = teamsEl.querySelectorAll('.bc-team-col');
      var best = null;
      var bestD = 40 * 40;
      for (var i = 0; i < cols.length; i++) {
        var r = cols[i].getBoundingClientRect();
        var cx = Math.max(r.left, Math.min(x, r.right));
        var cy = Math.max(r.top, Math.min(y, r.bottom));
        var ddx = x - cx, ddy = y - cy;
        var d = ddx*ddx + ddy*ddy;
        if (d < bestD) { bestD = d; best = cols[i]; }
      }
      return best;
    }

    function clearHighlights() {
      var cols = teamsEl.querySelectorAll('.bc-team-col');
      for (var i = 0; i < cols.length; i++) cols[i].classList.remove('drag-over');
    }

    function removeGhost() {
      if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
      ghostEl = null;
    }

    function onMove(ev) {
      if (!dragState) return;
      var dx = ev.clientX - dragState.startX;
      var dy = ev.clientY - dragState.startY;
      if (!dragState.active) {
        if (dx*dx + dy*dy < 64) return;
        dragState.active = true;
        dragState.row.classList.add('dragging');
        var nameEl = dragState.row.querySelector('.name');
        ghostEl = document.createElement('div');
        ghostEl.className = 'bc-drag-ghost';
        ghostEl.textContent = nameEl ? nameEl.textContent : 'Player';
        document.body.appendChild(ghostEl);
      }
      if (ghostEl) {
        ghostEl.style.left = ev.clientX + 'px';
        ghostEl.style.top = ev.clientY + 'px';
      }
      clearHighlights();
      var col = getTeamColAt(ev.clientX, ev.clientY);
      dragState.dropTarget = col;
      if (col) col.classList.add('drag-over');
    }

    function onUp(ev) {
      if (!dragState) return;
      var state = dragState;
      dragState = null;
      if (state.row) state.row.classList.remove('dragging');
      removeGhost();
      clearHighlights();
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      if (!state.active) return;
      if (ev && ev.type === 'pointercancel') return;
      var col = state.dropTarget;
      if (!col && ev) col = getTeamColAt(ev.clientX, ev.clientY);
      if (!col) return;
      if (!currentRoom) return;
      var teamName = col.dataset.team;
      var teamId = teamName === 'red' ? 1 : teamName === 'blue' ? 2 : 0;
      col.classList.remove('drop-success');
      void col.offsetWidth;
      col.classList.add('drop-success');
      setTimeout(function(){ col.classList.remove('drop-success'); }, 380);
      try {
        if (typeof currentRoom.setPlayerTeam !== 'function') return;
        currentRoom.setPlayerTeam(state.pid, teamId);
        setTimeout(function () { if (currentRoom) renderModal(currentRoom); }, 80);
        setTimeout(function () { if (currentRoom) renderModal(currentRoom); }, 250);
      } catch (e) { console.error('[dnd] setPlayerTeam error', e); }
    }

    teamsEl.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var row = ev.target.closest('.bc-player-row');
      if (!row) return;
      if (!canAdmin()) return;
      var pid = parseInt(row.dataset.playerId, 10);
      if (typeof pid !== 'number' || isNaN(pid) || !currentRoom) return;
      dragState = {
        pid: pid, row: row,
        startX: ev.clientX, startY: ev.clientY,
        active: false, dropTarget: null
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
      ev.preventDefault();
    });

    window.addEventListener('blur', function () {
      if (dragState) onUp({ type: 'pointercancel' });
    });
  })();
})();