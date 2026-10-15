// Série Chefes — B01 "Sistema Nervoso": um crânio gigante, com as veias e os
// nervos à mostra, protege a saída. Ele cospe bolas de energia das têmporas, dos
// olhos e da boca. Para acalmá-lo, leve a energia dele mesmo até os três
// gânglios (nos ombros e na garganta): a cada acerto os nervos recuam, os
// olhos esfriam e, no fim, só sobra um feixe de vasos arrumado, preso por
// fitas de osso — o "sistema tranquilo". Aí a porta de trás se abre.
//
// Coordenadas em metros; o chão é y = 0; o crânio olha para +z e a saída fica
// atrás dele, em −z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { northWallWithExit } from './levels.js';
import { canvas, heightToNormal } from './textures.js';

const SK = new THREE.Vector3(0, 26, -55); // centro do crânio
const CRANIUM = { c: new THREE.Vector3(0, 1.2, -0.8), r: new THREE.Vector3(6.05, 5.65, 6.65) }; // elipsoide (local)

// gerador pseudoaleatório fixo: a fase tem sempre as mesmas veias
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ osso
function boneMaterial() {
  const S = 512;
  const cv = canvas(S);
  const g = cv.getContext('2d');
  g.fillStyle = '#e3d7ba';
  g.fillRect(0, 0, S, S);
  const R = rng(7);
  // manchas de osso velho
  for (let i = 0; i < 260; i++) {
    const x = R() * S;
    const y = R() * S;
    const r = 6 + R() * 46;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = R() < 0.6;
    gr.addColorStop(0, dark ? 'rgba(120,92,52,0.16)' : 'rgba(255,248,226,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fissuras finas
  g.strokeStyle = 'rgba(90,66,36,0.35)';
  for (let i = 0; i < 22; i++) {
    g.lineWidth = 0.6 + R() * 1.2;
    g.beginPath();
    let x = R() * S;
    let y = R() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 9; k++) {
      x += (R() - 0.5) * 40;
      y += (R() - 0.3) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // relevo: grão + as mesmas fissuras
  const hc = canvas(S);
  const h = hc.getContext('2d');
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) {
    const v = 110 + Math.floor(R() * 40);
    h.fillStyle = `rgba(${v},${v},${v},0.5)`;
    h.fillRect(R() * S, R() * S, 1 + R() * 3, 1 + R() * 3);
  }
  h.strokeStyle = 'rgba(30,30,30,0.9)';
  for (let i = 0; i < 22; i++) {
    h.lineWidth = 1 + R() * 1.5;
    h.beginPath();
    let x = R() * S;
    let y = R() * S;
    h.moveTo(x, y);
    for (let k = 0; k < 9; k++) {
      x += (R() - 0.5) * 40;
      y += (R() - 0.3) * 40;
      h.lineTo(x, y);
    }
    h.stroke();
  }
  const normal = new THREE.CanvasTexture(heightToNormal(hc, 2.2));
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, roughness: 0.82, metalness: 0, envMapIntensity: 0.35 });
}

/** cápsula entre dois pontos (osso longo) */
function limb(a, b, r, mat) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

