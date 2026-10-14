// Trilha sonora procedural (Web Audio): nada de arquivos de música — tudo é
// sintetizado ao vivo, então não há direitos autorais envolvidos.
//
// Climas ("moods"):
//   ground  — deserto: drone grave, vento e violão esparso
//   space   — espaço/física: pads largos em ré menor e sinos
//   doc     — Minas Gerais: arpejo de viola caipira (Karplus-Strong) em ré maior
//   descent — descida do poço: drone, "coração" e pings metálicos
//   ride    — dentro da cápsula: baixo pulsante a 120 bpm
//   lab       — câmaras de teste: tenso — drone grave, baixo distorcido em
//               semicolcheias, sequência em ré frígio, batida industrial com
//               golpes metálicos, cordas em trêmolo e um motivo de "metais" (112 bpm)
//   labTense  — desafios/torretas: caótico e dramático — baixo distorcido em
//               semicolcheias com trítono, acordes em cluster, cordas em
//               trêmolo subindo, sirene, viradas de tons (138 bpm)
//   labEpic   — série Momento, câmara final e o outro lado da Terra: ré menor
//               a 100 bpm, cordas, tímpanos, pulso distorcido com trítono,
//               trêmolo agudo e percussão industrial sob um tema sombrio
// (composições próprias, no clima das faixas tensas de laboratório dos jogos de portal)
// Efeitos: explosão, ronco da descida, vento da queda.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Músicas gravadas (CC0, veja public/music/LEIA-ME.txt), tocadas em streaming com
// transição suave entre as faixas. `g` iguala o volume entre elas. Climas sem
// faixa (ou se o arquivo não carregar) usam a música sintetizada.
// `g` = ganho que leva cada faixa ao mesmo volume (várias vêm masterizadas muito baixo).
export const TRACKS = {
  // câmaras de teste: pulso lento, tensão contida
  lab: [
    { f: 'music/sector.mp3', g: 7.5 },
    { f: 'music/pulse.mp3', g: 4.5 },
    { f: 'music/airy.mp3', g: 12 },
  ],
  // desafios e torretas: urgência
  labTense: [
    { f: 'music/urgent.mp3', g: 15 },
    { f: 'music/depths.mp3', g: 1.76 },
    { f: 'music/infestation.mp3', g: 8.2 },
    { f: 'music/searching.ogg', g: 0.53 },
  ],
  // série Momento, câmara final e o outro lado da Terra: sombrio e grande
  labEpic: [
    { f: 'music/menacing.mp3', g: 0.33 },
    { f: 'music/surreal.mp3', g: 5 },
    { f: 'music/transmission.mp3', g: 4.3 },
  ],
};
const FADE = 4; // segundos de transição entre faixas
const BPM = { lab: 112, labTense: 138, labEpic: 100 };

