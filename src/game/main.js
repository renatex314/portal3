// Parte IV — "Laboratório Antípoda": jogo de quebra-cabeça em primeira pessoa
// com arma de portais, ligado ao documentário dos mineiros.

import * as THREE from 'three';
import { World } from './world.js';
import { PortalSystem } from './portals.js';
import { Player } from './player.js';
import { Cube } from './props.js';
import { Physics, initPhysics } from './physics.js';
import { EnergySystem } from './energy.js';
import { LEVELS, SPEAKER_NPC, DEFAULT_GRAVITY } from './levels.js';
import { Sfx } from './sfx.js';
import { Soundtrack } from '../audio.js';
import { Narrator, spoken } from '../narrator.js';
import { makeWorker, poseWorker } from '../mine.js';
import { makeDino, poseDino, orbit, roar, makeFossil } from '../dinos.js';
import { PEOPLE } from '../documentary.js';
import { Net } from './net.js';
import { Turret, crystalMesh } from './turrets.js';
import { SLOT_COLORS, SLOT_CSS } from './portals.js';
import { initEnvironment, portalGun, sampleCube, drawGunHolo } from './models.js';
import { Post, dust, ContactShadows, Dissolver } from './fx.js';
import { Frontier } from './frontier.js';
import { Chronos } from './relogio.js';
import './editor/editor.css';
import { createEditor } from './editor/editor.js';
import { store as mineStore } from './editor/store.js';
import { compile as compileMine } from './editor/doc.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// só escreve no DOM quando o texto muda (escrever o mesmo texto todo quadro refaz o layout)
const textCache = new Map();
function setText(id, text) {
  if (textCache.get(id) === text) return;
  textCache.set(id, text);
  $(id).textContent = text;
}

// ------------------------------------------------------------------ renderer / cena
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
// conferir cada shader trava a CPU até a placa terminar de compilar; só no desenvolvimento
renderer.debug.checkShaderErrors = import.meta.env.DEV;
initEnvironment(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101216);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3a30, 1.0));

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 700);
camera.layers.enable(2); // a arma em primeira pessoa
scene.add(camera);

const post = new Post(renderer, scene, camera);
post.haze.lakes = () => world.hazards; // névoa de calor sobre a rocha fundida
const motes = dust();
scene.add(motes);
const shadows = new ContactShadows(scene);
const dissolver = new Dissolver(scene);
const FIZZLE = new THREE.Color(0.45, 0.8, 1.0);
const BURN = new THREE.Color(1.0, 0.45, 0.1);

const world = new World(scene);
const portals = new PortalSystem(renderer, scene, camera, world);
const physics = new Physics(portals);
world.physics = physics;
const energy = new EnergySystem(scene);
const frontier = new Frontier(scene, world, portals, physics);
const UP = new THREE.Vector3(0, 1, 0);
const player = new Player(camera);
const sound = new Soundtrack();
const sfx = new Sfx(sound);
const narrator = new Narrator();
narrator.onSpeaking = (on) => sound.duck(on);
narrator.loadClips(); // falas gravadas (public/vozes)

const dyn = new THREE.Group(); // cubos e personagens da fase

// ------------------------------------------------------------------ multiplayer (rede local)
const net = new Net();
const avatars = new Map(); // id → { w, tag, target, yaw, up, moving, lvl, t }
const mp = () => net.connected;
const slotHex = (slot, i) => '#' + SLOT_COLORS[slot % 4][i].getHexString();

function nameTag(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.font = 'bold 54px Arial, sans-serif';
  const w = Math.min(g.measureText(name).width + 60, 512);
  g.fillStyle = 'rgba(8,10,16,0.75)';
  g.beginPath();
  g.roundRect((512 - w) / 2, 18, w, 92, 46);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.fillText(name, 256, 84);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  sp.scale.set(1.6, 0.4, 1);
  sp.position.y = 2.25;
  return sp;
}

function avatarFor(id) {
  const peer = net.peers.get(id);
  if (!peer) return null;
  if (!avatars.has(id)) {
    // os outros jogadores aparecem como raptores de capacete, com colete da cor dos portais
    const w = makeDino('raptor', { helmet: 0xffffff, vest: SLOT_COLORS[peer.slot % 4][0].getHex(), color: [0x8a5a34, 0x5e7a3a, 0x6a5a8a, 0x9a7a3a][peer.slot % 4] });
    w.group.add(nameTag(peer.name, slotHex(peer.slot, 0)));
    scene.add(w.group);
    avatars.set(id, { w, target: new THREE.Vector3(), yaw: 0, up: 1, moving: false, lvl: -1, t: 0 });
  }
  return avatars.get(id);
}

function removeAvatar(id) {
  const a = avatars.get(id);
  if (a) scene.remove(a.w.group);
  avatars.delete(id);
  portals.removeRemote(id);
}

function renderPlayers() {
  const el = $('mp-list');
  if (!mp()) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const rows = [`<b>Sala “${net.room}”</b>`, `<span style="--c:${slotHex(net.slot, 0)}">● ${$('mp-name').value || 'você'} (você)</span>`];
  for (const p of net.peers.values()) rows.push(`<span style="--c:${slotHex(p.slot, 0)}">● ${p.name}</span>`);
  el.innerHTML = rows.join('');
}

function setLocalSlot(slot) {
  portals.setSlot(slot);
  const [a, b] = SLOT_CSS[slot % 4];
  document.documentElement.style.setProperty('--pa', a);
  document.documentElement.style.setProperty('--pb', b);
}

net.on('joined', (m) => {
  toast(`${m.name} entrou na sala`);
  renderPlayers();
});
net.on('left', (m) => {
  toast(`${m.name ?? 'Alguém'} saiu da sala`);
  removeAvatar(m.id);
  renderPlayers();
});
net.on('disconnect', () => {
  toast('Conexão com a sala perdida — jogando sozinho.');
  for (const id of [...avatars.keys()]) removeAvatar(id);
  setLocalSlot(0);
  renderPlayers();
  $('mp-status').textContent = 'Desconectado.';
});
net.on('state', (m) => {
  const a = avatarFor(m.id);
  if (!a) return;
  a.target.fromArray(m.p);
  if (a.lvl !== m.lvl) a.w.group.position.copy(a.target);
  a.yaw = m.yaw;
  a.up = m.up;
  a.moving = m.mv;
  a.lvl = m.lvl;
  a.t = performance.now();
});
net.on('portal', (m) => {
  const peer = net.peers.get(m.id);
  if (peer && m.lvl === levelIdx) portals.placeRemote(m.id, peer.slot, m.which, m.c, m.n, m.u, m.b);
});
net.on('cube', (m) => {
  const c = cubes[m.idx];
  if (!c || m.lvl !== levelIdx) return;
  if (held === c) return; // eu é que estou segurando
  c.remote = { p: new THREE.Vector3().fromArray(m.p), q: m.q ? new THREE.Quaternion().fromArray(m.q) : null, held: m.held, t: performance.now() };
});
net.on('turret', (m) => {
  if (m.lvl === levelIdx) turretDown(m.idx, false, m.p);
});
net.on('gem', (m) => {
  if (m.lvl === levelIdx) takeGem(m.idx, m.name);
});

function applyRoomFlags(flags) {
  if (!flags) return;
  for (const [idx, p] of flags.turrets ?? []) turretDown(idx, false, p);
  for (const [idx, name] of flags.gems ?? []) takeGem(idx, name);
}

function fillMapSelect() {
  const sel = $('room-map');
  sel.innerHTML = LEVELS.map((L, i) => L.editor ? '' : `<option value="${i}">${L.free ? 'Mapa livre' : L.series === 'campaign' ? `Campanha original` : L.code ? L.code : `Câmara ${String(L.id).padStart(2, '0')}`} · ${L.name}</option>`).join('');
  sel.value = String(levelIdx);
}
$('room-map').addEventListener('change', (e) => {
  if (mp()) net.send({ t: 'setLevel', level: Number(e.target.value) });
  // startLevel (e não loadLevel direto): a campanha original precisa ler o mapa antes
  else startLevel(Number(e.target.value));
});

net.on('level', (m) => {
  if (m.final) {
    toast(`${m.by} atravessou a Terra!`);
    showFinal();
    return;
  }
  const first = !running;
  $('menu').hidden = true;
  $('done').hidden = true;
  $('final').hidden = true;
  running = true;
  if (!first && m.by) {
    sfx.win();
    toast(`${m.by} chegou ao elevador — câmara ${String(m.level + 1).padStart(2, '0')}!`);
  }
  if (!first && !m.by) toast(`Mapa da sala trocado: ${LEVELS[m.level].name}`);
  $('next').hidden = false;
  setTimeout(() => {
    loadLevel(Math.min(m.level, LEVELS.length - 1));
    fillMapSelect();
    if (first || !$('pause').hidden) {
      $('pause').hidden = true;
      lock();
    }
  }, first ? 0 : m.by ? 1400 : 200);
});

let netSendAcc = 0;
const cubeSendUntil = new Map();
function netTick(dt) {
  if (!mp()) return;
  netSendAcc += dt;
  if (netSendAcc >= 0.05) {
    netSendAcc = 0;
    const moving = input.f || input.b || input.l || input.r;
    net.send({ t: 'state', p: player.pos.toArray().map((v) => +v.toFixed(3)), yaw: +player.yaw.toFixed(3), up: player.upSign, mv: moving && player.grounded, lvl: levelIdx });
    const now = performance.now();
    cubes.forEach((c, idx) => {
      if (c === held) cubeSendUntil.set(idx, now + 2500);
      if ((cubeSendUntil.get(idx) ?? 0) > now && !(c.remote && now - c.remote.t < 300))
        net.send({ t: 'cube', idx, p: c.pos.toArray().map((v) => +v.toFixed(3)), q: c.quat.toArray().map((v) => +v.toFixed(4)), held: c === held, lvl: levelIdx });
    });
  }
}

function updateAvatars(dt, t) {
  const now = performance.now();
  for (const [id, a] of avatars) {
    const visible = a.lvl === levelIdx && now - a.t < 3000 && running;
    a.w.group.visible = visible;
    if (!visible) continue;
    const feet = a.target.clone().add(new THREE.Vector3(0, -0.9 * a.up, 0));
    a.w.group.position.lerp(feet, 1 - Math.exp(-dt * 14));
    a.w.group.rotation.set(0, a.yaw + Math.PI, a.up < 0 ? Math.PI : 0);
    a.w.P.pose = a.moving ? 'walk' : 'idle';
    poseDino(a.w, t, dt);
  }
}

function peerFeet() {
  const now = performance.now();
  const out = [];
  for (const a of avatars.values()) if (a.lvl === levelIdx && now - a.t < 1500) out.push(a.target.clone().add(new THREE.Vector3(0, -0.9 * a.up, 0)));
  return out;
}
scene.add(dyn);

// ------------------------------------------------------------------ clones do passado (relógio do tempo)
/** um raptor em tons de cinza (opaco): as outras versões de você no tempo */
function makeCloneGhost() {
  const w = makeDino('raptor', { helmet: 0x8fe3ff, vest: 0x38d8ff });
  w.group.traverse((o) => {
    if (!o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    for (const m of [o.material].flat()) {
      if (m.color) {
        const l = m.color.r * 0.3 + m.color.g * 0.59 + m.color.b * 0.11;
        m.color.setRGB(l, l, l);
      }
      if (m.emissive) {
        const l = (m.emissive.r * 0.3 + m.emissive.g * 0.59 + m.emissive.b * 0.11) * 0.6;
        m.emissive.setRGB(l, l, l);
      }
    }
  });
  scene.add(w.group);
  return {
    group: w.group,
    set(feet, yaw, up, moving, t, dt, alpha) {
      w.group.visible = true;
      w.group.position.copy(feet);
      w.group.rotation.set(0, yaw + Math.PI, up < 0 ? Math.PI : 0);
      w.P.pose = moving ? 'walk' : 'idle';
      poseDino(w, t, dt);
    },
  };
}

// ------------------------------------------------------------------ efeitos do relógio do tempo
const KEYS_TEXT = document.getElementById('keys')?.textContent ?? '';
const fxState = { jump: 0, paradox: 0, freeze: 0 };
const timeRings = [];
const timeWorldT = { v: 0 };
/** anel de energia: expande e some (ou, `hold`, fica como um portal-eco que pisca) */
function timeRing(pos, normal, color, life = 0.8, size = 1.6, ellipse = false) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 56),
    new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
  );
  m.position.copy(pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  scene.add(m);
  timeRings.push({ m, t: 0, life, size, ellipse });
}

const TIME_FX = new THREE.Color(0.75, 0.45, 1.0);
const chronosFx = {
  caught() {
    sfx.caught();
  },
  /** algo do presente mudou por causa do passado: some (desintegra) ou aparece (materializa) */
  changed(obj, appear = false) {
    const mesh = obj?.mesh ?? obj?.group ?? obj;
    if (!mesh) return;
    dissolver.add(mesh, TIME_FX, { appear });
    if (appear && obj.mesh) obj.hideUntil = performance.now() + 1150;
    if (appear && obj.group && !obj.mesh) {
      // bola: escondida enquanto o fantasma se forma
      obj.group.visible = false;
      setTimeout(() => (obj.group.visible = true), 1150);
    }
  },
  toast(m) {
    toast(m);
  },
  pause(on) {
    on ? sfx.freeze() : sfx.unfreeze();
    // parar/continuar o tempo: uma onda de distorção abrindo do centro da tela (sem anel)
    post.shockwave({ big: true });
    post.warp = Math.max(post.warp ?? 0, on ? 0.45 : 0.3);
    if (on && (chronosFx._said = (chronosFx._said ?? 0) + 1) <= 2) toast('Tempo parado. Roda do mouse: quantos segundos voltar. Vermelho = passado, ciano = presente.');
  },
  scrub(d) {
    sfx.scrub(d);
  },
  jump(delta) {
    sfx.timeJump();
    post.warp = 1.1;
    post.tunnel = 1;
    post.blur.reset();
    fxState.jump = 0.8;
    timeRing(camera.position.clone().addScaledVector(camForward(), 1.2), camForward().negate(), new THREE.Color(0.8, 2.0, 3.0), 0.9, 5);
    toast(`Você voltou ${delta.toFixed(1).replace('.', ',')} s no tempo.`);
  },
  paradox(why, at) {
    sfx.paradox();
    post.warp = 1.3;
    fxState.paradox = 1.1;
    const el = $('paradox');
    $('paradox-why').textContent = why;
    el.hidden = false;
    clearTimeout(chronosFx._t);
    chronosFx._t = setTimeout(() => (el.hidden = true), 2600);
    if (at) {
      timeRing(at, new THREE.Vector3(0, 1, 0), new THREE.Color(3, 0.3, 0.8), 0.9, 4);
      timeRing(at, new THREE.Vector3(1, 0, 0), new THREE.Color(0.4, 2, 3), 0.9, 3);
    }
    burst(at ?? player.pos, new THREE.Vector3(0, 1, 0));
  },
  echo(exit, open, pos) {
    sfx.echo(open);
    if (open) timeRing(exit.c.clone().addScaledVector(exit.n, 0.04), exit.n, new THREE.Color(1.4, 1.4, 1.4), 0.8, 1, true);
    else if (pos) {
      timeRing(pos.clone().add(new THREE.Vector3(0, 0.9, 0)), new THREE.Vector3(0, 1, 0), new THREE.Color(1.6, 1.6, 1.6), 0.7, 2.6);
      timeRing(pos.clone().add(new THREE.Vector3(0, 0.9, 0)), exit.n, new THREE.Color(1.6, 1.6, 1.6), 0.7, 2.2);
    }
  },
  toast: (m) => toast(m),
};

