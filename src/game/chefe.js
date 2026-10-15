// Série Chefes — B01 "Sistema Nervoso": um crânio gigante, com as veias e os
// nervos à mostra, protege a saída. A luta segue a do Portal 1: uma torreta
// atira foguetes em você; saia da frente e deixe o foguete entrar no portal
// azul — o laranja, já na parede, aponta para o crânio. Cada foguete que
// acerta derruba um núcleo, que você leva (E) até a fornalha no meio do salão.
// Com os três queimados ele se acalma: os nervos recuam, sobra só o feixe
// arrumado — o "sistema tranquilo" — e a porta de trás se abre.
//
// Coordenadas em metros; o chão é y = 0; o crânio olha para +z e a saída fica
// atrás dele, em −z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { northWallWithExit } from './levels.js';
import { canvas, heightToNormal } from './textures.js';
import { RocketTurret, Rocket, explosion, coreModel } from './campaign/boss.js';

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
function buildBoss(w, S, lights) {
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
    const target = new THREE.Vector3(s * (15 + R() * 8), 5 + R() * 28, -72 + R() * 58);
    if (k % 4 === 0) target.set((R() - 0.5) * 38, 37.5, -70 + R() * 50);
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

  // ---------------------------------------------------------------- animação
  const eyeCalm = new THREE.Color(0.5, 1.7, 2.3);
  const eyeAngry = new THREE.Color(3, 0.15, 0.1);
  let chaos = 1;
  let retract = 0;
  let grow = 0;
  let settled = false;
  const calmCol = new THREE.Color(0.3, 1.2, 1.7);
  const angryCol = new THREE.Color(2.6, 0.5, 0.3);
  const _look = new THREE.Vector3();
  w.anim.push((t, dt) => {
    // cada foguete que acerta tira um terço da raiva; com o último núcleo queimado vem a calma
    const n = S.stage;
    chaos += (1 - n / 3 - chaos) * Math.min(1, dt * 1.4);
    retract += (n / 3 - retract) * Math.min(1, dt * 0.7);
    if (n >= 3) {
      retract = Math.min(1, retract + dt * 0.3);
      if (!settled && retract > 0.97) settled = true;
    }
    if (S.calm) grow += (1.05 - grow) * Math.min(1, dt * 0.45);
    S.flash = Math.max(0, S.flash - dt * 1.6);
    S.gape = Math.max(0, S.gape - dt * 0.9);
    const flash = S.flash;
    U.uTime.value = t;
    U.uChaos.value = chaos;
    U.uRetract.value = settled ? 1 : retract * 0.99;
    U.uGrow.value = grow;
    U.uFlash.value = flash * flash;
    for (const s of straps) s.visible = grow > s.userData.u + 0.05;
    // olhos: vermelhos e tremendo → ciano e firmes
    const flick = chaos > 0.05 ? 0.75 + 0.25 * Math.abs(Math.sin(t * (9 + 10 * chaos))) : 1;
    eyeMat.color.lerpColors(eyeCalm, eyeAngry, chaos).multiplyScalar(flick + flash * 0.8);
    portMat.color.lerpColors(calmCol, angryCol, chaos);
    for (const [i, e] of eyes.entries()) e.scale.setScalar(1 + 0.12 * Math.sin(t * 3 + i) * chaos);
    // crânio: acompanha o jogador, balança e treme com a raiva; recua a cada acerto
    _look.copy(S.look).sub(SK);
    const yaw = THREE.MathUtils.clamp(Math.atan2(_look.x, _look.z), -0.7, 0.7);
    skull.rotation.y += (yaw * (0.4 + 0.6 * chaos) + Math.sin(t * 0.45) * 0.05 * chaos - skull.rotation.y) * Math.min(1, dt * 2.5);
    skull.rotation.x = Math.sin(t * 0.37) * 0.025 + flash * 0.05;
    skull.position.set(SK.x + (Math.sin(t * 31) * 0.05 + Math.sin(t * 17) * 0.04) * (chaos * chaos + flash), SK.y + Math.sin(t * 23) * 0.04 * chaos, SK.z - flash * 0.4);
    // mandíbula: bate os dentes; escancara quando leva um acerto; fecha quando calmo
    jaw.rotation.x = (0.06 + 0.14 * Math.abs(Math.sin(t * 11)) * chaos) * (chaos > 0.05 ? 1 : 0.2) + S.gape * 0.42;
    // luzes: ardem em vermelho/azul e esfriam para branco-azulado
    lights.warm.color.setRGB(1, 0.25 + 0.5 * (1 - chaos), 0.2 + 0.7 * (1 - chaos));
    lights.warm.intensity = 150 * (0.8 + 0.2 * Math.sin(t * 7) * chaos + 0.3 * (1 - chaos));
    lights.cold.intensity = 150 * (0.9 + 0.1 * Math.sin(t * 5 + 1) * chaos);
  });
  return { skull, jaw };
}

