// Efeitos sonoros do jogo, sintetizados (Web Audio) sobre o mesmo contexto
// da trilha sonora.

export class Sfx {
  constructor(sound) {
    this.sound = sound;
  }

  get ok() {
    return !!this.sound.ctx;
  }

  _env(node, t, a, peak, d) {
    const g = this.sound.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g).connect(this.sound.sfx);
    return g;
  }

  _osc(type, f0, f1, t, dur, peak = 0.3, a = 0.005) {
    const o = this.sound.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    this._env(o, t, a, peak, dur);
    o.start(t);
    o.stop(t + a + dur + 0.05);
  }

  _noise(t, dur, type, f0, f1, peak = 0.3, q = 1) {
    const ctx = this.sound.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.sound.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    s.connect(f);
    this._env(f, t, 0.01, peak, dur);
    s.start(t, Math.random());
    s.stop(t + dur + 0.1);
  }

  shot(blue) {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    const base = blue ? 880 : 620;
    this._osc('sawtooth', base, base * 0.25, t, 0.22, 0.12);
    this._osc('sine', base * 2, base * 0.5, t, 0.18, 0.1);
    this._noise(t, 0.12, 'highpass', 3000, 6000, 0.08);
  }

  open(blue) {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime + 0.05;
    const base = blue ? 330 : 247;
    for (let i = 0; i < 3; i++) this._osc('sine', base * (1 + i * 0.5), base * (2 + i), t + i * 0.03, 0.5, 0.07);
    this._noise(t, 0.6, 'bandpass', 800, 3000, 0.08, 3);
  }

  fizzle() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._noise(t, 0.35, 'bandpass', 2500, 300, 0.25, 4);
    this._osc('square', 220, 80, t, 0.25, 0.05);
  }

  whoosh() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._noise(t, 0.5, 'bandpass', 400, 2000, 0.22, 1.2);
    this._osc('sine', 120, 520, t, 0.35, 0.06);
  }

  click(down) {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._osc('square', down ? 300 : 500, down ? 180 : 700, t, 0.08, 0.08);
    this._noise(t, 0.05, 'highpass', 2000, 3000, 0.1);
  }

  door() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._osc('sawtooth', 55, 70, t, 1.2, 0.08, 0.15);
    this._noise(t, 1.1, 'lowpass', 400, 200, 0.12);
    this._osc('sine', 880, 880, t + 1.1, 0.4, 0.05);
  }

  pick() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._osc('sine', 300, 600, t, 0.12, 0.08);
  }

  drop() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._osc('sine', 500, 220, t, 0.12, 0.08);
  }

  step() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._noise(t, 0.08, 'lowpass', 500, 150, 0.06);
  }

  land(strength) {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._noise(t, 0.2, 'lowpass', 600, 100, Math.min(0.1 + strength * 0.02, 0.5));
  }

  death() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    this._noise(t, 1.2, 'lowpass', 2000, 120, 0.5);
    this._osc('sawtooth', 160, 40, t, 1.0, 0.12);
  }

  turretShot(dist) {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    const v = Math.max(0.03, 0.22 - dist * 0.006);
    this._noise(t, 0.06, 'bandpass', 1800, 900, v, 2);
    this._osc('square', 180, 90, t, 0.05, v * 0.4);
  }

  gem() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    [84, 88, 91, 96].forEach((m, i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      this._osc('sine', f, f, t + i * 0.05, 0.5, 0.07);
    });
  }

  win() {
    if (!this.ok) return;
    const t = this.sound.ctx.currentTime;
    [62, 66, 69, 74, 78].forEach((m, i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      this._osc('triangle', f, f, t + i * 0.09, 0.7, 0.1);
    });
  }
}
