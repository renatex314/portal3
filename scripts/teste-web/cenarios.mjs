// Testes da versão web no Chrome sem janela (os mesmos cenários da linha do tempo da versão nativa).
// Uso: node scripts/teste-web/cenarios.mjs [nome…]   — sai com 1 se algo falhar.
import { spawn } from 'node:child_process';
import { openPage, waitHttp } from './cdp.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const PORT = 5199;

// ajudantes na página: começar a fase, andar quadros (conferindo as regras da linha do tempo),
// abrir portais pelo raio, saltar, contar paradoxos
const HELPERS = `
window.T = {
  get J() { return window.__jogo; },
  V(x, y, z) { return new window.__jogo.THREE.Vector3(x, y, z); },
  async start(id, extra = null) {
    const J = this.J;
    J.manual = true;
    const L = J.levels.find((x) => x.id === id);
    // extra: campos a mais nos dados da fase (ex.: { relogio: true } para ligar o relógio)
    if (extra && !L._build) {
      L._build = L.build;
      L.build = (w) => ({ ...L._build(w), ...extra });
    }
    await J.startLevel(J.levels.indexOf(L));
    J.paused = false;
    this.par = [];
    this.inv = new Set();
    const fx = J.relogio.ctx.fx;
    const orig = fx.paradox;
    fx.paradox = (why, at) => { this.par.push(J.relogio.tw.toFixed(2) + ' ' + why); orig?.call(fx, why, at); };
  },
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      this.J.step(1 / 60);
      for (const v of this.J.relogio?.invariants?.() ?? []) this.inv.add(v.replace(/[0-9.]+/g, '#'));
    }
  },
  tw() { return this.J.relogio.tw; },
  until(cond, max = 60 * 30) { for (let i = 0; i < max && !cond(); i++) this.step(); return cond(); },
  place(which, o, d, delta = 0) {
    const J = this.J;
    const ok = J.portals.tryPlace(which, this.V(...o), this.V(...d).normalize()).ok;
    if (delta > 0) {
      const P = which === 'blue' ? J.portals.blue : J.portals.orange;
      P.delta = delta;
      P.placedTw = J.relogio.tw;
    }
    return !!ok;
  },
  jump(rest = [0, 0.92, 12]) {
    const J = this.J;
    const P = J.portals.blue;
    J.player.pos.copy(P.center).addScaledVector(P.normal, 0.5).add(this.V(0, -0.15, 0));
    const ok = J.relogio.jump(P);
    J.player.pos.copy(this.V(...rest));
    J.player.vel.set(0, 0, 0);
    // o "rebobinar" (só visual) termina e o mundo é refeito no instante de chegada
    this.until(() => !J.relogio.sweep, 120);
    J.player.pos.copy(this.V(...rest));
    return !!ok;
  },
  /** tira do mundo as bolas da história (fica só a mais velha, a do voo) e desliga os lançadores */
  removeYoung() {
    const J = this.J;
    const elder = new Set(J.relogio.linha.voos.map((v) => v.uid));
    for (const p of [...J.energy.pellets]) if (!elder.has(p.uid)) J.energy.kill(p);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
  },
  room1() { return this.J.energy.pellets.filter((p) => p.pos.z > -5.5).length; },
  /** portal com a boca em c, virado para n (na parede que está ali) */
  frame(which, c, n, delta = 0) {
    const J = this.J;
    const C = this.V(...c), N = this.V(...n);
    const hit = J.world.raycast(C.clone().addScaledVector(N, 0.5), N.clone().negate(), 2);
    const P = which === 'blue' ? J.portals.blue : J.portals.orange;
    P.setFrame(hit.point, N, this.V(0, 1, 0), hit.box);
    P.delta = delta;
    P.placedTw = J.relogio.tw;
    return !!hit;
  },
  /** tira o objeto do trilho da gravação (como pegá-lo) */
  unrail(c) {
    const R = this.J.relogio;
    R.free.add(c);
    R.snap.delete(c);
    R.driven.delete(c);
  },
};
`;

