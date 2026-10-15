// Campanha original: os mapas do Portal (Valve) lidos da instalação do próprio
// jogador e montados com as peças deste jogo. Nenhum arquivo da Valve fica no
// repositório nem no site: no `npm run dev` o servidor local lê PORTAL_DIR; no
// site publicado, o jogador escolhe o pacote .zip (npm run pacote) ou a pasta
// do Portal dele (ver source.js).

import { parseBSP } from './bsp.js';
import { buildMap } from './convert.js';
import { Dialogue } from './dialogue.js';
import { ensureSource, readFile } from './source.js';
import { MAPS } from './maps.js';
import { animatedModels, sequenceDurations } from './mdl.js';

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
  const bsp = parseBSP(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  cache.set(map, bsp);
  return bsp;
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
