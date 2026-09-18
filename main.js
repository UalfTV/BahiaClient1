const { app, BrowserWindow, ipcMain, shell, session, safeStorage, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const log = require('electron-log')
const { autoUpdater } = require('electron-updater')
const discordRPC = require('./discord-rpc')

// [FIX] Windows: agrupa notifs y taskbar bajo un AppUserModelId propio
if (process.platform === 'win32') {
  app.setAppUserModelId('com.bahiaclient.app')
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'bc-config.json')

log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.console.level = 'info'
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log')

// ============================================================
// CONFIG — cache en memoria
// ============================================================

let _configCache = null

function loadConfig() {
  if (_configCache) return _configCache
  try {
    _configCache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}
  } catch (e) {
    _configCache = {}
  }
  return _configCache
}

function saveConfig() {
  try { fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }) } catch (e) {}
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(_configCache || {}))
  } catch (e) {
    log.error('No se pudo guardar config:', e)
  }
}

const config = loadConfig()

if (!config.clientId) {
  config.clientId = crypto.randomUUID()
  saveConfig()
}

if (config.softwareRendering) {
  // [FIX FPS v0.2.8] Antes esto era "modo compatible" = apagar la GPU
  // entera (disable-gpu + disable-gpu-compositing + disable-accelerated-
  // 2d-canvas). Eso deja TODO por CPU: el WebGL del juego, el compositor
  // de la ventana, el canvas 2D del launcher... en una PC vieja eso es
  // literalmente lo que producía 1-2 FPS. La compositing GPU (mover/
  // dibujar la ventana) casi nunca es lo que crashea; lo que suele
  // fallar en iGPUs viejas es el contexto WebGL puntual. Con SwiftShader
  // (rasterizador WebGL 100% software pero OPTIMIZADO para eso, mucho
  // más rápido que "todo por CPU a mano") el juego sigue andando por
  // software SOLO donde hace falta, y la ventana/UI del launcher siguen
  // aceleradas por GPU. Resultado: mismo nivel de "compatibilidad" que
  // antes, pero sin tirar el resto del rendimiento a la basura.
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
} else {
  // FIX FPS: nada de esto estaba seteado. Sin "disable-background-timer-throttling"
  // en particular, Chromium le baja los timers a ~1Hz al proceso apenas pierde foco
  // (alt-tab a Discord, por ejemplo) y el juego se traba unos segundos al volver.
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  // [FIX #141] Windows: Chromium tiene una optimización ("Native Window
  // Occlusion") que detecta cuándo otra ventana tapa la nuestra y baja
  // los timers al mínimo. Con el game view abierto, cualquier diálogo
  // del sistema (Discord, notificaciones de Windows, alt-tab) hace que
  // Chromium marque la ventana como "occluded" y el rAF del juego se
  // frena. Los switches de arriba previenen el throttling por background
  // pero NO esta feature específica. Desactivarla solo en Windows; en
  // Linux/Mac no existe.
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  }
  // [FIX FPS 3] Los switches "disable-frame-rate-limit" / "disable-gpu-vsync"
  // que estaban ahi sacan el techo de 60fps en iGPUs viejas, PERO tambien
  // desactivan el vsync del compositor para TODOS los usuarios, no solo esas
  // maquinas puntuales. Sin vsync, los frames se presentan apenas estan
  // listos en vez de alinearse con el refresco real del monitor -> eso es
  // tearing y "frames salteados" aunque el contador diga un numero alto.
  // Los sacamos: el renderer ya tiene su propio cap (targetFPS en
  // renderer.js/game.js) que evita el techo de 60 sin tener que romper el
  // vsync global. Si en algun equipo puntual hace falta lo de antes,
  // conviene que sea un toggle en Ajustes, no algo prendido para todos.
  app.commandLine.appendSwitch('use-angle', 'gl')
}

// [FIX] Una sola instancia: evita múltiples SSE + Discord RPC
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // [FIX] No arrancamos NADA más si no tenemos el lock. Antes esto
  // seguía registrando IPC y podía crear una ventana fantasma antes
  // de que app.quit() procesara. Ahora abortamos limpio.
  app.quit()
  // No usamos `return` porque estamos en module scope de CJS; envolvemos
  // el resto en un if para que no se ejecute.
} else {
  main()
}

function main() {

app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

let win
const webviewContentsSet = new Set()

function sendToWin(channel, payload) {
  if (!win || win.isDestroyed()) return
  try { win.webContents.send(channel, payload) } catch (e) {}
}

let _updaterInitialTimeout = null
let _updaterInterval = null

let _spotifyStateCache = null
let _spotifyStateCacheAt = 0
const SPOTIFY_STATE_TTL_MS = 1500

// ============================================================
// ENCRYPT helpers
// ============================================================

function encryptSecret(plain) {
  if (typeof plain !== 'string' || !plain) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(plain).toString('base64') }
    }
  } catch (e) {}
  return { plain }
}

function decryptSecret(obj) {
  if (!obj) return null
  if (typeof obj === 'string') return obj
  try {
    if (obj.enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(obj.enc, 'base64'))
    }
    if (obj.plain) return obj.plain
  } catch (e) {
    log.warn('[safeStorage] decrypt falló:', e.message)
  }
  return null
}

// ============================================================
// WINDOW
// ============================================================

