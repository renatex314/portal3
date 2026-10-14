// Efeitos sonoros do jogo, sintetizados (Web Audio) sobre o mesmo contexto
// da trilha sonora — com cara de ficção científica: FM, varreduras de filtro,
// estalos elétricos, servos e campos de energia. Além dos efeitos de um tiro
// só, há "laços" contínuos (zumbido do campo da arma, ambiente do laboratório,
// laser, funil, buraco negro) cujo volume o jogo ajusta a cada quadro.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Gravações reais (pacotes de efeitos de domínio público CC0 — veja public/sfx/LEIA-ME.txt).
// Cada nome aponta para um ou mais arquivos; um é sorteado a cada vez. Se algum
// arquivo não carregar, o efeito usa a versão sintetizada.
const seq = (base, n, ext = 'ogg') => Array.from({ length: n }, (_, i) => `${base}_${String(i).padStart(3, '0')}.${ext}`);
const n3 = (base, ...ns) => ns.map((i) => `${base}_${String(i).padStart(3, '0')}.ogg`);
export const SAMPLES = {
  // arma de portais
  shot: seq('laserLarge', 5), // disparo
  open: seq('forceField', 5), // portal abrindo; pegar/soltar
  fail: seq('impactMetal', 5), // superfície que não aceita portal
  fizzle: ['computerNoise_000.ogg', 'computerNoise_002.ogg'], // grade apagando os portais
  pass: ['spaceEngineLow_000.ogg', 'spaceEngineLow_003.ogg'], // atravessar um portal
  toss: ['laserRetro_002.ogg', 'laserRetro_004.ogg'], // arremesso
  hum: ['spaceEngineSmall_000.ogg'], // campo da arma segurando (laço)
  // passos e pousos
  stepConcrete: seq('footstep_concrete', 5),
  stepMetal: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map((i) => `metal_steps_${String(i).padStart(2, '0')}.wav`),
  stepGlass: n3('impactGlass_light', 0, 1, 2),
  land: n3('impactPlate_medium', 0, 1, 2),
  // mecanismos
  btnDown: n3('click', 1, 2, 3),
  btnUp: n3('switch', 1, 3, 5),
  door: seq('doorOpen', 3),
  hiss: ['thrusterFire_000.ogg', 'thrusterFire_002.ogg'],
  chime: ['confirmation_002.ogg', 'confirmation_003.ogg'],
  plate: n3('impactMetal_heavy', 0, 1, 2),
  denied: n3('error', 1, 3, 5),
  tick: n3('tick', 1, 2),
  // torretas
  turret: seq('laserSmall', 5),
  spot: ['threeTone1.ogg', 'twoTone1.ogg'],
  lost: ['phaserDown1.ogg', 'phaserDown2.ogg'],
  down: ['zapThreeToneDown.ogg', 'lowDown.ogg'],
  // energia, laser, tempo, vácuo
  launch: ['phaserUp3.ogg', 'phaserUp5.ogg'],
  bounce: ['zap1.ogg', 'zap2.ogg'],
  caught: ['powerUp5.ogg', 'powerUp7.ogg'],
  pop: n3('explosionCrunch', 0, 2),
  burn: n3('explosionCrunch', 1, 3),
  laserOn: ['powerUp9.ogg', 'powerUp11.ogg'],
  sizzle: ['zap1.ogg', 'zapTwoTone.ogg'],
  funnelIn: ['phaserUp1.ogg', 'phaserUp6.ogg'],
  timeShift: ['phaseJump1.ogg', 'phaseJump3.ogg', 'phaseJump5.ogg'],
  boom: seq('lowFrequency_explosion', 2),
  death: seq('explosionCrunch', 5),
  // recompensas e tempo lento
  gem: ['powerUp3.ogg', 'powerUp4.ogg'],
  win: ['powerUp10.ogg', 'powerUp12.ogg'],
  slowIn: ['lowDown.ogg'],
  slowOut: ['highUp.ogg'],
  heart: n3('impactSoft_heavy', 0, 1),
  // laços (ambientes)
  laserLoop: ['spaceEngineSmall_003.ogg'],
  funnelLoop: ['forceField_002.ogg'],
  bhLoop: ['lowFrequency_explosion_000.ogg'],
  bhLoop2: ['spaceEngineLow_001.ogg'],
  wind: ['wind.ogg'],
  // criaturas
  roar: ['t-rex_calls.mp3'],
};

// trechos do arquivo de chamados de T-rex (início, duração em s), achados pela energia do sinal
const ROARS = [
  [26.35, 3.4],
  [36.6, 3.4],
  [4.25, 3.0],
  [10.5, 3.0],
];
const CHIRPS = [
  [0.3, 1.1],
  [2.4, 0.9],
];

