// Mundo do jogo: caixas alinhadas aos eixos (paredes, pisos, plataformas),
// materiais (o que aceita portal e o que não aceita), volumes de perigo,
// gatilhos, portas, botões, cubos e o elevador de saída.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorButton, envMap } from './models.js';
import * as TX from './textures.js';

const TILE = 2; // metros por repetição de textura
const _path = new THREE.Vector3();
const _c = new THREE.Color();
const RED = new THREE.Color(2.6, 0.25, 0.12);
const GREEN = new THREE.Color(0.3, 2.6, 0.7);

// campo da grade de desintegração: malha hexagonal, fluxo de ruído subindo,
// varredura, arcos elétricos junto aos emissores, faíscas e a onda de quem passa
const FIZZLER_FS = /* glsl */ `
  uniform float uTime; uniform vec2 uSize; uniform vec3 uRipple; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * n2(p); p = p * 2.1 + 3.7; a *= 0.5; } return s; }
  // distância à borda da célula hexagonal
  float hexEdge(vec2 p){
    vec2 r = vec2(1.0, 1.7320508);
    vec2 a = mod(p, r) - r * 0.5;
    vec2 b = mod(p - r * 0.5, r) - r * 0.5;
    vec2 q = abs(dot(a, a) < dot(b, b) ? a : b);
    return 0.5 - max(dot(q, vec2(0.5, 0.8660254)), q.x);
  }
  void main(){
    vec2 p = vUv * uSize;
    vec3 blue = vec3(0.35, 0.75, 1.0);
    // fluxo subindo
    float flow = fbm(vec2(p.x * 1.6, p.y * 0.9 - uTime * 0.8));
    float a = 0.05 + 0.16 * smoothstep(0.35, 0.9, flow);
    // malha hexagonal fina, mais forte onde o fluxo passa
    float hx = 1.0 - smoothstep(0.0, 0.035, hexEdge(p * 2.2 + vec2(0.0, uTime * 0.15)));
    a += hx * (0.06 + 0.25 * flow);
    // linhas verticais finas correndo de lado
    a += pow(abs(sin(p.x * 22.0 + uTime * 3.0 + sin(p.y * 1.5) * 2.0)), 80.0) * 0.25;
    // varredura horizontal descendo
    float sweep = fract(uTime * 0.35);
    a += exp(-pow((vUv.y - (1.0 - sweep)) * uSize.y * 3.0, 2.0)) * 0.55;
    // arcos elétricos junto às bordas (emissores)
    float edge = min(vUv.x, 1.0 - vUv.x) * uSize.x;
    float arcN = fbm(vec2(p.y * 3.0, uTime * 6.0 + step(0.5, vUv.x) * 10.0));
    float arc = smoothstep(0.06, 0.0, abs(edge - arcN * 0.5)) * step(edge, 0.6);
    a += arc * 1.2 + smoothstep(0.35, 0.0, edge) * 0.3;
    // faíscas
    vec2 sp = p * vec2(10.0, 10.0) + vec2(0.0, uTime * 5.0);
    vec2 cell = floor(sp);
    float spark = step(0.988, h(cell)) * (0.5 + 0.5 * sin(uTime * 25.0 + h(cell) * 6.28)) * smoothstep(0.22, 0.0, length(fract(sp) - 0.5));
    a += spark;
    // onda de quem passou
    float age = uTime - uRipple.z;
    if (age < 1.5) {
      float d = length((vUv - uRipple.xy) * uSize);
      a += exp(-pow((d - age * 6.0) * 2.5, 2.0)) * (1.5 - age) * 1.4;
    }
    vec3 col = blue * (1.0 + spark * 2.0 + arc * 1.5);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  }`;

let GRATE = null;
/** grade de piso (furos quadrados transparentes) */
function grateTexture() {
  if (GRATE) return GRATE;
  const cv = TX.canvas(256);
  const g = cv.getContext('2d');
  g.fillStyle = '#9aa0a8';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) for (let y = 0; y < 256; y += 16) g.clearRect(x + 3, y + 3, 10, 10);
  GRATE = TX.tex(cv, { repeat: 4 });
  return GRATE;
}

/** superfície da Lua: cinza com mares escuros e crateras */
let MOON_TEX = null;
function moonTexture() {
  if (MOON_TEX) return MOON_TEX;
  const cv = TX.canvas(1024, 512);
  const g = cv.getContext('2d');
  g.fillStyle = '#9a9a96';
  g.fillRect(0, 0, 1024, 512);
  TX.grain(g, 0, 0, 1024, 512, 30000, 0.12, 2);
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * 1024;
    const y = 120 + Math.random() * 280;
    const r = 60 + Math.random() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(60,60,64,0.55)');
    gr.addColorStop(1, 'rgba(60,60,64,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 1024, 512);
  }
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 512;
    const r = 2 + Math.random() ** 3 * 30;
    g.strokeStyle = 'rgba(40,40,40,0.35)';
    g.lineWidth = Math.max(1, r * 0.25);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(230,230,225,0.25)';
    g.beginPath();
    g.arc(x - r * 0.15, y - r * 0.15, r, Math.PI, Math.PI * 1.6);
    g.stroke();
  }
  MOON_TEX = TX.tex(cv, { wrap: false });
  return MOON_TEX;
}

