// Esfera do campo de dilatação temporal como objeto 3D (no estilo do núcleo da Cidadela de
// Half-Life 2: Episode One). Vidro que refrata o que está atrás por "grab pass" (fx.js): a cena
// é desenhada sem a esfera, a imagem é copiada e a esfera, desenhada por cima,
// lê essa cópia deslocada pela refração — bem mais leve que a transmissão do three.js, que
// desenharia a cena inteira de novo. Paredes na frente escondem a esfera (teste de profundidade)
// e de dentro se vê a casca em volta (BackSide).
//
//  1) anéis pulsando: lidos em (fresnel, ângulo), com seno × tempo no fresnel;
//  2) flow map: um ruído 3D arrastado por um campo de fluxo (duas fases que se alternam, para não
//     esticar) deforma a normal;
//  3) refração em tela: a cópia da cena, deslocada pela normal, multiplicada pela cor do núcleo.

import * as THREE from 'three';

export const coreUniforms = { uCoreTime: { value: 0 }, tGrab: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) } };
const MAX_BOXES = 8; // caixas sólidas que encostam na esfera (para suavizar o contato)

const VS = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying vec3 vW;
void main(){
  vP = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vec4 mvPosition = mv;
  #include <clipping_planes_vertex>
  vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FS = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform sampler2D tGrab;
uniform vec2 uScreen;
uniform float uCoreTime, uFade, uInside, uRad, uDist;
uniform vec3 uC;
uniform mat4 projectionMatrix;
uniform vec3 uBoxMin[${MAX_BOXES}];
uniform vec3 uBoxMax[${MAX_BOXES}];
uniform int uBoxN;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying vec3 vW;
float cH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float cN(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cH(i), cH(i + vec3(1, 0, 0)), u.x), mix(cH(i + vec3(0, 1, 0)), cH(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(cH(i + vec3(0, 0, 1)), cH(i + vec3(1, 0, 1)), u.x), mix(cH(i + vec3(0, 1, 1)), cH(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float cF(vec3 p){ return 0.65 * cN(p) + 0.35 * cN(p * 2.3 + 3.7); }
// "normal" do ruído: três leituras deslocadas
vec3 cGrad(vec3 p){ return (vec3(cF(p), cF(p + 17.3), cF(p + 31.7)) - 0.5) * 3.0; }
// 2) flow map
vec3 coreFlow(vec3 p){
  vec3 F = (vec3(cN(p * 1.3 + 11.0 + uCoreTime * 0.05), cN(p * 1.3 + 23.0 - uCoreTime * 0.04), cN(p * 1.3 + 37.0)) - 0.5) * 2.0;
  float t = uCoreTime * 0.22;
  float p0 = fract(t), p1 = fract(t + 0.5);
  vec3 a = cGrad(p * 2.6 - F * p0 * 1.2);
  vec3 b = cGrad(p * 2.6 - F * p1 * 1.2 + 4.7);
  return mix(a, b, abs(1.0 - 2.0 * p0));
}
// distância até a caixa sólida mais próxima (0 na superfície dela)
float coreContact(vec3 p){
  float d = 1e3;
  for (int i = 0; i < ${MAX_BOXES}; i++) {
    if (i >= uBoxN) break;
    vec3 c = (uBoxMin[i] + uBoxMax[i]) * 0.5, h = (uBoxMax[i] - uBoxMin[i]) * 0.5;
    vec3 q = abs(p - c) - h;
    d = min(d, length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0));
  }
  return d;
}
// projeta um ponto do mundo na tela (0..1)
vec2 toScreen(vec3 w){ vec4 c = projectionMatrix * viewMatrix * vec4(w, 1.0); return c.xy / c.w * 0.5 + 0.5; }
// a cópia da cena; onde ela marcou a arma (alfa), usa o que está logo atrás da esfera no lugar
vec3 grabAt(vec2 uv){
  vec4 g = texture2D(tGrab, clamp(uv, vec2(0.001), vec2(0.999)));
  if (g.a > 0.5) g = texture2D(tGrab, gl_FragCoord.xy / uScreen);
  return min(g.rgb, vec3(1.3));
}
void main(){
  #include <clipping_planes_fragment>
  vec3 V = normalize(vW - cameraPosition);            // raio da câmera (mundo)
  vec3 Nw = normalize(vW - uC);                         // normal da casca (mundo)
  float ang = atan(vP.y, vP.x);
  float facing = clamp(dot(-V, Nw), 0.0, 1.0);
  float fres = 1.0 - facing;
  // anéis pulsando e fluxo (bem de leve: só ondulam a superfície do vidro)
  float u = fres * 3.2 - uCoreTime * 0.35 + 0.18 * sin(uCoreTime * 1.7 + fres * 6.0);
  float rings = sin(u * 9.42 + cF(vec3(ang * 1.5, u * 0.7, 1.0)) * 3.0);
  vec3 g = coreFlow(vP);
  g -= vP * dot(g, vP);
  // (uDist: a distorção começa mais fraca quando o campo nasce e cresce aos poucos)
  vec3 N1 = normalize(Nw + (g * 0.06 + Nw * rings * 0.015) * uFade * uDist);
  // refração de verdade: entra (ar → vidro), atravessa, sai do outro lado (vidro → ar)
  float eta = 1.0 / mix(1.0, 1.33, uFade * uDist);
  vec3 r1 = refract(V, N1, eta);
  float tIn = max(-2.0 * dot(r1, vW - uC), 0.0);       // caminho dentro da esfera
  vec3 P2 = vW + r1 * tIn;
  vec3 N2 = normalize(P2 - uC);
  vec3 r2 = refract(r1, -N2, 1.0 / eta);
  if (dot(r2, r2) < 1e-4) r2 = reflect(r1, -N2);         // reflexão interna total
  vec3 refr = grabAt(toScreen(P2 + r2 * 6.0));
  // absorção pelo caminho no vidro: ciano mais forte no meio, mais claro na borda
  vec3 absorb = exp(-(vec3(1.0) - vec3(0.17, 0.62, 0.75)) * tIn / (uRad * 2.2));
  vec3 col = refr * mix(vec3(1.0), absorb * vec3(0.92, 1.0, 1.05), uFade);
  // reflexo (fresnel de Schlick): o ambiente refletido na casca + as luzes de cima
  float F = 0.04 + 0.96 * pow(fres, 5.0);
  vec3 R = reflect(V, N1);
  vec3 refl = grabAt(toScreen(vW + R * 4.0)) * 0.85 + vec3(0.12, 0.2, 0.24) * max(R.y, 0.0);
  col = mix(col, refl, F * uFade);
  float spec = pow(max(dot(R, normalize(vec3(-0.25, 1.0, 0.15))), 0.0), 140.0) + 0.5 * pow(max(dot(R, normalize(vec3(0.3, 1.0, -0.3))), 0.0), 220.0);
  col += vec3(1.0) * spec * 2.2 * uFade;
  // borda ciano (a casca de energia)
  col += vec3(0.22, 0.7, 1.0) * pow(fres, 3.0) * 0.45 * uFade;
  // contato suave: perto de uma superfície sólida a esfera vai sumindo
  float a = smoothstep(0.0, 0.45, coreContact(vW));
  gl_FragColor = vec4(col, a);
}`;

/** malha da esfera (raio R); fade/dentro/contatos pelas funções abaixo */
export function makeCoreSphere(R) {
  const boxes = { min: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) }, max: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) }, n: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tGrab: coreUniforms.tGrab,
      uScreen: coreUniforms.uScreen,
      uCoreTime: coreUniforms.uCoreTime,
      uFade: { value: 1 },
      uInside: { value: 0 },
      uC: { value: new THREE.Vector3() },
      uRad: { value: R },
      uDist: { value: 1 },
      uBoxMin: boxes.min,
      uBoxMax: boxes.max,
      uBoxN: boxes.n,
    },
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    clipping: true, // nas vistas pelos portais, o que está atrás do portal de saída não aparece
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 48), mat);
  mesh.userData.R = R;
  mesh.userData.boxes = boxes;
  return mesh;
}

/** esmaecer (0..1) e de que lado está a câmera (de dentro, só a casca de trás) */
export function setCoreFade(mesh, k, inside = false, dist = 1) {
  const u = mesh.material.uniforms;
  u.uDist.value = dist;
  u.uC.value.copy(mesh.position);
  u.uRad.value = mesh.userData.R * mesh.scale.x;
  u.uFade.value = k;
  u.uInside.value = inside ? 1 : 0;
  const side = inside ? THREE.BackSide : THREE.FrontSide;
  if (mesh.material.side !== side) mesh.material.side = side;
  mesh.visible = k > 0.002;
}

/** caixas sólidas (com `min`/`max`) que encostam na esfera, para o contato suave; as mais próximas primeiro */
export function setCoreContacts(mesh, solids) {
  const R = mesh.userData.R * mesh.scale.x + 0.5;
  const c = mesh.position;
  const b = mesh.userData.boxes;
  const near = [];
  for (const s of solids) {
    if (!s.min || !s.max || s.planes || s.obb || s.disabled) continue;
    const dx = Math.max(s.min.x - c.x, 0, c.x - s.max.x);
    const dy = Math.max(s.min.y - c.y, 0, c.y - s.max.y);
    const dz = Math.max(s.min.z - c.z, 0, c.z - s.max.z);
    const d = Math.hypot(dx, dy, dz);
    if (d < R) near.push([d, s]);
  }
  near.sort((a, z) => a[0] - z[0]);
  b.n.value = Math.min(near.length, MAX_BOXES);
  for (let i = 0; i < b.n.value; i++) {
    b.min.value[i].copy(near[i][1].min);
    b.max.value[i].copy(near[i][1].max);
  }
}
