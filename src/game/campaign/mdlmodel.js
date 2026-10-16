// Modelo animado do original (MDL v44–v48 + VVD + VTX [+ .ani]): malha com pesos
// de osso, esqueleto, famílias de pele e as animações (sequências), já
// descomprimidas quadro a quadro. Tudo em coordenadas do Source (polegadas).
// Código próprio, a partir do formato documentado do Source SDK.

const td = new TextDecoder('latin1');
const cstr = (u8, o) => {
  let e = o;
  while (e < u8.length && u8[e]) e++;
  return td.decode(u8.subarray(o, e));
};

/** float16 → número */
function half(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** ângulos em radianos (x, y, z do Source) → quatérnio [x, y, z, w] */
function eulerQuat(x, y, z) {
  const [sr, cr] = [Math.sin(x / 2), Math.cos(x / 2)];
  const [sp, cp] = [Math.sin(y / 2), Math.cos(y / 2)];
  const [sy, cy] = [Math.sin(z / 2), Math.cos(z / 2)];
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy];
}

/**
 * Lê tudo. Devolve { textures, skins, bones, groups, sequences } ou null.
 * groups: [{ slot, positions, normals, uvs, indices, boneIdx, boneW }]
 * sequences: [{ name, fps, frames, loop, pos: [quadro][osso][3], rot: [quadro][osso][4] }]
 */
