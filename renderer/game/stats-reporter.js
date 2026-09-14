'use strict';

// ============================================================
// BahiaClient — Stats Reporter
// Detecta goles, scorer, asistencias y postea al backend.
// Corre dentro del webview del juego.
//
// v10 — fixes de duplicación de kicks + limpieza de pendingGoals.
//
// v9 — ventanas ampliadas + warn detallado.
//
// BUG 1 (fixed en v8): teamId se guardaba como 0 cuando
// node-haxball devuelve player.team como NÚMERO plano (1 o 2) en
// vez de objeto { id }. Todos los kicks quedaban con teamId 0 y
// inferGoal los descartaba. Fix: teamIdOf() cubre número, objeto
// y ausente.
//
// BUG 2 (fixed en v8): ventana de 3s muy corta para rebotes.
// Subida a 5s. En v9 subida a 10s porque en partidos reales
// todavía se perdían goles con rebotes largos o pelota lenta.
//
// BUG 3 (fixed en v8): pendingGoals no se limpiaba en onGameEnd,
// acumulando goles huérfanos cuando nadie de BC estaba jugando.
//
// BUG 4 (fixed en v10): recordKicks duplicaba entradas cuando un
// jugador mantenía X apretada — el guard de 200ms era menor que
// el poll de 250ms, así que nunca filtraba y se grababa un kick
// por poll mientras isKicking siguiera true. Ahora el polling
// detecta transiciones false→true (compartidas con __bcOnKick
// vía discWasKicking), y jamás duplica la transición.
//
// BUG 5 (fixed en v10): pendingGoals no se limpiaba en onGameStart,
// así que goles huérfanos de un match cuyo /match/end falló se
// drenaban en el match siguiente. Ahora se vacía al inicio.
//
// BUG 6 (fixed en v10): midGameArmed quedaba true cuando
// onGameStart salía por early-return (room sin players todavía),
// dejando al watcher sin poder reintentar hasta el timeout de 20s.
//
// LÍMITE DE DISEÑO CONOCIDO: un gol solo puede atribuirse a un
// jugador que esté presente en window.__bcUsersMap con un
// playerId real — es decir, alguien que también usa BahiaClient.
// Si nadie de BahiaClient tocó la pelota antes del gol, se
// reporta scorer:null a propósito.
//
// LÍMITE TÉCNICO: isKicking solo transiciona a true cuando el
// jugador apreta X. Goles por colisión (sin apretar) no dejan
// kick grabado. El warn de inferGoal te dice cuántos ms atrás
// fue el último kick para distinguir esto de otros casos.
// ============================================================