// ------------------------------------------------------------------ veias
// Uma veia é um tubo; o vértice conhece o ponto central do tubo (aCenter), assim
// o ondular desloca a veia inteira e não só a espessura. `uv.x` é a posição ao
// longo do tubo: é por ela que a veia recua (some da ponta para a raiz), cresce
// (o feixe calmo) e pulsa.
function veinMaterial(color, U, amp, grow, retract) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uAmp: { value: amp },
      uTime: U.uTime,
      uChaos: U.uChaos,
      uRetract: retract,
      uGrow: grow,
      uFlash: U.uFlash,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter; attribute float aSeed;
      uniform float uTime, uChaos, uAmp;
      varying float vAlong; varying float vSeed; varying vec3 vN; varying vec3 vV;
      void main(){
        vAlong = uv.x; vSeed = aSeed;
        float ph = aSeed * 6.2831853;
        vec3 c = aCenter;
        vec3 off = vec3(sin(uTime * 2.1 + ph + c.y * 0.35), sin(uTime * 1.7 + ph * 1.3 + c.z * 0.3 + c.x * 0.2), cos(uTime * 2.4 + ph * 0.7 + c.x * 0.3));
        vec3 p = position + off * uAmp * uChaos * smoothstep(0.0, 0.45, uv.x);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime, uChaos, uRetract, uGrow, uFlash;
      varying float vAlong; varying float vSeed; varying vec3 vN; varying vec3 vV;
      void main(){
        float keep = uRetract >= 0.999 ? -1.0 : 1.0 - uRetract * (0.55 + 0.5 * vSeed) * 1.6;
        if (vAlong > keep || vAlong > uGrow) discard;
        vec3 n = normalize(vN);
        float lam = 0.5 + 0.5 * dot(n, normalize(vec3(0.25, 0.6, 0.75)));
        float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.5);
        float pulse = pow(0.5 + 0.5 * sin(vAlong * 38.0 - uTime * (2.5 + 7.0 * uChaos) + vSeed * 9.0), 4.0);
        vec3 col = uColor * (0.3 + 0.7 * lam) + uColor * pulse * (0.35 + 1.5 * uChaos) + uColor * rim * 0.6 + vec3(1.0, 0.95, 0.9) * uFlash * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** tubo ao longo de uma curva, com o centro de cada anel e uma semente de fase por veia */
function tube(points, radius, seed, { radial = 5, taper = (u) => 1 - 0.7 * u, perUnit = 3 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const tubular = Math.max(6, Math.round(curve.getLength() * perUnit));
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  const pos = g.attributes.position;
  const center = new Float32Array(pos.count * 3);
  const seeds = new Float32Array(pos.count).fill(seed);
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, c);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(taper(u)).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
      center.set([c.x, c.y, c.z], idx * 3);
    }
  }
  g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return g;
}

const mergeInto = (list) => (list.length ? mergeGeometries(list) : null);

