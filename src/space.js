// Cena "espaço": Terra com corte em cunha mostrando as camadas, o túnel de
// vácuo, a cápsula, o satélite rasante, a Lua, estrelas e o Sol.
//
// Convenção de eixos (o "referencial do túnel"):
//   - o centro da Terra é a origem;
//   - o túnel principal é o eixo X: entrada em x = −R, saída em x = +R;
//   - o corte remove a cunha {y > corteY e z > 0}, então quem olha de frente
//     e de cima vê o túnel exatamente na quina do corte.
// A textura da Terra é girada (na geometria) para que a cidade de partida
// caia em −X; as camadas internas são esféricas, então não precisam girar.

import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { GLSL_NOISE } from './noise.js';
import { R_EARTH } from './physics.js';

export const R = 100; // raio da Terra na cena
export const KM = R / (R_EARTH / 1000); // unidades da cena por km
export const TUNNEL_R = 3.2; // raio visual do túnel (MUITO fora de escala)

const SUN_DIR = new THREE.Vector3(-0.42, 0.38, 1.0).normalize();

// Camadas (profundidade em km a partir da superfície)
export const LAYERS = [
  { key: 'crosta', name: 'Crosta', from: 0, to: 35, temp: 'até ~400 °C', state: 'rocha sólida' },
  { key: 'litosfera', name: 'Litosfera (manto rígido)', from: 35, to: 100, temp: '~500–1.000 °C', state: 'rocha sólida e rígida' },
  { key: 'astenosfera', name: 'Astenosfera', from: 100, to: 410, temp: '~1.300 °C', state: 'rocha sólida, mas "mole" como massinha' },
  { key: 'transicao', name: 'Zona de transição', from: 410, to: 670, temp: '~1.600 °C', state: 'rocha sólida' },
  { key: 'mantoInf', name: 'Manto inferior', from: 670, to: 2891, temp: '~1.600–3.700 °C', state: 'rocha sólida sob pressão enorme' },
  { key: 'nucleoExt', name: 'Núcleo externo', from: 2891, to: 5150, temp: '~4.000–5.000 °C', state: 'ferro e níquel LÍQUIDOS' },
  { key: 'nucleoInt', name: 'Núcleo interno', from: 5150, to: 6371, temp: '~5.400 °C (como a superfície do Sol)', state: 'bola de ferro sólido' },
];

export function latLonToVec3(lat, lon, radius = 1, target = new THREE.Vector3()) {
  // mesma parametrização da THREE.SphereGeometry, para bater com a textura
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  return target.set(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export function vec3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = 90 - (Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)) * 180) / Math.PI;
  // x = -cos(phi) sinθ, z = sin(phi) sinθ  →  phi = atan2(z, -x)
  let phi = Math.atan2(n.z, -n.x);
  if (phi < 0) phi += Math.PI * 2;
  let lon = (phi / (Math.PI * 2)) * 360 - 180;
  return { lat, lon };
}

const COMMON = /* glsl */ `
uniform float uCutY;      // a cunha {y > uCutY, z > 0} é removida
uniform float uBoreLen;   // comprimento já escavado do túnel (0..2R), a partir de x = -R
uniform float uTunnelR;
uniform float uR;
bool removed(vec3 p){
  if (p.y > uCutY && p.z > 0.0) return true;
  if (uBoreLen > 0.0 && length(p.yz) < uTunnelR && p.x < -uR + uBoreLen) return true;
  return false;
}
`;

function makeUniforms() {
  return {
    uCutY: { value: R * 2 },
    uBoreLen: { value: 0 },
    uTunnelR: { value: TUNNEL_R },
    uR: { value: R },
    uSunDir: { value: SUN_DIR.clone() },
    uTime: { value: 0 },
    uHighlightR: { value: 0 },
    uHighlightMix: { value: 0 },
    uLayerFocus: { value: -1 },
  };
}

