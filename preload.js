const { contextBridge, ipcRenderer } = require('electron')

// ============================================================
// Listeners persistentes
// ------------------------------------------------------------
// Suscripciones a eventos one-way del main process. Cada `on*`
// del API expuesto devuelve su función de baja, así el renderer
// puede limpiar si alguna vez deja de escuchar.
//
// Los callbacks se ejecutan dentro de try/catch: si uno rompe,
// no afecta a los demás suscriptores del mismo canal.
// ============================================================

function makeListener(channel, extract) {
  const listeners = new Set()

  ipcRenderer.on(channel, (event, ...args) => {
    const payload = extract ? extract(...args) : args[0]
    for (const fn of listeners) {
      try { fn(payload) } catch (e) { /* swallow: un listener roto no rompe al resto */ }
    }
  })

  return (fn) => {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }
}

// --- Actualizaciones / crashes ---
const onUpdateStatus          = makeListener('update-status')
const onSpotifySessionExpired = makeListener('spotify-session-expired', () => 'spotify')
const onGpuProcessCrashed     = makeListener('gpu-process-crashed')
const onAppVersion            = makeListener('app-version')

// --- Social Center ---
const onFriendRequest         = makeListener('social:friend-request')
const onFriendAccepted        = makeListener('social:friend-accepted')
const onPlayInvite            = makeListener('social:play-invite')
const onFriendOnline          = makeListener('social:friend-online')
const onNotification          = makeListener('social:notification')
const onSocialDisconnected    = makeListener('social:disconnected')

// --- Party ---
const onPartyUpdate           = makeListener('party:update')
const onPartyLeaderRoomChange = makeListener('party:leader-room-change')
const onPartyDisbanded        = makeListener('party:disbanded')
const onPartyInvite           = makeListener('party:invite')

