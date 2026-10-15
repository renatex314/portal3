// Acabamento visual: pós-processamento (desfoque de movimento, brilho das
// luzes, vinheta, grão de filme, aberração no tempo lento), poeira no ar, sombras de contato
// embaixo dos objetos e o efeito de desintegração (grade e fornalha).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { canvas } from './textures.js';

// ------------------------------------------------------------------ pós-processamento
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberr: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uAberr, uVignette, uGrain; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uAberr * 8.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= 1.0 - uVignette * smoothstep(0.1, 1.0, r2 * 2.0);
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ------------------------------------------------------------------ desfoque de movimento
/**
 * Desfoque da câmera: cada pixel é levado de volta para onde estava no quadro
 * anterior (profundidade + matrizes das duas câmeras) e a cor é amostrada ao
 * longo desse caminho. O que está colado na câmera (a arma) não borra e não
 * "vaza" para o fundo; num salto de portal o histórico é zerado.
 */
const blurFS = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor, tDepth;
  uniform mat4 uInvVP, uPrevVP;
  uniform float uStrength, uNear, uFar, uMaxLen, uRadial;
  varying vec2 vUv;
  float viewDist(float d){ return -perspectiveDepthToViewZ(d, uNear, uFar); }
  void main(){
    float d = texture2D(tDepth, vUv).x;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 w = uInvVP * ndc;
    w /= w.w;
    vec4 p = uPrevVP * w;
    vec2 prev = p.xy / p.w * 0.5 + 0.5;
    vec2 vel = (vUv - prev) * uStrength;
    // em alta velocidade: rastro radial a partir do centro (sensação de "túnel")
    vel += (vUv - 0.5) * uRadial;
    float len = length(vel);
    if (len > uMaxLen) vel *= uMaxLen / len;
    float near = smoothstep(0.9, 1.6, viewDist(d)); // 0 na arma
    vel *= near;
    vec4 base = texture2D(tColor, vUv);
    if (length(vel) * 1500.0 < 1.0) { gl_FragColor = base; return; }
    vec3 sum = base.rgb;
    float wsum = 1.0;
    for (int i = 0; i < 12; i++) {
      float k = (float(i) + 0.5) / 12.0 - 0.5;
      vec2 uv = vUv + vel * k;
      // não puxa a arma para dentro do fundo borrado
      float ok = smoothstep(0.9, 1.6, viewDist(texture2D(tDepth, uv).x));
      sum += texture2D(tColor, uv).rgb * ok;
      wsum += ok;
    }
    gl_FragColor = vec4(sum / wsum, base.a);
  }`;

class MotionBlurPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.strength = 0.6;
    this.maxLen = 0.045;
    this.radial = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uInvVP: { value: new THREE.Matrix4() },
        uPrevVP: { value: new THREE.Matrix4() },
        uStrength: { value: 0.6 },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uMaxLen: { value: 0.045 },
        uRadial: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: blurFS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.vp = new THREE.Matrix4();
    this.prevVP = new THREE.Matrix4();
    this.prevPos = new THREE.Vector3();
    this.prevFwd = new THREE.Vector3();
    this.fresh = true;
  }

  /** chame num teletransporte (portal, renascer): o próximo quadro não borra */
  reset() {
    this.fresh = true;
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    // pulo grande de posição ou de direção = passou por um portal / renasceu
    if (pos.distanceTo(this.prevPos) > 2.5 || fwd.dot(this.prevFwd) < 0.75) this.fresh = true;
    const u = this.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uInvVP.value.copy(this.vp).invert();
    u.uPrevVP.value.copy(this.fresh ? this.vp : this.prevVP);
    u.uStrength.value = this.strength;
    u.uMaxLen.value = this.maxLen;
    u.uRadial.value = this.fresh ? 0 : this.radial;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.prevVP.copy(this.vp);
    this.prevPos.copy(pos);
    this.prevFwd.copy(fwd);
    this.fresh = false;
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Onda de choque do tiro: só uma distorção da imagem (como ar quente ou uma
 * lente), num anel pequeno que abre a partir da boca da arma — sem brilho.
 */
const ShockShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uT: { value: 1 },
    uAspect: { value: 1 },
    uMaxR: { value: 0.14 },
    uStrength: { value: 0.03 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uT, uAspect, uMaxR, uStrength;
    varying vec2 vUv;
    void main(){
      if (uT >= 1.0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 d = vUv - uCenter;
      d.x *= uAspect;
      float r = length(d);
      float e = 1.0 - pow(1.0 - uT, 3.0); // abre rápido e desacelera
      float R = 0.015 + e * uMaxR;
      float w = mix(0.015, 0.04, e);
      float x = (r - R) / w;
      float band = exp(-x * x);
      float fade = pow(1.0 - uT, 1.4);
      // a imagem é puxada para dentro na frente da onda e empurrada atrás dela
      vec2 dir = r > 1e-4 ? d / r : vec2(0.0);
      vec2 off = dir * (-x * band * uStrength * fade);
      off.x /= uAspect;
      gl_FragColor = texture2D(tDiffuse, vUv + off);
    }`,
};

