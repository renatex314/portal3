// Converte um mapa BSP da campanha original para o mundo do jogo: pincéis viram
// caixas (ou sólidos convexos) com os materiais PRÓPRIOS do laboratório, e as
// entidades viram as mecânicas daqui. Coordenadas: 1 unidade Source = 2,5 cm,
// Z para cima → Y para cima.

import * as THREE from 'three';
import { CONTENTS, SURF } from './bsp.js';
import { portalGun } from '../models.js';

export const S = 0.025;
export const toV = (x, y, z) => new THREE.Vector3(x * S, z * S, -y * S);
export const parseVec = (s) => (s ?? '0 0 0').trim().split(/\s+/).map(Number);
export const vecKV = (e, k) => {
  const [x, y, z] = parseVec(e.kv.get(k));
  return toV(x || 0, y || 0, z || 0);
};
/** ângulo de visão Source (graus, 0 = +X) → yaw do jogador daqui */
export const yawFromSource = (deg) => (deg * Math.PI) / 180 - Math.PI / 2;

// ordem das faces de uma caixa (igual à BoxGeometry): +x −x +y −y +z −z
const FACE_N = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** direção "para frente" de ângulos Source (graus), no espaço daqui */
export function forwardOf(pitch, yaw) {
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(p) * Math.cos(y), -Math.sin(p), -Math.cos(p) * Math.sin(y));
}

/** categoria visual/física de uma face, a partir do material e das flags */
export function faceKind(tex) {
  if (!tex) return null;
  const { name, flags } = tex;
  if (name === 'tools/toolsblack') return 'dark';
  if (flags & (SURF.NODRAW | SURF.SKY | SURF.SKY2D | SURF.HINT | SURF.SKIP | SURF.TRIGGER) || name.startsWith('tools/')) return null;
  if (name.includes('glass')) return 'glass';
  if (name.includes('toxicslime') || name.includes('water') || flags & SURF.WARP) return 'goo';
  if (name.startsWith('lights/') || flags & SURF.LIGHT) return 'lamp';
  if (flags & SURF.NOPORTAL || name.includes('grate')) return 'metal';
  return 'white';
}

/** pontos de um pincel convexo: interseção de cada trio de planos, dentro de todos */
function brushPoints(planes) {
  const pts = [];
  const m = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const [a, b, c] = [planes[i], planes[j], planes[k]];
        m.set(a.n.x, a.n.y, a.n.z, b.n.x, b.n.y, b.n.z, c.n.x, c.n.y, c.n.z);
        if (Math.abs(m.determinant()) < 1e-6) continue;
        v.set(a.d, b.d, c.d).applyMatrix3(m.clone().invert());
        if (planes.every((p) => p.n.dot(v) - p.d < 1e-3)) {
          if (!pts.some((q) => q.distanceToSquared(v) < 1e-8)) pts.push(v.clone());
        }
      }
  return pts;
}

/**
 * Pincel → sólido do mundo. `offset`: origem da entidade (pincéis de entidade
 * ficam relativos a ela). Devolve o sólido criado ou null.
 */
function addBrush(w, bsp, bi, offset, opts = {}) {
  const brush = bsp.brushes[bi];
  const c = brush.contents;
  const isGoo = c & (CONTENTS.WATER | CONTENTS.SLIME);
  const solid = c & (CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.GRATE | CONTENTS.PLAYERCLIP | CONTENTS.MOVEABLE);
  if (!isGoo && !solid && !opts.visualOnly) return null;

  const planes = [];
  for (let s = brush.first; s < brush.first + brush.count; s++) {
    const side = bsp.sides[s];
    if (side.bevel) continue;
    const p = bsp.planes[side.plane];
    const n = new THREE.Vector3(p.n[0], p.n[2], -p.n[1]);
    planes.push({ n, d: p.d * S + n.dot(offset), tex: bsp.texinfo[side.texinfo], kind: faceKind(bsp.texinfo[side.texinfo]) });
  }
  const pts = brushPoints(planes);
  if (pts.length < 4) return null;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) {
    min.min(p);
    max.max(p);
  }
  if (max.x - min.x < 1e-3 || max.y - min.y < 1e-3 || max.z - min.z < 1e-3) return null;

  if (isGoo) {
    w.hazard(min.x, min.y, min.z, max.x, max.y, max.z);
    return null;
  }
  const clipOnly = !(c & (CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.GRATE | CONTENTS.MOVEABLE));
  const grate = !!(c & CONTENTS.GRATE);
  let kinds = planes.map((p) => (clipOnly ? null : p.kind));
  // portas e placas de botão da Valve são pincéis invisíveis (o visual era um modelo):
  // aqui ganham o visual de porta/botão do laboratório
  if (opts.fallbackKind && kinds.every((k) => !k)) kinds = planes.map(() => opts.fallbackKind);
  const common = {
    solid: !opts.visualOnly,
    noRay: clipOnly || grate || !!opts.visualOnly, // tiros e bolas passam por grade e por "clip"
    kinematic: !!opts.kinematic,
  };

  const axial = planes.length === 6 && planes.every((p) => Math.max(Math.abs(p.n.x), Math.abs(p.n.y), Math.abs(p.n.z)) > 0.9999);
  if (axial) {
    const faces = FACE_N.map((fn) => {
      const p = planes.find((q) => q.n.x * fn[0] + q.n.y * fn[1] + q.n.z * fn[2] > 0.999);
      return p ? kinds[planes.indexOf(p)] : null;
    });
    return w.importedBox(min, max, faces, common);
  }
  return w.convex(pts, planes.map((p, i) => ({ n: p.n, d: p.d, kind: kinds[i] })), common);
}

