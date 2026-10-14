// Trilha sonora procedural (Web Audio): nada de arquivos de música — tudo é
// sintetizado ao vivo, então não há direitos autorais envolvidos.
//
// Climas ("moods"):
//   ground  — deserto: drone grave, vento e violão esparso
//   space   — espaço/física: pads largos em ré menor e sinos
//   doc     — Minas Gerais: arpejo de viola caipira (Karplus-Strong) em ré maior
//   descent — descida do poço: drone, "coração" e pings metálicos
//   ride    — dentro da cápsula: baixo pulsante a 120 bpm
// Efeitos: explosão, ronco da descida, vento da queda.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

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
    this._startDrones(mood);
    this.current = mood;
    this.moods.push(mood);
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
    }
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
}
