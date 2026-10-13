import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

import { SpaceScene, R, KM, LAYERS, TUNNEL_R, setArrow } from './space.js';
import { GroundScene } from './ground.js';
import { MineScene } from './mine.js';
import { PEOPLE, DESCENT_MILESTONES, DESCENT_ROCKS } from './documentary.js';
import { Soundtrack } from './audio.js';
import { Narrator, narrationFromHtml, spoken } from './narrator.js';
import { FallSim, MODELS, ORBIT, R_EARTH, fmtNum, fmtTime } from './physics.js';
import { Charts } from './charts.js';
import { CHAPTERS, PRESETS } from './chapters.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

// ------------------------------------------------------------------ renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 30000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
$('labels').appendChild(labelRenderer.domElement);

// ------------------------------------------------------------------ texturas
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const tex = (file, srgb = true) => {
  const t = loader.load(`${import.meta.env.BASE_URL}textures/${file}`);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
};
const textures = {
  day: tex('earth_atmos_2048.jpg'),
  night: tex('earth_lights_2048.png'),
  spec: tex('earth_specular_2048.jpg', false),
  clouds: tex('earth_clouds_1024.png', false),
  moon: tex('moon_1024.jpg'),
};

// ------------------------------------------------------------------ cenas
const space = new SpaceScene(renderer, textures);
const ground = new GroundScene(renderer);
const mine = new MineScene();
const sound = new Soundtrack();
const narrator = new Narrator();
narrator.onSpeaking = (on) => sound.duck(on);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let activeScene = 'ground';
const sceneOf = (name) => ({ space: space.scene, ground: ground.scene, mine: mine.scene })[name];

// ------------------------------------------------------------------ pós-processamento
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(ground.scene, camera);
composer.addPass(renderPass);
// profundidade de campo (fundo desfocado) nas entrevistas do documentário
const bokeh = new BokehPass(mine.scene, camera, { focus: 2, aperture: 0.0007, maxblur: 0.011 });
bokeh.enabled = false;
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.55, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 1 }, uAberr: { value: 0.0015 }, uDoc: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uAberr, uDoc; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * uAberr * d * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= mix(1.0, smoothstep(0.85, 0.25, d), 0.55 * uVignette);
      // "look" de documentário: um pouco menos saturado, mais quente e granulado
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), 0.15 * uDoc) * mix(vec3(1.0), vec3(1.04, 1.0, 0.94), uDoc);
      col += (rnd(vUv * 900.0 + fract(uTime)) - 0.5) * (0.035 + 0.03 * uDoc);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finalPass);

// ------------------------------------------------------------------ física
let model = MODELS.uniform;
const sim = new FallSim(model, 0);
const chordSim = new FallSim(model, 0.5 * R_EARTH);
let playing = false;
let simSpeed = 60;
const charts = new Charts({ pos: $('ch-pos'), grav: $('ch-grav'), energy: $('ch-energy'), ramp: $('ch-ramp') });

// ------------------------------------------------------------------ origem do túnel
let origin = { ...PRESETS[0] };
space.setOrigin(origin.lat, origin.lon);

// ------------------------------------------------------------------ rótulos
function makeLabel({ title, sub = '', cls = '', dx = 0, dy = -26 }) {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.innerHTML = `
    <svg width="1" height="1"><line x1="0" y1="0" x2="${dx}" y2="${dy}"/></svg>
    <span class="anchor"></span>
    <div class="box" style="left:${dx}px;top:${dy}px"><b></b><small></small></div>`;
  const obj = new CSS2DObject(el);
  obj.userData.set = (t, s) => {
    const b = el.querySelector('b');
    const sm = el.querySelector('small');
    if (b.textContent !== t) b.textContent = t;
    if (sm.textContent !== s) sm.textContent = s;
    sm.style.display = s ? '' : 'none';
  };
  obj.userData.set(title, sub);
  obj.userData.el = el;
  obj.visible = false;
  return obj;
}

const labels = {};
function addLabel(key, opts, parent = space.scene, pos = new THREE.Vector3()) {
  const l = makeLabel(opts);
  l.position.copy(pos);
  parent.add(l);
  labels[key] = l;
  return l;
}

addLabel('origin', { title: '', sub: 'partida', cls: 'cyan', dx: -40, dy: -48 }, space.pinA);
addLabel('anti', { title: '', sub: 'saída (antípoda)', cls: 'red', dx: 40, dy: -48 }, space.pinB);
addLabel('center', { title: 'Centro da Terra', sub: 'gravidade = 0', cls: 'gold', dx: 70, dy: 60 }, space.scene, new THREE.Vector3(0, 0, 0));
addLabel('scale', { title: 'Túnel e cápsula fora de escala', sub: 'o real seria invisível aqui', dx: -10, dy: -70 }, space.scene, new THREE.Vector3(-R * 0.6, TUNNEL_R, 0));
addLabel('capsule', { title: '', sub: '', cls: 'cap', dx: 0, dy: -44 }, space.capsuleGroup);
addLabel('sat', { title: 'Satélite rasante', sub: 'volta em 84 min', cls: 'gold', dx: 30, dy: -40 }, space.satellite);
addLabel('chord', { title: 'Túnel que NÃO passa pelo centro', sub: '', cls: 'gold', dx: 0, dy: -46 }, space.chordCapsule);
addLabel('shellIn', { title: 'Esta bola te puxa', sub: 'para o centro', cls: 'gold', dx: 60, dy: -40 }, space.scene);
// marcadores de profundidade real (epílogo do documentário)
addLabel('mk_minas', { title: 'Nova Lima (MG)', sub: 'superfície', cls: 'cyan', dx: -70, dy: -60 }, space.scene, space.depthAnchors.surface);
addLabel('mk_mponeng', { title: 'Mina mais funda do mundo', sub: 'Mponeng · ~4 km', cls: 'gold', dx: -20, dy: -95 }, space.scene, space.depthAnchors.mponeng);
addLabel('mk_kola', { title: 'Furo mais fundo já feito', sub: 'Kola · 12,3 km', cls: 'red', dx: 30, dy: -60 }, space.scene, space.depthAnchors.kola);
addLabel('mk_crosta', { title: 'Fim da crosta', sub: '~35 km · faltam 12.707 km', dx: 60, dy: 50 }, space.scene, space.depthAnchors.crust);
addLabel('mk_dot', { title: 'Tudo que a humanidade já cavou cabe neste pontinho', sub: 'faltam ~12.730 km até o outro lado', cls: 'red', dx: -40, dy: -70 }, space.scene, space.depthAnchors.surface);
addLabel('shellOut', { title: 'Esta casca não puxa', sub: 'os puxões se cancelam', dx: -40, dy: -50 }, space.scene);