export const isCube = (e) =>
  /^prop_(physics|physics_override|physics_multiplayer|weighted_cube)$/.test(e.classname) && (e.kv.get('model') ?? '').toLowerCase().includes('metal_box');
export const cubeOpts = (e) =>
  e.classname === 'prop_glados_core'
    ? {
        ioName: (e.kv.get('targetname') ?? '').toLowerCase(),
        core: parseInt(e.kv.get('coretype') || '0', 10),
        coreDelay: parseFloat(e.kv.get('delaybetweenlines')) || 0.4,
        frozen: !!(parseInt(e.kv.get('spawnflags') || '0', 10) & 8),
        grabUnlock: !!(parseInt(e.kv.get('spawnflags') || '0', 10) & 64),
      }
    : { ioName: (e.kv.get('targetname') ?? '').toLowerCase(), special: e.kv.get('skin') === '1' };

/** caixa (no mundo daqui) que envolve o modelo de pincel `mi` da entidade `e` */
export function modelBounds(bsp, mi, e) {
  const o = parseVec(e.kv.get('origin'));
  const { mins, maxs } = bsp.models[mi];
  const a = toV(mins[0] + (o[0] || 0), mins[1] + (o[1] || 0), mins[2] + (o[2] || 0));
  const b = toV(maxs[0] + (o[0] || 0), maxs[1] + (o[1] || 0), maxs[2] + (o[2] || 0));
  return { min: a.clone().min(b), max: a.clone().max(b) };
}

/** cascos (meia largura x, meia largura y, base z, topo z — em unidades Source)
 *  dos modelos de plataforma em que se pisa; o tampo é uma placa no alto do casco */
const MODEL_HULLS = {
  'models/props/light_rail_platform.mdl': [64, 64, 30, 42],
  'models/props/light_rail_platform_02.mdl': [48, 48, 30, 42],
  'models/props/lift_platform.mdl': [63.7, 63.7, 20, 30.4],
};

/** entidades de pincel que não viram geometria (gatilhos, volumes, áreas) */
const NOT_GEOMETRY = /^(trigger_|func_areaportal|func_portal_|func_noportal_volume|func_occluder|func_viscluster|func_clip_vphysics|func_ladderendpoint|env_|water_lod|func_precipitation|func_smokevolume|func_vehicleclip|func_dustmotes|func_dustcloud)/;

