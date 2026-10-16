// Converte um mapa BSP da campanha original para o mundo do jogo: pincéis viram
// caixas (ou sólidos convexos) com os materiais PRÓPRIOS do laboratório, e as
// entidades viram as mecânicas daqui. Coordenadas: 1 unidade Source = 2,5 cm,
// Z para cima → Y para cima.

import * as THREE from 'three';
import { CONTENTS, SURF } from './bsp.js';
import { portalGun } from '../models.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  if (name.includes('metalgrate')) return 'grate'; // vazada: dá para ver através
  if (flags & SURF.NOPORTAL) return 'metal';
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
    if (opts.rot) n.applyMatrix3(opts.rot).normalize(); // pincel de molde girado (a distância ao centro não muda)
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
    // luz mais alta e mais fraca: nos mapas do original há pedestais e plataformas logo acima da gosma
    w.hazard(min.x, min.y, min.z, max.x, max.y, max.z, { light: 9, lightLift: 3.5 });
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

  // pincel sólido todo em "nodraw": invisível, mas aceita portal (como no Portal 1; os
  // mapas o usam onde o portal deve parar sobre uma peça que se move, ex.: a rampa da 12)
  const seeThrough = kinds.includes('grate');
  const nodrawPortal = !clipOnly && !grate && !opts.visualOnly && planes.every((p) => p.tex?.name === 'tools/toolsnodraw');
  const axial = planes.length === 6 && planes.every((p) => Math.max(Math.abs(p.n.x), Math.abs(p.n.y), Math.abs(p.n.z)) > 0.9999);
  if (axial) {
    const faces = FACE_N.map((fn) => {
      const p = planes.find((q) => q.n.x * fn[0] + q.n.y * fn[1] + q.n.z * fn[2] > 0.999);
      return p ? kinds[planes.indexOf(p)] : null;
    });
    const b = w.importedBox(min, max, faces, common);
    if (b && seeThrough) b.seeThrough = b.noRay = true; // tiros e portais atravessam a grade
    if (b) b.src = { bi, contents: c, tex: [...new Set(planes.map((p) => p.tex?.name))] };
    if (b && nodrawPortal) {
      b.portalable = true;
      b.portalAt = () => true;
    }
    return b;
  }
  const b = w.convex(pts, planes.map((p, i) => ({ n: p.n, d: p.d, kind: kinds[i] })), common);
  if (b && seeThrough) b.seeThrough = b.noRay = true; // tiros e portais atravessam a grade
  if (b) b.src = { bi, contents: c, tex: [...new Set(planes.map((p) => p.tex?.name))] }; // para depurar
  if (b && nodrawPortal) {
    for (const p of b.planes0) p.portal = true;
    b.portalable = true;
  }
  return b;
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
  if (e._rot) {
    // entidade de molde levada para outro lugar e girada: gira os 8 cantos
    const at = vecKV(e, 'origin');
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let k = 0; k < 8; k++) {
      const c = toV(k & 1 ? maxs[0] : mins[0], k & 2 ? maxs[1] : mins[1], k & 4 ? maxs[2] : mins[2]).applyMatrix3(e._rot).add(at);
      min.min(c);
      max.max(c);
    }
    return { min, max };
  }
  const a = toV(mins[0] + (o[0] || 0), mins[1] + (o[1] || 0), mins[2] + (o[2] || 0));
  const b = toV(maxs[0] + (o[0] || 0), maxs[1] + (o[1] || 0), maxs[2] + (o[2] || 0));
  return { min: a.clone().min(b), max: a.clone().max(b) };
}

/** vetores frente/cima (espaço daqui) de ângulos Source em graus */
function frameOf(pitch, yaw, roll = 0) {
  const R = Math.PI / 180;
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(pitch * R), Math.cos(pitch * R), Math.sin(yaw * R), Math.cos(yaw * R), Math.sin(roll * R), Math.cos(roll * R)];
  const f = new THREE.Vector3(cp * cy, -sp, -(cp * sy));
  const u = new THREE.Vector3(cr * sp * cy + sr * sy, cr * cp, -(cr * sp * sy - sr * cy));
  return { f, u };
}

