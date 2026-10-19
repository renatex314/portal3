// Rocha fundida: material procedural (sem textura, nada se repete de longe) e brasas subindo.
//
// O padrão sai da posição no MUNDO: placas de crosta escura (Voronoi) boiando numa
// correnteza lenta, frestas incandescentes entre elas, poças abertas que borbulham e
// relevo (a crosta fica acima da lava exposta). A cor segue a temperatura: preto
// avermelhado → vermelho → laranja → amarelo quase branco (o bloom pega o mais quente).

import * as THREE from 'three';

export const lavaUniforms = { uLavaTime: { value: 0 } };

const LAVA_COMMON = /* glsl */ `
uniform float uLavaTime;
varying vec3 vLavaW;
varying vec3 vLavaN;
float lHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 lHash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float lNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lHash(i), lHash(i + vec2(1.0, 0.0)), u.x), mix(lHash(i + vec2(0.0, 1.0)), lHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * lNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
// (distância ao centro da placa, distância até a borda, sorteio da placa)
vec3 lVoro(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = lHash2(i + g);
      o = 0.5 + 0.4 * sin(t * 0.2 + 6.2831 * o); // as placas se juntam e se afastam devagar
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = lHash(i + g); } else if (d < d2) d2 = d;
    }
  d1 = sqrt(d1);
  return vec3(d1, sqrt(d2) - d1, id);
}
vec3 lHeatColor(float T) {
  vec3 c = mix(vec3(0.22, 0.015, 0.0), vec3(1.0, 0.16, 0.0), smoothstep(0.0, 0.45, T));
  c = mix(c, vec3(1.0, 0.5, 0.06), smoothstep(0.4, 0.75, T));
  return mix(c, vec3(1.0, 0.88, 0.55), smoothstep(0.82, 1.0, T));
}
// temperatura (0 crosta fria … 1 lava exposta) e relevo da crosta em vLavaW
float lavaHeat(out float height, out float grain) {
  vec3 an = abs(vLavaN);
  vec2 p = (an.y > 0.5 ? vLavaW.xz : (an.x > an.z ? vLavaW.zy : vLavaW.xy)) * 0.55;
  float t = uLavaTime;
  vec2 flow = vec2(t * 0.035, t * 0.022);
  vec2 w = vec2(lFbm(p * 0.6 + flow), lFbm(p * 0.6 - flow + 7.3));
  vec2 q = p + (w - 0.5) * 1.4 + flow * 0.5;
  vec3 v = lVoro(q, t);
  float n = lFbm(q * 3.0);
  grain = n;
  float aa = fwidth(v.y) * 1.5; // longe, a fresta não pisca
  float crack = 1.0 - smoothstep(0.01, 0.035 + 0.09 * n * n + 0.04 * v.z + aa, v.y);
  float pool = smoothstep(0.6, 0.8, lFbm(p * 0.22 + vec2(-t * 0.01, t * 0.008) + 3.1));
  float T = max(crack * (0.72 + 0.28 * n), pool * (0.78 + 0.22 * lFbm(q * 1.5 + t * 0.1)));
  // borda da placa ainda morna; cada placa esfria num ritmo
  T = max(T, (1.0 - smoothstep(0.0, 0.16, v.y)) * 0.3 * (1.0 - 0.7 * v.z));
  // bolhas nas poças: crescem, estouram e deixam um clarão
  vec2 bc = p * 1.3;
  vec2 bi = floor(bc);
  vec2 bf = fract(bc) - 0.5 - (lHash2(bi + 3.0) - 0.5) * 0.5;
  float bh = lHash(bi + 17.0);
  float ph = fract(t * 0.13 + bh * 7.0);
  float bd = length(bf);
  float r = ph * 0.3;
  float live = step(0.45, bh) * pool;
  float dome = (1.0 - smoothstep(r - 0.03, r, bd)) * step(ph, 0.9);
  float ring = (1.0 - smoothstep(0.0, 0.035, abs(bd - r))) * step(ph, 0.9);
  float pop = (1.0 - smoothstep(0.0, 0.22, bd)) * smoothstep(0.9, 0.92, ph) * (1.0 - smoothstep(0.93, 1.0, ph));
  T = mix(T, T * 0.55, dome * live) + (ring * 0.35 + pop * 0.8) * live;
  // muito longe vira a média (sem cintilar)
  float far = clamp(length(fwidth(q)) * 6.0 - 0.3, 0.0, 1.0);
  T = mix(T, 0.22 + 0.3 * pool, far);
  T = clamp(T * (0.93 + 0.07 * sin(t * 1.7 + n * 6.0)), 0.0, 1.0);
  height = (1.0 - T) * 0.7 + n * 0.3;
  return T;
}
`;