// cada cenário: código da página que devolve [[ok, mensagem], …] (e pode pôr linhas em `log`)
const CENARIOS = {
  // a bola bate no vermelho temporal (sala 2) e sai pelo ciano (sala 1) Δ s depois
  'bolas-vermelho': `
    await T.start(604);
    T.J.player.pos.set(8, 0.92, 12);
    T.step(60 * 5);
    const ok = T.place('orange', [8, 1.3, -12], [1, 0, 0], 2) && T.place('blue', [-8, 1.3, 6], [-1, 0, 0]);
    const t0 = T.tw();
    let inAt = null, outAt = null;
    const n0 = T.J.relogio.linha.saidas.length;
    T.until(() => { if (inAt === null && T.J.relogio.linha.saidas.length > n0) inAt = T.tw(); if (inAt !== null && outAt === null && T.room1() > 0) outAt = T.tw(); return outAt !== null; }, 60 * 10);
    log.push('entrou ' + inAt + ' saiu ' + outAt);
    return [[ok, 'portais no lugar'], [inAt !== null, 'a bola entra no vermelho temporal'], [inAt !== null && outAt !== null && Math.abs(outAt - inAt - 2) < 0.3, 'e sai pelo ciano Δ s depois']];
  `,
  // a bola entra no ciano (sala 2) e aparece na sala 1, onde estaria depois de voar Δ s a partir do vermelho
  'bolas-ciano': `
    await T.start(604);
    T.J.player.pos.set(8, 0.92, 12);
    T.step(60 * 5);
    const ok = T.place('blue', [8, 1.3, -12], [1, 0, 0]) && T.place('orange', [-8, 1.3, 6], [-1, 0, 0], 2);
    const sent = T.until(() => T.room1() > 0, 60 * 8);
    const p = T.J.energy.pellets.find((q) => q.pos.z > -5.5)?.pos;
    log.push('na sala 1 em ' + (p ? p.toArray().map((x) => x.toFixed(1)) : '-'));
    const l = T.J.relogio.linha;
    return [[ok, 'portais no lugar'], [sent, 'a bola vai ao passado e aparece onde estaria agora'], [!!p && p.x > -11 && p.x < 3, 'depois de voar Δ s a partir do vermelho'],
      [l.compromissos.length === 1 && l.voos.length === 1 && l.voos[0].uid !== l.compromissos[0].quem, 'um compromisso e um voo (a mais velha com identidade própria)']];
  `,
  // voltando para o meio do voo no passado: a bola continua lá; nada de paradoxo falso; a mesma bola
  // entrando no ciano duas vezes seguidas vai ao passado as duas vezes
  'bola-laco': `
    await T.start(604);
    T.J.player.pos.set(8, 0.92, 12);
    T.step(60 * 12);
    const ok = T.place('blue', [8, 1.3, -12], [1, 0, 0]) && T.place('orange', [-8, 1.3, 6], [-1, 0, 0], 4);
    const sent = T.until(() => T.room1() > 0, 60 * 10);
    const tSent = T.tw();
    T.step(60);
    const j = T.jump();
    T.step(3);
    let seen = false;
    T.until(() => { if (T.tw() > tSent + 0.3 && T.tw() < tSent + 0.8 && T.room1() > 0) seen = true; return T.tw() > tSent + 4; }, 60 * 12);
    // a mesma bola entra duas vezes seguidas
    const J = T.J;
    T.place('blue', [8, 1.3, -12], [1, 0, 0]); T.place('orange', [-8, 1.3, 6], [-1, 0, 0], 4);
    T.step(5);
    for (const p of [...J.energy.pellets]) J.energy.kill(p);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
    const B = J.portals.blue;
    const fake = J.energy.spawnFree(B.center.clone().addScaledVector(B.normal, 0.1), B.normal.clone().multiplyScalar(-6), 20);
    fake.uid = 'teste777';
    J.energy.kill(fake);
    const n0 = T.room1();
    const r1 = J.relogio.ballToPast(fake, B);
    const n1 = T.room1();
    J.relogio.tw += 0.3;
    const r2 = J.relogio.ballToPast(fake, B);
    const n2 = T.room1();
    log.push('sala 1: ' + n0 + ' → ' + n1 + ' → ' + n2);
    return [[ok && sent && j, 'a bola vai ao passado e o salto acontece'], [seen, 'voltando, a bola que voava no passado continua lá'],
      [r1 === true && r2 === true && n1 === n0 + 1 && n2 === n1 + 1, 'a mesma bola entrando no ciano de novo vai ao passado de novo']];
  `,
  // outra bola cumpre o compromisso (as bolas são iguais)
  'outra-bola': `
    await T.start(604);
    T.J.player.pos.set(8, 0.92, 12);
    T.step(60 * 12);
    T.place('blue', [8, 1.3, -12], [1, 0, 0]); T.place('orange', [-8, 1.3, 6], [-1, 0, 0], 4);
    const l0 = T.J.relogio.linha;
    T.until(() => l0.compromissos.length > 0, 60 * 12);
    const c = T.J.relogio.linha.compromissos[0];
    const t1 = c.t, at = c.onde.clone();
    T.step(60);
    const j = T.jump();
    T.step(3);
    T.removeYoung();
    let injected = false;
    T.until(() => {
      if (!injected && T.tw() >= t1 - 0.3) {
        injected = true;
        const J = T.J;
        const B = J.portals.list.find((P) => P.placed && !(P.delta > 0) && P.center.distanceTo(at) < 2);
        const q = J.energy.spawnFree(at.clone().add(T.V(0, 0.3, 0)), T.V(6, 0, 0), 20);
        q.uid = 'outra';
        if (J.relogio.ballToPast(q, B)) J.energy.kill(q);
      }
      return T.tw() > t1 + 3;
    }, 60 * 12);
    const l = T.J.relogio.linha;
    log.push('compromisso ' + l.compromissos[0].estado + ' voos ' + l.voos.length);
    return [[j, 'salto'], [T.par.length === 0, 'sem paradoxo'], [l.compromissos[0].estado === 'cumprido', 'a outra bola cumpre o compromisso'],
      [l.voos.length === 1 && l.voos[0].ativo, 'ela não vai ao passado de novo (o voo de antes continua)']];
  `,
  // compromisso quebrado sem dependentes: o voo some da história, sem paradoxo
  'apagar': `
    await T.start(604);
    T.J.player.pos.set(8, 0.92, 12);
    T.step(60 * 12);
    T.place('blue', [8, 1.3, -12], [1, 0, 0]); T.place('orange', [-8, 1.3, 6], [-1, 0, 0], 4);
    T.until(() => T.J.relogio.linha.compromissos.length > 0, 60 * 12);
    const t1 = T.J.relogio.linha.compromissos[0].t;
    T.step(60);
    const j = T.jump();
    T.step(3);
    T.removeYoung();
    const uid = T.J.relogio.linha.voos[0].uid;
    let elder = false;
    T.until(() => { elder ||= T.J.energy.pellets.some((p) => p.uid === uid); return T.tw() > t1 + 2.5; }, 60 * 12);
    const l = T.J.relogio.linha;
    log.push('compromisso ' + l.compromissos[0].estado + ' voo ativo ' + l.voos[0].ativo);
    return [[j, 'salto'], [elder, 'a bola mais velha voava no passado depois do salto'], [T.par.length === 0, 'sem paradoxo'],
      [l.compromissos[0].estado === 'quebrado' && !l.voos[0].ativo, 'o compromisso quebra e o voo some da história'],
      [!T.J.energy.pellets.some((p) => p.uid === uid), 'a bola mais velha não está mais no mundo']];
  `,
  // outro cubo igual faz o papel do que o seu passado usou
  'substituto': `
    await T.start(604);
    const J = T.J;
    J.player.pos.set(8, 0.92, 12);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
    const A = J.makeCube(6, 0, 12);
    const B = J.makeCube(2, 0, 9);
    T.step(60 * 3);
    const aPos = A.pos.clone();
    J.camera.position.copy(J.player.pos).add(T.V(0, 0.7, 0));
    // pega o A (como o E faz) e larga depois de 1 s
    const grab = (c) => { const r = J.relogio; window.__held = c; c.held = true; };
    const heldBefore = J.held;
    J.player.yaw = Math.atan2(-(aPos.x - J.player.pos.x), -(aPos.z - J.player.pos.z));
    J.player.pitch = Math.atan2(aPos.y - (J.player.pos.y + 0.7), Math.hypot(aPos.x - J.player.pos.x, aPos.z - J.player.pos.z));
    T.step(2);
    J.use();
    const picked = J.held === A;
    const tPick = T.tw();
    T.step(60);
    J.use();
    T.step(60);
    const delta = T.tw() - tPick + 1.5;
    const ok = T.place('blue', [-8, 1.3, 6], [-1, 0, 0]) && T.place('orange', [-8, 1.3, 1.5], [-1, 0, 0], delta);
    const j = T.jump([4, 0.92, 6]);
    T.step(3);
    // tira o A do lugar (pega e larga longe) e leva o B até onde o A estava
    const carry = (c, to) => { J.relogio.free.add(c); J.relogio.snap.delete(c); J.relogio.driven.delete(c); c.place(to, null, null); };
    carry(A, T.V(0, 0.31, 3));
    carry(B, aPos);
    const r0 = J.relogio.rollbacks ?? 0;
    T.until(() => T.tw() > tPick + 1.5, 60 * 10);
    log.push('pegou ' + picked + ' em ' + tPick.toFixed(2) + ' · substitutos ' + J.relogio.standIns + ' · voltas desfeitas ' + ((J.relogio.rollbacks ?? 0) - r0) + ' · B ' + B.pos.toArray().map((x) => x.toFixed(2)));
    return [[picked, 'o jogador pega o cubo A'], [ok && j, 'portais e salto'], [T.par.length === 0 && (J.relogio.rollbacks ?? 0) === r0, 'sem paradoxo'],
      [J.relogio.standIns >= 1, 'o cubo B fez o papel do A'], [B.pos.distanceTo(aPos) > 0.5, 'a sua versão passada pegou o B']];
  `,
  // dois laços: voltando para antes de o vermelho existir, a bola que bate na estática entra nele
  'bola-volta': `
    await T.start(604);
    T.J.player.pos.set(8, 0.92, 12);
    T.step(60 * 12);
    const a = T.place('orange', [8, 1.3, -12], [1, 0, 0], 8) && T.place('blue', [-8, 1.3, 6], [-1, 0, 0]);
    const tOpen = T.tw();
    T.step(60 * 2);
    const j1 = T.jump();
    T.step(10);
    const b = T.place('blue', [-8, 1.3, 6], [-1, 0, 0]) && T.place('orange', [-8, 1.3, 1.5], [-1, 0, 0], 4);
    const j2 = T.jump();
    log.push('vermelho aberto em ' + tOpen.toFixed(2) + ' (estática a partir de ' + (tOpen - 8).toFixed(2) + '); chegada ' + T.tw().toFixed(2));
    let pops = 0, out = 0, seenStatic = false;
    const l = T.J.relogio.linha;
    let nSaidas = l.saidas.length;
    T.until(() => {
      const st = T.J.relogio.liveGhosts().some((w) => w.f.c.x > 10.5);
      seenStatic ||= st;
      if (T.J.relogio.linha.saidas.length > nSaidas && st) pops++;
      nSaidas = T.J.relogio.linha.saidas.length;
      return T.tw() > tOpen + 2;
    }, 60 * 14);
    out = T.room1();
    log.push('entradas na estática ' + pops + ' · bolas na sala 1 ' + out);
    return [[a && b && j1 && j2, 'dois laços'], [seenStatic, 'o vermelho de estática aparece no passado'], [pops > 0, 'a bola entra no vermelho de estática'], [out > 0, 'e sai pelo ciano Δ s depois']];
  `,
  // um cubo mandado ao passado pelo ciano; voltando para antes, o laço tem de fechar: o mesmo cubo
  // entra de novo (no trilho da gravação), outro igual entra no lugar dele, ou nenhum (o duplo não
  // apertou nada: some da história, sem paradoxo)
  ...Object.fromEntries(['mesmo', 'outro', 'apagar'].map((modo) => [`duplo-${modo}`, `
    await T.start(604);
    const J = T.J;
    J.player.pos.set(8, 0.92, 12);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
    const k = J.makeCube(6, 0, -12);
    const other = J.makeCube(4, 0, -9);
    T.step(60 * 4);
    const ok = T.place('blue', [8, 1.3, -12], [1, 0, 0]) && T.place('orange', [-8, 1.3, 6], [-1, 0, 0], 3);
    T.step(60);
    k.place(T.V(10.6, 1, -12), null, { x: 5, y: 0.5, z: 0 });
    const sent = T.until(() => J.relogio.linha.compromissos.some((c) => c.tipo === 'objeto'), 120);
    const c0 = J.relogio.linha.compromissos.find((c) => c.tipo === 'objeto');
    const d0 = J.relogio.linha.duplos[0];
    const end = d0.track[d0.track.length - 1].p.clone();
    T.step(30);
    const j = T.jump();
    T.step(3);
    if ('${modo}' !== 'mesmo') { T.unrail(k); k.place(T.V(0, 0.31, -9), null, null); }
    if ('${modo}' === 'outro') T.unrail(other);
    let thrown = '${modo}' !== 'outro';
    T.until(() => {
      if (!thrown && T.tw() >= c0.t - 0.25) { thrown = true; other.place(T.V(10.6, 1, -12), null, { x: 5, y: 0.5, z: 0 }); }
      return T.tw() > c0.t + 2;
    }, 60 * 10);
    const l = J.relogio.linha;
    const c = l.compromissos.find((x) => x.tipo === 'objeto');
    log.push('compromisso ' + c.estado + ' · duplos ' + l.duplos.length + ' (ativo ' + l.duplos[0].ativo + ') · cubo ' + k.pos.toArray().map((x) => x.toFixed(2)) + ' · outro ' + other.pos.toArray().map((x) => x.toFixed(2)));
    const out = [[ok && sent && j, 'o cubo vai ao passado e o salto acontece'], [T.par.length === 0, 'sem paradoxo'], [l.duplos.length === 1, 'nenhum duplo novo (o laço fecha com o que já existia)']];
    if ('${modo}' === 'mesmo') out.push([c.estado === 'cumprido', 'o mesmo cubo cumpre o compromisso'], [k.pos.distanceTo(end) < 1, 'e segue de onde o duplo chegou']);
    else if ('${modo}' === 'outro') out.push([c.estado === 'cumprido', 'o outro cubo cumpre o compromisso'], [other.pos.distanceTo(end) < 1, 'e é ele que segue de onde o duplo chegou']);
    else out.push([c.estado === 'quebrado' && !l.duplos[0].ativo, 'o compromisso quebra e o duplo some da história']);
    return out;
  `])),
  // o laser mandado ao passado (fase 400 com o relógio): sem o laser entrando no ciano, paradoxo só se o
  // feixe do passado ligou o receptor sozinho; sem consequência, as emissões somem da história
  ...Object.fromEntries(['ancora', 'apagar'].map((modo) => [`laser-${modo}`, `
    await T.start(400, { relogio: true });
    const J = T.J;
    J.player.pos.set(0, 0.92, 11);
    T.step(60 * 3);
    // 1º laço: o laser entra no ciano (x = 20) e sai do vermelho Δ 2 s antes, na frente do receptor ou longe
    // (na web o laser entra a 0,3 m de altura e o receptor fica a 0,8 m: o vermelho 0,5 m mais alto)
    const back = '${modo}' === 'ancora' ? [6, 1.7, 14] : [-6, 1.7, 14];
    const ok = T.frame('blue', [20, 1.2, 6], [-1, 0, 0]) && T.frame('orange', back, [0, 0, -1], 2);
    const tOpen = T.tw();
    T.step(60 * 3);
    const j1 = T.jump([0, 0.92, 11]);
    // 2º laço: Δ 4 s leva para antes de o feixe sair do vermelho do 1º laço
    T.step(5);
    const ok2 = T.frame('blue', [-2, 1.2, 14], [0, 0, -1]) && T.frame('orange', [-10, 1.2, 14], [0, 0, -1], 4);
    const j2 = T.jump([0, 0.92, 11]);
    log.push('vermelho do 1º laço em ' + tOpen.toFixed(2) + '; chegada do 2º salto ' + T.tw().toFixed(2));
    T.until(() => T.tw() > tOpen - 2 + 1, 60 * 6);
    const l = J.relogio.linha;
    const lit = l.emissoes.some((e) => e.liga.length > 0);
    log.push('emissões ' + l.emissoes.length + ' · alguma ligou o receptor: ' + lit);
    const r0 = J.relogio.rollbacks ?? 0;
    for (const L of J.world.lasers) L.off = true;
    T.until(() => T.tw() > tOpen + 1 || (J.relogio.rollbacks ?? 0) > r0, 60 * 8);
    const r1 = J.relogio.rollbacks ?? 0;
    const out = [[ok && ok2 && j1 && j2, 'dois laços'], [l.emissoes.length > 30, 'o laser mandado ao passado está na linha do tempo (as emissões)'],
      [lit === ('${modo}' === 'ancora'), '${modo}' === 'ancora' ? 'o feixe do passado liga o receptor (âncora)' : 'o feixe do passado não liga nada']];
    if ('${modo}' === 'ancora') out.push([r1 > r0, 'sem o laser, o receptor que só ele ligava no passado: paradoxo (o loop se desfaz)']);
    else out.push([r1 === r0 && T.par.length === 0, 'sem consequência: sem paradoxo'], [J.relogio.linha.emissoes.some((e) => !e.ativo), 'as emissões somem da história']);
    return out;
  `])),
  // o seu passado pega um cubo com o tempo parado; depois do salto você mexe nele e o deixa no mesmo
  // lugar (sem paradoxo) ou a 2 m dele (paradoxo)
  ...Object.fromEntries(['', '-longe'].map((modo) => [`parado${modo}`, `
    await T.start(604);
    const J = T.J;
    J.player.pos.set(8, 0.92, 12);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
    const A = J.makeCube(6, 0, 12);
    T.step(60 * 3);
    const aPos = A.pos.clone();
    const aim = () => {
      J.player.yaw = Math.atan2(-(aPos.x - J.player.pos.x), -(aPos.z - J.player.pos.z));
      J.player.pitch = Math.atan2(aPos.y - (J.player.pos.y + 0.7), Math.hypot(aPos.x - J.player.pos.x, aPos.z - J.player.pos.z));
    };
    J.relogio.pause(true);
    aim();
    T.step(2);
    J.use();
    const picked = J.held === A;
    const tFreeze = T.tw();
    for (let i = 0; i < 40; i++) { J.player.pos.z -= 0.06; T.step(); }
    J.use();
    T.step(10);
    const moved = A.pos.clone();
    J.relogio.pause(false);
    T.step(60 * 2);
    const delta = T.tw() - tFreeze + 1.5;
    const ok = T.place('blue', [-8, 1.3, 6], [-1, 0, 0]) && T.place('orange', [-8, 1.3, 1.5], [-1, 0, 0], delta);
    const j = T.jump([4, 0.92, 6]);
    T.step(3);
    T.unrail(A);
    A.place('${modo}' ? aPos.clone().add(T.V(-2, 0, 0)) : aPos.clone(), null, null);
    const r0 = J.relogio.rollbacks ?? 0;
    T.until(() => T.tw() > tFreeze + 1.5 || (J.relogio.rollbacks ?? 0) > r0, 60 * 8);
    const r1 = J.relogio.rollbacks ?? 0;
    log.push('pegou ' + picked + ' em ' + tFreeze.toFixed(2) + ' · levado para ' + moved.toArray().map((x) => x.toFixed(2)) + ' · voltas desfeitas ' + (r1 - r0));
    const out = [[picked && moved.distanceTo(aPos) > 1, 'com o tempo parado, o passado leva o cubo para outro lugar'], [ok && j, 'salto para antes']];
    if ('${modo}') out.push([r1 > r0, 'o cubo não está onde o seu passado o encontrou: paradoxo']);
    else out.push([r1 === r0 && T.par.length === 0, 'o cubo está onde o seu passado o encontrou: sem paradoxo'], [A.pos.distanceTo(moved) < 0.8, 'e o seu passado o leva para onde levou']);
    return out;
  `])),
  // com o tempo parado você abre um par de portais na parede e passa por ele correndo; depois volta para
  // antes disso: a sua versão passada refaz o caminho sem "algo bloqueou"
  'parado-portal': `
    await T.start(604);
    const J = T.J;
    J.player.pos.set(2, 0.92, -12);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
    T.step(60 * 4);
    const tPause = T.tw();
    J.relogio.pause(true);
    const ok = T.place('blue', [8, 1.3, -12], [1, 0, 0]) && T.place('orange', [8, 1.3, -16.5], [1, 0, 0]);
    let crossed = false;
    for (let i = 0; i < 90; i++) {
      if (!crossed) J.player.vel.set(30, 0, 0);
      T.step();
      if (!crossed && Math.abs(J.player.pos.z + 16.5) < 1.5) crossed = true;
    }
    J.relogio.pause(false);
    T.step(60 * 2);
    const delta = T.tw() - tPause + 1;
    const ok2 = T.place('blue', [-8, 1.3, 6], [-1, 0, 0]) && T.place('orange', [-8, 1.3, 1.5], [-1, 0, 0], delta);
    const j = T.jump([0, 0.92, 4]);
    const r0 = J.relogio.rollbacks ?? 0;
    T.until(() => T.tw() > tPause + 2 || (J.relogio.rollbacks ?? 0) > r0, 60 * 8);
    return [[ok && crossed, 'passou pelo portal correndo com o tempo parado'], [ok2 && j, 'salto para antes da pausa'],
      [(J.relogio.rollbacks ?? 0) === r0 && T.par.length === 0, 'a sua versão passada refaz o caminho pelo portal sem paradoxo']];
  `,
  // as âncoras de caminho da sua versão passada: um objeto no caminho dela por menos que a folga não é
  // paradoxo; por mais, é
  'caminho': `
    await T.start(604);
    const J = T.J;
    J.player.pos.set(8, 0.92, 12);
    for (const L of J.world.launchers) { L.done = true; L.pellet = null; }
    const k = J.makeCube(-4, 0, 9);
    T.step(60 * 2);
    // anda um pouco (a versão passada vai refazer isso)
    for (let i = 0; i < 90; i++) { J.player.pos.x -= 0.03; T.step(); }
    T.place('blue', [-8, 1.3, 6], [-1, 0, 0]); T.place('orange', [-8, 1.3, 1.5], [-1, 0, 0], 2.5);
    T.step(10);
    const j = T.jump([0, 0.92, 4]);
    T.step(5);
    const R = J.relogio;
    const c = R.clones[R.clones.length - 1];
    T.unrail(k);
    const r0 = R.rollbacks ?? 0;
    // um instante no caminho (menos que a folga de 0,1 s)
    const at = () => R.clonePose(c)?.p;
    k.place(at().clone(), null, null);
    T.step(3);
    k.place(T.V(-4, 0.31, 2), null, null);
    T.step(20);
    const brief = (R.rollbacks ?? 0) === r0;
    // e agora parado no caminho
    let r = false;
    for (let i = 0; i < 40 && !r; i++) { const p = at(); if (p) k.place(p.clone(), null, null); T.step(); r = (R.rollbacks ?? 0) > r0; }
    log.push('paradoxos: ' + T.par.join(' | '));
    return [[j, 'salto'], [brief, 'um objeto no caminho por menos que a folga: sem paradoxo'], [r && T.par.some((w) => w.includes('objeto ficou no caminho')), 'parado no caminho: paradoxo (um objeto ficou no caminho do seu passado)']];
  `,
  // todas as fases com relógio abrem e andam alguns segundos sem erro (e sem quebrar as regras da linha do tempo)
  'fases-relogio': `
    const J = T.J;
    const ids = J.levels.filter((L) => L.relogio).map((L) => L.id);
    const out = [];
    for (const id of ids) {
      await T.start(id);
      T.step(60 * 3);
      out.push([!!J.relogio && J.state.levelTime > 2.5, 'fase ' + id + ' anda com o relógio']);
    }
    log.push(ids.length + ' fases');
    return out;
  `,
};

