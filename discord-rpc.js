// Discord Rich Presence para BahiaClient.
//
// Vive en el proceso principal porque necesita hablar con el cliente de
// Discord por IPC local (no desde el renderer, que está sandboxeado).
//
// Se conecta con el Application ID configurado. Si Discord no está
// corriendo, reintenta cada 15s. Si no hay Client ID, no hace nada.

let DiscordRPC = null
try {
  DiscordRPC = require('discord-rpc')
} catch (e) {
  console.warn('[discord-rpc] módulo npm no instalado, se desactiva:', e.message)
}

let client = null
let currentClientId = null
let ready = false
let lastActivity = null
let reconnectTimer = null

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (currentClientId) doConnect(currentClientId)
  }, 15000)
}

async function doConnect(clientId) {
  if (!DiscordRPC) return
  if (ready && currentClientId === clientId) return

  teardown()

  currentClientId = clientId
  try {
    client = new DiscordRPC.Client({ transport: 'ipc' })
    client.on('ready', () => {
      ready = true
      console.log('[discord-rpc] conectado como', client?.user?.username || '?')
      if (lastActivity) applyActivity(lastActivity)
    })
    client.on('disconnected', () => {
      ready = false
      scheduleReconnect()
    })
    await client.login({ clientId })
  } catch (e) {
    console.warn('[discord-rpc] no se pudo conectar:', e.message)
    ready = false
    scheduleReconnect()
  }
}

function teardown() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  try { client?.destroy() } catch (e) {}
  client = null
  ready = false
}

async function applyActivity(activity) {
  if (!ready || !client) return
  try {
    if (!activity) await client.clearActivity()
    else await client.setActivity(activity)
  } catch (e) {
    console.warn('[discord-rpc] error seteando actividad:', e.message)
  }
}

module.exports = {
  setClientId(id) {
    if (!DiscordRPC) return
    if (!id) { teardown(); currentClientId = null; return }
    doConnect(id)
  },
  setActivity(activity) {
    lastActivity = activity
    applyActivity(activity)
  },
  shutdown() {
    teardown()
    currentClientId = null
  }
}