function createWindow() {
  const isMac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1200,
    height: 700,
    minWidth: 940,
    minHeight: 580,
    frame: false,
    backgroundColor: '#05050a',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 12, y: 18 } } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
    ...(isMac ? {} : { icon: path.join(__dirname, 'assets', 'icon.ico') }),
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  const showTimeout = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      log.warn('[win] ready-to-show timeout, forzando show')
      win.show()
    }
  }, 5000)

  win.once('ready-to-show', () => {
    clearTimeout(showTimeout)
    if (win.isDestroyed()) return
    win.show()
    try { win.webContents.send('app-version', app.getVersion()) } catch (e) {}
  })

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.error(`[win] did-fail-load: ${errorCode} ${errorDescription} ${validatedURL}`)
  })

  win.webContents.on('render-process-gone', (event, details) => {
    log.error('[win] render-process-gone:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) {
      try { win.reload() } catch (e) {}
    }
  })

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'file:') return
      event.preventDefault()
      if (['http:', 'https:'].includes(u.protocol)) {
        shell.openExternal(url).catch(() => {})
      }
    } catch (e) {
      event.preventDefault()
    }
  })

  // [FIX CRÍTICO] will-attach-webview: forzar defaults seguros, PERO
  // permitir el preload propio del game view. Antes se hacía
  // `delete webPreferences.preload` incondicional, lo que rompía
  // preload-game.js (bcIPC, __bcBackend, hooks del renderer).
  // Ahora solo borramos el preload si NO vive bajo __dirname — es decir,
  // si alguien intentó referenciar un archivo fuera de nuestra app.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const allowOwnPreload = (p) => {
      if (!p) return false
      try {
        let normalized = String(p)
        if (normalized.startsWith('file://')) {
          normalized = normalized.replace(/^file:\/\//, '')
          if (!normalized.startsWith('/')) normalized = '/' + normalized
          if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(normalized)) {
            normalized = normalized.slice(1)
          }
          try { normalized = decodeURIComponent(normalized) } catch (_) {}
        }
        const resolved = path.resolve(normalized)
        const appDir = path.resolve(__dirname) + path.sep
        return resolved.startsWith(appDir)
      } catch (e) { return false }
    }
    if (!allowOwnPreload(webPreferences.preload)) {
      delete webPreferences.preload
    }
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.experimentalFeatures = false
    webPreferences.backgroundThrottling = false
  })

  win.webContents.on('did-attach-webview', (event, wc) => {
    webviewContentsSet.add(wc)
    wc.on('destroyed', () => webviewContentsSet.delete(wc))
    // [FIX FPS 3] setFrameRate(0) no significa "sin límite" para Electron
    // (exige fps > 0); si config.fpsLimit no está seteado, no tocamos nada
    // y dejamos el refresh rate del compositor (que ahora ya no tiene el
    // techo de vsync gracias a los switches de arriba).
    if (config.fpsLimit && config.fpsLimit > 0) {
      try { wc.setFrameRate(config.fpsLimit) } catch (e) {}
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (['http:', 'https:'].includes(parsed.protocol)) shell.openExternal(url).catch(() => {})
    } catch (e) {}
    return { action: 'deny' }
  })

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  // [FIX FPS v0.2.8] Antes, una vez que _gpuCrashes llegaba a 2 y se
  // activaba softwareRendering, quedaba prendido PARA SIEMPRE aunque el
  // usuario haya actualizado drivers o el crash haya sido un evento
  // aislado (ej: se durmió la PC con el juego abierto). Si esta sesión
  // arranca entera sin que el GPU process se caiga, después de un ratito
  // de uso real bajamos el contador de crashes para que eventualmente
  // se pueda volver a intentar con GPU. No lo sacamos del modo compatible
  // en caliente (cambiar flags de Chromium a mitad de sesión no sirve),
  // solo evitamos que un crash viejo condene todos los arranques futuros.
  if (config._gpuCrashes) {
    setTimeout(() => {
      // 30s sin crash = el arranque fue sano, no arrastramos
      // crashes de sesiones anteriores.
      config._gpuCrashes = 0
      saveConfig()
    }, 30 * 1000)
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ALLOWED = ['geolocation', 'media', 'clipboard-read', 'clipboard-write']
    callback(ALLOWED.includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const ALLOWED = ['geolocation', 'media', 'clipboard-read', 'clipboard-write']
    return ALLOWED.includes(permission)
  })

  const haxSession = session.fromPartition('persist:haxball-game')
  haxSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const ALLOWED = ['media', 'clipboard-read', 'clipboard-write']
    callback(ALLOWED.includes(permission))
  })
  // [FIX] Simétrico al defaultSession: sin esto, navigator.permissions.query()
  // en el game view consulta el handler por defecto (permisivo) y puede
  // devolver granted/denied inconsistentes para 'media' y 'clipboard-*'.
  haxSession.setPermissionCheckHandler((webContents, permission) => {
    const ALLOWED = ['media', 'clipboard-read', 'clipboard-write']
    return ALLOWED.includes(permission)
  })

  createWindow()
  setupAdBlocking()
  setupAutoUpdater()

  if (config.discordClientId) {
    try { discordRPC.setClientId(config.discordClientId) } catch (e) {}
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (_updaterInitialTimeout) { clearTimeout(_updaterInitialTimeout); _updaterInitialTimeout = null }
  if (_updaterInterval) { clearInterval(_updaterInterval); _updaterInterval = null }

  try { discordRPC.shutdown() } catch (e) {}
  try { closeSocialStream() } catch (e) {}
  try { cleanupPendingDiscord() } catch (e) {}
  try { cleanupPendingSpotify() } catch (e) {}
})

// ============================================================
// AUTO UPDATER
// ============================================================

function setupAutoUpdater() {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] buscando actualizaciones...')
    sendToWin('update-status', { state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update disponible:', info.version)
    sendToWin('update-status', { state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] no hay updates:', info.version)
    sendToWin('update-status', { state: 'uptodate', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    log.error('[updater] error:', err.message)
    sendToWin('update-status', { state: 'error', message: err.message })
  })
  autoUpdater.on('download-progress', (progress) => {
    sendToWin('update-status', {
      state: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] update descargado:', info.version)
    sendToWin('update-status', { state: 'downloaded', version: info.version })
  })

  if (!app.isPackaged) {
    log.info('[updater] modo dev, auto-update deshabilitado')
    return
  }

  _updaterInitialTimeout = setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log.warn('[updater] check falló:', err.message))
    _updaterInitialTimeout = null
  }, 15000)

  _updaterInterval = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 2 * 60 * 60 * 1000)
}

ipcMain.handle('updater:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, version: result?.updateInfo?.version || null }
  } catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('updater:download', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(false, true) })

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.on('app:version:emit', () => {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('app-version', app.getVersion()) } catch (e) {}
  }
})

