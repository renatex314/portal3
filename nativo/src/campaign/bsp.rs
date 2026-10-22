//! Leitor de mapas BSP v20 do Source (bsp.js, staticprops.js) e do formato texto KeyValues
//! (kv.js). Código próprio, a partir do formato documentado; os mapas vêm da cópia do jogador.

use bevy::math::{Mat3, Vec3};

pub mod contents {
    pub const SOLID: i32 = 0x1;
    pub const WINDOW: i32 = 0x2;
    pub const GRATE: i32 = 0x8;
    pub const SLIME: i32 = 0x10;
    pub const WATER: i32 = 0x20;
    pub const MOVEABLE: i32 = 0x4000;
    pub const PLAYERCLIP: i32 = 0x10000;
}

pub mod surf {
    pub const LIGHT: i32 = 0x1;
    pub const SKY2D: i32 = 0x2;
    pub const SKY: i32 = 0x4;
    pub const WARP: i32 = 0x8;
    pub const NOPORTAL: i32 = 0x20;
    pub const TRIGGER: i32 = 0x40;
    pub const NODRAW: i32 = 0x80;
    pub const HINT: i32 = 0x100;
    pub const SKIP: i32 = 0x200;
}

#[derive(Clone, Debug)]
pub struct Output {
    pub output: String,
    pub target: String,
    pub input: String,
    pub param: String,
    pub delay: f32,
    pub times: i32,
}

/// entidade do mapa: as chaves em ordem (o molde lista "template01", "template02"…) e as saídas
#[derive(Clone, Debug, Default)]
pub struct Entity {
    pub classname: String,
    pub kv: Vec<(String, String)>,
    pub outputs: Vec<Output>,
    /// molde levado para o lugar do "maker" (relocateTemplates): frente/cima girados e a rotação
    pub forward: Option<Vec3>,
    pub up: Option<Vec3>,
    pub rot: Option<Mat3>,
    pub origin0: Option<String>,
}

impl Entity {
    pub fn get(&self, k: &str) -> Option<&str> {
        self.kv.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
    }
    pub fn get_or<'a>(&'a self, k: &str, d: &'a str) -> &'a str {
        self.get(k).unwrap_or(d)
    }
    pub fn set(&mut self, k: &str, v: String) {
        match self.kv.iter_mut().find(|(a, _)| a == k) {
            Some(p) => p.1 = v,
            None => self.kv.push((k.into(), v)),
        }
    }
    /// nome em minúsculas ("" se não tiver)
    pub fn name(&self) -> String {
        self.get_or("targetname", "").to_lowercase()
    }
    pub fn flags(&self) -> i64 {
        self.get("spawnflags").and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0)
    }
    pub fn num(&self, k: &str, d: f32) -> f32 {
        self.get(k).and_then(|v| parse_f(v)).unwrap_or(d)
    }
    pub fn model(&self) -> String {
        self.get_or("model", "").to_lowercase().replace('\\', "/")
    }
}

/// número como o parseFloat do JS: o começo do texto que for número
pub fn parse_f(s: &str) -> Option<f32> {
    let s = s.trim();
    let mut end = 0;
    let b = s.as_bytes();
    let mut seen_dot = false;
    let mut seen_e = false;
    while end < b.len() {
        let c = b[end];
        let ok = c.is_ascii_digit() || ((c == b'-' || c == b'+') && (end == 0 || b[end - 1] == b'e' || b[end - 1] == b'E')) || (c == b'.' && !seen_dot && !seen_e) || ((c == b'e' || c == b'E') && !seen_e && end > 0);
        if !ok {
            break;
        }
        seen_dot |= c == b'.';
        seen_e |= c == b'e' || c == b'E';
        end += 1;
    }
    while end > 0 {
        if let Ok(v) = s[..end].parse::<f32>() {
            return v.is_finite().then_some(v);
        }
        end -= 1;
    }
    None
}

/// parseInt do JS
pub fn parse_i(s: &str) -> Option<i64> {
    let s = s.trim();
    let end = s.char_indices().take_while(|&(i, c)| c.is_ascii_digit() || (i == 0 && (c == '-' || c == '+'))).count();
    s[..end].parse().ok()
}

/// "x y z" → [x, y, z] (o que faltar ou não for número vira 0)
pub fn parse_vec(s: Option<&str>) -> [f32; 3] {
    let mut out = [0.0; 3];
    for (i, p) in s.unwrap_or("0 0 0").split_whitespace().take(3).enumerate() {
        out[i] = p.parse::<f32>().ok().filter(|v| v.is_finite()).unwrap_or(0.0);
    }
    out
}