// rótulos das camadas, ancorados no corte (plano z = 0, metade de cima)
const LAYER_LABEL_LAYOUT = {
  crosta: { ang: 122, dx: -150, dy: -62 },
  litosfera: { ang: 115, dx: -175, dy: -22 },
  astenosfera: { ang: 107, dx: -195, dy: 18 },
  transicao: { ang: 99, dx: -205, dy: 58 },
  mantoInf: { ang: 58, dx: 120, dy: -60 },
  nucleoExt: { ang: 40, dx: 150, dy: -20 },
  nucleoInt: { ang: 25, dx: 160, dy: 30 },
};
const layerLabels = LAYERS.map((L) => {
  const lay = LAYER_LABEL_LAYOUT[L.key];
  const rMid = R - ((L.from + L.to) / 2) * KM;
  const a = THREE.MathUtils.degToRad(lay.ang);
  return addLabel(
    `layer_${L.key}`,
    { title: L.name, sub: `${fmtNum(L.from)}–${fmtNum(L.to)} km · ${L.temp}`, dx: lay.dx, dy: lay.dy },
    space.scene,
    new THREE.Vector3(Math.cos(a) * rMid, Math.sin(a) * rMid, 0.2),
  );
});

// rótulos atrás do planeta ficam apagados (o CSS não sabe o que está na frente)
const _lp = new THREE.Vector3();
function occludeLabels() {
  const c = camera.position;
  for (const key of ['origin', 'anti']) {
    const l = labels[key];
    if (!l.visible) continue;
    if (view.cut < R) {
      l.userData.el.classList.remove('behind');
      continue;
    }
    l.getWorldPosition(_lp);
    const d = _lp.clone().sub(c);
    const t = clamp(-c.dot(d) / d.lengthSq(), 0, 1);
    const closest = c.clone().addScaledVector(d, t);
    l.userData.el.classList.toggle('behind', t < 0.995 && closest.length() < R * 0.97);
  }
}

function showLabels(keys = []) {
  const want = new Set();
  for (const k of keys) {
    if (k === 'layers') LAYERS.forEach((L) => want.add(`layer_${L.key}`));
    else if (k === 'layersMain') ['crosta', 'mantoInf', 'nucleoExt', 'nucleoInt'].forEach((key) => want.add(`layer_${key}`));
    else want.add(k);
  }
  for (const [k, l] of Object.entries(labels)) l.visible = want.has(k);
}

// ------------------------------------------------------------------ câmera
const rig = {
  mode: 'orbit', // orbit | tween | follow | ride
  tween: null,
  followOffset: new THREE.Vector3(),
  rideDir: 1,
  lastCapsule: new THREE.Vector3(),
};

function resolve(v) {
  return typeof v === 'function' ? v() : v;
}

function flyTo({ pos, target, fov = camera.fov, dur = 2.5, arc = activeScene === 'space', then = 'orbit' }) {
  return new Promise((done) => {
    if (dur <= 0.01) {
      camera.position.copy(resolve(pos));
      controls.target.copy(resolve(target));
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      rig.mode = then;
      controls.enabled = then !== 'ride';
      done();
      return;
    }
    rig.mode = 'tween';
    controls.enabled = false;
    rig.tween = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      fromFov: camera.fov,
      pos,
      target,
      fov,
      dur,
      t: 0,
      arc,
      then,
      done,
    };
    document.body.classList.add('bars');
  });
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
function updateTween(dt) {
  const tw = rig.tween;
  tw.t += dt;
  const k = easeInOut(clamp(tw.t / tw.dur, 0, 1));
  const toPos = resolve(tw.pos);
  const toTarget = resolve(tw.target);
  if (tw.arc) {
    const ra = tw.fromPos.length();
    const rb = toPos.length();
    _a.copy(tw.fromPos).normalize();
    _b.copy(toPos).normalize();
    const ang = _a.angleTo(_b);
    _q.setFromUnitVectors(_a, _b);
    const qk = new THREE.Quaternion().slerp(_q, k);
    const r = THREE.MathUtils.lerp(ra, rb, k) + Math.sin(Math.PI * k) * (ang / Math.PI) * 0.45 * Math.max(ra, rb);
    camera.position.copy(_a).applyQuaternion(qk).multiplyScalar(r);
  } else {
    camera.position.lerpVectors(tw.fromPos, toPos, k);
  }
  controls.target.lerpVectors(tw.fromTarget, toTarget, k);
  camera.fov = THREE.MathUtils.lerp(tw.fromFov, tw.fov, k);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  if (tw.t >= tw.dur) {
    rig.tween = null;
    rig.mode = tw.then;
    if (rig.mode === 'follow') rig.followOffset.copy(camera.position).sub(controls.target);
    controls.enabled = rig.mode !== 'ride';
    setTimeout(() => {
      if (rig.mode !== 'tween' && rig.mode !== 'ride' && !document.body.classList.contains('cinema'))
        document.body.classList.remove('bars');
    }, 400);
    tw.done();
  }
}

const capsulePos = () => new THREE.Vector3((sim.s / R_EARTH) * R, 0, 0);

function updateCamera(dt) {
  if (rig.mode === 'descent') updateDescent(dt, clock.elapsedTime);
  else if (rig.mode === 'tween') updateTween(dt);
  else if (rig.mode === 'follow') {
    const p = capsulePos();
    const delta = p.clone().sub(rig.lastCapsule);
    camera.position.add(delta);
    controls.target.add(delta);
    controls.target.lerp(p, 1 - Math.exp(-dt * 4));
  } else if (rig.mode === 'ride') {
    const p = capsulePos();
    if (Math.abs(sim.v) > 5) rig.rideDir = Math.sign(sim.v);
    const speedFrac = Math.abs(sim.v) / model.vmax;
    camera.position.copy(p);
    camera.position.y += Math.sin(clock.elapsedTime * 1.3) * 0.25 + (Math.random() - 0.5) * 0.05 * speedFrac;
    camera.position.z += Math.cos(clock.elapsedTime * 0.9) * 0.25;
    const look = new THREE.Vector3(p.x + rig.rideDir * 60, 0, 0);
    const m = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    camera.quaternion.slerp(q, 1 - Math.exp(-dt * 2.2));
    camera.fov = damp(camera.fov, 62 + 38 * speedFrac, 3, dt);
    camera.updateProjectionMatrix();
  }
  rig.lastCapsule.copy(capsulePos());
}

