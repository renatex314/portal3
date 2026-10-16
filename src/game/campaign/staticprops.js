// Objetos estáticos dos mapas (prop_static): canos, corrimãos, os tubos de vidro,
// mesas… Ficam no "game lump" do BSP (só a lista: modelo, posição, ângulos) e os
// modelos vêm da instalação do jogador (.mdl + .vvd + .dx90.vtx para a forma,
// .phy para a colisão). Código próprio, a partir dos formatos documentados.

const td = new TextDecoder('latin1');
const cstr = (u8, o) => {
  let e = o;
  while (e < u8.length && u8[e]) e++;
  return td.decode(u8.subarray(o, e));
};

/** lista dos objetos estáticos do mapa (lump 35, "sprp"); [] se o mapa não tiver */
export function parseStaticProps(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const ofs = dv.getInt32(8 + 35 * 16, true);
  const len = dv.getInt32(12 + 35 * 16, true);
  if (!len) return [];
  const n = dv.getInt32(ofs, true);
  for (let i = 0; i < n; i++) {
    const e = ofs + 4 + i * 16;
    if (dv.getInt32(e, true) !== 0x73707270) continue; // "sprp"
    const version = dv.getUint16(e + 6, true);
    const fo = dv.getInt32(e + 8, true);
    const fl = dv.getInt32(e + 12, true);
    if (dv.getUint16(e + 4, true) & 1) return []; // comprimido (não acontece no Portal)
    let o = fo;
    const nd = dv.getInt32(o, true);
    o += 4;
    const names = [];
    for (let k = 0; k < nd; k++, o += 128) names.push(cstr(u8, o).toLowerCase().replace(/\\/g, '/'));
    o += 4 + dv.getInt32(o, true) * 2; // folhas
    const np = dv.getInt32(o, true);
    o += 4;
    if (!np) return [];
    const size = Math.floor((fo + fl - o) / np);
    if (version < 4 || size < 56) return [];
    const out = [];
    for (let k = 0; k < np; k++) {
      const p = o + k * size;
      const f = (j) => dv.getFloat32(p + j, true);
      out.push({
        model: names[dv.getUint16(p + 24, true)],
        origin: [f(0), f(4), f(8)],
        angles: [f(12), f(16), f(20)],
        solid: u8[p + 30],
        skin: dv.getInt32(p + 32, true),
      });
    }
    return out;
  }
  return [];
}

/**
 * Modelo: { groups: [{ material, positions, normals, indices }], hulls: [[[x,y,z]…]…] }
 * em coordenadas do Source (polegadas). `phy` pode faltar (sem colisão).
 */
export function parseModel(mdl, vvd, vtx, phy) {
  const md = new DataView(mdl.buffer, mdl.byteOffset, mdl.byteLength);
  if (md.getUint32(0, true) !== 0x54534449) return null; // "IDST"
  // materiais
  const nTex = md.getInt32(204, true);
  const texIdx = md.getInt32(208, true);
  const textures = [];
  for (let i = 0; i < nTex; i++) {
    const t = texIdx + i * 64;
    textures.push(cstr(mdl, t + md.getInt32(t, true)).toLowerCase());
  }
  const vertices = readVVD(vvd);
  if (!vertices) return null;

  // VTX: corpo → modelo → LOD 0 → malha → grupos de tiras (índices de triângulo)
  const xd = new DataView(vtx.buffer, vtx.byteOffset, vtx.byteLength);
  if (xd.getInt32(0, true) !== 7) return null;
  const groupSize = detectStripGroupSize(xd, mdl, md);
  const byMat = new Map();
  const nBody = md.getInt32(232, true);
  const bodyIdx = md.getInt32(236, true);
  const vtxBodyOfs = xd.getInt32(32, true);
  for (let b = 0; b < nBody; b++) {
    const bp = bodyIdx + b * 16;
    const nModels = md.getInt32(bp + 4, true);
    const modelIdx = bp + md.getInt32(bp + 12, true);
    const xb = vtxBodyOfs + b * 8;
    const xModels = xb + xd.getInt32(xb + 4, true);
    // como no jogo: só o primeiro submodelo de cada parte (o padrão)
    for (let m = 0; m < Math.min(1, nModels); m++) {
      const mp = modelIdx + m * 148;
      const vStart = md.getInt32(mp + 84, true) / 48;
      const nMesh = md.getInt32(mp + 72, true);
      const meshIdx = mp + md.getInt32(mp + 76, true);
      const xm = xModels + m * 8;
      if (xd.getInt32(xm, true) < 1) continue;
      const xl = xm + xd.getInt32(xm + 4, true); // LOD 0
      const xMeshes = xl + xd.getInt32(xl + 4, true);
      for (let k = 0; k < nMesh; k++) {
        const mesh = meshIdx + k * 116;
        const material = textures[md.getInt32(mesh, true)] ?? '';
        const vOfs = vStart + md.getInt32(mesh + 12, true);
        const xs = xMeshes + k * 9;
        const nGroups = xd.getInt32(xs, true);
        const groups = xs + xd.getInt32(xs + 4, true);
        if (!byMat.has(material)) byMat.set(material, { material, positions: [], normals: [], uvs: [], indices: [] });
        const G = byMat.get(material);
        for (let g = 0; g < nGroups; g++) {
          const sg = groups + g * groupSize;
          const nv = xd.getInt32(sg, true);
          const vo = sg + xd.getInt32(sg + 4, true);
          const ni = xd.getInt32(sg + 8, true);
          const io = sg + xd.getInt32(sg + 12, true);
          const base = G.positions.length / 3;
          for (let v = 0; v < nv; v++) {
            const id = vOfs + xd.getUint16(vo + v * 9 + 4, true);
            const src = vertices[id];
            if (!src) return null;
            G.positions.push(src[0], src[1], src[2]);
            G.normals.push(src[3], src[4], src[5]);
            G.uvs.push(src[6], src[7]);
          }
          for (let t = 0; t < ni; t++) G.indices.push(base + xd.getUint16(io + t * 2, true));
        }
      }
    }
  }
  return { groups: [...byMat.values()].filter((g) => g.indices.length), hulls: phy ? readPHY(phy) : [], textures };
}

