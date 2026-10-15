// Falas e sons da campanha original, tocados a partir dos arquivos da própria
// instalação do jogador: cenas (scenes.image) → nomes de som (scripts de som)
// → .wav dentro do pacote VPK; legendas do arquivo de legendas do jogo, em
// português do Brasil quando houver. Nada disso fica no repositório.

import { readFile } from './source.js';
import { openContent } from './vpk.js';
import { parseKV, kvGet } from './kv.js';
import { parseScenesImage, findScene, loadSoundScripts, cleanWave, decodeText } from './scenes.js';

/** legenda: tira as marcações de formatação (<clr:…>, <I>, <len:…> etc.) */
const cleanCaption = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export class Dialogue {
  /** subtitle(who, text, seconds) mostra a legenda na tela */
  constructor({ subtitle }) {
    this.subtitle = subtitle;
    this.ready = null;
    this.sounds = new Map(); // nome do som (minúsculo) → [arquivos .wav]
    this.captions = new Map(); // nome do som (minúsculo) → { text, sfx }
    this.scenes = new Map(); // crc → { ms, sounds }
    this.buffers = new Map();
    this.playing = new Set();
    this.run = 0;
  }

  init() {
    this.ready ??= this.load().catch((err) => {
      console.warn('[falas] indisponíveis:', err.message);
      this.failed = true;
    });
    return this.ready;
  }

  async load() {
    // VPK da instalação ou o pacote .zip (ver source.js): mesma interface has/read
    this.pak = await openContent();
    ({ sounds: this.sounds } = await loadSoundScripts(this.pak, parseKV, kvGet));
    // cenas compiladas: para cada cena, duração e a lista de sons, em ordem
    this.scenes = parseScenesImage(await this.pak.read('scenes/scenes.image'));
    // legendas: português do Brasil, se a instalação tiver; senão inglês
    for (const lang of ['brazilian', 'portuguese', 'english']) {
      const bytes = await readFile(`portal/resource/closecaption_${lang}.txt`);
      if (!bytes) continue;
      const tokens = kvGet(parseKV(decodeText(bytes))[0] ?? {}, 'Tokens');
      for (const t of tokens?.children ?? []) this.captions.set(t.key.toLowerCase(), { text: cleanCaption(t.value ?? ''), sfx: /<sfx>/i.test(t.value ?? '') });
      if (this.captions.size) break;
    }
    console.log(`[falas] ${this.sounds.size} sons, ${this.scenes.size} cenas, ${this.captions.size} legendas`);
  }

  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async buffer(name) {
    const waves = this.sounds.get(name.toLowerCase()) ?? (/\.(wav|mp3)$/i.test(name) ? [cleanWave(name)] : null);
    if (!waves) return null;
    const path = waves[Math.floor(Math.random() * waves.length)].toLowerCase();
    if (!this.buffers.has(path))
      this.buffers.set(
        path,
        (async () => {
          const bytes = await this.pak.read(path);
          if (!bytes) return null;
          try {
            return await this.audio().decodeAudioData(bytes.slice().buffer);
          } catch {
            return null;
          }
        })(),
      );
    return this.buffers.get(path);
  }

  /** nomes de som que começam com `prefix`, em ordem numérica (falas dos núcleos) */
  soundNames(prefix) {
    const p = prefix.toLowerCase();
    return [...this.sounds.keys()].filter((k) => k.startsWith(p)).sort((a, b) => (parseInt(a.slice(p.length), 10) || 0) - (parseInt(b.slice(p.length), 10) || 0));
  }

  sceneInfo(file) {
    return findScene(this.scenes, file);
  }

  /** começa uma cena; devolve a duração (s) na hora, e toca em segundo plano */
  playScene(file) {
    const info = this.failed ? null : this.sceneInfo(file);
    if (!info) return null;
    const run = this.run;
    (async () => {
      const bufs = await Promise.all(info.sounds.map((s) => this.buffer(s)));
      if (run !== this.run) return;
      // os sons da cena em sequência, com o tempo que sobra dividido entre as pausas
      const total = bufs.reduce((a, b) => a + (b?.duration ?? 0), 0);
      const gap = Math.max(0.12, Math.min(1.5, (info.ms / 1000 - total) / (info.sounds.length + 1)));
      let t = this.audio().currentTime + 0.05;
      info.sounds.forEach((name, k) => {
        const b = bufs[k];
        if (!b) return;
        this.schedule(b, t, name);
        t += b.duration + gap;
      });
    })();
    return info.ms / 1000;
  }

  schedule(buf, when, name, volume = 1) {
    const ctx = this.audio();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.out);
    src.start(when);
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
    const cap = this.captions.get(name.toLowerCase());
    if (cap && !cap.sfx && cap.text) {
      const run = this.run;
      setTimeout(() => run === this.run && this.subtitle('GLaDOS', cap.text, buf.duration + 0.4), Math.max(0, (when - ctx.currentTime) * 1000));
    }
    return { src, gain: g };
  }

  /** som solto (ambient_generic): nome de script de som ou caminho de .wav; devolve o controle dele */
  async playSound(name, volume = 1) {
    if (this.failed) return null;
    const run = this.run;
    const b = await this.buffer(name);
    return b && run === this.run ? this.schedule(b, this.audio().currentTime + 0.02, name, volume) : null;
  }

  /** para (ou esmaece em `fade` segundos) um som tocado por playSound */
  stopSound(h, fade = 0) {
    if (!h) return;
    const t = this.audio().currentTime;
    try {
      if (fade > 0) {
        h.gain.gain.setValueAtTime(h.gain.gain.value, t);
        h.gain.gain.linearRampToValueAtTime(0, t + fade);
        h.src.stop(t + fade + 0.05);
      } else h.src.stop();
    } catch {}
  }

  setVolume(h, v) {
    if (h) h.gain.gain.setTargetAtTime(v, this.audio().currentTime, 0.05);
  }

  stopAll() {
    this.run++;
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {}
    }
    this.playing.clear();
  }
}
