// Leitura de pacotes VPK (v1/v2) da instalação do jogador, pedaço por pedaço
// (pelo servidor local ou direto da pasta escolhida — ver source.js).

import { readFile, readRange, packedContent } from './source.js';
import { tl } from '../i18n.js';

const fetchRange = readRange;
export const fetchFile = readFile;

/**
 * Conteúdo de dentro do pacote do jogo (sons, cenas, scripts): do .zip gerado
 * por `npm run pacote` (pasta "pak/" dele) ou do VPK da instalação.
 */
export async function openContent() {
  return packedContent() ?? new VPK('portal/portal_pak').open();
}

export class VPK {
  /** base: caminho sem "_dir.vpk", ex.: "portal/portal_pak" */
  constructor(base) {
    this.base = base;
    this.entries = new Map();
  }

  async open() {
    const d = await fetchFile(`${this.base}_dir.vpk`);
    if (!d) throw new Error(tl('pacote {p} não encontrado', { p: this.base }));
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const version = dv.getUint32(4, true);
    const header = version === 1 ? 12 : 28;
    this.dataStart = header + dv.getUint32(8, true);
    this.dir = d;
    let pos = header;
    const str = () => {
      let e = pos;
      while (d[e]) e++;
      const s = new TextDecoder('latin1').decode(d.subarray(pos, e));
      pos = e + 1;
      return s;
    };
    for (;;) {
      const ext = str();
      if (!ext) break;
      for (;;) {
        const dir = str();
        if (!dir) break;
        for (;;) {
          const name = str();
          if (!name) break;
          const preload = dv.getUint16(pos + 4, true);
          const e = { archive: dv.getUint16(pos + 6, true), offset: dv.getUint32(pos + 8, true), length: dv.getUint32(pos + 12, true), preloadAt: pos + 18, preload };
          pos += 18 + preload;
          const full = `${dir === ' ' ? '' : dir + '/'}${name}${ext === ' ' ? '' : '.' + ext}`.toLowerCase();
          this.entries.set(full, e);
        }
      }
    }
    return this;
  }

  has(path) {
    return this.entries.has(path.toLowerCase().replace(/\\/g, '/'));
  }

  async read(path) {
    const e = this.entries.get(path.toLowerCase().replace(/\\/g, '/'));
    if (!e) return null;
    const out = new Uint8Array(e.preload + e.length);
    out.set(this.dir.subarray(e.preloadAt, e.preloadAt + e.preload));
    if (e.length) {
      const body =
        e.archive === 0x7fff
          ? this.dir.subarray(this.dataStart + e.offset, this.dataStart + e.offset + e.length)
          : await fetchRange(`${this.base}_${String(e.archive).padStart(3, '0')}.vpk`, e.offset, e.length);
      out.set(body, e.preload);
    }
    return out;
  }
}
