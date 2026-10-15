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

const NOISE = /* glsl */ `
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }`;

const displayFS = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uCenter, uRight, uUp, uNormal, uColor;
  uniform float uA, uB, uLinked, uOpen, uTime, uPast;
  uniform vec2 uRes;
  varying vec3 vW;
  ${NOISE}
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
    // portal temporal: a vista do passado sai só em tons de cinza, sem nada por cima
    float lum = dot(view, vec3(0.3, 0.59, 0.11));
    view = mix(view, vec3(lum), uPast);
    // sem par: plasma girando na cor do portal, mais claro perto da borda
    float ang = uTime * 0.7 + r * 3.2;
    vec2 sp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * e * 2.4;
    float sw = fbm(sp + vec2(uTime * 0.25, -uTime * 0.18));
    vec3 swirl = (uColor * uColor) * (0.25 + 2.4 * sw * sw) * (0.5 + 0.8 * r) + uColor * smoothstep(0.55, 1.0, r) * 0.7;
    vec3 col = mix(swirl, view, uLinked);
    // a borda tinge a vista por dentro (a faixa brilhante vem do anel) e brilha
    // como energia: um degradê que sobe até a borda, ondulando com o ruído
    float edgeN = fbm(vec2(atan(e.y, e.x) * 2.0, uTime * 0.9));
    col = mix(col, uColor * 1.6, smoothstep(0.72, 1.0, r) * 0.45);
    col += uColor * exp(-(1.0 - r) * 9.0) * (0.9 + 0.8 * edgeN);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const RIM = 1.42; // o anel cobre a borda e o halo de fora
const rimFS = /* glsl */ `
  uniform vec3 uColor; uniform float uTime, uOpen, uFlash;
  varying vec2 vUv;
  ${NOISE}
  void main(){
    vec2 p = (vUv - 0.5) * 2.0 * ${RIM.toFixed(2)} / max(uOpen, 0.001);
    float r = length(p);
    if (r > ${RIM.toFixed(2)}) discard;
    float ang = atan(p.y, p.x);
    vec2 c = vec2(cos(ang), sin(ang)); // ruído sem emenda em volta do anel
    float slow = fbm(c * 2.0 + vec2(uTime * 0.31, -uTime * 0.23) + r);
    float fast = fbm(c * 5.5 + vec2(-uTime * 1.1, uTime * 0.8));
    float d = r - (1.0 + (slow - 0.5) * 0.10); // >0 fora da borda
    // faixa "queimando": nasce dentro do portal e corta seco por fora
    float band = smoothstep(-0.26 - 0.10 * fast, -0.03, d) * (1.0 - smoothstep(0.0, 0.03 + 0.06 * fast, d));
    float hot = exp(-abs(d + 0.03) * 30.0);
    float halo = step(0.0, d) * exp(-d * 8.0) * (0.25 + 0.45 * fast);
    vec3 col = uColor * (0.42 + 0.75 * fast + 0.5 * hot) + uColor * uColor * hot * 0.45 + vec3(hot * hot * 0.35);
    float a = clamp(band * (0.8 + 0.2 * fast) + hot * 0.6 + halo, 0.0, 1.0);
    a *= 1.0 - smoothstep(${(RIM - 0.08).toFixed(2)}, ${RIM.toFixed(2)}, r);
    col *= 1.6 * (1.0 + uFlash * 2.5); // acima de 1: o bloom faz a borda irradiar
    if (a < 0.005) discard;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// aura de energia em volta do portal: brilho que se espalha pela parede, com
// filetes que correm para fora e uma pulsação lenta (soma de luz, sem tampar nada)
const GLOW = 2.3;
const glowFS = /* glsl */ `
  uniform vec3 uColor; uniform float uTime, uOpen, uFlash;
  varying vec2 vUv;
  ${NOISE}
  void main(){
    vec2 p = (vUv - 0.5) * 2.0 * ${GLOW.toFixed(2)};
    float open = max(uOpen, 0.001);
    float r = length(p) / open;
    float d = r - 1.0; // 0 na borda, >0 fora
    if (d < -0.06) discard;
    float ang = atan(p.y, p.x);
    vec2 c = vec2(cos(ang), sin(ang));
    float flow = fbm(c * 3.0 + vec2(uTime * 0.55, -uTime * 0.4) - d * 2.2);
    float wisp = fbm(c * 7.5 + vec2(-uTime * 1.2, uTime * 0.85) - d * 5.0 + uTime * 0.7);
    float pulse = 0.82 + 0.18 * sin(uTime * 2.6 + flow * 2.0);
    float dd = max(d, 0.0);
    float glow = exp(-dd * 2.4) * (0.4 + 0.6 * flow) * pulse;
    float streak = smoothstep(0.52, 0.85, wisp) * exp(-dd * 4.5);
    float a = (glow * 0.6 + streak * 0.9) * smoothstep(-0.06, 0.03, d);
    a *= 1.0 - smoothstep(${(GLOW - 0.3).toFixed(2)}, ${GLOW.toFixed(2)}, length(p));
    a *= min(1.0, uOpen * 1.5);
    // cor saturada (o canal dominante da cor do portal manda): numa parede clara
    // a aura tinge em vez de só clarear; acima de 1 para o bloom pegar
    vec3 deep = uColor * uColor;
    vec3 col = deep * (2.2 + 2.4 * streak + uFlash * 3.0) + uColor * streak * 0.6;
    gl_FragColor = vec4(col, min(1.0, a));
    #include <colorspace_fragment>
  }`;

// faíscas que escapam da borda
const sparkVS = /* glsl */ `
  attribute float seed;
  uniform float uTime, uOpen, uA, uB, uSize, uH;
  varying float vA;
  void main(){
    float speed = 0.35 + 0.45 * fract(seed * 7.13);
    float life = fract(uTime * speed + seed * 3.7);
    float ang = seed * 6.2831853 * 17.0 + life * (fract(seed * 5.3) - 0.5) * 1.2;
    float rr = (1.0 + life * (0.18 + 0.3 * fract(seed * 2.9))) * uOpen;
    vec3 p = vec3(cos(ang) * uA * rr, sin(ang) * uB * rr, 0.02 + life * 0.35 * fract(seed * 9.1));
    p.y -= life * life * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (1.0 - 0.6 * life) * projectionMatrix[1][1] * uH / max(-mv.z, 0.05);
    vA = (1.0 - life) * smoothstep(0.0, 0.08, life) * uOpen;
  }`;
const sparkFS = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float k = (1.0 - d) * (1.0 - d);
    gl_FragColor = vec4(uColor * 1.6 + 0.6 * k, vA * k);
    #include <colorspace_fragment>
  }`;

