//! Modelos dos objetos estáticos (staticprops.js): forma do .mdl + .vvd + .dx90.vtx e colisão
//! do .phy, em coordenadas do Source (polegadas). Código próprio, a partir dos formatos documentados.

pub struct Group {
    pub material: String,
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}

pub struct StaticModel {
    pub groups: Vec<Group>,
    pub hulls: Vec<Vec<[f32; 3]>>,
    pub textures: Vec<String>,
}

pub struct D<'a>(pub &'a [u8]);
impl D<'_> {
    pub fn i32(&self, o: usize) -> i32 {
        self.0.get(o..o + 4).map(|b| i32::from_le_bytes(b.try_into().unwrap())).unwrap_or(0)
    }
    pub fn u32(&self, o: usize) -> u32 {
        self.i32(o) as u32
    }
    pub fn u16(&self, o: usize) -> u16 {
        self.0.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]])).unwrap_or(0)
    }
    pub fn i16(&self, o: usize) -> i16 {
        self.u16(o) as i16
    }
    pub fn f32(&self, o: usize) -> f32 {
        f32::from_bits(self.u32(o))
    }
    pub fn u8(&self, o: usize) -> u8 {
        self.0.get(o).copied().unwrap_or(0)
    }
    pub fn cstr(&self, o: usize) -> String {
        let mut e = o;
        while e < self.0.len() && self.0[e] != 0 {
            e += 1;
        }
        self.0.get(o..e).map(|b| b.iter().map(|&c| c as char).collect()).unwrap_or_default()
    }
}

/// vértices do LOD 0: [x, y, z, nx, ny, nz, u, v]
pub fn read_vvd(vvd: &[u8]) -> Option<Vec<[f32; 8]>> {
    let d = D(vvd);
    if d.u32(0) != 0x56534449 {
        return None;
    }
    let n_verts = d.i32(16).max(0) as usize;
    let n_fix = d.i32(48).max(0) as usize;
    let fix_start = d.i32(52) as usize;
    let data_start = d.i32(56) as usize;
    let read = |i: usize| -> [f32; 8] {
        let o = data_start + i * 48;
        std::array::from_fn(|k| d.f32(o + 16 + k * 4))
    };
    if n_fix == 0 {
        return Some((0..n_verts).map(read).collect());
    }
    let mut out = vec![];
    for f in 0..n_fix {
        let o = fix_start + f * 12;
        if d.i32(o) < 0 {
            continue;
        }
        let src = d.i32(o + 4) as usize;
        let n = d.i32(o + 8) as usize;
        out.extend((0..n).map(|i| read(src + i)));
    }
    Some(out)
}

/// o tamanho do cabeçalho de grupo de tiras mudou entre versões do motor (25 ou 33 bytes)
pub fn strip_group_size(x: &D) -> usize {
    let xb = x.i32(32) as usize;
    let xm = xb + x.i32(xb + 4) as usize;
    let xl = xm + x.i32(xm + 4) as usize;
    let xs = xl + x.i32(xl + 4) as usize;
    if x.i32(xs) < 2 {
        return 25;
    }
    let g0 = xs + x.i32(xs + 4) as usize;
    let sg = g0 + 25;
    let nv = x.i32(sg);
    let ni = x.i32(sg + 8);
    let ok = (0..65536).contains(&nv) && (0..1 << 20).contains(&ni) && ni % 3 == 0 && sg + (x.i32(sg + 4) as usize) < x.0.len();
    if ok { 25 } else { 33 }
}

/// nomes das texturas do .mdl (minúsculas)
pub fn mdl_textures(m: &D) -> Vec<String> {
    let n = m.i32(204).max(0) as usize;
    let idx = m.i32(208) as usize;
    (0..n)
        .map(|i| {
            let t = idx + i * 64;
            m.cstr((t as i64 + m.i32(t) as i64) as usize).to_lowercase()
        })
        .collect()
}