fn parse_entities(text: &str) -> Vec<Entity> {
    let mut out = vec![];
    let mut cur: Option<Entity> = None;
    let mut key: Option<String> = None;
    let b = text.as_bytes();
    let mut i = 0;
    let num_re = |s: &str| s.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-') && s.chars().filter(|&c| c == '-').count() <= 1 && (s.is_empty() || !s[1..].contains('-'));
    let int_re = |s: &str| s.chars().enumerate().all(|(k, c)| c.is_ascii_digit() || (k == 0 && c == '-'));
    while i < b.len() {
        match b[i] {
            b'{' => {
                cur = Some(Entity::default());
                key = None;
                i += 1;
            }
            b'}' => {
                if let Some(mut e) = cur.take() {
                    e.classname = e.get_or("classname", "").to_string();
                    out.push(e);
                }
                i += 1;
            }
            b'"' => {
                let s = i + 1;
                let mut e = s;
                while e < b.len() && b[e] != b'"' {
                    e += 1;
                }
                let v: String = b[s..e].iter().map(|&c| c as char).collect();
                i = e + 1;
                let Some(c) = cur.as_mut() else { continue };
                match key.take() {
                    None => key = Some(v),
                    Some(k0) => {
                        let k = k0.to_lowercase();
                        // saídas usam vírgula (antigas) ou o caractere ESC como separador
                        let parts: Vec<&str> = v.split(['\x1b', ',']).collect();
                        let n = parts.len();
                        let lk = k0.to_lowercase();
                        let is_out = (lk.starts_with("on") || lk.starts_with("out")) && n >= 5 && num_re(parts[n - 2]) && int_re(parts[n - 1]);
                        if is_out {
                            c.outputs.push(Output {
                                output: k,
                                target: parts[0].into(),
                                input: parts[1].into(),
                                param: if n > 5 { parts[2..n - 2].join(",") } else { parts[2].into() },
                                delay: parse_f(parts[n - 2]).unwrap_or(0.0),
                                times: parse_i(parts[n - 1]).filter(|&t| t != 0).unwrap_or(-1) as i32,
                            });
                        } else {
                            c.set(&k, v);
                        }
                    }
                }
            }
            _ => i += 1,
        }
    }
    out
}

#[derive(Clone, Copy, Debug)]
pub struct BPlane {
    pub n: [f32; 3],
    pub d: f32,
}

#[derive(Clone, Debug)]
pub struct TexInfo {
    pub flags: i32,
    pub name: String,
}

#[derive(Clone, Copy, Debug)]
pub struct Brush {
    pub first: usize,
    pub count: usize,
    pub contents: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct Side {
    pub plane: usize,
    pub texinfo: i32,
    pub bevel: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Model {
    pub mins: [f32; 3],
    pub maxs: [f32; 3],
    pub headnode: i32,
}

#[derive(Clone, Debug)]
pub struct StaticProp {
    pub model: String,
    pub origin: [f32; 3],
    pub angles: [f32; 3],
    pub solid: u8,
    pub skin: i32,
}

pub struct Bsp {
    pub entities: Vec<Entity>,
    pub planes: Vec<BPlane>,
    pub texinfo: Vec<TexInfo>,
    pub brushes: Vec<Brush>,
    pub sides: Vec<Side>,
    pub models: Vec<Model>,
    nodes: Vec<[i32; 2]>,
    leafs: Vec<(u16, u16)>,
    leaf_brushes: Vec<u16>,
    pub static_props: Vec<StaticProp>,
    pub relocated: bool,
}

struct R<'a>(&'a [u8]);
impl R<'_> {
    fn i32(&self, o: usize) -> i32 {
        i32::from_le_bytes(self.0[o..o + 4].try_into().unwrap())
    }
    fn u32(&self, o: usize) -> u32 {
        u32::from_le_bytes(self.0[o..o + 4].try_into().unwrap())
    }
    fn u16(&self, o: usize) -> u16 {
        u16::from_le_bytes([self.0[o], self.0[o + 1]])
    }
    fn i16(&self, o: usize) -> i16 {
        i16::from_le_bytes([self.0[o], self.0[o + 1]])
    }
    fn f32(&self, o: usize) -> f32 {
        f32::from_le_bytes(self.0[o..o + 4].try_into().unwrap())
    }
    fn cstr(&self, o: usize) -> String {
        let mut e = o;
        while e < self.0.len() && self.0[e] != 0 {
            e += 1;
        }
        self.0[o..e].iter().map(|&c| c as char).collect()
    }
}

const L_ENTITIES: usize = 0;
const L_PLANES: usize = 1;
const L_TEXDATA: usize = 2;
const L_NODES: usize = 5;
const L_TEXINFO: usize = 6;
const L_LEAFS: usize = 10;
const L_MODELS: usize = 14;
const L_LEAFBRUSHES: usize = 17;
const L_BRUSHES: usize = 18;
const L_BRUSHSIDES: usize = 19;
const L_GAME: usize = 35;
const L_TEXDATA_STRING_DATA: usize = 43;
const L_TEXDATA_STRING_TABLE: usize = 44;

