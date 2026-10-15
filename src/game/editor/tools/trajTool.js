// Ferramenta "Trajetória": mostra o arco de quem é lançado (placas de lançamento,
// bolas de energia dos lançadores e um lançamento livre que você ajusta).

import * as THREE from 'three';
import { flight, pellet, PLAYER_HALF } from './trajectory.js';

const COLORS = [0x66d9ff, 0xffb347, 0xff6a9a, 0x9aff6a, 0xb06cff, 0xffee66];
const END_COLOR = { pouso: 0x4cff8a, parede: 0xffa94d, mata: 0xff4040, grade: 0xb06cff, tempo: 0xaaaaaa, abismo: 0xff4040, vida: 0xaaaaaa, rebates: 0xaaaaaa };
const END_TEXT = {
  pouso: 'pousa em uma superfície',
  parede: 'bate numa parede',
  mata: 'cai na rocha fundida',
  grade: 'é desintegrado na grade',
  tempo: 'ainda está no ar depois de 14 s',
  abismo: 'cai no vazio',
  vida: 'some depois de viver o tempo todo',
  rebates: 'quica sem parar',
};
const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');

export function createTrajTool(ctx) {
  const { el, group } = ctx;
  const S = { plates: true, pellets: true, origin: null, yaw: 0, pitch: 35, speed: 12, picking: false, report: [], ends: [] };
  const report = el('div', { class: 'report' });
  const inputs = {};
  const row = (label, key, min, max, step) => {
    const num = el('input', { type: 'number', min, max, step, value: S[key], onchange: (e) => ((S[key] = Number(e.target.value)), (range.value = S[key]), refresh()) });
    const range = el('input', { type: 'range', min, max, step, value: S[key], oninput: (e) => ((S[key] = Number(e.target.value)), (num.value = S[key]), refresh()) });
    inputs[key] = [num, range];
    return el('div', { class: 'f' }, el('span', {}, label), el('div', { class: 'two' }, range, num));
  };
  const pickBtn = el('button', { class: 'ed-btn', onclick: () => ((S.picking = !S.picking), sync()) }, '');
  const panel = el(
    'div',
    { class: 'tool' },
    el('h3', {}, 'Trajetória'),
    el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => ((S.plates = e.target.checked), refresh()) }), 'Arco das placas de lançamento'),
    el('label', { class: 'f chk' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => ((S.pellets = e.target.checked), refresh()) }), 'Caminho das bolas de energia'),
    el('p', { class: 'note' }, 'Lançamento livre: escolha de onde sai e para onde vai.'),
    pickBtn,
    row('Direção (° — 0 = norte, 90 = oeste)', 'yaw', -180, 180, 5),
    row('Subida (°)', 'pitch', -90, 90, 1),
    row('Velocidade (m/s)', 'speed', 0, 40, 0.5),
    el('div', { class: 'row' },
      el('button', { class: 'ed-btn', onclick: () => preset('andar') }, 'Andar'),
      el('button', { class: 'ed-btn', onclick: () => preset('pular') }, 'Pular'),
      el('button', { class: 'ed-btn', onclick: () => preset('cair') }, 'Cair')),
    el('button', { class: 'ed-btn go', onclick: () => makePlate() }, 'Criar placa de lançamento com este arco'),
    report,
    el('p', { class: 'note' }, 'Estimativa do centro do corpo com a gravidade, as placas e os portais do nível; não inclui funis nem o jogador mudando de direção no ar.'),
  );

  function sync() {
    pickBtn.textContent = S.picking ? 'Clique no cenário para escolher a origem…' : S.origin ? `Origem: ${S.origin.toArray().map((v) => fmt(v)).join(', ')} (trocar)` : 'Escolher origem no cenário';
    pickBtn.classList.toggle('on', S.picking);
    for (const [k, [num, range]] of Object.entries(inputs)) num.value = range.value = S[k];
  }
  function preset(kind) {
    if (kind === 'andar') Object.assign(S, { pitch: 0, speed: 4.6 });
    else if (kind === 'pular') Object.assign(S, { pitch: 45, speed: 6.5 });
    else Object.assign(S, { pitch: 0, speed: 0 });
    sync();
    refresh();
  }
  const velOf = () => {
    const y = (S.yaw * Math.PI) / 180;
    const p = (S.pitch * Math.PI) / 180;
    return new THREE.Vector3(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)).multiplyScalar(S.speed);
  };
  function makePlate() {
    if (!S.origin) return ctx.toast('Escolha a origem primeiro.');
    const feet = S.origin.clone().sub(new THREE.Vector3(0, PLAYER_HALF.y + 0.05, 0));
    const v = velOf();
    ctx.addItem('plate', { p: feet.toArray().map((x) => Math.round(x * 4) / 4), mode: 'vel', vel: v.toArray().map((x) => Math.round(x * 10) / 10) });
    ctx.toast('Placa criada. Ela lança com a velocidade do arco.');
  }

  // ------------------------------------------------------------------ desenho
  function clear() {
    for (const c of [...group.children]) {
      group.remove(c);
      c.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
  }
  function drawPath(pts, seg, endKind, endPos, times) {
    // uma linha por trecho (cada portal atravessado muda de cor)
    let from = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i === pts.length || seg[i] !== seg[from]) {
        const part = pts.slice(from, i);
        if (part.length > 1) {
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(part), new THREE.LineBasicMaterial({ color: COLORS[seg[from] % COLORS.length], depthTest: false, transparent: true, opacity: 0.95 }));
          l.renderOrder = 10;
          group.add(l);
        }
        from = i;
      }
    }
    // marcas a cada meio segundo
    if (times) {
      const ticks = [];
      let next = 0.5;
      for (let i = 0; i < pts.length; i++)
        if (times[i] >= next) {
          ticks.push(pts[i]);
          next += 0.5;
        }
      if (ticks.length) {
        const p = new THREE.Points(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: false, depthTest: false }));
        p.renderOrder = 11;
        group.add(p);
      }
    }
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: END_COLOR[endKind] ?? 0xffffff, depthTest: false }));
    m.position.copy(endPos);
    m.renderOrder = 12;
    group.add(m);
  }

  function refresh() {
    clear();
    report.replaceChildren();
    S.report = [];
    S.ends = [];
    const env = ctx.env();
    const add = (title, r, kind) => {
      drawPath(r.pts, r.seg, r.end.kind, r.end.pos, r.times);
      const st = r.stats;
      const line =
        kind === 'bola'
          ? `${title}: ${END_TEXT[r.end.kind]}; ${st.bounces} rebate(s), ${st.portals} portal(is), ${fmt(st.time)} s`
          : `${title}: ${END_TEXT[r.end.kind]}. Sobe ${fmt(st.maxHeight)} m · alcance ${fmt(st.range)} m · ${fmt(st.time)} s · chega a ${fmt(st.speed)} m/s${r.passes.length ? ` · ${r.passes.length} portal(is)` : ''}`;
      S.report.push(line);
      S.ends.push(r.end.pos.clone());
      report.append(el('p', {}, line));
    };
    if (S.plates)
      ctx.world.plates.forEach((P, n) => {
        const r = flight(env, { pos: P.pos.clone().add(new THREE.Vector3(0, 0.2 + PLAYER_HALF.y + 0.05, 0)), vel: P.vel.clone() });
        add(`Placa ${n + 1}`, r, 'voo');
      });
    if (S.pellets)
      ctx.world.launchers.forEach((L, n) => {
        add(`Bola ${n + 1}`, pellet(env, { pos: L.pos.clone(), dir: L.dir.clone(), speed: L.speed, life: L.life }), 'bola');
      });
    if (S.origin) {
      const r = flight(env, { pos: S.origin.clone(), vel: velOf() });
      add('Lançamento livre', r, 'voo');
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      m.position.copy(S.origin).add(new THREE.Vector3(0, 0.4, 0));
      m.rotation.x = Math.PI;
      m.renderOrder = 12;
      group.add(m);
    }
    ctx.layer(group);
    if (!S.report.length) report.append(el('p', { class: 'note' }, 'Nada para mostrar: ponha uma placa de lançamento ou um lançador no nível, ou escolha uma origem.'));
  }
  sync();

  return {
    id: 'traj',
    label: 'Trajetória',
    panel,
    activate: refresh,
    deactivate: () => {
      S.picking = false;
      clear();
    },
    refresh,
    get ends() {
      return S.ends;
    },
    /** clique no cenário (devolve true se usou) */
    click(e, ray) {
      if (!S.picking) return false;
      const s = ctx.surfaceAt(ray);
      if (!s) return true;
      const up = s.n.y > 0.5;
      S.origin = s.p.clone().add(up ? new THREE.Vector3(0, PLAYER_HALF.y + 0.05, 0) : s.n.clone().multiplyScalar(0.4));
      if (!up) S.origin.y = s.p.y + 0.5;
      S.picking = false;
      sync();
      refresh();
      return true;
    },
  };
}