ipcMain.handle('logs:open', () => { const logsDir = path.join(app.getPath('userData'), 'logs'); shell.openPath(logsDir) })
ipcMain.handle('logs:path', () => path.join(app.getPath('userData'), 'logs', 'main.log'))
ipcMain.handle('logs:read', async (event, maxBytes = 50000) => {
  try {
    const p = path.join(app.getPath('userData'), 'logs', 'main.log')
    if (!fs.existsSync(p)) return { ok: true, content: '(vacío)' }
    const stat = fs.statSync(p)
    if (stat.size === 0) return { ok: true, content: '(vacío)' }
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return { ok: true, content: buf.toString('utf8') }
  } catch (e) { return { ok: false, error: e.message } }
})

// ============================================================
// ADBLOCK
// ============================================================

const AD_HOSTS = [
  'doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com',
  'google-analytics.com','googletagmanager.com','googletagservices.com','adnxs.com',
  'adsafeprotected.com','amazon-adsystem.com','taboola.com','outbrain.com',
  'scorecardresearch.com','histats.com','popads.net','propellerads.com','adsterra.com',
  'exoclick.com','juicyads.com','revcontent.com','mgid.com',
  'omnitagjs.com','adotmob.com','popcash.net','popmyads.com',
  'clickadu.com','adcash.com','ad-maven.com','hilltopads.net','onclickads.net',
  'mixpanel.com','amplitude.com','hotjar.com','fullstory.com','mouseflow.com','clarity.ms',
  'newrelic.com','nr-data.net','connect.facebook.net','ads-twitter.com','analytics.tiktok.com',
  'ct.pinterest.com','snap.licdn.com','fingerprintjs.com','fpjs.io','cpmstar.com',
  'cpmrevenuegate.com','revenuehits.com','coinzilla.com','coinzilla.io','bitmedia.io',
]
const NEVER_BLOCK = [
  'haxball.com','node-haxball.onrender.com','jsdelivr.net','googleapis.com','gstatic.com',
  'cloudflare.com','cloudflareinsights.com','unpkg.com','cdnjs.cloudflare.com',
  'discord.com','discordapp.com','discordapp.net','spotify.com','scdn.co',
]

function isNeverBlocked(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return NEVER_BLOCK.some(h => host === h || host.endsWith('.' + h))
  } catch (e) { return false }
}

function isAdUrl(url) {
  if (isNeverBlocked(url)) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return AD_HOSTS.some(p => host === p || host.endsWith('.' + p))
  } catch (e) { return false }
}

function setupAdBlocking() {
  const ses = session.fromPartition('persist:haxball-game')
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (isAdUrl(details.url)) { callback({ cancel: true }); return }
    callback({ cancel: false })
  })
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const host = new URL(url).hostname
        if (host === 'haxball.com' || host.endsWith('.haxball.com')) return { action: 'allow' }
      } catch (e) {}
      return { action: 'deny' }
    })
  })
}

// ============================================================
// CRASHES
// ============================================================

app.on('child-process-gone', (event, details) => {
  if (details.type !== 'GPU') return

  // clean-exit = terminó normalmente (típico al cerrar la app).
  // NO es un crash. Contarlo como tal hacía que, tras 2 cierres
  // normales, se activara softwareRendering y el juego cayera a
  // 1-2 FPS por swiftshader.
  if (details.reason === 'clean-exit') return

  log.error('[main] Se cayó el proceso de GPU:', details.reason, details.exitCode)
  config._gpuCrashes = (config._gpuCrashes || 0) + 1
  saveConfig()
  if (config._gpuCrashes >= 2 && !config.softwareRendering) {
    config.softwareRendering = true
    saveConfig()
  }
  sendToWin('gpu-process-crashed')
})

process.on('uncaughtException', (err) => {
  log.error('[main] uncaughtException:', (err && err.stack) || (err && err.message) || String(err))
})
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandledRejection:', (reason && reason.stack) || (reason && reason.message) || String(reason))
})

// ============================================================
// IPC — VENTANA
// ============================================================