/**
 * Troca o `renderer.render(cena, câmera)` final por: cena (com MSAA) → brilho
 * → tom/cor → acabamento. Os portais continuam renderizando direto nas
 * texturas deles (em espaço linear, sem tom), então nada muda para eles.
 */
export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = true;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(1, 1); // o desfoque de movimento lê a profundidade
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.blur = new MotionBlurPass(camera);
    this.composer.addPass(this.blur);
    this.shock = new ShaderPass(ShockShader);
    this.composer.addPass(this.shock);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.4, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.resize();
  }

  resize() {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  /** dispara a onda de choque (distorção); a posição na tela vem de `shockAt` a cada quadro */
  shockwave() {
    this.shock.uniforms.uT.value = 0;
  }

  /** onde fica a boca da arma na tela (coordenadas 0..1), para a onda sair dali */
  set shockAt(v) {
    this.shock.uniforms.uCenter.value.copy(v);
  }

  /**
   * `slow` 0..1 (tempo lento) aumenta a aberração e a vinheta; `speed` (m/s) e
   * `ahead` (−1..1, quanto do movimento é para a frente) acentuam o desfoque
   */
  render(dt, t, slow = 0, scene, camera, speed = 0, ahead = 0) {
    if (!this.enabled) {
      this.renderer.render(scene, camera);
      return;
    }
    const u = this.finish.uniforms;
    u.uTime.value = t;
    const su = this.shock.uniforms;
    su.uT.value = Math.min(1, su.uT.value + dt * 2.6);
    su.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    this.shock.enabled = su.uT.value < 1;
    // salto no tempo: aberração forte que some em ~0,7 s
    this.warp = Math.max(0, (this.warp ?? 0) - dt * 1.5);
    u.uAberr.value = slow * 0.012 + this.warp * this.warp * 0.08;
    u.uVignette.value = 0.32 + slow * 0.25 + this.warp * 0.4;
    this.bloom.strength = 0.45 + slow * 0.25;
    // no tempo lento a câmera anda pouco por quadro: o rastro fica mais longo;
    // acima de ~8 m/s o rastro cresce com a velocidade e ganha o borrão radial
    const fast = THREE.MathUtils.smoothstep(speed, 8, 32);
    this.blur.strength = (0.6 + slow * 1.4) * (1 + fast * 2.2);
    this.blur.maxLen = 0.045 + fast * 0.075;
    this.blur.radial = fast * 0.05 * ahead;
    this.composer.render(dt);
  }
}

// ------------------------------------------------------------------ poeira no ar
/** partículas finas flutuando em volta da câmera (só a câmera do jogador vê) */
export function dust(count = 700, size = 14) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSize: { value: size }, uH: { value: 800 } },
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uSize, uH; uniform vec3 uCam;
      varying float vA;
      void main(){
        vec3 drift = vec3(sin(uTime * 0.13 + seed.w * 6.28) * 0.6, -0.05 * uTime * (0.3 + seed.w), cos(uTime * 0.11 + seed.x * 6.28) * 0.6);
        vec3 p = seed.xyz * uSize + drift;
        p = mod(p - uCam + uSize * 0.5, uSize) + uCam - uSize * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = (0.012 + 0.012 * seed.w) * projectionMatrix[1][1] * uH / max(d, 0.1);
        // some perto da borda do cubo e muito perto da câmera
        vec3 rel = abs(p - uCam) / (uSize * 0.5);
        vA = (1.0 - smoothstep(0.7, 1.0, max(rel.x, max(rel.y, rel.z)))) * smoothstep(0.3, 1.2, d) * (0.25 + 0.35 * seed.y);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.88), vA * (1.0 - d * d));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.layers.set(2);
  pts.userData.update = (t, cam, h) => {
    mat.uniforms.uTime.value = t;
    mat.uniforms.uCam.value.copy(cam.position);
    mat.uniforms.uH.value = h * 0.5;
  };
  return pts;
}

// ------------------------------------------------------------------ sombras de contato
let BLOB = null;
function blobTexture() {
  if (BLOB) return BLOB;
  const cv = canvas(128);
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 128, 128);
  BLOB = new THREE.CanvasTexture(cv);
  return BLOB;
}

