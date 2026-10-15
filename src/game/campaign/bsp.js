// Leitor de mapas BSP v20 (Source). Código próprio, a partir do formato
// documentado; os mapas vêm da instalação do jogador, nunca do repositório.

const LUMP = {
  ENTITIES: 0, PLANES: 1, TEXDATA: 2, TEXINFO: 6, NODES: 5, LEAFS: 10, MODELS: 14,
  LEAFBRUSHES: 17, BRUSHES: 18, BRUSHSIDES: 19, TEXDATA_STRING_DATA: 43, TEXDATA_STRING_TABLE: 44,
};

export const CONTENTS = {
  SOLID: 0x1, WINDOW: 0x2, GRATE: 0x8, SLIME: 0x10, WATER: 0x20, MOVEABLE: 0x4000,
  PLAYERCLIP: 0x10000, MONSTERCLIP: 0x20000, DETAIL: 0x8000000, LADDER: 0x20000000,
};

export const SURF = {
  LIGHT: 0x1, SKY2D: 0x2, SKY: 0x4, WARP: 0x8, TRANS: 0x10, NOPORTAL: 0x20, TRIGGER: 0x40,
  NODRAW: 0x80, HINT: 0x100, SKIP: 0x200, NOLIGHT: 0x400,
};

/**
 * Entidades: cada uma é { classname, kv: Map(chave → valor), outputs: [...] }.
 * As saídas ("OnTrigger" "alvo,Entrada,parâmetro,atraso,vezes") podem se repetir,
 * por isso não dá para guardar num objeto simples.
 */
function parseEntities(text) {
  const out = [];
  const re = /\{|\}|"([^"]*)"/g;
  let cur = null;
  let key = null;
  let m;
  while ((m = re.exec(text))) {
    if (m[0] === '{') {
      cur = { kv: new Map(), outputs: [] };
      key = null;
    } else if (m[0] === '}') {
      if (cur) {
        cur.classname = cur.kv.get('classname') ?? '';
        out.push(cur);
      }
      cur = null;
    } else if (cur) {
      if (key === null) key = m[1];
      else {
        const k = key.toLowerCase();
        const v = m[1];
        // saídas usam vírgula (antigas) ou o caractere ESC como separador
        const parts = v.split(/\x1b|,/);
        // saída = "alvo,Entrada,parâmetro,atraso,vezes" (On… e também OutValue etc.)
        const isOutput = /^(on|out)/i.test(key) && parts.length >= 5 && /^-?[\d.]*$/.test(parts[parts.length - 2]) && /^-?\d*$/.test(parts[parts.length - 1]);
        if (isOutput) {
          cur.outputs.push({
            output: k,
            target: parts[0],
            input: parts[1],
            param: parts.length > 5 ? parts.slice(2, parts.length - 2).join(',') : parts[2],
            delay: parseFloat(parts[parts.length - 2]) || 0,
            times: parseInt(parts[parts.length - 1], 10) || -1,
          });
        } else cur.kv.set(k, v);
        key = null;
      }
    }
  }
  return out;
}

export function parseBSP(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  if (dv.getUint32(0, true) !== 0x50534256) throw new Error('não é um mapa VBSP');
  const version = dv.getInt32(4, true);
  const lump = (i) => {
    const ofs = dv.getInt32(8 + i * 16, true);
    const len = dv.getInt32(12 + i * 16, true);
    if (dv.getUint32(20 + i * 16, true) !== 0) throw new Error(`lump ${i} comprimido (não suportado)`);
    return { ofs, len };
  };

  const ents = lump(LUMP.ENTITIES);
  const entities = parseEntities(new TextDecoder('latin1').decode(u8.subarray(ents.ofs, ents.ofs + ents.len)));

  const pl = lump(LUMP.PLANES);
  const planes = [];
  for (let o = pl.ofs; o < pl.ofs + pl.len; o += 20)
    planes.push({ n: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)], d: dv.getFloat32(o + 12, true) });

  // nomes dos materiais
  const sd = lump(LUMP.TEXDATA_STRING_DATA);
  const st = lump(LUMP.TEXDATA_STRING_TABLE);
  const td = lump(LUMP.TEXDATA);
  const texNames = [];
  for (let o = td.ofs; o < td.ofs + td.len; o += 32) {
    const id = dv.getInt32(o + 12, true);
    const s = sd.ofs + dv.getInt32(st.ofs + id * 4, true);
    let e = s;
    while (u8[e]) e++;
    texNames.push(new TextDecoder('latin1').decode(u8.subarray(s, e)).toLowerCase().replace(/\\/g, '/'));
  }
  const ti = lump(LUMP.TEXINFO);
  const texinfo = [];
  for (let o = ti.ofs; o < ti.ofs + ti.len; o += 72) {
    const td2 = dv.getInt32(o + 68, true);
    texinfo.push({ flags: dv.getInt32(o + 64, true), name: texNames[td2] ?? '' });
  }

  const nl = lump(LUMP.NODES);
  const nodes = [];
  for (let o = nl.ofs; o < nl.ofs + nl.len; o += 32) nodes.push([dv.getInt32(o + 4, true), dv.getInt32(o + 8, true)]);

  const ll = lump(LUMP.LEAFS);
  const leafStride = dv.getInt32(8 + LUMP.LEAFS * 16 + 8, true) === 0 ? 56 : 32;
  const leafs = [];
  for (let o = ll.ofs; o + leafStride <= ll.ofs + ll.len; o += leafStride)
    leafs.push({ first: dv.getUint16(o + 24, true), count: dv.getUint16(o + 26, true) });

  const lb = lump(LUMP.LEAFBRUSHES);
  const leafBrushes = new Uint16Array(buffer.slice(lb.ofs, lb.ofs + lb.len));

  const bl = lump(LUMP.BRUSHES);
  const brushes = [];
  for (let o = bl.ofs; o < bl.ofs + bl.len; o += 12)
    brushes.push({ first: dv.getInt32(o, true), count: dv.getInt32(o + 4, true), contents: dv.getInt32(o + 8, true) });

  const sl = lump(LUMP.BRUSHSIDES);
  const sides = [];
  for (let o = sl.ofs; o < sl.ofs + sl.len; o += 8)
    sides.push({ plane: dv.getUint16(o, true), texinfo: dv.getInt16(o + 2, true), bevel: u8[o + 6] !== 0 });

  const ml = lump(LUMP.MODELS);
  const models = [];
  for (let o = ml.ofs; o < ml.ofs + ml.len; o += 48)
    models.push({
      mins: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
      maxs: [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)],
      headnode: dv.getInt32(o + 36, true),
    });

  /** pincéis (brushes) de um modelo: percorre a árvore BSP dele até as folhas */
  const modelBrushes = (mi) => {
    const found = new Set();
    const stack = [models[mi].headnode];
    while (stack.length) {
      const n = stack.pop();
      if (n < 0) {
        const leaf = leafs[-1 - n];
        if (!leaf) continue;
        for (let i = 0; i < leaf.count; i++) found.add(leafBrushes[leaf.first + i]);
      } else if (nodes[n]) stack.push(nodes[n][0], nodes[n][1]);
    }
    return [...found].sort((a, b) => a - b);
  };

  return { version, entities, planes, texinfo, brushes, sides, models, modelBrushes };
}
