// Ferramenta "Régua": clique em dois pontos do cenário para ver distância,
// distância horizontal e diferença de altura (e quantos pulos/alturas de jogador isso é).

import * as THREE from 'three';
import { tl, num } from '../../i18n.js';

const fmt = (n) => num(n, 2);

export function createMeasureTool(ctx) {
  const { el, group } = ctx;
  const rulers = []; // [{ a, b }]
  let pending = null;
  const list = el('div', { class: 'report' });
  const panel = el(
    'div',
    { class: 'tool' },
    el('h3', {}, 'Régua'),
    el('p', { class: 'note' }, 'Clique em dois pontos do cenário. Shift prende o ponto na grade. O jogador tem 1,8 m de altura, pula ~1,1 m e anda a 4,6 m/s.'),
    el('button', { class: 'ed-btn', onclick: () => ((rulers.length = 0), (pending = null), draw()) }, 'Limpar'),
    list,
  );

  function clear() {
    for (const c of [...group.children]) {
      group.remove(c);
      c.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
  }
  function dot(p, color = 0xffffff) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.copy(p);
    m.renderOrder = 12;
    group.add(m);
  }
  function draw() {
    clear();
    list.replaceChildren();
    rulers.forEach(({ a, b }, n) => {
      const d = b.clone().sub(a);
      const h = Math.hypot(d.x, d.z);
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffee66, depthTest: false }));
      l.renderOrder = 10;
      group.add(l);
      // catetos: horizontal e vertical
      const c = new THREE.Vector3(b.x, a.y, b.z);
      const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, c, b]), new THREE.LineDashedMaterial({ color: 0x66d9ff, dashSize: 0.3, gapSize: 0.2, depthTest: false }));
      l2.computeLineDistances();
      l2.renderOrder = 10;
      group.add(l2);
      dot(a);
      dot(b);
      list.append(el('p', {}, tl('{n}: {d} m (horizontal {h} m · altura {y} m · {p} jogadores de altura · {s} s andando)', { n: n + 1, d: fmt(d.length()), h: fmt(h), y: (d.y >= 0 ? '+' : '−') + fmt(Math.abs(d.y)), p: fmt(Math.abs(d.y) / 1.8), s: fmt(h / 4.6) })));
    });
    if (pending) dot(pending, 0x66ff99);
    ctx.layer(group);
  }

  return {
    id: 'measure',
    label: 'Régua',
    panel,
    activate: draw,
    deactivate: () => {
      pending = null;
      clear();
    },
    refresh: draw,
    click(e, ray) {
      const s = ctx.surfaceAt(ray);
      if (!s) return true;
      const p = s.p.clone();
      if (e.shiftKey) p.set(...p.toArray().map((v) => Math.round(v / ctx.snap()) * ctx.snap()));
      if (!pending) pending = p;
      else {
        rulers.push({ a: pending, b: p });
        pending = null;
      }
      draw();
      return true;
    },
    key(e) {
      if (e.code === 'Escape') {
        pending = null;
        draw();
      }
    },
  };
}
