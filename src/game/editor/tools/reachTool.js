// Ferramenta "Alcance": pinta os lugares que o jogador alcança a partir do ponto
// de partida (ou de um ponto escolhido) e diz se o elevador de saída entra.

import * as THREE from 'three';
import { reach, reached } from './reach.js';

const fmt = (n) => String(n);

export function createReachTool(ctx) {
  const { el, group } = ctx;
  const S = { ignoreDoors: true, plates: true, portals: true, start: null, picking: false, running: false, token: 0 };
  const info = el('div', { class: 'report' });
  const bar = el('div', { class: 'bar' }, el('i', {}));
  bar.hidden = true;
  const pickBtn = el('button', { class: 'ed-btn', onclick: () => ((S.picking = !S.picking), sync()) }, '');
  const go = el('button', { class: 'ed-btn go', onclick: () => run() }, 'Calcular alcance');
  const panel = el(
    'div',
    { class: 'tool' },
    el('h3', {}, 'Alcance do jogador'),
    el('p', { class: 'note' }, 'Verde = o jogador chega andando, pulando, caindo, pelas placas de lançamento e pelos portais fixos. Estimativa: não conta cubos como degrau nem portais que o jogador abriria.'),
    el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => (S.ignoreDoors = e.target.checked) }), 'Considerar as portas abertas'),
    el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => (S.plates = e.target.checked) }), 'Usar placas de lançamento'),
    el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => (S.portals = e.target.checked) }), 'Usar portais fixos'),
    pickBtn,
    go,
    bar,
    info,
  );
  function sync() {
    pickBtn.textContent = S.picking ? 'Clique no cenário…' : S.start ? `Ponto de partida: ${S.start.toArray().map((v) => v.toFixed(1)).join(', ')} (trocar)` : 'Partir do ponto de partida do nível (trocar…)';
    pickBtn.classList.toggle('on', S.picking);
  }
  function clear() {
    for (const c of [...group.children]) {
      group.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
  }
  let last = null;
  async function run() {
    const doc = ctx.doc();
    const spawn = doc.items.find((i) => i.type === 'spawn');
    const start = S.start ?? (spawn ? new THREE.Vector3(...spawn.p) : null);
    if (!start) return ctx.toast('O nível não tem ponto de partida.');
    const token = ++S.token;
    S.running = true;
    go.disabled = true;
    bar.hidden = false;
    info.replaceChildren(el('p', {}, 'Calculando…'));
    const r = await reach(ctx.env(), {
      start,
      ignoreDoors: S.ignoreDoors,
      plates: S.plates,
      portals: S.portals,
      maxCells: 14000,
      onProgress: (n) => (bar.firstChild.style.width = `${Math.min(100, (n / 14000) * 100)}%`),
      cancelled: () => token !== S.token,
    });
    if (token !== S.token) return;
    S.running = false;
    go.disabled = false;
    bar.hidden = true;
    last = r;
    draw(r);
    const exits = doc.items.filter((i) => i.type === 'exit');
    const lines = [`${r.cells.length} posições alcançáveis${r.truncated ? ' (busca cortada: o nível é grande demais)' : ''}.`];
    for (const e of exits) {
      const ok = reached(r.cells, new THREE.Vector3(...e.p), 1.6, 1.4);
      lines.push(ok ? '✔ O elevador de saída é alcançável.' : '✖ O elevador de saída NÃO é alcançável com o que o jogador tem aqui (talvez falte um portal, uma porta aberta por botão ou um cubo).');
    }
    const unreach = doc.items.filter((i) => ['button', 'pedestal', 'cube'].includes(i.type) && !reached(r.cells, new THREE.Vector3(...i.p), 1.6, 1.4));
    if (unreach.length) lines.push(`Fora do alcance: ${unreach.map((i) => `${i.type === 'button' ? 'botão' : i.type === 'cube' ? 'cubo' : 'pedestal'} em ${i.p.map((v) => v.toFixed(0)).join(', ')}`).join('; ')}.`);
    info.replaceChildren(...lines.map((t) => el('p', {}, t)));
  }
  function draw(r) {
    clear();
    if (!r.cells.length) return;
    const geo = new THREE.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x35e07a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, r.cells.length);
    const m = new THREE.Matrix4();
    r.cells.forEach((c, i) => mesh.setMatrixAt(i, m.makeTranslation(c.x, c.y + 0.04, c.z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    ctx.layer(group);
  }
  sync();
  return {
    id: 'reach',
    label: 'Alcance',
    panel,
    activate() {
      if (last) draw(last);
    },
    deactivate() {
      S.picking = false;
      S.token++;
      clear();
    },
    stale() {
      last = null;
    },
    refresh() {
      // o nível mudou: o resultado antigo não vale mais
      last = null;
      clear();
      info.replaceChildren(el('p', { class: 'note' }, 'O nível mudou: calcule de novo.'));
    },
    click(e, ray) {
      if (!S.picking) return false;
      const s = ctx.surfaceAt(ray);
      if (s) {
        S.start = s.p.clone();
        S.picking = false;
        sync();
      }
      return true;
    },
  };
}
