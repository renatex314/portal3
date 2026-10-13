// Mundo do jogo: caixas alinhadas aos eixos (paredes, pisos, plataformas),
// materiais (o que aceita portal e o que não aceita), volumes de perigo,
// gatilhos, portas, botões, cubos e o elevador de saída.

import * as THREE from 'three';
import { floorButton } from './models.js';

const TILE = 2; // metros por repetição de textura

function canvasTex(size, draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noiseFill(g, s, base, amp, n = 2600) {
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * amp;
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    const r = 1 + Math.random() * 3;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}

/**
 * Textura de painéis (cor + relevo). `n` placas por lado; a textura cobre
 * 4 m (repeat 0.5), então a variação de tom entre placas só se repete de 4 em 4 m.
 */
function paneled(size, n, o) {
  const t = size / n;
  const cv = document.createElement('canvas');
  const hv = document.createElement('canvas');
  cv.width = cv.height = hv.width = hv.height = size;
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  h.fillStyle = '#000';
  h.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = i * t;
      const y = j * t;
      const d = (Math.random() - 0.5) * 2 * o.vary;
      const [r, gg, b] = o.base.map((c) => Math.round(c + d));
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x, y, t, t);
      // grão do concreto/chapa e um leve degradê
      for (let k = 0; k < (t * t) / 90; k++) {
        const a = Math.random() * o.grain;
        g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
        g.fillRect(x + Math.random() * t, y + Math.random() * t, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
      }
      const gr = g.createLinearGradient(x, y, x, y + t);
      gr.addColorStop(0, 'rgba(255,255,255,0.03)');
      gr.addColorStop(1, 'rgba(0,0,0,0.04)');
      g.fillStyle = gr;
      g.fillRect(x, y, t, t);
      // relevo: placa alta com chanfro até a junta
      const gp = o.gap / 2;
      for (let k = 0; k <= o.bevel; k++) {
        const v = Math.round(255 * (k / o.bevel));
        h.fillStyle = `rgb(${v},${v},${v})`;
        h.fillRect(x + gp + k, y + gp + k, t - 2 * (gp + k), t - 2 * (gp + k));
      }
      // luz/sombra do chanfro na cor
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x + gp, y + gp, t - 2 * gp, o.bevel * 0.6);
      g.fillRect(x + gp, y + gp, o.bevel * 0.6, t - 2 * gp);
      g.fillStyle = 'rgba(0,0,0,0.09)';
      g.fillRect(x + gp, y + t - gp - o.bevel * 0.6, t - 2 * gp, o.bevel * 0.6);
      g.fillRect(x + t - gp - o.bevel * 0.6, y + gp, o.bevel * 0.6, t - 2 * gp);
      o.detail?.(g, x, y, t, h);
    }
  // juntas
  g.fillStyle = 'rgba(60,60,62,0.6)';
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * t - o.gap / 2, 0, o.gap, size);
    g.fillRect(0, i * t - o.gap / 2, size, o.gap);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = heightToNormal(hv, 1.5);
  for (const tx of [map, normal]) {
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.repeat.set(0.5, 0.5);
    tx.anisotropy = 8;
  }
  return [map, normal];
}

