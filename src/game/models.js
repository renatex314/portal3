// Modelos detalhados do jogo de portais: arma, amostra (cubo), botão de piso e
// torreta. Tudo feito com geometria do three.js (nada de arquivos de fora).
// Os materiais "plásticos" e metálicos usam um mapa de ambiente gerado na hora
// (sala neutra) para ganhar reflexo, como o acabamento dos laboratórios do gênero.
// As texturas (emendas, parafusos, grelhas, etiquetas) são desenhadas em canvas
// e viram também mapas de relevo.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, heightToNormal, tex, grain } from './textures.js';

let ENV = null;
/** gera (uma vez) o mapa de reflexo usado pelos modelos */
export function initEnvironment(renderer) {
  if (ENV) return ENV;
  const pm = new THREE.PMREMGenerator(renderer);
  ENV = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return ENV;
}
export const envMap = () => ENV;

const plastic = (color, o = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.25, envMap: ENV, envMapIntensity: 0.55, ...o });
const metal = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.75, envMap: ENV, envMapIntensity: 0.7, ...o });
const glow = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

/** perfil (raio, posição ao longo do eixo) → sólido de revolução com o eixo em −z */
function latheZ(points, segments = 40) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  ).rotateX(-Math.PI / 2);
}

/** cilindro ligando dois pontos */
function limb(a, b, r0, r1, mat, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** desenha cor e relevo juntos: `draw(g, h, w, h)` → { map, normalMap } */
function painted(w, hh, draw, strength = 2, base = '#fff') {
  const cv = canvas(w, hh);
  const hv = canvas(w, hh);
  const g = cv.getContext('2d');
  const h = hv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, hh);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, w, hh);
  draw(g, h, w, hh);
  return { map: tex(cv), normalMap: tex(heightToNormal(hv, strength), { srgb: false }) };
}

/** brilho redondo (sprite aditivo) */
let GLOW_TEX = null;
export function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const cv = canvas(128);
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 128, 128);
  GLOW_TEX = new THREE.CanvasTexture(cv);
  return GLOW_TEX;
}

/** clarão de disparo: estrela de 4 pontas */
let FLASH_TEX = null;
function flashTexture() {
  if (FLASH_TEX) return FLASH_TEX;
  const cv = canvas(128);
  const c = cv.getContext('2d');
  c.translate(64, 64);
  for (let i = 0; i < 4; i++) {
    c.rotate(Math.PI / 2 + (Math.random() - 0.5) * 0.3);
    const gr = c.createLinearGradient(0, 0, 60, 0);
    gr.addColorStop(0, 'rgba(255,240,200,1)');
    gr.addColorStop(1, 'rgba(255,140,40,0)');
    c.fillStyle = gr;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(60, 0);
    c.lineTo(0, 9);
    c.fill();
  }
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, 30);
  gr.addColorStop(0, 'rgba(255,255,230,1)');
  gr.addColorStop(1, 'rgba(255,170,60,0)');
  c.fillStyle = gr;
  c.fillRect(-64, -64, 128, 128);
  FLASH_TEX = new THREE.CanvasTexture(cv);
  return FLASH_TEX;
}

// ------------------------------------------------------------------ arma de portais
/** casco da arma: u = volta (0 = topo, 0.75 = lado esquerdo), v = de trás (0) para a frente (1) */
function gunShellMaps() {
  return painted(
    1024,
    512,
    (g, h, W, H) => {
      grain(g, 0, 0, W, H, 3000, 0.04);
      // emendas em volta do casco (linha escura + sulco)
      for (const y of [H * 0.18, H * 0.52]) {
        g.fillStyle = 'rgba(30,30,32,0.75)';
        g.fillRect(0, y - 2, W, 4);
        h.fillStyle = '#000';
        h.fillRect(0, y - 2, W, 4);
      }
      // emenda longitudinal em cima e embaixo
      for (const x of [0, W / 2]) {
        g.fillStyle = 'rgba(30,30,32,0.6)';
        g.fillRect(x - 1.5, H * 0.52, 3, H * 0.48);
        h.fillStyle = '#000';
        h.fillRect(x - 1.5, H * 0.52, 3, H * 0.48);
      }
      // grelhas de ventilação nos dois lados, perto de trás
      for (const cx of [W * 0.25, W * 0.75])
        for (let k = 0; k < 6; k++) {
          const y = H * 0.62 + k * 16;
          g.fillStyle = 'rgba(25,25,28,0.85)';
          g.beginPath();
          g.roundRect(cx - 50, y, 100, 7, 3.5);
          g.fill();
          h.fillStyle = '#000';
          h.beginPath();
          h.roundRect(cx - 50, y, 100, 7, 3.5);
          h.fill();
        }
      // parafusos
      for (const [x, y] of [
        [W * 0.15, H * 0.3],
        [W * 0.35, H * 0.3],
        [W * 0.65, H * 0.3],
        [W * 0.85, H * 0.3],
      ]) {
        g.fillStyle = '#9a9ea4';
        g.beginPath();
        g.arc(x, y, 6, 0, 7);
        g.fill();
        h.fillStyle = '#fff';
        h.beginPath();
        h.arc(x, y, 6, 0, 7);
        h.fill();
      }
      // etiqueta no lado esquerdo (o que o jogador vê)
      g.save();
      g.translate(W * 0.75, H * 0.36);
      g.fillStyle = 'rgba(40,42,46,0.85)';
      g.fillRect(-70, -22, 140, 44);
      g.fillStyle = '#f2b23a';
      g.fillRect(-64, -16, 10, 32);
      g.fillStyle = '#e8e8e4';
      g.font = 'bold 16px Arial';
      g.fillText('ANTÍPODA', -46, -1);
      g.font = '11px Arial';
      g.fillText('DISP. DE PORTAIS', -46, 14);
      g.restore();
    },
    3,
    '#f4f4f0',
  );
}