const PORTAL_DEPTH = 0.6; // fundo da caixa rasa atrás do portal

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
    this.delta = 0; // segundos no passado (laranja temporal): 0 = portal normal

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
      uPast: { value: 0 },
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
    const depth = PORTAL_DEPTH;
    const innerMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: displayVS, fragmentShader: displayFS, side: THREE.BackSide });
    const inner = new THREE.Mesh(new THREE.BoxGeometry(PORTAL_A * 2, PORTAL_B * 2, depth).translate(0, 0, -depth / 2), innerMat);
    this.group.add(front, inner);
    const rim = new THREE.Mesh(
      new THREE.PlaneGeometry(PORTAL_A * 2 * RIM, PORTAL_B * 2 * RIM),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: this.color }, uTime: this.uniforms.uTime, uOpen: this.uniforms.uOpen, uFlash: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: rimFS,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    rim.position.z = 0.012;
    rim.renderOrder = 2;
    this.group.add(rim);
    this.rimMat = rim.material;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(PORTAL_A * 2 * GLOW, PORTAL_B * 2 * GLOW),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: this.color }, uTime: this.uniforms.uTime, uOpen: this.uniforms.uOpen, uFlash: this.rimMat.uniforms.uFlash },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: glowFS,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    glow.position.z = 0.01;
    glow.renderOrder = 1;
    this.group.add(glow);
    const N = 90;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: N }, () => Math.random()), 1));
    const sparks = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.color },
          uTime: this.uniforms.uTime,
          uOpen: this.uniforms.uOpen,
          uA: { value: PORTAL_A },
          uB: { value: PORTAL_B },
          uSize: { value: 0.035 },
          uH: { value: size.y * 0.5 },
        },
        vertexShader: sparkVS,
        fragmentShader: sparkFS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sparks.frustumCulled = false;
    sparks.renderOrder = 3;
    this.sparks = sparks;
    this.group.add(sparks);
    // a luz fica fora do grupo e sempre "visível" (apagada sem portal): se o
    // número de luzes da cena mudasse ao abrir o portal, o three.js
    // recompilaria todos os materiais — era a travada do primeiro portal
    this.light = new THREE.PointLight(this.color, 0, 6, 1.6);
    scene.add(this.light);
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
    this.axis = Math.abs(normal.x) > 0.5 ? 'x' : Math.abs(normal.y) > 0.5 ? 'y' : 'z';
    this.matrix.makeBasis(this.right, this.up, this.normal).setPosition(this.center);
    this.inverse.copy(this.matrix).invert();
    this.group.matrix.copy(this.matrix);
    this.group.matrixWorldNeedsUpdate = true;
    this.group.visible = true;
    this.light.position.copy(center).addScaledVector(normal, 0.6);
    this.placed = true;
    this.moon = false; // (main marca de novo quando o tiro foi na Lua)
    this.delta = 0;
    this.open = 0;
    this.age = 0;
  }

  remove() {
    this.placed = false;
    this.delta = 0;
    this.group.visible = false;
    this.light.intensity = 0;
    this.box = null;
  }

  local(p) {
    return p.clone().applyMatrix4(this.inverse);
  }

  resize(w, h) {
    for (const r of this.rt) r.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
    this.sparks.material.uniforms.uH.value = h * 0.5;
  }

  setColor(c) {
    this.color.copy(c);
    this.light.color.copy(c);
  }

  dispose() {
    this.scene.remove(this.group, this.light);
    for (const r of this.rt) r.dispose();
  }
}

