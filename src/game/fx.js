// Acabamento visual: pós-processamento (desfoque de movimento, brilho das
// luzes, vinheta, grão de filme, aberração no tempo lento), poeira no ar, sombras de contato
// embaixo dos objetos e o efeito de desintegração (grade e fornalha).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { canvas } from './textures.js';
import { coreUniforms } from './coreSphere.js';

// ------------------------------------------------------------------ pós-processamento
/**
 * Último passe: tom (ACES) + sRGB — o que o OutputPass fazia — junto com a
 * aberração, a vinheta e o grão. O tom é aplicado em cada amostra, então o
 * resultado é idêntico ao de dois passes, com uma leitura e uma escrita a
 * menos da tela inteira.
 */
const FINISH_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse; uniform float uTime, uAberr, uVignette, uGrain, uFreeze, uGlitch; varying vec2 vUv;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  vec3 grade(vec2 uv){
    vec4 c = texture2D(tDiffuse, uv);
    #ifdef ACES_FILMIC_TONE_MAPPING
      c.rgb = ACESFilmicToneMapping(c.rgb);
    #endif
    #ifdef SRGB_TRANSFER
      c = sRGBTransferOETF(c);
    #endif
    return c.rgb;
  }
  void main(){
    vec2 uv = vUv;
    // paradoxo: faixas horizontais da imagem deslizam de lado
    if (uGlitch > 0.001) {
      float band = floor(uv.y * 26.0 + floor(uTime * 24.0));
      float rnd = fract(sin(band * 91.7 + floor(uTime * 24.0) * 7.3) * 437.5);
      uv.x += (rnd - 0.5) * 0.10 * uGlitch * step(0.62, rnd);
    }
    vec2 d = uv - 0.5;
    float r2 = dot(d, d);
    vec2 off = d * r2 * uAberr * 8.0 + vec2(uGlitch * 0.012, 0.0);
    vec3 c = (uAberr > 1e-5 || uGlitch > 0.001) ? vec3(grade(uv + off).r, grade(uv).g, grade(uv - off).b) : grade(uv);
    // tempo parado: o mundo perde a cor e fica azul-gelo, com a borda congelada
    if (uFreeze > 0.001) {
      float l = dot(c, vec3(0.3, 0.59, 0.11));
      c = mix(c, vec3(l) * vec3(0.80, 0.95, 1.15), uFreeze * 0.78);
      c += vec3(0.0, 0.05, 0.12) * uFreeze * smoothstep(0.15, 1.0, r2 * 2.2);
      c *= 1.0 + 0.06 * uFreeze * sin(gl_FragCoord.y * 1.8);
    }
    c *= 1.0 - uVignette * smoothstep(0.1, 1.0, r2 * 2.0);
    float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * uGrain;
    gl_FragColor = vec4(c, 1.0);
  }`;

class FinishPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uAberr: { value: 0 },
      uVignette: { value: 0.18 },
      uGrain: { value: 0.035 },
      uFreeze: { value: 0 },
      uGlitch: { value: 0 },
      toneMappingExposure: { value: 1 },
    };
    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
        attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: FINISH_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this._key = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    const key = renderer.outputColorSpace + '|' + renderer.toneMapping;
    if (key !== this._key) {
      this._key = key;
      this.material.defines = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) this.material.defines.SRGB_TRANSFER = '';
      if (renderer.toneMapping === THREE.ACESFilmicToneMapping) this.material.defines.ACES_FILMIC_TONE_MAPPING = '';
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

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
  uniform float uStrength, uNear, uFar, uMaxLen, uRadial, uOn;
  varying vec2 vUv;
  float viewDist(float d){ return -perspectiveDepthToViewZ(d, uNear, uFar); }
  void main(){
    if (uOn < 0.5) { gl_FragColor = texture2D(tColor, vUv); return; }
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
  /** `source`: o alvo da cena (com MSAA e profundidade) de onde ele lê */
  constructor(camera, source) {
    super();
    this.camera = camera;
    this.source = source;
    this.strength = 0.6;
    this.maxLen = 0.045;
    this.radial = 0;
    this.on = true; // desligado, só copia a cena (o passe não pode sair da cadeia)
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
        uOn: { value: 1 },
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

  render(renderer, writeBuffer) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    // pulo grande de posição ou de direção = passou por um portal / renasceu
    if (pos.distanceTo(this.prevPos) > 2.5 || fwd.dot(this.prevFwd) < 0.75) this.fresh = true;
    const u = this.material.uniforms;
    u.tColor.value = this.source.texture;
    u.tDepth.value = this.source.depthTexture;
    u.uInvVP.value.copy(this.vp).invert();
    u.uPrevVP.value.copy(this.fresh ? this.vp : this.prevVP);
    u.uOn.value = this.on ? 1 : 0;
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
    uWidth: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uT, uAspect, uMaxR, uStrength, uWidth;
    varying vec2 vUv;
    void main(){
      if (uT >= 1.0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 d = vUv - uCenter;
      d.x *= uAspect;
      float r = length(d);
      float e = 1.0 - pow(1.0 - uT, 3.0); // abre rápido e desacelera
      float R = 0.015 + e * uMaxR;
      float w = mix(0.015, 0.04, e) * uWidth;
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
/** desenha a cena no alvo com MSAA; os passes seguintes trabalham em alvos sem MSAA */
/**
 * Névoa de calor sobre a rocha fundida: para cada pixel, quanto do raio câmera → superfície
 * atravessa a camada de ar quente (HAZE_H metros acima de cada lago). Onde atravessa, a
 * imagem tremula subindo e ganha um brilho quente. Paredes na frente cortam o raio: não tremem.
 */
const HAZE_N = 12;
const HAZE_H = 3.2;
const hazeFS = /* glsl */ `
  uniform sampler2D tDiffuse, tDepth;
  uniform mat4 uInvVP;
  uniform vec3 uCam;
  uniform vec4 uLake[${HAZE_N}];
  uniform float uTop[${HAZE_N}];
  uniform int uCount;
  uniform float uTime, uAspect;
  varying vec2 vUv;
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hh(i), hh(i + vec2(1, 0)), u.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), u.x), u.y); }
  void main(){
    float d = texture2D(tDepth, vUv).x;
    vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    w /= w.w;
    vec3 ro = uCam, rd = w.xyz - uCam;
    float s = 0.0;
    for (int i = 0; i < ${HAZE_N}; i++) {
      if (i >= uCount) break;
      vec3 lo = vec3(uLake[i].x, uTop[i], uLake[i].y);
      vec3 hi = vec3(uLake[i].z, uTop[i] + ${HAZE_H.toFixed(2)}, uLake[i].w);
      vec3 inv = 1.0 / (rd + vec3(1e-6));
      vec3 a = (lo - ro) * inv, b = (hi - ro) * inv;
      vec3 mn = min(a, b), mx = max(a, b);
      float t0 = max(max(mn.x, mn.y), max(mn.z, 0.0));
      float t1 = min(min(mx.x, mx.y), min(mx.z, 1.0)); // 1.0 = a superfície que a câmera vê
      if (t1 <= t0) continue;
      float L = (t1 - t0) * length(rd);
      float y = (ro.y + rd.y * (t0 + t1) * 0.5 - uTop[i]) / ${HAZE_H.toFixed(2)}; // altura média no trecho (0 = rente)
      float k = (1.0 - clamp(y, 0.0, 1.0));
      s += L * k * k * 0.16;
    }
    s = clamp(s, 0.0, 1.0);
    if (s < 0.003) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
    // ondas subindo (a tremulação do ar)
    vec2 q = vec2(vUv.x * uAspect, vUv.y);
    vec2 off = vec2(vn(q * 38.0 + vec2(0.0, -uTime * 2.2)) - 0.5, vn(q * 31.0 + vec2(5.2, -uTime * 2.8)) - 0.5);
    off += 0.5 * vec2(vn(q * 90.0 + vec2(0.0, -uTime * 4.0)) - 0.5, 0.0);
    vec3 col = texture2D(tDiffuse, vUv + off * 0.012 * s).rgb;
    // brilho quente no ar (luz da lava espalhada)
    col += vec3(1.0, 0.33, 0.07) * s * (0.16 + 0.05 * sin(uTime * 1.7));
    gl_FragColor = vec4(col, 1.0);
  }`;

class HazePass extends Pass {
  constructor(camera, source) {
    super();
    this.camera = camera;
    this.source = source;
    this.lakes = () => []; // caixas de rocha fundida (world.hazards)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uInvVP: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() },
        uLake: { value: Array.from({ length: HAZE_N }, () => new THREE.Vector4()) },
        uTop: { value: new Array(HAZE_N).fill(0) },
        uCount: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: hazeFS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.vp = new THREE.Matrix4();
  }

  /** escolhe os lagos do quadro; sem lava por perto o passe sai da cadeia (não custa nada) */
  prepare() {
    const cam = this.camera;
    const u = this.material.uniforms;
    const pos = cam.getWorldPosition(u.uCam.value);
    // os lagos mais perto da câmera (a superfície de cada um é o topo da caixa)
    const list = this.lakes()
      .filter((b) => b.max.y - b.min.y < 3)
      .map((b) => ({ b, d: Math.hypot(Math.max(b.min.x - pos.x, 0, pos.x - b.max.x), Math.max(b.max.y - pos.y, 0, pos.y - b.max.y - HAZE_H), Math.max(b.min.z - pos.z, 0, pos.z - b.max.z)) }))
      .filter((l) => l.d < 120)
      .sort((a, c) => a.d - c.d)
      .slice(0, HAZE_N);
    list.forEach(({ b }, i) => {
      u.uLake.value[i].set(b.min.x, b.min.z, b.max.x, b.max.z);
      u.uTop.value[i] = b.max.y;
    });
    u.uCount.value = list.length;
    this.enabled = list.length > 0;
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    const u = this.material.uniforms;
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    u.uInvVP.value.copy(this.vp).invert();
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = this.source.depthTexture;
    u.uTime.value = performance.now() / 1000;
    u.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Lente gravitacional do campo de dilatação temporal (os dois botões por 5 s): a imagem em
 * volta da bolha é sugada para ela como perto de um buraco negro; a distorção vai sumindo aos poucos para fora. Com a câmera DENTRO da bolha,
 * são as bordas da tela que se curvam e giram (o mundo lá fora visto através da lente).
 */
/*
 * A esfera segue o "Core shader" do núcleo da Cidadela (Half-Life 2: Episode One), refeito em
 * três etapas — sem as texturas da Valve (aqui tudo é ruído gerado no shader):
 *  1) coordenadas circulares que pulsam: a textura do núcleo é lida em (fresnel, ângulo); o
 *     fresnel ganha um seno × tempo, e daí saem os anéis concêntricos pulsando;
 *  2) flow map: um mapa de normais animado por um campo de fluxo (duas fases que se alternam,
 *     para o fluxo não esticar) dita para onde a energia corre;
 *  3) refração em tela: a imagem de trás é deslocada pela normal da esfera + a do fluxo,
 *     borrada e multiplicada pela cor do núcleo.
 */
const lensFS = /* glsl */ `
  #include <packing>
  uniform sampler2D tDiffuse, tDepth;
  uniform vec2 uCenter;
  uniform float uR, uAspect, uFade, uTime, uInside, uNear, uFar;
  varying vec2 vUv;
  vec2 toUv(vec2 d){ d.x /= uAspect; return uCenter + d; }
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hh(i), hh(i + vec2(1, 0)), u.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p){ return 0.55 * vn(p) + 0.3 * vn(p * 2.1 + 3.7) + 0.15 * vn(p * 4.3 + 9.1); }
  // a arma (e o que estiver colado na câmera) não entra na lente
  float gunAt(vec2 uv){ return 1.0 - smoothstep(0.9, 1.6, -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar)); }

  // 2) mapa de normais (gradiente de um ruído) lido em coordenadas que o fluxo arrasta
  vec2 nrm(vec2 p){ float e = 0.04; return vec2(fbm(p + vec2(e, 0.0)) - fbm(p - vec2(e, 0.0)), fbm(p + vec2(0.0, e)) - fbm(p - vec2(0.0, e))) / (2.0 * e); }
  vec2 flowNormal(vec2 e){
    vec2 F = (vec2(vn(e * 1.4 + 11.0 + uTime * 0.05), vn(e * 1.4 + 23.0 - uTime * 0.04)) - 0.5) * 2.0; // campo de fluxo
    float t = uTime * 0.22;
    float p0 = fract(t), p1 = fract(t + 0.5);
    vec2 a = nrm(e * 3.0 - F * p0 * 1.2);
    vec2 b = nrm(e * 3.0 - F * p1 * 1.2 + 4.7);
    return mix(a, b, abs(1.0 - 2.0 * p0));
  }
  // 1) textura do núcleo em coordenadas circulares (fresnel, ângulo), pulsando com seno × tempo
  float corePattern(float fres, float ang){
    float u = fres * 3.2 - uTime * 0.35 + 0.18 * sin(uTime * 1.7 + fres * 6.0);
    float v = ang / 6.2831853;
    float rings = 0.5 + 0.5 * sin(u * 6.2831853 * 1.5 + fbm(vec2(v * 6.0, u * 0.7)) * 3.0);
    return mix(fbm(vec2(u * 2.0, v * 9.0)), rings, 0.55);
  }
  // 3) tela borrada (5 amostras), sem puxar a arma para dentro
  vec3 blurAt(vec2 uv, float rad){
    vec2 o = vec2(rad / uAspect, rad);
    vec3 c = texture2D(tDiffuse, uv).rgb * 0.4;
    c += texture2D(tDiffuse, uv + vec2(o.x, 0.0)).rgb * 0.15;
    c += texture2D(tDiffuse, uv - vec2(o.x, 0.0)).rgb * 0.15;
    c += texture2D(tDiffuse, uv + vec2(0.0, o.y)).rgb * 0.15;
    c += texture2D(tDiffuse, uv - vec2(0.0, o.y)).rgb * 0.15;
    return c;
  }

  void main(){
    vec2 d = vUv - uCenter; d.x *= uAspect;
    float r = length(d) + 1e-5;
    float x = r / uR;
    vec2 dir = d / r;
    vec2 e = d / uR; // posição na esfera (raio 1)
    float ang = atan(dir.y, dir.x);
    vec3 orig = texture2D(tDiffuse, vUv).rgb;
    float gun = gunAt(vUv);
    vec3 col;

    if (uInside > 0.5) {
      // dentro: a casca envolve a vista — refração do fluxo pela tela toda, mais forte nas bordas
      // (onde se olha a casca de lado)
      float side = smoothstep(0.2, 1.2, x);
      vec2 fn = flowNormal(e * 0.9);
      vec2 q = d + fn * uR * (0.03 + 0.06 * side);
      q = mix(d, q, uFade * (1.0 - gun));
      vec2 su = toUv(q);
      if (gunAt(su) > 0.5) su = vUv;
      vec3 refr = min(blurAt(su, 0.002 + 0.004 * side), vec3(1.4));
      float pat = corePattern(clamp(x * 0.8, 0.0, 1.0), ang);
      vec3 tint = mix(vec3(0.55, 0.85, 0.95), vec3(0.85, 1.0, 1.05), pat);
      col = mix(refr, refr * tint + vec3(0.03, 0.09, 0.12) * pat * side, (0.4 + 0.5 * side) * uFade);
    } else if (x > 1.0) {
      // fora: a imagem fica como está, só com o halo ciano em volta da casca
      col = orig + vec3(0.35, 0.85, 1.0) * exp(-(x - 1.0) * 5.0) * 0.45 * uFade;
    } else {
      // a esfera: normal da casca (z = profundidade da esfera) e fresnel
      float z = sqrt(max(0.0, 1.0 - x * x));
      float fres = 1.0 - z;
      vec2 fn = flowNormal(e);
      float pat = corePattern(fres, ang);
      // 3) refração: normal do fluxo (some no fio da borda, sem salto com o lado de fora)
      //    + o pulso dos anéis empurrando a imagem para fora e para dentro
      vec2 q = d + fn * uR * 0.16 * (0.4 + 0.6 * z) * (1.0 - smoothstep(0.85, 1.0, x));
      q += dir * uR * (pat - 0.5) * 0.1 * z;
      q = mix(d, q, uFade * (1.0 - gun));
      vec2 su = toUv(q);
      if (gunAt(su) > 0.5) su = vUv;
      vec3 refr = min(blurAt(su, 0.0035), vec3(1.0)); // (cena em HDR: o branco passaria de 1)
      // cor do núcleo multiplicando a refração: vidro ciano escuro, mais claro onde a textura pulsa
      vec3 coreCol = mix(vec3(0.16, 0.36, 0.46), vec3(0.42, 0.78, 0.9), pat);
      float light = 0.6 + 0.4 * clamp(dot(normalize(vec3(e, z)), normalize(vec3(-0.45, 0.6, 0.7))), 0.0, 1.0);
      vec3 sph = refr * coreCol * light + vec3(0.004, 0.018, 0.026);
      // casca: ciano brilhante subindo para a borda (fresnel), reflexo de luz no alto
      sph = mix(sph, vec3(0.35, 0.85, 1.0) * (0.7 + 0.5 * light), pow(x, 5.0) * 0.75);
      vec2 hl = e - vec2(-0.32, 0.42);
      sph += vec3(0.5, 0.85, 1.0) * exp(-dot(hl, hl) * 12.0) * 0.25;
      col = mix(texture2D(tDiffuse, su).rgb, sph, uFade);
      col += vec3(0.4, 0.9, 1.0) * exp(-(1.0 - x) * 30.0) * 0.6 * uFade;
    }
    // a arma por cima de tudo, como estava
    col = mix(col, orig, gun);
    gl_FragColor = vec4(col, 1.0);
  }`;

class LensPass extends Pass {
  /** `source`: o alvo da cena (a profundidade diz onde está a arma, que não entra na lente) */
  constructor(camera, source) {
    super();
    this.camera = camera;
    this.source = source;
    this.field = null; // { center: Vector3, R, fade } vindo do jogo
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 1000 }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uR: { value: 0.2 }, uAspect: { value: 1 }, uFade: { value: 0 }, uTime: { value: 0 }, uInside: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: lensFS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.enabled = false;
    this._p = new THREE.Vector3();
    this._r = new THREE.Vector3();
  }

  /** posição da bolha na tela; fora da vista (atrás da câmera) o passe sai da cadeia */
  prepare() {
    const f = this.field;
    const u = this.material.uniforms;
    this.enabled = !!f && f.fade > 0.001;
    if (!this.enabled) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    u.uAspect.value = aspect;
    u.uFade.value = f.fade;
    u.uTime.value = performance.now() / 1000;
    const dist = cam.position.distanceTo(f.center);
    if (dist < f.R) {
      u.uInside.value = 1;
      u.uCenter.value.set(0.5, 0.5);
      u.uR.value = 0.62;
      return;
    }
    u.uInside.value = 0;
    const c = this._p.copy(f.center).applyMatrix4(cam.matrixWorldInverse);
    if (c.z > -0.05) return void (this.enabled = false); // atrás da câmera
    const ndc = this._r.copy(f.center).project(cam);
    u.uCenter.value.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    // raio aparente da esfera (em unidades da altura da tela)
    const ang = Math.asin(Math.min(0.999, f.R / dist));
    u.uR.value = (Math.tan(ang) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) * 0.5;
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = this.source.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * A cena, e por cima o que refrata a própria cena ("grab pass"): a imagem pronta é copiada e
 * os objetos de `overlay` (as esferas do campo de dilatação) a leem deslocada.
 * Bem mais leve que a transmissão do three.js, que desenharia a cena inteira de novo.
 */
class ScenePass extends Pass {
  constructor(scene, camera, target, overlay) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.target = target;
    this.overlay = overlay;
    this.needsSwap = false;
    this.grab = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    // a cópia leva no alfa onde está a arma (pela profundidade: o que fica colado na câmera), para a
    // esfera não refletir/refratar a arma que está na sua mão
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 1000 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `#include <packing>
        uniform sampler2D tSrc, tDepth; uniform float uNear, uFar; varying vec2 vUv;
        void main(){
          float dist = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
          gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0 - smoothstep(0.9, 1.6, dist));
        }`,
      depthTest: false,
      depthWrite: false,
    }));
  }

  render(renderer) {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    if (!this.overlay.children.some((o) => o.visible)) return;
    const w = this.target.width;
    const h = this.target.height;
    if (this.grab.width !== w || this.grab.height !== h) this.grab.setSize(w, h); // resolução cheia: é só uma cópia, barata
    const cu = this.copy.material.uniforms;
    cu.tSrc.value = this.target.texture;
    cu.tDepth.value = this.target.depthTexture;
    cu.uNear.value = this.camera.near;
    cu.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.grab);
    this.copy.render(renderer);
    coreUniforms.tGrab.value = this.grab.texture;
    coreUniforms.uScreen.value.set(w, h);
    renderer.setRenderTarget(this.target);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.overlay, this.camera);
    renderer.autoClear = auto;
  }
}

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = true;
    // só a cena precisa de MSAA (e de profundidade para o desfoque); o resto são
    // passes de tela cheia — antes todos escreviam em alvos com MSAA 4×, à toa
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.overlay = new THREE.Scene(); // o que refrata a cena (esferas do campo de dilatação)
    this.composer.addPass(new ScenePass(scene, camera, this.sceneRT, this.overlay));
    this.blur = new MotionBlurPass(camera, this.sceneRT);
    this.composer.addPass(this.blur);
    this.haze = new HazePass(camera, this.sceneRT); // névoa de calor sobre a rocha fundida
    this.composer.addPass(this.haze);
    this.lens = new LensPass(camera, this.sceneRT); // lente do campo de dilatação temporal
    this.composer.addPass(this.lens);
    this.shock = new ShaderPass(ShockShader);
    this.composer.addPass(this.shock);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.4, 1.6);
    this.composer.addPass(this.bloom);
    this.finish = new FinishPass();
    this.composer.addPass(this.finish);
    this.resize();
  }

  resize() {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.sceneRT.setSize(Math.floor(window.innerWidth * pr), Math.floor(window.innerHeight * pr));
  }

  /**
   * dispara a onda de choque (distorção); a posição na tela vem de `shockAt` a cada quadro.
   * `big`: onda grande saindo do centro da tela (parar/continuar o tempo)
   */
  shockwave({ big = false } = {}) {
    const u = this.shock.uniforms;
    u.uT.value = 0;
    this.shockBig = big;
    this.shockRate = big ? 1.4 : 2.6;
    u.uMaxR.value = big ? 0.8 : 0.14;
    u.uStrength.value = big ? 0.05 : 0.03;
    u.uWidth.value = big ? 2.6 : 1;
    if (big) u.uCenter.value.set(0.5, 0.5);
  }

  /** onde fica a boca da arma na tela (coordenadas 0..1), para a onda sair dali */
  set shockAt(v) {
    if (this.shockBig && this.shock.uniforms.uT.value < 1) return; // a onda grande fica no centro
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
    su.uT.value = Math.min(1, su.uT.value + dt * (this.shockRate ?? 2.6));
    su.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    this.shock.enabled = su.uT.value < 1;
    // salto no tempo: aberração forte que some em ~0,7 s
    this.warp = Math.max(0, (this.warp ?? 0) - dt * 1.5);
    // `dilate` 0..1: carga/campo de dilatação temporal (a imagem se separa nas bordas)
    u.uAberr.value = slow * 0.012 + this.warp * this.warp * 0.08 + (this.dilate ?? 0) * 0.005;
    u.uVignette.value = 0.18 + slow * 0.25 + this.warp * 0.4;
    this.bloom.strength = 0.45 + slow * 0.25;
    // no tempo lento a câmera anda pouco por quadro: o rastro fica mais longo;
    // acima de ~8 m/s o rastro cresce com a velocidade e ganha o borrão radial
    const fast = THREE.MathUtils.smoothstep(speed, 8, 32);
    this.blur.strength = (0.6 + slow * 1.4) * (1 + fast * 2.2);
    this.blur.maxLen = 0.045 + fast * 0.075;
    this.tunnel = Math.max(0, (this.tunnel ?? 0) - dt * 1.3); // salto no tempo: túnel radial
    this.blur.radial = fast * 0.05 * ahead + this.tunnel * this.tunnel * 0.16;
    this.blur.strength += this.tunnel * 3;
    this.haze.prepare();
    this.lens.prepare();
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

  /**
   * `color` da borda: azul na grade, laranja na fornalha/rocha fundida. `appear`: ao
   * contrário (o objeto se materializa — mudança vinda do passado)
   */
  add(mesh, color = new THREE.Color(0.45, 0.8, 1.0), { appear = false } = {}) {
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
    if (appear) mat.uniforms.uT.value = 1;
    this.list.push({ ghost, mat, sparks, vel, t: 0, appear });
  }

  update(dt) {
    for (const d of [...this.list]) {
      d.t += dt;
      const k = d.t / 1.2;
      d.mat.uniforms.uT.value = d.appear ? Math.max(0, 1 - k) : Math.min(1, k);
      if (!d.appear) d.ghost.position.y += dt * 0.25;
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
