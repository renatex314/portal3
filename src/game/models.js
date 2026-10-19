// Modelos detalhados do jogo de portais: arma, amostra (cubo), botão de piso e
// torreta. Tudo feito com geometria do three.js (nada de arquivos de fora).
// Os materiais "plásticos" e metálicos usam um mapa de ambiente gerado na hora
// (sala neutra) para ganhar reflexo, como o acabamento dos laboratórios do gênero.
// As texturas (emendas, parafusos, grelhas, etiquetas) são desenhadas em canvas
// e viram também mapas de relevo.

import * as THREE from 'three';
import { tl } from './i18n.js';
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
      g.fillText(tl('ANTÍPODA'), -46, -1);
      g.font = '11px Arial';
      g.fillText(tl('DISP. DE PORTAIS'), -46, 14);
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
/** desenho anterior da arma (mantido como referência; o jogo usa a Mark III abaixo) */
export function portalGunClassic() {
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
    // grava profundidade onde é visível: a lente do campo de dilatação (fx.js) reconhece pela profundidade o que é da arma e não o distorce
    new THREE.MeshBasicMaterial({ map: holoTex, transparent: true, depthWrite: true, alphaTest: 0.04, side: THREE.DoubleSide, toneMapped: false }),
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

const SLOW_COL = new THREE.Color();

// ruído usado nos shaders de energia da arma
const GUN_NOISE = /* glsl */ `
  float gh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
  float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
  float gfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * gn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }`;

/** textura de metal pintado de azul-marinho, bem gasto (manchas, arranhões, bordas lascadas) */
function wornPaint() {
  const W = 512;
  const c = canvas(W, W);
  const x = c.getContext('2d');
  x.fillStyle = '#25324a';
  x.fillRect(0, 0, W, W);
  // manchas grandes (tinta desbotada)
  for (let i = 0; i < 60; i++) {
    const r = 20 + Math.random() * 70;
    const gx = x.createRadialGradient(0, 0, 0, 0, 0, r);
    const light = Math.random() < 0.5;
    gx.addColorStop(0, light ? 'rgba(70,86,112,0.22)' : 'rgba(14,20,30,0.28)');
    gx.addColorStop(1, 'rgba(0,0,0,0)');
    x.save();
    x.translate(Math.random() * W, Math.random() * W);
    x.fillStyle = gx;
    x.fillRect(-r, -r, r * 2, r * 2);
    x.restore();
  }
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = Math.random() < 0.5 ? `rgba(10,14,22,${Math.random() * 0.3})` : `rgba(90,104,128,${Math.random() * 0.2})`;
    x.fillRect(Math.random() * W, Math.random() * W, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // arranhões e lascas (metal claro aparecendo)
  x.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    x.strokeStyle = `rgba(165,175,190,${0.12 + Math.random() * 0.4})`;
    x.lineWidth = Math.random() < 0.85 ? 0.8 : 2.2;
    const sx = Math.random() * W;
    const sy = Math.random() * W;
    const a = Math.random() * Math.PI;
    const l = 3 + Math.random() * 26;
    x.beginPath();
    x.moveTo(sx, sy);
    x.quadraticCurveTo(sx + Math.cos(a) * l * 0.5 + (Math.random() - 0.5) * 4, sy + Math.sin(a) * l * 0.5, sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** adesivo: faixa quadriculada preta e branca */
function checkerDecal(cols = 16, rows = 3) {
  const c = canvas(cols * 8, rows * 8);
  const x = c.getContext('2d');
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      x.fillStyle = (i + j) % 2 ? '#111' : '#eee';
      x.fillRect(i * 8, j * 8, 8, 8);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** etiqueta vermelha de aviso */
function warningDecal(lines) {
  const c = canvas(256, 96);
  const x = c.getContext('2d');
  x.fillStyle = '#b3141c';
  x.fillRect(0, 0, 256, 96);
  x.strokeStyle = '#f2f2f2';
  x.lineWidth = 4;
  x.strokeRect(6, 6, 244, 84);
  x.fillStyle = '#f5f5f5';
  x.textAlign = 'center';
  x.font = 'bold 34px Arial, sans-serif';
  x.fillText(tl(lines[0]), 128, 44);
  x.font = 'bold 20px Arial, sans-serif';
  x.fillText(tl(lines[1] ?? ''), 128, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** plaqueta da traseira: quadriculado, um selo redondo e o nome do aparelho */
function nameplateDecal() {
  const c = canvas(256, 192);
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 192);
  for (let i = 0; i < 6; i++) {
    x.fillStyle = i % 2 ? '#111' : '#eee';
    x.fillRect(70 + i * 20, 8, 20, 20);
  }
  x.strokeStyle = '#e8e8e8';
  x.lineWidth = 4;
  x.beginPath();
  x.arc(48, 62, 16, 0, Math.PI * 2);
  x.stroke();
  x.beginPath();
  x.arc(48, 62, 7, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = '#e8e8e8';
  x.font = 'bold 20px Arial, sans-serif';
  x.fillText('APERTURE', 72, 70);
  x.font = 'bold 17px Arial, sans-serif';
  x.fillText('HANDHELD QUANTUM', 30, 110);
  x.fillText('TUNNELING DEVICE MKIII', 14, 134);
  // losangos brancos embaixo
  for (const [cx, cy] of [
    [128, 160],
    [128, 182],
  ]) {
    x.beginPath();
    x.moveTo(cx, cy - 9);
    x.lineTo(cx + 9, cy);
    x.lineTo(cx, cy + 9);
    x.lineTo(cx - 9, cy);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Arma de portais "Mark III" (desenho próprio no estilo do protótipo do link):
 * bloco traseiro alto e arredondado com sela preta embaixo, duas molduras
 * pretas, cilindro do meio com janela de vidro e filete aceso, alça reta em
 * cima, empunhadura lateral, mangueira corrugada pelo lado esquerdo, bloco da
 * frente com grade, boca redonda e quatro bobinas de cobre em volta dela.
 * Mesma interface (userData) dos desenhos anteriores, mais `animate`. Eixo: −z.
 */
export function portalGun() {
  const g = new THREE.Group();
  const paintTex = wornPaint();
  const paint = new THREE.MeshPhysicalMaterial({ map: paintTex, roughness: 0.66, metalness: 0.4, envMap: ENV, envMapIntensity: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.7 });
  const dark = metal(0x1b1d21, { roughness: 0.55, metalness: 0.55 });
  const black = metal(0x0d0e10, { roughness: 0.62, metalness: 0.3 });
  const steel = metal(0x8a9099, { roughness: 0.32, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.85 });
  const coreMat = glow(new THREE.Color(0.5, 1.6, 3.2));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xb9d4ee, roughness: 0.08, transparent: true, opacity: 0.32, envMap: ENV, envMapIntensity: 1.6, depthWrite: false, clearcoat: 1, side: THREE.DoubleSide });
  const flat = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const conduit = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.5, 1.6, 3.2) }, uTime: { value: 0 }, uPulse: { value: -1 } },
    vertexShader: flat,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime, uPulse; varying vec2 vUv;
      void main(){
        float flow = 0.5 + 0.3 * sin(vUv.x * 46.0 - uTime * 7.0);
        float pulse = uPulse < 0.0 ? 0.0 : exp(-pow((vUv.x - uPulse) * 9.0, 2.0)) * 3.5;
        gl_FragColor = vec4(uColor * (flow + pulse), 1.0);
      }`,
    toneMapped: false,
  });
  const plasmaU = { uColor: { value: new THREE.Color(0.5, 1.6, 3.2) }, uTime: { value: 0 }, uBoost: { value: 0 } };
  const plasmaFS = `
    uniform vec3 uColor; uniform float uTime, uBoost; varying vec2 vUv;
    ${GUN_NOISE}
    void main(){
      vec2 p = vec2(vUv.x * 7.0, vUv.y * 4.0 - uTime * 3.2);
      float f = gfbm(p + gfbm(p * 1.7 + uTime * 0.9));
      float bands = 0.65 + 0.35 * sin(vUv.y * 34.0 - uTime * 14.0);
      gl_FragColor = vec4(uColor * (0.3 + 1.6 * f * f + uBoost) * bands, 1.0);
    }`;
  const plasma = new THREE.ShaderMaterial({ uniforms: plasmaU, vertexShader: flat, fragmentShader: plasmaFS, toneMapped: false, side: THREE.DoubleSide });
  // cobre das bobinas: esquenta na cor do portal (emissivo) no tiro e segurando algo
  const copper = new THREE.MeshStandardMaterial({ color: 0x7a4024, roughness: 0.36, metalness: 0.9, envMap: ENV, envMapIntensity: 0.85, emissive: new THREE.Color(0, 0, 0) });
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const rbox = (w, h, d, r, mat, x, y, z) => add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat), x, y, z);
  const decal = (tex, w, h, x, y, z, ry, transparent = false) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, transparent, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.y = ry;
    return add(m, x, y, z);
  };
  const cyl = (r0, r1, len, mat, seg = 28) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2), mat);

  // ------------------------------------------------ bloco traseiro (alto, cantos bem redondos)
  rbox(0.165, 0.2, 0.2, 0.06, paint, 0, 0.012, 0.245);
  // sela preta embaixo (apoio), em arco de lado a lado
  const saddle = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.02, 10, 28, Math.PI), black);
  saddle.rotation.z = Math.PI; // abre para baixo
  saddle.scale.set(1, 1, 3.4);
  add(saddle, 0, -0.085, 0.27);
  // painel da face de trás com quatro botões quadrados
  rbox(0.07, 0.07, 0.012, 0.006, dark, 0, 0.03, 0.348);
  for (const [bx, by] of [
    [-0.017, 0.047],
    [0.017, 0.047],
    [-0.017, 0.013],
    [0.017, 0.013],
  ]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.022, 0.012, 2, 0.004), black);
    add(b, bx, by, 0.356);
  }
  // botão serrilhado em cima
  const knob = cyl(0.02, 0.022, 0.02, dark, 20);
  knob.rotation.x = 0;
  add(knob, 0.035, 0.122, 0.3);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const kn = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 0.006), black);
    kn.position.set(0.035 + Math.cos(a) * 0.021, 0.122, 0.3 + Math.sin(a) * 0.021);
    kn.rotation.y = -a;
    g.add(kn);
  }
  // etiquetas
  decal(warningDecal(['MK III', 'Q-TUNNEL']), 0.045, 0.017, 0.083, 0.085, 0.31, Math.PI / 2);
  decal(nameplateDecal(), 0.085, 0.064, 0.083, -0.005, 0.24, Math.PI / 2, true);
  decal(nameplateDecal(), 0.085, 0.064, -0.083, -0.005, 0.24, -Math.PI / 2, true);
  // aletas de calor nos dois lados da traseira (abrem depois dos tiros)
  const heatMat = glow(new THREE.Color(0, 0, 0));
  const vents = [];
  for (const sx of [-1, 1]) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.034, 0.06), heatMat);
    add(back, sx * 0.081, -0.065, 0.24);
    for (let k = 0; k < 3; k++) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.084, -0.08 + k * 0.011, 0.24);
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.01, 0.06), dark);
      slat.position.set(sx * 0.002, 0.005, 0);
      pivot.add(slat);
      pivot.userData.side = sx;
      g.add(pivot);
      vents.push(pivot);
    }
  }
  // ------------------------------------------------ duas molduras pretas grossas
  for (const z of [0.128, 0.09]) rbox(0.172, 0.17, 0.024, 0.02, black, 0, 0.0, z);

  // ------------------------------------------------ cilindro do meio com janela de vidro em cima
  const R = 0.066;
  const openA = 1.7; // abertura da janela (radianos)
  const winTilt = 0.75; // centro da janela: em cima, puxado para a esquerda (o lado que o jogador vê)
  const midLen = 0.24;
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(R, R, midLen, 36, 1, true, Math.PI / 2 + openA / 2 - Math.PI / 2, Math.PI * 2 - openA).rotateX(Math.PI / 2), paint);
  // CylinderGeometry gira em volta de y; depois de rotateX, o "theta" mede a partir de +z → ajusta para a janela ficar em cima
  mid.rotation.z = 0;
  add(mid, 0, 0, -0.04);
  mid.geometry.rotateZ(Math.PI / 2 + openA / 2 + winTilt);
  const midCaps = [0.08, -0.16].map((z) => add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.009, 8, 36), dark), 0, 0, z));
  const winGlass = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.002, R - 0.002, midLen, 24, 1, true, 0, openA).rotateX(Math.PI / 2), glass);
  winGlass.geometry.rotateZ(Math.PI / 2 - openA / 2 + winTilt);
  winGlass.renderOrder = 4;
  add(winGlass, 0, 0, -0.04);
  // por dentro: fundo escuro, o núcleo de plasma e uma bobina girando
  // fundo por dentro: brilha fraco na cor do último disparo (o vidro mostra a cor)
  const innerGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.25, 0.5), side: THREE.BackSide, toneMapped: false });
  add(new THREE.Mesh(new THREE.CylinderGeometry(R - 0.006, R - 0.006, midLen, 24, 1, true).rotateX(Math.PI / 2), innerGlow), 0, 0, -0.04);
  const core = add(cyl(0.028, 0.028, midLen - 0.01, plasma, 20), 0, 0.012, -0.04);
  const coilPts = [];
  for (let i = 0; i <= 140; i++) {
    const a = (i / 140) * Math.PI * 2 * 11;
    coilPts.push(new THREE.Vector3(Math.cos(a) * 0.034, Math.sin(a) * 0.034, 0.07 - (i / 140) * 0.22));
  }
  const coilPivot = new THREE.Group();
  coilPivot.position.set(0, 0.012, -0.04);
  coilPivot.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts.map((p) => p.clone().setZ(p.z + 0.04))), 280, 0.0024, 5), copper));
  g.add(coilPivot);
  // filete aceso ao longo do topo (no meio da janela)
  const strip = add(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, midLen - 0.02), conduit), -Math.sin(winTilt) * (R - 0.004), Math.cos(winTilt) * (R - 0.004), -0.04);
  strip.rotation.z = winTilt;
  // halo sobre a janela (aparece no tempo lento e pulsa)
  const winHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  winHalo.scale.set(0.34, 0.16, 1);
  add(winHalo, -Math.sin(winTilt) * 0.07, Math.cos(winTilt) * 0.07, -0.04);
  // anel de relógio holográfico em volta do cilindro (só no tempo lento): marcações e ponteiros
  const clockCanvas = canvas(256, 256);
  {
    const c = clockCanvas.getContext('2d');
    c.translate(128, 128);
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(0, 0, 120, 0, Math.PI * 2);
    c.stroke();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const r0 = k % 5 === 0 ? 96 : 108;
      c.lineWidth = k % 5 === 0 ? 4 : 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      c.lineTo(Math.cos(a) * 116, Math.sin(a) * 116);
      c.stroke();
    }
    c.lineWidth = 6;
    c.beginPath();
    c.arc(0, 0, 84, -0.4, 0.9);
    c.stroke();
    c.beginPath();
    c.arc(0, 0, 84, Math.PI - 0.4, Math.PI + 0.9);
    c.stroke();
  }
  const clockMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(clockCanvas), color: new THREE.Color(0.8, 0.6, 2.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const clocks = [-0.13, 0.05].map((z, i) => {
    const m = add(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), clockMat), 0, 0, z);
    m.renderOrder = 6;
    m.rotation.y = i ? 0.5 : -0.5; // inclinados: aparecem de lado também
    m.userData.dir = i ? -1 : 1;
    return m;
  });
  // trilho de baixo do cilindro
  rbox(0.07, 0.03, midLen, 0.01, dark, 0, -0.07, -0.04);
  // empunhadura lateral (direita), cilíndrica, saindo na horizontal
  const grip = cyl(0.022, 0.024, 0.11, black, 20);
  grip.rotation.set(0, Math.PI / 2, 0);
  add(grip, 0.115, -0.03, 0.0);
  const gripEnd = new THREE.Mesh(new THREE.SphereGeometry(0.023, 16, 12), black);
  add(gripEnd, 0.17, -0.03, 0.0);
  rbox(0.03, 0.05, 0.05, 0.01, dark, 0.064, -0.03, 0.0);
  // ------------------------------------------------ alça reta em cima
  const handle = rbox(0.03, 0.014, 0.25, 0.006, black, 0, 0.13, -0.01);
  for (const z of [0.11, -0.13]) rbox(0.026, 0.06, 0.018, 0.005, black, 0, 0.1, z);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.002, 0.22), conduit), 0, 0.1375, -0.01);
  // ------------------------------------------------ mangueira corrugada (lado esquerdo)
  const hoseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.03, 0.11, 0.2),
    new THREE.Vector3(-0.04, 0.2, 0.15),
    new THREE.Vector3(-0.1, 0.19, 0.06),
    new THREE.Vector3(-0.135, 0.07, 0.0),
    new THREE.Vector3(-0.125, -0.05, -0.05),
    new THREE.Vector3(-0.09, -0.085, -0.1),
    new THREE.Vector3(-0.05, -0.07, -0.13),
  ]);
  add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 90, 0.018, 12, false), rubber), 0, 0, 0);
  for (let i = 0; i <= 80; i++) {
    const tt = i / 80;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0195, 0.0038, 5, 14), rubber);
    ring.position.copy(hoseCurve.getPoint(tt));
    ring.lookAt(ring.position.clone().add(hoseCurve.getTangent(tt)));
    g.add(ring);
  }
  for (const tt of [0, 1]) {
    const collar = cyl(0.025, 0.025, 0.02, dark, 16);
    collar.position.copy(hoseCurve.getPoint(tt));
    collar.lookAt(collar.position.clone().add(hoseCurve.getTangent(tt)));
    collar.rotateX(Math.PI / 2);
    g.add(collar);
  }
  // ------------------------------------------------ bloco da frente
  rbox(0.172, 0.19, 0.12, 0.03, paint, 0, 0.0, -0.215);
  rbox(0.16, 0.175, 0.03, 0.02, black, 0, 0.0, -0.285);
  // grade de barras na lateral direita
  rbox(0.012, 0.11, 0.09, 0.004, black, 0.092, 0.0, -0.215);
  for (let k = 0; k < 6; k++) add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.1, 0.004), dark), 0.1, 0.0, -0.25 + k * 0.014);
  for (const yy of [0.052, -0.052]) add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.09), black), 0.1, yy, -0.215);
  // gaiola de barras finas e fios em cima
  for (const xx of [-0.03, 0.0, 0.03]) add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.004), black), xx, 0.11, -0.24);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, 0.004), black), 0, 0.125, -0.24);
  for (const [dx, h] of [
    [-0.025, 0.035],
    [0.0, 0.05],
    [0.022, 0.03],
  ]) {
    const w = new THREE.CatmullRomCurve3([
      new THREE.Vector3(dx, 0.096, -0.15),
      new THREE.Vector3(dx + 0.01, 0.096 + h, -0.19),
      new THREE.Vector3(dx - 0.006, 0.096 + h * 0.7, -0.24),
      new THREE.Vector3(dx, 0.096, -0.27),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(w, 20, 0.0022, 5, false), black));
  }
  // etiquetas da frente
  decal(warningDecal(['⚠ WARNING ⚠', 'DO NOT TOUCH COILS']), 0.06, 0.022, 0.087, -0.072, -0.16, Math.PI / 2);
  decal(checkerDecal(), 0.07, 0.013, 0.087, -0.05, -0.16, Math.PI / 2);
  decal(checkerDecal(4, 4), 0.03, 0.03, -0.087, -0.04, -0.17, -Math.PI / 2);
  decal(checkerDecal(), 0.07, 0.013, -0.087, -0.075, -0.2, -Math.PI / 2);
  // boca redonda preta no centro, com o plasma lá no fundo
  const muzzle = cyl(0.062, 0.062, 0.05, black, 40);
  add(muzzle, 0, 0, -0.31);
  add(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 12, 40), dark), 0, 0, -0.335);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.06, 32, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, side: THREE.BackSide }));
  add(bore, 0, 0, -0.31);
  const boreGlow = new THREE.Mesh(new THREE.CircleGeometry(0.044, 32), plasma);
  boreGlow.rotation.y = Math.PI;
  add(boreGlow, 0, 0, -0.29);
  // LEDs de carga na lateral esquerda do bloco da frente
  const leds = [];
  const halos = []; // brilhos suaves em volta das luzes (o bloom sozinho não basta tão perto da câmera)
  const halo = (x, y, z, sx, sy, k) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sp.scale.set(sx, sy, 1);
    sp.userData.k = k;
    halos.push(add(sp, x, y, z));
  };
  for (let k = 0; k < 3; k++) {
    const m = glow(new THREE.Color(0.4, 1.4, 2.4));
    add(new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), m), -0.088, 0.06, -0.19 - k * 0.02);
    leds.push(m);
    halo(-0.092, 0.06, -0.19 - k * 0.02, 0.035, 0.035, 0.5);
  }
  halo(-Math.sin(winTilt) * 0.068, Math.cos(winTilt) * 0.068, -0.04, 0.09, 0.26, 0.22); // filete do vidro
  halo(0, 0.142, -0.01, 0.05, 0.24, 0.16); // filete da alça
  halo(0, 0, -0.33, 0.13, 0.13, 0.3); // boca

  // ------------------------------------------------ quatro bobinas de cobre em volta da boca
  // em cima e embaixo: finas e compridas; dos lados: grossas e chatas. Cada uma num
  // suporte preto, com enrolamento (textura listrada) e pontas arredondadas
  const coilRods = [];
  const rodTips = [];
  for (const [x, y, w, h, len] of [
    [0.0, 0.098, 0.03, 0.018, 0.2],
    [0.0, -0.098, 0.03, 0.018, 0.2],
    [-0.1, 0.0, 0.026, 0.07, 0.16],
    [0.1, 0.0, 0.026, 0.07, 0.16],
  ]) {
    const rod = new THREE.Group();
    rod.position.set(x, y, -0.29);
    const mount = new THREE.Mesh(new RoundedBoxGeometry(w + 0.014, h + 0.014, 0.04, 2, 0.005), black);
    mount.position.z = 0.01;
    rod.add(mount);
    // núcleo escuro (aparece nos vãos) e as espiras: anéis empilhados ao longo do
    // comprimento, fundidos numa malha só; pontas arredondadas de cobre
    const coreBox = new THREE.Mesh(new RoundedBoxGeometry(w * 0.82, h * 0.82, len, 2, Math.min(w, h) * 0.3), black);
    coreBox.position.z = -len / 2 - 0.01;
    rod.add(coreBox);
    const turns = [];
    const pitch = 0.0062;
    const n = Math.floor((len - 0.012) / pitch);
    for (let k = 0; k < n; k++) {
      const t = new RoundedBoxGeometry(w, h, pitch * 0.72, 2, Math.min(w, h) * 0.42);
      t.translate(0, 0, -0.016 - k * pitch);
      turns.push(t);
    }
    const body = new THREE.Mesh(mergeGeometries(turns), copper);
    rod.add(body);
    for (const zEnd of [-0.012, -len - 0.004]) {
      const capGeo = new RoundedBoxGeometry(w * 1.04, h * 1.04, 0.008, 2, Math.min(w, h) * 0.45);
      const cap = new THREE.Mesh(capGeo, copper);
      cap.position.z = zEnd;
      rod.add(cap);
    }
    const tp = new THREE.Object3D();
    tp.position.z = -len - 0.012;
    rod.add(tp);
    rod.userData = { base: rod.position.clone() };
    g.add(rod);
    coilRods.push(rod);
    rodTips.push(tp);
  }
  // arcos elétricos entre as pontas vizinhas (redesenhados a cada quadro)
  const ARC_N = 12;
  const PAIRS = [
    [0, 3],
    [3, 1],
    [1, 2],
    [2, 0],
  ];
  const arcMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 2.6, 4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PAIRS.length * (ARC_N - 1) * 2 * 3), 3));
  const arcs = new THREE.LineSegments(arcGeo, arcMat);
  arcs.frustumCulled = false;
  arcs.renderOrder = 7;
  g.add(arcs);
  // partículas de energia na frente da boca
  const MOTES = 30;
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  mg.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: MOTES }, () => Math.random()), 1));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.5, 1.6, 3.2) }, uTime: { value: 0 }, uSpread: { value: 0 } },
    vertexShader: `
      attribute float seed; uniform float uTime, uSpread; varying float vA;
      void main(){
        float sp = 1.5 + 2.5 * fract(seed * 7.7);
        float a = seed * 6.2831853 * 13.0 + uTime * sp;
        float r = 0.05 + 0.05 * fract(seed * 3.1) + uSpread * 0.03;
        float z = -0.36 - 0.12 * fract(seed * 5.3 + uTime * 0.3 * sp);
        vec4 mv = modelViewMatrix * vec4(cos(a) * r, sin(a) * r, z, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.6 + 1.6 * fract(seed * 9.1)) / max(-mv.z, 0.05);
        vA = (0.5 + 0.5 * sin(uTime * 9.0 + seed * 40.0)) * (0.3 + uSpread * 0.7);
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(uColor * 2.2, vA * (1.0 - d)); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const motes = new THREE.Points(mg, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 7;
  g.add(motes);
  // (a onda de choque do tiro é uma distorção da imagem: ver ShockShader em fx.js)
  // painel holográfico flutuando ao lado esquerdo (o que o jogador vê)
  const holoCanvas = canvas(256, 128);
  const holoTex = new THREE.CanvasTexture(holoCanvas);
  holoTex.colorSpace = THREE.SRGBColorSpace;
  const holo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.21, 0.105),
    // grava profundidade onde é visível: a lente do campo de dilatação (fx.js) reconhece pela profundidade o que é da arma e não o distorce
    new THREE.MeshBasicMaterial({ map: holoTex, transparent: true, depthWrite: true, alphaTest: 0.04, side: THREE.DoubleSide, toneMapped: false }),
  );
  holo.position.set(-0.27, 0.08, 0.17);
  holo.rotation.set(-0.42, -0.42, 0, 'YXZ');
  holo.renderOrder = 5;
  g.add(holo, limb(new THREE.Vector3(-0.15, 0.06, 0.16), new THREE.Vector3(-0.16, 0.065, 0.165), 0.003, 0.003, dark));
  // brilho de plasma na boca
  const tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x88ccff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  tipGlow.scale.setScalar(0.06);
  add(tipGlow, 0, 0, -0.35);
  const tip = add(new THREE.Object3D(), 0, 0, -0.4);

  // efeitos (chamado pelo main a cada quadro, com recuo/segurar/calor e a cor)
  const v = new THREE.Vector3();
  const tipsLocal = rodTips.map(() => new THREE.Vector3());
  let arcClock = 0;
  const animate = (dt, t, s) => {
    const color = s.base;
    plasmaU.uTime.value = t;
    plasmaU.uColor.value.copy(color).multiplyScalar(0.45);
    plasmaU.uBoost.value = s.recoil * 1.6 + s.open * 0.4;
    moteMat.uniforms.uTime.value = t;
    moteMat.uniforms.uColor.value.copy(color).multiplyScalar(0.5);
    moteMat.uniforms.uSpread.value = Math.min(1.5, s.open + s.recoil * 2);
    // tempo lento: tudo migra para um violeta-azulado que pulsa como um coração lento
    const slow = s.slow ?? 0;
    const beat = Math.pow(0.5 + 0.5 * Math.sin(t * 3.2), 3);
    SLOW_COL.setRGB(0.8, 0.55, 2.6).multiplyScalar(1 + beat * 0.8);
    plasmaU.uColor.value.lerp(SLOW_COL.clone().multiplyScalar(0.45), slow);
    // o vidro mostra a cor do último disparo (e respira devagar)
    innerGlow.color.copy(color).multiplyScalar(0.24 + 0.05 * Math.sin(t * 2) + s.recoil * 0.3).lerp(SLOW_COL.clone().multiplyScalar(0.3), slow);
    s.conduitColor?.lerp(SLOW_COL.clone().multiplyScalar(0.55), slow);
    coreMat.color.lerp(SLOW_COL, slow);
    for (const m of s.leds ?? []) m.color.lerp(SLOW_COL, slow);
    winHalo.material.color.copy(SLOW_COL).multiplyScalar(0.35 * slow * (0.6 + 0.4 * beat));
    clockMat.opacity = slow * (0.45 + 0.25 * beat);
    clocks.forEach((m) => (m.rotation.z += dt * 0.35 * m.userData.dir));
    // luzes com mais brilho: costuras e LEDs acima do limiar do bloom, halos na mesma cor
    s.conduitColor?.multiplyScalar(2.3);
    for (const m of s.leds ?? []) m.color.multiplyScalar(2.6);
    const glowCol = SLOW_COL.clone().lerp(color, 1 - slow);
    for (const h of halos) h.material.color.copy(glowCol).multiplyScalar(h.userData.k * (1 + s.recoil * 1.5 + s.open * 0.5) * (0.85 + 0.15 * Math.sin(t * 5)));
    const hot = Math.min(1.6, s.recoil * 1.8 + s.open * 0.6 + s.heat * 0.5 + 0.05 + 0.04 * Math.sin(t * 4));
    copper.emissive.copy(color).multiplyScalar(0.045 * hot).lerp(SLOW_COL.clone().multiplyScalar(0.04 + 0.05 * beat), slow);
    coilRods.forEach((rod, i) => {
      const b = rod.userData.base;
      const j = s.open * 0.0015 * Math.sin(t * 61 + i * 2);
      rod.position.set(b.x + j, b.y + j * 0.7, b.z + s.recoil * 0.012 * (1 + (i % 2) * 0.4));
    });
    const power = Math.min(1, s.recoil * 1.4 + s.open * 0.85);
    const idle = Math.random() < 0.05 ? 0.4 : 0;
    arcMat.opacity = Math.max(power, idle) * (0.6 + 0.4 * Math.random());
    arcMat.color.copy(color).multiplyScalar(1.4).addScalar(0.5);
    arcClock -= dt;
    if (arcMat.opacity > 0.01 && arcClock <= 0) {
      arcClock = 1 / 40;
      g.updateMatrixWorld(true);
      rodTips.forEach((tp, i) => g.worldToLocal(tp.getWorldPosition(tipsLocal[i])));
      const pos = arcGeo.attributes.position.array;
      let o = 0;
      for (const [ia, ib] of PAIRS) {
        const A = tipsLocal[ia];
        const B = tipsLocal[ib];
        let prev = null;
        for (let k = 0; k < ARC_N; k++) {
          const f = k / (ARC_N - 1);
          v.lerpVectors(A, B, f);
          const amp = Math.sin(f * Math.PI) * 0.02 * (0.6 + power);
          v.x += (Math.random() - 0.5) * amp;
          v.y += (Math.random() - 0.5) * amp;
          v.z += (Math.random() - 0.5) * amp * 0.6 - Math.sin(f * Math.PI) * 0.012;
          if (prev) {
            pos.set([prev.x, prev.y, prev.z, v.x, v.y, v.z], o);
            o += 6;
          }
          prev = (prev ?? new THREE.Vector3()).copy(v);
        }
      }
      arcGeo.attributes.position.needsUpdate = true;
    }
  };

  const claws = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()];
  g.userData = { core: coreMat, tip, claws, coil: coilPivot, leds, rings: [], conduit, vents, heatMat, iris: [], tipGlow, animate, holo: { canvas: holoCanvas, tex: holoTex, t: 0 } };
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
  c.fillText(tl(s.mode === 'none' ? 'SEM ARMA' : 'PORTAIS'), 12, 24);
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
    c.fillText(tl(label), x + 19, 55);
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
  c.fillText(tl(s.holding ? 'CAMPO DE FORÇA' : 'TEMPO'), W - 112, 100);
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
      g.fillText(tl(heart ? 'AMOSTRA ESPECIAL' : 'AMOSTRA'), c, S - 118);
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
      g.fillText(tl('SEGURANÇA'), W / 2, H * 0.22);
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
