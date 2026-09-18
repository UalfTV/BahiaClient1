'use strict';

// ============================================================
// BahiaClient — preload del game view
// Corre ANTES que cualquier script del game view, en un contexto
// aislado. Expone un puente mínimo al host (el launcher).
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

// Canales conocidos del host. Se usa para el removeAllListeners
// de teardown (evita acumulación si la webview se recarga sin
// destruirse).
const HOST_CHANNELS = [
  'party-update',
  'perf-overlay',
  'open-reskin',
];

contextBridge.exposeInMainWorld('bcIPC', {
  /**
   * Manda un mensaje al launcher (el <webview> host).
   * @param {string} channel - ej: 'bc-exit', 'bc-goal', 'bc-ready'
   * @param {object} data    - payload serializable (opcional)
   */
  notifyHost(channel, data) {
    if (typeof channel !== 'string' || !channel) return;
    try {
      ipcRenderer.sendToHost(channel, data || {});
    } catch (e) {
      // FIX: log de debug en vez de silencio total.
      // No rompe nada si el host no está escuchando.
      try { console.debug('[bcIPC] notifyHost fail:', channel, e && e.message); } catch(_){}
    }
  },

  /**
   * Recibe mensajes del launcher.
   * @param {string} channel - ej: 'party-update'
   * @param {function} callback
   * @returns {function} función de baja
   */
  onHostMessage(channel, callback) {
    // FIX: validar callback — si no es función, devolvemos un noop
    // en vez de romper en la primera invocación.
    if (typeof channel !== 'string' || !channel) return () => {};
    if (typeof callback !== 'function') {
      try { console.warn('[bcIPC] onHostMessage sin callback:', channel); } catch(_){}
      return () => {};
    }

    const listener = (event, payload) => {
      try { callback(payload); } catch(e) {
        try { console.warn('[bcIPC] callback error en', channel, e && e.message); } catch(_){}
      }
    };
    ipcRenderer.on('bc-host-' + channel, listener);
    return () => {
      try { ipcRenderer.removeListener('bc-host-' + channel, listener); } catch(_){}
    };
  },

  /**
   * FIX: teardown de todos los listeners de un canal conocido.
   * Útil si el game view se recarga sin destruir la webview.
   */
  removeAllHostListeners(channel) {
    try {
      if (channel) {
        ipcRenderer.removeAllListeners('bc-host-' + channel);
      } else {
        for (const ch of HOST_CHANNELS) {
          ipcRenderer.removeAllListeners('bc-host-' + ch);
        }
      }
    } catch(_){}
  },
});