// ------------------------------------------------------------------ estado da cena "espaço"
const view = {
  cut: 0,
  cutTarget: 0,
  tunnelTarget: 0,
  capsule: false,
  gArrow: false,
  vArrow: false,
  field: false,
  shell: false,
  shellMix: 0,
  satellite: false,
  chord: false,
  through: false,
  pins: false,
  layerTour: false,
  ramp: false,
};
const CUT_CLOSED = R * 1.05;

// ------------------------------------------------------------------ UI: cartão e capítulos
let current = -1;
let busy = false;

const dotsEl = $('dots');
CHAPTERS.forEach((ch, i) => {
  const b = document.createElement('button');
  b.title = `${ch.kicker}: ${ch.title}`;
  if (ch.part === 'doc') b.classList.add('doc');
  b.addEventListener('click', () => goTo(i));
  dotsEl.appendChild(b);
});

function ctx() {
  const kmh = (v) => fmtNum(Math.round((v * 3.6) / 100) * 100);
  return {
    originName: origin.name,
    antiName: origin.anti,
    speed: simSpeed,
    vmaxKmh: kmh(model.vmax),
    vmaxSound: Math.round(model.vmax / 343),
    tOneWay: Math.round(model.halfPeriod / 60),
    tOneWayUni: Math.round(MODELS.uniform.halfPeriod / 60),
    tOneWayPrem: Math.round(MODELS.prem.halfPeriod / 60),
    vmaxUniKmh: kmh(MODELS.uniform.vmax),
    vmaxPremKmh: kmh(MODELS.prem.vmax),
  };
}

function renderCard(ch, i, animate = true) {
  const card = $('card');
  const fill = () => {
    $('card-kicker').textContent = ch.kicker;
    $('card-title').textContent = ch.title;
    $('card-body').innerHTML = ch.body(ctx());
    $('card-count').textContent = `${i + 1} / ${CHAPTERS.length}`;
    $('prev').disabled = i === 0;
    $('next').disabled = i === CHAPTERS.length - 1;
    $('next').textContent = ch.next ? `${ch.next} →` : i === CHAPTERS.length - 1 ? 'Fim' : 'Próximo →';
    $('explore-panel').hidden = !ch.explore;
    [...dotsEl.children].forEach((d, k) => {
      d.classList.toggle('active', k === i);
      d.classList.toggle('done', k < i);
    });
  };
  if (!animate) return fill();
  card.classList.add('swap');
  setTimeout(() => {
    fill();
    card.classList.remove('swap');
  }, 350);
}

function refreshCardText() {
  if (current >= 0) $('card-body').innerHTML = CHAPTERS[current].body(ctx());
}

function fade(on) {
  $('fade').classList.toggle('on', on);
  return new Promise((r) => setTimeout(r, on ? 950 : 50));
}

function switchScene(name) {
  activeScene = name;
  renderPass.scene = sceneOf(name);
  bloom.strength = name === 'space' ? 0.45 : name === 'mine' ? 0.3 : 0.2;
  bloom.threshold = name === 'space' ? 0.92 : name === 'mine' ? 0.95 : 0.97;
  if (name !== 'mine') bokeh.enabled = false;
  if (name === 'mine') {
    controls.minDistance = 0.6;
    controls.maxDistance = 900;
    controls.maxPolarAngle = Math.PI * 0.5;
  } else if (name === 'ground') {
    controls.minDistance = 2;
    controls.maxDistance = 140;
    controls.maxPolarAngle = Math.PI * 0.49;
  } else {
    controls.minDistance = 6;
    controls.maxDistance = 2200;
    controls.maxPolarAngle = Math.PI;
  }
}

async function goTo(i) {
  i = clamp(i, 0, CHAPTERS.length - 1);
  if (busy || i === current) return;
  busy = true;
  const prev = CHAPTERS[current];
  const ch = CHAPTERS[i];
  const fromIdx = current;
  current = i;
  history.replaceState(null, '', i > 0 ? `#${i}` : location.pathname);
  renderCard(ch, i, fromIdx >= 0);

  try {
    if (fromIdx < 0) {
      switchScene(ch.scene);
      applyChapter(ch, { instant: true });
    } else if (prev.scene !== ch.scene) {
      if (prev.scene === 'ground' && ch.scene === 'space') {
        await diveIntoHole();
        await fade(true);
        switchScene('space');
        // começa colado na superfície, no ponto de partida, e se afasta
        camera.position.set(-R - 7, 4, 6);
        controls.target.set(-R, 0, 0);
        camera.fov = 50;
        camera.updateProjectionMatrix();
        applyChapter(ch, { dur: 4.5 });
        await fade(false);
      } else {
        await fade(true);
        setRide(false);
        leaveDescent();
        switchScene(ch.scene);
        applyChapter(ch, { instant: ch.scene === 'ground', stateInstant: true, cut: true });
        await fade(false);
      }
    } else if (prev.camMode === 'ride' || ch.camMode === 'ride' || prev.descent || ch.descent) {
      await fade(true);
      if (prev.descent) {
        leaveDescent();
        camera.position.set(34, 6, 44);
        controls.target.set(0, -14, 0);
      }
      if (prev.camMode === 'ride') {
        setRide(false);
        // sai do túnel já "de fora", para a viagem de câmera não atravessar a rocha
        const c = ch.cam ? new THREE.Vector3(...ch.cam.pos).multiplyScalar(1.35) : new THREE.Vector3(0, 150, 400);
        camera.position.copy(c);
        controls.target.set(0, 0, 0);
      }
      applyChapter(ch, { cut: true });
      await fade(false);
    } else {
      applyChapter(ch, {});
    }
  } finally {
    busy = false;
  }
}

async function diveIntoHole() {
  document.body.classList.add('bars');
  sound.setWhoosh(0.25);
  setTimeout(() => sound.setWhoosh(0.8), 2200);
  setTimeout(() => sound.setWhoosh(0), 5200);
  await flyTo({ pos: new THREE.Vector3(1.5, 16, 2.5), target: new THREE.Vector3(0, -30, 0), fov: 55, dur: 2.2, arc: false, then: 'hold' });
  await flyTo({ pos: new THREE.Vector3(0, -90, 0.3), target: new THREE.Vector3(0, -260, 0), fov: 75, dur: 2.4, arc: false, then: 'hold' });
}

function setRide(on) {
  $('ride-hud').hidden = !on;
  document.body.classList.toggle('bars', on);
  $('hint').hidden = on;
  if (!on && rig.mode === 'ride') rig.mode = 'orbit';
}