/**
 * Moldes (point_template) criados por um env_entity_maker — no original, as
 * entidades aparecem no lugar e no ângulo do "maker" (ex.: o receptor de esfera
 * de energia da câmara 06, guardado num depósito e criado no teto). Aqui elas
 * já ficam lá desde o começo: posição, ângulos e pincéis giram junto. Os cubos
 * ficam de fora (o dispensador os cria na hora). Só para moldes com um maker só.
 */
export function relocateTemplates(bsp) {
  if (bsp._relocated) return;
  bsp._relocated = true;
  const ents = bsp.entities;
  const named = (n) => ents.filter((e) => (e.kv.get('targetname') ?? '').toLowerCase() === (n ?? '').toLowerCase());
  const makersOf = new Map();
  for (const m of ents) {
    if (m.classname !== 'env_entity_maker') continue;
    const tpl = named(m.kv.get('entitytemplate')).find((x) => x.classname === 'point_template');
    if (!tpl) continue;
    if (!makersOf.has(tpl)) makersOf.set(tpl, []);
    makersOf.get(tpl).push(m);
  }
  const fmt = (v) => `${(v.x / S).toFixed(3)} ${(-v.z / S).toFixed(3)} ${(v.y / S).toFixed(3)}`;
  for (const [tpl, makersAll] of makersOf) {
    const members0 = [];
    for (const [k, v] of tpl.kv) if (/^template\d+$/.test(k)) members0.push(...named(v));
    if (!members0.length || members0.every((e) => isCube(e) || e.classname === 'prop_glados_core')) continue;
    // um molde com vários "makers" (dois receptores iguais na câmara 17): uma cópia das
    // entidades para cada maker a mais; sem "preservar nomes" (flag 2), os nomes ganham
    // um sufixo e as ligações de dentro do molde apontam para a cópia certa
    makersAll.forEach((maker, mi) => {
    let members = members0;
    if (mi > 0) {
      const keep = parseInt(tpl.kv.get('spawnflags') || '0', 10) & 2;
      const names = new Set(members0.map((e) => (e.kv.get('targetname') ?? '').toLowerCase()).filter(Boolean));
      const ren = (v) => (!keep && v && names.has(v.toLowerCase()) ? `${v}&${mi}` : v);
      members = members0.map((e) => {
        const kv = new Map(e.kv);
        for (const k of ['targetname', 'parentname', 'filtername', 'target']) if (kv.has(k)) kv.set(k, ren(kv.get(k)));
        const c = { classname: e.classname, kv, outputs: e.outputs.map((o) => ({ ...o, target: ren(o.target) })) };
        if (e._origin) c.kv.set('origin', e._origin);
        return c;
      });
      ents.push(...members);
    } else for (const e of members0) e._origin = e.kv.get('origin');
    const T = vecKV(tpl, 'origin');
    const M = vecKV(maker, 'origin');
    const [mp, my, mr] = parseVec(maker.kv.get('angles'));
    const { f, u } = frameOf(mp || 0, my || 0, mr || 0);
    const rot = new THREE.Matrix3().set(f.x, u.x, f.y * u.z - f.z * u.y, f.y, u.y, f.z * u.x - f.x * u.z, f.z, u.z, f.x * u.y - f.y * u.x);
    for (const e of members) {
      if (isCube(e) || e.classname === 'prop_glados_core') continue;
      const p = vecKV(e, 'origin').sub(T).applyMatrix3(rot).add(M);
      e.kv.set('origin', fmt(p));
      const [ep, ey, er] = parseVec(e.kv.get('angles'));
      const fr = frameOf(ep || 0, ey || 0, er || 0);
      e._forward = fr.f.applyMatrix3(rot).normalize();
      e._up = fr.u.applyMatrix3(rot).normalize();
      if ((e.kv.get('model') ?? '')[0] === '*') e._rot = rot;
    }
    });
  }
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
  relocateTemplates(bsp);
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
  const worldFrom = w.solids.length;
  for (const bi of bsp.modelBrushes(0)) if (addBrush(w, bsp, bi, zero)) count++;
  // o mapa fixo (milhares de pincéis, cada face uma chamada de desenho) vira poucas malhas
  mergeStatic(w, w.solids.slice(worldFrom));

  // cadeia de pais: a peça que se move (porta, plataforma, trilho) de que esta depende
  const MOVING = /^func_(door|movelinear|tracktrain|rotating|door_rotating|platrot|train|physbox|water_analog)/;
  const movingRoot = (e) => {
    const seen = new Set();
    let cur = e;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const pn = (cur.kv.get('parentname') ?? '').toLowerCase();
      if (!pn) return null;
      const par = (byName.get(pn) ?? [])[0];
      if (!par) return null;
      if (MOVING.test(par.classname)) return par;
      cur = par;
    }
    return null;
  };
  const followers = []; // { solids, root }: andam junto com a peça raiz

  // entidades de pincel: na posição inicial (as que se mexem ganham corpo cinemático)
  const brushEnts = [];
  for (const e of ents) {
    const model = e.kv.get('model');
    if (!model || model[0] !== '*' || NOT_GEOMETRY.test(e.classname)) continue;
    const mi = parseInt(model.slice(1), 10);
    if (!bsp.models[mi]) continue;
    // a porta giratória do botão de pedestal não gira aqui: anda junto com o pedestal
    const root = MOVING.test(e.classname) && e.classname !== 'func_door_rotating' ? null : movingRoot(e);
    const moving = MOVING.test(e.classname) || !!root;
    const hidden = e.kv.get('startdisabled') === '1' || e.kv.get('rendermode') === '10';
    const visualOnly = e.classname === 'func_illusionary' || e.kv.get('solidity') === '1';
    let fallbackKind = /^func_(tracktrain|movelinear)$/.test(e.classname) ? 'metal' : null;
    if (e.classname === 'func_door') {
      const [pitch] = parseVec(e.kv.get('movedir'));
      const { mins, maxs } = bsp.models[mi];
      const flatWide = Math.min(maxs[0] - mins[0], maxs[1] - mins[1]) >= 24 && maxs[2] - mins[2] <= 24; // placa de botão
      fallbackKind = pitch > 45 && (parseFloat(e.kv.get('speed')) || 100) <= 60 ? (flatWide ? 'button' : 'metal') : 'door';
    }
    const solids = [];
    for (const bi of bsp.modelBrushes(mi)) {
      const s = addBrush(w, bsp, bi, vecKV(e, 'origin'), { kinematic: moving, visualOnly, fallbackKind, rot: e._rot });
      if (s) solids.push(s);
    }
    if (hidden) for (const s of solids) w.setSolidEnabled(s, false);
    // func_door "não sólida para o jogador" (flags 4/8): só visual
    if (e.classname === 'func_door' && parseInt(e.kv.get('spawnflags') || '0', 10) & 12) for (const s of solids) s.collider?.setEnabled(false);
    brushEnts.push({ e, solids, bounds: modelBounds(bsp, mi, e) });
    if (root && solids.length) followers.push({ solids, root });
    count += solids.length;
  }

  // portas giratórias com peças presas (a cunha que inclina na câmara 18): além das
  // peças na posição fechada, uma cópia invisível já girada, só para colisão, que vale
  // com a porta aberta. O visual das peças gira de verdade no runtime.
  const rotGroups = [];
  for (const be of brushEnts) {
    const e = be.e;
    const sf = parseInt(e.kv.get('spawnflags') || '0', 10);
    if (e.classname !== 'func_door_rotating' || sf & 256) continue;
    const members = brushEnts.filter((x) => x === be || movingRoot(x.e) === e);
    if (members.length < 2) continue;
    const dist = parseFloat(e.kv.get('distance')) || 90;
    // eixo do Source → daqui: rolagem = x, arfagem = −z; guinada = y, no sentido
    // horário visto de cima (o mesmo da arma giratória do runtime)
    const axis = sf & 64 ? new THREE.Vector3(1, 0, 0) : sf & 128 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const deg = (sf & (64 | 128) ? dist : -dist) * (sf & 2 ? -1 : 1);
    const hinge = vecKV(e, 'origin');
    const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
    // giros acumulados (catraca: a peça é solta no fim do giro e a porta volta sem ela):
    // até uma volta inteira em passos de `deg`; cada passo tem a sua cópia de colisão
    const turns = 360 % Math.abs(deg) < 1e-6 ? Math.round(360 / Math.abs(deg)) : 2;
    const parentOf = (x) => (byName.get((x.kv.get('parentname') ?? '').toLowerCase()) ?? [])[0];
    const unitOf = (x) => {
      // a peça presa direto na porta (as dela vão junto); a própria porta é a unidade ''
      let cur = x;
      for (let i = 0; i < 16 && cur && cur !== e; i++) {
        const par = parentOf(cur);
        if (par === e) return (cur.kv.get('targetname') ?? '').toLowerCase() || `#${ents.indexOf(cur)}`;
        cur = par;
      }
      return '';
    };
    const parts = members.map((m) => {
      const states = [null];
      for (let k = 1; k < turns; k++) {
        const qk = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg * k));
        const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(qk));
        const off = vecKV(m.e, 'origin').sub(hinge).applyQuaternion(qk).add(hinge);
        const mi = parseInt(m.e.kv.get('model').slice(1), 10);
        const list = [];
        for (const bi of bsp.modelBrushes(mi)) {
          const sd = addBrush(w, bsp, bi, off, { kinematic: true, rot });
          if (!sd) continue;
          w.setSolidEnabled(sd, false);
          list.push(sd);
        }
        states.push(list);
      }
      return { e: m.e, unit: m.e === e ? '' : unitOf(m.e), closed: m.solids, states };
    });
    const closed = members.flatMap((m) => m.solids);
    const open = parts.flatMap((p) => p.states.slice(1).flat());
    rotGroups.push({ e, hinge, q, deg, axis, turns, closed, open, parts, unitOf });
    // as peças do grupo passam a ser movidas por ele (giro + o deslocamento da mãe)
    for (let i = followers.length - 1; i >= 0; i--) if (followers[i].solids.some((s) => closed.includes(s))) followers.splice(i, 1);
  }

  // luzes: as mais fortes viram luzes de verdade (o resto fica no brilho dos painéis)
  const lights = [];
  for (const e of ents) {
    if (e.classname !== 'light' && e.classname !== 'light_spot') continue;
    const [r, g, b, bright] = parseVec(e.kv.get('_light'));
    if (!(bright > 0)) continue;
    lights.push({ p: vecKV(e, 'origin'), color: new THREE.Color(r / 255, g / 255, b / 255), bright, spot: e.classname === 'light_spot' });
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
    const dists = DIRS.map((d) => w.raycast(L.p, d, 20)?.dist ?? 20);
    const room = dists.reduce((a, x) => a + x, 0) / DIRS.length;
    const k = THREE.MathUtils.clamp(room / 7, 0.3, 1);
    // colada numa superfície (spot em cima de um botão, por exemplo) estouraria o material
    const near = THREE.MathUtils.clamp((Math.min(...dists) / 2) ** 2, 0.12, 1);
    // spot: no original só ilumina um cone; aqui (luz pontual) entra com metade da força
    const spot = L.spot ? 0.5 : 1;
    w.light(L.p.x, L.p.y, L.p.z, Math.min(90, Math.max(15, L.bright / 6)) * k * near * spot, L.color, 30, false);
  }

  // início
  const start = ents.find((e) => e.classname === 'info_player_start');
  const sp = start ? vecKV(start, 'origin') : new THREE.Vector3();
  const yaw = start ? yawFromSource(parseVec(start.kv.get('angles'))[1] || 0) : 0;

  // plataformas que no original são só modelo (com colisão própria) e não têm
  // pincel embaixo: viram um bloco de metal do tamanho do casco do modelo
  for (const e of ents) {
    if (!/^prop_dynamic/.test(e.classname) || e.kv.get('solid') === '0') continue;
    const hull = MODEL_HULLS[(e.kv.get('model') ?? '').toLowerCase()];
    if (!hull) continue;
    const root = e.kv.get('parentname') ? movingRoot(e) : null;
    if (e.kv.get('parentname') && !root) continue;
    const o = parseVec(e.kv.get('origin'));
    const yaw = Math.round((parseVec(e.kv.get('angles'))[1] || 0) / 90) & 1;
    const [hx, hy] = yaw ? [hull[1], hull[0]] : [hull[0], hull[1]];
    const a = toV(o[0] - hx, o[1] - hy, o[2] + hull[2]);
    const b = toV(o[0] + hx, o[1] + hy, o[2] + hull[3]);
    const min = a.clone().min(b);
    const max = a.clone().max(b);
    // não duplica se já houver sólido ali (a plataforma tem pincel próprio)
    const c = min.clone().add(max).multiplyScalar(0.5);
    if (!root && w.pointInSolid(c)) continue;
    const box = w.importedBox(min, max, ['metal', 'metal', 'metal', 'metal', 'metal', 'metal'], { kinematic: !!root });
    if (root) followers.push({ solids: [box], root });
  }

  // moldes com um carrinho (func_tracktrain) criados de tempos em tempos (a esteira de
  // plataformas da câmara 15): cópias prontas, escondidas, que o runtime solta a cada
  // ForceSpawn — várias andam ao mesmo tempo, como no original
  const trainPools = new Map();
  for (const tpl of ents) {
    if (tpl.classname !== 'point_template') continue;
    const names = [...tpl.kv].filter(([k]) => /^template\d+$/.test(k)).map(([, v]) => v.toLowerCase());
    const members = names.flatMap((nm) => byName.get(nm) ?? []);
    const train = members.find((e) => e.classname === 'func_tracktrain');
    if (!train) continue;
    // só os criados de tempos em tempos (um logic_timer manda o "maker" do molde criar)
    const tn = (tpl.kv.get('targetname') ?? '').toLowerCase();
    const makers = ents.filter((m) => m.classname === 'env_entity_maker' && (m.kv.get('entitytemplate') ?? '').toLowerCase() === tn).map((m) => (m.kv.get('targetname') ?? '').toLowerCase());
    const timed = ents.some((t) => t.classname === 'logic_timer' && t.outputs.some((o) => makers.includes(o.target.toLowerCase()) && o.input.toLowerCase() === 'forcespawn'));
    if (!timed) continue;
    const tname = (train.kv.get('targetname') ?? '').toLowerCase();
    const pool = [];
    for (let k = 0; k < 6; k++) {
      const solidsOf = (e, kind) => {
        const mi = parseInt((e.kv.get('model') ?? '').slice(1), 10);
        if (!bsp.models[mi]) return [];
        const out = [];
        for (const bi of bsp.modelBrushes(mi)) {
          const sd = addBrush(w, bsp, bi, vecKV(e, 'origin'), { kinematic: true, fallbackKind: kind, rot: e._rot });
          if (sd) out.push(sd);
        }
        return out;
      };
      const trainSolids = solidsOf(train, 'metal');
      const children = [];
      for (const m of members) {
        if (m === train || (m.kv.get('parentname') ?? '').toLowerCase() !== tname) continue;
        if ((m.kv.get('model') ?? '')[0] === '*') children.push(...solidsOf(m, null));
        const hull = MODEL_HULLS[(m.kv.get('model') ?? '').toLowerCase()];
        if (hull) {
          const o = parseVec(m.kv.get('origin'));
          const yaw = Math.round((parseVec(m.kv.get('angles'))[1] || 0) / 90) & 1;
          const [hx, hy] = yaw ? [hull[1], hull[0]] : [hull[0], hull[1]];
          const a = toV(o[0] - hx, o[1] - hy, o[2] + hull[2]);
          const b = toV(o[0] + hx, o[1] + hy, o[2] + hull[3]);
          children.push(w.importedBox(a.clone().min(b), a.clone().max(b), ['metal', 'metal', 'metal', 'metal', 'metal', 'metal'], { kinematic: true }));
        }
      }
      for (const sd of [...trainSolids, ...children]) w.setSolidEnabled(sd, false);
      pool.push({ train, trainSolids, children });
    }
    trainPools.set((tpl.kv.get('targetname') ?? '').toLowerCase(), pool);
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
    // a arma fica onde estava no original; a base do pedestal vai do chão de verdade
    // até ela (ignorando o suporte pequeno do original, que vira só um apoio)
    const big = (b) => b.max.x - b.min.x > 0.9 || b.max.z - b.min.z > 0.9;
    const floor = w.raycast(p.clone(), new THREE.Vector3(0, -1, 0), 6, big);
    const floorY = floor ? floor.point.y : p.y - 1.45;
    const height = THREE.MathUtils.clamp(p.y - floorY, 0.6, 4);
    const pd = w.pedestal(p.x, p.y - height, p.z, gives(e), portalGun(), { height });
    pd.entity = e; // pegar dispara as saídas OnPlayerPickup do mapa
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
    // o modelo daqui olha para +z local (o contrário do jogador): meia-volta a mais.
    // Menores e de pé estreito, como as originais: um cubo jogado as derruba
    turrets.push([p.x, p.y, p.z, yawFromSource(parseVec(e.kv.get('angles'))[1] || 0) + Math.PI, { scale: 0.8, tippy: true }]);
  }

  // bolas de energia
  const launchers = new Map();
  const launcherProps = ents.filter((e) => /^prop_dynamic/.test(e.classname) && (e.kv.get('model') ?? '').includes('combine_ball_launcher'));
  for (const e of ents) {
    if (e.classname !== 'point_energy_ball_launcher') continue;
    const p = vecKV(e, 'origin');
    // a direção vem da carcaça (o modelo do lançador) quando há uma perto: há mapas
    // em que o ângulo do ponto de lançamento aponta para a parede (câmara 15)
    let housing = null;
    for (const cp of launcherProps) {
      const d = vecKV(cp, 'origin').distanceTo(p);
      if (d < 3 && (!housing || d < housing.d)) housing = { e: cp, d };
    }
    const [pt, yw] = parseVec((housing?.e ?? e).kv.get('angles'));
    const n = housing?.e._forward?.clone() ?? forwardOf(pt || 0, yw || 0);
    // no original o ponto de lançamento fica na boca da carcaça, que sai da parede;
    // o soquete daqui vai para a parede atrás dele (a carcaça vira um tubo até a boca)
    const at = p.clone();
    const solidWall = (b) => !b.noRay && [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].filter((d) => d > 0.9).length >= 2;
    const back = w.raycast(p.clone().addScaledVector(n, 0.05), n.clone().negate(), 3, solidWall);
    if (back) at.copy(back.point);
    for (let k = 0; k < 40 && w.pointInSolid(at.clone().addScaledVector(n, 0.05)); k++) {
      if (w.pointInSolid(at.clone().addScaledVector(n, 0.05))?.noRay) break;
      at.addScaledVector(n, 0.05);
    }
    const depth = Math.max(0, p.clone().sub(at).dot(n));
    // como no original: começa lançando sozinho e repõe a bola depois de `ballrespawntime`
    const L = w.launcher(at.x, at.y, at.z, n.toArray(), {
      depth,
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
    const n = best?.e._forward ?? forwardOf(pt || 0, yw || 0);
    // o receptor fica na boca do modelo (não no meio do volume do gatilho, que pode
    // estar dentro da parede); se ainda estiver dentro de um sólido, sai pela frente
    const at = best ? best.q.clone() : c.clone();
    for (let k = 0; k < 40 && w.pointInSolid(at.clone().addScaledVector(n, 0.25)); k++) at.addScaledVector(n, 0.05);
    catchers.set(e, w.catcher(at.x, at.y, at.z, n.toArray(), null));
    for (const b of brushEnts)
      if (b.e.classname === 'func_tracktrain' && b.bounds.min.clone().add(b.bounds.max).multiplyScalar(0.5).distanceTo(at) < 3)
        for (const sd of b.solids) w.setSolidEnabled(sd, false);
  }

  // objetos estáticos (canos, tubos de vidro, corrimãos…): a forma do modelo do
  // original e a colisão do .phy dele (peças convexas invisíveis)
  const propStats = addStaticProps(w, bsp);

  // abaixo de tudo o que existe no mapa não há chão: quem cai ali morre logo
  const floor = Math.min(...w.solids.map((b) => b.min.y));
  return { killY: (Number.isFinite(floor) ? floor : -400) - 15, spawn: [sp.x, sp.y, sp.z, yaw], gun, cubes, turrets, launchers, catchers, byName, brushEnts, followers, rotGroups, trainPools, movingRoot, stats: { solids: count, lights: picked.length, props: propStats } };
}

// ---------------------------------------------------------------- objetos estáticos
// fizzler e trilhos do original já têm o visual daqui
const SKIP_PROP = /portal_cleanser|light_rail_wall_emitter/;
const propGeo = new Map(); // modelo → [{ geo, mat }] (geometria já nas unidades daqui)
const propMats = new Map();

/** material pelo nome da textura do modelo (as texturas em si não são lidas) */
function propMaterial(tex, model, w) {
  // cercas e grades de arame: vazadas (a mesma grade dos pincéis)
  if (/fence|grate|chainlink|mesh/.test(tex + model)) return w.importedMat('grate');
  const k = /glass/.test(tex) ? 'glass' : /clear_tube/.test(model) ? 'tubeframe' : /pipe/.test(tex + model) ? 'pipe' : /rail|fence|metal|grate|lever|light|spot/.test(tex + model) ? 'metal' : /concrete|debris|rock/.test(tex + model) ? 'concrete' : /desk|chair|stool|monitor|speaker/.test(tex + model) ? 'office' : 'default';
  if (propMats.has(k)) return propMats.get(k);
  const P = {
    glass: { color: 0xc8ecff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, emissive: 0x16303c },
    tubeframe: { color: 0xd5dade, metalness: 0.65, roughness: 0.32 },
    pipe: { color: 0x737a80, metalness: 0.7, roughness: 0.45 },
    metal: { color: 0x8a9096, metalness: 0.75, roughness: 0.4 },
    concrete: { color: 0x8e8b85, metalness: 0, roughness: 0.92 },
    office: { color: 0xb9bcbf, metalness: 0.25, roughness: 0.55 },
    default: { color: 0x9da2a7, metalness: 0.35, roughness: 0.55 },
  }[k];
  const m = new THREE.MeshStandardMaterial(P);
  propMats.set(k, m);
  return m;
}

function propParts(name, model, w) {
  if (propGeo.has(name)) return propGeo.get(name);
  const parts = model.groups.map((g) => {
    const n = g.positions.length / 3;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(g.uvs);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
      pos.set([x * S, z * S, -y * S], i * 3);
      const [a, b, c] = [g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]];
      nor.set([a, c, -b], i * 3);
    }
    // o Source desenha a frente no sentido horário; aqui é o anti-horário
    const idx = new Uint32Array(g.indices.length);
    for (let t = 0; t < g.indices.length; t += 3) idx.set([g.indices[t], g.indices[t + 2], g.indices[t + 1]], t);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return { geo, mat: propMaterial(g.material, name, w) };
  });
  propGeo.set(name, parts);
  return parts;
}

