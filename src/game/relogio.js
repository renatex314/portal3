// Relógio do tempo (série Experimento) — inspirado no jogo Flash "Time Experiment"
// (RodKis) e no mod "Thinking with Time Machine".
//
//  • Tecla 2: PAUSA o tempo do mundo (portas, plataformas, bolas de energia, cubos,
//    torretas…). Você anda, pega e atira à vontade.
//  • Na pausa aparece o holograma do passado: a roda do mouse escolhe Δ (quantos
//    segundos voltar) e o tiro LARANJA cai nas paredes daquele instante. O azul
//    cai no presente. Fora da pausa, o laranja é um portal normal (Δ = 0).
//  • Entrar no azul leva você ao laranja Δ segundos antes (LOOP FECHADO: uma só
//    linha do tempo). O mundo volta ao instante de destino e o seu eu que saltou
//    vira um CLONE que repete o que você fez — pisa em botões — até o momento do
//    salto, quando mergulha no azul "eco" e some.
//  • O QUE ACONTECEU SE REPETE: depois do salto, cubos e torretas seguem a gravação
//    ("no trilho") — o que o seu passado segurou, empurrou, arremessou ou mudou de
//    lugar com o tempo parado, e o que caiu ou rolou sozinho. Só sai do trilho o que
//    você (o viajante) perturbar: pegar, empurrar, um portal seu no caminho, uma porta
//    diferente da gravação ou outro objeto já fora do trilho; daí em diante é física.
//    O objeto que você leva no salto existe duas vezes até o instante do salto: a
//    cópia do passado (cinza) refaz a gravação e some no azul.
//  • PARADOXO: se o clone não puder repetir o passado (bola de energia no caminho
//    dele, porta/cubo na rota, chão que sumiu, destino ocupado, o objeto que ele usou
//    não está no lugar ou foi tirado dele…) o loop colapsa e você volta ao instante
//    do salto, com os portais como estavam.

import * as THREE from 'three';
import { tl, num } from './i18n.js';
import { PORTAL_A, PORTAL_B } from './portals.js';

const RATE = 1 / 30; // intervalo entre os quadros guardados (tempo do mundo)
const KEEP = 120; // segundos de história
const MAX_DELTA = 30;
const STEP = 0.5; // um "tique" da linha do tempo (s)
const MIN_DELTA = 0.25; // o mínimo que dá para voltar
const ECHO = 0.8; // o azul "eco" abre para o mergulho do clone nesse tempo final
const MERGE = 12; // quadros sem mexer num objeto que ainda contam como o mesmo "uso" dele (0,4 s)
const MISPLACED = 0.6; // m: o objeto não está onde o seu passado o encontrou → paradoxo

const V3 = THREE.Vector3;
const _path = new V3();

/** deslocamento de uma porta/plataforma com `open` (0..1) */
function doorOffset(d, open, out) {
  if (d.path) out.copy(d.path);
  else out.set(0, 0, 0).setComponent('xyz'.indexOf(d.axis), d.dist);
  return out.multiplyScalar(open);
}

const overlap = (aMin, aMax, bMin, bMax, eps = 0) =>
  aMin.x < bMax.x - eps && aMax.x > bMin.x + eps && aMin.y < bMax.y - eps && aMax.y > bMin.y + eps && aMin.z < bMax.z - eps && aMax.z > bMin.z + eps;

export class Chronos {
  /**
   * ctx: { world, energy, player, portals, scene, cubes(), turrets(), held(), makeGhost(),
   *        t(), dtReal(), fx: { pause, jump, paradox, scrub, echo, toast } }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.holoMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.25, 0.85, 1.0) }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main(){
          float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 1.7);
          float sc = 0.62 + 0.38 * sin(vW.y * 16.0 - uTime * 3.5) * sin(vW.x * 3.0 + vW.z * 3.0 + uTime);
          vec3 col = uColor * (0.45 + 1.6 * f) * sc;
          gl_FragColor = vec4(col * 1.4, (0.20 + 0.55 * f) * uAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.holo = null;
    this.eco = null;
    this.vt = 0; // tempo "visual" do mundo (só anda quando o mundo anda)
    this.paradoxes = 0;
    this.delta = 5;
    this.clear();
  }

  // ------------------------------------------------------------------ estado
  clear() {
    if (this.frozenProps) this.setFreeze(false);
    for (const d of this.doubles ?? []) this.dropDouble(d);
    this.doubles = [];
    this.ballDoubles = [];
    this.pastEntries = [];
    this.ballQueue = [];
    this.blueEntries = [];
    this.loopTw = null;
    for (const c of this.clones ?? []) this.dropClone(c);
    this.paused = false;
    this.tw = 0;
    this.samples = [];
    this.clones = [];
    this.cloneSeq ??= 0;
    this.arrival = -Infinity; // instante de chegada do último salto (não dá para saltar para antes dele)
    this.sweep = null;
    this.frozenProps = false;
    this.next = 0;
    this.pre = null;
    this.blocked = false;
    this.resetDriven();
    this.gap = false;
    this.record(0);
    this.next = RATE;
    this.setHolo(false);
    this.updateEco();
  }

  props() {
    return [...this.ctx.cubes(), ...(this.ctx.turrets?.() ?? [])];
  }

  /** foto do mundo agora */
  snapshot() {
    const { world, energy } = this.ctx;
    return {
      doors: world.doors.map((d) => [d.open, d.target, d.wait ?? 0]),
      buttons: world.buttons.map((b) => [b.pressed, b.count ?? 0]),
      pushButtons: (world.pushButtons ?? []).map((b) => [b.on, b.left, (world.pushChans?.(b) ?? []).map((c) => [c.on, c.left])]),
      catchers: world.catchers.map((c) => c.active),
      lasersOff: world.lasers.map((L) => !!L.off), // (ligado ou não naquele instante: o feixe do passado depende disso)
      incin: world.incinerators.map((i) => i.active),
      launchers: world.launchers.map((L) => [L.wait, L.done]),
      pellets: energy.pellets.map((p) => ({ uid: p.uid, li: world.launchers.indexOf(p.from), pos: p.pos.clone(), vel: p.vel.clone(), life: p.life, cd: p.cooldown })),
      props: this.props().map((c) => {
        const v = c.body?.linvel?.();
        const a = c.body?.angvel?.();
        return { p: c.pos.clone(), q: c.quat.clone(), v: v ? [v.x, v.y, v.z] : null, a: a ? [a.x, a.y, a.z] : null, gone: !!c.gone };
      }),
    };
  }

  /**
   * os seus portais agora — também o par temporal (laranja no passado, com o Δ dele): a
   * sua versão passada o terá de novo depois de um salto, e o que passa por ele (lasers,
   * bolas, cubos, você) continua indo e vindo. Reaproveita o objeto se nada mudou
   */
  portalState() {
    const { portals } = this.ctx;
    const { blue, orange } = portals;
    const fr = (P, old) => {
      if (!P.placed) return null;
      const delta = P.delta > 0 ? P.delta : 0;
      if (old && old.box === P.box && old.c.equals(P.center) && old.n.equals(P.normal) && (old.delta ?? 0) === delta) return old;
      return { c: P.center.clone(), n: P.normal.clone(), u: P.up.clone(), box: P.box, delta };
    };
    const old = this.samples[this.samples.length - 1]?.pt;
    const b = fr(blue, old?.b);
    const o = fr(orange, old?.o);
    return old && old.b === b && old.o === o ? old : { b, o };
  }

  /** os portais que o clone disparou, no instante t do script dele */
  syncClonePortals(c, t, alive) {
    const { portals } = this.ctx;
    const s = c.script[Math.max(0, Math.min(c.script.length - 1, Math.floor((t - c.script[0].t) / RATE + 1e-6)))];
    const want = alive ? s.pt : null;
    for (const which of ['b', 'o']) {
      const f = want?.[which] ?? null;
      if (!f && !c.pair) continue;
      c.pair ??= portals.clonePair(c.id);
      const P = which === 'b' ? c.pair.blue : c.pair.orange;
      if (!f) {
        if (P.placed) P.remove();
        P.delta = 0;
      } else if (!P.placed || c.shown?.[which] !== f) {
        P.setFrame(f.c, f.n, f.u, f.box);
        P.delta = f.delta ?? 0; // laranja temporal da versão passada: aberto no passado dela
        (c.shown ??= {})[which] = f;
      }
    }
  }

  record(t) {
    const { player } = this.ctx;
    this.samples.push({
      t,
      p: player.pos.clone(),
      up: player.upSign,
      yaw: player.yaw,
      pitch: player.pitch,
      grounded: !!player.grounded,
      mv: !!player.grounded && player.vel.clone().setY(0).lengthSq() > 0.4,
      pt: this.portalState(),
      h: this.props().indexOf(this.ctx.held?.() ?? null),
      hm: this.pushed(),
      ...this.gapMoves(),
      ...(this.markArrive ? { arrive: true } : {}),
      // atravessando um portal (a caixa do corpo entra na parede/teto dele): não é obstrução
      ...(this.ctx.portals?.mouths(player.pos, true, 0.5).length || player.cooldown > -0.4 ? { inMouth: true } : {}),
      // lasers entrando num azul temporal agora (viram feixes saindo do laranja Δ s antes)
      lz: (this.ctx.beams?.liveEntries ?? []).map((e) => ({ delta: e.delta, at: e.at.clone(), exit: e.exit.clone(), dir: e.dir.clone(), frame: e.frame, bridge: e.bridge || false })),
      w: this.snapshot(),
    });
    this.markArrive = false;
    while (this.samples.length > 2 && t - this.samples[0].t > KEEP) this.samples.shift();
  }

