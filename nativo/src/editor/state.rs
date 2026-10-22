//! O estado do editor e as operações sobre o documento (editor.js): seleção, colocar/mover/girar/
//! apagar itens, ligações de sinal, construção da câmara por células, desfazer/refazer.
//! Nada aqui desenha nem lê o teclado: a interface (`panel`) e a entrada (`input`) chamam isto.

use super::doc::*;
use crate::world::GameWorld;
use bevy::prelude::*;
use serde_json::{json, Map, Value};
use std::collections::HashSet;

pub const SNAPS: [f32; 4] = [0.25, 0.5, 1.0, 2.0];
const HORIZ: [&str; 4] = ["+x", "+z", "-x", "-z"];
const D2R: f32 = std::f32::consts::PI / 180.0;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tab {
    Chamber,
    Items,
}
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Build {
    Add,
    Remove,
    Paint,
}
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tool {
    Measure,
    Traj,
    Reach,
    Validate,
    Bot,
}

#[derive(Clone, Debug)]
pub struct Cam {
    pub pos: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub speed: f32,
}

impl Cam {
    pub fn rot(&self) -> Quat {
        Quat::from_euler(EulerRot::YXZ, self.yaw, self.pitch, 0.0)
    }
    pub fn fwd(&self) -> Vec3 {
        self.rot() * Vec3::NEG_Z
    }
}

/// alvo da construção: a célula (e a face, pintando)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Target {
    pub cell: [i32; 3],
    pub face: Option<usize>,
}

pub struct Stroke {
    pub seen: HashSet<String>,
    pub undone: bool,
}
pub struct Moving {
    pub id: String,
    pub undone: bool,
    pub moved: bool,
}
pub struct Edge {
    pub id: String,
    pub a: usize,
    pub n: Vec3,
    pub f0: Vec3,
    pub s0: f32,
    pub start: Map<String, Value>,
    pub undone: bool,
    pub moved: bool,
}
pub struct Picking {
    pub id: String,
    pub k: &'static str,
    pub mode: Option<&'static str>,
}

/// pedidos que precisam do mundo (o sistema de entrada atende)
#[derive(Default)]
pub struct Requests {
    pub rebuild: bool,
    pub test: bool,
    pub exit: bool,
    pub delete: bool,
    pub export: bool,
    pub import: bool,
    pub focus: bool,
    pub view: Option<&'static str>,
}

pub struct Editor {
    pub doc: Doc,
    pub tab: Tab,
    pub build: Build,
    pub paint: String,
    pub layer: i32,
    pub hide_ceil: bool,
    pub snap: f32,
    pub armed: Option<&'static str>,
    pub arm_rot: i32,
    pub selected: Vec<String>,
    pub linking: Option<String>,
    pub undo: Vec<String>,
    pub redo: Vec<String>,
    clipboard: Vec<Map<String, Value>>,
    pub stroke: Option<Stroke>,
    pub moving: Option<Moving>,
    pub edge: Option<Edge>,
    pub picking: Option<Picking>,
    pub cam: Cam,
    pub status: String,
    pub saved: String,
    pub tool: Option<Tool>,
    pub req: Requests,
    /// gravar no disco daqui a pouco (s)
    pub save_in: Option<f32>,
    pub dirty: bool,
    pub testing: bool,
    pub hover: Option<Target>,
    pub ghost: Option<(Vec3, Vec3, Quat, u32)>,
    pub pick_preview: Option<Vec3>,
    pub hot_handle: Option<(usize, f32)>,
    /// o que mudou desde o último quadro da interface (o painel relê os campos)
    pub version: u64,
    pub tools: super::tools::Tools,
}