impl Bsp {
    pub fn parse(buf: &[u8]) -> Result<Bsp, String> {
        let r = R(buf);
        if buf.len() < 1036 || r.u32(0) != 0x50534256 {
            return Err("não é um mapa VBSP".into());
        }
        let lump = |i: usize| -> Result<(usize, usize), String> {
            if r.u32(20 + i * 16) != 0 {
                return Err(format!("lump {i} comprimido (não suportado)"));
            }
            Ok((r.i32(8 + i * 16) as usize, r.i32(12 + i * 16) as usize))
        };
        let (eo, el) = lump(L_ENTITIES)?;
        let text: String = buf[eo..eo + el].iter().map(|&c| c as char).collect();
        let entities = parse_entities(&text);

        let (po, pl) = lump(L_PLANES)?;
        let planes = (po..po + pl).step_by(20).map(|o| BPlane { n: [r.f32(o), r.f32(o + 4), r.f32(o + 8)], d: r.f32(o + 12) }).collect();

        let (sdo, _) = lump(L_TEXDATA_STRING_DATA)?;
        let (sto, _) = lump(L_TEXDATA_STRING_TABLE)?;
        let (tdo, tdl) = lump(L_TEXDATA)?;
        let tex_names: Vec<String> = (tdo..tdo + tdl)
            .step_by(32)
            .map(|o| {
                let id = r.i32(o + 12) as usize;
                r.cstr(sdo + r.i32(sto + id * 4) as usize).to_lowercase().replace('\\', "/")
            })
            .collect();
        let (tio, til) = lump(L_TEXINFO)?;
        let texinfo = (tio..tio + til).step_by(72).map(|o| TexInfo { flags: r.i32(o + 64), name: tex_names.get(r.i32(o + 68) as usize).cloned().unwrap_or_default() }).collect();

        let (no, nl) = lump(L_NODES)?;
        let nodes = (no..no + nl).step_by(32).map(|o| [r.i32(o + 4), r.i32(o + 8)]).collect();

        let (lo, ll) = lump(L_LEAFS)?;
        let stride = if r.i32(8 + L_LEAFS * 16 + 8) == 0 { 56 } else { 32 };
        let mut leafs = vec![];
        let mut o = lo;
        while o + stride <= lo + ll {
            leafs.push((r.u16(o + 24), r.u16(o + 26)));
            o += stride;
        }
        let (lbo, lbl) = lump(L_LEAFBRUSHES)?;
        let leaf_brushes = (lbo..lbo + lbl).step_by(2).map(|o| r.u16(o)).collect();

        let (bo, bl) = lump(L_BRUSHES)?;
        let brushes = (bo..bo + bl).step_by(12).map(|o| Brush { first: r.i32(o) as usize, count: r.i32(o + 4) as usize, contents: r.i32(o + 8) }).collect();
        let (so, sl) = lump(L_BRUSHSIDES)?;
        let sides = (so..so + sl).step_by(8).map(|o| Side { plane: r.u16(o) as usize, texinfo: r.i16(o + 2) as i32, bevel: buf[o + 6] != 0 }).collect();
        let (mo, ml) = lump(L_MODELS)?;
        let models = (mo..mo + ml)
            .step_by(48)
            .map(|o| Model { mins: [r.f32(o), r.f32(o + 4), r.f32(o + 8)], maxs: [r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)], headnode: r.i32(o + 36) })
            .collect();
        let static_props = parse_static_props(&r).unwrap_or_default();
        Ok(Bsp { entities, planes, texinfo, brushes, sides, models, nodes, leafs, leaf_brushes, static_props, relocated: false })
    }

    /// pincéis (brushes) de um modelo: percorre a árvore BSP dele até as folhas
    pub fn model_brushes(&self, mi: usize) -> Vec<usize> {
        let mut found = std::collections::BTreeSet::new();
        let mut stack = vec![self.models[mi].headnode];
        while let Some(n) = stack.pop() {
            if n < 0 {
                let Some(&(first, count)) = self.leafs.get((-1 - n) as usize) else { continue };
                for i in 0..count as usize {
                    if let Some(&b) = self.leaf_brushes.get(first as usize + i) {
                        found.insert(b as usize);
                    }
                }
            } else if let Some(c) = self.nodes.get(n as usize) {
                stack.push(c[0]);
                stack.push(c[1]);
            }
        }
        found.into_iter().collect()
    }
}