export class Sfx {
  constructor(sound) {
    this.sound = sound;
    this.loops = new Map();
    this.stepSide = 1;
    this.bufs = {};
    this.loading = false;
    this.ready = false; // todas as gravações carregadas (ou falharam): os laços só começam depois
  }

  get ok() {
    if (this.sound.ctx && !this.loading) this._load();
    return !!this.sound.ctx;
  }

  /** baixa e decodifica as gravações (uma vez, quando o áudio liga) */
  _load() {
    this.loading = true;
    const jobs = [];
    for (const [name, files] of Object.entries(SAMPLES))
      files.forEach((f, i) =>
        jobs.push(
          fetch(`sfx/${f}`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
            .then((b) => this.sound.ctx.decodeAudioData(b))
            .then((buf) => ((this.bufs[name] ??= [])[i] = buf))
            .catch(() => {}),
        ),
      );
    Promise.all(jobs).then(() => (this.ready = true));
  }

  /**
   * Toca uma gravação (se já carregou). `rate` muda a altura/velocidade,
   * `jitter` sorteia uma variação em volta dela. Devolve false se não tocou
   * (aí quem chamou usa o som sintetizado).
   */
  sample(name, { vol = 0.5, rate = 1, jitter = 0.04, dest, delay = 0, filter = null, dur = 0, from = 0 } = {}) {
    const list = this.bufs[name]?.filter(Boolean);
    if (!list?.length) return false;
    const ctx = this.sound.ctx;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = src;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(dest ?? this.sound.sfx);
    const t0 = ctx.currentTime + delay;
    if (dur) {
      // só um trecho, com entrada e saída suaves
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur / 4));
      g.gain.setValueAtTime(vol, t0 + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.start(t0, from);
      src.stop(t0 + dur + 0.05);
    } else src.start(t0, from);
    return true;
  }

  get t() {
    return this.sound.ctx.currentTime;
  }

