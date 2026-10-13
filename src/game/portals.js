// Portais com perspectiva de verdade.
//
// Para cada portal P (ligado ao par Q), a cena é renderizada a partir de uma
// câmera virtual: a câmera do jogador transformada de P para Q (girada 180°),
// com a MESMA projeção da câmera do jogador, e tudo que está atrás de Q é
// cortado por um plano de recorte. Na tela, cada pixel do portal P lê o pixel
// de mesma posição dessa imagem (espaço de tela) — a perspectiva é exata de
// qualquer ângulo e a imagem fica nítida mesmo encostado no portal.
// Cada portal tem duas texturas (lê a do quadro anterior e escreve a nova),
// o que produz o efeito de portal dentro de portal (recursão).

import * as THREE from 'three';
import { aabbOverlap } from './world.js';

export const PORTAL_A = 0.68; // meia largura (m)
export const PORTAL_B = 1.08; // meia altura (m)
// cores dos pares de portais de cada jogador (multiplayer: até 4)
export const SLOT_COLORS = [
  [new THREE.Color(0.2, 0.62, 1.0), new THREE.Color(1.0, 0.5, 0.08)],
  [new THREE.Color(0.58, 0.32, 1.0), new THREE.Color(1.0, 0.18, 0.2)],
  [new THREE.Color(0.2, 1.0, 0.5), new THREE.Color(1.0, 0.9, 0.2)],
  [new THREE.Color(0.2, 0.95, 1.0), new THREE.Color(1.0, 0.35, 0.8)],
];
export const SLOT_CSS = ['#3fa2ff/#ff8a1e', '#9452ff/#ff2e33', '#33ff80/#ffe633', '#33f2ff/#ff59cc'].map((s) => s.split('/'));
const RY180 = new THREE.Matrix4().makeRotationY(Math.PI);

