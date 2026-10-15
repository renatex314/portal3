// Encerramento da campanha original: a música e a sequência de texto dos
// créditos, montadas a partir dos arquivos da cópia do Portal do jogador
// (scripts/credits.txt, a letra no arquivo de idioma e o .mp3 da música) —
// nada disso vem com o site. Tela de terminal: texto digitado à esquerda,
// nomes subindo à direita e a arte em ASCII embaixo deles.
//
// Formato das linhas da letra ("[t]texto"): o texto é digitado em t segundos e
// a linha acaba nele; com "*" no começo, a próxima continua na mesma linha; só
// espaço é pausa; "^" pula linha, "&" limpa a tela, "<<<N>>>" troca a arte
// (1 = primeira do arquivo; 0 = nenhuma) e "#token" vem do arquivo de idioma.

import { parseKV, kvGet } from './kv.js';
import { decodeText } from './scenes.js';
import { readFile } from './source.js';

const SONG = 'music/portal_still_alive.mp3';

function param(params, key, d) {
  // o arquivo repete chaves por plataforma ([$WIN32]/[$X360]); vale a primeira
  const n = params?.children?.find((c) => c.key.toLowerCase() === key.toLowerCase());
  const v = parseFloat(n?.value);
  return Number.isFinite(v) ? v : d;
}

async function loadTokens(langs) {
  for (const lang of langs) {
    const bytes = await readFile(`portal/resource/portal_${lang}.txt`);
    if (!bytes) continue;
    const tokens = kvGet(parseKV(decodeText(bytes))[0] ?? {}, 'Tokens');
    const map = new Map();
    for (const t of tokens?.children ?? []) if (!t.key.startsWith('[')) map.set(t.key.toLowerCase(), t.value ?? '');
    if (map.size) return map;
  }
  return new Map();
}

/** lê tudo o que a sequência precisa; null se a cópia não tiver os créditos */
export async function loadCredits(dialogue) {
  await dialogue.init();
  const pak = dialogue.pak;
  if (!pak?.has('scripts/credits.txt')) return null;
  const root = parseKV(decodeText(await pak.read('scripts/credits.txt')));
  const top = root[0]?.children ?? root;
  const block = (k) => top.find((c) => c.key.toLowerCase() === k.toLowerCase());
  const params = block('CreditsParams');
  const tokens = await loadTokens(['brazilian', 'portuguese', 'english']);
  const lyrics = (block('OutroSongLyrics')?.children ?? []).map((c) => {
    const m = /^\[([\d.]+)\](.*)$/s.exec(c.key);
    return m ? { t: parseFloat(m[1]), text: m[2] } : { t: 0.5, text: c.key };
  });
  const names = (block('OutroCreditsNames')?.children ?? []).map((c) => c.key);
  // arte: grupos de linhas com o mesmo prefixo (APERTURE1…20, CAKE1…), na ordem do arquivo
  const art = [];
  let last = null;
  for (const c of block('OutroAsciiArt')?.children ?? []) {
    const g = c.key.replace(/\d+$/, '');
    if (g !== last) art.push([]);
    last = g;
    art[art.length - 1].push((c.value ?? '').replace(/^\[[\d.]+\]/, ''));
  }
  return {
    lyrics,
    names,
    art,
    tokens,
    songStart: param(params, 'songstarttime', 6.85),
    scrollStart: param(params, 'scrollcreditsstart', 9),
    scrollTime: param(params, 'scrolltime', 173),
    song: await dialogue.buffer(SONG),
  };
}

/** toca a sequência; resolve quando termina ou quando o jogador pula (Esc/clique) */
export function playCredits(dialogue, data) {
  const el = document.createElement('div');
  el.id = 'campaign-credits';
  el.innerHTML = '<div class="cr-left"><pre class="cr-text"></pre></div><div class="cr-right"><div class="cr-names"><pre></pre></div><pre class="cr-art"></pre></div><p class="cr-skip">Esc ou clique para pular</p>';
  document.body.appendChild(el);
  const textEl = el.querySelector('.cr-text');
  const namesBox = el.querySelector('.cr-names');
  const namesEl = el.querySelector('.cr-names pre');
  const artEl = el.querySelector('.cr-art');
  namesEl.textContent = data.names.join('\n');

  const ctx = dialogue.audio();
  const t0 = ctx.currentTime + 0.1;
  let song = null;
  if (data.song) {
    song = dialogue.schedule(data.song, t0 + data.songStart, SONG, 0.9);
  }
  const songEnd = data.songStart + (data.song?.duration ?? data.scrollTime);

  // a letra vira uma lista de "quadros" no tempo: [início, fim, ação]
  const steps = [];
  let at = 0;
  for (const L of data.lyrics) {
    let s = L.text;
    let artIdx = null;
    const m = /^<<<(\d+)>>>/.exec(s);
    if (m) {
      artIdx = Number(m[1]);
      s = s.slice(m[0].length);
    }
    let kind = 'line';
    if (s.startsWith('*')) {
      kind = 'cont';
      s = s.slice(1);
    } else if (s === '^') kind = 'br';
    else if (s === '&') kind = 'clear';
    if (s.startsWith('#')) s = data.tokens.get(s.slice(1).toLowerCase()) ?? '';
    steps.push({ from: at, to: at + L.t, kind, text: kind === 'br' || kind === 'clear' ? '' : s, artIdx });
    at += L.t;
  }

  // estado da tela a cada quadro, recalculado a partir do zero (simples e sem acumular erros)
  const render = (now) => {
    let lines = [''];
    let artIdx = 0;
    for (const st of steps) {
      if (st.from > now) break;
      if (st.artIdx !== null) artIdx = st.artIdx;
      const k = Math.min(1, (now - st.from) / Math.max(st.to - st.from, 1e-3));
      if (st.kind === 'clear') {
        if (k >= 1) lines = [''];
        continue;
      }
      if (st.kind === 'br') {
        if (k >= 1) lines.push('');
        continue;
      }
      // linha comum: digita e pula linha no fim (só espaços = pausa); "*": digita sem pular
      if (st.kind === 'line' && !st.text.trim()) continue;
      lines[lines.length - 1] += st.text.slice(0, Math.round(st.text.length * k));
      if (st.kind === 'line' && k >= 1) lines.push('');
    }
    const blink = Math.floor(now / 0.3) % 2 ? '_' : ' ';
    textEl.textContent = lines.join('\n') + blink;
    artEl.textContent = artIdx > 0 ? (data.art[artIdx - 1] ?? []).join('\n') : '';
    // nomes: sobem de baixo para cima durante scrollTime
    const p = Math.max(0, Math.min(1, (now - data.scrollStart) / data.scrollTime));
    namesEl.style.transform = `translateY(${namesBox.clientHeight - p * (namesBox.clientHeight + namesEl.scrollHeight)}px)`;
  };

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialogue.stopSound(song, 1.5);
      removeEventListener('keydown', onKey, true);
      el.classList.add('out');
      setTimeout(() => el.remove(), 1200);
      resolve();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish();
      }
    };
    addEventListener('keydown', onKey, true);
    el.addEventListener('click', finish);
    const tick = () => {
      if (done) return;
      const now = ctx.currentTime - t0;
      render(now);
      if (now > Math.max(songEnd, at) + 3) return finish();
      requestAnimationFrame(tick);
    };
    tick();
  });
}