// ------------------------------------------------------------------ documentário
const descent = { t: 0, depth: 5, passed: new Set(), T: 44 };
function leaveDescent() {
  mine.setDescent(false);
  $('descent-hud').hidden = true;
  if (rig.mode === 'descent') rig.mode = 'orbit';
}

const mineLabels = {};
const MINE_LABEL_TEXT = {
  headframe: ['Torre de extração', 'polias levam o cabo do poço ao guincho'],
  winch: ['Casa do guincho', 'o tambor enrola o cabo de aço'],
  rig: ['Sonda com trado', 'perfuração rotativa'],
  crane: ['Guindaste de esteira', 'iça trados, tubos e ferramentas'],
  excavator: ['Escavadeira hidráulica', 'carrega os caminhões na bancada'],
  trucks: ['Caminhões fora de estrada', '~30 t de rocha por viagem'],
  vent: ['Ventilação', 'duto leva ar fresco ao fundo do poço'],
  benches: ['Bancadas', 'degraus de 6 m: a parede não desaba'],
  office: ['Escritório da obra', 'e, ao lado, a cozinha da Dona Cida'],
  blast: ['Frente de desmonte', 'furos carregados com explosivo'],
  shaft: ['Poço principal', '10 m de diâmetro, revestido de concreto'],
};
for (const [key, [t, sub]] of Object.entries(MINE_LABEL_TEXT)) {
  const l = makeLabel({ title: t, sub, cls: 'gold', dx: 0, dy: -40 });
  l.position.copy(mine.anchors[key]);
  mine.scene.add(l);
  mineLabels[key] = l;
}

let titleTimer = null;
function moodFor(ch) {
  if (ch.scene === 'ground') return 'ground';
  if (ch.descent) return 'descent';
  if (ch.scene === 'mine') return 'doc';
  if (ch.camMode === 'ride') return 'ride';
  return 'space';
}

function applyDoc(ch) {
  sound.setMood(moodFor(ch));
  if (!ch.descent) sound.setRumble(0);
  const isDoc = ch.part === 'doc';
  document.body.classList.toggle('doc', isDoc);
  finalPass.uniforms.uDoc.value = isDoc ? 1 : 0;
  $('rec').hidden = !isDoc;
  for (const [k, l] of Object.entries(mineLabels)) l.visible = !!ch.mineLabels?.includes(k);
  if (!ch.interview) bokeh.enabled = false;
  if (!ch.descent) leaveDescent();

  // cartela de título
  clearTimeout(titleTimer);
  const tc = $('doc-title');
  if (ch.titleCard) {
    const [a, b, c] = ch.titleCard;
    tc.innerHTML = `<small>${a}</small><b>${b}</b><span>${c}</span>`;
    tc.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => tc.classList.add('show')));
    titleTimer = setTimeout(() => {
      tc.classList.remove('show');
      titleTimer = setTimeout(() => (tc.hidden = true), 1200);
    }, 4200);
  } else {
    tc.classList.remove('show');
    tc.hidden = true;
  }

  // crédito do entrevistado ("lower third")
  const lt = $('lower-third');
  if (ch.interview) {
    const p = PEOPLE[ch.interview];
    lt.innerHTML = `<b>${p.name}, ${p.age}</b><span>${p.role}</span><small>${p.city} (MG) · ${p.years}</small>`;
    lt.hidden = false;
    lt.classList.remove('show');
    setTimeout(() => lt.classList.add('show'), 900);
  } else {
    lt.classList.remove('show');
    lt.hidden = true;
  }

  // legendas + vozes (ou, sem legendas, o narrador lê o cartão)
  playSubs(ch);
}

let subsRun = 0;
async function playSubs(ch) {
  const run = ++subsRun;
  narrator.cancel();
  const subs = $('subs');
  subs.classList.remove('show');
  if (!ch.subs?.length) {
    await sleep(ch.scene === 'space' && current > 0 ? 1600 : 900);
    if (run === subsRun) narrator.speak(narrationFromHtml(ch.body(ctx())));
    return;
  }
  await sleep(ch.titleCard ? 4600 : 1300);
  const minGap = ch.descent ? 8000 : 2600;
  for (const [who, text] of ch.subs) {
    if (run !== subsRun) return;
    subs.innerHTML = `<span class="who">${who}</span>${text}`;
    subs.classList.add('show');
    // a explosão acontece junto com o grito de "FOGO!"
    if (ch.blast && /^FOGO/.test(text)) doBlast();
    const t0 = performance.now();
    const spokenOk = await narrator.speak(spoken(text), who);
    const minMs = spokenOk ? minGap * 0.5 : Math.max(minGap, text.length * 70);
    const left = minMs - (performance.now() - t0);
    if (left > 0) await sleep(left);
    if (run !== subsRun) return;
    subs.classList.remove('show');
    await sleep(350);
  }
}

let shake = 0;
function doBlast() {
  mine.triggerBlast();
  sound.boom();
  shake = 1;
}

function renderMilestones() {
  $('d-list').innerHTML = DESCENT_MILESTONES.map((m, i) => `<li data-i="${i}">${m.text}</li>`).join('');
}

function updateDescent(dt, t) {
  descent.t += dt;
  const k = clamp(descent.t / descent.T, 0, 1);
  const e = k * k * k * (k * (k * 6 - 15) + 10);
  const depth = 5 + (3900 - 5) * e;
  const speed = (depth - descent.depth) / Math.max(dt, 1e-3);
  descent.depth = depth;
  const y = mine.updateDescent(depth, speed);
  sound.setIntensity(depth / 3900);
  sound.setRumble(Math.min(speed / 260, 1) * 0.8 + 0.1);
  const bob = Math.sin(t * 2.3) * 0.02 * (1 + speed / 120);
  camera.position.set(Math.sin(t * 0.4) * 0.12, y + 1.58 + bob, 1.3);
  camera.lookAt(Math.sin(t * 0.27) * 0.4, y + 1.3, -5);
  camera.fov = damp(camera.fov, 60 + Math.min(speed / 40, 12), 2, dt);
  camera.updateProjectionMatrix();

  const rock = DESCENT_ROCKS.find((r) => depth < r.to).name;
  const temp = 22 + 20 * (depth / 1000);
  const atm = 1 + 265 * (depth / 1000);
  $('d-depth').textContent = fmtNum(Math.round(depth));
  $('d-rock').textContent = rock;
  $('d-temp').textContent = `${fmtNum(Math.round(temp))} °C`;
  $('d-press').textContent = `${fmtNum(Math.round(atm))} atm`;
  $('d-left').textContent = `${fmtNum(12742 - depth / 1000, 1)} km`;
  $('d-pct').textContent = `${fmtNum((depth / 12742000) * 100, 3)}%`;
  $('d-bar').style.width = `${Math.max((depth / 12742000) * 100, 0.4)}%`;
  DESCENT_MILESTONES.forEach((m, i) => {
    if (depth >= m.d && !descent.passed.has(i)) {
      descent.passed.add(i);
      $('d-list').querySelector(`[data-i="${i}"]`)?.classList.add('passed');
    }
  });
}

