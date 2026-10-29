// A linha do tempo de tudo que viaja no tempo: bolas, objetos, o laser e você (como
// relogio/linha.rs da versão nativa).
//
// Cada coisa tem identidade fixa (a bola, pelo `uid`, que nunca troca — nem ao sair de um portal,
// nem ao ser refeita depois de um salto; o objeto, pelo índice; a sua versão passada, pelo clone)
// e trechos de vida no passado: o voo de uma bola, o duplo de um objeto (a versão mais velha dele,
// que saiu do vermelho), as emissões de laser que saem do vermelho de uma versão passada e o
// trecho da sua versão passada (que refaz a gravação).
//
// O que cada trecho precisa para existir é um compromisso: "uma bola / um objeto / o laser entra
// neste ciano por volta de t". Ele passa por três estados: cumprido (aconteceu nesta história),
// pendente (você voltou para antes dele e ele ainda tem de acontecer) e quebrado (passou da hora,
// com a folga, sem acontecer). Quebrado não é paradoxo por si: só é se algo dependia do trecho
// (uma âncora: um receptor que ele ligou, um botão que ele apertou) e nada mais segura essa
// consequência (outro caminho). Sem dependentes, a história se ajeita: o trecho some. As coisas
// iguais (bolas, cubos do mesmo modelo) podem fazer o papel umas das outras.
//
// O trecho da sua versão passada tem âncoras de caminho: ela tem de poder andar por onde andou.
// Cada problema (algo no caminho, perigo, bola, chão que sumiu) tem uma folga de tempo antes de
// virar paradoxo.

import * as THREE from 'three';

/** folga de tempo para uma bola ou um objeto cumprirem o compromisso (antes ou depois da hora) */
export const TOL_T = 1.0;
/** folga de tempo do laser (ele entra no ciano a cada quadro: a folga é curta) */
export const TOL_LASER = 0.25;
/** folga de lugar: entrou no mesmo ciano, perto de onde a outra entrou */
export const TOL_D = 1.5;
/** o laser entrou no ciano perto de onde entrava */
export const TOL_D_LASER = 0.5;

/** as âncoras do caminho da sua versão passada: [motivo do paradoxo, folga em segundos] */
export const CAMINHO = [
  ['algo bloqueou o caminho do seu passado', 0.1],
  ['um objeto ficou no caminho do seu passado', 0.1],
  ['o seu passado caiu num perigo', 0.05],
  ['uma bola de energia atingiu o seu passado', 0.03],
  ['o chão do seu passado sumiu', 0.35],
];

export const PENDENTE = 'pendente';
export const QUEBRADO = 'quebrado';
export const CUMPRIDO = 'cumprido';

/** onde a bola do voo estava em `t`: { p, v, life } (ou null fora do trecho) */
export function vooEm(v, t) {
  if (!v.track.length || t < v.de - 1e-6 || t >= v.ate) return null;
  let k = 0;
  for (let i = v.track.length - 1; i >= 0; i--)
    if (v.track[i].t <= t + 1e-6) {
      k = i;
      break;
    }
  const a = v.track[k];
  const b = v.track[k + 1];
  const p = b ? new THREE.Vector3().lerpVectors(a.p, b.p, Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-4, b.t - a.t)))) : a.p.clone();
  return { p, v: a.v.clone(), life: Math.max(0.3, a.life ?? v.life - (t - v.de)) };
}

/** o trecho que o compromisso sustenta (o voo, o duplo ou a emissão) */
const trechoDe = (c) => c.voo ?? c.duplo ?? c.emissao;

let duploSeq = 0;
/** identidade de um duplo (os da linha guardada no ponto de volta são cópias: o mesmo `id`) */
export const novoDuplo = (d) => ({ id: ++duploSeq, ativo: true, botoes: [], hid: false, ...d });

export class Linha {
  constructor() {
    /** { tipo: 'bola'|'objeto'|'laser', quem, li, k, clone, t, tol, onde, estado, quando, voo|duplo|emissao } */
    this.compromissos = [];
    /** voos de bola: { uid, de, ate, track: [{ t, p, v, life }], life, cons: { pegou, reentrou, viva }, ativo, noMundo, noMundoDesde } */
    this.voos = [];
    /** duplos de objeto: { id, k, prop, from, to, born, track: [{ t, p, q }], ativo, botoes: [[botão, t]], hid, mesh, box } */
    this.duplos = [];
    /** emissões de laser: { clone, t, entryT, at, exit, dir, frame, bridge, ativo, liga: [receptor] } */
    this.emissoes = [];
    /** trechos da sua versão passada: { clone, de, ate, ruim: [5] } */
    this.trechos = [];
    /** bolas a caminho do ciano: { uid, tIn, tOut, pos, vel, key, life } */
    this.saidas = [];
    this.visto = null;
  }

