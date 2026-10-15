// Alcance do jogador (estimativa): a partir de um ponto, quais lugares dá para
// alcançar andando, pulando, caindo, pelas placas de lançamento e pelos portais
// fixos. Busca em largura numa grade de 0,5 m; cada salto/queda é uma simulação
// de voo (trajectory.js). É CONSERVADORA no que não sabe fazer (não usa cubos
// como degrau, nem portais que o jogador abriria, nem funis).

import * as THREE from 'three';
import { flight, PLAYER_HALF, WALK, JUMP } from './trajectory.js';

const CELL = 0.5;
const DIRS8 = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)));
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const key = (x, y, z) => `${Math.round(x / CELL)},${Math.round(y / 0.25)},${Math.round(z / CELL)}`;

/**
 * env = { world, portals, gravityAt }
 * opts = { start: Vector3 (pés), ignoreDoors, plates, portals, maxCells, onProgress(n) }
 * Devolve { cells: [Vector3 (pés)], truncated, visited:Map }
 */
export async function reach(env, opts) {
  const { world, portals } = env;
  const ignore = opts.ignoreDoors ? new Set(world.doors.map((d) => d.box)) : null;
  const filter = ignore ? (b) => !ignore.has(b) : null;
  const maxCells = opts.maxCells ?? 12000;
  const H = PLAYER_HALF;
  const visited = new Map();
  const queue = [];
  let truncated = false;
  let t0 = performance.now();

  const floorAt = (x, z, fromY, drop) => {
    const h = world.raycast(new THREE.Vector3(x, fromY, z), DOWN, drop, filter);
    if (!h || h.normal.y < 0.7 || h.box.isHazard) return null;
    return h.point.y;
  };
  const headroom = (x, y, z) => !world.raycast(new THREE.Vector3(x, y + 0.05, z), UP, 1.75, filter);
  const free = (a, b, y) => {
    // corredor livre do ponto a ao b, na altura dos joelhos e do peito, com a largura do corpo
    const d = b.clone().sub(a).setY(0);
    const len = d.length();
    if (len < 1e-6) return true;
    d.divideScalar(len);
    const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(H.x * 0.9);
    for (const dy of [0.45, 1.5])
      for (const s of [-1, 0, 1]) {
        const o = a.clone().addScaledVector(side, s).setY(y + dy);
        if (world.raycast(o, d, len + 0.05, filter)) return false;
      }
    return true;
  };
  const push = (x, y, z) => {
    const k = key(x, y, z);
    if (visited.has(k)) return false;
    if (visited.size >= maxCells) {
      truncated = true;
      return false;
    }
    const p = new THREE.Vector3(Math.round(x / CELL) * CELL, y, Math.round(z / CELL) * CELL);
    visited.set(k, p);
    queue.push(p);
    return true;
  };
  const land = (r) => {
    if (r.end.kind !== 'pouso') return;
    const e = r.end.pos;
    const feet = e.y - H.y - 0.02;
    const y = floorAt(e.x, e.z, feet + 0.6, 1.2);
    if (y !== null) push(e.x, y, e.z);
  };
  const fly = (pos, vel) => land(flight(env, { pos, vel, half: H, dt: 1 / 90, maxT: 6, plates: opts.plates !== false, ignore: ignore ? (b) => ignore.has(b) : null }));

  const s = opts.start;
  const y0 = floorAt(s.x, s.z, s.y + 1.2, 6) ?? s.y;
  push(s.x, y0, s.z);
  let steps = 0;
  while (queue.length) {
    const c = queue.shift();
    const center = new THREE.Vector3(c.x, c.y + H.y + 0.05, c.z);
    let edge = false;
    // andar
    for (const d of DIRS8) {
      const nx = c.x + d.x * CELL;
      const nz = c.z + d.z * CELL;
      const ny = floorAt(nx, nz, c.y + 0.7, 1.4);
      if (ny !== null && ny - c.y <= 0.5 && ny - c.y >= -0.5) {
        if (free(c, new THREE.Vector3(nx, c.y, nz), c.y) && headroom(nx, ny, nz)) push(nx, ny, nz);
        else edge = true;
      } else {
        edge = true;
        if (ny === null && !world.raycast(new THREE.Vector3(nx, c.y + 0.7, nz), DOWN, 0.9, filter) && free(c, new THREE.Vector3(nx, c.y, nz), c.y)) {
          // sem chão adiante: cai andando
          fly(center.clone().addScaledVector(d, CELL * 0.8), d.clone().multiplyScalar(WALK));
        }
      }
    }
    // pular (só de beiradas e paredes: o miolo de um salão não precisa)
    if (edge) {
      for (const d of DIRS8) {
        fly(center.clone(), d.clone().multiplyScalar(WALK).addScaledVector(UP, JUMP));
        fly(center.clone(), d.clone().multiplyScalar(WALK * 0.5).addScaledVector(UP, JUMP));
      }
      fly(center.clone(), UP.clone().multiplyScalar(JUMP));
    }
    // placas de lançamento
    if (opts.plates !== false)
      for (const P of world.plates)
        if (Math.abs(c.x - P.pos.x) < 1.0 && Math.abs(c.z - P.pos.z) < 1.0 && Math.abs(c.y - (P.pos.y + 0.2)) < 0.4) fly(center.clone(), new THREE.Vector3(0, 0, 0));
    // portais fixos: andar até a boca (parede) ou pisar nela (chão)
    if (opts.portals !== false)
      for (const P of portals.list) {
        if (!portals.isLinked(P) || P.delta > 0) continue;
        const rel = c.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(P.center);
        if (Math.abs(P.normal.y) > 0.7) {
          if (Math.hypot(rel.x, rel.z) < 0.9 && Math.abs(c.y - P.center.y) < 0.5) fly(center.clone().add(new THREE.Vector3(0, -0.2, 0)), new THREE.Vector3(0, -1, 0));
        } else if (rel.length() < 2.4 && rel.dot(P.normal) > 0) fly(center.clone(), P.normal.clone().negate().multiplyScalar(WALK));
      }
    if (++steps % 4 === 0 && performance.now() - t0 > 10) {
      opts.onProgress?.(visited.size);
      await new Promise((r) => setTimeout(r));
      t0 = performance.now();
      if (opts.cancelled?.()) return { cells: [...visited.values()], truncated: true, visited, cancelled: true };
    }
  }
  return { cells: [...visited.values()], truncated, visited };
}

/** a lista de células contém um ponto a ≤ `r` m (horizontal) de `p` e na mesma altura (± `dy`)? */
export function reached(cells, p, r = 1.3, dy = 1.1) {
  return cells.some((c) => Math.hypot(c.x - p.x, c.z - p.z) <= r && Math.abs(c.y - p.y) <= dy);
}
