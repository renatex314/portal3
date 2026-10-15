// Sistema de entradas/saídas (I/O) das entidades dos mapas importados: é o que
// liga botões, portas, elevadores, dispensadores e portais da fase. Implementa a
// semântica documentada do motor Source (fila de eventos com atraso, alvos com
// curinga e !activator/!caller/!self/!player) sobre as peças deste jogo.

import * as THREE from 'three';
import { S, toV, parseVec, vecKV, modelBounds, isCube, cubeOpts, yawFromSource } from './convert.js';
import { RocketTurret, Rocket, bossMachine, animateBoss, coreModel, explosion, elevatorShell } from './boss.js';

const D2R = Math.PI / 180;
const ZERO = new THREE.Vector3();

/** vetores frente/cima de ângulos Source (graus) já no espaço daqui */
export function anglesToVectors(pitch, yaw, roll = 0) {
  const [sp, cp] = [Math.sin(pitch * D2R), Math.cos(pitch * D2R)];
  const [sy, cy] = [Math.sin(yaw * D2R), Math.cos(yaw * D2R)];
  const [sr, cr] = [Math.sin(roll * D2R), Math.cos(roll * D2R)];
  const f = [cp * cy, cp * sy, -sp];
  const u = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  return { forward: new THREE.Vector3(f[0], f[2], -f[1]), up: new THREE.Vector3(u[0], u[2], -u[1]) };
}

const flags = (e) => parseInt(e.kv.get('spawnflags') || '0', 10);
const num = (e, k, d = 0) => {
  const v = parseFloat(e.kv.get(k));
  return Number.isFinite(v) ? v : d;
};

export class CampaignRuntime {
  /**
   * ctx: { world, portals, player, cubes(), spawnCube(pos, opts), removeCube(cube),
   *        die(), complete(nextMap), teleport(pos, yaw), toast(msg), scene(node, name) }
   */
  constructor(bsp, built, ctx) {
    this.bsp = bsp;
    this.ctx = ctx;
    this.time = 0;
    this.queue = [];
    this.nodes = [];
    this.byName = new Map();
    this.brushOf = new Map(built.brushEnts.map((b) => [b.e, b]));
    this.player = { cls: 'player', name: '!player', enabled: true };
    this.ball = { cls: 'prop_energy_ball', name: 'energy_ball', enabled: true, fired: new Map(), e: { outputs: [], kv: new Map() } };
    this.launchers = built.launchers ?? new Map();
    this.catchers = built.catchers ?? new Map();
    this.cubeNodes = new Map(); // cubo → nó
    this.rockets = [];
    this.booms = [];
    this.hitTargets = []; // { node, a, b, r }: cápsulas que recebem dano de foguete
    this.noPortal = [];
    for (const e of bsp.entities) this.add(e);
    for (const n of this.nodes) n.init?.();
    // volumes onde o original não deixa abrir portal
    ctx.portals.blockedAt = (c) => this.noPortal.some((n) => n.active && !n.dead && c.x > n.min.x - 0.3 && c.x < n.max.x + 0.3 && c.y > n.min.y - 0.3 && c.y < n.max.y + 0.3 && c.z > n.min.z - 0.3 && c.z < n.max.z + 0.3);
  }