/** a Terra: oceanos, continentes e nuvens (procedural) */
let EARTH_TEX = null;
function earthTexture() {
  if (EARTH_TEX) return EARTH_TEX;
  const cv = TX.canvas(1024, 512);
  const g = cv.getContext('2d');
  g.fillStyle = '#1d4f9a';
  g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 1024;
    const y = 80 + Math.random() * 350;
    g.fillStyle = Math.random() < 0.5 ? '#3f7a3a' : '#8a7a4a';
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const r = 20 + Math.random() * 60;
      g.lineTo(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r);
    }
    g.fill();
  }
  g.fillStyle = 'rgba(240,245,255,0.9)';
  g.fillRect(0, 0, 1024, 30);
  g.fillRect(0, 482, 1024, 30);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.4})`;
    g.beginPath();
    g.ellipse(Math.random() * 1024, Math.random() * 512, 20 + Math.random() * 60, 4 + Math.random() * 10, 0, 0, Math.PI * 2);
    g.fill();
  }
  EARTH_TEX = TX.tex(cv, { wrap: false });
  return EARTH_TEX;
}

let HALO_TEX = null;
function haloTexture() {
  if (HALO_TEX) return HALO_TEX;
  const cv = TX.canvas(128);
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  HALO_TEX = new THREE.CanvasTexture(cv);
  return HALO_TEX;
}

let MATS = null;
/**
 * Materiais do cenário. `faces` (quando existe) dá um material para cada face
 * da caixa na ordem do BoxGeometry: +x, −x, +y (topo/piso), −y (teto), +z, −z.
 */
export function materials() {
  if (MATS) return MATS;
  const ENV = envMap();
  const std = (maps, o = {}) => new THREE.MeshStandardMaterial({ ...maps, envMap: ENV, envMapIntensity: 0.25, ...o });
  const wall = std(TX.whiteWall(), { roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1) });
  const floor = std(TX.whiteFloor(), { roughness: 1, metalness: 0, envMapIntensity: 0.35 });
  const ceil = std(TX.ceiling(), { roughness: 1, metalness: 0, color: 0xc8c8c8 });
  const mWall = std(TX.metalWall(), { roughness: 1, metalness: 0.65, color: 0xc4c8d0, envMapIntensity: 0.6, normalScale: new THREE.Vector2(1.2, 1.2) });
  const mFloor = std(TX.metalFloor(), { roughness: 1, metalness: 0.7, color: 0xc8ccd2, envMapIntensity: 0.6 });
  const magma = TX.magma();
  magma.repeat.set(0.3, 0.3); // a crosta repetindo de 2 em 2 m vira um xadrez de longe
  const side6 = (side, top, bottom) => [side, side, top, bottom, side, side];
  MATS = {
    white: { mat: wall, faces: side6(wall, floor, ceil), portalable: true },
    metal: { mat: mWall, faces: side6(mWall, mFloor, mWall), portalable: false },
    rock: { mat: std(TX.rock(), { roughness: 0.95, envMapIntensity: 0.1 }), portalable: false },
    glass: {
      mat: new THREE.MeshPhysicalMaterial({
        color: 0xa8dcff,
        transparent: true,
        opacity: 0.16,
        roughness: 0.04,
        metalness: 0.1,
        clearcoat: 1,
        envMap: ENV,
        envMapIntensity: 1.4,
        depthWrite: false,
      }),
      portalable: false,
    },
    magma: {
      mat: new THREE.MeshStandardMaterial({ map: magma, color: 0x8a3a18, emissiveMap: magma, emissive: 0xff6a1a, emissiveIntensity: 1, roughness: 0.6 }),
      portalable: false,
    },
    stripe: { mat: std({ map: TX.hazardStripe() }, { roughness: 0.6 }), portalable: false },
    moon: { mat: std(TX.moonGround(), { roughness: 1, metalness: 0, envMapIntensity: 0.1 }), portalable: true },
  };
  const door = TX.doorPanel();
  MATS.door = std(door, { roughness: 0.55, metalness: 0.6, color: 0xd0d4dc, envMapIntensity: 0.6 });
  MATS.frame = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.8, envMap: ENV, envMapIntensity: 0.6 });
  MATS.dark = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.6, envMap: ENV, envMapIntensity: 0.5 });
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

/** raio contra caixa girada: leva o raio para o espaço da caixa e testa como caixa alinhada */
function rayObb(origin, dir, obb, maxDist) {
  const o = origin.clone().sub(obb.c).applyQuaternion(obb.qi);
  const d = dir.clone().applyQuaternion(obb.qi);
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const oi = o.getComponent(i);
    const di = d.getComponent(i);
    const h = obb.half.getComponent(i);
    if (Math.abs(di) < 1e-9) {
      if (oi < -h || oi > h) return null;
      continue;
    }
    let t1 = (-h - oi) / di;
    let t2 = (h - oi) / di;
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
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxDist || axis < 0) return null;
  const normal = new THREE.Vector3().setComponent(axis, sign).applyQuaternion(obb.q);
  return { dist: tmin, point: origin.clone().addScaledVector(dir, tmin), normal };
}

/** raio contra sólido convexo (interseção dos semiespaços n·p ≤ d) */
function rayConvex(origin, dir, planes, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  let hitN = null;
  for (const pl of planes) {
    const den = pl.n.dot(dir);
    const dist = pl.d - pl.n.dot(origin);
    if (Math.abs(den) < 1e-9) {
      if (dist < 0) return null;
      continue;
    }
    const t = dist / den;
    if (den < 0) {
      if (t > tmin) {
        tmin = t;
        hitN = pl.n;
      }
    } else if (t < tmax) tmax = t;
    if (tmin > tmax) return null;
  }
  if (!hitN) return null; // começou dentro
  return { dist: tmin, point: origin.clone().addScaledVector(dir, tmin), normal: hitN.clone() };
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
    this.fizzlers = [];
    this.launchers = [];
    this.catchers = [];
    this.incinerators = [];
    this.pedestals = [];
    // mecânicas da série Fronteira
    this.lasers = [];
    this.laserCatchers = [];
    this.signals = new Map(); // sinais ligados pela lógica da fase (id → ligado)
    this.plates = [];
    this.funnels = [];
    this.gravZones = [];
    this.blackHoles = [];
    this.eraItems = []; // { obj, era, box?, light?, k? }
    this.era = 'past';
    this.physics?.reset();
  }

  box(x0, y0, z0, x1, y1, z1, matName = 'white', opts = {}) {
    const M = materials()[matName];
    const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const mesh = new THREE.Mesh(worldBoxGeo(min, max), M.faces ?? M.mat);
    mesh.receiveShadow = true;
    if (matName === 'glass') {
      mesh.renderOrder = 5;
      this.glassFrame(mesh, min, max);
    }
    this.group.add(mesh);
    const b = { min, max, mat: matName, portalable: M.portalable && !opts.noPortal, mesh, solid: opts.solid !== false };
    if (b.solid) {
      this.solids.push(b);
      this.physics?.addBox(b, !!opts.kinematic);
    }
    if (opts.era) this.inEra(b, opts.era);
    return b;
  }

  /** volume que mata ao tocar (com superfície visível de rocha fundida) */
  hazard(x0, y0, z0, x1, y1, z1, opts = {}) {
    const b = this.box(x0, y0, z0, x1, y1, z1, 'magma', { solid: false });
    b.isHazard = true;
    this.hazards.push(b);
    // `light`/`lightLift`: intensidade e altura da luz (mapas importados usam mais alta e mais fraca)
    const light = new THREE.PointLight(0xff6a20, opts.light ?? 25, 18, 1.6);
    light.position.set((x0 + x1) / 2, y1 + (opts.lightLift ?? 1.5), (z0 + z1) / 2);
    this.group.add(light);
    if (opts.era) {
      this.inEra(b, opts.era);
      this.inEra(light, opts.era);
    }
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

  /** cantoneiras escuras nas 12 arestas de uma caixa de vidro (filhas da malha: acompanham portas) */
  glassFrame(mesh, min, max) {
    const s = new THREE.Vector3().subVectors(max, min);
    const c = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const t = 0.06;
    const mat = materials().frame;
    for (const ax of ['x', 'y', 'z']) {
      const [a, b] = ['x', 'y', 'z'].filter((k) => k !== ax);
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const size = { x: t, y: t, z: t };
          size[ax] = s[ax] + t;
          const bar = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
          bar.position.copy(c);
          bar.position[a] += (sa * s[a]) / 2;
          bar.position[b] += (sb * s[b]) / 2;
          mesh.add(bar);
        }
    }
  }

  light(x, y, z, intensity = 40, color = 0xfff4e6, dist = 30, fixture = true) {
    const l = new THREE.PointLight(color, intensity, dist, 1.5);
    l.position.set(x, y, z);
    this.group.add(l);
    if (!fixture) return l; // luz solta (ex.: o Sol na Lua), sem luminária
    // luminária no teto: caixa escura, difusor aceso e grade de proteção
    const g = new THREE.Group();
    const M = materials();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.14, 0.52), M.frame);
    housing.position.y = 0.07;
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.03, 0.36), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6), toneMapped: false }));
    diffuser.position.y = -0.005;
    g.add(housing, diffuser);
    for (let i = -3; i <= 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.42), M.dark);
      slat.position.set(i * 0.24, -0.025, 0);
      g.add(slat);
    }
    for (const sx of [-1, 1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), M.dark);
      rod.position.set(sx * 0.7, 0.38, 0);
      g.add(rod);
    }
    g.position.set(x, y + 0.27, z);
    this.group.add(g);
    return l;
  }

  /** porta que sobe quando aberta */
  door(id, x0, y0, z0, x1, y1, z1, opts = {}) {
    const b = this.box(x0, y0, z0, x1, y1, z1, opts.mat ?? (opts.axis ? 'stripe' : 'metal'), { kinematic: true });
    const plain = !opts.axis && !opts.mat;
    if (plain) {
      // porta de verdade: textura própria (UV de 0 a 1 na folha) nas duas faces largas
      const size = new THREE.Vector3().subVectors(b.max, b.min);
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z).translate(...new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5).toArray());
      const M = materials();
      const thinX = size.x < size.z;
      b.mesh.geometry.dispose();
      b.mesh.geometry = geo;
      b.mesh.material = [0, 1, 2, 3, 4, 5].map((i) => ((thinX ? i < 2 : i >= 4) ? M.door : M.frame));
    }
    const d = {
      id,
      box: b,
      plain,
      lamps: null,
      open: 0,
      target: 0,
      baseMin: b.min.clone(),
      baseMax: b.max.clone(),
      axis: opts.axis ?? 'y',
      latch: !!opts.latch, // uma vez aberta, fica aberta
      dist: opts.dist ?? Math.abs(y1 - y0) - 0.15,
      speed: opts.speed ?? 1.4,
      mesh: b.mesh,
      delta: new THREE.Vector3(),
      offset: new THREE.Vector3(),
    };
    this.doors.push(d);
    return d;
  }

  /** plataforma (elevador) que sobe/anda quando o sinal `id` liga; leva quem estiver em cima */
  platform(id, x0, y0, z0, x1, y1, z1, { axis = 'y', dist = 4, speed = 1.2, loop = 0, always = false } = {}) {
    const d = this.door(id, x0, y0, z0, x1, y1, z1, { axis, dist: 1, speed: speed / Math.abs(dist), mat: 'metal' });
    d.dist = dist;
    d.loop = loop; // >0: vai e volta (espera `loop` s em cada ponta) enquanto ligado
    d.always = always; // ligado desde o começo
    d.wait = loop;
    const top = Math.max(y0, y1);
    this.strip(Math.min(x0, x1) + 0.05, top + 0.005, Math.min(z0, z1) + 0.05, Math.max(x0, x1) - 0.05, top + 0.02, Math.min(z0, z1) + 0.12, 0xffcc33, 1.4).userData.follow = d;
    this.strip(Math.min(x0, x1) + 0.05, top + 0.005, Math.max(z0, z1) - 0.12, Math.max(x0, x1) - 0.05, top + 0.02, Math.max(z0, z1) - 0.05, 0xffcc33, 1.4).userData.follow = d;
    return d;
  }

  /**
   * Plataforma que vai e volta sozinha ao longo do vetor `to` (pode ser
   * diagonal), com `speed` m/s na ida e `back` m/s na volta, parando `waits`
   * segundos em cada ponta [início, fim]. `phase` (0..1) desencontra várias.
   * `crush`: esmaga quem ficar embaixo/no caminho (pistão).
   */
  mover(id, x0, y0, z0, x1, y1, z1, { to, speed = 4, back, waits = [0.6, 0.6], always = true, phase = 0, crush = false, mat = 'metal', marks = true } = {}) {
    const d = this.door(id, x0, y0, z0, x1, y1, z1, { mat });
    d.path = new THREE.Vector3(...to);
    const L = d.path.length();
    d.speed = speed / L;
    d.speedBack = (back ?? speed) / L;
    d.loop = 1;
    d.waits = waits;
    d.always = always;
    d.crush = crush;
    d.mover = true;
    d.open = phase;
    d.target = 1;
    d.wait = waits[1];
    if (marks) {
      const top = Math.max(y0, y1);
      const [ax, bx, az, bz] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)];
      const color = crush ? 0xff3a2a : 0xffcc33;
      for (const [sx0, sz0, sx1, sz1] of [
        [ax + 0.05, az + 0.05, bx - 0.05, az + 0.15],
        [ax + 0.05, bz - 0.15, bx - 0.05, bz - 0.05],
        [ax + 0.05, az + 0.05, ax + 0.15, bz - 0.05],
        [bx - 0.15, az + 0.05, bx - 0.05, bz - 0.05],
      ])
        this.strip(sx0, crush ? Math.min(y0, y1) - 0.02 : top + 0.005, sz0, sx1, crush ? Math.min(y0, y1) - 0.005 : top + 0.02, sz1, color, 1.6).userData.follow = d;
    }
    return d;
  }

  /**
   * Rampa: caixa girada (euler `rot` em radianos). De metal não aceita portal;
   * de concreto claro ('white') aceita — inclusive na diagonal. O motor de
   * física e os raios (tiros, bolas de energia) usam a caixa girada de verdade.
   */
  ramp(cx, cy, cz, sx, sy, sz, rot, matName = 'metal') {
    const M = materials()[matName];
    const half = new THREE.Vector3(sx / 2, sy / 2, sz / 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
    const c = new THREE.Vector3(cx, cy, cz);
    const mesh = new THREE.Mesh(worldBoxGeo(half.clone().negate(), half), M.faces ?? M.mat);
    mesh.position.copy(c);
    mesh.quaternion.copy(q);
    this.group.add(mesh);
    // caixa alinhada que envolve a rampa (para os testes rápidos)
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const p = new THREE.Vector3(x * half.x, y * half.y, z * half.z).applyQuaternion(q).add(c);
          min.min(p);
          max.max(p);
        }
    const b = { min, max, mat: matName, portalable: M.portalable, mesh, solid: true, obb: { c, q, qi: q.clone().invert(), half } };
    this.solids.push(b);
    this.physics?.addBox(b);
    return b;
  }

  // ------------------------------------------------- mapas importados (campanha)
  /** material de cada tipo de face importada; null = face escondida */
  importedMat(kind, faceIndex = 0) {
    const M = materials();
    if (!M.lamp) {
      M.lamp = { mat: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6e8).multiplyScalar(2.2), toneMapped: false }), portalable: false };
      M.darkFace = { mat: M.dark, portalable: false };
      M.hidden = new THREE.MeshBasicMaterial({ visible: false });
    }
    if (!kind) return M.hidden;
    if (kind === 'door') return M.door;
    if (kind === 'button') return (M.buttonFace ??= new THREE.MeshStandardMaterial({ color: 0xc0392b, emissive: 0x5a0a05, roughness: 0.5 }));
    const m = kind === 'dark' ? M.darkFace : kind === 'goo' ? M.magma : M[kind] ?? M.metal;
    return m.faces ? m.faces[faceIndex] : m.mat;
  }

  /** caixa alinhada com um tipo por face (ordem +x −x +y −y +z −z); aceita portal face a face */
  importedBox(min, max, faces, { solid = true, noRay = false, kinematic = false } = {}) {
    const mats = faces.map((k, i) => this.importedMat(k, i));
    const mesh = new THREE.Mesh(worldBoxGeo(min, max), mats);
    mesh.receiveShadow = true;
    if (faces.every((k) => !k)) mesh.visible = false;
    if (faces.includes('glass')) mesh.renderOrder = 5;
    this.group.add(mesh);
    const portalFaces = faces.map((k) => k === 'white');
    const b = {
      min: min.clone(),
      max: max.clone(),
      mat: faces.find((k) => k) ?? 'metal',
      portalable: portalFaces.some(Boolean),
      portalAt: (n) => portalFaces[Math.abs(n.x) > 0.5 ? (n.x > 0 ? 0 : 1) : Math.abs(n.y) > 0.5 ? (n.y > 0 ? 2 : 3) : n.z > 0 ? 4 : 5],
      surfaceFit: true,
      noRay,
      mesh,
      solid,
      imported: true,
    };
    if (solid) {
      this.solids.push(b);
      this.physics?.addBox(b, kinematic);
    }
    return b;
  }

  /**
   * Sólido convexo qualquer (pincel inclinado): `pts` são os vértices e
   * `planes` [{ n, d, kind }] as faces (n aponta para fora; dentro: n·p ≤ d).
   */
  convex(pts, planes, { solid = true, noRay = false, kinematic = false } = {}) {
    const pos = [];
    const uv = [];
    const geo = new THREE.BufferGeometry();
    const mats = [];
    let start = 0;
    planes.forEach((pl) => {
      const on = pts.filter((p) => Math.abs(pl.n.dot(p) - pl.d) < 2e-3);
      if (on.length < 3) return;
      const c = on.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / on.length);
      const t = new THREE.Vector3().subVectors(on[0], c).normalize();
      const bt = new THREE.Vector3().crossVectors(pl.n, t);
      on.sort((a, b) => {
        const da = a.clone().sub(c);
        const db = b.clone().sub(c);
        return Math.atan2(da.dot(bt), da.dot(t)) - Math.atan2(db.dot(bt), db.dot(t));
      });
      const ax = Math.abs(pl.n.x) > Math.abs(pl.n.y) && Math.abs(pl.n.x) > Math.abs(pl.n.z) ? 0 : Math.abs(pl.n.y) > Math.abs(pl.n.z) ? 1 : 2;
      const push = (p) => {
        pos.push(p.x, p.y, p.z);
        if (ax === 0) uv.push(p.z / TILE, p.y / TILE);
        else if (ax === 1) uv.push(p.x / TILE, p.z / TILE);
        else uv.push(p.x / TILE, p.y / TILE);
      };
      for (let i = 1; i + 1 < on.length; i++) {
        push(on[0]);
        push(on[i]);
        push(on[i + 1]);
      }
      const n = (on.length - 2) * 3;
      geo.addGroup(start, n, mats.length);
      mats.push(this.importedMat(pl.kind, pl.n.y > 0.7 ? 2 : pl.n.y < -0.7 ? 3 : 0));
      start += n;
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats);
    mesh.receiveShadow = true;
    if (planes.every((p) => !p.kind)) mesh.visible = false;
    if (planes.some((p) => p.kind === 'glass')) mesh.renderOrder = 5;
    this.group.add(mesh);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      min.min(p);
      max.max(p);
    }
    const b = {
      min,
      max,
      mat: planes.find((p) => p.kind)?.kind ?? 'metal',
      planes: planes.map((p) => ({ n: p.n.clone(), d: p.d, portal: p.kind === 'white' })),
      pts: pts.map((p) => p.clone()),
      portalable: planes.some((p) => p.kind === 'white'),
      portalAt: (n) => b.planes.some((p) => p.portal && p.n.dot(n) > 0.999),
      surfaceFit: true,
      noRay,
      mesh,
      solid,
      imported: true,
    };
    if (solid) {
      this.solids.push(b);
      this.physics?.addConvex(b, kinematic);
    }
    return b;
  }

  /** liga/desliga um sólido importado (func_brush com Enable/Disable) */
  setSolidEnabled(b, on) {
    b.mesh.visible = on && b.mesh.material !== undefined && (Array.isArray(b.mesh.material) ? b.mesh.material.some((m) => m.visible !== false) : true);
    b.disabled = !on;
    if (b.collider) b.collider.setEnabled(on);
  }

  /**
   * Painel diagonal de concreto claro (aceita portal): a face da frente tem
   * centro em `at` e aponta para `normal` (qualquer direção). `w` × `h` é o
   * tamanho da face; `up` orienta a altura (padrão: o "para cima" do mundo
   * projetado na face). Contorno aceso para dar para achar no meio do voo.
   * `stand`: altura do chão — põe uma coluna de metal embaixo do painel.
   */
  panel(at, normal, { w = 4, h = 5, t = 0.8, up = null, color = 0x8fe3ff, stand = null } = {}) {
    const n = new THREE.Vector3(...normal).normalize();
    const u = up ? new THREE.Vector3(...up) : Math.abs(n.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    u.projectOnPlane(n).normalize();
    const rgt = new THREE.Vector3().crossVectors(u, n).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rgt, u, n));
    const face = new THREE.Vector3(...at);
    const c = face.clone().addScaledVector(n, -t / 2);
    const e = new THREE.Euler().setFromQuaternion(q);
    const b = this.ramp(c.x, c.y, c.z, w, h, t, [e.x, e.y, e.z], 'white');
    // moldura acesa na face (grossa: dá para achar o painel de longe, no meio do voo)
    const hw = w / 2;
    const hh = h / 2;
    const pts = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, y]) => face.clone().addScaledVector(rgt, x).addScaledVector(u, y));
    const bar = 0.16;
    const frameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) });
    const bars = [
      [0, hh - bar / 2, w, bar],
      [0, -hh + bar / 2, w, bar],
      [-hw + bar / 2, 0, bar, h],
      [hw - bar / 2, 0, bar, h],
    ].map(([x, y, sx, sy]) => new THREE.BoxGeometry(sx, sy, 0.06).translate(x, y, 0.03));
    const frame = new THREE.Mesh(mergeGeometries(bars), frameMat);
    frame.position.copy(face);
    frame.quaternion.copy(q);
    this.group.add(frame);
    // setas no meio da face indicando para onde o painel "atira"
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.55 }));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    arrow.position.copy(face).addScaledVector(u, hh - 0.45).addScaledVector(n, 0.3);
    this.group.add(arrow);
    if (stand !== null) {
      const low = Math.min(...pts.map((p) => p.y)) - 0.2;
      const base = face.clone().addScaledVector(n, -t);
      if (low > stand) this.box(base.x - 0.3, stand, base.z - 0.3, base.x + 0.3, low, base.z + 0.3, 'metal');
    }
    b.panel = { n, up: u, right: rgt, face };
    return b;
  }

  /**
   * Grade de desintegração: um plano de luz que some com os portais de quem
   * passa por ela e desintegra objetos (que voltam ao dispensador). Também
   * barra os tiros da arma de portais.
   */
  fizzler(x0, y0, z0, x1, y1, z1) {
    const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const size = new THREE.Vector3().subVectors(max, min);
    const thin = size.y < Math.min(size.x, size.z) ? 'y' : size.x < size.z ? 'x' : 'z';
    const w = thin === 'x' ? size.z : size.x;
    const hgt = thin === 'y' ? size.z : size.y;
    const uniforms = {
      uTime: { value: 0 },
      uSize: { value: new THREE.Vector2(w, hgt) },
      uRipple: { value: new THREE.Vector3(0.5, 0.5, -99) }, // (u, v, instante) da última passagem
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FIZZLER_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), mat);
    plane.position.addVectors(min, max).multiplyScalar(0.5);
    if (thin === 'x') plane.rotation.y = Math.PI / 2;
    if (thin === 'y') plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = 6;
    this.group.add(plane);
    // emissores nas laterais: coluna escura com bobinas acesas que pulsam em
    // sequência, fenda de energia virada para a grade e tampas com aletas
    const M = materials();
    const coilMat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime },
      vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime; varying vec3 vP;
        void main(){
          float wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(vP.y * 3.0 - uTime * 7.0), 6.0);
          gl_FragColor = vec4(vec3(0.5, 1.2, 2.6) * wave, 1.0);
        }`,
      toneMapped: false,
    });
    const slitMat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime },
      vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime; varying vec3 vP;
        float h(float x){ return fract(sin(x * 91.7) * 43758.5); }
        void main(){
          float flick = 0.8 + 0.2 * h(floor(uTime * 30.0) + floor(vP.y * 6.0));
          float band = 0.6 + 0.4 * sin(vP.y * 11.0 + uTime * 9.0);
          gl_FragColor = vec4(vec3(0.7, 1.6, 3.0) * flick * band, 1.0);
        }`,
      toneMapped: false,
    });
    const along = thin === 'x' ? 'z' : 'x';
    for (const s of thin === 'y' ? [] : [-1, 1]) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, size.y, 0.34), M.frame);
      g.add(post);
      // bobinas
      const nCoils = Math.max(3, Math.floor(size.y / 0.55));
      for (let i = 0; i < nCoils; i++) {
        const y = -size.y / 2 + 0.35 + (i * (size.y - 0.7)) / Math.max(1, nCoils - 1);
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20).rotateX(Math.PI / 2), coilMat);
        coil.position.y = y;
        g.add(coil);
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 16), M.dark);
        collar.position.y = y + 0.06;
        g.add(collar);
      }
      // fenda virada para o campo
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.06, size.y - 0.4, 0.04), slitMat);
      slit.position.x = -s * 0.19;
      g.add(slit);
      // tampas com aletas
      for (const e of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), M.dark);
        cap.position.y = (e * (size.y - 0.16)) / 2;
        g.add(cap);
        for (let k = -1; k <= 1; k++) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.5), M.frame);
          fin.position.set(k * 0.12, cap.position.y + e * 0.12, 0);
          g.add(fin);
        }
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.04), coilMat);
        lamp.position.set(0, cap.position.y, 0.255);
        g.add(lamp);
      }
      g.position.copy(plane.position);
      g.position[along] += (s * w) / 2;
      if (thin === 'x') g.rotation.y = Math.PI / 2;
      this.group.add(g);
    }
    // faíscas soltas subindo junto ao campo
    const N = Math.min(240, Math.floor(w * hgt * 4));
    const seeds = new Float32Array(N * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    const motes = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: uniforms.uTime, uSize: uniforms.uSize, uH: { value: 800 } },
        vertexShader: `
          attribute vec3 seed; uniform float uTime, uH; uniform vec2 uSize; varying float vA;
          void main(){
            float life = fract(uTime * (0.08 + seed.z * 0.12) + seed.y);
            vec3 p = vec3((seed.x - 0.5) * uSize.x, (life - 0.5) * uSize.y, (seed.z - 0.5) * 0.12);
            p.x += sin(uTime * 2.0 + seed.y * 20.0) * 0.05;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = 0.03 * projectionMatrix[1][1] * uH / max(-mv.z, 0.1);
            vA = sin(life * 3.14159) * (0.4 + 0.6 * step(0.7, fract(seed.x * 13.0 + uTime * 3.0)));
          }`,
        fragmentShader: `
          varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vec3(0.7, 1.5, 3.0), vA * (1.0 - d)); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    motes.position.copy(plane.position);
    motes.rotation.copy(plane.rotation);
    motes.frustumCulled = false;
    this.group.add(motes);
    this.anim.push((t) => {
      uniforms.uTime.value = t;
      motes.material.uniforms.uH.value = window.innerHeight * 0.75;
    });
    const pad = new THREE.Vector3(thin === 'x' ? 0.1 : 0, thin === 'y' ? 0.1 : 0, thin === 'z' ? 0.1 : 0);
    const f = { min: min.clone().sub(pad), max: max.clone().add(pad), axis: thin, plane, uniforms };
    this.fizzlers.push(f);
    return f;
  }

  /** onda no campo da grade no ponto `p` (algo atravessou ou foi desintegrado) */
  fizzlerRipple(f, p, t) {
    const l = f.plane.worldToLocal(p.clone());
    f.uniforms.uRipple.value.set(l.x / f.uniforms.uSize.value.x + 0.5, l.y / f.uniforms.uSize.value.y + 0.5, t);
  }

  /** o segmento a→b passa por alguma grade? (quedas rápidas atravessam a grade fina num só quadro) */
  segmentFizzler(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-6) return this.fizzlers.find((f) => a.x > f.min.x && a.x < f.max.x && a.y > f.min.y && a.y < f.max.y && a.z > f.min.z && a.z < f.max.z) ?? null;
    return this.rayFizzler(a, d.divideScalar(len), len) ? true : null;
  }

  /** o raio cruza uma grade de desintegração antes de `maxDist`? */
  rayFizzler(origin, dir, maxDist) {
    for (const f of this.fizzlers) {
      let t0 = 0;
      let t1 = maxDist;
      for (const a of ['x', 'y', 'z']) {
        if (Math.abs(dir[a]) < 1e-9) {
          if (origin[a] < f.min[a] || origin[a] > f.max[a]) t0 = Infinity;
          continue;
        }
        let ta = (f.min[a] - origin[a]) / dir[a];
        let tb = (f.max[a] - origin[a]) / dir[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      if (t0 <= t1) return origin.clone().addScaledVector(dir, t0);
    }
    return null;
  }

  /** tubo no teto que solta a amostra (e solta outra quando ela é desintegrada) */
  dispenser(x, top, z) {
    const g = new THREE.Group();
    const metal = materials().metal.mat;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.2, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    tube.position.y = -1.1;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.35, 32), metal);
    collar.position.y = -0.17;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.06, 10, 32).rotateX(Math.PI / 2), metal);
    lip.position.y = -2.2;
    g.add(tube, collar, lip);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.06), metal);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      rib.position.set(Math.cos(a) * 0.64, -1.1, Math.sin(a) * 0.64);
      g.add(rib);
    }
    // anel aceso no colar e luz de aviso
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.3), toneMapped: false });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.025, 8, 40).rotateX(Math.PI / 2), lampMat);
    band.position.y = -0.3;
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 8, 32).rotateX(Math.PI / 2), materials().dark);
    hatch.position.y = -2.1;
    g.add(band, hatch);
    for (let i = 0; i < 3; i++) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.645, 0.02, 6, 32).rotateX(Math.PI / 2), metal);
      hoop.position.y = -0.6 - i * 0.6;
      g.add(hoop);
    }
    this.anim.push((t) => lampMat.color.setRGB(2.4, 1.6, 0.3).multiplyScalar(0.7 + 0.3 * Math.sin(t * 2.2)));
    g.position.set(x, top, z);
    this.group.add(g);
    return [x, top - 1.6, z];
  }

  /** pedestal com a arma de portais (ou a melhoria dela) */
  /** `height`: altura da arma acima da base (o pedestal estica até lá); padrão 1,45 m */
  pedestal(x, y, z, gives, model, { height = 1.45 } = {}) {
    const g = new THREE.Group();
    const metal = materials().metal.mat;
    const col = Math.max(0.15, height - 0.45);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.0, 32), metal);
    base.scale.y = col;
    base.position.y = col / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.6) }));
    ring.position.y = col + 0.02;
    g.add(base, ring);
    const holder = new THREE.Group();
    holder.position.y = height;
    if (model) holder.add(model);
    g.add(holder);
    const light = new THREE.PointLight(0x9fd8ff, 4, 5, 1.6);
    light.position.y = height + 0.15;
    g.add(light);
    g.position.set(x, y, z);
    this.group.add(g);
    this.anim.push((t) => {
      holder.rotation.y = t * 0.8;
      holder.position.y = height + Math.sin(t * 2) * 0.05;
    });
    const p = { pos: new THREE.Vector3(x, y + height - 0.45, z), gives, group: holder, taken: false, light };
    this.pedestals.push(p);
    return p;
  }


  /** lançador de bola de energia na parede (normal = para onde atira) */
  launcher(x, y, z, normal, opts = {}) {
    const n = new THREE.Vector3(...normal);
    const g = this.socket(n, 0xffb347);
    g.position.set(x, y, z);
    const L = { pos: new THREE.Vector3(x, y, z).addScaledVector(n, 0.35), dir: n, group: g, pellet: null, wait: opts.delay ?? 1, life: opts.life ?? 12, speed: opts.speed ?? 6.5, done: false };
    this.launchers.push(L);
    return L;
  }

  /** receptor da bola de energia: liga o sinal `opens` quando recebe uma (`radius`: raio de captura) */
  catcher(x, y, z, normal, opens, { radius = 0.8 } = {}) {
    const n = new THREE.Vector3(...normal);
    const g = this.socket(n, 0x6fc8ff);
    g.position.set(x, y, z);
    const C = { pos: new THREE.Vector3(x, y, z).addScaledVector(n, 0.25), normal: n, opens, active: false, group: g, radius };
    this.catchers.push(C);
    return C;
  }

  /** soquete redondo na parede (lançador/receptor) com o anel aceso */
  socket(n, color) {
    const g = new THREE.Group();
    const metal = materials().metal.mat;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.12, 32), metal);
    plate.position.y = 0.06;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.35, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
    cup.position.y = 0.25;
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.04, 8, 40).rotateX(Math.PI / 2), glowMat);
    ring.position.y = 0.42;
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.3), metal);
      const a = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.62, 0.25, Math.sin(a) * 0.62);
      fin.rotation.y = -a;
      g.add(fin);
    }
    g.add(plate, cup, ring);
    // anel interno com aletas, girando (mais rápido quando ativo)
    const spin = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 32).rotateX(Math.PI / 2), materials().frame);
    spin.add(inner);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), glowMat);
      vane.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
      vane.rotation.y = -a;
      spin.add(vane);
    }
    spin.position.y = 0.15;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), materials().dark);
    hub.position.y = 0.12;
    g.add(spin, hub);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 6), materials().frame);
      bolt.position.set(Math.cos(a) * 0.7, 0.13, Math.sin(a) * 0.7);
      g.add(bolt);
    }
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    g.userData.glow = glowMat;
    g.userData.spin = spin;
    this.group.add(g);
    return g;
  }

  /** fornalha: o que cair dentro é destruído (e liga o sinal `opens`) */
  incinerator(x0, y0, z0, x1, y1, z1, opens) {
    const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(max.x - min.x, 0.05, max.z - min.z),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.1, 0.2) }),
    );
    glow.position.set((min.x + max.x) / 2, min.y + 0.02, (min.z + max.z) / 2);
    this.group.add(glow);
    const light = new THREE.PointLight(0xff7a20, 18, 8, 1.6);
    light.position.copy(glow.position).add(new THREE.Vector3(0, 0.8, 0));
    this.group.add(light);
    this.anim.push((t) => (light.intensity = 14 + Math.sin(t * 9) * 3 + Math.sin(t * 23) * 2));
    const I = { min, max, opens, active: false };
    this.incinerators.push(I);
    return I;
  }

  button(x, y, z, opens) {
    const { group: g, plate, lights, spin } = floorButton();
    g.position.set(x, y, z);
    this.group.add(g);
    const btn = { pos: new THREE.Vector3(x, y, z), opens, pressed: false, plate, lights, spin, group: g };
    this.buttons.push(btn);
    return btn;
  }

  /** elevador de saída (tubo de vidro iluminado) + gatilho de fim de fase */
  exitElevator(x, y, z, flipped = false, { era = null } = {}) {
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
    const M = materials();
    // colunas da estrutura, tampa de cima e piso de grade
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, 0.16), M.frame);
      col.position.set(Math.cos(a) * 1.3, 1.6 * s, Math.sin(a) * 1.3);
      col.rotation.y = -a;
      g.add(col);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.22, 40), M.frame);
    cap.position.y = 3.3 * s;
    g.add(cap);
    const grate = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 1.2, 40, 1).rotateX(-Math.PI / 2 * s),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.8, map: grateTexture(), transparent: true, alphaTest: 0.5 }),
    );
    grate.position.y = 0.16 * s;
    g.add(grate);
    // anel de luz que sobe pelo tubo e partículas subindo
    const scan = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.025, 6, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 1.3), transparent: true, toneMapped: false }));
    g.add(scan);
    const N = 60;
    const pg = new THREE.BufferGeometry();
    const seeds = Float32Array.from({ length: N * 3 }, () => Math.random());
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: new THREE.Color(0.5, 2.2, 1.2), size: 0.05, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    motes.frustumCulled = false;
    g.add(motes);
    const l = new THREE.PointLight(0x7dffb0, 14, 8, 1.5);
    l.position.y = 2 * s;
    g.add(l);
    g.position.set(x, y, z);
    this.group.add(g);
    this.anim.push((t) => {
      tube.material.opacity = 0.18 + Math.sin(t * 3) * 0.06;
      const k = (t * 0.45) % 1;
      scan.position.y = (0.2 + k * 3) * s;
      scan.material.opacity = Math.sin(k * Math.PI);
      const p = pg.attributes.position;
      for (let i = 0; i < N; i++) {
        const a = seeds[i * 3] * Math.PI * 2 + t * 0.3;
        const r = 0.3 + seeds[i * 3 + 1] * 0.85;
        p.setXYZ(i, Math.cos(a) * r, (((seeds[i * 3 + 2] * 3 + t * (0.4 + seeds[i * 3 + 1] * 0.5)) % 3) + 0.2) * s, Math.sin(a) * r);
      }
      p.needsUpdate = true;
    });
    if (era) {
      // elevador que só existe numa época (a luz dele também)
      this.inEra(g, era);
      this.inEra(l, era);
    }
    return this.trigger(x - 1, flipped ? y - 3 : y, z - 1, x + 1, flipped ? y : y + 3, z + 1, { exit: true, era });
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

  /**
   * Indicadores acima da porta (vermelho fechada, verde aberta), dos dois
   * lados. Ficam na face da parede acima da porta, achada com um raio (por
   * isso são montados no primeiro quadro, com a fase toda construída).
   */
  doorLamps(d, t) {
    if (!d.lamps) {
      d.lamps = [];
      const size = new THREE.Vector3().subVectors(d.baseMax, d.baseMin);
      const thin = size.x < size.z ? 'x' : 'z';
      const wide = thin === 'x' ? 'z' : 'x';
      const c = new THREE.Vector3().addVectors(d.baseMin, d.baseMax).multiplyScalar(0.5);
      const M = materials();
      for (const s of [-1, 1]) {
        const dir = new THREE.Vector3().setComponent(thin === 'x' ? 0 : 2, -s);
        const from = c.clone().setY(d.baseMax.y + 0.32);
        from[thin] += s * 2;
        const hit = this.raycast(from, dir, 2.2, (b) => b !== d.box && !this.doors.some((o) => o.box === b));
        if (!hit) continue;
        const g = new THREE.Group();
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.05), M.frame);
        g.add(plate);
        const mat = new THREE.MeshBasicMaterial({ color: RED.clone(), toneMapped: false });
        for (const k of [-1, 0, 1]) {
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 20).rotateX(Math.PI / 2), mat);
          lens.position.set(k * 0.26, 0, 0.03);
          g.add(lens);
        }
        g.position.copy(hit.point).addScaledVector(hit.normal, 0.025);
        g.lookAt(g.position.clone().add(hit.normal));
        this.group.add(g);
        d.lamps.push(mat);
        // moldura dos dois lados da abertura (na mesma face)
        for (const e of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, size.y + 0.14, 0.06), M.frame);
          post.position.copy(c);
          post.position[wide] += (e * (size[wide] + 0.14)) / 2;
          post.position.y += 0.07;
          post.position[thin] = hit.point[thin] + hit.normal.getComponent(thin === 'x' ? 0 : 2) * 0.03;
          post.lookAt(post.position.clone().add(hit.normal));
          this.group.add(post);
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(size[wide] + 0.42, 0.14, 0.06), M.frame);
        lintel.position.copy(c).setY(d.baseMax.y + 0.07);
        lintel.position[thin] = hit.point[thin] + hit.normal.getComponent(thin === 'x' ? 0 : 2) * 0.03;
        lintel.lookAt(lintel.position.clone().add(hit.normal));
        this.group.add(lintel);
      }
    }
    const blink = d.open > 0.02 && d.open < 0.98 ? 0.6 + 0.4 * Math.sin(t * 18) : 1;
    _c.lerpColors(RED, GREEN, THREE.MathUtils.smoothstep(d.open, 0.1, 0.9)).multiplyScalar(blink);
    for (const m of d.lamps) m.color.copy(_c);
  }


  // ================================================================== série Fronteira
  /**
   * Prende algo a uma época (viagem no tempo): caixa (sólida ou perigo),
   * luz ou qualquer objeto. Na outra época a caixa some (deixa de colidir), a
   * luz apaga e o objeto fica invisível.
   */
  inEra(obj, era) {
    const item = { obj, era };
    if (obj.isLight) item.k = obj.intensity;
    this.eraItems.push(item);
    this.applyEra(item);
    return obj;
  }

  applyEra(item) {
    const on = item.era === this.era;
    const o = item.obj;
    if (o.isLight) o.intensity = on ? item.k : 0;
    else if (o.isObject3D) o.visible = on;
    else {
      // caixa do cenário (sólida ou de perigo)
      o.mesh.visible = on;
      const list = o.isHazard ? this.hazards : o.solid ? this.solids : null;
      if (list) {
        const i = list.indexOf(o);
        if (on && i < 0) list.push(o);
        if (!on && i >= 0) list.splice(i, 1);
      }
      o.collider?.setEnabled(on);
      o.active = on;
    }
  }

  setEra(era) {
    this.era = era;
    for (const it of this.eraItems) this.applyEra(it);
  }

  /** a caixa existe na época atual? (as sem época existem sempre) */
  live(b) {
    return b.active !== false;
  }

  // ------------------------------------------------------------------ laser
  /** emissor de laser na parede/chão (`dir` = para onde o feixe sai) */
  laser(x, y, z, dir) {
    const d = new THREE.Vector3(...dir).normalize();
    const M = materials();
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), M.frame);
    plate.position.y = 0.06;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.35, 6), M.dark);
    body.position.y = 0.3;
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 20), lensMat);
    lens.position.y = 0.5;
    g.add(plate, body, lens);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.14), M.frame);
      fin.position.set(Math.cos(a) * 0.3, 0.26, Math.sin(a) * 0.3);
      fin.rotation.y = -a;
      g.add(fin);
    }
    g.position.set(x, y, z);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    this.group.add(g);
    const L = { pos: new THREE.Vector3(x, y, z).addScaledVector(d, 0.55), dir: d, group: g, lensMat };
    this.lasers.push(L);
    return L;
  }

  /** receptor de laser: liga o sinal `opens` enquanto o feixe acerta */
  laserCatcher(x, y, z, normal, opens) {
    const n = new THREE.Vector3(...normal).normalize();
    const g = this.socket(n, 0xff5a3a);
    g.position.set(x, y, z);
    g.scale.setScalar(0.72);
    // acerta quem bater na parede até 0,75 m do centro do receptor
    const C = { pos: new THREE.Vector3(x, y, z), normal: n, opens, active: false, group: g };
    this.laserCatchers.push(C);
    return C;
  }

  // ------------------------------------------------------------------ placa de lançamento
  /**
   * Placa de lançamento (no chão): quem pisa (ou o que cair nela) sai voando
   * com a velocidade `vel`. A placa abre como uma tampa ao disparar.
   */
  faithPlate(x, y, z, vel, { target = null } = {}) {
    const v = new THREE.Vector3(...vel);
    const M = materials();
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 2.2), M.frame);
    frame.position.y = 0.08;
    g.add(frame);
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.6), toneMapped: false });
    // tampa articulada na borda de trás (oposta à direção do lançamento)
    const flat = new THREE.Vector3(v.x, 0, v.z);
    const yaw = flat.lengthSq() > 1e-4 ? Math.atan2(flat.x, flat.z) : 0;
    const hinge = new THREE.Group();
    hinge.position.set(-Math.sin(yaw) * 0.95, 0.17, -Math.cos(yaw) * 0.95);
    hinge.rotation.y = yaw;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 1.9), materials().white.mat);
    lid.position.set(0, 0, 0.95);
    hinge.add(lid);
    // seta acesa na tampa
    const arrow = new THREE.Shape();
    arrow.moveTo(-0.25, -0.35);
    arrow.lineTo(0, 0.1);
    arrow.lineTo(0.25, -0.35);
    arrow.lineTo(0.25, -0.15);
    arrow.lineTo(0, 0.3);
    arrow.lineTo(-0.25, -0.15);
    arrow.closePath();
    for (const dz of [0.6, 1.25]) {
      const a = new THREE.Mesh(new THREE.ShapeGeometry(arrow), glowMat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(0, 0.045, dz);
      hinge.add(a);
    }
    g.add(hinge);
    // pistões
    for (const sx of [-0.6, 0.6]) {
      const pis = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10), M.dark);
      pis.position.set(Math.cos(yaw) * sx, 0.12, -Math.sin(yaw) * sx);
      g.add(pis);
    }
    g.position.set(x, y, z);
    this.group.add(g);
    const P = { pos: new THREE.Vector3(x, y, z), vel: v, hinge, glowMat, cool: 0, kick: 0 };
    this.plates.push(P);
    // marcador no ponto de pouso
    if (target) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.6), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }));
      ring.position.set(target[0], target[1] + 0.02, target[2]);
      this.group.add(ring);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2), ring.material);
      dot.position.copy(ring.position);
      this.group.add(dot);
      this.anim.push((t) => ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06));
    }
    return P;
  }

  /**
   * Placa que joga de (x, y, z) até o ponto (tx, ty, tz) passando a `apex`
   * metros acima do mais alto dos dois (gravidade normal).
   */
  faithPlateTo(x, y, z, tx, ty, tz, apex = 4, g = 9.8) {
    const top = Math.max(y, ty) + apex;
    const vy = Math.sqrt(2 * g * (top - y));
    const T = vy / g + Math.sqrt((2 * (top - ty)) / g);
    return this.faithPlate(x, y, z, [(tx - x) / T, vy, (tz - z) / T], { target: [tx, ty, tz] });
  }

  // ------------------------------------------------------------------ funil de excursão
  /**
   * Funil de excursão: um feixe largo que carrega o que estiver dentro (sem
   * gravidade) a 4 m/s, atravessa portais e vira de sentido com o sinal `id`
   * (azul = para longe do emissor, laranja = puxando de volta).
   */
  funnel(x, y, z, dir, { id = null, reversed = false, speed = 4, power = null } = {}) {
    const d = new THREE.Vector3(...dir).normalize();
    const M = materials();
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.25, 32), M.frame);
    base.position.y = 0.12;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.8), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.07, 10, 48).rotateX(Math.PI / 2), ringMat);
    ring.position.y = 0.28;
    g.add(base, ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.4), M.dark);
      fin.position.set(Math.cos(a) * 1.55, 0.3, Math.sin(a) * 1.55);
      fin.rotation.y = -a;
      g.add(fin);
    }
    g.position.set(x, y, z);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    this.group.add(g);
    const F = { pos: new THREE.Vector3(x, y, z).addScaledVector(d, 0.3), dir: d, id, reversed, startReversed: reversed, speed, power, off: !!power, group: g, ringMat, segs: [] };
    this.funnels.push(F);
    return F;
  }

  // ------------------------------------------------------------------ gravidade
  /** volume com gravidade própria `g` (ex.: [0, 9.8, 0] = invertida, [0, 0, 0] = sem peso) */
  gravZone(x0, y0, z0, x1, y1, z1, g, color = 0xb06cff) {
    const min = new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const size = new THREE.Vector3().subVectors(max, min);
    const gv = new THREE.Vector3(...g);
    const dir = gv.lengthSq() > 1e-4 ? gv.clone().normalize() : new THREE.Vector3(0, 0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDir: { value: dir }, uColor: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform float uTime; uniform vec3 uDir, uColor; varying vec3 vP; varying vec3 vN;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main(){
          // faixas correndo no sentido da gravidade (paradas e tremendo sem gravidade)
          float along = dot(vP, length(uDir) > 0.5 ? uDir : vec3(0.0, 1.0, 0.0));
          float speed = length(uDir) > 0.5 ? 1.2 : 0.15;
          float bands = pow(0.5 + 0.5 * sin(along * 3.0 - uTime * speed * 6.0), 8.0);
          vec3 cell = floor(vP * 2.0);
          float twinkle = step(0.97, h(cell)) * (0.5 + 0.5 * sin(uTime * 4.0 + h(cell) * 30.0));
          float a = 0.05 + bands * 0.12 + twinkle * 0.25;
          gl_FragColor = vec4(uColor * 1.6, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.addVectors(min, max).multiplyScalar(0.5);
    mesh.renderOrder = 6;
    this.group.add(mesh);
    // contorno aceso nas arestas
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), toneMapped: false }));
    edges.position.copy(mesh.position);
    this.group.add(edges);
    this.anim.push((t) => (mat.uniforms.uTime.value = t));
    const Z = { min, max, g: gv, mesh };
    this.gravZones.push(Z);
    return Z;
  }

  /**
   * Buraco negro: puxa tudo (jogador, objetos, bolas de energia) com força
   * `strength`/d² até `reach` metros; dentro do horizonte, nada volta.
   */
  blackHole(x, y, z, { strength = 900, horizon = 1.2, reach = 40 } = {}) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const core = new THREE.Mesh(new THREE.SphereGeometry(horizon, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    g.add(core);
    // anel de fótons e brilho em volta (sempre virado para a câmera)
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(horizon * 7, horizon * 7),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform float uTime; varying vec2 vUv;
          void main(){
            vec2 p = (vUv - 0.5) * 7.0;
            float r = length(p);
            float ring = exp(-pow((r - 1.35) * 6.0, 2.0)) * 1.6;
            float glow = exp(-(r - 1.0) * 1.2) * 0.35 * step(1.0, r);
            float a = atan(p.y, p.x);
            float flick = 0.85 + 0.15 * sin(a * 7.0 + uTime * 3.0);
            vec3 col = vec3(1.0, 0.75, 0.45) * ring * flick + vec3(0.6, 0.35, 1.0) * glow;
            gl_FragColor = vec4(col, clamp(ring + glow, 0.0, 1.0) * step(1.0, r));
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    halo.renderOrder = 7;
    g.add(halo);
    // disco de acreção girando
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(horizon * 1.6, horizon * 5.5, 96, 4),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uIn: { value: horizon * 1.6 }, uOut: { value: horizon * 5.5 } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform float uTime, uIn, uOut; varying vec2 vP;
          float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
          float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main(){
            float r = length(vP);
            float k = (r - uIn) / (uOut - uIn);
            float a = atan(vP.y, vP.x);
            float swirl = a + uTime * (2.4 / (0.4 + k * 3.0)) - log(r) * 3.0;
            float n = n2(vec2(swirl * 3.0, r * 2.0)) * 0.6 + n2(vec2(swirl * 9.0, r * 6.0)) * 0.4;
            vec3 hot = mix(vec3(3.0, 2.4, 1.6), vec3(2.2, 0.6, 0.15), smoothstep(0.0, 0.7, k));
            float alpha = (1.0 - smoothstep(0.6, 1.0, k)) * smoothstep(0.0, 0.05, k) * (0.35 + 0.65 * n);
            gl_FragColor = vec4(hot * (0.6 + 0.8 * n), alpha);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    disk.rotation.x = -Math.PI / 2 + 0.35;
    g.add(disk);
    // partículas caindo em espiral
    const N = 400;
    const pg = new THREE.BufferGeometry();
    const seeds = Float32Array.from({ length: N * 3 }, () => Math.random());
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    pg.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    const motes = new THREE.Points(
      pg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uH: { value: 800 }, uIn: { value: horizon }, uOut: { value: horizon * 9 } },
        vertexShader: `
          attribute vec3 seed; uniform float uTime, uH, uIn, uOut; varying float vA;
          void main(){
            float life = fract(uTime * (0.05 + seed.x * 0.08) + seed.y);
            float r = mix(uOut, uIn, life * life);
            float ang = seed.z * 6.2831 + uTime * (0.6 + 3.0 / r) * (1.0 + life * 2.0);
            vec3 p = vec3(cos(ang) * r, (seed.x - 0.5) * r * 0.25 * (1.0 - life), sin(ang) * r);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = 0.06 * projectionMatrix[1][1] * uH / max(-mv.z, 0.1);
            vA = sin(life * 3.14159);
          }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vec3(2.4, 1.4, 0.7), vA * (1.0 - d)); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    motes.frustumCulled = false;
    g.add(motes);
    const light = new THREE.PointLight(0xffa060, 30, reach * 0.8, 1.6);
    g.add(light);
    this.group.add(g);
    this.anim.push((t) => {
      halo.material.uniforms.uTime.value = t;
      disk.material.uniforms.uTime.value = t;
      motes.material.uniforms.uTime.value = t;
      motes.material.uniforms.uH.value = window.innerHeight * 0.75;
    });
    const B = { pos: new THREE.Vector3(x, y, z), strength, horizon, reach, group: g };
    this.blackHoles.push(B);
    return B;
  }

  // ------------------------------------------------------------------ Lua
  /**
   * A Lua no céu (vista por uma claraboia): atirar um portal nela abre o
   * portal no `spot` da superfície lunar (lá longe, na área da fase com
   * gravidade lunar). Devolve { pos, r, spot }.
   */
  moon(x, y, z, r, spot) {
    const tex = moonTexture();
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 1 }));
    m.position.set(x, y, z);
    this.group.add(m);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xbcd0ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(r * 3.4);
    glow.position.copy(m.position);
    this.group.add(glow);
    this.anim.push((t) => (m.rotation.y = t * 0.01));
    this.moonInfo = { pos: m.position.clone(), r, spot };
    return this.moonInfo;
  }

  /** a Terra vista da Lua */
  earth(x, y, z, r) {
    const tex = earthTexture();
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.8 }));
    m.position.set(x, y, z);
    m.rotation.z = 0.4;
    this.group.add(m);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0x6fb0ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(r * 3);
    glow.position.copy(m.position);
    this.group.add(glow);
    this.anim.push((t) => (m.rotation.y = t * 0.02));
    return m;
  }

  /** céu estrelado (esfera de pontos em volta de `center`) */
  stars(center = [0, 0, 0], radius = 900, n = 3000) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(radius);
      pos.set([v.x + center[0], v.y + center[1], v.z + center[2]], i * 3);
      const k = 0.5 + Math.random() * 1.5;
      const warm = Math.random();
      col.set([k * (0.8 + warm * 0.2), k * 0.9, k * (1.1 - warm * 0.3)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: true, vertexColors: true, toneMapped: false, depthWrite: false }));
    pts.frustumCulled = false;
    this.group.add(pts);
    return pts;
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
      if (b.noRay || b.disabled) continue;
      if (b.planes) {
        const h = rayConvex(origin, dir, b.planes, maxDist);
        if (h && (!best || h.dist < best.dist)) best = { box: b, ...h, axis: -1 };
        continue;
      }
      if (b.obb) {
        const h = rayObb(origin, dir, b.obb, maxDist);
        if (h && (!best || h.dist < best.dist)) best = { box: b, ...h, axis: -1 };
        continue;
      }
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
      if (b === except || b.disabled) continue;
      if (b.planes) {
        if (b.planes.every((pl) => pl.n.dot(p) < pl.d)) return b;
        continue;
      }
      if (b.obb) {
        const l = p.clone().sub(b.obb.c).applyQuaternion(b.obb.qi);
        if (Math.abs(l.x) < b.obb.half.x && Math.abs(l.y) < b.obb.half.y && Math.abs(l.z) < b.obb.half.z) return b;
        continue;
      }
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return b;
    }
    return null;
  }

  update(t, dt) {
    for (const f of this.anim) f(t, dt);
    const magma = materials().magma.mat.map;
    magma.offset.set(t * 0.02, t * 0.013);
    materials().magma.mat.emissiveIntensity = 0.95 + Math.sin(t * 1.7) * 0.2;
    for (const d of this.doors) {
      // movimento próprio (trem/elevador da campanha importada, que segue trilhos)
      if (d.drive) {
        d.drive(dt);
        continue;
      }
      // caminho: vetor qualquer (plataformas diagonais) ou um eixo × distância (portas)
      const path = d.path ?? _path.set(0, 0, 0);
      if (!d.path) path[d.axis] = d.dist;
      const before = d.open;
      const sp = d.target < d.open && d.speedBack ? d.speedBack : d.speed;
      d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * sp);
      d.delta.copy(path).multiplyScalar(d.open - before);
      d.offset.copy(path).multiplyScalar(d.open);
      d.box.min.copy(d.baseMin).add(d.offset);
      d.box.max.copy(d.baseMax).add(d.offset);
      d.mesh.position.copy(d.offset);
      this.physics?.moveBox(d.box);
      if (d.plain) this.doorLamps(d, t);
    }
    for (const P of this.plates) {
      // tampa abre de uma vez e volta devagar; setas piscam carregando
      P.kick = Math.max(0, P.kick - dt * 1.6);
      P.hinge.rotation.x = -Math.min(1, P.kick * 3) * 0.85;
      const ready = P.cool <= 0;
      P.glowMat.color.setRGB(0.4, 1.6, 2.6).multiplyScalar(ready ? 0.8 + 0.2 * Math.sin(t * 6) : 0.25);
    }
    for (const b of this.buttons) {
      // a placa afunda com mola e as luzes trocam de cor aos poucos
      const k = b.pressed ? 1 : 0;
      b.v = (b.v ?? 0) + ((k - (b.k ?? 0)) * 260 - (b.v ?? 0) * 18) * dt;
      b.k = (b.k ?? 0) + b.v * dt;
      b.plate.position.y = 0.16 - 0.07 * THREE.MathUtils.clamp(b.k, -0.3, 1.3);
      b.c = (b.c ?? 0) + (k - (b.c ?? 0)) * Math.min(1, dt * 8);
      b.plate.material.color.lerpColors(_c.set(0xc0392b), new THREE.Color(0x27ae60), b.c);
      b.plate.material.emissive.lerpColors(_c.set(0x5a0a05), new THREE.Color(0x0a4a20), b.c);
      b.lights.color.lerpColors(RED, GREEN, b.c);
      if (b.spin) b.spin.rotation.y += dt * (0.4 + b.c * 2.5);
    }
    for (const c of this.group.children) {
      const f = c.userData.follow;
      if (!f) continue;
      c.userData.base ??= c.position.clone();
      c.position.copy(c.userData.base).add(f.offset);
    }
  }
}