/**
 * Arma de portais em primeira pessoa, de cara sci-fi: casco branco com placas
 * blindadas e condutos de energia (um pulso corre a cada tiro), aletas de
 * calor que abrem depois de atirar, anéis flutuando em volta da câmara de
 * vidro, núcleo aceso (cor do último portal) com bobina girando, íris no
 * emissor, três garras articuladas e um painel holográfico ao lado.
 * userData: { core, tip, claws, coil, leds, rings, conduit, vents, heatMat, iris, tipGlow, holo }.
 */
export function portalGun() {
  const g = new THREE.Group();
  // branco um pouco abaixo de 1: colado na câmera, o casco não deve "estourar" no brilho
  const white = plastic(0xe4e4e0, { ...gunShellMaps(), roughness: 0.38, clearcoat: 0.45, envMapIntensity: 0.35 });
  const whiteP = plastic(0xdcdcd8, { clearcoat: 0.45, envMapIntensity: 0.35 });
  const dark = metal(0x2b2d31, { roughness: 0.5, metalness: 0.55 });
  const black = metal(0x111214, { roughness: 0.6, metalness: 0.3 });
  const chrome = metal(0xb8bcc4, { roughness: 0.2, metalness: 0.95 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 });
  const coreMat = glow(new THREE.Color(0.5, 1.6, 3.2));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, roughness: 0.05, transparent: true, opacity: 0.25, envMap: ENV, envMapIntensity: 1.4, depthWrite: false, clearcoat: 1 });
  // condutos de energia: um pulso de luz corre de trás para a frente (cor do último portal)
  const conduit = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.5, 1.6, 3.2) }, uTime: { value: 0 }, uPulse: { value: -1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime, uPulse; varying vec2 vUv;
      void main(){
        float flow = 0.45 + 0.25 * sin(vUv.x * 40.0 - uTime * 6.0);
        float pulse = uPulse < 0.0 ? 0.0 : exp(-pow((vUv.x - uPulse) * 9.0, 2.0)) * 3.0;
        gl_FragColor = vec4(uColor * (flow + pulse), 1.0);
      }`,
    toneMapped: false,
  });

  // casco traseiro (ovo alongado) — o eixo da arma é −z
  const shell = new THREE.Mesh(
    latheZ(
      [
        [0.0, -0.3],
        [0.045, -0.296],
        [0.078, -0.278],
        [0.1, -0.24],
        [0.112, -0.17],
        [0.114, -0.09],
        [0.108, -0.02],
        [0.096, 0.04],
        [0.088, 0.07],
      ],
      64,
    ),
    white,
  );
  shell.scale.set(1, 0.92, 1);
  g.add(shell);
  // placas blindadas chanfradas dos dois lados
  const plateShape = new THREE.Shape();
  plateShape.moveTo(-0.11, -0.03);
  plateShape.lineTo(0.12, -0.035);
  plateShape.lineTo(0.15, 0.0);
  plateShape.lineTo(0.12, 0.04);
  plateShape.lineTo(-0.06, 0.045);
  plateShape.lineTo(-0.12, 0.01);
  plateShape.closePath();
  const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
  for (const sx of [-1, 1]) {
    const pl = new THREE.Mesh(plateGeo, whiteP);
    // a forma fica no plano zy (z = ao longo da arma)
    pl.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    pl.position.set(sx * 0.108, -0.005, 0.11);
    g.add(pl);
    // conduto aceso na borda da placa
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.118, 0.035, 0.22),
      new THREE.Vector3(sx * 0.121, 0.04, 0.08),
      new THREE.Vector3(sx * 0.112, 0.03, -0.03),
      new THREE.Vector3(sx * 0.095, 0.02, -0.12),
      new THREE.Vector3(sx * 0.08, 0.012, -0.19),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0045, 6, false), conduit));
  }
  // conduto de cima, ao longo do braço
  // anel de borracha entre o casco e o corpo
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.012, 10, 48), rubber);
  band.position.z = -0.06;
  band.scale.set(1, 0.92, 1);
  g.add(band);
  // tampa traseira com aletas
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 32).rotateX(Math.PI / 2), dark);
  cap.position.z = 0.296;
  g.add(cap);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.012), black);
    fin.position.set(Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0.31);
    fin.rotation.z = a;
    g.add(fin);
  }
  // aletas de calor: abrem depois dos tiros e mostram o brilho de dentro
  const heatMat = glow(new THREE.Color(0, 0, 0));
  const vents = [];
  for (const sx of [-1, 1]) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.075), heatMat);
    back.position.set(sx * 0.1, 0.03, 0.19);
    g.add(back);
    for (let k = 0; k < 4; k++) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.104, 0.012 + k * 0.012, 0.19);
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.011, 0.075), dark);
      slat.position.set(sx * 0.002, 0.0055, 0);
      pivot.add(slat);
      pivot.userData.side = sx;
      g.add(pivot);
      vents.push(pivot);
    }
  }

  // corpo escuro da frente, com nervuras
  const body = new THREE.Mesh(
    latheZ(
      [
        [0.0, 0.05],
        [0.09, 0.05],
        [0.088, 0.1],
        [0.078, 0.16],
        [0.07, 0.2],
        [0.0, 0.2],
      ],
      48,
    ),
    dark,
  );
  g.add(body);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.11), black);
    rib.position.set(Math.cos(a) * 0.084, Math.sin(a) * 0.084, -0.125);
    rib.rotation.z = a + Math.PI / 2;
    rib.rotation.x = 0.1;
    g.add(rib);
  }
  // câmara de vidro com o núcleo aceso e a bobina
  const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.11, 32, 1, true).rotateX(Math.PI / 2), glass);
  chamber.position.z = -0.255;
  chamber.renderOrder = 4;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.12, 16).rotateX(Math.PI / 2), coreMat);
  core.position.z = -0.25;
  const coreBall = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), coreMat);
  coreBall.position.z = -0.31;
  const coilPts = [];
  for (let i = 0; i <= 80; i++) {
    const a = (i / 80) * Math.PI * 2 * 5;
    coilPts.push(new THREE.Vector3(Math.cos(a) * 0.038, Math.sin(a) * 0.038, -0.205 - (i / 80) * 0.095));
  }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 160, 0.0035, 6), metal(0xc28a3a, { roughness: 0.3, metalness: 0.9 }));
  g.add(core, coreBall, coil, chamber);
  // anéis flutuantes em volta da câmara (soltos, girando em sentidos opostos)
  const rings = [];
  for (const [z, r, dir] of [
    [-0.235, 0.078, 1],
    [-0.285, 0.072, -1],
  ]) {
    const ring = new THREE.Group();
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.0055, 8, 48), chrome));
    // marcas acesas no anel
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.006), conduit);
      m.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.004);
      m.rotation.z = a + Math.PI / 2;
      ring.add(m);
    }
    ring.position.z = z;
    ring.userData = { z, dir };
    g.add(ring);
    rings.push(ring);
  }
  // anel do emissor e a íris (seis lâminas que abrem no disparo)
  const emitterRing = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.012, 10, 40), dark);
  emitterRing.position.z = -0.2;
  g.add(emitterRing);
  const dish = new THREE.Mesh(
    latheZ(
      [
        [0.03, 0.31],
        [0.062, 0.315],
        [0.066, 0.33],
        [0.06, 0.34],
        [0.035, 0.335],
      ],
      40,
    ),
    dark,
  );
  g.add(dish);
  const iris = [];
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.lineTo(0.034, 0.004);
  bladeShape.lineTo(0.03, 0.02);
  bladeShape.closePath();
  const bladeGeo = new THREE.ShapeGeometry(bladeShape);
  for (let k = 0; k < 6; k++) {
    const pivot = new THREE.Group();
    const a = (k / 6) * Math.PI * 2;
    pivot.position.set(Math.cos(a) * 0.034, Math.sin(a) * 0.034, -0.336);
    pivot.rotation.z = a + Math.PI * 0.62;
    const blade = new THREE.Mesh(bladeGeo, metal(0x3a3d42, { side: THREE.DoubleSide, roughness: 0.4 }));
    pivot.add(blade);
    pivot.userData.a = a + Math.PI * 0.62;
    g.add(pivot);
    iris.push(pivot);
  }
  // três garras articuladas: cada uma gira em volta da própria base (abre/fecha)
  const claws = [];
  const clawProfile = [
    [0.066, -0.19],
    [0.09, -0.25],
    [0.082, -0.33],
    [0.048, -0.39],
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(Math.cos(a) * 0.066, Math.sin(a) * 0.066, -0.19);
    holder.rotation.z = a;
    const pivot = new THREE.Group();
    holder.add(pivot);
    // no espaço do pivô: +x = para fora, −z = para a frente
    const curve = new THREE.CatmullRomCurve3(clawProfile.map(([r, z]) => new THREE.Vector3(r - 0.066, 0, z + 0.19)));
    const claw = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 10, false), black);
    const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), whiteP);
    tipBall.position.copy(curve.getPoint(1));
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12), dark);
    // reforço branco no meio da garra e um filete aceso por dentro
    const guard = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 4, 8), whiteP);
    guard.position.copy(curve.getPoint(0.45));
    guard.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(0.45));
    const inner = new THREE.CatmullRomCurve3(clawProfile.map(([r, z]) => new THREE.Vector3(r - 0.066 - 0.011, 0, z + 0.19)));
    const lit = new THREE.Mesh(new THREE.TubeGeometry(inner, 20, 0.003, 5, false), conduit);
    pivot.add(claw, tipBall, hinge, guard, lit);
    g.add(holder);
    claws.push(pivot);
  }
  // braço de cima: sai do casco e passa por cima da câmara, com conduto aceso
  const arm = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.098, 0.04),
    new THREE.Vector3(0, 0.128, -0.08),
    new THREE.Vector3(0, 0.122, -0.22),
    new THREE.Vector3(0, 0.098, -0.33),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(arm, 40, 0.017, 12, false), whiteP));
  const armLit = new THREE.CatmullRomCurve3(arm.points.map((p) => p.clone().add(new THREE.Vector3(0, 0.0165, 0))));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(armLit, 40, 0.0038, 6, false), conduit));
  const armTip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), dark);
  armTip.position.copy(arm.getPoint(1));
  g.add(armTip);
  for (const tt of [0.35, 0.62]) {
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 6, 16), dark);
    clip.position.copy(arm.getPoint(tt));
    clip.lookAt(clip.position.clone().add(arm.getTangent(tt)));
    g.add(clip);
  }
  // alça de baixo, mangueira e detalhes laterais
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.06, 0.2, 2, 0.02), black);
  grip.position.set(0, -0.1, 0.05);
  g.add(grip);
  for (let k = 0; k < 5; k++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.008, 0.012), rubber);
    ridge.position.set(0, -0.127, 0.0 + k * 0.03);
    g.add(ridge);
  }
  const hose = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.03, -0.09, -0.04),
    new THREE.Vector3(0.06, -0.1, -0.1),
    new THREE.Vector3(0.07, -0.06, -0.16),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 20, 0.008, 8, false), rubber));
  // luz indicadora no topo e LEDs de carga do lado esquerdo
  const lamp = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.06, 4, 10).rotateX(Math.PI / 2), coreMat);
  lamp.position.set(0, 0.102, -0.02);
  g.add(lamp);
  const leds = [];
  for (let k = 0; k < 3; k++) {
    const m = glow(new THREE.Color(0.4, 1.4, 2.4));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), m);
    led.position.set(-0.122, 0.034, -0.0 - k * 0.022);
    g.add(led);
    leds.push(m);
  }
  // painel holográfico flutuando ao lado esquerdo (o que o jogador vê)
  const holoCanvas = canvas(256, 128);
  const holoTex = new THREE.CanvasTexture(holoCanvas);
  holoTex.colorSpace = THREE.SRGBColorSpace;
  const holo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.21, 0.105),
    new THREE.MeshBasicMaterial({ map: holoTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
  // virado para o olho do jogador (que fica atrás e à esquerda da arma)
  holo.position.set(-0.24, 0.07, 0.17);
  holo.rotation.set(-0.42, -0.42, 0, "YXZ");
  holo.renderOrder = 5;
  const holoArm = limb(new THREE.Vector3(-0.105, 0.04, 0.15), new THREE.Vector3(-0.13, 0.055, 0.16), 0.003, 0.003, dark);
  g.add(holo, holoArm);
  // brilho de plasma na ponta
  const tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x88ccff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  tipGlow.position.set(0, 0, -0.35);
  tipGlow.scale.setScalar(0.06);
  g.add(tipGlow);

  const tip = new THREE.Object3D();
  tip.position.set(0, 0, -0.38);
  g.add(tip);
  g.userData = { core: coreMat, tip, claws, coil, leds, rings, conduit, vents, heatMat, iris, tipGlow, holo: { canvas: holoCanvas, tex: holoTex, t: 0 } };
  return g;
}

/**
 * Redesenha o painel holográfico da arma: estado dos dois portais, campo de
 * força (segurando), tempo lento e uma onda correndo. `s` = { blue, orange,
 * holding, slow, mode, color: [cssA, cssB], t }.
 */
export function drawGunHolo(gun, s) {
  const { canvas: cv, tex } = gun.userData.holo;
  const c = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  c.clearRect(0, 0, W, H);
  // fundo escuro translúcido: legível em parede clara ou escura
  c.fillStyle = 'rgba(4,18,32,0.62)';
  c.fillRect(3, 3, W - 6, H - 6);
  // linhas de varredura do holograma
  c.fillStyle = 'rgba(120,200,255,0.06)';
  for (let y = 4; y < H; y += 4) c.fillRect(3, y, W - 6, 1);
  c.strokeStyle = 'rgba(140,210,255,0.55)';
  c.lineWidth = 2;
  c.strokeRect(3, 3, W - 6, H - 6);
  // cantos
  c.fillStyle = 'rgba(140,210,255,0.9)';
  for (const [x, y] of [
    [3, 3],
    [W - 13, 3],
    [3, H - 6],
    [W - 13, H - 6],
  ])
    c.fillRect(x, y, 10, 3);
  c.font = 'bold 18px monospace';
  c.fillStyle = 'rgba(170,225,255,0.95)';
  c.fillText(s.mode === 'none' ? 'SEM ARMA' : 'PORTAIS', 12, 24);
  // indicadores dos portais
  const dot = (x, on, col, label) => {
    c.beginPath();
    c.arc(x, 50, 13, 0, Math.PI * 2);
    c.fillStyle = on ? col : 'rgba(255,255,255,0.08)';
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = 'rgba(200,230,255,0.9)';
    c.font = 'bold 14px monospace';
    c.fillText(label, x + 19, 55);
  };
  dot(26, s.blue, s.color[0], s.blue ? 'ON' : '--');
  if (s.mode === 'both') dot(140, s.orange, s.color[1], s.orange ? 'ON' : '--');
  // onda de energia
  c.beginPath();
  for (let x = 12; x < W - 12; x += 3) {
    const k = (x - 12) / (W - 24);
    const y = 82 + Math.sin(k * 18 - s.t * 8) * (s.holding ? 9 : 4) * Math.sin(k * Math.PI) + Math.sin(k * 51 + s.t * 13) * 1.5;
    if (x === 12) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.strokeStyle = s.holding ? 'rgba(255,220,120,0.9)' : 'rgba(120,200,255,0.8)';
  c.lineWidth = 3;
  c.stroke();
  // barra do tempo lento
  c.fillStyle = 'rgba(140,210,255,0.18)';
  c.fillRect(12, 104, W - 24, 10);
  c.fillStyle = s.slow < 0.25 ? 'rgba(255,120,90,0.9)' : 'rgba(150,230,255,0.85)';
  c.fillRect(12, 104, (W - 24) * s.slow, 10);
  c.font = '10px monospace';
  c.fillStyle = 'rgba(200,230,255,0.7)';
  c.fillText(s.holding ? 'CAMPO DE FORÇA' : 'TEMPO', W - 112, 100);
  tex.needsUpdate = true;
}

// ------------------------------------------------------------------ amostra (cubo)
let CUBE = null;
function cubeParts() {
  if (CUBE) return CUBE;
  const S = 512;
  // face: chapa cinza com moldura rebaixada, janela redonda mostrando o núcleo
  // de itabirito (ou o coração da amostra especial), cantoneiras e rebites
  const draw = (mode) => (g, h) => {
    const emissive = mode === 'glow' || mode === 'glowHeart';
    const heart = mode === 'heart' || mode === 'glowHeart';
    const c = S / 2;
    g.fillStyle = emissive ? '#000' : '#73777d';
    g.fillRect(0, 0, S, S);
    if (!emissive) {
      grain(g, 0, 0, S, S, 4000, 0.07);
      // moldura rebaixada
      for (const [ctx, col, w] of [
        [g, 'rgba(25,27,30,0.85)', 14],
        [h, '#202020', 14],
      ]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.strokeRect(96, 96, S - 192, S - 192);
      }
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 3;
      g.strokeRect(106, 106, S - 212, S - 212);
      // rebites em volta
      for (let k = 0; k < 4; k++)
        for (const [x, y] of [
          [140 + k * 77, 76],
          [140 + k * 77, S - 76],
          [76, 140 + k * 77],
          [S - 76, 140 + k * 77],
        ]) {
          g.fillStyle = '#a3a7ad';
          g.beginPath();
          g.arc(x, y, 6, 0, 7);
          g.fill();
          h.fillStyle = '#fff';
          h.beginPath();
          h.arc(x, y, 6, 0, 7);
          h.fill();
        }
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = `rgba(220,225,230,${Math.random() * 0.2})`;
        g.lineWidth = 1;
        g.beginPath();
        const x = Math.random() * S;
        const y = Math.random() * S;
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
        g.stroke();
      }
    }
    // janela do núcleo
    g.save();
    g.beginPath();
    g.arc(c, c, S * 0.17, 0, Math.PI * 2);
    g.clip();
    if (!emissive) {
      g.fillStyle = heart ? '#d9b3c4' : '#2c2a30';
      g.fillRect(0, 0, S, S);
      if (!heart)
        for (let y = c - S * 0.17; y < c + S * 0.17; y += 9) {
          g.fillStyle = Math.random() < 0.5 ? '#2c2a30' : '#8a3a1c';
          g.fillRect(c - S * 0.17, y + Math.sin(y * 0.3) * 3, S * 0.34, 6 + Math.random() * 5);
        }
    }
    g.restore();
    h.fillStyle = '#3a3a3a';
    h.beginPath();
    h.arc(c, c, S * 0.17, 0, Math.PI * 2);
    h.fill();
    if (heart) {
      g.fillStyle = emissive ? '#ff6ab4' : '#e05a9a';
      g.beginPath();
      const k = S * 0.0045;
      g.moveTo(c, c + 26 * k);
      g.bezierCurveTo(c - 34 * k, c + 2 * k, c - 26 * k, c - 26 * k, c, c - 12 * k);
      g.bezierCurveTo(c + 26 * k, c - 26 * k, c + 34 * k, c + 2 * k, c, c + 26 * k);
      g.fill();
    }
    // anel aceso em volta da janela + marcas nos cantos (em relevo)
    g.strokeStyle = emissive ? '#ffb030' : '#d58a2a';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(c, c, S * 0.19, 0, Math.PI * 2);
    g.stroke();
    h.strokeStyle = '#e0e0e0';
    h.lineWidth = 18;
    h.beginPath();
    h.arc(c, c, S * 0.19, 0, Math.PI * 2);
    h.stroke();
    for (const ctx of [g, h]) {
      ctx.lineWidth = 10;
      if (ctx === h) ctx.strokeStyle = '#d0d0d0';
      for (const [x, y] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(c + x * S * 0.27, c + y * S * 0.14);
        ctx.lineTo(c + x * S * 0.27, c + y * S * 0.27);
        ctx.lineTo(c + x * S * 0.14, c + y * S * 0.27);
        ctx.stroke();
      }
    }
    if (!emissive) {
      g.fillStyle = 'rgba(240,240,236,0.75)';
      g.font = 'bold 26px Arial';
      g.textAlign = 'center';
      g.fillText(heart ? 'AMOSTRA ESPECIAL' : 'AMOSTRA', c, S - 118);
      // pegada de terópode (três dedos) carimbada no alto da face
      g.fillStyle = 'rgba(213,138,42,0.85)';
      g.beginPath();
      g.ellipse(c, 142, 12, 9, 0, 0, Math.PI * 2);
      g.fill();
      for (const a of [-0.55, 0, 0.55]) {
        g.save();
        g.translate(c, 138);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, -17, 4.5, 13, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  };
  const faceMat = (heart) => {
    const { map, normalMap } = painted(S, S, draw(heart ? 'heart' : 'face'), 2.5);
    const emissiveMap = tex(canvas(S));
    draw(heart ? 'glowHeart' : 'glow')(emissiveMap.image.getContext('2d'), canvas(S).getContext('2d'));
    emissiveMap.needsUpdate = true;
    return new THREE.MeshPhysicalMaterial({
      map,
      normalMap,
      emissiveMap,
      emissive: heart ? 0xff6ab4 : 0xffffff,
      emissiveIntensity: 0.6,
      roughness: 0.5,
      metalness: 0.35,
      clearcoat: 0.25,
      envMap: ENV,
      envMapIntensity: 0.6,
    });
  };
  // cantoneiras: peça arredondada com um disco escuro em cada face de fora
  const cg = [];
  const dg = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        cg.push(new RoundedBoxGeometry(0.19, 0.19, 0.19, 3, 0.045).translate(x * 0.21, y * 0.21, z * 0.21));
        for (const [ax, s] of [
          ['x', x],
          ['y', y],
          ['z', z],
        ]) {
          const d = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20);
          if (ax === 'x') d.rotateZ(Math.PI / 2);
          if (ax === 'z') d.rotateX(Math.PI / 2);
          const p = new THREE.Vector3(x * 0.21, y * 0.21, z * 0.21);
          p[ax] = s * 0.302;
          dg.push(d.translate(p.x, p.y, p.z));
        }
      }
  CUBE = {
    face: faceMat(false),
    heart: faceMat(true),
    corner: plastic(0xdcdcd6, { roughness: 0.4 }),
    pink: plastic(0xf3b8d4, { roughness: 0.35 }),
    laserCorner: plastic(0x3a3d44, { roughness: 0.35, clearcoat: 0.8 }),
    disc: metal(0x3a3d42, { roughness: 0.5 }),
    body: new RoundedBoxGeometry(0.58, 0.58, 0.58, 3, 0.035),
    corners: mergeGeometries(cg),
    discs: mergeGeometries(dg),
  };
  return CUBE;
}

/** cubo de amostra no estilo dos cubos de teste: cantos reforçados e janela acesa */
export function sampleCube(opts = {}) {
  const P = cubeParts();
  const mat = (opts.special ? P.heart : P.face).clone();
  if (opts.laser) mat.emissive.set(0xff5030);
  const m = new THREE.Mesh(P.body, mat);
  m.castShadow = true;
  m.add(new THREE.Mesh(P.corners, opts.special ? P.pink : opts.laser ? P.laserCorner : P.corner), new THREE.Mesh(P.discs, P.disc));
  if (opts.laser) {
    // cubo refletor: lente na face da frente (+z), por onde o feixe sai
    const lensMat = glow(new THREE.Color(0.6, 0.08, 0.05));
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.06, 32).rotateX(Math.PI / 2), metal(0x2a2c30, { roughness: 0.3 }));
    bezel.position.z = 0.3;
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), lensMat);
    lens.position.z = 0.31;
    lens.scale.z = 0.5;
    m.add(bezel, lens);
    m.userData.lens = lensMat;
  }
  m.userData.glow = mat;
  return m;
}

// ------------------------------------------------------------------ botão de piso
/**
 * Botão grande de piso: base de metal com saia parafusada, anel claro, luzes
 * em volta, anel de luz girando por baixo da placa e a placa vermelha que
 * afunda. Devolve { group, plate, lights, spin }.
 */
export function floorButton() {
  const g = new THREE.Group();
  const baseMat = metal(0x4a4d53, { roughness: 0.5 });
  const base = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, 0],
        [1.04, 0],
        [1.05, 0.02],
        [0.99, 0.04],
        [0.97, 0.1],
        [0.86, 0.12],
        [0.8, 0.1],
        [0.72, 0.1],
        [0.7, 0.05],
        [0, 0.05],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      72,
    ),
    baseMat,
  );
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.025, 8, 72).rotateX(Math.PI / 2), plastic(0xe8e8e4));
  ring.position.y = 0.105;
  g.add(base, ring);
  // parafusos da saia e quatro presilhas
  const boltMat = metal(0x9a9ea6, { roughness: 0.3 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 6), boltMat);
    bolt.position.set(Math.cos(a) * 1.015, 0.03, Math.sin(a) * 1.015);
    g.add(bolt);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.08, 0.12, 2, 0.02), metal(0x2b2d31, { roughness: 0.45 }));
    clamp.position.set(Math.cos(a) * 0.98, 0.06, Math.sin(a) * 0.98);
    clamp.rotation.y = -a;
    g.add(clamp);
  }
  const lights = glow(new THREE.Color(2.6, 0.25, 0.12));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.07, 4, 8).rotateZ(Math.PI / 2), lights);
    l.position.set(Math.cos(a) * 0.79, 0.108, Math.sin(a) * 0.79);
    l.rotation.y = -a + Math.PI / 2;
    g.add(l);
  }
  // anel de luz por baixo da placa (gira mais rápido apertado)
  const spin = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.02), lights);
    seg.position.set(Math.cos(a) * 0.69, 0.1, Math.sin(a) * 0.69);
    seg.rotation.y = -a + Math.PI / 2;
    spin.add(seg);
  }
  g.add(spin);
  // placa: disco com bordas chanfradas e sulcos concêntricos (por cima, transparentes)
  const grooves = tex(canvas(512), { wrap: false });
  {
    const c = grooves.image.getContext('2d');
    const s = 512;
    for (let r = 36; r < s / 2 - 8; r += 40) {
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = 6;
      c.beginPath();
      c.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.14)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(s / 2, s / 2, r + 5, 0, Math.PI * 2);
      c.stroke();
    }
    // marcas de pisada no centro
    for (let k = 0; k < 30; k++) {
      c.strokeStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
      c.lineWidth = 2 + Math.random() * 4;
      c.beginPath();
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 150;
      c.arc(s / 2, s / 2, r, a, a + 0.3 + Math.random());
      c.stroke();
    }
    grooves.needsUpdate = true;
  }
  const plate = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, -0.06],
        [0.62, -0.06],
        [0.66, -0.03],
        [0.64, 0.04],
        [0.58, 0.06],
        [0, 0.06],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      72,
    ),
    new THREE.MeshPhysicalMaterial({ color: 0xc0392b, emissive: 0x5a0a05, roughness: 0.35, clearcoat: 0.6, envMap: ENV, envMapIntensity: 0.5 }),
  );
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.58, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: grooves, transparent: true, depthWrite: false }));
  top.position.y = 0.0615;
  plate.add(top);
  plate.position.y = 0.16;
  g.add(plate);
  return { group: g, plate, lights, spin };
}

// ------------------------------------------------------------------ torreta
/** casco da torreta: emendas, grelha, dobradiça e etiqueta (u = de um lado ao outro da metade, v = altura) */
let TURRET_SHELL = null;
function turretShellMaps() {
  if (TURRET_SHELL) return TURRET_SHELL;
  TURRET_SHELL = painted(
    512,
    512,
    (g, h, W, H) => {
      grain(g, 0, 0, W, H, 3000, 0.04);
      for (const y of [H * 0.3, H * 0.68]) {
        g.fillStyle = 'rgba(40,40,42,0.7)';
        g.fillRect(0, y - 2, W, 4);
        h.fillStyle = '#000';
        h.fillRect(0, y - 2, W, 4);
      }
      g.fillStyle = 'rgba(40,40,42,0.6)';
      g.fillRect(W / 2 - 1.5, H * 0.3, 3, H * 0.38);
      h.fillStyle = '#000';
      h.fillRect(W / 2 - 1.5, H * 0.3, 3, H * 0.38);
      // grelha do alto-falante, embaixo no lado
      for (let k = 0; k < 5; k++) {
        const y = H * 0.73 + k * 13;
        for (const ctx of [g, h]) {
          ctx.fillStyle = ctx === g ? 'rgba(30,30,33,0.85)' : '#000';
          ctx.beginPath();
          ctx.roundRect(W * 0.38, y, W * 0.24, 6, 3);
          ctx.fill();
        }
      }
      // dobradiça redonda no meio do lado
      g.fillStyle = '#8c9096';
      g.beginPath();
      g.arc(W / 2, H * 0.49, 16, 0, 7);
      g.fill();
      g.fillStyle = '#4a4d52';
      g.beginPath();
      g.arc(W / 2, H * 0.49, 8, 0, 7);
      g.fill();
      h.fillStyle = '#fff';
      h.beginPath();
      h.arc(W / 2, H * 0.49, 16, 0, 7);
      h.fill();
      g.fillStyle = 'rgba(60,62,66,0.8)';
      g.font = 'bold 15px Arial';
      g.textAlign = 'center';
      g.fillText('SEGURANÇA', W / 2, H * 0.22);
    },
    2.5,
    '#f4f4f0',
  );
  return TURRET_SHELL;
}

/**
 * Torreta de segurança: "ovo" branco partido ao meio (as metades abrem e
 * mostram as metralhadoras giratórias quando ela mira), olho vermelho com
 * íris, cabeça de T-rex robô, LEDs de status, antena que pisca e três pernas
 * com pistões. Tudo acima do quadril fica num grupo `head` que se mexe
 * (procura, mira, treme ao cair). userData: { lensMat, eyeGlow, halves, guns,
 * barrels, flashes, flashLight, body, head, iris, antMat, ledMat, spark }.
 */
export function turretModel() {
  const g = new THREE.Group();
  const head = new THREE.Group();
  const white = plastic(0xffffff, { ...turretShellMaps() });
  const whiteP = plastic(0xeeeeea, { roughness: 0.35 });
  const dark = metal(0x26282c, { roughness: 0.55 });
  const black = metal(0x121315, { roughness: 0.6, metalness: 0.4 });
  const chrome = metal(0xb8bcc4, { roughness: 0.2, metalness: 0.95 });
  const lensMat = glow(new THREE.Color(3, 0.15, 0.1));
  const ledMat = glow(new THREE.Color(0, 0, 0));
  const antMat = glow(new THREE.Color(2, 0.2, 0.1));

  const BODY_Y = 0.8;
  const S = [0.25, 0.45, 0.2];
  // miolo escuro (aparece na fenda) e as duas metades brancas
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), dark);
  inner.scale.set(S[0] * 0.9, S[1] * 0.97, S[2] * 0.95);
  inner.position.y = BODY_Y;
  head.add(inner);
  // fileira de LEDs na fenda da frente (acendem conforme abre)
  for (let k = 0; k < 6; k++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.01), ledMat);
    const y = BODY_Y - 0.22 + k * 0.04;
    led.position.set(0, y, S[2] * 0.95 * Math.sqrt(Math.max(0, 1 - ((y - BODY_Y) / (S[1] * 0.97)) ** 2)) + 0.002);
    head.add(led);
  }
  const halves = [];
  const guns = [];
  const barrels = [];
  const flashes = [];
  const flashMat = new THREE.SpriteMaterial({ map: flashTexture(), color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28, side < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI), white);
    shell.scale.set(S[0], S[1], S[2]);
    // tampa plana do lado de dentro de cada metade
    const lid = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateY((side * Math.PI) / 2), dark);
    lid.scale.set(1, S[1], S[2]);
    lid.position.x = -side * 0.001;
    half.add(shell, lid);
    // nervuras de blindagem do lado de fora
    for (const dy of [-0.12, 0.0, 0.12]) {
      const rib = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.025, 0.2, 2, 0.008), whiteP);
      rib.position.set(side * S[0] * Math.sqrt(Math.max(0, 1 - (dy / S[1]) ** 2)) * 0.98, dy, -0.02);
      half.add(rib);
    }
    // metralhadora giratória (três canos em volta de um eixo) que aparece com a metade aberta
    const gunG = new THREE.Group();
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.17, 0.15, 2, 0.02), dark);
    housing.position.set(side * 0.03, 0, 0.0);
    gunG.add(housing);
    const spin = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.17, 10).rotateX(Math.PI / 2), black);
      barrel.position.set(Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0);
      spin.add(barrel);
    }
    const front = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.015, 16).rotateX(Math.PI / 2), chrome);
    front.position.z = 0.075;
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 16).rotateX(Math.PI / 2), dark);
    back.position.z = -0.07;
    spin.add(front, back);
    spin.position.set(side * 0.03, 0, 0.08);
    gunG.add(spin);
    barrels.push(spin);
    const fl = new THREE.Sprite(flashMat);
    fl.position.set(side * 0.03, 0, 0.2);
    fl.visible = false;
    gunG.add(fl);
    flashes.push(fl);
    gunG.position.set(-side * 0.02, 0.0, 0);
    half.add(gunG);
    // trilho de abertura (aparece com a metade aberta)
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8).rotateZ(Math.PI / 2), chrome);
    rail.position.set(-side * 0.05, 0.12, -0.05);
    half.add(rail);
    half.position.set(side * 0.006, BODY_Y, 0);
    head.add(half);
    halves.push(half);
    guns.push(gunG);
  }
  const flashLight = new THREE.PointLight(0xffb060, 0, 4, 2);
  flashLight.position.set(0, BODY_Y, 0.35);
  g.add(flashLight);
  // olho: soquete, lente com íris e o brilho
  const EYE_Y = 0.95;
  const eyeZ = S[2] * Math.sqrt(1 - ((EYE_Y - BODY_Y) / S[1]) ** 2) - 0.005;
  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.013, 12, 28), black);
  socket.position.set(0, EYE_Y, eyeZ);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.038, 20, 14), lensMat);
  lens.position.copy(socket.position).add(new THREE.Vector3(0, 0, -0.012));
  const iris = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.026, 24), new THREE.MeshBasicMaterial({ color: 0x220000, transparent: true, opacity: 0.6 }));
  iris.position.copy(socket.position).add(new THREE.Vector3(0, 0, 0.026));
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.041, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, roughness: 0, envMap: ENV, envMapIntensity: 2, depthWrite: false }),
  );
  glass.position.copy(socket.position).add(new THREE.Vector3(0, 0, -0.012));
  head.add(socket, lens, iris, glass);
  const eyeGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  eyeGlow.scale.setScalar(0.3);
  eyeGlow.position.copy(lens.position).add(new THREE.Vector3(0, 0, 0.03));
  head.add(eyeGlow);
  // antena (com a ponta piscando) e aletas de refrigeração nas costas
  const ant = limb(new THREE.Vector3(0.05, BODY_Y + S[1] - 0.04, -0.06), new THREE.Vector3(0.07, BODY_Y + S[1] + 0.14, -0.08), 0.006, 0.004, black);
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), antMat);
  antTip.position.set(0.07, BODY_Y + S[1] + 0.145, -0.08);
  head.add(ant, antTip);
  for (const dx of [-0.05, 0, 0.05]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.16, 0.05), dark);
    fin.position.set(dx, BODY_Y - 0.12, -S[2] - 0.005);
    head.add(fin);
  }
  // faísca de quando ela é derrubada
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: 0x9fd8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  spark.visible = false;
  spark.scale.setScalar(0.15);
  spark.position.set(0.06, BODY_Y + 0.22, 0.12);
  head.add(spark);
  // cubo do quadril (onde as pernas se prendem)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.1, 16), dark);
  hub.position.y = 0.42;
  g.add(hub);
  // "T-rex robô": cabeça de dinossauro no topo, dentes, crista nas costas e rabinho
  const TOP = BODY_Y + S[1];
  const snout = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), white);
  snout.scale.set(0.13, 0.09, 0.2);
  snout.position.set(0, TOP + 0.02, 0.12);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), dark);
  jaw.scale.set(0.09, 0.035, 0.14);
  jaw.position.set(0, TOP - 0.07, 0.16);
  head.add(snout, jaw);
  const toothMat = plastic(0xf4efe0);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.035, 4).rotateX(Math.PI), toothMat);
      tooth.position.set(s * 0.08, TOP - 0.06, 0.12 + i * 0.045);
      head.add(tooth);
    }
    const dinoEye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), lensMat);
    dinoEye.position.set(s * 0.08, TOP + 0.07, 0.2);
    head.add(dinoEye);
  }
  for (let i = 0; i < 4; i++) {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), black);
    const a = 0.5 + i * 0.32;
    crest.position.set(0, BODY_Y + Math.cos(a) * S[1] * 0.98, -Math.sin(a) * S[2] * 0.98);
    crest.rotation.x = -a;
    head.add(crest);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 10).rotateX(-Math.PI / 2 - 0.35), white);
  tail.position.set(0, 0.62, -0.38);
  head.add(tail);
  // a cabeça gira em volta do quadril: as peças foram montadas em coordenadas da torreta
  const PIVOT = 0.45;
  for (const c of head.children) c.position.y -= PIVOT;
  head.position.y = PIVOT;
  g.add(head);
  // três pernas (duas na frente abertas, uma atrás) com pistão hidráulico
  const legs = [
    [new THREE.Vector3(-0.1, 0.45, 0.05), new THREE.Vector3(-0.3, 0.32, 0.2), new THREE.Vector3(-0.36, 0.0, 0.3)],
    [new THREE.Vector3(0.1, 0.45, 0.05), new THREE.Vector3(0.3, 0.32, 0.2), new THREE.Vector3(0.36, 0.0, 0.3)],
    [new THREE.Vector3(0, 0.45, -0.1), new THREE.Vector3(0, 0.32, -0.36), new THREE.Vector3(0, 0.0, -0.44)],
  ];
  for (const [hip, knee, foot] of legs) {
    g.add(limb(hip, knee, 0.022, 0.018, black), limb(knee, foot, 0.018, 0.012, black));
    // pistão: do quadril (um pouco acima) até o meio da canela
    const a = hip.clone().add(new THREE.Vector3(0, 0.05, 0));
    const b = knee.clone().lerp(foot, 0.35);
    const mid = a.clone().lerp(b, 0.55);
    g.add(limb(a, mid, 0.012, 0.012, dark), limb(mid, b, 0.007, 0.007, chrome));
    const kj = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), dark);
    kj.position.copy(knee);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.025, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 }));
    pad.position.copy(foot).setY(0.012);
    g.add(kj, pad);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.userData = { lensMat, eyeGlow, halves, guns, barrels, flashes, flashLight, body: inner, head, iris, antMat, ledMat, spark };
  return g;
}
