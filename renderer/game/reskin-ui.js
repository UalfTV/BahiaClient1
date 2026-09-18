'use strict';

// ============================================================
// BahiaClient — UI del panel de reskin
// ============================================================

(function () {

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const LAST_TAB_KEY = 'bc_reskin_last_tab';
  const VALID_TABS = ['ball', 'trail', 'bg', 'ambient', 'avatar', 'sounds'];

  function getLastTab() {
    try {
      const t = localStorage.getItem(LAST_TAB_KEY);
      if (t && VALID_TABS.includes(t)) return t;
    } catch (e) {}
    return 'ball';
  }
  function setLastTab(t) {
    if (!VALID_TABS.includes(t)) return;
    try { localStorage.setItem(LAST_TAB_KEY, t); } catch (e) {}
  }

  let modalEl = null;

  function buildModal() {
    if (modalEl) return modalEl;
    const div = document.createElement('div');
    div.id = 'bc-reskin-modal';
    div.innerHTML = `
      <div class="reskin-modal">
        <div class="reskin-head">
          <div class="reskin-title"><i class="ti ti-palette"></i> Personalización</div>
          <button class="bc-modal-close" onclick="BCReskinUI.close()">✕</button>
        </div>
        <div class="reskin-tabs">
          <button class="reskin-tab" data-tab="ball"><i class="ti ti-ball-football"></i> Pelota</button>
          <button class="reskin-tab" data-tab="trail"><i class="ti ti-line"></i> Trail</button>
          <button class="reskin-tab" data-tab="bg"><i class="ti ti-photo"></i> Fondo</button>
          <button class="reskin-tab" data-tab="ambient"><i class="ti ti-sparkles"></i> Ambiente</button>
          <button class="reskin-tab" data-tab="avatar"><i class="ti ti-user-circle"></i> Avatar</button>
          <button class="reskin-tab" data-tab="sounds"><i class="ti ti-volume"></i> Sonidos</button>
        </div>
        <div class="reskin-body" id="reskin-body"></div>
        <div class="reskin-foot">
          <button class="fb danger" onclick="BCReskinUI.confirmReset()">Resetear todo</button>
          <div style="flex:1"></div>
          <button class="fb p" onclick="BCReskinUI.close()">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    modalEl = div;

    div.addEventListener('click', (e) => {
      if (e.target === div) close();
    });
    div.querySelectorAll('.reskin-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        div.querySelectorAll('.reskin-tab').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        setLastTab(btn.dataset.tab);
        renderTab(btn.dataset.tab);
      });
    });
    return div;
  }

  function activateTab(tab) {
    if (!modalEl) return;
    const t = VALID_TABS.includes(tab) ? tab : getLastTab();
    modalEl.querySelectorAll('.reskin-tab').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === t);
    });
    renderTab(t);
  }

  function renderTab(tab) {
    const body = $('reskin-body');
    if (!body) return;
    if (!window.BCReskin) {
      body.innerHTML = '<div class="reskin-hint">La personalización no está disponible todavía. Probá de nuevo en unos segundos.</div>';
      return;
    }
    if (tab === 'ball')    body.innerHTML = renderBall();
    if (tab === 'trail')   body.innerHTML = renderTrail();
    if (tab === 'bg')      body.innerHTML = renderBg();
    if (tab === 'ambient') body.innerHTML = renderAmbient();
    if (tab === 'avatar')  body.innerHTML = renderAvatar();
    if (tab === 'sounds')  body.innerHTML = renderSounds();
    bindFileInputs();
  }

  function renderBall() {
    const cfg = BCReskin.getSection('ball');
    const presets = window.BCReskinPresets.BALLS;
    const presetsHtml = presets.map(p => {
      const on = (p.id === 'default' && cfg.mode === 'none') ||
                 (p.id !== 'default' && cfg.mode === 'preset' && cfg.preset === p.id);
      return `
        <button class="reskin-swatch ${on ? 'on' : ''}" data-action="ball-preset" data-id="${p.id}" title="${esc(p.label)}">
          <div class="swatch-preview" style="background:${p.preview};background-size:cover"></div>
          <div class="swatch-label">${esc(p.label)}</div>
        </button>`;
    }).join('');

    const isCustom = cfg.mode === 'custom';
    return `
      <div class="reskin-section">
        <div class="reskin-section-title">Presets</div>
        <div class="reskin-grid">${presetsHtml}</div>
      </div>
      <div class="reskin-section">
        <div class="reskin-section-title">Personalizada</div>
        <div class="reskin-row">
          <input type="file" id="file-ball" accept="image/png,image/jpeg,image/webp" style="display:none">
          <button class="fb ${isCustom ? 'p' : ''}" onclick="document.getElementById('file-ball').click()">
            <i class="ti ti-upload"></i> ${isCustom ? 'Cambiar imagen' : 'Subir imagen'}
          </button>
          ${isCustom ? `<button class="fb danger" onclick="BCReskinUI.clearCustom('ball')">Quitar</button>` : ''}
        </div>
      </div>
      <div class="reskin-section">
        <div class="reskin-row">
          <label>Tamaño</label>
          <input type="range" min="0.5" max="2" step="0.05" value="${cfg.size}"
                 data-fmt="fixed2" data-suffix="×"
                 oninput="BCReskin.setSection('ball',{size:parseFloat(this.value)})">
          <span class="reskin-val">${cfg.size.toFixed(2)}×</span>
        </div>
      </div>
    `;
  }

  function renderTrail() {
    const cfg = BCReskin.getSection('trail');
    const colors = window.BCReskinPresets.TRAIL_COLORS;
    const colorHtml = colors.map(c => {
      const on = (c.id === 'none' && cfg.mode === 'none') ||
                 (c.id !== 'none' && cfg.mode === 'preset' && cfg.preset === c.id);
      let bg;
      if (c.id === 'none') bg = 'transparent';
      else if (c.id === 'rainbow') bg = 'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';
      else if (c.id === 'fire') bg = 'linear-gradient(180deg, #fef08a, #f97316, #dc2626)';
      else if (c.id === 'ice') bg = 'linear-gradient(180deg, #e0f2fe, #0284c7)';
      else if (c.id === 'neon') bg = 'linear-gradient(180deg, #f0abfc, #d946ef, #a855f7)';
      else if (c.id === 'shadow') bg = 'linear-gradient(180deg, #333, #000)';
      else bg = c.value;
      return `
        <button class="reskin-swatch reskin-swatch-sm ${on ? 'on' : ''}" data-action="trail-preset" data-id="${c.id}" title="${esc(c.label)}">
          <div class="swatch-preview" style="background:${bg};${c.id==='none'?'border:1px dashed rgba(255,255,255,.2)':''}"></div>
        </button>`;
    }).join('');

    return `
      <div class="reskin-section">
        <div class="reskin-section-title">Color</div>
        <div class="reskin-grid reskin-grid-sm">${colorHtml}</div>
      </div>
      <div class="reskin-section">
        <div class="reskin-row">
          <label>Largo</label>
          <input type="range" min="5" max="60" step="1" value="${cfg.length}"
                 oninput="BCReskin.setSection('trail',{length:parseInt(this.value,10)})">
          <span class="reskin-val">${cfg.length}</span>
        </div>
        <div class="reskin-row">
          <label>Ancho</label>
          <input type="range" min="2" max="20" step="1" value="${cfg.width}"
                 data-suffix="px"
                 oninput="BCReskin.setSection('trail',{width:parseInt(this.value,10)})">
          <span class="reskin-val">${cfg.width}px</span>
        </div>
      </div>
    `;
  }

  function renderBg() {
    const cfg = BCReskin.getSection('bg');
    const presets = window.BCReskinPresets.BACKGROUNDS;
    const presetsHtml = presets.map(p => {
      const on = (p.id === 'none' && cfg.mode === 'none') ||
                 (p.id !== 'none' && cfg.mode === 'preset' && cfg.preset === p.id);
      return `
        <button class="reskin-swatch ${on ? 'on' : ''}" data-action="bg-preset" data-id="${p.id}" title="${esc(p.label)}">
          <div class="swatch-preview" style="background:${p.preview};background-size:cover"></div>
          <div class="swatch-label">${esc(p.label)}</div>
        </button>`;
    }).join('');

    const isCustom = cfg.mode === 'custom';
    return `
      <div class="reskin-section">
        <div class="reskin-section-title">Presets</div>
        <div class="reskin-grid">${presetsHtml}</div>
      </div>
      <div class="reskin-section">
        <div class="reskin-section-title">Personalizado</div>
        <div class="reskin-row">
          <input type="file" id="file-bg" accept="image/png,image/jpeg,image/webp" style="display:none">
          <button class="fb ${isCustom ? 'p' : ''}" onclick="document.getElementById('file-bg').click()">
            <i class="ti ti-upload"></i> ${isCustom ? 'Cambiar imagen' : 'Subir imagen'}
          </button>
          ${isCustom ? `<button class="fb danger" onclick="BCReskinUI.clearCustom('bg')">Quitar</button>` : ''}
        </div>
      </div>
      <div class="reskin-section">
        <div class="reskin-row">
          <label>Opacidad</label>
          <input type="range" min="0.1" max="1" step="0.05" value="${cfg.opacity}"
                 data-fmt="percent"
                 oninput="BCReskin.setSection('bg',{opacity:parseFloat(this.value)})">
          <span class="reskin-val">${Math.round(cfg.opacity*100)}%</span>
        </div>
      </div>
    `;
  }

  function renderAmbient() {
    const cfg = BCReskin.getSection('ambient');
    const presets = window.BCReskinPresets.AMBIENTS;
    const presetsHtml = presets.map(p => {
      const on = (p.id === 'none' && cfg.mode === 'none') ||
                 (p.id !== 'none' && cfg.mode === 'preset' && cfg.preset === p.id);
      return `
        <button class="reskin-swatch ${on ? 'on' : ''}" data-action="ambient-preset" data-id="${p.id}" title="${esc(p.label)}">
          <div class="swatch-preview" style="background:${p.preview};background-size:cover"></div>
          <div class="swatch-label">${esc(p.label)}</div>
        </button>`;
    }).join('');

    return `
      <div class="reskin-section">
        <div class="reskin-section-title">Efecto de fondo (fuera del mapa)</div>
        <p class="reskin-hint">Se dibuja detrás de todo, en el espacio negro que rodea la cancha.</p>
        <div class="reskin-grid">${presetsHtml}</div>
      </div>
      ${cfg.mode !== 'none' ? `
      <div class="reskin-section">
        <div class="reskin-row">
          <label>Intensidad</label>
          <input type="range" min="0.2" max="2" step="0.1" value="${cfg.intensity}"
                 data-fmt="fixed1" data-suffix="×"
                 oninput="BCReskin.setSection('ambient',{intensity:parseFloat(this.value)})">
          <span class="reskin-val">${cfg.intensity.toFixed(1)}×</span>
        </div>
        <div class="reskin-row">
          <label>Velocidad</label>
          <input type="range" min="0.1" max="3" step="0.1" value="${cfg.speed}"
                 data-fmt="fixed1" data-suffix="×"
                 oninput="BCReskin.setSection('ambient',{speed:parseFloat(this.value)})">
          <span class="reskin-val">${cfg.speed.toFixed(1)}×</span>
        </div>
      </div>` : ''}
    `;
  }

  function renderAvatar() {
    const cfg = BCReskin.getSection('avatar');
    const isCustom = cfg.mode === 'custom' && cfg.custom;
    return `
      <div class="reskin-section">
        <div class="reskin-section-title">Foto de tu jugador</div>
        <p class="reskin-hint">Se muestra sobre tu disco. Cuadrado, fondo transparente recomendado.</p>
        <div class="reskin-row">
          <input type="file" id="file-avatar" accept="image/png,image/jpeg,image/webp" style="display:none">
          <button class="fb ${isCustom ? 'p' : ''}" onclick="document.getElementById('file-avatar').click()">
            <i class="ti ti-upload"></i> ${isCustom ? 'Cambiar foto' : 'Subir foto'}
          </button>
          ${isCustom ? `<button class="fb danger" onclick="BCReskinUI.clearCustom('avatar')">Quitar</button>` : ''}
        </div>
        ${isCustom ? `<div class="reskin-avatar-preview"><img src="${esc(cfg.custom)}" alt=""></div>` : ''}
      </div>
    `;
  }

  function renderSounds() {
    const cfg = BCReskin.getSection('sounds');
    return `
      <div class="reskin-section">
        <div class="reskin-section-title">Sonido al pegar (kick)</div>
        <div class="reskin-row">
          <input type="file" id="file-sound-kick" accept="audio/*" style="display:none">
          <button class="fb ${cfg.kick.mode==='custom'?'p':''}" onclick="document.getElementById('file-sound-kick').click()">
            <i class="ti ti-upload"></i> ${cfg.kick.mode==='custom' ? 'Cambiar audio' : 'Subir audio'}
          </button>
          ${cfg.kick.mode==='custom' ? `<button class="fb danger" onclick="BCReskinUI.resetSound('kick')">Por defecto</button>` : ''}
        </div>
      </div>
      <div class="reskin-section">
        <div class="reskin-section-title">Sonido de gol</div>
        <div class="reskin-row">
          <input type="file" id="file-sound-goal" accept="audio/*" style="display:none">
          <button class="fb ${cfg.goal.mode==='custom'?'p':''}" onclick="document.getElementById('file-sound-goal').click()">
            <i class="ti ti-upload"></i> ${cfg.goal.mode==='custom' ? 'Cambiar audio' : 'Subir audio'}
          </button>
          ${cfg.goal.mode==='custom' ? `<button class="fb danger" onclick="BCReskinUI.resetSound('goal')">Por defecto</button>` : ''}
        </div>
      </div>
      <p class="reskin-hint">Los audios custom se cargan por encima de los del juego. Formatos: mp3, ogg, wav.</p>
    `;
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function bindFileInputs() {
    const ball = $('file-ball');
    if (ball) ball.onchange = async () => {
      const f = ball.files[0]; if (!f) return;
      if (f.size > 500_000) { alert('Imagen muy grande (máx 500 KB).'); return; }
      const d = await readAsDataUrl(f);
      BCReskin.setSection('ball', { mode: 'custom', custom: d });
      refresh();
    };
    const bg = $('file-bg');
    if (bg) bg.onchange = async () => {
      const f = bg.files[0]; if (!f) return;
      if (f.size > 1_500_000) { alert('Imagen muy grande (máx 1.5 MB).'); return; }
      const d = await readAsDataUrl(f);
      BCReskin.setSection('bg', { mode: 'custom', custom: d });
      refresh();
    };
    const av = $('file-avatar');
    if (av) av.onchange = async () => {
      const f = av.files[0]; if (!f) return;
      if (f.size > 500_000) { alert('Imagen muy grande (máx 500 KB).'); return; }
      const d = await readAsDataUrl(f);
      BCReskin.setSection('avatar', { mode: 'custom', custom: d });
      refresh();
    };
    const sk = $('file-sound-kick');
    if (sk) sk.onchange = async () => {
      const f = sk.files[0]; if (!f) return;
      if (f.size > 800_000) { alert('Audio muy grande (máx 800 KB).'); return; }
      const d = await readAsDataUrl(f);
      BCReskin.setSection('sounds', { kick: { mode: 'custom', custom: d } });
      refresh();
    };
    const sg = $('file-sound-goal');
    if (sg) sg.onchange = async () => {
      const f = sg.files[0]; if (!f) return;
      if (f.size > 800_000) { alert('Audio muy grande (máx 800 KB).'); return; }
      const d = await readAsDataUrl(f);
      BCReskin.setSection('sounds', { goal: { mode: 'custom', custom: d } });
      refresh();
    };
  }

  // FIX: los sliders ahora actualizan el <span class="reskin-val"> hermano
  // en vivo mientras arrastrás. Se scopea a inputs dentro del modal
  // (chequeando que el nextElementSibling tenga la clase reskin-val),
  // así no rompe sliders de otros lados.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'range') return;
    const sib = el.nextElementSibling;
    if (!sib || !sib.classList.contains('reskin-val')) return;
    const fmt = el.dataset.fmt || '';
    const suffix = el.dataset.suffix || '';
    const v = parseFloat(el.value);
    if (fmt === 'percent')      sib.textContent = Math.round(v * 100) + '%';
    else if (fmt === 'fixed2')  sib.textContent = v.toFixed(2) + suffix;
    else if (fmt === 'fixed1')  sib.textContent = v.toFixed(1) + suffix;
    else                        sib.textContent = el.value + suffix;
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    if (a === 'ball-preset') {
      if (t.dataset.id === 'default') BCReskin.setSection('ball', { mode: 'none', preset: 'default' });
      else BCReskin.setSection('ball', { mode: 'preset', preset: t.dataset.id });
      renderTab('ball');
    }
    if (a === 'trail-preset') {
      if (t.dataset.id === 'none') BCReskin.setSection('trail', { mode: 'none' });
      else {
        const color = window.BCReskinPresets.TRAIL_COLORS.find(c => c.id === t.dataset.id);
        BCReskin.setSection('trail', { mode: 'preset', preset: t.dataset.id, custom: color ? color.value : '#7dd3fc' });
      }
      renderTab('trail');
    }
    if (a === 'bg-preset') {
      if (t.dataset.id === 'none') BCReskin.setSection('bg', { mode: 'none' });
      else BCReskin.setSection('bg', { mode: 'preset', preset: t.dataset.id });
      renderTab('bg');
    }
    if (a === 'ambient-preset') {
      if (t.dataset.id === 'none') BCReskin.setSection('ambient', { mode: 'none' });
      else BCReskin.setSection('ambient', { mode: 'preset', preset: t.dataset.id });
      renderTab('ambient');
    }
  });

  function open(tab) {
    // FIX: guard por si BCReskin no está inicializado (por ej. si este
    // archivo se carga en un contexto donde customizer.js no arrancó,
    // o si el launcher intenta abrirlo sin game view activo). Sin
    // esto, renderBall/renderTrail/etc explotaban con
    // "Cannot read properties of undefined (reading 'getSection')".
    if (!window.BCReskin) {
      console.warn('[reskin-ui] BCReskin no está inicializado; no se puede abrir el modal');
      return;
    }
    buildModal();
    modalEl.classList.add('on');
    activateTab(tab || getLastTab());
  }
  function close() {
    if (modalEl) modalEl.classList.remove('on');
  }
  function refresh() {
    if (!modalEl || !modalEl.classList.contains('on')) return;
    const active = modalEl.querySelector('.reskin-tab.on');
    renderTab(active ? active.dataset.tab : getLastTab());
  }
  function clearCustom(section) {
    if (section === 'ball')   BCReskin.setSection('ball',   { mode: 'none', custom: null });
    if (section === 'bg')     BCReskin.setSection('bg',     { mode: 'none', custom: null });
    if (section === 'avatar') BCReskin.setSection('avatar', { mode: 'none', custom: null });
    refresh();
  }
  // FIX: helper para restaurar un sonido al default y refrescar el UI.
  function resetSound(which) {
    if (which === 'kick')      BCReskin.setSection('sounds', { kick: { mode: 'default', custom: null } });
    else if (which === 'goal') BCReskin.setSection('sounds', { goal: { mode: 'default', custom: null } });
    refresh();
  }
  function confirmReset() {
    if (!confirm('¿Resetear toda la personalización?')) return;
    BCReskin.reset();
    refresh();
  }

  window.BCReskinUI = { open, close, refresh, clearCustom, resetSound, confirmReset };
  console.log('[reskin-ui] cargado');
})();