export function parseAnimatedModel(mdl, vvd, vtx, ani = null) {
  const md = new DataView(mdl.buffer, mdl.byteOffset, mdl.byteLength);
  if (md.getUint32(0, true) !== 0x54534449) return null;
  // materiais e peles
  const nTex = md.getInt32(204, true);
  const texIdx = md.getInt32(208, true);
  const textures = [];
  for (let i = 0; i < nTex; i++) {
    const t = texIdx + i * 64;
    textures.push(cstr(mdl, t + md.getInt32(t, true)).toLowerCase().replace(/\\/g, '/'));
  }
  const nCd = md.getInt32(212, true);
  const cdIdx = md.getInt32(216, true);
  const dirs = [];
  for (let i = 0; i < nCd; i++) dirs.push(cstr(mdl, md.getInt32(cdIdx + i * 4, true)).toLowerCase().replace(/\\/g, '/'));
  const nRef = md.getInt32(220, true);
  const nFam = md.getInt32(224, true);
  const skinIdx = md.getInt32(228, true);
  const skins = [];
  for (let f = 0; f < nFam; f++) {
    const row = [];
    for (let r = 0; r < nRef; r++) row.push(md.getInt16(skinIdx + (f * nRef + r) * 2, true));
    skins.push(row);
  }

  // ossos (216 bytes cada)
  const nBones = md.getInt32(156, true);
  const boneIdx = md.getInt32(160, true);
  const bones = [];
  for (let i = 0; i < nBones; i++) {
    const o = boneIdx + i * 216;
    const f = (j) => md.getFloat32(o + j, true);
    const m = [];
    for (let k = 0; k < 12; k++) m.push(f(96 + k * 4));
    bones.push({
      name: cstr(mdl, o + md.getInt32(o, true)),
      parent: md.getInt32(o + 4, true),
      pos: [f(32), f(36), f(40)],
      quat: [f(44), f(48), f(52), f(56)],
      rot: [f(60), f(64), f(68)],
      posscale: [f(72), f(76), f(80)],
      rotscale: [f(84), f(88), f(92)],
      poseToBone: m, // 3×4, por linhas
    });
  }

  // vértices (VVD), com os pesos
  const vd = new DataView(vvd.buffer, vvd.byteOffset, vvd.byteLength);
  if (vd.getUint32(0, true) !== 0x56534449) return null;
  const nVerts0 = vd.getInt32(16, true);
  const nFix = vd.getInt32(48, true);
  const fixStart = vd.getInt32(52, true);
  const dataStart = vd.getInt32(56, true);
  const order = [];
  if (!nFix) for (let i = 0; i < nVerts0; i++) order.push(i);
  else
    for (let k = 0; k < nFix; k++) {
      const o = fixStart + k * 12;
      if (vd.getInt32(o, true) < 0) continue;
      const src = vd.getInt32(o + 4, true);
      const n = vd.getInt32(o + 8, true);
      for (let i = 0; i < n; i++) order.push(src + i);
    }
  const vert = (i) => {
    const o = dataStart + order[i] * 48;
    const f = (j) => vd.getFloat32(o + j, true);
    const nb = vvd[o + 15];
    return {
      w: [f(0), f(4), f(8)],
      b: [vvd[o + 12], vvd[o + 13], vvd[o + 14]],
      nb,
      p: [f(16), f(20), f(24)],
      n: [f(28), f(32), f(36)],
      uv: [f(40), f(44)],
    };
  };

  // VTX → triângulos, por "slot" de material
  const xd = new DataView(vtx.buffer, vtx.byteOffset, vtx.byteLength);
  if (xd.getInt32(0, true) !== 7) return null;
  const nBody = md.getInt32(232, true);
  const bodyIdx = md.getInt32(236, true);
  const xBody = xd.getInt32(32, true);
  const bySlot = new Map();
  let groupSize = 25;
  for (let b = 0; b < nBody; b++) {
    const bp = bodyIdx + b * 16;
    const nModels = md.getInt32(bp + 4, true);
    const modelIdx = bp + md.getInt32(bp + 12, true);
    const xb = xBody + b * 8;
    const xModels = xb + xd.getInt32(xb + 4, true);
    for (let mi = 0; mi < Math.min(1, nModels); mi++) {
      const mp = modelIdx + mi * 148;
      const vStart = md.getInt32(mp + 84, true) / 48;
      const nMesh = md.getInt32(mp + 72, true);
      const meshIdx = mp + md.getInt32(mp + 76, true);
      const xm = xModels + mi * 8;
      if (xd.getInt32(xm, true) < 1) continue;
      const xl = xm + xd.getInt32(xm + 4, true);
      const xMeshes = xl + xd.getInt32(xl + 4, true);
      for (let k = 0; k < nMesh; k++) {
        const mesh = meshIdx + k * 116;
        const slot = md.getInt32(mesh, true);
        const vOfs = vStart + md.getInt32(mesh + 12, true);
        const xs = xMeshes + k * 9;
        const nGroups = xd.getInt32(xs, true);
        const groups = xs + xd.getInt32(xs + 4, true);
        if (!bySlot.has(slot)) bySlot.set(slot, { slot, positions: [], normals: [], uvs: [], indices: [], boneIdx: [], boneW: [] });
        const G = bySlot.get(slot);
        for (let g = 0; g < nGroups; g++) {
          let sg = groups + g * groupSize;
          // cabeçalho do grupo: 25 bytes (2007) ou 33 (versões novas); confere pelo primeiro
          if (g === 0 && b === 0 && k === 0 && mi === 0 && nGroups > 1) {
            const ok = (size) => {
              const s2 = groups + size;
              const nv = xd.getInt32(s2, true);
              const ni = xd.getInt32(s2 + 8, true);
              return nv >= 0 && nv < 65536 && ni >= 0 && ni % 3 === 0;
            };
            groupSize = ok(25) ? 25 : 33;
            sg = groups;
          }
          const nv = xd.getInt32(sg, true);
          const vo = sg + xd.getInt32(sg + 4, true);
          const ni = xd.getInt32(sg + 8, true);
          const io = sg + xd.getInt32(sg + 12, true);
          const base = G.positions.length / 3;
          for (let v = 0; v < nv; v++) {
            const id = vOfs + xd.getUint16(vo + v * 9 + 4, true);
            if (id >= order.length) return null;
            const V = vert(id);
            G.positions.push(...V.p);
            G.normals.push(...V.n);
            G.uvs.push(...V.uv);
            const bi = [0, 0, 0, 0];
            const bw = [0, 0, 0, 0];
            for (let j = 0; j < Math.min(3, V.nb); j++) {
              bi[j] = V.b[j];
              bw[j] = V.w[j];
            }
            if (V.nb === 0) bw[0] = 1;
            G.boneIdx.push(...bi);
            G.boneW.push(...bw);
          }
          for (let t = 0; t < ni; t++) G.indices.push(base + xd.getUint16(io + t * 2, true));
        }
      }
    }
  }

  // animações
  const nAnim = md.getInt32(180, true);
  const animIdx = md.getInt32(184, true);
  const nBlocks = md.getInt32(352, true);
  const blockIdx = md.getInt32(356, true);
  const blocks = [];
  for (let i = 0; i < nBlocks; i++) blocks.push([md.getInt32(blockIdx + i * 8, true), md.getInt32(blockIdx + i * 8 + 4, true)]);
  const ad = ani ? new DataView(ani.buffer, ani.byteOffset, ani.byteLength) : null;
  const anims = [];
  for (let a = 0; a < nAnim; a++) {
    const o = animIdx + a * 100;
    const fps = md.getFloat32(o + 8, true);
    const flags = md.getInt32(o + 12, true);
    const frames = md.getInt32(o + 16, true);
    const block = md.getInt32(o + 52, true);
    const index = md.getInt32(o + 56, true);
    const sectionIndex = md.getInt32(o + 80, true);
    const sectionFrames = md.getInt32(o + 84, true);
    // onde ficam os dados de cada trecho (sections) do quadro f
    const where = (f) => {
      let blk = block;
      let idx = index;
      let local = f;
      if (sectionFrames > 0 && sectionIndex) {
        const s = Math.floor(f / sectionFrames);
        const so = o + sectionIndex + s * 8;
        blk = md.getInt32(so, true);
        idx = md.getInt32(so + 4, true);
        local = f - s * sectionFrames;
      }
      if (blk === 0) return { dv: md, u8: mdl, at: o + idx, local };
      if (!ad || !blocks[blk]) return null;
      return { dv: ad, u8: ani, at: blocks[blk][0] + idx, local };
    };
    const pos = [];
    const rot = [];
    for (let f = 0; f < frames; f++) {
      const W = where(f);
      const P = bones.map((b) => b.pos.slice());
      const Q = bones.map((b) => b.quat.slice());
      if (W) readFrame(W.dv, W.u8, W.at, W.local, bones, P, Q, flags & 4);
      pos.push(P);
      rot.push(Q);
    }
    anims.push({ fps, frames, loop: !!(flags & 1), pos, rot });
  }

  const nSeq = md.getInt32(188, true);
  const seqIdx = md.getInt32(192, true);
  const sequences = [];
  for (let i = 0; i < nSeq; i++) {
    const o = seqIdx + i * 212;
    const name = cstr(mdl, o + md.getInt32(o + 4, true)).toLowerCase();
    const flags = md.getInt32(o + 12, true);
    const a = md.getInt16(o + md.getInt32(o + 60, true), true);
    const A = anims[a];
    if (!A) continue;
    sequences.push({ name, fps: A.fps || 30, frames: A.frames, loop: !!(flags & 1) || A.loop, pos: A.pos, rot: A.rot });
  }
  return { textures, dirs, skins, bones, groups: [...bySlot.values()].filter((g) => g.indices.length), sequences };
}

