// Simuladores de trajetória para o editor: o mesmo que o jogo faz com a gravidade
// (frontier.gravity: zonas, buracos negros, lua), a velocidade máxima de queda,
// as placas de lançamento e os portais (portals.carry conserva o momento).
//
// É uma estimativa do CENTRO do corpo (não roda o controlador de colisão do
// Rapier): serve para planejar. Não simula funis de excursão.

import * as THREE from 'three';
import { PORTAL_A, PORTAL_B } from '../../portals.js';

export const PLAYER_HALF = new THREE.Vector3(0.3, 0.9, 0.3);
export const MAX_FALL = 32; // igual ao do player.js
export const WALK = 4.6;
export const JUMP = 4.6;

const _a = new THREE.Vector3();
const _g = new THREE.Vector3();
const _step = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p2 = new THREE.Vector3();

/**
 * Voo de um corpo lançado.
 *   env = { world, portals, gravityAt(p) → Vector3 (m/s², devolve cópia) }
 *   opts = { pos, vel, half?, dt?, maxT?, plates?, ignore?(box), ghost? }
 *   ghost: atravessa tudo (sólidos, rocha fundida, grades); só portais e placas mudam o voo
 * Devolve { pts, seg, times, end:{kind,pos,normal,t,speed}, stats, passes:[{t,pos}] }.
 *   seg[i]: quantos portais já foram atravessados até o ponto i (para pintar cada trecho de uma cor).
 *   end.kind: 'pouso' (superfície que sustenta) | 'parede' | 'mata' (rocha fundida) | 'grade' | 'tempo' | 'abismo'
 */