/** material da rocha fundida (MeshStandard com o padrão injetado: luz, névoa e sombras continuam valendo) */
export function lavaMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLavaTime = lavaUniforms.uLavaTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLavaW;\nvarying vec3 vLavaN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLavaW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLavaN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${LAVA_COMMON}`)
      .replace(
        '#include <map_fragment>',
        `float lavaH, lavaGrain;
        float lavaT = lavaHeat(lavaH, lavaGrain);
        diffuseColor.rgb = mix(vec3(0.03, 0.022, 0.02) * (0.4 + 1.1 * lavaGrain), vec3(0.3, 0.06, 0.01), smoothstep(0.2, 0.7, lavaT));`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.38, lavaT);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // relevo pela derivada da altura (a crosta fica acima da lava exposta)
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
          vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
          float det = dot(sX, R1);
          float hs = 0.12 * lavaH;
          vec3 grad = sign(det) * (dFdx(hs) * R1 + dFdy(hs) * R2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      )
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = lHeatColor(lavaT) * (pow(lavaT, 2.2) * 3.6 + 0.012);');
  };
  m.customProgramCacheKey = () => 'lava-v1';
  return m;
}

const EMBER_VS = /* glsl */ `
uniform float uLavaTime;
uniform float uScale;
attribute vec4 aSeed;
varying float vA;
varying float vHot;
void main() {
  float life = 2.5 + aSeed.y * 3.5;
  float ph = fract(uLavaTime / life + aSeed.x);
  vec3 p = position;
  p.y += ph * (1.5 + aSeed.z * 4.5);
  p.x += sin(uLavaTime * 0.9 + aSeed.w * 20.0) * 0.5 * ph;
  p.z += cos(uLavaTime * 0.7 + aSeed.x * 20.0) * 0.5 * ph;
  vA = (1.0 - ph) * smoothstep(0.0, 0.06, ph) * (0.6 + 0.4 * sin(uLavaTime * 12.0 + aSeed.w * 40.0));
  vHot = 1.0 - ph;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(1.5, (0.035 + 0.05 * aSeed.w) * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const EMBER_FS = /* glsl */ `
varying float vA;
varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  vec3 c = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.75, 0.3), vHot) * 3.0;
  gl_FragColor = vec4(c, vA * (1.0 - d * d));
}`;
let emberMat = null;

/** brasas que sobem da superfície (y = top) de um retângulo de lava; a quantidade segue a área, com teto */
export function lavaEmbers(min, max, top) {
  const area = (max.x - min.x) * (max.z - min.z);
  const n = Math.round(THREE.MathUtils.clamp(area * 0.12, 10, 320));
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = THREE.MathUtils.lerp(min.x, max.x, Math.random());
    pos[i * 3 + 1] = top;
    pos[i * 3 + 2] = THREE.MathUtils.lerp(min.z, max.z, Math.random());
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 7; // elas sobem até ~6 m
  emberMat ??= new THREE.ShaderMaterial({
    uniforms: { uLavaTime: lavaUniforms.uLavaTime, uScale: { value: 800 } },
    vertexShader: EMBER_VS,
    fragmentShader: EMBER_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pts = new THREE.Points(g, emberMat);
  pts.renderOrder = 7;
  return pts;
}

/** a cada quadro: tempo do padrão e tamanho das brasas na tela */
export function updateLava(t) {
  lavaUniforms.uLavaTime.value = t;
  if (emberMat) emberMat.uniforms.uScale.value = window.innerHeight * 0.9;
}