// ============================================================
// API expuesta al renderer
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================================
  // Ventana
  // ============================================================
  minimize:    () => ipcRenderer.send('window-minimize'),
  maximize:    () => ipcRenderer.send('window-maximize'),
  close:       () => ipcRenderer.send('window-close'),
  relaunchApp: () => ipcRenderer.send('relaunch-app'),

  // Links externos
  openExternal:    (url) => ipcRenderer.send('open-external', url),
  openAnyExternal: (url) => ipcRenderer.send('open-any-external', url),

  // Crashes
  reportGpuCrash:      () => ipcRenderer.send('gpu-crash'),
  onGpuProcessCrashed: (callback) => onGpuProcessCrashed(callback),

  // ============================================================
  // Cliente
  // ============================================================
  getClientId:   () => ipcRenderer.invoke('get-client-id'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // Listener persistente: si el renderer se suscribe después de que
  // main emitió el evento, no lo pierde porque main lo puede re-emitir.
  onAppVersion: (callback) => onAppVersion(callback),

  // [FIX] Expone el handler `ipcMain.on('app:version:emit', ...)` que
  // existía en main.js pero no se podía invocar desde el renderer.
  // Útil para forzar re-emisión de `app-version` si el listener se
  // suscribe tarde (race con la carga del renderer).
  requestAppVersion: () => ipcRenderer.send('app:version:emit'),

  // ============================================================
  // Game view
  // ============================================================
  // Devuelve la URL absoluta al index.html del webview de HaxBall,
  // o `null` si no hay `window.location` disponible (contexto raro).
  getGameViewUrl: () => {
    try {
      const base = window.location && window.location.href
      if (!base) return null
      return new URL('game/index.html', base).href
    } catch (e) {
      return null
    }
  },

  // ============================================================
  // Config general (bc-config.json)
  // ============================================================
  configGet: (key)          => ipcRenderer.invoke('config:get', key),
  configSet: (key, value)   => ipcRenderer.invoke('config:set', key, value),

  // ============================================================
  // Player (ID / nickname)
  // ============================================================
  playerGet:   ()     => ipcRenderer.invoke('player:get'),
  playerSave:  (data) => ipcRenderer.invoke('player:save', data),
  playerClear: ()     => ipcRenderer.invoke('player:clear'),

  // ============================================================
  // FPS
  // ============================================================
  setFpsLimit: (fps) => ipcRenderer.send('set-fps-limit', fps),
  getFpsLimit: ()    => ipcRenderer.invoke('get-fps-limit'),

  // ============================================================
  // Renderizado / GPU
  // ============================================================
  getSoftwareRendering: ()        => ipcRenderer.invoke('get-software-rendering'),
  setSoftwareRendering: (enabled) => ipcRenderer.invoke('set-software-rendering', enabled),

  // ============================================================
  // Discord Rich Presence
  // ============================================================
  discordRpcSetClientId: (id)       => ipcRenderer.send('discord-rpc:set-client-id', id),
  discordSetActivity:    (activity) => ipcRenderer.send('discord-rpc:set-activity', activity),

  // ALIAS: mismo handler que discordRpcSetClientId (compat con código viejo)
  discordSetClientId: (id) => ipcRenderer.send('discord-rpc:set-client-id', id),

  // ============================================================
  // Discord OAuth
  // ============================================================
  discordLogin:  (clientId) => ipcRenderer.invoke('discord:login', clientId),
  discordLogout: ()         => ipcRenderer.invoke('discord:logout'),
  discordStatus: ()         => ipcRenderer.invoke('discord:status'),

  // Canonical: setea el client ID OAuth y sincroniza el RPC si está configurado
  discordOAuthSetClientId: (id) => ipcRenderer.invoke('discord:set-client-id', id),

  // ALIAS: mismo handler (compat)
  discordSetOAuthClientId: (id) => ipcRenderer.invoke('discord:set-client-id', id),

  // ============================================================
  // Spotify OAuth + controles
  // ============================================================
  spotifyLogin:       (clientId) => ipcRenderer.invoke('spotify:login', clientId),
  spotifyLogout:      ()         => ipcRenderer.invoke('spotify:logout'),
  spotifyStatus:      ()         => ipcRenderer.invoke('spotify:status'),
  spotifySetClientId: (id)       => ipcRenderer.invoke('spotify:set-client-id', id),

  spotifyNext:     () => ipcRenderer.invoke('spotify:next'),
  spotifyPrevious: () => ipcRenderer.invoke('spotify:previous'),
  spotifyPause:    () => ipcRenderer.invoke('spotify:pause'),
  spotifyPlay:     () => ipcRenderer.invoke('spotify:play'),
  spotifyState:    () => ipcRenderer.invoke('spotify:state'),

  onSpotifySessionExpired: (callback) => onSpotifySessionExpired(callback),

  // ============================================================
  // Auto Updater
  // ============================================================
  updaterCheck:    () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall:  () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus:  (callback) => onUpdateStatus(callback),

  // ============================================================
  // Logs
  // ============================================================
  openLogsFolder: ()         => ipcRenderer.invoke('logs:open'),
  getLogsPath:    ()         => ipcRenderer.invoke('logs:path'),
  readLogs:       (maxBytes) => ipcRenderer.invoke('logs:read', maxBytes),

  // ============================================================
  // SOCIAL CENTER — Amigos, notificaciones, búsqueda, privacy
  // ============================================================

  socialConnect:    (playerId) => ipcRenderer.invoke('social:connect', playerId),
  socialDisconnect: ()         => ipcRenderer.invoke('social:disconnect'),
  socialStatus:     ()         => ipcRenderer.invoke('social:status'),

  // Amigos
  friendsList:    (playerId)                            => ipcRenderer.invoke('social:friends-list', playerId),
  friendRequest:  (fromPlayerId, toPlayerId)            => ipcRenderer.invoke('social:friend-request', fromPlayerId, toPlayerId),
  friendAccept:   (playerId, fromPlayerId)              => ipcRenderer.invoke('social:friend-accept', playerId, fromPlayerId),
  friendDecline:  (playerId, fromPlayerId)              => ipcRenderer.invoke('social:friend-decline', playerId, fromPlayerId),
  friendRemove:   (playerId, friendPlayerId)            => ipcRenderer.invoke('social:friend-remove', playerId, friendPlayerId),
  friendFavorite: (playerId, friendPlayerId, favorite)  => ipcRenderer.invoke('social:friend-favorite', playerId, friendPlayerId, favorite),

  // Notificaciones
  notificationsList: (playerId, all)       => ipcRenderer.invoke('social:notifications-list', playerId, all),
  notificationsRead: (playerId, idsOrAll)  => ipcRenderer.invoke('social:notifications-read', playerId, idsOrAll),

  // Invitaciones
  invitePlay: (fromPlayerId, toPlayerId, roomId, roomName, mode, players, maxPlayers) =>
    ipcRenderer.invoke('social:invite-play', fromPlayerId, toPlayerId, roomId, roomName, mode, players, maxPlayers),

  // Búsqueda
  searchPlayer: (query, asPlayerId) => ipcRenderer.invoke('social:search', query, asPlayerId),
  playerPublic: (playerId)          => ipcRenderer.invoke('social:player-public', playerId),

  // Privacy
  privacyGet: (playerId)         => ipcRenderer.invoke('social:privacy-get', playerId),
  privacySet: (playerId, config) => ipcRenderer.invoke('social:privacy-set', playerId, config),

  // Eventos del SSE
  onFriendRequest:      (callback) => onFriendRequest(callback),
  onFriendAccepted:     (callback) => onFriendAccepted(callback),
  onPlayInvite:         (callback) => onPlayInvite(callback),
  onFriendOnline:       (callback) => onFriendOnline(callback),
  onNotification:       (callback) => onNotification(callback),
  onSocialDisconnected: (callback) => onSocialDisconnected(callback),

  // ============================================================
  // PARTY
  // ============================================================

  partyCreate:  (playerId, maxSize)        => ipcRenderer.invoke('party:create', playerId, maxSize),
  partyInvite:  (playerId, targetPlayerId) => ipcRenderer.invoke('party:invite', playerId, targetPlayerId),
  partyAccept:  (playerId, partyId)        => ipcRenderer.invoke('party:accept', playerId, partyId),
  partyDecline: (playerId, partyId)        => ipcRenderer.invoke('party:decline', playerId, partyId),
  partyLeave:   (playerId)                 => ipcRenderer.invoke('party:leave', playerId),
  partyKick:    (playerId, targetPlayerId) => ipcRenderer.invoke('party:kick', playerId, targetPlayerId),
  partyPromote: (playerId, newLeaderId)    => ipcRenderer.invoke('party:promote', playerId, newLeaderId),
  partyGet:     (playerId)                 => ipcRenderer.invoke('party:get', playerId),

  // Eventos de party
  onPartyUpdate:           (callback) => onPartyUpdate(callback),
  onPartyLeaderRoomChange: (callback) => onPartyLeaderRoomChange(callback),
  onPartyDisbanded:        (callback) => onPartyDisbanded(callback),
  onPartyInvite:           (callback) => onPartyInvite(callback),
})