// melodias: por compasso, [semicolcheia de início, nota MIDI, duração em semicolcheias]
// câmaras: motivo de "metais" lento sobre Ré – Ré – Si♭ – Lá (segundas menores, nada alegre)
const LAB_THEME = [
  [[0, 69, 8], [8, 70, 4], [12, 69, 4]],
  [[0, 67, 8], [8, 65, 8]],
  [[0, 65, 6], [6, 67, 2], [8, 70, 8]],
  [[0, 69, 12], [12, 61, 4]],
  [[0, 74, 8], [8, 75, 4], [12, 74, 4]],
  [[0, 72, 8], [8, 70, 8]],
  [[0, 70, 4], [4, 69, 4], [8, 65, 8]],
  [[0, 64, 8], [8, 61, 8]],
];
// tensão: queda cromática de "metais" (Sol – Sol♭ – Mi♭ – Dó)
const TENSE_FALL = [[0, 79, 4], [4, 78, 4], [8, 75, 4], [12, 72, 4]];
// Momento: tema grave e dramático em ré menor (Rém – Si♭ – Solm – Lá)
const EPIC = [
  [[0, 74, 8], [8, 72, 4], [12, 70, 4]],
  [[0, 69, 12], [12, 65, 4]],
  [[0, 67, 6], [6, 70, 2], [8, 74, 8]],
  [[0, 73, 8], [8, 76, 8]],
  [[0, 77, 8], [8, 76, 4], [12, 74, 4]],
  [[0, 74, 8], [8, 70, 8]],
  [[0, 70, 4], [4, 72, 4], [8, 74, 4], [12, 70, 4]],
  [[0, 69, 16]],
];

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.moods = [];
    this.current = null;
    this.ksCache = new Map();
    this.tension = 0;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp);

    // reverb gerado (ruído com decaimento exponencial)
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.music = ctx.createGain(); // volume geral da música (abaixa na narração)
    this.music.gain.value = 0.5;
    // filtro "abafado" do tempo lento (jogo): normalmente aberto
    this.slowLP = ctx.createBiquadFilter();
    this.slowLP.type = 'lowpass';
    this.slowLP.frequency.value = 20000;
    this.slowLP.Q.value = 0.9;
    this.slowLP.connect(this.master);
    this.music.connect(this.slowLP);
    this.music.connect(this.reverb);
    // eco rítmico da melodia (o tempo acompanha o clima tocando)
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.4;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    const dOut = ctx.createGain();
    dOut.gain.value = 0.6;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(dOut).connect(this.music);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.slowLP);

    // ruído branco reaproveitável
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // ronco (descida) e vento (queda): ficam ligados com volume 0
    this.rumble = this._noiseVoice('lowpass', 120, 0.7, this.sfx);
    this.whoosh = this._noiseVoice('bandpass', 400, 0.9, this.sfx);

    this.timer = setInterval(() => this._schedule(), 90);
  }

  _noiseVoice(type, freq, q, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(dest);
    src.start();
    return { f, g };
  }

  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(on ? (this.ducked ? 0.18 : 0.5) : 0, this.ctx.currentTime, 0.4);
  }

  duck(on) {
    this.ducked = on;
    if (!this.ctx || !this.musicOn) return;
    this.music.gain.setTargetAtTime(on ? 0.18 : 0.5, this.ctx.currentTime, on ? 0.15 : 0.8);
  }

  setMood(name) {
    if (!this.ctx || this.current?.name === name) return;
    const t = this.ctx.currentTime;
    if (this.current) {
      const old = this.current;
      old.bus.gain.cancelScheduledValues(t);
      old.bus.gain.setValueAtTime(old.bus.gain.value, t);
      old.bus.gain.linearRampToValueAtTime(0, t + 3);
      old.dying = t + 3.2;
    }
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0, t);
    bus.gain.linearRampToValueAtTime(1, t + 3);
    bus.connect(this.music);
    const mood = { name, bus, next: t + 0.1, step: 0, nodes: [] };
    const bpm = BPM[name];
    if (bpm) this.delay.delayTime.setTargetAtTime((3 * 60) / bpm / 4, t, 0.05); // eco de 3 semicolcheias
    if (TRACKS[name]?.length) {
      mood.next = Infinity; // sem sequenciador: quem toca é o streaming
      this._playlist(mood);
    } else this._startDrones(mood);
    this.current = mood;
    this.moods.push(mood);
  }

  // ------------------------------------------------------------ músicas gravadas
  _playlist(mood) {
    const list = [...TRACKS[mood.name]].sort(() => Math.random() - 0.5);
    mood.stream = { list, i: 0, cur: null, failed: false };
    this._nextTrack(mood, 0.3);
  }

  /** começa a próxima faixa (entra em `fade` s) */
  _nextTrack(mood, fade = FADE) {
    const st = mood.stream;
    const tr = st.list[st.i++ % st.list.length];
    const ctx = this.ctx;
    const el = new Audio(tr.f);
    el.preload = 'auto';
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.max(tr.g ?? 1, 0.01), t + fade);
    src.connect(g).connect(mood.bus);
    const track = { el, g, tr };
    mood.nodes.push({ stop: () => el.pause() });
    el.addEventListener('error', () => this._streamFailed(mood, track));
    el.play().catch((e) => {
      // autoplay bloqueado (ainda sem clique/tecla): tenta de novo no primeiro gesto
      if (e?.name === 'NotAllowedError') this._retryOnGesture(el);
      else this._streamFailed(mood, track);
    });
    // a faixa anterior sai
    const old = st.cur;
    if (old) {
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setValueAtTime(old.g.gain.value, t);
      old.g.gain.linearRampToValueAtTime(0, t + fade);
      old.ending = true;
      setTimeout(() => old.el.pause(), (fade + 0.3) * 1000);
    }
    st.cur = track;
  }

  _retryOnGesture(el) {
    const go = () => {
      for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, go, true);
      this.ctx?.resume();
      el.play().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, go, true);
  }

  /** arquivo ausente / bloqueado: cai para a música sintetizada do clima */
  _streamFailed(mood, track) {
    const st = mood.stream;
    if (!st || st.failed || track.ending) return;
    st.failed = true;
    mood.stream = null;
    mood.next = this.ctx.currentTime + 0.1;
    this._startDrones(mood);
  }

  /** a cada passo do sequenciador: emenda a próxima faixa perto do fim da atual */
  _streamTick(mood) {
    const st = mood.stream;
    if (!st?.cur) return;
    const { el } = st.cur;
    if (isFinite(el.duration) && el.duration > FADE * 2 && el.currentTime > el.duration - FADE - 0.2 && !st.cur.ending) this._nextTrack(mood);
  }

  /** tempo lento: abafa música e efeitos (o som do próprio efeito passa por fora) */
  setSlowmo(on) {
    if (!this.ctx) return;
    this.slowLP.frequency.setTargetAtTime(on ? 650 : 20000, this.ctx.currentTime, on ? 0.12 : 0.25);
  }

  /** 0..1 — usado na descida (tensão) e na queda (velocidade) */
  setIntensity(x) {
    this.tension = x;
  }

  setRumble(x) {
    if (this.ctx) {
      this.rumble.g.gain.setTargetAtTime(x * 0.5, this.ctx.currentTime, 0.2);
      this.rumble.f.frequency.setTargetAtTime(70 + x * 160, this.ctx.currentTime, 0.2);
    }
  }

  setWhoosh(x) {
    if (this.ctx) {
      this.whoosh.g.gain.setTargetAtTime(x * 0.22, this.ctx.currentTime, 0.15);
      this.whoosh.f.frequency.setTargetAtTime(250 + x * 1800, this.ctx.currentTime, 0.15);
    }
  }

  /** rugido de dinossauro sintetizado: ronco grave com "rosnado" + bafo de ruído */
  roar(vol = 1, pitch = 1) {
    if (!this.ctx || vol <= 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 2.1;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.22);
    out.gain.setValueAtTime(0.9 * vol, t + dur * 0.55);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(this.sfx);
    out.connect(this.reverb);
    // rosnado: modulação rápida de amplitude
    const growl = ctx.createGain();
    growl.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 27;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.4;
    lfo.connect(lfoG).connect(growl.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    lp.frequency.exponentialRampToValueAtTime(350, t + dur);
    growl.connect(lp).connect(out);
    for (const [mult, type, g] of [
      [1, 'sawtooth', 0.5],
      [1.49, 'sawtooth', 0.25],
      [0.5, 'square', 0.2],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      const f = 95 * pitch * mult;
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.45);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + dur);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(growl);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    // bafo
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(500 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(1100 * pitch, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(300 * pitch, t + dur);
    const ng = ctx.createGain();
    ng.gain.value = 0.55;
    src.connect(bp).connect(ng).connect(growl);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  boom() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(60, t + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.6, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    src.connect(f).connect(g).connect(this.sfx);
    src.connect(f).connect(g).connect(this.reverb);
    src.start(t);
    src.stop(t + 4.6);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.0, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 2.1);
    // pedrinhas caindo depois
    for (let i = 0; i < 26; i++) {
      const tt = t + 0.8 + Math.random() * 3.5;
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 1500 + Math.random() * 3000;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.25 * Math.random(), tt);
      sg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.06);
      s.connect(hp).connect(sg).connect(this.sfx);
      s.start(tt, Math.random());
      s.stop(tt + 0.08);
    }
  }

  // ------------------------------------------------------------ instrumentos
  _ks(midi) {
    if (this.ksCache.has(midi)) return this.ksCache.get(midi);
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 3);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / mtof(midi)));
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    for (let i = 1; i < N; i++) ring[i] = 0.5 * (ring[i] + ring[i - 1]);
    let idx = 0;
    const decay = midi > 60 ? 0.9955 : 0.997;
    for (let i = 0; i < len; i++) {
      const v = ring[idx];
      const nx = ring[(idx + 1) % N];
      ring[idx] = decay * 0.5 * (v + nx);
      d[i] = v * 0.6;
      idx = (idx + 1) % N;
    }
    for (let i = 0; i < 400; i++) d[len - 1 - i] *= i / 400;
    this.ksCache.set(midi, buf);
    return buf;
  }

  _pluck(bus, midi, t, vel = 0.5, pan = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._ks(midi);
    const g = this.ctx.createGain();
    g.gain.value = vel;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(g).connect(p).connect(bus);
    s.start(t);
    s.stop(t + 3);
  }

  _pad(bus, notes, t, dur, { cutoff = 900, vol = 0.07, type = 'sawtooth', attack = 2.5 } = {}) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur);
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 3);
    f.connect(g).connect(bus);
    for (const m of notes)
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 3.2);
      }
  }

  _bell(bus, midi, t, vol = 0.08) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    g.connect(bus);
    for (const [mult, a] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.15],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = mtof(midi) * mult;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 4.1);
    }
  }

  _bass(bus, midi, t, dur, cutoff, vol = 0.12) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(cutoff * 2.5, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.5, 60), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _thump(bus, t, vol = 0.5) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.4);
  }

  /**
   * voz de sintetizador: osciladores (desafinados entre si) → passa-baixa com
   * envelope → volume → pan; `send` manda para o eco, `vib` (cents) dá vibrato.
   */
  _voice(bus, midi, t, dur, o = {}) {
    const { types = ['square'], vol = 0.06, cutoff = 2400, env = 0, q = 1, attack = 0.006, release = 0.08, detune = 8, pan = 0, send = 0, vib = 0, dist = 0 } = o;
    const ctx = this.ctx;
    const end = t + dur + release;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(cutoff * (1 + env), t);
    f.frequency.exponentialRampToValueAtTime(cutoff, t + Math.min(Math.max(dur, 0.02), 0.25));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    f.connect(g).connect(p).connect(bus);
    // distorção (antes do filtro): satura e "suja" o timbre
    let input = f;
    if (dist) {
      input = ctx.createWaveShaper();
      input.curve = this._curve(dist);
      input.oversample = '2x';
      input.connect(f);
    }
    if (send) {
      const sg = ctx.createGain();
      sg.gain.value = send;
      p.connect(sg).connect(this.delay);
    }
    let lg = null;
    if (vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.6;
      lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(vib, t + Math.min(dur, 0.4));
      lfo.connect(lg);
      lfo.start(t);
      lfo.stop(end + 0.05);
    }
    types.forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(midi);
      osc.detune.value = (i - (types.length - 1) / 2) * detune;
      if (lg) lg.connect(osc.detune);
      osc.connect(input);
      osc.start(t);
      osc.stop(end + 0.05);
    });
  }

  _curve(amount) {
    this.curves ??= new Map();
    const key = Math.round(amount * 100);
    if (!this.curves.has(key)) {
      const n = 1024;
      const c = new Float32Array(n);
      const k = 1 + amount * 20;
      for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * k) / Math.tanh(k);
      this.curves.set(key, c);
    }
    return this.curves.get(key);
  }

  /** golpe metálico (sino desafinado curto): a "batida industrial" */
  _metal(bus, t, vol = 0.05, pitch = 1, decay = 0.28) {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    hp.connect(g).connect(bus);
    for (const f of [587, 845, 1253, 1729, 2311]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * pitch;
      o.connect(hp);
      o.start(t);
      o.stop(t + decay + 0.02);
    }
    this._noiseHit(bus, t, { type: 'bandpass', freq: 3500 * pitch, q: 2, vol: vol * 0.8, dur: 0.06 });
  }

  /** impacto grave (início de seção): queda de senoide + estrondo filtrado */
  _impact(bus, t, vol = 0.45) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 2.3);
    this._noiseHit(bus, t, { type: 'lowpass', freq: 380, q: 0.7, vol: vol * 0.9, dur: 2.4 });
  }

  _tom(bus, midi, t, vol = 0.22) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(mtof(midi) * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.5);
    this._noiseHit(bus, t, { type: 'bandpass', freq: 900, q: 1, vol: vol * 0.4, dur: 0.05 });
  }

  _crash(bus, t, vol = 0.06) {
    this._noiseHit(bus, t, { type: 'highpass', freq: 4200, q: 0.5, vol, dur: 1.8 });
  }

  /** sirene: serra subindo por um passa-faixa estreito */
  _siren(bus, t, dur, from, to, vol = 0.03) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(from), t);
    o.frequency.exponentialRampToValueAtTime(mtof(to), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(mtof(from) * 2, t);
    f.frequency.exponentialRampToValueAtTime(mtof(to) * 2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    o.connect(f).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.35);
  }

  _kick(bus, t, vol = 0.4) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.35);
  }

  _noiseHit(bus, t, { type = 'highpass', freq = 7000, q = 0.7, vol = 0.05, dur = 0.05 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  _hat(bus, t, vol = 0.035, open = false) {
    this._noiseHit(bus, t, { freq: 7500, vol, dur: open ? 0.22 : 0.045 });
  }

  _snare(bus, t, vol = 0.14) {
    this._noiseHit(bus, t, { type: 'bandpass', freq: 1900, q: 0.8, vol, dur: 0.17 });
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** tímpano: senoide grave com leve queda de afinação e um "toque" de ruído */
  _timpani(bus, midi, t, vol = 0.3) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(mtof(midi) * 1.06, t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 1.7);
    this._noiseHit(bus, t, { type: 'lowpass', freq: 400, vol: vol * 0.5, dur: 0.12 });
  }

  /** cordas sintetizadas: três serras por nota, ataque lento e vibrato */
  _strings(bus, notes, t, dur, vol = 0.03, cutoff = 2200) {
    for (const n of notes) this._voice(bus, n, t, dur, { types: ['sawtooth', 'sawtooth', 'sawtooth'], detune: 12, vol, cutoff, attack: 0.7, release: 1.2, vib: 10, pan: ((n % 5) - 2) * 0.15 });
  }

  _drone(mood, midi, type = 'sine', vol = 0.05, cutoff = 400) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    o.connect(f).connect(g).connect(mood.bus);
    o.start();
    mood.nodes.push(o);
    return { o, f, g };
  }

  _startDrones(mood) {
    if (mood.name === 'ground') {
      this._drone(mood, 33, 'sawtooth', 0.05, 180);
      this._drone(mood, 40, 'sine', 0.05);
      // vento
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 500;
      f.Q.value = 0.4;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lg = this.ctx.createGain();
      lg.gain.value = 300;
      lfo.connect(lg).connect(f.frequency);
      const g = this.ctx.createGain();
      g.gain.value = 0.05;
      src.connect(f).connect(g).connect(mood.bus);
      src.start();
      lfo.start();
      mood.nodes.push(src, lfo);
    } else if (mood.name === 'space') {
      this._drone(mood, 26, 'sine', 0.07);
    } else if (mood.name === 'doc') {
      this._drone(mood, 38, 'triangle', 0.03, 300);
    } else if (mood.name === 'descent') {
      mood.d1 = this._drone(mood, 26, 'sawtooth', 0.07, 140);
      mood.d2 = this._drone(mood, 33, 'sawtooth', 0.04, 160);
    } else if (mood.name === 'ride') {
      this._drone(mood, 26, 'sine', 0.06);
    } else if (mood.name === 'lab' || mood.name === 'labEpic') {
      // drone de ré: sub grave + serra abafada que "respira" devagar
      this._drone(mood, 26, 'sine', 0.06);
      this._breath(mood, this._drone(mood, 38, 'sawtooth', 0.035, 160), 0.06, 220);
    } else if (mood.name === 'labTense') {
      this._drone(mood, 24, 'sine', 0.05);
      this._breath(mood, this._drone(mood, 30, 'sawtooth', 0.03, 200), 0.11, 300);
    }
  }

  /** LFO lento no filtro de um drone */
  _breath(mood, d, rate, depth) {
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = rate;
    const lg = this.ctx.createGain();
    lg.gain.value = depth;
    lfo.connect(lg).connect(d.f.frequency);
    lfo.start();
    mood.nodes.push(lfo);
  }

  // ------------------------------------------------------------ sequenciador
  _schedule() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const m of this.moods) {
      if (m.dying && now > m.dying) {
        for (const n of m.nodes) {
          try {
            n.stop();
          } catch {}
        }
        m.bus.disconnect();
        m.dead = true;
        continue;
      }
      if (m.dying) continue;
      if (m.stream) this._streamTick(m);
      while (m.next < now + 0.35) this[`_${m.name}`](m, m.next);
    }
    this.moods = this.moods.filter((m) => !m.dead);
  }

  _ground(m, t) {
    const scale = [57, 60, 62, 64, 67, 69, 72, 64];
    if (m.step % 2 === 0) this._pluck(m.bus, scale[Math.floor(Math.random() * scale.length)], t, 0.35, Math.random() - 0.5);
    if (m.step % 16 === 0) this._pad(m.bus, [45, 52, 57], t, 10, { cutoff: 600, vol: 0.035, type: 'triangle' });
    m.step++;
    m.next = t + 0.9 + Math.random() * 1.4;
  }

  _space(m, t) {
    const chords = [
      [38, 50, 53, 57, 64],
      [34, 46, 50, 53, 57],
      [33, 45, 48, 52, 57],
      [36, 48, 50, 55, 60],
    ];
    const bar = 8;
    if (m.step % 8 === 0) {
      const c = chords[(m.step / 8) % chords.length];
      this._pad(m.bus, c, t, bar, { cutoff: 1000, vol: 0.05 });
    }
    // sinos esparsos na pentatônica de ré menor
    if (Math.random() < 0.45) {
      const pent = [74, 77, 79, 81, 84, 86];
      this._bell(m.bus, pent[Math.floor(Math.random() * pent.length)], t + Math.random() * 0.3, 0.035);
    }
    m.step++;
    m.next = t + 1;
  }

  _doc(m, t) {
    // viola caipira: I – V – vi – IV em ré maior, colcheias a 84 bpm
    const bars = [
      [50, 57, 62, 66, 69, 66, 62, 57],
      [45, 57, 61, 64, 69, 64, 61, 57],
      [47, 54, 59, 62, 66, 62, 59, 54],
      [43, 55, 59, 62, 67, 62, 59, 55],
    ];
    const eighth = 60 / 84 / 2;
    const b = Math.floor(m.step / 8) % bars.length;
    const i = m.step % 8;
    const note = bars[b][i];
    const swing = i % 2 ? 0.035 : 0;
    this._pluck(m.bus, note, t + swing, i === 0 ? 0.55 : 0.32, (i % 4) / 4 - 0.4);
    if (i === 0) {
      this._pluck(m.bus, bars[b][0] - 12, t, 0.5, 0);
      this._pad(m.bus, [bars[b][0], bars[b][2], bars[b][3]], t, eighth * 8, { cutoff: 700, vol: 0.022, type: 'triangle', attack: 0.8 });
    }
    // "dobra" de viola: a mesma nota uma oitava acima, de vez em quando
    if (i === 4 && Math.random() < 0.5) this._pluck(m.bus, note + 12, t + 0.02, 0.18, 0.3);
    m.step++;
    m.next = t + eighth;
  }

  _descent(m, t) {
    const x = this.tension;
    // "coração": batida dupla, acelera com a profundidade
    const period = 1.25 - x * 0.55;
    this._thump(m.bus, t, 0.45);
    this._thump(m.bus, t + 0.22, 0.28);
    if (Math.random() < 0.35 + x * 0.3) this._bell(m.bus, 86 + Math.floor(Math.random() * 6), t + 0.5, 0.025);
    if (m.d1) m.d1.f.frequency.setTargetAtTime(140 + x * 500, t, 1);
    if (m.d2) m.d2.f.frequency.setTargetAtTime(160 + x * 700, t, 1);
    if (m.step % 8 === 0) this._pad(m.bus, [38, 45, 51], t, period * 8, { cutoff: 400 + x * 600, vol: 0.03 });
    m.step++;
    m.next = t + period;
  }

  _ride(m, t) {
    const x = this.tension;
    const six = 60 / 120 / 4;
    const pat = [38, 38, 50, 38, 38, 45, 38, 48, 38, 38, 50, 38, 41, 38, 45, 43];
    this._bass(m.bus, pat[m.step % 16], t, six * 0.95, 200 + x * 1600, 0.11);
    if (m.step % 4 === 0) this._thump(m.bus, t, 0.35);
    if (m.step % 64 === 0) this._pad(m.bus, [50, 53, 57, 62], t, six * 64, { cutoff: 800 + x * 1200, vol: 0.035 });
    m.step++;
    m.next = t + six;
  }

  // ------------------------------------------------------------ laboratório
  /** toca as notas da melodia que começam nesta semicolcheia */
  _melody(bar, s, t, six, play) {
    for (const [at, n, len] of bar ?? []) if (at === s) play(n, len * six);
  }

  _lab(m, t) {
    const six = 60 / BPM.lab / 4;
    const s = m.step % 16;
    const bar = Math.floor(m.step / 16) % 32;
    const ci = bar % 4;
    const root = [38, 38, 34, 33][ci]; // Ré, Ré, Si♭, Lá
    const seq = [
      [62, 63, 65, 69],
      [62, 63, 65, 69],
      [58, 62, 65, 69],
      [57, 61, 64, 69],
    ][ci];
    const sec = bar < 4 ? 'intro' : bar < 12 ? 'drive' : bar < 20 ? 'theme' : bar < 24 ? 'void' : 'theme2';
    const b = m.bus;
    const beat = sec === 'drive' || sec === 'theme' || sec === 'theme2';
    // pulso: baixo distorcido abafado (colcheias na introdução, semicolcheias
    // depois), com a segunda menor e o trítono puxando para baixo
    if (sec === 'void' ? s % 4 === 0 : sec === 'intro' ? s % 2 === 0 : true) {
      const n = root + [0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 12, 0, 6, 0, 1, 0][s];
      this._voice(b, n, t, six * (sec === 'intro' ? 1.2 : 0.8), { types: ['sawtooth', 'square'], vol: sec === 'void' ? 0.045 : 0.055, cutoff: 210 + (s / 16) * 220 + (sec === 'theme2' ? 200 : 0), env: 2.5, q: 6, detune: 6, dist: 0.6 });
    }
    // cordas em trêmolo agudas, em segunda menor, subindo a cada compasso
    if (sec === 'theme' || sec === 'theme2' || sec === 'void') {
      const n = 74 + (bar % 4);
      this._voice(b, n, t, six * 0.9, { types: ['sawtooth', 'sawtooth'], vol: 0.008, cutoff: 2400, detune: 14, pan: -0.35 });
      if (sec !== 'void') this._voice(b, n + 1, t, six * 0.9, { types: ['sawtooth', 'sawtooth'], vol: 0.006, cutoff: 2400, detune: 14, pan: 0.35 });
    }
    // acordes em cluster no contratempo (segunda parte)
    if (sec === 'theme2' && (s === 3 || s === 10))
      for (const i of [24, 25, 30]) this._voice(b, root + i, t, six * 1.5, { types: ['sawtooth', 'sawtooth'], vol: 0.013, cutoff: 1200, env: 2, detune: 12, dist: 0.4, pan: ((i % 3) - 1) * 0.4 });
    // sequência em semicolcheias, filtro abrindo ao longo da seção
    const order = [0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 1, 0, 3, 2];
    if (sec !== 'intro' && sec !== 'void') {
      const open = ((bar % 8) + s / 16) / 8;
      this._voice(b, seq[order[s]], t, six * 0.5, { vol: 0.016, cutoff: 500 + open * 1600, env: 1.2, q: 3, pan: s % 2 ? 0.4 : -0.4, send: 0.18 });
    }
    // batida industrial: bumbo quebrado, golpe metálico no lugar da caixa
    if (beat) {
      if (s === 0 || s === 6 || s === 8 || (sec === 'theme2' && s === 11)) this._kick(b, t, 0.42);
      if (s === 4 || s === 12) {
        this._snare(b, t, 0.08);
        this._metal(b, t, 0.035, s === 12 ? 0.94 : 1);
      }
      if (s % 2 === 0) this._hat(b, t, s % 4 === 2 ? 0.028 : 0.012);
    } else {
      if (s % 4 === 0) this._voice(b, 98, t, 0.015, { types: ['sine'], vol: 0.02, cutoff: 9000 }); // tique-taque
      if (s === 0 || s === 3) this._kick(b, t, s ? 0.2 : 0.3); // "coração"
    }
    if (sec === 'void') {
      if (s === 0 && bar % 2 === 0) this._impact(b, t, 0.35);
      if (Math.random() < 0.08) this._metal(b, t, 0.02, 0.6 + Math.random() * 0.8, 0.6);
    }
    if (s === 0 && (sec === 'drive' || sec === 'theme2') && bar % 8 === 4) this._crash(b, t, 0.04);
    // virada de tons no fim do ciclo
    if (bar === 31 && s >= 8) this._tom(b, [50, 50, 47, 47, 43, 43, 40, 40][s - 8], t, s % 2 ? 0.12 : 0.2);
    // motivo de "metais" + cordas
    if (s === 0 && (sec === 'theme' || sec === 'theme2' || sec === 'void'))
      this._strings(b, [root, root + 7, root + 12 + (ci === 3 ? 4 : 3)], t, six * 15, 0.016, 1300);
    if (sec === 'theme' || sec === 'theme2')
      this._melody(LAB_THEME[(bar - (sec === 'theme' ? 12 : 24)) % 8], s, t, six, (n, d) =>
        this._voice(b, n + (sec === 'theme2' ? 12 : 0), t, d * 0.95, { types: ['sawtooth', 'sawtooth', 'square'], vol: 0.04, cutoff: 1500, env: 0.6, detune: 10, attack: 0.06, release: 0.3, vib: 6, send: 0.2, dist: 0.3 }),
      );
    m.step++;
    m.next = t + six;
  }

  _labTense(m, t) {
    const x = this.tension;
    const six = 60 / BPM.labTense / 4;
    const s = m.step % 16;
    const bar = Math.floor(m.step / 16) % 16;
    const ci = bar % 4;
    const root = [36, 36, 37, 30][ci]; // Dó, Dó, Ré♭, Sol♭ (trítono)
    const sec = bar < 4 ? 'build' : bar < 12 ? 'chaos' : bar < 14 ? 'break' : 'roll';
    const b = m.bus;
    // baixo distorcido em semicolcheias, com trítono e segunda menor
    if (sec !== 'break') {
      const off = [0, 0, 12, 0, 0, 0, 6, 0, 0, 0, 12, 0, 3, 0, 6, 1][s];
      this._voice(b, root + off, t, six * 0.85, { types: ['sawtooth', 'square'], vol: 0.055, cutoff: 260 + (s / 16) * 500 + x * 700, env: 2, q: 6, detune: 7, dist: 0.7 });
    }
    // cordas em trêmolo subindo meio tom por compasso
    if (sec !== 'break') {
      const n = 72 + ci;
      this._voice(b, n, t, six * 0.9, { types: ['sawtooth', 'sawtooth'], vol: sec === 'build' ? 0.012 + (bar / 4) * 0.008 : 0.014, cutoff: 2600, detune: 14, attack: 0.01, pan: -0.3 });
      this._voice(b, n + 7, t, six * 0.9, { types: ['sawtooth', 'sawtooth'], vol: 0.009, cutoff: 2600, detune: 14, attack: 0.01, pan: 0.3 });
    }
    if (sec === 'build') {
      if (s % 2 === 0) this._hat(b, t, 0.02);
      if (bar === 3 && s % 2 === 0) this._snare(b, t, 0.04 + s * 0.008);
    } else if (sec === 'chaos') {
      if (s % 4 === 0 || s === 14) this._kick(b, t, 0.48);
      if (s === 4 || s === 12) {
        this._snare(b, t, 0.16);
        this._metal(b, t, 0.04, 1.1);
      }
      this._hat(b, t, s % 2 ? 0.012 : 0.03);
      // acordes de "metais" em cluster (tônica, segunda menor, trítono)
      if ([0, 3, 6, 10].includes(s))
        for (const i of [24, 25, 30]) this._voice(b, root + i, t, six * (s === 10 ? 3 : 1.6), { types: ['sawtooth', 'sawtooth'], vol: 0.016, cutoff: 1300, env: 2.2, detune: 12, dist: 0.4, pan: ((i % 3) - 1) * 0.4 });
      if (bar >= 8)
        this._melody(TENSE_FALL, s, t, six, (n, d) =>
          this._voice(b, n, t, d * 0.95, { types: ['sawtooth', 'square'], vol: 0.04, cutoff: 1800, env: 0.8, detune: 9, vib: 10, send: 0.25, dist: 0.35 }),
        );
      if ((bar === 4 || bar === 8) && s === 0) this._siren(b, t, six * 32, 60, 72, 0.025);
      if (ci === 3 && s >= 12) this._tom(b, [48, 45, 41, 38][s - 12], t, 0.2);
    } else if (sec === 'break') {
      if (bar === 12 && s === 0) {
        this._impact(b, t, 0.5);
        this._crash(b, t, 0.05);
      }
      if (s % 4 === 0) this._voice(b, 96, t, 0.015, { types: ['sine'], vol: 0.025, cutoff: 9000 });
      if (Math.random() < 0.1) this._metal(b, t, 0.025, 0.5 + Math.random(), 0.7);
    } else {
      // rufo crescendo até voltar o caos
      const k = ((bar - 14) * 16 + s) / 32;
      this._snare(b, t, 0.03 + k * 0.12);
      if (s % 4 === 0) this._kick(b, t, 0.3 + k * 0.2);
      if (bar === 15 && s >= 8) this._tom(b, [52, 50, 48, 45, 43, 41, 38, 36][s - 8], t, 0.18);
    }
    if (s === 0 && (bar === 4 || bar === 8)) this._crash(b, t, 0.05);
    m.step++;
    m.next = t + six;
  }

  _labEpic(m, t) {
    const six = 60 / BPM.labEpic / 4;
    const s = m.step % 16;
    const bar = Math.floor(m.step / 16) % 24;
    const [root, tri] = [
      [50, [0, 3, 7]],
      [46, [0, 4, 7]],
      [43, [0, 3, 7]],
      [45, [0, 4, 7]],
    ][bar % 4];
    const sec = bar < 4 ? 'intro' : bar < 12 ? 'rise' : 'theme';
    const b = m.bus;
    // cordas: acorde grave que respira a cada compasso
    if (s === 0) {
      this._strings(b, [root - 12, root + tri[1], root + tri[2], root + 12], t, six * 15, sec === 'intro' ? 0.02 : 0.024, sec === 'theme' ? 2200 : 1500);
      this._timpani(b, root - 24, t, sec === 'intro' ? 0.25 : 0.32);
    }
    if (sec === 'intro' && bar % 2 === 1 && s >= 12) this._timpani(b, root - 24, t, 0.05 + (s - 12) * 0.03); // rufo
    if (sec !== 'intro') {
      // ostinato grave das cordas em colcheias
      if (s % 2 === 0) {
        const pat = [0, 7, 12, 7, 0, 7, 12, tri[1] + 12];
        this._voice(b, root - 12 + pat[s / 2], t, six * 1.6, { types: ['sawtooth', 'sawtooth'], vol: 0.03, cutoff: 900, env: 0.8, detune: 10, attack: 0.02 });
      }
      // pulso distorcido em semicolcheias com trítono no fim do compasso
      const off = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 6, 6, 1, 0][s];
      this._voice(b, root - 24 + off, t, six * 0.8, { types: ['sawtooth', 'square'], vol: 0.05, cutoff: 230 + (s / 16) * 250, env: 2.5, q: 5, dist: 0.6 });
      // trêmolo agudo das cordas
      if (sec === 'theme') this._voice(b, root + 24 + (bar % 2), t, six * 0.9, { types: ['sawtooth', 'sawtooth'], vol: 0.008, cutoff: 2600, detune: 14, pan: s % 2 ? 0.3 : -0.3 });
      // percussão industrial em meio tempo
      if (s === 0 || s === 10) this._kick(b, t, 0.5);
      if (s === 8) {
        this._snare(b, t, 0.12);
        this._metal(b, t, 0.04, 0.85, 0.4);
      }
      if (s % 4 === 2) this._hat(b, t, 0.02);
      if (sec === 'theme' && s === 14 && Math.random() < 0.5) this._metal(b, t, 0.02, 1.3);
      if (s === 0 && (bar === 4 || bar === 12)) {
        this._impact(b, t, 0.4);
        this._crash(b, t, 0.05);
      }
    }
    if (bar === 11 && s >= 8) this._tom(b, [45, 45, 43, 43, 40, 40, 38, 38][s - 8], t, s % 2 ? 0.12 : 0.2);
    if (sec === 'theme') {
      this._melody(EPIC[(bar - 12) % 8], s, t, six, (n, d) => {
        this._voice(b, n, t, d * 0.95, { types: ['sawtooth', 'sawtooth', 'square'], vol: 0.04, cutoff: 2000, env: 0.5, detune: 11, attack: 0.05, vib: 12, send: 0.25, release: 0.3, dist: 0.25 });
        // cordas dobrando a melodia uma oitava abaixo
        this._voice(b, n - 12, t, d, { types: ['sawtooth', 'sawtooth', 'sawtooth'], vol: 0.02, cutoff: 1600, detune: 14, attack: 0.18, release: 0.6, vib: 10 });
      });
    }
    m.step++;
    m.next = t + six;
  }
}
