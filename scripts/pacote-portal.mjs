// Gera o pacote da campanha original a partir da SUA instalação do Portal:
//
//   npm run pacote                                   (pasta padrão do CrossOver)
//   npm run pacote -- "/caminho/para/steamapps/common/Portal" [saida.zip]
//   PORTAL_DIR="/caminho/…/Portal" npm run pacote
//
// O .zip fica no seu computador (está no .gitignore): no jogo publicado, você o
// escolhe em "Campanha original" e ele é lido só no seu navegador. Não publique
// esse arquivo — o conteúdo é da Valve.
//
// Vai no pacote só o que a campanha usa: os 18 mapas (sem iluminação, visibilidade
// e texturas embutidas, que o jogo daqui não lê), as falas e sons tocados por eles,
// as cenas, os scripts de som e as legendas (português do Brasil e inglês).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseBSP } from '../src/game/campaign/bsp.js';
import { parseKV, kvGet } from '../src/game/campaign/kv.js';
import { parseScenesImage, findScene, loadSoundScripts, cleanWave } from '../src/game/campaign/scenes.js';
import { MAPS } from '../src/game/campaign/maps.js';
import { animatedModels } from '../src/game/campaign/mdl.js';
import { parseStaticProps } from '../src/game/campaign/staticprops.js';
import { parseAnimatedModel } from '../src/game/campaign/mdlmodel.js';
import { parseVMT, texPath } from '../src/game/campaign/textures.js';

const DEFAULT_DIR = '/Volumes/SSD/crossover/bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Portal';
const ROOT = path.resolve(process.argv[2] || process.env.PORTAL_DIR || DEFAULT_DIR);
const OUT = path.resolve(process.argv[3] || 'portal-campanha.zip');

/** arquivo da instalação sem diferenciar maiúsculas (os nomes vêm do Windows) */
function findFile(rel) {
  let at = ROOT;
  for (const seg of rel.split('/')) {
    if (!fs.existsSync(at)) return null;
    const hit = fs.readdirSync(at).find((n) => n.toLowerCase() === seg.toLowerCase());
    if (!hit) return null;
    at = path.join(at, hit);
  }
  return fs.statSync(at).isFile() ? at : null;
}

if (!findFile('portal/gameinfo.txt')) {
  console.error(`Não achei o Portal em:\n  ${ROOT}\nPasse a pasta "Portal" (a que tem "portal" e "hl2" dentro):\n  npm run pacote -- "/caminho/para/steamapps/common/Portal"`);
  process.exit(1);
}

// ------------------------------------------------------------------ VPK
function openVPK(base) {
  const dirFile = findFile(`${base}_dir.vpk`);
  const d = fs.readFileSync(dirFile);
  const version = d.readUInt32LE(4);
  const header = version === 1 ? 12 : 28;
  const dataStart = header + d.readUInt32LE(8);
  const entries = new Map();
  let pos = header;
  const str = () => {
    let e = pos;
    while (d[e]) e++;
    const s = d.toString('latin1', pos, e);
    pos = e + 1;
    return s;
  };
  for (;;) {
    const ext = str();
    if (!ext) break;
    for (;;) {
      const dir = str();
      if (!dir) break;
      for (;;) {
        const name = str();
        if (!name) break;
        const preload = d.readUInt16LE(pos + 4);
        const e = { archive: d.readUInt16LE(pos + 6), offset: d.readUInt32LE(pos + 8), length: d.readUInt32LE(pos + 12), preloadAt: pos + 18, preload };
        pos += 18 + preload;
        entries.set(`${dir === ' ' ? '' : dir + '/'}${name}${ext === ' ' ? '' : '.' + ext}`.toLowerCase(), e);
      }
    }
  }
  const fds = new Map();
  const key = (p) => p.toLowerCase().replace(/\\/g, '/');
  return {
    has: (p) => entries.has(key(p)),
    read(p) {
      const e = entries.get(key(p));
      if (!e) return null;
      const out = Buffer.alloc(e.preload + e.length);
      d.copy(out, 0, e.preloadAt, e.preloadAt + e.preload);
      if (e.length) {
        if (e.archive === 0x7fff) d.copy(out, e.preload, dataStart + e.offset, dataStart + e.offset + e.length);
        else {
          if (!fds.has(e.archive)) fds.set(e.archive, fs.openSync(findFile(`${base}_${String(e.archive).padStart(3, '0')}.vpk`), 'r'));
          fs.readSync(fds.get(e.archive), out, e.preload, e.length, e.offset);
        }
      }
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    },
  };
}