const _frustum = new THREE.Frustum();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _ax = new THREE.Vector3();
const _pm = new THREE.Matrix4();
const _c4 = new THREE.Vector4();
const _pv = new THREE.Matrix4();
const _r1 = new THREE.Vector4();
const _r2 = new THREE.Vector4();
const NONE = new THREE.Vector4(); // marca: portal todo atrás da câmera
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
      this.prewarm(); // luzes novas na cena: recompila agora, não no meio do jogo
    }
    return this.remote.get(id);
  }

  /** par de portais de um clone do tempo (a versão do futuro): em tons de cinza, mas funciona como qualquer par */
  clonePair(id) {
    if (!this.remote.has(id)) {
      const g = new THREE.Color(0.85, 0.85, 0.85);
      const blue = new Portal('blue', this.scene, this.renderer, g);
      const orange = new Portal('orange', this.scene, this.renderer, g);
      blue.partner = orange;
      orange.partner = blue;
      blue.owner = orange.owner = id;
      blue.gray = orange.gray = true;
      this.remote.set(id, { blue, orange });
      this.prewarm();
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
    for (const p of this.list) {
      p.remove();
      p.fixed = false;
      p.owner = null; // prop_portal da campanha que pôs este portal fixo
    }
  }

  /** grade de desintegração: some com os portais do jogador (os fixos da fase ficam) */
  fizzle() {
    let any = false;
    for (const P of [this.blue, this.orange])
      if (P.placed && !P.fixed) {
        P.remove();
        any = true;
      }
    return any;
  }

  /** portal colocado pela própria fase (não sai com a grade nem com tiro) */
  placeFixed(which, center, normal, up) {
    const P = which === 'blue' ? this.blue : this.orange;
    const c = new THREE.Vector3(...center);
    let n = new THREE.Vector3(...normal);
    let u = new THREE.Vector3(...up);
    // a parede logo atrás do centro; se o ponto dado estiver enterrado nela (mapas
    // importados), começa cada vez mais à frente até sair do sólido
    let hit = null;
    for (const ofs of [0.3, 0.6, 1.0, 1.6]) {
      hit = this.world.raycast(c.clone().addScaledVector(n, ofs), n.clone().negate(), ofs + 0.7);
      if (hit) break;
    }
    if (!hit) {
      // nada atrás na direção dada (há mapas do original com o ângulo trocado): o
      // portal assenta na superfície em que o ponto encosta, em qualquer direção
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].map((v) => new THREE.Vector3(...v))) {
        const h = this.world.raycast(c.clone().addScaledVector(d, 0.3), d.clone().negate(), 0.45);
        if (h && h.normal.dot(d) > 0.99) {
          hit = h;
          n = d;
          if (Math.abs(n.y) < 0.5) u = new THREE.Vector3(0, 1, 0);
          else if (Math.abs(u.dot(n)) > 0.5) u = new THREE.Vector3(0, 0, -1);
          break;
        }
      }
    }
    if (!hit) return null;
    P.setFrame(hit.point.addScaledVector(n, 0.002), n, u, hit.box);
    P.fixed = true;
    return P;
  }

  resize(w, h) {
    for (const p of this.list) p.resize(w, h);
  }

  /** matriz que leva o espaço "na frente de P" para "na frente de Q" */
  transform(P, Q) {
    return new THREE.Matrix4().multiplyMatrices(Q.matrix, RY180).multiply(P.inverse);
  }

  // ------------------------------------------------------------ colocar portal
  /** `dry`: só verifica se o portal caberia (para a mira), sem abri-lo */
  tryPlace(which, origin, dir, dry = false) {
    const P = which === 'blue' ? this.blue : this.orange;
    if (P.fixed) return { ok: false };
    const hit = this.world.raycast(origin, dir, 400);
    if (!hit) return { ok: false };
    if (hit.box.surfaceFit) {
      if (!dry) return this.tryPlaceSurface(P, hit, dir);
      // verificação da mira: só os sólidos perto do ponto (mapas importados têm milhares)
      const all = this.world.solids;
      const c = hit.point;
      const R = 3;
      this.world.solids = all.filter((b) => !(b.max.x < c.x - R || b.min.x > c.x + R || b.max.y < c.y - R || b.min.y > c.y + R || b.max.z < c.z - R || b.min.z > c.z + R));
      try {
        return this.tryPlaceSurface(P, hit, dir, true);
      } finally {
        this.world.solids = all;
      }
    }
    if (!hit.box.portalable) return { ok: false, point: hit.point, normal: hit.normal };
    const n = hit.normal.clone();
    let up;
    if (Math.abs(n.y) > (hit.box.obb ? 0.9 : 0.5)) {
      // piso/teto (ou painel quase deitado): o portal fica alinhado com a direção do olhar
      up = dir.clone().projectOnPlane(n);
      if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
      up.normalize();
      if (n.y < 0) up.negate();
    } else up = new THREE.Vector3(0, 1, 0).projectOnPlane(n).normalize(); // parede (ou painel em pé, inclinado)
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const box = hit.box;
    const center = hit.point.clone();
    // a face atingida, no espaço da caixa: caixa girada (painel diagonal) ou alinhada
    const obb = box.obb;
    const toLocal = (v) => (obb ? v.clone().applyQuaternion(obb.qi) : v.clone());
    const toWorld = (v) => (obb ? v.clone().applyQuaternion(obb.q) : v.clone());
    const origin0 = obb ? obb.c : new THREE.Vector3();
    const nL = toLocal(n);
    const faceAxis = obb ? [0, 1, 2].reduce((a, i) => (Math.abs(nL.getComponent(i)) > Math.abs(nL.getComponent(a)) ? i : a), 0) : hit.axis;
    const axes = [0, 1, 2].filter((i) => i !== faceAxis);
    const rL = toLocal(right);
    const uL = toLocal(up);
    const lo = (i) => (obb ? -obb.half.getComponent(i) : box.min.getComponent(i));
    const hi = (i) => (obb ? obb.half.getComponent(i) : box.max.getComponent(i));
    const ext = (i) => Math.abs(rL.getComponent(i)) * PORTAL_A + Math.abs(uL.getComponent(i)) * PORTAL_B;

    const fits = (c) => {
      // dentro da face da caixa
      const cl = toLocal(c.clone().sub(origin0));
      for (const i of axes) {
        if (cl.getComponent(i) - ext(i) < lo(i) - 1e-3 || cl.getComponent(i) + ext(i) > hi(i) + 1e-3) return false;
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
    const cl = toLocal(center.clone().sub(origin0));
    for (const i of axes) {
      const a = lo(i) + ext(i);
      const b = hi(i) - ext(i);
      if (a > b) return { ok: false, point: hit.point, normal: n };
      cl.setComponent(i, THREE.MathUtils.clamp(cl.getComponent(i), a, b));
    }
    center.copy(toWorld(cl).add(origin0));
    // em parede, se a base do portal ficou perto do chão, encosta no chão (dá para entrar andando)
    if (!obb && Math.abs(n.y) < 0.5) {
      const probe = center.clone().addScaledVector(n, 0.4);
      const floor = this.world.raycast(probe, new THREE.Vector3(0, -1, 0), PORTAL_B + 3.0);
      if (floor && floor.dist - PORTAL_B < 2.5) {
        // (só se continuar cabendo na face: painel pequeno no alto não "desce")
        const snapped = center.clone().setY(probe.y - floor.dist + PORTAL_B + 0.01);
        if (fits(snapped)) center.copy(snapped);
      }
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
    if (dry) return { ok: true, point: final, normal: n, up };
    P.setFrame(final.addScaledVector(n, 0.002), n, up, box);
    return { ok: true, point: final, normal: n, up, boxIndex: this.world.solids.indexOf(box) };
  }

  /**
   * Mapas importados (campanha): a parede é feita de vários pincéis, então o
   * portal cabe se cada ponto da borda tiver, logo atrás, uma face que aceita
   * portal no mesmo plano — e nada sólido na frente.
   */
  tryPlaceSurface(P, hit, dir, dry = false) {
    const fail = { ok: false, point: hit.point, normal: hit.normal };
    const n = hit.normal.clone();
    if (!hit.box.portalAt(n)) return fail;
    let up;
    if (Math.abs(n.y) > 0.5) {
      up = dir.clone().projectOnPlane(n);
      if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
      up.normalize();
      if (n.y < 0) up.negate();
    } else up = new THREE.Vector3(0, 1, 0).projectOnPlane(n).normalize();
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const plane = n.dot(hit.point);
    const back = new THREE.Vector3();
    const front = new THREE.Vector3();
    const backed = (q) => {
      back.copy(q).addScaledVector(n, 0.05);
      const h = this.world.raycast(back, n.clone().negate(), 0.12);
      return h && h.normal.dot(n) > 0.999 && Math.abs(n.dot(h.point) - plane) < 0.01 && h.box.portalAt?.(h.normal);
    };
    const blocked = (q) => {
      front.copy(q).addScaledVector(n, 0.06);
      for (const b of this.world.solids) {
        if (b.noRay || b.disabled) continue;
        if (b.planes ? b.planes.every((pl) => pl.n.dot(front) < pl.d) : !b.obb && front.x > b.min.x && front.x < b.max.x && front.y > b.min.y && front.y < b.max.y && front.z > b.min.z && front.z < b.max.z) return true;
      }
      return false;
    };
    const fits = (c) => {
      if (this.blockedAt?.(c)) return false; // volumes sem portal (func_noportal_volume)
      const samples = [c.clone()];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        samples.push(c.clone().addScaledVector(right, Math.cos(a) * PORTAL_A * 0.98).addScaledVector(up, Math.sin(a) * PORTAL_B * 0.98));
      }
      for (const [x, y] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]])
        samples.push(c.clone().addScaledVector(right, x * PORTAL_A).addScaledVector(up, y * PORTAL_B));
      for (const q of samples) if (!backed(q) || blocked(q)) return false;
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
    const center = hit.point.clone();
    let final = fits(center) ? center : null;
    // como no jogo original, o portal "escorrega" para a posição válida mais próxima
    outer: for (let r = 0.15; !final && r <= 1.8; r += 0.15)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const c = center.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
        if (fits(c)) {
          final = c;
          break outer;
        }
      }
    if (!final) return fail;
    if (dry) return { ok: true, point: final, normal: n, up };
    P.setFrame(final.addScaledVector(n, 0.002), n, up, hit.box);
    return { ok: true, point: final, normal: n, up, boxIndex: this.world.solids.indexOf(hit.box) };
  }

  // ------------------------------------------------------------ física
  /**
   * Portais ligados em cuja boca está o centro de um corpo (o corpo está
   * entrando neles). `wall`: jogador — em portal de parede precisa caber em pé.
   */
  mouths(center, wall = false, reach = 0) {
    const out = [];
    for (const P of this.list) {
      if (!this.isLinked(P) || !P.box || P.delta > 0 || (P.partner.delta > 0 && !wall)) continue; // portal temporal: só o jogador passa
      const l = P.local(center);
      if (l.z < -2.5 || l.z > 1.2 + reach) continue;
      const mv = wall && Math.abs(P.normal.y) < 0.5 ? 0.72 : 0.25;
      if (Math.abs(l.x) <= PORTAL_A - 0.25 && Math.abs(l.y) <= PORTAL_B - mv) out.push(P);
    }
    return out;
  }

  /**
   * A caixa `box` deixa de colidir com um corpo (caixa min..max) que está na
   * boca de um dos portais `mouths`? Sim quando tudo o que o corpo toca dela
   * fica ATRÁS do plano do portal (a parede do portal e o que houver atrás).
   */
  passes(box, mouths, min, max) {
    if (!aabbOverlap(min, max, box.min, box.max)) return false;
    for (const P of mouths) {
      const n = P.normal;
      const plane = n.dot(P.center) + 0.01;
      if (box.pts) {
        // sólido convexo importado: passa se todos os vértices estão atrás do plano
        if (box.pts.every((p) => n.dot(p) <= plane)) return true;
        continue;
      }
      if (box.obb) {
        // caixa girada (painel diagonal): passa se ela inteira está atrás do plano
        const o = box.obb;
        let far = n.dot(o.c);
        for (let i = 0; i < 3; i++) far += o.half.getComponent(i) * Math.abs(n.dot(_ax.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(o.q)));
        if (far <= plane) return true;
        continue;
      }
      // caixa alinhada: o ponto mais à frente (na direção da normal) da parte
      // dela que o corpo toca tem de ficar atrás do plano do portal
      let front = 0;
      for (const a of ['x', 'y', 'z']) {
        const l = Math.max(min[a], box.min[a]);
        const h = Math.min(max[a], box.max[a]);
        front += n[a] > 0 ? n[a] * h : n[a] * l;
      }
      if (front <= plane) return true;
    }
    return false;
  }

  /** o ponto foi de `a` para `b`: atravessou algum portal? */
  crossing(a, b, player = false) {
    for (const P of this.list) {
      if (!this.isLinked(P)) continue;
      if (P.delta > 0) continue; // o laranja do passado não existe no presente
      if (P.partner.delta > 0 && !player) continue; // o azul temporal só o jogador atravessa
      const sa = _v.subVectors(a, P.center).dot(P.normal);
      const sb = _v.subVectors(b, P.center).dot(P.normal);
      if (sa > 0 && sb <= 0) {
        const l = P.local(_v.copy(a).lerp(b, sa / (sa - sb)));
        if (Math.abs(l.x) <= PORTAL_A && Math.abs(l.y) <= PORTAL_B) return P;
      }
    }
    return null;
  }

  /** o ponto terminou atrás do plano de um portal sem cruzá-lo (entrou rápido demais): devolve o portal */
  stuckIn(point, min, max, margin = 0.45) {
    for (const P of this.list) {
      if (!this.isLinked(P) || P.delta > 0 || !P.box || !aabbOverlap(min, max, P.box.min, P.box.max)) continue;
      const l = P.local(point);
      if (l.z < -0.02 && l.z > -1.6 && Math.abs(l.x) < PORTAL_A + margin && Math.abs(l.y) < PORTAL_B + margin) return P;
    }
    return null;
  }

  /** ponto (a câmera) logo atrás da boca de um portal ligado: devolve o portal */
  behind(point) {
    for (const P of this.list) {
      if (!this.isLinked(P) || P.delta > 0) continue;
      const l = P.local(point);
      if (l.z < 0 && l.z > -1.5 && Math.abs(l.x) < PORTAL_A && Math.abs(l.y) < PORTAL_B) return P;
    }
    return null;
  }

  /**
   * Leva um corpo de P para Q conservando o momento: posição e velocidade
   * passam pela MESMA transformação rígida (nada de empurrões extras), então
   * quem entra a v sai a v, na mesma posição relativa ao portal.
   * Devolve a rotação aplicada.
   */
  carry(P, pos, vel) {
    const Q = P.partner;
    const M = this.transform(P, Q);
    const rot = new THREE.Quaternion().setFromRotationMatrix(_m.extractRotation(M));
    pos.applyMatrix4(M);
    vel.applyQuaternion(rot);
    return { Q, M, rot };
  }

  /**
   * Saída por um portal virado para cima com pouca velocidade: garante o
   * mínimo para o corpo sair inteiro da boca e um empurrãozinho lateral para
   * não cair de volta nele (como nos jogos do gênero). Só age quando a
   * velocidade é baixa — numa queda em loop entre dois portais no chão a
   * velocidade fica igual a cada volta.
   */
  exitAssist(Q, pos, vel, half, g, side) {
    const gm = g.length();
    if (gm < 0.01) return;
    const up = _v.copy(g).multiplyScalar(-1 / gm);
    if (Q.normal.dot(up) < 0.7) return;
    const h = _v2.subVectors(pos, Q.center).dot(up);
    const clear = Math.abs(up.x) * half.x + Math.abs(up.y) * half.y + Math.abs(up.z) * half.z + 0.3;
    const need = Math.sqrt(2 * gm * Math.max(0, clear - h));
    const vUp = vel.dot(up);
    if (vUp >= 7) return;
    if (vUp < need) vel.addScaledVector(up, need - vUp);
    const lat = _v2.copy(vel).addScaledVector(up, -vel.dot(up));
    const dir = side.clone().addScaledVector(up, -side.dot(up));
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    const along = lat.dot(dir);
    if (along < 2) vel.addScaledVector(dir, 2 - along);
  }

  // ------------------------------------------------------------ renderização
  /**
   * Compila de antemão os shaders dos dois caminhos de renderização — a vista
   * normal e a vista pelos portais (textura + um plano de corte) — e sobe as
   * texturas para a placa de vídeo. Sem isso, cada material compila na hora
   * em que o primeiro portal liga, e o jogo trava meio segundo.
   */
  prewarm() {
    const r = this.renderer;
    const cam = this.camera;
    const prevTarget = r.getRenderTarget();
    const prevClip = r.clippingPlanes;
    const empty = (this.emptyScene ??= new THREE.Scene());
    // as texturas de todos os portais são criadas na placa agora (na primeira
    // vez que se desenha nelas, o navegador aloca e trava)
    for (const P of this.list)
      for (const rt of P.rt) {
        r.setRenderTarget(rt);
        r.render(empty, cam);
      }
    // qualquer alvo fora da tela serve: o pós-processamento também desenha num
    r.setRenderTarget(this.blue.rt[1 - this.blue.read]);
    for (const planes of [[], [this.clip.set(new THREE.Vector3(0, 1, 0), 1e6)]]) {
      r.clippingPlanes = planes;
      r.render(empty, cam); // fixa o estado de corte que o compile lê
      r.compile(this.scene, cam);
    }
    // um desenho de verdade da vista pelo portal, com TUDO (sem descartar o que
    // está fora da tela): alguns drivers só terminam de preparar o shader no
    // primeiro uso, e a geometria de cada objeto só sobe na primeira vez que é desenhada
    const culled = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    r.render(this.scene, cam);
    for (const o of culled) o.frustumCulled = true;
    r.clippingPlanes = prevClip;
    r.setRenderTarget(prevTarget);
    const seen = new Set();
    this.scene.traverse((o) => {
      for (const m of [o.material].flat())
        if (m)
          for (const v of Object.values(m))
            if (v?.isTexture && !seen.has(v) && !v.isRenderTargetTexture) {
              seen.add(v);
              r.initTexture(v);
            }
    });
  }

  update(t, dt) {
    for (const P of this.list) {
      P.uniforms.uTime.value = t;
      P.open = Math.min(1, P.open + dt * 4.5);
      P.age = (P.age ?? 9) + dt;
      // abre com um leve "passar do ponto" e um clarão, como no original
      const o = P.open;
      P.uniforms.uOpen.value = o >= 1 ? 1 : 1 + 2.2 * Math.pow(o - 1, 3) + 1.2 * Math.pow(o - 1, 2);
      P.rimMat.uniforms.uFlash.value = Math.max(0, 1 - P.age / 0.5) ** 2;
      // a luz do portal pulsa junto com a aura
      P.light.intensity = P.placed ? 9 + 1.5 * Math.sin(t * 2.6) + 14 * P.rimMat.uniforms.uFlash.value : 0;
      P.uniforms.uLinked.value = this.isLinked(P) ? 1 : 0;
      P.uniforms.uPast.value += ((P.partner.delta > 0 || P.gray ? 1 : 0) - P.uniforms.uPast.value) * Math.min(1, dt * 8);
      if (P.delta > 0) {
        // o laranja do passado só existe lá: no presente fica a marca-holograma (feita pelo relógio)
        P.group.visible = false;
        P.light.intensity = 0;
      }
    }
  }

  /**
   * Retângulo (em pixels de `W`×`H`) que o portal P ocupa na tela de uma câmera
   * (`vp` = projeção × vista): caixa de projeção dos 8 cantos do volume dele,
   * com folga para o filtro. `null` se algum canto passa do plano próximo (portal
   * colado na câmera) — aí vale a tela inteira; `NONE` se ele está todo atrás da câmera.
   */
  footprint(P, vp, near, W, H, out) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let behind = 0;
    let close = false;
    for (let i = 0; i < 8; i++) {
      _c4.set(i & 1 ? PORTAL_A : -PORTAL_A, i & 2 ? PORTAL_B : -PORTAL_B, i & 4 ? 0.01 : -PORTAL_DEPTH, 1).applyMatrix4(P.matrix).applyMatrix4(vp);
      if (_c4.w <= 0) {
        behind++;
        continue;
      }
      if (_c4.w < near * 2) close = true;
      const x = (_c4.x / _c4.w * 0.5 + 0.5) * W;
      const y = (_c4.y / _c4.w * 0.5 + 0.5) * H;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (behind === 8) return NONE;
    if (behind || close) return null;
    return out.set(x0, y0, x1, y1);
  }

  /**
   * A tela do portal só lê da textura os pixels onde ela aparece, então a vista
   * pelo portal é desenhada só no retângulo da tela que o portal ocupa — com o
   * portal longe ou de lado, uma fração da tela. Quando o próprio portal aparece
   * na vista dele (corredor entre os dois), a textura do quadro anterior também
   * é lida ali, então esse retângulo entra na conta. Com portais de outros
   * jogadores na cena, desenha tudo como antes.
   */
  scissorTo(P, rt, vp) {
    const cam = this.camera;
    const W = rt.width;
    const H = rt.height;
    const r1 = this.remote.size ? null : this.footprint(P, _pm, cam.near, W, H, _r1);
    const r2 = r1 && r1 !== NONE ? this.footprint(P, vp, this.vcam.near, W, H, _r2) : null;
    // sem retângulo (portal colado na câmera real ou na virtual): vale a tela inteira
    if (!r1 || r1 === NONE || !r2) {
      rt.scissorTest = false;
      return;
    }
    const PAD = 4;
    const both = r2 !== NONE;
    const x0 = Math.max(0, Math.floor(Math.min(r1.x, both ? r2.x : Infinity) - PAD));
    const y0 = Math.max(0, Math.floor(Math.min(r1.y, both ? r2.y : Infinity) - PAD));
    const x1 = Math.min(W, Math.ceil(Math.max(r1.z, both ? r2.z : -Infinity) + PAD));
    const y1 = Math.min(H, Math.ceil(Math.max(r1.w, both ? r2.w : -Infinity) + PAD));
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) > 0.85 * W * H) {
      rt.scissorTest = false;
      return;
    }
    rt.scissor.set(x0, y0, x1 - x0, y1 - y0);
    rt.scissorTest = true;
  }

  render() {
    if (!this.enabled) return;
    const r = this.renderer;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // só renderiza a vista dos portais que estão na tela (economiza com vários jogadores)
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const todo = this.list.filter((P) => this.isLinked(P) && P.delta === 0 && _frustum.intersectsSphere(_sphere.set(P.center, PORTAL_B * 1.2)));
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
      this.scissorTo(P, P.rt[1 - P.read], _pv.multiplyMatrices(v.projectionMatrix, v.matrixWorldInverse));
      // corta tudo que estiver atrás do portal de saída
      this.clip.setFromNormalAndCoplanarPoint(Q.normal, Q.center);
      r.clippingPlanes = [this.clip];
      const wasVisible = Q.group.visible;
      Q.group.visible = false;
      // portal temporal: a vista de dentro é o mundo como estava Δ segundos antes
      const past = Q.delta > 0 ? this.pastView : null;
      past?.begin(Q.delta);
      r.setRenderTarget(P.rt[1 - P.read]);
      r.clear();
      r.render(this.scene, v);
      past?.end();
      Q.group.visible = wasVisible;
    }
    r.clippingPlanes = prevClip;
    r.setRenderTarget(prevTarget);
    for (const P of todo) {
      P.read = 1 - P.read;
      P.uniforms.map.value = P.rt[P.read].texture;
    }
  }
}
