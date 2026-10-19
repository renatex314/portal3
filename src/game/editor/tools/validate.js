// Verificações do nível (lint): problemas que o jogador só descobriria jogando.
// Cada aviso: { level:'erro'|'aviso'|'ok', text, ids:[ids dos itens] }.

import * as THREE from 'three';
import { tl, num } from '../../i18n.js';
import { ELEMENTS, minmax, obbOf } from '../elements.js';
import { FACE_DIRS, cellKey, parseKey, OPP, DEFAULT_PAINT } from '../chamber.js';

const PLAYER_HALF = new THREE.Vector3(0.3, 0.9, 0.3);
const SIG_KEYS = ['sig', 'opens', 'id', 'power'];

const sigsOf = (it) => {
  const T = ELEMENTS[it.type];
  const out = [];
  for (const f of T.params ?? []) if (f.t === 'sig' && typeof it[f.k] === 'string' && it[f.k]) out.push([f.k, it[f.k]]);
  return out;
};

/** env = { world, portals } (o mundo já reconstruído a partir de `doc`) */
export function validate(doc, env) {
  const { world, portals } = env;
  const out = [];
  const items = doc.items;
  const of = (type) => items.filter((i) => i.type === type);
  const err = (text, ids = []) => out.push({ level: 'erro', text, ids });
  const warn = (text, ids = []) => out.push({ level: 'aviso', text, ids });

  const open = new Set(doc.chamber.open);
  if (!open.size && !items.some((i) => ['block', 'ramp'].includes(i.type))) err('A câmara está vazia: abra células na aba Câmara.');
  const spawns = of('spawn');
  const exits = of('exit');
  if (!spawns.length) err('Falta o ponto de partida.');
  if (!exits.length) err('Falta o elevador de saída: ninguém consegue completar o nível.');

  // partida dentro de sólido ou sem chão
  for (const s of spawns) {
    const c = new THREE.Vector3(s.p[0], s.p[1] + PLAYER_HALF.y + 0.05, s.p[2]);
    const inside = world.pointInSolid(c) || world.pointInSolid(c.clone().add(new THREE.Vector3(0, PLAYER_HALF.y - 0.1, 0)));
    if (inside) err('O ponto de partida está dentro de um bloco.', [s.id]);
    const down = world.raycast(new THREE.Vector3(s.p[0], s.p[1] + 0.5, s.p[2]), new THREE.Vector3(0, -1, 0), 60);
    if (!down) warn('Sob o ponto de partida não há chão: o jogador cai no vazio.', [s.id]);
    else if (down.box.isHazard) err('O ponto de partida está sobre rocha fundida.', [s.id]);
    else if (s.p[1] - down.point.y > 1.5) warn(tl('O ponto de partida fica {h} m acima do chão: o jogador começa caindo.', { h: num(s.p[1] - down.point.y) }), [s.id]);
  }
  // elevador de saída sobre chão
  for (const e of exits) {
    const down = world.raycast(new THREE.Vector3(e.p[0], e.p[1] + 0.5, e.p[2]), new THREE.Vector3(0, -1, 0), 8);
    if (!down) warn('O elevador de saída está sem chão embaixo.', [e.id]);
  }

  // sinais: cada porta precisa de quem a abra, e cada botão precisa de algo para abrir
  const sources = new Map();
  const sinks = new Map();
  for (const it of items)
    for (const [k, v] of sigsOf(it)) {
      const m = k === 'opens' ? sources : sinks;
      m.set(v, [...(m.get(v) ?? []), it]);
    }
  for (const it of items) {
    const T = ELEMENTS[it.type];
    if (['door', 'platform'].includes(it.type)) {
      if (!it.sig) {
        if (it.type === 'door') warn('Porta sem sinal: ela nunca abre.', [it.id]);
      } else if (!sources.has(it.sig) && !(it.type === 'platform' && it.always)) warn(tl('A porta/plataforma do sinal “{s}” não tem botão nem receptor que a ligue.', { s: it.sig }), [it.id]);
    }
    if (['button', 'catcher', 'laserCatcher', 'incinerator'].includes(it.type)) {
      if (!it.opens) warn(tl('{label} sem sinal: não liga nada.', { label: tl(T.label) }), [it.id]);
      else if (!sinks.has(it.opens)) warn(tl('{label} liga o sinal “{s}”, mas nenhuma porta/plataforma/funil usa esse sinal.', { label: tl(T.label), s: it.opens }), [it.id]);
    }
  }
  // laser: receptor sem emissor, ou emissor sem nada para acertar
  const lasers = items.filter((i) => i.type === 'laser');
  for (const it of items.filter((i) => i.type === 'laserCatcher')) if (!lasers.length) warn('Receptor de laser sem nenhum emissor de laser no nível.', [it.id]);
  if (lasers.length && !items.some((i) => i.type === 'laserCatcher')) out.push({ level: 'aviso', text: 'Há emissor de laser, mas nenhum receptor: o feixe não liga nada.', ids: lasers.map((i) => i.id) });
  // sinal "ligado por vários": a porta só abre com TODOS ativos
  for (const [name, list] of sources) if (list.length > 1 && sinks.has(name)) out.push({ level: 'aviso', text: tl('O sinal “{s}” tem {n} ligadores: a porta só abre com todos ativos ao mesmo tempo.', { s: name, n: list.length }), ids: list.map((i) => i.id) });

  // peças de chão dentro da parede (fora da câmara)
  for (const it of items) {
    if (!['button', 'cube', 'turret', 'crystal', 'pedestal', 'plate', 'dino', 'exit', 'spawn'].includes(it.type)) continue;
    const c = new THREE.Vector3(it.p[0], it.p[1] + 0.4, it.p[2]);
    if (world.pointInSolid(c)) warn(tl('{label} está dentro de uma parede ou bloco (fora da câmara?).', { label: tl(ELEMENTS[it.type].label) }), [it.id]);
  }

  // coisas enterradas em blocos
  const blocks = items.filter((i) => ['block', 'ramp'].includes(i.type));
  for (const it of items) {
    const T = ELEMENTS[it.type];
    if (!['button', 'cube', 'turret', 'crystal', 'pedestal', 'plate', 'dispenser'].includes(it.type)) continue;
    const c = obbOf(it).c;
    for (const b of blocks) {
      if (b.mat === 'glass' && b.type === 'block') continue;
      const [x0, y0, z0, x1, y1, z1] = minmax(b);
      if (c.x > x0 + 0.05 && c.x < x1 - 0.05 && c.y > y0 + 0.05 && c.y < y1 - 0.05 && c.z > z0 + 0.05 && c.z < z1 - 0.05) {
        warn(tl('{label} está dentro de um bloco.', { label: tl(T.label) }), [it.id, b.id]);
        break;
      }
    }
  }

  // portais: precisa de arma, de superfície que aceita e de portais fixos que assentam
  const canShoot = doc.cfg.gun !== 'none' || of('pedestal').length > 0;
  let chamberWhite = false;
  for (const s of open) {
    const [i, j, k] = parseKey(s);
    FACE_DIRS.forEach(([dx, dy, dz], f) => {
      if (!open.has(cellKey(i + dx, j + dy, k + dz)) && (doc.chamber.paint[`${s},${f}`] ?? DEFAULT_PAINT) === 'white') chamberWhite = true;
    });
  }
  const hasWhite = chamberWhite || items.some((i) => i.type === 'block' && i.mat === 'white' && i.portal) || of('panel').length > 0 || items.some((i) => i.type === 'ramp' && i.mat === 'white');
  if (canShoot && !hasWhite) warn('Há arma de portais mas nenhuma superfície aceita portal: use concreto claro (bloco “Aceita portal”) ou um painel diagonal.');
  const fixed = of('portal');
  const placed = [portals.blue, portals.orange].filter((p) => p.placed && p.fixed).length;
  if (fixed.length && placed < Math.min(2, fixed.length)) warn('Algum portal fixo não achou parede atrás dele (ele precisa encostar numa superfície).', fixed.map((i) => i.id));
  if (fixed.filter((p) => p.which === 'blue').length > 1 || fixed.filter((p) => p.which === 'orange').length > 1) warn('Só cabe um portal fixo de cada cor: os extras são ignorados.', fixed.map((i) => i.id));
  if (fixed.length === 1) warn('Portal fixo sozinho não leva a lugar nenhum: ponha o par.', [fixed[0].id]);

  // placas de lançamento sem pouso / luz
  if (!of('light').length && !(doc.cfg.autoLight !== false && open.size)) warn('O nível não tem nenhuma luz: ele fica escuro no jogo (o editor tem luz própria).');
  for (const p of of('plate')) if (p.mode === 'alvo' && Math.hypot(p.target[0] - p.p[0], p.target[2] - p.p[2]) < 0.5 && Math.abs(p.target[1] - p.p[1]) < 0.5) warn('A placa de lançamento aponta para o próprio lugar.', [p.id]);
  for (const t of of('turret')) if (!doc.cfg.gun || doc.cfg.gun === 'none') warn('Há torreta mas o jogador não tem arma de portais: cuidado com o equilíbrio.', [t.id]);
  if (doc.cfg.relogio && !items.some((i) => i.type === 'button' || i.type === 'door')) out.push({ level: 'aviso', text: 'O relógio do tempo está ligado mas o nível não tem botões nem portas para o passado ajudar.', ids: [] });

  if (!out.length) out.push({ level: 'ok', text: 'Nada de errado encontrado. (Confira também o alcance e jogue: nenhuma verificação substitui o teste.)', ids: [] });
  return out;
}
