// Texturas e materiais dos modelos do original (.vmt + .vtf), lidos da cópia do
// jogador. Decodifica DXT1/DXT3/DXT5 e os formatos sem compressão comuns no
// próprio navegador (sem depender da extensão de textura comprimida da placa).

/** formatos do VTF que sabemos ler: bytes por bloco/pixel */
const FMT = { RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, I8: 5, IA88: 6, ARGB8888: 11, BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, DXT1A: 20 };

function levelBytes(fmt, w, h) {
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  switch (fmt) {
    case FMT.DXT1:
    case FMT.DXT1A:
      return bw * bh * 8;
    case FMT.DXT3:
    case FMT.DXT5:
      return bw * bh * 16;
    case FMT.RGB888:
    case FMT.BGR888:
      return w * h * 3;
    case FMT.I8:
      return w * h;
    case FMT.IA88:
      return w * h * 2;
    default:
      return w * h * 4;
  }
}

/**
 * VTF → { width, height, data: RGBA8 } no maior nível de detalhe que caiba em
 * `maxSize` (os originais vão até 2048²); null se o formato não for conhecido.
 */
export function decodeVTF(bytes, maxSize = 1024) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (d.getUint32(0, true) !== 0x00465456) return null; // "VTF\0"
  const minor = d.getUint32(8, true);
  const headerSize = d.getUint32(12, true);
  const W = d.getUint16(16, true);
  const H = d.getUint16(18, true);
  const flags = d.getUint32(20, true);
  const frames = Math.max(1, d.getUint16(24, true));
  const fmt = d.getInt32(52, true);
  const mips = bytes[56];
  const lowFmt = d.getInt32(57, true);
  const lowW = bytes[61];
  const lowH = bytes[62];
  const depth = minor >= 2 ? Math.max(1, d.getUint16(63, true)) : 1;
  const faces = flags & 0x4000 ? (minor < 5 ? 7 : 6) : 1;
  if (levelBytes(fmt, 4, 4) === 64 && ![0, 1, 11, 12, 16].includes(fmt)) return null;
  let at = -1;
  if (minor >= 3) {
    const n = d.getUint32(68, true);
    for (let i = 0; i < n; i++) {
      const o = 80 + i * 8;
      if (bytes[o] === 0x30 && bytes[o + 1] === 0 && bytes[o + 2] === 0) at = d.getUint32(o + 4, true);
    }
  }
  if (at < 0) at = headerSize + (lowFmt >= 0 ? levelBytes(lowFmt, lowW, lowH) : 0);
  // níveis do menor (mips−1) para o maior (0)
  let level = 0;
  while (level < mips - 1 && Math.max(W >> level, H >> level) > maxSize) level++;
  for (let l = mips - 1; l > level; l--) at += levelBytes(fmt, Math.max(1, W >> l), Math.max(1, H >> l)) * frames * faces * depth;
  const w = Math.max(1, W >> level);
  const h = Math.max(1, H >> level);
  if (at + levelBytes(fmt, w, h) > bytes.length) return null;
  const src = bytes.subarray(at, at + levelBytes(fmt, w, h));
  const out = new Uint8Array(w * h * 4);
  if (fmt === FMT.DXT1 || fmt === FMT.DXT1A || fmt === FMT.DXT3 || fmt === FMT.DXT5) decodeDXT(src, w, h, fmt, out);
  else {
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      switch (fmt) {
        case FMT.RGBA8888:
          out.set(src.subarray(i * 4, i * 4 + 4), o);
          break;
        case FMT.ABGR8888:
          out.set([src[i * 4 + 3], src[i * 4 + 2], src[i * 4 + 1], src[i * 4]], o);
          break;
        case FMT.ARGB8888:
          out.set([src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3], src[i * 4]], o);
          break;
        case FMT.BGRA8888:
          out.set([src[i * 4 + 2], src[i * 4 + 1], src[i * 4], src[i * 4 + 3]], o);
          break;
        case FMT.BGRX8888:
          out.set([src[i * 4 + 2], src[i * 4 + 1], src[i * 4], 255], o);
          break;
        case FMT.RGB888:
          out.set([src[i * 3], src[i * 3 + 1], src[i * 3 + 2], 255], o);
          break;
        case FMT.BGR888:
          out.set([src[i * 3 + 2], src[i * 3 + 1], src[i * 3], 255], o);
          break;
        case FMT.I8:
          out.set([src[i], src[i], src[i], 255], o);
          break;
        case FMT.IA88:
          out.set([src[i * 2], src[i * 2], src[i * 2], src[i * 2 + 1]], o);
          break;
        default:
          return null;
      }
    }
  }
  return { width: w, height: h, data: out };
}