  /** cópia independente (o ponto de volta de um salto guarda a linha como estava) */
  clone() {
    const l = new Linha();
    const map = new Map();
    l.voos = this.voos.map((v) => {
      const c = { ...v, cons: { ...v.cons, pegou: v.cons.pegou.slice() } };
      map.set(v, c);
      return c;
    });
    l.duplos = this.duplos.map((d) => {
      const c = { ...d, botoes: d.botoes.slice() };
      map.set(d, c);
      return c;
    });
    l.emissoes = this.emissoes.map((e) => {
      const c = { ...e, liga: e.liga.slice() };
      map.set(e, c);
      return c;
    });
    l.trechos = this.trechos.map((t) => ({ ...t, ruim: t.ruim.slice() }));
    l.compromissos = this.compromissos.map((c) => {
      const x = { ...c };
      for (const f of ['voo', 'duplo', 'emissao']) if (c[f]) x[f] = map.get(c[f]) ?? c[f];
      return x;
    });
    l.saidas = this.saidas.map((s) => ({ ...s }));
    l.visto = this.visto;
    return l;
  }

  /**
   * O tempo andou até `tw` (para trás, num salto ou paradoxo): o que ainda não aconteceu nesta
   * história volta a ser pendente, as saídas de entradas futuras somem e os voos voltam a poder
   * entrar no mundo. Devolve true se o tempo voltou.
   */
  irPara(tw) {
    const back = this.visto !== null && tw < this.visto - 1e-4;
    this.visto = tw;
    if (!back) return false;
    for (const c of this.compromissos)
      if (c.estado === CUMPRIDO && c.quando > tw + 1e-6) {
        c.estado = PENDENTE;
        c.quando = null;
      }
    this.saidas = this.saidas.filter((s) => s.tIn <= tw + 1e-6);
    for (const v of this.voos) v.noMundo = false;
    for (const d of this.duplos) d.botoes = d.botoes.filter((b) => b[1] <= tw + 1e-6);
    for (const e of this.emissoes) if (e.t > tw + 1e-6) e.liga = [];
    return true;
  }

  pendentePerto(c, pos, tw, d) {
    return c.estado === PENDENTE && Math.abs(c.t - tw) <= c.tol && c.onde.distanceTo(pos) <= d;
  }

  /** marca cumprido o melhor pendente que `serve` aceita: primeiro os `preferido` (a mesma coisa), senão o mais perto da hora */
  cumprirCom(pos, tw, d, serve, preferido) {
    const ok = (c) => this.pendentePerto(c, pos, tw, d) && serve(c);
    let c = this.compromissos.find((x) => ok(x) && preferido(x));
    if (!c) for (const x of this.compromissos) if (ok(x) && (!c || Math.abs(x.t - tw) < Math.abs(c.t - tw))) c = x;
    if (!c) return null;
    c.estado = CUMPRIDO;
    c.quando = tw;
    return c;
  }

  /**
   * Uma bola (`uid`, do lançador `li`) entra no ciano em `pos` no instante `tw`: cumpre um
   * compromisso pendente? Primeiro o da mesma bola; senão qualquer um ali, na mesma hora (as bolas
   * são iguais: outra pode fazer o papel dela). Devolve o compromisso cumprido (ou null).
   */
  cumprir(uid, li, pos, tw) {
    return this.cumprirCom(pos, tw, TOL_D, (c) => c.tipo === 'bola', (c) => c.quem === uid || (li >= 0 && c.li === li));
  }

  /**
   * Um objeto `k` entra no ciano em `pos` no instante `tw`: cumpre o compromisso de um objeto?
   * Primeiro o dele; senão o de outro igual (`igual(j)`: o objeto j é do mesmo tipo e modelo).
   */
  cumprirObjeto(k, pos, tw, igual) {
    return this.cumprirCom(pos, tw, TOL_D, (c) => c.tipo === 'objeto' && (c.k === k || igual(c.k)), (c) => c.k === k);
  }

  /** os feixes que entraram num ciano neste quadro (`entradas`, pontos) cumprem os compromissos de laser de agora; devolve quantos */
  cumprirLaser(entradas, tw) {
    let n = 0;
    for (const c of this.compromissos)
      if (c.tipo === 'laser' && entradas.some((p) => this.pendentePerto(c, p, tw, TOL_D_LASER))) {
        c.estado = CUMPRIDO;
        c.quando = tw;
        n++;
      }
    return n;
  }