const displayVS = /* glsl */ `
  varying vec3 vW;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const displayFS = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uCenter, uRight, uUp, uNormal, uColor;
  uniform float uA, uB, uLinked, uOpen, uTime;
  uniform vec2 uRes;
  varying vec3 vW;
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){
    // onde o raio olho → este pixel cruza o plano do portal
    vec3 dir = vW - cameraPosition;
    float denom = dot(dir, uNormal);
    if (abs(denom) < 1e-6) discard;
    float t = dot(uCenter - cameraPosition, uNormal) / denom;
    vec3 q = cameraPosition + dir * t;
    vec2 pl = vec2(dot(q - uCenter, uRight), dot(q - uCenter, uUp));
    vec2 e = pl / (vec2(uA, uB) * max(uOpen, 0.001));
    float r = length(e);
    if (r > 1.0) discard;
    vec3 view = texture2D(map, gl_FragCoord.xy / uRes).rgb;
    // sem par: superfície giratória da cor do portal
    float ang = atan(e.y, e.x);
    float sw = n2(vec2(ang * 3.0 + uTime * 1.5 + r * 6.0, r * 5.0 - uTime * 2.0));
    vec3 swirl = uColor * (0.25 + 0.9 * sw * (1.0 - r * 0.5)) + uColor * pow(1.0 - r, 3.0) * 0.6;
    vec3 col = mix(swirl, view, uLinked);
    // borda brilhante por dentro
    float rim = smoothstep(0.82, 1.0, r) * (0.75 + 0.25 * n2(vec2(ang * 9.0, uTime * 4.0)));
    col = mix(col, uColor * 1.25, rim * 0.6);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const rimFS = /* glsl */ `
  uniform vec3 uColor; uniform float uTime, uOpen;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  void main(){
    vec2 p = (vUv - 0.5) * 2.0 * 1.18 / max(uOpen, 0.001);
    float r = length(p);
    float ang = atan(p.y, p.x);
    float flick = n2(vec2(ang * 7.0 + uTime * 3.0, uTime * 2.0 + r * 4.0));
    float ring = smoothstep(1.16, 1.0, r) * smoothstep(0.93, 1.0, r);
    float glow = exp(-abs(r - 1.02) * 16.0) * (0.3 + 0.5 * flick);
    float a = clamp(ring * 0.9 + glow, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.75 + 0.45 * flick), a * 0.9);
    #include <colorspace_fragment>
  }`;

class Portal {
  constructor(name, scene, renderer, color) {
    this.name = name;
    this.color = color.clone();
    this.partner = null;
    this.scene = scene;
    this.placed = false;
    this.open = 0;
    this.center = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.box = null;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const opts = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace };
    this.rt = [new THREE.WebGLRenderTarget(size.x, size.y, opts), new THREE.WebGLRenderTarget(size.x, size.y, opts)];
    this.read = 0;

    this.uniforms = {
      map: { value: this.rt[0].texture },
      uCenter: { value: this.center },
      uRight: { value: this.right },
      uUp: { value: this.up },
      uNormal: { value: this.normal },
      uColor: { value: this.color },
      uA: { value: PORTAL_A },
      uB: { value: PORTAL_B },
      uLinked: { value: 0 },
      uOpen: { value: 0 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: displayVS, fragmentShader: displayFS, side: THREE.DoubleSide });

    // tela do portal: um quadro na frente da parede + uma "caixa" rasa atrás dele,
    // que cobre o caso em que o plano de corte próximo da câmera entra no portal
    this.group = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(PORTAL_A * 2, PORTAL_B * 2), mat);
    front.position.z = 0.006;
    const depth = 0.6;
    const innerMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: displayVS, fragmentShader: displayFS, side: THREE.BackSide });
    const inner = new THREE.Mesh(new THREE.BoxGeometry(PORTAL_A * 2, PORTAL_B * 2, depth).translate(0, 0, -depth / 2), innerMat);
    this.group.add(front, inner);
    const rim = new THREE.Mesh(
      new THREE.PlaneGeometry(PORTAL_A * 2 * 1.18, PORTAL_B * 2 * 1.18),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: this.color }, uTime: this.uniforms.uTime, uOpen: this.uniforms.uOpen },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: rimFS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    rim.position.z = 0.012;
    this.group.add(rim);
    this.light = new THREE.PointLight(this.color, 6, 6, 1.6);
    this.light.position.z = 0.6;
    this.group.add(this.light);
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.front = front;
    scene.add(this.group);
  }

  setFrame(center, normal, up, box) {
    this.center.copy(center);
    this.normal.copy(normal);
    this.up.copy(up);
    this.right.crossVectors(up, normal).normalize();
    this.box = box;
    this.matrix.makeBasis(this.right, this.up, this.normal).setPosition(this.center);
    this.inverse.copy(this.matrix).invert();
    this.group.matrix.copy(this.matrix);
    this.group.matrixWorldNeedsUpdate = true;
    this.group.visible = true;
    this.placed = true;
    this.open = 0;
  }

  remove() {
    this.placed = false;
    this.group.visible = false;
    this.box = null;
  }

  local(p) {
    return p.clone().applyMatrix4(this.inverse);
  }

  resize(w, h) {
    for (const r of this.rt) r.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
  }

  setColor(c) {
    this.color.copy(c);
    this.light.color.copy(c);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const r of this.rt) r.dispose();
  }
}

const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

export class PortalSystem {
  constructor(renderer, scene, camera, world) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    // par local (o seu) + pares dos outros jogadores da sala
    this.blue = new Portal('blue', scene, renderer, SLOT_COLORS[0][0]);
    this.orange = new Portal('orange', scene, renderer, SLOT_COLORS[0][1]);
    this.blue.partner = this.orange;
    this.orange.partner = this.blue;
    this.remote = new Map(); // id do jogador → { blue, orange }
    this.vcam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.01, 1000);
    this.vcam.matrixAutoUpdate = false;
    this.vcam.matrixWorldAutoUpdate = false;
    this.vcam.layers.set(0);
    this.vcam.layers.enable(1); // o corpo do jogador aparece nos portais
    this.clip = new THREE.Plane();
    this.enabled = true;
  }

  get linked() {
    return this.blue.placed && this.orange.placed;
  }

  get list() {
    const l = [this.blue, this.orange];
    for (const r of this.remote.values()) l.push(r.blue, r.orange);
    return l;
  }

  other(p) {
    return p.partner;
  }

  isLinked(p) {
    return p.placed && p.partner.placed;
  }

  get anyLinked() {
    return this.list.some((p) => this.isLinked(p));
  }

  setSlot(slot) {
    this.blue.setColor(SLOT_COLORS[slot % 4][0]);
    this.orange.setColor(SLOT_COLORS[slot % 4][1]);
  }

  remotePair(id, slot) {
    if (!this.remote.has(id)) {
      const c = SLOT_COLORS[slot % 4];
      const blue = new Portal('blue', this.scene, this.renderer, c[0]);
      const orange = new Portal('orange', this.scene, this.renderer, c[1]);
      blue.partner = orange;
      orange.partner = blue;
      blue.owner = orange.owner = id;
      this.remote.set(id, { blue, orange });
    }
    return this.remote.get(id);
  }

  removeRemote(id) {
    const r = this.remote.get(id);
    if (!r) return;
    r.blue.dispose();
    r.orange.dispose();
    this.remote.delete(id);
  }

  /** portal de outro jogador (vem pela rede) */
  placeRemote(id, slot, which, center, normal, up, boxIndex) {
    const pair = this.remotePair(id, slot);
    const P = which === 'blue' ? pair.blue : pair.orange;
    const box = this.world.solids[boxIndex];
    if (!box) return;
    P.setFrame(new THREE.Vector3(...center), new THREE.Vector3(...normal), new THREE.Vector3(...up), box);
  }

  reset() {
    for (const p of this.list) p.remove();
  }

  resize(w, h) {
    for (const p of this.list) p.resize(w, h);
  }

  /** matriz que leva o espaço "na frente de P" para "na frente de Q" */
  transform(P, Q) {
    return new THREE.Matrix4().multiplyMatrices(Q.matrix, RY180).multiply(P.inverse);
  }

  // ------------------------------------------------------------ colocar portal
  tryPlace(which, origin, dir) {
    const P = which === 'blue' ? this.blue : this.orange;
    const hit = this.world.raycast(origin, dir, 400);
    if (!hit) return { ok: false };
    if (!hit.box.portalable) return { ok: false, point: hit.point, normal: hit.normal };
    const n = hit.normal.clone();
    let up;
    if (Math.abs(n.y) > 0.5) {
      // piso/teto: o portal fica alinhado com a direção do olhar
      up = dir.clone().projectOnPlane(n);
      if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
      up.normalize();
      if (n.y < 0) up.negate();
    } else up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const box = hit.box;
    const axes = [0, 1, 2].filter((i) => i !== hit.axis);
    const center = hit.point.clone();

    const fits = (c) => {
      // dentro da face da caixa
      for (const i of axes) {
        const ext = Math.abs(right.getComponent(i)) * PORTAL_A + Math.abs(up.getComponent(i)) * PORTAL_B;
        if (c.getComponent(i) - ext < box.min.getComponent(i) - 1e-3 || c.getComponent(i) + ext > box.max.getComponent(i) + 1e-3) return false;
      }
      // nada sólido na frente da borda do portal
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const p = c
          .clone()
          .addScaledVector(right, Math.cos(a) * PORTAL_A * 0.96)
          .addScaledVector(up, Math.sin(a) * PORTAL_B * 0.96)
          .addScaledVector(n, 0.06);
        if (this.world.pointInSolid(p, box)) return false;
      }
      // não sobrepor outro portal (de qualquer jogador) no mesmo plano
      for (const O of this.list) {
        if (O === P || !O.placed) continue;
        if (O.normal.dot(n) > 0.99 && Math.abs(O.normal.dot(c) - O.normal.dot(O.center)) < 0.02) {
          const d = c.clone().sub(O.center);
          const du = d.dot(right) / (PORTAL_A * 2);
          const dv = d.dot(up) / (PORTAL_B * 2);
          if (du * du + dv * dv < 1) return false;
        }
      }
      return true;
    };

    // empurra para dentro da face
    for (const i of axes) {
      const ext = Math.abs(right.getComponent(i)) * PORTAL_A + Math.abs(up.getComponent(i)) * PORTAL_B;
      const lo = box.min.getComponent(i) + ext;
      const hi = box.max.getComponent(i) - ext;
      if (lo > hi) return { ok: false, point: hit.point, normal: n };
      center.setComponent(i, THREE.MathUtils.clamp(center.getComponent(i), lo, hi));
    }
    // em parede, se a base do portal ficou perto do chão, encosta no chão (dá para entrar andando)
    if (Math.abs(n.y) < 0.5) {
      const probe = center.clone().addScaledVector(n, 0.4);
      const floor = this.world.raycast(probe, new THREE.Vector3(0, -1, 0), PORTAL_B + 3.0);
      if (floor && floor.dist - PORTAL_B < 2.5) center.y = probe.y - floor.dist + PORTAL_B + 0.01;
    }
    let final = null;
    if (fits(center)) final = center;
    else {
      // procura uma posição válida por perto (como nos jogos, o portal "escorrega")
      outer: for (let r = 0.2; r <= 1.8; r += 0.2)
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const c = center.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
          if (fits(c)) {
            final = c;
            break outer;
          }
        }
    }
    if (!final) return { ok: false, point: hit.point, normal: n };
    P.setFrame(final.addScaledVector(n, 0.002), n, up, box);
    return { ok: true, point: final, normal: n, up, boxIndex: this.world.solids.indexOf(box) };
  }

  // ------------------------------------------------------------ física
  /** caixas que o corpo pode atravessar porque está entrando num portal */
  ignoreFor(min, max, center, wall = true) {
    const set = new Set();
    for (const P of this.list) {
      if (!this.isLinked(P)) continue;
      if (!P.box || !aabbOverlap(min, max, P.box.min, P.box.max)) continue;
      const l = P.local(center);
      const isWall = Math.abs(P.normal.y) < 0.5;
      const mu = 0.25;
      const mv = isWall && wall ? 0.72 : 0.25;
      if (Math.abs(l.x) <= PORTAL_A - mu && Math.abs(l.y) <= PORTAL_B - mv && l.z > -2.5) set.add(P.box);
    }
    return set;
  }

  /** o ponto foi de `a` para `b`: atravessou algum portal? */
  crossing(a, b) {
    for (const P of this.list) {
      if (!this.isLinked(P)) continue;
      const sa = a.clone().sub(P.center).dot(P.normal);
      const sb = b.clone().sub(P.center).dot(P.normal);
      if (sa > 0 && sb <= 0) {
        const x = a.clone().lerp(b, sa / (sa - sb));
        const l = P.local(x);
        if (Math.abs(l.x) <= PORTAL_A && Math.abs(l.y) <= PORTAL_B) return P;
      }
    }
    return null;
  }

  /** corpo terminou atrás do plano de um portal (entrou rápido demais): devolve o portal */
  stuckIn(center, min, max) {
    for (const P of this.list) {
      if (!this.isLinked(P) || !P.box || !aabbOverlap(min, max, P.box.min, P.box.max)) continue;
      const l = P.local(center);
      if (l.z < -0.02 && l.z > -1.6 && Math.abs(l.x) < PORTAL_A + 0.45 && Math.abs(l.y) < PORTAL_B + 1.0) return P;
    }
    return null;
  }

  // ------------------------------------------------------------ renderização
  update(t, dt) {
    for (const P of this.list) {
      P.uniforms.uTime.value = t;
      P.open = Math.min(1, P.open + dt * 5);
      P.uniforms.uOpen.value = 1 - Math.pow(1 - P.open, 3);
      P.uniforms.uLinked.value = this.isLinked(P) ? 1 : 0;
    }
  }

  render() {
    if (!this.enabled) return;
    const r = this.renderer;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // só renderiza a vista dos portais que estão na tela (economiza com vários jogadores)
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const todo = this.list.filter((P) => this.isLinked(P) && _frustum.intersectsSphere(_sphere.set(P.center, PORTAL_B * 1.2)));
    if (!todo.length) return;
    const prevTarget = r.getRenderTarget();
    const prevClip = r.clippingPlanes;
    for (const P of todo) {
      const Q = this.other(P);
      const M = this.transform(P, Q);
      const v = this.vcam;
      v.projectionMatrix.copy(cam.projectionMatrix);
      v.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
      v.matrixWorld.multiplyMatrices(M, cam.matrixWorld);
      v.matrixWorldInverse.copy(v.matrixWorld).invert();
      // corta tudo que estiver atrás do portal de saída
      this.clip.setFromNormalAndCoplanarPoint(Q.normal, Q.center);
      r.clippingPlanes = [this.clip];
      Q.group.visible = false;
      r.setRenderTarget(P.rt[1 - P.read]);
      r.clear();
      r.render(this.scene, v);
      Q.group.visible = true;
    }
    r.clippingPlanes = prevClip;
    r.setRenderTarget(prevTarget);
    for (const P of todo) {
      P.read = 1 - P.read;
      P.uniforms.map.value = P.rt[P.read].texture;
    }
  }
}
