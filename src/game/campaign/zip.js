// Leitor de .zip (o pacote gerado por `npm run pacote`): lê só o diretório
// central e, sob demanda, cada arquivo — guardado ou comprimido (deflate),
// descomprimido pelo próprio navegador (DecompressionStream).

import { tl } from '../i18n.js';

const SIG_END = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const slice = async (blob, start, len) => new Uint8Array(await blob.slice(start, start + len).arrayBuffer());

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** blob: File/Blob do .zip → { has(path), file(path), names() } (caminhos sem diferenciar maiúsculas) */
export async function openZip(blob) {
  // fim do diretório central: nos últimos 22 bytes + comentário (até 64 KB)
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tail = await slice(blob, blob.size - tailLen, tailLen);
  const tv = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--)
    if (tv.getUint32(i, true) === SIG_END) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('não é um arquivo .zip');
  const count = tv.getUint16(end + 10, true);
  const cdSize = tv.getUint32(end + 12, true);
  const cdOfs = tv.getUint32(end + 16, true);
  const cd = await slice(blob, cdOfs, cdSize);
  const dv = new DataView(cd.buffer);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error('.zip corrompido');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
    if (!name.endsWith('/')) entries.set(name.toLowerCase(), { method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    has: (path) => entries.has(path.toLowerCase()),
    names: () => [...entries.keys()],
    async file(path) {
      const e = entries.get(path.toLowerCase());
      if (!e) return null;
      const h = await slice(blob, e.local, 30);
      const hv = new DataView(h.buffer);
      if (hv.getUint32(0, true) !== SIG_LOCAL) throw new Error('.zip corrompido');
      const start = e.local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      const raw = await slice(blob, start, e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRaw(raw);
      throw new Error(tl('compressão {m} não suportada no .zip', { m: e.method }));
    },
  };
}
