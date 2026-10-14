// Texturas procedurais do laboratório (tudo desenhado em canvas na hora):
// cor + relevo (vira mapa de normais) + rugosidade. Cada superfície tem
// grão, manchas, juntas com sujeira acumulada, escorridos e arranhões, para
// que nenhuma placa pareça igual à vizinha.

import * as THREE from 'three';

const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

export function canvas(size, h = size) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = h;
  return cv;
}

/** mapa de normais (espaço tangente) a partir de um mapa de altura em tons de cinza */
export function heightToNormal(cv, strength) {
  const w = cv.width;
  const hh = cv.height;
  const hgt = cv.getContext('2d').getImageData(0, 0, w, hh).data;
  const out = canvas(w, hh);
  const og = out.getContext('2d');
  const img = og.createImageData(w, hh);
  const d = img.data;
  for (let y = 0; y < hh; y++) {
    const y0 = ((y - 1 + hh) % hh) * w;
    const y1 = ((y + 1) % hh) * w;
    const yc = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = (x - 1 + w) % w;
      const x1 = (x + 1) % w;
      const dx = ((hgt[(yc + x1) * 4] - hgt[(yc + x0) * 4]) / 255) * strength;
      const dy = ((hgt[(y1 + x) * 4] - hgt[(y0 + x) * 4]) / 255) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (yc + x) * 4;
      d[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      d[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      d[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

export function tex(cv, { srgb = true, repeat = 1, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/** pontinhos claros/escuros (poros, grão) */
export function grain(g, x, y, w, h, n, amp, size = 2.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * amp;
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    const r = 0.6 + Math.random() * size;
    g.fillRect(x + Math.random() * w, y + Math.random() * h, r, r);
  }
}

/** manchas grandes e suaves (variação de tom dentro da placa) */
function blotches(g, x, y, w, h, n, color, amp) {
  for (let i = 0; i < n; i++) {
    const cx = x + Math.random() * w;
    const cy = y + Math.random() * h;
    const r = rand(0.15, 0.5) * Math.max(w, h);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(${color},${Math.random() * amp})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  }
}

/** escorridos verticais de sujeira saindo da borda de cima */
function streaks(g, x, y, w, h, n, color, amp) {
  for (let i = 0; i < n; i++) {
    const sx = x + Math.random() * w;
    const len = rand(0.15, 0.8) * h;
    const sw = rand(1, 5);
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, `rgba(${color},${rand(0.3, 1) * amp})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(sx, y, sw, len);
  }
}

/** riscos finos em direções aleatórias */
function scratches(g, x, y, w, h, n, color, amp, maxLen = 60) {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const sx = x + Math.random() * w;
    const sy = y + Math.random() * h;
    const a = Math.random() * Math.PI * 2;
    const l = rand(6, maxLen);
    g.strokeStyle = `rgba(${color},${Math.random() * amp})`;
    g.lineWidth = rand(0.5, 1.5);
    g.beginPath();
    g.moveTo(sx, sy);
    g.quadraticCurveTo(sx + Math.cos(a + 0.3) * l * 0.5, sy + Math.sin(a + 0.3) * l * 0.5, sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    g.stroke();
  }
}

/** marcas de sola/arrasto (arcos escuros) no piso */
function scuffs(g, x, y, w, h, n, amp) {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const cx = x + Math.random() * w;
    const cy = y + Math.random() * h;
    const r = rand(8, 40);
    const a0 = Math.random() * Math.PI * 2;
    g.strokeStyle = `rgba(20,18,16,${Math.random() * amp})`;
    g.lineWidth = rand(1.5, 5);
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + rand(0.4, 1.6));
    g.stroke();
  }
}

/** escurece a borda de dentro da placa (oclusão perto da junta) */
function edgeShade(g, x, y, w, h, d, a) {
  const sides = [
    [x, y, w, d, x, y, x, y + d],
    [x, y + h - d, w, d, x, y + h, x, y + h - d],
    [x, y, d, h, x, y, x + d, y],
    [x + w - d, y, d, h, x + w, y, x + w - d, y],
  ];
  for (const [rx, ry, rw, rh, x0, y0, x1, y1] of sides) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(0,0,0,${a})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  }
}

/**
 * Grade de placas: desenha cor (g), altura (h) e rugosidade (r) de cada placa
 * com `o.panel(ctx, x, y, w, h)` e as juntas por cima.
 */
function panels(size, cols, rows, o) {
  const cv = canvas(size);
  const hv = canvas(size);
  const rv = canvas(size);
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  const r = rv.getContext('2d');
  h.fillStyle = '#000';
  h.fillRect(0, 0, size, size);
  r.fillStyle = `rgb(${o.rough},${o.rough},${o.rough})`;
  r.fillRect(0, 0, size, size);
  const pw = size / cols;
  const ph = size / rows;
  const gp = o.gap / 2;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x = i * pw;
      const y = j * ph;
      const d = (Math.random() - 0.5) * 2 * o.vary;
      const [cr, cg, cb] = o.base.map((c) => Math.round(c + d));
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.fillRect(x, y, pw, ph);
      // relevo: placa alta com chanfro até a junta
      for (let k = 0; k <= o.bevel; k++) {
        const v = Math.round(200 + 55 * (k / o.bevel));
        h.fillStyle = `rgb(${v},${v},${v})`;
        h.fillRect(x + gp + k, y + gp + k, pw - 2 * (gp + k), ph - 2 * (gp + k));
      }
      o.panel?.({ g, h, r }, x + gp, y + gp, pw - 2 * gp, ph - 2 * gp, i, j);
      // luz/sombra do chanfro na cor
      const b = o.bevel * 0.7;
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x + gp, y + gp, pw - 2 * gp, b);
      g.fillRect(x + gp, y + gp, b, ph - 2 * gp);
      g.fillStyle = 'rgba(0,0,0,0.10)';
      g.fillRect(x + gp, y + ph - gp - b, pw - 2 * gp, b);
      g.fillRect(x + pw - gp - b, y + gp, b, ph - 2 * gp);
    }
  // juntas (com sujeira acumulada) — mais rugosas
  g.fillStyle = o.seam;
  r.fillStyle = '#fff';
  for (let i = 0; i <= cols; i++) {
    g.fillRect(i * pw - gp, 0, o.gap, size);
    r.fillRect(i * pw - gp, 0, o.gap, size);
  }
  for (let j = 0; j <= rows; j++) {
    g.fillRect(0, j * ph - gp, size, o.gap);
    r.fillRect(0, j * ph - gp, size, o.gap);
  }
  o.after?.({ g, h, r }, size);
  return { cv, hv, rv };
}

function finish({ cv, hv, rv }, strength, repeat) {
  return {
    map: tex(cv, { repeat }),
    normalMap: tex(heightToNormal(hv, strength), { srgb: false, repeat }),
    roughnessMap: tex(rv, { srgb: false, repeat }),
  };
}

// ------------------------------------------------------------------ superfícies
/** painel branco de parede (aceita portal): placas de concreto claro de 1 m */
export function whiteWall() {
  return finish(
    panels(1024, 4, 4, {
      base: [222, 221, 215],
      vary: 7,
      gap: 4,
      bevel: 4,
      rough: 196,
      seam: 'rgba(70,70,72,0.75)',
      panel({ g, h, r }, x, y, w, hh) {
        blotches(g, x, y, w, hh, 5, Math.random() < 0.5 ? '0,0,0' : '255,255,250', 0.05);
        blotches(r, x, y, w, hh, 4, Math.random() < 0.5 ? '0,0,0' : '255,255,255', 0.12);
        grain(g, x, y, w, hh, 1800, 0.07);
        // poros do concreto (também no relevo)
        for (let k = 0; k < 220; k++) {
          const px = x + Math.random() * w;
          const py = y + Math.random() * hh;
          const s = rand(0.8, 2.2);
          g.fillStyle = `rgba(60,58,55,${rand(0.15, 0.4)})`;
          g.fillRect(px, py, s, s);
          h.fillStyle = 'rgba(0,0,0,0.5)';
          h.fillRect(px, py, s, s);
        }
        edgeShade(g, x, y, w, hh, 14, 0.07);
        if (Math.random() < 0.45) streaks(g, x, y, w, hh, 6, '70,64,56', 0.07);
        if (Math.random() < 0.3) scratches(g, x, y, w, hh, 6, '90,88,84', 0.25, 30);
        // marcas de fixação nos cantos de algumas placas
        if (Math.random() < 0.5)
          for (const [u, v] of [
            [16, 16],
            [w - 26, 16],
            [16, hh - 26],
            [w - 26, hh - 26],
          ]) {
            g.fillStyle = 'rgba(0,0,0,0.12)';
            g.fillRect(x + u, y + v, 10, 10);
            h.fillStyle = 'rgba(0,0,0,0.6)';
            h.fillRect(x + u, y + v, 10, 10);
          }
      },
    }),
    2.2,
    0.5,
  );
}

/** piso branco: ladrilhos de 50 cm mais cinzentos, gastos e com marcas de sola */
export function whiteFloor() {
  return finish(
    panels(1024, 8, 8, {
      base: [186, 186, 182],
      vary: 6,
      gap: 4,
      bevel: 3,
      rough: 170,
      seam: 'rgba(40,40,40,0.85)',
      panel({ g, h, r }, x, y, w, hh) {
        blotches(g, x, y, w, hh, 3, '40,36,30', 0.06);
        blotches(r, x, y, w, hh, 3, '0,0,0', 0.25); // gasto: mais liso
        grain(g, x, y, w, hh, 900, 0.08);
        for (let k = 0; k < 90; k++) {
          const px = x + Math.random() * w;
          const py = y + Math.random() * hh;
          h.fillStyle = 'rgba(0,0,0,0.4)';
          h.fillRect(px, py, 1.5, 1.5);
        }
        edgeShade(g, x, y, w, hh, 10, 0.12);
        if (Math.random() < 0.6) scuffs(g, x, y, w, hh, 4, 0.18);
        if (Math.random() < 0.5) scratches(g, x, y, w, hh, 8, '255,255,255', 0.12, 40);
      },
    }),
    1.8,
    0.5,
  );
}

/** chapa escura de parede (não aceita portal): frisos, parafusos, ferrugem, riscos */
export function metalWall() {
  return finish(
    panels(1024, 2, 2, {
      base: [62, 65, 70],
      vary: 5,
      gap: 6,
      bevel: 7,
      rough: 120,
      seam: 'rgba(10,10,12,0.8)',
      panel({ g, h, r }, x, y, w, hh) {
        grain(g, x, y, w, hh, 3500, 0.1);
        blotches(g, x, y, w, hh, 4, '0,0,0', 0.15);
        blotches(r, x, y, w, hh, 6, '255,255,255', 0.2);
        // frisos horizontais (em baixo-relevo)
        for (let k = 1; k < 8; k++) {
          const yy = y + (k * hh) / 8;
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(x + 40, yy - 3, w - 80, 6);
          g.fillStyle = 'rgba(255,255,255,0.08)';
          g.fillRect(x + 40, yy + 3, w - 80, 1.5);
          h.fillStyle = 'rgba(0,0,0,0.55)';
          h.fillRect(x + 40, yy - 3, w - 80, 6);
        }
        // parafusos com escorrido de ferrugem
        for (const [u, v] of [
          [22, 22],
          [w - 22, 22],
          [22, hh - 22],
          [w - 22, hh - 22],
          [w / 2, 22],
          [w / 2, hh - 22],
        ]) {
          const bx = x + u;
          const by = y + v;
          const gr = g.createLinearGradient(0, by, 0, by + rand(30, 90));
          gr.addColorStop(0, 'rgba(110,60,30,0.35)');
          gr.addColorStop(1, 'rgba(110,60,30,0)');
          g.fillStyle = gr;
          g.fillRect(bx - 3, by, 6, 90);
          g.fillStyle = 'rgba(25,26,28,1)';
          g.beginPath();
          g.arc(bx, by, 8, 0, 7);
          g.fill();
          g.fillStyle = 'rgba(170,175,182,0.8)';
          g.beginPath();
          g.arc(bx - 1, by - 1, 6, 0, 7);
          g.fill();
          g.strokeStyle = 'rgba(30,30,30,0.9)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(bx - 4, by);
          g.lineTo(bx + 4, by);
          g.stroke();
          h.fillStyle = '#fff';
          h.beginPath();
          h.arc(bx, by, 7, 0, 7);
          h.fill();
          r.fillStyle = 'rgba(40,40,40,1)';
          r.beginPath();
          r.arc(bx, by, 6, 0, 7);
          r.fill();
        }
        streaks(g, x, y, w, hh, 10, '20,18,16', 0.18);
        scratches(g, x, y, w, hh, 40, '200,205,215', 0.22, 70);
        scratches(r, x, y, w, hh, 40, '0,0,0', 0.5, 70);
        edgeShade(g, x, y, w, hh, 20, 0.18);
      },
    }),
    3,
    0.5,
  );
}

/** chapa de piso antiderrapante (losangos em relevo), gasta onde mais se pisa */
export function metalFloor() {
  const size = 1024;
  const cv = canvas(size);
  const hv = canvas(size);
  const rv = canvas(size);
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  const r = rv.getContext('2d');
  g.fillStyle = 'rgb(84,87,93)';
  g.fillRect(0, 0, size, size);
  grain(g, 0, 0, size, size, 9000, 0.1);
  blotches(g, 0, 0, size, size, 14, '0,0,0', 0.2);
  blotches(g, 0, 0, size, size, 8, '90,60,35', 0.12);
  h.fillStyle = 'rgb(60,60,60)';
  h.fillRect(0, 0, size, size);
  r.fillStyle = 'rgb(150,150,150)';
  r.fillRect(0, 0, size, size);
  blotches(r, 0, 0, size, size, 10, '255,255,255', 0.25);
  const S = 32; // passo (6 cm)
  for (let y = 0; y < size; y += S)
    for (let x = 0; x < size; x += S) {
      const flip = ((x + y) / S) % 2 === 0;
      for (const [ctx, style, wid] of [
        [h, '#fff', 7],
        [g, 'rgba(150,155,165,0.55)', 5],
        [r, 'rgba(60,60,60,0.9)', 5],
      ]) {
        ctx.save();
        ctx.translate(x + S / 2, y + S / 2);
        ctx.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.ellipse(0, 0, 12, wid / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  scratches(g, 0, 0, size, size, 160, '210,215,220', 0.18, 90);
  scuffs(g, 0, 0, size, size, 30, 0.2);
  // borda (a placa cobre 2 m e emenda com a vizinha)
  g.fillStyle = 'rgba(15,15,16,0.9)';
  g.fillRect(0, 0, size, 4);
  g.fillRect(0, 0, 4, size);
  h.fillStyle = '#000';
  h.fillRect(0, 0, size, 4);
  h.fillRect(0, 0, 4, size);
  return finish({ cv, hv, rv }, 2.4, 1);
}

/** teto: grelha escura de painéis acústicos */
export function ceiling() {
  return finish(
    panels(512, 4, 4, {
      base: [150, 152, 150],
      vary: 8,
      gap: 6,
      bevel: 3,
      rough: 220,
      seam: 'rgba(25,26,28,0.95)',
      panel({ g, h }, x, y, w, hh) {
        grain(g, x, y, w, hh, 500, 0.08);
        // furos de painel acústico
        for (let u = 10; u < w - 6; u += 10)
          for (let v = 10; v < hh - 6; v += 10) {
            g.fillStyle = 'rgba(0,0,0,0.18)';
            g.fillRect(x + u, y + v, 2, 2);
            h.fillStyle = 'rgba(0,0,0,0.6)';
            h.fillRect(x + u, y + v, 2, 2);
          }
        edgeShade(g, x, y, w, hh, 8, 0.15);
      },
    }),
    1.5,
    0.5,
  );
}

/** rocha laterítica / itabirito, com relevo de camadas */
export function rock() {
  const size = 512;
  const cv = canvas(size);
  const hv = canvas(size);
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  g.fillStyle = '#7c3519';
  g.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  grain(g, 0, 0, size, size, 7000, 0.14, 3);
  for (let y = 0; y < size; y += 6) {
    const dark = Math.random() < 0.4;
    const a = 0.15 + Math.random() * 0.25;
    const yy = y + Math.sin(y) * 2;
    const th = 2 + Math.random() * 4;
    g.fillStyle = `rgba(${dark ? '40,38,44' : '150,60,30'},${a})`;
    g.fillRect(0, yy, size, th);
    h.fillStyle = dark ? `rgba(0,0,0,${a * 1.5})` : `rgba(255,255,255,${a * 1.5})`;
    h.fillRect(0, yy, size, th);
  }
  grain(h, 0, 0, size, size, 9000, 0.4, 4);
  blotches(g, 0, 0, size, size, 10, '20,10,8', 0.25);
  return { map: tex(cv), normalMap: tex(heightToNormal(hv, 4), { srgb: false }) };
}

/** faixa de advertência amarela e preta, com a tinta gasta */
export function hazardStripe() {
  const size = 256;
  const cv = canvas(size);
  const g = cv.getContext('2d');
  g.fillStyle = '#f2c200';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#1a1a1a';
  for (let i = -size; i < size * 2; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 0);
    g.lineTo(i + 32 - size, size);
    g.lineTo(i - size, size);
    g.fill();
  }
  grain(g, 0, 0, size, size, 2500, 0.15);
  scratches(g, 0, 0, size, size, 50, '120,120,120', 0.6, 30);
  blotches(g, 0, 0, size, size, 6, '0,0,0', 0.2);
  return tex(cv);
}

/**
 * Porta de duas folhas (UV de 0 a 1 em cada face): chapa escura com a
 * emenda no meio, painéis rebaixados, faixa de advertência embaixo.
 */
export function doorPanel() {
  const S = 512;
  const cv = canvas(S);
  const hv = canvas(S);
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  g.fillStyle = 'rgb(70,73,79)';
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#ccc';
  h.fillRect(0, 0, S, S);
  grain(g, 0, 0, S, S, 5000, 0.1);
  for (const x0 of [0, S / 2]) {
    // painel rebaixado de cada folha
    const px = x0 + 26;
    const pw = S / 2 - 52;
    for (const [py, ph] of [
      [30, S * 0.36],
      [S * 0.36 + 50, S * 0.3],
    ]) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(px, py, pw, ph);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(px, py + ph - 3, pw, 3);
      g.fillRect(px + pw - 3, py, 3, ph);
      h.fillStyle = '#666';
      h.fillRect(px, py, pw, ph);
      // frisos
      for (let k = 1; k < 5; k++) {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(px + 14, py + (k * ph) / 5, pw - 28, 3);
        h.fillStyle = '#444';
        h.fillRect(px + 14, py + (k * ph) / 5, pw - 28, 3);
      }
    }
  }
  // emenda das folhas
  g.fillStyle = '#0c0c0e';
  g.fillRect(S / 2 - 3, 0, 6, S);
  h.fillStyle = '#000';
  h.fillRect(S / 2 - 3, 0, 6, S);
  // faixa de advertência embaixo
  const by = S * 0.8;
  g.save();
  g.beginPath();
  g.rect(0, by, S, S - by);
  g.clip();
  g.fillStyle = '#e8b800';
  g.fillRect(0, by, S, S - by);
  g.fillStyle = '#18181a';
  for (let i = -S; i < S * 2; i += 48) {
    g.beginPath();
    g.moveTo(i, by);
    g.lineTo(i + 24, by);
    g.lineTo(i + 24 - (S - by), S);
    g.lineTo(i - (S - by), S);
    g.fill();
  }
  g.restore();
  scratches(g, 0, by, S, S - by, 40, '60,60,60', 0.6, 25);
  h.fillStyle = '#eee';
  h.fillRect(0, by, S, S - by);
  scratches(g, 0, 0, S, S, 70, '200,205,215', 0.2, 50);
  streaks(g, 0, 0, S, S * 0.8, 12, '15,14,12', 0.18);
  return {
    map: tex(cv, { wrap: false }),
    normalMap: tex(heightToNormal(hv, 3), { srgb: false, wrap: false }),
  };
}

/** lama/rocha fundida: emissiva, animada pelo deslocamento da textura */
export function magma() {
  const size = 512;
  const cv = canvas(size);
  const g = cv.getContext('2d');
  g.fillStyle = '#ff6a10';
  g.fillRect(0, 0, size, size);
  blotches(g, 0, 0, size, size, 20, '255,220,120', 0.5);
  grain(g, 0, 0, size, size, 9000, 0.4, 3);
  // crosta escura rachada
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(50,8,0,${0.5 + Math.random() * 0.4})`;
    g.lineWidth = 3 + Math.random() * 9;
    g.lineJoin = 'round';
    g.beginPath();
    let x = Math.random() * size;
    let y = Math.random() * size;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo((x += (Math.random() - 0.5) * 90), (y += (Math.random() - 0.5) * 90));
    g.stroke();
  }
  return tex(cv);
}

/** regolito lunar: pó cinza com pedrinhas e crateras pequenas (aceita portal, como a rocha lunar) */
export function moonGround() {
  const size = 1024;
  const cv = canvas(size);
  const hv = canvas(size);
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  g.fillStyle = 'rgb(128,127,124)';
  g.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);
  grain(g, 0, 0, size, size, 40000, 0.14, 2.5);
  grain(h, 0, 0, size, size, 30000, 0.3, 3);
  blotches(g, 0, 0, size, size, 20, '60,60,62', 0.18);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() ** 2 * 60;
    for (const [ctx, dark, light] of [
      [g, 'rgba(50,50,50,0.4)', 'rgba(220,220,215,0.3)'],
      [h, 'rgba(0,0,0,0.6)', 'rgba(255,255,255,0.6)'],
    ]) {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = light;
      ctx.lineWidth = Math.max(1.5, r * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return { map: tex(cv, { repeat: 0.25 }), normalMap: tex(heightToNormal(hv, 3), { srgb: false, repeat: 0.25 }) };
}