function applyChapter(ch, { instant = false, stateInstant = instant, dur, cut = false } = {}) {
  // ---- cena
  if (ch.scene === 'space') {
    view.cutTarget = ch.cut ? 0 : CUT_CLOSED;
    view.tunnelTarget = ch.tunnel ? 1 : 0;
    view.capsule = !!ch.capsule;
    view.gArrow = !!ch.gArrow;
    view.vArrow = !!ch.vArrow;
    view.field = !!ch.field;
    view.shell = !!ch.shell;
    view.satellite = !!ch.satellite;
    view.chord = !!ch.chord;
    view.through = !!ch.through;
    view.pins = !!ch.pins;
    view.layerTour = !!ch.layerTour;
    view.ramp = !!ch.ramp;
    if (stateInstant) {
      view.cut = view.cutTarget;
      space.setTunnelProgress(view.tunnelTarget);
    }
    space.depthMarkers.visible = !!ch.depthMarkers;
    showLabels(ch.labels);
    layerTourT = 0;
  }

  if (ch.forceModel && model.id !== ch.forceModel) {
    setModel(MODELS[ch.forceModel]);
    toast(`Modelo trocado para: ${model.name}`);
  }

  // ---- simulação
  const s = ch.sim;
  if (s) {
    if (s.speed) setSpeed(s.speed);
    if (s.mode === 'reset-pause') {
      resetSim();
      setPlaying(false);
    } else if (s.mode === 'reset-run') {
      resetSim();
      setPlaying(true);
    } else if (s.mode === 'run') {
      setPlaying(true);
    } else if (s.mode === 'jump') {
      resetSim();
      const t = s.at * model.halfPeriod;
      sim.step(t);
      chordSim.step(t);
      charts.clearHistory();
      setPlaying(true);
    }
  }

  // ---- interface
  const showHud = !!ch.hud && ch.camMode !== 'ride';
  $('hud').hidden = !showHud;
  $('block-ramp').hidden = !ch.ramp;
  $('block-pos').hidden = !!ch.ramp;
  $('simbar').hidden = !ch.sim;
  controls.autoRotate = !!ch.autoRotate;
  controls.autoRotateSpeed = 0.35;
  if (ch.explore) {
    exploreCam = 'orbit';
    $('btn-cam').textContent = 'Câmera: livre';
    $('btn-cut').classList.toggle('on', true);
  } else space.setPick(null);

  applyDoc(ch);
  camera.near = ch.near ?? 0.05;
  camera.far = ch.near ? 12000 : 30000;
  camera.updateProjectionMatrix();

  // ---- câmera
  let d = instant ? 0 : dur ?? ch.cam?.dur ?? 2.5;
  if (ch.camFrom && (instant || cut)) {
    // plano de abertura: começa num ponto e viaja até o enquadramento do capítulo
    camera.position.set(...ch.camFrom);
    controls.target.set(...(ch.camFromTarget ?? ch.cam.target));
    camera.lookAt(controls.target);
    d = ch.cam.dur;
  }
  if (ch.descent) {
    rig.mode = 'descent';
    controls.enabled = false;
    descent.t = 0;
    descent.depth = 5;
    descent.passed = new Set();
    mine.setDescent(true);
    $('descent-hud').hidden = false;
    renderMilestones();
    document.body.classList.add('bars');
    return;
  }
  if (ch.interview) {
    const shot = mine.interviewShot(ch.interview);
    mine.setTalking(ch.interview, shot.pos);
    bokeh.enabled = true;
    flyTo({ pos: shot.pos, target: shot.target, fov: 30, dur: instant || cut ? 0 : 2.8, arc: false, then: 'orbit' });
    return;
  }
  if (ch.scene === 'mine') mine.setTalking(null);
  if (ch.camMode === 'ride') {
    setRide(true);
    rig.mode = 'ride';
    controls.enabled = false;
    camera.position.copy(capsulePos());
    camera.lookAt(capsulePos().add(new THREE.Vector3(60, 0, 0)));
    rig.rideDir = 1;
    return;
  }
  setRide(false);
  if (ch.camMode === 'follow') {
    const off = new THREE.Vector3(...ch.followOffset);
    flyTo({ pos: () => capsulePos().add(off), target: capsulePos, fov: ch.cam.fov, dur: d, then: 'follow' });
  } else {
    flyTo({ pos: new THREE.Vector3(...ch.cam.pos), target: new THREE.Vector3(...ch.cam.target), fov: ch.cam.fov, dur: d, then: 'orbit' });
  }
}

// ------------------------------------------------------------------ simulação: controles
const SPEEDS = [1, 10, 30, 60, 120, 300];
const speedSeg = $('sim-speed');
SPEEDS.forEach((s) => {
  const b = document.createElement('button');
  b.textContent = `${s}×`;
  b.title = s === 1 ? 'Tempo real (a viagem leva mais de meia hora!)' : `${s} vezes mais rápido que o real`;
  b.addEventListener('click', () => setSpeed(s));
  b.dataset.v = s;
  speedSeg.appendChild(b);
});
const modelSeg = $('sim-model');
Object.values(MODELS).forEach((m) => {
  const b = document.createElement('button');
  b.textContent = m.short;
  b.title = m.name;
  b.dataset.v = m.id;
  b.addEventListener('click', () => {
    setModel(m);
    toast(`${m.name}: ida em ${fmtTime(m.halfPeriod)} min, pico de ${fmtNum(Math.round(m.vmax * 3.6))} km/h`);
  });
  modelSeg.appendChild(b);
});

function setSpeed(s) {
  simSpeed = s;
  [...speedSeg.children].forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === s));
}
function setModel(m) {
  model = m;
  sim.setModel(m);
  chordSim.setModel(m);
  [...modelSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.v === m.id));
  refreshCardText();
}
function setPlaying(p) {
  playing = p;
  $('sim-play').textContent = p ? '❚❚' : '▶';
}
function resetSim() {
  sim.reset();
  chordSim.reset();
  charts.clearHistory();
}
$('sim-play').addEventListener('click', () => setPlaying(!playing));
$('sim-reset').addEventListener('click', () => {
  resetSim();
  setPlaying(true);
});
setSpeed(simSpeed);
setModel(model);