pub fn ray_obb(o: Vec3, d: Vec3, c: Vec3, h: Vec3, q: Quat) -> Option<f32> {
    let qi = q.inverse();
    let lo = qi * (o - c);
    let ld = qi * d;
    let (mut t0, mut t1) = (0.0f32, f32::INFINITY);
    for a in 0..3 {
        if ld[a].abs() < 1e-9 {
            if lo[a].abs() > h[a] {
                return None;
            }
        } else {
            let mut a0 = (-h[a] - lo[a]) / ld[a];
            let mut a1 = (h[a] - lo[a]) / ld[a];
            if a0 > a1 {
                std::mem::swap(&mut a0, &mut a1);
            }
            t0 = t0.max(a0);
            t1 = t1.min(a1);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(t0)
}

/// células por onde o raio passa (Amanatides–Woo); `face` = por qual face da célula ANTERIOR ele saiu
pub fn walk(o: Vec3, d: Vec3, max_t: f32) -> Vec<(([i32; 3], Option<usize>), f32)> {
    let pos = [(o.x + CELL / 2.0) / CELL, o.y / CELL, (o.z + CELL / 2.0) / CELL];
    let mut cell = [pos[0].floor() as i32, pos[1].floor() as i32, pos[2].floor() as i32];
    let dir = [d.x, d.y, d.z];
    let step: [i32; 3] = std::array::from_fn(|a| if dir[a] > 0.0 { 1 } else if dir[a] < 0.0 { -1 } else { 0 });
    let dt: [f32; 3] = std::array::from_fn(|a| if dir[a] == 0.0 { f32::INFINITY } else { (CELL / dir[a]).abs() });
    let mut tmax: [f32; 3] = std::array::from_fn(|a| if dir[a] == 0.0 { f32::INFINITY } else { (if dir[a] > 0.0 { cell[a] as f32 + 1.0 - pos[a] } else { pos[a] - cell[a] as f32 }) * CELL / dir[a].abs() });
    let mut out = vec![((cell, None), 0.0)];
    for _ in 0..700 {
        let a = if tmax[0] < tmax[1] { if tmax[0] < tmax[2] { 0 } else { 2 } } else if tmax[1] < tmax[2] { 1 } else { 2 };
        let t = tmax[a];
        if t > max_t {
            break;
        }
        cell[a] += step[a];
        tmax[a] += dt[a];
        out.push(((cell, Some(a * 2 + if step[a] > 0 { 0 } else { 1 })), t));
    }
    out
}

impl Editor {
    pub fn new(doc: Doc) -> Self {
        let mut e = Editor {
            doc,
            tab: Tab::Items,
            build: Build::Add,
            paint: "metal".into(),
            layer: 0,
            hide_ceil: true,
            snap: 0.5,
            armed: None,
            arm_rot: 0,
            selected: vec![],
            linking: None,
            undo: vec![],
            redo: vec![],
            clipboard: vec![],
            stroke: None,
            moving: None,
            edge: None,
            picking: None,
            cam: Cam { pos: Vec3::new(0.0, 12.0, 14.0), yaw: 0.0, pitch: -0.6, speed: 10.0 },
            status: String::new(),
            saved: String::new(),
            tool: None,
            req: Requests { rebuild: true, ..default() },
            save_in: None,
            dirty: false,
            testing: false,
            hover: None,
            ghost: None,
            pick_preview: None,
            hot_handle: None,
            version: 0,
            tools: Default::default(),
        };
        e.view("persp");
        e
    }

    pub fn item(&self, id: &str) -> Option<&Map<String, Value>> {
        self.doc.items.iter().find(|i| i.get("id").and_then(|v| v.as_str()) == Some(id))
    }
    pub fn item_mut(&mut self, id: &str) -> Option<&mut Map<String, Value>> {
        self.doc.items.iter_mut().find(|i| i.get("id").and_then(|v| v.as_str()) == Some(id))
    }

    // ------------------------------------------------------------------ documento
    pub fn push_undo(&mut self) {
        self.undo.push(serde_json::to_string(&self.doc).unwrap_or_default());
        if self.undo.len() > 150 {
            self.undo.remove(0);
        }
        self.redo.clear();
    }
    fn restore(&mut self, json: &str) {
        if let Ok(d) = serde_json::from_str::<Doc>(json) {
            self.doc = d;
        }
        let ids: Vec<String> = self.selected.clone();
        self.selected = ids.into_iter().filter(|id| self.item(id).is_some()).collect();
        self.changed();
    }
    pub fn do_undo(&mut self) {
        if let Some(j) = self.undo.pop() {
            self.redo.push(serde_json::to_string(&self.doc).unwrap_or_default());
            self.restore(&j);
        }
    }
    pub fn do_redo(&mut self) {
        if let Some(j) = self.redo.pop() {
            self.undo.push(serde_json::to_string(&self.doc).unwrap_or_default());
            self.restore(&j);
        }
    }
    /// o documento mudou: o mundo se refaz e grava daqui a pouco
    pub fn changed(&mut self) {
        self.req.rebuild = true;
        self.save_in = Some(0.35);
        self.status = crate::i18n::tl("salvando…");
        self.version += 1;
    }
    pub fn save_now(&mut self) {
        self.save_in = None;
        let ok = super::store::save(&self.doc);
        self.status = crate::i18n::tl(if ok { "salvo" } else { "não consegui salvar — use Exportar" });
        self.saved = self.status.clone();
    }

    // ------------------------------------------------------------------ itens
    pub fn select(&mut self, ids: Vec<String>, additive: bool) {
        if additive {
            for id in ids {
                if !self.selected.contains(&id) {
                    self.selected.push(id);
                }
            }
        } else {
            self.selected = ids;
        }
        if self.picking.as_ref().is_some_and(|p| !self.selected.contains(&p.id)) {
            self.picking = None;
        }
        self.version += 1;
    }
    pub fn add_item(&mut self, t: &'static str, over: Map<String, Value>) -> String {
        self.push_undo();
        if elem(t).is_some_and(|e| e.unique) {
            self.doc.items.retain(|i| st(i, "type") != t);
        }
        let i = self.doc.add(t, over);
        let id = st(&self.doc.items[i], "id");
        self.selected = vec![id.clone()];
        self.changed();
        id
    }
    pub fn remove_items(&mut self, ids: Vec<String>) {
        if ids.is_empty() {
            return;
        }
        self.push_undo();
        self.doc.items.retain(|i| !ids.contains(&st(i, "id")));
        self.selected.clear();
        self.changed();
    }
    fn offset_copy(src: &Map<String, Value>) -> Map<String, Value> {
        let mut c = src.clone();
        c.insert("id".into(), json!(uid()));
        let p = v3(&c, "p");
        set_v3(&mut c, "p", Vec3::new(p.x + CELL / 2.0, p.y, p.z + CELL / 2.0));
        c
    }
    pub fn duplicate(&mut self) {
        let list: Vec<Map<String, Value>> = self.selected.iter().filter_map(|id| self.item(id).cloned()).filter(|i| !elem(&st(i, "type")).is_some_and(|e| e.unique)).collect();
        if list.is_empty() {
            return;
        }
        self.push_undo();
        let news: Vec<Map<String, Value>> = list.iter().map(Self::offset_copy).collect();
        self.selected = news.iter().map(|i| st(i, "id")).collect();
        self.doc.items.extend(news);
        self.changed();
    }
    pub fn copy(&mut self) {
        self.clipboard = self.selected.iter().filter_map(|id| self.item(id).cloned()).collect();
        self.status = crate::i18n::tlv("{n} copiado(s)", &[("n", self.clipboard.len().to_string())]);
    }
    pub fn paste(&mut self) {
        let list: Vec<Map<String, Value>> = self.clipboard.iter().filter(|i| !elem(&st(i, "type")).is_some_and(|e| e.unique)).cloned().collect();
        if list.is_empty() {
            return;
        }
        self.push_undo();
        let news: Vec<Map<String, Value>> = list.iter().map(Self::offset_copy).collect();
        self.selected = news.iter().map(|i| st(i, "id")).collect();
        self.doc.items.extend(news);
        self.changed();
    }
    /// gira 90° (R): o giro do item, a direção da tomada ou a orientação da porta
    fn rotate_one(it: &mut Map<String, Value>) {
        let Some(t) = elem(&st(it, "type")) else { return };
        match t.rot {
            Rot::Yaw => {
                let y = (f(it, "yaw") + 90.0).rem_euclid(360.0);
                it.insert("yaw".into(), json!(y));
            }
            Rot::Euler => {
                let mut r = v3(it, "r");
                r.y = (r.y + 90.0) % 360.0;
                set_v3(it, "r", r);
            }
            Rot::None => {
                if t.params.iter().any(|p| p.k == "dir") {
                    let d = st(it, "dir");
                    if let Some(i) = HORIZ.iter().position(|h| *h == d) {
                        it.insert("dir".into(), json!(HORIZ[(i + 1) % 4]));
                    }
                } else if t.place == Place::Face {
                    let s = v3(it, "s");
                    set_v3(it, "s", Vec3::new(s.z, s.y, s.x));
                }
            }
        }
    }
    pub fn rotate_sel(&mut self) {
        if self.armed.is_some() {
            self.arm_rot = (self.arm_rot + 1) % 4;
            return;
        }
        if self.selected.is_empty() {
            return;
        }
        self.push_undo();
        for id in self.selected.clone() {
            if let Some(it) = self.item_mut(&id) {
                Self::rotate_one(it);
            }
        }
        self.changed();
    }

    // ligações (botão → porta)
    pub fn is_source(it: &Map<String, Value>) -> bool {
        elem(&st(it, "type")).is_some_and(|e| e.params.iter().any(|p| p.k == "opens"))
    }
    pub fn sink_key(it: &Map<String, Value>) -> Option<&'static str> {
        elem(&st(it, "type")).and_then(|e| e.params.iter().find(|p| p.t == PT::Sig && p.k != "opens").map(|p| p.k))
    }
    pub fn next_sig(&self) -> String {
        let used: HashSet<String> = self.doc.items.iter().flat_map(|it| SIG_KEYS.iter().map(move |k| st(it, k))).filter(|s| !s.is_empty()).collect();
        for n in 0..26 * 27 {
            let s = if n < 26 { ((b'A' + n as u8) as char).to_string() } else { format!("{}{}", (b'A' + (n / 26 - 1) as u8) as char, (b'A' + (n % 26) as u8) as char) };
            if !used.contains(&s) {
                return s;
            }
        }
        uid()[..4].to_string()
    }
    /// liga uma fonte (botão, receptor) a um item ligado (porta, plataforma, funil, laser, grade)
    pub fn link(&mut self, a: &str, b: &str) -> bool {
        let (Some(ia), Some(ib)) = (self.item(a).cloned(), self.item(b).cloned()) else { return false };
        let (src, snk) = if Self::is_source(&ia) && Self::sink_key(&ib).is_some() {
            (a, b)
        } else if Self::is_source(&ib) && Self::sink_key(&ia).is_some() {
            (b, a)
        } else {
            return false;
        };
        let snk_it = self.item(snk).cloned().unwrap();
        let key = Self::sink_key(&snk_it).unwrap();
        let opens = st(self.item(src).unwrap(), "opens");
        let sk = st(&snk_it, key);
        self.push_undo();
        if !opens.is_empty() {
            self.item_mut(snk).unwrap().insert(key.into(), json!(opens)); // a fonte comanda várias portas
        } else if !sk.is_empty() {
            self.item_mut(src).unwrap().insert("opens".into(), json!(sk)); // várias fontes na mesma porta: todas precisam estar ligadas
        } else {
            let s = self.next_sig();
            self.item_mut(src).unwrap().insert("opens".into(), json!(s.clone()));
            self.item_mut(snk).unwrap().insert(key.into(), json!(s));
        }
        self.changed();
        true
    }
    pub fn unlink(&mut self, snk: &str) {
        let Some(key) = self.item(snk).and_then(Self::sink_key) else { return };
        self.push_undo();
        self.item_mut(snk).unwrap().insert(key.into(), json!(""));
        self.changed();
    }

    // ------------------------------------------------------------------ mouse no cenário
    pub fn pick_item(&self, o: Vec3, d: Vec3) -> Option<String> {
        let mut hits: Vec<(f32, f32, String)> = self
            .doc
            .items
            .iter()
            .filter_map(|it| {
                let (c, h, q) = obb_of(it);
                ray_obb(o, d, c, h, q).map(|t| (t, h.length_squared(), st(it, "id")))
            })
            .collect();
        if hits.is_empty() {
            return None;
        }
        hits.sort_by(|a, b| a.0.total_cmp(&b.0));
        let t0 = hits[0].0;
        hits.retain(|h| h.0 - t0 < 0.03);
        hits.sort_by(|a, b| a.1.total_cmp(&b.1));
        Some(hits[0].2.clone())
    }

    /// a célula está escondida (acima do andar que você edita)?
    pub fn hidden_cell(&self, c: Option<IVec3>) -> bool {
        self.hide_ceil && c.is_some_and(|c| c.y > self.layer)
    }

    /// onde o mouse toca o cenário: superfície do mundo ou o plano do chão da camada
    pub fn surface_at(&self, w: &GameWorld, o: Vec3, d: Vec3) -> Option<(Vec3, Vec3)> {
        if let Some(h) = w.raycast_f(o, d, 400.0, |i| !self.hidden_cell(w.solids[i].cell)) {
            return Some((h.point, h.normal));
        }
        let y = self.layer as f32 * CELL;
        if d.y.abs() > 1e-4 {
            let t = (y - o.y) / d.y;
            if t > 0.0 && t < 400.0 {
                return Some((o + d * t, Vec3::Y));
            }
        }
        None
    }

    pub fn snap_to(&self, v: f32, g: Option<f32>) -> f32 {
        let g = g.unwrap_or(self.snap);
        (v / g).round() * g
    }

    /// encaixe do item: no chão (centro da célula), na parede (grade de 1 m), no teto ou na face da célula
    pub fn placement_for(&self, t: &str, sp: Vec3, sn: Vec3, rot: i32) -> (Vec3, Map<String, Value>) {
        let e = elem(t).unwrap();
        let mut extra = Map::new();
        let inside = sp + sn * 0.05;
        let cell = cell_of(inside);
        let axis = |n: Vec3| if n.x.abs() >= n.y.abs() && n.x.abs() >= n.z.abs() { 0 } else if n.y.abs() >= n.z.abs() { 1 } else { 2 };
        let p = match e.place {
            Place::Floor => {
                let c = cell_center(cell);
                if e.rot == Rot::Yaw {
                    extra.insert("yaw".into(), json!(rot * 90));
                }
                Vec3::new(c.x, if sn.y > 0.5 { sp.y } else { cell[1] as f32 * CELL }, c.z)
            }
            Place::Ceiling => {
                let c = cell_center(cell);
                Vec3::new(c.x, if sn.y < -0.5 { sp.y } else { cell[1] as f32 * CELL + CELL - if t == "light" { 0.35 } else { 0.0 } }, c.z)
            }
            Place::Wall => {
                let a = axis(sn);
                let mut p = sp;
                for i in 0..3 {
                    if i != a {
                        p[i] = self.snap_to(p[i], Some(1.0));
                    }
                }
                if e.params.iter().any(|p| p.k == "dir") {
                    let sgn = if sn[a] >= 0.0 { "+" } else { "-" };
                    extra.insert("dir".into(), json!(format!("{sgn}{}", ["x", "y", "z"][a])));
                }
                if e.rot == Rot::Yaw {
                    let y = if a == 1 { (rot * 90) as f32 } else { (((-sn.x).atan2(-sn.z) / D2R + 180.0) % 360.0).round() };
                    extra.insert("yaw".into(), json!(y));
                }
                p
            }
            Place::Face => {
                // face da célula que o olhar atravessa: o eixo dominante do olhar decide se a porta fica em X ou Z
                let fw = Quat::from_rotation_y(self.cam.yaw) * Vec3::NEG_Z;
                let base = e.size.unwrap();
                if fw.x.abs() > fw.z.abs() {
                    extra.insert("s".into(), json!([base[2], base[1], base[0]]));
                    Vec3::new(((inside.x - CELL / 2.0) / CELL).round() * CELL + CELL / 2.0, cell[1] as f32 * CELL + base[1] / 2.0, cell[2] as f32 * CELL)
                } else {
                    extra.insert("s".into(), json!(base));
                    Vec3::new(cell[0] as f32 * CELL, cell[1] as f32 * CELL + base[1] / 2.0, ((inside.z - CELL / 2.0) / CELL).round() * CELL + CELL / 2.0)
                }
            }
            Place::Free if e.shape == Shape::Box => {
                let h = Vec3::from(e.size.unwrap()) / 2.0;
                let c = sp + sn * h;
                Vec3::new(self.snap_to(c.x - h.x, None) + h.x, self.snap_to(c.y - h.y, None) + h.y, self.snap_to(c.z - h.z, None) + h.z)
            }
            Place::Free => Vec3::new(self.snap_to(sp.x, None), self.snap_to(sp.y, None), self.snap_to(sp.z, None)),
        };
        (Vec3::new(r2(p.x), r2(p.y), r2(p.z)), extra)
    }

    /// coloca o item armado onde o mouse toca
    pub fn place_armed(&mut self, sp: Vec3, sn: Vec3, keep: bool) -> Option<String> {
        let t = self.armed?;
        let (p, mut extra) = self.placement_for(t, sp, sn, self.arm_rot);
        extra.insert("p".into(), json!([p.x, p.y, p.z]));
        let id = self.add_item(t, extra);
        if !keep && ["spawn", "exit", "stars"].contains(&t) {
            self.armed = None;
        }
        Some(id)
    }

    // ------------------------------------------------------------------ câmara
    fn open_vis(&self, c: [i32; 3]) -> bool {
        self.doc.chamber.is_open(c) && !(self.hide_ceil && c[1] > self.layer)
    }
    pub fn chamber_target(&self, o: Vec3, d: Vec3) -> Option<Target> {
        let cells = walk(o, d, 300.0);
        match self.build {
            Build::Remove => cells.iter().find(|((c, _), _)| self.open_vis(*c)).map(|((c, _), _)| Target { cell: *c, face: None }),
            Build::Add => {
                let mut seen = false;
                for ((c, _), _) in &cells {
                    if self.open_vis(*c) {
                        seen = true;
                    } else if seen {
                        return Some(Target { cell: *c, face: None });
                    }
                }
                let y = self.layer as f32 * CELL + CELL / 2.0;
                if d.y.abs() > 1e-4 {
                    let t = (y - o.y) / d.y;
                    if t > 0.0 && t < 400.0 {
                        let p = o + d * t;
                        return Some(Target { cell: cell_of(Vec3::new(p.x, y, p.z)), face: None });
                    }
                }
                None
            }
            Build::Paint => {
                let mut inside = false;
                let mut prev: Option<[i32; 3]> = None;
                for ((c, face), _) in &cells {
                    if self.open_vis(*c) {
                        inside = true;
                    } else if inside {
                        return Some(Target { cell: prev.unwrap(), face: *face });
                    }
                    prev = Some(*c);
                }
                None
            }
        }
    }
    /// pinta todas as faces vizinhas no mesmo plano que tinham a mesma tinta da clicada
    fn flood_paint(&mut self, cell: [i32; 3], face: usize, kind: &str) {
        let ch = self.doc.chamber.clone();
        let from = ch.paint_of(cell, face);
        let axes: Vec<usize> = (0..3).filter(|a| *a != face / 2).collect();
        let d = FACE_DIRS[face];
        let mut seen = HashSet::from([cell_key(cell)]);
        let mut q = std::collections::VecDeque::from([cell]);
        while let Some(c) = q.pop_front() {
            self.doc.chamber.set_paint(c, face, kind);
            for &a in &axes {
                for s in [-1, 1] {
                    let mut n = c;
                    n[a] += s;
                    let k = cell_key(n);
                    if seen.contains(&k) || !ch.is_open(n) || ch.is_open([n[0] + d[0], n[1] + d[1], n[2] + d[2]]) || ch.paint_of(n, face) != from {
                        continue;
                    }
                    seen.insert(k);
                    q.push_back(n);
                }
            }
        }
    }
    /// um passo do arrasto de construção/pintura; devolve se mudou algo
    pub fn apply_chamber(&mut self, t: Option<Target>, flood: bool) -> bool {
        let Some(t) = t else { return false };
        let key = format!("{},{:?}", cell_key(t.cell), t.face);
        let st0 = self.stroke.get_or_insert(Stroke { seen: HashSet::new(), undone: false });
        if !st0.seen.insert(key) {
            return false;
        }
        if !st0.undone {
            st0.undone = true;
            self.push_undo();
        }
        let did = match self.build {
            Build::Add => self.doc.chamber.set_open(t.cell, true),
            Build::Remove => self.doc.chamber.set_open(t.cell, false),
            Build::Paint => {
                let f = t.face.unwrap_or(3);
                let kind = self.paint.clone();
                if flood {
                    self.flood_paint(t.cell, f, &kind);
                } else {
                    self.doc.chamber.set_paint(t.cell, f, &kind);
                }
                true
            }
        };
        if did {
            self.dirty = true;
        }
        did
    }
    pub fn end_stroke(&mut self) {
        if self.stroke.take().is_some() && self.dirty {
            self.dirty = false;
            self.changed();
        }
    }

    // ------------------------------------------------------------------ mover e esticar
    /// arrasta o item selecionado: desliza no plano da altura dele (ou encaixa na parede)
    pub fn move_item(&mut self, w: &GameWorld, o: Vec3, d: Vec3) {
        let Some(m) = self.moving.as_ref() else { return };
        let id = m.id.clone();
        let Some(it) = self.item(&id).cloned() else { return };
        let t = elem(&st(&it, "type")).unwrap();
        let cur = v3(&it, "p");
        let mut extra = Map::new();
        let p = if t.place == Place::Wall {
            let Some((sp, sn)) = self.surface_at(w, o, d) else { return };
            let (p, ex) = self.placement_for(t.key, sp, sn, self.arm_rot);
            extra = ex;
            p
        } else {
            let y = cur.y;
            if d.y.abs() < 1e-4 {
                return;
            }
            let tt = (y - o.y) / d.y;
            if tt <= 0.0 || tt > 600.0 {
                return;
            }
            let hit = o + d * tt;
            match t.place {
                Place::Floor | Place::Ceiling => {
                    let c = cell_center(cell_of(Vec3::new(hit.x, y + 0.01, hit.z)));
                    Vec3::new(c.x, cur.y, c.z)
                }
                Place::Face => {
                    let s = v3(&it, "s");
                    if s.x < s.z {
                        Vec3::new(((hit.x - CELL / 2.0) / CELL).round() * CELL + CELL / 2.0, cur.y, self.snap_to(hit.z, Some(CELL)))
                    } else {
                        Vec3::new(self.snap_to(hit.x, Some(CELL)), cur.y, ((hit.z - CELL / 2.0) / CELL).round() * CELL + CELL / 2.0)
                    }
                }
                _ => Vec3::new(self.snap_to(hit.x, None), cur.y, self.snap_to(hit.z, None)),
            }
        };
        let p = Vec3::new(r2(p.x), r2(p.y), r2(p.z));
        if p == cur {
            return;
        }
        if !self.moving.as_ref().unwrap().undone {
            self.push_undo();
            self.moving.as_mut().unwrap().undone = true;
        }
        let it = self.item_mut(&id).unwrap();
        set_v3(it, "p", p);
        for (k, v) in extra {
            it.insert(k, v);
        }
        self.moving.as_mut().unwrap().moved = true;
        self.version += 1;
    }
    pub fn end_move(&mut self) {
        if let Some(m) = self.moving.take() {
            if m.moved {
                self.changed();
            }
        }
        if let Some(e) = self.edge.take() {
            if e.moved {
                self.changed();
            }
        }
    }

    /// o item que mostra alças de borda: um só selecionado, com tamanho
    pub fn edge_item(&self) -> Option<&Map<String, Value>> {
        if self.selected.len() != 1 || self.armed.is_some() || self.tab != Tab::Items {
            return None;
        }
        self.item(&self.selected[0]).filter(|it| elem(&st(it, "type")).is_some_and(|e| e.shape == Shape::Box))
    }
    /// as alças: (eixo, sinal, posição, normal)
    pub fn handles(&self) -> Vec<(usize, f32, Vec3, Vec3)> {
        let Some(it) = self.edge_item() else { return vec![] };
        let (c, h, q) = obb_of(it);
        let mut out = vec![];
        for a in 0..3 {
            for sg in [1.0, -1.0] {
                let mut ax = Vec3::ZERO;
                ax[a] = sg;
                let n = q * ax;
                out.push((a, sg, c + n * h[a], n));
            }
        }
        out
    }
    /// ponto da reta (f0 + s·n) mais perto do raio do mouse: devolve s
    pub fn along_axis(o: Vec3, d: Vec3, f0: Vec3, n: Vec3) -> Option<f32> {
        let w0 = f0 - o;
        let b = n.dot(d);
        let den = 1.0 - b * b;
        if den < 1e-4 {
            return None;
        }
        Some((b * d.dot(w0) - n.dot(w0)) / den)
    }
    pub fn start_edge(&mut self, a: usize, n: Vec3, f0: Vec3, o: Vec3, d: Vec3) -> bool {
        let Some(it) = self.edge_item().cloned() else { return false };
        let Some(s0) = Self::along_axis(o, d, f0, n) else { return false };
        self.edge = Some(Edge { id: st(&it, "id"), a, n, f0, s0, start: it, undone: false, moved: false });
        true
    }
    /// arrasta a face: a oposta fica parada (com Shift, as duas se afastam juntas)
    pub fn drag_edge(&mut self, o: Vec3, d: Vec3, sym: bool) {
        let Some(e) = self.edge.as_ref() else { return };
        let Some(s) = Self::along_axis(o, d, e.f0, e.n) else { return };
        let (a, n, f0) = (e.a, e.n, e.f0);
        let start = e.start.clone();
        let mut dd = s - e.s0;
        let sg = n[a].signum();
        let plain = v3(&start, "r").abs().max_element() < 1e-6 || !start.contains_key("r");
        if plain {
            dd = (self.snap_to(f0[a] + dd * sg, None) - f0[a]) * sg;
        } else {
            dd = self.snap_to(dd, None);
        }
        let (s0, p0) = (v3(&start, "s"), v3(&start, "p"));
        let grow = if sym { 2.0 * dd } else { dd };
        let size = r2(s0[a] + grow).max(self.snap);
        let dd = if sym { (size - s0[a]) / 2.0 } else { size - s0[a] };
        let mut s3 = s0;
        s3[a] = size;
        let p = if sym { p0 } else { p0 + n * (dd / 2.0) };
        let p = Vec3::new(r2(p.x), r2(p.y), r2(p.z));
        let id = e.id.clone();
        let it = self.item(&id).cloned().unwrap_or_default();
        if v3(&it, "s") == s3 && v3(&it, "p") == p {
            return;
        }
        if !self.edge.as_ref().unwrap().undone {
            self.push_undo();
            self.edge.as_mut().unwrap().undone = true;
        }
        let it = self.item_mut(&id).unwrap();
        set_v3(it, "s", s3);
        set_v3(it, "p", p);
        self.edge.as_mut().unwrap().moved = true;
        self.version += 1;
        let names = ["largura (x)", "altura (y)", "profundidade (z)"];
        self.status = format!("{}: {} m{}", crate::i18n::tl(names[a]), crate::i18n::num(size, 2), if sym { crate::i18n::tl(" · Shift: dos dois lados") } else { String::new() });
    }

    // ------------------------------------------------------------------ vista
    pub fn bounds(&self) -> (Vec3, Vec3) {
        let mut b = self.doc.chamber.bounds();
        for it in &self.doc.items {
            let (c, h, _) = obb_of(it);
            b = Some(match b {
                None => (c - h, c + h),
                Some((a, z)) => (a.min(c - h), z.max(c + h)),
            });
        }
        b.unwrap_or((Vec3::new(-4.0, 0.0, -4.0), Vec3::new(4.0, 4.0, 4.0)))
    }
    pub fn focus(&mut self) {
        let (a, z) = if self.selected.is_empty() {
            self.bounds()
        } else {
            let mut b: Option<(Vec3, Vec3)> = None;
            for id in &self.selected {
                if let Some(it) = self.item(id) {
                    let (c, h, _) = obb_of(it);
                    b = Some(match b {
                        None => (c - h, c + h),
                        Some((a, z)) => (a.min(c - h), z.max(c + h)),
                    });
                }
            }
            b.unwrap_or_else(|| self.bounds())
        };
        let c = (a + z) / 2.0;
        let r = ((z - a).length() * 0.8).max(4.0);
        self.cam.pos = c - self.cam.fwd() * r;
    }
    pub fn view(&mut self, kind: &str) {
        let (a, z) = self.bounds();
        let c = (a + z) / 2.0;
        let r = ((z - a).length() * 0.95).max(14.0);
        if kind == "top" {
            self.cam.pitch = -std::f32::consts::FRAC_PI_2 + 0.001;
            self.cam.yaw = 0.0;
            self.cam.pos = c + Vec3::Y * r;
        } else {
            self.cam.pitch = -0.7;
            self.cam.yaw = 0.45;
            self.cam.pos = c - self.cam.fwd() * r;
        }
    }
    pub fn set_layer(&mut self, n: i32) {
        self.layer = n.clamp(-3, 8);
        self.req.rebuild = true;
        self.hover = None;
    }
    pub fn set_tab(&mut self, t: Tab) {
        self.tab = t;
        self.selected.clear();
        self.armed = None;
        self.linking = None;
        self.ghost = None;
        self.hover = None;
        self.status.clear();
        self.version += 1;
    }

    /// os nomes de sinal em uso
    pub fn sig_names(&self) -> Vec<String> {
        let mut s: Vec<String> = self.doc.items.iter().flat_map(|it| SIG_KEYS.iter().map(move |k| st(it, k))).filter(|s| !s.is_empty()).collect();
        s.sort();
        s.dedup();
        s
    }
}
