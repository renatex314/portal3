// Índice das cenas compiladas (scenes/scenes.image) e o CRC32 que dá nome a
// cada uma. Sem dependências do navegador: o script do pacote (npm run pacote)
// usa o mesmo código para saber quais falas entram no pacote.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(str) {
  let c = 0xffffffff;
  for (let i = 0; i < str.length; i++) c = CRC_TABLE[(c ^ str.charCodeAt(i)) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** scenes.image → Map(crc → { ms, sounds: [nomes de som, em ordem] }) */
export function parseScenesImage(img) {
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const nScenes = dv.getInt32(8, true);
  const nStrings = dv.getInt32(12, true);
  const entryOff = dv.getInt32(16, true);
  const str = (k) => {
    const o = dv.getInt32(20 + k * 4, true);
    let e = o;
    while (img[e]) e++;
    return new TextDecoder('latin1').decode(img.subarray(o, e));
  };
  const scenes = new Map();
  for (let i = 0; i < nScenes; i++) {
    const at = entryOff + i * 16;
    const sum = dv.getInt32(at + 12, true);
    const count = dv.getInt32(sum + 4, true);
    const sounds = [];
    for (let k = 0; k < count && k < nStrings; k++) sounds.push(str(dv.getInt32(sum + 8 + k * 4, true)));
    scenes.set(dv.getUint32(at, true), { ms: dv.getUint32(sum, true), sounds });
  }
  return scenes;
}

/** cena pelo caminho do arquivo (.vcd), como está no mapa */
export function findScene(scenes, file) {
  const name = file.toLowerCase().replace(/\//g, '\\');
  return scenes.get(crc32(name)) ?? scenes.get(crc32(name.replace(/\\/g, '/')));
}

/** nome de arquivo de som sem os prefixos de mixagem do motor (*, #, @, ^…) */
export const cleanWave = (w) => 'sound/' + w.replace(/^[*#@<>^)}$!?&]+/, '').replace(/\\/g, '/');

export const decodeText = (bytes) =>
  bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder('utf-16le').decode(bytes.subarray(2)) : new TextDecoder('latin1').decode(bytes);

/**
 * Scripts de som listados no manifesto → Map(nome do som minúsculo → [arquivos]).
 * `pak` é qualquer coisa com has(caminho) e read(caminho) (pacote VPK ou o .zip).
 */
export async function loadSoundScripts(pak, parseKV, kvGet) {
  const sounds = new Map();
  const manifest = parseKV(decodeText(await pak.read('scripts/game_sounds_manifest.txt')));
  const files = (manifest[0]?.children ?? []).filter((c) => /file$/i.test(c.key)).map((c) => c.value);
  await Promise.all(
    files.map(async (f) => {
      const bytes = pak.has(f) ? await pak.read(f) : null;
      if (!bytes) return;
      for (const node of parseKV(decodeText(bytes))) {
        if (!node.children) continue;
        const waves = [];
        const one = kvGet(node, 'wave');
        if (one?.value) waves.push(one.value);
        const rnd = kvGet(node, 'rndwave');
        for (const w of rnd?.children ?? []) if (w.value) waves.push(w.value);
        if (waves.length) sounds.set(node.key.toLowerCase(), waves.map(cleanWave));
      }
    }),
  );
  return { sounds, scriptFiles: files.filter((f) => pak.has(f)) };
}