ipcMain.on('window-minimize', () => { if (win && !win.isDestroyed()) win.minimize() })
ipcMain.on('window-maximize', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('window-close', () => { if (win && !win.isDestroyed()) win.close() })

ipcMain.on('open-external', (event, url) => {
  try {
    const parsed = new URL(url)
    const allowed = ['haxball.com', 'html5.haxball.com', 'www.haxball.com', 'discord.com', 'spotify.com', 'github.com']
    if (allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      shell.openExternal(url).catch(() => {})
    }
  } catch (e) { log.error('URL inválida en open-external:', url) }
})

ipcMain.on('open-any-external', (event, url) => {
  try {
    const parsed = new URL(url)
    if (['http:', 'https:'].includes(parsed.protocol)) shell.openExternal(url).catch(() => {})
  } catch (e) {}
})

ipcMain.on('gpu-crash', () => {
  if (!config.softwareRendering) {
    config.softwareRendering = true
    saveConfig()
    log.warn('[main] Se registró un crash del juego. Próximo arranque: modo compatible.')
  }
})

ipcMain.on('relaunch-app', () => {
  app.relaunch()
  app.quit()
})

ipcMain.handle('get-client-id', () => config.clientId)

// [FIX FPS v0.2.8] El renderer del juego no tenía forma de saber los Hz
// reales del monitor: usaba un cap fijo de 144 para todo el mundo. En un
// monitor de 60Hz eso no cambia nada (el rAF igual lo frena), pero en
// uno de 75/100/165/240Hz el juego se quedaba corto y "no aprovechaba"
// el monitor. Con esto el cliente pregunta el refresh real de la
// pantalla donde está la ventana y usa ESE como default.
ipcMain.handle('get-display-hz', () => {
  try {
    const display = screen.getDisplayNearestPoint(win ? win.getBounds() : { x: 0, y: 0 })
    const hz = display && display.displayFrequency
    return (hz && hz > 0) ? Math.round(hz) : 60
  } catch (e) {
    return 60
  }
})

ipcMain.handle('get-software-rendering', () => !!config.softwareRendering)
ipcMain.handle('set-software-rendering', (event, enabled) => {
  config.softwareRendering = !!enabled
  saveConfig()
  return { ok: true }
})

// ============================================================
// CONFIG general
// ============================================================

ipcMain.handle('config:get', (event, key) => {
  const cfg = loadConfig()
  if (key === undefined) return cfg
  return cfg[key] ?? null
})
ipcMain.handle('config:set', (event, key, value) => {
  const cfg = loadConfig()
  if (value === null || value === undefined) delete cfg[key]
  else cfg[key] = value
  saveConfig()
  return { ok: true }
})

// ============================================================
// PLAYER
// ============================================================

ipcMain.handle('player:get', () => {
  const cfg = loadConfig()
  return {
    playerId: cfg.playerId || null,
    nickname: cfg.nickname || null,
    recoveryCode: cfg.recoveryCode || null,
    clientId: cfg.clientId || null,
  }
})
ipcMain.handle('player:save', (event, data) => {
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_data' }
  const cfg = loadConfig()
  if (data.playerId !== undefined) cfg.playerId = data.playerId || null
  if (data.nickname !== undefined) cfg.nickname = data.nickname || null
  if (data.recoveryCode !== undefined) cfg.recoveryCode = data.recoveryCode || null
  saveConfig()
  log.info('[main] player guardado:', { playerId: cfg.playerId, nickname: cfg.nickname })
  return { ok: true }
})
ipcMain.handle('player:clear', () => {
  const cfg = loadConfig()
  delete cfg.playerId
  delete cfg.nickname
  delete cfg.recoveryCode
  saveConfig()
  log.warn('[main] player borrado del config')
  return { ok: true }
})

// ============================================================
// FPS
// ============================================================

ipcMain.on('set-fps-limit', (event, fps) => {
  const n = Math.max(0, parseInt(fps, 10) || 0)
  config.fpsLimit = n
  saveConfig()
  for (const wc of webviewContentsSet) {
    try { wc.setFrameRate(n) } catch (e) {}
  }
})
ipcMain.handle('get-fps-limit', () => config.fpsLimit || 0)

// ============================================================
// DISCORD RPC
// ============================================================

ipcMain.on('discord-rpc:set-client-id', (event, id) => {
  const trimmed = String(id || '').trim()
  config.discordClientId = trimmed
  saveConfig()
  try { discordRPC.setClientId(trimmed) } catch (e) { log.warn('[discord-rpc]', e.message) }
})
ipcMain.on('discord-rpc:set-activity', (event, activity) => {
  try { discordRPC.setActivity(activity || null) } catch (e) { log.warn('[discord-rpc]', e.message) }
})

// ============================================================
// UTILIDADES OAUTH
// ============================================================

function base64UrlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]))
}
function oauthResultHtml(title, message, ok, brandColor) {
  const color = ok ? brandColor : '#f43f5e'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#05050a;color:#eceef7;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
  .box{max-width:420px;padding:44px 36px;background:#0f0f1a;border-radius:18px;
       border:1px solid ${color}44;box-shadow:0 20px 60px rgba(0,0,0,.7)}
  h1{color:${color};margin:0 0 12px;font-size:22px;font-weight:800}
  p{margin:8px 0;color:#c0c0d0;font-size:14px;line-height:1.5}
  .hint{color:#5a5a70;font-size:12px;margin-top:20px}
</style></head><body>
<div class="box">
  <h1>${ok ? '✓ Listo' : '✗ Error'}</h1>
  <p>${escapeHtml(message)}</p>
  <p class="hint">Ya podés cerrar esta pestaña y volver a BahiaClient.</p>
</div>
</body></html>`
}

function validateClientId(id) {
  const trimmed = String(id || '').trim()
  if (!trimmed) return { ok: false, error: 'empty_client_id' }
  if (trimmed.length > 100) return { ok: false, error: 'client_id_too_long' }
  if (/\s/.test(trimmed)) return { ok: false, error: 'client_id_has_spaces' }
  return { ok: true, value: trimmed }
}

// FIX #167: fetch con timeout. Sin esto, si Discord/Spotify no responden
// (API lenta, red caída, DNS colgado), los handlers de OAuth y
// spotify:state quedan esperando para siempre: el server local sigue
// escuchando en el puerto (bloqueando reintentos), el renderer nunca
// recibe la respuesta, y el usuario no ve ningún error. Con AbortSignal
// forzamos un timeout real y liberamos el puerto.
// Node 18+ (Electron 32 ya lo trae), así que AbortController + setTimeout
// funciona sin polyfills.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, Object.assign({}, opts, { signal: controller.signal }))
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================
// DISCORD OAUTH
// ============================================================

const DISCORD_CALLBACK_PORT = 8765
const DISCORD_CALLBACK_PATH = '/callback'
const DISCORD_REDIRECT_URI = `http://localhost:${DISCORD_CALLBACK_PORT}${DISCORD_CALLBACK_PATH}`
const DISCORD_API = 'https://discord.com/api'

let pendingDiscordServer = null
let pendingDiscordTimeout = null

function cleanupPendingDiscord() {
  if (pendingDiscordTimeout) { clearTimeout(pendingDiscordTimeout); pendingDiscordTimeout = null }
  if (pendingDiscordServer) {
    try { pendingDiscordServer.close() } catch (e) {}
    pendingDiscordServer = null
  }
}

async function discordStartLogin(clientId) {
  const v = validateClientId(clientId)
  if (!v.ok) return { ok: false, error: v.error }
  cleanupPendingDiscord()
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest())
  const state = base64UrlEncode(crypto.randomBytes(16))

  return new Promise((resolve) => {
    let resolved = false
    const finish = (ok, payload) => {
      if (resolved) return
      resolved = true
      cleanupPendingDiscord()
      if (ok && payload && payload.user) {
        config.discord = {
          id: String(payload.user.id),
          username: payload.user.username,
          globalName: payload.user.global_name || null,
          discriminator: payload.user.discriminator || null,
          avatar: payload.user.avatar || null,
          connectedAt: Date.now(),
        }
        saveConfig()
        resolve({ ok: true, discord: config.discord })
      } else {
        resolve({ ok: false, error: (payload && payload.error) || 'unknown' })
      }
    }
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://localhost:${DISCORD_CALLBACK_PORT}`)
        if (u.pathname !== DISCORD_CALLBACK_PATH) { res.writeHead(404); res.end('not found'); return }
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const error = u.searchParams.get('error')
        if (error) { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(oauthResultHtml('BahiaClient — Discord', `Discord rechazó la autorización: ${error}`, false, '#7289da')); finish(false, { error }); return }
        if (!code) { res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'}); res.end(oauthResultHtml('BahiaClient — Discord', 'No llegó el código.', false, '#7289da')); finish(false, { error: 'no_code' }); return }
        if (returnedState !== state) { res.writeHead(400); res.end(oauthResultHtml('BahiaClient — Discord', 'Estado inválido.', false, '#7289da')); finish(false, { error: 'bad_state' }); return }
        let tokenData
        try {
          const tokenRes = await fetchWithTimeout(DISCORD_API + '/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: v.value, grant_type: 'authorization_code', code, redirect_uri: DISCORD_REDIRECT_URI, code_verifier: codeVerifier }).toString(),
          }, 15000)
          if (!tokenRes.ok) { res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Discord', 'No se pudo canjear el código.', false, '#7289da')); finish(false, { error: 'token_exchange_failed' }); return }
          tokenData = await tokenRes.json()
        } catch (e) {
          const isTimeout = e && e.name === 'AbortError'
          res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Discord', isTimeout ? 'Discord tardó demasiado en responder.' : 'No se pudo contactar a Discord.', false, '#7289da'))
          finish(false, { error: isTimeout ? 'timeout' : 'network' }); return
        }
        let user
        try {
          const userRes = await fetchWithTimeout(DISCORD_API + '/users/@me', { headers: { Authorization: 'Bearer ' + tokenData.access_token } }, 10000)
          if (!userRes.ok) { res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Discord', 'No se pudo leer tu perfil.', false, '#7289da')); finish(false, { error: 'user_fetch_failed' }); return }
          user = await userRes.json()
        } catch (e) {
          const isTimeout = e && e.name === 'AbortError'
          res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Discord', isTimeout ? 'Discord tardó demasiado en responder.' : 'No se pudo contactar a Discord.', false, '#7289da'))
          finish(false, { error: isTimeout ? 'timeout' : 'network' }); return
        }
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(oauthResultHtml('BahiaClient — Discord', `¡Listo, ${user.username}!`, true, '#7289da'))
        finish(true, { user })
      } catch (e) { try { res.writeHead(500); res.end('error') } catch (_) {} finish(false, { error: 'handler_error' }) }
    })
    pendingDiscordServer = server
    server.on('error', () => finish(false, { error: 'port_busy' }))
    server.listen(DISCORD_CALLBACK_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({ client_id: v.value, response_type: 'code', redirect_uri: DISCORD_REDIRECT_URI, scope: 'identify', state, code_challenge: codeChallenge, code_challenge_method: 'S256', prompt: 'consent' })
      shell.openExternal(`https://discord.com/oauth2/authorize?${params.toString()}`).catch(() => finish(false, { error: 'open_failed' }))
    })
    pendingDiscordTimeout = setTimeout(() => finish(false, { error: 'timeout' }), 5 * 60 * 1000)
  })
}