function updateTimeFx(dt) {
  for (let i = timeRings.length - 1; i >= 0; i--) {
    const r = timeRings[i];
    r.t += dt;
    const k = r.t / r.life;
    if (k >= 1) {
      scene.remove(r.m);
      r.m.geometry.dispose();
      r.m.material.dispose();
      timeRings.splice(i, 1);
      continue;
    }
    if (r.ellipse) r.m.scale.set(0.68 * (0.9 + 0.1 * Math.sin(k * 30)), 1.08 * (0.9 + 0.1 * Math.sin(k * 30)), 1);
    else r.m.scale.setScalar(0.3 + k * r.size);
    r.m.material.opacity = r.ellipse ? Math.min(1, k * 4) * (1 - k * k) : (1 - k) * (1 - k);
  }
  fxState.jump = Math.max(0, fxState.jump - dt);
  fxState.paradox = Math.max(0, fxState.paradox - dt);
  const u = post.finish.uniforms;
  const target = relogio?.paused ? 1 : 0;
  u.uFreeze.value += (target - u.uFreeze.value) * Math.min(1, dt * 6);
  u.uGlitch.value = relogio ? Math.min(1, fxState.paradox * 1.5) : 0;
  if (relogio) {
    const mode = fxState.paradox > 0 ? 'paradox' : fxState.jump > 0 ? 'jump' : relogio.paused ? 'pause' : 'play';
    if (document.body.dataset.relogio !== mode) document.body.dataset.relogio = mode;
  }
}

function updateClockHud() {
  const h = relogio.hud();
  const showBlocked = h.paused && h.blocked && portals.orange.placed && portals.orange.delta > 0;
  $('clock').classList.toggle('blocked', showBlocked);
  setText('clock-state', h.paused ? 'tempo parado' : relogio.sweep ? 'saltando no tempo' : 'tempo normal');
  setText('clock-d', h.paused ? `−${h.delta.toFixed(1).replace('.', ',')} s` : fmt(h.tw));
  $('clock-fill').style.width = h.paused ? `${Math.min(100, (h.delta / Math.max(h.max, 0.5)) * 100)}%` : '0%';
  setText('clock-hint', h.paused ? 'roda do mouse: voltar mais/menos · vermelho = passado · ciano = presente · 2: continuar' : '2 — parar o tempo');
  setText('clock-extra', [h.clones ? `${h.clones} clone${h.clones > 1 ? 's' : ''} do passado` : '', h.paradoxes ? `${h.paradoxes} paradoxo${h.paradoxes > 1 ? 's' : ''}` : '', showBlocked ? '⚠ destino ocupado' : ''].filter(Boolean).join(' · '));
}

// ------------------------------------------------------------------ corpo do jogador (visível só pelos portais)
// você é um raptor de capacete e colete (dá para se ver pelos portais)
const body = makeDino('raptor', { helmet: 0xffffff, vest: 0xe8762a });
body.group.traverse((o) => o.layers.set(1));
scene.add(body.group);

// ------------------------------------------------------------------ arma de portais (primeira pessoa)
const gun = portalGun();
{
  gun.position.set(0.21, -0.19, -0.5);
  gun.rotation.set(0.05, 0.09, 0);
  gun.scale.setScalar(0.55); // Mark III: mais comprida e quadrada que a anterior
  gun.traverse((o) => o.layers.set(2));
  camera.add(gun);
  const gunLight = new THREE.PointLight(0x9fd8ff, 0.6, 1.2);
  gunLight.position.set(0.16, -0.04, -1.2); // na frente da arma (encostada, estouraria o casco branco)
  camera.add(gunLight);
  gun.userData.light = gunLight;
}
let recoil = 0;
gun.userData.base = gun.userData.core.color.clone();
// estado da animação da arma: atraso ao girar a câmera, passos, aterrissagem, garras
const GUN = { look: new THREE.Vector2(), sway: new THREE.Vector2(), swayV: new THREE.Vector2(), land: 0, landV: 0, open: 0, walk: 0, heat: 0, pulse: -1, holoT: 0 };

function animateGun(dt, t) {
  const u = gun.userData;
  recoil = Math.max(0, recoil - dt * 6);
  // mola: a arma fica um pouco para trás quando a câmera gira e volta balançando
  const tx = clamp(-GUN.look.x * 0.0007, -0.05, 0.05);
  const ty = clamp(GUN.look.y * 0.0007, -0.04, 0.04);
  GUN.look.set(0, 0);
  GUN.swayV.x += ((tx - GUN.sway.x) * 160 - GUN.swayV.x * 16) * dt;
  GUN.swayV.y += ((ty - GUN.sway.y) * 160 - GUN.swayV.y * 16) * dt;
  GUN.sway.addScaledVector(GUN.swayV, dt);
  GUN.landV += (-GUN.land * 220 - GUN.landV * 15) * dt;
  GUN.land += GUN.landV * dt;
  const moving = (input.f || input.b || input.l || input.r) && player.grounded;
  GUN.walk += ((moving ? 1 : 0) - GUN.walk) * Math.min(1, dt * 8);
  GUN.open += ((held ? 1 : 0) - GUN.open) * Math.min(1, dt * 9);
  const b = player.bob * 0.5;
  const bx = Math.sin(b) * 0.012 * GUN.walk;
  const by = -Math.abs(Math.cos(b)) * 0.01 * GUN.walk;
  const breathe = Math.sin(t * 1.7) * 0.0025;
  gun.position.set(0.21 + GUN.sway.x + bx, -0.19 + GUN.sway.y + by + breathe + GUN.land + recoil * 0.015 + GUN.open * 0.01, -0.5 + recoil * 0.06 - GUN.open * 0.02);
  gun.rotation.set(0.05 + recoil * 0.22 + GUN.sway.y * 1.5 - GUN.land * 1.2, 0.09 + GUN.sway.x * 2, -GUN.sway.x * 2.5 + Math.sin(t * 1.1) * 0.008 + bx * 0.8);
  // garras: abrem ao atirar e ao segurar algo (tremendo com a força do campo)
  const jitter = GUN.open * Math.sin(t * 47) * 0.025;
  u.claws.forEach((c, i) => (c.rotation.y = -(GUN.open * 0.16 + recoil * 0.4 + jitter * (i % 2 ? 1 : -1))));
  u.coil.rotation.z += dt * (1.5 + GUN.open * 14 + recoil * 25);
  const k = 1 + Math.sin(t * 5) * 0.12 + recoil * 1.6 + GUN.open * (0.5 + 0.4 * Math.sin(t * 31));
  u.core.color.copy(u.base).multiplyScalar(0.55 * k);
  u.light.intensity = 0.3 * k;
  // LEDs de carga: correm quando segurando, ficam acesos parados
  u.leds.forEach((m, i) => {
    const on = GUN.open > 0.5 ? (Math.floor(t * 10) % 3 === i ? 1.6 : 0.3) : 1;
    m.color.copy(u.base).multiplyScalar(0.5 * on);
  });
  // condutos: fluxo contínuo e um pulso correndo para a frente depois do tiro
  u.conduit.uniforms.uTime.value = t;
  u.conduit.uniforms.uColor.value.copy(u.base).multiplyScalar(0.45 * (1 + GUN.open * 0.6));
  if (GUN.pulse >= 0) GUN.pulse += dt * 4.5;
  if (GUN.pulse > 1.3) GUN.pulse = -1;
  u.conduit.uniforms.uPulse.value = GUN.pulse;
  // anéis: giram em sentidos opostos, avançam no tiro e se afastam segurando
  u.rings.forEach((r) => {
    r.rotation.z += dt * r.userData.dir * (1.2 + recoil * 14 + GUN.open * 5);
    r.position.z = r.userData.z - recoil * 0.025 + GUN.open * Math.sin(t * 9 + r.userData.dir) * 0.004;
    r.scale.setScalar(1 + recoil * 0.12 + GUN.open * 0.06);
  });
  // calor: cada tiro esquenta, as aletas abrem e o brilho de dentro esfria aos poucos
  GUN.heat = Math.max(0, GUN.heat - dt * 0.45);
  u.vents.forEach((v) => (v.rotation.z = v.userData.side * Math.min(1, GUN.heat * 1.4) * 0.9));
  u.heatMat.color.setRGB(2.4 * GUN.heat, 0.7 * GUN.heat * GUN.heat, 0.08 * GUN.heat);
  // íris do emissor: abre no tiro e segurando algo
  const irisOpen = Math.min(1, recoil * 1.5 + GUN.open * 0.6);
  u.iris.forEach((p) => (p.rotation.z = p.userData.a + irisOpen * 0.9));
  // plasma na ponta
  u.tipGlow.material.color.copy(u.base).multiplyScalar(0.35);
  u.tipGlow.scale.setScalar(0.05 + Math.random() * 0.012 + recoil * 0.14 + GUN.open * 0.03);
  // efeitos da Mark III (plasma, arcos entre as garras, anel holográfico, onda de choque)
  u.animate?.(dt, t, { recoil, open: GUN.open, heat: GUN.heat, base: u.base, slow: Math.max(clamp((1 - SLOW.k) / (1 - SLOW.scale), 0, 1), fieldGlow()), conduitColor: u.conduit.uniforms.uColor.value, leds: u.leds });
  // painel holográfico (redesenha ~12 vezes por segundo)
  GUN.holoT -= dt;
  if (GUN.holoT <= 0) {
    GUN.holoT = 1 / 12;
    const cols = SLOT_CSS[mp() ? net.slot % 4 : 0];
    drawGunHolo(gun, { blue: portals.blue.placed, orange: portals.orange.placed, holding: !!held, slow: SLOW.left / SLOW.max, mode: gunMode, color: cols, t });
  }
}

// projétil do tiro (como no Portal 1): uma bola de energia na cor do portal voa até
// a parede, e o portal só abre quando ela chega. Um por cor, sempre na cena (luz e
// materiais fixos: ligar/desligar luzes faria o three.js recompilar os shaders)
const BOLT_SPEED = 150; // m/s
function makeBolt() {
  const g = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), toneMapped: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), coreMat);
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), haloMat);
  // rastro: cone com a base no núcleo e a ponta para trás (−z; o grupo olha para o alvo)
  const trailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const trail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5), trailMat);
  // espiral tracejada: duas hélices enroladas no rastro (em −z), que afinam e apagam
  // na cauda; o objeto gira em volta do eixo do voo e estica com a distância voada
  const spiral = new THREE.Group();
  const spiralMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const SPIRAL_L = 2.4;
  for (const phase of [0, Math.PI]) {
    const pos = [];
    const col = [];
    const N = 96; // pontos por hélice; um traço a cada dois segmentos
    const at = (i) => {
      const f = i / N;
      const a = phase + f * Math.PI * 2 * 7; // 7 voltas no comprimento todo
      const r = 0.1 * (1 - 0.55 * f);
      return [Math.cos(a) * r, Math.sin(a) * r, -f * SPIRAL_L, 1 - f];
    };
    for (let i = 0; i < N; i += 2) {
      for (const j of [i, i + 1]) {
        const [x, y, z, k] = at(j);
        pos.push(x, y, z);
        col.push(k, k, k); // brilho cai até a cauda (vezes a cor do material)
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const line = new THREE.LineSegments(geo, spiralMat);
    line.frustumCulled = false;
    spiral.add(line);
  }
  g.add(core, halo, trail, spiral);
  g.visible = false;
  scene.add(g);
  const light = new THREE.PointLight(0xffffff, 0, 6, 1.6);
  scene.add(light);
  return { g, core, halo, trail, spiral, spiralMat, SPIRAL_L, coreMat, haloMat, trailMat, light, active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0, done: null };
}
const bolts = { blue: makeBolt(), orange: makeBolt() };
const _shockV = new THREE.Vector3();
const _shockUv = new THREE.Vector2();

/** dispara o projétil de `from` até `to`; `done` roda quando ele chega */
function fireBolt(which, from, to, done) {
  const B = bolts[which];
  const c = SLOT_COLORS[mp() ? net.slot % 4 : 0][which === 'blue' ? 0 : 1];
  B.coreMat.color.copy(c).multiplyScalar(4).addScalar(0.6); // núcleo quase branco, acima de 1: o bloom acende
  B.haloMat.color.copy(c).multiplyScalar(2.2);
  B.trailMat.color.copy(c).multiplyScalar(2.6);
  B.spiralMat.color.copy(c).multiplyScalar(3.2).addScalar(0.3);
  B.light.color.copy(c);
  B.from.copy(from);
  B.to.copy(to);
  B.t = 0;
  B.dur = Math.max(0.04, from.distanceTo(to) / BOLT_SPEED);
  B.done = done; // um tiro novo da mesma cor substitui o que ainda está voando
  B.active = true;
  B.g.position.copy(from);
  B.g.lookAt(to);
  B.trail.scale.set(1, 1, 0.01);
  B.spiral.scale.set(1, 1, 0.01);
  B.g.visible = true;
}

function updateBolts(dt, t) {
  for (const B of Object.values(bolts)) {
    if (!B.active) continue;
    B.t += dt;
    const k = Math.min(1, B.t / B.dur);
    B.g.position.lerpVectors(B.from, B.to, k);
    const flown = B.from.distanceTo(B.g.position);
    B.trail.scale.z = Math.min(1.6, flown); // o rastro cresce até ~1,6 m
    B.spiral.scale.z = Math.min(1, flown / B.SPIRAL_L); // a espiral cresce até o comprimento todo
    B.spiral.rotation.z = -t * 38; // gira em volta do eixo do voo
    const pulse = 1 + 0.18 * Math.sin(t * 60);
    B.core.scale.setScalar(pulse);
    B.halo.scale.setScalar(1.1 - 0.1 * pulse);
    B.light.position.copy(B.g.position);
    B.light.intensity = 6;
    if (k >= 1) {
      B.active = false;
      B.g.visible = false;
      B.light.intensity = 0;
      const done = B.done;
      B.done = null;
      done?.();
    }
  }
}
function clearBolts() {
  for (const B of Object.values(bolts)) {
    B.active = false;
    B.done = null;
    B.g.visible = false;
    B.light.intensity = 0;
  }
}

// faíscas quando o portal não gruda
const sparkGeo = new THREE.BufferGeometry();
const SPARKS = 40;
sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffd080, size: 0.06, transparent: true, opacity: 0 }));
sparks.frustumCulled = false;
scene.add(sparks);
const sparkVel = Array.from({ length: SPARKS }, () => new THREE.Vector3());
let sparkT = 9;

// ------------------------------------------------------------------ estado
const input = { f: false, b: false, l: false, r: false, jump: false, crouch: false };
// zoom: segure Z; a rodinha muda o aumento enquanto segura
const ZOOM = { on: false, level: 3, k: 1 };
let level = null; // definição
let data = null; // dados devolvidos por build()
let levelIdx = 0;
let cubes = [];
let npcs = {};
let npcList = [];
let dinoList = []; // { d, orbit? }
let rex = null; // o T-rex do mapa livre
let rexCooldown = 0;
let rexWarned = false;
let held = null;
let running = false;
let paused = true;
let levelTime = 0;
let completed = false;
let deadFlash = 0;
let assist = null;
let lastGrounded = false;
let lastVy = 0;
let stepAcc = 0;
let inTube = false;
const firedHints = new Set();
const grav = new THREE.Vector3();
let gravityFn = DEFAULT_GRAVITY;
let turrets = [];
let relogio = null; // relógio do tempo (série Experimento): 1 volta, 2 para, 3 anda
let fight = null; // luta contra um chefe (série Chefes): criada pela própria fase
let crystals = [];
let health = 100;
let hurtT = 9;
let hurtFlash = 0;
let gemsMine = 0;
let gunMode = 'both'; // 'none' | 'blue' | 'both' (a arma é achada/melhorada em algumas câmaras)
let cycle = null; // portal da fase que troca de lugar sozinho
let inFizzler = false;
const lastPlayerPos = new THREE.Vector3();
const gemOwners = new Map(); // nome → cristais (multiplayer)
let moonVisited = false;
// gravidade da fase + zonas de gravidade, buracos negros e funis (série Fronteira)
const gravityAt = (p) => frontier.gravity(p, gravityFn(p, grav));

