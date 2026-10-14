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

  light(x, y, z, intensity = 40, color = 0xfff4e6, dist = 30) {
    const l = new THREE.PointLight(color, intensity, dist, 1.5);
    l.position.set(x, y, z);
    this.group.add(l);
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
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: new THREE.Vector2(w, hgt) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec2 uSize; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 p = vUv * uSize;
          float lines = pow(abs(sin(p.y * 9.0 - uTime * 1.5)), 40.0) * 0.6;
          float ripple = 0.5 + 0.5 * sin(p.x * 3.0 + uTime * 2.0 + sin(p.y * 2.0 + uTime));
          vec2 cell = floor(p * vec2(14.0, 14.0) + vec2(0.0, uTime * 6.0));
          float spark = step(0.985, h(cell)) * (0.6 + 0.4 * sin(uTime * 20.0 + h(cell) * 6.28));
          float edge = smoothstep(0.08, 0.0, vUv.x) + smoothstep(0.92, 1.0, vUv.x);
          float a = 0.08 + 0.10 * ripple + lines + spark + edge * 0.35;
          gl_FragColor = vec4(vec3(0.45, 0.8, 1.0) * (1.0 + spark * 2.0), clamp(a, 0.0, 0.85));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), mat);
    plane.position.addVectors(min, max).multiplyScalar(0.5);
    if (thin === 'x') plane.rotation.y = Math.PI / 2;
    if (thin === 'y') plane.rotation.x = -Math.PI / 2;
    this.group.add(plane);
    // emissores nas laterais
    const emit = materials().frame;
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 2.6), toneMapped: false });
    for (const s of thin === 'y' ? [] : [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(thin === 'x' ? 0.3 : 0.14, size.y, thin === 'x' ? 0.14 : 0.3), emit);
      post.position.copy(plane.position);
      post.position[thin === 'x' ? 'z' : 'x'] += (s * w) / 2;
      // fenda acesa virada para a grade
      const slit = new THREE.Mesh(new THREE.BoxGeometry(thin === 'x' ? 0.06 : 0.02, size.y - 0.2, thin === 'x' ? 0.02 : 0.06), stripMat);
      slit.position.copy(post.position);
      slit.position[thin === 'x' ? 'z' : 'x'] -= s * 0.07;
      // tampas em cima e embaixo
      for (const e of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(thin === 'x' ? 0.36 : 0.2, 0.12, thin === 'x' ? 0.2 : 0.36), materials().dark);
        cap.position.copy(post.position);
        cap.position.y += (e * (size.y - 0.12)) / 2;
        this.group.add(cap);
      }
      this.group.add(post, slit);
    }
    this.anim.push((t) => {
      mat.uniforms.uTime.value = t;
      stripMat.color.setRGB(0.6, 1.4, 2.6).multiplyScalar(0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3));
    });
    const pad = new THREE.Vector3(thin === 'x' ? 0.1 : 0, thin === 'y' ? 0.1 : 0, thin === 'z' ? 0.1 : 0);
    const f = { min: min.clone().sub(pad), max: max.clone().add(pad), axis: thin };
    this.fizzlers.push(f);
    return f;
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
  pedestal(x, y, z, gives, model) {
    const g = new THREE.Group();
    const metal = materials().metal.mat;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.0, 32), metal);
    base.position.y = 0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.6) }));
    ring.position.y = 1.02;
    g.add(base, ring);
    const holder = new THREE.Group();
    holder.position.y = 1.45;
    if (model) holder.add(model);
    g.add(holder);
    const light = new THREE.PointLight(0x9fd8ff, 4, 5, 1.6);
    light.position.y = 1.6;
    g.add(light);
    g.position.set(x, y, z);
    this.group.add(g);
    this.anim.push((t) => {
      holder.rotation.y = t * 0.8;
      holder.position.y = 1.45 + Math.sin(t * 2) * 0.05;
    });
    const p = { pos: new THREE.Vector3(x, y + 1, z), gives, group: holder, taken: false, light };
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

  /** receptor da bola de energia: liga o sinal `opens` quando recebe uma */
  catcher(x, y, z, normal, opens) {
    const n = new THREE.Vector3(...normal);
    const g = this.socket(n, 0x6fc8ff);
    g.position.set(x, y, z);
    const C = { pos: new THREE.Vector3(x, y, z).addScaledVector(n, 0.25), normal: n, opens, active: false, group: g };
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
      if (b === except) continue;
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