  _env(node, t, a, peak, d, dest = this.sound.sfx) {
    const g = this.sound.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g).connect(dest);
    return g;
  }

  _osc(type, f0, f1, t, dur, peak = 0.3, a = 0.005, dest) {
    const o = this.sound.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    this._env(o, t, a, peak, dur, dest);
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  }

  /** síntese FM: portadora f0→f1 modulada por razão `ratio` com índice que decai */
  _fm(f0, f1, t, dur, { ratio = 1.5, index = 4, peak = 0.12, a = 0.004, type = 'sine', dest } = {}) {
    const ctx = this.sound.ctx;
    const car = ctx.createOscillator();
    car.type = type;
    car.frequency.setValueAtTime(f0, t);
    car.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const mod = ctx.createOscillator();
    mod.frequency.setValueAtTime(f0 * ratio, t);
    mod.frequency.exponentialRampToValueAtTime(Math.max(f1 * ratio, 1), t + dur);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f0 * index, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(f1 * 0.05, 1), t + dur);
    mod.connect(mg).connect(car.frequency);
    this._env(car, t, a, peak, dur, dest);
    car.start(t);
    mod.start(t);
    car.stop(t + a + dur + 0.05);
    mod.stop(t + a + dur + 0.05);
  }

  _noise(t, dur, type, f0, f1, peak = 0.3, q = 1, dest) {
    const ctx = this.sound.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.sound.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    s.connect(f);
    this._env(f, t, 0.01, peak, dur, dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.1);
  }

  /** estalos elétricos: rajadas curtíssimas de ruído espalhadas em `dur` s */
  _crackle(t, dur, n, peak = 0.12) {
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * dur;
      this._noise(tt, 0.012 + Math.random() * 0.02, 'bandpass', 2000 + Math.random() * 5000, 1500, peak * (0.4 + Math.random() * 0.6), 3);
    }
  }

  /** brilho agudo com tremolo (cauda "cintilante") */
  _shimmer(f, t, dur, peak = 0.03) {
    const ctx = this.sound.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const trem = ctx.createOscillator();
    trem.frequency.value = 18;
    const tg = ctx.createGain();
    tg.gain.value = 0.5;
    const g = this._env(o, t, 0.02, peak, dur);
    trem.connect(tg).connect(g.gain);
    o.start(t);
    trem.start(t);
    o.stop(t + dur + 0.1);
    trem.stop(t + dur + 0.1);
  }

  // ------------------------------------------------------------------ laços contínuos
  /**
   * Som contínuo com volume controlado pelo jogo (0..1). `build(ctx, out)`
   * liga as fontes ao nó `out`; devolve { set(v, extra) } — `extra` permite
   * mudar timbre (ex.: altura do zumbido).
   */
  loop(name, build, max = 0.2) {
    if (!this.ok) return { set() {} };
    if (!this.loops.has(name)) {
      const ctx = this.sound.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.sound.sfx);
      const ctl = build(ctx, out) ?? {};
      const entry = {
        v: 0,
        set: (v, extra) => {
          entry.v = v;
          out.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * max, ctx.currentTime, 0.08);
          ctl.tune?.(extra, ctx.currentTime);
        },
      };
      this.loops.set(name, entry);
    }
    return this.loops.get(name);
  }

  _noiseSrc(ctx) {
    const s = ctx.createBufferSource();
    s.buffer = this.sound.noiseBuf;
    s.loop = true;
    s.start();
    return s;
  }

  /**
   * Toca `buf` em laço sem emenda audível: cada cópia entra e sai com fade e
   * a próxima começa antes de a anterior acabar. Só gasta processamento
   * enquanto o laço `name` está audível.
   */
  _xloop(buf, dest, name, rate = 1, fade = 0.6) {
    const ctx = this.sound.ctx;
    const dur = buf.duration / rate;
    const f = Math.min(fade, dur / 3);
    let next = 0;
    const spawn = (t) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + f);
      g.gain.setValueAtTime(1, t + dur - f);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      src.connect(g).connect(dest);
      src.start(t);
      src.stop(t + dur + 0.05);
    };
    setInterval(() => {
      const on = (this.loops.get(name)?.v ?? 0) > 0.01;
      const now = ctx.currentTime;
      if (!on) {
        next = 0;
        return;
      }
      if (next < now) next = now;
      while (next < now + 0.8) {
        spawn(next);
        next += dur - f;
      }
    }, 200);
  }

  /**
   * Laço feito de uma gravação (`key` em SAMPLES). Devolve false se ela ainda
   * não carregou (quem chamou usa a versão sintetizada).
   */
  _sloop(name, key, v, { max = 0.2, rate = 1, fade = 0.6, filter = null, tune = null, extra } = {}) {
    const buf = this.bufs[key]?.find(Boolean);
    if (!buf) return false;
    this.loop(
      name,
      (ctx, out) => {
        let dest = out;
        let f = null;
        if (filter) {
          f = ctx.createBiquadFilter();
          f.type = filter.type;
          f.frequency.value = filter.freq;
          f.Q.value = filter.q ?? 0.7;
          f.connect(out);
          dest = f;
        }
        this._xloop(buf, dest, name, rate, fade);
        return { tune: (d, t) => tune?.(f, d, t) };
      },
      max,
    ).set(v, extra);
    return true;
  }

  /** zumbido do campo da arma segurando um objeto (gravação em laço; sintetizado enquanto não carrega) */
  hold(v) {
    if (!this.ready) return;
    if (this.bufs.hum?.[0]) {
      this.loop(
        'holdS',
        (ctx, out) => {
          const src = ctx.createBufferSource();
          src.buffer = this.bufs.hum[0];
          src.loop = true;
          src.playbackRate.value = 1.35;
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 900;
          f.Q.value = 0.8;
          src.connect(f).connect(out);
          src.start();
        },
        0.16,
      ).set(v);
      this.loops.get('hold')?.set(0);
      return;
    }
    this.loop(
      'hold',
      (ctx, out) => {
        const a = ctx.createOscillator();
        a.type = 'sawtooth';
        a.frequency.value = 92;
        const b = ctx.createOscillator();
        b.type = 'sawtooth';
        b.frequency.value = 92.7;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 600;
        f.Q.value = 6;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 3.1;
        const lg = ctx.createGain();
        lg.gain.value = 250;
        lfo.connect(lg).connect(f.frequency);
        a.connect(f);
        b.connect(f);
        f.connect(out);
        for (const o of [a, b, lfo]) o.start();
      },
      0.07,
    ).set(v);
  }

  /** chiado do laser (volume pela distância até o feixe mais próximo) */
  laserHum(v) {
    if (!this.ready) return;
    if (this._sloop('laserS', 'laserLoop', v, { max: 0.09, rate: 1.7, filter: { type: 'bandpass', freq: 1400, q: 1.2 } })) return this.loops.get('laser')?.set(0);
    this.loop(
      'laser',
      (ctx, out) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 220;
        const o2 = ctx.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.value = 331;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1800;
        f.Q.value = 2;
        o.connect(f);
        o2.connect(f);
        const n = this._noiseSrc(ctx);
        const nf = ctx.createBiquadFilter();
        nf.type = 'highpass';
        nf.frequency.value = 5000;
        const ng = ctx.createGain();
        ng.gain.value = 0.4;
        n.connect(nf).connect(ng).connect(out);
        f.connect(out);
        o.start();
        o2.start();
      },
      0.05,
    ).set(v);
  }

  /** zumbido do funil de excursão; `extra` = 1 normal, −1 invertido (muda a altura) */
  funnelHum(v, dir = 1) {
    if (!this.ready) return;
    if (this._sloop('funnelS', 'funnelLoop', v, { max: 0.12, rate: 0.85, fade: 0.3, extra: dir, tune: (f, d) => f && (f.frequency.value = d < 0 ? 500 : 1500), filter: { type: 'lowpass', freq: 1500 } })) return this.loops.get('funnel')?.set(0);
    this.loop(
      'funnel',
      (ctx, out) => {
        const os = [110, 165, 220.5].map((f) => {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.connect(out);
          o.start();
          return o;
        });
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.8;
        const lg = ctx.createGain();
        lg.gain.value = 0.25;
        lfo.connect(lg).connect(out.gain);
        lfo.start();
        return {
          tune: (d, t) => os.forEach((o, i) => o.frequency.setTargetAtTime([110, 165, 220.5][i] * (d < 0 ? 0.84 : 1), t, 0.2)),
        };
      },
      0.06,
    ).set(v, dir);
  }

  /** rugido grave do buraco negro */
  blackHole(v) {
    if (!this.ready) return;
    if (this._sloop('bhS', 'bhLoop', v, { max: 0.55, rate: 0.55, fade: 0.7 })) {
      this._sloop('bhS2', 'bhLoop2', v, { max: 0.5, rate: 0.5, fade: 0.9, filter: { type: 'lowpass', freq: 220 } });
      return this.loops.get('bh')?.set(0);
    }
    this.loop(
      'bh',
      (ctx, out) => {
        const n = this._noiseSrc(ctx);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 140;
        f.Q.value = 3;
        n.connect(f).connect(out);
        const o = ctx.createOscillator();
        o.frequency.value = 31;
        const og = ctx.createGain();
        og.gain.value = 0.8;
        o.connect(og).connect(out);
        o.start();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.37;
        const lg = ctx.createGain();
        lg.gain.value = 60;
        lfo.connect(lg).connect(f.frequency);
        lfo.start();
      },
      0.5,
    ).set(v);
  }

  /** vento forte (vácuo do portal para a Lua) */
  gale(v) {
    if (!this.ready) return;
    if (this._sloop('galeS', 'wind', v, { max: 0.5, rate: 1.1, filter: { type: 'lowpass', freq: 2400 } })) return this.loops.get('gale')?.set(0);
    this.loop(
      'gale',
      (ctx, out) => {
        const n = this._noiseSrc(ctx);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 700;
        f.Q.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.6;
        const lg = ctx.createGain();
        lg.gain.value = 400;
        lfo.connect(lg).connect(f.frequency);
        lfo.start();
        n.connect(f).connect(out);
      },
      0.45,
    ).set(v);
  }

  /** vento da velocidade (0..1): gravação em laço, mais agudo e forte quanto mais rápido; false se ainda não carregou */
  wind(v) {
    if (!this.ready) return true; // (ainda carregando: silêncio, sem o vento sintetizado)
    return this._sloop('windS', 'wind', v * v, {
      max: 0.5,
      rate: 0.8,
      fade: 0.5,
      extra: v,
      tune: (f, d) => f && (f.frequency.value = 500 + (d ?? 0) * 3500),
      filter: { type: 'lowpass', freq: 800, q: 0.5 },
    });
  }

  /** desliga todos os laços (troca de fase / pausa) */
  silenceLoops() {
    for (const l of this.loops.values()) l.set(0);
  }

  // ------------------------------------------------------------------ arma de portais
  shot(blue) {
    if (!this.ok) return;
    const t = this.t;
    // gravação: o azul um pouco mais agudo que o laranja (como cada portal tem sua "voz")
    if (this.sample('shot', { vol: 0.42, rate: blue ? 1.12 : 0.86 })) {
      this._osc('sine', 150, 50, t, 0.16, 0.12); // soco grave por baixo
      return;
    }
    const f = blue ? 1500 : 1050;
    this._fm(f, f * 0.22, t, 0.24, { ratio: 1.41, index: 6, peak: 0.12 });
    this._osc('sine', 160, 50, t, 0.18, 0.18);
    this._noise(t, 0.08, 'highpass', 5000, 9000, 0.09);
    this._shimmer(blue ? 2637 : 2093, t + 0.04, 0.35, 0.02);
  }

  open(blue) {
    if (!this.ok) return;
    if (this.sample('open', { vol: 0.3, rate: blue ? 1.15 : 0.92, delay: 0.04 })) return;
    const t = this.t + 0.04;
    const base = blue ? 196 : 147;
    const ctx = this.sound.ctx;
    // vórtice: três serras desafinadas com o filtro abrindo
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 8;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.8);
    this._env(f, t, 0.03, 0.06, 0.8);
    for (const d of [0.99, 1, 1.013]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * d, t);
      o.frequency.exponentialRampToValueAtTime(base * 2 * d, t + 0.6);
      o.connect(f);
      o.start(t);
      o.stop(t + 0.9);
    }
    this._osc('sine', 60, 110, t, 0.5, 0.15, 0.02);
    for (let i = 0; i < 5; i++) this._osc('sine', 2000 + Math.random() * 2500, 3000, t + 0.1 + i * 0.05, 0.08, 0.02);
  }

  /** o tiro bateu numa superfície que não aceita portal */
  fail() {
    if (!this.ok) return;
    if (this.sample('fail', { vol: 0.35, rate: 1.1, jitter: 0.08 })) return;
    const t = this.t;
    this._osc('square', 300, 120, t, 0.08, 0.04);
    this._noise(t, 0.08, 'bandpass', 2500, 900, 0.08, 3);
  }

  fizzle() {
    if (!this.ok) return;
    if (this.sample('fizzle', { vol: 0.35, rate: 1.3, dur: 0.55, from: Math.random() * 3 })) {
      this._fm(700, 90, this.t, 0.4, { ratio: 2.7, index: 8, peak: 0.04, type: 'square' });
      return;
    }
    const t = this.t;
    this._crackle(t, 0.45, 18, 0.16);
    this._fm(700, 90, t, 0.4, { ratio: 2.7, index: 8, peak: 0.06, type: 'square' });
    this._noise(t, 0.4, 'bandpass', 4000, 400, 0.12, 5);
  }

  /** passagem por um portal: dobra de fase */
  whoosh() {
    if (!this.ok) return;
    if (this.sample('pass', { vol: 0.32, rate: 1.7, dur: 0.6, from: Math.random() * 3, filter: { type: 'highpass', freq: 220 } })) return;
    const t = this.t;
    this._noise(t, 0.45, 'bandpass', 3500, 300, 0.2, 2.5);
    this._osc('sine', 220, 55, t, 0.4, 0.12);
    this._fm(900, 300, t, 0.3, { ratio: 0.5, index: 2, peak: 0.04 });
  }

  // ------------------------------------------------------------------ mecanismos
  click(down) {
    if (!this.ok) return;
    if (this.sample(down ? 'btnDown' : 'btnUp', { vol: 0.45, rate: down ? 0.9 : 1.1 })) return;
    const t = this.t;
    // servo + trava
    this._osc('square', down ? 420 : 620, down ? 210 : 900, t, 0.09, 0.05);
    this._osc('sine', down ? 90 : 120, 50, t, 0.12, 0.2);
    this._noise(t, 0.04, 'highpass', 3000, 5000, 0.08);
    this._osc('sine', down ? 1318 : 1760, down ? 1318 : 1760, t + 0.1, 0.12, 0.03);
  }

  door() {
    if (!this.ok) return;
    if (this.sample('door', { vol: 0.55, rate: 0.6, jitter: 0.03 })) {
      this.sample('hiss', { vol: 0.2, rate: 1.2, dur: 0.7, from: 0.2 });
      this.sample('chime', { vol: 0.2, delay: 0.85 });
      return;
    }
    const t = this.t;
    // hidráulica (chiado) + servo subindo + sinal de duas notas
    this._noise(t, 0.6, 'highpass', 6000, 2500, 0.06, 0.8);
    const o = this._osc('sawtooth', 70, 140, t + 0.1, 1.0, 0.05, 0.1);
    const ctx = this.sound.ctx;
    const vib = ctx.createOscillator();
    vib.frequency.value = 9;
    const vg = ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg).connect(o.frequency);
    vib.start(t);
    vib.stop(t + 1.2);
    this._noise(t + 0.1, 1.0, 'lowpass', 300, 150, 0.1);
    this._osc('sine', 988, 988, t + 1.1, 0.15, 0.04);
    this._osc('sine', 1319, 1319, t + 1.22, 0.3, 0.04);
  }

  pick() {
    if (!this.ok) return;
    if (this.sample('open', { vol: 0.22, rate: 1.6, dur: 0.35 })) return;
    const t = this.t;
    this._fm(200, 700, t, 0.2, { ratio: 2, index: 3, peak: 0.07 });
    this._noise(t, 0.15, 'bandpass', 800, 3000, 0.05, 4);
  }

  drop() {
    if (!this.ok) return;
    if (this.sample('open', { vol: 0.18, rate: 0.7, dur: 0.3 })) return;
    const t = this.t;
    this._fm(600, 180, t, 0.18, { ratio: 2, index: 3, peak: 0.06 });
  }

  /** passo: bota com solado de metal; `mat` do chão muda o timbre */
  step(mat = 'white', speed = 1) {
    if (!this.ok) return;
    const key = mat === 'metal' || mat === 'stripe' ? 'stepMetal' : mat === 'glass' ? 'stepGlass' : 'stepConcrete';
    if (this.sample(key, { vol: 0.3 + Math.min(speed, 1.5) * 0.22, rate: mat === 'rock' || mat === 'moon' ? 0.85 : 1, jitter: 0.07 })) return;
    const t = this.t;
    this.stepSide = -this.stepSide;
    const p = 1 + this.stepSide * 0.04 + (Math.random() - 0.5) * 0.06;
    const v = 0.55 + Math.min(speed, 1.5) * 0.3;
    this._osc('sine', 110 * p, 48 * p, t, 0.1, 0.22 * v);
    this._noise(t, 0.05, 'bandpass', 1800 * p, 900, 0.07 * v, 1.5);
    if (mat === 'metal') {
      // chapa: anel metálico curto (dois parciais desafinados)
      this._osc('sine', 1180 * p, 1150 * p, t, 0.14, 0.025 * v);
      this._osc('sine', 1730 * p, 1700 * p, t, 0.1, 0.018 * v);
    } else if (mat === 'glass') this._osc('sine', 2400 * p, 2380 * p, t, 0.12, 0.02 * v);
    else this._noise(t, 0.07, 'lowpass', 700, 200, 0.06 * v);
    // servo da armadura da perna, bem baixinho
    this._osc('square', 900 * p, 1100 * p, t + 0.02, 0.05, 0.006 * v);
  }

  land(strength) {
    if (!this.ok) return;
    {
      const k = Math.min(strength / 15, 1);
      if (this.sample('land', { vol: 0.35 + k * 0.5, rate: 1.1 - k * 0.3 })) return;
    }
    const t = this.t;
    const k = Math.min(strength / 15, 1);
    this._osc('sine', 120, 35, t, 0.25, 0.25 + k * 0.3);
    this._noise(t, 0.22, 'lowpass', 900, 120, 0.1 + k * 0.3);
    // amortecedores da bota
    this._osc('sawtooth', 300, 180 + k * 200, t + 0.03, 0.18, 0.015 + k * 0.03);
  }

  death() {
    if (!this.ok) return;
    if (this.sample('death', { vol: 0.6, rate: 0.9 })) {
      this.sample('boom', { vol: 0.5, rate: 0.9, delay: 0.05 });
      return;
    }
    const t = this.t;
    this._fm(800, 40, t, 1.2, { ratio: 1.5, index: 10, peak: 0.12, type: 'sawtooth' });
    this._crackle(t, 0.6, 20, 0.15);
    this._noise(t, 1.4, 'lowpass', 2500, 80, 0.4);
    this._osc('sine', 70, 25, t, 1.4, 0.4);
  }

  // ------------------------------------------------------------------ torretas
  turretShot(dist) {
    if (!this.ok) return;
    {
      const v = Math.max(0.03, 0.22 - dist * 0.006);
      if (this.sample('turret', { vol: v * 2.4, rate: 1.9, jitter: 0.14 })) return;
    }
    const t = this.t;
    const v = Math.max(0.03, 0.22 - dist * 0.006);
    this._osc('square', 2600, 500, t, 0.06, v * 0.35);
    this._noise(t, 0.05, 'bandpass', 3000, 1200, v, 2);
    this._osc('sine', 140, 60, t, 0.06, v * 0.6);
  }

  /** alvo encontrado: três bipes subindo */
  turretSpot() {
    if (!this.ok) return;
    if (this.sample('spot', { vol: 0.28 })) return;
    const t = this.t;
    [76, 81, 88].forEach((m, i) => this._osc('square', mtof(m), mtof(m), t + i * 0.08, 0.06, 0.035));
  }

  /** procurando: dois bipes descendo */
  turretLost() {
    if (!this.ok) return;
    if (this.sample('lost', { vol: 0.25 })) return;
    const t = this.t;
    [84, 79].forEach((m, i) => this._osc('square', mtof(m), mtof(m), t + i * 0.12, 0.08, 0.025));
  }

  /** desligando: tremido descendo */
  turretDown() {
    if (!this.ok) return;
    if (this.sample('down', { vol: 0.35 })) return;
    const t = this.t;
    this._fm(1200, 120, t, 0.8, { ratio: 0.25, index: 3, peak: 0.06, type: 'square' });
    this._crackle(t, 0.4, 8, 0.08);
  }

  roar(dist = 0) {
    if (!this.ok) return;
    const v = Math.max(0.15, 1 - dist / 45);
    const [from, dur] = ROARS[Math.floor(Math.random() * ROARS.length)];
    if (this.sample('roar', { vol: 0.75 * v, from, dur, jitter: 0.06, filter: dist > 25 ? { type: 'lowpass', freq: 1800 } : null })) return;
    this.sound.roar(v, 1);
  }

  /** guincho de raptor (mascote) */
  chirp() {
    if (!this.ok) return;
    const [from, dur] = CHIRPS[Math.floor(Math.random() * CHIRPS.length)];
    if (this.sample('roar', { vol: 0.4, rate: 2.1, from, dur: dur / 2.1, jitter: 0.12 })) return;
    const t = this.t;
    this._osc('sawtooth', 900, 1500, t, 0.12, 0.05);
    this._osc('sawtooth', 1400, 700, t + 0.12, 0.18, 0.05);
  }

  gem() {
    if (!this.ok) return;
    if (this.sample('gem', { vol: 0.35 })) return;
    const t = this.t;
    [84, 88, 91, 96].forEach((m, i) => this._fm(mtof(m), mtof(m), t + i * 0.05, 0.6, { ratio: 3.5, index: 1.5, peak: 0.05 }));
  }

  win() {
    if (!this.ok) return;
    if (this.sample('win', { vol: 0.45 })) {
      this.sample('chime', { vol: 0.3, delay: 0.5 });
      return;
    }
    const t = this.t;
    [62, 69, 74, 78, 81].forEach((m, i) => this._fm(mtof(m), mtof(m), t + i * 0.09, 0.9, { ratio: 2, index: 1.2, peak: 0.06 }));
    this._osc('sine', 55, 110, t, 1.2, 0.12, 0.2);
  }

  // ---- tempo lento (passa por fora do filtro abafado, direto no master)
  slowIn() {
    if (!this.ok) return;
    if (this.sample('slowIn', { vol: 0.6, rate: 0.9, dest: this.sound.master })) return;
    const t = this.t;
    const m = this.sound.master;
    this._osc('sine', 420, 55, t, 0.9, 0.28, 0.01, m);
    this._osc('triangle', 210, 40, t, 1.1, 0.12, 0.01, m);
    this._noise(t, 0.9, 'lowpass', 3000, 120, 0.25, 1, m);
  }

  slowOut() {
    if (!this.ok) return;
    if (this.sample('slowOut', { vol: 0.5, dest: this.sound.master })) return;
    const t = this.t;
    const m = this.sound.master;
    this._osc('sine', 60, 480, t, 0.45, 0.22, 0.01, m);
    this._noise(t, 0.4, 'bandpass', 200, 3500, 0.2, 1.2, m);
  }

  heartbeat() {
    if (!this.ok) return;
    if (this.sample('heart', { vol: 0.75, rate: 0.65, dest: this.sound.master })) {
      this.sample('heart', { vol: 0.5, rate: 0.6, delay: 0.2, dest: this.sound.master });
      return;
    }
    const t = this.t;
    const m = this.sound.master;
    this._osc('sine', 70, 38, t, 0.18, 0.35, 0.005, m);
    this._osc('sine', 62, 34, t + 0.2, 0.2, 0.25, 0.005, m);
  }

  lowTime() {
    if (!this.ok) return;
    if (this.sample('tick', { vol: 0.4, rate: 1.8, dest: this.sound.master })) return;
    const t = this.t;
    this._osc('square', 1320, 1320, t, 0.06, 0.05, 0.003, this.sound.master);
  }

  denied() {
    if (!this.ok) return;
    if (this.sample('denied', { vol: 0.4 })) return;
    const t = this.t;
    // buzina com batimento (duas quadradas quase iguais)
    this._osc('square', 150, 140, t, 0.22, 0.05);
    this._osc('square', 157, 146, t, 0.22, 0.05);
  }

  // ---- bola de energia, grade e fornalha
  launch() {
    if (!this.ok) return;
    if (this.sample('launch', { vol: 0.3 })) return;
    const t = this.t;
    this._fm(150, 900, t, 0.35, { ratio: 1.5, index: 5, peak: 0.06, type: 'sawtooth' });
    this._noise(t + 0.3, 0.2, 'bandpass', 1500, 400, 0.12, 2);
  }

  bounce(dist) {
    if (!this.ok) return;
    {
      const v = Math.max(0.02, 0.16 - dist * 0.006);
      if (this.sample('bounce', { vol: v * 3, rate: 0.9 + Math.random() * 0.3 })) return;
    }
    const t = this.t;
    const v = Math.max(0.02, 0.16 - dist * 0.006);
    this._fm(520, 200, t, 0.16, { ratio: 1.33, index: 4, peak: v });
    this._noise(t, 0.06, 'highpass', 3000, 6000, v * 0.4);
  }

  caught() {
    if (!this.ok) return;
    if (this.sample('caught', { vol: 0.4 })) return;
    const t = this.t;
    [57, 64, 69, 76].forEach((m, i) => this._fm(mtof(m), mtof(m), t + i * 0.07, 0.7, { ratio: 2, index: 1, peak: 0.06 }));
    this._osc('sawtooth', 55, 220, t, 1.2, 0.05, 0.1);
  }

  pop() {
    if (!this.ok) return;
    if (this.sample('pop', { vol: 0.28, rate: 1.4 })) return;
    const t = this.t;
    this._noise(t, 0.5, 'lowpass', 4000, 200, 0.2);
    this._fm(600, 80, t, 0.4, { ratio: 3, index: 6, peak: 0.05 });
  }

  burn() {
    if (!this.ok) return;
    if (this.sample('burn', { vol: 0.5, rate: 0.9 })) {
      this.sample('hiss', { vol: 0.3, rate: 0.8, dur: 1.2, from: 0.2 });
      return;
    }
    const t = this.t;
    this._noise(t, 1.6, 'lowpass', 1800, 300, 0.35, 0.7);
    this._crackle(t, 1.2, 25, 0.1);
    this._osc('sawtooth', 80, 45, t, 1.4, 0.08, 0.05);
  }

  gun() {
    if (!this.ok) return;
    if (this.sample('open', { vol: 0.35, rate: 0.75 })) this.sample('shot', { vol: 0.25, rate: 1.3, delay: 0.35 });
    const t = this.t;
    this._fm(80, 1200, t, 0.8, { ratio: 1.5, index: 3, peak: 0.06, type: 'sawtooth' });
    [60, 67, 72, 79, 84].forEach((m, i) => this._fm(mtof(m), mtof(m), t + 0.5 + i * 0.06, 0.8, { ratio: 2, index: 1, peak: 0.05 }));
  }

  toss() {
    if (!this.ok) return;
    if (this.sample('toss', { vol: 0.3, rate: 0.9 })) return;
    const t = this.t;
    this._noise(t, 0.25, 'bandpass', 500, 2600, 0.16, 1.4);
    this._fm(400, 1200, t, 0.15, { ratio: 2, index: 3, peak: 0.05 });
  }

  // ---- mecânicas novas
  /** placa de lançamento: pistão pneumático + rajada */
  plate() {
    if (!this.ok) return;
    if (this.sample('plate', { vol: 0.55, rate: 0.9 })) {
      this.sample('hiss', { vol: 0.35, rate: 1.4, dur: 0.5, from: 0.2 });
      return;
    }
    const t = this.t;
    this._osc('sine', 90, 40, t, 0.25, 0.4);
    this._noise(t, 0.35, 'highpass', 1500, 6000, 0.15, 0.7);
    this._osc('square', 300, 900, t, 0.12, 0.03);
  }

  /** receptor de laser ligou */
  laserOn() {
    if (!this.ok) return;
    if (this.sample('laserOn', { vol: 0.35 })) return;
    const t = this.t;
    this._fm(220, 880, t, 0.5, { ratio: 2, index: 2, peak: 0.06 });
    this._osc('sine', 1760, 1760, t + 0.4, 0.4, 0.03);
  }

  /** queimadura do laser na pele (curto, repetido enquanto encosta) */
  sizzle() {
    if (!this.ok) return;
    if (this.sample('sizzle', { vol: 0.25, rate: 1.4, jitter: 0.15 })) return;
    const t = this.t;
    this._noise(t, 0.12, 'highpass', 3000, 6000, 0.12);
    this._crackle(t, 0.1, 3, 0.08);
  }

  /** entrou/saiu de um funil */
  funnelIn() {
    if (!this.ok) return;
    if (this.sample('funnelIn', { vol: 0.3 })) return;
    const t = this.t;
    this._osc('sine', 80, 220, t, 0.4, 0.15, 0.02);
    this._noise(t, 0.4, 'bandpass', 300, 1500, 0.08, 2);
  }

  /** salto no tempo: varredura dobrando para os dois lados + "prato ao contrário" */
  timeShift(toPast) {
    if (!this.ok) return;
    if (this.sample('timeShift', { vol: 0.5, rate: toPast ? 0.8 : 1.15, dest: this.sound.master })) {
      this.sample('boom', { vol: 0.35, rate: 1.4, delay: 0.45, dest: this.sound.master });
      return;
    }
    const t = this.t;
    const m = this.sound.master;
    this._fm(toPast ? 1600 : 120, toPast ? 120 : 1600, t, 0.7, { ratio: 1.01, index: 12, peak: 0.08, dest: m });
    const ctx = this.sound.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.sound.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    s.connect(f).connect(g).connect(m);
    s.start(t, Math.random());
    s.stop(t + 0.7);
    this._osc('sine', 50, 30, t + 0.5, 0.8, 0.4, 0.005, m);
  }

  /** chegou na Lua / voltou: estrondo e assobio de despressurização */
  vacuum() {
    if (!this.ok) return;
    if (this.sample('boom', { vol: 0.55, rate: 0.85 })) {
      this.sample('hiss', { vol: 0.4, rate: 0.7, dur: 1.4, from: 0.2 });
      return;
    }
    const t = this.t;
    this._noise(t, 1.2, 'bandpass', 2500, 300, 0.3, 1);
    this._osc('sine', 60, 25, t, 1.0, 0.4);
  }
}