// ------------------------------------------------------------------ construção do chefe
function buildBoss(w, hud) {
  const R = rng(20260115);
  const U = {
    uTime: { value: 0 },
    uChaos: { value: 1 },
    uRetract: { value: 0 },
    uGrow: { value: 0 },
    uFlash: { value: 0 },
  };
  const bone = boneMaterial();
  const dark = new THREE.MeshBasicMaterial({ color: 0x060505 });
  const boss = new THREE.Group();
  w.group.add(boss);

  // ---------------------------------------------------------------- crânio (coordenadas locais; olha para +z)
  const skull = new THREE.Group();
  skull.position.copy(SK);
  boss.add(skull);
  const cran = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), bone);
  cran.position.copy(CRANIUM.c);
  cran.scale.copy(CRANIUM.r);
  skull.add(cran);
  const maxilla = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), bone);
  maxilla.position.set(0, -3.6, 4.0);
  maxilla.scale.set(3.0, 1.9, 2.1);
  skull.add(maxilla);
  for (const s of [-1, 1]) {
    skull.add(limb(new THREE.Vector3(3.9 * s, -2.0, 2.6), new THREE.Vector3(2.9 * s, -3.4, 5.2), 0.6, bone)); // maçã do rosto
    // órbita: disco escuro com aro de osso e o olho aceso na frente
    const socket = new THREE.Mesh(new THREE.CircleGeometry(1, 40), dark);
    socket.scale.set(1.55, 1.7, 1);
    socket.position.set(2.35 * s, -0.3, 5.02);
    socket.rotation.y = 0.2 * s;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 12, 48), bone);
    rim.scale.set(1.6, 1.75, 0.75);
    rim.position.set(2.35 * s, -0.3, 5.04);
    rim.rotation.y = 0.2 * s;
    skull.add(socket, rim);
  }
  const nose = new THREE.Mesh(new THREE.CircleGeometry(1, 24), dark);
  nose.scale.set(0.75, 1.3, 1);
  nose.position.set(0, -2.9, 5.99);
  skull.add(nose);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1), toneMapped: false });
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), eyeMat);
    e.position.set(2.35 * s, -0.3, 5.1);
    skull.add(e);
    return e;
  });
  // portas das têmporas (de onde saem as bolas que vão para as paredes)
  const portMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.5, 0.3), toneMapped: false });
  for (const s of [-1, 1]) {
    const port = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.14, 10, 32), portMat);
    port.position.set(5.95 * s, 0.4, -0.5);
    port.rotation.y = Math.PI / 2;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), dark);
    hole.position.copy(port.position);
    hole.position.x += 0.02 * s;
    hole.rotation.y = (s * Math.PI) / 2;
    skull.add(port, hole);
  }
  // dentes de cima
  const toothGeo = new THREE.CapsuleGeometry(0.26, 0.62, 4, 10);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf0e6cc, roughness: 0.5, metalness: 0 });
  for (let i = -6; i <= 6; i++) {
    const x = i * 0.46;
    const t = new THREE.Mesh(toothGeo, toothMat);
    t.position.set(x, -5.0, 5.45 - 0.045 * x * x);
    t.scale.set(1, 1, 0.8);
    skull.add(t);
  }
  // mandíbula: gira em torno do eixo x que passa pelas articulações
  const jaw = new THREE.Group();
  const pivot = new THREE.Vector3(0, -2.6, 0.8);
  jaw.position.copy(pivot);
  skull.add(jaw);
  const jp = (x, y, z) => new THREE.Vector3(x, y, z).sub(pivot);
  const arc = [];
  for (const s of [-1, 1]) {
    jaw.add(limb(jp(4.3 * s, -2.5, 0.8), jp(4.2 * s, -6.0, 1.2), 0.55, bone));
  }
  arc.push(jp(-4.2, -6.0, 1.2), jp(-3.4, -6.6, 3.4), jp(-1.6, -6.9, 4.9), jp(0, -7.0, 5.3), jp(1.6, -6.9, 4.9), jp(3.4, -6.6, 3.4), jp(4.2, -6.0, 1.2));
  jaw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 40, 0.62, 12), bone));
  const chin = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), bone);
  chin.position.copy(jp(0, -6.9, 5.35));
  chin.scale.set(1.3, 0.9, 0.8);
  jaw.add(chin);
  for (let i = -6; i <= 6; i++) {
    const x = i * 0.46;
    const t = new THREE.Mesh(toothGeo, toothMat);
    t.position.copy(jp(x, -5.85, 5.05 - 0.05 * x * x));
    t.scale.set(1, 0.95, 0.8);
    jaw.add(t);
  }

  // ---------------------------------------------------------------- pescoço, ombros e costelas
  const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.6, -60), new THREE.Vector3(0, 5, -59), new THREE.Vector3(0, 10, -57.5), new THREE.Vector3(0, 15, -56.6), new THREE.Vector3(0, 20.2, -55.9)]);
  const vGeo = new THREE.CylinderGeometry(1, 1.12, 1.5, 28);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x8c7d62, roughness: 0.9 });
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = 0.04 + (i / (N - 1)) * 0.92;
    const p = neck.getPoint(t);
    const tan = neck.getTangent(t);
    const rad = THREE.MathUtils.lerp(2.35, 1.75, t);
    const v = new THREE.Mesh(vGeo, bone);
    v.position.copy(p);
    v.scale.set(rad, 1, rad);
    v.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    boss.add(v);
    const spine = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.9, 10), bone);
    spine.position.copy(p).add(new THREE.Vector3(0, -0.15, -rad - 0.5));
    spine.rotation.x = -Math.PI / 2 - 0.35;
    boss.add(spine);
    if (i < N - 1) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 20), discMat);
      d.position.copy(neck.getPoint(t + 0.46 / (N - 1)));
      d.scale.set(rad * 0.8, 1, rad * 0.8);
      d.quaternion.copy(v.quaternion);
      boss.add(d);
    }
  }
  for (const s of [-1, 1]) {
    boss.add(limb(new THREE.Vector3(0.6 * s, 9.1, -53.8), new THREE.Vector3(5.2 * s, 9.6, -55.2), 0.55, bone));
    boss.add(limb(new THREE.Vector3(5.2 * s, 9.6, -55.2), new THREE.Vector3(10.6 * s, 9.2, -57.4), 0.5, bone));
  }
  for (let k = 0; k < 4; k++) {
    const y = 6.0 - k * 1.5;
    const rad = 6.4 + k * 0.5;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.26, 8, 40, Math.PI).rotateX(Math.PI / 2), bone);
    rib.position.set(0, y, -58.5);
    boss.add(rib);
  }

  // ---------------------------------------------------------------- veias
  const ell = (dir) => dir.clone().multiply(CRANIUM.r).multiplyScalar(1.012).add(CRANIUM.c).add(SK); // ponto da superfície
  const project = (p) => {
    const q = p.clone().sub(SK).sub(CRANIUM.c).divide(CRANIUM.r).normalize();
    return ell(q);
  };
  const red = new THREE.Color(0xff2a30);
  const blue = new THREE.Color(0x2f62ff);
  const parts = { red: [], blue: [], redT: [], blueT: [], redK: [], blueK: [] };
  // trama de veias na superfície do crânio (a lateral esquerda e o topo, como na figura)
  const branch = (start, dir, len, rad, depth) => {
    const pts = [start.clone()];
    let p = start.clone();
    const d = dir.clone();
    const steps = Math.max(4, Math.floor(len / 1.1));
    for (let i = 0; i < steps; i++) {
      d.add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.7)).normalize();
      p = project(p.clone().addScaledVector(d, len / steps));
      pts.push(p.clone());
      if (depth > 0 && R() < 0.33) {
        const side = d.clone().applyAxisAngle(project(p).sub(SK).normalize(), (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.7));
        branch(p, side, len * 0.62, rad * 0.72, depth - 1);
      }
    }
    const isRed = R() < 0.5;
    (isRed ? parts.red : parts.blue).push(tube(pts, rad, R(), { radial: 5, taper: (u) => 1 - 0.75 * u, perUnit: 2.2 }));
  };
  for (let i = 0; i < 16; i++) {
    const a = (R() - 0.5) * 2.4 - 1.1; // mais para o lado esquerdo (−x)
    const el = 0.15 + R() * 1.1;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
    const start = project(ell(dir));
    const tangent = new THREE.Vector3(R() - 0.5, R() - 0.2, R() - 0.5).normalize();
    branch(start, tangent, 7 + R() * 5, 0.2 + R() * 0.1, 2);
  }
  // troncos grossos, enrolados no pescoço, que se abrem pelo peito e pelos ombros
  for (let k = 0; k < 6; k++) {
    const pts = [];
    const phase = (k / 6) * Math.PI * 2;
    for (let i = 0; i <= 16; i++) {
      const t = 0.98 - (i / 16) * 0.96;
      const p = neck.getPoint(t);
      const ang = phase + t * 7;
      const rr = THREE.MathUtils.lerp(2.9, 2.35, t);
      pts.push(new THREE.Vector3(p.x + Math.cos(ang) * rr, p.y, p.z + Math.sin(ang) * rr));
    }
    // a ponta se abre para os ombros ou para as costelas
    const end = pts[pts.length - 1];
    const sx = k % 2 ? 1 : -1;
    pts.push(end.clone().add(new THREE.Vector3(sx * 3, -1.2, 1)), end.clone().add(new THREE.Vector3(sx * 6, -0.6, -0.5)));
    (k % 2 ? parts.blue : parts.red).push(tube(pts, 0.34, R(), { radial: 6, taper: (u) => 1 - 0.55 * u, perUnit: 2.5 }));
  }
  // vasos que se espalham pelo peito
  for (let k = 0; k < 10; k++) {
    const sx = k % 2 ? 1 : -1;
    const a = new THREE.Vector3((R() - 0.5) * 3, 8 + R() * 2, -53 - R() * 3);
    const pts = [a, a.clone().add(new THREE.Vector3(sx * (2 + R() * 4), -1 - R() * 2, 1 + R())), a.clone().add(new THREE.Vector3(sx * (5 + R() * 5), -3 - R() * 4, R() * 2 - 1.5))];
    (k % 2 ? parts.blue : parts.red).push(tube(pts, 0.17, R(), { radial: 5, perUnit: 2.5 }));
  }
  // raízes compridas até as paredes e o teto: se debatem e recuam quando ele se acalma
  const roots = [];
  for (let k = 0; k < 14; k++) {
    const s = k % 2 ? 1 : -1;
    const a = (k / 14) * Math.PI * 2;
    const start = project(ell(new THREE.Vector3(Math.sin(a) * 0.9, 0.3 + R() * 0.7, -0.3 - R() * 0.5).normalize()));
    const target = new THREE.Vector3(s * (28 + R() * 11), 6 + R() * 36, -70 + R() * 70);
    if (k % 4 === 0) target.set((R() - 0.5) * 60, 47.5, -70 + R() * 55);
    const mid1 = start.clone().lerp(target, 0.35).add(new THREE.Vector3((R() - 0.5) * 12, (R() - 0.2) * 10, (R() - 0.5) * 12));
    const mid2 = start.clone().lerp(target, 0.7).add(new THREE.Vector3((R() - 0.5) * 12, (R() - 0.5) * 10, (R() - 0.5) * 12));
    roots.push([start, mid1, mid2, target]);
    (k % 2 ? parts.blueT : parts.redT).push(tube([start, mid1, mid2, target], 0.34 + R() * 0.12, R(), { radial: 6, taper: (u) => 1 - 0.65 * u, perUnit: 1.6 }));
  }
  const veinMats = {};
  const FULL = { value: 2 }; // veias comuns: sempre inteiras (só o feixe calmo cresce)
  const NEVER = { value: 0 }; // o feixe calmo não recua
  const addMesh = (list, color, amp, key, grow = FULL, retract = U.uRetract) => {
    const g = mergeInto(list);
    if (!g) return;
    const m = new THREE.Mesh(g, (veinMats[key] = veinMaterial(color, U, amp, grow, retract)));
    m.frustumCulled = false;
    boss.add(m);
  };
  addMesh(parts.red, red, 0.1, 'red');
  addMesh(parts.blue, blue, 0.1, 'blue');
  addMesh(parts.redT, red, 1.9, 'redT');
  addMesh(parts.blueT, blue, 1.9, 'blueT');

  // ---------------------------------------------------------------- o feixe calmo (sistema tranquilo)
  const arch = [new THREE.Vector3(0, 1.5, -61), new THREE.Vector3(0, 9, -60.4), new THREE.Vector3(0, 17, -59.6), new THREE.Vector3(0, 22.5, -61), new THREE.Vector3(0, 25.5, -62.6)];
  const cz = SK.z + CRANIUM.c.z;
  const cy = SK.y + CRANIUM.c.y;
  for (let i = 1; i <= 14; i++) {
    const th = Math.PI - (i / 14) * (Math.PI - 0.32);
    arch.push(new THREE.Vector3(0, cy + 5.95 * Math.sin(th) * 1.03, cz + 6.9 * Math.cos(th) * 1.03));
  }
  // faixa de osso, com o aro virado para a direção do feixe (`side` = para onde os vasos se alinham)
  const strapMat = new THREE.MeshStandardMaterial({ color: 0xe9dfc6, roughness: 0.6 });
  const straps = [];
  const calmRed = [];
  const calmBlue = [];
  const bundle = (path, side, strapAt) => {
    [-0.95, -0.32, 0.32, 0.95].forEach((o, i) => {
      const pts = path.map((p) => p.clone().addScaledVector(side, o));
      (i % 2 ? calmRed : calmBlue).push(tube(pts, 0.27, 0.5, { radial: 10, taper: () => 1, perUnit: 3 }));
    });
    const curve = new THREE.CatmullRomCurve3(path);
    for (const u of strapAt) {
      const zAxis = curve.getTangentAt(u);
      const xAxis = side.clone().addScaledVector(zAxis, -side.dot(zAxis)).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.11, 8, 28), strapMat);
      m.scale.set(1, 0.45, 1);
      m.position.copy(curve.getPointAt(u));
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      m.visible = false;
      m.userData.u = u;
      boss.add(m);
      straps.push(m);
    }
  };
  bundle(arch, new THREE.Vector3(1, 0, 0), [0.28, 0.5, 0.72, 0.9]);
  // segundo feixe: uma faixa de orelha a orelha por cima da testa (visível de frente)
  const hoop = [];
  const hz = cz + 1.6;
  const sc = Math.sqrt(1 - (1.6 / CRANIUM.r.z) ** 2) * 1.035;
  for (let i = 0; i <= 18; i++) {
    const th = Math.PI - (i / 18) * Math.PI;
    hoop.push(new THREE.Vector3(CRANIUM.r.x * sc * Math.cos(th), cy + CRANIUM.r.y * sc * Math.sin(th) - 0.05, hz));
  }
  bundle(hoop, new THREE.Vector3(0, 0, 1), [0.25, 0.5, 0.75]);
  addMesh(calmBlue, new THREE.Color(0x2a60ff), 0, 'calmBlue', U.uGrow, NEVER);
  addMesh(calmRed, new THREE.Color(0xff2630), 0, 'calmRed', U.uGrow, NEVER);

  // ---------------------------------------------------------------- nós de energia (os três gânglios) e luzes
  for (const C of hud.catchers) {
    C.group.scale.setScalar(2.3);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const h = new THREE.Mesh(new THREE.SphereGeometry(2.7, 24, 16), haloMat);
    h.position.copy(C.group.position);
    boss.add(h);
    C.halo = h;
  }
  const lights = hud.lights;

  // ---------------------------------------------------------------- animação
  const eyeCalm = new THREE.Color(0.5, 1.7, 2.3);
  const eyeAngry = new THREE.Color(3, 0.15, 0.1);
  let chaos = 1;
  let retract = 0;
  let grow = 0;
  let known = 0;
  let flash = 0;
  let gape = 0;
  let settled = false;
  w.anim.push((t, dt) => {
    const n = w.catchers.filter((c) => c.active).length;
    if (n > known) {
      known = n;
      flash = 1;
      gape = 1;
    }
    const k = Math.min(1, dt * 1.4);
    chaos += (1 - n / 3 - chaos) * k;
    retract += (n / 3 - retract) * Math.min(1, dt * 0.7);
    if (n >= 3) {
      grow += (1.05 - grow) * Math.min(1, dt * 0.45);
      retract = Math.min(1, retract + dt * 0.3);
      if (!settled && retract > 0.97) settled = true;
    }
    flash = Math.max(0, flash - dt * 1.6);
    gape = Math.max(0, gape - dt * 0.9);
    U.uTime.value = t;
    U.uChaos.value = chaos;
    U.uRetract.value = settled ? 1 : retract * 0.99;
    U.uGrow.value = grow;
    U.uFlash.value = flash * flash;
    for (const s of straps) s.visible = grow > s.userData.u + 0.05;
    // olhos: vermelhos e tremendo → ciano e firmes
    const flick = chaos > 0.05 ? 0.75 + 0.25 * Math.abs(Math.sin(t * (9 + 10 * chaos))) : 1;
    eyeMat.color.lerpColors(eyeCalm, eyeAngry, chaos).multiplyScalar(flick + flash * 0.8);
    portMat.color.lerpColors(new THREE.Color(0.3, 1.2, 1.7), new THREE.Color(2.6, 0.5, 0.3), chaos);
    for (const [i, e] of eyes.entries()) e.scale.setScalar(1 + 0.12 * Math.sin(t * 3 + i) * chaos);
    // crânio: balança e treme com a raiva; recua a cada acerto
    skull.rotation.y = Math.sin(t * 0.45) * 0.06 * (0.3 + chaos);
    skull.rotation.x = Math.sin(t * 0.37) * 0.025 + flash * 0.05;
    skull.position.set(SK.x + (Math.sin(t * 31) * 0.05 + Math.sin(t * 17) * 0.04) * (chaos * chaos + flash), SK.y + Math.sin(t * 23) * 0.04 * chaos, SK.z - flash * 0.4);
    // mandíbula: bate os dentes; escancara quando leva um acerto; fecha quando calmo
    jaw.rotation.x = (0.06 + 0.14 * Math.abs(Math.sin(t * 11)) * chaos) * (chaos > 0.05 ? 1 : 0.2) + gape * 0.42;
    // gânglios: vermelhos até receberem a energia; depois, ciano
    for (const C of hud.catchers) {
      C.halo.material.color.setRGB(C.active ? 0.2 : 1, C.active ? 0.9 : 0.2, C.active ? 1 : 0.15);
      C.halo.scale.setScalar(1 + 0.08 * Math.sin(t * 4 + C.pos.x) + (C.active ? 0.25 : 0));
    }
    // luzes: ardem em vermelho/azul e esfriam para branco-azulado
    lights.warm.color.setRGB(1, 0.25 + 0.5 * (1 - chaos), 0.2 + 0.7 * (1 - chaos));
    lights.warm.intensity = 150 * (0.8 + 0.2 * Math.sin(t * 7) * chaos + 0.3 * (1 - chaos));
    lights.cold.intensity = 150 * (0.9 + 0.1 * Math.sin(t * 5 + 1) * chaos);
  });
  return { skull, jaw };
}