// ------------------------------------------------------------------ explorar: antípodas
let exploreCam = 'orbit';
let pickPoint = null;
const specData = { data: null, w: 0, h: 0 };
function isWater(lat, lon) {
  if (!specData.data) {
    const img = textures.spec.image;
    if (!img) return null;
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 512;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, cv.width, cv.height);
    specData.data = g.getImageData(0, 0, cv.width, cv.height).data;
    specData.w = cv.width;
    specData.h = cv.height;
  }
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const x = clamp(Math.floor(u * specData.w), 0, specData.w - 1);
  const y = clamp(Math.floor(v * specData.h), 0, specData.h - 1);
  return specData.data[(y * specData.w + x) * 4] > 100;
}
const fmtLat = (lat) => `${fmtNum(Math.abs(lat), 1)}° ${lat >= 0 ? 'N' : 'S'}`;
const fmtLon = (lon) => `${fmtNum(Math.abs(lon), 1)}° ${lon >= 0 ? 'L' : 'O'}`;
const where = (lat, lon) => (isWater(lat, lon) ? '🌊 oceano' : '⛰️ terra firme');

const presetsEl = $('presets');
PRESETS.forEach((p) => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = p.name;
  b.addEventListener('click', () => digFrom(p));
  presetsEl.appendChild(b);
});

function digFrom(p) {
  origin = { ...p };
  space.setOrigin(p.lat, p.lon);
  space.setPick(null);
  pickPoint = null;
  $('btn-dig').disabled = true;
  resetSim();
  setPlaying(true);
  $('pick-info').innerHTML = `Túnel cavado em <b>${p.name}</b> (${fmtLat(p.lat)}, ${fmtLon(p.lon)}).<br>Saída: <b>${p.anti}</b>.`;
  refreshCardText();
  view.tunnelTarget = 1;
  // mostra o ponto de partida
  flyTo({ pos: new THREE.Vector3(-230, 110, 190), target: new THREE.Vector3(0, 0, 0), fov: 42, dur: 2.2 });
}

const down = new THREE.Vector2();
canvas.addEventListener('pointerdown', (e) => down.set(e.clientX, e.clientY));
canvas.addEventListener('pointerup', (e) => {
  if (current < 0 || !CHAPTERS[current].explore || activeScene !== 'space') return;
  if (down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 5) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(space.pickSphere)[0];
  if (!hit) return;
  // clique dentro do corte (a superfície ali foi "removida"): ignora
  const cutY = space.u.uCutY.value;
  if (hit.point.y > cutY && hit.point.z > 0) {
    $('pick-info').textContent = 'Esse pedaço foi cortado para mostrar o interior — clique na superfície (a parte azul e verde).';
    return;
  }
  pickPoint = hit.point.clone();
  space.setPick(pickPoint);
  const a = space.sceneToGeo(pickPoint);
  const b = { lat: -a.lat, lon: a.lon > 0 ? a.lon - 180 : a.lon + 180 };
  $('pick-info').innerHTML = `
    Ponto escolhido: <b>${fmtLat(a.lat)}, ${fmtLon(a.lon)}</b> (${where(a.lat, a.lon)})<br>
    Antípoda: <b>${fmtLat(b.lat)}, ${fmtLon(b.lon)}</b> → sairia em <b>${where(b.lat, b.lon)}</b>`;
  $('btn-dig').disabled = false;
});
$('btn-dig').addEventListener('click', () => {
  if (!pickPoint) return;
  const a = space.sceneToGeo(pickPoint);
  const b = { lat: -a.lat, lon: a.lon > 0 ? a.lon - 180 : a.lon + 180 };
  digFrom({
    name: 'Ponto escolhido',
    lat: a.lat,
    lon: a.lon,
    anti: `${where(b.lat, b.lon).replace(/^\S+ /, '')} em ${fmtLat(b.lat)}, ${fmtLon(b.lon)}`,
  });
});
$('btn-cut').addEventListener('click', (e) => {
  const on = view.cutTarget < R;
  view.cutTarget = on ? CUT_CLOSED : 0;
  e.currentTarget.classList.toggle('on', !on);
});
$('btn-cam').addEventListener('click', (e) => {
  const order = ['orbit', 'follow', 'ride'];
  const names = { orbit: 'livre', follow: 'seguir cápsula', ride: 'primeira pessoa' };
  exploreCam = order[(order.indexOf(exploreCam) + 1) % order.length];
  e.currentTarget.textContent = `Câmera: ${names[exploreCam]}`;
  if (exploreCam === 'ride') {
    setRide(true);
    rig.mode = 'ride';
    controls.enabled = false;
    $('hud').hidden = true;
  } else if (exploreCam === 'follow') {
    setRide(false);
    $('hud').hidden = false;
    controls.enabled = true;
    camera.position.copy(capsulePos()).add(new THREE.Vector3(20, 25, 70));
    controls.target.copy(capsulePos());
    camera.fov = 45;
    camera.updateProjectionMatrix();
    rig.mode = 'follow';
    rig.followOffset.set(20, 25, 70);
  } else {
    setRide(false);
    controls.enabled = true;
    flyTo({ pos: new THREE.Vector3(-170, 120, 240), target: new THREE.Vector3(0, 0, 0), fov: 42, dur: 2 });
  }
});

// ------------------------------------------------------------------ botões gerais / teclado
$('next').addEventListener('click', () => goTo(current + 1));
$('prev').addEventListener('click', () => goTo(current - 1));
$('btn-labels').addEventListener('click', (e) => {
  document.body.classList.toggle('labels-off');
  e.currentTarget.classList.toggle('on', !document.body.classList.contains('labels-off'));
});
function toggleCinema() {
  const on = document.body.classList.toggle('cinema');
  $('btn-cinema').classList.toggle('on', on);
  document.body.classList.toggle('bars', on || rig.mode === 'ride');
  if (on) toast('Modo cinema — aperte H ou Esc para voltar');
}
$('btn-cinema').addEventListener('click', toggleCinema);
$('btn-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(current + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(current - 1);
  else if (e.key === ' ') {
    e.preventDefault();
    if (CHAPTERS[current]?.sim) setPlaying(!playing);
  } else if (e.key === 'r' || e.key === 'R') {
    resetSim();
    setPlaying(true);
  } else if (e.key === 'h' || e.key === 'H') toggleCinema();
  else if (e.key === 'Escape' && document.body.classList.contains('cinema')) toggleCinema();
  else if (e.key === 'l' || e.key === 'L') $('btn-labels').click();
  else if (e.key === 'f' || e.key === 'F') $('btn-full').click();
});

