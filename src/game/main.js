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
import { initEnvironment, portalGun, sampleCube } from './models.js';
import { Post, dust, ContactShadows, Dissolver } from './fx.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ renderer / cena
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
initEnvironment(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101216);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3a30, 1.0));

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 700);
camera.layers.enable(2); // a arma em primeira pessoa
scene.add(camera);

const post = new Post(renderer, scene, camera);
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
const UP = new THREE.Vector3(0, 1, 0);
const player = new Player(camera);
const sound = new Soundtrack();
const sfx = new Sfx(sound);
const narrator = new Narrator();
narrator.onSpeaking = (on) => sound.duck(on);

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
  sel.innerHTML = LEVELS.map((L, i) => `<option value="${i}">${L.free ? 'Mapa livre' : `Câmara ${String(L.id).padStart(2, '0')}`} · ${L.name}</option>`).join('');
  sel.value = String(levelIdx);
}
$('room-map').addEventListener('change', (e) => {
  if (mp()) net.send({ t: 'setLevel', level: Number(e.target.value) });
  else {
    loadLevel(Number(e.target.value));
    lock();
  }
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

// ------------------------------------------------------------------ corpo do jogador (visível só pelos portais)
// você é um raptor de capacete e colete (dá para se ver pelos portais)
const body = makeDino('raptor', { helmet: 0xffffff, vest: 0xe8762a });
body.group.traverse((o) => o.layers.set(1));
scene.add(body.group);

// ------------------------------------------------------------------ arma de portais (primeira pessoa)
const gun = portalGun();
{
  gun.position.set(0.21, -0.19, -0.44);
  gun.rotation.set(0.05, 0.09, 0);
  gun.scale.setScalar(0.62);
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
const GUN = { look: new THREE.Vector2(), sway: new THREE.Vector2(), swayV: new THREE.Vector2(), land: 0, landV: 0, open: 0, walk: 0 };

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
  gun.position.set(0.21 + GUN.sway.x + bx, -0.19 + GUN.sway.y + by + breathe + GUN.land + recoil * 0.015 + GUN.open * 0.01, -0.44 + recoil * 0.06 - GUN.open * 0.02);
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
}

// rastro do tiro
const tracer = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0 }),
);
tracer.frustumCulled = false;
scene.add(tracer);

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
const input = { f: false, b: false, l: false, r: false, jump: false };
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
let spottedOnce = false;
const gravityAt = (p) => gravityFn(p, grav);

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
progress.best = progress.best || {};
const saveProgress = () => {
  try {
    localStorage.setItem('tunel-jogo', JSON.stringify(progress));
  } catch {}
};

const levelLabel = (L) =>
  L.free ? 'Mapa livre' : L.series === 'hard' ? `Desafio ${L.code}` : L.series === 'momentum' ? `Momento ${L.code}` : L.code ? `Teste ${L.code}` : `Câmara ${String(L.id).padStart(2, '0')}`;
const cycleSpot = (i) => {
  const sp = cycle.spots[i];
  return [sp.c, sp.n, sp.u ?? [0, 1, 0]];
};