function decodeDXT(src, w, h, fmt, out) {
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  const blockSize = fmt === FMT.DXT1 || fmt === FMT.DXT1A ? 8 : 16;
  const col = new Uint8Array(16);
  const alpha = new Uint8Array(16);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let o = (by * bw + bx) * blockSize;
      alpha.fill(255);
      if (fmt === FMT.DXT5) {
        const a0 = src[o];
        const a1 = src[o + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else {
          for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5 | 0);
          pal.push(0, 255);
        }
        // 16 índices de 3 bits em 6 bytes
        let bits = 0;
        let nbits = 0;
        let p = o + 2;
        for (let i = 0; i < 16; i++) {
          while (nbits < 3) {
            bits |= src[p++] << nbits;
            nbits += 8;
          }
          alpha[i] = pal[bits & 7];
          bits >>= 3;
          nbits -= 3;
        }
        o += 8;
      } else if (fmt === FMT.DXT3) {
        for (let i = 0; i < 8; i++) {
          const v = src[o + i];
          alpha[i * 2] = (v & 15) * 17;
          alpha[i * 2 + 1] = (v >> 4) * 17;
        }
        o += 8;
      }
      const c0 = src[o] | (src[o + 1] << 8);
      const c1 = src[o + 2] | (src[o + 3] << 8);
      const rgb = (c) => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
      const p0 = rgb(c0);
      const p1 = rgb(c1);
      const four = blockSize === 16 || c0 > c1;
      const p2 = four ? p0.map((v, i) => (2 * v + p1[i]) / 3 | 0) : p0.map((v, i) => (v + p1[i]) / 2 | 0);
      const p3 = four ? p0.map((v, i) => (v + 2 * p1[i]) / 3 | 0) : [0, 0, 0];
      const pal = [p0, p1, p2, p3];
      const idx = src[o + 4] | (src[o + 5] << 8) | (src[o + 6] << 16) | (src[o + 7] << 24);
      for (let i = 0; i < 16; i++) {
        const k = (idx >>> (i * 2)) & 3;
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const q = (y * w + x) * 4;
        const c = pal[k];
        out[q] = c[0];
        out[q + 1] = c[1];
        out[q + 2] = c[2];
        out[q + 3] = !four && k === 3 && blockSize === 8 ? 0 : alpha[i];
      }
    }
  return out;
}

/** chaves e valores de um .vmt (só o primeiro nível, minúsculas) */
export function parseVMT(text) {
  const out = { shader: (/^\s*"?([\w]+)"?/.exec(text)?.[1] ?? '').toLowerCase() };
  // tira comentários de linha
  const clean = text.replace(/\/\/[^\n]*/g, '');
  const re = /"?(\$?%?[\w]+)"?\s+"([^"]*)"|"?(\$[\w]+)"?\s+([^\s"{}]+)/g;
  let m;
  while ((m = re.exec(clean))) {
    const k = (m[1] ?? m[3]).toLowerCase();
    const v = m[2] ?? m[4];
    if (!(k in out)) out[k] = v;
  }
  return out;
}

export const texPath = (name) => name.toLowerCase().replace(/\\/g, '/').replace(/\.vtf$/, '');