  /** cubos que você está empurrando (perto de você e se mexendo): o clone também os empurra */
  pushed() {
    const { player } = this.ctx;
    const held = this.ctx.held?.();
    const prev = this.samples[this.samples.length - 1]?.w.props;
    const out = [];
    this.props().forEach((p, k) => {
      const q = prev?.[k];
      // (no trilho, quem mexe é a gravação, não você)
      if (p === held || p.gone || p.kind !== 'cube' || !q || q.gone || this.driven?.has(p)) return;
      if (Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) < 1.0 && Math.abs(p.pos.y - player.pos.y) < 1.4 && p.pos.distanceTo(q.p) > 0.012) out.push(k);
    });
    return out;
  }

  /** primeiro quadro depois de uma pausa: os objetos que mudaram de lugar com o mundo parado foram mexidos por você */
  gapMoves() {
    if (!this.gap) return {};
    this.gap = false;
    const prev = this.samples[this.samples.length - 1]?.w.props;
    const pm = [];
    this.props().forEach((p, k) => {
      const q = prev?.[k];
      if (q && (q.gone !== !!p.gone || (!p.gone && p.pos.distanceTo(q.p) > 0.05))) pm.push(k);
    });
    const fz = this.frozenPath?.length > 1 ? this.frozenPath : null;
    this.frozenPath = null;
    return { gap: true, pm, ...(fz ? { fz } : {}) };
  }

  indexAt(t) {
    const s = this.samples;
    const i = Math.floor((t - s[0].t) / RATE + 1e-6);
    return Math.max(0, Math.min(s.length - 1, i));
  }

  /**
   * limite do Δ: a história guardada e 30 s. Dá para voltar para antes da sua própria
   * chegada: a versão nova refaz o caminho de antes do salto anterior e, no instante da
   * chegada, o corpo "se divide" (a versão antiga segue dali; a nova sai do laranja)
   */
  maxDelta() {
    const hist = this.tw - this.samples[0].t;
    return Math.max(0, Math.min(MAX_DELTA, hist));
  }

  /** põe o mundo exatamente como estava na foto (o jogador não é mexido) */
  restore(snap, { keep = null } = {}) {
    const { world, energy, player } = this.ctx;
    const moved = [];
    world.doors.forEach((d, k) => {
      const s = snap.doors[k];
      if (!s) return;
      if (Math.abs(d.open - s[0]) > 1e-5) moved.push(d);
      d.open = s[0];
      d.target = s[1];
      if (d.wait !== undefined) d.wait = s[2];
    });
    (world.pushButtons ?? []).forEach((b, k) => {
      b.on = !!snap.pushButtons?.[k]?.[0];
      b.left = snap.pushButtons?.[k]?.[1] ?? 0;
      (world.pushChans?.(b) ?? []).forEach((c, j) => {
        const v = snap.pushButtons?.[k]?.[2]?.[j];
        // (gravação sem este canal: o estado do começo — "desliga e fica desligado" começa ligado)
        c.on = v ? !!v[0] : c.mode === 'unlatch';
        c.left = v?.[1] ?? 0;
      });
    });
    world.buttons.forEach((b, k) => {
      b.pressed = !!snap.buttons[k]?.[0];
      b.count = snap.buttons[k]?.[1] ?? 0;
    });
    world.catchers.forEach((c, k) => (c.active = !!snap.catchers[k]));
    world.incinerators.forEach((f, k) => (f.active = !!snap.incin[k]));
    // bolas de energia, pela identidade de cada uma: reaproveita as que existem, cria as
    // que faltam (as soltas — vindas pelo par temporal — também), tira as que sobram
    const key = (p) => p.uid ?? `li${p.li}`;
    const want = new Map(snap.pellets.map((p) => [key(p), p]));
    for (const p of [...energy.pellets]) {
      const k = p.uid ?? `li${world.launchers.indexOf(p.from)}`;
      const w = want.get(k);
      if (!w) {
        energy.kill(p);
        continue;
      }
      this.setPellet(p, w);
      want.delete(k);
    }
    for (const w of want.values()) {
      const L = world.launchers[w.li];
      let p = null;
      if (L && !L.pellet) p = energy.spawn(L);
      else if (!L) p = energy.spawnFree(w.pos, w.vel, w.life);
      if (!p) continue;
      if (w.uid) p.uid = w.uid;
      this.setPellet(p, w);
    }
    world.launchers.forEach((L, k) => {
      if (!snap.launchers[k]) return;
      L.wait = snap.launchers[k][0];
      L.done = snap.launchers[k][1];
    });
    this.props().forEach((c, k) => {
      if (c === keep) return; // o que você está segurando fica na sua mão
      const s = snap.props[k];
      if (!s) return;
      if (s.gone) {
        if (!c.gone) c.vanish();
        return;
      }
      if (c.gone) {
        c.gone = false;
        c.body?.setEnabled(true);
        c.mesh.visible = true;
      }
      c.place(s.p, s.q, s.v ? { x: s.v[0], y: s.v[1], z: s.v[2] } : null);
      if (s.a) c.body?.setAngvel({ x: s.a[0], y: s.a[1], z: s.a[2] }, true);
    });
    // portas e plataformas andam para onde estavam (e não esmagam quem está no caminho)
    world.update(this.vt, 0); // (o tempo visual, o mesmo do main: senão a lava e as animações pulam entre os dois)
    for (const d of moved) this.pushOut(player, d.box);
  }

  setPellet(p, w) {
    p.pos.copy(w.pos);
    p.vel.copy(w.vel);
    p.life = w.life;
    p.cooldown = w.cd;
    p.group.position.copy(p.pos);
    p.light?.position.copy(p.pos);
    for (const h of p.hist) h.copy(p.pos);
  }

  pushOut(player, b) {
    const pen = ['x', 'y', 'z'].map((a) => Math.min(player.pos[a] + player.half[a] - b.min[a], b.max[a] - (player.pos[a] - player.half[a])));
    if (pen.some((v) => v <= 0.02)) return;
    const i = pen.indexOf(Math.min(...pen));
    const a = 'xyz'[i];
    player.pos[a] += (player.pos[a] > (b.min[a] + b.max[a]) / 2 ? 1 : -1) * (pen[i] + 0.01);
  }

  // ------------------------------------------------------------------ pausa
  pause(on = !this.paused) {
    if (on === this.paused || this.sweep) return;
    this.paused = on;
    if (on) {
      this.frozenPath = [];
      this.trackFrozen();
    }
    if (!on) this.gap = true;
    if (on) this.delta = this.deltaGoal = THREE.MathUtils.clamp(this.delta, MIN_DELTA, Math.max(MIN_DELTA, this.maxDelta()));
    this.setFreeze(on);
    this.setHolo(on);
    this.ctx.fx.pause?.(on);
  }

  /** com o tempo parado: o caminho que você anda (um ponto a cada ~25 cm, e se estava pisando em algo) */
  trackFrozen() {
    const { player, portals } = this.ctx;
    const path = (this.frozenPath ??= []);
    const last = path[path.length - 1];
    if (last && last.p.distanceTo(player.pos) < 0.25 && last.grounded === !!player.grounded) return;
    if (path.length > 4000) return; // (andando muito tempo parado: o começo já basta)
    path.push({
      p: player.pos.clone(),
      up: player.upSign,
      grounded: !!player.grounded,
      // atravessando um portal: a caixa do corpo entra na parede dele, não é obstrução
      inMouth: !!(portals?.mouths(player.pos, true, 0.5).length || player.cooldown > -0.4),
    });
  }

  /** na pausa os cubos/torretas ficam fixos no lugar (ainda colidem); o que você segura continua solto */
  setFreeze(on) {
    this.frozenProps = on;
    for (const c of this.props()) {
      if (!c.body || c.gone) continue;
      if (on) {
        const v = c.body.linvel();
        const a = c.body.angvel();
        c._tv = [v.x, v.y, v.z, a.x, a.y, a.z];
      } else if (c._bt === 1) {
        c.body.setBodyType(0, true);
        if (c._tv) {
          c.body.setLinvel({ x: c._tv[0], y: c._tv[1], z: c._tv[2] }, true);
          c.body.setAngvel({ x: c._tv[3], y: c._tv[4], z: c._tv[5] }, true);
        }
        c._bt = 0;
      }
    }
  }

  syncFreeze() {
    const held = this.ctx.held?.();
    for (const c of this.props()) {
      if (!c.body || c.gone) continue;
      const want = held === c ? 0 : 1;
      if ((c._bt ?? 0) !== want) {
        if (want === 1) c.body.setBodyType(1, true);
        else {
          c.body.setBodyType(0, true);
          c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        c._bt = want;
      }
    }
  }

  /** o mundo está parado (pausa ou "rebobinar" visual do salto) */
  get frozen() {
    return this.paused || !!this.sweep;
  }

  scrub(steps) {
    return this.scrubBy(steps * STEP);
  }

  /**
   * Roda do mouse na pausa: move o ALVO do Δ (em segundos, proporcional à rolagem); o Δ
   * mostrado desliza até ele a cada quadro (smoothDelta), sem saltos de meio segundo.
   */
  scrubBy(seconds) {
    if (!this.paused) return false;
    const max = Math.max(MIN_DELTA, this.maxDelta());
    const from = this.deltaGoal ?? this.delta;
    this.deltaGoal = THREE.MathUtils.clamp(from + seconds, MIN_DELTA, max);
    return this.deltaGoal !== from;
  }

  /** o Δ anda até o alvo; um "tique" a cada meio segundo atravessado */
  smoothDelta(dtReal) {
    if (this.deltaGoal == null) return;
    const before = this.delta;
    const k = 1 - Math.exp(-(dtReal || 1 / 60) * 14);
    this.delta += (this.deltaGoal - this.delta) * k;
    if (Math.abs(this.deltaGoal - this.delta) < 0.004) this.delta = this.deltaGoal;
    if (Math.floor(before / STEP) !== Math.floor(this.delta / STEP)) this.ctx.fx.scrub?.(this.delta);
  }

  // ------------------------------------------------------------------ quadro
  /** devolve o quanto o mundo avança neste quadro (0 = parado) */
  frame(dt) {
    const out = this.frameInner(dt);
    this.updateDoubles();
    return out;
  }

  frameInner(dt) {
    const { player } = this.ctx;
    this.pre = { pos: player.pos.clone(), vel: player.vel.clone(), yaw: player.yaw, pitch: player.pitch, up: player.upSign };
    this.holoMat.uniforms.uTime.value = this.ctx.t();
    if (this.sweep) {
      this.syncFreeze();
      this.stepSweep(dt);
      this.syncAll();
      return 0;
    }
    if (this.paused) {
      this.syncFreeze();
      this.trackFrozen();
      this.smoothDelta(this.ctx.dtReal?.());
      this.holoUpdate();
      this.syncAll();
      this.driveProps();
      return 0;
    }
    this.tw += dt;
    this.vt += dt;
    while (this.tw >= this.next) {
      this.record(this.next);
      this.next += RATE;
    }
    this.syncAll();
    if (!this.driveProps()) this.checkParadox(dt);
    return dt;
  }

  // ------------------------------------------------------------------ clones e marca do laranja
  clonePose(c, t = this.tw) {
    const s = c.script;
    if (t < c.born - 1e-6 || t > c.end + 1e-6) return null;
    const f = (t - s[0].t) / RATE;
    const i = Math.max(0, Math.min(s.length - 1, Math.floor(f)));
    const a = s[i];
    const b = s[Math.min(s.length - 1, i + 1)];
    // um salto de posição entre dois quadros guardados (o jogador parou o tempo e andou, ou atravessou um portal): sem interpolar
    const jumped = !!b.gap || !!b.arrive || a.p.distanceTo(b.p) > 2.5;
    const k = jumped ? 0 : Math.max(0, Math.min(1, f - i));
    return { p: a.p.clone().lerp(b.p, k), yaw: a.yaw + (b.yaw - a.yaw) * k, up: a.up, mv: a.mv && !jumped, grounded: a.grounded, jumped, inMouth: !!(a.inMouth || b.inMouth) };
  }

  feetOf(p, up) {
    return p.clone().addScaledVector(new V3(0, -1, 0), 0.9 * up);
  }

  /** pés dos clones agora (eles pisam em botões) */
  feet() {
    const out = [];
    for (const c of this.clones) {
      const pose = this.clonePose(c);
      if (pose) out.push(this.feetOf(pose.p, pose.up));
    }
    return out;
  }

  syncAll() {
    const t = this.ctx.t();
    const dt = this.ctx.dtReal?.() ?? 1 / 60;
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i];
      const pose = this.clonePose(c);
      if (!pose) {
        if (c.echo) c.echo.mesh.visible = false;
        // ainda não nasceu ou já mergulhou no azul (o loop fechou); ele continua na história: um novo salto
        // para antes do fim dele o traz de volta
        if (c.ghost) c.ghost.group.visible = false;
        if (c.portal) c.portal.visible = false;
        this.syncClonePortals(c, this.tw, false);
        if (c.end < this.samples[0].t - 1) {
          this.dropClone(c);
          this.clones.splice(i, 1);
        }
        continue;
      }
      if (this.tw < c.end - ECHO - 0.02) c.echoed = c.closed = false;
      c.ghost ??= this.ctx.makeGhost();
      c.ghost.set(this.feetOf(pose.p, pose.up), pose.yaw, pose.up, pose.mv, t, dt, 0.55);
      if (c.echo) this.poseEcho(c, this.tw);
      this.cloneBlue(c).visible = true;
      this.syncClonePortals(c, this.tw, true);
      // últimos instantes: o azul "eco" abre para o clone mergulhar
      if (!c.echoed && this.tw > c.end - ECHO) {
        c.echoed = true;
        this.ctx.fx.echo?.(c.exit, true);
      }
      if (!c.closed && this.tw >= c.end - 0.05) {
        c.closed = true;
        this.ctx.fx.echo?.(c.exit, false, c.ghost.group.position);
      }
    }
    this.updateEco();
  }

  // ------------------------------------------------------------------ objetos que o seu passado mexeu
  /** estado gravado do objeto `k` no quadro fracionário `f` do script (sem interpolar sobre pausas e teletransportes) */
  propAt(script, f, k) {
    const i = Math.max(0, Math.min(script.length - 1, Math.floor(f)));
    const a = script[i];
    const b = script[Math.min(script.length - 1, i + 1)];
    const pa = a.w.props[k];
    if (!pa) return null;
    const pb = b.w.props[k];
    const smooth = pb && !b.gap && !pa.gone && !pb.gone && pa.p.distanceTo(pb.p) < 2.5;
    const t = smooth ? Math.max(0, Math.min(1, f - i)) : 0;
    return { p: pa.p.clone().lerp(smooth ? pb.p : pa.p, t), q: pa.q.clone().slerp(smooth ? pb.q : pa.q, t), v: pa.v, a: pa.a, gone: pa.gone, held: a.h === k };
  }

  /** trechos do script em que você mexeu em cada objeto: [{ k, j0, j1 }] (índices do script) */
  episodes(script, skip = -1) {
    const open = new Map();
    const out = [];
    script.forEach((s, j) => {
      for (const k of new Set([...(s.h >= 0 ? [s.h] : []), ...(s.hm ?? []), ...(s.pm ?? [])])) {
        if (k === skip) continue;
        const e = open.get(k);
        if (e && j - e.j1 <= MERGE) e.j1 = j;
        else {
          if (e) out.push(e);
          open.set(k, { k, j0: j, j1: j });
        }
      }
    });
    return [...out, ...open.values()];
  }

  /** a gravação mais nova que cobre o instante t (a do último salto que passou por ele) */
  railSource(t = this.tw) {
    for (let i = this.clones.length - 1; i >= 0; i--) {
      const c = this.clones[i];
      if (t >= c.born - 1e-6 && t <= c.end + 1e-6) return c;
    }
    return null;
  }

  /** o viajante (você, depois do salto) mexeu nesse objeto? então ele sai do trilho */
  disturbed(prop, st, held, free) {
    const { player, portals, world } = this.ctx;
    if (prop === held) return true;
    const h = prop.half ?? new V3(0.3, 0.3, 0.3);
    const pMin = prop.pos.clone().sub(h);
    const pMax = prop.pos.clone().add(h);
    // você encostado e andando
    const meMin = player.pos.clone().sub(player.half).subScalar(0.06);
    const meMax = player.pos.clone().add(player.half).addScalar(0.06);
    if (overlap(meMin, meMax, pMin, pMax) && Math.hypot(player.vel.x, player.vel.z) > 0.3) return true;
    // outro objeto que já saiu do trilho bateu nele
    for (const o of free) {
      if (o === prop || o.gone) continue;
      const oh = o.half ?? h;
      if (overlap(o.pos.clone().sub(oh), o.pos.clone().add(oh), pMin, pMax, -0.03)) return true;
    }
    // um portal seu (que não existia na gravação) no caminho gravado
    for (const P of [portals.blue, portals.orange]) {
      if (!P.placed || P.delta > 0 || P.partner?.delta > 0 || !portals.isLinked(P)) continue;
      const a = P.local(prop.pos);
      const b = P.local(st.p);
      if (Math.sign(a.z) !== Math.sign(b.z) && Math.abs(a.z - b.z) < 2.5) {
        const k = a.z / (a.z - b.z);
        const x = a.x + (b.x - a.x) * k;
        const y = a.y + (b.y - a.y) * k;
        if ((x / (PORTAL_A + 0.3)) ** 2 + (y / (PORTAL_B + 0.3)) ** 2 <= 1) return true;
      }
    }
    // uma porta/plataforma que está diferente da gravação perto dele
    const src = this.railSource();
    const snap = src && src.script[this.indexIn(src)].w;
    if (snap)
      for (let k = 0; k < world.doors.length; k++) {
        const d = world.doors[k];
        const was = snap.doors[k];
        if (!was || Math.abs(was[0] - d.open) < 0.05) continue;
        if (overlap(d.box.min.clone().subScalar(0.4), d.box.max.clone().addScalar(0.4), pMin, pMax)) return true;
      }
    return false;
  }

  /** índice do quadro do script do clone no instante atual */
  indexIn(c, t = this.tw) {
    return Math.max(0, Math.min(c.script.length - 1, Math.floor((t - c.script[0].t) / RATE + 1e-6)));
  }

  /** sai do trilho: continua com a velocidade gravada (a física assume) */
  leaveRail(prop, st) {
    prop.cloneHeld = false;
    if (!st || st.gone || prop.gone || prop === this.ctx.held?.()) return;
    const moving = !this.frozenProps;
    prop.place(prop.pos.clone(), prop.quat.clone(), st.v && moving ? { x: st.v[0], y: st.v[1], z: st.v[2] } : null);
    if (st.a && moving) prop.body?.setAngvel({ x: st.a[0], y: st.a[1], z: st.a[2] }, true);
  }

  /**
   * Depois de um salto, o mundo refaz a gravação: cada cubo/torreta fica no trilho (segue o
   * estado gravado) até você o perturbar. Os usos que o seu passado faz de um objeto são
   * obrigatórios: se ele não estiver no lugar, ou estiver na sua mão, é paradoxo.
   * Devolve true se houve paradoxo (o loop já foi desfeito).
   */
  driveProps() {
    if (this.sweep) return false;
    const props = this.props();
    const held = this.ctx.held?.();
    const src = this.railSource();
    // o objeto que viajou com você: na gravação da versão que o levou, ele é a cópia do
    // passado (o eco, refeito à parte); nas gravações mais novas, é o objeto de verdade
    // os usos que os clones fazem agora
    for (const c of this.clones) {
      if (!c.eps?.length || !this.clonePose(c)) continue;
      const f = (this.tw - c.script[0].t) / RATE;
      for (const e of c.eps) {
        if (f < e.j0 - 1e-6 || f >= e.j1 + 1 || c.echo?.k === e.k) continue;
        const prop = props[e.k];
        const st = prop && this.propAt(c.script, f, e.k);
        if (!st || st.gone) continue;
        if (prop === held) {
          this.rollback(c.cp, 'você pegou o objeto que o seu passado estava usando', prop.pos.clone());
          return true;
        }
        if (this.free.has(prop)) {
          // fora do trilho: só dá se ainda estiver onde o seu passado o encontrou
          if (prop.gone || prop.pos.distanceTo(st.p) > MISPLACED) {
            this.rollback(c.cp, 'o objeto que o seu passado usou não estava mais no lugar', prop.pos.clone());
            return true;
          }
          this.free.delete(prop);
          this.snap.add(prop);
        }
      }
    }
    const f = src ? (this.tw - src.script[0].t) / RATE : 0;
    const next = new Map();
    props.forEach((prop, k) => {
      const was = this.driven.get(prop);
      const st = src && src.echo?.k !== k && !this.free.has(prop) ? this.propAt(src.script, f, k) : null;
      if (!st) {
        if (was) this.leaveRail(prop, this.propAt(was.src.script, (this.tw - was.src.script[0].t) / RATE, k));
        return;
      }
      if (was?.src === src || this.snap.has(prop)) {
        if (!this.snap.has(prop) && this.disturbed(prop, st, held, this.free)) {
          this.free.add(prop);
          this.leaveRail(prop, st);
          return;
        }
      } else if (prop.gone !== st.gone || (!st.gone && prop.pos.distanceTo(st.p) > 0.2)) {
        // entrou numa gravação nova (outro salto) mas não está como ela diz: segue livre
        this.free.add(prop);
        if (was) this.leaveRail(prop, st);
        return;
      }
      this.snap.delete(prop);
      if (st.gone) {
        if (!prop.gone) prop.vanish();
      } else {
        if (prop.gone) {
          prop.gone = false;
          prop.body?.setEnabled(true);
        }
        prop.place(st.p, st.q, null);
        prop.sync();
      }
      prop.cloneHeld = st.held; // segurado pelo clone: não aperta botão (como não apertava)
      next.set(prop, { src });
    });
    this.driven = next;
    return false;
  }

  /** esquece os objetos em uso (salto e paradoxo: o mundo foi refeito por `restore`) */
  resetDriven() {
    for (const prop of this.driven?.keys() ?? []) prop.cloneHeld = false;
    this.driven = new Map();
    this.free = new Set();
    this.snap = new Set();
  }

  /** a cópia do passado do objeto que viajou com você, no instante t */
  poseEcho(c, t) {
    const E = c.echo;
    const st = this.propAt(c.script, (t - c.script[0].t) / RATE, E.k);
    E.mesh.visible = !!st && !st.gone;
    if (!E.mesh.visible) return null;
    E.mesh.position.copy(st.p);
    E.mesh.quaternion.copy(st.q);
    return st;
  }

  /**
   * Cópias de objetos que agora existem só por causa do tempo — o eco (o objeto que viajou
   * com você, refeito pela sua versão passada) e o duplo (o objeto mandado ao passado):
   * [{ c: o objeto de verdade (tipo, refletor…), p, q }]. O laser as enxerga.
   */
  virtualProps() {
    const out = [];
    const props = this.props();
    for (const c of this.clones) {
      if (!c.echo || !this.clonePose(c)) continue;
      const st = this.propAt(c.script, (this.tw - c.script[0].t) / RATE, c.echo.k);
      if (st && !st.gone && props[c.echo.k]) out.push({ c: props[c.echo.k], p: st.p, q: st.q });
    }
    for (const d of this.doubles ?? []) {
      const st = this.doubleAt(d, this.tw);
      if (st) out.push({ c: d.prop, p: st.p, q: st.q });
    }
    return out;
  }

  /** cópias do passado que apertam botões agora (as que o clone não está segurando) */
  echoes() {
    const out = [];
    for (const c of this.clones) {
      if (!c.echo || !this.clonePose(c)) continue;
      const st = this.propAt(c.script, (this.tw - c.script[0].t) / RATE, c.echo.k);
      if (st && !st.gone && !st.held) out.push(st.p);
    }
    for (const d of this.doubles ?? []) {
      const st = this.doubleAt(d, this.tw);
      if (st) out.push(st.p);
    }
    return out;
  }

  /** modelo cinza da cópia do passado (como o clone) */
  makeEcho(prop) {
    const m = prop.mesh.clone(true);
    m.traverse((o) => {
      if (o.isLight) o.visible = false;
      if (!o.material) return;
      o.material = [o.material].flat().map((src) => {
        const mat = src.clone();
        for (const key of ['color', 'emissive']) {
          if (!mat[key]?.isColor) continue;
          const l = mat[key].r * 0.3 + mat[key].g * 0.59 + mat[key].b * 0.11;
          mat[key].setRGB(l, l, l);
        }
        return mat;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    m.matrixAutoUpdate = true;
    this.ctx.scene.add(m);
    return m;
  }

  /** o azul de saída de um clone (a versão do futuro): um portal em tons de cinza, sempre visível */
  cloneBlue(c) {
    if (c.portal) return c.portal;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.87, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.08, 0.08), side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.scale.set(PORTAL_A, PORTAL_B, 1);
    disc.scale.set(PORTAL_A, PORTAL_B, 1);
    ring.position.z = 0.03;
    disc.position.z = 0.02;
    g.add(disc, ring);
    const { c: pos, n, u } = c.exit;
    const right = new V3().crossVectors(u, n).normalize();
    g.matrix.makeBasis(right, u, n).setPosition(pos);
    g.matrixWorldNeedsUpdate = true;
    this.ctx.scene.add(g);
    c.portal = g;
    return g;
  }

  dropClone(c) {
    if (c.echo) {
      c.echo.mesh.parent?.remove(c.echo.mesh);
      c.echo.mesh.traverse((o) => [o.material].flat().forEach((m) => m?.dispose?.()));
      c.echo = null;
    }
    c.ghost?.group.parent?.remove(c.ghost.group);
    if (c.pair) {
      this.ctx.portals.removeRemote(c.id);
      c.pair = null;
      c.shown = null;
    }
    if (c.portal) {
      c.portal.parent?.remove(c.portal);
      c.portal.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      c.portal = null;
    }
  }

  /** marca-holograma do laranja que está no passado ("−N s") */
  updateEco() {
    const { portals, scene } = this.ctx;
    if (!scene) return;
    const O = portals.orange;
    const on = !!(O.placed && O.delta > 0);
    if (!this.eco) {
      if (!on) return;
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), ringMat);
      ring.scale.set(PORTAL_A, PORTAL_B, 1);
      ring.position.z = 0.03;
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.88, 48), this.holoMat);
      inner.scale.set(PORTAL_A, PORTAL_B, 1);
      inner.position.z = 0.02;
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 96;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      label.scale.set(1.5, 0.56, 1);
      label.position.set(0, PORTAL_B + 0.55, 0.1);
      g.add(ring, inner, label);
      scene.add(g);
      this.eco = { g, ring, ringMat, cv, tex, label, shown: -1, blocked: null };
    }
    const e = this.eco;
    e.g.visible = on;
    if (!on) return;
    e.g.matrix.copy(O.matrix);
    e.g.matrixWorldNeedsUpdate = true;
    const pulse = 0.75 + 0.25 * Math.sin(this.ctx.t() * 4);
    e.ringMat.color.setRGB(this.blocked ? 2.4 : 1.6, this.blocked ? 0.25 : 1.0, this.blocked ? 0.2 : 0.4).multiplyScalar(pulse);
    if (e.shown !== O.delta || e.blocked !== this.blocked) {
      e.shown = O.delta;
      e.blocked = this.blocked;
      const g = e.cv.getContext('2d');
      g.clearRect(0, 0, 256, 96);
      g.font = 'bold 54px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = this.blocked ? '#ff6a5a' : '#9fe8ff';
      g.shadowColor = this.blocked ? '#ff3020' : '#20c8ff';
      g.shadowBlur = 12;
      g.fillText(`−${num(O.delta)} s`, 128, 62);
      e.tex.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ holograma do passado
  setHolo(on) {
    if (on && !this.holo) this.buildHolo();
    if (this.holo) this.holo.group.visible = on;
    if (!on && this.holo) this.holo.self?.group && (this.holo.self.group.visible = false);
  }

  buildHolo() {
    const { scene, world } = this.ctx;
    const group = new THREE.Group();
    scene.add(group);
    this.holo = { group, doors: new Map(), props: new Map(), pellets: [], self: null };
    void world;
  }

  holoMesh(src, mat) {
    const m = src.clone(true);
    m.traverse((o) => {
      if (o.isMesh) o.material = mat;
      if (o.isLight) o.visible = false;
    });
    return m;
  }

  /** mostra no holograma só o que ERA diferente de agora, no instante tw − Δ */
  holoUpdate() {
    const { world } = this.ctx;
    if (!this.holo) return;
    const H = this.holo;
    const s = this.samples[this.indexAt(this.tw - this.delta)];
    const snap = s.w;
    // portas e plataformas
    world.doors.forEach((d, k) => {
      const past = snap.doors[k];
      if (!past) return;
      let g = H.doors.get(d);
      const differs = Math.abs(past[0] - d.open) > 0.02;
      if (!g && differs) {
        g = new THREE.Mesh(d.mesh.geometry, this.holoMat);
        H.group.add(g);
        H.doors.set(d, g);
      }
      if (g) {
        g.visible = differs;
        if (differs) doorOffset(d, past[0], g.position);
      }
    });
    // cubos e torretas
    this.props().forEach((c, k) => {
      const p = snap.props[k];
      if (!p || !c.mesh) return;
      let g = H.props.get(c);
      const differs = p.gone !== !!c.gone || (!p.gone && p.p.distanceTo(c.pos) > 0.15);
      if (!g && differs && !p.gone) {
        g = this.holoMesh(c.mesh, this.holoMat);
        H.group.add(g);
        H.props.set(c, g);
      }
      if (g) {
        g.visible = differs && !p.gone;
        if (g.visible) {
          g.position.copy(p.p);
          g.quaternion.copy(p.q);
        }
      }
    });
    // bolas de energia (sempre mostradas: são o que mais muda)
    snap.pellets.forEach((p, i) => {
      let g = H.pellets[i];
      if (!g) {
        g = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), this.holoMat);
        H.group.add(g);
        H.pellets[i] = g;
      }
      g.visible = true;
      g.position.copy(p.pos);
    });
    for (let i = snap.pellets.length; i < H.pellets.length; i++) H.pellets[i].visible = false;
    // o seu eu do passado
    H.self ??= this.ctx.makeGhost();
    H.self.set(this.feetOf(s.p, s.up), s.yaw, s.up, s.mv, this.ctx.t(), this.ctx.dtReal?.() ?? 1 / 60, 0.85);
    this.blocked = this.destinationBlocked(s);
  }

  // ------------------------------------------------------------------ bolas e objetos pelo par temporal
  /**
   * Bola que bate no laranja temporal: ela entrou no portal aberto no passado, então
   * (loop fechado) sai pelo azul Δ segundos depois — como o laser. Devolve true (a
   * bola some agora).
   */
  ballIntoPast(p, O) {
    if (this.paused || this.sweep) return false;
    const pos = p.pos.clone();
    const vel = p.vel.clone();
    this.ballQueue ??= [];
    this.ballQueue.push({ tIn: this.tw, tOut: this.tw + O.delta, pos, vel, key: this.orangeKey(O), O, life: p.from?.life ?? p.life });
    (this.pastEntries ??= []).push({ li: this.ctx.world.launchers.indexOf(p.from), tIn: this.tw });
    this.ctx.fx.fizzleBall?.(pos);
    return true;
  }

  orangeKey(O) {
    return this.frameKey(O.center);
  }

  frameKey(c) {
    return `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`;
  }

  // ------------------------------------------------------------------ o vermelho visto do passado
  /**
   * Quando um vermelho temporal de uma versão passada sua "existe" no passado: aberto de
   * T1 a T2 olhando Δ s para trás (com o ciano aberto junto), ele é uma boca ali de T1 − Δ
   * a T2 − Δ (de fundo preto) que leva ao ciano Δ s depois. [{ from, to, f, delta }]
   */
  ghostWindows(c) {
    if (c.ghostWins) return c.ghostWins;
    const out = [];
    for (const s of c.script) {
      const o = s.pt?.o;
      if (!(o?.delta > 0) || !s.pt.b) continue;
      const t = s.t - o.delta;
      const last = out[out.length - 1];
      if (last && last.f === o && t - last.to < RATE * 1.5) last.to = t;
      else out.push({ from: t, to: t, f: o, delta: o.delta, c });
    }
    return (c.ghostWins = out);
  }

  /** o outro lado de uma janela agora (a vista dela): o ciano da sua versão passada, Δ s no futuro (ou null) */
  ghostExit(w) {
    const T = this.tw + w.delta;
    if (T > w.c.end + 1e-6) return null;
    const b = w.c.script[this.indexIn(w.c, T)]?.pt?.b;
    return b?.box ? { to: b, T, clone: w.c } : null;
  }

  // ---- vista do futuro (render do vermelho do passado)
  beginFuture(view) {
    const arr = view.clone.cp.samples;
    const T = view.T;
    const s = arr[Math.max(0, Math.min(arr.length - 1, Math.floor((T - arr[0].t) / RATE + 1e-6)))];
    this._undoFut = this.applyVisual(s.w);
    this._hideF = [this.eco?.g, this.holo?.group].filter((g) => g?.visible);
    for (const g of this._hideF) g.visible = false;
    const t = this.ctx.t();
    const dt = this.ctx.dtReal?.() ?? 1 / 60;
    this._cloneVisF = this.clones.map((c) => c.ghost?.group.visible);
    for (const c of this.clones) {
      const pose = this.clonePose(c, T);
      if (!pose) {
        if (c.ghost) c.ghost.group.visible = false;
        continue;
      }
      c.ghost ??= this.ctx.makeGhost();
      c.ghost.set(this.feetOf(pose.p, pose.up), pose.yaw, pose.up, pose.mv, t, dt, 0.7);
    }
  }

  endFuture() {
    this._undoFut?.();
    this._undoFut = null;
    for (const g of this._hideF ?? []) g.visible = true;
    this._hideF = null;
    this.clones.forEach((c, i) => {
      if (!c.ghost) return;
      c.ghost.group.visible = !!this._cloneVisF?.[i];
      const pose = this.clonePose(c);
      if (pose) c.ghost.set(this.feetOf(pose.p, pose.up), pose.yaw, pose.up, pose.mv, this.ctx.t(), 0, 0.55);
    });
  }

  /** os vermelhos do passado abertos neste instante do mundo */
  liveGhosts() {
    const out = [];
    for (const c of this.clones) for (const w of this.ghostWindows(c)) if (this.tw >= w.from - 1e-6 && this.tw <= w.to + RATE) out.push(w);
    return out;
  }

  /** bola que bate num vermelho do passado: some ali e sai pelo ciano Δ s depois (true = some agora) */
  ballIntoGhost(p, at) {
    if (this.paused || this.sweep) return false;
    for (const w of this.liveGhosts()) {
      const f = w.f;
      const d = at.clone().sub(f.c);
      if (Math.abs(d.dot(f.n)) > 0.1) continue;
      const right = new THREE.Vector3().crossVectors(f.u, f.n).normalize();
      if ((d.dot(right) / PORTAL_A) ** 2 + (d.dot(f.u) / PORTAL_B) ** 2 > 1) continue;
      (this.ballQueue ??= []).push({ tIn: this.tw, tOut: this.tw + w.delta, pos: p.pos.clone(), vel: p.vel.clone(), key: this.frameKey(f.c), life: p.from?.life ?? p.life });
      (this.pastEntries ??= []).push({ li: this.ctx.world.launchers.indexOf(p.from), tIn: this.tw });
      this.ctx.fx.fizzleBall?.(p.pos.clone());
      return true;
    }
    return false;
  }

  /**
   * Bolas que (na história) entraram no azul temporal: quando o tempo passa de novo por
   * aquele instante — você voltou para antes dele —, a mesma bola some ali (ela é a que
   * saiu do laranja lá atrás). Se ela não estiver lá (você mexeu no caminho dela), é paradoxo.
   */
  closeBallLoops() {
    const prev = this.loopTw ?? this.tw;
    this.loopTw = this.tw;
    if (!this.blueEntries?.length || this.paused || this.sweep) return;
    this.blueEntries = this.blueEntries.filter((e) => this.tw - e.t < KEEP);
    // o tempo voltou para antes de um laço já fechado: ele tem de fechar de novo
    for (const e of this.blueEntries) if (e.closedAt > this.tw + 1e-6) e.closedAt = undefined;
    if (!(this.tw > prev)) return;
    for (const e of this.blueEntries) {
      if (!(e.t > prev && e.t <= this.tw)) continue;
      if (e.closedAt !== undefined) continue; // ela já entrou no ciano (um pouco antes) desta vez
      const p = this.ctx.energy.pellets.find((q) => this.sameBall(e, q));
      if (!p) {
        // ela sumiu antes da hora (pega, destruída, nem foi lançada): a que veio do futuro não poderia existir
        this.ctx.fx.paradox?.('a esfera que foi para o passado não chegou ao ciano desta vez', e.pos.clone());
        continue;
      }
      if (p.pos.distanceTo(e.pos) < 2.5) {
        this.ctx.fx.changed?.(p); // entrou no azul (que já não está aqui): vai para o passado
        this.ctx.energy.kill(p);
        e.closedAt = this.tw;
      } else this.ctx.fx.paradox?.('a esfera que foi para o passado não passou pelo ciano desta vez', p.pos.clone());
    }
  }

  /**
   * a bola `q` é a mesma da entrada `e` no azul? Pela identidade, ou pelo lançador: se você
   * voltou para antes de ela ser lançada, o lançador a dispara de novo com outra identidade
   */
  sameBall(e, q) {
    return e.uid === q.uid || (e.li >= 0 && e.li === this.ctx.world.launchers.indexOf(q.from));
  }

  /** solta pelo azul as bolas cuja hora de sair chegou (chamado a cada quadro) */
  pastPellets() {
    this.ctx.portals.setGhostStatics?.(this.liveGhosts().map((w) => ({ ...w.f, view: this.ghostExit(w) })));
    const prev = this.loopTw ?? this.tw;
    this.closeBallLoops();
    // bolas mandadas ao passado: você voltou para antes de elas saírem do vermelho e o
    // tempo chegou de novo àquele instante — elas saem de novo (a história se repete)
    if (this.tw > prev && !this.paused && !this.sweep)
      for (const d of this.ballDoubles ?? []) {
        if (!(d.from > prev && d.from <= this.tw) || !d.track.length) continue;
        const a = d.track[0].p;
        const v = d.v0.clone();
        const np = this.ctx.energy.spawnFree(a.clone(), v, d.life ?? 10);
        d.liveFrom = Math.min(d.liveFrom ?? Infinity, d.from);
        np.cooldown = 0.15;
        if (d.uid) np.uid = d.uid;
        this.ctx.fx.launch?.(a.clone());
      }
    // o tempo voltou (salto, paradoxo): as entradas no laranja depois de agora não aconteceram
    if (this.pastEntries?.length) this.pastEntries = this.pastEntries.filter((e) => e.tIn <= this.tw + 1e-6);
    this.scanPastBalls();
    if (!this.ballQueue?.length) return;
    const { portals, energy } = this.ctx;
    // o tempo voltou (salto, paradoxo): o que entrou depois de agora não aconteceu
    this.ballQueue = this.ballQueue.filter((b) => b.tIn <= this.tw + 1e-6);
    const keep = [];
    for (const b of this.ballQueue) {
      if (this.tw < b.tOut) {
        keep.push(b);
        continue;
      }
      // o laranja mudou de lugar ou fechou: a bola se perdeu no tempo
      // depois de um salto, o vermelho é o da sua versão passada (o mesmo lugar)
      const fits = (Q) => Q?.placed && Q.delta > 0 && portals.isLinked(Q) && this.orangeKey(Q) === b.key;
      const O = [b.O ?? portals.orange, ...portals.list].find(fits);
      if (!O) continue;
      const pos = b.pos.clone();
      const vel = b.vel.clone();
      portals.carry(O, pos, vel);
      pos.addScaledVector(vel.clone().normalize(), 0.25);
      const np = energy.spawnFree(pos, vel, b.life);
      np.cooldown = 0.15;
      this.ctx.fx.launch?.(pos);
    }
    this.ballQueue = keep;
  }

  /**
   * Bolas que JÁ estavam na história (antes de você abrir o laranja): conforme o
   * instante mostrado pelo laranja (agora − Δ) anda, procura nas fotos uma bola que bateu
   * onde hoje está o laranja. Ela entrou no portal (loop fechado) e sai agora pelo azul —
   * se isso não mudar o que já aconteceu: se, depois daquele instante, essa bola ligou um
   * receptor, tirá-la da história seria um paradoxo, e ela fica como estava.
   */
  scanPastBalls() {
    const { portals } = this.ctx;
    // o seu laranja temporal e os das suas versões passadas
    const oranges = portals.list.filter((P) => P.placed && P.delta > 0 && portals.isLinked(P));
    if (!oranges.length || this.paused || this.sweep) {
      this.scanT = null;
      this.scanTs = new Map();
      return;
    }
    this.scanTs ??= new Map();
    for (const O of oranges) this.scanPastBallsFor(O);
  }

  scanPastBallsFor(O) {
    const { portals, energy, world } = this.ctx;
    const cur = this.tw - O.delta;
    const from = this.scanTs.get(O) ?? cur;
    this.scanTs.set(O, cur);
    const limit = Math.min(cur, O.placedTw ?? -Infinity); // depois de abrir, quem cuida é ballIntoPast
    if (!(limit > from)) return;
    const n = O.normal;
    const R = 0.16;
    for (let i = Math.max(1, this.indexAt(from)); i <= this.indexAt(limit); i++) {
      const A = this.samples[i - 1];
      const B = this.samples[i];
      if (!A || !B || B.t <= from - 1e-6) continue;
      for (const a of A.w.pellets) {
        const vn = a.vel.dot(n);
        if (vn >= -1e-3) continue; // não vai em direção à parede do laranja
        const la = O.local(a.pos);
        if (la.z < -0.05) continue;
        const sHit = (la.z - R) / -vn;
        if (sHit < 0 || sHit > RATE * 1.5) continue;
        const at = a.pos.clone().addScaledVector(a.vel, sHit);
        const l = O.local(at);
        if ((l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 > 1) continue;
        const tHit = A.t + sHit;
        const key = `${a.li}|${Math.round(tHit * 30)}`;
        if (this.pastHits?.has(key)) continue;
        (this.pastHits ??= new Set()).add(key);
        // consequências: depois disso, essa mesma bola (a do lançador li, enquanto ela
        // existir sem sumir) foi pega por um receptor? Então tirá-la da história é paradoxo
        let caughtLater = false;
        for (let j = this.indexAt(tHit) + 1; j < this.samples.length; j++) {
          const S = this.samples[j].w;
          const P0 = this.samples[j - 1].w;
          const ball = P0.pellets.find((q) => q.li === a.li);
          if (!ball) break; // a bola acabou
          const flip = S.catchers.findIndex((on, c) => on && !P0.catchers[c] && world.catchers[c]?.pos.distanceTo(ball.pos) < 1.5);
          if (flip >= 0) {
            caughtLater = true;
            break;
          }
          if (!S.pellets.some((q) => q.li === a.li)) break; // sumiu sem ser pega
        }
        if (caughtLater) {
          this.ctx.fx.paradox?.('essa bola do passado ligou um receptor depois: ela não pode ter entrado no vermelho', at);
          continue;
        }
        // a mesma bola ainda existe agora? então ela some (foi para o portal lá atrás)
        for (const p of [...energy.pellets]) {
          const born = this.tw - ((p.from?.life ?? p.life) - p.life);
          if (world.launchers.indexOf(p.from) === a.li && born <= tHit + 0.05) {
            this.ctx.fx.changed?.(p); // a bola de agora some: ela entrou no laranja lá atrás
            energy.kill(p);
          }
        }
        (this.pastEntries ??= []).push({ li: a.li, tIn: tHit });
        const out = { tIn: tHit, tOut: tHit + O.delta, pos: at, vel: a.vel.clone(), key: this.orangeKey(O), life: world.launchers[a.li]?.life ?? a.life };
        (this.ballQueue ??= []).push(out);
      }
    }
  }

  /**
   * Bola do presente que entra no azul temporal: vai para o passado. Sai do laranja em
   * Td = agora − Δ e anda Δ segundos lá (simulado agora): quica, pode ser pega por um
   * receptor (que fica ligado), pode voltar a entrar no laranja (sai do azul Δ s depois)
   * ou acabar o tempo dela. Se no caminho ela acertaria você (onde você estava então), é
   * paradoxo: ela não vai. Se sobreviver, ela está agora onde a simulação terminou.
   */
  ballToPast(p, blue) {
    const { portals, world } = this.ctx;
    const O = blue.partner;
    const delta = O.delta;
    if (!(delta > 0) || this.paused || this.sweep) return false;
    // repetição: esta bola já foi mandada ao passado por este azul neste instante (o
    // da sua versão passada) — é o laço fechando; ela só entra, sem mandar de novo
    const again = this.blueEntries?.find((e) => this.sameBall(e, p) && Math.abs(e.t - this.tw) < 0.6);
    if (again) {
      again.closedAt = this.tw;
      this.ctx.fx.changed?.(p);
      return true;
    }
    const Td = this.tw - delta;
    if (Td < this.samples[0].t - 1e-6) return false;
    const pos = p.pos.clone();
    const vel = p.vel.clone();
    portals.carry(blue, pos, vel);
    pos.addScaledVector(O.normal, 0.2);
    const v0 = vel.clone(); // velocidade de saída do vermelho (a simulação muda `vel`)
    const sim = this.simBall(pos, vel, Math.max(p.life, p.from?.life ?? 0), Td, delta);
    if (sim.paradox) {
      this.ctx.fx.paradox?.(sim.paradox, sim.at ?? pos);
      return 'paradox';
    }
    // a bola do passado só existe enquanto voou de verdade: se entrou de novo no laranja,
    // foi pega ou acabou, some ali (sem ficar "grudada" na vista do azul)
    const end = sim.alive ? this.tw : Math.min(this.tw, (sim.track[sim.track.length - 1]?.t ?? Td) + RATE);
    (this.ballDoubles ??= []).push({ from: Td, to: end, track: sim.track, v0, mesh: null, life: Math.max(p.life, p.from?.life ?? 0) });
    // o laço fecha: se você voltar para antes de agora, esta mesma bola (a mais nova)
    // tem de entrar no azul de novo neste instante e neste lugar
    if (p.uid) (this.blueEntries ??= []).push({ uid: p.uid, li: world.launchers.indexOf(p.from), t: this.tw, pos: p.pos.clone(), closedAt: this.tw });
    for (const C of sim.caught) {
      if (C.active) continue;
      C.active = true;
      if (p.from && !p.from.free) p.from.done = true;
      this.ctx.fx.caught?.(C);
      this.ctx.fx.changed?.(C.group, true); // o receptor de agora foi ligado lá atrás
    }
    for (const r of sim.reenter) (this.ballQueue ??= []).push(r);
    if (sim.alive) {
      const np = this.ctx.energy.spawnFree(sim.pos, sim.vel, sim.life);
      this.ballDoubles[this.ballDoubles.length - 1].uid = np.uid; // a mesma bola, se a história se repetir
      np.cooldown = 0.1;
      this.ctx.fx.changed?.(np, true); // a bola aparece onde estaria agora
    }
    return true;
  }

  /** voo de uma bola no passado, de t0 a t0 + dur, contra o cenário de agora */
  simBall(pos, vel, life, t0, dur) {
    const { world, portals } = this.ctx;
    const R = 0.16;
    const O = portals.orange;
    const track = [];
    const caught = [];
    const reenter = [];
    const dt = 1 / 120;
    let next = 0;
    let t = 0;
    for (; t <= dur + 1e-9; t += dt) {
      if (t >= next - 1e-9) {
        // `v` e `life` próprios da bola (fora da dilatação): é com eles que ela renasce no meio do voo
        track.push({ t: t0 + t, p: pos.clone(), v: vel.clone(), life });
        next += RATE;
      }
      // campo de dilatação ativo ali naquele instante: a bola anda e envelhece no tempo dele
      const ks = this.ctx.timeScaleAt?.(pos, t0 + t) ?? 1;
      life -= dt * ks;
      if (life <= 0) return { track, caught, reenter, alive: false };
      // você estava ali naquele instante?
      const S = this.samples[this.indexAt(t0 + t)];
      if (S) {
        const half = this.ctx.player.half;
        const d = pos.clone().sub(S.p);
        if (Math.abs(d.x) < half.x + R && Math.abs(d.y) < half.y + R && Math.abs(d.z) < half.z + R)
          return { track, caught, reenter, paradox: 'a bola mandada ao passado teria acertado você', at: pos.clone() };
      }
      let rest = vel.length() * dt * ks;
      while (rest > 1e-5) {
        const step = Math.min(rest, 0.12);
        rest -= step;
        const dir = vel.clone().normalize();
        const hit = world.raycast(pos, dir, step + R);
        if (hit) {
          // de novo no laranja: entra e sai pelo azul Δ s depois
          const l = O.local(hit.point);
          if (O.placed && Math.abs(l.z) < 0.1 && (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 1) {
            reenter.push({ tIn: t0 + t, tOut: t0 + t + O.delta, pos: pos.clone(), vel: vel.clone(), key: this.orangeKey(O), life: Math.max(life, 1) });
            return { track, caught, reenter, alive: false };
          }
          pos.copy(hit.point).addScaledVector(hit.normal, R + 0.002);
          vel.addScaledVector(hit.normal, -2 * vel.dot(hit.normal));
          continue;
        }
        pos.addScaledVector(dir, step);
      }
      const C = world.catchers.find((c) => !c.active && c.pos.distanceTo(pos) < (c.radius ?? 0.8));
      if (C) {
        caught.push(C);
        return { track, caught, reenter, alive: false };
      }
    }
    return { track, caught, reenter, alive: true, pos, vel, life };
  }

  // ------------------------------------------------------------------ torretas e o par temporal
  /** onde estava o seu olho Δ segundos atrás (o "você do passado" visto pelo azul) */
  pastSelfEye(delta) {
    if (!(delta > 0) || this.paused) return null;
    const S = this.samples[this.indexAt(this.tw - delta)];
    if (!S || this.tw - delta < this.samples[0].t) return null;
    return S.p.clone().add(new V3(0, 0.7 * (S.up ?? 1), 0));
  }

  /**
   * Torretas do passado: cada uma, na pose que tinha Δ s atrás, olhando para o laranja
   * (que estava aberto naquele instante) vê você agora pelo azul e atira — as balas saem
   * do azul. Devolve quantos tiros te acertaram neste quadro.
   */
  pastTurretShots(dt, eye) {
    const { portals, world } = this.ctx;
    const O = portals.orange;
    const B = portals.blue;
    if (!dt || this.paused || this.sweep || !O.placed || !(O.delta > 0) || !B.placed || !portals.isLinked(O)) return 0;
    const S = this.samples[this.indexAt(this.tw - O.delta)]?.w;
    if (!S) return 0;
    const aim = eye.clone().applyMatrix4(portals.transform(B, O)); // você, visto do lado do laranja
    const toB = portals.transform(O, B);
    this.pastLock ??= new Map();
    let shots = 0;
    this.props().forEach((t, k) => {
      const st = S.props[k];
      if (t.kind !== 'turret' || !st || st.gone) return this.pastLock.delete(k);
      const up = new V3(0, 1, 0).applyQuaternion(st.q);
      if (up.y < 0.6) return this.pastLock.delete(k); // caída então: desligada
      const sc = t.mesh?.scale.x ?? 1;
      const tEye = new V3(0, 0.35, 0.2).multiplyScalar(sc).applyQuaternion(st.q).add(st.p);
      const fwd = new V3(0, 0, 1).applyQuaternion(st.q);
      const to = aim.clone().sub(tEye);
      const dist = to.length();
      const dir = to.divideScalar(dist);
      let ok = dist < 26 && Math.acos(THREE.MathUtils.clamp(dir.dot(fwd), -1, 1)) < THREE.MathUtils.degToRad(55);
      let x = null;
      if (ok) {
        const sa = tEye.clone().sub(O.center).dot(O.normal);
        const den = dir.dot(O.normal);
        ok = sa > 0.02 && den < -1e-4;
        if (ok) {
          const sHit = -sa / den;
          x = tEye.clone().addScaledVector(dir, sHit);
          const l = O.local(x);
          ok = (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 0.85 && !(world.raycast(tEye, dir, Math.max(0, sHit - 0.12))?.dist >= 0);
        }
      }
      if (ok) {
        // do lado de agora: da boca do azul até você
        const xb = x.clone().applyMatrix4(toB);
        const d2 = eye.clone().sub(xb);
        const L = d2.length();
        d2.divideScalar(L);
        ok = !(L > 0.6 && world.physics?.castRay(xb.clone().addScaledVector(d2, 0.12), d2, L - 0.55));
        if (ok) {
          const lock = Math.min(1, (this.pastLock.get(k) ?? 0) + dt / 0.7);
          this.pastLock.set(k, lock);
          if (lock >= 1) {
            const acc = (this.pastAcc?.get(k) ?? 0) + dt;
            let n = Math.floor(acc / 0.1);
            (this.pastAcc ??= new Map()).set(k, acc - n * 0.1);
            shots += n;
            if (n) this.pastTracer(xb, eye);
          }
          return;
        }
      }
      this.pastLock.delete(k);
    });
    if (shots && !this.saidPastTurret) {
      this.saidPastTurret = true;
      this.ctx.fx.toast?.('Uma torreta do passado viu você pelo vermelho: as balas saem do ciano.');
    }
    return shots;
  }

  /** risco de bala saindo da boca do azul */
  pastTracer(from, to) {
    this.tracers ??= [];
    let tr = this.tracers.find((l) => l.material.opacity <= 0.05);
    if (!tr) {
      tr = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false }));
      tr.frustumCulled = false;
      this.ctx.scene.add(tr);
      this.tracers.push(tr);
    }
    const d = to.clone().sub(from);
    const a = from.clone().addScaledVector(d, Math.random() * 0.3);
    tr.geometry.setFromPoints([a, a.clone().addScaledVector(d.normalize(), 1.4)]);
    tr.material.opacity = 0.9;
    const fade = () => {
      tr.material.opacity *= 0.6;
      if (tr.material.opacity > 0.05) requestAnimationFrame(fade);
      else tr.material.opacity = 0;
    };
    requestAnimationFrame(fade);
  }

  /** bolas mandadas ao passado: como estavam no instante T (para a vista do azul) */
  showBallDoubles(T) {
    this.ballMeshes ??= [];
    let n = 0;
    for (const d of this.ballDoubles ?? []) {
      if (T < d.from - 1e-6 || T >= d.to) continue;
      // a partir de `liveFrom` ela já é uma bola de verdade na gravação (aparece sozinha): sem desenho duplicado
      if (T >= (d.liveFrom ?? Infinity) - 1e-6) continue;
      const i = Math.max(0, Math.min(d.track.length - 1, Math.floor((T - d.from) / RATE)));
      let m = this.ballMeshes[n];
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.6), toneMapped: false }));
        this.ctx.scene.add(m);
        this.ballMeshes[n] = m;
      }
      m.visible = true;
      m.position.copy(d.track[i].p);
      n++;
    }
    for (let i = n; i < this.ballMeshes.length; i++) this.ballMeshes[i].visible = false;
  }

  /**
   * Objeto solto que entra no azul temporal: vai para o passado. Ele sai do laranja no
   * instante Td = agora − Δ e, de lá até agora, cai/quica/escorrega (simulado de uma vez
   * contra o cenário). Entre Td e agora existem DOIS dele: o mais novo (a gravação, que
   * acaba de entrar no azul) e o mais velho (o "duplo", que veio do laranja). O duplo
   * aparece na vista do azul, existe de verdade (colide e aperta botões) se você voltar
   * para dentro desse intervalo, e se funde ao objeto real no instante em que ele foi
   * jogado. Agora, só existe o mais velho: o objeto real vai para onde o duplo chegou.
   */
  sendToPast(prop, blue) {
    const { portals, world } = this.ctx;
    const O = blue.partner;
    const delta = O.delta;
    if (!(delta > 0) || this.paused || this.sweep) return;
    const Td = this.tw - delta;
    if (Td < this.samples[0].t - 1e-6) return;
    const k = this.props().indexOf(prop);
    const pos = prop.pos.clone();
    const vel = prop.vel.clone();
    const { rot } = portals.carry(blue, pos, vel);
    const quat = rot.clone().multiply(prop.quat);
    const h = (prop.half?.y ?? 0.3) * 0.95;
    pos.addScaledVector(O.normal, h + 0.05);
    const g = this.ctx.gravityAt?.(pos)?.clone() ?? new V3(0, -9.81, 0);
    // Δ segundos de voo, em passos de 1/120 s; a pose fica guardada a cada quadro do relógio
    const track = [];
    const dt = 1 / 120;
    let next = 0;
    for (let t = 0; t <= delta + 1e-9; t += dt) {
      if (t >= next - 1e-9) {
        track.push({ t: Td + t, p: pos.clone(), q: quat.clone() });
        next += RATE;
      }
      // dentro de um campo de dilatação ativo naquele instante, o cubo vive no tempo do campo
      const ks = this.ctx.timeScaleAt?.(pos, Td + t) ?? 1;
      vel.addScaledVector(g, dt * ks);
      const move = vel.length() * dt * ks;
      if (move > 1e-6) {
        const dir = vel.clone().normalize();
        const hit = world.raycast(pos, dir, move + h);
        if (hit && hit.dist < move + h) {
          pos.addScaledVector(dir, Math.max(0, hit.dist - h - 0.002));
          const vn = vel.dot(hit.normal);
          vel.addScaledVector(hit.normal, -1.15 * vn);
        } else pos.addScaledVector(dir, move);
      }
      // apoio: nunca dentro do chão; no chão, sem afundar e com atrito
      const down = g.clone().normalize();
      const floor = world.raycast(pos.clone().addScaledVector(down, -0.2), down, h + 0.22);
      if (floor && floor.dist < h + 0.2) {
        pos.addScaledVector(down, -(h + 0.2 - floor.dist));
        const vd = vel.dot(down);
        if (vd > 0) vel.addScaledVector(down, -vd);
        vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
      }
    }
    this.doubles ??= [];
    // desde quando este objeto existe na história: antes disso não há o "mais novo" dele, só o duplo
    // (anotado agora — nas voltas seguintes a gravação daquele trecho é refeita e já o incluiria)
    let born = Infinity;
    for (const s of this.samples) {
      const pr = s.w?.props?.[k];
      if (pr && !pr.gone) {
        born = s.t;
        break;
      }
    }
    this.doubles.push({ k, prop, from: Td, to: this.tw, born, track, mesh: null, box: null });
    this.free.add(prop); // sai de qualquer trilho de gravação
    this.driven.delete(prop);
    prop.place(pos, quat, { x: vel.x, y: vel.y, z: vel.z });
    this.ctx.fx.changed?.(prop, true); // o cubo aparece onde o passado o deixou
    this.ctx.fx.toPast?.(pos);
  }

  /** pose do duplo no instante t (ou null fora do intervalo dele) */
  doubleAt(d, t) {
    if (t < d.from - 1e-6 || t >= d.to) return null;
    const i = Math.max(0, Math.min(d.track.length - 1, Math.floor((t - d.from) / RATE)));
    const a = d.track[i];
    const b = d.track[Math.min(i + 1, d.track.length - 1)];
    const k = b === a ? 0 : Math.min(1, (t - a.t) / RATE);
    return { p: a.p.clone().lerp(b.p, k), q: a.q.clone().slerp(b.q, k) };
  }

  doubleMesh(d) {
    if (d.mesh) return d.mesh;
    d.mesh = d.prop.mesh.clone(true);
    d.mesh.traverse((o) => {
      if (o.isLight) o.visible = false;
    });
    d.mesh.visible = false;
    this.ctx.scene.add(d.mesh);
    return d.mesh;
  }

  /** mostra o duplo numa pose (o modelo do objeto fica com o centro em p) */
  poseDouble(d, st) {
    const m = this.doubleMesh(d);
    m.visible = !!st;
    if (!st) return;
    m.quaternion.copy(st.q);
    m.position.copy(d.prop.meshOffset ?? new V3()).applyQuaternion(st.q).add(st.p);
  }

  /** a cada quadro: duplos visíveis e com colisão só dentro do intervalo deles */
  updateDoubles() {
    if (!this.doubles?.length) return;
    const phys = this.ctx.world.physics;
    const sample = this.samples[this.indexAt(this.tw)]?.w;
    for (const d of this.doubles) {
      const st = this.doubleAt(d, this.tw);
      this.poseDouble(d, st);
      // o objeto ainda não existia nessa parte da história (veio depois): só o duplo existe;
      // no fim do intervalo, o objeto real reaparece onde o duplo chegou
      const younger = sample?.props?.[d.k];
      const youngerHere = d.born !== undefined ? this.tw >= d.born - 1e-6 : younger && !younger.gone;
      // (antes de o duplo sair do vermelho também: o objeto ainda nem existe nessa parte da história)
      if ((st || this.tw < d.from) && !youngerHere && !d.prop.gone && !d.prop.held) {
        this.ctx.fx.changed?.(d.prop);
        d.prop.vanish();
        d.hid = true;
      } else if (!st && d.hid && this.tw >= d.to) {
        d.hid = false;
        const end = d.track[d.track.length - 1];
        d.prop.gone = false;
        d.prop.body?.setEnabled(true);
        d.prop.place(end.p, end.q);
        this.ctx.fx.changed?.(d.prop, true);
      }
      const h = d.prop.half ?? new V3(0.3, 0.3, 0.3);
      if (st) {
        if (!d.box && phys?.addBox) {
          d.box = { min: st.p.clone().sub(h), max: st.p.clone().add(h) };
          phys.addBox(d.box, true);
          d.box.world = phys.world; // o mundo da física é trocado ao reiniciar o mapa
        }
        if (d.box) {
          d.box.min.copy(st.p).sub(h);
          d.box.max.copy(st.p).add(h);
          phys.moveBox(d.box);
        }
      } else if (d.box) this.dropDoubleBody(d);
    }
    // história velha demais: esquece
    this.doubles = this.doubles.filter((d) => {
      if (this.tw - d.to < KEEP) return true;
      this.dropDouble(d);
      return false;
    });
  }

  dropDoubleBody(d) {
    const phys = this.ctx.world.physics;
    // só se o corpo ainda é deste mundo (ao reiniciar, o mundo velho já foi descartado)
    if (d.box?.collider && phys?.world && d.box.world === phys.world) {
      phys.ents.delete(d.box.collider.handle);
      if (d.box.kbody) phys.world.removeRigidBody(d.box.kbody);
      else phys.world.removeCollider(d.box.collider, false);
    }
    d.box = null;
  }

  dropDouble(d) {
    this.dropDoubleBody(d);
    if (d.mesh) this.ctx.scene.remove(d.mesh);
  }

  // ------------------------------------------------------------------ o passado visto pelo azul e mirado pelo laranja
  /** roda `fn` com as portas/plataformas nas posições do passado (colisores incluídos) */
  inPast(delta, fn) {
    const { world } = this.ctx;
    const snap = this.samples[this.indexAt(this.tw - delta)].w;
    const saved = world.doors.map((d) => [d.open, d.target]);
    world.doors.forEach((d, k) => {
      if (snap.doors[k]) d.open = snap.doors[k][0];
    });
    world.update(this.vt, 0); // (o tempo visual, o mesmo do main: senão a lava e as animações pulam entre os dois)
    try {
      return fn();
    } finally {
      world.doors.forEach((d, k) => {
        d.open = saved[k][0];
        d.target = saved[k][1];
      });
      world.update(this.vt, 0); // (o tempo visual, o mesmo do main: senão a lava e as animações pulam entre os dois)
    }
  }

  /** poses visuais do passado (para o render do azul e para o "rebobinar" do salto); devolve o desfazer */
  applyVisual(snap, { keep = null } = {}) {
    const { world, energy } = this.ctx;
    const undo = [];
    world.doors.forEach((d, k) => {
      if (!snap.doors[k]) return;
      const old = d.mesh.position.clone();
      doorOffset(d, snap.doors[k][0], d.mesh.position);
      undo.push(() => d.mesh.position.copy(old));
    });
    // botões: afundados e verdes se estavam pisados
    world.buttons.forEach((b, k) => {
      const was = snap.buttons[k];
      if (!was || !b.plate) return;
      const y = b.plate.position.y;
      const col = b.plate.material.color.clone();
      const em = b.plate.material.emissive.clone();
      const lc = b.lights?.color?.clone();
      const on = was[0] ? 1 : 0;
      b.plate.position.y = 0.16 - 0.07 * on;
      b.plate.material.color.set(on ? 0x27ae60 : 0xc0392b);
      b.plate.material.emissive.set(on ? 0x0a4a20 : 0x5a0a05);
      if (on) b.lights?.color?.setRGB(0.3, 2.6, 0.7);
      else b.lights?.color?.setRGB(2.6, 0.25, 0.12);
      undo.push(() => {
        b.plate.position.y = y;
        b.plate.material.color.copy(col);
        b.plate.material.emissive.copy(em);
        if (lc) b.lights.color.copy(lc);
      });
    });
    this.props().forEach((c, k) => {
      const p = snap.props[k];
      if (!p || !c.mesh || c === keep) return;
      const pos = c.mesh.position.clone();
      const quat = c.mesh.quaternion.clone();
      const vis = c.mesh.visible;
      c.mesh.position.copy(p.p);
      c.mesh.quaternion.copy(p.q);
      c.mesh.visible = !p.gone;
      undo.push(() => {
        c.mesh.position.copy(pos);
        c.mesh.quaternion.copy(quat);
        c.mesh.visible = vis;
      });
    });
    // as bolas de agora somem; as de então aparecem como esferas brilhantes
    for (const p of energy.pellets) {
      const g = p.group.visible;
      const tr = p.trail.visible;
      p.group.visible = false;
      p.trail.visible = false;
      undo.push(() => {
        p.group.visible = g;
        p.trail.visible = tr;
      });
    }
    this.pastBalls ??= [];
    // bolas que (na história nova) já tinham entrado no laranja nesse instante não aparecem
    const T = snap === this._viewSnap ? this._viewT : null;
    const entered = (p) => {
      if (T == null || p.li < 0) return false;
      const born = T - ((world.launchers[p.li]?.life ?? p.life) - p.life);
      return (this.pastEntries ?? []).some((e) => e.li === p.li && e.tIn <= T + 1e-6 && born <= e.tIn + 0.05);
    };
    let shown = 0;
    snap.pellets.forEach((p) => {
      if (entered(p)) return;
      const i = shown++;
      let b = this.pastBalls[i];
      if (!b) {
        b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.6), toneMapped: false }));
        this.ctx.scene.add(b);
        this.pastBalls[i] = b;
      }
      b.visible = true;
      b.position.copy(p.pos);
    });
    for (let i = shown; i < this.pastBalls.length; i++) this.pastBalls[i].visible = false;
    undo.push(() => this.pastBalls.forEach((b) => (b.visible = false)));
    return () => undo.reverse().forEach((f) => f());
  }

  /** usado pelo render do azul temporal: a sala como estava Δ segundos antes */
  beginPast(delta) {
    const T = this.tw - delta;
    const s = this.samples[this.indexAt(T)];
    this._viewSnap = s.w;
    this._viewT = T;
    this._undoPast = this.applyVisual(s.w);
    this.ctx.beams?.pastView(true);
    // o marcador e o holograma da pausa são só para quem está no presente: dentro da vista do azul
    // o marcador fica colado na câmera virtual e cobre tudo de branco
    this._hide = [this.eco?.g, this.holo?.group].filter((g) => g?.visible);
    for (const g of this._hide) g.visible = false;
    // clones: onde estavam então; e você mesmo, onde estava
    this._cloneVis = this.clones.map((c) => c.ghost?.group.visible);
    for (const c of this.clones) if (c.echo) this.clonePose(c, T) ? this.poseEcho(c, T) : (c.echo.mesh.visible = false);
    const t = this.ctx.t();
    const dt = this.ctx.dtReal?.() ?? 1 / 60;
    this.clones.forEach((c) => {
      const pose = this.clonePose(c, T);
      if (!pose) {
        if (c.ghost) c.ghost.group.visible = false;
        return;
      }
      c.ghost ??= this.ctx.makeGhost();
      c.ghost.set(this.feetOf(pose.p, pose.up), pose.yaw, pose.up, pose.mv, t, dt, 0.7);
    });
    this._pastSelf ??= this.ctx.makeGhost();
    this._pastSelf.set(this.feetOf(s.p, s.up), s.yaw, s.up, s.mv, t, dt, 0.9);
    // objetos mandados para o passado: o duplo deles, como estava então
    for (const d of this.doubles ?? []) this.poseDouble(d, this.doubleAt(d, T));
    this.showBallDoubles(T);
    // o que você está segurando e enfiou no azul aparece saindo do laranja (como num
    // portal comum, o pedaço que já passou é visto do outro lado)
    const held = this.ctx.held?.();
    const { portals } = this.ctx;
    const B = portals.blue;
    if (held && !held.gone && B.placed && B.partner?.delta > 0 && portals.temporalWallNear?.(held.pos) === B) {
      const M = portals.transform(B, B.partner);
      const m = held.mesh;
      const old = { p: m.position.clone(), q: m.quaternion.clone(), v: m.visible };
      const world = new THREE.Matrix4().compose(held.pos, held.quat, new THREE.Vector3(1, 1, 1)).premultiply(M);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      world.decompose(p, q, new THREE.Vector3());
      m.quaternion.copy(q);
      m.position.copy(held.meshOffset ?? new THREE.Vector3()).applyQuaternion(q).add(p);
      m.visible = true;
      const undo0 = this._undoPast;
      this._undoPast = () => {
        m.position.copy(old.p);
        m.quaternion.copy(old.q);
        m.visible = old.v;
        undo0?.();
      };
    }
  }

  endPast() {
    this.ctx.beams?.pastView(false);
    for (const d of this.doubles ?? []) this.poseDouble(d, this.doubleAt(d, this.tw));
    for (const m of this.ballMeshes ?? []) m.visible = false;
    for (const g of this._hide ?? []) g.visible = true;
    this._hide = null;
    this._undoPast?.();
    this._undoPast = null;
    if (this._pastSelf) this._pastSelf.group.visible = false;
    this.clones.forEach((c, i) => {
      if (c.ghost) c.ghost.group.visible = !!this._cloneVis?.[i];
      if (c.echo) this.clonePose(c) ? this.poseEcho(c, this.tw) : (c.echo.mesh.visible = false);
    });
  }

  // ------------------------------------------------------------------ colocar o laranja no passado
  /**
   * Tiro laranja com Δ: o raio vê as paredes (portas) do instante tw − Δ.
   * Devolve o resultado de `portals.tryPlace` ou `{ ok: false, why }`.
   */
  placeOrange(origin, dir, delta) {
    const { world, portals } = this.ctx;
    return this.inPast(delta, () => {
      const hit = world.raycast(origin, dir, 400);
      if (hit?.box.kinematic) return { ok: false, why: 'Não dá para abrir portal numa porta que se mexe, no passado.' };
      const res = portals.tryPlace('orange', origin, dir);
      if (res.ok) {
        portals.orange.delta = delta;
        portals.orange.fixed = false;
        portals.orange.placedTw = this.tw; // antes disso, as bolas da história contam pelas fotos
        this.pastHits = new Set();
      }
      return res;
    });
  }

  /** o espaço de chegada (no laranja, no instante de destino) está ocupado? */
  destinationBlocked(sample) {
    const { portals, world, player } = this.ctx;
    const O = portals.orange;
    if (!(O.placed && O.delta > 0)) return false;
    const need = Math.abs(O.normal.x) * player.half.x + Math.abs(O.normal.z) * player.half.z + 0.05;
    const pos = O.center.clone().addScaledVector(O.normal, Math.abs(O.normal.y) > 0.5 ? player.half.y + 0.1 : need);
    if (Math.abs(O.normal.y) < 0.5) pos.y = Math.max(pos.y, O.center.y - 0.1);
    const min = pos.clone().sub(player.half);
    const max = pos.clone().add(player.half);
    const snap = (sample ?? this.samples[this.indexAt(this.tw - O.delta)]).w;
    return this.inPast(O.delta, () => {
      for (const b of world.solids) {
        if (b.solid === false) continue;
        if (overlap(min, max, b.min, b.max, 0.1)) return true;
      }
      const T = this.tw - O.delta;
      for (const c of this.clones) {
        const pose = this.clonePose(c, T);
        if (pose && overlap(min, max, pose.p.clone().sub(player.half), pose.p.clone().add(player.half), 0.05)) return true;
      }
      return snap.props.some((p) => !p.gone && overlap(min, max, p.p.clone().addScaledVector(new V3(1, 1, 1), -0.32), p.p.clone().addScaledVector(new V3(1, 1, 1), 0.32), 0.05));
    });
  }

  // ------------------------------------------------------------------ o salto
  /** o jogador atravessou o azul temporal (já levado ao laranja pelo portal) */
  jump(blue) {
    const { player, portals } = this.ctx;
    const orange = blue.partner;
    const delta = orange.delta;
    if (!(delta > 0)) return false;
    // o que você fez com o mundo parado logo antes de saltar também é passado: o último quadro
    // guardado passa a ser este instante (com você onde estava ao entrar no azul)
    if ((this.paused || this.gap) && this.samples.length > 1) {
      const last = this.samples.pop();
      this.gap = true;
      this.record(last.t);
      const s = this.samples[this.samples.length - 1];
      if (this.pre) Object.assign(s, { p: this.pre.pos.clone(), yaw: this.pre.yaw, pitch: this.pre.pitch, up: this.pre.up });
    }
    const cp = this.makeCheckpoint(blue, orange);
    const Td = this.tw - delta;
    if (Td < this.samples[0].t - 1e-6) {
      this.rollback(cp, 'não há história guardada tão longe assim');
      return false;
    }
    const i = this.indexAt(Td);
    const tail = this.samples.slice(i);
    // 1) o mundo volta ao instante de destino (tudo é sobrescrito)
    this.restore(this.samples[i].w);
    // 2) o destino não pode estar ocupado
    if (this.playerBlocked([orange])) {
      this.rollback(cp, 'o destino está ocupado');
      return false;
    }
    this.resetDriven();
    // 3) o objeto segurado viaja com você; até o instante do salto ele existe duas vezes:
    //    a cópia do passado refaz a gravação dele e some no azul com o clone
    const held = this.ctx.held?.();
    const heldK = held ? this.props().indexOf(held) : -1;
    if (held) {
      const pos = player.eye().addScaledVector(player.forward(), 1.4);
      held.place(pos, held.quat);
    }
    // 4) o seu passado vira um clone (com os usos que ele fez de cada objeto)
    this.clones = this.clones.filter((c) => c.end >= Td || (this.dropClone(c), false));
    this.clones.push({
      id: `clone${++this.cloneSeq}`,
      born: this.samples[i].t,
      end: tail[tail.length - 1].t,
      script: tail,
      eps: this.episodes(tail, heldK),
      echo: heldK >= 0 ? { k: heldK, mesh: this.makeEcho(held) } : null,
      ghost: null,
      cp,
      exit: { c: blue.center.clone(), n: blue.normal.clone(), u: blue.up.clone() },
      bad: {},
      // laser que você mandou para o passado: sai do laranja Δ antes de cada entrada no azul
      laserEmits: tail.flatMap((s) => (s.lz ?? []).map((e) => ({ t: s.t - e.delta, entryT: s.t, at: e.at, exit: e.exit, dir: e.dir, frame: e.frame, bridge: e.bridge }))),
    });
    this.samples = this.samples.slice(0, i + 1);
    this.tw = this.samples[i].t;
    this.next = this.tw + RATE;
    this.arrival = this.tw;
    this.markArrive = true; // o próximo quadro guardado é a chegada (a versão passada não "desliza" até lá)
    // bolas mandadas ao passado que estão no ar no instante de destino: existem de verdade
    // (criadas quando o "rebobinar" termina — ele restaura o mundo de novo)
    this.pendingBalls = [];
    for (const d of this.ballDoubles ?? []) {
      if (this.tw < d.from - 1e-6 || this.tw >= d.to) continue;
      const k = Math.max(0, Math.min(d.track.length - 1, Math.round((this.tw - d.from) / RATE)));
      const s = d.track[k];
      // velocidade e vida gravadas na simulação (a diferença entre dois quadros erra num quique e,
      // dentro de um campo de dilatação, daria a velocidade lenta como se fosse a de verdade)
      const v = s.v?.clone() ?? (d.track[k + 1] ?? s).p.clone().sub(d.track[Math.max(0, k - 1)].p).divideScalar(RATE * 2);
      if (v.lengthSq() > 1e-4) {
        this.pendingBalls.push({ pos: s.p.clone(), vel: v, life: Math.max(1, s.life ?? (d.life ?? 10) - (this.tw - d.from)), uid: d.uid });
        d.liveFrom = Math.min(d.liveFrom ?? Infinity, this.tw);
      }
    }
    // (o registro fica: voltando de novo, a mesma bola sai do vermelho de novo — é história, vale em todas as voltas)
    // 5) os portais se desfazem; o mundo "rebobina" ao seu redor
    portals.fizzle();
    this.paused = false;
    this.setFreeze(true); // durante o "rebobinar" visual o mundo fica parado
    this.setHolo(false);
    this.sweep = { tail, t: 0, dur: 0.75, undo: null };
    this.ctx.fx.jump?.(delta);
    return true;
  }

  makeCheckpoint(blue, orange) {
    const frame = (P) => ({ placed: !!P.placed, c: P.center.clone(), n: P.normal.clone(), u: P.up.clone(), box: P.box });
    return {
      samples: this.samples,
      clones: this.clones.slice(),
      doubles: (this.doubles ?? []).slice(),
      tw: this.tw,
      next: this.next,
      arrival: this.arrival,
      w: this.snapshot(),
      extra: this.ctx.checkpointExtra?.(), // estado do jogo fora do relógio (campos de dilatação)
      player: this.pre,
      // os SEUS portais (o salto pode ter sido pelo azul de uma versão passada, e aí os
      // seus podem nem estar abertos); `entered`: o azul por onde você entrou
      entered: frame(blue),
      blue: frame(this.ctx.portals.blue),
      orange: { ...frame(this.ctx.portals.orange), delta: this.ctx.portals.orange.delta },
    };
  }

  /**
   * "O destino está ocupado": no instante de destino, o seu corpo (saindo do laranja)
   * entraria numa peça sólida (porta, plataforma, parede) ou num cubo/torreta. Usa a forma
   * real das peças (planos), não a caixa que as envolve, e ignora o que está desligado.
   */
  /** `mouths`: portais por onde o jogador acabou de sair (a parede/teto deles não conta) */
  playerBlocked(mouths = []) {
    const { player, world, portals } = this.ctx;
    const m = 0.1; // folga: encostar não conta
    const min = player.pos.clone().sub(player.half).addScalar(m);
    const max = player.pos.clone().add(player.half).subScalar(m);
    const corners = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push(new V3(x, y, z));
    for (const b of world.solids) {
      if (b.solid === false || b.disabled || !overlap(min, max, b.min, b.max)) continue;
      if (mouths.length && portals.passes(b, mouths, min, max)) continue;
      let planes = b.planes;
      if (!planes && b.obb) {
        // caixa girada: os 6 planos dela
        planes = [];
        for (let i = 0; i < 3; i++)
          for (const sgn of [1, -1]) {
            const n = new V3(i === 0 ? sgn : 0, i === 1 ? sgn : 0, i === 2 ? sgn : 0).applyQuaternion(b.obb.q);
            planes.push({ n, d: n.dot(b.obb.c) + b.obb.half.getComponent(i) });
          }
      }
      // separado por algum plano da peça? então não encosta
      if (planes && planes.some((pl) => corners.every((c) => pl.n.dot(c) > pl.d))) continue;
      return true;
    }
    for (const c of this.props()) {
      if (c.gone) continue;
      if (overlap(min, max, c.pos.clone().addScaledVector(new V3(1, 1, 1), -0.3), c.pos.clone().addScaledVector(new V3(1, 1, 1), 0.3), 0.05)) return true;
    }
    return false;
  }

  /** "rebobina" visualmente o trecho que você viveu (T_j → T_d) enquanto o mundo está parado */
  stepSweep(dt) {
    const S = this.sweep;
    S.t += dt;
    const k = Math.min(1, S.t / S.dur);
    S.undo?.();
    const idx = Math.round((1 - k) * (S.tail.length - 1));
    S.undo = k < 1 ? this.applyVisual(S.tail[idx].w, { keep: this.ctx.held?.() ?? null }) : null;
    // as bolas não aparecem no "rebobinar": passar Δ segundos de quiques em 0,75 s vira
    // um zigue-zague; elas surgem já no lugar quando o mundo chega ao destino
    for (const b of this.pastBalls ?? []) b.visible = false;
    if (k >= 1) {
      this.sweep = null;
      // (o objeto que viajou com você na mão não volta para onde estava no passado)
      this.restore(this.samples[this.samples.length - 1].w, { keep: this.ctx.held?.() ?? null });
      for (const b of this.pendingBalls ?? []) {
        const np = this.ctx.energy.spawnFree(b.pos, b.vel, b.life);
        np.cooldown = 0.1;
        if (b.uid) np.uid = b.uid;
      }
      this.pendingBalls = [];
      this.setFreeze(false);
    }
  }

  // ------------------------------------------------------------------ paradoxo
  checkParadox(dt) {
    const { player } = this.ctx;
    for (const c of this.clones) {
      // o caminho que ele andou com o tempo parado: conferido inteiro no instante em que o tempo parou
      const fz = this.checkFrozenPaths(c);
      if (fz) {
        this.rollback(c.cp, fz.why, fz.at);
        return;
      }
      const pose = this.clonePose(c);
      if (!pose || pose.jumped || this.tw < c.born + 0.25 || this.tw > c.end - 0.05) continue;
      const test = (key, bad, limit, why) => {
        c.bad[key] = bad ? (c.bad[key] ?? 0) + dt : 0;
        return c.bad[key] > limit ? why : null;
      };
      const h = this.poseProblems(pose, player.half);
      let why = null;
      why ??= test('solid', h.solid, 0.1, 'algo bloqueou o caminho do seu passado');
      why ??= test('cube', h.cube, 0.1, 'um objeto ficou no caminho do seu passado');
      why ??= test('hazard', h.hazard, 0.05, 'o seu passado caiu num perigo');
      why ??= test('ball', h.ball, 0.03, 'uma bola de energia atingiu o seu passado');
      why ??= test('floor', h.noFloor, 0.35, 'o chão do seu passado sumiu');
      if (why) {
        this.rollback(c.cp, why, pose.p);
        return;
      }
    }
  }

  /** o que está errado para o seu passado numa pose (sem tolerância de tempo: quem soma é quem chama) */
  poseProblems(pose, half) {
    const { world, energy } = this.ctx;
    const min = pose.p.clone().sub(half);
    const max = pose.p.clone().add(half);
    const out = { solid: false, cube: false, hazard: false, ball: false, noFloor: false };
    // sólido (porta/parede/plataforma) ou cubo no caminho do seu passado
    if (!pose.inMouth)
      for (const b of world.solids) {
        if (b.solid === false) continue;
        if (overlap(min, max, b.min, b.max, 0.14)) {
          out.solid = true;
          break;
        }
      }
    for (const p of this.props()) {
      if (p.gone || p.held || this.driven.has(p)) continue;
      if (overlap(min, max, p.pos.clone().addScaledVector(new V3(1, 1, 1), -0.3), p.pos.clone().addScaledVector(new V3(1, 1, 1), 0.3), 0.08)) out.cube = true;
    }
    // perigos
    for (const h of [...world.hazards, ...world.incinerators]) if (overlap(min, max, h.min, h.max, 0.05)) out.hazard = true;
    // bola de energia no caminho do clone
    for (const p of energy.pellets) {
      const q = p.pos.clone().clamp(min, max);
      if (q.distanceTo(p.pos) < 0.34) out.ball = true;
    }
    // o chão em que você pisava sumiu
    if (pose.grounded && pose.up > 0) {
      const feet = pose.p.clone().add(new V3(0, -half.y + 0.25, 0));
      // a sola inteira, não só o centro: na beirada (de uma ponte de 2 m, por exemplo) o centro
      // fica para fora e o corpo ainda está apoiado
      const hx = half.x - 0.05;
      const hz = half.z - 0.05;
      const down = new V3(0, -1, 0);
      const hit =
        [[0, 0], [hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz]].some(([x, z]) => world.raycast(feet.clone().add(new V3(x, 0, z)), down, 0.75)) ||
        // (a ponte de luz não para raios — tiros e lasers a atravessam —, mas é chão: conta à parte)
        world.solids.some((b) => b.bridge && feet.x + hx > b.min.x && feet.x - hx < b.max.x && feet.z + hz > b.min.z && feet.z - hz < b.max.z && b.max.y <= feet.y + 0.05 && b.max.y >= feet.y - 0.75);
      const under = (q, top) => Math.abs(q.x - pose.p.x) < 0.5 && Math.abs(q.z - pose.p.z) < 0.5 && Math.abs(q.y + top - (pose.p.y - half.y)) < 0.5;
      // em cima de um cubo — real ou o duplo de um cubo mandado ao passado (enquanto ele existe na história,
      // o real fica escondido e quem sustenta é o duplo)
      const onProp =
        this.props().some((p) => !p.gone && under(p.pos, 0.3)) ||
        (this.doubles ?? []).some((d) => {
          const st = this.doubleAt(d, this.tw);
          return st && under(st.p, d.prop.half?.y ?? 0.3);
        });
      out.noFloor = !hit && !onProp;
    }
    return out;
  }

  /**
   * Tempo parado: você anda sem o relógio andar, então na história o seu passado "pula" do lugar
   * onde o tempo parou para onde ele voltou a andar. O caminho entre os dois foi gravado
   * (`fz` no quadro do pulo) e, quando o clone chega nesse instante, é conferido inteiro contra o
   * mundo de agora — a ponte que você desligou no passado, uma porta que fechou… Devolve { why, at } ou null.
   */
  checkFrozenPaths(c) {
    if (c.fzLast == null || this.tw < c.fzLast - 1e-6) c.fzLast = Math.min(c.fzLast ?? -Infinity, this.tw); // (voltou no tempo: confere de novo)
    const half = this.ctx.player.half;
    for (const s of c.script) {
      if (!s.fz || s.t <= c.fzLast + 1e-6 || s.t > this.tw + 1e-6) continue;
      c.fzLast = s.t;
      let gaps = 0;
      for (const q of s.fz) {
        const h = this.poseProblems(q, half);
        const where = q.p.clone();
        if (h.solid) return { why: 'algo bloqueou o caminho do seu passado (com o tempo parado)', at: where };
        if (h.cube) return { why: 'um objeto ficou no caminho do seu passado (com o tempo parado)', at: where };
        if (h.hazard) return { why: 'o seu passado caiu num perigo (com o tempo parado)', at: where };
        // chão: dois pontos seguidos sem nada embaixo (um só pode ser a borda de um degrau)
        gaps = h.noFloor ? gaps + 1 : 0;
        if (gaps >= 2) return { why: 'o chão do seu passado sumiu (com o tempo parado)', at: where };
      }
    }
    return null;
  }

  /** o loop colapsa: tudo volta ao instante do salto */
  /** até quando a história ainda tem versões suas do passado agindo (0 = nada pendente) */
  openUntil() {
    return Math.max(0, ...this.clones.map((c) => c.end).filter((e) => e > this.tw + 1e-3));
  }

  rollback(cp, why, at = null) {
    const { player, portals } = this.ctx;
    this.rollbacks = (this.rollbacks ?? 0) + 1; // (a verificação na saída vê se houve paradoxo)
    this.ctx.fx.paradox?.(why, at);
    for (const c of this.clones) if (!cp.clones.includes(c)) this.dropClone(c);
    // objetos mandados ao passado dentro do loop desfeito: não aconteceu
    for (const d of this.doubles ?? []) if (!cp.doubles?.includes(d)) this.dropDouble(d);
    this.doubles = (this.doubles ?? []).filter((d) => cp.doubles?.includes(d));
    this.sweep?.undo?.();
    this.sweep = null;
    this.resetDriven();
    this.samples = cp.samples;
    this.clones = cp.clones;
    this.tw = cp.tw;
    this.next = cp.next;
    this.arrival = cp.arrival;
    this.restore(cp.w);
    this.ctx.onRollback?.(cp.extra);
    // os seus portais como estavam (só os que estavam abertos: sem portal "fantasma" sem parede)
    for (const [P, f] of [
      [portals.blue, cp.blue],
      [portals.orange, cp.orange],
    ]) {
      if (f.placed && f.box) P.setFrame(f.c, f.n, f.u, f.box);
      else if (P.placed) P.remove();
    }
    portals.orange.delta = cp.orange.placed ? cp.orange.delta : 0;
    portals.blue.fixed = portals.orange.fixed = false;
    // você volta para onde estava logo antes de entrar no azul (um passo para trás, parado: sem re-entrar sozinho)
    player.pos.copy(cp.player.pos);
    player.vel.set(0, 0, 0);
    const E = cp.entered ?? cp.blue;
    const l = E.n.clone().dot(player.pos.clone().sub(E.c));
    if (l < 0.8) player.pos.addScaledVector(E.n, 0.8 - l);
    player.yaw = cp.player.yaw;
    player.pitch = cp.player.pitch;
    player.viewOffset?.set(0, 0, 0);
    player.viewRot?.identity?.();
    player.cooldown = 0.5;
    this.paused = false;
    this.setFreeze(false);
    this.setHolo(false);
    this.paradoxes++;
    this.ctx.fx.toast?.(tl('Paradoxo: {why}. O loop se desfez.', { why: tl(why) }));
  }

  /** dados para o HUD */
  hud() {
    return { paused: this.paused, delta: this.delta, max: this.maxDelta(), tw: this.tw, blocked: this.blocked, clones: this.clones.filter((c) => this.clonePose(c)).length, paradoxes: this.paradoxes };
  }
}