ipcMain.handle('discord:login', async (event, clientId) => await discordStartLogin(clientId))
ipcMain.handle('discord:logout', () => { delete config.discord; saveConfig(); return { ok: true } })
ipcMain.handle('discord:status', () => ({ discord: config.discord || null, clientId: config.discordClientId || '' }))
ipcMain.handle('discord:set-client-id', (event, id) => {
  const v = validateClientId(id)
  if (!v.ok) return v
  config.discordClientId = v.value
  saveConfig()
  try { discordRPC.setClientId(config.discordClientId) } catch (e) {}
  return { ok: true }
})

// ============================================================
// SPOTIFY OAUTH
// ============================================================

const SPOTIFY_CALLBACK_PORT = 8766
const SPOTIFY_CALLBACK_PATH = '/callback'
const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}${SPOTIFY_CALLBACK_PATH}`
const SPOTIFY_API = 'https://api.spotify.com/v1'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state'

let pendingSpotifyServer = null
let pendingSpotifyTimeout = null

function cleanupPendingSpotify() {
  if (pendingSpotifyTimeout) { clearTimeout(pendingSpotifyTimeout); pendingSpotifyTimeout = null }
  if (pendingSpotifyServer) { try { pendingSpotifyServer.close() } catch (e) {} pendingSpotifyServer = null }
}

async function spotifyStartLogin(clientId) {
  const v = validateClientId(clientId)
  if (!v.ok) return { ok: false, error: v.error }
  cleanupPendingSpotify()
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest())
  const state = base64UrlEncode(crypto.randomBytes(16))

  return new Promise((resolve) => {
    let resolved = false
    const finish = (ok, payload) => {
      if (resolved) return
      resolved = true
      cleanupPendingSpotify()
      if (ok && payload && payload.tokens) {
        config.spotify = {
          accessToken: encryptSecret(payload.tokens.access_token),
          refreshToken: encryptSecret(payload.tokens.refresh_token),
          expiresAt: Date.now() + (payload.tokens.expires_in * 1000),
          user: payload.user || null,
          isPremium: payload.user ? payload.user.product === 'premium' : null,
        }
        config.spotifyClientId = v.value
        saveConfig()
        resolve({ ok: true, spotify: config.spotify })
      } else {
        resolve({ ok: false, error: (payload && payload.error) || 'unknown' })
      }
    }
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}`)
        if (u.pathname !== SPOTIFY_CALLBACK_PATH) { res.writeHead(404); res.end('not found'); return }
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const error = u.searchParams.get('error')
        if (error) { res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Spotify', `Spotify rechazó la autorización: ${error}`, false, '#1db954')); finish(false, { error }); return }
        if (!code) { res.writeHead(400); res.end(oauthResultHtml('BahiaClient — Spotify', 'No llegó el código.', false, '#1db954')); finish(false, { error: 'no_code' }); return }
        if (returnedState !== state) { res.writeHead(400); res.end(oauthResultHtml('BahiaClient — Spotify', 'Estado inválido.', false, '#1db954')); finish(false, { error: 'bad_state' }); return }
        let tokenData
        try {
          const tokenRes = await fetchWithTimeout(SPOTIFY_TOKEN_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: v.value, grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI, code_verifier: codeVerifier }).toString(),
          }, 15000)
          if (!tokenRes.ok) { res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Spotify', 'No se pudo canjear el código.', false, '#1db954')); finish(false, { error: 'token_exchange_failed' }); return }
          tokenData = await tokenRes.json()
        } catch (e) {
          const isTimeout = e && e.name === 'AbortError'
          res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Spotify', isTimeout ? 'Spotify tardó demasiado en responder.' : 'No se pudo contactar a Spotify.', false, '#1db954'))
          finish(false, { error: isTimeout ? 'timeout' : 'network' }); return
        }
        let user = null
        try { const userRes = await fetchWithTimeout(SPOTIFY_API + '/me', { headers: { Authorization: 'Bearer ' + tokenData.access_token } }, 10000); if (userRes.ok) user = await userRes.json() } catch (e) {}
        res.writeHead(200); res.end(oauthResultHtml('BahiaClient — Spotify', '¡Listo!', true, '#1db954'))
        finish(true, { tokens: tokenData, user })
      } catch (e) { try { res.writeHead(500); res.end('error') } catch (_) {} finish(false, { error: 'handler_error' }) }
    })
    pendingSpotifyServer = server
    server.on('error', () => finish(false, { error: 'port_busy' }))
    server.listen(SPOTIFY_CALLBACK_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({ client_id: v.value, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT_URI, scope: SPOTIFY_SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256' })
      shell.openExternal(`https://accounts.spotify.com/authorize?${params.toString()}`).catch(() => finish(false, { error: 'open_failed' }))
    })
    pendingSpotifyTimeout = setTimeout(() => finish(false, { error: 'timeout' }), 5 * 60 * 1000)
  })
}

