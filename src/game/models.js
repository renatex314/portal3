// Modelos detalhados do jogo de portais: arma, amostra (cubo), botão de piso e
// torreta. Tudo feito com geometria do three.js (nada de arquivos de fora).
// Os materiais "plásticos" e metálicos usam um mapa de ambiente gerado na hora
// (sala neutra) para ganhar reflexo, como o acabamento dos laboratórios do gênero.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let ENV = null;
/** gera (uma vez) o mapa de reflexo usado pelos modelos */
export function initEnvironment(renderer) {
  if (ENV) return ENV;
  const pm = new THREE.PMREMGenerator(renderer);
  ENV = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return ENV;
}

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

function canvasTexture(size, draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ arma de portais
/**
 * Arma de portais em primeira pessoa: casco branco brilhante, corpo escuro,
 * câmara de vidro com o núcleo aceso (cor do último portal), anel emissor e
 * três garras curvas na frente. Devolve o grupo com userData { core, tip, light }.
 */
export function portalGun() {
  const g = new THREE.Group();
  const white = plastic(0xf4f4f0);
  const dark = metal(0x2b2d31, { roughness: 0.5, metalness: 0.55 });
  const black = metal(0x111214, { roughness: 0.6, metalness: 0.3 });
  const coreMat = glow(new THREE.Color(0.5, 1.6, 3.2));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.28, envMap: ENV, envMapIntensity: 1.2, depthWrite: false });

  // casco traseiro (ovo alongado) — o eixo da arma é −z
  const shell = new THREE.Mesh(
    latheZ([
      [0.0, -0.3],
      [0.045, -0.296],
      [0.078, -0.278],
      [0.1, -0.24],
      [0.112, -0.17],
      [0.114, -0.09],
      [0.108, -0.02],
      [0.096, 0.04],
      [0.088, 0.07],
    ]),
    white,
  );
  shell.scale.set(1, 0.92, 1);
  g.add(shell);
  // frisos escuros no casco
  for (const z of [0.12, 0.02]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(z > 0.1 ? 0.112 : 0.11, 0.006, 8, 48), black);
    ring.position.z = z;
    ring.scale.set(1, 0.92, 1);
    g.add(ring);
  }
  // tampa traseira
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 32).rotateX(Math.PI / 2), dark);
  cap.position.z = 0.296;
  g.add(cap);

  // corpo escuro da frente
  const body = new THREE.Mesh(
    latheZ([
      [0.0, 0.05],
      [0.09, 0.05],
      [0.088, 0.1],
      [0.078, 0.16],
      [0.07, 0.2],
      [0.0, 0.2],
    ]),
    dark,
  );
  g.add(body);
  // câmara de vidro com o núcleo aceso
  const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.11, 32, 1, true).rotateX(Math.PI / 2), glass);
  chamber.position.z = -0.255;
  chamber.renderOrder = 4;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.12, 16).rotateX(Math.PI / 2), coreMat);
  core.position.z = -0.25;
  const coreBall = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), coreMat);
  coreBall.position.z = -0.31;
  g.add(core, coreBall, chamber);
  // anéis do emissor
  for (const [z, r, t] of [
    [-0.2, 0.068, 0.012],
    [-0.31, 0.062, 0.01],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 40), dark);
    ring.position.z = z;
    g.add(ring);
  }
  // três garras curvas
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const curve = new THREE.CatmullRomCurve3(
      [
        [0.066, -0.19],
        [0.088, -0.26],
        [0.078, -0.33],
        [0.046, -0.385],
      ].map(([r, z]) => new THREE.Vector3(c * r, s * r, z)),
    );
    const claw = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.011, 8, false), black);
    const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), black);
    tipBall.position.copy(curve.getPoint(1));
    g.add(claw, tipBall);
  }
  // alça de baixo e detalhes laterais
  const grip = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.06, 0.2, 2, 0.02), black);
  grip.position.set(0, -0.1, 0.05);
  g.add(grip);
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.05, 0.12, 2, 0.008), dark);
    panel.position.set(sx * 0.108, 0.0, -0.08);
    g.add(panel);
  }
  // luz indicadora no topo (cor do último portal)
  const lamp = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.06, 4, 10).rotateX(Math.PI / 2), coreMat);
  lamp.position.set(0, 0.102, -0.06);
  g.add(lamp);

  const tip = new THREE.Object3D();
  tip.position.set(0, 0, -0.38);
  g.add(tip);
  g.userData = { core: coreMat, tip };
  return g;
}