export function flight(env, o) {
  const { world, portals, gravityAt } = env;
  const half = o.half ?? PLAYER_HALF;
  const dt = o.dt ?? 1 / 120;
  const maxT = o.maxT ?? 14;
  const pos = o.pos.clone();
  const vel = o.vel.clone();
  const pts = [pos.clone()];
  const seg = [0];
  const times = [0];
  const passes = [];
  const used = new Map(); // placa → instante do último uso
  let t = 0;
  let cross = 0;
  let cool = 0;
  let maxH = pos.y;
  let end = null;
  const startPos = pos.clone();
  const filter = o.ignore ? (b) => !o.ignore(b) : null;
  // sem colisão, o voo acaba um pouco abaixo da parte mais baixa do nível
  const floorY = o.ghost ? world.solids.reduce((m, b) => Math.min(m, b.min?.y ?? m), startPos.y) - 10 : -300;
  const ext = (d) => Math.abs(d.x) * half.x + Math.abs(d.y) * half.y + Math.abs(d.z) * half.z;
  while (t < maxT && !end) {
    gravityAt(pos, _g);
    vel.addScaledVector(_g, dt);
    if (vel.length() > MAX_FALL) vel.setLength(MAX_FALL);
    _step.copy(vel).multiplyScalar(dt);
    const len = _step.length();
    const prev = pos.clone();
    // placa de lançamento (mesmas regras do jogo)
    if (o.plates !== false)
      for (const P of world.plates) {
        if (t - (used.get(P) ?? -9) < 0.9) continue;
        const top = P.pos.y + 0.2;
        const feetY = pos.y - half.y;
        if (Math.abs(pos.x - P.pos.x) < 1.05 && Math.abs(pos.z - P.pos.z) < 1.05 && feetY > top - 0.25 && feetY < top + 0.45 && vel.y <= 0.5) {
          vel.copy(P.vel);
          pos.y = Math.max(pos.y, top + half.y + 0.05);
          used.set(P, t);
        }
      }
    const next = pos.clone().add(_step);
    // portal: o centro do corpo atravessou a boca?
    const P = cool <= 0 && len > 1e-6 ? portals.crossing(prev, next, true) : null;
    if (P) {
      pos.copy(next);
      const { Q } = portals.carry(P, pos, vel);
      const n = Q.normal;
      if (Math.abs(n.y) < 0.5) {
        const need = Math.abs(n.x) * half.x + Math.abs(n.z) * half.z + 0.03;
        const d = pos.clone().sub(Q.center).dot(n);
        if (d < need) pos.addScaledVector(n, need - d);
      }
      _a.set(vel.x, 0, vel.z);
      portals.exitAssist(Q, pos, vel, half, gravityAt(pos, _n.clone()), _a.lengthSq() > 1e-6 ? _a.clone().normalize() : new THREE.Vector3(1, 0, 0));
      cross++;
      cool = 0.12;
      passes.push({ t, pos: pos.clone() });
      pts.push(pos.clone());
      seg.push(cross);
      times.push(t);
      t += dt;
      continue;
    }
    cool -= dt;
    // fornalha/rocha fundida e grades
    if (!o.ghost && world.hazards.some((h) => next.x > h.min.x && next.x < h.max.x && next.y - half.y < h.max.y && next.y + half.y > h.min.y && next.z > h.min.z && next.z < h.max.z)) {
      pos.copy(next);
      end = { kind: 'mata', pos: pos.clone(), normal: new THREE.Vector3(0, 1, 0), t, speed: vel.length() };
      pts.push(pos.clone());
      seg.push(cross);
      times.push(t);
      break;
    }
    if (!o.ghost && world.segmentFizzler?.(prev, next)) {
      pos.copy(next);
      end = { kind: 'grade', pos: pos.clone(), normal: new THREE.Vector3(0, 1, 0), t, speed: vel.length() };
      pts.push(pos.clone());
      seg.push(cross);
      times.push(t);
      break;
    }
    // sólidos: varredura da caixa do corpo (caixas alinhadas exatas; rampas e convexos pelo centro)
    if (len > 1e-6 && !o.ghost) {
      _a.copy(_step).divideScalar(len);
      let hit = sweep(world, prev, _a, len, half, filter);
      // sobre a boca de um portal ligado a parede/chão some: o corpo passa (o jogo abre o buraco na colisão)
      if (hit) {
        const at = _p2.copy(prev).addScaledVector(_a, hit.dist);
        for (const Pm of portals.list) {
          if (!portals.isLinked(Pm) || Pm.delta > 0 || Pm.box !== hit.box) continue;
          const l = Pm.local(at);
          if (Math.abs(l.x) <= PORTAL_A + 0.15 && Math.abs(l.y) <= PORTAL_B + 0.15) {
            hit = null;
            break;
          }
        }
      }
      if (hit) {
        pos.copy(prev).addScaledVector(_a, hit.dist);
        const n = hit.normal;
        const up = _n.copy(gravityAt(pos, new THREE.Vector3())).negate();
        const gl = up.length();
        if (gl > 0.01) up.divideScalar(gl);
        const ground = gl > 0.01 && n.dot(up) > 0.7;
        end = { kind: ground ? 'pouso' : 'parede', pos: pos.clone(), normal: n.clone(), t, speed: vel.length(), box: hit.box };
        pts.push(pos.clone());
        seg.push(cross);
        times.push(t);
        break;
      }
    }
    pos.copy(next);
    maxH = Math.max(maxH, pos.y);
    pts.push(pos.clone());
    seg.push(cross);
    times.push(t);
    t += dt;
    if (pos.y < floorY || pos.length() > 5000) end = { kind: 'abismo', pos: pos.clone(), normal: new THREE.Vector3(0, 1, 0), t, speed: vel.length() };
  }
  end ??= { kind: 'tempo', pos: pos.clone(), normal: new THREE.Vector3(0, 1, 0), t, speed: vel.length() };
  const last = end.pos;
  return {
    pts,
    seg,
    times,
    end,
    passes,
    stats: { maxHeight: maxH - startPos.y, range: Math.hypot(last.x - startPos.x, last.z - startPos.z), time: end.t, speed: end.speed, drop: startPos.y - last.y },
  };
}

