// Robô gravado: quando você completa o nível no teste (F5), o caminho vira a
// "prova" de que ele tem solução. Aqui você a reproduz como um fantasma.

import * as THREE from 'three';
import { tl, num, isEN } from '../../i18n.js';

/** impressão do conteúdo do nível (sem a gravação): a prova só vale enquanto ela não muda */
export function docHash(doc) {
  const s = JSON.stringify({ c: doc.cfg, h: doc.chamber, i: doc.items.map(({ id, ...r }) => r) });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export const proofState = (doc) => (!doc.recording ? 'none' : doc.recording.hash === docHash(doc) ? 'valid' : 'old');
export const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const fmt = (n, d = 1) => num(n, d);
const R2D = 180 / Math.PI;

/** velocidade do robô no quadro n: a gravada; nas provas antigas, pela diferença entre quadros (sem pular portal) */
export function velAt(rec, n) {
  const S = rec.samples;
  const s = S[n];
  if (s.length >= 10) return new THREE.Vector3(s[7], s[8], s[9]);
  const P = (i) => new THREE.Vector3(S[i][0], S[i][1], S[i][2]);
  const jump = (i, j) => P(i).distanceTo(P(j)) > 40 * rec.dt * Math.abs(j - i); // atravessou portal
  const a = n > 0 && !jump(n - 1, n) ? n - 1 : n;
  const b = n < S.length - 1 && !jump(n, n + 1) ? n + 1 : n;
  return b > a ? P(b).sub(P(a)).divideScalar((b - a) * rec.dt) : new THREE.Vector3();
}

export function createBotTool(ctx) {
  const { el, group } = ctx;
  const S = { t: 0, playing: false, speed: 1, ghost: null, n: 0 };
  const info = el('div', { class: 'report' });
  const velInfo = el('div', { class: 'report' });
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, 0xffd84a, 0.35, 0.22);
  arrow.traverse((o) => o.material && ((o.material.depthTest = false), (o.renderOrder = 12)));
  arrow.visible = false;
  let velRow = null;
  const step = (k) => {
    const rec = ctx.doc().recording;
    if (!rec) return;
    S.playing = false;
    S.t = Math.max(0, Math.min(total(), (Math.round(S.t / rec.dt) + k) * rec.dt));
    sync();
    pose();
  };
  const play = el('button', { class: 'ed-btn go', onclick: () => ((S.playing = !S.playing), (S.t = S.playing && S.t >= total() ? 0 : S.t), sync()) }, '');
  const slider = el('input', { type: 'range', min: 0, max: 1000, value: 0, oninput: (e) => ((S.t = (e.target.value / 1000) * total()), pose()) });
  const panel = el(
    'div',
    { class: 'tool' },
    el('h3', {}, 'Robô gravado'),
    el('p', { class: 'note' }, 'Teste o nível (F5) e chegue ao elevador de saída: o seu caminho é gravado como prova de que dá para completar. Quando você muda o nível, a prova fica desatualizada.'),
    info,
    play,
    slider,
    el('div', { class: 'row' },
      el('button', { class: 'ed-btn', onclick: () => ((S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 0.5 : 1), sync()) }, 'Velocidade'),
      el('button', { class: 'ed-btn danger', onclick: () => ctx.clearProof() }, 'Apagar prova')),
    el('p', { class: 'note' }, 'Pare o robô no ponto que interessa (clique no caminho verde ou use ◀ ▶ quadro a quadro) e leve a velocidade dele para a Trajetória.'),
    (velRow = el('div', { class: 'row' },
      el('button', { class: 'ed-btn', title: 'Quadro anterior', onclick: () => step(-1) }, '◀'),
      el('button', { class: 'ed-btn', title: 'Próximo quadro', onclick: () => step(1) }, '▶'),
      el('button', { class: 'ed-btn go', onclick: () => useVel() }, 'Usar na Trajetória'))),
    velInfo,
  );
  const total = () => ((ctx.doc().recording?.samples.length ?? 1) - 1) * (ctx.doc().recording?.dt ?? 1 / 30);

  function sync() {
    const d = ctx.doc();
    const st = proofState(d);
    play.textContent = S.playing ? '⏸ Pausar' : '▶ Reproduzir';
    play.disabled = st === 'none';
    slider.disabled = st === 'none';
    for (const b of velRow.querySelectorAll('button')) b.disabled = st === 'none';
    const rec = d.recording;
    info.replaceChildren(
      el('p', {}, st === 'none' ? 'Ainda não há prova gravada.' : st === 'valid' ? tl('✔ Prova válida: {time} de jogo, {n} quadros.', { time: fmtTime(rec.time), n: rec.samples.length }) : tl('⚠ Prova desatualizada (o nível mudou depois dela): {time}.', { time: fmtTime(rec.time) })),
      el('p', { class: 'note' }, tl('Velocidade {v}×', { v: S.speed })),
    );
  }
  function clear() {
    for (const c of [...group.children]) {
      group.remove(c);
      if (c === arrow) continue; // a seta é sempre a mesma
      c.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
  }
  function path() {
    clear();
    const rec = ctx.doc().recording;
    if (!rec) return;
    const pts = rec.samples.map((s) => new THREE.Vector3(s[0], s[1] - 0.8, s[2]));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x66ff99, depthTest: false, transparent: true, opacity: 0.8 }));
    l.renderOrder = 10;
    group.add(l);
    group.add(arrow);
    ctx.layer(group);
    pose();
  }
  /** velocidade e posição (centro do corpo) do robô no quadro atual */
  function here() {
    const rec = ctx.doc().recording;
    if (!rec) return null;
    const s = rec.samples[S.n];
    return { v: velAt(rec, S.n), pos: new THREE.Vector3(s[0], s[1], s[2]), t: S.n * rec.dt };
  }
  function showVel() {
    const h = here();
    if (!h) return velInfo.replaceChildren();
    const { v, pos, t } = h;
    const hz = Math.hypot(v.x, v.z);
    const yaw = Math.atan2(-v.x, -v.z) * R2D;
    velInfo.replaceChildren(
      el('p', {}, tl('Em {time} (quadro {n}): {v} m/s', { time: `${fmtTime(t)}${isEN ? '.' : ','}${Math.floor((t % 1) * 10)}`, n: S.n, v: fmt(v.length()) })),
      el('p', { class: 'note' }, `${tl('horizontal {v} m/s', { v: fmt(hz) })}${hz > 0.05 ? ` ${tl('para {a}°', { a: fmt(yaw, 0) })}` : ''} · ${tl('vertical {v} m/s', { v: fmt(v.y) })} · (${[v.x, v.y, v.z].map((x) => fmt(x)).join('; ')})`),
    );
    arrow.visible = v.length() > 0.05;
    if (arrow.visible) {
      arrow.position.copy(pos);
      arrow.setDirection(v.clone().normalize());
      arrow.setLength(Math.max(0.6, v.length() * 0.25), 0.35, 0.22);
    }
  }
  function useVel() {
    const h = here();
    if (!h) return;
    ctx.useVelocity(h.v, h.pos);
  }
  function pose() {
    const rec = ctx.doc().recording;
    if (!rec) return;
    S.ghost ??= ctx.makeGhost();
    const n = Math.min(rec.samples.length - 1, Math.floor(S.t / rec.dt + 1e-6));
    S.n = n;
    const a = rec.samples[n];
    const b = rec.samples[Math.min(n + 1, rec.samples.length - 1)];
    const k = Math.min(1, Math.max(0, S.t / rec.dt - n));
    const feet = new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 0.9 * (a[6] ?? 1), a[2] + (b[2] - a[2]) * k);
    const moving = Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.02;
    S.ghost.set(feet, a[3], a[6] ?? 1, moving, performance.now() / 1000, 1 / 60, 1);
    S.ghost.group.visible = true;
    slider.value = Math.round((S.t / Math.max(0.001, total())) * 1000);
    showVel();
  }
  return {
    id: 'bot',
    label: 'Robô',
    panel,
    activate() {
      sync();
      path();
    },
    deactivate() {
      S.playing = false;
      clear();
      if (S.ghost) S.ghost.group.visible = false;
    },
    /** clique perto do caminho verde: o robô vai para aquele ponto */
    click(e, ray) {
      const rec = ctx.doc().recording;
      if (!rec) return false;
      const R = new THREE.Ray(ray.o, ray.d);
      let best = -1;
      let bd = Infinity;
      rec.samples.forEach((s, i) => {
        const p = new THREE.Vector3(s[0], s[1] - 0.8, s[2]);
        const d = R.distanceSqToPoint(p) / Math.max(1, p.distanceTo(ray.o)) ** 2; // perto na tela
        if (d < bd) (bd = d), (best = i);
      });
      if (best < 0 || bd > 0.03 ** 2) return false;
      S.playing = false;
      S.t = best * rec.dt;
      sync();
      pose();
      return true;
    },
    refresh() {
      sync();
      path();
    },
    frame(dt) {
      if (!S.playing) return;
      S.t += dt * S.speed;
      if (S.t >= total()) {
        S.t = total();
        S.playing = false;
        sync();
      }
      pose();
    },
    dispose() {
      if (S.ghost) S.ghost.group.parent?.remove(S.ghost.group);
      S.ghost = null;
    },
    sync,
  };
}