let toastEl;
let toastTimer;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let layerTourT = 0;

function updateSpace(dt, t) {
  // física
  if (playing) {
    const simDt = Math.min(dt, 0.1) * simSpeed;
    sim.step(simDt);
    if (view.chord) chordSim.step(simDt);
    else chordSim.t = sim.t;
  }
  charts.push(sim.t, sim.s / sim.L);

  // corte e túnel
  view.cut = damp(view.cut, view.cutTarget, 1.6, dt);
  space.u.uCutY.value = view.cut < 0.05 ? 0 : view.cut;
  const tp = space.tunnelProgress;
  let nextTp = tp;
  if (view.tunnelTarget > tp) nextTp = Math.min(tp + dt / 2.2, view.tunnelTarget);
  else if (view.tunnelTarget < tp) nextTp = Math.max(tp - dt / 1.2, view.tunnelTarget);
  if (nextTp !== tp) space.setTunnelProgress(nextTp);

  // cápsula
  const p = capsulePos();
  const tunnelReady = space.tunnelProgress > 0.995;
  space.capsuleGroup.position.copy(p);
  space.capsuleGroup.visible = view.capsule && tunnelReady && rig.mode !== 'ride';
  const vFrac = Math.abs(sim.v) / model.vmax;
  if (Math.abs(sim.v) > 1) space.capsuleGroup.rotation.y = sim.v < 0 ? Math.PI : 0;
  space.trail.scale.set(Math.max(vFrac * 28, 0.01), 1, 1);
  space.trail.material.uniforms.uAlpha.value = vFrac * 0.9;
  space.capsuleBody.rotation.x += dt * 0.4; // gira devagar (está flutuando)

  const showArrows = space.capsuleGroup.visible;
  space.gArrow.visible = view.gArrow && showArrows && Math.abs(sim.s) > R_EARTH * 0.01;
  if (space.gArrow.visible) setArrow(space.gArrow, p.clone().add(new THREE.Vector3(0, 6.5, 0)), -Math.sign(sim.s), (sim.g / 10) * 18);
  space.vArrow.visible = view.vArrow && showArrows && vFrac > 0.02;
  if (space.vArrow.visible) setArrow(space.vArrow, p.clone().add(new THREE.Vector3(0, -6.5, 0)), Math.sign(sim.v), vFrac * 24);

  // som: vento dentro da cápsula (só em primeira pessoa)
  if (rig.mode === 'ride') {
    sound.setIntensity(vFrac);
    sound.setWhoosh(playing ? vFrac : 0);
  } else sound.setWhoosh(0);

  // campo de gravidade ao longo do túnel
  space.field.visible = view.field && tunnelReady;
  if (space.field.visible) space.updateFieldArrows(model);

  // teorema das cascas
  const rScene = (sim.r / R_EARTH) * R;
  view.shellMix = damp(view.shellMix, view.shell ? 1 : 0, 2.5, dt);
  space.u.uHighlightMix.value = view.shellMix;
  space.u.uHighlightR.value = rScene;
  space.shell.visible = view.shellMix > 0.02 && rScene > 1;
  space.shell.scale.setScalar(Math.max(rScene, 0.01));
  if (labels.shellIn.visible) labels.shellIn.position.set(rScene * 0.35, rScene * 0.6, 0.3);
  if (labels.shellOut.visible) {
    const rm = (rScene + R) / 2;
    labels.shellOut.position.set(Math.cos(2.1) * rm, Math.sin(2.1) * rm, 0.3);
    labels.shellOut.userData.el.classList.toggle('hidden', R - rScene < 6);
  }

  // satélite (órbita rasante no plano XY)
  space.satellite.visible = view.satellite;
  space.orbitLine.visible = view.satellite;
  space.projLine.visible = view.satellite && tunnelReady;
  if (view.satellite) {
    const th = ORBIT.omega * sim.t;
    const sp = new THREE.Vector3(-Math.cos(th) * R * 1.04, Math.sin(th) * R * 1.04, 0);
    space.satellite.position.copy(sp);
    space.satellite.rotation.z = th;
    space.projLine.geometry.setFromPoints([sp, p]);
    space.projLine.computeLineDistances();
  }

  // túnel em corda
  space.chordGroup.visible = view.chord && tunnelReady;
  if (space.chordGroup.visible) space.chordCapsule.position.x = (chordSim.s / R_EARTH) * R;

  // marcadores
  space.placePin(space.pinA, new THREE.Vector3(-R, 0, 0));
  space.placePin(space.pinB, new THREE.Vector3(R, 0, 0));
  space.pinA.visible = space.pinB.visible = view.pins || view.through;
  space.throughLine.visible = view.through;
  space.mouthA.visible = space.tunnelProgress > 0.01;

  // passeio pelas camadas
  if (view.layerTour) {
    layerTourT += dt;
    const step = 2.6;
    const n = LAYERS.length;
    const k = Math.floor(layerTourT / step) % (n + 2);
    const focus = k < n && layerTourT > 3 ? k : -1;
    space.u.uLayerFocus.value = focus;
    layerLabels.forEach((l, i) => {
      l.userData.el.classList.toggle('focus', focus === i);
      l.userData.el.classList.toggle('dim', focus >= 0 && focus !== i);
    });
  } else {
    space.u.uLayerFocus.value = -1;
    layerLabels.forEach((l) => l.userData.el.classList.remove('focus', 'dim'));
  }

  // textos dos rótulos
  labels.origin.userData.set(origin.name, 'partida');
  labels.anti.userData.set(origin.anti, 'saída (antípoda)');
  labels.capsule.userData.set(`${fmtNum(Math.abs(sim.v) * 3.6)} km/h`, `g = ${fmtNum(sim.g, 1)} m/s²`);
  if (view.chord) labels.chord.userData.set('Túnel que NÃO passa pelo centro', `${fmtNum(Math.abs(chordSim.v) * 3.6)} km/h · ${fmtTime(chordSim.t)}`);

  // epílogo: rótulos detalhados só de perto; de longe, um rótulo só
  if (space.depthMarkers.visible) {
    const near = camera.position.distanceTo(space.depthAnchors.surface) < 7;
    for (const k of ['mk_minas', 'mk_mponeng', 'mk_kola', 'mk_crosta']) labels[k].visible = near;
    labels.mk_dot.visible = !near;
  } else labels.mk_dot.visible = false;
  occludeLabels();
  space.update(t);
}