/// lista dos objetos estáticos do mapa (lump 35, "sprp")
fn parse_static_props(r: &R) -> Option<Vec<StaticProp>> {
    let ofs = r.i32(8 + L_GAME * 16) as usize;
    let len = r.i32(12 + L_GAME * 16);
    if len <= 0 {
        return None;
    }
    let n = r.i32(ofs);
    for i in 0..n as usize {
        let e = ofs + 4 + i * 16;
        if r.i32(e) != 0x73707270 {
            continue;
        }
        let version = r.u16(e + 6);
        let fo = r.i32(e + 8) as usize;
        let fl = r.i32(e + 12) as usize;
        if r.u16(e + 4) & 1 != 0 {
            return None;
        }
        let mut o = fo;
        let nd = r.i32(o) as usize;
        o += 4;
        let names: Vec<String> = (0..nd).map(|k| r.cstr(o + k * 128).to_lowercase().replace('\\', "/")).collect();
        o += nd * 128;
        o += 4 + r.i32(o) as usize * 2;
        let np = r.i32(o) as usize;
        o += 4;
        if np == 0 {
            return None;
        }
        let size = (fo + fl - o) / np;
        if version < 4 || size < 56 {
            return None;
        }
        return Some(
            (0..np)
                .map(|k| {
                    let p = o + k * size;
                    StaticProp {
                        model: names.get(r.u16(p + 24) as usize).cloned().unwrap_or_default(),
                        origin: [r.f32(p), r.f32(p + 4), r.f32(p + 8)],
                        angles: [r.f32(p + 12), r.f32(p + 16), r.f32(p + 20)],
                        solid: r.0[p + 30],
                        skin: r.i32(p + 32),
                    }
                })
                .collect(),
        );
    }
    None
}

// ------------------------------------------------------------------ KeyValues
#[derive(Clone, Debug)]
pub struct Kv {
    pub key: String,
    pub value: Option<String>,
    pub children: Vec<Kv>,
}

impl Kv {
    pub fn get(&self, key: &str) -> Option<&Kv> {
        self.children.iter().find(|c| c.key.eq_ignore_ascii_case(key))
    }
    pub fn val(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(|c| c.value.as_deref())
    }
}

/// formato texto KeyValues (scripts de som e legendas da Valve)
pub fn parse_kv(text: &str) -> Vec<Kv> {
    let c: Vec<char> = text.chars().collect();
    let mut i = 0usize;
    enum T {
        Open,
        Close,
        S(String, bool),
    }
    let n = c.len();
    let token = |i: &mut usize| -> Option<T> {
        loop {
            while *i < n && c[*i].is_whitespace() {
                *i += 1;
            }
            if *i + 1 < n && c[*i] == '/' && c[*i + 1] == '/' {
                while *i < n && c[*i] != '\n' {
                    *i += 1;
                }
                continue;
            }
            break;
        }
        if *i >= n {
            return None;
        }
        match c[*i] {
            '{' => {
                *i += 1;
                Some(T::Open)
            }
            '}' => {
                *i += 1;
                Some(T::Close)
            }
            '"' => {
                *i += 1;
                let mut s = String::new();
                while *i < n && c[*i] != '"' {
                    if c[*i] == '\\' && *i + 1 < n && (c[*i + 1] == '"' || c[*i + 1] == '\\') {
                        *i += 1;
                    }
                    s.push(c[*i]);
                    *i += 1;
                }
                *i += 1;
                Some(T::S(s, true))
            }
            _ => {
                let mut s = String::new();
                while *i < n && !c[*i].is_whitespace() && c[*i] != '{' && c[*i] != '}' && c[*i] != '"' {
                    s.push(c[*i]);
                    *i += 1;
                }
                Some(T::S(s, false))
            }
        }
    };
    fn block(i: &mut usize, n: usize, token: &dyn Fn(&mut usize) -> Option<T>) -> Vec<Kv> {
        let mut out = vec![];
        loop {
            let Some(k) = token(i) else { return out };
            let k = match k {
                T::Close => return out,
                T::Open => continue,
                T::S(s, _) => s,
            };
            let mut v = token(i);
            if let Some(T::S(s, false)) = &v {
                if s.starts_with('[') {
                    v = token(i); // condição de plataforma
                }
            }
            match v {
                None => return out,
                Some(T::Open) => out.push(Kv { key: k, value: None, children: block(i, n, token) }),
                Some(T::S(s, _)) => {
                    out.push(Kv { key: k, value: Some(s), children: vec![] });
                    let save = *i;
                    match token(i) {
                        Some(T::S(c, false)) if c.starts_with('[') => {}
                        _ => *i = save,
                    }
                }
                Some(T::Close) => return out,
            }
        }
    }
    block(&mut i, n, &token)
}
