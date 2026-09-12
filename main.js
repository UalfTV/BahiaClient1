const { app, BrowserWindow, ipcMain, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const log = require('electron-log')
const { autoUpdater } = require('electron-updater')
const discordRPC = require('./discord-rpc')

const CONFIG_PATH = path.join(app.getPath('userData'), 'bc-config.json')

// Configurar logging
log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB
log.transports.console.level = 'info'
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log')

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } catch (e) { return {} }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }) } catch (e) {}
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg)) } catch (e) { log.error('No se pudo guardar config:', e) }
}

const config = loadConfig()

if (!config.clientId) {
  config.clientId = crypto.randomUUID()
  saveConfig(config)
}

if (config.softwareRendering) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  app.commandLine.appendSwitch('disable-accelerated-2d-canvas')
  app.commandLine.appendSwitch('disable-2d-canvas-clip-aa')
}

// ============================================================
// GEOLOCATION (Windows)
// ------------------------------------------------------------
// El switch de Winrt rompía el webview de HaxBall en algunos setups,
// así que está descomentado por default. Si querés probar la API nativa
// de Windows, descomentá la línea de abajo. Ya existe fallback a HOME_GEO
// en el renderer, así que no es crítico.
// ============================================================
// app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation')

let win
let webviewContentsSet = new Set()

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 700,
    minWidth: 940,
    minHeight: 580,
    frame: false,
    backgroundColor: '#05050a',
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  win.once('ready-to-show', () => {
    win.show()
    win.webContents.send('app-version', app.getVersion())
  })

  win.webContents.on('did-attach-webview', (event, wc) => {
    webviewContentsSet.add(wc)
    wc.on('destroyed', () => webviewContentsSet.delete(wc))
    try { wc.setFrameRate(config.fpsLimit || 0) } catch (e) {}
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Solo abrir http/https externos, no file://, smb://, custom protocols, etc.
    try {
      const parsed = new URL(url)
      if (['http:', 'https:'].includes(parsed.protocol)) shell.openExternal(url)
    } catch (e) {}
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  // ============================================================
  // Permisos: geolocation concedido, el resto también
  // ============================================================
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') return callback(true)
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'geolocation') return true
    return true
  })
  // ============================================================

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
  try { discordRPC.shutdown() } catch (e) {}
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
    win?.webContents.send('update-status', { state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update disponible:', info.version)
    win?.webContents.send('update-status', { state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] no hay updates:', info.version)
    win?.webContents.send('update-status', { state: 'uptodate', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    log.error('[updater] error:', err.message)
    win?.webContents.send('update-status', { state: 'error', message: err.message })
  })

  autoUpdater.on('download-progress', (progress) => {
    win?.webContents.send('update-status', {
      state: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] update descargado:', info.version)
    win?.webContents.send('update-status', { state: 'downloaded', version: info.version })
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => log.warn('[updater] check falló:', err.message))
  }, 5000)

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 2 * 60 * 60 * 1000)
}

ipcMain.handle('updater:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, version: result?.updateInfo?.version || null }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('app:version', () => app.getVersion())

ipcMain.handle('logs:open', () => {
  const logsDir = path.join(app.getPath('userData'), 'logs')
  shell.openPath(logsDir)
})

ipcMain.handle('logs:path', () => path.join(app.getPath('userData'), 'logs', 'main.log'))

ipcMain.handle('logs:read', async (event, maxBytes = 50000) => {
  try {
    const p = path.join(app.getPath('userData'), 'logs', 'main.log')
    if(!fs.existsSync(p)) return { ok: true, content: '(vacío)' }
    const stat = fs.statSync(p)
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return { ok: true, content: buf.toString('utf8') }
  } catch(e) {
    return { ok: false, error: e.message }
  }
})

// ============================================================
// ADBLOCK
// ============================================================

const AD_HOSTS = [
  'doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.',
  'google-analytics.com','googletagmanager.com','googletagservices.com','adnxs.com',
  'adsafeprotected.com','amazon-adsystem.com','taboola.com','outbrain.com',
  'scorecardresearch.com','histats.com','popads.net','propellerads.com','adsterra.com',
  'exoclick.com','juicyads.com','revcontent.com','mgid.com','yandex.ru/clck',
  'omnitagjs.com','adotmob.com','visitor.omnitag','popcash.net','popmyads.com',
  'clickadu.com','adcash.com','ad-maven.com','hilltopads.net','onclickads.net','onclck.',
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
  const u = url.toLowerCase()
  return AD_HOSTS.some(p => u.includes(p))
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
  log.error('[main] Se cayó el proceso de GPU:', details.reason, details.exitCode)
  if (!config.softwareRendering) {
    config.softwareRendering = true
    saveConfig(config)
  }
  win?.webContents.send('gpu-process-crashed')
})

process.on('uncaughtException', (err) => {
  log.error('[main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandledRejection:', reason)
})

// ============================================================
// IPC — VENTANA
// ============================================================

ipcMain.on('window-minimize', () => win.minimize())
ipcMain.on('window-maximize', () => {
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('window-close', () => win.close())

ipcMain.on('open-external', (event, url) => {
  try {
    const parsed = new URL(url)
    const allowed = ['haxball.com', 'html5.haxball.com', 'www.haxball.com', 'discord.com', 'spotify.com', 'github.com']
    if (allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) shell.openExternal(url)
  } catch (e) { log.error('URL inválida en open-external:', url) }
})

ipcMain.on('open-any-external', (event, url) => {
  try {
    const parsed = new URL(url)
    if (['http:', 'https:'].includes(parsed.protocol)) shell.openExternal(url)
  } catch (e) {}
})

ipcMain.on('gpu-crash', () => {
  if (!config.softwareRendering) {
    config.softwareRendering = true
    saveConfig(config)
    log.warn('[main] Se registró un crash del juego. Próximo arranque: modo compatible.')
  }
})

ipcMain.on('relaunch-app', () => {
  app.relaunch()
  app.exit(0)
})

ipcMain.handle('get-client-id', () => config.clientId)

ipcMain.handle('get-software-rendering', () => !!config.softwareRendering)
ipcMain.handle('set-software-rendering', (event, enabled) => {
  config.softwareRendering = !!enabled
  saveConfig(config)
  return { ok: true }
})

// ============================================================
// FPS
// ============================================================

ipcMain.on('set-fps-limit', (event, fps) => {
  const n = Math.max(0, parseInt(fps, 10) || 0)
  config.fpsLimit = n
  saveConfig(config)
  for (const wc of webviewContentsSet) {
    try { wc.setFrameRate(n) } catch (e) {}
  }
})
ipcMain.handle('get-fps-limit', () => config.fpsLimit || 0)

// ============================================================
// DISCORD RICH PRESENCE
// ============================================================

ipcMain.on('discord-rpc:set-client-id', (event, id) => {
  try { discordRPC.setClientId(id || '') } catch (e) { log.warn('[discord-rpc]', e.message) }
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
  if (!clientId || typeof clientId !== 'string') return { ok: false, error: 'missing_client_id' }

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
        saveConfig(config)
        resolve({ ok: true, discord: config.discord })
      } else {
        resolve({ ok: false, error: (payload && payload.error) || 'unknown' })
      }
    }

    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://localhost:${DISCORD_CALLBACK_PORT}`)
        if (u.pathname !== DISCORD_CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('not found')
          return
        }
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const error = u.searchParams.get('error')
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Discord', `Discord rechazó la autorización: ${error}`, false, '#7289da'))
          finish(false, { error })
          return
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Discord', 'No llegó el código de autorización.', false, '#7289da'))
          finish(false, { error: 'no_code' })
          return
        }
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Discord', 'Estado inválido.', false, '#7289da'))
          finish(false, { error: 'bad_state' })
          return
        }

        let tokenData
        try {
          const tokenRes = await fetch(DISCORD_API + '/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              grant_type: 'authorization_code',
              code,
              redirect_uri: DISCORD_REDIRECT_URI,
              code_verifier: codeVerifier,
            }).toString(),
          })
          if (!tokenRes.ok) {
            const txt = await tokenRes.text().catch(() => '')
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(oauthResultHtml('BahiaClient — Discord', 'No se pudo canjear el código. Verificá que el redirect URI esté configurado en Discord Developer Portal.', false, '#7289da'))
            log.warn('[discord-oauth] token exchange failed:', tokenRes.status, txt)
            finish(false, { error: 'token_exchange_failed' })
            return
          }
          tokenData = await tokenRes.json()
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Discord', 'No se pudo contactar a Discord.', false, '#7289da'))
          finish(false, { error: 'network' })
          return
        }

        let user
        try {
          const userRes = await fetch(DISCORD_API + '/users/@me', {
            headers: { Authorization: 'Bearer ' + tokenData.access_token },
          })
          if (!userRes.ok) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(oauthResultHtml('BahiaClient — Discord', 'No se pudo leer tu perfil.', false, '#7289da'))
            finish(false, { error: 'user_fetch_failed' })
            return
          }
          user = await userRes.json()
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Discord', 'No se pudo contactar a Discord.', false, '#7289da'))
          finish(false, { error: 'network' })
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthResultHtml('BahiaClient — Discord', `¡Listo, ${user.username}! Ya podés cerrar esta pestaña.`, true, '#7289da'))
        finish(true, { user })
      } catch (e) {
        try { res.writeHead(500); res.end('error') } catch (_) {}
        finish(false, { error: 'handler_error' })
      }
    })

    pendingDiscordServer = server
    server.on('error', (e) => { finish(false, { error: 'port_busy' }) })
    server.listen(DISCORD_CALLBACK_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: DISCORD_REDIRECT_URI,
        scope: 'identify',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
      })
      const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`
      shell.openExternal(authUrl).catch(() => finish(false, { error: 'open_failed' }))
    })

    pendingDiscordTimeout = setTimeout(() => finish(false, { error: 'timeout' }), 5 * 60 * 1000)
  })
}

ipcMain.handle('discord:login', async (event, clientId) => await discordStartLogin(clientId))
ipcMain.handle('discord:logout', () => {
  delete config.discord
  saveConfig(config)
  return { ok: true }
})
ipcMain.handle('discord:status', () => ({ discord: config.discord || null, clientId: config.discordClientId || '' }))
ipcMain.handle('discord:set-client-id', (event, id) => {
  config.discordClientId = String(id || '').trim()
  saveConfig(config)
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
  if (pendingSpotifyServer) {
    try { pendingSpotifyServer.close() } catch (e) {}
    pendingSpotifyServer = null
  }
}

async function spotifyStartLogin(clientId) {
  if (!clientId) return { ok: false, error: 'missing_client_id' }

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
          accessToken: payload.tokens.access_token,
          refreshToken: payload.tokens.refresh_token,
          expiresAt: Date.now() + (payload.tokens.expires_in * 1000),
          user: payload.user || null,
          isPremium: payload.user?.product === 'premium' || null,
        }
        config.spotifyClientId = clientId
        saveConfig(config)
        resolve({ ok: true, spotify: config.spotify })
      } else {
        resolve({ ok: false, error: (payload && payload.error) || 'unknown' })
      }
    }

    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}`)
        if (u.pathname !== SPOTIFY_CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('not found')
          return
        }
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const error = u.searchParams.get('error')
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Spotify', `Spotify rechazó la autorización: ${error}`, false, '#1db954'))
          finish(false, { error })
          return
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Spotify', 'No llegó el código.', false, '#1db954'))
          finish(false, { error: 'no_code' })
          return
        }
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Spotify', 'Estado inválido.', false, '#1db954'))
          finish(false, { error: 'bad_state' })
          return
        }

        let tokenData
        try {
          const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              grant_type: 'authorization_code',
              code,
              redirect_uri: SPOTIFY_REDIRECT_URI,
              code_verifier: codeVerifier,
            }).toString(),
          })
          if (!tokenRes.ok) {
            const txt = await tokenRes.text().catch(() => '')
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(oauthResultHtml('BahiaClient — Spotify', 'No se pudo canjear el código. Verificá el redirect URI (debe ser http://127.0.0.1:8766/callback).', false, '#1db954'))
            log.warn('[spotify-oauth] token exchange failed:', tokenRes.status, txt)
            finish(false, { error: 'token_exchange_failed' })
            return
          }
          tokenData = await tokenRes.json()
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthResultHtml('BahiaClient — Spotify', 'No se pudo contactar a Spotify.', false, '#1db954'))
          finish(false, { error: 'network' })
          return
        }

        let user = null
        try {
          const userRes = await fetch(SPOTIFY_API + '/me', {
            headers: { Authorization: 'Bearer ' + tokenData.access_token },
          })
          if (userRes.ok) user = await userRes.json()
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthResultHtml('BahiaClient — Spotify', '¡Listo! Ya podés cerrar esta pestaña.', true, '#1db954'))
        finish(true, { tokens: tokenData, user })
      } catch (e) {
        try { res.writeHead(500); res.end('error') } catch (_) {}
        finish(false, { error: 'handler_error' })
      }
    })

    pendingSpotifyServer = server
    server.on('error', (e) => { finish(false, { error: 'port_busy' }) })
    server.listen(SPOTIFY_CALLBACK_PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: SPOTIFY_REDIRECT_URI,
        scope: SPOTIFY_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`
      shell.openExternal(authUrl).catch(() => finish(false, { error: 'open_failed' }))
    })

    pendingSpotifyTimeout = setTimeout(() => finish(false, { error: 'timeout' }), 5 * 60 * 1000)
  })
}

async function spotifyEnsureToken() {
  const s = config.spotify
  if (!s || !s.refreshToken) return null
  if (s.expiresAt && Date.now() < s.expiresAt - 60000) return s.accessToken
  try {
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: s.refreshToken,
        client_id: config.spotifyClientId || '',
      }).toString(),
    })
    if (!res.ok) {
      log.warn('[spotify] refresh failed:', res.status)
      if(res.status === 400 || res.status === 401) {
        delete config.spotify
        saveConfig(config)
        win?.webContents.send('spotify-session-expired')
      }
      return null
    }
    const data = await res.json()
    s.accessToken = data.access_token
    s.expiresAt = Date.now() + (data.expires_in * 1000)
    if (data.refresh_token) s.refreshToken = data.refresh_token
    config.spotify = s
    saveConfig(config)
    return s.accessToken
  } catch (e) {
    log.warn('[spotify] refresh error:', e.message)
    return null
  }
}

async function spotifyApiCall(method, path, body) {
  const token = await spotifyEnsureToken()
  if (!token) return { ok: false, error: 'no_token' }
  try {
    const opts = {
      method,
      headers: { Authorization: 'Bearer ' + token },
    }
    if (body) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(SPOTIFY_API + path, opts)
    if (res.status === 204 || res.status === 200) return { ok: true, status: res.status }
    if (res.status === 403) return { ok: false, error: 'premium_required', status: 403 }
    if (res.status === 404) return { ok: false, error: 'no_active_device', status: 404 }
    if (res.status === 401) {
      delete config.spotify
      saveConfig(config)
      win?.webContents.send('spotify-session-expired')
      return { ok: false, error: 'session_expired' }
    }
    if (!res.ok) return { ok: false, error: 'api_error', status: res.status }
    return { ok: true, status: res.status }
  } catch (e) {
    return { ok: false, error: 'network', message: e.message }
  }
}

ipcMain.handle('spotify:login', async (event, clientId) => await spotifyStartLogin(clientId))
ipcMain.handle('spotify:logout', () => {
  delete config.spotify
  saveConfig(config)
  return { ok: true }
})
ipcMain.handle('spotify:status', () => ({ spotify: config.spotify || null, clientId: config.spotifyClientId || '' }))
ipcMain.handle('spotify:set-client-id', (event, id) => {
  config.spotifyClientId = String(id || '').trim()
  saveConfig(config)
  return { ok: true }
})

ipcMain.handle('spotify:next',     () => spotifyApiCall('POST', '/me/player/next', null))
ipcMain.handle('spotify:previous', () => spotifyApiCall('POST', '/me/player/previous', null))
ipcMain.handle('spotify:pause',    () => spotifyApiCall('PUT', '/me/player/pause', null))
ipcMain.handle('spotify:play',     () => spotifyApiCall('PUT', '/me/player/play', null))

ipcMain.handle('spotify:state', async () => {
  const token = await spotifyEnsureToken()
  if (!token) return { ok: false, error: 'no_token' }
  try {
    const res = await fetch(SPOTIFY_API + '/me/player', {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (res.status === 204) return { ok: true, state: null }
    if (res.status === 403) return { ok: false, error: 'premium_required' }
    if (res.status === 401) {
      delete config.spotify
      saveConfig(config)
      win?.webContents.send('spotify-session-expired')
      return { ok: false, error: 'session_expired' }
    }
    if (!res.ok) return { ok: false, error: 'api_error', status: res.status }
    const data = await res.json()
    const item = data.item
    return {
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
  } catch (e) {
    return { ok: false, error: 'network' }
  }
})