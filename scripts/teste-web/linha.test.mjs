// testes de unidade da linha do tempo (src/game/linha.js), os mesmos da versão nativa
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Linha, vooEm, novoDuplo, receptorPorOutra, botaoPorOutro, CAMINHO, TOL_T, TOL_LASER, PENDENTE, CUMPRIDO, QUEBRADO } from '../../src/game/linha.js';

const V = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function voo(de, ate) {
  const track = [];
  for (let i = 0; i <= Math.round((ate - de) * 30); i++) track.push({ t: de + i / 30, p: V(i * 0.1), v: V(3), life: 10 - i / 30 });
  return { uid: 'v900', de, ate, track, life: 10, cons: { pegou: [], reentrou: false, viva: false }, ativo: true, noMundo: false, noMundoDesde: null };
}

function linha() {
  const l = new Linha();
  const v = voo(6, 10);
  l.voos.push(v);
  l.compromissos.push({ tipo: 'bola', quem: 'b7', li: -1, t: 10, tol: TOL_T, onde: V(0), estado: CUMPRIDO, quando: 10, voo: v });
  l.irPara(12);
  return l;
}

test('voltar deixa pendente e a mesma bola cumpre', () => {
  const l = linha();
  assert.equal(l.irPara(5), true);
  assert.equal(l.compromissos[0].estado, PENDENTE);
  assert.equal(l.cumprir('b7', -1, V(0.3), 10.2), l.compromissos[0]);
  assert.equal(l.compromissos[0].estado, CUMPRIDO);
});

test('outra bola pode cumprir', () => {
  const l = linha();
  l.irPara(5);
  assert.equal(l.cumprir('b55', 3, V(0, 1, 0), 9.5), l.compromissos[0]);
});

test('sem voltar no tempo nada é repetição', () => {
  const l = linha();
  assert.equal(l.cumprir('b7', -1, V(0), 10.3), null);
});

test('longe ou fora da hora não cumpre', () => {
  const l = linha();
  l.irPara(5);
  assert.equal(l.cumprir('b7', -1, V(5), 10), null);
  assert.equal(l.cumprir('b7', -1, V(0), 12), null);
});

test('vencido sem dependentes apaga; com receptor é âncora', () => {
  let l = linha();
  l.irPara(5);
  assert.deepEqual(l.vencidos(10.5), []);
  const r = l.vencidos(11.2);
  assert.equal(r.length, 1);
  assert.equal(r[0].apagar, l.voos[0]);
  assert.equal(l.compromissos[0].estado, QUEBRADO);
  l = linha();
  l.voos[0].cons.pegou.push(2);
  l.irPara(5);
  const a = l.vencidos(11.2);
  assert.equal(a[0].ancora, l.voos[0]);
  assert.deepEqual(a[0].receptores, [2]);
});

test('materializa uma vez por passada', () => {
  const l = linha();
  l.irPara(7);
  const m = l.aMaterializar(7, () => false);
  assert.equal(m.length, 1);
  assert.ok(Math.abs(m[0].p.x - 3) < 0.11);
  assert.equal(l.aMaterializar(7.1, () => false).length, 0);
  l.irPara(6.5);
  assert.equal(l.aMaterializar(6.5, () => false).length, 1);
  l.irPara(6);
  assert.equal(l.aMaterializar(6.2, (u) => u === 'v900').length, 0);
  l.irPara(6);
  l.apagar(l.voos[0]);
  assert.equal(l.aMaterializar(6.2, () => false).length, 0);
  assert.equal(vooEm(l.voos[0], 11), null);
});

test('âncoras com outro caminho', () => {
  const b = V(0);
  const longe = V(10, 1, 0);
  assert.equal(botaoPorOutro(b, [{ p: V(0.1, 0.3, 0) }, { p: V(5, 0.3, 0) }], 0, longe), false);
  assert.equal(botaoPorOutro(b, [{ p: V(0.1, 0.3, 0) }, { p: V(-0.3, 0.3, 0.2) }], 0, longe), true);
  assert.equal(botaoPorOutro(b, [{ p: V(0.1, 0.3, 0) }, { p: V(-0.3, 0.3, 0.2), gone: true }], 0, longe), false);
  assert.equal(botaoPorOutro(b, [{ p: V(0.1, 0.3, 0) }], 0, V(0.3, 0.92, 0.1)), true);
  const c = V(0, 1, 0);
  assert.equal(receptorPorOutra(c, 0.8, [{ uid: 'b7', li: 1, pos: V(0.2, 1, 0) }], 'b7', 1), false);
  assert.equal(receptorPorOutra(c, 0.8, [{ uid: 'b7', li: 1, pos: c }, { uid: 'b9', li: 2, pos: V(0.5, 1, 0.3) }], 'b7', 1), true);
  assert.equal(receptorPorOutra(c, 0.8, [{ uid: 'b9', li: 1, pos: c }], 'b7', 1), false);
});

