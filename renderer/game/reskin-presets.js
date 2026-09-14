'use strict';

// ============================================================
// BahiaClient — Catálogo de presets para reskin
// ============================================================

(function () {

  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }

  // ============================================================
  // BASE — ESFERA CON ILUMINACIÓN
  // ============================================================

  function drawSphere(ctx, cx, cy, r, baseColor, opts) {
    opts = opts || {};
    const light = opts.light || 'rgba(255,255,255,.85)';
    const dark = opts.dark || 'rgba(0,0,0,.55)';
    const rim = opts.rim || 'rgba(255,255,255,.35)';

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = baseColor;
    ctx.fill();

    const shadowG = ctx.createRadialGradient(
      cx - r * 0.3, cy - r * 0.3, r * 0.1,
      cx + r * 0.3, cy + r * 0.3, r * 1.1
    );
    shadowG.addColorStop(0, 'rgba(0,0,0,0)');
    shadowG.addColorStop(1, dark);
    ctx.fillStyle = shadowG;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    const rimG = ctx.createRadialGradient(
      cx - r * 0.6, cy - r * 0.6, r * 0.1,
      cx - r * 0.4, cy - r * 0.4, r * 1.2
    );
    rimG.addColorStop(0, rim);
    rimG.addColorStop(0.4, 'rgba(255,255,255,0)');
    rimG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rimG;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    const hlG = ctx.createRadialGradient(
      cx - r * 0.4, cy - r * 0.4, 0,
      cx - r * 0.4, cy - r * 0.4, r * 0.55
    );
    hlG.addColorStop(0, light);
    hlG.addColorStop(0.5, 'rgba(255,255,255,.15)');
    hlG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hlG;
    ctx.beginPath(); ctx.arc(cx - r * 0.4, cy - r * 0.4, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function withCircleClip(ctx, cx, cy, r, fn) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    ctx.clip();
    fn();
    ctx.restore();
  }

  // ============================================================
  // PELOTAS ESTÁTICAS
  // ============================================================

  function ballSoccer(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#f8f8f8', { rim: 'rgba(255,255,255,.9)', dark: 'rgba(0,0,0,.5)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.fillStyle = '#111';
      const drawPent = (px, py, s, rot) => {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = rot + i * (Math.PI * 2 / 5);
          const x = px + Math.cos(a) * s;
          const y = py + Math.sin(a) * s;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
      };
      drawPent(cx, cy, r * 0.42, -Math.PI / 2);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
        drawPent(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95, r * 0.28, a + Math.PI);
      }
    });
    withCircleClip(ctx, cx, cy, r, () => {
      const g = ctx.createRadialGradient(cx - r * .4, cy - r * .4, 0, cx - r * .4, cy - r * .4, r * 1.1);
      g.addColorStop(0, 'rgba(255,255,255,.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
    return c;
  }

  function ballBasket(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#e35a1a', { rim: 'rgba(255,220,150,.7)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.strokeStyle = 'rgba(20,15,10,.85)';
      ctx.lineWidth = size * .028;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - r * 0.65, cy, r * 0.75, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + r * 0.65, cy, r * 0.75, Math.PI / 2, -Math.PI / 2, true); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.65, r * 0.75, 0, Math.PI, false); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.65, r * 0.75, 0, Math.PI, true); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    });
    return c;
  }

  function ballTennis(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#c9e04a', { rim: 'rgba(255,255,220,.85)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.strokeStyle = '#f8faf5';
      ctx.lineWidth = size * .05;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx - r * .85, cy, r * 1.15, -Math.PI * 0.38, Math.PI * 0.38); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + r * .85, cy, r * 1.15, Math.PI - Math.PI * 0.38, Math.PI + Math.PI * 0.38); ctx.stroke();
    });
    return c;
  }

  function ballPool8(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#0a0a0a', { rim: 'rgba(200,200,200,.35)', dark: 'rgba(0,0,0,.7)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath(); ctx.arc(cx, cy, r * .42, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(cx - r * .15, cy - r * .15, 0, cx, cy, r * .42);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.25)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * .42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0a0a';
      ctx.font = `900 ${Math.round(r * .55)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('8', cx, cy + r * .02);
    });
    return c;
  }

  function ballPokeball(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#d92b2b', { rim: 'rgba(255,255,255,.6)', dark: 'rgba(80,0,0,.5)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI);
      ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(0, cy, 0, cy + r);
      g.addColorStop(0, 'rgba(0,0,0,.18)');
      g.addColorStop(1, 'rgba(0,0,0,.05)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = size * .07;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath(); ctx.arc(cx, cy, r * .25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath(); ctx.arc(cx, cy, r * .16, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = size * .03;
      ctx.beginPath(); ctx.arc(cx, cy, r * .2, 0, Math.PI * 2); ctx.stroke();
    });
    return c;
  }

  function ballSmile(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#fbbf24', { rim: 'rgba(255,240,180,.95)', light: 'rgba(255,255,255,.7)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath(); ctx.arc(cx - r * .32, cy - r * .18, r * .13, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * .32, cy - r * .18, r * .13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.arc(cx - r * .35, cy - r * .22, r * .04, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * .29, cy - r * .22, r * .04, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0a0a0a';
      ctx.lineWidth = size * .055;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + r * .08, r * .48, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    });
    return c;
  }

  function ballChrome(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    const g = ctx.createRadialGradient(cx - r * .35, cy - r * .4, 0, cx, cy, r * 1.15);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, '#e2e8f0');
    g.addColorStop(0.42, '#94a3b8');
    g.addColorStop(0.7, '#334155');
    g.addColorStop(1, '#0f172a');
    ctx.fillStyle = g;
    ctx.fill();
    const band = ctx.createLinearGradient(0, cy - r * .1, 0, cy + r * .3);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(.5, 'rgba(0,0,0,.35)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const rim = ctx.createRadialGradient(cx - r * .7, cy - r * .7, 0, cx - r * .7, cy - r * .7, r);
    rim.addColorStop(0, 'rgba(255,255,255,.7)');
    rim.addColorStop(.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const h2 = ctx.createRadialGradient(cx + r * .4, cy + r * .5, 0, cx + r * .4, cy + r * .5, r * .5);
    h2.addColorStop(0, 'rgba(255,255,255,.4)');
    h2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = h2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return c;
  }

  function ballMarble(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#f5f5f4');
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.strokeStyle = 'rgba(60,60,80,.45)';
      ctx.lineWidth = size * .015;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        const y0 = Math.random() * size;
        ctx.moveTo(-10, y0);
        for (let x = 0; x <= size + 10; x += 20) {
          ctx.lineTo(x, y0 + Math.sin(x * .05 + i) * 15 + (Math.random() - .5) * 10);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(30,30,50,.6)';
      ctx.lineWidth = size * .008;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        const y0 = Math.random() * size;
        ctx.moveTo(-10, y0);
        for (let x = 0; x <= size + 10; x += 15) {
          ctx.lineTo(x, y0 + Math.sin(x * .08 + i * 2) * 8 + (Math.random() - .5) * 5);
        }
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(cx - r * .4, cy - r * .4, 0, cx - r * .4, cy - r * .4, r * 1.1);
      g.addColorStop(0, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
    return c;
  }

  function ballGold(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    const g = ctx.createRadialGradient(cx - r * .35, cy - r * .4, 0, cx, cy, r * 1.15);
    g.addColorStop(0, '#fef9c3');
    g.addColorStop(0.2, '#fde047');
    g.addColorStop(0.5, '#ca8a04');
    g.addColorStop(0.8, '#854d0e');
    g.addColorStop(1, '#422006');
    ctx.fillStyle = g;
    ctx.fill();
    const hl = ctx.createRadialGradient(cx - r * .4, cy - r * .4, 0, cx - r * .4, cy - r * .4, r * .55);
    hl.addColorStop(0, 'rgba(255,255,255,.9)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return c;
  }

  function ballIceCrystal(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    const g = ctx.createRadialGradient(cx - r * .3, cy - r * .3, 0, cx, cy, r * 1.2);
    g.addColorStop(0, '#f0f9ff');
    g.addColorStop(0.35, '#bae6fd');
    g.addColorStop(0.7, '#0284c7');
    g.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = size * .012;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
    const hl = ctx.createRadialGradient(cx - r * .45, cy - r * .45, 0, cx - r * .45, cy - r * .45, r * .5);
    hl.addColorStop(0, 'rgba(255,255,255,.85)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return c;
  }

  function ballEarth(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#0284c7', { rim: 'rgba(125,211,252,.6)', dark: 'rgba(2,6,23,.75)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const blob = (px, py, rx, ry, rot) => {
        ctx.save();
        ctx.translate(px, py); ctx.rotate(rot);
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 2; a += .15) {
          const rr = 1 + Math.sin(a * 3) * .25 + Math.cos(a * 5) * .15;
          const x = Math.cos(a) * rx * rr;
          const y = Math.sin(a) * ry * rr;
          if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const g = ctx.createLinearGradient(-rx, -ry, rx, ry);
        g.addColorStop(0, '#166534');
        g.addColorStop(1, '#14532d');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,200,140,.5)';
        ctx.lineWidth = size * .006;
        ctx.stroke();
        ctx.restore();
      };
      blob(cx - r * .3, cy - r * .3, r * .45, r * .3, .3);
      blob(cx + r * .25, cy + r * .15, r * .5, r * .35, -.2);
      blob(cx - r * .1, cy + r * .55, r * .3, r * .18, .1);
      blob(cx + r * .5, cy - r * .5, r * .22, r * .15, -.6);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * r * .85;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.ellipse(x, y, r * .15, r * .05, a, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    return c;
  }

  function ballMoon(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#d4d4d8', { rim: 'rgba(255,255,255,.6)', dark: 'rgba(50,50,60,.5)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const craters = [
        [cx - r * .3, cy - r * .25, r * .18],
        [cx + r * .28, cy + r * .12, r * .24],
        [cx - r * .15, cy + r * .4, r * .13],
        [cx + r * .42, cy - r * .35, r * .1],
        [cx - r * .5, cy + r * .1, r * .08],
        [cx + r * .1, cy - r * .5, r * .07],
      ];
      for (const [x, y, rr] of craters) {
        const g = ctx.createRadialGradient(x - rr * .3, y - rr * .3, 0, x, y, rr);
        g.addColorStop(0, 'rgba(100,100,110,.9)');
        g.addColorStop(.7, 'rgba(80,80,90,.7)');
        g.addColorStop(1, 'rgba(120,120,130,.2)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.3)';
        ctx.lineWidth = size * .008;
        ctx.beginPath(); ctx.arc(x, y, rr * .9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
    });
    return c;
  }

  function ballNeonSign(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size / 2;
    drawSphere(ctx, cx, cy, r, '#0a0a1a', { rim: 'rgba(168,85,247,.6)', dark: 'rgba(0,0,0,.85)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.shadowBlur = size * .1;
      ctx.shadowColor = '#22d3ee';
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = size * .04;
      ctx.beginPath(); ctx.arc(cx, cy, r * .78, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowColor = '#ec4899';
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = size * .035;
      ctx.beginPath(); ctx.arc(cx, cy, r * .55, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowColor = '#a855f7';
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = size * .04;
      ctx.beginPath(); ctx.arc(cx, cy, r * .28, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    });
    return c;
  }

  // ============================================================
  // PELOTAS ANIMADAS
  // ============================================================

  function animFuego(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#3a0d0d', { rim: 'rgba(255,200,100,.5)', dark: 'rgba(0,0,0,.7)' });
    withCircleClip(ctx, cx, cy, r, () => {
      for (let k = 0; k < 10; k++) {
        const baseA = (k / 10) * Math.PI * 2 + t * .8;
        const flare = r * (0.55 + Math.sin(t * 2.5 + k * 1.7) * 0.18);
        const x = cx + Math.cos(baseA) * r * .35;
        const y = cy + Math.sin(baseA) * r * .35;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, flare);
        grad.addColorStop(0, 'rgba(255,250,200,.95)');
        grad.addColorStop(.3, 'rgba(251,191,36,.85)');
        grad.addColorStop(.7, 'rgba(239,68,68,.55)');
        grad.addColorStop(1, 'rgba(120,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, flare, 0, Math.PI * 2); ctx.fill();
      }
      for (let k = 0; k < 8; k++) {
        const a = (k * 1.3 + t * 1.2);
        const rr = r * (0.5 + (k % 3) * .15);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr - (t * 15 + k * 8) % (r * 1.5);
        ctx.fillStyle = `rgba(254,240,138,${.9 - (k % 3) * .2})`;
        ctx.beginPath(); ctx.arc(x, y, size * .02, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  function animPlasma(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#0a001a', { rim: 'rgba(168,85,247,.7)', dark: 'rgba(0,0,0,.8)' });
    withCircleClip(ctx, cx, cy, r, () => {
      for (let k = 0; k < 6; k++) {
        const a = t * .6 + k * 1.05;
        const dist = r * (0.4 + Math.sin(t * 1.2 + k) * .25);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        const rr = r * (0.55 + Math.sin(t * 1.8 + k) * .12);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rr);
        const hue = (k * 60 + t * 40) % 360;
        grad.addColorStop(0, `hsla(${hue}, 100%, 70%, .95)`);
        grad.addColorStop(.4, `hsla(${(hue + 60) % 360}, 100%, 55%, .55)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      }
      const coreG = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * .35);
      coreG.addColorStop(0, 'rgba(255,255,255,.95)');
      coreG.addColorStop(.5, 'rgba(236,72,153,.7)');
      coreG.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = coreG;
      ctx.beginPath(); ctx.arc(cx, cy, r * .35, 0, Math.PI * 2); ctx.fill();
    });
  }

  function animGalaxy(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#05000f', { rim: 'rgba(167,139,250,.5)', dark: 'rgba(0,0,0,.9)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const arms = 3;
      const stars = 120;
      for (let i = 0; i < stars; i++) {
        const arm = i % arms;
        const t01 = i / stars;
        const angle = t01 * 4.5 + (arm / arms) * Math.PI * 2 + t * .5;
        const dist = t01 * r * .9;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        const alpha = 0.4 + (1 - t01) * 0.6;
        const sz = size * (0.004 + Math.random() * 0.005);
        const hue = 260 + (arm * 30) + Math.sin(t + i) * 15;
        ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${alpha})`;
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
      }
      const coreG = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * .3);
      coreG.addColorStop(0, 'rgba(255,255,255,1)');
      coreG.addColorStop(.3, 'rgba(253,224,71,.9)');
      coreG.addColorStop(1, 'rgba(124,58,237,0)');
      ctx.fillStyle = coreG;
      ctx.beginPath(); ctx.arc(cx, cy, r * .3, 0, Math.PI * 2); ctx.fill();
      const nebG = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      nebG.addColorStop(0, 'rgba(124,58,237,.3)');
      nebG.addColorStop(.5, 'rgba(236,72,153,.15)');
      nebG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = nebG;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    });
  }

  function animLava(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#1c0503', { rim: 'rgba(251,146,60,.7)', dark: 'rgba(0,0,0,.75)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const baseG = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      baseG.addColorStop(0, 'rgba(120,20,5,.9)');
      baseG.addColorStop(.7, 'rgba(60,10,3,.6)');
      baseG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = baseG;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 14; k++) {
        const seed = k * 2.7;
        const cycle = (t * .6 + seed) % 1;
        const x = cx + Math.sin(seed * 3) * r * .7;
        const y = cy + r * .9 - cycle * r * 1.8;
        const rr = size * (0.015 + (1 - cycle) * 0.02);
        const alpha = Math.sin(cycle * Math.PI);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rr * 2.5);
        grad.addColorStop(0, `rgba(255,251,180,${alpha})`);
        grad.addColorStop(.4, `rgba(251,146,60,${alpha * .9})`);
        grad.addColorStop(1, 'rgba(220,38,38,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, rr * 2.5, 0, Math.PI * 2); ctx.fill();
      }
      for (let k = 0; k < 6; k++) {
        const a = (t * .8 + k * 1.1) % (Math.PI * 2);
        const dist = r * (.5 + Math.sin(t + k) * .2);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        ctx.fillStyle = `rgba(255,220,100,.9)`;
        ctx.beginPath(); ctx.arc(x, y, size * .012, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  function animVortex(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#000', { rim: 'rgba(34,211,238,.5)', dark: 'rgba(0,0,0,.9)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const points = 200;
      for (let i = 0; i < points; i++) {
        const t01 = i / points;
        const angle = t01 * 8 * Math.PI + t * 1.5;
        const dist = t01 * r;
        const alpha = 1 - t01;
        const hue = (t * 60 + t01 * 300) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        ctx.beginPath();
        ctx.arc(x, y, size * .015 * (1 - t01 * .7), 0, Math.PI * 2);
        ctx.fill();
      }
      const coreG = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * .25);
      coreG.addColorStop(0, 'rgba(255,255,255,1)');
      coreG.addColorStop(.4, 'rgba(34,211,238,.9)');
      coreG.addColorStop(1, 'rgba(8,145,178,0)');
      ctx.fillStyle = coreG;
      ctx.beginPath(); ctx.arc(cx, cy, r * .25, 0, Math.PI * 2); ctx.fill();
    });
  }

  function animNeonPulse(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#0a0217', { rim: 'rgba(236,72,153,.6)', dark: 'rgba(0,0,0,.85)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const hue = (t * 40) % 360;
      for (let k = 0; k < 5; k++) {
        const phase = (t * .8 + k * .5) % 1;
        const radius = phase * r * .95;
        const alpha = 1 - phase;
        const h = (hue + k * 40) % 360;
        ctx.strokeStyle = `hsla(${h}, 100%, 60%, ${alpha})`;
        ctx.lineWidth = size * .025 * (1 - phase * .5);
        ctx.shadowColor = `hsl(${h}, 100%, 60%)`;
        ctx.shadowBlur = size * .08;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
      ctx.shadowBlur = size * .15;
      ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
      ctx.beginPath(); ctx.arc(cx, cy, size * .04, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  function animMatrix(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#000', { rim: 'rgba(34,197,94,.55)', dark: 'rgba(0,0,0,.9)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const cols = 10;
      const colW = size / cols;
      const chars = '01アイウエオカキクケコサシスセソ';
      for (let c = 0; c < cols; c++) {
        const speed = 0.4 + (c % 3) * 0.3;
        const offset = (t * speed * 1.5 + c * 0.37) % 1;
        const startY = offset * size - size;
        for (let row = 0; row < 12; row++) {
          const y = startY + row * (size / 10);
          if (y < -20 || y > size + 20) continue;
          const alpha = Math.max(0, 1 - row / 12);
          const ch = chars[(c * 7 + row + Math.floor(t * 10)) % chars.length];
          ctx.fillStyle = `rgba(34,197,94,${alpha})`;
          ctx.font = `bold ${Math.round(size * .12)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(ch, c * colW + colW / 2, y);
        }
      }
      const scanY = ((t * .4) % 1) * size;
      const scanG = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
      scanG.addColorStop(0, 'rgba(34,197,94,0)');
      scanG.addColorStop(.5, 'rgba(34,197,94,.35)');
      scanG.addColorStop(1, 'rgba(34,197,94,0)');
      ctx.fillStyle = scanG;
      ctx.fillRect(0, scanY - 10, size, 20);
    });
  }

  function animSun(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#fbbf24', { rim: 'rgba(255,240,150,.95)', light: 'rgba(255,255,255,.85)' });
    withCircleClip(ctx, cx, cy, r, () => {
      const rotation = t * .8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const pulse = 0.75 + Math.sin(t * 3 + k) * 0.15;
        const len = r * pulse;
        ctx.save();
        ctx.rotate(a);
        const g = ctx.createLinearGradient(r * .3, 0, len, 0);
        g.addColorStop(0, 'rgba(255,251,180,.9)');
        g.addColorStop(1, 'rgba(251,146,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(r * .25, -r * .08);
        ctx.lineTo(len, 0);
        ctx.lineTo(r * .25, r * .08);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      const corona = ctx.createRadialGradient(cx, cy, r * .5, cx, cy, r);
      corona.addColorStop(0, 'rgba(255,240,150,0)');
      corona.addColorStop(.7, `rgba(251,146,60,${.4 + Math.sin(t * 4) * .15})`);
      corona.addColorStop(1, 'rgba(220,38,38,0)');
      ctx.fillStyle = corona;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    });
  }

  function animWater(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#0c4a6e', { rim: 'rgba(125,211,252,.7)', dark: 'rgba(2,6,23,.75)' });
    withCircleClip(ctx, cx, cy, r, () => {
      for (let k = 0; k < 4; k++) {
        const phase = (t * .5 + k * .25) % 1;
        const radius = phase * r;
        const alpha = (1 - phase) * .55;
        ctx.strokeStyle = `rgba(125,211,252,${alpha})`;
        ctx.lineWidth = size * .02;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      }
      const lg = ctx.createRadialGradient(cx - r * .4, cy - r * .4, 0, cx - r * .4, cy - r * .4, r * .6);
      lg.addColorStop(0, 'rgba(255,255,255,.55)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + t * .3;
        const dist = r * (.35 + Math.sin(t * 1.3 + k) * .15);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.beginPath();
        ctx.ellipse(x, y, size * .04, size * .012, a + t, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function animGlitch(t, size, canvas, ctx) {
    const cx = size / 2, cy = size / 2, r = size / 2;
    ctx.clearRect(0, 0, size, size);
    drawSphere(ctx, cx, cy, r, '#0a0a1e', { rim: 'rgba(236,72,153,.7)', dark: 'rgba(0,0,0,.85)' });
    withCircleClip(ctx, cx, cy, r, () => {
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const colors = ['#ff0040', '#00ff80', '#0080ff'];
        const offset = Math.sin(t * 12 + k * 2.1) * size * .03;
        ctx.fillStyle = colors[k];
        ctx.globalAlpha = .25;
        ctx.beginPath(); ctx.arc(cx + offset, cy, r * .85, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (let k = 0; k < 3; k++) {
        if (Math.random() > .4) continue;
        // FIX: h primero, luego y dentro del rango válido → getImageData
        // nunca recibe y+h > size (que tiraba IndexSizeError silencioso).
        const h = size * .05 * (1 + Math.random() * 2);
        const y = Math.random() * (size - h);
        const shift = (Math.random() - .5) * size * .2;
        try {
          const img = ctx.getImageData(0, y, size, h);
          ctx.putImageData(img, shift, y);
        } catch (e) {}
      }
      ctx.fillStyle = 'rgba(0,0,0,.15)';
      for (let y = 0; y < size; y += 3) ctx.fillRect(0, y, size, 1);
    });
  }

  // ============================================================
  // HELPERS DE CALIDAD (ruido + viñeta)
  // ============================================================

  let _noiseCanvas = null;
  function getNoiseCanvas() {
    if (_noiseCanvas) return _noiseCanvas;
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = Math.random() * 255;
      d[i] = d[i+1] = d[i+2] = n;
      d[i+3] = Math.floor(Math.random() * 28);
    }
    ctx.putImageData(img, 0, 0);
    _noiseCanvas = c;
    return c;
  }
  function applyNoise(ctx, size, strength) {
    const n = getNoiseCanvas();
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = strength != null ? strength : 0.35;
    for (let y = 0; y < size; y += 128)
      for (let x = 0; x < size; x += 128)
        ctx.drawImage(n, x, y);
    ctx.restore();
  }
  function applyVignette(ctx, size, strength) {
    const s = strength != null ? strength : 0.4;
    const g = ctx.createRadialGradient(size/2, size/2, size*0.25, size/2, size/2, size*0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${s})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // ============================================================
  // FONDOS DE MAPA
  // ============================================================

  function bgGradient(size, stops) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    stops.forEach(([off, col]) => g.addColorStop(off, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  function bgGrass(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,    '#2d5016');
    g.addColorStop(0.25, '#3a6b1f');
    g.addColorStop(0.5,  '#2f5d19');
    g.addColorStop(0.75, '#1e3d0e');
    g.addColorStop(1,    '#0e2106');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    const sun = ctx.createRadialGradient(size*0.25, -size*0.1, 0, size*0.25, -size*0.1, size*1.2);
    sun.addColorStop(0,   'rgba(180, 230, 130, 0.20)');
    sun.addColorStop(0.5, 'rgba(120, 180, 80, 0.06)');
    sun.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    const bh = size / 28;
    for (let y = 0; y < size; y += bh) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(120, 180, 80, 0.14)';
    for (let i = 0; i < 600; i++) {
      ctx.fillRect(Math.random()*size, Math.random()*size, 1, 2 + Math.random()*2);
    }
    applyNoise(ctx, size, 0.30);
    applyVignette(ctx, size, 0.40);
    return c;
  }

  function bgSnow(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,   '#eaf4ff');
    g.addColorStop(0.4, '#d4e9ff');
    g.addColorStop(0.75,'#b9d8f5');
    g.addColorStop(1,   '#8fbce0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = `rgba(255,255,255,${0.08 + k*0.03})`;
      for (let i = 0; i < 6; i++) {
        const cx = Math.random()*size;
        const cy = size*(0.05 + k*0.08) + Math.random()*size*0.1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, size*(0.12+Math.random()*0.08), size*(0.03+Math.random()*0.02), 0, 0, Math.PI*2);
        ctx.fill();
      }
    }

    for (let i = 0; i < 400; i++) {
      const r = Math.random()*1.8 + 0.3;
      ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.random()*0.5})`;
      ctx.beginPath(); ctx.arc(Math.random()*size, Math.random()*size, r, 0, Math.PI*2); ctx.fill();
    }
    applyVignette(ctx, size, 0.28);
    return c;
  }

  function bgDark(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size*0.9);
    g.addColorStop(0,   '#0e0e1a');
    g.addColorStop(0.5, '#06060d');
    g.addColorStop(1,   '#000000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 80; i++) {
      const a = Math.random()*0.35 + 0.05;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(Math.random()*size, Math.random()*size, Math.random()*1.2, 0, Math.PI*2); ctx.fill();
    }
    applyNoise(ctx, size, 0.22);
    return c;
  }

  function bgSunset(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,    '#1a0b2e');
    g.addColorStop(0.18, '#4a1a5c');
    g.addColorStop(0.38, '#8b2f5c');
    g.addColorStop(0.55, '#d94a5c');
    g.addColorStop(0.72, '#f98051');
    g.addColorStop(0.88, '#fbbf24');
    g.addColorStop(1,    '#5b1907');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    const sunY = size*0.72;
    const sunG = ctx.createRadialGradient(size*0.5, sunY, 0, size*0.5, sunY, size*0.45);
    sunG.addColorStop(0,    'rgba(255, 250, 230, 1)');
    sunG.addColorStop(0.12, 'rgba(255, 220, 140, 0.95)');
    sunG.addColorStop(0.3,  'rgba(255, 150, 80, 0.5)');
    sunG.addColorStop(0.7,  'rgba(220, 60, 40, 0.15)');
    sunG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sunG;
    ctx.beginPath(); ctx.arc(size*0.5, sunY, size*0.45, 0, Math.PI*2); ctx.fill();

    for (let i = 0; i < 14; i++) {
      const y = size*(0.05 + Math.random()*0.55);
      const x = Math.random()*size;
      const w = size*(0.15 + Math.random()*0.20);
      const h = size*(0.008 + Math.random()*0.015);
      ctx.fillStyle = `rgba(30, 10, 40, ${0.05 + Math.random()*0.15})`;
      ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI*2); ctx.fill();
    }
    applyNoise(ctx, size, 0.25);
    applyVignette(ctx, size, 0.45);
    return c;
  }

  function bgOcean(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,    '#4ec9e8');
    g.addColorStop(0.25, '#22a5d4');
    g.addColorStop(0.5,  '#0d7fb0');
    g.addColorStop(0.75, '#0a4a78');
    g.addColorStop(1,    '#041e3d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    for (let k = 0; k < 6; k++) {
      const cx = size*(0.15 + Math.random()*0.7);
      const w = size*(0.06 + Math.random()*0.10);
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0,   `rgba(200, 240, 255, ${0.10 + Math.random()*0.08})`);
      grad.addColorStop(0.6, 'rgba(200, 240, 255, 0.02)');
      grad.addColorStop(1,   'rgba(200, 240, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx - w*2, size);
      ctx.lineTo(cx + w*2, size);
      ctx.closePath();
      ctx.fill();
    }

    for (let i = 0; i < 120; i++) {
      const x = Math.random()*size;
      const y = size*0.3 + Math.random()*size*0.7;
      const r = Math.random()*2 + 0.5;
      ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random()*0.15})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    applyNoise(ctx, size, 0.28);
    applyVignette(ctx, size, 0.42);
    return c;
  }

  function bgNight(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,   '#0c1445');
    g.addColorStop(0.5, '#060824');
    g.addColorStop(1,   '#02010a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    const mw = ctx.createLinearGradient(0, 0, size, size);
    mw.addColorStop(0,   'rgba(167, 139, 250, 0)');
    mw.addColorStop(0.4, 'rgba(167, 139, 250, 0.10)');
    mw.addColorStop(0.5, 'rgba(196, 181, 253, 0.18)');
    mw.addColorStop(0.6, 'rgba(167, 139, 250, 0.10)');
    mw.addColorStop(1,   'rgba(167, 139, 250, 0)');
    ctx.fillStyle = mw; ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 250; i++) {
      const x = Math.random()*size;
      const y = Math.random()*size;
      const r = Math.pow(Math.random(), 3) * 2.2 + 0.2;
      const a = Math.random()*0.85 + 0.15;
      const hue = r > 1.4 ? `rgba(180, 210, 255, ${a})` : `rgba(255,255,255,${a})`;
      ctx.fillStyle = hue;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    applyNoise(ctx, size, 0.18);
    return c;
  }

  function bgLava(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,   '#2a0805');
    g.addColorStop(0.5, '#4a1008');
    g.addColorStop(1,   '#160402');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 22; i++) {
      const x = Math.random()*size;
      const y = Math.random()*size;
      const rr = size * (0.05 + Math.random() * 0.14);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rr);
      grad.addColorStop(0,   'rgba(255, 220, 100, 0.9)');
      grad.addColorStop(0.2, 'rgba(255, 150, 50, 0.75)');
      grad.addColorStop(0.5, 'rgba(220, 60, 30, 0.4)');
      grad.addColorStop(1,   'rgba(120, 20, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI*2); ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255, 200, 80, 0.55)';
    ctx.lineWidth = size*0.004;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      let x = Math.random()*size;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < size) {
        x += (Math.random()-0.5)*size*0.08;
        y += size*0.04;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    applyNoise(ctx, size, 0.30);
    applyVignette(ctx, size, 0.50);
    return c;
  }

  function bgSakura(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,   '#fef4fa');
    g.addColorStop(0.4, '#fce7f3');
    g.addColorStop(0.75,'#f7c7e0');
    g.addColorStop(1,   '#e8a3c9');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 90; i++) {
      const x = Math.random()*size;
      const y = Math.random()*size;
      const rr = size*(0.012 + Math.random()*0.02);
      const rot = Math.random()*Math.PI*2;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + Math.random()*0.35})`;
      for (let j = 0; j < 5; j++) {
        const a = (j/5)*Math.PI*2;
        ctx.save(); ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(rr, 0, rr*0.85, rr*0.30, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    applyVignette(ctx, size, 0.22);
    return c;
  }

  function bgCyberpunk(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,    '#050014');
    g.addColorStop(0.35, '#1a0b3e');
    g.addColorStop(0.55, '#3b0764');
    g.addColorStop(0.7,  '#7c1a6e');
    g.addColorStop(1,    '#050014');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    const horizonY = size*0.55;

    const sunG = ctx.createRadialGradient(size*0.75, horizonY*0.85, 0, size*0.75, horizonY*0.85, size*0.35);
    sunG.addColorStop(0,    'rgba(236, 72, 153, 0.85)');
    sunG.addColorStop(0.3,  'rgba(219, 39, 119, 0.55)');
    sunG.addColorStop(0.7,  'rgba(126, 34, 206, 0.20)');
    sunG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sunG;
    ctx.beginPath(); ctx.arc(size*0.75, horizonY*0.85, size*0.35, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = 1;
    for (let i = -20; i <= 20; i++) {
      ctx.beginPath();
      ctx.moveTo(size*0.5 + i*size*0.02, horizonY);
      ctx.lineTo(size*0.5 + i*size*0.35, size);
      ctx.stroke();
    }
    for (let i = 1; i <= 12; i++) {
      const t = Math.pow(i/12, 1.8);
      const y = horizonY + t*(size - horizonY);
      ctx.globalAlpha = 0.3 + (1-t)*0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(5, 0, 20, 0.85)';
    let x = 0;
    while (x < size) {
      const w = size*(0.02 + Math.random()*0.06);
      const h = size*(0.05 + Math.random()*0.15);
      ctx.fillRect(x, horizonY - h, w, h + 2);
      x += w + size*(0.003 + Math.random()*0.01);
    }

    for (let i = 0; i < 200; i++) {
      const wx = Math.random()*size;
      const wy = horizonY - Math.random()*size*0.20;
      if (wy < 0) continue;
      ctx.fillStyle = Math.random() < 0.5
        ? 'rgba(34, 211, 238, 0.55)'
        : 'rgba(236, 72, 153, 0.55)';
      ctx.fillRect(wx, wy, 1, 1);
    }
    applyNoise(ctx, size, 0.28);
    applyVignette(ctx, size, 0.55);
    return c;
  }

  function bgAurora(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,   '#020617');
    g.addColorStop(0.7, '#0a0a20');
    g.addColorStop(1,   '#050510');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random()*0.85 + 0.15})`;
      ctx.beginPath();
      ctx.arc(Math.random()*size, Math.random()*size*0.75, Math.pow(Math.random(),2)*1.4, 0, Math.PI*2);
      ctx.fill();
    }

    const colors = ['#10b981', '#06b6d4', '#8b5cf6'];
    for (let k = 0; k < 3; k++) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.45 - k*0.08;
      const color = colors[k];
      const baseY = size*(0.22 + k*0.10);
      for (let i = 0; i < 50; i++) {
        const t = i/50;
        const x = t*size;
        const y = baseY + Math.sin(t*6 + k*2)*size*0.10 + Math.sin(t*13 + k*3)*size*0.03;
        const rad = size*(0.10 + Math.sin(t*4 + k)*0.03);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }

    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.moveTo(0, size);
    let yy = size*0.85;
    for (let x = 0; x <= size; x += 8) {
      yy = size*0.85 - Math.abs(Math.sin(x*0.013)) * size*0.15 - Math.sin(x*0.04) * size*0.03;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(size, size);
    ctx.closePath(); ctx.fill();
    applyNoise(ctx, size, 0.20);
    return c;
  }

  function bgDesert(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0,    '#fde68a');
    g.addColorStop(0.3,  '#fbbf24');
    g.addColorStop(0.6,  '#f59e0b');
    g.addColorStop(0.85, '#b45309');
    g.addColorStop(1,    '#78350f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    const sunG = ctx.createRadialGradient(size*0.3, size*0.28, 0, size*0.3, size*0.28, size*0.28);
    sunG.addColorStop(0,   'rgba(255, 255, 240, 1)');
    sunG.addColorStop(0.3, 'rgba(255, 230, 160, 0.7)');
    sunG.addColorStop(0.7, 'rgba(251, 191, 36, 0.2)');
    sunG.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = sunG;
    ctx.beginPath(); ctx.arc(size*0.3, size*0.28, size*0.28, 0, Math.PI*2); ctx.fill();

    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = `rgba(120, 53, 15, ${0.15 + layer*0.10})`;
      ctx.beginPath();
      ctx.moveTo(0, size);
      for (let x = 0; x <= size; x += 6) {
        const y = size*(0.55 + layer*0.13) + Math.sin(x*0.012 + layer*2)*size*0.05 + Math.sin(x*0.03)*size*0.02;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
    }
    applyNoise(ctx, size, 0.25);
    applyVignette(ctx, size, 0.35);
    return c;
  }

  function bgMatrix(size) {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#020c05');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);

    const cols = 28;
    const colW = size/cols;
    const chars = '01アイウエオカキクケコサシスセソ';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c2 = 0; c2 < cols; c2++) {
      const headY = Math.random()*size;
      const tail = 10 + Math.floor(Math.random()*10);
      for (let r = 0; r < tail; r++) {
        const y = headY - r * colW*0.9;
        if (y < -colW || y > size + colW) continue;
        const t = 1 - r/tail;
        const alpha = t*t*0.85;
        ctx.fillStyle = r === 0
          ? `rgba(220, 255, 220, ${alpha})`
          : `rgba(34, 197, 94, ${alpha})`;
        ctx.font = `bold ${Math.round(colW*0.85)}px monospace`;
        ctx.fillText(chars[Math.floor(Math.random()*chars.length)], c2*colW + colW/2, y);
      }
    }
    applyVignette(ctx, size, 0.55);
    return c;
  }

  // ============================================================
  // CATÁLOGO
  // ============================================================

  const BALLS = [
    { id: 'default',    label: 'Por defecto',   gen: null,          preview: 'radial-gradient(circle at 35% 35%, #fff, #cbd5e1)' },
    { id: 'soccer',     label: 'Fútbol',        gen: ballSoccer,    preview: 'radial-gradient(circle at 35% 35%, #fff, #bbb)' },
    { id: 'basket',     label: 'Básquet',       gen: ballBasket,    preview: 'radial-gradient(circle at 35% 35%, #fb923c, #7c2d12)' },
    { id: 'tennis',     label: 'Tenis',         gen: ballTennis,    preview: 'radial-gradient(circle at 35% 35%, #e5f78e, #84cc16)' },
    { id: 'pool8',      label: 'Bola 8',        gen: ballPool8,     preview: 'radial-gradient(circle at 50% 50%, #fff 0 18%, #0a0a0a 19% 100%)' },
    { id: 'pokeball',   label: 'Pokébola',      gen: ballPokeball,  preview: 'linear-gradient(180deg, #ef4444 0 45%, #0a0a0a 45% 55%, #f5f5f5 55% 100%)' },
    { id: 'smile',      label: 'Carita',        gen: ballSmile,     preview: 'radial-gradient(circle at 35% 35%, #fde047, #d97706)' },
    { id: 'chrome',     label: 'Cromada',       gen: ballChrome,    preview: 'radial-gradient(circle at 35% 35%, #fff, #cbd5e1 30%, #334155 70%, #0f172a 100%)' },
    { id: 'marble',     label: 'Mármol',        gen: ballMarble,    preview: 'linear-gradient(135deg, #f5f5f4, #cbd5e1, #e5e7eb, #94a3b8)' },
    { id: 'gold',       label: 'Oro',           gen: ballGold,      preview: 'radial-gradient(circle at 35% 35%, #fef9c3, #facc15 30%, #ca8a04 70%, #422006 100%)' },
    { id: 'ice',        label: 'Cristal hielo', gen: ballIceCrystal,preview: 'radial-gradient(circle at 35% 35%, #f0f9ff, #bae6fd 30%, #0284c7 70%, #0c4a6e 100%)' },
    { id: 'earth',      label: 'Tierra',        gen: ballEarth,     preview: 'radial-gradient(circle at 50% 50%, #0ea5e9 30%, #166534 60%, #075985 100%)' },
    { id: 'moon',       label: 'Luna',          gen: ballMoon,      preview: 'radial-gradient(circle at 35% 35%, #f4f4f5, #a1a1aa 70%, #52525b 100%)' },
    { id: 'neon',       label: 'Neón',          gen: ballNeonSign,  preview: 'radial-gradient(circle at 50% 50%, #22d3ee 0 20%, #a855f7 40%, #ec4899 60%, #0a0a1a 80%)' },

    { id: 'a_fuego',    label: '✨ Fuego',      animated: true, genFrame: animFuego,    preview: 'radial-gradient(circle at 50% 50%, #fef3c7, #fb923c 30%, #dc2626 60%, #7c2d12 100%)' },
    { id: 'a_plasma',   label: '✨ Plasma',     animated: true, genFrame: animPlasma,   preview: 'radial-gradient(circle at 50% 50%, #fff, #ec4899 30%, #a855f7 60%, #0a001a 100%)' },
    { id: 'a_galaxy',   label: '✨ Galaxia',    animated: true, genFrame: animGalaxy,   preview: 'radial-gradient(circle at 50% 50%, #fff 5%, #fde047 15%, #a78bfa 45%, #05000f 100%)' },
    { id: 'a_lava',     label: '✨ Lava',       animated: true, genFrame: animLava,     preview: 'radial-gradient(circle at 50% 50%, #fef08a, #f97316 40%, #7c2d12 100%)' },
    { id: 'a_vortex',   label: '✨ Vórtice',    animated: true, genFrame: animVortex,   preview: 'conic-gradient(from 0deg, #22d3ee, #a855f7, #ec4899, #22d3ee)' },
    { id: 'a_neon',     label: '✨ Neón pulsante', animated: true, genFrame: animNeonPulse, preview: 'radial-gradient(circle at 50% 50%, #f0abfc, #a855f7 50%, #0a0217 100%)' },
    { id: 'a_matrix',   label: '✨ Matrix',     animated: true, genFrame: animMatrix,   preview: 'linear-gradient(180deg, #000, #0a1a0e, #000)' },
    { id: 'a_sun',      label: '✨ Sol',        animated: true, genFrame: animSun,      preview: 'radial-gradient(circle at 50% 50%, #fef08a, #f97316 50%, #dc2626 100%)' },
    { id: 'a_water',    label: '✨ Agua',       animated: true, genFrame: animWater,    preview: 'radial-gradient(circle at 50% 50%, #bae6fd, #0284c7 60%, #0c4a6e 100%)' },
    { id: 'a_glitch',   label: '✨ Glitch',     animated: true, genFrame: animGlitch,   preview: 'linear-gradient(45deg, #ff0040 0 33%, #00ff80 33% 66%, #0080ff 66% 100%)' },
  ];

  const BACKGROUNDS = [
    { id: 'none',       label: 'Ninguno',      gen: null,        preview: 'transparent' },
    { id: 'grass',      label: 'Césped',       gen: bgGrass,     preview: 'linear-gradient(180deg, #3a6b1f, #2f5d19 50%, #0e2106)' },
    { id: 'snow',       label: 'Nieve',        gen: bgSnow,      preview: 'linear-gradient(180deg, #eaf4ff, #8fbce0)' },
    { id: 'dark',       label: 'Oscuro',       gen: bgDark,      preview: 'linear-gradient(180deg, #0e0e1a, #000)' },
    { id: 'sunset',     label: 'Atardecer',    gen: bgSunset,    preview: 'linear-gradient(180deg, #1a0b2e, #8b2f5c 40%, #f98051 70%, #5b1907)' },
    { id: 'ocean',      label: 'Océano',       gen: bgOcean,     preview: 'linear-gradient(180deg, #4ec9e8, #0d7fb0 50%, #041e3d)' },
    { id: 'night',      label: 'Noche',        gen: bgNight,     preview: 'linear-gradient(180deg, #0c1445, #02010a)' },
    { id: 'lava',       label: 'Volcán',       gen: bgLava,      preview: 'radial-gradient(circle at 50% 50%, #fbbf24 10%, #dc2626 40%, #2a0805 100%)' },
    { id: 'sakura',     label: 'Cerezo',       gen: bgSakura,    preview: 'linear-gradient(180deg, #fef4fa, #e8a3c9)' },
    { id: 'cyberpunk',  label: 'Cyberpunk',    gen: bgCyberpunk, preview: 'linear-gradient(180deg, #050014, #7c1a6e 55%, #050014)' },
    { id: 'aurora',     label: 'Aurora',       gen: bgAurora,    preview: 'linear-gradient(180deg, #10b981, #06b6d4 30%, #8b5cf6 60%, #020617)' },
    { id: 'desert',     label: 'Desierto',     gen: bgDesert,    preview: 'linear-gradient(180deg, #fde68a, #f59e0b 50%, #78350f)' },
    { id: 'matrix',     label: 'Matrix',       gen: bgMatrix,    preview: 'linear-gradient(180deg, #020c05, #000)' },
  ];

  const TRAIL_COLORS = [
    { id: 'none',     label: 'Sin trail',   value: null },
    { id: 'cyan',     label: 'Celeste',     value: '#7dd3fc' },
    { id: 'purple',   label: 'Violeta',     value: '#a855f7' },
    { id: 'red',      label: 'Rojo',        value: '#ef4444' },
    { id: 'green',    label: 'Verde',       value: '#22c55e' },
    { id: 'gold',     label: 'Oro',         value: '#facc15' },
    { id: 'white',    label: 'Blanco',      value: '#ffffff' },
    { id: 'pink',     label: 'Rosa',        value: '#ec4899' },
    { id: 'orange',   label: 'Naranja',     value: '#f97316' },
    { id: 'shadow',   label: 'Sombra',      value: '#0a0a0a' },
    { id: 'rainbow',  label: 'Arcoíris',    value: 'rainbow' },
    { id: 'fire',     label: 'Fuego',       value: 'fire' },
    { id: 'ice',      label: 'Hielo',       value: 'ice' },
    { id: 'neon',     label: 'Neón',        value: 'neon' },
    { id: 'plasma',   label: 'Plasma',      value: 'plasma' },
    { id: 'electric', label: 'Eléctrico',   value: 'electric' },
    { id: 'void',     label: 'Vacío',       value: 'void' },
  ];

  const AMBIENTS = [
    { id: 'none',          label: 'Ninguno',           preview: 'transparent' },

    { id: 'nebula',        label: '🌌 Nebulosa',       preview: 'radial-gradient(circle at 30% 40%, #7c3aed, transparent 55%), radial-gradient(circle at 70% 60%, #06b6d4, transparent 55%), radial-gradient(circle at 50% 20%, #ec4899, transparent 55%), #05000f' },
    { id: 'galaxy',        label: '🌌 Galaxia',        preview: 'conic-gradient(from 0deg at 50% 50%, #a78bfa, #ec4899, #06b6d4, #a78bfa), #05000f' },
    { id: 'deepspace',     label: '🌌 Espacio profundo',preview: 'linear-gradient(135deg, #000, #1e1b4b 50%, #000)' },
    { id: 'warp',          label: '🚀 Hyperespacio',   preview: 'radial-gradient(circle at 50% 50%, #fff, #7dd3fc 10%, #000 40%, #000)' },
    { id: 'shooting',      label: '💫 Estrellas fugaces',preview: 'linear-gradient(135deg, #000, #0a0a1e 50%, #000), radial-gradient(circle at 70% 30%, #fff, transparent 5%)' },

    { id: 'aurora',        label: 'Aurora',            preview: 'linear-gradient(180deg, #10b981, #06b6d4 40%, #8b5cf6 70%, #0a0a1e)' },
    { id: 'stars',         label: 'Estrellas',         preview: 'radial-gradient(circle at 20% 30%, #fff 1px, transparent 2px), radial-gradient(circle at 70% 60%, #fff 1px, transparent 2px), #050510' },
    { id: 'fireflies',     label: 'Luciérnagas',       preview: 'radial-gradient(circle at 30% 40%, #fde047 2px, transparent 4px), radial-gradient(circle at 70% 60%, #facc15 2px, transparent 4px), #0a0510' },
    { id: 'snowfall',      label: 'Nieve cayendo',     preview: 'radial-gradient(circle at 30% 30%, #fff 2px, transparent 3px), radial-gradient(circle at 70% 60%, #fff 2px, transparent 3px), #0c1445' },
    { id: 'ember',         label: 'Brasas',            preview: 'radial-gradient(circle at 30% 60%, #f97316 2px, transparent 4px), radial-gradient(circle at 70% 40%, #fbbf24 2px, transparent 4px), #1c0a0a' },
    { id: 'bubbles',       label: 'Burbujas',          preview: 'radial-gradient(circle at 30% 40%, rgba(255,255,255,.5) 3px, transparent 5px), radial-gradient(circle at 70% 60%, rgba(255,255,255,.5) 3px, transparent 5px), #082f49' },
    { id: 'rain',          label: 'Lluvia',            preview: 'repeating-linear-gradient(105deg, rgba(125,211,252,.35) 0 1px, transparent 1px 8px), #050510' },

    { id: 'particles',     label: 'Partículas',        preview: 'radial-gradient(circle at 30% 40%, #7dd3fc 2px, transparent 3px), radial-gradient(circle at 70% 70%, #a855f7 2px, transparent 3px), #0a0a18' },
    { id: 'grid',          label: 'Grilla',            preview: 'repeating-linear-gradient(0deg, rgba(125,211,252,.3) 0 1px, transparent 1px 12px), repeating-linear-gradient(90deg, rgba(125,211,252,.3) 0 1px, transparent 1px 12px), #050a14' },
    { id: 'matrix_rain',   label: 'Lluvia digital',    preview: 'repeating-linear-gradient(180deg, rgba(34,197,94,.6) 0 2px, transparent 2px 10px), #020c05' },
    { id: 'void',          label: 'Vacío',             preview: 'radial-gradient(circle at 30% 40%, #7c3aed, transparent 50%), radial-gradient(circle at 70% 70%, #ec4899, transparent 50%), #05000a' },
  ];

  window.BCReskinPresets = {
    BALLS,
    BACKGROUNDS,
    TRAIL_COLORS,
    AMBIENTS,
    generateTexture(id, kind, size) {
      const list = kind === 'ball' ? BALLS : BACKGROUNDS;
      const preset = list.find(p => p.id === id);
      if (!preset) return null;
      if (preset.animated) return null;
      if (!preset.gen) return null;
      return preset.gen(size || 256);
    },
    getBallPreset(id) { return BALLS.find(p => p.id === id) || null; },
    getBgPreset(id) { return BACKGROUNDS.find(p => p.id === id) || null; },
  };

  console.log('[reskin-presets] cargado:', BALLS.length, 'bolas,', BACKGROUNDS.length, 'fondos,', AMBIENTS.length, 'ambientes,', TRAIL_COLORS.length, 'trails');
})();