function addStaticProps(w, bsp) {
  let shown = 0;
  let hulls = 0;
  // tudo o que tem o mesmo material vira uma malha só (centenas de objetos → poucas
  // chamadas de desenho, também na vista de cada portal)
  const batches = new Map();
  for (const p of bsp.staticProps ?? []) {
    if (SKIP_PROP.test(p.model)) continue;
    const model = bsp.propModels?.get(p.model);
    if (!model) continue;
    const seeThrough = /fence|grate|chainlink/.test(p.model);
    const { f, u } = frameOf(p.angles[0], p.angles[1], p.angles[2]);
    const left = new THREE.Vector3().crossVectors(u, f);
    // eixos locais daqui: x = frente do Source, y = cima, z = −esquerda
    const M = new THREE.Matrix4().makeBasis(f, u, left.clone().negate()).setPosition(toV(...p.origin));
    for (const { geo, mat } of propParts(p.model, model, w)) {
      if (!batches.has(mat)) batches.set(mat, []);
      batches.get(mat).push(geo.clone().applyMatrix4(M));
    }
    shown++;
    if (!p.solid) continue;
    for (const hull of model.hulls) {
      const pts = hull.map(([x, y, z]) => new THREE.Vector3(x * S, z * S, -y * S).applyMatrix4(M));
      let ch;
      try {
        ch = new ConvexHull().setFromPoints(pts);
      } catch {
        continue;
      }
      const planes = [];
      for (const face of ch.faces) {
        if (face.mark !== 0) continue;
        const n = face.normal.clone();
        if (planes.some((q) => q.n.dot(n) > 0.9999 && Math.abs(q.d - face.constant) < 1e-4)) continue;
        planes.push({ n, d: face.constant, kind: null });
      }
      if (planes.length < 4) continue;
      const verts = ch.vertices.map((v) => v.point.clone());
      const s = w.convex(verts, planes, { solid: true, noRay: false });
      if (s) {
        s.prop = true;
        if (seeThrough) s.seeThrough = s.noRay = true; // cerca: a torreta enxerga e o tiro passa
        hulls++;
      }
    }
  }
  for (const [mat, geos] of batches) {
    // em lotes de até ~1 milhão de vértices (índices de 32 bits dão conta)
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    if (mat.transparent) mesh.renderOrder = 5;
    w.group.add(mesh);
  }
  return { shown, hulls, batches: batches.size };
}

