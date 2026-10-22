// Exporta as fases do jogo web (src/game/levels.js) para JSON, para a versão nativa.
//
// Cada fase do jogo web é uma função `build(w)` que chama a API do mundo (w.box, w.door, ...).
// Aqui `w` é um gravador: cada chamada vira { call, args, id } e o valor devolvido é uma
// referência ({ ref: id }) que pode ser usada em chamadas seguintes. O que `build` devolve
// (spawn, cubos, falas, ...) vai junto; funções viram { fn: "nome" } e são portadas à mão.
//
// Uso: node nativo/tools/export-levels.mjs  →  nativo/assets/levels/levels.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// as fases que montam modelos próprios desenham texturas num <canvas>: um falso basta (só o desenho se perde)
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : noop), apply: () => noop });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => noop, toDataURL: () => '' }),
};
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { LEVELS } = await import(resolve(root, 'src/game/levels.js'));

const isRef = Symbol('ref');

function encode(v, path, fns) {
  if (v === null || v === undefined) return v ?? null;
  if (v[isRef]) return { ref: v[isRef] };
  if (typeof v === 'function') {
    fns.push(path);
    return { fn: path };
  }
  if (typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? { num: String(v) } : v;
  if (v[isRef]) return { ref: v[isRef] };
  if (v.isVector3) return { v3: [v.x, v.y, v.z] };
  if (v.isObject3D || v.isMaterial || v.isBufferGeometry || v.isTexture) return { three: v.type, name: v.name || undefined };
  if (v.isColor) return { color: v.getHex() };
  if (Array.isArray(v)) return v.map((x, i) => encode(x, `${path}[${i}]`, fns));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = encode(x, `${path}.${k}`, fns);
  return out;
}

function recorder() {
  const calls = [];
  const fns = [];
  let seq = 0;
  // valor devolvido por uma chamada: guarda acessos e chamadas aninhadas (d.box.min etc.)
  const handle = (id, known = {}) =>
    new Proxy(function () {}, {
      get(_, prop) {
        if (prop === isRef) return id;
        if (prop in known) return known[prop];
        if (prop === Symbol.toPrimitive) return () => 0;
        if (prop === 'then') return undefined;
        return handle(`${id}.${String(prop)}`);
      },
      set(_, prop, value) {
        calls.push({ set: `${id}.${String(prop)}`, value: encode(value, `${id}.${String(prop)}`, fns) });
        return true;
      },
      apply(_, __, args) {
        const nid = `#${++seq}`;
        calls.push({ call: id, args: encode(args, nid, fns), id: nid });
        return handle(nid);
      },
    });
  // listas que as fases leem depois de montar (ex.: w.doors.forEach(d => d.speedBack = 16))
  const lists = { doors: [], buttons: [], lasers: [], fizzlers: [], launchers: [], catchers: [], pushButtons: [], triggers: [], solids: [] };
  const into = { door: 'doors', platform: 'doors', mover: 'doors', button: 'buttons', laser: 'lasers', lightBridge: 'lasers', fizzler: 'fizzlers', launcher: 'launchers', catcher: 'catchers', pushButton: 'pushButtons', trigger: 'triggers', box: 'solids' };
  const w = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') return undefined;
        if (prop in lists) return lists[prop];
        // modelos e animações próprios da fase (o chefe): só visuais, exportados à parte como modelos
        if (prop === 'group') return { add() {}, remove() {} };
        if (prop === 'anim') return { push() {} };
        return (...args) => {
          const id = `#${++seq}`;
          calls.push({ call: String(prop), args: encode(args, id, fns), id });
          // valores que as fases usam direto (desestruturam): o dispensador devolve onde a amostra nasce
          if (prop === 'dispenser') return [args[0], args[1] - 1.6, args[2]];
          const h = handle(id, prop === 'door' || prop === 'platform' || prop === 'mover' ? { id: args[0] } : {});
          if (into[prop]) lists[into[prop]].push(h);
          return h;
        };
      },
    },
  );
  return { w, calls, fns };
}

const out = [];
const allFns = [];
for (const L of LEVELS) {
  const { w, calls, fns } = recorder();
  let data = null;
  let error = null;
  try {
    data = L.build(w);
  } catch (e) {
    error = String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ');
  }
  const meta = {};
  for (const [k, v] of Object.entries(L)) if (k !== 'build') meta[k] = encode(v, `${L.id}.${k}`, fns);
  out.push({ ...meta, calls, data: encode(data, `${L.id}.data`, fns), error });
  if (fns.length || error) allFns.push({ id: L.id, name: L.name, series: L.series, fns, error });
}

const file = resolve(root, 'nativo/assets/levels/levels.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out));
console.log(`${out.length} fases → ${file}`);
const methods = new Map();
for (const L of out) for (const c of L.calls) if (c.call && !c.call.startsWith('#')) methods.set(c.call, (methods.get(c.call) ?? 0) + 1);
console.log('API do mundo usada:', [...methods].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' '));
console.log('\nFases com funções ou erro:');
for (const f of allFns) console.log(`- [${f.series ?? 'lab'}] ${f.id} ${f.name}: ${f.fns.join(', ')}${f.error ? ' ERRO ' + f.error : ''}`);