// ------------------------------------------------------------------ amostra (cubo)
let CUBE_MATS = null;
function cubeMaterials() {
  if (CUBE_MATS) return CUBE_MATS;
  // face: painel cinza com janela redonda mostrando o núcleo de itabirito
  const draw = (emissive) => (g, s) => {
    g.fillStyle = emissive ? '#000' : '#6c7076';
    g.fillRect(0, 0, s, s);
    if (!emissive) {
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`;
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // moldura rebaixada
      g.strokeStyle = 'rgba(30,32,36,0.8)';
      g.lineWidth = 10;
      g.strokeRect(46, 46, s - 92, s - 92);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 3;
      g.strokeRect(54, 54, s - 108, s - 108);
    }
    const c = s / 2;
    // janela do núcleo (faixas de hematita e quartzo)
    g.save();
    g.beginPath();
    g.arc(c, c, s * 0.2, 0, Math.PI * 2);
    g.clip();
    if (!emissive) {
      for (let y = c - s * 0.2; y < c + s * 0.2; y += 7) {
        g.fillStyle = Math.random() < 0.5 ? '#2c2a30' : '#8a3a1c';
        g.fillRect(c - s * 0.2, y + Math.sin(y * 0.3) * 2, s * 0.4, 5 + Math.random() * 4);
      }
    } else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
    }
    g.restore();
    // anel aceso em volta da janela + marcas nos cantos
    g.strokeStyle = emissive ? '#ffb030' : '#d58a2a';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(c, c, s * 0.225, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6;
    for (const [x, y] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      g.beginPath();
      g.moveTo(c + x * s * 0.3, c + y * s * 0.16);
      g.lineTo(c + x * s * 0.3, c + y * s * 0.3);
      g.lineTo(c + x * s * 0.16, c + y * s * 0.3);
      g.stroke();
    }
    if (!emissive) {
      g.fillStyle = 'rgba(240,240,236,0.75)';
      g.font = 'bold 22px Arial';
      g.textAlign = 'center';
      g.fillText('AMOSTRA', c, s - 64);
      // pegada de terópode (três dedos) carimbada no alto da face
      g.fillStyle = 'rgba(213,138,42,0.85)';
      g.beginPath();
      g.ellipse(c, 80, 9, 7, 0, 0, Math.PI * 2);
      g.fill();
      for (const a of [-0.55, 0, 0.55]) {
        g.save();
        g.translate(c, 77);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, -13, 3.5, 10, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  };
  const face = new THREE.MeshPhysicalMaterial({
    map: canvasTexture(256, draw(false)),
    emissiveMap: canvasTexture(256, draw(true)),
    emissive: 0xffffff,
    emissiveIntensity: 0.6,
    roughness: 0.55,
    metalness: 0.35,
    clearcoat: 0.2,
    envMap: ENV,
    envMapIntensity: 0.6,
  });
  const corner = plastic(0xdcdcd6, { roughness: 0.4 });
  CUBE_MATS = { face, corner };
  return CUBE_MATS;
}

/** cubo de amostra no estilo dos cubos de teste: cantos reforçados e janela acesa */
export function sampleCube(opts = {}) {
  const { face, corner: baseCorner } = cubeMaterials();
  const mat = face.clone();
  let corner = baseCorner;
  // amostra especial (quartzo rosa): anel e cantos rosados
  if (opts.special) {
    mat.emissive.set(0xff6ab4);
    mat.color.set(0xe6d6de);
    corner = plastic(0xf3b8d4, { roughness: 0.35 });
  }
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.58, 0.58, 3, 0.035), mat);
  m.castShadow = true;
  const cg = new RoundedBoxGeometry(0.19, 0.19, 0.19, 3, 0.045);
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const c = new THREE.Mesh(cg, corner);
        c.position.set(x * 0.21, y * 0.21, z * 0.21);
        m.add(c);
      }
  m.userData.glow = m.material;
  return m;
}

// ------------------------------------------------------------------ botão de piso
/**
 * Botão grande de piso: base de metal com anel claro, luzes em volta e a
 * placa vermelha que afunda. Devolve { group, plate, lights }.
 */
export function floorButton() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, 0],
        [0.98, 0],
        [1.0, 0.03],
        [0.97, 0.1],
        [0.86, 0.12],
        [0.8, 0.1],
        [0.72, 0.1],
        [0.7, 0.05],
        [0, 0.05],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      64,
    ),
    metal(0x4a4d53, { roughness: 0.5 }),
  );
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.025, 8, 64).rotateX(Math.PI / 2), plastic(0xe8e8e4));
  ring.position.y = 0.105;
  g.add(base, ring);
  const lights = glow(new THREE.Color(2.4, 0.35, 0.15));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.07, 4, 8).rotateZ(Math.PI / 2), lights);
    l.position.set(Math.cos(a) * 0.79, 0.108, Math.sin(a) * 0.79);
    l.rotation.y = -a + Math.PI / 2;
    g.add(l);
  }
  // placa: disco com bordas chanfradas e sulcos concêntricos (por cima, transparentes)
  const grooves = canvasTexture(256, (c, s) => {
    c.clearRect(0, 0, s, s);
    for (let r = 18; r < s / 2 - 4; r += 20) {
      c.strokeStyle = 'rgba(0,0,0,0.28)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(s / 2, s / 2, r + 2.5, 0, Math.PI * 2);
      c.stroke();
    }
  });
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
      64,
    ),
    new THREE.MeshPhysicalMaterial({ color: 0xc0392b, emissive: 0x5a0a05, roughness: 0.35, clearcoat: 0.6, envMap: ENV, envMapIntensity: 0.5 }),
  );
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.58, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: grooves, transparent: true, depthWrite: false }));
  top.position.y = 0.0615;
  plate.add(top);
  plate.position.y = 0.16;
  g.add(plate);
  return { group: g, plate, lights };
}

// ------------------------------------------------------------------ torreta
/**
 * Torreta de segurança: "ovo" branco partido ao meio (as metades abrem e
 * mostram os canos quando ela mira), olho vermelho e três pernas finas.
 */
export function turretModel() {
  const g = new THREE.Group();
  const white = plastic(0xf2f2ee);
  const dark = metal(0x26282c, { roughness: 0.55 });
  const black = metal(0x121315, { roughness: 0.6, metalness: 0.4 });
  const lensMat = glow(new THREE.Color(3, 0.15, 0.1));

  const BODY_Y = 0.8;
  const S = [0.25, 0.45, 0.2];
  // miolo escuro (aparece na fenda) e as duas metades brancas
  const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), dark);
  inner.scale.set(S[0] * 0.9, S[1] * 0.97, S[2] * 0.95);
  inner.position.y = BODY_Y;
  g.add(inner);
  const halves = [];
  const guns = [];
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20, side < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI), white);
    shell.scale.set(S[0], S[1], S[2]);
    // tampa plana do lado de dentro de cada metade
    const lid = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateY(side * Math.PI / 2), dark);
    lid.scale.set(1, S[1], S[2]);
    lid.position.x = -side * 0.001;
    half.add(shell, lid);
    // canos que aparecem quando a metade abre
    const gunG = new THREE.Group();
    for (const dy of [0.04, -0.04]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.16, 10).rotateX(Math.PI / 2), black);
      barrel.position.set(side * 0.03, dy, 0.07);
      gunG.add(barrel);
    }
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.15, 0.14, 2, 0.02), dark);
    housing.position.set(side * 0.03, 0, 0.0);
    gunG.add(housing);
    gunG.position.set(-side * 0.02, 0.0, 0);
    half.add(gunG);
    half.position.set(side * 0.006, BODY_Y, 0);
    g.add(half);
    halves.push(half);
    guns.push(gunG);
  }
  // olho
  const EYE_Y = 0.95;
  const socket = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 10, 24), black);
  socket.position.set(0, EYE_Y, S[2] * Math.sqrt(1 - ((EYE_Y - BODY_Y) / S[1]) ** 2) - 0.005);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 12), lensMat);
  lens.position.copy(socket.position).add(new THREE.Vector3(0, 0, -0.01));
  g.add(socket, lens);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,60,40,0.9)');
  gr.addColorStop(1, 'rgba(255,20,10,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  eyeGlow.scale.setScalar(0.3);
  eyeGlow.position.copy(lens.position).add(new THREE.Vector3(0, 0, 0.03));
  g.add(eyeGlow);
  // antena
  const ant = limb(new THREE.Vector3(0.05, BODY_Y + S[1] - 0.04, -0.06), new THREE.Vector3(0.07, BODY_Y + S[1] + 0.14, -0.08), 0.006, 0.004, black);
  g.add(ant);
  // "T-rex robô": cabeça de dinossauro no topo, dentes, crista nas costas e rabinho
  const TOP = BODY_Y + S[1];
  const snout = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), white);
  snout.scale.set(0.13, 0.09, 0.2);
  snout.position.set(0, TOP + 0.02, 0.12);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), dark);
  jaw.scale.set(0.09, 0.035, 0.14);
  jaw.position.set(0, TOP - 0.07, 0.16);
  g.add(snout, jaw);
  const toothMat = plastic(0xf4efe0);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.035, 4).rotateX(Math.PI), toothMat);
      tooth.position.set(s * 0.08, TOP - 0.06, 0.12 + i * 0.045);
      g.add(tooth);
    }
    const dinoEye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), lensMat);
    dinoEye.position.set(s * 0.08, TOP + 0.07, 0.2);
    g.add(dinoEye);
  }
  for (let i = 0; i < 4; i++) {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), black);
    const a = 0.5 + i * 0.32;
    crest.position.set(0, BODY_Y + Math.cos(a) * S[1] * 0.98, -Math.sin(a) * S[2] * 0.98);
    crest.rotation.x = -a;
    g.add(crest);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 10).rotateX(-Math.PI / 2 - 0.35), white);
  tail.position.set(0, 0.62, -0.38);
  g.add(tail);
  // três pernas (duas na frente abertas, uma atrás)
  const legs = [
    [new THREE.Vector3(-0.1, 0.45, 0.05), new THREE.Vector3(-0.3, 0.32, 0.2), new THREE.Vector3(-0.36, 0.0, 0.3)],
    [new THREE.Vector3(0.1, 0.45, 0.05), new THREE.Vector3(0.3, 0.32, 0.2), new THREE.Vector3(0.36, 0.0, 0.3)],
    [new THREE.Vector3(0, 0.45, -0.1), new THREE.Vector3(0, 0.32, -0.36), new THREE.Vector3(0, 0.0, -0.44)],
  ];
  for (const [hip, knee, foot] of legs) {
    g.add(limb(hip, knee, 0.022, 0.018, black), limb(knee, foot, 0.018, 0.012, black));
    const kj = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), dark);
    kj.position.copy(knee);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.02, 12), dark);
    pad.position.copy(foot).setY(0.01);
    g.add(kj, pad);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.userData = { lensMat, eyeGlow, halves, guns, body: inner };
  return g;
}