// ---------------------------------------------------------------- malhas do mapa fixo
/** trecho [start, start+count) de uma geometria (por grupo de material), sem índice */
function geometryRange(g, start, count) {
  const out = new THREE.BufferGeometry();
  const idx = g.index;
  for (const [name, attr] of Object.entries(g.attributes)) {
    const n = attr.itemSize;
    const arr = new Float32Array(count * n);
    for (let i = 0; i < count; i++) {
      const v = idx ? idx.getX(start + i) : start + i;
      for (let k = 0; k < n; k++) arr[i * n + k] = attr.array[v * n + k];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return out;
}

/**
 * Junta as faces visíveis dos pincéis fixos por material: as malhas de cada pincel
 * ficam escondidas (os sólidos continuam para colisão, tiros e portais).
 */
function mergeStatic(w, solids) {
  const buckets = new Map();
  for (const s of solids) {
    const m = s.mesh;
    if (!m || !m.visible || s.disabled || s.kbody) continue;
    m.updateMatrixWorld(true);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const g = m.geometry;
    const total = g.index ? g.index.count : g.attributes.position.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat || mat.visible === false || !gr.count) continue;
      const part = geometryRange(g, gr.start, gr.count).applyMatrix4(m.matrixWorld);
      const key = `${mat.uuid}|${m.renderOrder}|${Object.keys(part.attributes).sort().join(',')}`;
      if (!buckets.has(key)) buckets.set(key, { mat, order: m.renderOrder, geos: [] });
      buckets.get(key).geos.push(part);
    }
    m.visible = false;
    m.userData.merged = true;
  }
  for (const { mat, order, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = order;
    w.group.add(mesh);
  }
}