// ------------------------------------------------------------------ fases
function clearLevel() {
  world.reset();
  portals.reset();
  energy.reset();
  dissolver.clear();
  for (const c of [...dyn.children]) dyn.remove(c);
  cubes = [];
  turrets = [];
  crystals = [];
  gemsMine = 0;
  gemOwners.clear();
  health = 100;
  spottedOnce = false;
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

const spawnOffset = () => (mp() ? [0, 1.3, -1.3, 2.6][net.slot % 4] : 0);

function loadLevel(i, silent = false) {
  clearLevel();
  levelIdx = i;
  level = LEVELS[i];
  data = level.build(world);
  gravityFn = data.gravityAt ?? DEFAULT_GRAVITY;
  const [x, y, z, yaw] = data.spawn;
  player.spawn(x + spawnOffset(), y, z, yaw);
  physics.setPlayer(player.half);
  for (const [cx, cy, cz, opts] of data.cubes ?? []) {
    const m = sampleCube(opts);
    dyn.add(m);
    cubes.push(new Cube(physics, portals, m, cx, cy, cz, opts));
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
  for (const [tx, ty, tz, tyaw] of data.turrets ?? []) turrets.push(new Turret(dyn, physics, portals, tx, ty, tz, tyaw));
  gunMode = data.gun ?? 'both';
  for (const f of data.portals ?? []) portals.placeFixed(f.which, f.c, f.n, f.u);
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
  $('health').hidden = !turrets.length;
  updateGems();
  levelTime = 0;
  completed = false;
  inTube = false;
  sound.setMood(level.music);
  $('lvl-num').textContent = levelLabel(level);
  $('lvl-name').textContent = level.name;
  $('lvl-goal').textContent = level.lesson;
  $('tube-hud').hidden = true;
  $('heat').hidden = !level.heat;
  updateCrosshair();
  if (silent) return;
  playLines(data.intro ?? [], 1200);
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
    const ok = await narrator.speak(spoken(text), who);
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
  gun.userData.base.copy(SLOT_COLORS[mp() ? net.slot % 4 : 0][blue ? 0 : 1]).multiplyScalar(3);
  gun.userData.light.color.copy(SLOT_COLORS[mp() ? net.slot % 4 : 0][blue ? 0 : 1]);
  sfx.shot(blue);
  const allowed = !data.portalsAllowed || data.portalsAllowed(player.pos);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camForward();
  // a grade de desintegração barra o tiro
  const wall = world.raycast(origin, dir, 400);
  const fz = world.rayFizzler(origin, dir, wall ? wall.dist : 400);
  const res = !allowed ? { ok: false } : fz ? { ok: false, point: fz, normal: dir.clone().negate() } : portals.tryPlace(which, origin, dir);
  const tipW = gun.userData.tip.getWorldPosition(new THREE.Vector3());
  const end = res.point ?? origin.clone().addScaledVector(dir, 40);
  tracer.geometry.setFromPoints([tipW, end]);
  tracer.material.color.copy(SLOT_COLORS[mp() ? net.slot % 4 : 0][blue ? 0 : 1]);
  tracer.material.opacity = 0.9;
  if (res.ok) {
    if (mp())
      net.send({ t: 'portal', which, lvl: levelIdx, c: res.point.toArray(), n: res.normal.toArray(), u: res.up.toArray(), b: res.boxIndex });
    sfx.open(blue);
    physics.wakeAll();
    updateCrosshair();
  } else {
    sfx.fizzle();
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
  const hit = rayCube(origin, dir, 2.8);
  // por trás de uma torreta ativa: E desliga (e ela tomba)
  const ti = turrets.findIndex((t) => t.canDisableFrom(player.pos) && (!hit || hit.c === t));
  if (ti >= 0) {
    turretDown(ti, true);
    return;
  }
  if (!hit) return;
  if (hit.c.remote?.held && performance.now() - hit.c.remote.t < 500) return toast('Outra pessoa está segurando essa amostra.');
  const wall = world.raycast(origin, dir, hit.t);
  if (wall) return;
  held = hit.c;
  held.held = true;
  held.farTime = 0;
  held.space.identity(); // segurado do mesmo lado do jogador
  // segura mantendo o giro relativo ao olhar (cubo no múltiplo de 90° mais perto;
  // torreta virada para a frente, como quem aponta)
  const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, player.yaw);
  if (held.kind === 'turret') held.holdBase = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
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
    const P = portals.crossing(o, o.clone().addScaledVector(d, wall ? wall.dist + 0.01 : rest));
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

function die() {
  health = 100;
  sfx.death();
  deadFlash = 1;
  release();
  const [x, y, z, yaw] = data.spawn;
  player.spawn(x + spawnOffset(), y, z, yaw);
  playLines([[level.who, ['Opa. Volta pro começo e tenta de novo.', 'Essa doeu. De novo!', 'Calma, sô. Mais uma vez.'][Math.floor(Math.random() * 3)]]]);
}

function complete(final) {
  if (completed) return;
  completed = true;
  sfx.win();
  const t = levelTime;
  const prev = progress.best[level.id];
  if (!prev || t < prev) progress.best[level.id] = t;
  if (level.series) progress[level.series] = Math.max(progress[level.series], level.n + 2);
  else progress.unlocked = Math.max(progress.unlocked, Math.min(level.id + 1, LEVELS.length));
  saveProgress();
  document.exitPointerLock?.();
  $('next').hidden = !LEVELS[levelIdx + 1] || LEVELS[levelIdx + 1].series !== level.series || !!LEVELS[levelIdx + 1].free;
  if (final) {
    showFinal(t);
    return;
  }
  $('done-title').textContent = `${levelLabel(level)} concluíd${level.code ? 'o' : 'a'}`;
  $('done-time').textContent = `Tempo: ${fmt(t)}${prev && prev <= t ? ` · recorde ${fmt(prev)}` : ' · novo recorde!'}`;
  $('done').hidden = false;
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

function updateCrosshair() {
  $('xh').classList.toggle('blue', portals.blue.placed);
  $('xh').classList.toggle('orange', portals.orange.placed);
  $('xh').classList.toggle('no-gun', gunMode === 'none');
  $('xh').classList.toggle('blue-only', gunMode === 'blue');
}

// ------------------------------------------------------------------ entrada
const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
window.addEventListener('keydown', (e) => {
  if (KEYS[e.code]) input[KEYS[e.code]] = true;
  if (!running || paused) return;
  if (e.code === 'Space') {
    input.jump = true;
    e.preventDefault();
  }
  if (e.code === 'KeyE') use();
  if (e.code === 'KeyR') loadLevel(levelIdx);
  if (e.code === 'KeyQ') held ? release(true) : shoot('blue');
  if (e.code === 'KeyZ') ZOOM.on = true;
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) input[KEYS[e.code]] = false;
  if (e.code === 'KeyZ') ZOOM.on = false;
  if (e.code === 'Space') input.jump = false;
});
document.addEventListener('mousemove', (e) => {
  // com zoom, a mira fica mais fina (proporcional ao campo de visão)
  const s = camera.fov / 75;
  if (document.pointerLockElement === canvas && running && !paused) {
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
  // segurando um objeto: o botão esquerdo arremessa (e não sai portal)
  if (e.button === 0) held ? release(true) : shoot('blue');
  if (e.button === 2 && !held) shoot('orange');
  if (e.button === 1) {
    e.preventDefault();
    toggleSlowmo();
  }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener(
  'wheel',
  (e) => {
    if (!ZOOM.on || !running || paused) return;
    e.preventDefault();
    ZOOM.level = clamp(ZOOM.level * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1.5, 8);
  },
  { passive: false },
);
// botão do meio não abre a rolagem automática do navegador
window.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());

// ------------------------------------------------------------------ tempo lento (bullet time)
// Botão do meio liga/desliga. Gasta a reserva (segundos de verdade) enquanto
// está ligado; desligado, ela recarrega no mesmo ritmo (6 s gastos voltam em 6 s).
const SLOW = { max: 6, left: 6, on: false, k: 1, beat: 0, warn: 0, scale: 0.28 };
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
  $('room-map-label').textContent = mp() ? 'Mapa da sala (muda para todos):' : 'Mapa:';
  document.body.classList.toggle('playing', locked);
  for (const k of Object.keys(input)) input[k] = false;
});

// ------------------------------------------------------------------ menus
function setAudio(music, voice) {
  sound.setMusic(music);
  narrator.enabled = voice && narrator.available;
  if (!narrator.enabled) narrator.cancel();
  $('opt-music').classList.toggle('on', music);
  $('opt-voice').classList.toggle('on', narrator.enabled);
}

function renderMenu() {
  const grid = $('levels');
  grid.innerHTML = '';
  const groups = [
    ['Laboratório Antípoda', 'as seis câmaras do documentário', (L) => !L.free && !L.series],
    ['Bateria clássica', 'os testes clássicos do gênero, refeitos aqui embaixo', (L) => L.series === 'classic'],
    ['Desafios hardcore', 'salas enormes, plataformas diagonais, pistões — use o tempo lento', (L) => L.series === 'hard'],
    ['Série Momento', 'arremessos encadeados: abra os portais nos painéis diagonais em pleno voo', (L) => L.series === 'momentum'],
    ['Exploração', '', (L) => L.free],
  ];
  for (const [title, sub, pick] of groups) {
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
}

function startLevel(i) {
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
if (!narrator.available) setTimeout(() => !narrator.available && $('opt-voice').classList.remove('on'), 1500);
if (matchMedia('(pointer: coarse)').matches) $('mobile').hidden = false;
renderMenu();

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

function update(dt, t) {
  levelTime += dt;
  world.update(t, dt);
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
    assist.t += dt / 0.5;
    const k = Math.min(assist.t, 1);
    player.pos.lerpVectors(assist.from, assist.to, k * k * (3 - 2 * k));
    player.vel.set(0, 0, 0);
    if (assist.t >= 1) assist = null;
  } else {
    player.update(dt, input, world, portals, gravityAt, (P) => {
      sfx.whoosh();
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
  // aterrissagem e passos
  if (player.grounded && !lastGrounded && Math.abs(lastVy) > 3) {
    sfx.land(Math.abs(lastVy));
    GUN.landV -= Math.min(0.6, Math.abs(lastVy) * 0.03);
  }
  lastGrounded = player.grounded;
  lastVy = player.vel.y;
  if (player.grounded && (input.f || input.b || input.l || input.r)) {
    stepAcc += dt;
    if (stepAcc > 0.42) {
      stepAcc = 0;
      sfx.step();
    }
  }

  // ---- objetos (cubos e torretas): corpos rígidos
  const fwd = camForward();
  const props = [...cubes, ...turrets];
  if (held) {
    const eye = player.eye();
    // alvo na frente da mira (do lado do jogador; o objeto converte para o lado em que estiver)
    held.holdLocal = eye.clone().addScaledVector(fwd, holdDistance(eye, fwd));
    held.holdQuatLocal = new THREE.Quaternion().setFromAxisAngle(UP, player.yaw).multiply(held.holdBase);
  }
  physics.step(
    dt,
    (p, h) => p.pre(h, gravityAt(p.prevCenter)),
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
      dissolver.add(c.mesh, world.hazards.some((h) => touches(c, h)) ? BURN : FIZZLE);
      if (c.kind === 'cube') c.respawn();
      else c.vanish();
      sfx.fizzle();
      continue;
    }
    if (c.pos.y < -300 || c.pos.y > 400) c.kind === 'cube' ? c.respawn() : c.vanish();
  }

  // ---- botões, receptores e portas (sinais)
  const feet = player.pos.clone().addScaledVector(new THREE.Vector3(0, -1, 0), 0.9 * player.upSign);
  const peers = peerFeet();
  for (const b of world.buttons) {
    const near = (p, dy0, dy1) => Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 0.85 && p.y - b.pos.y > dy0 && p.y - b.pos.y < dy1;
    const pressed = props.some((c) => !c.held && !c.gone && !c.remote?.held && near(c.pos, 0, 1.0)) || near(feet, -0.1, 0.5) || peers.some((f) => near(f, -0.1, 0.5));
    if (pressed !== b.pressed) {
      b.pressed = pressed; // a placa e as luzes se animam em world.update
      sfx.click(pressed);
    }
  }
  // uma porta abre quando TODOS os botões/receptores/fornalhas ligados a ela estão ativos
  const sig = new Map();
  const and = (id, v) => id && sig.set(id, (sig.get(id) ?? true) && v);
  for (const b of world.buttons) and(b.opens, b.pressed);
  for (const c of world.catchers) and(c.opens, c.active);
  for (const I of world.incinerators) and(I.opens, I.active);
  for (const d of world.doors) {
    if (d.loop) {
      // plataforma que vai e volta enquanto ligada
      if (!(d.always || sig.get(d.id))) {
        d.target = 0;
        continue;
      }
      if (Math.abs(d.open - d.target) < 1e-4) {
        d.wait -= dt;
        if (d.wait <= 0) {
          d.target = 1 - d.target;
          d.wait = d.waits ? d.waits[d.target] : d.loop;
        }
      }
      continue;
    }
    if (!sig.has(d.id)) continue;
    const target = sig.get(d.id) ? 1 : 0;
    if (d.target !== target) {
      d.target = target;
      sfx.door();
    }
  }

  // ---- grade de desintegração: passar por ela some com os seus portais
  const nowIn = !!world.segmentFizzler(lastPlayerPos, player.pos);
  lastPlayerPos.copy(player.pos);
  if (nowIn && !inFizzler) {
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
      sfx.gun();
      toast(pd.gives === 'blue' ? 'Você pegou a arma de portais (por enquanto, só o portal azul).' : 'Arma completa: agora ela abre os dois portais!');
      updateCrosshair();
    }

  // ---- bolas de energia
  tmpMin.copy(player.pos).sub(player.half);
  tmpMax.copy(player.pos).add(player.half);
  energy.update(dt, t, world, portals, { min: tmpMin.clone(), max: tmpMax.clone() }, {
    launch: () => sfx.launch(),
    bounce: (p) => sfx.bounce(p.distanceTo(player.pos)),
    caught: () => sfx.caught(),
    pop: () => sfx.pop(),
    hitPlayer: () => die(),
  });

  // amostra em cima de um botão acende a janela do núcleo
  for (const c of cubes) {
    const gl = c.mesh.userData.glow;
    if (!gl) continue;
    const on = world.buttons.some((b) => Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) < 0.85 && c.pos.y - b.pos.y > 0 && c.pos.y - b.pos.y < 0.9);
    gl.emissiveIntensity += ((on ? 2.4 : 0.6) - gl.emissiveIntensity) * Math.min(1, dt * 5);
  }

  // ---- torretas
  if (turrets.length) {
    const eye = player.eye();
    let shotsTaken = 0;
    let anySees = false;
    for (const t of turrets) {
      const shots = t.update(dt, world, portals, gravityAt, eye, cubes);
      if (t.spottedNow) anySees = true;
      if (shots) {
        shotsTaken += shots;
        sfx.turretShot(t.pos.distanceTo(eye));
      }
    }
    if (anySees && !spottedOnce) {
      spottedOnce = true;
      playLines([['Marquinho', 'Torreta te viu! Sai da mira dela!']]);
    }
    if (shotsTaken) {
      health -= shotsTaken * 6;
      hurtT = 0;
      hurtFlash = Math.min(1, hurtFlash + 0.25 * shotsTaken);
    } else hurtT += dt;
    if (hurtT > 2.5) health = Math.min(100, health + dt * 30);
    if (health <= 0) die();
    $('health-bar').style.width = `${Math.max(health, 0)}%`;
    $('health').classList.toggle('low', health < 35);
  }
  hurtFlash = Math.max(0, hurtFlash - dt * 1.8);
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
  if (player.pos.y < -400 || world.incinerators.some((f) => inside(player.pos, f.min, f.max))) die();
  for (const tr of world.triggers) {
    if (tr.done || !inside(player.pos, tr.min, tr.max)) continue;
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
      sound.setMood(inTube ? 'ride' : player.upSign < 0 ? 'space' : level.music);
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
    poseWorker(w, t, dt);
  }
  updateDinos(t, dt);
  updateRex(dt);
  const moving = input.f || input.b || input.l || input.r;
  body.P.pose = moving && player.grounded ? 'walk' : 'idle';
  body.P.speed = 4.5;
  poseDino(body, t, dt);
  body.group.position.copy(feet);
  body.group.rotation.set(0, player.yaw + Math.PI, player.upSign < 0 ? Math.PI : 0);

  // ---- arma, rastro, faíscas
  gun.visible = gunMode !== 'none' && ZOOM.k < 1.3;
  animateGun(dt, t);
  tracer.material.opacity = Math.max(0, tracer.material.opacity - dt * 5);
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
  ZOOM.fov = THREE.MathUtils.lerp(ZOOM.fov ?? 75, baseFov, 1 - Math.exp(-dt * (SLOW.on ? 10 : 4)));
  camera.fov = ZOOM.fov / ZOOM.k;
  document.body.classList.toggle('zoomed', ZOOM.k > 1.15);
  $('zoom-v').textContent = `${ZOOM.k.toFixed(1).replace('.', ',')}×`;
  camera.updateProjectionMatrix();
  player.applyCamera(dt, 0);
  // logo depois de um portal a câmera ainda está "chegando": o próprio corpo
  // apareceria colado na vista
  body.group.visible = !player.inTransit;
  deadFlash = Math.max(0, deadFlash - dt * 1.5);
  $('flash').style.opacity = deadFlash;
  $('timer').textContent = fmt(levelTime);
  // dica de "E" quando olhando para um cubo
  const look = rayCube(camera.position, fwd, 2.8);
  $('use-hint').hidden = !(look && !held) && !held;
  $('use-hint').textContent = held ? 'E — soltar · botão esquerdo — arremessar' : 'E — pegar';
}

let realDt = 1 / 60;
// passo manual da simulação (testes automáticos pelo console: __jogo.manual = true; __jogo.step(1/60))
let manualStep = false;
let manualT = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  realDt = dt;
  const t = clock.elapsedTime;
  if (running && level) {
    netTick(dt);
    updateAvatars(dt, t);
    if (manualStep) {
      player.applyCamera(0);
    } else if (!paused && !completed) {
      updateSlowmo(dt);
      update(dt * SLOW.k, t);
    } else if (SLOW.on) toggleSlowmo(false);
    else {
      world.update(t, dt);
      portals.update(t, dt);
      for (const w of npcList) poseWorker(w, t, dt);
      updateDinos(t, dt);
      player.applyCamera(dt);
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
  shadows.update(level ? [...cubes, ...turrets] : [], world, gravityAt);
  motes.userData.update(t, camera, window.innerHeight * renderer.getPixelRatio());
  post.render(dt, t, clamp((1 - SLOW.k) / (1 - SLOW.scale), 0, 1), scene, camera);
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
    update(dt, manualT);
  },
  THREE, post, gun, GUN, dissolver, player, portals, world, physics, energy, SLOW, toggleSlowmo, get turrets() { return turrets; }, get held() { return held; }, get gunMode() { return gunMode; }, loadLevel, get cubes() { return cubes; }, startLevel, sound, shoot, use, input, camera, set paused(v) { paused = v; }, get state() { return { running, paused, completed, levelIdx, levelTime }; } };
