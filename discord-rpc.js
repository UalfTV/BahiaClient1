// Discord Rich Presence para BahiaClient.
//
// Vive en el proceso principal porque necesita hablar con el cliente de
// Discord por IPC local (no desde el renderer, que está sandboxeado).
//
// Se conecta con el Application ID configurado. Si Discord no está
// corriendo, reintenta con backoff exponencial (15s → 60s). Si no hay
// Client ID, no hace nada.
//
// v2 — fix: connectingClientId se asignaba ANTES de teardown(), pero
// teardown() lo reseteaba a null. Resultado: el guard anti-doble-connect
// `if (connectingClientId === clientId) return` nunca se activaba y dos
// llamadas seguidas a doConnect(id) creaban dos clientes, uno huérfano.
// Ahora la asignación va DESPUÉS de teardown().

let DiscordRPC = null
try {
  DiscordRPC = require('discord-rpc')
} catch (e) {
  console.warn('[discord-rpc] módulo npm no instalado, se desactiva:', e.message)
}

const LOGIN_TIMEOUT_MS         = 10_000   // login() debe resolver en 10s
const RECONNECT_BASE_MS        = 15_000   // primer retry
const RECONNECT_MAX_MS         = 60_000   // cap del backoff
const RECONNECT_BACKOFF        = 1.5      // factor multiplicativo
const ACTIVITY_MIN_INTERVAL_MS = 1_000    // throttle de setActivity

let client = null
let currentClientId = null
let ready = false
let lastActivity = null
let reconnectTimer = null
let connectingClientId = null
let reconnectAttempts = 0
let pendingActivityTimer = null
let lastActivityAt = 0

// ============================================================
// Reconnect
// ============================================================

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(
    RECONNECT_MAX_MS,
    Math.round(RECONNECT_BASE_MS * Math.pow(RECONNECT_BACKOFF, reconnectAttempts))
  )
  reconnectAttempts++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (currentClientId) doConnect(currentClientId)
  }, delay)
}

// ============================================================
// Connect
// ============================================================

async function doConnect(clientId) {
  if (!DiscordRPC) return
  if (ready && currentClientId === clientId) return
  if (connectingClientId === clientId) return

  // FIX: teardown() resetea connectingClientId a null. La asignación
  // tiene que ir DESPUÉS, si no el guard de arriba nunca se activa y
  // dos doConnect(id) seguidos crean dos clientes (el primero queda
  // huérfano hasta que su login resuelva o falle).
  teardown()
  connectingClientId = clientId
  currentClientId = clientId

  const thisClient = new DiscordRPC.Client({ transport: 'ipc' })
  client = thisClient

  // Guard: si este cliente deja de ser el activo (porque otro doConnect
  // arrancó o porque hubo teardown), los handlers no deben tocar el estado.
  const isCurrent = () => client === thisClient && currentClientId === clientId

  thisClient.on('ready', () => {
    if (!isCurrent()) {
      safeDestroy(thisClient)
      return
    }
    ready = true
    connectingClientId = null
    reconnectAttempts = 0
    console.log('[discord-rpc] conectado como', thisClient?.user?.username || '?')
    if (lastActivity) applyActivity(lastActivity)
  })

  thisClient.on('disconnected', () => {
    if (!isCurrent()) return
    ready = false
    connectingClientId = null
    scheduleReconnect()
  })

  // FIX: sin este handler, un error del pipe cae en uncaughtException
  thisClient.on('error', (err) => {
    if (!isCurrent()) return
    console.warn('[discord-rpc] error:', err && err.message)
    ready = false
    connectingClientId = null
    scheduleReconnect()
  })

  try {
    // FIX: timeout — si login() se cuelga, forzamos el catch
    await Promise.race([
      thisClient.login({ clientId }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('login_timeout')), LOGIN_TIMEOUT_MS)
      ),
    ])
  } catch (e) {
    if (!isCurrent()) return
    console.warn('[discord-rpc] no se pudo conectar:', e.message)
    // Matar el cliente colgado (login puede seguir pending en background)
    safeDestroy(thisClient)
    if (client === thisClient) client = null
    ready = false
    connectingClientId = null
    scheduleReconnect()
  }
}

// ============================================================
// Teardown
// ------------------------------------------------------------
// NO resetea reconnectAttempts: eso lo hace setClientId cuando el ID
// cambia, y el handler 'ready' cuando la conexión tiene éxito.
// ============================================================

function teardown() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (pendingActivityTimer) { clearTimeout(pendingActivityTimer); pendingActivityTimer = null }
  safeDestroy(client)
  client = null
  ready = false
  connectingClientId = null
}

// [FIX] client.destroy() es ASYNC: internamente hace transport.close(),
// que crea una Promise y adentro llama a transport.send() para mandar el
// opcode de cierre. Si el login nunca llegó a abrir el socket (timeout,
// Discord cerrado, etc.), ese socket es null y send() explota con
// "Cannot read properties of null (reading 'write')" DENTRO del executor
// de la Promise. Como nunca hacíamos await ni .catch() de destroy(), esa
// rejection quedaba sin manejar → unhandledRejection en main.js.
// Con try/catch sincrónico no alcanza porque el throw pasa por un
// microtask; hay que atrapar la promesa que devuelve destroy().
function safeDestroy(c) {
  if (!c) return
  try {
    const p = c.destroy()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (e) {
    // destroy() tirando de forma sincrónica tampoco debería tumbar el proceso
  }
}

// ============================================================
// Activity
// ============================================================

async function applyActivity(activity) {
  if (!ready || !client) return
  try {
    if (!activity) await client.clearActivity()
    else await client.setActivity(activity)
  } catch (e) {
    console.warn('[discord-rpc] error seteando actividad:', e.message)
  }
}

// Throttle: si llegan muchas llamadas seguidas, manda una inmediata y
// una trailing con el último valor. Evita martillar el IPC de Discord.
function applyActivityThrottled(activity) {
  const now = Date.now()
  const elapsed = now - lastActivityAt
  if (elapsed >= ACTIVITY_MIN_INTERVAL_MS) {
    lastActivityAt = now
    applyActivity(activity)
    return
  }
  if (pendingActivityTimer) clearTimeout(pendingActivityTimer)
  pendingActivityTimer = setTimeout(() => {
    pendingActivityTimer = null
    lastActivityAt = Date.now()
    applyActivity(lastActivity)
  }, ACTIVITY_MIN_INTERVAL_MS - elapsed)
}

// ============================================================
// API pública
// ============================================================

module.exports = {
  setClientId(id) {
    if (!DiscordRPC) return

    // Logout / desactivar
    if (!id) {
      teardown()
      currentClientId = null
      reconnectAttempts = 0
      return
    }

    // Si cambia el ID, reseteamos backoff para no arrastrar intentos del anterior
    if (currentClientId !== id) reconnectAttempts = 0

    doConnect(id)
  },

  setActivity(activity) {
    lastActivity = activity
    applyActivityThrottled(activity)
  },

  shutdown() {
    teardown()
    currentClientId = null
    lastActivity = null
    reconnectAttempts = 0
  },
}