const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(CENARIOS);
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
let fails = 0;
try {
  await waitHttp(`http://localhost:${PORT}/jogo.html`);
  for (const [n, name] of names.entries()) {
    let p = null;
    try {
      p = await openPage(`http://localhost:${PORT}/jogo.html`, { port: 9333 + n });
      for (let i = 0; i < 150; i++) {
        if (await p.evaluate('return !!window.__jogo').catch(() => false)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      await p.evaluate(HELPERS);
      const res = await p.evaluate(`const log = []; const checks = await (async () => { ${CENARIOS[name]} })(); return { checks, log, par: T.par, inv: [...T.inv] };`);
      let ok = 0, f = 0;
      const lines = [];
      for (const [c, msg] of res.checks) {
        lines.push(`${c ? 'ok  ' : 'FALHA'} ${msg}`);
        c ? ok++ : f++;
      }
      for (const v of res.inv) {
        lines.push(`FALHA invariante: ${v}`);
        f++;
      }
      const exc = p.logs.filter((l) => l.startsWith('EXCEÇÃO'));
      for (const e of exc) {
        lines.push(`FALHA ${e.split('\n')[0]}`);
        f++;
      }
      console.log(`${name}: ${ok} ok, ${f} falhas`);
      for (const l of res.log) console.log(`  ${l}`);
      for (const l of res.par) console.log(`  paradoxo ${l}`);
      for (const l of lines) if (l.startsWith('FALHA') || process.env.VERBOSE) console.log(`  ${l}`);
      fails += f;
    } catch (e) {
      console.log(`${name}: FALHA ${e.message.split('\n')[0]}`);
      fails++;
    } finally {
      await p?.close();
    }
  }
} finally {
  vite.kill();
}
process.exit(fails ? 1 : 0);