/** um quadro de animação (dados RLE por osso) sobre as poses de repouso P, Q */
function readFrame(dv, u8, at, frame, bones, P, Q, delta) {
  for (let guard = 0; guard < 512; guard++) {
    if (at + 4 > u8.length) return;
    const bone = u8[at];
    const flags = u8[at + 1];
    const next = dv.getInt16(at + 2, true);
    const B = bones[bone];
    if (B) {
      let p = at + 4;
      const RAWPOS = 1;
      const RAWROT = 2;
      const ANIMPOS = 4;
      const ANIMROT = 8;
      const RAWROT2 = 32;
      if (flags & RAWROT) {
        Q[bone] = quat48(dv, p);
        p += 6;
      }
      if (flags & RAWROT2) {
        Q[bone] = quat64(dv, p);
        p += 8;
      }
      if (flags & ANIMROT) {
        const base = p;
        const e = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const off = dv.getInt16(base + k * 2, true);
          e[k] = off ? animValue(dv, base + off, frame) * B.rotscale[k] : 0;
        }
        if (!delta) for (let k = 0; k < 3; k++) e[k] += B.rot[k];
        Q[bone] = eulerQuat(e[0], e[1], e[2]);
        p += 6;
      }
      if (flags & RAWPOS) {
        P[bone] = [half(dv.getUint16(p, true)), half(dv.getUint16(p + 2, true)), half(dv.getUint16(p + 4, true))];
        p += 6;
      }
      if (flags & ANIMPOS) {
        const base = p;
        const v = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const off = dv.getInt16(base + k * 2, true);
          v[k] = off ? animValue(dv, base + off, frame) * B.posscale[k] : 0;
        }
        P[bone] = delta ? v : [v[0] + B.pos[0], v[1] + B.pos[1], v[2] + B.pos[2]];
        p += 6;
      }
    }
    if (!next) return;
    at += next;
  }
}

/** valor comprimido (RLE) do quadro k */
function animValue(dv, p, k) {
  for (let guard = 0; guard < 4096; guard++) {
    const valid = dv.getUint8(p);
    const total = dv.getUint8(p + 1);
    if (!total) return 0;
    if (total > k) {
      if (valid > k) return dv.getInt16(p + 2 + k * 2, true);
      return dv.getInt16(p + 2 + (valid - 1) * 2, true);
    }
    k -= total;
    p += 2 + valid * 2;
  }
  return 0;
}

function quat48(dv, p) {
  const x = (dv.getUint16(p, true) - 32768) / 32768;
  const y = (dv.getUint16(p + 2, true) - 32768) / 32768;
  const zr = dv.getUint16(p + 4, true);
  const z = ((zr & 0x7fff) - 16384) / 16384;
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)) * (zr & 0x8000 ? -1 : 1);
  return [x, y, z, w];
}

function quat64(dv, p) {
  const lo = dv.getUint32(p, true);
  const hi = dv.getUint32(p + 4, true);
  const xr = lo & 0x1fffff;
  const yr = ((lo >>> 21) | ((hi & 0x3ff) << 11)) & 0x1fffff;
  const zr = (hi >>> 10) & 0x1fffff;
  const x = (xr - 1048576) / 1048576.5;
  const y = (yr - 1048576) / 1048576.5;
  const z = (zr - 1048576) / 1048576.5;
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)) * (hi >>> 31 ? -1 : 1);
  return [x, y, z, w];
}