  /** E apertado: botões de apertar (func_button, func_rot_button, porta "abre com uso") */
  use(origin, dir) {
    let best = null;
    for (const n of this.nodes) {
      if (n.dead || !n.useable) continue;
      const b = this.brushOf.get(n.e)?.bounds ?? n.bounds;
      if (!b) continue;
      let t0 = 0;
      let t1 = 2.6;
      for (const a of ['x', 'y', 'z']) {
        const lo = b.min[a] - 0.15;
        const hi = b.max[a] + 0.15;
        if (Math.abs(dir[a]) < 1e-9) {
          if (origin[a] < lo || origin[a] > hi) t1 = -1;
          continue;
        }
        let ta = (lo - origin[a]) / dir[a];
        let tb = (hi - origin[a]) / dir[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && (!best || t0 < best.t)) best = { n, t: t0 };
    }
    if (!best || !best.n.enabled) return false;
    best.n.useable(this.player);
    return true;
  }

  /** núcleo preso que solta ao ser agarrado (flag do original) */
  unfreeze(cube) {
    INPUTS.prop_physics.call(this, this.cubeNode(cube), 'enablemotion', '', {});
  }

  onPickup(cube) {
    this.fire(this.cubeNode(cube), 'onplayerpickup', this.player);
  }

  /** foguetes, explosões e o resto da luta final */
  updateBoss(dt) {
    const { world, portals, player } = this.ctx;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      const prev = r.pos.clone();
      r.pos.addScaledVector(r.dir, r.speed * dt);
      r.life -= dt;
      const P = portals.crossing(prev, r.pos);
      if (P?.partner) {
        const M = portals.transform(P, P.partner);
        r.pos.applyMatrix4(M);
        r.dir.transformDirection(M);
        prev.copy(r.pos).addScaledVector(r.dir, -0.05);
      }
      let boom = r.life <= 0;
      // acertou a máquina?
      for (const h of this.hitTargets) {
        if (h.node.dead) continue;
        const ab = h.b.clone().sub(h.a);
        const t = Math.min(1, Math.max(0, r.pos.clone().sub(h.a).dot(ab) / ab.lengthSq()));
        if (r.pos.distanceTo(h.a.clone().addScaledVector(ab, t)) < h.r) {
          this.fire(h.node, 'ontakedamage', this.player);
          boom = true;
        }
      }
      if (!boom && r.pos.distanceTo(player.pos) < 0.8) {
        this.ctx.hurt(45);
        boom = true;
      }
      const step = r.pos.clone().sub(prev);
      if (!boom && step.lengthSq() > 0 && world.raycast(prev, step.clone().normalize(), step.length())) boom = true;
      if (boom) {
        explosion(world.group, r.pos, this.booms);
        this.ctx.sound?.('Portal.rocket_explode', 1);
        r.dispose();
        this.rockets.splice(i, 1);
      } else r.sync();
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.t += dt;
      b.m.scale.setScalar(1 + b.t * 9);
      b.m.material.opacity = Math.max(0, 1 - b.t * 2.5);
      if (b.t > 0.4) {
        world.group.remove(b.m);
        this.booms.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ nós
  add(e) {
    const n = {
      e,
      cls: e.classname,
      name: (e.kv.get('targetname') ?? '').toLowerCase(),
      enabled: e.kv.get('startdisabled') !== '1',
      fired: new Map(),
      dead: false,
    };
    const setup = SETUP[n.cls];
    if (setup) setup.call(this, n);
    this.nodes.push(n);
    if (n.name) {
      if (!this.byName.has(n.name)) this.byName.set(n.name, []);
      this.byName.get(n.name).push(n);
    }
    return n;
  }

  /** deslocamento atual da entidade-mãe (porta, plataforma ou trem) de `n`, se houver */
  parentOffset(n) {
    if (n.parentNode === undefined) {
      const pn = n.e.kv.get('parentname');
      n.parentNode = pn ? (this.find(pn, n, null).find((x) => x.doors?.length || x.offset) ?? null) : null;
    }
    const p = n.parentNode;
    if (!p) return ZERO;
    return p.doors?.[0]?.offset ?? p.offset ?? ZERO;
  }

  cubeNode(cube) {
    if (!this.cubeNodes.has(cube))
      this.cubeNodes.set(cube, { cls: cube.ioClass ?? 'prop_physics', name: cube.ioName ?? '', cube, enabled: true, fired: new Map(), e: { outputs: cube.ioOutputs ?? [], kv: new Map() } });
    return this.cubeNodes.get(cube);
  }

  find(target, caller, activator) {
    const t = target.toLowerCase();
    if (t === '!self' || t === '!caller') return caller ? [caller] : [];
    if (t === '!activator') return activator ? [activator] : [];
    if (t === '!player') return [this.player];
    const out = [];
    if (t.endsWith('*')) {
      const pre = t.slice(0, -1);
      for (const [k, list] of this.byName) if (k.startsWith(pre)) out.push(...list);
      for (const c of this.ctx.cubes()) if ((c.ioName ?? '').startsWith(pre)) out.push(this.cubeNode(c));
    } else {
      out.push(...(this.byName.get(t) ?? []));
      for (const c of this.ctx.cubes()) if (c.ioName === t && !c.gone) out.push(this.cubeNode(c));
    }
    return out.filter((n) => !n.dead);
  }

  // ------------------------------------------------------------- eventos
  fire(node, output, activator = null, value) {
    for (const o of node.e.outputs) {
      if (o.output !== output) continue;
      const used = node.fired.get(o) ?? 0;
      if (o.times > 0 && used >= o.times) continue;
      node.fired.set(o, used + 1);
      this.schedule(o.delay, o.target, o.input, o.param !== '' ? o.param : value !== undefined ? String(value) : '', activator, node);
    }
  }

  schedule(delay, target, input, param, activator, caller) {
    const ev = { t: this.time + delay, target, input, param, activator, caller, seq: this.seq = (this.seq ?? 0) + 1 };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > ev.t || (this.queue[i - 1].t === ev.t && this.queue[i - 1].seq > ev.seq))) i--;
    this.queue.splice(i, 0, ev);
  }

  dispatch(ev) {
    const input = ev.input.toLowerCase();
    if (globalThis.__ioLog) console.log(`[io ${this.time.toFixed(2)}] ${ev.caller?.name || ev.caller?.cls || '?'} → ${ev.target}.${ev.input}(${ev.param})`);
    for (const n of this.find(ev.target, ev.caller, ev.activator)) {
      if (this.generic(n, input, ev)) continue;
      if (INPUTS[n.cls]) INPUTS[n.cls].call(this, n, input, ev.param, ev);
      else (globalThis.__ioMissing ??= new Map()).set(`${n.cls}.${input}`, ((globalThis.__ioMissing.get(`${n.cls}.${input}`)) ?? 0) + 1);
    }
  }

  /** entradas que valem para qualquer entidade */
  generic(n, input, ev) {
    switch (input) {
      case 'kill':
      case 'killhierarchy':
        this.kill(n);
        return true;
      case 'fireuser1':
      case 'fireuser2':
      case 'fireuser3':
      case 'fireuser4':
        this.fire(n, `onuser${input.slice(-1)}`, ev.activator);
        return true;
      case 'addoutput': {
        const m = /^(\w+)\s+([^:]*):([^:]*):([^:]*):([^:]*):?(-?\d*)$/.exec(ev.param.trim());
        if (m && /^on/i.test(m[1]))
          n.e.outputs.push({ output: m[1].toLowerCase(), target: m[2], input: m[3], param: m[4], delay: parseFloat(m[5]) || 0, times: parseInt(m[6], 10) || -1 });
        return true;
      }
    }
    return false;
  }

  kill(n) {
    if (n.sound) INPUTS.ambient_generic.call(this, n, 'stopsound', '');
    n.dead = true;
    if (n.cube) this.ctx.removeCube(n.cube);
    const b = this.brushOf.get(n.e);
    if (b) for (const s of b.solids) this.ctx.world.setSolidEnabled(s, false);
    n.onKill?.();
  }

  start() {
    for (const n of this.nodes)
      if (n.cls === 'logic_auto') {
        this.fire(n, 'onmapspawn');
        this.fire(n, 'onnewgame');
        if (flags(n.e) & 1) n.dead = true;
      }
  }

  update(dt) {
    this.time += dt;
    let guard = 0;
    while (this.queue.length && this.queue[0].t <= this.time && guard++ < 2000) this.dispatch(this.queue.shift());
    for (const n of this.nodes) if (!n.dead) n.tick?.(dt);
    this.updateBoss(dt);
  }

  // ------------------------------------------------------------ gatilhos
  /** quem está dentro do volume (jogador e cubos), respeitando flags e filtro */
  insiders(n) {
    const out = [];
    const sf = flags(n.e);
    const all = sf & 64;
    const { player } = this.ctx;
    if (all || sf & 1 || n.cls === 'trigger_changelevel') {
      const pmin = player.pos.clone().sub(player.half);
      const pmax = player.pos.clone().add(player.half);
      if (pmin.x < n.max.x && pmax.x > n.min.x && pmin.y < n.max.y && pmax.y > n.min.y && pmin.z < n.max.z && pmax.z > n.min.z) out.push(this.player);
    }
    if (all || sf & 8) {
      for (const c of this.ctx.cubes()) {
        if (c.gone) continue;
        const p = c.pos;
        if (p.x > n.min.x - 0.3 && p.x < n.max.x + 0.3 && p.y > n.min.y - 0.3 && p.y < n.max.y + 0.3 && p.z > n.min.z - 0.3 && p.z < n.max.z + 0.3) out.push(this.cubeNode(c));
      }
    }
    return out.filter((a) => this.passFilter(n, a));
  }

  passFilter(n, a) {
    const fname = n.e.kv.get('filtername');
    if (!fname) return true;
    const f = this.find(fname, n, a)[0];
    if (!f) return true;
    let ok = true;
    // nome com curinga no fim ("brain_core_sphere*")
    const match = (v, pat) => (pat.endsWith('*') ? v.startsWith(pat.slice(0, -1)) : v === pat);
    if (a === this.ball) ok = f.cls === 'filter_combineball_type';
    else if (f.cls === 'filter_combineball_type') ok = false;
    else if (f.cls === 'filter_activator_name') ok = match(a.name, (f.e.kv.get('filtername') ?? '').toLowerCase());
    else if (f.cls === 'filter_activator_class') ok = match(a.cls, (f.e.kv.get('filterclass') ?? '').toLowerCase());
    // "negated": 1/0 ou o texto do editor ("Disallow entities that match criteria")
    const neg = f.e.kv.get('negated') ?? '0';
    return neg === '1' || /^disallow/i.test(neg) ? !ok : ok;
  }

  setupTrigger(n) {
    const model = n.e.kv.get('model');
    const mi = model?.[0] === '*' ? parseInt(model.slice(1), 10) : -1;
    if (!this.bsp.models[mi]) return false;
    Object.assign(n, modelBounds(this.bsp, mi, n.e));
    n.touching = new Set();
    n.wait = num(n.e, 'wait', 0.2);
    n.nextTrigger = 0;
    return true;
  }

  tickTrigger(n, onEnter) {
    if (!n.enabled) {
      n.touching.clear();
      return;
    }
    const now = new Set(this.insiders(n));
    const C = this.catchers.get(n.e);
    if (C?.active) now.add(this.ball);
    for (const a of now)
      if (!n.touching.has(a)) {
        if (!n.touching.size) this.fire(n, 'onstarttouchall', a);
        this.fire(n, 'onstarttouch', a);
        if (this.time >= n.nextTrigger) {
          n.nextTrigger = this.time + Math.max(n.wait, 0);
          this.fire(n, 'ontrigger', a);
          onEnter?.(a);
          if (n.cls === 'trigger_once') {
            n.dead = true;
            return;
          }
        }
      }
    for (const a of n.touching)
      if (!now.has(a)) {
        this.fire(n, 'onendtouch', a);
        if (!now.size) this.fire(n, 'onendtouchall', a);
      }
    n.touching = now;
  }

  // ------------------------------------------------------- pincéis móveis
  /** cria um "door" do mundo para cada sólido da entidade (o mundo move e carrega o jogador) */
  movers(n, path, speedUnits, startOpen = 0) {
    const b = this.brushOf.get(n.e);
    if (!b) return [];
    const len = path.length();
    return b.solids.map((s, k) => {
      const d = {
        id: `io-${this.nodes.length}-${k}`,
        box: s,
        plain: false,
        open: startOpen,
        target: startOpen,
        baseMin: s.min.clone(),
        baseMax: s.max.clone(),
        path: path.clone(),
        speed: len > 1e-6 ? (speedUnits * S) / len : 1,
        mesh: s.mesh,
        delta: new THREE.Vector3(),
        offset: new THREE.Vector3(),
      };
      if (startOpen) {
        d.offset.copy(path).multiplyScalar(startOpen);
        s.min.copy(d.baseMin).add(d.offset);
        s.max.copy(d.baseMax).add(d.offset);
        s.mesh.position.copy(d.offset);
        this.ctx.world.physics?.moveBox(s);
      }
      this.ctx.world.doors.push(d);
      return d;
    });
  }
}

// ---------------------------------------------------------------- classes
const SETUP = {
  logic_timer(n) {
    n.refire = num(n.e, 'refiretime', 1);
    n.random = n.e.kv.get('userandomtime') === '1';
    n.lo = num(n.e, 'lowerrandombound', 1);
    n.hi = num(n.e, 'upperrandombound', 2);
    const next = () => (n.random ? n.lo + Math.random() * (n.hi - n.lo) : Math.max(n.refire, 0.01));
    n.reset = () => (n.left = next());
    n.reset();
    n.tick = (dt) => {
      if (!n.enabled) return;
      n.left -= dt;
      if (n.left <= 0) {
        this.fire(n, 'ontimer');
        n.reset();
      }
    };
  },
  math_counter(n) {
    n.value = num(n.e, 'startvalue', 0);
    n.min = num(n.e, 'min', 0);
    n.max = num(n.e, 'max', 0);
  },
  logic_compare(n) {
    n.value = num(n.e, 'initialvalue', 0);
    n.cmp = num(n.e, 'comparevalue', 0);
  },
  trigger_once(n) {
    if (this.setupTrigger(n)) n.tick = () => this.tickTrigger(n);
  },
  trigger_multiple(n) {
    if (this.setupTrigger(n)) n.tick = () => this.tickTrigger(n);
  },
  trigger_hurt(n) {
    if (!this.setupTrigger(n)) return;
    const lethal = num(n.e, 'damage', 10) >= 50;
    n.tick = () =>
      this.tickTrigger(n, (a) => {
        if (a === this.player && lethal) this.ctx.die();
        if (a.cube && lethal) this.ctx.removeCube(a.cube);
      });
    // continua matando quem ficar dentro
    const base = n.tick;
    n.tick = (dt) => {
      base(dt);
      if (n.enabled && lethal && n.touching.has(this.player)) this.ctx.die();
    };
  },
  trigger_changelevel(n) {
    if (!this.setupTrigger(n)) return;
    if (!(flags(n.e) & 2)) n.tick = () => this.tickTrigger(n, (a) => a === this.player && this.ctx.complete(n.e.kv.get('map')));
  },
  trigger_teleport(n) {
    if (!this.setupTrigger(n)) return;
    n.tick = () =>
      this.tickTrigger(n, (a) => {
        const dest = this.find(n.e.kv.get('target') ?? '', n, a)[0];
        if (a === this.player && dest) this.ctx.teleport(vecKV(dest.e, 'origin'), yawFromSource(parseVec(dest.e.kv.get('angles'))[1] || 0));
      });
  },
  trigger_portal_cleanser(n) {
    if (!this.setupTrigger(n)) return;
    const w = this.ctx.world;
    n.fizz = w.fizzler(n.min.x, n.min.y, n.min.z, n.max.x, n.max.y, n.max.z);
    n.setOn = (on) => {
      n.enabled = on;
      const i = w.fizzlers.indexOf(n.fizz);
      if (on && i < 0) w.fizzlers.push(n.fizz);
      if (!on && i >= 0) w.fizzlers.splice(i, 1);
      if (n.fizz.plane) n.fizz.plane.visible = on;
    };
    n.init = () => n.setOn(n.enabled);
  },
  func_door(n) {
    const [p, y] = parseVec(n.e.kv.get('movedir'));
    const dir = anglesToVectors(p || 0, y || 0).forward;
    const b = this.brushOf.get(n.e);
    if (!b) return;
    const size = new THREE.Vector3().subVectors(b.bounds.max, b.bounds.min);
    const dist = Math.max(0, Math.abs(dir.x) * size.x + Math.abs(dir.y) * size.y + Math.abs(dir.z) * size.z - num(n.e, 'lip', 0) * S);
    n.doors = this.movers(n, dir.multiplyScalar(dist), num(n.e, 'speed', 100), flags(n.e) & 1 ? 1 : 0);
    n.waitClose = num(n.e, 'wait', -1);
    if (flags(n.e) & 256) n.useable = () => INPUTS.func_door.call(this, n, n.doors[0]?.target ? 'close' : 'open', '', {});
    n.state = flags(n.e) & 1 ? 1 : 0;
    n.tick = (dt) => {
      const d = n.doors[0];
      if (!d) return;
      if (d.open >= 1 && n.state !== 1 && d.target === 1) {
        n.state = 1;
        this.fire(n, 'onfullyopen');
        if (n.waitClose >= 0) n.closeIn = n.waitClose;
      }
      if (d.open <= 0 && n.state !== 0 && d.target === 0) {
        n.state = 0;
        this.fire(n, 'onfullyclosed');
      }
      if (n.closeIn !== undefined) {
        n.closeIn -= dt;
        if (n.closeIn <= 0) {
          n.closeIn = undefined;
          INPUTS.func_door.call(this, n, 'close', '', {});
        }
      }
    };
  },
  func_movelinear(n) {
    const [p, y] = parseVec(n.e.kv.get('movedir'));
    const dir = anglesToVectors(p || 0, y || 0).forward;
    n.doors = this.movers(n, dir.multiplyScalar(num(n.e, 'movedistance', 100) * S), num(n.e, 'speed', 100), num(n.e, 'startposition', 0));
    n.state = -1;
    n.tick = () => {
      const d = n.doors[0];
      if (!d) return;
      const s = d.open >= 1 ? 1 : d.open <= 0 ? 0 : -1;
      if (s !== n.state && s >= 0 && n.state !== -2) this.fire(n, s ? 'onfullyopen' : 'onfullyclosed');
      n.state = s;
    };
  },
  path_track(n) {
    n.pos = vecKV(n.e, 'origin');
  },
  func_tracktrain(n) {
    const b = this.brushOf.get(n.e);
    if (!b) return;
    // velocidade máxima 0 = usa a inicial (o elevador da Valve vem assim)
    n.speedMax = (num(n.e, 'speed', 0) || num(n.e, 'startspeed', 0) || 100) * S;
    n.speed = n.speedMax;
    n.height = num(n.e, 'height', 0) * S;
    n.dir = 0;
    n.origin = vecKV(n.e, 'origin');
    n.offset = new THREE.Vector3();
    n.solids = b.solids;
    n.base = b.solids.map((s) => ({ min: s.min.clone(), max: s.max.clone() }));
    // o "door" do mundo serve só para o jogador ser carregado (delta) e o colisor seguir
    n.doors = b.solids.map((s, k) => {
      const d = { id: `train-${k}`, box: s, plain: false, open: 0, target: 0, baseMin: s.min.clone(), baseMax: s.max.clone(), mesh: s.mesh, delta: new THREE.Vector3(), offset: n.offset };
      d.drive = () => {};
      this.ctx.world.doors.push(d);
      return d;
    });
    const place = (off, dt) => {
      const delta = off.clone().sub(n.offset);
      n.offset.copy(off);
      n.solids.forEach((s, k) => {
        s.min.copy(n.base[k].min).add(off);
        s.max.copy(n.base[k].max).add(off);
        s.mesh.position.copy(off);
        this.ctx.world.physics?.moveBox(s);
        n.doors[k].delta.copy(dt > 0 ? delta : new THREE.Vector3());
      });
    };
    n.init = () => {
      // no começo, o trem vai para o primeiro ponto do trilho
      n.node = this.find(n.e.kv.get('target') ?? '', n, null).find((x) => x.cls === 'path_track');
      if (n.node) place(n.node.pos.clone().add(new THREE.Vector3(0, n.height, 0)).sub(n.origin), 0);
      n.next = n.node ? this.nextTrack(n.node, 1) : null;
    };
    n.doors[0].drive = (dt) => {
      for (const d of n.doors) d.delta.set(0, 0, 0);
      if (!n.dir || !n.node) return;
      const goal = n.dir > 0 ? n.next : this.nextTrack(n.node, -1);
      if (!goal) {
        n.dir = 0;
        this.fire(n, 'onnextpoint');
        return;
      }
      const target = goal.pos.clone().add(new THREE.Vector3(0, n.height, 0)).sub(n.origin);
      const to = target.clone().sub(n.offset);
      const step = Math.max(n.speed, 0.05) * dt;
      if (to.length() <= step) {
        place(target, dt);
        n.node = goal;
        n.next = this.nextTrack(goal, 1);
        // ponto do trilho pode mudar a velocidade do trem
        const sp = num(goal.e, 'speed', 0);
        if (sp > 0) n.speed = sp * S;
        this.fire(goal, 'onpass', n);
        if (flags(goal.e) & 16 || !(n.dir > 0 ? n.next : this.nextTrack(goal, -1))) {
          n.dir = 0; // trilho com "parar aqui" ou fim do caminho
          this.fire(n, 'onnextpoint');
        }
      } else place(n.offset.clone().add(to.setLength(step)), dt);
    };
  },
  prop_portal(n) {
    n.which = n.e.kv.get('portaltwo') === '1' ? 'orange' : 'blue';
    n.center = vecKV(n.e, 'origin');
    const [p, y, r] = parseVec(n.e.kv.get('angles'));
    const v = anglesToVectors(p || 0, y || 0, r || 0);
    n.normal = v.forward;
    n.up = v.up;
    n.open = () => this.ctx.portals.placeFixed(n.which, n.center.toArray(), n.normal.toArray(), n.up.toArray());
    n.close = () => {
      const P = n.which === 'blue' ? this.ctx.portals.blue : this.ctx.portals.orange;
      if (P.fixed) {
        P.remove();
        P.fixed = false;
      }
    };
    n.init = () => n.e.kv.get('activated') === '1' && n.open();
  },
  npc_rocket_turret(n) {
    n.base = vecKV(n.e, 'origin');
    n.turret = new RocketTurret(this.ctx.world.group, n.base, !(flags(n.e) & 1));
    n.tick = (dt) => {
      // sobe junto com o elevador (func_door) em que está presa
      n.turret.group.position.copy(n.base).add(this.parentOffset(n));
      const shot = n.turret.update(dt, this.ctx.player.eye(new THREE.Vector3()), this.ctx.world);
      if (shot) {
        this.rockets.push(new Rocket(this.ctx.world.group, shot.pos, shot.dir));
        this.ctx.sound?.('Portal.rocket_fire', 1);
        this.fire(n, 'onfoundtarget', this.player);
      }
    };
  },
  prop_dynamic(n) {
    const model = (n.e.kv.get('model') ?? '').toLowerCase();
    const at = vecKV(n.e, 'origin');
    if (/glados_body\.mdl$/.test(model)) {
      // a máquina central (desenho próprio) e o volume que recebe os foguetes
      n.machine = bossMachine();
      n.machine.position.copy(at);
      this.ctx.world.group.add(n.machine);
      this.hitTargets.push({ node: n, a: at.clone().add(new THREE.Vector3(0, -1.6, 0)), b: at.clone().add(new THREE.Vector3(0, -5.6, 0)), r: 1.9 });
      n.tick = (dt) => animateBoss(n.machine, this.time, dt);
      n.onKill = () => (n.machine.visible = false);
    } else if (model.includes('round_elevator_body')) {
      // cabine do elevador acompanhando o trem em que está presa
      n.visual = elevatorShell();
      n.visual.position.copy(at);
      this.ctx.world.group.add(n.visual);
      n.init = () => (n.parent = this.find(n.e.kv.get('parentname') ?? '', n, null).find((x) => x.cls === 'func_tracktrain'));
      n.tick = () => {
        if (n.parent) n.visual.position.copy(at).add(n.parent.offset);
      };
    } else if (model.includes('glados_ball')) {
      // núcleo ainda preso (vai junto do trilho que o tira da máquina)
      n.visual = coreModel(0);
      n.visual.position.copy(at);
      this.ctx.world.group.add(n.visual);
      n.onKill = () => (n.visual.visible = false);
      n.tick = () => {
        if (n.parent) n.visual.position.copy(at).add(n.parent.offset);
      };
    }
  },
  func_noportal_volume(n) {
    if (!this.setupTrigger(n)) return;
    n.active = !(flags(n.e) & 1);
    this.noPortal.push(n);
  },
  trigger_push(n) {
    if (!this.setupTrigger(n)) return;
    const [p, y] = parseVec(n.e.kv.get('pushdir'));
    const dir = anglesToVectors(p || 0, y || 0).forward;
    const speed = num(n.e, 'speed', 40) * S;
    n.tick = (dt) => {
      this.tickTrigger(n);
      if (n.enabled && n.touching.has(this.player)) this.ctx.player.vel.addScaledVector(dir, speed * dt * 4);
    };
  },
  func_rot_button(n) {
    n.useable = (a) => {
      this.fire(n, 'onpressed', a);
      this.fire(n, 'onin', a);
    };
  },
  point_template(n) {
    n.templates = [];
    for (const [k, v] of n.e.kv) if (/^template\d+$/.test(k)) n.templates.push(v.toLowerCase());
  },
};
for (const c of ['trigger_look', 'trigger_vphysics_motion']) SETUP[c] = SETUP.trigger_multiple;
SETUP.func_water_analog = SETUP.func_movelinear;
SETUP.func_button = SETUP.func_rot_button;
SETUP.prop_dynamic_override = SETUP.prop_dynamic;

/** próximo ponto do trilho (dir > 0) ou o anterior (dir < 0) */
CampaignRuntime.prototype.nextTrack = function (node, dir) {
  if (dir > 0) {
    const t = node.e.kv.get('target');
    return t ? this.find(t, node, null).find((x) => x.cls === 'path_track') : null;
  }
  const me = node.name;
  return this.nodes.find((x) => x.cls === 'path_track' && (x.e.kv.get('target') ?? '').toLowerCase() === me) ?? null;
};

CampaignRuntime.prototype.spawnTemplate = function (tpl, at) {
  const origin = vecKV(tpl.e, 'origin');
  for (const name of tpl.templates)
    for (const e of this.bsp.entities) {
      if ((e.kv.get('targetname') ?? '').toLowerCase() !== name || !(isCube(e) || e.classname === 'prop_glados_core')) continue;
      const p = vecKV(e, 'origin');
      if (at) p.sub(origin).add(at);
      this.ctx.spawnCube(new THREE.Vector3(p.x, p.y - 0.3, p.z), { ...cubeOpts(e), outputs: e.outputs });
    }
};

const INPUTS = {
  func_noportal_volume(n, input) {
    if (input === 'activate') n.active = true;
    else if (input === 'deactivate') n.active = false;
    else if (input === 'toggle') n.active = !n.active;
  },
  npc_rocket_turret(n, input) {
    if (input === 'enable') n.turret.enabled = true;
    else if (input === 'disable') n.turret.enabled = false;
    else if (input === 'toggle') n.turret.enabled = !n.turret.enabled;
  },
  prop_dynamic(n, input, param) {
    if (n.machine) {
      if (input === 'setdefaultanimation' || input === 'setanimation') {
        const m = /insanity_0?(\d)/.exec(param);
        if (m) n.machine.userData.stress = Number(m[1]);
        if (/death/.test(param)) {
          explosion(this.ctx.world.group, n.machine.position.clone().add(new THREE.Vector3(0, -3, 0)), this.booms);
          n.machine.userData.stress = 4;
        }
      }
    }
    if (n.visual && input === 'setparent') {
      const t = this.find(param, n, null).find((x) => x.cls === 'func_tracktrain');
      if (t) {
        n.parent = t;
        n.visual.userData.base = n.visual.position.clone().sub(t.offset);
      }
    }
    if (input === 'disable' || input === 'turnoff') {
      if (n.visual) n.visual.visible = false;
    } else if (input === 'enable' || input === 'turnon') {
      if (n.visual) n.visual.visible = true;
    }
  },
  scripted_sequence(n, input) {
    // sem as animações do original: os eventos da sequência saem no tempo aproximado dela
    if (input === 'beginsequence') {
      this.fire(n, 'onbeginsequence');
      this.schedule(8, '!self', 'FireScriptEvent', '', null, n);
      this.schedule(12, '!self', 'FireEndSequence', '', null, n);
    } else if (input === 'firescriptevent') this.fire(n, 'onscriptevent01');
    else if (input === 'fireendsequence') this.fire(n, 'onendsequence');
    else if (input === 'cancelsequence') this.queue = this.queue.filter((ev) => ev.caller !== n);
  },
  point_viewcontrol(n, input) {
    if (input === 'enable') {
      const [p, y] = parseVec(n.e.kv.get('angles'));
      this.ctx.view?.({ pos: vecKV(n.e, 'origin'), yaw: yawFromSource(y || 0), pitch: (-(p || 0) * Math.PI) / 180 });
    } else if (input === 'disable') this.ctx.view?.(null);
  },
  env_fade(n, input) {
    if (input !== 'fade' && input !== 'fadereverse') return;
    const [r, g, b] = parseVec(n.e.kv.get('rendercolor') ?? '0 0 0');
    // flags: 1 = "a partir da cor" (clareia), 8 = fica na cor até outro esmaecimento
    const sf = flags(n.e);
    this.ctx.fade?.(`rgb(${r},${g},${b})`, num(n.e, 'duration', 2), num(n.e, 'holdtime', 0), input === 'fadereverse' || !!(sf & 1), !!(sf & 8));
  },
  env_portal_credits(n, input) {
    // fim da campanha: a sequência de créditos (lida da cópia do jogador) e a tela de conclusão
    if (!/^roll.*credits$/.test(input) || n.rolling) return;
    n.rolling = true;
    Promise.resolve(this.ctx.credits?.())
      .catch((err) => console.warn('[créditos]', err))
      .then(() => {
        this.fire(n, 'oncreditsdone');
        this.ctx.complete('final');
      });
  },
  ambient_generic(n, input, param) {
    // músicas e sons de uma vez; os em loop posicionados (máquinas, zumbidos) ficam de
    // fora — sem som 3D, tocados todos juntos virariam um barulho só
    const sf = flags(n.e);
    const stop = (fade) => {
      const h = n.sound;
      n.sound = null;
      Promise.resolve(h).then((x) => this.ctx.stopSound?.(x, fade));
    };
    if (input === 'playsound' || (input === 'togglesound' && !n.sound)) {
      if (!(sf & 32) && !(sf & 1)) return;
      const name = n.e.kv.get('message');
      if (!name) return;
      let vol = Math.min(1, num(n.e, 'health', 10) / 10);
      if (!(sf & 1)) {
        // sem "tocar em todo lugar": mais baixo longe de quem ouve
        const r = num(n.e, 'radius', 1250) * S;
        vol *= Math.max(0, 1 - this.ctx.player.pos.distanceTo(vecKV(n.e, 'origin')) / Math.max(r, 1));
        if (vol < 0.03) return;
      }
      if (n.sound) stop(0);
      n.sound = this.ctx.sound?.(name, vol);
    } else if (input === 'stopsound' || input === 'kill' || (input === 'togglesound' && n.sound)) stop(0);
    else if (input === 'fadeout') stop(parseFloat(param) || 1);
    else if (input === 'volume') Promise.resolve(n.sound).then((x) => this.ctx.setVolume?.(x, Math.min(1, (parseFloat(param) || 0) / 10)));
  },
  point_energy_ball_launcher(n, input) {
    const L = this.launchers.get(n.e);
    if (!L) return;
    if (input === 'launchball') {
      L.done = false;
      L.wait = Math.min(L.wait, 0.1);
      this.fire(n, 'onpostspawnball');
    } else if (input === 'disable') L.done = true;
    else if (input === 'enable') L.done = false;
  },
  weapon_portalgun(n, input) {
    // arma "de cena" que dispara portais sozinha (câmaras 01 e 07)
    if (input !== 'fireportal1' && input !== 'fireportal2') return;
    const [p, y] = parseVec(n.e.kv.get('angles'));
    const dir = anglesToVectors(p || 0, y || 0).forward;
    const hit = this.ctx.world.raycast(vecKV(n.e, 'origin'), dir, 400);
    if (hit) this.ctx.portals.placeFixed(input === 'fireportal1' ? 'blue' : 'orange', hit.point.toArray(), hit.normal.toArray(), [0, 1, 0]);
  },
  logic_relay(n, input) {
    if (input === 'trigger' && n.enabled) {
      this.fire(n, 'ontrigger');
      if (flags(n.e) & 1) n.dead = true;
    } else if (input === 'enable') n.enabled = true;
    else if (input === 'disable') n.enabled = false;
    else if (input === 'toggle') n.enabled = !n.enabled;
    else if (input === 'enablerefire') n.enabled = true;
    else if (input === 'cancelpending') this.queue = this.queue.filter((ev) => ev.caller !== n);
  },
  logic_timer(n, input, param) {
    if (input === 'enable') {
      n.enabled = true;
      n.reset();
    } else if (input === 'disable') n.enabled = false;
    else if (input === 'toggle') n.enabled = !n.enabled;
    else if (input === 'resettimer') n.reset();
    else if (input === 'firetimer') {
      this.fire(n, 'ontimer');
      n.reset();
    } else if (input === 'refiretime') n.refire = parseFloat(param) || n.refire;
    else if (input === 'lowerrandombound') n.lo = parseFloat(param) || 0;
    else if (input === 'upperrandombound') n.hi = parseFloat(param) || 0;
  },
  math_counter(n, input, param) {
    const v = parseFloat(param) || 0;
    const set = (x, fire = true) => {
      const hasMax = n.max !== 0 || n.min !== 0;
      if (hasMax) x = Math.min(Math.max(x, n.min), n.max);
      n.value = x;
      if (!fire) return;
      this.fire(n, 'outvalue', null, x);
      if (hasMax && x >= n.max) this.fire(n, 'onhitmax');
      if (hasMax && x <= n.min) this.fire(n, 'onhitmin');
    };
    if (!n.enabled && input !== 'enable') return;
    if (input === 'add') set(n.value + v);
    else if (input === 'subtract') set(n.value - v);
    else if (input === 'multiply') set(n.value * v);
    else if (input === 'divide') set(v ? n.value / v : n.value);
    else if (input === 'setvalue') set(v);
    else if (input === 'setvaluenofire') set(v, false);
    else if (input === 'getvalue') this.fire(n, 'ongetvalue', null, n.value);
    else if (input === 'enable') n.enabled = true;
    else if (input === 'disable') n.enabled = false;
  },
  logic_compare(n, input, param) {
    const cmp = () => {
      const o = n.value === n.cmp ? 'onequalto' : n.value < n.cmp ? 'onlessthan' : 'ongreaterthan';
      this.fire(n, o, null, n.value);
      if (n.value !== n.cmp) this.fire(n, 'onnotequalto', null, n.value);
    };
    if (input === 'setvalue') n.value = parseFloat(param) || 0;
    else if (input === 'setvaluecompare') {
      n.value = parseFloat(param) || 0;
      cmp();
    } else if (input === 'setcomparevalue') n.cmp = parseFloat(param) || 0;
    else if (input === 'compare') cmp();
  },
  logic_case(n, input, param) {
    const cases = [];
    for (let i = 1; i <= 16; i++) {
      const v = n.e.kv.get(`case${String(i).padStart(2, '0')}`);
      if (v !== undefined) cases.push([i, v]);
    }
    if (input === 'invalue') {
      const hit = cases.find(([, v]) => v === param || (parseFloat(v) === parseFloat(param) && param !== ''));
      this.fire(n, hit ? `oncase${String(hit[0]).padStart(2, '0')}` : 'ondefault');
    } else if (input === 'pickrandom' || input === 'pickrandomshuffle') {
      if (cases.length) this.fire(n, `oncase${String(cases[Math.floor(Math.random() * cases.length)][0]).padStart(2, '0')}`);
    }
  },
  func_door(n, input) {
    if (!n.doors) return;
    const set = (t) => {
      if (n.doors[0]?.target === t) return;
      for (const d of n.doors) d.target = t;
      this.fire(n, t ? 'onopen' : 'onclose');
      if (!t) n.closeIn = undefined;
    };
    if (input === 'open') set(1);
    else if (input === 'close') set(0);
    else if (input === 'toggle') set(n.doors[0].target ? 0 : 1);
  },
  func_movelinear(n, input, param) {
    if (!n.doors) return;
    const set = (t) => n.doors.forEach((d) => (d.target = t));
    if (input === 'open') set(1);
    else if (input === 'close') set(0);
    else if (input === 'setposition') set(Math.min(1, Math.max(0, parseFloat(param) || 0)));
  },
  func_tracktrain(n, input, param) {
    if (input === 'startforward' || input === 'resume') {
      n.dir = 1;
      n.speed = n.speedMax;
    } else if (input === 'startbackward') {
      n.dir = -1;
      n.speed = n.speedMax;
    } else if (input === 'stop') n.dir = 0;
    else if (input === 'toggle') n.dir = n.dir ? 0 : 1;
    else if (input === 'setspeed') {
      n.speed = n.speedMax * Math.abs(parseFloat(param) || 0);
      n.dir = n.speed > 0 ? n.dir || 1 : 0;
    } else if (input === 'setspeedreal') {
      n.speed = (parseFloat(param) || 0) * S;
      n.dir = n.speed > 0 ? n.dir || 1 : 0;
    } else if (input === 'setspeeddir') {
      const v = parseFloat(param) || 0;
      n.speed = n.speedMax * Math.abs(v);
      n.dir = Math.sign(v);
    } else if (input === 'teleporttopathtrack') {
      const t = this.find(param, n, null).find((x) => x.cls === 'path_track');
      if (t) {
        n.node = t;
        n.next = this.nextTrack(t, 1);
      }
    }
  },
  func_brush(n, input) {
    const b = this.brushOf.get(n.e);
    if (!b) return;
    const on = input === 'enable' ? true : input === 'disable' ? false : input === 'toggle' ? !!b.solids[0]?.disabled : null;
    if (on !== null) for (const s of b.solids) this.ctx.world.setSolidEnabled(s, on);
  },
  trigger_portal_cleanser(n, input) {
    if (input === 'enable') n.setOn?.(true);
    else if (input === 'disable') n.setOn?.(false);
    else if (input === 'toggle') n.setOn?.(!n.enabled);
  },
  trigger_changelevel(n, input) {
    if (input === 'changelevel') this.ctx.complete(n.e.kv.get('map'));
  },
  prop_portal(n, input, param) {
    if (input === 'setactivatedstate') (param.trim() === '1' ? n.open : n.close)();
    else if (input === 'open') n.open();
    else if (input === 'fizzle' || input === 'close') n.close();
    else if (input === 'newlocation') {
      const [x, y, z, p, yw, r] = param.trim().split(/\s+/).map(Number);
      n.center = toV(x, y, z);
      const v = anglesToVectors(p || 0, yw || 0, r || 0);
      n.normal = v.forward;
      n.up = v.up;
      n.close();
      n.open();
    }
  },
  point_template(n, input) {
    if (input === 'forcespawn') {
      this.spawnTemplate(n, null);
      this.fire(n, 'onentityspawned');
    }
  },
  env_entity_maker(n, input) {
    if (input !== 'forcespawn') return;
    const tpl = this.find(n.e.kv.get('entitytemplate') ?? '', n, null).find((x) => x.cls === 'point_template');
    if (tpl) {
      this.spawnTemplate(tpl, vecKV(n.e, 'origin'));
      this.fire(n, 'onentityspawned');
    }
  },
  prop_physics(n, input) {
    const c = n.cube;
    if (!c) return;
    if (input === 'dissolve' || input === 'break' || input === 'kill') {
      if (input === 'break') this.fire(n, 'onbreak');
      this.kill(n);
    } else if (input === 'enablemotion' || input === 'wake') {
      if (c.frozen) {
        c.frozen = false;
        c.body.setBodyType(0, true); // dinâmico
        this.fire(n, 'onmotionenabled');
      }
    } else if (input === 'disablemotion') {
      c.frozen = true;
      c.body.setBodyType(1, true); // fixo
    } else if (input === 'starttalking' && c.coreLines?.length && !n.talking) {
      n.talking = true;
      let k = 0;
      const next = () => {
        if (!n.talking || c.gone) return;
        const line = c.coreLines[k++ % c.coreLines.length];
        this.ctx.sound?.(line, 1);
        n.talkTimer = setTimeout(next, (2.6 + c.coreDelay) * 1000);
      };
      next();
    } else if (input === 'stoptalking') {
      n.talking = false;
      clearTimeout(n.talkTimer);
    }
  },
  point_servercommand(n, input, param) {
    const m = /changelevel\s+(\S+)/i.exec(param);
    if (input === 'command' && m) this.ctx.complete(m[1]);
  },
  logic_choreographed_scene(n, input) {
    // falas: tocadas pelo módulo de diálogo (ctx.scene); sem ele, só o tempo passa
    if (input === 'start') {
      this.fire(n, 'onstart');
      const dur = this.ctx.scene?.(n.e.kv.get('scenefile') ?? '') ?? 3;
      this.schedule(dur, '!self', 'FireCompletion', '', null, n);
    } else if (input === 'firecompletion') this.fire(n, 'oncompletion');
    else if (input === 'cancel') this.queue = this.queue.filter((ev) => !(ev.caller === n && ev.input === 'FireCompletion'));
  },
};
INPUTS.func_wall_toggle = INPUTS.func_brush;
INPUTS.func_water_analog = INPUTS.func_movelinear;
for (const c of ['trigger_once', 'trigger_multiple', 'trigger_hurt', 'trigger_teleport', 'trigger_look', 'trigger_vphysics_motion', 'trigger_changelevel'])
  INPUTS[c] = function (n, input) {
    if (input === 'enable') n.enabled = true;
    else if (input === 'disable') n.enabled = false;
    else if (input === 'toggle') n.enabled = !n.enabled;
    if (c === 'trigger_changelevel' && input === 'changelevel') this.ctx.complete(n.e.kv.get('map'));
  };
INPUTS.prop_physics_override = INPUTS.prop_physics;
INPUTS.prop_glados_core = INPUTS.prop_physics;
INPUTS.prop_dynamic_override = INPUTS.prop_dynamic;
INPUTS.func_door_rotating = function (n, input) {
  // giro aproximado: aberta = sem colisão; as saídas saem no tempo do giro (distância ÷ velocidade)
  const b = this.brushOf.get(n.e);
  const t = Math.abs(num(n.e, 'distance', 90)) / Math.max(1, num(n.e, 'speed', 100));
  const go = (open) => {
    if (n.isOpen === open) return;
    n.isOpen = open;
    b?.solids.forEach((s) => this.ctx.world.setSolidEnabled(s, !open));
    this.fire(n, open ? 'onopen' : 'onclose');
    this.queue = this.queue.filter((ev) => !(ev.caller === n && ev.input === 'FireFully'));
    this.schedule(t, '!self', 'FireFully', open ? 'open' : 'closed', null, n);
  };
  if (input === 'open') go(true);
  else if (input === 'close') go(false);
  else if (input === 'toggle') go(!n.isOpen);
  else if (input === 'firefully') this.fire(n, arguments[2] === 'open' ? 'onfullyopen' : 'onfullyclosed');
};
