// Campanha original: os mapas do Portal (Valve) lidos da instalação do próprio
// jogador e montados com as peças deste jogo. Nenhum arquivo da Valve fica no
// repositório nem no site: no `npm run dev` o servidor local lê PORTAL_DIR; no
// site publicado, o jogador escolhe o pacote .zip (npm run pacote) ou a pasta
// do Portal dele (ver source.js).

import { parseBSP } from './bsp.js';
import { buildMap, REAL_PROP_TEX } from './convert.js';
import { Dialogue } from './dialogue.js';
import { ensureSource, readFile, packedContent } from './source.js';
import { MAPS } from './maps.js';
import { animatedModels, sequenceDurations } from './mdl.js';
import { parseStaticProps, parseModel, readPHY } from './staticprops.js';
import { parseAnimatedModel } from './mdlmodel.js';
import { buildModel, placeModel, playSeq } from './model3d.js';
import * as THREE from 'three';
import { VPK } from './vpk.js';

// falas e sons (um só para a campanha toda); a legenda é ligada pelo main.js
export const dialogue = new Dialogue({ subtitle: (...a) => dialogue.onSubtitle?.(...a) });

const cache = new Map();

const NO_SOURCE = 'Para jogar a campanha original, escolha o pacote da campanha (.zip) ou a pasta do Portal.';

export async function fetchMap(map) {
  if (cache.has(map)) return cache.get(map);
  const got = await ensureSource();
  if (got !== 'ok') throw new Error(NO_SOURCE);
  const bytes = await readFile(`portal/maps/${map}.bsp`);
  if (!bytes) throw new Error(`O mapa ${map} não está nesse pacote/instalação do Portal.`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const bsp = parseBSP(buffer);
  bsp.staticProps = parseStaticProps(buffer);
  cache.set(map, bsp);
  return bsp;
}

// modelos dos objetos estáticos (canos, tubos, corrimãos…), lidos uma vez só: do
// pacote do Portal ou, na instalação, também do pacote do Half-Life 2 (props_c17…)
const propModels = new Map();
let hl2 = null;
async function modelFile(pak, p) {
  if (pak?.has(p)) return pak.read(p);
  if (packedContent()) return null; // no .zip, tudo fica junto em pak/
  hl2 ??= new VPK('hl2/hl2_misc').open().catch(() => null);
  const v = await hl2;
  return v?.has(p) ? v.read(p) : null;
}
async function loadPropModels(bsp, pak) {
  const names = [...new Set(bsp.staticProps.map((p) => p.model))].filter((m) => !propModels.has(m));
  await Promise.all(
    names.map(async (name) => {
      const base = name.replace(/\.mdl$/, '');
      try {
        const [mdl, vvd, vtx, phy] = await Promise.all(['.mdl', '.vvd', '.dx90.vtx', '.phy'].map((x) => modelFile(pak, base + x)));
        propModels.set(name, mdl && vvd && vtx ? parseModel(mdl, vvd, vtx, phy) : null);
      } catch (err) {
        console.warn('modelo', name, err);
        propModels.set(name, null);
      }
    }),
  );
  bsp.propModels = propModels;
}

// modelos de entidade desenhados com o modelo do original (a sala da GLaDOS: corpo,
// núcleos, discos, gerador, monitores, varanda, porta e os destroços do final)
export const REAL_MODEL = /models\/(props_bts\/glados_|gladdysdestruction\/|props\/round_elevator_)/;
const entModels = new Map();
async function loadEntityModels(bsp, pak) {
  const names = new Set();
  for (const e of bsp.entities) {
    const m = (e.kv.get('model') ?? '').toLowerCase().replace(/\\/g, '/');
    if (/^prop_(dynamic|dynamic_override|physics|glados_core)/.test(e.classname) && REAL_MODEL.test(m)) names.add(m);
  }
  for (const p of bsp.staticProps ?? []) if (REAL_PROP_TEX.test(p.model)) names.add(p.model);
  await Promise.all(
    [...names].filter((n) => !entModels.has(n)).map(async (name) => {
      const base = name.replace(/\.mdl$/, '');
      try {
        const [mdl, vvd, vtx, ani, phy] = await Promise.all(['.mdl', '.vvd', '.dx90.vtx', '.ani', '.phy'].map((x) => modelFile(pak, base + x)));
        const M = mdl && vvd && vtx ? parseAnimatedModel(mdl, vvd, vtx, ani) : null;
        if (M) M.hulls = phy ? readPHY(phy) : []; // colisão (plataformas da sala da GLaDOS)
        entModels.set(name, M);
      } catch (err) {
        console.warn('modelo', name, err);
        entModels.set(name, null);
      }
    }),
  );
  bsp.entModels = entModels;
  bsp.readAsset = (p) => modelFile(pak, p); // texturas e materiais dos modelos
  lastRead = bsp.readAsset;
}
let lastRead = null;

/**
 * Núcleo de personalidade com o modelo do original (os que caem da GLaDOS): pele
 * pelo tipo (0 curiosidade, 1 raiva, 2 bolo/maluco; 3 = o "fictício"). null se não houver.
 */
export function realCoreModel(type = 0) {
  const M = entModels.get('models/props_bts/glados_ball_reference.mdl');
  if (!M || !lastRead) return null;
  const obj = buildModel(M, lastRead, { skin: (((type + 1) % 4) + 4) % 4 });
  if (!playSeq(obj, 'look_02', { loop: true })) playSeq(obj, 'idle', { loop: true });
  const inner = placeModel(obj, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const g = new THREE.Group();
  g.scale.setScalar(0.8); // cabe no corpo físico do cubo
  g.add(inner);
  g.coreMixer = obj.mixer; // fora do userData: o clone do objeto (efeito de queima) copia o userData por JSON
  return g;
}

export const CAMPAIGN = MAPS.map(([map, code], n) => ({
  id: `campanha-${map}`,
  series: 'campaign',
  n,
  code,
  map,
  name: map.startsWith('escape') ? (map === 'escape_02' ? 'Fuga 3 · o final' : `Fuga ${n - 14}`) : code.includes('–') ? `Câmaras ${code}` : `Câmara ${code}`,
  who: 'GLaDOS',
  music: map.startsWith('escape') ? 'labTense' : 'lab',
  lesson: 'Campanha original, lida da sua instalação',
  preload: async () => {
    const bsp = await fetchMap(map);
    await dialogue.init();
    await loadPropModels(bsp, dialogue.pak);
    await loadEntityModels(bsp, dialogue.pak);
    // duração das animações que a lógica do mapa espera terminar (OnAnimationDone)
    if (!bsp.animDurations) {
      bsp.animDurations = new Map();
      for (const model of animatedModels(bsp.entities)) {
        const bytes = dialogue.pak?.has(model) ? await dialogue.pak.read(model) : null;
        if (bytes) bsp.animDurations.set(model, sequenceDurations(bytes));
      }
    }
  },
  bsp: () => cache.get(map),
  build(w) {
    const m = buildMap(w, cache.get(map));
    return { spawn: m.spawn, gun: m.gun, cubes: m.cubes, turrets: m.turrets, killY: m.killY, campaign: m };
  },
}));