async function spotifyEnsureToken() {
  const s = config.spotify
  if (!s) return null

  const refreshToken = decryptSecret(s.refreshToken)
  if (!refreshToken) return null

  if (s.expiresAt && Date.now() < s.expiresAt - 60000) {
    return decryptSecret(s.accessToken)
  }
  try {
    const res = await fetchWithTimeout(SPOTIFY_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: config.spotifyClientId || '' }).toString(),
    }, 10000)
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) {
        delete config.spotify
        saveConfig()
        sendToWin('spotify-session-expired')
      }
      return null
    }
    const data = await res.json()
    s.accessToken = encryptSecret(data.access_token)
    s.expiresAt = Date.now() + (data.expires_in * 1000)
    if (data.refresh_token) s.refreshToken = encryptSecret(data.refresh_token)
    config.spotify = s
    saveConfig()
    return data.access_token
  } catch (e) { log.warn('[spotify] refresh error:', e.message); return null }
}

async function spotifyApiCall(method, path, body) {
  const token = await spotifyEnsureToken()
  if (!token) return { ok: false, error: 'no_token' }
  try {
    const opts = { method, headers: { Authorization: 'Bearer ' + token } }
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
    const res = await fetchWithTimeout(SPOTIFY_API + path, opts, 10000)
    if (res.status === 204 || res.status === 200) return { ok: true, status: res.status }
    if (res.status === 403) return { ok: false, error: 'premium_required', status: 403 }
    if (res.status === 404) return { ok: false, error: 'no_active_device', status: 404 }
    if (res.status === 401) {
      delete config.spotify
      saveConfig()
      sendToWin('spotify-session-expired')
      return { ok: false, error: 'session_expired' }
    }
    if (!res.ok) return { ok: false, error: 'api_error', status: res.status }
    return { ok: true, status: res.status }
  } catch (e) { return { ok: false, error: 'network', message: e.message } }
}

ipcMain.handle('spotify:login', async (event, clientId) => await spotifyStartLogin(clientId))
ipcMain.handle('spotify:logout', () => { delete config.spotify; saveConfig(); _spotifyStateCache = null; return { ok: true } })
ipcMain.handle('spotify:status', () => ({ spotify: config.spotify || null, clientId: config.spotifyClientId || '' }))
ipcMain.handle('spotify:set-client-id', (event, id) => {
  const v = validateClientId(id)
  if (!v.ok) return v
  config.spotifyClientId = v.value
  saveConfig()
  _spotifyStateCache = null
  return { ok: true }
})

ipcMain.handle('spotify:next',     () => spotifyApiCall('POST', '/me/player/next', null))
ipcMain.handle('spotify:previous', () => spotifyApiCall('POST', '/me/player/previous', null))
ipcMain.handle('spotify:pause',    () => spotifyApiCall('PUT', '/me/player/pause', null))
ipcMain.handle('spotify:play',     () => spotifyApiCall('PUT', '/me/player/play', null))

ipcMain.handle('spotify:state', async () => {
  const now = Date.now()
  if (_spotifyStateCache && now - _spotifyStateCacheAt < SPOTIFY_STATE_TTL_MS) {
    return _spotifyStateCache
  }
  const token = await spotifyEnsureToken()
  if (!token) return { ok: false, error: 'no_token' }
  let result
  try {
    const res = await fetchWithTimeout(SPOTIFY_API + '/me/player', { headers: { Authorization: 'Bearer ' + token } }, 8000)
    if (res.status === 204) result = { ok: true, state: null }
    else if (res.status === 403) result = { ok: false, error: 'premium_required' }
    else if (res.status === 401) {
      delete config.spotify
      saveConfig()
      sendToWin('spotify-session-expired')
      result = { ok: false, error: 'session_expired' }
    } else if (!res.ok) {
      result = { ok: false, error: 'api_error', status: res.status }
    } else {
      const data = await res.json()
      const item = data.item
      result = {
        ok: true,
        state: {
          isPlaying: !!data.is_playing,
          track: item ? {
            name: item.name,
            artists: (item.artists || []).map(a => a.name).join(', '),
            albumArt: item.album && item.album.images && item.album.images[0] ? item.album.images[0].url : null,
            durationMs: item.duration_ms,
            progressMs: data.progress_ms,
            url: item.external_urls ? item.external_urls.spotify : null,
          } : null,
        },
      }
    }
  } catch (e) { result = { ok: false, error: 'network' } }

  _spotifyStateCache = result
  _spotifyStateCacheAt = now
  return result
})