/** mancha escura no chão embaixo de cada objeto (no sentido da gravidade) */
export class ContactShadows {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
    this.geo = new THREE.PlaneGeometry(1, 1);
  }

  update(props, world, gravityAt) {
    const seen = new Set();
    const down = new THREE.Vector3();
    for (const p of props) {
      seen.add(p);
      let m = this.map.get(p);
      if (!m) {
        m = new THREE.Mesh(
          this.geo,
          new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
        );
        m.renderOrder = 1;
        this.scene.add(m);
        this.map.set(p, m);
      }
      if (p.gone) {
        m.visible = false;
        continue;
      }
      down.copy(gravityAt(p.pos));
      if (down.lengthSq() < 1e-6) down.set(0, -1, 0);
      down.normalize();
      const size = p.kind === 'turret' ? 1.0 : 0.95;
      const max = 4;
      const hit = world.raycast(p.pos, down, max);
      if (!hit) {
        m.visible = false;
        continue;
      }
      const k = Math.max(0, 1 - hit.dist / max);
      m.visible = true;
      m.position.copy(hit.point).addScaledVector(hit.normal, 0.004);
      m.lookAt(m.position.clone().add(hit.normal));
      m.scale.setScalar(size * (1 + (1 - k) * 0.8));
      m.material.opacity = 0.62 * k * k;
    }
    for (const [p, m] of this.map)
      if (!seen.has(p)) {
        this.scene.remove(m);
        m.material.dispose();
        this.map.delete(p);
      }
  }
}

// ------------------------------------------------------------------ desintegração
const dissolveVS = /* glsl */ `
  varying vec3 vP; varying vec3 vN;
  void main(){
    vP = position;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const dissolveFS = /* glsl */ `
  uniform float uT; uniform vec3 uColor;
  varying vec3 vP; varying vec3 vN;
  float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float n3(vec3 p){
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main(){
    float n = n3(vP * 9.0) * 0.65 + n3(vP * 23.0) * 0.35;
    float cut = uT * 1.1 - 0.05;
    if (n < cut) discard;
    float edge = 1.0 - smoothstep(0.0, 0.035, n - cut);
    float lit = 0.35 + 0.65 * max(dot(vN, normalize(vec3(0.3, 0.9, 0.4))), 0.0);
    vec3 base = mix(vec3(0.5), vec3(0.04), smoothstep(0.0, 0.25, uT)) * lit;
    gl_FragColor = vec4(mix(base, uColor * 4.0, edge), 1.0);
  }`;

/** cópias "queimando" de objetos que somem; cada uma vive ~1,2 s */
export class Dissolver {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    // modelos invisíveis: os shaders do efeito são compilados ao carregar a fase
    const tmpl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), this.material(new THREE.Color()));
    const pts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)), this.sparkMaterial(new THREE.Color()));
    tmpl.visible = pts.visible = false;
    scene.add(tmpl, pts);
  }

  material(color) {
    return new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uColor: { value: color.clone() } }, vertexShader: dissolveVS, fragmentShader: dissolveFS });
  }

  sparkMaterial(color) {
    return new THREE.PointsMaterial({ color: color.clone().multiplyScalar(3), size: 0.04, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  }

  /** `color` da borda: azul na grade, laranja na fornalha/rocha fundida */
  add(mesh, color = new THREE.Color(0.45, 0.8, 1.0)) {
    mesh.updateMatrixWorld(true);
    const mat = this.material(color);
    const ghost = mesh.clone(true);
    ghost.traverse((o) => {
      if (o.isMesh) o.material = mat;
      if (o.isSprite || o.isLight || o.isPoints || o.isLine) o.visible = false;
    });
    mesh.matrixWorld.decompose(ghost.position, ghost.quaternion, ghost.scale);
    ghost.visible = true;
    this.scene.add(ghost);
    // faíscas saindo do objeto
    const N = 40;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const vel = [];
    for (let i = 0; i < N; i++) {
      pos.set([ghost.position.x + (Math.random() - 0.5) * 0.5, ghost.position.y + (Math.random() - 0.5) * 0.5, ghost.position.z + (Math.random() - 0.5) * 0.5], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.5 + 0.3, (Math.random() - 0.5) * 1.2));
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(g, this.sparkMaterial(color));
    sparks.frustumCulled = false;
    this.scene.add(sparks);
    this.list.push({ ghost, mat, sparks, vel, t: 0 });
  }

  update(dt) {
    for (const d of [...this.list]) {
      d.t += dt;
      const k = d.t / 1.2;
      d.mat.uniforms.uT.value = Math.min(1, k);
      d.ghost.position.y += dt * 0.25;
      const p = d.sparks.geometry.attributes.position;
      for (let i = 0; i < d.vel.length; i++) {
        d.vel[i].multiplyScalar(1 - dt * 1.5);
        p.setXYZ(i, p.getX(i) + d.vel[i].x * dt, p.getY(i) + d.vel[i].y * dt, p.getZ(i) + d.vel[i].z * dt);
      }
      p.needsUpdate = true;
      d.sparks.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.scene.remove(d.ghost, d.sparks);
        d.mat.dispose();
        d.sparks.geometry.dispose();
        this.list = this.list.filter((x) => x !== d);
      }
    }
  }

  clear() {
    for (const d of this.list) this.scene.remove(d.ghost, d.sparks);
    this.list = [];
  }
}