export function buildMap(w, bsp) {
  const ents = bsp.entities;
  const byName = new Map();
  for (const e of ents) {
    const n = e.kv.get('targetname');
    if (n) {
      const k = n.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(e);
    }
  }

  // mundo (modelo 0)
  const zero = new THREE.Vector3();
  let count = 0;
  for (const bi of bsp.modelBrushes(0)) if (addBrush(w, bsp, bi, zero)) count++;

  // entidades de pincel: na posição inicial (as que se mexem ganham corpo cinemático)
  const brushEnts = [];
  for (const e of ents) {
    const model = e.kv.get('model');
    if (!model || model[0] !== '*' || NOT_GEOMETRY.test(e.classname)) continue;
    const mi = parseInt(model.slice(1), 10);
    if (!bsp.models[mi]) continue;
    const moving = /^func_(door|movelinear|tracktrain|rotating|door_rotating|platrot|train|physbox)/.test(e.classname);
    const hidden = e.kv.get('startdisabled') === '1' || e.kv.get('rendermode') === '10';
    const visualOnly = e.classname === 'func_illusionary' || e.kv.get('solidity') === '1';
    let fallbackKind = /^func_(tracktrain|movelinear)$/.test(e.classname) ? 'metal' : null;
    if (e.classname === 'func_door') {
      const [pitch] = parseVec(e.kv.get('movedir'));
      fallbackKind = pitch > 45 && (parseFloat(e.kv.get('speed')) || 100) <= 60 ? 'button' : 'door';
    }
    const solids = [];
    for (const bi of bsp.modelBrushes(mi)) {
      const s = addBrush(w, bsp, bi, vecKV(e, 'origin'), { kinematic: moving, visualOnly, fallbackKind });
      if (s) solids.push(s);
    }
    if (hidden) for (const s of solids) w.setSolidEnabled(s, false);
    // func_door "não sólida para o jogador" (flags 4/8): só visual
    if (e.classname === 'func_door' && parseInt(e.kv.get('spawnflags') || '0', 10) & 12) for (const s of solids) s.collider?.setEnabled(false);
    brushEnts.push({ e, solids, bounds: modelBounds(bsp, mi, e) });
    count += solids.length;
  }

  // luzes: as mais fortes viram luzes de verdade (o resto fica no brilho dos painéis)
  const lights = [];
  for (const e of ents) {
    if (e.classname !== 'light' && e.classname !== 'light_spot') continue;
    const [r, g, b, bright] = parseVec(e.kv.get('_light'));
    if (!(bright > 0)) continue;
    lights.push({ p: vecKV(e, 'origin'), color: new THREE.Color(r / 255, g / 255, b / 255), bright });
  }
  lights.sort((a, b) => b.bright - a.bright);
  const picked = [];
  for (const L of lights) {
    if (picked.length >= 10) break;
    if (picked.some((q) => q.p.distanceTo(L.p) < 6)) continue;
    picked.push(L);
  }
  // luz forte em sala pequena estoura a imagem: a intensidade cai com o tamanho do lugar
  // (média da distância até as paredes em 6 direções)
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((d) => new THREE.Vector3(...d));
  for (const L of picked) {
    const room = DIRS.reduce((a, d) => a + (w.raycast(L.p, d, 20)?.dist ?? 20), 0) / DIRS.length;
    const k = THREE.MathUtils.clamp(room / 7, 0.3, 1);
    w.light(L.p.x, L.p.y, L.p.z, Math.min(90, Math.max(15, L.bright / 6)) * k, L.color, 30, false);
  }

  // início
  const start = ents.find((e) => e.classname === 'info_player_start');
  const sp = start ? vecKV(start, 'origin') : new THREE.Vector3();
  const yaw = start ? yawFromSource(parseVec(start.kv.get('angles'))[1] || 0) : 0;

  // plataformas que no original são só modelo (com colisão própria) e não têm
  // pincel embaixo: viram um bloco de metal do tamanho do casco do modelo
  for (const e of ents) {
    if (!/^prop_dynamic/.test(e.classname) || e.kv.get('parentname') || e.kv.get('solid') === '0') continue;
    const hull = MODEL_HULLS[(e.kv.get('model') ?? '').toLowerCase()];
    if (!hull) continue;
    const o = parseVec(e.kv.get('origin'));
    const yaw = Math.round((parseVec(e.kv.get('angles'))[1] || 0) / 90) & 1;
    const [hx, hy] = yaw ? [hull[1], hull[0]] : [hull[0], hull[1]];
    const a = toV(o[0] - hx, o[1] - hy, o[2] + hull[2]);
    const b = toV(o[0] + hx, o[1] + hy, o[2] + hull[3]);
    const min = a.clone().min(b);
    const max = a.clone().max(b);
    // não duplica se já houver sólido ali (a plataforma tem pincel próprio)
    const c = min.clone().add(max).multiplyScalar(0.5);
    if (w.pointInSolid(c)) continue;
    w.importedBox(min, max, ['metal', 'metal', 'metal', 'metal', 'metal', 'metal']);
  }

  // dispensadores de cubo: no original o modelo é só visual (a boca fica na origem,
  // rente ao teto); aqui entra o tubo do dispensador do laboratório
  for (const e of ents) {
    if (!/^prop_dynamic/.test(e.classname) || !/box_dropper\.mdl$/i.test(e.kv.get('model') ?? '')) continue;
    const p = vecKV(e, 'origin');
    w.dispenser(p.x, p.y + 2.2, p.z);
  }

  // arma de portais: a que está no ponto de início é a que o jogador já traz da
  // câmara anterior; as outras são para pegar (num pedestal daqui)
  let gun = 'none';
  const gives = (e) => {
    const one = e.kv.get('canfireportal1') !== '0';
    const two = e.kv.get('canfireportal2') === '1';
    return two ? 'both' : one ? 'blue' : 'none';
  };
  for (const e of ents) {
    if (e.classname !== 'weapon_portalgun') continue;
    const p = vecKV(e, 'origin');
    if (p.distanceTo(sp) < 4) {
      gun = gives(e);
      continue;
    }
    const floor = w.raycast(p.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0), 6);
    w.pedestal(p.x, floor ? floor.point.y : p.y - 1, p.z, gives(e), portalGun());
  }

  // amostras (cubos): na campanha original são props de física com o modelo da caixa.
  // As que estão num point_template só aparecem quando o dispensador as cria.
  const templated = new Set();
  for (const e of ents)
    if (e.classname === 'point_template')
      for (const [k, v] of e.kv) if (/^template\d+$/.test(k)) templated.add(v.toLowerCase());
  const cubes = [];
  for (const e of ents) {
    if (!isCube(e) && e.classname !== 'prop_glados_core') continue;
    if (templated.has((e.kv.get('targetname') ?? '').toLowerCase())) continue;
    const p = vecKV(e, 'origin');
    cubes.push([p.x, p.y - 0.3, p.z, cubeOpts(e)]);
  }

  // torretas (o modelo daqui, no lugar e na direção das originais)
  const turrets = [];
  for (const e of ents) {
    if (e.classname !== 'npc_portal_turret_floor') continue;
    const p = vecKV(e, 'origin');
    turrets.push([p.x, p.y, p.z, yawFromSource(parseVec(e.kv.get('angles'))[1] || 0)]);
  }

  // bolas de energia
  const launchers = new Map();
  for (const e of ents) {
    if (e.classname !== 'point_energy_ball_launcher') continue;
    const p = vecKV(e, 'origin');
    const [pt, yw] = parseVec(e.kv.get('angles'));
    const n = forwardOf(pt || 0, yw || 0);
    // como no original: começa lançando sozinho e repõe a bola depois de `ballrespawntime`
    const L = w.launcher(p.x, p.y, p.z, n.toArray(), {
      life: parseFloat(e.kv.get('balllifetime')) || 12,
      delay: parseFloat(e.kv.get('ballrespawntime')) || 2,
      speed: (parseFloat(e.kv.get('minspeed')) || 260) * S,
    });
    L.done = e.kv.get('startdisabled') === '1';
    launchers.set(e, L);
  }
  // receptores: gatilho com filtro de bola de energia + o modelo do receptor ao lado
  const ballFilters = new Set(ents.filter((e) => e.classname === 'filter_combineball_type').map((e) => (e.kv.get('targetname') ?? '').toLowerCase()));
  const catcherProps = ents.filter((e) => /^prop_dynamic/.test(e.classname) && (e.kv.get('model') ?? '').includes('combine_ball_catcher'));
  const catchers = new Map();
  for (const e of ents) {
    if (!/^trigger_/.test(e.classname) || !ballFilters.has((e.kv.get('filtername') ?? '').toLowerCase())) continue;
    const mi = parseInt((e.kv.get('model') ?? '').slice(1), 10);
    if (!bsp.models[mi]) continue;
    const bb = modelBounds(bsp, mi, e);
    const c = bb.min.clone().add(bb.max).multiplyScalar(0.5);
    let best = null;
    for (const cp of catcherProps) {
      const q = vecKV(cp, 'origin');
      if (q.distanceTo(c) < 4 && (!best || q.distanceTo(c) < best.d)) best = { q, d: q.distanceTo(c), e: cp };
    }
    const [pt, yw] = best ? parseVec(best.e.kv.get('angles')) : [0, 0];
    const n = forwardOf(pt || 0, yw || 0);
    catchers.set(e, w.catcher(c.x, c.y, c.z, n.toArray(), null));
  }

  return { spawn: [sp.x, sp.y, sp.z, yaw], gun, cubes, turrets, launchers, catchers, byName, brushEnts, stats: { solids: count, lights: picked.length } };
}
