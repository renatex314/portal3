// Robô gravado: quando você completa o nível no teste (F5), o caminho vira a
// "prova" de que ele tem solução. Aqui você a reproduz como um fantasma.

import * as THREE from 'three';

/** impressão do conteúdo do nível (sem a gravação): a prova só vale enquanto ela não muda */
export function docHash(doc) {
  const s = JSON.stringify({ c: doc.cfg, h: doc.chamber, i: doc.items.map(({ id, ...r }) => r) });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export const proofState = (doc) => (!doc.recording ? 'none' : doc.recording.hash === docHash(doc) ? 'valid' : 'old');
export const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function createBotTool(ctx) {
  const { el, group } = ctx;
  const S = { t: 0, playing: false, speed: 1, ghost: null };
  const info = el('div', { class: 'report' });
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
  );
  const total = () => ((ctx.doc().recording?.samples.length ?? 1) - 1) * (ctx.doc().recording?.dt ?? 1 / 30);

  function sync() {
    const d = ctx.doc();
    const st = proofState(d);
    play.textContent = S.playing ? '⏸ Pausar' : '▶ Reproduzir';
    play.disabled = st === 'none';
    slider.disabled = st === 'none';
    const rec = d.recording;
    info.replaceChildren(
      el('p', {}, st === 'none' ? 'Ainda não há prova gravada.' : st === 'valid' ? `✔ Prova válida: ${fmtTime(rec.time)} de jogo, ${rec.samples.length} quadros.` : `⚠ Prova desatualizada (o nível mudou depois dela): ${fmtTime(rec.time)}.`),
      el('p', { class: 'note' }, `Velocidade ${S.speed}×`),
    );
  }
  function clear() {
    for (const c of [...group.children]) {
      group.remove(c);
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
    ctx.layer(group);
  }
  function pose() {
    const rec = ctx.doc().recording;
    if (!rec) return;
    S.ghost ??= ctx.makeGhost();
    const n = Math.min(rec.samples.length - 1, Math.floor(S.t / rec.dt));
    const a = rec.samples[n];
    const b = rec.samples[Math.min(n + 1, rec.samples.length - 1)];
    const k = Math.min(1, Math.max(0, S.t / rec.dt - n));
    const feet = new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 0.9 * (a[6] ?? 1), a[2] + (b[2] - a[2]) * k);
    const moving = Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.02;
    S.ghost.set(feet, a[3], a[6] ?? 1, moving, performance.now() / 1000, 1 / 60, 1);
    slider.value = Math.round((S.t / Math.max(0.001, total())) * 1000);
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
