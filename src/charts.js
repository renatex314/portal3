// Mini-gráficos do painel (canvas 2D): posição × tempo, gravidade ×
// profundidade, barras de energia e a "pista em U" do balanço.

import { MODELS, R_EARTH } from './physics.js';

const C = {
  grid: 'rgba(255,255,255,0.08)',
  axis: 'rgba(255,255,255,0.35)',
  text: 'rgba(255,255,255,0.6)',
  pos: '#59d0ff',
  g: '#ffc83d',
  ghost: 'rgba(255,200,61,0.28)',
  pot: '#5b8cff',
  kin: '#ff8a3d',
};

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export class Charts {
  constructor(els) {
    this.els = els;
    this.history = [];
  }

  clearHistory() {
    this.history.length = 0;
  }

  push(t, frac) {
    const last = this.history[this.history.length - 1];
    if (last && t < last.t) this.history.length = 0;
    if (!last || t - last.t > 4) this.history.push({ t, f: frac });
    if (this.history.length > 2000) this.history.shift();
  }

  drawPosition(sim) {
    const { ctx, w, h } = setup(this.els.pos);
    const pad = { l: 34, r: 8, t: 8, b: 16 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const T = sim.model.halfPeriod * 2; // janela = 1 ida e volta
    const t0 = Math.max(0, sim.t - T);
    const X = (t) => pad.l + ((t - t0) / T) * iw;
    const Y = (f) => pad.t + ih / 2 - (f * ih) / 2;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(0));
    ctx.lineTo(w - pad.r, Y(0));
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('saída', pad.l - 4, Y(1) + 4);
    ctx.fillText('centro', pad.l - 4, Y(0) + 3);
    ctx.fillText('partida', pad.l - 4, Y(-1) + 3);
    ctx.strokeStyle = C.pos;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of this.history) {
      if (p.t < t0) continue;
      const x = X(p.t);
      const y = Y(p.f);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    const fNow = sim.s / sim.L;
    ctx.lineTo(X(sim.t), Y(fNow));
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(X(sim.t), Y(fNow), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGravity(sim) {
    const { ctx, w, h } = setup(this.els.grav);
    const pad = { l: 26, r: 8, t: 8, b: 16 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    const gMax = 11;
    const X = (depthKm) => pad.l + (depthKm / 6371) * iw;
    const Y = (g) => pad.t + ih - (g / gMax) * ih;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    for (const g of [0, 5, 10]) {
      ctx.moveTo(pad.l, Y(g));
      ctx.lineTo(w - pad.r, Y(g));
    }
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (const g of [0, 5, 10]) ctx.fillText(String(g), pad.l - 5, Y(g) + 3);
    ctx.textAlign = 'left';
    ctx.fillText('superfície', pad.l + 2, h - 3);
    ctx.textAlign = 'right';
    ctx.fillText('centro', w - pad.r, h - 3);

    const curve = (model, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const depth = (i / 100) * 6371;
        const g = model.g(R_EARTH - depth * 1000);
        if (i === 0) ctx.moveTo(X(depth), Y(g));
        else ctx.lineTo(X(depth), Y(g));
      }
      ctx.stroke();
    };
    for (const m of Object.values(MODELS)) if (m !== sim.model) curve(m, C.ghost, 1.5);
    curve(sim.model, C.g, 2);
    const depthKm = Math.min(sim.depth / 1000, 6371);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(X(depthKm), Y(sim.g), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEnergy(sim) {
    const { ctx, w, h } = setup(this.els.energy);
    const { pot, kin } = sim.energy;
    const total = Math.max(pot + kin, 1e-6);
    const pw = (pot / total) * w;
    ctx.fillStyle = C.pot;
    ctx.fillRect(0, 0, pw, h);
    ctx.fillStyle = C.kin;
    ctx.fillRect(pw, 0, w - pw, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (pw > 60) {
      ctx.textAlign = 'left';
      ctx.fillText(`altura ${Math.round((pot / total) * 100)}%`, 6, h / 2);
    }
    if (w - pw > 70) {
      ctx.textAlign = 'right';
      ctx.fillText(`movimento ${Math.round((kin / total) * 100)}%`, w - 6, h / 2);
    }
  }

  drawRamp(sim) {
    const { ctx, w, h } = setup(this.els.ramp);
    const pad = 14;
    const iw = w - 2 * pad;
    const ih = h - 2 * pad;
    // perfil da pista = energia potencial ao longo do túnel (normalizada)
    const prof = (f) => {
      const r = Math.hypot(f * sim.L, sim.d);
      const U0 = sim.model.potential(sim.d);
      return (sim.model.potential(r) - U0) / (sim.model.potential(R_EARTH) - U0);
    };
    const X = (f) => pad + ((f + 1) / 2) * iw;
    const Y = (u) => pad + ih - u * ih;
    const grd = ctx.createLinearGradient(0, pad, 0, h - pad);
    grd.addColorStop(0, 'rgba(91,140,255,0.35)');
    grd.addColorStop(1, 'rgba(91,140,255,0.02)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(X(-1), Y(0));
    for (let i = 0; i <= 80; i++) {
      const f = -1 + (i / 80) * 2;
      ctx.lineTo(X(f), Y(prof(f)));
    }
    ctx.lineTo(X(1), Y(0));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const f = -1 + (i / 80) * 2;
      if (i === 0) ctx.moveTo(X(f), Y(prof(f)));
      else ctx.lineTo(X(f), Y(prof(f)));
    }
    ctx.stroke();
    // linha da energia total (constante)
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,200,61,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, Y(1));
    ctx.lineTo(w - pad, Y(1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,200,61,0.85)';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('energia total (sempre igual)', w / 2, pad - 3);
    const f = sim.s / sim.L;
    const u = prof(f);
    // a cápsula vira o T-rex passageiro, andando de skate na pista em U
    ctx.shadowColor = '#59d0ff';
    ctx.shadowBlur = 12;
    ctx.font = '20px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.save();
    ctx.translate(X(f), Y(u) + 2);
    if (sim.v > 0) ctx.scale(-1, 1); // o emoji olha para a esquerda: vira para o lado em que anda
    ctx.fillText('🦖', 0, 0);
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'alphabetic';
  }
}