  /**
   * Compromissos pendentes que passaram da hora (com a folga): cada um vira quebrado e diz o que
   * fazer com o trecho que ele sustentava — { c, apagar: trecho } (nada dependia dele) ou
   * { c, ancora: trecho, receptores, botoes } (paradoxo, a não ser que outra coisa os mantenha)
   */
  vencidos(tw) {
    const out = [];
    for (const c of this.compromissos) {
      if (c.estado !== PENDENTE || tw <= c.t + c.tol) continue;
      c.estado = QUEBRADO;
      const x = trechoDe(c);
      const receptores = (c.voo?.cons.pegou ?? c.emissao?.liga ?? []).slice();
      const botoes = (c.duplo?.botoes ?? []).slice();
      out.push(receptores.length || botoes.length ? { c, ancora: x, receptores, botoes } : { c, apagar: x });
    }
    return out;
  }

  /** some da história o trecho (e, de um voo, o que saiu dele pelo ciano); devolve a identidade da bola do voo */
  apagar(x) {
    x.ativo = false;
    if (x.uid !== undefined && x.cons) this.saidas = this.saidas.filter((s) => s.uid !== x.uid);
    return x.uid;
  }

  /**
   * Voos que deveriam estar no mundo em `tw` e ainda não entraram nesta passada:
   * [{ voo, p, v, life }]. `existe(uid)` diz se a bola já está no mundo.
   */
  aMaterializar(tw, existe) {
    const out = [];
    for (const v of this.voos) {
      if (!v.ativo || v.noMundo) continue;
      const s = vooEm(v, tw);
      if (!s) continue;
      v.noMundo = true;
      if (!existe(v.uid)) out.push({ voo: v, ...s });
    }
    return out;
  }

  /** as emissões de laser de agora (de versões passadas que ainda existem: `vivo(clone)`) */
  emissoesEm(tw, janela, vivo) {
    const out = [];
    for (const e of this.emissoes) {
      if (!e.ativo || Math.abs(e.t - tw) > janela || !vivo(e.clone)) continue;
      if (out.some((x) => x.exit.distanceTo(e.exit) < 0.2 && x.dir.dot(e.dir) > 0.98)) continue;
      out.push(e);
    }
    return out;
  }

  /**
   * O trecho da sua versão passada `clone` neste quadro: `problemas` = as âncoras de caminho em
   * falta agora (na ordem de CAMINHO). Cada uma acumula enquanto falta e zera quando volta; passou
   * da folga, devolve o motivo do paradoxo (ou null).
   */
  conferirCaminho(clone, problemas, dt) {
    const t = this.trechos.find((x) => x.clone === clone);
    if (!t) return null;
    let why = null;
    problemas.forEach((bad, i) => {
      t.ruim[i] = bad ? t.ruim[i] + dt : 0;
      if (!why && t.ruim[i] > CAMINHO[i][1]) why = CAMINHO[i][0];
    });
    return why;
  }

  esquecerAntigos(tw, keep) {
    this.compromissos = this.compromissos.filter((c) => tw - c.t < keep);
    const usados = new Set(this.compromissos.map(trechoDe));
    this.voos = this.voos.filter((v) => usados.has(v) || tw - v.ate < keep);
    this.emissoes = this.emissoes.filter((e) => usados.has(e) || tw - e.entryT < keep);
  }
}

// ------------------------------------------------------------------ âncoras: outro caminho
/**
 * O receptor em `pos` (raio `r`) foi alcançado por outra bola (não `uid`, nem do lançador `li`)?
 * Então ele continua ligado sem a bola que deixou a história. `bolas`: [{ uid, li, pos }]
 */
export function receptorPorOutra(pos, r, bolas, uid, li = -1) {
  const R = Math.max(r ?? 0.8, 0.8) + 0.4;
  return bolas.some((b) => b.uid !== uid && (li < 0 || b.li !== li) && b.pos.distanceTo(pos) < R);
}

/**
 * O botão em `pos` estava apertado também por outra coisa além do objeto `k`: outro objeto em cima
 * (`objetos`: [{ p, gone }]) ou você (`eu`, o centro do corpo)?
 */
export function botaoPorOutro(pos, objetos, k, eu) {
  const outro = objetos.some((o, j) => j !== k && o && !o.gone && o.p.distanceTo(pos) < 0.9);
  const dx = eu.x - pos.x;
  const dz = eu.z - pos.z;
  return outro || (Math.hypot(dx, dz) < 0.8 && Math.abs(eu.y - pos.y) < 1.6);
}
