// Editor de níveis em 3D dentro do jogo, no estilo do editor do Portal 2:
//   • aba CÂMARA: abra e feche células numa grade (as paredes surgem sozinhas) e pinte as faces
//     (aceita portal / não aceita / vidro);
//   • aba ITENS: arraste da paleta, os itens encaixam no chão, na parede ou no teto da célula;
//     R gira, Del apaga, e "Ligar a…" conecta botões a portas;
//   • ferramentas: régua, trajetória de impulso, alcance, validação e o robô gravado.
// O documento (doc.js) é a verdade; a cada edição o mundo é reconstruído por host.rebuild().

import './editor.css';
import * as THREE from 'three';
import { tl, num, isEN } from '../i18n.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ELEMENTS, typesByGroup, obbOf, dirVec, PUSH_TYPES, PUSH_MODES } from './elements.js';
export { obbOf };
import { add, clone, compile, newDoc, uid } from './doc.js';
import { store } from './store.js';
import { MUSIC_OPTIONS } from '../../audio.js';
import { CELL, FACE_DIRS, PAINTS, cellKey, cellMin, cellCenter, cellOf, chamberBounds, setOpen, parseKey } from './chamber.js';
import { validate } from './tools/validate.js';
import { createTrajTool } from './tools/trajTool.js';
import { createMeasureTool } from './tools/measureTool.js';
import { createReachTool } from './tools/reachTool.js';
import { createBotTool, docHash, proofState } from './tools/recorder.js';

const D2R = Math.PI / 180;
const LAYER = 3; // tudo do editor fica numa camada que a vista dos portais não desenha
const SNAPS = [0.25, 0.5, 1, 2];
const SIG_KEYS = ['sig', 'opens', 'id', 'power'];
const HORIZ = ['+x', '+z', '-x', '-z'];

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const r2 = (n) => Math.round(n * 100) / 100;
const hue = (s) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

/** distância do raio até a caixa orientada, ou null */
function rayObb(o, d, b) {
  const qi = b.q.clone().invert();
  const lo = o.clone().sub(b.c).applyQuaternion(qi);
  const ld = d.clone().applyQuaternion(qi);
  let t0 = 0;
  let t1 = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(ld[a]) < 1e-9) {
      if (Math.abs(lo[a]) > b.h[a]) return null;
    } else {
      let a0 = (-b.h[a] - lo[a]) / ld[a];
      let a1 = (b.h[a] - lo[a]) / ld[a];
      if (a0 > a1) [a0, a1] = [a1, a0];
      t0 = Math.max(t0, a0);
      t1 = Math.min(t1, a1);
      if (t0 > t1) return null;
    }
  }
  return t0;
}

/** células por onde o raio passa (Amanatides–Woo); `face` = por qual face da célula ANTERIOR ele saiu */
function* walk(o, d, maxT = 300) {
  const pos = [(o.x + CELL / 2) / CELL, o.y / CELL, (o.z + CELL / 2) / CELL];
  const cell = pos.map(Math.floor);
  const dir = [d.x, d.y, d.z];
  const step = dir.map(Math.sign);
  const dt = dir.map((x) => (x === 0 ? Infinity : Math.abs(CELL / x)));
  const tmax = dir.map((x, a) => (x === 0 ? Infinity : ((x > 0 ? cell[a] + 1 - pos[a] : pos[a] - cell[a]) * CELL) / Math.abs(x)));
  yield { c: [...cell], face: -1, t: 0 };
  for (let n = 0; n < 700; n++) {
    const a = tmax[0] < tmax[1] ? (tmax[0] < tmax[2] ? 0 : 2) : tmax[1] < tmax[2] ? 1 : 2;
    const t = tmax[a];
    if (t > maxT) return;
    cell[a] += step[a];
    tmax[a] += dt[a];
    yield { c: [...cell], face: a * 2 + (step[a] > 0 ? 0 : 1), t };
  }
}