function duplo(k) {
  const track = [];
  for (let i = 0; i <= 120; i++) track.push({ t: 6 + i / 30, p: V(0, 0.3, i * 0.01), q: new THREE.Quaternion() });
  return novoDuplo({ k, from: 6, to: 10, born: 0, track });
}

test('objeto igual cumpre; duplo sem botão some, com botão é âncora', () => {
  const l = new Linha();
  const d = duplo(3);
  l.duplos.push(d);
  l.compromissos.push({ tipo: 'objeto', k: 3, t: 10, tol: TOL_T, onde: V(0), estado: CUMPRIDO, quando: 10, duplo: d });
  l.irPara(12);
  l.irPara(5);
  assert.equal(l.cumprirObjeto(4, V(0), 10, () => false), null);
  assert.equal(l.cumprirObjeto(4, V(0), 10, (j) => j === 3), l.compromissos[0]);
  l.irPara(12);
  l.irPara(5);
  const r = l.vencidos(11.5);
  assert.equal(r[0].apagar, d);
  l.apagar(d);
  assert.equal(d.ativo, false);
  const l2 = new Linha();
  const d2 = duplo(3);
  d2.botoes.push([1, 8]);
  l2.duplos.push(d2);
  l2.compromissos.push({ tipo: 'objeto', k: 3, t: 10, tol: TOL_T, onde: V(0), estado: PENDENTE, duplo: d2 });
  const a = l2.vencidos(11.5);
  assert.equal(a[0].ancora, d2);
  assert.deepEqual(a[0].botoes, [[1, 8]]);
  // voltar para antes do aperto o esquece
  l2.irPara(9);
  l2.irPara(7);
  assert.deepEqual(d2.botoes, []);
  // a cópia da linha (ponto de volta) é independente e mantém a identidade do duplo
  const c = l2.clone();
  assert.notEqual(c.duplos[0], d2);
  assert.equal(c.duplos[0].id, d2.id);
});

test('laser cumpre perto e vence rápido; emissões só das versões que existem', () => {
  const l = new Linha();
  const e = { clone: 'c1', t: 6, entryT: 10, at: V(0), exit: V(1), dir: V(0, 0, 1), ativo: true, liga: [] };
  l.emissoes.push(e);
  l.compromissos.push({ tipo: 'laser', clone: 'c1', t: 10, tol: TOL_LASER, onde: V(0), estado: PENDENTE, emissao: e });
  assert.equal(l.cumprirLaser([V(2)], 10), 0);
  assert.equal(l.cumprirLaser([V(0.2)], 10.1), 1);
  l.compromissos[0].estado = PENDENTE;
  assert.deepEqual(l.vencidos(10.2), []);
  assert.equal(l.vencidos(10.3)[0].apagar, e);
  assert.equal(l.emissoesEm(6, 0.02, () => true).length, 1);
  assert.equal(l.emissoesEm(6, 0.02, () => false).length, 0);
  assert.equal(l.emissoesEm(7, 0.02, () => true).length, 0);
});

test('caminho da versão passada com folga', () => {
  const l = new Linha();
  l.trechos.push({ clone: 'c2', de: 0, ate: 10, ruim: [0, 0, 0, 0, 0] });
  const objeto = [false, true, false, false, false];
  assert.equal(l.conferirCaminho('c2', objeto, 0.05), null);
  assert.equal(l.conferirCaminho('c2', objeto, 0.05), null);
  assert.equal(l.conferirCaminho('c2', [false, false, false, false, false], 0.05), null);
  assert.equal(l.conferirCaminho('c2', objeto, 0.08), null);
  assert.equal(l.conferirCaminho('c2', objeto, 0.08), CAMINHO[1][0]);
  assert.equal(l.conferirCaminho('c2', [false, false, false, true, false], 0.05), CAMINHO[3][0]);
  assert.equal(l.conferirCaminho('c9', objeto, 1), null);
});