// ------------------------------------------------------------------ BSP
// lumps lidos por src/game/campaign/bsp.js (e o 35, dos objetos estáticos); o resto vira vazio
const KEEP = new Set([0, 1, 2, 5, 6, 10, 14, 17, 18, 19, 35, 43, 44]);
function trimBSP(src) {
  const parts = [];
  const head = Buffer.alloc(1036);
  src.copy(head, 0, 0, 8); // "VBSP" + versão
  head.writeInt32LE(src.readInt32LE(1032), 1032); // revisão do mapa
  let at = head.length;
  for (let i = 0; i < 64; i++) {
    const h = 8 + i * 16;
    const ofs = src.readInt32LE(h);
    const len = src.readInt32LE(h + 4);
    head.writeInt32LE(src.readInt32LE(h + 8), h + 8); // versão do lump
    if (!KEEP.has(i) || !len) continue;
    const pad = (4 - (at % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    at += pad;
    let data = src.subarray(ofs, ofs + len);
    if (i === 35) {
      // "game lump": as entradas apontam para posições absolutas no arquivo
      data = Buffer.from(data);
      const n = data.readInt32LE(0);
      for (let k = 0; k < n; k++) data.writeInt32LE(data.readInt32LE(4 + k * 16 + 8) - ofs + at, 4 + k * 16 + 8);
    }
    parts.push(data);
    head.writeInt32LE(at, h);
    head.writeInt32LE(len, h + 4);
    at += len;
  }
  return Buffer.concat([head, ...parts]);
}

// ------------------------------------------------------------------ zip
const CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
const crc32 = zlib.crc32 ?? ((buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
});

function writeZip(file, items) {
  const fd = fs.openSync(file, 'w');
  const central = [];
  let ofs = 0;
  for (const { name, data } of items) {
    const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const deflate = packed.length < raw.length * 0.95;
    const body = deflate ? packed : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    fs.writeSync(fd, local);
    fs.writeSync(fd, nameBuf);
    fs.writeSync(fd, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(ofs, 42);
    central.push(c, nameBuf);
    ofs += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(ofs, 16);
  fs.writeSync(fd, cd);
  fs.writeSync(fd, end);
  fs.closeSync(fd);
  return ofs + cd.length + 22;
}

// ------------------------------------------------------------------ monta
console.log(`Portal em: ${ROOT}`);
const pak = openVPK('portal/portal_pak');
const hl2 = findFile('hl2/hl2_misc_dir.vpk') ? openVPK('hl2/hl2_misc') : null;
const propModels = new Set(); // objetos estáticos (canos, tubos…) dos mapas
const entModels = new Set(); // modelos desenhados de verdade (a sala da GLaDOS)
const REAL_MODEL = /models\/(props_bts\/glados_|gladdysdestruction\/)/;
const items = [];
const add = (name, data) => items.push({ name, data });

// mapas: o que eles tocam (cenas e sons soltos) e a versão enxuta do arquivo
const sceneFiles = new Set();
const models = new Set(); // .mdl com animações que a lógica do mapa espera terminar
const soundNames = new Set(['portal.rocket_fire', 'portal.rocket_explode']);
for (const [map] of MAPS) {
  const f = findFile(`portal/maps/${map}.bsp`);
  if (!f) {
    console.error(`  falta o mapa ${map}.bsp — a instalação está completa?`);
    process.exit(1);
  }
  const src = fs.readFileSync(f);
  const small = trimBSP(src);
  const bsp = parseBSP(small.buffer.slice(small.byteOffset, small.byteOffset + small.byteLength)); // confere que lê
  for (const e of bsp.entities) {
    if (e.classname === 'logic_choreographed_scene' && e.kv.get('scenefile')) sceneFiles.add(e.kv.get('scenefile'));
    if (e.classname === 'ambient_generic' && e.kv.get('message')) soundNames.add(e.kv.get('message').toLowerCase());
  }
  for (const m of animatedModels(bsp.entities)) models.add(m);
  for (const p of parseStaticProps(small.buffer.slice(small.byteOffset, small.byteOffset + small.byteLength))) propModels.add(p.model);
  for (const e of bsp.entities) {
    const m = (e.kv.get('model') ?? '').toLowerCase().replace(/\\/g, '/');
    if (/^prop_(dynamic|dynamic_override|physics|glados_core)/.test(e.classname) && REAL_MODEL.test(m)) entModels.add(m);
  }
  add(`portal/maps/${map}.bsp`, small);
  console.log(`  ${map.padEnd(14)} ${(src.length / 1e6).toFixed(1).padStart(5)} MB → ${(small.length / 1e6).toFixed(1).padStart(4)} MB`);
}

// scripts de som e cenas
const { sounds, scriptFiles } = await loadSoundScripts(pak, parseKV, kvGet);
add('pak/scripts/game_sounds_manifest.txt', pak.read('scripts/game_sounds_manifest.txt'));
for (const f of scriptFiles) add(`pak/${f.toLowerCase()}`, pak.read(f));
const sceneImage = pak.read('scenes/scenes.image');
add('pak/scenes/scenes.image', sceneImage);
const scenes = parseScenesImage(sceneImage);
let scenesFound = 0;
for (const f of sceneFiles) {
  const s = findScene(scenes, f);
  if (!s) continue;
  scenesFound++;
  for (const n of s.sounds) soundNames.add(n.toLowerCase());
}
// falas dos núcleos da luta final (tocadas em sequência pelo jogo)
for (const k of sounds.keys()) if (k.startsWith('portal.glados_core.')) soundNames.add(k);

// arquivos de som de cada nome (script de som ou caminho direto de .wav)
const waves = new Set();
for (const n of soundNames) {
  const list = sounds.get(n) ?? (/\.(wav|mp3)$/i.test(n) ? [cleanWave(n)] : []);
  for (const w of list) waves.add(w.toLowerCase());
}
waves.add('sound/music/portal_still_alive.mp3'); // música dos créditos
let missing = 0;
for (const w of [...waves].sort()) {
  const bytes = pak.read(w);
  if (bytes) add(`pak/${w}`, bytes);
  else missing++; // sons do Half-Life 2 (hl2/*.vpk): o jogo segue sem eles
}

for (const m of models) if (pak.has(m)) add(`pak/${m}`, pak.read(m));

// modelos dos objetos estáticos: forma (.mdl/.vvd/.dx90.vtx) e colisão (.phy); os do
// Half-Life 2 (props_c17, props_pipes…) vêm do pacote dele e ficam junto, em pak/
let propFiles = 0;
for (const m of propModels) {
  if (models.has(m)) continue;
  for (const ext of ['.mdl', '.vvd', '.dx90.vtx', '.phy']) {
    const p = m.replace(/\.mdl$/, ext);
    const bytes = pak.has(p) ? pak.read(p) : hl2?.has(p) ? hl2.read(p) : null;
    if (bytes) {
      add(`pak/${p}`, bytes);
      propFiles++;
    }
  }
}
console.log(`  ${propModels.size} modelos de objetos estáticos (${propFiles} arquivos)`);

// modelos de entidade com animação (.ani) e os materiais/texturas deles
const readAny = (p) => (pak.has(p) ? pak.read(p) : hl2?.has(p) ? hl2.read(p) : null);
const added = new Set(items.map((i) => i.name));
const addPak = (p) => {
  if (added.has(`pak/${p}`)) return true;
  const b = readAny(p);
  if (!b) return false;
  add(`pak/${p}`, b);
  added.add(`pak/${p}`);
  return true;
};
let texFiles = 0;
for (const m of entModels) {
  const base = m.replace(/\.mdl$/, '');
  for (const ext of ['.mdl', '.vvd', '.dx90.vtx', '.ani', '.phy']) addPak(base + ext);
  const [mdl, vvd, vtx, ani] = ['.mdl', '.vvd', '.dx90.vtx', '.ani'].map((x) => readAny(base + x));
  const M = mdl && vvd && vtx ? parseAnimatedModel(mdl, vvd, vtx, ani) : null;
  if (!M) continue;
  for (const t of M.textures)
    for (const dir of M.dirs.length ? M.dirs : ['']) {
      const vmtPath = `materials/${dir}${t}.vmt`;
      const vb = readAny(vmtPath);
      if (!vb) continue;
      addPak(vmtPath);
      const vmt = parseVMT(Buffer.from(vb).toString('latin1'));
      for (const k of ['$basetexture', '$bumpmap']) if (vmt[k] && addPak(`materials/${texPath(vmt[k])}.vtf`)) texFiles++;
      break;
    }
}
console.log(`  ${entModels.size} modelos animados (sala da GLaDOS), ${texFiles} texturas`);

// créditos do final: o roteiro, a música e a letra (no arquivo de idioma)
add('pak/scripts/credits.txt', pak.read('scripts/credits.txt'));

// legendas e textos do jogo (português do Brasil e inglês)
for (const lang of ['brazilian', 'english'])
  for (const kind of ['closecaption', 'portal']) {
    const f = findFile(`portal/resource/${kind}_${lang}.txt`);
    if (f) add(`portal/resource/${kind}_${lang}.txt`, fs.readFileSync(f));
  }

const info = { formato: 1, mapas: MAPS.map(([m]) => m), cenas: scenesFound, sons: waves.size - missing, criado: new Date().toISOString() };
add('portal-campanha.json', Buffer.from(JSON.stringify(info, null, 2)));

const size = writeZip(OUT, items);
console.log(`\n${scenesFound} cenas, ${waves.size - missing} arquivos de som (${missing} de fora, do Half-Life 2), ${items.length} arquivos no total`);
console.log(`Pacote: ${OUT} (${(size / 1e6).toFixed(1)} MB)`);
console.log('No jogo: "Campanha original" → escolha este arquivo. Não publique o pacote: o conteúdo é da Valve.');