const progress = (() => {
  try {
    return JSON.parse(localStorage.getItem('tunel-jogo') || '{}');
  } catch {
    return {};
  }
})();
if (new URLSearchParams(location.search).has('todas')) progress.unlocked = LEVELS.length;
progress.unlocked = Math.max(progress.unlocked || 1, 1);
progress.classic = Math.max(progress.classic || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.hard = Math.max(progress.hard || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.momentum = Math.max(progress.momentum || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.frontier = Math.max(progress.frontier || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.experiment = Math.max(progress.experiment || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.boss = Math.max(progress.boss || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.campaign = Math.max(progress.campaign || 1, new URLSearchParams(location.search).has('todas') ? 99 : 1);
progress.best = progress.best || {};
const saveProgress = () => {
  try {
    localStorage.setItem('tunel-jogo', JSON.stringify(progress));
  } catch {}
};

const levelLabel = (L) =>
  L.free ? 'Mapa livre' : L.series === 'mine' ? `Meu nível ${L.code}` : L.series === 'campaign' ? L.name : L.series === 'hard' ? `Desafio ${L.code}` : L.series === 'momentum' ? `Momento ${L.code}` : L.series === 'boss' ? `Chefe ${L.code}` : L.series === 'experiment' ? `Experimento ${L.code}` : L.code ? `Teste ${L.code}` : `Câmara ${String(L.id).padStart(2, '0')}`;
const cycleSpot = (i) => {
  const sp = cycle.spots[i];
  return [sp.c, sp.n, sp.u ?? [0, 1, 0]];
};

// ------------------------------------------------------------------ fases
function clearLevel() {
  portals.blockedAt = null;
  viewOverride = null;
  clearBolts();
  ZOOM.on = false; // o zoom (rodinha) não passa de um mapa para o outro
  clearTimeout(fadeTimer);
  document.getElementById('campaign-fade')?.style.setProperty('opacity', '0');
  campaign?.dialogue.stopAll();
  world.reset();
  portals.reset();
  energy.reset();
  frontier.reset();
  dissolver.clear();
  for (const c of [...dyn.children]) dyn.remove(c);
  cubes = [];
  turrets = [];
  relogio?.clear();
  relogio = null;
  portals.pastView = null;
  portals.futureView = null;
  document.body.dataset.relogio = '';
  fight = null;
  crystals = [];
  gemsMine = 0;
  gemOwners.clear();
  health = 100;
  moonVisited = false;
  npcs = {};
  npcList = [];
  dinoList = [];
  rex = null;
  rexCooldown = 3;
  rexWarned = false;
  held = null;
  assist = null;
  firedHints.clear();
  dialogRun++;
  narrator.cancel();
  $('subs').classList.remove('show');
}

const CORE_VOICES = ['Portal.Glados_core.Curiosity_', 'Portal.Glados_core.Aggressive_', 'Portal.Glados_core.Crazy_'];
/** cubo (amostra) — ou, na campanha original, um núcleo da luta final */
function makeCube(x, y, z, opts = {}) {
  const core = opts.core !== undefined;
  const m = opts.mesh ?? (core ? (campaign.realCoreModel?.(opts.core) ?? campaign.coreModel(opts.core)) : sampleCube(opts));
  dyn.add(m);
  const c = new Cube(physics, portals, m, x, y, z, opts);
  c.ioName = opts.ioName;
  if (core) {
    c.ioClass = 'prop_glados_core';
    c.coreLines = CORE_VOICES[opts.core] ? campaign.dialogue.soundNames(CORE_VOICES[opts.core]) : [];
    c.coreDelay = opts.coreDelay ?? 0.4;
    c.grabUnlock = !!opts.grabUnlock;
    if (opts.frozen) {
      c.frozen = true;
      c.body.setBodyType(1, true); // preso no lugar até EnableMotion
    }
  }
  cubes.push(c);
  return c;
}

/**
 * Tela escurecendo/clareando (env_fade da campanha original). `from`: começa na
 * cor, segura `hold` s e clareia em `dur` s; senão escurece em `dur` s, segura e
 * volta — a não ser com `stay` ("fica escuro" até o próximo esmaecimento).
 */
let fadeTimer = 0;
function screenFade(color, dur, hold, from, stay) {
  let el = document.getElementById('campaign-fade');
  if (!el) {
    el = document.createElement('div');
    el.id = 'campaign-fade';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:40';
    document.body.appendChild(el);
  }
  clearTimeout(fadeTimer);
  const to = (opacity, secs) => {
    el.style.transition = `opacity ${Math.max(0, secs)}s linear`;
    el.style.opacity = String(opacity);
  };
  el.style.background = color;
  if (from) {
    to(1, 0);
    fadeTimer = setTimeout(() => to(0, dur), Math.max(0, hold) * 1000);
  } else {
    requestAnimationFrame(() => to(1, dur));
    if (!stay) fadeTimer = setTimeout(() => to(0, 0.5), (dur + Math.max(hold, 0.3)) * 1000);
  }
}

/** fim da campanha original: tela própria (o final cantado do original não é reproduzido) */
function completeCampaign() {
  if (completed) return;
  completed = true;
  sfx.win();
  document.exitPointerLock?.();
  progress.campaign = 99;
  saveProgress();
  $('done-title').textContent = 'Campanha original concluída';
  $('done-time').textContent = `Tempo na última fase: ${fmt(levelTime)} · mortes no total: ${deaths}`;
  $('next').hidden = true;
  $('done').hidden = false;
}

// módulo da campanha original (carregado sob demanda)
let campaign = null;

// câmera de cena (point_viewcontrol): enquanto ligada, a tela mostra esse ponto de vista
let viewOverride = null;
const NO_INPUT = {};

// ganchos que o sistema de entidades da campanha original usa
const campaignCtx = {
  world,
  portals,
  player,
  cubes: () => cubes,
  spawnCube(pos, opts = {}) {
    const c = makeCube(pos.x, pos.y, pos.z, opts);
    c.ioOutputs = opts.outputs;
    return c;
  },
  removeCube(c) {
    if (c.gone) return;
    if (held === c) release();
    dissolver.add(c.mesh, new THREE.Color(0.4, 1.0, 0.8));
    c.vanish();
    c.killed = true;
    cubes = cubes.filter((x) => x !== c);
  },
  die: () => die(),
  hurt(amount) {
    health -= amount;
    hurtT = 0;
    hurtFlash = 1;
    if (health <= 0) die();
  },
  complete(map) {
    if (map === 'final') return completeCampaign();
    // elevador de chegada também tem uma troca de mapa (de volta à câmara anterior): ignora
    const to = LEVELS.findIndex((L) => L.map && L.map === (map ?? '').toLowerCase());
    if (to >= 0 && to <= levelIdx) return;
    complete(false);
  },
  fade: (...a) => screenFade(...a),
  view: (v) => (viewOverride = v),
  teleport(pos, yaw) {
    player.spawn(pos.x, pos.y, pos.z, yaw);
  },
  toast: (m) => toast(m),
  scene: (file, wait) => campaign.dialogue.playScene(file, { wait }),
  stopScene: (file) => campaign.dialogue.stopVoice(file),
  sound: (name, vol) => campaign.dialogue.playSound(name, vol),
  stopSound: (h, fade) => campaign.dialogue.stopSound(h, fade),
  async credits() {
    document.exitPointerLock?.();
    const d = await campaign.loadCredits(campaign.dialogue);
    if (d) await campaign.playCredits(campaign.dialogue, d);
  },
  setVolume: (h, v) => campaign.dialogue.setVolume(h, v),
};
// legenda das falas da campanha (texto vindo da instalação: entra como texto, nunca como HTML)
let subTimer = 0;
function campaignSubtitle(who, text, secs) {
  const subs = $('subs');
  if (!text) {
    // fala interrompida: a legenda some junto
    clearTimeout(subTimer);
    subs.classList.remove('show');
    return;
  }
  const w = document.createElement('span');
  w.className = 'who';
  w.textContent = who;
  subs.replaceChildren(w, document.createTextNode(text));
  subs.classList.add('show');
  clearTimeout(subTimer);
  subTimer = setTimeout(() => subs.classList.remove('show'), secs * 1000);
}

const spawnOffset = () => (mp() ? [0, 1.3, -1.3, 2.6][net.slot % 4] : 0);

function loadLevel(i, silent = false) {
  // campanha original ainda não lida da cópia do jogador: lê antes (senão o mapa sai vazio)
  if (LEVELS[i].preload && !LEVELS[i].bsp()) {
    startLevel(i);
    return;
  }
  resetField();
  clearLevel();
  levelIdx = i;
  level = LEVELS[i];
  data = level.build(world);
  fight =
    data.fight?.({
      world,
      portals,
      player: { pos: player.pos, eye: (out) => out.copy(camera.position) },
      spawnCube: makeCube,
      hurt(amount) {
        health -= amount;
        hurtT = 0;
        hurtFlash = 1;
        if (health <= 0) die();
      },
      say: (lines) => playLines(lines),
      sfx,
    }) ?? null;
  gravityFn = data.gravityAt ?? DEFAULT_GRAVITY;
  const [x, y, z, yaw] = data.spawn;
  player.spawn(x + spawnOffset(), y, z, yaw);
  physics.setPlayer(player.half);
  for (const [cx, cy, cz, opts] of data.cubes ?? []) makeCube(cx, cy, cz, opts);
  // campanha original: as entidades do mapa (botões, portas, elevadores…) ganham vida
  if (data.campaign) {
    data.campaign.runtime = new campaign.CampaignRuntime(level.bsp(), data.campaign, campaignCtx);
    data.campaign.runtime.start();
  }
  for (const b of [...(data.booths ?? []), ...(data.npcs ?? [])]) {
    const p = PEOPLE[b.who];
    const w = makeWorker(p.look, p.pose);
    w.group.position.set(b.x, b.y, b.z);
    w.group.rotation.y = b.rotY;
    if (b.flipped) w.group.rotation.z = Math.PI;
    dyn.add(w.group);
    npcs[b.who] = w;
    npcList.push(w);
  }
  // cada cabine de observação tem um raptor-mascote de capacete (o Pipoca)
  for (const b of data.booths ?? []) {
    // em cima da bancada, de lado, ao lado do personagem
    const d = makeDino('raptor', { helmet: 0xf2c200, scale: 0.55 });
    const [lx, lz] = [-Math.cos(b.rotY), Math.sin(b.rotY)];
    d.group.position.set(b.x - 1.8 * lx + 0.95 * Math.sin(b.rotY), b.y + 0.95, b.z - 1.8 * lz + 0.95 * Math.cos(b.rotY));
    d.group.rotation.y = Math.atan2(lx, lz);
    dyn.add(d.group);
    dinoList.push({ d, look: true });
  }
  for (const o of data.dinos ?? []) {
    const d = makeDino(o.s, { helmet: o.helmet, scale: o.scale });
    d.P.pose = o.pose ?? (o.s === 'ptero' ? 'fly' : o.orbit ? 'walk' : 'idle');
    if (!o.orbit) {
      d.group.position.set(o.x, o.y, o.z);
      d.group.rotation.set(0, o.rotY ?? 0, o.flipped ? Math.PI : 0);
    }
    dyn.add(d.group);
    const e = { d, orbit: o.orbit, look: !o.orbit && !o.flipped };
    dinoList.push(e);
    if (o.rex) rex = e;
  }
  for (const f of data.fossils ?? []) {
    const m = makeFossil(f.len ?? 5, 0xd8ccb0);
    m.position.set(f.x, f.y, f.z);
    m.rotation.set(f.rotX ?? 0, f.rotY ?? 0, f.rotZ ?? 0);
    dyn.add(m);
  }
  for (const [tx, ty, tz, tyaw, topts] of data.turrets ?? []) turrets.push(new Turret(dyn, physics, portals, tx, ty, tz, tyaw, topts));
  gunMode = data.gun ?? 'both';
  for (const f of data.portals ?? []) portals.placeFixed(f.which, f.c, f.n, f.u);
  relogio = data.relogio
    ? new Chronos({
        world,
        energy,
        player,
        portals,
        scene,
        cubes: () => cubes,
        turrets: () => turrets,
        held: () => held,
        gravityAt,
        beams: frontier,
        makeGhost: makeCloneGhost,
        t: () => clock.elapsedTime,
        dtReal: () => realDt,
        fx: chronosFx,
        // campos de dilatação criados depois de um ponto de controle somem se o loop for desfeito
        checkpointExtra: () => ({ fields: FIELD.events.length }),
        // simulações do relógio (bola/cubo mandados ao passado): passo de tempo num campo ativo no instante T
        timeScaleAt: (p, T) => (FIELD.events.some((ev) => T >= ev.t0 - 1e-6 && T < ev.t0 + ev.life && p.distanceTo(ev.center) < FIELD.R) ? 1 / FIELD.rate : 1),
        onRollback: (x) => {
          if (x) FIELD.events.length = Math.min(FIELD.events.length, x.fields);
        },
      })
    : null;
  portals.pastView = relogio ? { begin: (d) => relogio.beginPast(d), end: () => relogio.endPast() } : null;
  portals.futureView = relogio ? { begin: (v) => relogio.beginFuture(v), end: () => relogio.endFuture() } : null;
  portals.onTemporal = relogio ? (prop, P) => relogio.sendToPast(prop, P) : null;
  document.body.dataset.relogio = 'play';
  $('clock').hidden = !relogio;
  $('keys').textContent = relogio
    ? 'Esquerdo/Q: portal ciano · Direito: portal vermelho (parado: no passado) · 2: parar/continuar o tempo · Rodinha parado: voltar mais/menos · Meio: tempo lento · E: pegar/soltar · Espaço: pular · R: reiniciar · Esc: pausa'
    : KEYS_TEXT;
  cycle = data.cycle ? { ...data.cycle, i: 0, t: data.cycle.every } : null;
  if (cycle) portals.placeFixed(cycle.which, ...cycleSpot(0));
  inFizzler = false;
  lastPlayerPos.copy(player.pos);
  toggleSlowmo(false);
  SLOW.left = SLOW.max;
  for (const [cx, cy, cz] of data.crystals ?? []) {
    const m = crystalMesh();
    m.position.set(cx, cy, cz);
    dyn.add(m);
    crystals.push({ m, pos: new THREE.Vector3(cx, cy + 0.4, cz), taken: false });
  }
  $('gems').hidden = !crystals.length;
  $('health').hidden = !(turrets.length || world.lasers.length);
  $('era').hidden = !data.timeTravel;
  updateEraHud();
  updateGems();
  levelTime = 0;
  completed = false;
  REC.samples = [];
  REC.acc = 0;
  inTube = false;
  // campanha original: só os sons do próprio mapa (sem a trilha deste jogo)
  if (level.series === 'campaign') sound.stopMood();
  else sound.setMood(level.music);
  if (!editing) portals.prewarm(); // compila tudo agora (inclusive a vista pelos portais), não na hora do primeiro portal
  $('lvl-num').textContent = levelLabel(level);
  $('lvl-name').textContent = level.name;
  $('lvl-goal').textContent = level.lesson;
  $('tube-hud').hidden = true;
  $('heat').hidden = !level.heat;
  updateCrosshair();
  if (silent) return;
  playLines(data.intro ?? [], 1200);
  if (level.series === 'mine') return;
  progress.last = i;
  saveProgress();
}

// ------------------------------------------------------------------ diálogos (legendas + voz)
let dialogRun = 0;
const queue = [];
let speakingLoop = false;
function playLines(lines, delay = 0) {
  queue.push(...lines.map((l) => ({ l, delay })));
  if (!speakingLoop) runQueue(dialogRun);
}
async function runQueue(run) {
  speakingLoop = true;
  while (queue.length && run === dialogRun) {
    const { l, delay } = queue.shift();
    if (delay) await sleep(delay);
    if (run !== dialogRun) break;
    const [who, text] = l;
    const subs = $('subs');
    subs.innerHTML = `<span class="who">${who}</span>${text}`;
    subs.classList.add('show');
    const npc = npcs[SPEAKER_NPC[who]];
    if (npc) npc.P.talking = true;
    const t0 = performance.now();
    const ok = await narrator.speak(spoken(text), who, text);
    const min = ok ? 900 : Math.max(2600, text.length * 65);
    const left = min - (performance.now() - t0);
    if (left > 0) await sleep(left);
    if (npc) npc.P.talking = false;
    subs.classList.remove('show');
    await sleep(300);
  }
  if (run !== dialogRun) queue.length = 0;
  speakingLoop = false;
  if (queue.length) runQueue(dialogRun);
}

// ------------------------------------------------------------------ ações
function camForward() {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
}

function shoot(which) {
  if (!running || paused || completed) return;
  const blue = which === 'blue';
  if (gunMode === 'none') return;
  if (gunMode === 'blue' && !blue) return sfx.denied();
  recoil = 1;
  GUN.pulse = 0;
  GUN.heat = Math.min(1, GUN.heat + 0.3);
  gun.userData.base.copy(SLOT_COLORS[mp() ? net.slot % 4 : 0][blue ? 0 : 1]).multiplyScalar(3);
  gun.userData.light.color.copy(SLOT_COLORS[mp() ? net.slot % 4 : 0][blue ? 0 : 1]);
  post.shockwave(); // distorção saindo da boca da arma
  sfx.shot(blue);
  const allowed = !data.portalsAllowed || data.portalsAllowed(player.pos);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camForward();
  // tiro na Lua (por uma claraboia): o portal abre lá em cima
  if (allowed && frontier.hitsMoon(origin, dir)) {
    const m = world.moonInfo;
    const P = portals.placeFixed(which, m.spot.c, m.spot.n, m.spot.u);
    if (P) {
      P.fixed = false;
      P.moon = true;
      sfx.open(blue);
      fireBolt(which, gun.userData.tip.getWorldPosition(new THREE.Vector3()), origin.clone().addScaledVector(dir, 60), null);
      toast('Portal aberto na Lua! Cuidado com o vácuo...');
      physics.wakeAll();
      updateCrosshair();
      return;
    }
  }
  // o projétil voa até onde o tiro bate (parede ou grade de desintegração); o
  // portal é decidido e aberto quando ele chega
  // vermelho na pausa: o tiro vê as paredes (portas) do passado escolhido
  const wall = !blue && relogio?.paused ? relogio.inPast(relogio.delta, () => world.raycast(origin, dir, 400)) : world.raycast(origin, dir, 400);
  const fz = world.rayFizzler(origin, dir, wall ? wall.dist : 400);
  const end = fz ? fz.clone() : wall ? wall.point.clone() : origin.clone().addScaledVector(dir, 60);
  const tipW = gun.userData.tip.getWorldPosition(new THREE.Vector3());
  const lvl = levelIdx;
  fireBolt(which, tipW, end, () => {
    if (levelIdx === lvl && running && !completed) landShot(which, origin, dir, allowed);
  });
}

/** o projétil chegou: abre o portal (ou faísca, se a superfície não aceita) */
function landShot(which, origin, dir, allowed) {
  const blue = which === 'blue';
  const wall = world.raycast(origin, dir, 400);
  const fz = world.rayFizzler(origin, dir, wall ? wall.dist : 400);
  const temporal = !blue && relogio?.paused && relogio.maxDelta() >= 0.5;
  if (!blue && relogio?.paused && !temporal) toast('Ainda não há passado para mirar: espere o tempo andar um pouco.');
  const res = !allowed
    ? { ok: false }
    : fz
      ? { ok: false, point: fz, normal: dir.clone().negate() }
      : temporal
        ? relogio.placeOrange(origin, dir, relogio.delta)
        : portals.tryPlace(which, origin, dir);
  if (res.ok && temporal) toast(`Portal aberto ${relogio.delta.toFixed(1).replace('.', ',')} s no passado: entre no ciano para voltar.`);
  if (res.why) toast(res.why);
  if (res.ok) {
    if (mp())
      net.send({ t: 'portal', which, lvl: levelIdx, c: res.point.toArray(), n: res.normal.toArray(), u: res.up.toArray(), b: res.boxIndex });
    sfx.open(blue);
    physics.wakeAll();
    updateCrosshair();
  } else {
    sfx.fail();
    if (res.point) burst(res.point, res.normal);
    if (!allowed) toast('Aqui dentro o campo do túnel não deixa abrir portal.');
  }
}

function burst(p, n) {
  const pos = sparkGeo.attributes.position;
  for (let i = 0; i < SPARKS; i++) {
    pos.setXYZ(i, p.x, p.y, p.z);
    sparkVel[i]
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .multiplyScalar(4)
      .addScaledVector(n ?? new THREE.Vector3(0, 1, 0), 3);
  }
  pos.needsUpdate = true;
  sparkT = 0;
}

function rayCube(origin, dir, maxD) {
  let best = null;
  for (const c of [...cubes, ...turrets]) {
    if (c.gone) continue;
    const min = c.pos.clone().sub(c.half);
    const max = c.pos.clone().add(c.half);
    let t0 = 0;
    let t1 = maxD;
    let ok = true;
    for (const a of ['x', 'y', 'z']) {
      if (Math.abs(dir[a]) < 1e-9) {
        if (origin[a] < min[a] || origin[a] > max[a]) ok = false;
        continue;
      }
      let ta = (min[a] - origin[a]) / dir[a];
      let tb = (max[a] - origin[a]) / dir[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (ok && t0 <= t1 && (!best || t0 < best.t)) best = { c, t: t0 };
  }
  return best;
}

function use() {
  if (!running || paused) return;
  if (held) {
    release(); // E só solta; o botão esquerdo é que arremessa
    return;
  }
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camForward();
  // campanha original: botões de apertar (func_button) vêm antes de pegar objetos
  if (data?.campaign?.runtime?.use(origin, dir)) return;
  const hit = rayCube(origin, dir, 2.8);
  // por trás de uma torreta ativa: E desliga (e ela tomba)
  const ti = turrets.findIndex((t) => t.canDisableFrom(player.pos) && (!hit || hit.c === t));
  if (ti >= 0) {
    turretDown(ti, true);
    return;
  }
  if (!hit) return;
  if (hit.c.frozen) {
    if (!hit.c.grabUnlock) return; // núcleo ainda preso na máquina
    data.campaign.runtime.unfreeze(hit.c);
  }
  if (hit.c.remote?.held && performance.now() - hit.c.remote.t < 500) return toast('Outra pessoa está segurando essa amostra.');
  const wall = world.raycast(origin, dir, hit.t);
  if (wall) return;
  held = hit.c;
  held.held = true;
  data?.campaign?.runtime?.onPickup(held);
  held.farTime = 0;
  held.space.identity(); // segurado do mesmo lado do jogador
  // segura mantendo o giro relativo ao olhar (cubo no múltiplo de 90° mais perto;
  // torreta virada para a frente, como quem aponta)
  const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, player.yaw);
  // torreta e cubo refletor: virados para a frente (a lente do cubo aponta para onde você olha)
  if (held.kind === 'turret' || held.redirect) held.holdBase = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
  else {
    const rel = yawQ.clone().invert().multiply(held.quat);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(rel);
    held.holdBase = new THREE.Quaternion().setFromAxisAngle(UP, Math.round(Math.atan2(f.x, f.z) / (Math.PI / 2)) * (Math.PI / 2));
  }
  sfx.pick();
}

/** solta o objeto segurado; `toss`: arremessa na direção da mira */
function release(toss = false) {
  if (!held) return;
  const c = held;
  held.held = false;
  held.holdLocal = null;
  held = null;
  if (toss) {
    // a mira e a velocidade do jogador levadas para o lado em que o objeto está
    const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(c.space));
    const v = player.vel.clone().multiplyScalar(0.8).addScaledVector(camForward(), 7).applyQuaternion(rot);
    c.throw(v);
    sfx.toss();
  } else sfx.drop();
}

/**
 * Até onde o objeto segurado vai à frente da mira (no máximo 1,7 m). O raio
 * atravessa portais: se a mira passa por um, a distância continua do outro
 * lado — o ponto pode ficar "atrás" da parede do portal, e o objeto passa por ele.
 */
function holdDistance(eye, fwd) {
  const MAX = 1.7;
  const o = eye.clone();
  const d = fwd.clone();
  let dist = 0;
  for (let k = 0; k < 3; k++) {
    const rest = MAX - dist;
    const wall = world.raycast(o, d, rest);
    const end = o.clone().addScaledVector(d, wall ? wall.dist + 0.01 : rest);
    // ciano temporal: o objeto entra na parede junto com você (vai no salto), sem parar antes
    if (portals.temporalCrossing?.(o, end)) return MAX;
    const P = portals.crossing(o, end);
    if (!P) return wall ? Math.max(dist + wall.dist - 0.45, 0.5) : MAX;
    const tc = P.center.clone().sub(o).dot(P.normal) / d.dot(P.normal);
    dist += tc;
    const M = portals.transform(P, P.partner);
    o.addScaledVector(d, tc + 0.01).applyMatrix4(M);
    d.transformDirection(M);
  }
  return MAX;
}

function turretDown(idx, byMe, pos = null) {
  const t = turrets[idx];
  if (!t) return;
  if (!t.disable(byMe ? 'desligada' : 'rede', byMe ? 55 : 0)) return;
  sfx.click(true);
  if (byMe && mp()) net.send({ t: 'turret', idx, p: t.pos.toArray(), lvl: levelIdx });
  if (byMe) toast('Torreta desligada.');
}

function takeGem(idx, who) {
  const g = crystals[idx];
  if (!g || g.taken) return;
  g.taken = true;
  g.m.visible = false;
  gemOwners.set(who, (gemOwners.get(who) ?? 0) + 1);
  updateGems();
  if (crystals.every((c) => c.taken)) {
    sfx.win();
    const ranking = [...gemOwners].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}: ${c}`).join(' · ');
    playLines([['Helena', 'Todos os doze cristais! A mina foi explorada de ponta a ponta.']]);
    setTimeout(() => {
      completed = true;
      document.exitPointerLock?.();
      $('done-title').textContent = 'Mina explorada!';
      $('done-time').textContent = `Tempo: ${fmt(levelTime)}${ranking ? ` · ${ranking}` : ''}`;
      $('next').hidden = true;
      $('done').hidden = false;
    }, 2500);
  }
}

function updateGems() {
  const n = crystals.filter((c) => c.taken).length;
  $('gems-v').textContent = `${n}/${crystals.length}`;
}

let deaths = 0;
function die() {
  deaths++;
  resetField();
  relogio?.clear();
  health = 100;
  sfx.death();
  deadFlash = 1;
  release();
  const [x, y, z, yaw] = data.spawn;
  player.spawn(x + spawnOffset(), y, z, yaw);
  if (level.series !== 'campaign') playLines([[level.who, ['Opa. Volta pro começo e tenta de novo.', 'Essa doeu. De novo!', 'Calma, sô. Mais uma vez.'][Math.floor(Math.random() * 3)]]]);
}

function complete(final) {
  if (completed) return;
  completed = true;
  sfx.win();
  const t = levelTime;
  const prev = progress.best[level.id];
  if (!prev || t < prev) progress.best[level.id] = t;
  if (level.series === 'mine') {
    // níveis do jogador não mexem no progresso
  } else if (level.series) progress[level.series] = Math.max(progress[level.series], level.n + 2);
  else progress.unlocked = Math.max(progress.unlocked, Math.min(level.id + 1, LEVELS.length));
  saveProgress();
  document.exitPointerLock?.();
  if (testingMine && REC.samples.length > 10) {
    editor?.saveProof({ dt: 1 / 30, samples: REC.samples.slice(), time: t });
    toast('Prova gravada: o seu caminho até a saída ficou no editor (aba Robô).');
  }
  $('next').hidden = level.series === 'mine' || !LEVELS[levelIdx + 1] || LEVELS[levelIdx + 1].series !== level.series || !!LEVELS[levelIdx + 1].free;
  if (final) {
    showFinal(t);
    return;
  }
  const ending = level.series === 'campaign' ? (level.name.startsWith('Câmaras') ? 'as' : 'a') : level.code ? 'o' : 'a';
  $('done-title').textContent = `${levelLabel(level)} concluíd${ending}`;
  $('done-time').textContent = `Tempo: ${fmt(t)}${prev && prev <= t ? ` · recorde ${fmt(prev)}` : ' · novo recorde!'}`;
  $('done').hidden = false;
  $('done-editor').hidden = !testingMine;
}

function showFinal(t = levelTime) {
  completed = true;
  document.exitPointerLock?.();
  progress.unlocked = LEVELS.length;
  saveProgress();
  $('final').hidden = false;
  $('final-time').textContent = fmt(t);
  playLines([
    ['Dona Cida', 'Chegou, meu filho? Eu falei que lá do outro lado era mar.'],
    ['Helena', 'Num túnel de verdade, de um lado ao outro da Terra, essa viagem levaria quarenta e dois minutos.'],
    ['Helena', 'Mas agora você sabe por quê. Obrigada por cavar com a gente.'],
  ]);
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let toastT = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 2600);
}

// a mira indica se a superfície em que você mira aceita portal (verificação ~10×/s)
let aimClock = 0;
function updateAim(dt) {
  aimClock -= dt;
  if (aimClock > 0) return;
  aimClock = 0.1;
  const xh = $('xh');
  if (gunMode === 'none' || held || !data) {
    xh.classList.remove('aim-ok', 'aim-no');
    return;
  }
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camForward();
  const allowed = !data.portalsAllowed || data.portalsAllowed(player.pos);
  const wall = world.raycast(origin, dir, 400);
  const fz = wall ? world.rayFizzler(origin, dir, wall.dist) : null;
  // a cor que dá para atirar (na campanha, uma delas pode estar presa pela fase)
  const which = !portals.blue.fixed ? 'blue' : gunMode === 'both' && !portals.orange.fixed ? 'orange' : null;
  const ok = !!(allowed && wall && !fz && which && portals.tryPlace(which, origin, dir, true).ok);
  xh.classList.toggle('aim-ok', ok);
  xh.classList.toggle('aim-no', !ok);
}

function updateCrosshair() {
  $('xh').classList.toggle('blue', portals.blue.placed);
  $('xh').classList.toggle('orange', portals.orange.placed);
  $('xh').classList.toggle('no-gun', gunMode === 'none');
  $('xh').classList.toggle('blue-only', gunMode === 'blue');
}

// ------------------------------------------------------------------ entrada
const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
window.addEventListener('keydown', (e) => {
  if (e.code === 'F5' && testingMine) {
    e.preventDefault();
    backToEditor();
    return;
  }
  if (KEYS[e.code]) input[KEYS[e.code]] = true;
  if (!running || paused) return;
  if (e.code === 'Space') {
    input.jump = true;
    e.preventDefault();
  }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') {
    input.crouch = true;
    e.preventDefault();
  }
  if (e.ctrlKey) e.preventDefault(); // agachado: sem atalhos do navegador (Ctrl+S, Ctrl+D…)
  if (e.code === 'KeyE') use();
  if (e.code === 'KeyR') loadLevel(levelIdx);
  if (e.code === 'KeyQ') held ? release(true) : shoot('blue');
  if (e.code === 'KeyT' && !e.repeat) timeTravel();
  if (e.code === 'Digit2' && !e.repeat && relogio) relogio.pause();
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) input[KEYS[e.code]] = false;
  if (e.code === 'Space') input.jump = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') input.crouch = false;
});
// Ctrl+W (agachar andando para a frente) fecharia a aba: durante o jogo, o navegador pergunta antes
window.addEventListener('beforeunload', (e) => {
  if (running && !paused && document.pointerLockElement) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('mousemove', (e) => {
  // com zoom, a mira fica mais fina (proporcional ao campo de visão)
  const s = camera.fov / 75;
  if (document.pointerLockElement === canvas && running && !paused && !viewOverride) {
    player.look(e.movementX * s, e.movementY * s);
    GUN.look.x += e.movementX;
    GUN.look.y += e.movementY;
  }
});
canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) {
    if (running && !completed) lock();
    return;
  }
  if (e.button === 0 || e.button === 2) {
    mouseHeld[e.button] = true;
    // segurando um objeto: o botão esquerdo arremessa (e não sai portal)
    if (e.button === 0 && held) return release(true);
    // os dois botões juntos: carga do campo de dilatação (o portal que esperava não sai)
    if (mouseHeld[0] && mouseHeld[2]) {
      pendingShot = null;
      return;
    }
    if (e.button === 2 && held) return;
    // o portal sai num instante (ou ao soltar): dá tempo de o outro botão chegar junto
    pendingShot = { which: e.button === 0 ? 'blue' : 'orange', at: performance.now() };
  }
  if (e.button === 1) {
    e.preventDefault();
    toggleSlowmo();
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  mouseHeld[e.button] = false;
  if (pendingShot && pendingShot.which === (e.button === 0 ? 'blue' : 'orange')) firePending();
});
window.addEventListener('blur', () => (mouseHeld[0] = mouseHeld[2] = false));
// zoom pela rodinha: para cima liga e aproxima; para baixo afasta e, no mínimo, desliga.
// A rolagem é somada até um "degrau" (o trackpad manda dezenas de eventos pequenos)
let wheelSum = 0;
window.addEventListener(
  'wheel',
  (e) => {
    if (!running || paused) return;
    e.preventDefault();
    if (relogio?.paused) {
      // na pausa a roda escolhe quantos segundos voltar (para cima: mais longe no passado)
      // contínuo: ~0,5 s a cada "degrau" de roda (40 px); o trackpad anda fino
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      relogio.scrubBy((-px / 40) * 0.5);
      return;
    }
    wheelSum += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    while (Math.abs(wheelSum) >= 60) {
      const zoomIn = wheelSum < 0;
      wheelSum -= Math.sign(wheelSum) * 60;
      if (zoomIn) {
        if (!ZOOM.on) {
          ZOOM.on = true;
          ZOOM.level = Math.max(ZOOM.level, 2);
        } else ZOOM.level = clamp(ZOOM.level * 1.25, 1.5, 8);
      } else if (ZOOM.on) {
        if (ZOOM.level <= 1.6) ZOOM.on = false;
        else ZOOM.level = clamp(ZOOM.level / 1.25, 1.5, 8);
      }
    }
  },
  { passive: false },
);
// botão do meio não abre a rolagem automática do navegador
window.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());

// ------------------------------------------------------------------ tempo lento (bullet time)
// Botão do meio liga/desliga. Gasta a reserva (segundos de verdade) enquanto
// está ligado; desligado, ela recarrega no mesmo ritmo (6 s gastos voltam em 6 s).
const SLOW = { max: 6, left: 6, on: false, k: 1, beat: 0, warn: 0, scale: 0.28 };
// ------------------------------------------------------------------ viagem no tempo
function updateEraHud() {
  const past = world.era === 'past';
  $('era-v').textContent = past ? data?.eraNames?.[0] ?? 'PASSADO' : data?.eraNames?.[1] ?? 'FUTURO';
  $('era').classList.toggle('future', !past);
}

function timeTravel() {
  if (!running || paused || completed || !data?.timeTravel) return;
  if (!frontier.toggleEra(player)) {
    sfx.denied();
    toast('Não dá: na outra época você ficaria dentro de uma parede.');
    return;
  }
  sfx.timeShift(world.era === 'past');
  post.warp = 1;
  // portais em paredes que não existem nesta época se apagam
  for (const P of [portals.blue, portals.orange]) if (P.placed && P.box && !world.live(P.box)) P.remove();
  // objetos que ficariam dentro de algo voltam ao ponto de partida
  for (const c of [...cubes, ...turrets]) {
    if (c.gone || c === held) continue;
    if (world.pointInSolid(c.pos)) {
      dissolver.add(c.mesh, new THREE.Color(0.4, 1.0, 0.8));
      if (c.kind === 'cube') c.respawn();
      else c.vanish();
    }
  }
  physics.wakeAll();
  updateCrosshair();
  updateEraHud();
}

function toggleSlowmo(force) {
  const want = force ?? !SLOW.on;
  if (want === SLOW.on) return;
  if (want) {
    if (!running || paused || completed) return;
    if (mp()) return toast('O tempo lento só funciona no modo solo.');
    if (SLOW.left < 0.6) {
      sfx.denied();
      return toast('Reserva de tempo lento vazia — espere recarregar.');
    }
  }
  SLOW.on = want;
  SLOW.beat = 0;
  if (want) sfx.slowIn();
  else sfx.slowOut();
  sound.setSlowmo(want);
  document.body.classList.toggle('slowmo', want);
  const ring = $('slow-ring');
  ring.classList.remove('pulse');
  void ring.offsetWidth;
  ring.classList.add('pulse');
}

// ------------------------------------------------------------------ campo de dilatação temporal
// Os dois botões do mouse seguros por 5 s criam um campo PARADO onde você está. Dentro dele o
// tempo passa 10× mais devagar, como perto de um horizonte de eventos: 2 s de quem está dentro
// são 20 s lá fora. Você (e o que estiver dentro: cubos, bolas de energia) anda no seu ritmo
// enquanto o mundo corre. Não é para usar toda hora: a carga é longa de propósito.
const FIELD = { need: 5, rate: 10, R: 3.2, life: 20, charge: 0, on: false, left: 0, center: new THREE.Vector3(), armed: true, shake: 0, events: [], ev: null, lastTw: 0 };
const CHORD_MS = 90;
const mouseHeld = { 0: false, 2: false };
let pendingShot = null; // portal esperando um instante para ver se o outro botão vem junto
let pScale = 1; // passo do jogador em relação ao do mundo (1/5 dentro do campo)
function firePending() {
  const ps = pendingShot;
  pendingShot = null;
  if (ps && running && !paused && !completed) shoot(ps.which);
}
const inField = (p) => FIELD.on && p.distanceTo(FIELD.center) < FIELD.R;
/** a arma brilha como no tempo lento: cresce com a carga e fica cheia dentro do campo */
const fieldGlow = () => (inField(player.pos) ? 1 : FIELD.charge / FIELD.need);
/** desfaz o campo (fim natural ou troca de fase/morte/viagem no tempo: `instant` sem devolver velocidades) */
function endField(instant = false) {
  if (!FIELD.on) return;
  FIELD.on = false;
  for (const c of [...cubes, ...turrets]) {
    if (c.dilated && !instant) {
      const v = c.body.linvel();
      c.body.setLinvel({ x: v.x * FIELD.rate, y: v.y * FIELD.rate, z: v.z * FIELD.rate }, true);
    }
    if (c.dilated) c.body.wakeUp();
    c.dilated = false;
  }
  if (!instant) sfx.slowOut();
}
/** tudo do campo some (morte, troca de fase): inclusive o que estava gravado na linha do tempo */
function resetField() {
  endField(true);
  FIELD.events = [];
  FIELD.ev = null;
  FIELD.lastTw = 0;
  FIELD.charge = 0;
}
/**
 * Com o relógio, o campo é parte da linha do tempo: existe enquanto o tempo do mundo estiver
 * dentro de uma criação gravada. Voltando no tempo, ele reaparece na hora e no lugar em que a
 * sua versão do passado o criou. Num pulo no tempo as velocidades vêm do retrato do relógio:
 * só as marcas de "dentro do campo" são refeitas.
 */
function syncFieldTimeline(dt) {
  if (!relogio) return;
  const tw = relogio.tw;
  const jumped = tw < FIELD.lastTw - 1e-6 || tw - FIELD.lastTw > dt + 0.05;
  FIELD.lastTw = tw;
  let e = null;
  for (const ev of FIELD.events) if (tw >= ev.t0 - 1e-6 && tw < ev.t0 + ev.life) e = ev;
  if (e) {
    if (!FIELD.on && !jumped) {
      // a versão do passado criando o campo agora (o trovão mais fraco quanto mais longe)
      sfx.thunder(Math.max(0.35, 1 - player.pos.distanceTo(e.center) / 20));
      if (player.pos.distanceTo(e.center) < 12) FIELD.shake = 0.7 * Math.max(0.3, 1 - player.pos.distanceTo(e.center) / 12);
    }
    FIELD.on = true;
    FIELD.ev = e;
    FIELD.center.copy(e.center);
    FIELD.left = e.t0 + e.life - tw;
  } else if (FIELD.on) endField(jumped);
  if (jumped) for (const c of [...cubes, ...turrets]) c.dilated = inField(c.pos) && !c.held && !c.gone;
}
/** carga (tempo real) e o efeito na tela; chamado uma vez por quadro */
function updateField(realDt, live) {
  if (pendingShot && performance.now() - pendingShot.at > CHORD_MS) firePending();
  const both = live && mouseHeld[0] && mouseHeld[2] && !held;
  if (!both) FIELD.armed = true; // precisa soltar antes de carregar de novo
  if (both && FIELD.armed && !FIELD.on) {
    FIELD.charge += realDt;
    if (FIELD.charge >= FIELD.need) {
      FIELD.charge = 0;
      FIELD.armed = false;
      FIELD.on = true;
      FIELD.left = FIELD.life;
      FIELD.center.copy(player.pos);
      // com o relógio, a criação entra na linha do tempo: voltando, a sua versão do passado a cria de novo
      if (relogio) {
        FIELD.ev = { t0: relogio.tw, center: player.pos.clone(), life: FIELD.life };
        FIELD.events.push(FIELD.ev);
        FIELD.lastTw = relogio.tw;
      }
      sfx.thunder();
      post.warp = 1;
      FIELD.shake = 0.7; // a visão treme quando a bolha nasce
    }
  } else FIELD.charge = Math.max(0, FIELD.charge - realDt * 3);
  FIELD.shake = Math.max(0, FIELD.shake - realDt);
  const k = FIELD.charge / FIELD.need;
  sfx.dilateCharge(live && k > 0 ? 0.3 + 0.7 * k : 0, k);
  sfx.blackHole(live && inField(player.pos) ? 0.8 : FIELD.on ? 0.25 : 0);
  post.dilate = Math.max(k * 0.6, inField(player.pos) ? 1 : 0);
  // a bolha é uma lente gravitacional (fx.js): nasce rápido e vai se esmaecendo nos últimos 60% da vida
  post.lens.field = FIELD.on ? { center: FIELD.center, R: FIELD.R, fade: Math.min(1, FIELD.left / (FIELD.life * 0.6), (FIELD.life - FIELD.left) * 2) } : null;
  document.body.classList.toggle('dilated', live && inField(player.pos));
  const g = $('field');
  g.hidden = !(k > 0 || FIELD.on);
  $('field-v').textContent = FIELD.on ? `${(FIELD.left / FIELD.rate).toFixed(1).replace('.', ',')} s` : `${Math.round(k * 100)}%`;
  $('field-fill').style.transform = `scaleX(${FIELD.on ? FIELD.left / FIELD.life : k})`;
  g.classList.toggle('on', FIELD.on);
}

/** um quadro de jogo: dentro do campo o mundo dá `rate` passos e o jogador anda 1/rate em cada */
function tick(realDt, dt, t) {
  updateField(realDt, true);
  if (!inField(player.pos)) return update(dt, t);
  pScale = 1 / FIELD.rate;
  for (let i = 0; i < FIELD.rate && inField(player.pos); i++) update(dt, t);
  pScale = 1;
}

function updateSlowmo(realDt) {
  if (SLOW.on) {
    SLOW.left -= realDt;
    SLOW.beat -= realDt;
    if (SLOW.beat <= 0) {
      SLOW.beat = 0.8;
      sfx.heartbeat();
    }
    if (SLOW.left < 1.5) {
      SLOW.warn -= realDt;
      if (SLOW.warn <= 0) {
        SLOW.warn = 0.25;
        sfx.lowTime();
      }
    }
    if (SLOW.left <= 0) {
      SLOW.left = 0;
      toggleSlowmo(false);
    }
  } else {
    SLOW.left = Math.min(SLOW.max, SLOW.left + realDt);
  }
  SLOW.k += ((SLOW.on ? SLOW.scale : 1) - SLOW.k) * Math.min(1, realDt * 7);
  const f = SLOW.left / SLOW.max;
  $('slow-fill').style.transform = `scaleX(${f})`;
  $('slow-v').textContent = `${SLOW.left.toFixed(1).replace('.', ',')} s`;
  $('slow').classList.toggle('on', SLOW.on);
  $('slow').classList.toggle('low', f < 0.25);
  document.body.classList.toggle('slow-low', f < 0.25);
  $('slow').classList.toggle('full', f >= 0.999 && !SLOW.on);
  $('slow-arc').style.strokeDashoffset = String(100 - f * 100);
}

function lock() {
  sound.init();
  if (DEBUG) {
    paused = false;
    document.body.classList.add('playing');
    return;
  }
  canvas.requestPointerLock?.();
}
const DEBUG = new URLSearchParams(location.search).has('debug'); // testes automatizados sem trava do mouse
document.addEventListener('pointerlockchange', () => {
  const locked = DEBUG || document.pointerLockElement === canvas;
  paused = !locked;
  $('pause').hidden = locked || !running || completed;
  if (!$('pause').hidden) fillMapSelect();
  if (level) $('pause-info').textContent = `${levelLabel(level)} · ${level.name} · ${fmt(levelTime)}`;
  $('back-editor').hidden = !testingMine;
  $('room-map-label').textContent = mp() ? 'Mapa da sala (muda para todos):' : 'Mapa:';
  document.body.classList.toggle('playing', locked);
  for (const k of Object.keys(input)) input[k] = false;
});
// o navegador recusou travar o mouse (ex.: o clique "expirou" enquanto a campanha
// original carregava o mapa): mostra a pausa, e o "Continuar" trava de novo
document.addEventListener('pointerlockerror', () => {
  if (!running || completed || DEBUG) return;
  paused = true;
  $('pause').hidden = false;
  fillMapSelect();
});

// ------------------------------------------------------------------ menus
function setAudio(music, voice) {
  sound.setMusic(music);
  narrator.enabled = voice && narrator.available;
  if (!narrator.enabled) narrator.cancel();
  $('opt-music').classList.toggle('on', music);
  $('opt-voice').classList.toggle('on', narrator.enabled);
  $('p-music').classList.toggle('on', music);
  $('p-voice').classList.toggle('on', narrator.enabled);
}

// ------------------------------------------------------------------ editor de níveis
let editing = false; // o editor está aberto (câmera livre, nada de jogador)
let testingMine = false; // jogando um nível a partir do editor (F5 volta)
let editor = null;
const EDIT_LEVEL0 = { id: 'editor', name: 'Editor', series: 'mine', n: 0, code: 'ED', who: 'Você', lesson: '', editor: true, build: () => ({ spawn: [0, 0, 0, 0] }) };
let editLevel = EDIT_LEVEL0;
LEVELS.push(editLevel); // a campanha entra no meio da lista depois: por isso o índice é sempre achado por objeto
const mineLevels = new Map(); // id do documento → fase compilada (a mesma que está em LEVELS)
const slotOf = (L) => LEVELS.indexOf(L);

/** põe/atualiza o nível guardado na lista de fases do jogo e devolve o objeto */
function mineLevel(doc, k) {
  const L = compileMine(doc, k);
  const old = mineLevels.get(doc.id);
  if (old && slotOf(old) >= 0) LEVELS[slotOf(old)] = L;
  else LEVELS.push(L);
  mineLevels.set(doc.id, L);
  return L;
}

function getEditor() {
  editor ??= createEditor({
    scene,
    camera,
    canvas,
    world,
    portals,
    toast,
    gravityAt,
    makeGhost: makeCloneGhost,
    // reconstrói o mundo com o documento atual (sem som, sem texto, sem compilar sombreadores à toa)
    rebuild(L) {
      const i = slotOf(editLevel);
      editLevel = Object.assign(L, { editor: true });
      LEVELS[i] = editLevel;
      loadLevel(i, true);
    },
    // joga o nível: é a mesma fase, só que valendo
    test(L) {
      const i = slotOf(editLevel);
      editLevel = Object.assign(L, { editor: true });
      LEVELS[i] = editLevel;
      editing = false;
      testingMine = true;
      $('menu').hidden = true;
      $('done').hidden = true;
      running = true;
      completed = false;
      loadLevel(i);
      lock();
    },
    leave() {
      editing = false;
      running = false;
      testingMine = false;
      level = null; // o fundo do menu recarrega a primeira câmara
      $('menu').hidden = false;
      renderMenu();
    },
  });
  return editor;
}

function openEditor(docId) {
  sound.init();
  $('menu').hidden = true;
  $('pause').hidden = true;
  $('done').hidden = true;
  document.exitPointerLock?.();
  running = false;
  completed = false;
  paused = true;
  editing = true;
  testingMine = false;
  getEditor().open(docId);
}

function backToEditor() {
  if (!testingMine || !editor?.doc) return;
  document.exitPointerLock?.();
  $('pause').hidden = true;
  $('done').hidden = true;
  running = false;
  completed = false;
  paused = true;
  editing = true;
  toggleSlowmo(false);
  editor.resume();
}
$('back-editor').addEventListener('click', backToEditor);
$('done-editor').addEventListener('click', backToEditor);
$('open-editor').addEventListener('click', () => openEditor(null));

/** grupo "Meus níveis" do menu: seus níveis (jogar/editar), novo e importar */
function renderMine(grid) {
  const h = document.createElement('div');
  h.className = 'lvl-head';
  h.innerHTML = '<b>Meus níveis</b><span>feitos por você no editor — ficam neste navegador; exporte para compartilhar</span>';
  grid.appendChild(h);
  const tools = document.createElement('div');
  tools.className = 'lvl-tools';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', fn);
    tools.appendChild(b);
  };
  mk('＋ Novo nível', () => openEditor(null));
  mk('⇪ Importar .json', async () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      try {
        const doc = await mineStore.importFile(inp.files[0]);
        mineStore.save(doc);
        toast(`“${doc.name}” importado.`);
        renderMenu();
      } catch (err) {
        toast(`Não deu para importar: ${err.message}`);
      }
    });
    inp.click();
  });
  grid.appendChild(tools);
  mineStore.list().forEach((doc, k) => {
    const L = mineLevel(doc, k);
    const b = document.createElement('button');
    b.className = 'lvl mine';
    b.innerHTML = `<span class="n">${L.code}</span><b>${doc.name.replace(/</g, '&lt;')}</b><small>${doc.items.length} itens</small>${progress.best[L.id] ? `<em>${fmt(progress.best[L.id])}</em>` : ''}`;
    b.addEventListener('click', () => startLevel(slotOf(L)));
    const e = document.createElement('span');
    e.className = 'edit';
    e.textContent = '✎ editar';
    e.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEditor(doc.id);
    });
    b.appendChild(e);
    grid.appendChild(b);
  });
}

function renderMenu() {
  const grid = $('levels');
  grid.innerHTML = '';
  const groups = [
    ['Laboratório Antípoda', 'as seis câmaras do documentário', (L) => !L.free && !L.series],
    ['Bateria clássica', 'os testes clássicos do gênero, refeitos aqui embaixo', (L) => L.series === 'classic'],
    ['Desafios hardcore', 'salas enormes, plataformas diagonais, pistões — use o tempo lento', (L) => L.series === 'hard'],
    ['Série Momento', 'arremessos encadeados: abra os portais nos painéis diagonais em pleno voo', (L) => L.series === 'momentum'],
    ['Série Fronteira', 'mapas enormes com tudo junto: lasers, funis, placas de lançamento, viagem no tempo, antigravidade, buracos negros e a Lua', (L) => L.series === 'frontier'],
    ['Série Chefes', 'um inimigo gigante por fase: devolva os foguetes dele pelos portais, queime os núcleos que caem e abra a saída', (L) => L.series === 'boss'],
    ['Série Experimento', 'o relógio do tempo: 1 volta, 2 para, 3 anda — e o seu passado vira um clone que ajuda você', (L) => L.series === 'experiment'],
    ['Campanha original', 'precisa da sua cópia do Portal (Valve): escolha o pacote gerado com "npm run pacote" ou a pasta do jogo — tudo é lido só no seu navegador', (L) => L.series === 'campaign'],
    ['Exploração', '', (L) => L.free],
  ];
  for (const [title, sub, pick] of groups) {
    if (!LEVELS.some(pick)) continue;
    const h = document.createElement('div');
    h.className = 'lvl-head';
    h.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    grid.appendChild(h);
    LEVELS.forEach((L, i) => {
      if (!pick(L)) return;
      const locked = !L.free && !mp() && (L.series ? L.n + 1 > progress[L.series] : L.id > progress.unlocked);
      const b = document.createElement('button');
      b.className = `lvl${locked ? ' locked' : ''}`;
      b.innerHTML = `<span class="n">${L.free ? 'MAPA LIVRE' : L.code ?? String(L.id).padStart(2, '0')}</span><b>${L.name}</b><small>${L.who}</small>${
        progress.best[L.id] ? `<em>${fmt(progress.best[L.id])}</em>` : ''
      }`;
      b.disabled = locked;
      b.addEventListener('click', () => startLevel(i));
      grid.appendChild(b);
    });
  }
  renderMine(grid);
}

async function startLevel(i) {
  if (LEVELS[i].series === 'mine' && mp()) return toast('Os seus níveis são só para o modo solo.');
  if (!LEVELS[i].editor) testingMine = false;
  if (LEVELS[i].preload) {
    // campanha original: o mapa vem da instalação do jogador
    if (mp()) return toast('A campanha original é só no modo solo.');
    toast('Carregando o mapa…');
    try {
      await LEVELS[i].preload();
      $('toast').classList.remove('show');
    } catch (err) {
      console.error(err);
      toast(err.message);
      return;
    }
  }
  sound.init();
  setAudio($('opt-music').classList.contains('on'), $('opt-voice').classList.contains('on'));
  if (mp()) {
    $('menu').hidden = true;
    $('done').hidden = true;
    $('final').hidden = true;
    $('pause').hidden = true;
    net.send({ t: 'setLevel', level: i });
    lock();
    return;
  }
  $('menu').hidden = true;
  $('done').hidden = true;
  $('final').hidden = true;
  $('pause').hidden = true;
  running = true;
  loadLevel(i);
  lock();
}

try {
  $('mp-name').value = localStorage.getItem('tunel-nome') || '';
  $('mp-room').value = localStorage.getItem('tunel-sala') || 'mina';
} catch {}
$('mp-join').addEventListener('click', async () => {
  const name = $('mp-name').value.trim() || `Mineiro ${Math.floor(Math.random() * 90 + 10)}`;
  const room = $('mp-room').value.trim() || 'mina';
  $('mp-name').value = name;
  try {
    localStorage.setItem('tunel-nome', name);
    localStorage.setItem('tunel-sala', room);
  } catch {}
  if ($('mp-join').disabled) return;
  $('mp-join').disabled = true;
  $('mp-status').textContent = 'Conectando… (no primeiro acesso pode levar alguns segundos)';
  sound.init();
  setAudio($('opt-music').classList.contains('on'), $('opt-voice').classList.contains('on'));
  try {
    const w = await net.connect(room, name);
    setLocalSlot(w.slot);
    $('mp-status').textContent = `Na sala “${w.room}” com ${w.players.length} pessoa(s). Endereço para os colegas: ${location.host}`;
    $('mp-join').hidden = true;
    $('mp-leave').hidden = false;
    renderPlayers();
    // entra direto na câmara em que a sala está
    $('menu').hidden = true;
    running = true;
    loadLevel(Math.min(w.level, LEVELS.length - 1));
    fillMapSelect();
    applyRoomFlags(w.flags);
    toast(`Mapa da sala: ${LEVELS[w.level].name} — para trocar, aperte Esc`);
    for (const m of w.portals) {
      const peer = net.peers.get(m.id);
      if (peer) portals.placeRemote(m.id, peer.slot, m.which, m.c, m.n, m.u, m.b);
    }
    lock();
  } catch (e) {
    const dev = location.port === '5173' || location.port === '5182';
    $('mp-status').textContent = dev
      ? 'Multiplayer indisponível no modo de desenvolvimento: abra pelo servidor da rede (npm run serve).'
      : e.message === 'timeout'
        ? 'O servidor demorou para responder. Clique em “Entrar na sala” de novo.'
        : e.message === 'sem servidor'
          ? `Não consegui falar com o servidor em ${location.host}. Ele pode ter sido desligado — tente recarregar a página.`
          : `Não deu para entrar: ${e.message}.`;
  } finally {
    $('mp-join').disabled = false;
  }
});
$('mp-leave').addEventListener('click', () => {
  net.leave();
  for (const id of [...avatars.keys()]) removeAvatar(id);
  setLocalSlot(0);
  $('mp-join').hidden = false;
  $('mp-leave').hidden = true;
  $('mp-status').textContent = 'Você saiu da sala.';
  renderPlayers();
});

$('play').addEventListener('click', () => startLevel(Math.min(progress.last ?? 0, progress.unlocked - 1)));
$('opt-music').addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
$('opt-voice').addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
$('resume').addEventListener('click', () => lock());
$('restart').addEventListener('click', () => {
  loadLevel(levelIdx);
  lock();
});
$('to-menu').addEventListener('click', () => {
  running = false;
  $('pause').hidden = true;
  $('menu').hidden = false;
  renderMenu();
});
$('next').addEventListener('click', () => startLevel(Math.min(levelIdx + 1, LEVELS.length - 1)));
$('done').addEventListener('click', (e) => {
  if (e.target.id === 'done-menu' || e.target.id === 'again') $('next').hidden = false;
});
$('again').addEventListener('click', () => startLevel(levelIdx));
$('done-menu').addEventListener('click', () => {
  running = false;
  $('done').hidden = true;
  $('menu').hidden = false;
  renderMenu();
});
$('final-menu').addEventListener('click', () => {
  running = false;
  $('final').hidden = true;
  $('menu').hidden = false;
  renderMenu();
});
$('p-music').addEventListener('click', () => setAudio(!$('opt-music').classList.contains('on'), narrator.enabled));
$('p-voice').addEventListener('click', () => setAudio($('opt-music').classList.contains('on'), !narrator.enabled));
// desfoque de movimento (lembrado neste navegador)
let blurOn = true;
try {
  blurOn = localStorage.getItem('tunel-desfoque') !== '0';
} catch {}
function setBlur(on) {
  blurOn = on;
  post.blur.on = on;
  post.sceneRT.resolveDepthBuffer = on; // sem desfoque ninguém lê a profundidade: poupa a cópia dela a cada quadro
  $('opt-blur').classList.toggle('on', on);
  $('p-blur').classList.toggle('on', on);
  try {
    localStorage.setItem('tunel-desfoque', on ? '1' : '0');
  } catch {}
}
setBlur(blurOn);
$('opt-blur').addEventListener('click', () => setBlur(!blurOn));
$('p-blur').addEventListener('click', () => setBlur(!blurOn));
if (!narrator.available) setTimeout(() => !narrator.available && $('opt-voice').classList.remove('on'), 1500);
if (matchMedia('(pointer: coarse)').matches) $('mobile').hidden = false;
renderMenu();
// campanha original: carrega o módulo, põe os mapas no menu e, com
// jogo.html?campanha=testchmb_a_00, já começa direto no mapa
import('./campaign/hook.js').then((m) => {
    campaign = m;
    m.dialogue.onSubtitle = campaignSubtitle;
    const before = LEVELS.findIndex((L) => L.free);
    LEVELS.splice(before < 0 ? LEVELS.length : before, 0, ...m.CAMPAIGN);
    if (level) levelIdx = Math.max(0, LEVELS.indexOf(level)); // a lista cresceu no meio: o índice da fase atual andou
    renderMenu();
    const want = new URLSearchParams(location.search).get('campanha');
    const idx = want ? LEVELS.findIndex((L) => L.map === want) : -1;
    if (idx >= 0) startLevel(idx);
  });

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
const tmpMin = new THREE.Vector3();
const tmpMax = new THREE.Vector3();

function inside(p, min, max) {
  return p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z;
}

function updateDinos(t, dt) {
  for (const e of dinoList) {
    if (e.orbit) orbit(e.d, t, e.orbit);
    e.d.P.lookAt = e.look ? camera.position : null;
    poseDino(e.d, t, dt);
  }
}

// o T-rex do mapa livre: ruge quando você chega perto e empurra quem fica na frente
const _rf = new THREE.Vector3();
const _rp = new THREE.Vector3();
function updateRex(dt) {
  if (!rex) return;
  rexCooldown -= dt;
  const g = rex.d.group;
  _rf.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
  _rp.copy(player.pos).sub(g.position);
  const along = _rp.dot(_rf);
  const side = Math.hypot(_rp.x - _rf.x * along, _rp.z - _rf.z * along);
  const dist = Math.hypot(_rp.x, _rp.z);
  // corpo: da ponta da cauda (−8 m) até o focinho (+6 m), ~1,8 m de cada lado, até 6 m de altura
  if (along > -8 && along < 6 && side < 1.8 && player.pos.y < g.position.y + 6) {
    const push = _rp.clone().setY(0).sub(_rf.clone().multiplyScalar(along)).normalize();
    if (push.lengthSq() < 0.5) push.copy(_rf);
    player.vel.copy(push.multiplyScalar(11).add(_rf.clone().multiplyScalar(along > 0 ? 6 : -3))).setY(7);
    player.grounded = false;
    if (rexCooldown < 1) {
      roar(rex.d);
      sfx.roar(0);
      rexCooldown = 6;
      hurtFlash = Math.min(1, hurtFlash + 0.4);
      if (!rexWarned) {
        rexWarned = true;
        playLines([['Marquinho', 'Eu falei! Não fica na frente do Rex!']]);
      }
    }
  } else if (dist < 14 && rexCooldown <= 0) {
    roar(rex.d);
    sfx.roar(dist);
    rexCooldown = 9 + Math.random() * 5;
  }
}

// prova gravada do teste a partir do editor: o caminho a 30 quadros por segundo
const REC = { samples: [], acc: 0 };
function recordRun(dt) {
  REC.acc += dt;
  while (REC.acc >= 1 / 30) {
    REC.acc -= 1 / 30;
    const r = (v) => Math.round(v * 100) / 100;
    // (7–9: velocidade, para o editor medir o robô num ponto e levar para a Trajetória)
    REC.samples.push([r(player.pos.x), r(player.pos.y), r(player.pos.z), r(player.yaw), r(player.pitch), player.grounded ? 1 : 0, player.upSign, r(player.vel.x), r(player.vel.y), r(player.vel.z)]);
  }
}

let crushT = 0;
/** o jogador está sendo esmagado? (precisa continuar prensado por um instante) */
function crushed(dt) {
  const mn = player.pos.clone().sub(player.half).addScalar(0.12);
  const mx = player.pos.clone().add(player.half).subScalar(0.12);
  const near = (b, m) => b.max.x > mn.x - m && b.min.x < mx.x + m && b.max.y > mn.y - m && b.min.y < mx.y + m && b.max.z > mn.z - m && b.min.z < mx.z + m;
  // alguma peça se mexendo encostada?
  const pushing = world.doors.some((d) => d.delta.lengthSq() > 1e-8 && d.box && !d.box.disabled && near(d.box, 0.2));
  let inside = false;
  // entrando/saindo de um portal (ou logo depois de atravessar, ou no salto no tempo) não conta
  const atPortal = portals.mouths(player.pos, true, 0.5).length > 0 || player.cooldown > -0.4 || relogio?.sweep;
  if (atPortal) crushT = 0;
  if (pushing && !atPortal) {
    const pts = [player.pos.clone()];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(new THREE.Vector3(sx > 0 ? mx.x : mn.x, sy > 0 ? mx.y : mn.y, sz > 0 ? mx.z : mn.z));
    for (const b of world.solids) {
      if (b.disabled || b.solid === false || !near(b, 0)) continue;
      if (b.obb) {
        const inObb = (p) => {
          const l = p.clone().sub(b.obb.c).applyQuaternion(b.obb.qi);
          return Math.abs(l.x) < b.obb.half.x && Math.abs(l.y) < b.obb.half.y && Math.abs(l.z) < b.obb.half.z;
        };
        if (pts.some(inObb)) {
          inside = true;
          break;
        }
        continue;
      }
      if (!b.planes) {
        inside = true;
        break;
      }
      if (pts.some((p) => b.planes.every((pl) => pl.n.dot(p) < pl.d - 0.02))) {
        inside = true;
        break;
      }
    }
  }
  crushT = inside ? crushT + dt : 0;
  return crushT > 0.12;
}

function update(dt, t) {
  const pdt = dt * pScale; // tempo do jogador (menor dentro do campo de dilatação)
  if (FIELD.on && !relogio) {
    FIELD.left -= dt;
    if (FIELD.left <= 0) endField();
  }
  if (testingMine && !completed) recordRun(dt);
  data?.campaign?.runtime?.update(dt);
  updateBolts(dt, t);
  updateAim(realDt);
  levelTime += dt;
  // relógio do tempo: 0 enquanto o mundo está parado ou voltando
  const wdt = relogio ? relogio.frame(dt) : dt;
  syncFieldTimeline(wdt);
  const tv = relogio ? relogio.vt : t; // tempo visual do mundo (para quando ele para)
  world.update(tv, wdt);
  portals.update(t, dt);
  // portal da fase que muda de lugar sozinho
  if (cycle) {
    cycle.t -= dt;
    if (cycle.t <= 0) {
      cycle.t = cycle.every;
      cycle.i = (cycle.i + 1) % cycle.spots.length;
      portals.placeFixed(cycle.which, ...cycleSpot(cycle.i));
      sfx.open(cycle.which === 'blue');
      physics.wakeAll();
    }
  }

  // ---- jogador
  if (assist) {
    assist.t += pdt / 0.5;
    const k = Math.min(assist.t, 1);
    player.pos.lerpVectors(assist.from, assist.to, k * k * (3 - 2 * k));
    player.vel.set(0, 0, 0);
    if (assist.t >= 1) assist = null;
  } else {
    // dentro de um funil de excursão: a velocidade vai para a do fluxo; as
    // teclas (na direção da mira) empurram para os lados — é assim que se sai
    const flow = frontier.flowAt(player.pos);
    if (flow) {
      const axis = frontier.axis;
      const look = camForward();
      const right = look.clone().cross(UP).normalize();
      const wish = new THREE.Vector3().addScaledVector(look, (input.f ? 1 : 0) - (input.b ? 1 : 0)).addScaledVector(right, (input.r ? 1 : 0) - (input.l ? 1 : 0));
      wish.addScaledVector(axis, -wish.dot(axis));
      if (wish.lengthSq() > 1e-4) flow.addScaledVector(wish.normalize(), 4.5);
      player.vel.lerp(flow, 1 - Math.exp(-pdt * 5));
    }
    // câmera de cena da campanha com "congelar o jogador": nenhuma tecla move
    player.update(pdt, viewOverride?.freeze ? NO_INPUT : input, world, portals, gravityAt, (P) => {
      // ciano temporal: o jogador viaja no tempo (o relógio restaura o mundo e cria o clone)
      if (relogio && P.partner.delta > 0) {
        relogio.jump(P);
        return;
      }
      sfx.whoosh();
      if (P.partner.moon && !moonVisited) {
        moonVisited = true;
        sfx.vacuum();
        if (data.moonLines) playLines(data.moonLines);
      }
      // o jogador mudou de lado: o objeto segurado continua onde está e passa a
      // seguir a mira "através" do portal (até atravessar também)
      if (held) held.space.multiply(portals.transform(P, P.partner).invert());
    });
  }
  // porta/plataforma em movimento entrou no jogador: pistão esmaga; o resto empurra
  for (const d of world.doors) {
    if (d.delta.lengthSq() === 0 || player.ground === d.box) continue;
    const b = d.box;
    const pen = ['x', 'y', 'z'].map((a) => Math.min(player.pos[a] + player.half[a] - b.min[a], b.max[a] - (player.pos[a] - player.half[a])));
    if (pen.some((v) => v <= 0.06)) continue;
    if (d.crush) {
      die('esmagado');
      break;
    }
    const i = pen.indexOf(Math.min(...pen));
    const a = 'xyz'[i];
    const center = (b.min[a] + b.max[a]) / 2;
    player.pos[a] += (player.pos[a] > center ? 1 : -1) * (pen[i] + 0.01);
  }
  // esmagado: depois do empurrão, ainda prensado dentro de algo sólido enquanto uma peça
  // em movimento encosta em você (plataforma subindo até o teto, porta fechando contra a
  // parede…). Na boca de um portal não conta (lá você atravessa a parede de propósito)
  if (crushed(dt)) die('esmagado');
  // aterrissagem e passos
  if (player.grounded && !lastGrounded && Math.abs(lastVy) > 3) {
    sfx.land(Math.abs(lastVy));
    GUN.landV -= Math.min(0.6, Math.abs(lastVy) * 0.03);
  }
  lastGrounded = player.grounded;
  lastVy = player.vel.y;
  // passos: cadência pela velocidade de verdade (empurrado contra a parede, não pisa)
  const walkSpeed = player.vel.clone().projectOnPlane(UP).length();
  if (player.grounded && walkSpeed > 0.6) {
    stepAcc += (pdt * walkSpeed) / 4.6;
    if (stepAcc > 0.42) {
      stepAcc = 0;
      sfx.step(player.ground?.mat, walkSpeed / 4.6);
    }
  } else if (!player.grounded) stepAcc = 0.3; // o primeiro passo depois de pousar vem logo

  // ---- objetos (cubos e torretas): corpos rígidos
  const fwd = camForward();
  const props = [...cubes, ...turrets];
  if (held) {
    const eye = player.eye();
    // alvo na frente da mira (do lado do jogador; o objeto converte para o lado em que estiver)
    held.holdLocal = eye.clone().addScaledVector(fwd, holdDistance(eye, fwd));
    held.holdQuatLocal = new THREE.Quaternion().setFromAxisAngle(UP, player.yaw).multiply(held.holdBase);
  }
  for (const c of props) {
    const inF = inField(c.pos) && !c.held && !c.gone;
    // no tempo lento do campo a física acharia que está parado e o poria para dormir (e aí a gravidade some)
    if (inF) c.body.wakeUp();
    if (inF === !!c.dilated) continue;
    const k = inF ? 1 / FIELD.rate : FIELD.rate;
    const v = c.body.linvel();
    const w = c.body.angvel();
    c.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    c.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
    c.dilated = inF;
  }
  physics.step(
    dt,
    (p, h) => {
      p.pre(h, p.dilated ? gravityAt(p.prevCenter).clone().multiplyScalar(1 / (FIELD.rate * FIELD.rate)) : gravityAt(p.prevCenter));
      if (p.held || !world.funnels.length) return;
      const f = frontier.flowAt(p.prevCenter);
      if (!f) return;
      const v = p.body.linvel();
      const k = 1 - Math.exp(-h * 5);
      p.body.setLinvel({ x: v.x + (f.x - v.x) * k, y: v.y + (f.y - v.y) * k, z: v.z + (f.z - v.z) * k }, true);
    },
    (p) => p.post(gravityAt),
  );
  for (const c of props) c.sync();
  if (held) {
    // longe do alvo por um tempo = preso em algo: solta (atrasado num giro rápido, não)
    held.updateHold();
    held.farTime = held.pos.distanceTo(held.holdTarget) > 2.6 ? (held.farTime ?? 0) + dt : 0;
    if (held.farTime > 0.4) release();
  }
  const touches = (c, b) => {
    tmpMin.copy(c.pos).sub(c.half);
    tmpMax.copy(c.pos).add(c.half);
    return tmpMin.x < b.max.x && tmpMax.x > b.min.x && tmpMin.y < b.max.y && tmpMax.y > b.min.y && tmpMin.z < b.max.z && tmpMax.z > b.min.z;
  };
  for (const c of props) {
    if (c.gone) continue;
    // fornalha: queima a amostra e liga o sinal
    const I = world.incinerators.find((f) => inside(c.pos, f.min, f.max));
    if (I) {
      if (held === c) release();
      dissolver.add(c.mesh, BURN);
      c.vanish();
      I.active = true;
      sfx.burn();
      continue;
    }
    // rocha fundida ou grade de desintegração: a amostra volta ao dispensador; a torreta é destruída
    if (world.hazards.some((h) => touches(c, h)) || world.fizzlers.some((f) => inside(c.pos, f.min, f.max))) {
      if (held === c) release();
      for (const f of world.fizzlers) if (inside(c.pos, f.min, f.max)) world.fizzlerRipple(f, c.pos, t);
      dissolver.add(c.mesh, world.hazards.some((h) => touches(c, h)) ? BURN : FIZZLE);
      if (c.kind === 'cube') c.respawn();
      else c.vanish();
      sfx.fizzle();
      continue;
    }
    if (c.pos.y < -300 || c.pos.y > 400) c.kind === 'cube' ? c.respawn() : c.vanish();
  }

  // ---- série Fronteira: lasers, funis, placas, buracos negros, Lua
  frontier.update(dt, {
    player,
    props,
    t,
    relogio,
    sfx,
    hurt: (dps, h, dir) => {
      h *= pScale; // o laser queima no tempo de quem está queimando
      health -= dps * h;
      hurtT = 0;
      hurtFlash = Math.min(1, hurtFlash + h * 3);
      player.vel.addScaledVector(dir, 25 * h);
    },
    killTurret: (tu) => {
      tu.disable('laser', 3);
      tu.burnT = 1.4;
    },
    lose: (c) => {
      if (held === c) release();
      dissolver.add(c.mesh, new THREE.Color(0.7, 0.4, 1.0));
      if (c.kind === 'cube') c.respawn();
      else c.vanish();
    },
    die: () => die(),
  });

  // ---- botões, receptores e portas (sinais)
  const feet = player.pos.clone().addScaledVector(new THREE.Vector3(0, -1, 0), 0.9 * player.upSign);
  const peers = [...peerFeet(), ...(relogio?.feet() ?? [])];
  const echoes = relogio?.echoes() ?? []; // cópias do passado do objeto que viajou com você
  for (const b of world.buttons) {
    const near = (p, dy0, dy1) => Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 0.85 && p.y - b.pos.y > dy0 && p.y - b.pos.y < dy1;
    const pressed =
      props.some((c) => !c.held && !c.cloneHeld && !c.gone && !c.remote?.held && near(c.pos, 0, 1.0)) ||
      echoes.some((p) => near(p, 0, 1.0)) ||
      near(feet, -0.1, 0.5) ||
      peers.some((f) => near(f, -0.1, 0.5));
    if (b.hold) b.count = pressed ? b.hold : Math.max(0, b.count - wdt); // sinal que continua ligado depois de solto
    if (pressed !== b.pressed) {
      b.pressed = pressed; // a placa e as luzes se animam em world.update
      sfx.click(pressed);
    }
  }
  // uma porta abre quando TODOS os botões/receptores/fornalhas ligados a ela estão ativos
  const sig = new Map();
  const and = (id, v) => id && sig.set(id, (sig.get(id) ?? true) && v);
  for (const b of world.buttons) and(b.opens, b.pressed || b.count > 0);
  for (const c of world.catchers) and(c.opens, c.active);
  for (const I of world.incinerators) and(I.opens, I.active);
  for (const C of world.laserCatchers) and(C.opens, C.active);
  for (const [id, v] of world.signals) and(id, v); // sinais ligados pela própria fase (lutas contra chefes)
  // emissor de laser ligado a um sinal (o feixe acende no quadro seguinte)
  for (const L of world.lasers) if (L.sig) L.off = !sig.get(L.sig);
  // grade de desintegração ligada a um sinal: o botão a desliga (mode 'off') ou a liga (mode 'on')
  for (const f of world.fizzLinked) world.setFizzler(f, f.mode === 'on' ? !!sig.get(f.sig) : !sig.get(f.sig));
  // funil que vira de sentido com um sinal
  for (const F of world.funnels) {
    if (F.id) F.reversed = F.startReversed !== !!sig.get(F.id);
    if (F.power) F.off = !sig.get(F.power) && !(F.latch && !F.off); // funil que só liga com um sinal (`latch`: liga e fica)
  }
  for (const d of world.doors) {
    if (d.loop) {
      // plataforma que vai e volta enquanto ligada
      if (!(d.always || sig.get(d.id))) {
        d.target = 0;
        continue;
      }
      if (Math.abs(d.open - d.target) < 1e-4) {
        d.wait -= wdt;
        if (d.wait <= 0) {
          d.target = 1 - d.target;
          d.wait = d.waits ? d.waits[d.target] : d.loop;
        }
      }
      continue;
    }
    if (!sig.has(d.id)) continue;
    const target = sig.get(d.id) || (d.latch && d.target === 1) ? 1 : 0;
    if (d.target !== target) {
      d.target = target;
      sfx.door();
    }
  }

  // ---- grade de desintegração: passar por ela some com os seus portais
  const nowIn = !!world.segmentFizzler(lastPlayerPos, player.pos, player.half); // o corpo todo, não só o centro
  lastPlayerPos.copy(player.pos);
  if (nowIn && !inFizzler) {
    // onda no campo onde o jogador passou
    for (const f of world.fizzlers) {
      const c = player.pos.clone().clamp(f.min, f.max);
      if (c.distanceTo(player.pos) < 1.2) world.fizzlerRipple(f, c, t);
    }
    if (portals.fizzle()) {
      sfx.fizzle();
      updateCrosshair();
    }
    if (held) {
      const c = held;
      release();
      dissolver.add(c.mesh, FIZZLE);
      if (c.kind === 'cube') c.respawn();
      else c.vanish();
    }
  }
  inFizzler = nowIn;

  // ---- pedestal da arma
  for (const pd of world.pedestals)
    if (!pd.taken && player.pos.distanceTo(pd.pos) < 1.5) {
      pd.taken = true;
      pd.group.visible = false;
      pd.light.intensity = 0;
      gunMode = pd.gives;
      if (pd.entity) data?.campaign?.runtime?.pickupGun(pd.entity); // campanha: as saídas do mapa
      sfx.gun();
      toast(pd.gives === 'blue' ? 'Você pegou a arma de portais (por enquanto, só o portal ciano).' : 'Arma completa: agora ela abre os dois portais!');
      updateCrosshair();
    }

  // ---- bolas de energia
  tmpMin.copy(player.pos).sub(player.half);
  tmpMax.copy(player.pos).add(player.half);
  energy.update(wdt, tv, world, portals, { min: tmpMin.clone(), max: tmpMax.clone() }, {
    launch: () => sfx.launch(),
    timeScale: (p) => (inField(p) ? 1 / FIELD.rate : 1),
    caught: () => sfx.caught(),
    pop: () => sfx.pop(),
    hitPlayer: () => die(),
    props: () => [...cubes, ...turrets],
    intoPast: (p, O) => relogio?.ballIntoPast(p, O),
    intoGhost: (p, at) => relogio?.ballIntoGhost(p, at),
    toPast: relogio ? (p, P) => relogio.ballToPast(p, P) : null,
  });
  relogio?.pastPellets(); // bolas do passado que entraram no vermelho temporal saem pelo ciano

  fight?.update(dt, t);

  // amostra em cima de um botão acende a janela do núcleo
  for (const c of cubes) {
    c.mesh.coreMixer?.update(wdt); // núcleo do original: o olho se mexe
    const gl = c.mesh.userData.glow;
    if (!gl) continue;
    const on = world.buttons.some((b) => Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) < 0.85 && c.pos.y - b.pos.y > 0 && c.pos.y - b.pos.y < 0.9);
    gl.emissiveIntensity += ((on ? 2.4 : 0.6) - gl.emissiveIntensity) * Math.min(1, dt * 5);
  }

  // ---- torretas
  if (turrets.length || world.lasers.length) {
    const eye = player.eye();
    let shotsTaken = 0;
    // alvos pelos portais: você do outro lado de um par comum; pelo ciano temporal, o seu
    // eu do passado (acertá-lo machuca você agora: era você)
    const via = [];
    for (const P of [portals.blue, portals.orange]) {
      if (!P.placed || !portals.isLinked(P)) continue;
      if (P.delta > 0) continue; // o vermelho do passado não existe no presente
      if (P.partner.delta > 0) {
        const me = relogio?.pastSelfEye?.(P.partner.delta);
        if (me) via.push({ real: me, P, Q: P.partner, past: true });
      } else via.push({ real: eye, P, Q: P.partner });
    }
    // torretas do passado (como estavam Δ s atrás) que viam o vermelho: as balas saem do ciano agora
    if (relogio) {
      const past = relogio.pastTurretShots?.(wdt, eye) ?? 0;
      if (past) {
        shotsTaken += past;
        turretFiring(portals.blue.center.distanceTo(eye));
      }
    }
    for (const t of turrets) {
      const shots = t.update(wdt, world, portals, gravityAt, eye, cubes, via);
      // bipes de alvo encontrado / perdido e o desligar
      if (t.spottedNow && !t.wasSpotted) sfx.turretSpot();
      else if (!t.spottedNow && t.wasSpotted && t.active) sfx.turretLost();
      if (!t.active && t.wasActive) sfx.turretDown();
      t.wasSpotted = t.spottedNow;
      t.wasActive = t.active;
      // torreta queimada pelo laser: some depois de um instante
      if (t.burnT !== undefined && !t.gone) {
        t.burnT -= dt;
        if (t.burnT <= 0) {
          dissolver.add(t.mesh, BURN);
          t.vanish();
          sfx.burn();
        }
      }
      if (shots) {
        shotsTaken += shots;
        turretFiring(t.pos.distanceTo(eye));
        if (t.viaPast && !t.saidPast) {
          t.saidPast = true;
          toast('A torreta acertou o seu eu do passado pelo ciano — e era você.');
        }
      }
    }
    if (shotsTaken) {
      health -= shotsTaken * 6;
      hurtT = 0;
      hurtFlash = Math.min(1, hurtFlash + 0.25 * shotsTaken);
    } else hurtT += pdt;
    if (hurtT > 2.5) health = Math.min(100, health + pdt * 30);
    if (health <= 0) die();
    $('health-bar').style.width = `${Math.max(health, 0)}%`;
    $('health').classList.toggle('low', health < 35);
  }
  hurtFlash = Math.max(0, hurtFlash - pdt * 1.8);
  $('hurt').style.opacity = hurtFlash;
  // ---- cristais
  for (const [i, g] of crystals.entries()) {
    if (g.taken) continue;
    g.m.rotation.y += dt * 0.8;
    g.m.position.y = g.pos.y - 0.4 + Math.sin(t * 2 + i) * 0.08;
    if (g.pos.distanceTo(player.pos) < 1.4) {
      const me = mp() ? $('mp-name').value || 'você' : 'você';
      takeGem(i, me);
      sfx.gem();
      gemsMine++;
      if (mp()) net.send({ t: 'gem', idx: i, name: me, lvl: levelIdx });
    }
  }

  // ---- perigos, gatilhos, saída
  tmpMin.copy(player.pos).sub(player.half);
  tmpMax.copy(player.pos).add(player.half);
  for (const h of world.hazards)
    if (tmpMin.x < h.max.x && tmpMax.x > h.min.x && tmpMin.y < h.max.y && tmpMax.y > h.min.y && tmpMin.z < h.max.z && tmpMax.z > h.min.z) {
      die();
      break;
    }
  if (player.pos.y < (data.killY ?? -400) || world.incinerators.some((f) => inside(player.pos, f.min, f.max))) die();
  for (const tr of world.triggers) {
    if (tr.done || !inside(player.pos, tr.min, tr.max) || (tr.era && tr.era !== world.era)) continue;
    if (tr.exit) {
      tr.done = true;
      if (mp()) net.send({ t: 'exit', level: levelIdx, final: !!tr.final });
      else complete(!!tr.final);
    } else if (tr.lines) {
      tr.done = true;
      playLines(tr.lines);
    }
  }
  for (const [i, h] of (data.hints ?? []).entries())
    if (!firedHints.has(i) && levelTime > h.after) {
      firedHints.add(i);
      playLines(h.lines);
    }
  if (data.stuck && player.pos.y < data.stuck.below && player.groundTime > 1.3) {
    playLines(data.stuck.lines);
    const [x, y, z, yaw] = data.spawn;
    player.spawn(x + spawnOffset(), y, z, yaw);
  }

  // ---- fase final: o túnel
  if (data.tube) {
    const p = player.pos;
    const nowIn = Math.abs(p.x) < 2.6 && Math.abs(p.z) < 2.6 && p.y < -0.5 && p.y > data.tube.bottom - 1;
    if (nowIn !== inTube) {
      inTube = nowIn;
      $('tube-hud').hidden = !inTube;
      sound.setMood(inTube ? 'labTense' : player.upSign < 0 ? 'labEpic' : level.music);
      if (inTube) playLines([['Helena', 'Lá vai! Repara na gravidade diminuindo...']]);
    }
    const speed = player.vel.length();
    sound.setIntensity(Math.min(speed / 28, 1));
    sound.setWhoosh(inTube ? Math.min(speed / 28, 1) : 0);
    if (inTube) {
      $('t-speed').textContent = Math.round(speed * 3.6).toLocaleString('pt-BR');
      $('t-g').textContent = Math.abs(gravityAt(p).y).toFixed(1).replace('.', ',');
      $('t-center').textContent = Math.round(Math.abs(p.y - data.tube.center)).toLocaleString('pt-BR');
      $('t-phase').textContent = p.y > data.tube.center ? 'caindo para o centro ↓' : 'subindo para o outro lado ↑';
    }
    // "agarra na borda": do outro lado, ajuda a sair da boca do túnel
    if (!assist && player.upSign < 0 && p.y < data.tube.bottom + 3 && Math.abs(p.x) < 2.4 && Math.abs(p.z) < 2.4 && Math.abs(player.vel.y) < 3.5) {
      const d = camForward().setY(0);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      d.normalize();
      const dir = Math.abs(d.x) > Math.abs(d.z) ? new THREE.Vector3(Math.sign(d.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(d.z));
      const to = new THREE.Vector3(dir.x * 3.3, data.tube.bottom - 0.92, dir.z * 3.3);
      assist = { from: p.clone(), to, t: 0 };
      playLines([['Dona Cida', 'Agarra na borda, menino!']]);
    }
  }
  if (level.heat) $('heat-v').textContent = `${Math.round(38 + Math.min(levelTime, 300) * 0.06)} °C`;

  // ---- personagens
  for (const w of npcList) {
    w.P.lookAt = camera.position;
    poseWorker(w, tv, wdt);
  }
  updateDinos(tv, wdt);
  updateRex(dt);
  const moving = input.f || input.b || input.l || input.r;
  body.P.pose = moving && player.grounded ? 'walk' : 'idle';
  body.P.speed = 4.5;
  poseDino(body, t, dt);
  body.group.position.copy(feet);
  body.group.rotation.set(0, player.yaw + Math.PI, player.upSign < 0 ? Math.PI : 0);

  // ---- arma, rastro, faíscas
  gun.visible = gunMode !== 'none' && ZOOM.k < 1.3;
  animateGun(pdt, t);

  if (sparkT < 1) {
    sparkT += dt;
    const pos = sparkGeo.attributes.position;
    for (let i = 0; i < SPARKS; i++) {
      sparkVel[i].y -= 9.8 * dt;
      pos.setXYZ(i, pos.getX(i) + sparkVel[i].x * dt, pos.getY(i) + sparkVel[i].y * dt, pos.getZ(i) + sparkVel[i].z * dt);
    }
    pos.needsUpdate = true;
    sparks.material.opacity = 1 - sparkT;
  }

  // ---- câmera
  const speed = player.vel.length();
  // zoom com o tempo de verdade (o lento não deixa a lente lenta)
  ZOOM.k += ((ZOOM.on ? ZOOM.level : 1) - ZOOM.k) * (1 - Math.exp(-realDt * 14));
  const baseFov = 75 + clamp((speed - 8) / 22, 0, 1) * 16 - (SLOW.on ? 7 : 0);
  ZOOM.fov = THREE.MathUtils.lerp(ZOOM.fov ?? 75, baseFov, 1 - Math.exp(-pdt * (SLOW.on ? 10 : 4)));
  camera.fov = ZOOM.fov / ZOOM.k;
  document.body.classList.toggle('zoomed', ZOOM.k > 1.15);
  setText('zoom-v', `${ZOOM.k.toFixed(1).replace('.', ',')}×`);
  camera.updateProjectionMatrix();
  // a visão treme: aos poucos durante a carga do campo e com um tranco quando a bolha nasce
  const charging = FIELD.charge / FIELD.need;
  player.applyCamera(pdt, Math.max(0.075 * charging ** 2, FIELD.shake > 0 ? 0.18 * (FIELD.shake / 0.7) ** 2 : 0));
  // logo depois de um portal a câmera ainda está "chegando": o próprio corpo
  // apareceria colado na vista
  body.group.visible = !player.inTransit;
  deadFlash = Math.max(0, deadFlash - pdt * 1.5);
  $('flash').style.opacity = deadFlash;
  setText('timer', fmt(levelTime));
  if (relogio) updateClockHud();
  // dica de "E" quando olhando para um cubo
  const look = rayCube(camera.position, fwd, 2.8);
  $('use-hint').hidden = !(look && !held) && !held;
  $('use-hint').textContent = held ? 'E — soltar · botão esquerdo — arremessar' : 'E — pegar';
}

let realDt = 1 / 60;
// passo manual da simulação (testes automáticos pelo console: __jogo.manual = true; __jogo.step(1/60))
let manualStep = false;
let manualT = 0;

// com o menu/pausa por cima (fundo escurecido e borrado) metade dos quadros basta:
// a placa de vídeo descansa e ninguém nota atrás do painel
const coverEls = [...document.querySelectorAll('.overlay'), $('menu')].filter(Boolean);
let coverFlip = false;

// última rajada de torreta ouvida (o som é um laço enquanto ela atira)
let fireAt = -1e9;
let fireDist = Infinity;
function turretFiring(dist) {
  const now = performance.now();
  if (now - fireAt > 160 || dist < fireDist) fireDist = dist;
  fireAt = now;
}

function frame() {
  if (!manualStep && coverEls.some((e) => !e.hidden)) {
    coverFlip = !coverFlip;
    if (coverFlip) {
      requestAnimationFrame(frame);
      return;
    }
  }
  const dt = Math.min(clock.getDelta(), 0.05);
  realDt = dt;
  const t = clock.elapsedTime;
  if (editing) {
    editor.frame(dt);
    gun.visible = false;
    world.update(t, dt);
    portals.update(t, dt);
    for (const w of npcList) poseWorker(w, t, dt);
    updateDinos(t, dt);
    portals.render();
  } else if (running && level) {
    netTick(dt);
    updateAvatars(dt, t);
    if (manualStep) {
      player.applyCamera(0);
    } else if (!paused && !completed) {
      updateSlowmo(dt);
      tick(dt, dt * SLOW.k, t);
    } else if (SLOW.on) toggleSlowmo(false);
    else {
      updateField(0, false);
      // pausado: portas, plataformas e elevadores ficam parados (dt = 0)
      world.update(t, 0);
      portals.update(t, dt);
      for (const w of npcList) poseWorker(w, t, dt);
      updateDinos(t, dt);
      player.applyCamera(dt);
    }
    if (viewOverride) {
      camera.position.copy(viewOverride.pos);
      camera.quaternion.setFromEuler(new THREE.Euler(viewOverride.pitch, viewOverride.yaw, 0, 'YXZ'));
    }
    portals.render();
  } else {
    // fundo do menu: câmara 1 girando devagar
    gun.visible = false;
    if (!level) loadLevel(0, true);
    world.update(t, dt);
    portals.update(t, dt);
    for (const w of npcList) poseWorker(w, t, dt);
    updateDinos(t, dt);
    camera.position.set(Math.sin(t * 0.05) * 4, 5, 2 + Math.cos(t * 0.05) * 3);
    camera.lookAt(0, 3, -14);
  }
  dissolver.update(dt);
  updateTimeFx(dt);
  shadows.update(level ? [...cubes, ...turrets] : [], world, gravityAt);
  motes.userData.update(relogio ? relogio.vt : t, camera, window.innerHeight * renderer.getPixelRatio()); // a poeira também para com o tempo
  const spd = running && level ? player.vel.length() : 0;
  const ahead = spd > 0.1 ? player.vel.dot(camForward()) / spd : 0;
  // sons contínuos: ambiente do laboratório, campo da arma e vento da velocidade
  const live = running && level && !paused && !completed;
  if (live) {
    sfx.hold(held ? 1 : 0);
    sfx.slowHum(SLOW.on ? 1 : 0);
    // rajada das torretas: segue tocando enquanto chegam tiros (a cada 0,1 s)
    sfx.turretFire(performance.now() - fireAt < 160 ? Math.max(0.2, 1 - fireDist / 30) : 0);
    // vento: gravação em laço que cresce com a velocidade (sintetizado se ainda não carregou)
    const wv = inTube ? Math.min(spd / 28, 1) : clamp((spd - 5) / 18, 0, 1);
    sound.setWhoosh(sfx.wind(wv) ? 0 : wv);
  } else {
    sfx.silenceLoops();
    sound.setWhoosh(0);
  }
  // a onda de choque do tiro sai da boca da arma (posição dela na tela)
  const tipNdc = gun.userData.tip.getWorldPosition(_shockV).project(camera);
  post.shockAt = _shockUv.set(tipNdc.x * 0.5 + 0.5, tipNdc.y * 0.5 + 0.5);
  post.render(dt, t, clamp((1 - SLOW.k) / (1 - SLOW.scale), 0, 1), scene, camera, spd, ahead);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.resize();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  portals.resize(s.x, s.y);
});

// atalho para testes: jogo.html#fase=3
const m = location.hash.match(/fase=(\d)/);
if (m) {
  progress.unlocked = Math.max(progress.unlocked, Number(m[1]));
  renderMenu();
}
initPhysics().then(() => requestAnimationFrame(frame));
window.__jogo = {
  get manual() {
    return manualStep;
  },
  set manual(v) {
    manualStep = v;
  },
  step(dt = 1 / 60) {
    if (!running || !level || completed) return;
    manualT += dt;
    tick(dt, dt, manualT);
  },
  get campaign() { return campaign; }, get editor() { return editor; }, openEditor, mineLevel, get editing() { return editing; }, get testingMine() { return testingMine; }, backToEditor, get relogio() { return relogio; }, get chronos() { return relogio; }, get fight() { return fight; }, get levels() { return LEVELS; }, THREE, post, gun, GUN, dissolver, frontier, sfx, timeTravel, release, get deaths() { return deaths; }, get data() { return data; }, get health() { return health; }, player, portals, world, physics, energy, SLOW, toggleSlowmo, get turrets() { return turrets; }, get held() { return held; }, get gunMode() { return gunMode; }, loadLevel, get cubes() { return cubes; }, makeCube, startLevel, sound, shoot, use, input, camera, set paused(v) { paused = v; }, get state() { return { running, paused, completed, levelIdx, levelTime }; }, FIELD, mouseHeld, inField };