pub fn parse_model(mdl: &[u8], vvd: &[u8], vtx: &[u8], phy: Option<&[u8]>) -> Option<StaticModel> {
    let m = D(mdl);
    if m.u32(0) != 0x54534449 {
        return None;
    }
    let textures = mdl_textures(&m);
    let vertices = read_vvd(vvd)?;
    let x = D(vtx);
    if x.i32(0) != 7 {
        return None;
    }
    let gsize = strip_group_size(&x);
    let mut groups: Vec<Group> = vec![];
    let n_body = m.i32(232).max(0) as usize;
    let body_idx = m.i32(236) as usize;
    let vtx_body = x.i32(32) as usize;
    for b in 0..n_body {
        let bp = body_idx + b * 16;
        let n_models = m.i32(bp + 4);
        let model_idx = (bp as i64 + m.i32(bp + 12) as i64) as usize;
        let xb = vtx_body + b * 8;
        let x_models = xb + x.i32(xb + 4) as usize;
        if n_models < 1 {
            continue;
        }
        // como no jogo: só o primeiro submodelo de cada parte (o padrão)
        let mp = model_idx;
        let v_start = (m.i32(mp + 84) / 48) as usize;
        let n_mesh = m.i32(mp + 72).max(0) as usize;
        let mesh_idx = (mp as i64 + m.i32(mp + 76) as i64) as usize;
        let xm = x_models;
        if x.i32(xm) < 1 {
            continue;
        }
        let xl = xm + x.i32(xm + 4) as usize;
        let x_meshes = xl + x.i32(xl + 4) as usize;
        for k in 0..n_mesh {
            let mesh = mesh_idx + k * 116;
            let material = textures.get(m.i32(mesh) as usize).cloned().unwrap_or_default();
            let v_ofs = v_start + m.i32(mesh + 12) as usize;
            let xs = x_meshes + k * 9;
            let n_groups = x.i32(xs).max(0) as usize;
            let gbase = xs + x.i32(xs + 4) as usize;
            let gi = match groups.iter().position(|g| g.material == material) {
                Some(i) => i,
                None => {
                    groups.push(Group { material: material.clone(), positions: vec![], normals: vec![], uvs: vec![], indices: vec![] });
                    groups.len() - 1
                }
            };
            let g = &mut groups[gi];
            for gg in 0..n_groups {
                let sg = gbase + gg * gsize;
                let nv = x.i32(sg).max(0) as usize;
                let vo = sg + x.i32(sg + 4) as usize;
                let ni = x.i32(sg + 8).max(0) as usize;
                let io = sg + x.i32(sg + 12) as usize;
                let base = g.positions.len() as u32;
                for v in 0..nv {
                    let id = v_ofs + x.u16(vo + v * 9 + 4) as usize;
                    let s = vertices.get(id)?;
                    g.positions.push([s[0], s[1], s[2]]);
                    g.normals.push([s[3], s[4], s[5]]);
                    g.uvs.push([s[6], s[7]]);
                }
                for t in 0..ni {
                    g.indices.push(base + x.u16(io + t * 2) as u32);
                }
            }
        }
    }
    groups.retain(|g| !g.indices.is_empty());
    Some(StaticModel { groups, hulls: phy.map(read_phy).unwrap_or_default(), textures })
}

/// colisão (.phy): as peças convexas ("ledges") de cada sólido, em polegadas do Source
pub fn read_phy(phy: &[u8]) -> Vec<Vec<[f32; 3]>> {
    let d = D(phy);
    let mut hulls = vec![];
    let header = d.i32(0).max(0) as usize;
    let n_solids = d.i32(8).max(0) as usize;
    let mut pos = header;
    for _ in 0..n_solids {
        if pos + 8 > phy.len() {
            break;
        }
        let size = d.i32(pos).max(0) as usize;
        let next = pos + 4 + size;
        let vphy = d.u32(pos + 4) == 0x59485056;
        let surf = if vphy { pos + 32 } else { pos + 4 };
        let tree_at = (surf as i64 + d.i32(surf + 32) as i64) as usize;
        let mut at = surf + 48;
        let mut points_from = usize::MAX;
        while at + 15 < points_from.min(tree_at).min(next) && at + 16 <= phy.len() {
            let point_base = (at as i64 + d.i32(at) as i64) as usize;
            let flags = d.u32(at + 8) & 3;
            let n_tri = d.i16(at + 12);
            if n_tri <= 0 || point_base <= at {
                break;
            }
            let n_tri = n_tri as usize;
            points_from = points_from.min(point_base);
            if flags != 0 {
                at += 16 + n_tri * 16;
                continue;
            }
            let mut ids: Vec<u16> = vec![];
            for t in 0..n_tri {
                let tri = at + 16 + t * 16;
                for e in 0..3 {
                    let id = d.u16(tri + 4 + e * 4);
                    if !ids.contains(&id) {
                        ids.push(id);
                    }
                }
            }
            let pts: Vec<[f32; 3]> = ids
                .iter()
                .map(|&id| {
                    let p = point_base + id as usize * 16;
                    // IVP (metros, y para baixo) → Source (polegadas)
                    let (x, y, z) = (d.f32(p), d.f32(p + 4), d.f32(p + 8));
                    [x / 0.0254, z / 0.0254, -y / 0.0254]
                })
                .collect();
            if pts.len() >= 4 {
                hulls.push(pts);
            }
            at += 16 + n_tri * 16;
        }
        pos = next;
    }
    hulls
}

/// duração de cada sequência do .mdl (mdl.js): nome → segundos (fps × quadros)
pub fn sequence_durations(mdl: &[u8]) -> std::collections::HashMap<String, f32> {
    let m = D(mdl);
    let mut out = std::collections::HashMap::new();
    if mdl.len() < 200 || m.u32(0) != 0x54534449 {
        return out;
    }
    let anim_idx = m.i32(184) as usize;
    let n_seq = m.i32(188).max(0) as usize;
    let seq_idx = m.i32(192) as usize;
    for i in 0..n_seq {
        let o = seq_idx + i * 212;
        if o + 212 > mdl.len() {
            break;
        }
        let label = m.cstr((o as i64 + m.i32(o + 4) as i64) as usize).to_lowercase();
        // primeira animação da mistura
        let anim = m.i16((o as i64 + m.i32(o + 60) as i64) as usize).max(0) as usize;
        let a = anim_idx + anim * 100;
        if a + 20 > mdl.len() {
            continue;
        }
        let fps = m.f32(a + 8);
        let frames = m.i32(a + 16);
        if fps > 0.0 && frames > 0 {
            out.insert(label, (frames - 1) as f32 / fps);
        }
    }
    out
}
