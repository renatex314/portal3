// Duração das animações (sequências) de um modelo .mdl do Source (versão 44+).
// O jogo daqui não desenha os modelos do original, mas alguns mapas esperam o fim
// de uma animação para continuar (OnAnimationDone) — o tempo vem daqui.

/** bytes do .mdl → Map(nome da sequência minúsculo → segundos) */
export function sequenceDurations(bytes) {
  const out = new Map();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 200 || dv.getUint32(0, true) !== 0x54534449) return out; // "IDST"
  const str = (o) => {
    let e = o;
    while (e < bytes.length && bytes[e]) e++;
    return new TextDecoder('latin1').decode(bytes.subarray(o, e));
  };
  const animIdx = dv.getInt32(184, true);
  const nSeq = dv.getInt32(188, true);
  const seqIdx = dv.getInt32(192, true);
  for (let i = 0; i < nSeq; i++) {
    const o = seqIdx + i * 212;
    if (o + 212 > bytes.length) break;
    const label = str(o + dv.getInt32(o + 4, true)).toLowerCase();
    const anim = dv.getInt16(o + dv.getInt32(o + 60, true), true); // primeira animação da mistura
    const a = animIdx + anim * 100;
    if (a + 20 > bytes.length) continue;
    const fps = dv.getFloat32(a + 8, true);
    const frames = dv.getInt32(a + 16, true);
    if (fps > 0 && frames > 0) out.set(label, (frames - 1) / fps);
  }
  return out;
}

/** modelos (minúsculos) dos prop_dynamic cujo fim de animação a lógica do mapa espera */
export function animatedModels(entities) {
  const set = new Set();
  for (const e of entities)
    if (/^prop_dynamic/.test(e.classname) && e.outputs.some((o) => o.output === 'onanimationdone') && e.kv.get('model'))
      set.add(e.kv.get('model').toLowerCase().replace(/\\/g, '/'));
  return set;
}
