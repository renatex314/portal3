// Cenário da câmara do chefe (B01): uma sala industrial escura, no clima da
// câmara central do Portal 1 — painéis brancos de portal encaixados em paredes
// de metal escuro, pilares com luz de alerta, tubulações, passarelas, treliças
// no teto, bancos de máquinas piscando no fundo, ventiladores, a base da
// máquina no chão e cabos grossos descendo do teto até o crânio.
// Tudo aqui é só visual (não bloqueia tiro, portal nem jogador); as peças
// sólidas (paredes, painéis, chão) são montadas na fase.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** centros dos painéis de portal: nas paredes laterais (z) e na da frente (x) */
export const PANEL_Z = [-62.5, -55, -47.5, -40, -32.5, -25, -17.5];
export const PANEL_X = [-15, -7.5, 0, 7.5, 15];

const rng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export function dressHall(w, { skull, shoulders }) {
  const R = rng(1977);
  const root = new THREE.Group();
  w.group.add(root);
  const mats = {
    dark: new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.8, roughness: 0.5, envMapIntensity: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x626972, metalness: 0.85, roughness: 0.38, envMapIntensity: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x131417, metalness: 0.25, roughness: 0.65 }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.5, 0.35), toneMapped: false }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.45, 1.3), toneMapped: false }),
  };
  const geos = { dark: [], steel: [], rubber: [], amber: [], lamp: [] };
  const box = (k, x0, y0, z0, x1, y1, z1) => {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    geos[k].push(g);
  };
  const cylZ = (k, r, x, y, z0, z1, seg = 18) => geos[k].push(new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg).rotateX(Math.PI / 2).translate(x, y, (z0 + z1) / 2));
  const cylY = (k, r, x, y0, y1, z, seg = 18) => geos[k].push(new THREE.CylinderGeometry(r, r, Math.abs(y1 - y0), seg).translate(x, (y0 + y1) / 2, z));
  const ringZ = (k, r, tube, x, y, z) => geos[k].push(new THREE.TorusGeometry(r, tube, 8, 24).translate(x, y, z));

  // ---------------------------------------------------------------- paredes laterais
  const gaps = [-66.25, ...PANEL_Z.map((z) => z + 3.75)];
  for (const s of [-1, 1]) {
    const xf = 24 * s; // face interna da parede
    const xin = (d) => xf - s * d; // d metros para dentro da sala
    for (const z of gaps) {
      // pilar entre os painéis, com a luz de alerta vertical
      box('dark', xin(0), 0, z - 0.55, xin(0.7), 38, z + 0.55);
      box('amber', xin(0.7), 4, z - 0.07, xin(0.78), 30, z + 0.07);
      for (const y of [6, 14, 22, 30]) box('steel', xin(0.2), y - 0.25, z - 0.62, xin(0.82), y + 0.25, z + 0.62); // abraçadeiras
    }
    // tubulações ao longo da parede, bem em cima, com flanges
    for (const [y, r] of [
      [33.2, 0.55],
      [35.2, 0.38],
      [31.8, 0.25],
    ]) {
      cylZ('steel', r, xin(0.9), y, -72, -10);
      for (let z = -70; z < -10; z += 7.5) ringZ('dark', r + 0.12, 0.1, xin(0.9), y, z);
    }
    // vigas horizontais e a passarela
    box('dark', xin(0), 15.2, -70, xin(2.6), 15.6, -12);
    box('steel', xin(0), 15.6, -70, xin(2.6), 15.72, -12);
    for (let z = -70; z <= -12; z += 2.5) {
      box('dark', xin(2.5), 15.7, z - 0.04, xin(2.58), 16.9, z + 0.04);
      box('dark', xin(0.02), 15.2 - 1.6, z - 0.1, xin(0.1), 15.2, z + 0.1);
    }
    box('steel', xin(2.5), 16.85, -70, xin(2.58), 16.95, -12);
    box('steel', xin(2.5), 16.3, -70, xin(2.58), 16.37, -12);
    // faixa de aviso no pé da parede
    box('amber', xin(0.02), 0.25, -72, xin(0.08), 0.55, -10);
  }

  // ---------------------------------------------------------------- parede da frente (atrás do jogador)
  for (const x of [-18.75, -11.25, -3.75, 3.75, 11.25, 18.75, -22.5, 22.5]) {
    box('dark', x - 0.55, 0, -10.7, x + 0.55, 38, -10);
    box('amber', x - 0.07, 3, -10.78, x + 0.07, 26, -10.7);
  }
  for (const y of [6, 16, 26]) box('steel', -24, y - 0.2, -10.5, 24, y + 0.2, -10);

  // ---------------------------------------------------------------- teto: treliças, luzes e dutos
  for (let z = -68; z <= -12; z += 8) {
    box('dark', -24, 36.4, z - 0.3, 24, 37.2, z + 0.3);
    box('dark', -24, 34.8, z - 0.2, 24, 35.3, z + 0.2);
    for (let x = -22; x <= 22; x += 4.4) box('steel', x - 0.1, 35.3, z - 0.1, x + 0.1, 36.4, z + 0.1);
  }
  for (const x of [-12, 12]) box('lamp', x - 0.9, 34.7, -70, x + 0.9, 34.78, -12);
  cylZ('steel', 0.9, -5, 33.6, -72, -10, 24);
  cylZ('steel', 0.9, 5, 33.6, -72, -10, 24);
  for (let z = -68; z < -10; z += 8) {
    ringZ('dark', 1, 0.15, -5, 33.6, z);
    ringZ('dark', 1, 0.15, 5, 33.6, z);
  }

  // ---------------------------------------------------------------- fundo: bancos de máquinas
  const racks = [];
  for (const s of [-1, 1])
    for (let i = 0; i < 6; i++) {
      const cx = s * (6.8 + i * 3);
      box('dark', cx - 1.3, 0, -72, cx + 1.3, 13 + (i % 2) * 2, -70.8);
      box('steel', cx - 1.35, 12.6 + (i % 2) * 2, -72, cx + 1.35, 13 + (i % 2) * 2, -70.7);
      for (let c = 0; c < 5; c++) for (let r = 0; r < 18; r++) racks.push([cx - 1 + c * 0.5, 0.7 + r * 0.62, -70.78]);
    }
  const ledGeo = new THREE.BoxGeometry(0.16, 0.12, 0.06);
  const leds = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), racks.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  racks.forEach((p, i) => {
    leds.setMatrixAt(i, m4.setPosition(p[0], p[1], p[2]));
    leds.setColorAt(i, col.setRGB(0, 0, 0));
  });
  leds.frustumCulled = false;
  root.add(leds);
  // ventiladores grandes na parede do fundo
  const fans = [];
  const fanBlade = new THREE.BoxGeometry(3.6, 0.35, 0.12);
  for (const x of [-14, 14, -7, 7]) {
    const g = new THREE.Group();
    g.position.set(x, 24, -71.8);
    g.add(new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshBasicMaterial({ color: 0x050506 })));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.2, 8, 36), mats.steel);
    g.add(ring);
    const blades = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const bl = new THREE.Mesh(fanBlade, mats.dark);
      bl.rotation.z = (b * Math.PI) / 3;
      blades.add(bl);
    }
    blades.position.z = 0.12;
    g.add(blades);
    root.add(g);
    fans.push({ blades, spd: 1.2 + R() * 1.4 });
  }
  // faixa de aviso e cano vertical dos dois lados da porta
  for (const s of [-1, 1]) {
    cylY('steel', 0.45, s * 4.2, 0, 36, -71.5);
    box('amber', s * 3.6 - 0.06, 3, -71.95, s * 3.6 + 0.06, 34, -71.85);
  }

  // ---------------------------------------------------------------- chão: base da máquina, anéis, alçapões e cabos
  const floorDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.7, roughness: 0.55 }));
  floorDisc.position.set(0, 0.025, -58);
  root.add(floorDisc);
  for (const [r0, r1] of [
    [9, 9.25],
    [12, 12.15],
    [4.6, 4.75],
  ]) {
    const g = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 72).rotateX(-Math.PI / 2), mats.amber);
    g.position.set(0, 0.035, -58);
    root.add(g);
  }
  // base cilíndrica onde a coluna do chefe se apoia
  geos.steel.push(new THREE.CylinderGeometry(3.4, 3.8, 0.7, 40).translate(0, 0.35, -58.4));
  geos.dark.push(new THREE.CylinderGeometry(2.6, 3.2, 0.5, 40).translate(0, 0.95, -58.4));
  geos.amber.push(new THREE.TorusGeometry(3.45, 0.07, 6, 48).rotateX(Math.PI / 2).translate(0, 0.72, -58.4));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    geos.steel.push(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 10).translate(Math.cos(a) * 4.4, 0.8, -58.4 + Math.sin(a) * 4.4));
    geos.amber.push(new THREE.SphereGeometry(0.18, 10, 8).translate(Math.cos(a) * 4.4, 1.7, -58.4 + Math.sin(a) * 4.4));
  }
  // alçapões das torretas e faixas amarelas de aviso
  for (const x of [-8, 8]) {
    box('dark', x - 1.9, 0.01, -38 - 1.9, x + 1.9, 0.05, -38 + 1.9);
    box('amber', x - 1.9, 0.05, -38 - 1.9, x + 1.9, 0.07, -38 - 1.74);
    box('amber', x - 1.9, 0.05, -38 + 1.74, x + 1.9, 0.07, -38 + 1.9);
    box('amber', x - 1.9, 0.05, -38 - 1.9, x - 1.74, 0.07, -38 + 1.9);
    box('amber', x + 1.74, 0.05, -38 - 1.9, x + 1.9, 0.07, -38 + 1.9);
  }
  // cabos grossos no chão, da base do chefe até as paredes
  const floorCables = [];
  for (let k = 0; k < 8; k++) {
    const s = k % 2 ? 1 : -1;
    const a = new THREE.Vector3(Math.cos(k) * 3, 0.3, -58.4 + Math.sin(k) * 3);
    const mid = new THREE.Vector3(s * (7 + R() * 6), 0.3, -58 + (R() - 0.5) * 20);
    const end = new THREE.Vector3(s * 23, 0.3 + R() * 4, -64 + R() * 40);
    floorCables.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, end]), 40, 0.32 + R() * 0.12, 8, false));
  }
  geos.rubber.push(...floorCables);

  // ---------------------------------------------------------------- cabos pendurados do teto até o crânio e os ombros
  const anchors = [];
  for (let k = 0; k < 9; k++) {
    const dir = new THREE.Vector3(R() - 0.5, 0.75 + R() * 0.3, R() - 0.5).normalize();
    anchors.push(skull.clone().add(new THREE.Vector3(dir.x * 5.2, 1.2 + dir.y * 5.4, -0.8 + dir.z * 5.8)));
  }
  for (const p of shoulders) anchors.push(p.clone());
  anchors.forEach((end, k) => {
    const start = new THREE.Vector3((R() - 0.5) * 34, 38, -66 + R() * 40);
    const mid1 = start.clone().lerp(end, 0.35).add(new THREE.Vector3((R() - 0.5) * 5, -R() * 2, (R() - 0.5) * 5));
    const mid2 = start.clone().lerp(end, 0.7).add(new THREE.Vector3((R() - 0.5) * 3, 0, (R() - 0.5) * 3));
    const curve = new THREE.CatmullRomCurve3([start, mid1, mid2, end]);
    const thick = k < 9 ? 0.42 : 0.3;
    geos.rubber.push(new THREE.TubeGeometry(curve, 48, thick, 8, false));
    // anéis de metal ao longo do cabo
    const n = Math.floor(curve.getLength() / 2.2);
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const g = new THREE.TorusGeometry(thick + 0.08, 0.07, 6, 14);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
      g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      geos.steel.push(g);
    }
  });

  // ---------------------------------------------------------------- junta tudo (poucos desenhos)
  for (const k of Object.keys(geos)) {
    if (!geos[k].length) continue;
    const m = new THREE.Mesh(mergeGeometries(geos[k]), mats[k]);
    m.frustumCulled = false;
    root.add(m);
  }

  // ---------------------------------------------------------------- luzes de alerta (giratórias) e animação
  const beacons = [];
  for (const [x, z, ph] of [
    [-23, -14, 0],
    [23, -14, 2],
    [-23, -68, 4],
    [23, -68, 1],
  ]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.1, 0.2), toneMapped: false }));
    b.position.set(x, 33.6, z);
    root.add(b);
    beacons.push({ b, ph });
  }
  const ledCol = [new THREE.Color(0.2, 2.4, 0.5), new THREE.Color(2.6, 0.5, 0.2), new THREE.Color(0.3, 0.9, 2.6), new THREE.Color(0.02, 0.02, 0.02)];
  let ledT = 0;
  w.anim.push((t, dt) => {
    for (const f of fans) f.blades.rotation.z += dt * f.spd;
    for (const { b, ph } of beacons) b.material.color.setRGB(3, 1.1, 0.2).multiplyScalar(0.15 + 0.85 * Math.max(0, Math.sin(t * 3 + ph)) ** 2);
    ledT -= dt;
    if (ledT <= 0) {
      ledT = 0.18;
      for (let i = 0; i < racks.length; i += 1) {
        if (R() < 0.08) leds.setColorAt(i, ledCol[Math.floor(R() * 4)]);
      }
      leds.instanceColor.needsUpdate = true;
    }
  });
}