// ============================================================
// SOCIAL CENTER — SSE + IPC
// ============================================================

const socialState = {
  connected: false,
  playerId: null,
  request: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  buffer: '',
  lastEventType: null,
}

const SSE_BUFFER_MAX = 1_000_000

function getBackendConfig() {
  const cfg = loadConfig()
  let url = '', key = ''
  try { url = (cfg.bcBackendUrl || '').trim() } catch (e) {}
  try { key = (cfg.bcBackendKey || '').trim() } catch (e) {}
  return { url: url.replace(/\/+$/, ''), key }
}

function closeSocialStream() {
  if (socialState.reconnectTimer) { clearTimeout(socialState.reconnectTimer); socialState.reconnectTimer = null }
  if (socialState.request) {
    try { socialState.request.destroy() } catch (e) {}
    socialState.request = null
  }
  socialState.connected = false
  socialState.buffer = ''
}

function scheduleSocialReconnect() {
  if (socialState.reconnectTimer) return
  const n = socialState.reconnectAttempts++
  const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(n, 5)))
  log.info(`[social] reconnect en ${Math.round(delay/1000)}s`)
  socialState.reconnectTimer = setTimeout(() => {
    socialState.reconnectTimer = null
    if (socialState.playerId) openSocialStream(socialState.playerId)
  }, delay)
}

function dispatchSocialEvent(eventType, data) {
  if (!win || win.isDestroyed()) return
  const send = (channel, payload) => {
    try { win.webContents.send(channel, payload) } catch (e) {}
  }
  switch (eventType) {
    case 'hello':
      send('social:notification', { kind: 'hello', ...data })
      break
    case 'notification': {
      if (data.type === 'friend_request')        send('social:friend-request', data)
      else if (data.type === 'friend_accepted')  send('social:friend-accepted', data)
      else if (data.type === 'invite_to_play')   send('social:play-invite', data)
      else if (data.type === 'party_invite')     send('party:invite', data)
      send('social:notification', data)
      break
    }
    case 'presence':
      send('social:friend-online', data)
      send('social:notification', { kind: 'presence', ...data })
      break
    case 'party_update':
      send('party:update', data)
      break
    case 'party_leader_room_change':
      send('party:leader-room-change', data)
      break
    case 'party_disbanded':
      send('party:disbanded', data)
      break
    case 'party_left':
    case 'party_kicked':
      send('party:update', null)
      send('social:notification', { kind: eventType, ...data })
      break
    case 'party_invite_declined':
      send('social:notification', { kind: 'party_invite_declined', ...data })
      break
    default:
      send('social:notification', { kind: eventType, ...data })
  }
}

function openSocialStream(playerId) {
  closeSocialStream()
  socialState.playerId = playerId

  const { url, key } = getBackendConfig()
  if (!url) {
    log.warn('[social] no hay backend configurado, no se abre SSE')
    return { ok: false, error: 'no_backend' }
  }
  if (!playerId) return { ok: false, error: 'no_player_id' }

  const target = `${url}/events?playerId=${encodeURIComponent(playerId)}`
  let u
  try { u = new URL(target) } catch (e) { return { ok: false, error: 'bad_backend_url' } }
  const transport = u.protocol === 'https:' ? https : http

  // FIX #42: forzar IPv4 en DNS lookup. `dns.lookup` sin family puede
  // devolver IPv6 primero (según el orden del resolver del sistema),
  // y si el backend (NUC en la LAN) solo escucha en IPv4, la conexión
  // cuelga hasta el timeout o tira ECONNREFUSED. Igual chequeamos si
  // el hostname es un literal IPv6 (empieza con `[`) para no romper
  // ese caso.
  const isIPv6Literal = u.hostname.startsWith('[')
  const reqOpts = {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'x-bc-key': key,
    },
  }
  if (!isIPv6Literal) reqOpts.family = 4

  const req = transport.get(reqOpts, (res) => {
    if (res.statusCode !== 200) {
      log.warn(`[social] SSE status ${res.statusCode}, reintentando`)
      res.resume()
      socialState.connected = false
      scheduleSocialReconnect()
      return
    }
    socialState.connected = true
    socialState.reconnectAttempts = 0
    log.info(`[social] SSE conectado como ${playerId}`)

    res.setEncoding('utf8')

    res.on('data', (chunk) => {
      socialState.buffer += chunk

      if (socialState.buffer.length > SSE_BUFFER_MAX) {
        log.warn('[social] buffer overflow, descartando cola')
        const lastSep = socialState.buffer.lastIndexOf('\n\n')
        socialState.buffer = lastSep >= 0
          ? socialState.buffer.slice(lastSep + 2)
          : ''
      }

      let idx
      while ((idx = socialState.buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = socialState.buffer.slice(0, idx)
        socialState.buffer = socialState.buffer.slice(idx + 2)

        let eventType = 'message'
        let dataStr = ''
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim()
          else if (line.startsWith('data:')) dataStr += (dataStr ? '\n' : '') + line.slice(5).trim()
        }
        if (!dataStr) continue
        let parsed = null
        try { parsed = JSON.parse(dataStr) } catch (e) { continue }
        dispatchSocialEvent(eventType, parsed)
      }
    })

    res.on('end', () => {
      log.info('[social] SSE stream cerrado por el server')
      socialState.connected = false
      if (win && !win.isDestroyed()) win.webContents.send('social:disconnected')
      scheduleSocialReconnect()
    })
    res.on('error', (e) => {
      log.warn('[social] SSE res error:', e.message)
      socialState.connected = false
      scheduleSocialReconnect()
    })
  })

  req.on('error', (e) => {
    log.warn('[social] SSE req error:', e.message)
    socialState.connected = false
    socialState.request = null
    scheduleSocialReconnect()
  })

  req.setTimeout(0)
  socialState.request = req
  return { ok: true }
}

ipcMain.handle('social:connect', (event, playerId) => {
  if (!playerId || typeof playerId !== 'string') return { ok: false, error: 'invalid_player_id' }
  return openSocialStream(playerId)
})