// ------------------------------------------------------------------ a luta
const TURRETS = [
  [-8, 0, -38],
  [8, 0, -38],
];
const ROCKET_SPEED = 21; // rápido: dá para ver o laser travar, mas o foguete chega logo
const MOUTH = new THREE.Vector3(0, 20.2, -50);
// onde um foguete "acerta" o chefe: o crânio e o pescoço
const HURT = [
  { a: SK, b: SK, r: 7.4 },
  { a: new THREE.Vector3(0, 3, -59), b: new THREE.Vector3(0, 19, -56.5), r: 3.4 },
];

/** a luta: torretas de foguete, foguetes, núcleos que caem e a fornalha (lógica própria da série Chefes) */
function createFight(ctx, S) {
  const { world, portals, player } = ctx;
  const turrets = TURRETS.map((p, i) => {
    const T = new RocketTurret(world.group, new THREE.Vector3(...p), false);
    T.group.scale.setScalar(1.7); // maiores, para se enxergarem do outro lado do salão
    T.lockTime = 0.9;
    T.coolTime = 2.3;
    T.cool = 0.8 + i * 1.0; // as duas atiram, uma defasada da outra
    return T;
  });
  let tipped = false;
  let tip = 0; // dicas na primeira vez que o laser trava em você
  const rockets = [];
  const booms = [];
  const eye = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const step = new THREE.Vector3();
  let core = null;
  let burned = 0;

  const bossHit = () => {
    S.stage++;
    S.flash = 1;
    S.gape = 1;
    ctx.sfx.death?.();
    // o núcleo cai da boca para o chão, em frente ao pescoço
    core = ctx.spawnCube(MOUTH.x, MOUTH.y, MOUTH.z, { mesh: coreModel(S.stage - 1) });
    core.body.setLinvel({ x: (Math.random() - 0.5) * 3, y: 1, z: 4.5 }, true); // cuspido para a frente: cai a meio caminho da fornalha
    ctx.say([
      S.stage === 1
        ? ['Helena', 'Acertou! Caiu um núcleo da boca dele. Pegue com E, leve até a fornalha no meio do salão e solte lá dentro.']
        : ['Helena', S.stage === 2 ? 'Mais um núcleo. Mesma coisa: fornalha.' : 'O último! Fornalha nele também.'],
    ]);
  };

  return {
    S,
    rockets,
    update(dt) {
      ctx.player.eye(eye);
      S.look.copy(eye);
      const idle = !!core || S.calm;
      turrets.forEach((T, i) => {
        T.enabled = !idle;
        const shot = T.update(dt, eye, world);
        if (T.lock === 0) tipped = false;
        if (T.enabled && T.lock > 0.3 && !tipped && tip < 2) {
          tipped = true;
          tip++;
          ctx.say([
            portals.blue.placed
              ? ['Helena', 'O laser travou em você! Saia do caminho: o foguete vai reto até o portal azul.']
              : ['Helena', 'O laser travou! Ponha o portal azul numa parede branca atrás de você e saia da frente do foguete.'],
          ]);
        }
        if (shot) {
          const rk = new Rocket(world.group, shot.pos, shot.dir);
          rk.speed = ROCKET_SPEED;
          rockets.push(rk);
          ctx.sfx.turretShot?.(shot.pos.distanceTo(eye));
        }
      });
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        prev.copy(r.pos);
        r.pos.addScaledVector(r.dir, r.speed * dt);
        r.life -= dt;
        const P = portals.crossing(prev, r.pos);
        if (P?.partner) {
          const M = portals.transform(P, P.partner);
          r.pos.applyMatrix4(M);
          r.dir.transformDirection(M);
          prev.copy(r.pos).addScaledVector(r.dir, -0.05);
          r.homing = true;
        }
        // depois do portal o foguete corrige a rota sozinho rumo ao crânio (o ângulo de entrada no azul
        // não precisa ser perfeito): só se ele já estiver apontado mais ou menos para lá
        if (r.homing) {
          seg.copy(SK).sub(r.pos).normalize();
          if (seg.dot(r.dir) > 0.8) r.dir.lerp(seg, Math.min(1, dt * 1.6)).normalize();
        }
        let boom = r.life <= 0;
        for (const h of HURT) {
          ab.copy(h.b).sub(h.a);
          const len2 = ab.lengthSq();
          const k = len2 > 0 ? THREE.MathUtils.clamp(seg.copy(r.pos).sub(h.a).dot(ab) / len2, 0, 1) : 0;
          if (r.pos.distanceTo(seg.copy(h.a).addScaledVector(ab, k)) < h.r) {
            if (!core && S.stage < 3 && !S.calm) bossHit();
            boom = true;
          }
        }
        if (!boom && r.pos.distanceTo(ctx.player.pos) < 0.8) {
          ctx.hurt(45);
          boom = true;
        }
        step.copy(r.pos).sub(prev);
        if (!boom && step.lengthSq() > 0 && world.raycast(prev, step.clone().normalize(), step.length())) boom = true;
        if (boom) {
          explosion(world.group, r.pos, booms);
          ctx.sfx.pop?.();
          r.dispose();
          rockets.splice(i, 1);
        } else r.sync();
      }
      for (let i = booms.length - 1; i >= 0; i--) {
        const b = booms[i];
        b.t += dt;
        b.m.scale.setScalar(1 + b.t * 9);
        b.m.material.opacity = Math.max(0, 1 - b.t * 2.5);
        if (b.t > 0.4) {
          world.group.remove(b.m);
          booms.splice(i, 1);
        }
      }
      // núcleo na fornalha
      if (core?.gone) {
        core = null;
        burned++;
        if (burned >= 3) {
          S.calm = true;
          world.signals.set('exit', true);
          for (const T of turrets) T.enabled = false;
          ctx.say([['Helena', 'Ele se acalmou. Os nervos se recolheram e a porta atrás dele abriu: pode ir.']]);
        } else ctx.say([['Helena', 'Queimou! A torreta vai voltar a atirar: mesma tática.']]);
      }
    },
  };
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
    lesson: 'Fique na frente do portal azul e saia do caminho quando o foguete vier: ele sai no laranja, direto no crânio. Queime os três núcleos que caem.',
    build(w) {
      // salão (bem menor que antes): paredes laterais e da frente de concreto claro (aceitam portal), fundo e teto de metal
      w.box(-25, 0, -73, -24, 38, -9, 'white');
      w.box(24, 0, -73, 25, 38, -9, 'white');
      w.box(-25, 0, -10, 25, 38, -9, 'white');
      w.box(-25, 38, -79, 25, 39, -9, 'metal');
      // chão com o buraco da fornalha entre o jogador e o chefe
      w.box(-24, -2, -72, 24, 0, -31, 'white');
      w.box(-24, -2, -25, 24, 0, -10, 'white');
      w.box(-24, -2, -31, -3, 0, -25, 'white');
      w.box(3, -2, -31, 24, 0, -25, 'white');
      w.box(-3, -2, -31, 3, -1, -25, 'rock');
      w.incinerator(-2.95, -1, -30.95, 2.95, 0.9, -25.05);
      for (const [x0, z0, x1, z1] of [
        [-3.4, -31.4, 3.4, -31],
        [-3.4, -25, 3.4, -24.6],
        [-3.4, -31, -3, -25],
        [3, -31, 3.4, -25],
      ])
        w.box(x0, 0, z0, x1, 0.05, z1, 'stripe', { solid: false });
      w.light(0, 4, -28, 60, 0xff8030, 18, false);
      // porta de trás, atrás do chefe: só abre quando o último núcleo for queimado
      northWallWithExit(w, -24, 24, 38, -72, 'exit');
      // luzes (fixas: o número de luzes não muda durante a fase)
      for (const [x, y, z] of [
        [-14, 30, -20],
        [14, 30, -20],
        [-14, 30, -46],
        [14, 30, -46],
      ])
        w.light(x, y, z, 260, 0xdfe8ff, 70, false);
      const warm = w.light(-9, 15, -43, 150, 0xff4030, 46, false);
      const cold = w.light(9, 15, -43, 150, 0x4a7aff, 46, false);
      // estado compartilhado entre a animação do chefe e a luta
      const S = { stage: 0, calm: false, flash: 0, gape: 0, look: new THREE.Vector3(0, 1.6, -14) };
      buildBoss(w, S, { warm, cold });
      // os olhos cospem bolas de energia que varrem o salão e quicam: não dá para ficar parado
      const eyes = [-1, 1].map((sx, i) => {
        const L = w.launcher(2.4 * sx, 25.7, -50.2, [0, -0.3, 1], { delay: 2 + i * 2.5, life: 8, speed: 7 });
        L.group.visible = false;
        return L;
      });
      let spitting = true;
      w.anim.push((t) => {
        eyes.forEach((L, i) => {
          const yaw = Math.sin(t * 1.3 + i * 2.4) * 0.9;
          const pitch = -0.3 - 0.25 * Math.sin(t * 1.9 + i);
          L.dir.set(Math.sin(yaw), pitch, Math.cos(yaw)).normalize();
        });
        if (S.calm && spitting) {
          spitting = false;
          for (const L of eyes) {
            L.done = true;
            if (L.pellet) L.pellet.life = Math.min(L.pellet.life, 0.25);
          }
        }
      });
      sign(w, -24.97, 3.2, -18, Math.PI / 2, 'B01', 'SISTEMA NERVOSO', 'foguete · portal · núcleo · fornalha');
      return {
        spawn: [0, 0, -14, 0],
        gun: 'blue',
        // o laranja já está na parede, na altura do crânio: tudo que entra no azul sai apontado para ele
        portals: [{ which: 'orange', c: [-23.9, 27, -55], n: [1, 0, 0], u: [0, 1, 0] }],
        fight: (ctx) => createFight(ctx, S),
        intro: [
          ['Helena', 'Esse crânio gigante manda na câmara. As torretas de foguete miram em você: o laser trava e o foguete sai reto e rápido. Os olhos dele também cospem bolas de energia: não encoste.'],
          ['Helena', 'O portal laranja já está na parede, de frente para o crânio. Ponha o azul na parede branca atrás de você, espere o laser travar e saia do caminho: o foguete passa pelo portal e acerta o crânio.'],
          ['Helena', 'Cada acerto derruba um núcleo da boca dele. Leve até a fornalha no meio do salão (E pega e solta). Com três queimados, a porta de trás abre.'],
        ],
        hints: [
          { after: 70, lines: [['Helena', 'De costas para uma parede branca, atire o portal azul nela. Quando o laser travar em você, ande para o lado: o foguete segue em linha reta até o portal.']] },
          { after: 150, lines: [['Helena', 'Quando o núcleo cair, as torretas param. Pegue ele com E (olhando de perto) e jogue dentro do buraco brilhante do chão.']] },
        ],
      };
    },
  }),
];
