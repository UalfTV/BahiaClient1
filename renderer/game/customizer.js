'use strict';

// ============================================================
// BahiaClient — Customizer de reskin v3.8
// - Pelota animada a 384px / 45ms
// - _imgCache con LRU (max 12) — evita leak, no evicta en uso
// - Pausa el rAF cuando la ventana está oculta
// - v3.6: fix eviction de texturas en uso
// - v3.7: trail con glow aditivo + highlight + presets nuevos
// - v3.8: hslToRgbNum normaliza hue/clamp, hookGoalSound retry,
//         evict no rompe LRU, destroy() API, size clamp
// ============================================================

(function () {

  const STORAGE_KEY = 'bc_reskin_v2';

  const DEFAULT_CONFIG = {
    ball:   { mode: 'none', preset: 'default', custom: null, size: 1.0 },
    trail:  { mode: 'none', preset: 'cyan',    custom: '#7dd3fc', length: 20, width: 6 },
    bg:     { mode: 'none', preset: 'grass',   custom: null, opacity: 0.5 },
    avatar: { mode: 'none', custom: null },
    ambient:{ mode: 'none', preset: 'stars', intensity: 1.0, speed: 1.0 },
    sounds: { kick: { mode: 'default', custom: null }, goal: { mode: 'default', custom: null } },
  };

  const BALL_ANIM_SIZE = 384;
  const BALL_ANIM_INTERVAL = 45;
  const MAX_IMG_CACHE = 12;

  function deepMerge(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const k in override) {
      if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) {
        out[k] = deepMerge(base[k] || {}, override[k]);
      } else {
        out[k] = override[k];
      }
    }
    return out;
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      return deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
    catch (e) { console.warn('[customizer] no se pudo guardar:', e.message); }
  }

  // ============================================================
  // ESTADO
  // ============================================================

  const S = {
    rendererObj: null,
    hooks: null,
    config: loadConfig(),

    ballSprite: null,
    ballTexture: null,
    ballTextureKey: null,
    ballMask: null,
    ballMaskRadius: -1,

    ballAnimCanvas: null,
    ballAnimCtx: null,
    ballAnimTexture: null,
    ballAnimLastFrame: -1,

    trailGlow: null,
    trailGraphics: null,
    trailPoints: [],

    bgSprite: null,
    bgTexture: null,
    bgTextureKey: null,
    bgFlagApplied: null,
    bgSortableSet: false,

    ambientContainer: null,
    ambientGfx: null,
    ambientData: null,

    prevKicking: new Map(),
    customAudioCache: new Map(),

    raf: null,
    attached: false,
    paused: false,
    rainbowPhase: 0,
    t0: performance.now(),

    // FIX: retry de hook de sonido
    _goalSoundTimer: null,
    _goalSoundTries: 0,
  };

  // ============================================================
  // HELPERS
  // ============================================================

  function getPIXI() {
    if (S.hooks && S.hooks.getPixi) {
      const p = S.hooks.getPixi();
      if (p) return p;
    }
    return window.PIXI || null;
  }

  function hexToNumber(hex) {
    if (typeof hex === 'number') return hex;
    if (typeof hex !== 'string') return 0xffffff;
    const v = parseInt(hex.replace('#', ''), 16);
    return isNaN(v) ? 0xffffff : v;
  }

  function textureFromCanvas(canvas) {
    const PIXI = getPIXI();
    if (!PIXI || !canvas) return null;
    try { return PIXI.Texture.from(canvas); } catch (e) { return null; }
  }

  const _imgCache = new Map();

  function _isTextureInCache(tex) {
    if (!tex) return false;
    for (const [, entry] of _imgCache) {
      if (entry.tex === tex) return true;
    }
    return false;
  }

  function _isTextureInUse(tex) {
    if (!tex) return false;
    const bs = S.ballSprite;
    const bgs = S.bgSprite;
    if (bs && !bs.destroyed && bs.texture === tex) return true;
    if (bgs && !bgs.destroyed && bgs.texture === tex) return true;
    return false;
  }

  // FIX: si la entrada está en uso, la rotamos al final en vez de borrarla.
  // Antes: delete + skip destroy → textura huérfana (leak).
  // Ahora: la entrada en uso se mueve al final de la LRU y no se toca.
  function _evictImgCache() {
    const maxAttempts = _imgCache.size * 2 + 4;
    let attempts = 0;
    while (_imgCache.size > MAX_IMG_CACHE && attempts < maxAttempts) {
      attempts++;
      const firstKey = _imgCache.keys().next().value;
      if (firstKey === undefined) break;
      const entry = _imgCache.get(firstKey);

      if (entry && entry.tex && _isTextureInUse(entry.tex)) {
        // Rotar al final (más reciente) y seguir con el siguiente
        _imgCache.delete(firstKey);
        _imgCache.set(firstKey, entry);
        continue;
      }

      _imgCache.delete(firstKey);

      if (entry && entry.tex) {
        try { entry.tex.destroy(true); } catch (e) {}
      }
      if (entry && entry.img) {
        try {
          entry.img.onload = null;
          entry.img.onerror = null;
          entry.img.src = '';
        } catch (e) {}
      }
    }
  }

  function textureFromDataUrl(dataUrl) {
    const PIXI = getPIXI();
    if (!PIXI || !dataUrl) return null;

    let entry = _imgCache.get(dataUrl);
    if (!entry) {
      const img = new Image();
      entry = { img, tex: null, ok: false, failed: false };
      _imgCache.set(dataUrl, entry);
      _evictImgCache();

      img.onload = async () => {
        try {
          if (typeof img.decode === 'function') {
            try { await img.decode(); } catch (e) {}
          }
          entry.tex = PIXI.Texture.from(img);
          entry.ok = true;
        } catch (e) {
          console.warn('[customizer] no se pudo crear textura de imagen:', e.message);
          entry.failed = true;
        }
      };
      img.onerror = () => {
        console.warn('[customizer] fallo al cargar imagen custom');
        entry.failed = true;
      };
      img.src = dataUrl;
      return null;
    }

    _imgCache.delete(dataUrl);
    _imgCache.set(dataUrl, entry);

    if (entry.failed) return null;
    return entry.ok ? entry.tex : null;
  }

  function clearImageCache() {
    for (const [, entry] of _imgCache) {
      if (entry.tex) { try { entry.tex.destroy(true); } catch (e) {} }
      if (entry.img) {
        try {
          entry.img.onload = null;
          entry.img.onerror = null;
          entry.img.src = '';
        } catch (e) {}
      }
    }
    _imgCache.clear();
  }

  function getBallPhysics() {
    const room = S.rendererObj && S.rendererObj.room;
    const gs = room && room.state && room.state.gameState;
    const discs = gs && gs.physicsState && gs.physicsState.discs;
    return discs && discs[0] ? discs[0] : null;
  }

  function getBallDiscInfo() {
    const arr = S.hooks && S.hooks.getCustomDiscInfo();
    return arr && arr[0] ? arr[0] : null;
  }

  function playSound(kind) {
    const cfg = S.config.sounds[kind];
    if (cfg.mode === 'custom' && cfg.custom) {
      const key = kind + ':' + cfg.custom.slice(0, 40);
      let audio = S.customAudioCache.get(key);
      if (!audio) {
        audio = new Audio(cfg.custom);
        audio.volume = 0.5;
        S.customAudioCache.set(key, audio);
      }
      try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (e) {}
      return true;
    }
    return false;
  }

  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < .5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // FIX: normaliza hue (acepta negativos y fuera de 360) y clampa RGB a [0,255]
  // Antes: con h<0 se generaban r/g/b > 255 → overflow en <<16 → canales cruzados.
  function hslToRgbNum(h, s, l) {
    const hn = ((h % 360) + 360) % 360;
    const sn = Math.max(0, Math.min(1, s));
    const ln = Math.max(0, Math.min(1, l));
    const c = hslToRgb(hn / 360, sn, ln);
    const r = Math.max(0, Math.min(255, c[0]));
    const g = Math.max(0, Math.min(255, c[1]));
    const b = Math.max(0, Math.min(255, c[2]));
    return (r << 16) + (g << 8) + b;
  }

  // ============================================================
  // PELOTA
  // ============================================================

  function resolveBallTexture() {
    const ball = S.config.ball;
    if (ball.mode === 'none') return null;

    if (ball.mode === 'custom') {
      if (!ball.custom) return null;
      return textureFromDataUrl(ball.custom);
    }

    if (ball.preset === 'default') return null;
    const preset = window.BCReskinPresets ? window.BCReskinPresets.getBallPreset(ball.preset) : null;
    if (!preset) return null;

    if (preset.animated && typeof preset.genFrame === 'function') {
      const PIXI = getPIXI();
      if (!PIXI) return null;

      const animKey = 'anim:' + ball.preset;
      if (S.ballTextureKey !== animKey) {
        S.ballAnimLastFrame = -1;
        S.ballTextureKey = animKey;
      }

      if (!S.ballAnimCanvas) {
        S.ballAnimCanvas = document.createElement('canvas');
        S.ballAnimCanvas.width = BALL_ANIM_SIZE;
        S.ballAnimCanvas.height = BALL_ANIM_SIZE;
        S.ballAnimCtx = S.ballAnimCanvas.getContext('2d');
        S.ballAnimCtx.imageSmoothingEnabled = true;
        S.ballAnimCtx.imageSmoothingQuality = 'high';
        S.ballAnimTexture = PIXI.Texture.from(S.ballAnimCanvas);
        S.ballAnimLastFrame = -1;
      }

      const now = performance.now();
      if (now - S.ballAnimLastFrame > BALL_ANIM_INTERVAL) {
        S.ballAnimLastFrame = now;
        const t = (now - S.t0) / 1000;
        try {
          preset.genFrame(t, BALL_ANIM_SIZE, S.ballAnimCanvas, S.ballAnimCtx);
          if (S.ballAnimTexture && S.ballAnimTexture.source && S.ballAnimTexture.source.update) {
            S.ballAnimTexture.source.update();
          }
        } catch (e) {
          console.warn('[customizer] ball anim frame:', e.message);
        }
      }

      return S.ballAnimTexture;
    }

    const key = 'preset:' + ball.preset;
    if (S.ballTextureKey === key && S.ballTexture) return S.ballTexture;
    const canvas = window.BCReskinPresets.generateTexture(ball.preset, 'ball', 512);
    if (!canvas) return null;
    S.ballTexture = textureFromCanvas(canvas);
    S.ballTextureKey = key;
    return S.ballTexture;
  }

  function ensureBallMask(tex) {
    const PIXI = getPIXI();
    if (!PIXI || !tex) return;

    const texW = (tex.width) || (tex.source && tex.source.width) || 512;
    const maskRadius = texW / 2;

    if (!S.ballMask) {
      S.ballMask = new PIXI.Graphics();
      S.ballMaskRadius = -1;
    }
    if (S.ballMaskRadius !== maskRadius) {
      S.ballMaskRadius = maskRadius;
      S.ballMask.clear();
      S.ballMask.circle(0, 0, maskRadius);
      S.ballMask.fill(0xffffff);
    }
  }

  function tickBall() {
    const discInfo = getBallDiscInfo();
    if (!discInfo || !discInfo.gr) return;

    const tex = resolveBallTexture();

    if (!tex) {
      if (S.ballSprite) S.ballSprite.visible = false;
      discInfo.gr.visible = true;
      return;
    }

    const stage2 = S.hooks.getStage2();
    if (!stage2) return;

    const PIXI = getPIXI();
    if (!PIXI) return;

    if (!S.ballSprite || S.ballSprite.destroyed) {
      S.ballSprite = new PIXI.Sprite(tex);
      S.ballSprite.anchor.set(0.5);
      try { tex.source.scaleMode = 'linear'; } catch (e) {}
      try { stage2.addChild(S.ballSprite); } catch (e) {}
    } else if (S.ballSprite.texture !== tex) {
      S.ballSprite.texture = tex;
      try { tex.source.scaleMode = 'linear'; } catch (e) {}
    }
    if (S.ballSprite.parent !== stage2) {
      try { stage2.addChild(S.ballSprite); } catch (e) { return; }
    }

    ensureBallMask(tex);
    if (S.ballMask) {
      if (S.ballMask.parent !== S.ballSprite) {
        try { S.ballSprite.addChild(S.ballMask); } catch (e) {}
      }
      if (S.ballSprite.mask !== S.ballMask) {
        S.ballSprite.mask = S.ballMask;
      }
    }

    const phys = getBallPhysics();
    const radius = phys ? phys.radius : 10;

    S.ballSprite.visible = true;
    S.ballSprite.x = discInfo.gr.x;
    S.ballSprite.y = discInfo.gr.y;
    // FIX: clamp del size para evitar negativo o cero
    const sizeMul = Math.max(0.1, S.config.ball.size || 1);
    const size = radius * 2 * sizeMul;
    S.ballSprite.width = size;
    S.ballSprite.height = size;

    discInfo.gr.visible = false;
  }

  // ============================================================
  // TRAIL (v3.7 — glow aditivo + highlight)
  // ============================================================

  function tickTrail() {
    const trail = S.config.trail;
    const active = trail.mode !== 'none';

    if (!active) {
      if (S.trailGlow)     { try { S.trailGlow.clear(); }     catch(e){} }
      if (S.trailGraphics) { try { S.trailGraphics.clear(); } catch(e){} }
      S.trailPoints.length = 0;
      return;
    }

    const discInfo = getBallDiscInfo();
    if (!discInfo || !discInfo.gr) return;

    const stage2 = S.hooks.getStage2();
    if (!stage2) return;

    const PIXI = getPIXI();
    if (!PIXI) return;

    // Asegurar Graphics
    if (!S.trailGlow || S.trailGlow.destroyed) {
      S.trailGlow = new PIXI.Graphics();
      try { S.trailGlow.blendMode = 'add'; } catch(e){}
      try { stage2.addChild(S.trailGlow); } catch(e){ return; }
    }
    if (!S.trailGraphics || S.trailGraphics.destroyed) {
      S.trailGraphics = new PIXI.Graphics();
      try { stage2.addChild(S.trailGraphics); } catch(e){ return; }
    }
    if (S.trailGlow.parent !== stage2)     { try { stage2.addChild(S.trailGlow); }     catch(e){} }
    if (S.trailGraphics.parent !== stage2) { try { stage2.addChild(S.trailGraphics); } catch(e){} }

    // Push punto
    const px = discInfo.gr.x;
    const py = discInfo.gr.y;

    const last = S.trailPoints[S.trailPoints.length - 1];
    if (last) {
      const dx = px - last.x, dy = py - last.y;
      if (dx * dx + dy * dy > 400 * 400) S.trailPoints.length = 0;
    }

    const maxLen = Math.max(4, Math.min(80, trail.length || 20));
    S.trailPoints.push({ x: px, y: py });
    while (S.trailPoints.length > maxLen) S.trailPoints.shift();

    if (S.trailPoints.length < 2) {
      S.trailGlow.clear();
      S.trailGraphics.clear();
      return;
    }

    // Paleta
    const preset    = trail.preset || 'cyan';
    const isRainbow = preset === 'rainbow';
    const isFire    = preset === 'fire';
    const isIce     = preset === 'ice';
    const isNeon    = preset === 'neon';
    const isPlasma  = preset === 'plasma';
    const isVoid    = preset === 'void';
    const isElectric= preset === 'electric';

    S.rainbowPhase = (S.rainbowPhase + 0.018) % 1;

    let coreColor, glowColor;
    if (isRainbow) {
      coreColor = hslToRgbNum(S.rainbowPhase * 360, 0.90, 0.62);
      glowColor = hslToRgbNum((S.rainbowPhase * 360 + 25) % 360, 1, 0.55);
    } else if (isFire) {
      const h = 25 + Math.sin(S.rainbowPhase * Math.PI * 4) * 12;
      coreColor = hslToRgbNum(h, 1, 0.58);
      glowColor = hslToRgbNum(15, 1, 0.50);
    } else if (isIce) {
      coreColor = 0xdff6ff;
      glowColor = 0x7cc7ff;
    } else if (isNeon) {
      const pulse = (Math.sin(S.rainbowPhase * Math.PI * 4) + 1) / 2;
      coreColor = hslToRgbNum(310, 1, 0.55 + pulse * 0.20);
      glowColor = hslToRgbNum(310, 1, 0.45);
    } else if (isPlasma) {
      const h = 280 + Math.sin(S.rainbowPhase * Math.PI * 2) * 35;
      coreColor = hslToRgbNum(h, 0.95, 0.68);
      glowColor = hslToRgbNum((h + 30) % 360, 1, 0.55);
    } else if (isVoid) {
      coreColor = 0x2a1a4a;
      glowColor = 0x7c3aed;
    } else if (isElectric) {
      const flicker = Math.random() < 0.15 ? 1 : 0.55 + Math.random() * 0.20;
      coreColor = hslToRgbNum(195, 1, 0.70 * flicker + 0.15);
      glowColor = hslToRgbNum(195, 1, 0.60);
    } else {
      coreColor = hexToNumber(trail.custom);
      glowColor = coreColor;
    }

    const baseW = Math.max(1, trail.width || 6);
    const pts = S.trailPoints;
    const n = pts.length;

    // Capa glow
    const glow = S.trailGlow;
    glow.clear();
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      const alpha = Math.pow(t, 2.2) * 0.32;
      const w = Math.max(1.2, baseW * 2.4 * Math.pow(t, 1.8));
      glow.moveTo(pts[i-1].x, pts[i-1].y);
      glow.lineTo(pts[i].x, pts[i].y);
      glow.stroke({ color: glowColor, width: w, alpha, cap: 'round', join: 'round' });
    }

    // Capa core
    const g = S.trailGraphics;
    g.clear();

    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      const alpha = Math.pow(t, 1.5) * 0.75;
      const w = Math.max(0.6, baseW * 0.9 * Math.pow(t, 1.3));
      g.moveTo(pts[i-1].x, pts[i-1].y);
      g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ color: coreColor, width: w, alpha, cap: 'round', join: 'round' });
    }

    // Highlight blanco (excepto void)
    if (!isVoid) {
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        const alpha = Math.pow(t, 2) * 0.55;
        const w = Math.max(0.4, baseW * 0.30 * t);
        g.moveTo(pts[i-1].x, pts[i-1].y);
        g.lineTo(pts[i].x, pts[i].y);
        g.stroke({ color: 0xffffff, width: w, alpha, cap: 'round', join: 'round' });
      }
    }
  }

  // ============================================================
  // FONDO DEL MAPA
  // ============================================================

  function resolveBgTexture() {
    const bg = S.config.bg;
    if (bg.mode === 'none') return null;
    if (bg.mode === 'custom') {
      if (!bg.custom) return null;
      return textureFromDataUrl(bg.custom);
    }
    const key = 'preset:' + bg.preset;
    if (S.bgTextureKey === key && S.bgTexture) return S.bgTexture;
    const canvas = window.BCReskinPresets
      ? window.BCReskinPresets.generateTexture(bg.preset, 'bg', 512)
      : null;
    if (!canvas) return null;
    S.bgTexture = textureFromCanvas(canvas);
    S.bgTextureKey = key;
    return S.bgTexture;
  }

  function syncDrawBackgroundFlag() {
    if (!S.rendererObj) return;
    const wantsCustomBg = S.config.bg.mode !== 'none';
    // El ambient NO debe apagar el fondo del campo. El ambient se dibuja
    // en stage[0], detrás de stage2 (donde vive el césped del renderer),
    // así que con el fondo visible el ambient solo se ve AFUERA de la
    // cancha. Solo el bg custom (que sí reemplaza el césped) apaga el
    // fondo del renderer.
    const desired = !wantsCustomBg;
    if (S.bgFlagApplied !== desired) {
      if (S.hooks && S.hooks.setDrawBackground) {
        S.hooks.setDrawBackground(desired);
      } else {
        S.rendererObj.drawBackground = desired;
      }
      S.bgFlagApplied = desired;
    }
  }

  function tickBg() {
    const tex = resolveBgTexture();

    if (!tex) {
      if (S.bgSprite) S.bgSprite.visible = false;
      return;
    }

    const room = S.rendererObj && S.rendererObj.room;
    const gs = room && room.state && room.state.gameState;
    const stadium = gs && gs.stadium;
    if (!stadium) return;

    const stage2 = S.hooks.getStage2();
    if (!stage2) return;

    const PIXI = getPIXI();
    if (!PIXI) return;

    const bgW = stadium.bgWidth || stadium.width || 420;
    const bgH = stadium.bgHeight || stadium.height || 200;

    if (!S.bgSprite || S.bgSprite.destroyed) {
      S.bgSprite = new PIXI.Sprite(tex);
      S.bgSprite.anchor.set(0.5);
      try { stage2.addChildAt(S.bgSprite, 0); } catch (e) { return; }
      // FIX: sortableChildren se setea UNA vez al crear el sprite, no cada frame
      try { stage2.sortableChildren = false; } catch(e){}
      S.bgSortableSet = true;
    } else if (S.bgSprite.texture !== tex) {
      S.bgSprite.texture = tex;
    }

    try {
      if (S.bgSprite.parent !== stage2) stage2.addChildAt(S.bgSprite, 0);
      else if (stage2.children[0] !== S.bgSprite) stage2.setChildIndex(S.bgSprite, 0);
    } catch (e) { return; }

    S.bgSprite.visible = true;
    S.bgSprite.x = 0;
    S.bgSprite.y = 0;
    S.bgSprite.width = 2 * bgW;
    S.bgSprite.height = 2 * bgH;
    S.bgSprite.alpha = S.config.bg.opacity != null ? S.config.bg.opacity : 0.5;
  }

  // ============================================================
  // AMBIENTE
  // ============================================================

  function ambientInitData(kind) {
    const counts = {
      stars: 120, particles: 60, rain: 100, void: 5,
      nebula: 6, galaxy: 300, deepspace: 200, warp: 150,
      fireflies: 40, snowfall: 80, ember: 60, bubbles: 50,
      shooting: 12, matrix_rain: 30,
    };
    const N = counts[kind] || 0;
    const data = { kind, items: [] };
    for (let i = 0; i < N; i++) {
      const item = {
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - .5) * 0.02,
        vy: (Math.random() - .5) * 0.02,
        r: Math.random() * 1.5 + 0.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.2,
        color: Math.random() < .5 ? 0xffffff : 0x7dd3fc,
      };
      if (kind === 'warp') {
        item.angle = Math.random() * Math.PI * 2;
        item.dist = Math.random();
        item.speedWarp = 0.15 + Math.random() * 0.4;
      }
      if (kind === 'galaxy') {
        item.arm = i % 3;
        item.t01 = i / N;
      }
      if (kind === 'deepspace') {
        item.layer = i % 3;
        item.r = Math.random() * 2 + 0.4;
        item.color = Math.random() < .3 ? 0x7dd3fc : (Math.random() < .5 ? 0xffe4b5 : 0xffffff);
      }
      if (kind === 'nebula') {
        item.r = 80 + Math.random() * 120;
        item.hue = Math.random() * 360;
        item.hueSpeed = (Math.random() - .5) * 0.02;
        item.pxSpeed = (Math.random() - .5) * 0.02;
        item.pySpeed = (Math.random() - .5) * 0.02;
      }
      if (kind === 'fireflies') {
        item.color = Math.random() < .5 ? 0xfde047 : 0xfacc15;
        item.r = 1 + Math.random() * 1.5;
        item.glowPhase = Math.random() * Math.PI * 2;
      }
      if (kind === 'snowfall') {
        item.r = 1 + Math.random() * 2;
        item.speed = 0.1 + Math.random() * 0.15;
        item.drift = (Math.random() - .5) * 0.1;
      }
      if (kind === 'ember') {
        item.r = 1 + Math.random() * 1.5;
        item.speed = 0.15 + Math.random() * 0.3;
        item.drift = (Math.random() - .5) * 0.15;
        item.hue = Math.random() < .5 ? 0xf97316 : 0xfbbf24;
      }
      if (kind === 'bubbles') {
        item.r = 3 + Math.random() * 8;
        item.speed = 0.1 + Math.random() * 0.2;
        item.drift = (Math.random() - .5) * 0.08;
      }
      if (kind === 'shooting') {
        item.angle = Math.PI * 0.75 + (Math.random() - .5) * 0.3;
        item.len = 100 + Math.random() * 200;
        item.speed = 0.3 + Math.random() * 0.4;
        item.delay = Math.random() * 6;
        item.duration = 1.2;
      }
      if (kind === 'matrix_rain') {
        item.speed = 0.3 + Math.random() * 0.5;
        item.offset = Math.random();
        item.chars = [];
        const chars = '01アイウエオカキクケコサシスセソタチツテト';
        for (let j = 0; j < 15; j++) item.chars.push(chars[Math.floor(Math.random() * chars.length)]);
      }
      data.items.push(item);
    }
    return data;
  }

  function ensureAmbient() {
    const stage = S.hooks.getStage();
    if (!stage) return null;
    const PIXI = getPIXI();
    if (!PIXI) return null;

    if (!S.ambientContainer || S.ambientContainer.destroyed) {
      S.ambientContainer = new PIXI.Container();
      S.ambientGfx = new PIXI.Graphics();
      S.ambientContainer.addChild(S.ambientGfx);
      try { stage.addChildAt(S.ambientContainer, 0); } catch (e) {
        try { stage.addChild(S.ambientContainer); } catch (e2) { return null; }
      }
    }
    if (S.ambientContainer.parent !== stage) {
      try { stage.addChildAt(S.ambientContainer, 0); } catch (e) { return null; }
    }
    return S.ambientContainer;
  }

  function tickAmbient(dt) {
    const amb = S.config.ambient;
    const active = amb.mode !== 'none';

    if (!active) {
      if (S.ambientContainer) S.ambientContainer.visible = false;
      return;
    }

    const container = ensureAmbient();
    if (!container) return;
    container.visible = true;

    const origin = S.hooks.getOrigin ? S.hooks.getOrigin() : { x: 0, y: 0 };
    const parallax = 0.15;
    container.x = -origin.x * parallax;
    container.y = -origin.y * parallax;

    const screen = S.rendererObj.screen || { width: 1200, height: 700 };
    const W = screen.width + 400;
    const H = screen.height + 400;

    if (!S.ambientData || S.ambientData.kind !== amb.preset) {
      S.ambientData = ambientInitData(amb.preset);
    }

    const g = S.ambientGfx;
    if (!g) return;
    g.clear();

    const intensity = Math.max(0.2, Math.min(2, amb.intensity || 1));
    const speed = Math.max(0.1, Math.min(4, amb.speed || 1));
    const time = (performance.now() - S.t0) / 1000;

    const x0 = -W / 2;
    const y0 = -H / 2;

    if (amb.preset === 'stars') {
      for (const s of S.ambientData.items) {
        const px = x0 + s.x * W + Math.sin(time * s.speed + s.phase) * 8;
        const py = y0 + s.y * H + Math.cos(time * s.speed * .7 + s.phase) * 8;
        const a = (Math.sin(time * s.speed * 1.5 + s.phase) * .5 + .5) * .9 * intensity;
        g.circle(px, py, s.r);
        g.fill({ color: s.color, alpha: a });
      }
    }
    else if (amb.preset === 'particles') {
      for (const s of S.ambientData.items) {
        let px = s.x + s.vx * time * speed;
        let py = s.y + s.vy * time * speed;
        px = ((px % 1) + 1) % 1;
        py = ((py % 1) + 1) % 1;
        const X = x0 + px * W;
        const Y = y0 + py * H;
        const a = (Math.sin(time * 2 + s.phase) * .5 + .5) * .7 * intensity;
        g.circle(X, Y, s.r * 1.5);
        g.fill({ color: s.color, alpha: a });
      }
    }
    else if (amb.preset === 'grid') {
      const spacing = 60;
      const offset = (time * 20 * speed) % spacing;
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x050a14, alpha: 1 });
      const lineColor = 0x22d3ee;
      const alpha = .22 * intensity;
      for (let x = x0 - offset; x <= x0 + W; x += spacing) {
        g.moveTo(x, y0); g.lineTo(x, y0 + H);
        g.stroke({ color: lineColor, width: 1, alpha });
      }
      for (let y = y0 - offset; y <= y0 + H; y += spacing) {
        g.moveTo(x0, y); g.lineTo(x0 + W, y);
        g.stroke({ color: lineColor, width: 1, alpha });
      }
    }
    else if (amb.preset === 'aurora') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x020617, alpha: 1 });
      const colors = [0x10b981, 0x06b6d4, 0x8b5cf6];
      for (let k = 0; k < 3; k++) {
        const color = colors[k];
        const baseY = y0 + H * (.3 + k * .12);
        for (let i = 0; i < 40; i++) {
          const t = i / 40;
          const x = x0 + t * W;
          const y = baseY + Math.sin(time * speed * .5 + i * .2 + k * 1.5) * H * .08;
          g.circle(x, y, 40 * intensity);
          g.fill({ color, alpha: .12 * intensity });
        }
      }
    }
    else if (amb.preset === 'void') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x05000a, alpha: 1 });
      const palette = [0x7c3aed, 0xec4899, 0x0ea5e9, 0xa855f7, 0xf97316];
      for (let i = 0; i < S.ambientData.items.length; i++) {
        const s = S.ambientData.items[i];
        const px = x0 + s.x * W + Math.sin(time * .3 + s.phase) * 30;
        const py = y0 + s.y * H + Math.cos(time * .25 + s.phase) * 30;
        const rr = (80 + Math.sin(time * .5 + s.phase) * 30) * intensity;
        for (let j = 6; j >= 1; j--) {
          const rj = rr * (j / 6);
          const a = (1 - j / 6) * 0.28 * intensity;
          g.circle(px, py, rj);
          g.fill({ color: palette[i % palette.length], alpha: a });
        }
      }
    }
    else if (amb.preset === 'rain') {
      for (const s of S.ambientData.items) {
        const px = x0 + s.x * W;
        const py = y0 + (((s.y + time * s.speed * .3 * speed) % 1) + 1) % 1 * H;
        const len = 12 * intensity;
        g.moveTo(px, py);
        g.lineTo(px - 3, py + len);
        g.stroke({ color: 0x7dd3fc, width: 1.2, alpha: .6 * intensity });
      }
    }
    else if (amb.preset === 'nebula') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x05000f, alpha: 1 });
      for (const s of S.ambientData.items) {
        let px = s.x + s.pxSpeed * time * speed;
        let py = s.y + s.pySpeed * time * speed;
        px = ((px % 1) + 1) % 1;
        py = ((py % 1) + 1) % 1;
        const X = x0 + px * W;
        const Y = y0 + py * H;
        const R = s.r * intensity;
        const hue = (s.hue + s.hueSpeed * time * 100) % 360;
        const hue2 = (hue + 40) % 360;
        for (let j = 10; j >= 1; j--) {
          const rj = R * (j / 10);
          const a = (1 - j / 10) * 0.18 * intensity;
          g.circle(X, Y, rj);
          g.fill({ color: hslToRgbNum(hue2, 0.7, 0.5), alpha: a });
        }
      }
    }
    else if (amb.preset === 'galaxy') {
      const cx = 0, cy = 0;
      const maxR = Math.min(W, H) * 0.45;
      for (const s of S.ambientData.items) {
        const angle = s.t01 * 4.5 + (s.arm / 3) * Math.PI * 2 + time * 0.5 * speed;
        const dist = s.t01 * maxR;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        const a = (1 - s.t01) * 0.9 * intensity;
        const sz = 1.2 + (1 - s.t01) * 1.8;
        const hue = 260 + (s.arm * 40) + Math.sin(time + s.phase) * 20;
        g.circle(x, y, sz);
        g.fill({ color: hslToRgbNum(hue, 0.85, 0.7), alpha: a });
      }
      for (let j = 6; j >= 1; j--) {
        const rj = (maxR * 0.15) * (j / 6);
        const a = (1 - j / 6) * 0.25 * intensity;
        g.circle(cx, cy, rj);
        g.fill({ color: 0xfde047, alpha: a });
      }
    }
    else if (amb.preset === 'deepspace') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x000, alpha: 1 });
      for (const s of S.ambientData.items) {
        const layer = s.layer;
        let px = s.x + Math.sin(time * 0.1 + s.phase) * 0.02;
        let py = s.y + Math.cos(time * 0.1 + s.phase) * 0.02;
        const X = x0 + px * W;
        const Y = y0 + py * H;
        const a = (Math.sin(time * s.speed + s.phase) * 0.3 + 0.7) * (1 - layer * 0.2) * intensity;
        g.circle(X, Y, s.r);
        g.fill({ color: s.color, alpha: a });
      }
    }
    else if (amb.preset === 'warp') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x000, alpha: 1 });
      const maxR = Math.sqrt(W * W + H * H) / 2;
      for (const s of S.ambientData.items) {
        s.dist += s.speedWarp * dt * speed;
        if (s.dist > 1) s.dist -= 1;
        const r0 = s.dist * maxR;
        const r1 = Math.max(0, r0 - 30 * intensity);
        const x1 = Math.cos(s.angle) * r0;
        const y1 = Math.sin(s.angle) * r0;
        const x2 = Math.cos(s.angle) * r1;
        const y2 = Math.sin(s.angle) * r1;
        const a = Math.min(1, s.dist * 1.5) * intensity;
        g.moveTo(x2, y2);
        g.lineTo(x1, y1);
        g.stroke({ color: 0xffffff, width: 1.5, alpha: a });
      }
    }
    else if (amb.preset === 'shooting') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x000, alpha: 1 });
      for (let i = 0; i < 100; i++) {
        const x = x0 + ((i * 137.5) % W);
        const y = y0 + ((i * 73.3) % H);
        g.circle(x, y, 0.8);
        g.fill({ color: 0xffffff, alpha: 0.4 * intensity });
      }
      for (const s of S.ambientData.items) {
        const cycle = ((time * s.speed + s.delay) % (s.duration + 6));
        if (cycle > s.duration) continue;
        const progress = cycle / s.duration;
        const startX = x0 + s.x * W;
        const startY = y0 + s.y * H;
        const dx = Math.cos(s.angle) * s.len * progress;
        const dy = Math.sin(s.angle) * s.len * progress;
        const a = Math.sin(progress * Math.PI) * intensity;
        const tailLen = s.len * 0.3;
        g.moveTo(startX + dx, startY + dy);
        g.lineTo(startX + dx - Math.cos(s.angle) * tailLen, startY + dy - Math.sin(s.angle) * tailLen);
        g.stroke({ color: 0xffffff, width: 2, alpha: a });
        g.circle(startX + dx, startY + dy, 3);
        g.fill({ color: 0xffffff, alpha: a });
      }
    }
    else if (amb.preset === 'fireflies') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x0a0510, alpha: 1 });
      for (const s of S.ambientData.items) {
        const px = x0 + s.x * W + Math.sin(time * s.speed * 0.5 + s.phase) * 40;
        const py = y0 + s.y * H + Math.cos(time * s.speed * 0.4 + s.phase * 1.3) * 40;
        const glow = (Math.sin(time * 1.5 + s.glowPhase) * 0.5 + 0.5);
        const R = s.r * (2 + glow * 3) * intensity;
        for (let j = 3; j >= 1; j--) {
          const rj = R * (j / 3);
          g.circle(px, py, rj);
          g.fill({ color: s.color, alpha: (1 - j / 3) * 0.5 * glow * intensity });
        }
        g.circle(px, py, s.r * 0.8);
        g.fill({ color: 0xffffff, alpha: glow * intensity });
      }
    }
    else if (amb.preset === 'snowfall') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x0c1445, alpha: 1 });
      for (const s of S.ambientData.items) {
        let py = ((s.y + time * s.speed * speed) % 1 + 1) % 1;
        const drift = Math.sin(time * 0.5 + s.phase) * s.drift;
        let px = ((s.x + drift * time * 0.1) % 1 + 1) % 1;
        const X = x0 + px * W;
        const Y = y0 + py * H;
        g.circle(X, Y, s.r);
        g.fill({ color: 0xffffff, alpha: 0.7 * intensity });
      }
    }
    else if (amb.preset === 'ember') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x1c0a0a, alpha: 1 });
      for (const s of S.ambientData.items) {
        let py = 1 - ((s.y + time * s.speed * speed) % 1 + 1) % 1;
        const drift = Math.sin(time * 0.7 + s.phase) * s.drift;
        let px = ((s.x + drift * time * 0.15) % 1 + 1) % 1;
        const X = x0 + px * W;
        const Y = y0 + py * H;
        const a = Math.sin(((py) % 1) * Math.PI) * intensity;
        for (let j = 3; j >= 1; j--) {
          const rj = s.r * (j / 3) * 2;
          g.circle(X, Y, rj);
          g.fill({ color: s.hue, alpha: (1 - j / 3) * 0.5 * a });
        }
      }
    }
    else if (amb.preset === 'bubbles') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x082f49, alpha: 1 });
      for (const s of S.ambientData.items) {
        let py = 1 - ((s.y + time * s.speed * speed) % 1 + 1) % 1;
        const drift = Math.sin(time * 0.6 + s.phase) * s.drift;
        let px = ((s.x + drift * time * 0.1) % 1 + 1) % 1;
        const X = x0 + px * W;
        const Y = y0 + py * H;
        const R = s.r * intensity;
        g.circle(X, Y, R);
        g.stroke({ color: 0xffffff, width: 1.5, alpha: 0.4 * intensity });
        g.circle(X - R * 0.3, Y - R * 0.3, R * 0.25);
        g.fill({ color: 0xffffff, alpha: 0.25 * intensity });
      }
    }
    else if (amb.preset === 'matrix_rain') {
      g.rect(x0, y0, W, H);
      g.fill({ color: 0x020c05, alpha: 1 });
      const colCount = S.ambientData.items.length;
      const colW = W / colCount;
      for (let c = 0; c < colCount; c++) {
        const s = S.ambientData.items[c];
        const offset = (time * s.speed * speed + s.offset) % 1;
        const startY = offset * H - H;
        const colX = x0 + c * colW + colW / 2;
        for (let row = 0; row < s.chars.length; row++) {
          const y = startY + row * (H / 12);
          if (y < y0 - 20 || y > y0 + H + 20) continue;
          const alpha = Math.max(0, 1 - row / 12) * intensity;
          g.rect(colX - 3, y, 6, 6);
          g.fill({ color: 0x22c55e, alpha: alpha * 0.3 });
        }
        const headY = startY;
        if (headY >= y0 - 20 && headY <= y0 + H + 20) {
          g.circle(colX, headY, 3);
          g.fill({ color: 0xdff7e0, alpha: 0.9 * intensity });
        }
      }
    }
  }

  // ============================================================
  // KICK / GOAL SOUND
  // ============================================================

  function tickKick() {
    const arr = S.hooks.getCustomDiscInfo();
    if (!arr) return;
    const playDefault = window.__bcSoundPlay;
    for (let i = 0; i < arr.length; i++) {
      const di = arr[i];
      if (!di || di.playerId == null) continue;
      const now = !!di.isKicking;
      const prev = S.prevKicking.get(di.playerId) || false;
      if (now && !prev) {
        const handled = playSound('kick');
        if (!handled && typeof playDefault === 'function') {
          try { playDefault('kick'); } catch (e) {}
        }
      }
      S.prevKicking.set(di.playerId, now);
    }
  }

  // FIX: retry si __bcSoundPlay no existe todavía.
  // Antes: solo intentaba UNA vez desde attach(); si el renderer definía
  // __bcSoundPlay después, el hook nunca se aplicaba.
  function hookGoalSound() {
    if (window.__bcSoundHooked) return;

    const orig = window.__bcSoundPlay;
    if (typeof orig !== 'function') {
      // Reintentar con backoff hasta agotar (10s)
      if (S._goalSoundTries < 20) {
        S._goalSoundTries++;
        clearTimeout(S._goalSoundTimer);
        S._goalSoundTimer = setTimeout(() => {
          if (!window.__bcSoundHooked) hookGoalSound();
        }, 500);
      }
      return;
    }

    window.__bcSoundPlay = function (name) {
      if (name === 'goal' && playSound('goal')) return;
      return orig.apply(this, arguments);
    };
    window.__bcSoundHooked = true;
    clearTimeout(S._goalSoundTimer);
    S._goalSoundTimer = null;
  }

  // ============================================================
  // AVATAR
  // ============================================================

  function applyAvatar() {
    if (!S.rendererObj) return;
    const av = S.config.avatar;
    const wants = av.mode === 'custom' && av.custom;
    const nextPath = wants ? av.custom : null;

    if (S.rendererObj.playerAvatarTexturePath === nextPath) return;
    S.rendererObj.playerAvatarTexturePath = nextPath;

    const arr = S.hooks.getCustomDiscInfo();
    const follow = S.rendererObj.followPlayerId;
    if (!arr || !follow) return;
    for (const di of arr) {
      if (di && di.playerId === follow) {
        di.texturePath = null;
        di.teamCache = null;
      }
    }
  }

  // ============================================================
  // LOOP
  // ============================================================

  let _lastTime = performance.now();

  function tick() {
    if (S.paused) {
      S.raf = null;
      return;
    }
    S.raf = requestAnimationFrame(tick);
    if (!S.attached) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - _lastTime) / 1000);
    _lastTime = now;

    syncDrawBackgroundFlag();
    try { tickBall(); }      catch (e) { console.warn('[customizer] ball:', e.message); }
    try { tickTrail(); }     catch (e) { console.warn('[customizer] trail:', e.message); }
    try { tickBg(); }        catch (e) { console.warn('[customizer] bg:', e.message); }
    try { tickAmbient(dt); } catch (e) { console.warn('[customizer] ambient:', e.message); }
    try { tickKick(); }      catch (e) { console.warn('[customizer] kick:', e.message); }
  }

  document.addEventListener('visibilitychange', () => {
    S.paused = document.hidden;
    if (!S.paused && S.attached && !S.raf) {
      _lastTime = performance.now();
      S.raf = requestAnimationFrame(tick);
    }
  });

  // ============================================================
  // APPLY / API
  // ============================================================

  function invalidateTextures() {
    if (S.ballTexture && !_isTextureInCache(S.ballTexture)) {
      try { S.ballTexture.destroy(true); } catch (e) {}
    }
    if (S.bgTexture && !_isTextureInCache(S.bgTexture)) {
      try { S.bgTexture.destroy(true); } catch (e) {}
    }
    S.ballTexture = null; S.ballTextureKey = null;
    S.bgTexture = null;   S.bgTextureKey = null;

    if (S.ballAnimTexture) { try { S.ballAnimTexture.destroy(true); } catch (e) {} }
    S.ballAnimTexture = null;
    S.ballAnimCanvas = null;
    S.ballAnimCtx = null;
    S.ballAnimLastFrame = -1;

    if (S.ballSprite) { try { S.ballSprite.destroy(); } catch (e) {} S.ballSprite = null; }
    if (S.ballMask)   { try { S.ballMask.destroy(); }   catch (e) {} S.ballMask = null; }
    S.ballMaskRadius = -1;
    if (S.bgSprite)   { try { S.bgSprite.destroy(); }   catch (e) {} S.bgSprite = null; }

    S.trailPoints.length = 0;
    if (S.trailGraphics) { try { S.trailGraphics.clear(); } catch (e) {} }
    if (S.trailGlow)     { try { S.trailGlow.clear(); }     catch (e) {} }

    if (S.ambientData) S.ambientData = null;
    if (S.ambientGfx) { try { S.ambientGfx.clear(); } catch (e) {} }
    if (S.ambientContainer) { try { S.ambientContainer.visible = false; } catch (e) {} }
  }

  function applyAll() {
    syncDrawBackgroundFlag();
    invalidateTextures();
    applyAvatar();
    saveConfig(S.config);
    if (window.BCReskinUI && window.BCReskinUI.refresh) {
      try { window.BCReskinUI.refresh(); } catch (e) {}
    }
  }

  // FIX: teardown total expuesto como API
  function destroy() {
    try {
      if (S.raf) cancelAnimationFrame(S.raf);
      S.raf = null;
      S.attached = false;

      // Cancelar reintento de hook de sonido
      clearTimeout(S._goalSoundTimer);
      S._goalSoundTimer = null;
      S._goalSoundTries = 0;

      // Destruir sprites y graphics
      if (S.ballSprite)   { try { S.ballSprite.destroy(); }   catch (e) {} S.ballSprite = null; }
      if (S.ballMask)     { try { S.ballMask.destroy(); }     catch (e) {} S.ballMask = null; }
      if (S.bgSprite)     { try { S.bgSprite.destroy(); }     catch (e) {} S.bgSprite = null; }
      if (S.trailGlow)    { try { S.trailGlow.destroy(); }    catch (e) {} S.trailGlow = null; }
      if (S.trailGraphics){ try { S.trailGraphics.destroy(); }catch (e) {} S.trailGraphics = null; }
      if (S.ambientContainer) { try { S.ambientContainer.destroy({children: true}); } catch (e) {} S.ambientContainer = null; }
      S.ambientGfx = null;

      // Texturas
      if (S.ballTexture && !_isTextureInCache(S.ballTexture)) { try { S.ballTexture.destroy(true); } catch(e){} }
      if (S.bgTexture && !_isTextureInCache(S.bgTexture)) { try { S.bgTexture.destroy(true); } catch(e){} }
      if (S.ballAnimTexture) { try { S.ballAnimTexture.destroy(true); } catch(e){} }
      S.ballTexture = null;
      S.bgTexture = null;
      S.ballAnimTexture = null;
      S.ballAnimCanvas = null;
      S.ballAnimCtx = null;

      clearImageCache();
      S.customAudioCache.clear();
      S.trailPoints.length = 0;
      S.prevKicking.clear();

      // Restaurar drawBackground
      if (S.rendererObj) {
        try { S.rendererObj.drawBackground = true; } catch(e){}
      }
      S.bgFlagApplied = null;
      S.bgSortableSet = false;

      S.rendererObj = null;
      S.hooks = null;
    } catch (e) {
      console.warn('[customizer] destroy:', e.message);
    }
  }

  const api = {
    setSection(section, patch) {
      if (!S.config[section]) return false;
      S.config[section] = { ...S.config[section], ...patch };
      applyAll();
      return true;
    },
    getSection(section) { return { ...S.config[section] }; },
    getAll() { return JSON.parse(JSON.stringify(S.config)); },
    replaceAll(cfg) { S.config = deepMerge(DEFAULT_CONFIG, cfg); applyAll(); },
    resetSection(section) {
      if (!DEFAULT_CONFIG[section]) return false;
      S.config[section] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[section]));
      applyAll();
      return true;
    },
    reset() {
      S.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      applyAll();
    },
    clearImageCache,
    destroy,
    _internal: S,
  };
  window.BCReskin = api;

  // ============================================================
  // ATTACH
  // ============================================================

  function attach(rendererObj) {
    if (S.attached) return;
    if (!rendererObj || !rendererObj.bc) {
      console.warn('[customizer] renderer sin hooks');
      return;
    }
    S.rendererObj = rendererObj;
    S.hooks = rendererObj.bc;
    S.attached = true;
    hookGoalSound();
    applyAll();
    _lastTime = performance.now();
    S.paused = document.hidden;
    if (!S.raf && !S.paused) S.raf = requestAnimationFrame(tick);
    console.log('[customizer] enganchado');
  }

  function waitForRenderer() {
    if (S.attached) return;
    const r = window.__bcRenderer;
    if (r && r.bc) { attach(r); return; }
    setTimeout(waitForRenderer, 500);
  }
  waitForRenderer();

  console.log('[customizer] v3.8 cargado (trail + hue fix + goal retry + destroy API)');
})();