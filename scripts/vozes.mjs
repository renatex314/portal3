// Gera as falas gravadas (ElevenLabs) dos personagens escolhidos:
//   ELEVENLABS_API_KEY=… node scripts/vozes.mjs [--dry] [--so=Helena,Kelly]
// Cada fala vira public/vozes/<chave>.mp3 (a chave sai de quem fala + o texto, igual
// ao jogo) e public/vozes/index.json lista as que existem. Falas já geradas são puladas;
// mudou o texto, muda a chave e a fala é gerada de novo. A chave da API nunca é salva.

import fs from 'node:fs';
import path from 'node:path';
import { voiceKey } from '../src/voicekey.js';

const VOICES = {
  Helena: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  'Seu Tião': 'pqHfZKP75CvOlQylNhV4', // Bill
  'Seu Tião (rádio)': 'pqHfZKP75CvOlQylNhV4',
  'Dona Cida': 'XrExE9yKIg1WjnnlVkGX', // Matilda
  Kelly: 'cgSgspJ2msm6clMCkdW9', // Jessica
  Luciana: 'FGY2WhTYpPnrIDTdsKH5', // Laura
  Bigode: 'nPczCjzI2devNBz1zQrb', // Brian
  Rodrigo: 'iP95p4xoKVk53GoZ742B', // Chris
  Marquinho: 'TX3LPaxmHKxFdv7VOQHJ', // Liam
};
const MODEL = 'eleven_multilingual_v2';
const OUT = 'public/vozes';
const dry = process.argv.includes('--dry');
// --so=Nome,Nome: só esses personagens (para caber na cota do mês)
const only = process.argv.find((a) => a.startsWith('--so='))?.slice(5).split(',');

// falas no código: ['Quem', 'texto'] (strings com aspas simples, como estão nas fases)
const LINE = /\[\s*'([^'\n]{2,30})',\s*'((?:[^'\\\n]|\\.){4,})'\s*\]/g;
const lines = new Map();
for (const f of fs.readdirSync('src/game').filter((n) => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join('src/game', f), 'utf8');
  for (const m of src.matchAll(LINE)) {
    const who = m[1];
    if (!VOICES[who] || (only && !only.includes(who))) continue;
    const text = m[2].replace(/\\(.)/g, '$1');
    lines.set(voiceKey(who, text), { who, text });
  }
}

fs.mkdirSync(OUT, { recursive: true });
const todo = [...lines].filter(([k]) => !fs.existsSync(path.join(OUT, `${k}.mp3`)));
const chars = todo.reduce((n, [, l]) => n + l.text.length, 0);
console.log(`${lines.size} falas; faltam ${todo.length} (${chars} caracteres)`);
if (dry) process.exit(0);

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('Defina ELEVENLABS_API_KEY.');
  process.exit(1);
}
for (const [k, { who, text }] of todo) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[who]}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) {
    console.error(`falhou (${res.status}): ${who}: ${text.slice(0, 60)}…\n${await res.text()}`);
    break;
  }
  fs.writeFileSync(path.join(OUT, `${k}.mp3`), Buffer.from(await res.arrayBuffer()));
  console.log(`ok ${k} ${who}: ${text.slice(0, 60)}`);
}
const have = fs
  .readdirSync(OUT)
  .filter((n) => n.endsWith('.mp3'))
  .map((n) => n.slice(0, -4))
  .sort();
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(have));
console.log(`index.json: ${have.length} falas gravadas`);