/**
 * Varredura da caixa do corpo (centro `o`, meia-medida `half`) ao longo de `d` por `maxD`.
 * Caixas alinhadas: exato (caixa expandida × raio). Rampas/convexos: raio do centro com recuo.
 */
export function sweep(world, o, d, maxD, half, filter = null) {
  let best = null;
  const e = 0.01; // folga: encostado não é atravessando
  const hx = half.x - e;
  const hy = half.y - e;
  const hz = half.z - e;
  for (const b of world.solids) {
    if (filter && !filter(b)) continue;
    if (b.noRay || b.disabled || b.solid === false) continue;
    if (b.planes || b.obb) continue;
    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = -1;
    let sign = 0;
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const oi = o.getComponent(i);
      const di = d.getComponent(i);
      const h = i === 0 ? hx : i === 1 ? hy : hz;
      const lo = b.min.getComponent(i) - h;
      const hi = b.max.getComponent(i) + h;
      if (Math.abs(di) < 1e-9) {
        if (oi <= lo || oi >= hi) {
          ok = false;
          break;
        }
        continue;
      }
      let t1 = (lo - oi) / di;
      let t2 = (hi - oi) / di;
      let s = -1;
      if (t1 > t2) {
        [t1, t2] = [t2, t1];
        s = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = i;
        sign = s;
      }
      tmax = Math.min(tmax, t2);
      if (tmin >= tmax) {
        ok = false;
        break;
      }
    }
    if (!ok || axis < 0 || tmin < 0 || tmin > maxD) continue;
    if (!best || tmin < best.dist) {
      const normal = new THREE.Vector3();
      normal.setComponent(axis, sign);
      best = { dist: tmin, normal, box: b };
    }
  }
  // rampas e convexos
  const hit = world.raycast(o, d, maxD + 3, (b) => !!(b.planes || b.obb) && (!filter || filter(b)));
  if (hit) {
    const n = hit.normal;
    const back = (Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z) / Math.max(0.05, Math.abs(d.dot(n)));
    const t = Math.max(0, hit.dist - back);
    if (t <= maxD && (!best || t < best.dist)) best = { dist: t, normal: n.clone(), box: hit.box };
  }
  return best;
}

/** bola de energia: reta com reflexos nas paredes e passagem por portais */
export function pellet(env, { pos, dir, speed = 6.5, life = 12, dt = 1 / 60, maxBounces = 40 }) {
  const { world, portals } = env;
  const p = pos.clone();
  const d = dir.clone().normalize();
  const pts = [p.clone()];
  const seg = [0];
  let t = 0;
  let bounces = 0;
  let cross = 0;
  let cool = 0;
  let end = 'vida';
  while (t < life) {
    const step = speed * dt;
    const next = p.clone().addScaledVector(d, step);
    const P = cool <= 0 ? portals.crossing(p, next, false) : null;
    if (P) {
      p.copy(next);
      const M = portals.transform(P, P.partner);
      p.applyMatrix4(M);
      d.transformDirection(M);
      cross++;
      cool = 0.1;
      pts.push(p.clone());
      seg.push(cross);
      t += dt;
      continue;
    }
    cool -= dt;
    const hit = world.raycast(p, d, step + 0.2);
    if (hit) {
      p.copy(hit.point).addScaledVector(hit.normal, 0.2);
      d.addScaledVector(hit.normal, -2 * d.dot(hit.normal)).normalize();
      pts.push(p.clone());
      seg.push(cross);
      if (++bounces > maxBounces) {
        end = 'rebates';
        break;
      }
      t += dt;
      continue;
    }
    p.copy(next);
    pts.push(p.clone());
    seg.push(cross);
    t += dt;
    if (p.length() > 3000) {
      end = 'abismo';
      break;
    }
  }
  return { pts, seg, end: { kind: end, pos: p.clone(), t }, stats: { bounces, portals: cross, time: t } };
}

/** velocidade inicial que a placa dá a quem pisa: `faithPlate` guarda em P.vel */
export const plateVelocity = (P) => P.vel.clone();
