// Documento de um nível do editor (JSON puro) e o compilador que o transforma
// numa fase igual às de levels.js: { id, name, series, build(w) → data }.
//
//   doc = { v, id, name, cfg:{ who, lesson, music, gun, relogio, gravity }, items:[ item… ] }
//   item = { id, type, p:[x,y,z], s:[sx,sy,sz]?, r:[rx,ry,rz]? (graus), …parâmetros do tipo }
//
// Os tipos (elements.js) só chamam a API do World: o jogo roda o nível sem tratamento especial.

import { ELEMENTS, PUSH_TYPES } from './elements.js';
import { buildChamber, autoLights, newChamber } from './chamber.js';
import { tl } from '../i18n.js';

export const DOC_V = 1;

let seq = 0;
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function newDoc(name = tl('Novo nível')) {
  const doc = {
    v: DOC_V,
    id: uid(),
    name,
    cfg: { who: tl('Você'), lesson: tl('Chegue ao elevador de saída.'), music: 'lab', gun: 'both', relogio: false, gravity: 9.8, autoLight: true },
    chamber: newChamber(),
    items: [],
  };
  // câmara inicial: duas células, o ponto de partida numa e o elevador de saída na outra
  add(doc, 'spawn', { p: [0, 0, 0], yaw: 0 });
  add(doc, 'exit', { p: [0, 0, -4] });
  return doc;
}

function normChamber(c) {
  const ok = (s) => typeof s === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(s);
  if (!c || !Array.isArray(c.open)) return { open: [], paint: {} };
  const open = [...new Set(c.open.filter(ok))];
  const paint = {};
  for (const [k, v] of Object.entries(c.paint ?? {})) if (/^-?\d+,-?\d+,-?\d+,[0-5]$/.test(k) && ['white', 'metal', 'glass'].includes(v)) paint[k] = v;
  return { open, paint };
}

/** cria o item com os padrões do tipo e o põe no documento */
export function add(doc, type, over = {}) {
  const T = ELEMENTS[type];
  const it = { id: uid(), type, p: [0, 0, 0], ...(T.size ? { s: [...T.size] } : {}), ...(T.rot === 'euler' ? { r: [0, 0, 0] } : {}) };
  for (const f of T.params ?? []) it[f.k] = structuredCloneSafe(f.d);
  Object.assign(it, over);
  doc.items.push(it);
  return it;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
function structuredCloneSafe(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

/** confere e completa um documento vindo de fora (importado ou de versão antiga) */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) throw new Error('arquivo não é um nível do editor');
  const doc = {
    v: DOC_V,
    id: typeof raw.id === 'string' ? raw.id : uid(),
    name: String(raw.name ?? tl('Nível importado')).slice(0, 60),
    cfg: { who: 'Você', lesson: '', music: 'lab', gun: 'both', relogio: false, gravity: 9.8, autoLight: true, ...(raw.cfg ?? {}) },
    chamber: normChamber(raw.chamber),
    items: [],
  };
  const num3 = (a) => Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(n));
  for (const r of raw.items) {
    const T = ELEMENTS[r?.type];
    if (!T || !num3(r.p)) continue; // tipo que esta versão não conhece: ignora
    const it = { ...r, id: typeof r.id === 'string' ? r.id : uid() };
    if (T.size && !num3(it.s)) it.s = [...T.size];
    if (T.rot === 'euler' && !num3(it.r)) it.r = [0, 0, 0];
    for (const f of T.params ?? []) if (it[f.k] === undefined) it[f.k] = structuredCloneSafe(f.d);
    doc.items.push(it);
  }
  if (raw.recording) doc.recording = raw.recording;
  return doc;
}

/** fase para o jogo. `index` só rotula (U01…). */
export function compile(doc, index = 0) {
  return {
    id: `mine-${doc.id}`,
    n: index,
    series: 'mine',
    code: `U${String(index + 1).padStart(2, '0')}`,
    name: doc.name,
    who: doc.cfg.who || 'Você',
    lesson: doc.cfg.lesson || '',
    music: doc.cfg.music || 'lab',
    heat: false,
    mine: doc.id,
    build(w) {
      const data = {
        spawn: [0, 0, 0, 0],
        cubes: [],
        turrets: [],
        portals: [],
        crystals: [],
        dinos: [],
        booths: [],
        gun: doc.cfg.gun,
        relogio: !!doc.cfg.relogio,
        intro: [],
      };
      const ctx = { data, w, doc };
      buildChamber(w, doc.chamber);
      if (doc.cfg.autoLight !== false) autoLights(w, doc.chamber);
      let spawned = false;
      // botões de apertar: o item ligado pode reagir do seu jeito (pmode/ptime) em vez do modo do botão
      const pushSigs = new Set(doc.items.filter((i) => PUSH_TYPES.has(i.type) && i.opens).map((i) => i.opens));
      for (const it of doc.items) {
        const T = ELEMENTS[it.type];
        if (!T) continue;
        let bi = it;
        for (const f of T.params ?? []) {
          if (f.t !== 'sig' || f.k === 'opens' || !pushSigs.has(it[f.k])) continue;
          if (it.pmode) bi = { ...bi, [f.k]: w.pushSig(it[f.k], it.pmode, it.ptime ?? 4) };
          else w.pushUsed?.add(it[f.k]);
        }
        T.build(w, bi, ctx);
        if (it.type === 'spawn') spawned = true;
      }
      if (!spawned) data.spawn = [0, 0, 0, 0];
      const g = Number(doc.cfg.gravity);
      if (Number.isFinite(g) && Math.abs(g - 9.8) > 1e-6) data.gravityAt = (p, out) => out.set(0, -g, 0);
      return data;
    },
  };
}
