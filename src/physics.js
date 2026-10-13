// Física do "trem gravitacional": queda livre num túnel reto através da Terra.
//
// Tudo aqui é em unidades SI (metros, segundos). A cena 3D converte para a
// escala dela (raio da Terra = 100 unidades) só na hora de desenhar.

export const R_EARTH = 6371000; // m
export const G_SURFACE = 9.82; // m/s² (média na superfície)

// Gravidade dentro da Terra segundo o modelo PREM (Preliminary Reference
// Earth Model, Dziewonski & Anderson 1981). Pares [raio em km, g em m/s²].
// Repare que g AUMENTA um pouco ao descer pelo manto (o núcleo de ferro é
// muito denso) e só depois cai até zero no centro.
const PREM_G = [
  [0, 0],
  [600, 2.17],
  [1221.5, 4.4],
  [1500, 5.33],
  [2000, 6.85],
  [2500, 8.18],
  [3000, 9.42],
  [3480, 10.68],
  [3800, 10.47],
  [4200, 10.25],
  [4600, 10.1],
  [5000, 10.0],
  [5400, 9.96],
  [5701, 9.99],
  [5971, 10.0],
  [6151, 9.92],
  [6371, 9.82],
];

function premG(r) {
  const km = Math.min(Math.max(r, 0), R_EARTH) / 1000;
  for (let i = 1; i < PREM_G.length; i++) {
    const [r1, g1] = PREM_G[i];
    if (km <= r1) {
      const [r0, g0] = PREM_G[i - 1];
      const t = (km - r0) / (r1 - r0);
      return g0 + (g1 - g0) * t;
    }
  }
  return G_SURFACE;
}

function uniformG(r) {
  return (G_SURFACE * Math.min(Math.max(r, 0), R_EARTH)) / R_EARTH;
}

function buildModel(id, name, short, g) {
  // Tabela do potencial gravitacional U(r) = ∫₀ʳ g dr  (por kg, zero no centro).
  const N = 4000;
  const U = new Float64Array(N + 1);
  const dr = R_EARTH / N;
  for (let i = 1; i <= N; i++) {
    const a = g((i - 1) * dr);
    const b = g(i * dr);
    U[i] = U[i - 1] + 0.5 * (a + b) * dr;
  }
  const potential = (r) => {
    const x = (Math.min(Math.max(r, 0), R_EARTH) / R_EARTH) * N;
    const i = Math.min(Math.floor(x), N - 1);
    const f = x - i;
    return U[i] + (U[i + 1] - U[i]) * f;
  };
  const model = { id, name, short, g, potential, Umax: U[N] };
  // Velocidade máxima (no centro) pela conservação de energia: ½v² = U(R) − U(0)
  model.vmax = Math.sqrt(2 * U[N]);
  model.halfPeriod = measureHalfPeriod(model, 0);
  return model;
}

export const MODELS = {};
MODELS.uniform = buildModel('uniform', 'Terra uniforme (didático)', 'Uniforme', uniformG);
MODELS.prem = buildModel('prem', 'Terra real (modelo PREM)', 'Real (PREM)', premG);

// Aceleração ao longo de um túnel reto (corda) que passa a uma distância `d`
// do centro. `s` é a posição ao longo do túnel, medida a partir do ponto do
// túnel mais próximo do centro. Só a componente da gravidade paralela ao
// túnel acelera a cápsula: g(r) · s / r.
function accel(model, s, d) {
  const r = Math.hypot(s, d);
  if (r < 1e-9) return 0;
  return (-model.g(r) * s) / r;
}

function measureHalfPeriod(model, d) {
  const L = Math.sqrt(R_EARTH * R_EARTH - d * d);
  let s = -L;
  let v = 0;
  let t = 0;
  const dt = 0.25;
  while (t < 20000) {
    const prevV = v;
    [s, v] = rk4(model, s, v, d, dt);
    t += dt;
    if (s > 0 && v <= 0) {
      // interpolação linear do instante em que v cruzou zero
      return t - dt * (v / (v - prevV));
    }
  }
  return t;
}

function rk4(model, s, v, d, dt) {
  const a1 = accel(model, s, d);
  const s2 = s + 0.5 * dt * v;
  const v2 = v + 0.5 * dt * a1;
  const a2 = accel(model, s2, d);
  const s3 = s + 0.5 * dt * v2;
  const v3 = v + 0.5 * dt * a2;
  const a3 = accel(model, s3, d);
  const s4 = s + dt * v3;
  const v4 = v + dt * a3;
  const a4 = accel(model, s4, d);
  return [
    s + (dt / 6) * (v + 2 * v2 + 2 * v3 + v4),
    v + (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4),
  ];
}

/**
 * Uma cápsula caindo, a partir do repouso, num túnel reto e sem ar.
 * `d` = distância do túnel ao centro da Terra (0 = túnel pelo centro).
 */
export class FallSim {
  constructor(model = MODELS.uniform, d = 0) {
    this.model = model;
    this.d = d;
    this.reset();
  }

  get L() {
    return Math.sqrt(R_EARTH * R_EARTH - this.d * this.d);
  }

  reset() {
    this.s = -this.L;
    this.v = 0;
    this.t = 0;
    this.trips = 0; // quantas vezes já chegou de um lado ao outro
    this._lastSign = -1;
  }

  setModel(model) {
    this.model = model;
  }

  step(dt) {
    // sub-passos de no máximo 1 s de tempo simulado: precisão de sobra
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(remaining, 1);
      const prevV = this.v;
      [this.s, this.v] = rk4(this.model, this.s, this.v, this.d, h);
      this.t += h;
      remaining -= h;
      if (Math.sign(this.v) !== Math.sign(prevV) && prevV !== 0) this.trips++;
    }
    const L = this.L;
    if (this.s > L) this.s = L;
    if (this.s < -L) this.s = -L;
  }

  get r() {
    return Math.hypot(this.s, this.d);
  }
  get depth() {
    return R_EARTH - this.r;
  }
  /** intensidade da gravidade no ponto (m/s²) */
  get g() {
    return this.model.g(this.r);
  }
  /** componente da gravidade ao longo do túnel (m/s², com sinal) */
  get a() {
    return accel(this.model, this.s, this.d);
  }
  /** energia por kg, normalizada: { pot, kin } somando ~1 */
  get energy() {
    const total = this.model.Umax - this.model.potential(Math.hypot(0, this.d));
    const pot = this.model.potential(this.r) - this.model.potential(this.d);
    const kin = 0.5 * this.v * this.v;
    return { pot: pot / total, kin: kin / total };
  }
}

/** Velocidade e período de um satélite em órbita rasante (no nível do mar) */
export const ORBIT = {
  omega: Math.sqrt(G_SURFACE / R_EARTH),
  get period() {
    return (2 * Math.PI) / this.omega;
  },
  get speed() {
    return Math.sqrt(G_SURFACE * R_EARTH);
  },
};

export function fmtTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtNum(n, digits = 0) {
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