/** vértices do LOD 0: [x, y, z, nx, ny, nz, u, v] */
function readVVD(vvd) {
  const d = new DataView(vvd.buffer, vvd.byteOffset, vvd.byteLength);
  if (d.getUint32(0, true) !== 0x56534449) return null; // "IDSV"
  const nVerts = d.getInt32(16, true); // LOD 0
  const nFix = d.getInt32(48, true);
  const fixStart = d.getInt32(52, true);
  const dataStart = d.getInt32(56, true);
  const read = (i) => {
    const o = dataStart + i * 48;
    const f = (j) => d.getFloat32(o + j, true);
    return [f(16), f(20), f(24), f(28), f(32), f(36), f(40), f(44)];
  };
  const out = [];
  if (!nFix) {
    for (let i = 0; i < nVerts; i++) out.push(read(i));
    return out;
  }
  // "fixups": a ordem dos vértices do LOD 0 vem por trechos
  for (let f = 0; f < nFix; f++) {
    const o = fixStart + f * 12;
    if (d.getInt32(o, true) < 0) continue;
    const src = d.getInt32(o + 4, true);
    const n = d.getInt32(o + 8, true);
    for (let i = 0; i < n; i++) out.push(read(src + i));
  }
  return out;
}

/** o tamanho do cabeçalho de grupo de tiras mudou entre versões do motor (25 ou 33 bytes) */
function detectStripGroupSize(xd, mdl, md) {
  // os dois primeiros grupos da primeira malha: com o tamanho certo, o segundo
  // aponta para dentro do arquivo e tem contagens razoáveis
  try {
    const xb = xd.getInt32(32, true);
    const xm = xb + xd.getInt32(xb + 4, true);
    const xl = xm + xd.getInt32(xm + 4, true);
    const xs = xl + xd.getInt32(xl + 4, true);
    const n = xd.getInt32(xs, true);
    if (n < 2) return 25;
    const g0 = xs + xd.getInt32(xs + 4, true);
    const ok = (size) => {
      const sg = g0 + size;
      const nv = xd.getInt32(sg, true);
      const ni = xd.getInt32(sg + 8, true);
      return nv >= 0 && nv < 65536 && ni >= 0 && ni < 1 << 20 && ni % 3 === 0 && sg + xd.getInt32(sg + 4, true) < xd.byteLength;
    };
    return ok(25) ? 25 : 33;
  } catch {
    return 25;
  }
}

/**
 * Colisão (.phy): cada sólido é um "compact surface" do IVP com várias peças
 * convexas ("ledges"); devolve os vértices de cada peça, em polegadas do Source.
 */
function readPHY(phy) {
  const d = new DataView(phy.buffer, phy.byteOffset, phy.byteLength);
  const hulls = [];
  try {
    const headerSize = d.getInt32(0, true);
    const nSolids = d.getInt32(8, true);
    let pos = headerSize;
    for (let s = 0; s < nSolids; s++) {
      const size = d.getInt32(pos, true);
      const next = pos + 4 + size;
      const vphy = d.getUint32(pos + 4, true) === 0x59485056; // "VPHY"
      const surf = vphy ? pos + 32 : pos + 4;
      const treeAt = surf + d.getInt32(surf + 32, true);
      let at = surf + 48;
      let pointsFrom = Infinity;
      while (at < Math.min(pointsFrom, treeAt, next) - 15) {
        const pointBase = at + d.getInt32(at, true);
        const flags = d.getUint32(at + 8, true) & 3; // ≠ 0: casca de um grupo (não é peça)
        const nTri = d.getInt16(at + 12, true);
        if (nTri <= 0 || pointBase <= at) break;
        pointsFrom = Math.min(pointsFrom, pointBase);
        if (flags) {
          at += 16 + nTri * 16;
          continue;
        }
        const ids = new Set();
        for (let t = 0; t < nTri; t++) {
          const tri = at + 16 + t * 16;
          for (let e = 0; e < 3; e++) ids.add(d.getUint16(tri + 4 + e * 4, true));
        }
        const pts = [];
        for (const id of ids) {
          const p = pointBase + id * 16;
          // IVP (metros, y para baixo) → Source (polegadas)
          const x = d.getFloat32(p, true);
          const y = d.getFloat32(p + 4, true);
          const z = d.getFloat32(p + 8, true);
          pts.push([x / 0.0254, z / 0.0254, -y / 0.0254]);
        }
        if (pts.length >= 4) hulls.push(pts);
        at += 16 + nTri * 16;
      }
      pos = next;
    }
  } catch {
    /* .phy estranho: fica sem colisão */
  }
  return hulls;
}