(function () {

  const SCORER_WINDOW_MS = 10000;
  const ASSIST_WINDOW_MS = 12000;
  const KICK_HISTORY_SIZE = 100;
  const KICK_MIN_INTERVAL_MS = 200;
  const MIN_CONFIDENCE = 0.4;
  const KICK_POLL_MS = 250;
  const JOIN_MIDGAME_MAX_WAIT_MS = 20000;
  const JOIN_MIDGAME_POLL_MS = 500;

  const kickHistory = [];
  const pendingGoals = [];
  let matchId = null;
  let matchStartTs = 0;
  let lastScoreRed = 0;
  let lastScoreBlue = 0;
  let pollTimer = null;
  let armed = false;
  let joinMidGameTimer = null;
  let midGameArmed = false;

  // FIX BUG 4: estado por jugador del último isKicking que ya
  // registramos. El polling solo graba transiciones false→true,
  // nunca estado sostenido. __bcOnKick también lo actualiza para
  // no grabar la misma transición dos veces.
  const discWasKicking = new Map();

  function log(...a)  { try { console.log('[stats]', ...a); } catch(e){} }
  function warn(...a) { try { console.warn('[stats]', ...a); } catch(e){} }

  function getBackend() {
    const b = window.__bcBackend;
    if (!b || !b.url) return null;
    return { url: String(b.url).replace(/\/+$/, ''), key: b.key || '' };
  }

  async function post(path, body) {
    const be = getBackend();
    if (!be) { warn('backend no configurado, skip', path); return null; }
    try {
      const res = await fetch(be.url + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bc-key': be.key,
        },
        body: JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch(e){}
      if (!res.ok) { warn('POST', path, res.status, data); return null; }
      return data;
    } catch (e) {
      warn('POST error', path, e.message);
      return null;
    }
  }

  function getRoom() {
    return window.__bcRoom || null;
  }

  function getDiscs() {
    try {
      const r = window.__bcRenderer;
      if (!r || !r.bc || !r.bc.getCustomDiscInfo) return null;
      return r.bc.getCustomDiscInfo();
    } catch(e) { return null; }
  }

  function usersMap() {
    return window.__bcUsersMap || {};
  }

  function playerIdForNick(nick) {
    if (!nick) return null;
    const m = usersMap();
    const entry = m[String(nick).toLowerCase().trim()];
    return entry && entry.playerId ? entry.playerId : null;
  }

  // ============================================================
  // teamId robusto
  // ------------------------------------------------------------
  // node-haxball expone player.team de varias formas según el
  // contexto:
  //   - un número (1 o 2)           → teamId directo
  //   - un objeto { id: 1|2, ... }  → teamId = team.id
  //   - undefined / null            → 0 (desconocido)
  // ============================================================
  function teamIdOf(playerOrTeam) {
    if (playerOrTeam == null) return 0;
    if (typeof playerOrTeam === 'number') return playerOrTeam;
    const t = playerOrTeam.team;
    if (t == null) return 0;
    if (typeof t === 'number') return t;
    if (typeof t.id === 'number') return t.id;
    return 0;
  }

  // ============================================================
  // HOOK DIRECTO — el renderer llama acá cuando un jugador
  // empieza a patear (transición false → true de isKicking).
  // ============================================================
  window.__bcOnKick = function(haxballId, nick) {
    if (typeof haxballId !== 'number' || !nick) return;

    // FIX BUG 4: marcamos la transición acá para que recordKicks
    // no la vuelva a grabar en el próximo poll.
    discWasKicking.set(haxballId, true);

    const pid = playerIdForNick(nick);
    if (!pid) return;

    const room = getRoom();
    let player = room && room.getPlayer ? room.getPlayer(haxballId) : null;

    // Fallback: algunos frames de node-haxball devuelven null para
    // getPlayer(id) justo cuando isKicking transiciona. Buscamos
    // directo en room.players.
    if (!player && room && Array.isArray(room.players)) {
      player = room.players.find(p => p && p.id === haxballId) || null;
    }

    const teamId = teamIdOf(player);

    const discs = getDiscs();
    const ball = discs && discs[0];
    const myDisc = discs ? discs.find(d => d && d.playerId === haxballId) : null;

    const dx = (ball && ball.gr && myDisc && myDisc.gr) ? (myDisc.gr.x - ball.gr.x) : 999;
    const dy = (ball && ball.gr && myDisc && myDisc.gr) ? (myDisc.gr.y - ball.gr.y) : 999;
    const dist = Math.sqrt(dx*dx + dy*dy);

    const now = performance.now();
    const last = kickHistory[kickHistory.length - 1];
    if (last && last.nick === nick && (now - last.ts) < KICK_MIN_INTERVAL_MS) return;

    kickHistory.push({
      nick,
      playerId: pid,
      haxballId,
      teamId,
      ts: now,
      dist,
      ballX: ball && ball.gr ? ball.gr.x : null,
      ballY: ball && ball.gr ? ball.gr.y : null,
      kickerX: myDisc && myDisc.gr ? myDisc.gr.x : null,
      kickerY: myDisc && myDisc.gr ? myDisc.gr.y : null,
    });
    if (kickHistory.length > KICK_HISTORY_SIZE) kickHistory.shift();
  };

  // ─── Fallback por polling ────────────────────────────────────
  function recordKicks() {
    const discs = getDiscs();
    const room = getRoom();
    if (!discs || !room) return;
    const ball = discs[0];
    if (!ball || !ball.gr) return;

    const now = performance.now();

    for (let i = 1; i < discs.length; i++) {
      const d = discs[i];
      if (!d || !d.gr) continue;
      if (d.playerId == null) continue;

      // FIX BUG 4: solo grabamos en la transición false→true.
      // El estado sostenido (jugador manteniendo X) se ignora.
      const isKickingNow = d.isKicking === true;
      const wasKicking = discWasKicking.get(d.playerId) === true;
      discWasKicking.set(d.playerId, isKickingNow);
      if (!isKickingNow || wasKicking) continue;

      let player = room.getPlayer ? room.getPlayer(d.playerId) : null;
      if (!player && Array.isArray(room.players)) {
        player = room.players.find(p => p && p.id === d.playerId) || null;
      }
      if (!player || !player.name) continue;

      const nick = player.name;
      const pid = playerIdForNick(nick);
      if (!pid) continue;

      const last = kickHistory[kickHistory.length - 1];
      if (last && last.nick === nick && (now - last.ts) < KICK_MIN_INTERVAL_MS) continue;

      const teamId = teamIdOf(player);
      const dx = d.gr.x - ball.gr.x;
      const dy = d.gr.y - ball.gr.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      kickHistory.push({
        nick,
        playerId: pid,
        haxballId: d.playerId,
        teamId,
        ts: now,
        dist,
        ballX: ball.gr.x,
        ballY: ball.gr.y,
        kickerX: d.gr.x,
        kickerY: d.gr.y,
      });
      if (kickHistory.length > KICK_HISTORY_SIZE) kickHistory.shift();
    }
  }

  function startKickLoop() {
    if (pollTimer) return;
    pollTimer = setInterval(recordKicks, KICK_POLL_MS);
  }

  function stopKickLoop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ─── Inferencia de scorer/assister ────────────────────────────
  function inferGoal(teamId, historySource, nowRef) {
    const history = historySource || kickHistory;
    const now = nowRef || performance.now();
    const room = getRoom();
    const stadium = room && room.state && room.state.gameState && room.state.gameState.stadium;
    const halfWidth = stadium && typeof stadium.width === 'number' ? stadium.width : 400;

    // Pool de kicks recientes, sin filtrar por equipo todavía.
    const recent = history.filter(k => (now - k.ts) < SCORER_WINDOW_MS);

    // Preferimos kicks del mismo equipo. Si no hay, caemos a
    // cualquier kick reciente — cubre autogoles legítimos y casos
    // donde el teamId del kick quedó mal grabado.
    const sameTeam = recent.filter(k => k.teamId === teamId);
    const pool = sameTeam.length > 0 ? sameTeam : recent;

    const candidates = pool
      .map(k => {
        const proximity = Math.max(0, 1 - k.dist / 100);
        const recency   = Math.max(0, 1 - (now - k.ts) / SCORER_WINDOW_MS);
        const attackDir = teamId === 1 ? -1 : 1;
        const directionOK = Math.sign(k.kickerX) === -attackDir
                         || Math.abs(k.kickerX) < halfWidth * 0.3;
        const direction = directionOK ? 1 : 0.5;
        return Object.assign({}, k, {
          score: proximity * 0.5 + recency * 0.35 + direction * 0.15,
        });
      })
      .sort((a, b) => b.score - a.score);

    const scorer = candidates[0] || null;

    let assister = null;
    if (scorer) {
      const assistCandidates = history.filter(k =>
        k.teamId === teamId &&
        k.nick !== scorer.nick &&
        (now - k.ts) < ASSIST_WINDOW_MS &&
        k.ts < scorer.ts
      );
      if (assistCandidates.length) {
        assistCandidates.sort((a, b) => b.ts - a.ts);
        assister = assistCandidates[0];
      }
    }

    // Diagnóstico: si no hay candidatos, mostrar por qué.
    if (!candidates.length) {
      const uk = history.length ? history[history.length - 1] : null;
      warn('inferGoal: sin candidatos', {
        goalTeamId: teamId,
        kickHistorySize: history.length,
        recentSize: recent.length,
        sameTeamSize: sameTeam.length,
        msDesdeUltimoKick: uk ? Math.round(now - uk.ts) : null,
        ultimoKickTeam: uk ? uk.teamId : null,
        ultimoKickNick: uk ? uk.nick : null,
      });
    }

    return {
      scorer: scorer,
      assister: assister,
      confidence: scorer ? scorer.score : 0,
    };
  }

  // ─── Detección de autogol ──────────────────────────────────────
  // No marcamos autogol si el teamId del kicker es 0 (desconocido).
  function resolveOwnGoal(teamId, goalInfo) {
    if (!goalInfo.scorer) return { isOwn: false, realScorerId: null, realAssisterId: null };
    const scorerTeam = goalInfo.scorer.teamId;
    if (scorerTeam === 0 || scorerTeam === teamId) {
      return {
        isOwn: false,
        realScorerId: goalInfo.scorer.playerId,
        realAssisterId: goalInfo.assister ? goalInfo.assister.playerId : null,
      };
    }
    return { isOwn: true, realScorerId: goalInfo.scorer.playerId, realAssisterId: null };
  }

  // ─── Procesamiento efectivo de un gol ────────────────────────
  function processGoal(teamId, historySnapshot, nowRef) {
    const goalInfo = inferGoal(teamId, historySnapshot, nowRef);
    const resolved = resolveOwnGoal(teamId, goalInfo);

    log('goal detectado', {
      teamId,
      scorer: goalInfo.scorer && goalInfo.scorer.nick,
      scorerTeam: goalInfo.scorer && goalInfo.scorer.teamId,
      assister: goalInfo.assister && goalInfo.assister.nick,
      confidence: +goalInfo.confidence.toFixed(3),
      ownGoal: resolved.isOwn,
    });

    const body = {
      matchId,
      teamId,
      scorerId:   goalInfo.confidence >= MIN_CONFIDENCE ? resolved.realScorerId   : null,
      assisterId: goalInfo.confidence >= MIN_CONFIDENCE ? resolved.realAssisterId : null,
      ownGoal:    resolved.isOwn,
      confidence: +goalInfo.confidence.toFixed(3),
    };
    post('/match/goal', body);
  }

  // ─── Eventos del juego ──────────────────────────────────────────
  function onGameStart() {
    const room = getRoom();
    if (!room || !room.players) {
      warn('gameStart sin room');
      // FIX BUG 6: liberar el lock del watcher para que reintente
      // en el próximo poll (si esta llamada vino del watcher).
      midGameArmed = false;
      return;
    }

    const players = [];
    for (const p of room.players) {
      if (!p || !p.name) continue;
      const pid = playerIdForNick(p.name);
      if (!pid) continue;
      players.push({
        playerId: pid,
        haxballId: typeof p.id === 'number' ? p.id : null,
        nickname: p.name,
        teamId: teamIdOf(p),
      });
    }

    if (!players.length) {
      log('gameStart sin jugadores BahiaClient, match no iniciado');
      matchId = null;
      midGameArmed = false;
      return;
    }

    // FIX BUG 5: limpiar goles huérfanos de un match anterior cuyo
    // /match/end no llegó a confirmar. Antes se drenaban acá por
    // error y contaminaban el partido nuevo.
    pendingGoals.length = 0;

    // FIX BUG 4 (higiene): limpiar el estado de transición por
    // jugador al arrancar un partido nuevo. Sin esto, un jugador
    // que quedó con isKicking=true al terminar el partido anterior
    // podría no registrar su primer kick del nuevo.
    discWasKicking.clear();

    kickHistory.length = 0;
    matchStartTs = Date.now();
    lastScoreRed = 0;
    lastScoreBlue = 0;

    const stadium = room.state && room.state.gameState && room.state.gameState.stadium;
    const roomId   = (new URLSearchParams(location.search).get('roomId')) || room.id || '';
    const roomName = room.name || '';

    log('gameStart → post /match/start', { players: players.length, roomName });

    post('/match/start', {
      roomId: String(roomId),
      roomName: String(roomName),
      stadium: stadium && stadium.name ? stadium.name : null,
      players,
    }).then(res => {
      if (res && res.ok && res.matchId) {
        matchId = res.matchId;
        log('matchId asignado:', matchId);
        armed = true;
        startKickLoop();

        if (pendingGoals.length) {
          log('procesando', pendingGoals.length, 'goles encolados');
          while (pendingGoals.length) {
            const g = pendingGoals.shift();
            processGoal(g.teamId, g.kickSnapshot, g.ts);
          }
        }
      } else {
        matchId = null;
        armed = false;
        midGameArmed = false;
      }
    });
  }

  function onGameEnd(/* data */) {
    armed = false;
    stopKickLoop();
    pendingGoals.length = 0;
    kickHistory.length = 0;

    if (!matchId) { log('gameEnd sin matchId, skip'); return; }

    const room = getRoom();
    let scoreRed  = lastScoreRed;
    let scoreBlue = lastScoreBlue;
    try {
      const r = document.getElementById('bc-score-red');
      const b = document.getElementById('bc-score-blue');
      if (r && b) {
        scoreRed  = parseInt(r.textContent, 10) || scoreRed;
        scoreBlue = parseInt(b.textContent, 10) || scoreBlue;
      }
    } catch(e){}

    const roomId = (new URLSearchParams(location.search).get('roomId')) || (room && room.id) || '';

    log('gameEnd → post /match/end', { matchId, scoreRed, scoreBlue });

    post('/match/end', {
      matchId,
      scoreRed,
      scoreBlue,
      roomId: String(roomId),
    }).then(res => {
      log('match end respondido:', res);
      matchId = null;
    });
  }

  function onGoal(data) {
    const teamId = data && typeof data.teamId === 'number' ? data.teamId : null;
    if (teamId !== 1 && teamId !== 2) return;

    if (teamId === 1) lastScoreRed++;
    else              lastScoreBlue++;

    if (!matchId || !armed) {
      pendingGoals.push({
        teamId,
        kickSnapshot: kickHistory.slice(),
        ts: performance.now(),
      });
      log('gol antes de armar el match, encolado', { teamId, pending: pendingGoals.length });
      return;
    }

    processGoal(teamId, kickHistory, performance.now());
  }

  function onGameStop() {
    armed = false;
    stopKickLoop();
    matchId = null;
    midGameArmed = false;
    kickHistory.length = 0;
    pendingGoals.length = 0;
  }

  // ─── Detección de join mid-game ─────────────────────────────
  function checkJoinedMidGame() {
    if (matchId || midGameArmed) return;
    const room = getRoom();
    if (!room) return;

    const gs = room.state && room.state.gameState;
    if (!gs) return;

    const inGame = window.__bcMatchRunning === true;

    if (inGame) {
      midGameArmed = true;
      log('partido en curso detectado al entrar → armando reporter');
      onGameStart();
    }
  }

  function startJoinMidGameWatcher() {
    if (joinMidGameTimer) return;
    const start = performance.now();
    joinMidGameTimer = setInterval(() => {
      if (matchId) {
        clearInterval(joinMidGameTimer);
        joinMidGameTimer = null;
        return;
      }
      if (performance.now() - start > JOIN_MIDGAME_MAX_WAIT_MS) {
        log('join-mid-game watcher: timeout, sala sin partido en curso o room nunca llegó');
        clearInterval(joinMidGameTimer);
        joinMidGameTimer = null;
        return;
      }
      checkJoinedMidGame();
    }, JOIN_MIDGAME_POLL_MS);
  }

  // ─── Wire up ──────────────────────────────────────────────────
  function attachEvents() {
    if (!window.BCGameEvents) { setTimeout(attachEvents, 300); return; }
    window.BCGameEvents.on('gameStart', onGameStart);
    window.BCGameEvents.on('gameEnd',   onGameEnd);
    window.BCGameEvents.on('goal',      onGoal);
    window.BCGameEvents.on('gameStop',  onGameStop);
    log('eventos enganchados');
    startKickLoop();
    startJoinMidGameWatcher();
  }

  attachEvents();

  log('stats-reporter v10 cargado');
})();