ipcMain.handle('social:disconnect', () => {
  closeSocialStream()
  socialState.playerId = null
  return { ok: true }
})

ipcMain.handle('social:status', () => ({
  connected: socialState.connected,
  playerId: socialState.playerId,
  reconnectAttempts: socialState.reconnectAttempts,
}))

async function socialFetch(path, opts = {}) {
  const { url, key } = getBackendConfig()
  if (!url) return { ok: false, error: 'no_backend' }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url + path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-bc-key': key,
        ...(opts.headers || {}),
      },
      body: opts.body,
      signal: controller.signal,
    })
    let data = null
    try { data = await res.json() } catch (e) {}
    if (!res.ok) return { ok: false, error: (data && data.error) || 'http_error', status: res.status, data }
    return { ok: true, data }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timeout' }
    return { ok: false, error: 'network', message: e.message }
  } finally {
    clearTimeout(timeoutId)
  }
}

ipcMain.handle('social:friends-list', async (event, playerId) => {
  return socialFetch(`/friends/list?playerId=${encodeURIComponent(playerId)}`)
})

ipcMain.handle('social:friend-request', async (event, fromPlayerId, toPlayerId) => {
  return socialFetch('/friends/request', {
    method: 'POST',
    body: JSON.stringify({ fromPlayerId, toPlayerId }),
  })
})

ipcMain.handle('social:friend-accept', async (event, playerId, fromPlayerId) => {
  return socialFetch('/friends/accept', {
    method: 'POST',
    body: JSON.stringify({ playerId, fromPlayerId }),
  })
})

ipcMain.handle('social:friend-decline', async (event, playerId, fromPlayerId) => {
  return socialFetch('/friends/decline', {
    method: 'POST',
    body: JSON.stringify({ playerId, fromPlayerId }),
  })
})

ipcMain.handle('social:friend-remove', async (event, playerId, friendPlayerId) => {
  return socialFetch('/friends/remove', {
    method: 'POST',
    body: JSON.stringify({ playerId, friendPlayerId }),
  })
})

ipcMain.handle('social:friend-favorite', async (event, playerId, friendPlayerId, favorite) => {
  return socialFetch('/friends/favorite', {
    method: 'POST',
    body: JSON.stringify({ playerId, friendPlayerId, favorite: !!favorite }),
  })
})

ipcMain.handle('social:notifications-list', async (event, playerId, all) => {
  return socialFetch(`/notifications?playerId=${encodeURIComponent(playerId)}${all ? '&all=1' : ''}`)
})

ipcMain.handle('social:notifications-read', async (event, playerId, idsOrAll) => {
  const body = idsOrAll === 'all'
    ? { playerId, all: true }
    : { playerId, ids: Array.isArray(idsOrAll) ? idsOrAll : [] }
  return socialFetch('/notifications/read', { method: 'POST', body: JSON.stringify(body) })
})

ipcMain.handle('social:invite-play', async (event, fromPlayerId, toPlayerId, roomId, roomName, mode, players, maxPlayers) => {
  return socialFetch('/invite/play', {
    method: 'POST',
    body: JSON.stringify({ fromPlayerId, toPlayerId, roomId, roomName, mode, players, maxPlayers }),
  })
})

ipcMain.handle('social:search', async (event, query, asPlayerId) => {
  const q = encodeURIComponent(String(query || '').slice(0, 32))
  const as = asPlayerId ? `&as=${encodeURIComponent(asPlayerId)}` : ''
  return socialFetch(`/player/search?q=${q}${as}`)
})

ipcMain.handle('social:player-public', async (event, playerId) => {
  const id = encodeURIComponent(String(playerId || ''))
  const [profileRes, statsRes] = await Promise.all([
    socialFetch(`/player/${id}`),
    socialFetch(`/player/${id}/stats`).catch(() => ({ ok: false })),
  ])
  return {
    ok: profileRes.ok,
    player: profileRes.ok ? profileRes.data.player : null,
    stats: statsRes && statsRes.ok ? statsRes.data : null,
    error: profileRes.error,
  }
})

ipcMain.handle('social:privacy-get', async (event, playerId) => {
  return socialFetch(`/privacy?playerId=${encodeURIComponent(playerId)}`)
})

ipcMain.handle('social:privacy-set', async (event, playerId, cfg) => {
  return socialFetch('/privacy', {
    method: 'POST',
    body: JSON.stringify({ playerId, ...cfg }),
  })
})

// ============================================================
// PARTY
// ============================================================

function unwrap(r) {
  if (!r) return { ok: false, error: 'no_response' }
  if (!r.ok) return r
  return r.data || { ok: true }
}

ipcMain.handle('party:create',  async (e, playerId, maxSize) => unwrap(await socialFetch('/party/create',  { method: 'POST', body: JSON.stringify({ playerId, maxSize }) })))
ipcMain.handle('party:invite',  async (e, playerId, targetPlayerId) => unwrap(await socialFetch('/party/invite',  { method: 'POST', body: JSON.stringify({ playerId, targetPlayerId }) })))
ipcMain.handle('party:accept',  async (e, playerId, partyId) => unwrap(await socialFetch('/party/accept',  { method: 'POST', body: JSON.stringify({ playerId, partyId }) })))
ipcMain.handle('party:decline', async (e, playerId, partyId) => unwrap(await socialFetch('/party/decline', { method: 'POST', body: JSON.stringify({ playerId, partyId }) })))
ipcMain.handle('party:leave',   async (e, playerId) => unwrap(await socialFetch('/party/leave',   { method: 'POST', body: JSON.stringify({ playerId }) })))
ipcMain.handle('party:kick',    async (e, playerId, targetPlayerId) => unwrap(await socialFetch('/party/kick', { method: 'POST', body: JSON.stringify({ playerId, targetPlayerId }) })))
ipcMain.handle('party:promote', async (e, playerId, newLeaderId) => unwrap(await socialFetch('/party/promote', { method: 'POST', body: JSON.stringify({ playerId, newLeaderId }) })))
ipcMain.handle('party:get',     async (e, playerId) => unwrap(await socialFetch('/party?playerId=' + encodeURIComponent(playerId))))

} // end main()