export function createEditor(host) {
  const { scene, camera, canvas, world } = host;
  let doc = null;
  let active = false;
  let testing = false;
  let openedAt = 0;
  let tab = 'items'; // 'chamber' | 'items'
  let buildTool = 'add'; // 'add' | 'remove' | 'paint'
  let paintKind = 'metal';
  let layer = 0;
  let hideCeil = true;
  let gizmo = null; // null | 'translate' | 'rotate' | 'scale'
  let snap = 0.5;
  let armed = null;
  let armRot = 0;
  let selected = [];
  let linking = null; // id do item que está esperando o outro lado da ligação
  let toolId = null;
  let undo = [];
  let redo = [];
  let clipboard = null;
  let saveTimer = 0;
  let dirty = false;
  let stroke = null; // arrasto de construção/pintura em andamento: { seen:Set }
  let moving = null; // arrasto de um item: { id }
  let picking = null; // escolhendo um ponto no cenário para um campo v3 do item: { id, k, mode }
  let edge = null; // arrasto de uma face (alça de borda): { id, a, sg, n, f0, s0, start, undone, moved }
  let hover = null;
  const cam = { pos: new THREE.Vector3(0, 12, 14), yaw: 0, pitch: -0.6, speed: 10 };
  const keys = new Set();
  const mouse = { rmb: false, mmb: false, over: false, x: 0, y: 0 };
  const itemOf = (id) => doc.items.find((i) => i.id === id);

  // ------------------------------------------------------------------ objetos 3D do editor
  const root = new THREE.Group();
  root.name = 'editor';
  const mark = new THREE.Group();
  const links = new THREE.Group();
  const ghost = new THREE.Group();
  const hoverG = new THREE.Group();
  const toolG = new THREE.Group();
  const handles = new THREE.Group(); // alças nas faces do item selecionado: arrastar uma move só aquela borda
  root.add(mark, links, ghost, hoverG, toolG, handles);
  const grid = new THREE.GridHelper(120, 30, 0x4a6a8a, 0x2a3b4d); // uma linha por célula (4 m)
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.material.depthWrite = false;
  root.add(grid);
  const sky = new THREE.HemisphereLight(0xffffff, 0x556070, 0.45); // luz do editor (o nível pode estar sem luzes)
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const fillGeo = new THREE.BoxGeometry(1, 1, 1);
  const proxy = new THREE.Object3D();
  root.add(proxy);
  const tc = new TransformControls(camera, canvas);
  tc.setSize(0.9);
  const helper = tc.getHelper();
  root.add(helper);
  tc.getRaycaster().layers.enable(LAYER);
  const setLayer = (o) => o.traverse((x) => x.layers.set(LAYER));
  setLayer(root);

  let gdrag = null;
  tc.addEventListener('dragging-changed', (e) => {
    if (e.value) {
      gdrag = { start: new Map(selected.map((id) => [id, clone(itemOf(id))])), pos: proxy.position.clone() };
      pushUndo();
    } else if (gdrag) {
      gdrag = null;
      proxy.scale.set(1, 1, 1);
      changed();
    }
  });
  tc.addEventListener('objectChange', () => {
    if (!gdrag) return;
    for (const id of selected) {
      const it = itemOf(id);
      const s0 = gdrag.start.get(id);
      const T = ELEMENTS[it.type];
      if (tc.mode === 'translate') {
        const d = proxy.position.clone().sub(gdrag.pos);
        it.p = s0.p.map((v, i) => r2(v + d.getComponent(i)));
      } else if (tc.mode === 'rotate' && selected.length === 1) {
        const e = new THREE.Euler().setFromQuaternion(proxy.quaternion, 'YXZ');
        if (T.rot === 'euler') it.r = [r2(e.x / D2R), r2(e.y / D2R), r2(e.z / D2R)];
        else if (T.rot === 'yaw') it.yaw = Math.round(e.y / D2R / 5) * 5;
      } else if (tc.mode === 'scale' && selected.length === 1 && T.shape === 'box') {
        it.s = s0.s.map((v, i) => Math.max(snap, Math.round((v * Math.abs(proxy.scale.getComponent(i))) / snap) * snap));
      }
    }
    refreshMarks();
    fillProps(true);
  });

  // ------------------------------------------------------------------ marcadores
  const lineMat = (color, test = false) => new THREE.LineBasicMaterial({ color, depthTest: test, transparent: true, opacity: 0.95 });
  function boxOutline(b, color, test) {
    const g = new THREE.Group();
    g.add(new THREE.LineSegments(edges, lineMat(color, test)));
    g.position.copy(b.c);
    g.quaternion.copy(b.q);
    g.scale.set(b.h.x * 2, b.h.y * 2, b.h.z * 2);
    return g;
  }
  const disposeKids = (g) => {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        o.geometry !== edges && o.geometry !== fillGeo && o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
  };
  function refreshMarks() {
    disposeKids(mark);
    disposeKids(links);
    if (!doc) return;
    const sel = new Set(selected);
    for (const it of doc.items) {
      const T = ELEMENTS[it.type];
      const b = obbOf(it);
      if (sel.has(it.id)) mark.add(boxOutline(b, linking === it.id ? 0x66ff99 : 0xffd84a, false));
      else if (['spawn', 'trigger', 'gravzone', 'light', 'portal'].includes(it.type)) {
        const o = boxOutline(b, T.color, true);
        if (T.shape === 'box') o.add(new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: T.color, transparent: true, opacity: 0.1, depthWrite: false })));
        mark.add(o);
      }
      if (it.type === 'spawn') {
        const a = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 12), new THREE.MeshBasicMaterial({ color: T.color }));
        const yaw = (it.yaw ?? 0) * D2R;
        const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        a.position.set(it.p[0], it.p[1] + 1.1, it.p[2]).addScaledVector(f, 0.9);
        a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f);
        mark.add(a);
      }
      if (it.type === 'plate' && it.mode === 'alvo') {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.7, depthWrite: false }));
        m.position.set(it.target[0], it.target[1] + 0.03, it.target[2]);
        mark.add(m);
      }
    }
    setLayer(mark);
    // ligações de sinal: de quem liga (opens) para quem é ligado (sig, power, id)
    const src = new Map();
    const dst = new Map();
    for (const it of doc.items)
      for (const k of SIG_KEYS) {
        const v = it[k];
        if (typeof v !== 'string' || !v) continue;
        if (!(ELEMENTS[it.type].params ?? []).some((f) => f.k === k && f.t === 'sig')) continue;
        const m = k === 'opens' ? src : dst;
        m.set(v, [...(m.get(v) ?? []), obbOf(it).c]);
      }
    for (const [name, from] of src)
      for (const a of from)
        for (const b of dst.get(name) ?? []) {
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: new THREE.Color().setHSL(hue(name) / 360, 0.9, 0.62), dashSize: 0.4, gapSize: 0.25, depthTest: false, transparent: true, opacity: 0.85 }));
          l.computeLineDistances();
          links.add(l);
        }
    setLayer(links);
    refreshHandles();
    syncGizmo();
  }

  // ------------------------------------------------------------------ alças de borda
  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const AXIS_COLORS = [0xff5a5a, 0x6aff6a, 0x5aa8ff];
  const handleGeo = new THREE.BoxGeometry(1, 1, 1);
  let hotHandle = null;
  /** item que mostra alças: um só selecionado, com tamanho (shape 'box') */
  function edgeItem() {
    if (selected.length !== 1 || armed || testing || gizmo || tab !== 'items') return null;
    const it = itemOf(selected[0]);
    return it && ELEMENTS[it.type].shape === 'box' ? it : null;
  }
  function refreshHandles() {
    disposeKids(handles);
    if (hotHandle) canvas.style.cursor = '';
    hotHandle = null;
    const it = edgeItem();
    if (!it) return;
    const b = obbOf(it);
    for (let a = 0; a < 3; a++)
      for (const sg of [1, -1]) {
        const m = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: AXIS_COLORS[a], depthTest: false, transparent: true, opacity: 0.9 }));
        const n = AXES[a].clone().multiplyScalar(sg).applyQuaternion(b.q);
        m.position.copy(b.c).addScaledVector(n, b.h.getComponent(a));
        m.quaternion.copy(b.q);
        m.renderOrder = 10;
        m.userData = { a, sg, n };
        handles.add(m);
      }
    setLayer(handles);
    scaleHandles();
  }
  /** as alças têm o mesmo tamanho na tela, perto ou longe */
  function scaleHandles() {
    for (const m of handles.children) m.scale.setScalar(Math.max(0.12, m.position.distanceTo(camera.position) * 0.022) * (m === hotHandle ? 1.5 : 1));
  }
  function pickHandle(r) {
    const R = new THREE.Ray(r.o, r.d);
    let best = null;
    let bd = Infinity;
    for (const m of handles.children) {
      const d = R.distanceToPoint(m.position);
      const t = m.position.clone().sub(r.o).dot(r.d);
      if (t > 0 && d < m.scale.x * 1.8 && t < bd) (best = m), (bd = t);
    }
    return best;
  }
  /** ponto da reta (f0 + s·n) mais perto do raio do mouse: devolve s */
  function alongAxis(r, f0, n) {
    const w0 = f0.clone().sub(r.o);
    const b = n.dot(r.d);
    const den = 1 - b * b;
    if (den < 1e-4) return null; // olhando de frente para o eixo: não dá para medir
    return (b * r.d.dot(w0) - n.dot(w0)) / den;
  }
  function startEdge(m, r) {
    const it = itemOf(selected[0]);
    const { a, sg, n } = m.userData;
    const f0 = m.position.clone();
    const s0 = alongAxis(r, f0, n);
    if (s0 === null) return false;
    edge = { id: it.id, a, sg, n: n.clone(), f0, s0, start: clone(it), undone: false, moved: false, sym: false };
    return true;
  }
  /** arrasta a face: a oposta fica parada (com Shift, as duas se afastam juntas) */
  function dragEdge(e) {
    const it = itemOf(edge.id);
    if (!it) return;
    const s = alongAxis(mouseRay(e), edge.f0, edge.n);
    if (s === null) return;
    const { a, sg, n, f0, start } = edge;
    let d = s - edge.s0;
    // item sem giro: a face encaixa na grade do mundo; girado: o tamanho muda em passos da grade
    const k = 'xyz'[a];
    const plain = !start.r || start.r.every((v) => Math.abs(v % 360) < 1e-6);
    if (plain) d = (snapTo(f0[k] + d * sg) - f0[k]) * sg;
    else d = snapTo(d);
    const sym = e.shiftKey;
    const grow = sym ? 2 * d : d;
    const size = Math.max(snap, r2(start.s[a] + grow));
    d = sym ? (size - start.s[a]) / 2 : size - start.s[a];
    const s3 = [...start.s];
    s3[a] = size;
    const p = sym ? [...start.p] : start.p.map((v, i) => r2(v + n.getComponent(i) * (d / 2)));
    if (s3.every((v, i) => v === it.s[i]) && p.every((v, i) => v === it.p[i])) return;
    if (!edge.undone) {
      pushUndo();
      edge.undone = true;
    }
    it.s = s3;
    it.p = p;
    edge.moved = true; // (como no arrasto de mover: o mundo se refaz ao soltar)
    refreshMarks();
    fillProps(true);
    setStatus(`${tl(['largura (x)', 'altura (y)', 'profundidade (z)'][a])}: ${r2(size)} m${sym ? tl(' · Shift: dos dois lados') : ''}`);
  }
  function syncGizmo() {
    if (!selected.length || armed || testing || !gizmo || tab !== 'items') {
      tc.detach();
      helper.visible = false;
      return;
    }
    const c = new THREE.Vector3();
    for (const id of selected) c.add(obbOf(itemOf(id)).c);
    c.divideScalar(selected.length);
    proxy.position.copy(c);
    proxy.scale.set(1, 1, 1);
    const one = selected.length === 1 ? itemOf(selected[0]) : null;
    proxy.quaternion.copy(one ? obbOf(one).q : new THREE.Quaternion());
    tc.attach(proxy);
    tc.setMode(gizmo);
    tc.enabled = true;
    helper.visible = true;
    tc.setTranslationSnap(snap);
    tc.setRotationSnap(5 * D2R);
    tc.setScaleSnap(null);
    tc.setSpace(gizmo === 'translate' ? 'world' : 'local');
  }

  // ------------------------------------------------------------------ documento
  function pushUndo() {
    undo.push(JSON.stringify(doc));
    if (undo.length > 150) undo.shift();
    redo = [];
    syncButtons();
  }
  function restore(json) {
    doc = JSON.parse(json);
    selected = selected.filter((id) => itemOf(id));
    changed();
  }
  const doUndo = () => undo.length && (redo.push(JSON.stringify(doc)), restore(undo.pop()));
  const doRedo = () => redo.length && (undo.push(JSON.stringify(doc)), restore(redo.pop()));

  function rebuild() {
    dirty = false;
    host.rebuild(compile(doc, store.list().findIndex((d) => d.id === doc.id)));
    applyCeil();
    for (const [id, t] of Object.entries(tools)) (id === toolId ? t.refresh : t.stale)?.call(t);
  }
  /** esconde o que está acima da camada que você edita (o teto): não atrapalha a vista nem o clique */
  function applyCeil() {
    for (const b of world.solids) {
      const c = b.mesh?.userData?.cell;
      if (!c) continue;
      const hide = hideCeil && c[1] > layer;
      b.mesh.visible = hide ? false : b.mesh.userData.vis;
    }
  }
  function changed() {
    rebuild();
    refreshMarks();
    fillProps();
    syncButtons();
    scheduleSave();
  }
  function scheduleSave() {
    setStatus('salvando…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }
  function save() {
    clearTimeout(saveTimer);
    if (!doc) return;
    setStatus(store.save(doc) ? 'salvo no navegador' : 'não consegui salvar (sem espaço?) — use Exportar');
  }

  // ------------------------------------------------------------------ itens
  function select(ids, additive = false) {
    selected = additive ? [...new Set([...selected, ...ids])] : ids;
    if (picking && !selected.includes(picking.id)) (picking = null), disposeKids(hoverG);
    refreshMarks();
    fillProps();
  }
  function addItem(type, over = {}) {
    pushUndo();
    if (ELEMENTS[type].unique) doc.items = doc.items.filter((i) => i.type !== type);
    const it = add(doc, type, over);
    selected = [it.id];
    changed();
    return it;
  }
  function removeItems(ids = selected) {
    if (!ids.length) return;
    pushUndo();
    doc.items = doc.items.filter((i) => !ids.includes(i.id));
    selected = [];
    changed();
  }
  const offsetCopy = (src) => {
    const c = clone(src);
    c.id = uid();
    c.p = c.p.map((v, i) => (i === 1 ? v : r2(v + CELL / 2)));
    return c;
  };
  function duplicate(ids = selected) {
    const list = ids.map(itemOf).filter((i) => i && !ELEMENTS[i.type].unique);
    if (!list.length) return;
    pushUndo();
    const news = list.map(offsetCopy);
    doc.items.push(...news);
    selected = news.map((i) => i.id);
    changed();
  }
  const copy = () => ((clipboard = selected.map((id) => clone(itemOf(id)))), setStatus(tl('{n} copiado(s)', { n: clipboard.length })));
  function paste() {
    const list = (clipboard ?? []).filter((i) => !ELEMENTS[i.type].unique);
    if (!list.length) return;
    pushUndo();
    const news = list.map(offsetCopy);
    doc.items.push(...news);
    selected = news.map((i) => i.id);
    changed();
  }
  /** gira 90° (R): o giro do item, a direção da tomada ou a orientação da porta */
  function rotateOne(it) {
    const T = ELEMENTS[it.type];
    if (T.rot === 'yaw') it.yaw = (((it.yaw ?? 0) + 90) % 360 + 360) % 360;
    else if (T.rot === 'euler') it.r[1] = (it.r[1] + 90) % 360;
    else if (T.params?.some((f) => f.k === 'dir')) {
      const i = HORIZ.indexOf(it.dir);
      if (i >= 0) it.dir = HORIZ[(i + 1) % 4];
    } else if (T.place === 'face') {
      // a porta troca de plano: gira em volta do centro da face
      it.s = [it.s[2], it.s[1], it.s[0]];
    }
  }
  function rotateSel() {
    if (armed) {
      armRot = (armRot + 1) % 4;
      return updateGhost();
    }
    if (!selected.length) return;
    pushUndo();
    for (const id of selected) rotateOne(itemOf(id));
    changed();
  }

  // ligações (botão → porta)
  const isSource = (it) => (ELEMENTS[it.type].params ?? []).some((f) => f.k === 'opens');
  const sinkKey = (it) => (ELEMENTS[it.type].params ?? []).find((f) => f.t === 'sig' && f.k !== 'opens')?.k ?? null;
  function nextSig() {
    const used = new Set();
    for (const it of doc.items) for (const k of SIG_KEYS) if (typeof it[k] === 'string') used.add(it[k]);
    for (let n = 0; n < 26 * 27; n++) {
      const s = n < 26 ? String.fromCharCode(65 + n) : String.fromCharCode(65 + Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26));
      if (!used.has(s)) return s;
    }
    return uid().slice(0, 4);
  }
  function link(a, b) {
    const src = isSource(a) && sinkKey(b) ? a : isSource(b) && sinkKey(a) ? b : null;
    if (!src) return false;
    const snk = src === a ? b : a;
    const key = sinkKey(snk);
    pushUndo();
    if (src.opens) snk[key] = src.opens; // a fonte comanda várias portas
    else if (snk[key]) src.opens = snk[key]; // várias fontes na mesma porta: todas precisam estar ligadas
    else src.opens = snk[key] = nextSig();
    changed();
    return true;
  }
  function unlink(src, snk) {
    pushUndo();
    snk[sinkKey(snk)] = '';
    changed();
  }

  // ------------------------------------------------------------------ raio do mouse e colocação
  const ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
  function mouseRay(e) {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    camera.updateMatrixWorld();
    ray.o.copy(camera.position);
    ray.d.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    return ray;
  }
  function pickItem(r) {
    const hits = [];
    for (const it of doc.items) {
      const t = rayObb(r.o, r.d, obbOf(it));
      if (t !== null) hits.push({ it, t, vol: obbOf(it).h.lengthSq() });
    }
    if (!hits.length) return null;
    hits.sort((a, b) => a.t - b.t);
    const near = hits.filter((h) => h.t - hits[0].t < 0.03);
    near.sort((a, b) => a.vol - b.vol);
    return near[0].it;
  }
  /** onde o mouse toca o cenário: superfície do mundo ou o plano do chão da camada */
  function surfaceAt(r) {
    // (o teto escondido não conta: o clique atravessa; as simulações das ferramentas, sim, o enxergam)
    const h = world.raycast(r.o, r.d, 400, (b) => !(hideCeil && b.mesh?.userData?.cell?.[1] > layer));
    if (h) return { p: h.point.clone(), n: h.normal.clone() };
    const y = layer * CELL;
    if (Math.abs(r.d.y) > 1e-4) {
      const t = (y - r.o.y) / r.d.y;
      if (t > 0 && t < 400) return { p: r.o.clone().addScaledVector(r.d, t), n: new THREE.Vector3(0, 1, 0) };
    }
    return null;
  }
  const snapTo = (v, g = snap) => Math.round(v / g) * g;
  const axisOfNormal = (n) => ['x', 'y', 'z'].reduce((m, a) => (Math.abs(n[a]) > Math.abs(n[m]) ? a : m), 'x');
  const dirName = (n) => {
    const a = axisOfNormal(n);
    return `${n[a] >= 0 ? '+' : '-'}${a}`;
  };
  /** encaixe do item: no chão (centro da célula), na parede (grade de 1 m), no teto ou na face da célula */
  function placementFor(type, s, rot = armRot) {
    const T = ELEMENTS[type];
    const place = T.place ?? 'free';
    const out = { p: null, extra: {} };
    const inside = s.p.clone().addScaledVector(s.n, 0.05); // um passo para dentro da câmara
    const cell = cellOf(inside.x, inside.y, inside.z);
    if (place === 'floor') {
      const c = cellCenter(...cell);
      out.p = [c[0], s.n.y > 0.5 ? s.p.y : cell[1] * CELL, c[2]];
      if (T.rot === 'yaw') out.extra.yaw = rot * 90;
    } else if (place === 'ceiling') {
      const c = cellCenter(...cell);
      out.p = [c[0], s.n.y < -0.5 ? s.p.y : cell[1] * CELL + CELL - (type === 'light' ? 0.35 : 0), c[2]];
    } else if (place === 'wall') {
      const a = axisOfNormal(s.n);
      const p = s.p.toArray().map((v, i) => (['x', 'y', 'z'][i] === a ? v : snapTo(v, 1)));
      out.p = p;
      if (T.params?.some((f) => f.k === 'dir')) out.extra.dir = dirName(s.n);
      if (T.rot === 'yaw') out.extra.yaw = a === 'y' ? rot * 90 : Math.round((Math.atan2(-s.n.x, -s.n.z) / D2R + 180) % 360);
    } else if (place === 'face') {
      // face da célula que o olhar atravessa: o eixo dominante do olhar decide se a porta fica em X ou Z
      const f = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, cam.yaw, 0));
      const alongX = Math.abs(f.x) > Math.abs(f.z);
      const base = T.size;
      if (alongX) {
        out.p = [Math.round((inside.x - CELL / 2) / CELL) * CELL + CELL / 2, cell[1] * CELL + base[1] / 2, cell[2] * CELL];
        out.extra.s = [base[2], base[1], base[0]];
      } else {
        out.p = [cell[0] * CELL, cell[1] * CELL + base[1] / 2, Math.round((inside.z - CELL / 2) / CELL) * CELL + CELL / 2];
        out.extra.s = [...base];
      }
    } else if (T.shape === 'box') {
      const h = T.size.map((v) => v / 2);
      const c = [s.p.x + s.n.x * h[0], s.p.y + s.n.y * h[1], s.p.z + s.n.z * h[2]];
      out.p = c.map((v, i) => snapTo(v - h[i]) + h[i]);
    } else out.p = s.p.toArray().map((v) => snapTo(v));
    out.p = out.p.map(r2);
    return out;
  }
  function updateGhost(e) {
    disposeKids(ghost);
    if (!armed || tab !== 'items' || !mouse.over) return;
    const s = surfaceAt(mouseRay(e ?? { clientX: mouse.x, clientY: mouse.y }));
    if (!s) return;
    const { p, extra } = placementFor(armed, s);
    const T = ELEMENTS[armed];
    const tmp = { type: armed, p, s: extra.s ?? (T.size ? [...T.size] : undefined), r: [0, 0, 0], yaw: extra.yaw ?? 0 };
    const o = boxOutline(obbOf(tmp), T.color, false);
    o.add(new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: T.color, transparent: true, opacity: 0.25, depthWrite: false })));
    ghost.add(o);
    setLayer(ghost);
    setStatus(tl('{label} em {p} — clique para pôr · R gira · Esc cancela', { label: tl(T.label), p: p.map((v) => r2(v)).join(', ') }));
  }

  // ------------------------------------------------------------------ construção da câmara
  const isOpen = (c) => doc.chamber.open.includes(cellKey(...c)) && !(hideCeil && c[1] > layer);
  function targetRemove(r) {
    for (const s of walk(r.o, r.d)) if (isOpen(s.c)) return { cell: s.c };
    return null;
  }
  function targetAdd(r) {
    let seen = false;
    for (const s of walk(r.o, r.d)) {
      if (isOpen(s.c)) seen = true;
      else if (seen) return { cell: s.c };
    }
    const y = layer * CELL + CELL / 2;
    if (Math.abs(r.d.y) > 1e-4) {
      const t = (y - r.o.y) / r.d.y;
      if (t > 0 && t < 400) {
        const p = r.o.clone().addScaledVector(r.d, t);
        return { cell: cellOf(p.x, y, p.z) };
      }
    }
    return null;
  }
  function targetPaint(r) {
    let inside = false;
    let prev = null;
    for (const s of walk(r.o, r.d)) {
      if (isOpen(s.c)) inside = true;
      else if (inside) return { cell: prev.c, face: s.face };
      prev = s;
    }
    return null;
  }
  function chamberTarget(r) {
    return buildTool === 'add' ? targetAdd(r) : buildTool === 'remove' ? targetRemove(r) : targetPaint(r);
  }
  function drawHover(t) {
    disposeKids(hoverG);
    if (!t || tab !== 'chamber') return;
    const color = buildTool === 'add' ? 0x4cff8a : buildTool === 'remove' ? 0xff5050 : paintKind === 'white' ? 0xffffff : paintKind === 'glass' ? 0x9fd8ff : 0xffb347;
    const m = cellMin(...t.cell);
    if (buildTool === 'paint') {
      const [dx, dy, dz] = FACE_DIRS[t.face];
      const q = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
      q.position.set(m[0] + CELL / 2 + (dx * CELL) / 2, m[1] + CELL / 2 + (dy * CELL) / 2, m[2] + CELL / 2 + (dz * CELL) / 2);
      q.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx, dy, dz));
      q.renderOrder = 20;
      hoverG.add(q);
    } else {
      const o = boxOutline({ c: new THREE.Vector3(m[0] + CELL / 2, m[1] + CELL / 2, m[2] + CELL / 2), h: new THREE.Vector3(CELL / 2, CELL / 2, CELL / 2), q: new THREE.Quaternion() }, color, false);
      o.add(new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false })));
      hoverG.add(o);
    }
    setLayer(hoverG);
  }
  function floodPaint(cell, face, kind) {
    // pinta todas as faces vizinhas no mesmo plano que tinham a mesma tinta da clicada
    const ch = doc.chamber;
    const paintAt = (c) => ch.paint[`${cellKey(...c)},${face}`] ?? 'white';
    const from = paintAt(cell);
    const axes = [0, 1, 2].filter((a) => a !== Math.floor(face / 2));
    const seen = new Set([cellKey(...cell)]);
    const q = [cell];
    const [dx, dy, dz] = FACE_DIRS[face];
    while (q.length) {
      const c = q.shift();
      setPaint(c, face, kind);
      for (const a of axes)
        for (const s of [-1, 1]) {
          const n = [...c];
          n[a] += s;
          const k = cellKey(...n);
          if (seen.has(k) || !ch.open.includes(k) || ch.open.includes(cellKey(n[0] + dx, n[1] + dy, n[2] + dz)) || paintAt(n) !== from) continue;
          seen.add(k);
          q.push(n);
        }
    }
  }
  function setPaint(cell, face, kind) {
    const key = `${cellKey(...cell)},${face}`;
    if (kind === 'white') delete doc.chamber.paint[key];
    else doc.chamber.paint[key] = kind;
  }
  function applyChamber(t, e) {
    if (!t) return false;
    const k = `${t.cell.join(',')},${t.face ?? ''}`;
    if (stroke.seen.has(k)) return false;
    stroke.seen.add(k);
    if (!stroke.undone) (pushUndo(), (stroke.undone = true));
    let did = false;
    if (buildTool === 'add') did = setOpen(doc.chamber, ...t.cell, true);
    else if (buildTool === 'remove') did = setOpen(doc.chamber, ...t.cell, false);
    else {
      if (e?.shiftKey) floodPaint(t.cell, t.face, paintKind);
      else setPaint(t.cell, t.face, paintKind);
      did = true;
    }
    if (did) dirty = true;
    return did;
  }

  // ------------------------------------------------------------------ ferramentas
  const toolCtx = {
    el,
    THREE,
    world,
    portals: host.portals,
    doc: () => doc,
    toast: (m) => host.toast(m),
    snap: () => snap,
    surfaceAt,
    addItem,
    layer: setLayer,
    env: () => ({ world, portals: host.portals, gravityAt: (p, out) => out.copy(host.gravityAt(p)) }),
    makeGhost: () => host.makeGhost(),
    /** Robô → Trajetória: a velocidade dele num ponto vira o lançamento livre (você escolhe de onde sai) */
    useVelocity(v) {
      if (toolId !== 'traj') setToolId('traj');
      tools.traj.setLaunch(v);
      host.toast(tools.traj.picking ? tl('Velocidade do robô: {v} m/s. Clique na plataforma de onde ele vai sair.', { v: num(v.length()) }) : 'Velocidade do robô no lançamento livre.');
    },
    clearProof() {
      pushUndo();
      delete doc.recording;
      changed();
      tools.bot.sync();
    },
  };
  const tools = {};
  for (const [id, make] of [['traj', createTrajTool], ['measure', createMeasureTool], ['reach', createReachTool], ['bot', createBotTool]]) {
    const g = new THREE.Group();
    toolG.add(g);
    tools[id] = make({ ...toolCtx, group: g });
  }
  function setToolId(id) {
    if (toolId) tools[toolId]?.deactivate?.();
    toolId = toolId === id ? null : id;
    if (toolId && tools[toolId]) tools[toolId].activate?.();
    fillTool();
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === toolId);
  }
  function runValidate() {
    const out = validate(doc, { world, portals: host.portals });
    const box = el('div', { class: 'tool' }, el('h3', {}, 'Validação'));
    for (const m of out) {
      const row = el('button', { class: `issue ${m.level}`, onclick: () => (m.ids.length ? (select(m.ids), focus()) : null) }, `${m.level === 'erro' ? '✖' : m.level === 'aviso' ? '⚠' : '✔'} ${tl(m.text)}`);
      box.append(row);
    }
    box.append(el('button', { class: 'ed-btn', onclick: () => fillTool() }, 'Revalidar'));
    return box;
  }
  function fillTool() {
    toolBox.replaceChildren();
    if (!toolId) return;
    toolBox.append(toolId === 'validate' ? runValidate() : tools[toolId].panel);
  }

  // ------------------------------------------------------------------ interface
  const ui = el('div', { id: 'ed', hidden: true });
  const top = el('div', { id: 'ed-top' });
  const left = el('div', { id: 'ed-left' });
  const right = el('div', { id: 'ed-right' });
  const toolBox = el('div', { id: 'ed-tools' });
  const propBox = el('div', { id: 'ed-props' });
  right.append(toolBox, propBox);
  const bottom = el('div', { id: 'ed-bottom' }, el('span', { id: 'ed-msg' }), el('span', { id: 'ed-hint' }));
  ui.append(top, left, right, bottom);
  document.body.append(ui);

  const btn = (label, title, fn, cls = '') => el('button', { class: `ed-btn ${cls}`, title, onclick: fn }, label);
  const nameIn = el('input', {
    id: 'ed-name',
    maxlength: '60',
    onchange: (e) => {
      pushUndo();
      doc.name = e.target.value.trim() || 'Sem nome';
      changed();
    },
  });
  const tabBtns = {
    chamber: btn('① Câmara', 'Abrir células, fechar e pintar (1)', () => setTab('chamber'), 'tab'),
    items: btn('② Itens', 'Colocar botões, portas, lasers… (2)', () => setTab('items'), 'tab'),
  };
  const toolBtns = {};
  for (const [id, label, title] of [['measure', 'Régua', 'Medir distâncias'], ['traj', 'Trajetória', 'Ver o arco de um lançamento'], ['reach', 'Alcance', 'O que o jogador alcança'], ['validate', 'Validar', 'Procurar problemas'], ['bot', 'Robô', 'Prova gravada']])
    toolBtns[id] = btn(label, title, () => setToolId(id), 'tool');
  const undoB = btn('↶', 'Desfazer (Ctrl+Z)', doUndo);
  const redoB = btn('↷', 'Refazer (Ctrl+Y)', doRedo);
  const saveSt = el('span', { id: 'ed-save' });
  const layerLabel = el('span', { class: 'lbl' });
  const ceilB = btn('Teto', 'Esconde o que está acima da camada', () => ((hideCeil = !hideCeil), applyCeil(), syncButtons()), 'tool');
  top.append(
    btn('← Menu', 'Salvar e voltar ao menu', () => exit()),
    nameIn,
    el('span', { class: 'sep' }),
    tabBtns.chamber,
    tabBtns.items,
    el('span', { class: 'sep' }),
    undoB,
    redoB,
    btn('▶ Testar', 'Jogar este nível (F5)', () => test(), 'go'),
    el('span', { class: 'sep' }),
    btn('Persp.', 'Vista livre', () => view('persp')),
    btn('Cima', 'Vista de cima', () => view('top')),
    el('span', { class: 'lbl' }, 'Andar'),
    btn('−', 'Camada de baixo (PageDown)', () => setLayerTo(layer - 1)),
    layerLabel,
    btn('+', 'Camada de cima (PageUp)', () => setLayerTo(layer + 1)),
    ceilB,
    el('span', { class: 'sep' }),
    ...Object.values(toolBtns),
    el('span', { class: 'grow' }),
    saveSt,
    btn('Exportar', 'Baixar como arquivo .json', () => (save(), store.exportFile(doc))),
  );
  function setLayerTo(n) {
    layer = Math.max(-3, Math.min(8, n));
    applyCeil();
    syncButtons();
    drawHover(null);
  }
  function setTab(t) {
    tab = t;
    selected = [];
    armed = null;
    linking = null;
    disposeKids(ghost);
    disposeKids(hoverG);
    fillLeft();
    syncButtons();
    refreshMarks();
    fillProps();
    setStatus('');
  }
  function syncButtons() {
    undoB.disabled = !undo.length;
    redoB.disabled = !redo.length;
    for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('on', k === tab);
    ceilB.classList.toggle('on', hideCeil);
    layerLabel.textContent = String(layer + 1);
    $hint.textContent =
      tab === 'chamber'
        ? tl('clique/arraste: ') + tl(buildTool === 'paint' ? 'pinta (Shift = toda a parede)' : buildTool === 'add' ? 'abre células' : 'fecha células') + tl(' · A adiciona · X remove · P pinta · PgUp/PgDn muda de andar')
        : 'arraste para mover · arraste as alças coloridas para mexer só uma borda (Shift: as duas) · R gira 90° · Del apaga · Ctrl+D duplica · botão direito + WASD voa · F foca';
    syncPalette();
  }
  const $hint = bottom.querySelector('#ed-hint');
  function setStatus(s) {
    bottom.querySelector('#ed-msg').textContent = s;
    if (/salv|export/.test(s)) saveSt.textContent = s;
  }
  const palBtns = new Map();
  function syncPalette() {
    for (const [k, x] of palBtns) x.classList.toggle('on', k === armed);
  }
  function fillLeft() {
    left.replaceChildren();
    palBtns.clear();
    if (tab === 'chamber') {
      const mk = (id, label, title) => btn(label, title, () => ((buildTool = id), fillLeft(), syncButtons(), drawHover(null)), `pal big${buildTool === id ? ' on' : ''}`);
      left.append(
        el('div', { class: 'grp' }, el('b', {}, 'Câmara'), mk('add', '＋ Abrir células', 'Abre a célula apontada (A)'), mk('remove', '− Fechar células', 'Enche a célula apontada (X)'), mk('paint', '🎨 Pintar faces', 'Pinta a parede, o chão ou o teto apontado (P)')),
      );
      if (buildTool === 'paint')
        left.append(
          el('div', { class: 'grp' }, el('b', {}, 'Tinta'),
            ...PAINTS.map(([k, label]) => btn(label, '', () => ((paintKind = k), fillLeft(), drawHover(null)), `pal${paintKind === k ? ' on' : ''}`))),
        );
      left.append(
        el('div', { class: 'grp' }, el('b', {}, 'Dicas'),
          el('p', { class: 'note' }, 'Cada célula tem 4 m. Em cima você enxerga de fora porque o teto some; “Andar” escolhe em que altura você desenha. Branco aceita portal, preto/metal não.')),
      );
      return;
    }
    for (const [g, list] of typesByGroup()) {
      const box = el('div', { class: 'grp' }, el('b', {}, g));
      for (const [key, T] of list) {
        const b = el('button', {
          class: 'pal',
          title: T.label,
          onclick: () => {
            armed = armed === key ? null : key;
            armRot = 0;
            select([]);
            syncPalette();
            updateGhost();
            setStatus(armed ? tl('{label}: clique no cenário para colocar', { label: tl(T.label) }) : '');
          },
        }, el('i', { style: `background:#${T.color.toString(16).padStart(6, '0')}` }), T.label);
        palBtns.set(key, b);
        box.append(b);
      }
      left.append(box);
    }
    syncPalette();
  }

  // painel de propriedades
  function sigNames() {
    const s = new Set();
    for (const it of doc.items) for (const k of SIG_KEYS) if (typeof it[k] === 'string' && it[k]) s.add(it[k]);
    return [...s];
  }
  function field(it, f) {
    const set = (v) => {
      pushUndo();
      it[f.k] = v;
      changed();
    };
    if (f.t === 'bool') return el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: !!it[f.k], onchange: (e) => set(e.target.checked) }), f.label);
    if (f.t === 'select') return el('label', { class: 'f' }, el('span', {}, f.label), el('select', { onchange: (e) => set(e.target.value) }, f.o.map(([v, l]) => el('option', { value: v, selected: v === it[f.k] }, l))));
    if (f.t === 'color') return el('label', { class: 'f' }, el('span', {}, f.label), el('input', { type: 'color', value: it[f.k] ?? '#ffffff', onchange: (e) => set(e.target.value) }));
    if (f.t === 'sig') return null; // os sinais aparecem na seção “Ligações”
    if (f.t === 'v3') {
      const on = picking?.id === it.id && picking.k === f.k;
      return el('div', { class: 'f' }, el('span', {}, f.label), el('div', { class: 'v3' }, [0, 1, 2].map((i) =>
        el('input', { type: 'number', step: '0.5', value: it[f.k][i], onchange: (e) => {
          pushUndo();
          it[f.k] = it[f.k].map((v, j) => (j === i ? Number(e.target.value) || 0 : v));
          changed();
        } }))),
        f.pick ? btn(on ? 'Clique no cenário… (Esc cancela)' : '◎ Escolher no cenário', 'Escolher o ponto com o mouse', () => startPick(on ? null : { id: it.id, k: f.k, mode: f.pick }), on ? 'on' : '') : null);
    }
    if (f.t === 'text') return el('label', { class: 'f' }, el('span', {}, f.label), el('input', { type: 'text', value: it[f.k] ?? '', maxlength: '120', onchange: (e) => set(e.target.value) }));
    return el('label', { class: 'f' }, el('span', {}, f.label), el('input', { type: 'number', step: f.step ?? 'any', min: f.min, max: f.max, value: it[f.k] ?? '', onchange: (e) => set(e.target.value === '' ? null : Number(e.target.value)) }));
  }
  /** escolher um ponto com o mouse (ex.: o pouso da placa de lançamento) */
  function startPick(pk) {
    picking = pk;
    disposeKids(hoverG);
    fillProps();
    setStatus(pk ? 'Clique no lugar onde quer que caia' : '');
  }
  function pickPreview(e) {
    disposeKids(hoverG);
    const s = surfaceAt(mouseRay(e));
    if (!s) return null;
    const p = [snapTo(s.p.x), r2(s.p.y), snapTo(s.p.z)];
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.85, depthTest: false }));
    m.position.set(p[0], p[1] + 0.03, p[2]);
    m.renderOrder = 12;
    hoverG.add(m);
    setLayer(hoverG);
    setStatus(tl('Pouso em {p}', { p: p.map((v) => (isEN ? String(v) : String(v).replace('.', ','))).join('; ') }));
    return p;
  }
  function connectionsBox(it) {
    const sinks = isSource(it) && it.opens ? doc.items.filter((o) => o !== it && sinkKey(o) && o[sinkKey(o)] === it.opens) : [];
    const sources = sinkKey(it) && it[sinkKey(it)] ? doc.items.filter((o) => o !== it && isSource(o) && o.opens === it[sinkKey(it)]) : [];
    const rows = [];
    // como o item ligado reage a um botão de apertar (cada item do seu jeito; vazio = o modo do botão)
    const pushMode = (sink, button) => {
      const set = (k, v) => {
        pushUndo();
        if (v === '' || v === null) delete sink[k];
        else sink[k] = v;
        changed();
      };
      const def = PUSH_MODES.find(([v]) => v === (button.mode ?? 'timer'))?.[1] ?? '';
      return el('div', { class: 'f' },
        el('label', { class: 'f' }, el('span', {}, 'Ao apertar o botão'),
          el('select', { onchange: (e) => set('pmode', e.target.value) },
            el('option', { value: '', selected: !sink.pmode }, tl('Como o botão ({m})', { m: tl(def.replace(/ \(.*\)/, '').toLowerCase()) })),
            PUSH_MODES.map(([v, l]) => el('option', { value: v, selected: sink.pmode === v }, l)))),
        sink.pmode === 'timer'
          ? el('label', { class: 'f' }, el('span', {}, 'Tempo ligado (s)'), el('input', { type: 'number', step: '0.5', min: '0.5', value: sink.ptime ?? 4, onchange: (e) => set('ptime', Number(e.target.value) || 4) }))
          : null);
    };
    for (const o of sinks) {
      rows.push(el('div', { class: 'conn' }, el('button', { class: 'lnk', onclick: () => select([o.id]) }, `→ ${tl(ELEMENTS[o.type].label)}`), btn('✕', 'Desligar', () => unlink(it, o), 'danger sm')));
      if (PUSH_TYPES.has(it.type)) rows.push(pushMode(o, it));
    }
    for (const o of sources) {
      rows.push(el('div', { class: 'conn' }, el('button', { class: 'lnk', onclick: () => select([o.id]) }, `← ${tl(ELEMENTS[o.type].label)}`), btn('✕', 'Desligar', () => unlink(o, it), 'danger sm')));
      if (PUSH_TYPES.has(o.type)) rows.push(pushMode(it, o));
    }
    const can = isSource(it) || sinkKey(it);
    if (!can) return null;
    return el('div', { class: 'f' },
      el('span', {}, isSource(it) ? 'Liga' : 'É ligada por'),
      ...rows,
      btn(linking === it.id ? 'Clique no outro item… (Esc cancela)' : '＋ Ligar a…', 'Conectar com um botão/receptor ou com uma porta', () => {
        linking = linking === it.id ? null : it.id;
        refreshMarks();
        fillProps();
        setStatus(linking ? 'Clique no item que será ligado' : '');
      }, linking === it.id ? 'on' : ''),
      el('details', {}, el('summary', {}, 'Sinal (avançado)'),
        ...(ELEMENTS[it.type].params ?? []).filter((f) => f.t === 'sig').map((f) =>
          el('label', { class: 'f' }, el('span', {}, f.label), el('input', { type: 'text', value: it[f.k] ?? '', maxlength: '12', onchange: (e) => {
            pushUndo();
            it[f.k] = e.target.value.trim();
            changed();
          } })))));
  }
  let propKey = '';
  function fillProps(onlyValues = false) {
    if (!doc) return;
    const key = selected.join(',');
    if (onlyValues && key === propKey) {
      const it = selected.length === 1 ? itemOf(selected[0]) : null;
      if (it) {
        propBox.querySelectorAll('[data-p]').forEach((i) => (i.value = it.p[Number(i.dataset.p)]));
        propBox.querySelectorAll('[data-s]').forEach((i) => (i.value = it.s?.[Number(i.dataset.s)]));
        propBox.querySelectorAll('[data-r]').forEach((i) => (i.value = it.r?.[Number(i.dataset.r)] ?? it.yaw));
      }
      return;
    }
    propKey = key;
    propBox.replaceChildren();
    if (!selected.length) return void propBox.append(...levelPanel());
    if (selected.length > 1) {
      propBox.append(el('h3', {}, tl('{n} itens', { n: selected.length })), btn('Duplicar (Ctrl+D)', '', () => duplicate()), btn('Apagar (Del)', '', () => removeItems(), 'danger'));
      return;
    }
    const it = itemOf(selected[0]);
    const T = ELEMENTS[it.type];
    const vec = (label, arr, attr, step = snap) =>
      el('div', { class: 'f' }, el('span', {}, label), el('div', { class: 'v3' }, [0, 1, 2].map((i) =>
        el('input', { type: 'number', step, value: arr[i], [`data-${attr}`]: i, onchange: (e) => {
          pushUndo();
          arr[i] = Number(e.target.value) || 0;
          if (attr === 's') arr[i] = Math.max(0.05, arr[i]);
          changed();
        } }))));
    propBox.append(el('h3', {}, T.label));
    propBox.append(el('div', { class: 'row gz' },
      ...[['translate', '✥'], ['rotate', '⟳'], ['scale', '⤢']].map(([m, l]) => btn(l, tl(m === 'translate' ? 'Alça de mover (avançado)' : m === 'rotate' ? 'Alça de girar (avançado)' : 'Alça de esticar (avançado)'), () => ((gizmo = gizmo === m ? null : m), syncGizmo(), fillProps()), `sm${gizmo === m ? ' on' : ''}`))));
    propBox.append(vec('Posição', it.p, 'p'));
    if (it.s) propBox.append(vec('Tamanho', it.s, 's'));
    if (it.r) propBox.append(vec('Rotação (°)', it.r, 'r', 5));
    if (T.rot === 'yaw')
      propBox.append(el('label', { class: 'f' }, el('span', {}, 'Giro (°)'), el('input', { type: 'number', step: 90, value: it.yaw ?? 0, 'data-r': 0, onchange: (e) => {
        pushUndo();
        it.yaw = Number(e.target.value) || 0;
        changed();
      } })));
    const conn = connectionsBox(it);
    if (conn) propBox.append(conn);
    for (const f of T.params ?? []) propBox.append(field(it, f) ?? '');
    propBox.append(el('div', { class: 'row' }, btn('Girar 90° (R)', '', () => rotateSel()), btn('Duplicar', 'Ctrl+D', () => duplicate()), btn('Apagar', 'Del', () => removeItems(), 'danger')));
  }
  function levelPanel() {
    const c = doc.cfg;
    const set = (k, v) => {
      pushUndo();
      c[k] = v;
      changed();
    };
    const st = proofState(doc);
    return [
      el('h3', {}, 'Este nível'),
      el('label', { class: 'f' }, el('span', {}, 'Objetivo (mostrado na tela)'), el('input', { type: 'text', value: c.lesson, maxlength: '120', onchange: (e) => set('lesson', e.target.value) })),
      el('label', { class: 'f' }, el('span', {}, 'Arma de portais'), el('select', { onchange: (e) => set('gun', e.target.value) }, [['both', 'Os dois portais'], ['blue', 'Só o ciano'], ['none', 'Nenhuma (use o pedestal)']].map(([v, l]) => el('option', { value: v, selected: v === c.gun }, l)))),
      el('label', { class: 'f' }, el('span', {}, 'Gravidade (m/s²)'), el('input', { type: 'number', step: 0.1, min: 0, value: c.gravity, onchange: (e) => set('gravity', Number(e.target.value)) })),
      el('label', { class: 'f' }, el('span', {}, 'Música'), el('select', { onchange: (e) => set('music', e.target.value) }, MUSIC_OPTIONS.map(([v, l]) => el('option', { value: v, selected: v === (c.music || 'lab') }, l)))),
      el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: c.autoLight !== false, onchange: (e) => set('autoLight', e.target.checked) }), 'Luzes de teto automáticas'),
      el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: !!c.relogio, onchange: (e) => set('relogio', e.target.checked) }), 'Relógio do tempo (tecla 2, portal temporal)'),
      el('p', { class: 'note' }, tl('{c} células · {n} itens · prova: {p}', { c: doc.chamber.open.length, n: doc.items.length, p: tl(st === 'none' ? 'nenhuma' : st === 'valid' ? 'válida ✔' : 'desatualizada ⚠') })),
      el('div', { class: 'row' },
        btn('Importar .json', '', () => importDialog()),
        btn('Apagar nível', 'Remove do navegador', () => {
          if (confirm(tl('Apagar “{name}” de vez?', { name: doc.name }))) {
            store.remove(doc.id);
            exit(true);
          }
        }, 'danger')),
    ];
  }
  function importDialog() {
    const inp = el('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      try {
        const d = await store.importFile(inp.files[0]);
        store.save(d);
        host.toast(tl('“{name}” importado: aparece em Meus níveis.', { name: d.name }));
        open(d.id);
      } catch (err) {
        host.toast(tl('Não deu para importar: {msg}', { msg: err.message }));
      }
    });
    inp.click();
  }

  // ------------------------------------------------------------------ câmera
  function bounds() {
    const box = chamberBounds(doc.chamber);
    for (const it of doc.items) {
      const b = obbOf(it);
      box.expandByPoint(b.c.clone().sub(b.h));
      box.expandByPoint(b.c.clone().add(b.h));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 4, 4));
    return box;
  }
  function focus() {
    const box = new THREE.Box3();
    if (selected.length)
      for (const id of selected) {
        const b = obbOf(itemOf(id));
        box.expandByPoint(b.c.clone().sub(b.h));
        box.expandByPoint(b.c.clone().add(b.h));
      }
    else box.copy(bounds());
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(4, box.getSize(new THREE.Vector3()).length() * 0.8);
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
    cam.pos.copy(c).addScaledVector(dir, -r);
  }
  function view(kind) {
    const box = bounds();
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(14, box.getSize(new THREE.Vector3()).length() * 0.95);
    if (kind === 'top') {
      cam.pitch = -Math.PI / 2 + 0.001;
      cam.yaw = 0;
      cam.pos.set(c.x, c.y + r, c.z);
    } else {
      cam.pitch = -0.7;
      cam.yaw = 0.45;
      const f = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
      cam.pos.copy(c).addScaledVector(f, -r);
    }
  }

  // ------------------------------------------------------------------ entrada
  const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  function onKeyDown(e) {
    if (!active || e.defaultPrevented) return;
    if (e.code === 'F5') {
      e.preventDefault();
      if (performance.now() - openedAt > 400) test(); // (o mesmo F5 que acabou de voltar do teste não manda testar de novo)
      return;
    }
    if (typing()) {
      if (e.code === 'Escape') document.activeElement.blur();
      return;
    }
    keys.add(e.code);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') (e.preventDefault(), e.shiftKey ? doRedo() : doUndo());
    else if (ctrl && e.code === 'KeyY') (e.preventDefault(), doRedo());
    else if (ctrl && e.code === 'KeyD') (e.preventDefault(), duplicate());
    else if (ctrl && e.code === 'KeyC') copy();
    else if (ctrl && e.code === 'KeyV') paste();
    else if (ctrl && e.code === 'KeyA') (e.preventDefault(), tab === 'items' && select(doc.items.map((i) => i.id)));
    else if (ctrl && e.code === 'KeyS') (e.preventDefault(), save());
    else if (!mouse.rmb && !ctrl) {
      if (toolId && tools[toolId]?.key?.(e)) return;
      if (e.code === 'Digit1') setTab('chamber');
      else if (e.code === 'Digit2') setTab('items');
      else if (e.code === 'PageUp') setLayerTo(layer + 1);
      else if (e.code === 'PageDown') setLayerTo(layer - 1);
      else if (e.code === 'KeyF') focus();
      else if (tab === 'chamber') {
        if (e.code === 'KeyA') ((buildTool = 'add'), fillLeft(), syncButtons());
        else if (e.code === 'KeyX') ((buildTool = 'remove'), fillLeft(), syncButtons());
        else if (e.code === 'KeyP') ((buildTool = 'paint'), fillLeft(), syncButtons());
      } else {
        if (e.code === 'Delete' || e.code === 'Backspace') removeItems();
        else if (e.code === 'KeyR') rotateSel();
        else if (e.code === 'Escape' && picking) startPick(null);
        else if (e.code === 'Escape') {
          armed = null;
          linking = null;
          select([]);
          disposeKids(ghost);
          syncPalette();
        }
      }
    }
  }
  const onKeyUp = (e) => keys.delete(e.code);
  function onPointerDown(e) {
    if (!active || e.target !== canvas) return;
    if (e.button === 2) (mouse.rmb = true), canvas.setPointerCapture?.(e.pointerId);
    else if (e.button === 1) (mouse.mmb = true), canvas.setPointerCapture?.(e.pointerId), e.preventDefault();
    else if (e.button === 0 && !tc.dragging) {
      const r = mouseRay(e);
      if (picking) {
        const it = itemOf(picking.id);
        const p = pickPreview(e);
        if (it && p) {
          pushUndo();
          it[picking.k] = p;
          if (picking.mode) it.mode = picking.mode;
          picking = null;
          disposeKids(hoverG);
          changed();
          setStatus('Pouso escolhido.');
        }
        return;
      }
      if (toolId && tools[toolId]?.click?.(e, r)) return;
      if (tab === 'chamber') {
        stroke = { seen: new Set(), undone: false };
        applyChamber(chamberTarget(r), e);
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
      if (armed) {
        const s = surfaceAt(r);
        if (s) {
          const { p, extra } = placementFor(armed, s);
          pushUndo();
          if (ELEMENTS[armed].unique) doc.items = doc.items.filter((i) => i.type !== armed);
          const it = add(doc, armed, { p, ...extra });
          selected = [it.id];
          changed();
          if (e.shiftKey === false && ['spawn', 'exit', 'stars'].includes(armed)) {
            armed = null;
            syncPalette();
            disposeKids(ghost);
          }
        }
        return;
      }
      if (tc.axis) return; // clicou no gizmo
      const h = !linking && pickHandle(r);
      if (h && startEdge(h, r)) return canvas.setPointerCapture?.(e.pointerId);
      const it = pickItem(r);
      if (linking) {
        const from = itemOf(linking);
        if (it && it !== from && link(from, it)) host.toast('Ligado.');
        else if (it && it !== from) host.toast('Esses dois não se ligam (um precisa ser botão/receptor, o outro uma porta, plataforma, funil, laser ou grade).');
        linking = null;
        refreshMarks();
        fillProps();
        setStatus('');
        return;
      }
      if (it) {
        const was = selected.includes(it.id);
        select([it.id], e.shiftKey);
        if (was && !e.shiftKey && selected.length === 1) moving = { id: it.id, undone: false, moved: false, y: it.p[1] };
        if (moving) canvas.setPointerCapture?.(e.pointerId);
      } else if (!e.shiftKey) select([]);
    }
  }
  function onPointerUp(e) {
    if (e.button === 2) mouse.rmb = false;
    if (e.button === 1) mouse.mmb = false;
    if (e.button === 0) {
      if (stroke) {
        stroke = null;
        if (dirty) changed();
      }
      if (moving) {
        const m = moving;
        moving = null;
        if (m.moved) changed();
      }
      if (edge) {
        const m = edge;
        edge = null;
        if (m.moved) changed();
      }
    }
  }
  function moveItem(e) {
    const it = itemOf(moving.id);
    if (!it) return;
    const T = ELEMENTS[it.type];
    const r = mouseRay(e);
    let p = null;
    if (T.place === 'wall') {
      const s = surfaceAt(r);
      if (s) {
        const pl = placementFor(it.type, s);
        p = pl.p;
        Object.assign(it, pl.extra);
      }
    } else {
      // desliza no plano da altura do item
      const y = it.p[1] + (T.place === 'face' ? 0 : 0);
      if (Math.abs(r.d.y) < 1e-4) return;
      const t = (y - r.o.y) / r.d.y;
      if (t <= 0 || t > 600) return;
      const hit = r.o.clone().addScaledVector(r.d, t);
      if (T.place === 'floor' || T.place === 'ceiling') {
        const c = cellOf(hit.x, y + 0.01, hit.z);
        p = [cellCenter(...c)[0], it.p[1], cellCenter(...c)[2]];
      } else if (T.place === 'face') {
        const alongX = it.s[0] < it.s[2];
        p = alongX ? [Math.round((hit.x - CELL / 2) / CELL) * CELL + CELL / 2, it.p[1], snapTo(hit.z, CELL)] : [snapTo(hit.x, CELL), it.p[1], Math.round((hit.z - CELL / 2) / CELL) * CELL + CELL / 2];
      } else p = [snapTo(hit.x), it.p[1], snapTo(hit.z)];
    }
    if (!p) return;
    p = p.map(r2);
    if (p.every((v, i) => v === it.p[i])) return;
    if (!moving.undone) {
      pushUndo(); // (guarda o documento ainda com o item no lugar de antes)
      moving.undone = true;
    }
    it.p = p;
    moving.moved = true;
    refreshMarks();
    fillProps(true);
  }
  function onPointerMove(e) {
    if (!active) return;
    mouse.over = e.target === canvas || stroke !== null || moving !== null || edge !== null;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (mouse.rmb) {
      cam.yaw -= e.movementX * 0.0035;
      cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch - e.movementY * 0.0035));
      return;
    }
    if (mouse.mmb) {
      const right_ = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, cam.yaw, 0));
      cam.pos.addScaledVector(right_, -e.movementX * 0.02 * (cam.speed / 8));
      cam.pos.y += e.movementY * 0.02 * (cam.speed / 8);
      return;
    }
    if (!mouse.over) return;
    if (stroke) {
      applyChamber(chamberTarget(mouseRay(e)), e);
      if (dirty) rebuild(), refreshMarks();
      return;
    }
    if (edge) return dragEdge(e);
    if (picking) return void pickPreview(e);
    if (moving) return moveItem(e);
    if (handles.children.length) {
      const h = pickHandle(mouseRay(e));
      if (h !== hotHandle) {
        hotHandle = h;
        scaleHandles();
        canvas.style.cursor = h ? 'grab' : '';
      }
    }
    if (tab === 'chamber') {
      hover = chamberTarget(mouseRay(e));
      drawHover(hover);
      const t = hover;
      setStatus(t ? (buildTool === 'paint' ? tl('Face {f} da célula {c}', { f: tl(['leste', 'oeste', 'teto', 'chão', 'sul', 'norte'][t.face]), c: t.cell.join(', ') }) : tl('Célula {c} (andar {n})', { c: t.cell.join(', '), n: t.cell[1] + 1 })) : '');
    } else if (armed) updateGhost(e);
  }
  function onWheel(e) {
    if (!active || e.target !== canvas) return;
    e.preventDefault();
    if (mouse.rmb) {
      cam.speed = Math.max(1, Math.min(80, cam.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      setStatus(tl('velocidade de voo {v} m/s', { v: cam.speed.toFixed(0) }));
      return;
    }
    const d = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
    cam.pos.addScaledVector(d, -Math.sign(e.deltaY) * Math.max(1.5, cam.speed * 0.5));
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', () => keys.clear());

  // ------------------------------------------------------------------ ciclo de vida
  function open(id) {
    const d = typeof id === 'string' ? store.get(id) : null;
    doc = d ? clone(d) : newDoc();
    if (!d) store.save(doc);
    undo = [];
    redo = [];
    selected = [];
    armed = null;
    linking = null;
    testing = false;
    active = true;
    openedAt = performance.now();
    ui.hidden = false;
    nameIn.value = doc.name;
    document.body.classList.add('editing');
    scene.add(root, sky);
    camera.layers.enable(LAYER);
    camera.fov = 70;
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    cam.speed = 10;
    layer = 0;
    tab = 'items';
    toolId = null;
    fillTool();
    fillLeft();
    rebuild();
    refreshMarks();
    fillProps();
    view('persp');
    syncButtons();
    setStatus('');
    saveSt.textContent = '';
    for (const b of Object.values(toolBtns)) b.classList.remove('on');
  }
  function leaveScene() {
    active = false;
    ui.hidden = true;
    document.body.classList.remove('editing');
    tc.detach();
    scene.remove(root, sky);
    camera.layers.disable(LAYER);
    if (toolId) tools[toolId]?.deactivate?.();
    tools.bot.dispose?.();
  }
  function exit(deleted = false) {
    if (!deleted) save();
    leaveScene();
    testing = false;
    doc = null;
    host.leave();
  }
  function test() {
    if (!active) return;
    save();
    leaveScene();
    testing = true;
    host.test(compile(doc, store.list().findIndex((d) => d.id === doc.id)));
  }
  /** volta do teste para o editor, com o documento como estava */
  function resume() {
    if (!testing || !doc) return;
    open(doc.id);
  }
  /** a prova (caminho gravado) de quem completou o nível no teste */
  function saveProof(rec) {
    if (!doc) return;
    doc.recording = { ...rec, hash: docHash(doc) };
    store.save(doc);
  }

  function frame(dt) {
    if (!active) return;
    if (dirty && !stroke) rebuild(), refreshMarks();
    const spd = cam.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1) * dt;
    if (mouse.rmb) {
      const f = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
      const r = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, cam.yaw, 0));
      if (keys.has('KeyW')) cam.pos.addScaledVector(f, spd);
      if (keys.has('KeyS')) cam.pos.addScaledVector(f, -spd);
      if (keys.has('KeyD')) cam.pos.addScaledVector(r, spd);
      if (keys.has('KeyA')) cam.pos.addScaledVector(r, -spd);
      if (keys.has('KeyE') || keys.has('Space')) cam.pos.y += spd;
      if (keys.has('KeyQ')) cam.pos.y -= spd;
    }
    camera.position.copy(cam.pos);
    camera.quaternion.setFromEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
    camera.updateMatrixWorld();
    grid.position.x = Math.round(cam.pos.x / CELL) * CELL - CELL / 2;
    grid.position.z = Math.round(cam.pos.z / CELL) * CELL - CELL / 2;
    grid.position.y = layer * CELL + 0.01;
    scaleHandles();
    if (toolId) tools[toolId]?.frame?.(dt);
  }

  return {
    open,
    exit,
    resume,
    frame,
    saveProof,
    get active() {
      return active;
    },
    get testing() {
      return testing;
    },
    get doc() {
      return doc;
    },
    // para testes automatizados
    _api: {
      test, add: addItem, select, remove: removeItems, undo: doUndo, redo: doRedo, obbOf, pickItem: (o, d) => pickItem({ o, d }), cam, view, changed, setTab, setToolId, link, rotateSel, setLayerTo,
      chamber: { setOpen: (i, j, k, on) => (pushUndo(), setOpen(doc.chamber, i, j, k, on), changed()), paint: (cell, face, kind) => (pushUndo(), setPaint(cell, face, kind), changed()) },
      get selected() { return selected; },
      get tools() { return tools; },
      placementFor, surfaceAt, validate: () => validate(doc, { world, portals: host.portals }),
    },
  };
}

export { dirVec, parseKey };