export class SpaceScene {
  constructor(renderer, textures) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01030a);
    this.u = makeUniforms();
    this.textures = textures;
    this.geoQuat = new THREE.Quaternion(); // geo → túnel
    this.tunnelProgress = 0;

    this._lights();
    this._stars();
    this._sun();
    this._moon();
    this._earth();
    this._caps();
    this._tunnel();
    this._capsule();
    this._fieldArrows();
    this._satellite();
    this._chord();
    this._markers();
    this._depthMarkers();
  }

  // riscos em escala REAL: mina mais funda, furo mais fundo e fim da crosta
  _depthMarkers() {
    const g = new THREE.Group();
    const bar = (km, y, color, w = 0.004) => {
      const len = km * KM;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, w, w),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), depthTest: false, transparent: true }),
      );
      m.position.set(-R + len / 2, y, 0.01);
      m.renderOrder = 30;
      g.add(m);
    };
    bar(3.9, 0.018, 0xffb74d);
    bar(12.262, 0.006, 0xff5a4a);
    bar(35, -0.006, 0xb0bec5, 0.0025);
    // tique no fim da crosta
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.06, 0.003),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    tick.position.set(-R + 35 * KM, 0.0, 0.01);
    tick.renderOrder = 30;
    g.add(tick);
    g.visible = false;
    this.scene.add(g);
    this.depthMarkers = g;
    this.depthAnchors = {
      surface: new THREE.Vector3(-R, 0.012, 0.01),
      mponeng: new THREE.Vector3(-R + 3.9 * KM, 0.018, 0.01),
      kola: new THREE.Vector3(-R + 12.262 * KM, 0.006, 0.01),
      crust: new THREE.Vector3(-R + 35 * KM, -0.006, 0.01),
    };
  }

  // ---------------------------------------------------------------- luzes
  _lights() {
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(1000);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x201008, 0.35));
    this.sunLight = sun;
  }

  _stars() {
    const N = 9000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection();
      // concentra parte das estrelas numa faixa (uma "Via Láctea")
      if (i < N * 0.45) {
        v.y *= 0.18;
        v.normalize();
        v.applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.1);
      }
      v.multiplyScalar(8000);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      c.setHSL(t < 0.7 ? 0.6 : 0.08, t < 0.7 ? 0.25 : 0.6, 0.75 + Math.random() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = Math.pow(Math.random(), 6) * 3.2 + 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.u.uTime, uPixel: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 color;
        varying vec3 vColor; varying float vTw;
        uniform float uTime; uniform float uPixel;
        void main(){
          vColor = color;
          vTw = 0.75 + 0.25 * sin(uTime * (1.0 + fract(position.x) * 3.0) + position.y);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixel;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * vTw * 1.4, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  _sun() {
    const canvasTex = (draw, s = 256) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = s;
      draw(cv.getContext('2d'), s);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const glow = canvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.15, 'rgba(255,240,200,0.9)');
      gr.addColorStop(0.4, 'rgba(255,190,120,0.25)');
      gr.addColorStop(1, 'rgba(255,160,80,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
    const ring = canvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(120,200,255,0)');
      gr.addColorStop(0.7, 'rgba(140,210,255,0.35)');
      gr.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
    const hex = canvasTex((g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,220,180,0.5)');
      gr.addColorStop(1, 'rgba(255,200,150,0)');
      g.fillStyle = gr;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.lineTo(s / 2 + Math.cos(a) * s * 0.48, s / 2 + Math.sin(a) * s * 0.48);
      }
      g.fill();
    });
    const light = new THREE.PointLight(0xffffff, 0, 1);
    light.position.copy(SUN_DIR).multiplyScalar(6000);
    const flare = new Lensflare();
    flare.addElement(new LensflareElement(glow, 700, 0, new THREE.Color(1, 0.95, 0.85)));
    flare.addElement(new LensflareElement(ring, 240, 0.25));
    flare.addElement(new LensflareElement(hex, 60, 0.6));
    flare.addElement(new LensflareElement(hex, 90, 0.75));
    flare.addElement(new LensflareElement(ring, 140, 0.95));
    light.add(flare);
    this.scene.add(light);
    this.flare = flare;
  }

  _moon() {
    const geo = new THREE.SphereGeometry(R * 0.273, 64, 48);
    const mat = new THREE.MeshStandardMaterial({ map: this.textures.moon, roughness: 1, metalness: 0 });
    this.moon = new THREE.Mesh(geo, mat);
    this.moon.position.set(-420, 160, -650);
    this.scene.add(this.moon);
  }

  // ---------------------------------------------------------------- Terra
  _earth() {
    const T = this.textures;
    this.surfaceGeoBase = new THREE.SphereGeometry(R, 256, 192);
    this.cloudGeoBase = new THREE.SphereGeometry(R * 1.007, 160, 120);

    const surfMat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.u,
        dayMap: { value: T.day },
        nightMap: { value: T.night },
        specMap: { value: T.spec },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vWPos;
        void main(){
          vUv = uv; vPos = position;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWPos = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        uniform sampler2D dayMap, nightMap, specMap;
        uniform vec3 uSunDir;
        varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vWPos;
        void main(){
          if (removed(vPos)) discard;
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWPos);
          float ndl = dot(N, uSunDir);
          float day = smoothstep(-0.18, 0.25, ndl);
          vec3 dayC = texture2D(dayMap, vUv).rgb;
          vec3 nightC = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.75, 0.45) * 2.2;
          float water = texture2D(specMap, vUv).r;
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 220.0) * water * 0.55 * day;
          vec3 col = dayC * (0.06 + 1.15 * max(ndl, 0.0)) ;
          col = mix(nightC * 0.9 + dayC * 0.025, col, day);
          col += vec3(1.0, 0.9, 0.75) * spec;
          // brilho azul da atmosfera nas bordas
          float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          col += vec3(0.25, 0.5, 1.0) * fr * (0.15 + 0.85 * day) * 0.9;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.surface = new THREE.Mesh(this.surfaceGeoBase.clone(), surfMat);
    this.scene.add(this.surface);

    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { ...this.u, cloudMap: { value: T.clouds } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vPos; varying vec3 vN;
        void main(){
          vUv = uv; vPos = position * (1.0 / 1.007);
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${COMMON}
        uniform sampler2D cloudMap; uniform vec3 uSunDir; uniform float uTime;
        varying vec2 vUv; varying vec3 vPos; varying vec3 vN;
        void main(){
          if (removed(vPos)) discard;
          float a = texture2D(cloudMap, vUv + vec2(uTime * 0.0012, 0.0)).a;
          float ndl = dot(normalize(vN), uSunDir);
          float l = smoothstep(-0.2, 0.4, ndl);
          gl_FragColor = vec4(vec3(1.0) * (0.05 + 1.0 * l), a * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(this.cloudGeoBase.clone(), cloudMat);
    this.scene.add(this.clouds);

    const atmoMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: this.u.uSunDir },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
          float inten = smoothstep(0.0, 1.0, rim) * 1.0;
          float sunSide = 0.35 + 0.65 * smoothstep(-0.5, 0.6, dot(normalize(vN), uSunDir));
          // borda interna mais intensa, fade externo suave
          float edge = smoothstep(1.0, 0.55, rim);
          gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * inten * sunSide * 1.6 * edge, 1.0);
        }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 96, 64), atmoMat);
    this.scene.add(this.atmosphere);

    // esfera invisível para clique (raycast)
    this.pickSphere = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 48),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.scene.add(this.pickSphere);
  }

  /** Gira a textura da Terra para que (lat, lon) fique em −X (entrada do túnel). */
  setOrigin(lat, lon) {
    const a = latLonToVec3(lat, lon, 1); // direção geográfica da cidade
    const north = new THREE.Vector3(0, 1, 0);
    const X = a.clone().negate(); // eixo +X do túnel aponta para a antípoda
    const Y = north.clone().sub(a.clone().multiplyScalar(north.dot(a)));
    if (Y.lengthSq() < 1e-6) Y.set(0, 0, 1);
    Y.normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const tunnelToGeo = new THREE.Matrix4().makeBasis(X, Y, Z);
    const geoToTunnel = tunnelToGeo.clone().invert();
    this.geoQuat.setFromRotationMatrix(geoToTunnel);

    for (const [mesh, base] of [
      [this.surface, this.surfaceGeoBase],
      [this.clouds, this.cloudGeoBase],
    ]) {
      mesh.geometry.dispose();
      mesh.geometry = base.clone().applyMatrix4(geoToTunnel);
    }
  }

  geoToScene(lat, lon, radius = R) {
    return latLonToVec3(lat, lon, radius).applyQuaternion(this.geoQuat);
  }

  sceneToGeo(p) {
    const inv = this.geoQuat.clone().invert();
    return vec3ToLatLon(p.clone().applyQuaternion(inv));
  }

  // ---------------------------------------------------------------- corte
  _caps() {
    const layerGLSL = LAYERS.map((l) => `${((R_EARTH / 1000 - l.to) * KM).toFixed(4)}`);
    // raios internos de cada camada (unidades da cena), do núcleo para fora
    const capMat = (planeAxis) =>
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main(){
            vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${COMMON}
          ${GLSL_NOISE}
          uniform float uTime; uniform vec3 uSunDir;
          uniform float uHighlightR, uHighlightMix, uLayerFocus;
          varying vec3 vW;
          // raio (cena) onde COMEÇA cada camada, de fora para dentro
          const float rLit  = ${layerGLSL[0]};
          const float rAst  = ${layerGLSL[1]};
          const float rTra  = ${layerGLSL[2]};
          const float rMinf = ${layerGLSL[3]};
          const float rNext = ${layerGLSL[4]};
          const float rNint = ${layerGLSL[5]};
          void main(){
            vec3 p = vW;
            float r = length(p);
            if (r > uR) discard;
            ${planeAxis === 'z' ? 'if (p.y < uCutY) discard;' : 'if (p.z < 0.0) discard;'}
            if (uBoreLen > 0.0 && length(p.yz) < uTunnelR && p.x < -uR + uBoreLen) discard;

            float n = fbm3(p * 0.35);
            float fine = vnoise(p * 4.0);
            vec3 col; float emit = 0.0; float idx;
            if (r > rLit) {            // crosta
              col = mix(vec3(0.42,0.36,0.30), vec3(0.62,0.55,0.45), n); idx = 0.0;
            } else if (r > rAst) {     // litosfera
              col = mix(vec3(0.38,0.20,0.12), vec3(0.50,0.27,0.15), n); idx = 1.0;
            } else if (r > rTra) {     // astenosfera
              col = mix(vec3(0.62,0.27,0.10), vec3(0.78,0.38,0.14), n); idx = 2.0;
            } else if (r > rMinf) {    // zona de transição
              col = mix(vec3(0.66,0.30,0.11), vec3(0.80,0.40,0.15), n); idx = 3.0;
            } else if (r > rNext) {    // manto inferior: escurece e esquenta para dentro
              float t = (r - rNext) / (rMinf - rNext);
              col = mix(vec3(0.75,0.20,0.06), vec3(0.55,0.20,0.09), t);
              col *= 0.8 + 0.4 * n;
              // correntes de convecção (bem lentas)
              float conv = sin(atan(p.y, p.x) * 6.0 + r * 0.25 + n * 4.0 + uTime * 0.05);
              col += vec3(0.12,0.03,0.0) * conv;
              idx = 4.0;
            } else if (r > rNint) {    // núcleo externo LÍQUIDO
              float flow = fbm3(p * 0.18 + vec3(uTime * 0.05, -uTime * 0.03, 0.0));
              col = mix(vec3(0.95,0.36,0.05), vec3(1.0,0.62,0.18), flow);
              emit = 0.25 + 0.3 * flow; idx = 5.0;
            } else {                   // núcleo interno sólido
              float t = r / rNint;
              col = mix(vec3(1.0,0.97,0.85), vec3(1.0,0.82,0.45), t);
              emit = 0.7; idx = 6.0;
            }
            col *= 0.85 + 0.3 * fine;
            col = pow(col, vec3(2.2)); // cores escolhidas em sRGB → linear

            // linhas finas entre camadas
            float edges = 0.0;
            float bounds[6]; bounds[0]=rLit; bounds[1]=rAst; bounds[2]=rTra; bounds[3]=rMinf; bounds[4]=rNext; bounds[5]=rNint;
            for (int i = 0; i < 6; i++) edges = max(edges, 1.0 - smoothstep(0.0, 0.25, abs(r - bounds[i])));
            col = mix(col, col * 0.35, edges * 0.8);
            // borda da superfície
            col = mix(col, vec3(0.9,0.85,0.7), 1.0 - smoothstep(0.0, 0.25, uR - r));

            // iluminação plana suave
            vec3 Nrm = ${planeAxis === 'z' ? 'vec3(0.0,0.0,1.0)' : 'vec3(0.0,1.0,0.0)'};
            float l = 0.55 + 0.45 * max(dot(Nrm, uSunDir), 0.0);
            vec3 lit = col * l + col * emit;

            // destaque de uma camada (passeio pelas camadas)
            if (uLayerFocus >= 0.0) {
              float on = 1.0 - step(0.5, abs(idx - uLayerFocus));
              lit = mix(lit * 0.28, lit * 1.25 + vec3(0.08,0.06,0.02), on);
            }

            // teorema das cascas: só a esfera abaixo de você puxa
            if (uHighlightMix > 0.0) {
              float inside = 1.0 - smoothstep(uHighlightR - 0.3, uHighlightR + 0.3, r);
              vec3 gold = mix(lit, lit * 0.5 + vec3(1.0,0.55,0.06) * 0.6, 0.7);
              float grey = dot(lit, vec3(0.3,0.59,0.11));
              vec3 dim = vec3(grey) * 0.22 + vec3(0.02,0.04,0.08);
              // listras diagonais na casca de fora ("se anula")
              float stripes = step(0.5, fract((p.x + p.y + p.z) * 0.25));
              dim += vec3(0.05,0.08,0.14) * stripes;
              vec3 h = mix(dim, gold, inside);
              float ring = 1.0 - smoothstep(0.0, 0.45, abs(r - uHighlightR));
              h += vec3(1.0,0.7,0.15) * ring * 2.0;
              lit = mix(lit, h, uHighlightMix);
            }
            gl_FragColor = vec4(lit, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.DoubleSide,
      });

    const g = new THREE.PlaneGeometry(2 * R, 2 * R, 1, 1);
    this.capZ = new THREE.Mesh(g, capMat('z')); // plano z = 0 (mostra metade de cima)
    this.scene.add(this.capZ);
    const g2 = new THREE.PlaneGeometry(2 * R, 2 * R, 1, 1).rotateX(-Math.PI / 2);
    this.capY = new THREE.Mesh(g2, capMat('y')); // plano y = corteY (mostra metade da frente)
    this.scene.add(this.capY);
  }

  // ---------------------------------------------------------------- túnel
  _tunnel() {
    const len = 2 * R;
    this.tunnel = new THREE.Group();
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, len, 64, 1, true).rotateZ(Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uTime: this.u.uTime, uR: this.u.uR },
        vertexShader: /* glsl */ `
          varying vec3 vP;
          void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uR; varying vec3 vP;
          void main(){
            float ang = atan(vP.z, vP.y);
            float x = vP.x;
            vec3 base = vec3(0.010, 0.012, 0.018);
            // painéis
            float panel = step(0.96, fract(x * 0.5)) + step(0.97, fract(ang * 4.0 / 3.14159));
            base += vec3(0.012) * panel;
            // anéis de luz a cada ~32 km
            float ringL = 1.0 - smoothstep(0.0, 0.05, abs(fract(x * 0.5) - 0.5));
            // 4 faixas de LED ao longo do túnel
            float strip = 1.0 - smoothstep(0.0, 0.06, abs(fract(ang * 2.0 / 3.14159) - 0.5));
            vec3 col = base + vec3(0.25, 0.75, 1.0) * ringL * 1.2 + vec3(0.3,0.6,1.0) * strip * 0.1;
            // marco do centro da Terra (vermelho) e marcos a cada 1.000 km
            float centre = 1.0 - smoothstep(0.0, 0.8, abs(x));
            col = mix(col, vec3(1.6, 0.25, 0.15), centre);
            float kmMark = 1.0 - smoothstep(0.0, 0.25, abs(mod(x + uR, 15.6964) ));
            col += vec3(1.2, 0.8, 0.3) * kmMark;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
      }),
    );
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(TUNNEL_R * 1.02, TUNNEL_R * 1.02, len, 64, 1, true).rotateZ(Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW;
          void main(){
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW;
          void main(){
            vec3 V = normalize(cameraPosition - vW);
            float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.5);
            gl_FragColor = vec4(vec3(0.6, 0.85, 1.0), 0.06 + f * 0.55);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    );
    // anéis estruturais
    const ringGeo = new THREE.TorusGeometry(TUNNEL_R * 1.06, 0.22, 10, 48).rotateY(Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d0, metalness: 0.9, roughness: 0.35 });
    const nR = 24;
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, nR);
    const m = new THREE.Matrix4();
    for (let i = 0; i < nR; i++) {
      m.makeTranslation(-R + ((i + 0.5) / nR) * len, 0, 0);
      rings.setMatrixAt(i, m);
    }
    // bocas do túnel (anéis luminosos)
    const mouthGeo = new THREE.TorusGeometry(TUNNEL_R * 1.25, 0.45, 12, 64).rotateY(Math.PI / 2);
    const mouthMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.2) });
    this.mouthA = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouthA.position.x = -R;
    this.mouthB = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouthB.position.x = R;

    this.tunnelBody = new THREE.Group();
    this.tunnelBody.add(inner, glass, rings);
    this.tunnel.add(this.tunnelBody, this.mouthA, this.mouthB);
    this.scene.add(this.tunnel);
    this.setTunnelProgress(0);
  }

  setTunnelProgress(p) {
    this.tunnelProgress = p;
    const len = 2 * R * p;
    this.u.uBoreLen.value = len;
    this.tunnelBody.scale.set(Math.max(p, 1e-4), 1, 1);
    this.tunnelBody.position.x = -R + R * p;
    this.tunnel.visible = p > 0.001;
    this.mouthB.visible = p > 0.999;
  }

  // ---------------------------------------------------------------- cápsula
  _capsule() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.7, 3.6, 12, 32).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.55, roughness: 0.25 }),
    );
    const windowBand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.74, 1.74, 1.1, 40, 1, true).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0b1d2c, metalness: 0.9, roughness: 0.1, emissive: 0x2fb6ff, emissiveIntensity: 0.6 }),
    );
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(1.73, 0.08, 8, 40).rotateY(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.9, 0.3) }),
    );
    stripe.position.x = -1.6;
    const stripe2 = stripe.clone();
    stripe2.position.x = 1.6;
    g.add(body, windowBand, stripe, stripe2);

    // rastro de velocidade
    const trailMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uAlpha;
        void main(){
          float a = pow(1.0 - vUv.y, 1.6) * uAlpha;
          gl_FragColor = vec4(vec3(0.4, 0.8, 1.6) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // cone com a ponta para trás (−X local); escala em X = comprimento
    const trailGeo = new THREE.ConeGeometry(1.5, 1, 32, 1, true).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    this.trail = new THREE.Mesh(trailGeo, trailMat);
    this.capsuleGroup = new THREE.Group();
    this.capsuleHalo = makeHalo(0x7fd8ff, 16);
    this.capsuleGroup.add(g, this.trail, this.capsuleHalo);
    this.capsuleBody = g;
    this.scene.add(this.capsuleGroup);

    // setas de gravidade (amarela) e velocidade (verde)
    this.gArrow = makeArrow(0xffc83d);
    this.vArrow = makeArrow(0x4dff9a);
    this.scene.add(this.gArrow, this.vArrow);

    // esfera "que puxa" (teorema das cascas) — só o contorno, brilhando
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { ...this.u },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vW; varying vec3 vP;
          void main(){
            vN = normalize(mat3(modelMatrix) * normal);
            vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vP = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${COMMON}
          varying vec3 vN; varying vec3 vW; varying vec3 vP;
          void main(){
            if (vP.y > uCutY && vP.z > 0.0) discard;
            vec3 V = normalize(cameraPosition - vW);
            float f = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
            gl_FragColor = vec4(vec3(1.0, 0.8, 0.3) * f * 1.3, f * 0.8);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.shell.visible = false;
    this.scene.add(this.shell);
  }

  _fieldArrows() {
    // setinhas ao longo do túnel apontando para o centro, tamanho ∝ g
    const n = 22;
    const geo = new THREE.ConeGeometry(0.9, 2.4, 12).rotateZ(-Math.PI / 2); // aponta +X
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.3), transparent: true, opacity: 0.95 });
    this.field = new THREE.InstancedMesh(geo, mat, n);
    this.field.visible = false;
    this.fieldN = n;
    this.scene.add(this.field);
  }

  updateFieldArrows(model) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < this.fieldN; i++) {
      const x = -R + ((i + 0.5) / this.fieldN) * 2 * R;
      const r = (Math.abs(x) / R) * R_EARTH;
      const g = model.g(r) / 10;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), x > 0 ? Math.PI : 0);
      p.set(x, TUNNEL_R + 3.2, 0);
      s.setScalar(Math.max(g, 0.02) * 1.25);
      m.compose(p, q, s);
      this.field.setMatrixAt(i, m);
    }
    this.field.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- satélite
  _satellite() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 2.2, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.9, roughness: 0.3 }),
    );
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1b3a8a, metalness: 0.6, roughness: 0.25, emissive: 0x0a1844 });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.8, 6), panelMat);
    p1.position.z = 4.6;
    const p2 = p1.clone();
    p2.position.z = -4.6;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1, 0.3) }));
    beacon.position.y = 1.4;
    g.add(body, p1, p2, beacon);
    this.satellite = g;
    this.satellite.visible = false;
    this.scene.add(g);

    this.orbitLine = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.04, 0.28, 8, 256),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.85, 0.35), transparent: true, opacity: 0.75 }),
    );
    this.orbitLine.visible = false;
    this.scene.add(this.orbitLine);

    this.projLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xfff2b0, dashSize: 2, gapSize: 1.4, transparent: true, opacity: 1, depthTest: false }),
    );
    this.projLine.visible = false;
    this.projLine.renderOrder = 10;
    this.scene.add(this.projLine);
  }

  // ---------------------------------------------------------------- túnel em corda
  _chord() {
    this.chordD = R * 0.5; // a 3.185 km do centro
    const L = Math.sqrt(R * R - this.chordD * this.chordD);
    const g = new THREE.Group();
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(TUNNEL_R * 0.8, TUNNEL_R * 0.8, 2 * L, 48, 1, true).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x5a3010,
        metalness: 0.3,
        roughness: 0.4,
        transparent: true,
        opacity: 0.55,
        emissive: 0x6a3008,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    g.add(tube);
    g.position.set(0, this.chordD, TUNNEL_R * 0.85);
    this.chordGroup = g;
    this.chordGroup.visible = false;
    this.scene.add(g);

    const cap = new THREE.Mesh(
      new THREE.CapsuleGeometry(1.25, 2.6, 8, 24).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffb04a, metalness: 0.4, roughness: 0.3, emissive: 0x442200 }),
    );
    cap.add(makeHalo(0xffa040, 13));
    this.chordCapsule = cap;
    g.add(cap);
  }

  // ---------------------------------------------------------------- marcadores
  _markers() {
    const pin = (color) => {
      const grp = new THREE.Group();
      const c = new THREE.Color(color);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 14), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2) }));
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(1.8, 2.4, 40),
        new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.8), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      );
      grp.add(head, halo);
      grp.userData.halo = halo;
      return grp;
    };
    this.pinA = pin(0x4dd2ff);
    this.pinB = pin(0xff6b4d);
    this.scene.add(this.pinA, this.pinB);

    this.throughLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-R, 0, 0), new THREE.Vector3(R, 0, 0)]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.throughLine.computeLineDistances();
    this.throughLine.renderOrder = 9;
    this.scene.add(this.throughLine);

    // par de marcadores para o explorador de antípodas
    this.pickA = pin(0x7dff9a);
    this.pickB = pin(0xffe14d);
    this.pickLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xfff0a0, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.pickLine.renderOrder = 9;
    this.pickA.visible = this.pickB.visible = this.pickLine.visible = false;
    this.scene.add(this.pickA, this.pickB, this.pickLine);
  }

  placePin(pin, p) {
    pin.position.copy(p).setLength(R * 1.01);
    pin.lookAt(p.clone().multiplyScalar(2));
  }

  setPick(p) {
    if (!p) {
      this.pickA.visible = this.pickB.visible = this.pickLine.visible = false;
      return;
    }
    const a = p.clone().setLength(R);
    const b = a.clone().negate();
    this.placePin(this.pickA, a);
    this.placePin(this.pickB, b);
    this.pickLine.geometry.setFromPoints([a, b]);
    this.pickLine.computeLineDistances();
    this.pickA.visible = this.pickB.visible = this.pickLine.visible = true;
  }

  update(t) {
    this.u.uTime.value = t;
    this.capY.position.y = Math.min(this.u.uCutY.value, R * 1.5);
    const pulse = 1 + 0.25 * Math.sin(t * 4);
    for (const p of [this.pinA, this.pinB, this.pickA, this.pickB]) p.userData.halo.scale.setScalar(pulse);
    this.moon.rotation.y = t * 0.01;
  }
}

function makeHalo(color, size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv),
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sp.scale.setScalar(size);
  sp.renderOrder = 15;
  return sp;
}

function makeArrow(color) {
  const grp = new THREE.Group();
  const c = new THREE.Color(color).multiplyScalar(1.6);
  const mat = new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 12).rotateZ(-Math.PI / 2).translate(0.5, 0, 0), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.2, 16).rotateZ(-Math.PI / 2), mat);
  grp.add(shaft, head);
  grp.renderOrder = 20;
  shaft.renderOrder = head.renderOrder = 20;
  grp.userData = { shaft, head };
  grp.visible = false;
  return grp;
}

/** Ajusta uma seta (feita apontando para +X) para começar em `from`, direção ±X, comprimento `len`. */
export function setArrow(arrow, from, dirSign, len) {
  const L = Math.max(len, 0);
  arrow.position.copy(from);
  arrow.scale.set(1, 1, 1);
  arrow.rotation.set(0, dirSign < 0 ? Math.PI : 0, 0);
  arrow.userData.shaft.scale.set(Math.max(L - 2.2, 0.001), 1, 1);
  arrow.userData.head.position.x = Math.max(L - 1.1, 1.1);
  arrow.userData.head.visible = L > 0.3;
  arrow.userData.shaft.visible = L > 2.3;
}