// ------------------------------------------------------------------ fase
function sign(w, x, y, z, rotY, code, name, line2) {
  w.sign(x, y, z, rotY, [
    [`CHEFE ${code}`, 110, 150],
    [name, 70, 270, '#b71c1c'],
    [line2, 40, 380, '#55575c', 'Arial, sans-serif'],
    ['SÉRIE CHEFES · LABORATÓRIO ANTÍPODA', 30, 455, '#8a8c90', 'Arial, sans-serif'],
  ]);
}

const B = (n, def) => ({ ...def, id: 500 + n, n, code: `B${String(n + 1).padStart(2, '0')}`, series: 'boss', music: def.music ?? 'labEpic', heat: false });

export const CHEFES = [
  B(0, {
    name: 'Sistema Nervoso',
    who: 'Helena',
    lesson: 'Use a própria energia do crânio para acalmá-lo: leve as bolas dele até os três gânglios, nos ombros e na garganta.',
    build(w) {
      // salão: chão, paredes laterais e do fundo de concreto claro (aceitam portal), teto de metal
      w.box(-40, -2, -80, 40, 0, 16, 'white');
      w.box(-41, 0, -81, -40, 48, 17, 'white');
      w.box(40, 0, -81, 41, 48, 17, 'white');
      w.box(-41, 0, 16, 41, 48, 17, 'white');
      w.box(-41, 48, -81, 41, 49, 17, 'metal');
      // porta de trás, atrás do chefe: só abre quando os três gânglios estão ligados
      northWallWithExit(w, -40, 40, 48, -80, 'exit');
      // gânglios: ombros e garganta (raio de captura grande: a mira não precisa ser perfeita)
      const catchers = [
        w.catcher(-10, 8.4, -55, [-1, 0, 0], 'exit', { radius: 2.3 }),
        w.catcher(10, 8.4, -55, [1, 0, 0], 'exit', { radius: 2.3 }),
        w.catcher(0, 14, -52.5, [0, 0, 1], 'exit', { radius: 2.3 }),
      ];
      // bolas: têmporas (cruzam o salão até as paredes), boca (reta para o jogador) e olhos (chuva torta)
      const hide = (L) => {
        L.group.visible = false; // o soquete padrão não aparece: a saída é o próprio crânio
        return L;
      };
      const temporas = [
        hide(w.launcher(-6.4, 26.4, -55.5, [-1, 0, 0], { delay: 2, life: 15, speed: 6 })),
        hide(w.launcher(6.4, 26.4, -55.5, [1, 0, 0], { delay: 5, life: 15, speed: 6 })),
      ];
      const mouth = hide(w.launcher(0, 20.7, -49.9, [0, 0, 1], { delay: 3.5, life: 19, speed: 5 }));
      const eyes = [hide(w.launcher(-2.4, 25.7, -50.2, [0, -0.3, 1], { delay: 6, life: 9, speed: 4.2 })), hide(w.launcher(2.4, 25.7, -50.2, [0, -0.3, 1], { delay: 8, life: 9, speed: 4.2 }))];
      const all = [...temporas, mouth, ...eyes];
      const base = new Map(all.map((L) => [L, L.pos.clone()]));
      // luzes (fixas: o número de luzes não muda durante a fase)
      const hall = [
        [-22, 36, -2],
        [22, 36, -2],
        [-22, 36, -34],
        [22, 36, -34],
      ];
      for (const [x, y, z] of hall) w.light(x, y, z, 330, 0xdfe8ff, 95, false);
      const warm = w.light(-9, 15, -43, 150, 0xff4030, 46, false);
      const cold = w.light(9, 15, -43, 150, 0x4a7aff, 46, false);
      buildBoss(w, { catchers, lights: { warm, cold } });
      // movimento das bolas: sobe e desce nas têmporas e na boca; varre no olho — tudo se acalma com o chefe
      let calmed = false;
      w.anim.push((t) => {
        const n = catchers.filter((c) => c.active).length;
        const chaos = 1 - n / 3;
        temporas.forEach((L, i) => (L.pos.y = base.get(L).y + Math.sin(t * 0.9 + i * 2.1) * 3.4 * (0.35 + 0.65 * chaos)));
        mouth.pos.y = base.get(mouth).y + Math.sin(t * 0.7) * 1.4 * (0.3 + 0.7 * chaos);
        eyes.forEach((L, i) => {
          const yaw = Math.sin(t * 0.8 + i * 2.4) * 0.8;
          const pitch = -0.3 - 0.2 * Math.sin(t * 1.3 + i);
          L.dir.set(Math.sin(yaw), pitch, Math.cos(yaw)).normalize();
        });
        // um lançador que acertou um gânglio volta a atirar (a energia é dele, não acaba)
        if (n < 3) for (const L of all) L.done = false;
        if (n >= 3 && !calmed) {
          calmed = true;
          for (const L of all) {
            L.done = true;
            if (L.pellet) L.pellet.life = Math.min(L.pellet.life, 0.25);
          }
        }
      });
      sign(w, -39.97, 3.2, 6, Math.PI / 2, 'B01', 'SISTEMA NERVOSO', 'três gânglios · bolas de energia · portais');
      return {
        spawn: [0, 0, 10, 0],
        gun: 'both',
        intro: [
          ['Helena', 'Esse crânio gigante é o sistema nervoso da câmara: cada nervo dele cospe energia e ele não para de tremer.'],
          ['Helena', 'As bolas das têmporas cruzam o salão em linha reta. Ponha um portal na parede onde uma bola bate e o outro de frente para um gânglio, nos ombros ou na garganta.'],
          ['Helena', 'A cada acerto ele se acalma um pouco. Quando os três estiverem ligados, a porta atrás dele se abre.'],
        ],
        hints: [
          { after: 80, lines: [['Helena', 'A bola das têmporas bate na parede na altura do crânio, lá em cima. Portal azul ali; o laranja na parede do outro lado, na altura do ombro.']] },
          { after: 160, lines: [['Helena', 'O gânglio da garganta fica mais alto que os ombros: laranja na altura dele, de qualquer um dos lados.']] },
        ],
      };
    },
  }),
];