/** mapa de normais (espaço tangente) a partir de um mapa de altura em tons de cinza */
function heightToNormal(cv, strength) {
  const w = cv.width;
  const hgt = cv.getContext('2d').getImageData(0, 0, w, w).data;
  const out = document.createElement('canvas');
  out.width = out.height = w;
  const og = out.getContext('2d');
  const img = og.createImageData(w, w);
  const H = (x, y) => hgt[(((y + w) % w) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  og.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

let MATS = null;
export function materials() {
  if (MATS) return MATS;
  // painel branco (aceita portal): placas de concreto claro de 1 m, cada uma
  // com um tom levemente diferente, juntas fundas e cantos chanfrados
  const [white, whiteN] = paneled(1024, 4, {
    base: [220, 219, 213],
    vary: 8,
    gap: 3,
    bevel: 3,
    grain: 0.05,
    detail(g, x, y, t) {
      // marcas de fixação nos cantos de algumas placas
      if (Math.random() < 0.5) {
        g.fillStyle = 'rgba(0,0,0,0.10)';
        for (const [u, v] of [
          [14, 14],
          [t - 24, 14],
          [14, t - 24],
          [t - 24, t - 24],
        ])
          g.fillRect(x + u, y + v, 10, 10);
      }
    },
  });
  // metal escuro (não aceita portal): painéis de chapa com frisos e parafusos
  const [metal, metalN] = paneled(1024, 2, {
    base: [58, 61, 66],
    vary: 6,
    gap: 4,
    bevel: 6,
    grain: 0.09,
    detail(g, x, y, t, h) {
      // frisos horizontais e parafusos (também no relevo)
      for (const ctx of [g, h]) {
        const hm = ctx === h;
        ctx.fillStyle = hm ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.28)';
        for (let k = 1; k < 8; k++) ctx.fillRect(x + 40, y + (k * t) / 8 - 2, t - 80, 4);
        ctx.fillStyle = hm ? '#fff' : 'rgba(200,205,210,0.4)';
        for (const [u, v] of [
          [22, 22],
          [t - 22, 22],
          [22, t - 22],
          [t - 22, t - 22],
        ]) {
          ctx.beginPath();
          ctx.arc(x + u, y + v, 6, 0, 7);
          ctx.fill();
        }
      }
    },
  });
  // rocha laterítica / itabirito (não aceita portal)
  const rock = canvasTex(512, (g, s) => {
    noiseFill(g, s, '#7c3519', 0.12, 6000);
    for (let y = 0; y < s; y += 6) {
      g.fillStyle = `rgba(${Math.random() < 0.4 ? '40,38,44' : '150,60,30'},${0.15 + Math.random() * 0.25})`;
      g.fillRect(0, y + Math.sin(y) * 2, s, 2 + Math.random() * 4);
    }
  });
  // lama/rocha fundida: emissiva, animada pelo deslocamento da textura
  const magma = canvasTex(256, (g, s) => {
    noiseFill(g, s, '#ff6a10', 0.4, 5000);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(60,10,0,${0.4 + Math.random() * 0.4})`;
      g.lineWidth = 2 + Math.random() * 5;
      g.beginPath();
      let x = Math.random() * s;
      let y = Math.random() * s;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo((x += (Math.random() - 0.5) * 60), (y += (Math.random() - 0.5) * 60));
      g.stroke();
    }
  });
  const stripe = canvasTex(256, (g, s) => {
    g.fillStyle = '#f2c200';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#1a1a1a';
    for (let i = -s; i < s * 2; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 32, 0);
      g.lineTo(i + 32 - s, s);
      g.lineTo(i - s, s);
      g.fill();
    }
  });
  MATS = {
    white: { mat: new THREE.MeshStandardMaterial({ map: white, normalMap: whiteN, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.78, metalness: 0.0 }), portalable: true },
    metal: {
      mat: new THREE.MeshStandardMaterial({ map: metal, normalMap: metalN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.5, metalness: 0.6, color: 0xb8bcc4 }),
      portalable: false,
    },
    rock: { mat: new THREE.MeshStandardMaterial({ map: rock, roughness: 0.95 }), portalable: false },
    glass: {
      mat: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, depthWrite: false }),
      portalable: false,
    },
    magma: {
      mat: new THREE.MeshStandardMaterial({ map: magma, emissiveMap: magma, emissive: 0xff5a10, emissiveIntensity: 1.6, roughness: 0.6 }),
      portalable: false,
    },
    stripe: { mat: new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }), portalable: false },
  };
  return MATS;
}

/** BoxGeometry com UV em metros (a textura não estica em caixas compridas). */
function worldBoxGeo(min, max) {
  const size = new THREE.Vector3().subVectors(max, min);
  const g = new THREE.BoxGeometry(size.x, size.y, size.z);
  g.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    let u;
    let v;
    if (nx > 0.5) [u, v] = [p.getZ(i), p.getY(i)];
    else if (ny > 0.5) [u, v] = [p.getX(i), p.getZ(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv.setXY(i, u / TILE, v / TILE);
  }
  return g;
}

export function aabbOverlap(aMin, aMax, bMin, bMax, eps = 0) {
  return aMin.x < bMax.x - eps && aMax.x > bMin.x + eps && aMin.y < bMax.y - eps && aMax.y > bMin.y + eps && aMin.z < bMax.z - eps && aMax.z > bMin.z + eps;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.reset();
  }

  reset() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse?.((o) => o.geometry?.dispose?.());
    }
    this.solids = [];
    this.hazards = [];
    this.triggers = [];
    this.doors = [];
    this.buttons = [];
    this.lights = [];
    this.anim = [];
  }

  box(x0, y0, z0, x1, y1, z1, matName = 'white', opts = {}) {
    const M = materials()[matName];
    const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const mesh = new THREE.Mesh(worldBoxGeo(min, max), M.mat);
    mesh.receiveShadow = true;
    if (matName === 'glass') mesh.renderOrder = 5;
    this.group.add(mesh);
    const b = { min, max, mat: matName, portalable: M.portalable && !opts.noPortal, mesh, solid: opts.solid !== false };
    if (b.solid) this.solids.push(b);
    return b;
  }

  /** volume que mata ao tocar (com superfície visível de rocha fundida) */
  hazard(x0, y0, z0, x1, y1, z1) {
    const b = this.box(x0, y0, z0, x1, y1, z1, 'magma', { solid: false });
    this.hazards.push(b);
    const light = new THREE.PointLight(0xff6a20, 25, 18, 1.6);
    light.position.set((x0 + x1) / 2, y1 + 1.5, (z0 + z1) / 2);
    this.group.add(light);
    return b;
  }

  trigger(x0, y0, z0, x1, y1, z1, data) {
    const t = {
      min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      done: false,
      ...data,
    };
    this.triggers.push(t);
    return t;
  }

  light(x, y, z, intensity = 40, color = 0xfff4e6, dist = 30) {
    const l = new THREE.PointLight(color, intensity, dist, 1.5);
    l.position.set(x, y, z);
    this.group.add(l);
    // luminária no teto
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.35), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }));
    lamp.position.set(x, y + 0.3, z);
    this.group.add(lamp);
    return l;
  }

  /** porta que sobe quando aberta */
  door(id, x0, y0, z0, x1, y1, z1, opts = {}) {
    const b = this.box(x0, y0, z0, x1, y1, z1, opts.axis ? 'stripe' : 'metal');
    let stripe = null;
    if (!opts.axis) {
      stripe = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + 0.02, 0.25, Math.abs(z1 - z0) + 0.02), materials().stripe.mat);
      stripe.position.set((x0 + x1) / 2, Math.min(y0, y1) + 0.4, (z0 + z1) / 2);
      this.group.add(stripe);
    }
    const d = {
      id,
      box: b,
      stripe,
      open: 0,
      target: 0,
      baseMin: b.min.clone(),
      baseMax: b.max.clone(),
      axis: opts.axis ?? 'y',
      dist: opts.dist ?? Math.abs(y1 - y0) - 0.15,
      mesh: b.mesh,
    };
    this.doors.push(d);
    return d;
  }

  button(x, y, z, opens) {
    const { group: g, plate, lights } = floorButton();
    g.position.set(x, y, z);
    this.group.add(g);
    const btn = { pos: new THREE.Vector3(x, y, z), opens, pressed: false, plate, lights, group: g };
    this.buttons.push(btn);
    return btn;
  }

  /** elevador de saída (tubo de vidro iluminado) + gatilho de fim de fase */
  exitElevator(x, y, z, flipped = false) {
    const g = new THREE.Group();
    const s = flipped ? -1 : 1;
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.25, 3.2, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    tube.position.y = 1.6 * s;
    const ring = (yy) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.08, 10, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 1.2) }));
      r.rotation.x = Math.PI / 2;
      r.position.y = yy * s;
      return r;
    };
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.15, 40), materials().metal.mat);
    base.position.y = 0.075 * s;
    g.add(tube, ring(0.18), ring(3.2), base);
    const l = new THREE.PointLight(0x7dffb0, 14, 8, 1.5);
    l.position.y = 2 * s;
    g.add(l);
    g.position.set(x, y, z);
    this.group.add(g);
    this.anim.push((t) => {
      tube.material.opacity = 0.18 + Math.sin(t * 3) * 0.06;
    });
    return this.trigger(x - 1, flipped ? y - 3 : y, z - 1, x + 1, flipped ? y : y + 3, z + 1, { exit: true });
  }

  sign(x, y, z, rotY, lines, w = 3.2, h = 1.6, rotZ = 0) {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 512;
    const g = cv.getContext('2d');
    g.fillStyle = '#f3f2ee';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#1d1d1f';
    g.fillRect(0, 0, 1024, 22);
    g.fillRect(0, 490, 1024, 22);
    g.textAlign = 'left';
    lines.forEach(([txt, size, yy, color = '#1d1d1f', font = 'Arial Black, Impact, sans-serif']) => {
      g.fillStyle = color;
      g.font = `bold ${size}px ${font}`;
      g.fillText(txt, 60, yy);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x222222 }));
    m.position.set(x, y, z);
    m.rotation.set(0, rotY, rotZ);
    this.group.add(m);
    return m;
  }

  /** faixa de luz decorativa (não colide) */
  strip(x0, y0, z0, x1, y1, z1, color = 0x9fd8ff, k = 2) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }),
    );
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.group.add(m);
    return m;
  }

  /** Raio contra as caixas sólidas. Devolve a mais próxima com a normal da face atingida. */
  raycast(origin, dir, maxDist = 300, filter = null) {
    let best = null;
    for (const b of this.solids) {
      if (filter && !filter(b)) continue;
      let tmin = -Infinity;
      let tmax = Infinity;
      let axis = -1;
      let sign = 0;
      let ok = true;
      for (let i = 0; i < 3; i++) {
        const o = origin.getComponent(i);
        const d = dir.getComponent(i);
        const lo = b.min.getComponent(i);
        const hi = b.max.getComponent(i);
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            ok = false;
            break;
          }
          continue;
        }
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        let s = -1;
        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = i;
          sign = s;
        }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          ok = false;
          break;
        }
      }
      if (!ok || tmin < 0 || tmin > maxDist || axis < 0) continue;
      if (!best || tmin < best.dist) {
        const normal = new THREE.Vector3();
        normal.setComponent(axis, sign);
        best = { box: b, dist: tmin, point: origin.clone().addScaledVector(dir, tmin), normal, axis };
      }
    }
    return best;
  }

  pointInSolid(p, except = null) {
    for (const b of this.solids) {
      if (b === except) continue;
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return b;
    }
    return null;
  }

  update(t, dt) {
    for (const f of this.anim) f(t, dt);
    const magma = materials().magma.mat.map;
    magma.offset.set(t * 0.02, t * 0.013);
    materials().magma.mat.emissiveIntensity = 1.4 + Math.sin(t * 1.7) * 0.25;
    for (const d of this.doors) {
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.4);
      const off = d.open * d.dist;
      const a = d.axis;
      d.box.min[a] = d.baseMin[a] + off;
      d.box.max[a] = d.baseMax[a] + off;
      d.mesh.position[a] = off;
      if (d.stripe) d.stripe.position.y = d.baseMin.y + 0.4 + off;
    }
  }
}