function phaseText() {
  const f = sim.s / sim.L;
  const slow = Math.abs(sim.v) < 60;
  if (sim.t < 1) return 'pronto para pular';
  if (f > 0.985 && slow) return 'chegou do outro lado!';
  if (f < -0.985 && slow) return 'voltou ao ponto de partida';
  if (Math.abs(f) < 0.03) return 'passando pelo centro!';
  return sim.v * sim.s < 0 ? 'acelerando ↓' : 'freando ↑';
}

let hudTick = 0;
function updateHud(dt) {
  hudTick += dt;
  const ch = CHAPTERS[current];
  if (!ch || activeScene !== 'space') return;
  const kmh = fmtNum(Math.abs(sim.v) * 3.6);
  const depth = fmtNum(Math.max(sim.depth / 1000, 0));
  const g = fmtNum(sim.g, 1);
  if (!$('hud').hidden) {
    $('h-time').textContent = fmtTime(sim.t);
    $('h-trip').textContent = phaseText();
    $('h-speed').textContent = kmh;
    $('h-depth').textContent = depth;
    $('h-g').textContent = g;
    charts.drawGravity(sim);
    charts.drawEnergy(sim);
    if (view.ramp) charts.drawRamp(sim);
    else charts.drawPosition(sim);
    let extra = '';
    if (view.satellite) {
      const satX = -Math.cos(ORBIT.omega * sim.t) * R_EARTH;
      extra = `Distância horizontal satélite ↔ cápsula: <b>${fmtNum(Math.abs(satX - sim.s) / 1000)} km</b>`;
      if (model.id !== 'uniform') extra += '<br><small>(no modelo real a cápsula é mais rápida que o satélite)</small>';
    } else if (view.chord) {
      extra = `Túnel pelo centro: <b>12.742 km</b> · túnel em corda: <b>${fmtNum((2 * chordSim.L) / 1000)} km</b><br>Pico de velocidade: <b>${kmh}</b> × <b>${fmtNum(Math.abs(chordSim.v) * 3.6)}</b> km/h — e mesmo assim chegam juntas.`;
    }
    if ($('extra-stat').innerHTML !== extra) $('extra-stat').innerHTML = extra;
  }
  if (!$('ride-hud').hidden) {
    $('r-speed').textContent = kmh;
    $('r-depth').textContent = `${depth} km`;
    $('r-g').textContent = `${g} m/s²`;
    $('r-time').textContent = fmtTime(sim.t);
  }
}

function timecode(t) {
  const f = Math.floor((t * 24) % 24);
  const s = Math.floor(t + 4413);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest?.('#btn-blast')) doBlast();
});
$('card-min').addEventListener('click', () => {
  const min = document.body.classList.toggle('card-min');
  $('card-min').textContent = min ? '+' : '–';
  $('card-min').title = min ? 'Mostrar o texto' : 'Esconder o texto';
});

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  if (activeScene === 'space') updateSpace(dt, t);
  else if (activeScene === 'mine') mine.update(t, dt);
  else {
    ground.update(t);
  }
  updateCamera(dt);
  if (controls.enabled && rig.mode !== 'tween' && rig.mode !== 'ride' && rig.mode !== 'hold' && rig.mode !== 'descent') controls.update();
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 0.6);
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.25, (Math.random() - 0.5) * shake * 0.25, 0));
  }
  if (bokeh.enabled) bokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);
  if (!$('rec').hidden) $('rec-tc').textContent = timecode(t);
  updateHud(dt);
  finalPass.uniforms.uTime.value = t;
  finalPass.uniforms.uAberr.value = rig.mode === 'ride' ? 0.002 + 0.006 * (Math.abs(sim.v) / model.vmax) : 0.0012;
  composer.render();
  labelRenderer.render(sceneOf(activeScene), camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  labelRenderer.setSize(w, h);
});

// ------------------------------------------------------------------ início
function startExperience(withSound) {
  $('start').classList.add('done');
  document.body.classList.remove('prestart');
  setTimeout(() => ($('start').hidden = true), 900);
  if (withSound) sound.init();
  setAudio(withSound, withSound);
  beginTour();
}
function setAudio(music, voice) {
  sound.setMusic(music);
  narrator.enabled = voice && narrator.available;
  if (!narrator.enabled) narrator.cancel();
  $('btn-music').classList.toggle('on', music);
  $('btn-voice').classList.toggle('on', narrator.enabled);
}
$('start-sound').addEventListener('click', () => startExperience(true));
$('start-mute').addEventListener('click', () => startExperience(false));
$('btn-music').addEventListener('click', () => {
  sound.init();
  setAudio(!$('btn-music').classList.contains('on'), narrator.enabled);
  if (current >= 0) sound.setMood(moodFor(CHAPTERS[current]));
});
$('btn-voice').addEventListener('click', () => {
  if (!narrator.available) return toast('Este navegador não tem voz em português instalada.');
  sound.init();
  setAudio($('btn-music').classList.contains('on'), !narrator.enabled);
  if (narrator.enabled && current >= 0) playSubs(CHAPTERS[current]);
});

manager.onLoad = () => {
  $('loading').classList.add('done');
  // o deserto aparece ao fundo da tela inicial
  switchScene('ground');
  camera.position.set(34, 8, 30);
  controls.target.set(2, -0.5, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;
  $('start').hidden = false;
  requestAnimationFrame(() => $('start').classList.add('show'));
};
function beginTour() {
  // câmera começa um pouco mais longe e se aproxima devagar
  // link direto para um capítulo: index.html#5
  const start = clamp(parseInt(location.hash.slice(1), 10) || 0, 0, CHAPTERS.length - 1);
  if (start > 0) {
    camera.position.set(0, 150, 420);
    goTo(start);
    return;
  }
  goTo(0).then(() => {
    camera.position.set(34, 8, 30);
    flyTo({ pos: new THREE.Vector3(...CHAPTERS[0].cam.pos), target: new THREE.Vector3(...CHAPTERS[0].cam.target), fov: 50, dur: 6, arc: false });
  });
};
// se as texturas falharem, segue mesmo assim
manager.onError = (url) => console.warn('Falha ao carregar', url);
requestAnimationFrame(frame);

// acesso para depuração pelo console do navegador
window.__tunel = { goTo, sim, space, ground, mine, sound, narrator, camera, controls, rig, view, get current() { return current; } };
