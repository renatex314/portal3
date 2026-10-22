//! Ferramentas do editor (tools/ da versão web): régua, trajetória (voo de quem é lançado e das
//! bolas de energia), alcance do jogador (busca em largura com saltos simulados), validação (os
//! problemas que o jogador só descobriria jogando) e o robô gravado (a prova de que o nível tem
//! solução, gravada ao completar o teste).

use super::doc::*;
use super::state::{Editor, Tool};
use crate::game::Game;
use crate::i18n::{num, tl, tlv};
use crate::portals::{Who, PORTAL_A, PORTAL_B};
use crate::world::GameWorld;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use bevy_egui::egui;
use std::collections::{HashMap, HashSet, VecDeque};

pub const PLAYER_HALF: Vec3 = Vec3::new(0.3, 0.9, 0.3);
pub const MAX_FALL: f32 = 32.0;
pub const WALK: f32 = 4.6;
pub const JUMP: f32 = 4.6;
const COLORS: [u32; 6] = [0x66d9ff, 0xffb347, 0xff6a9a, 0x9aff6a, 0xb06cff, 0xffee66];

fn color(hex: u32) -> Color {
    Color::srgb_u8((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

fn end_color(k: &str) -> u32 {
    match k {
        "pouso" => 0x4cff8a,
        "parede" => 0xffa94d,
        "mata" | "abismo" => 0xff4040,
        "grade" => 0xb06cff,
        _ => 0xaaaaaa,
    }
}

fn end_text(k: &str) -> &'static str {
    match k {
        "pouso" => "pousa em uma superfície",
        "parede" => "bate numa parede",
        "mata" => "cai na rocha fundida",
        "grade" => "é desintegrado na grade",
        "tempo" => "ainda está no ar depois de 14 s",
        "abismo" => "cai no vazio",
        "fundo" => "passa por tudo e sai por baixo do nível",
        "vida" => "some depois de viver o tempo todo",
        _ => "quica sem parar",
    }
}

// ------------------------------------------------------------------ estado
pub struct Path {
    pub pts: Vec<Vec3>,
    pub seg: Vec<u32>,
    pub times: Vec<f32>,
    pub end: (String, Vec3),
}

pub struct Traj {
    pub ghost: bool,
    pub plates: bool,
    pub pellets: bool,
    pub origin: Option<Vec3>,
    pub yaw: f32,
    pub pitch: f32,
    pub speed: f32,
    pub picking: bool,
    pub report: Vec<String>,
    pub paths: Vec<Path>,
    pub dirty: bool,
}

pub struct ReachJob {
    visited: HashMap<(i32, i32, i32), Vec3>,
    queue: VecDeque<Vec3>,
    truncated: bool,
    ignore: HashSet<usize>,
}

pub struct Reach {
    pub ignore_doors: bool,
    pub plates: bool,
    pub portals: bool,
    pub start: Option<Vec3>,
    pub picking: bool,
    pub run: bool,
    pub job: Option<ReachJob>,
    pub cells: Vec<Vec3>,
    pub report: Vec<String>,
    pub mesh: Option<Entity>,
}

pub struct Issue {
    pub level: &'static str,
    pub text: String,
    pub ids: Vec<String>,
}

pub struct Bot {
    pub t: f32,
    pub playing: bool,
    pub speed: f32,
    pub n: usize,
    pub ghost: Option<crate::characters::Dino>,
}

pub struct Tools {
    pub rulers: Vec<(Vec3, Vec3)>,
    pub pending: Option<Vec3>,
    pub traj: Traj,
    pub reach: Reach,
    pub issues: Vec<Issue>,
    pub validate: bool,
    pub bot: Bot,
    /// o nível mudou (a trajetória e o alcance se refazem)
    pub version: u64,
}

impl Default for Tools {
    fn default() -> Self {
        Tools {
            rulers: vec![],
            pending: None,
            traj: Traj { ghost: true, plates: true, pellets: true, origin: None, yaw: 0.0, pitch: 35.0, speed: 12.0, picking: false, report: vec![], paths: vec![], dirty: true },
            reach: Reach { ignore_doors: true, plates: true, portals: true, start: None, picking: false, run: false, job: None, cells: vec![], report: vec![], mesh: None },
            issues: vec![],
            validate: true,
            bot: Bot { t: 0.0, playing: false, speed: 1.0, n: 0, ghost: None },
            version: 0,
        }
    }
}

/// liga/desliga uma ferramenta
pub fn set_tool(ed: &mut Editor, t: Tool) {
    ed.tool = if ed.tool == Some(t) { None } else { Some(t) };
    ed.tools.traj.picking = false;
    ed.tools.reach.picking = false;
    ed.tools.bot.playing = false;
    match ed.tool {
        Some(Tool::Validate) => ed.tools.validate = true,
        Some(Tool::Traj) => ed.tools.traj.dirty = true,
        _ => {}
    }
}

// ------------------------------------------------------------------ simulação de voo (trajectory.js)
pub struct Flight {
    pub path: Path,
    pub passes: usize,
    pub max_h: f32,
    pub range: f32,
    pub time: f32,
    pub speed: f32,
}

/// varredura da caixa do corpo ao longo de `d` por `max_d`: caixas alinhadas exatas, rampas e
/// convexos pelo raio do centro com recuo; devolve (distância, normal, sólido)
pub fn sweep(w: &GameWorld, o: Vec3, d: Vec3, max_d: f32, half: Vec3, ignore: &HashSet<usize>) -> Option<(f32, Vec3, usize)> {
    let mut best: Option<(f32, Vec3, usize)> = None;
    let e = 0.01;
    let h3 = half - Vec3::splat(e);
    for i in w.solid_ids() {
        let b = &w.solids[i];
        if ignore.contains(&i) || b.no_ray || b.disabled || !b.solid || b.planes.is_some() || b.obb.is_some() {
            continue;
        }
        let (mut tmin, mut tmax) = (f32::NEG_INFINITY, f32::INFINITY);
        let (mut axis, mut sign) = (usize::MAX, 0.0);
        let mut ok = true;
        for a in 0..3 {
            let (lo, hi) = (b.min[a] - h3[a], b.max[a] + h3[a]);
            if d[a].abs() < 1e-9 {
                if o[a] <= lo || o[a] >= hi {
                    ok = false;
                    break;
                }
                continue;
            }
            let (mut t1, mut t2) = ((lo - o[a]) / d[a], (hi - o[a]) / d[a]);
            let mut s = -1.0;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
                s = 1.0;
            }
            if t1 > tmin {
                tmin = t1;
                axis = a;
                sign = s;
            }
            tmax = tmax.min(t2);
            if tmin >= tmax {
                ok = false;
                break;
            }
        }
        if !ok || axis == usize::MAX || tmin < 0.0 || tmin > max_d {
            continue;
        }
        if best.is_none_or(|b| tmin < b.0) {
            let mut n = Vec3::ZERO;
            n[axis] = sign;
            best = Some((tmin, n, i));
        }
    }
    // rampas e convexos
    if let Some(h) = w.raycast_f(o, d, max_d + 3.0, |i| (w.solids[i].planes.is_some() || w.solids[i].obb.is_some()) && !ignore.contains(&i)) {
        let n = h.normal;
        let back = (n.x.abs() * half.x + n.y.abs() * half.y + n.z.abs() * half.z) / d.dot(n).abs().max(0.05);
        let t = (h.dist - back).max(0.0);
        if t <= max_d && best.is_none_or(|b| t < b.0) {
            best = Some((t, n, h.solid));
        }
    }
    best
}

/// voo de um corpo lançado: `ghost` atravessa tudo (só portais e placas mudam o voo)
#[allow(clippy::too_many_arguments)]
pub fn flight(g: &Game, pos: Vec3, vel: Vec3, half: Vec3, dt: f32, max_t: f32, plates: bool, ghost: bool, ignore: &HashSet<usize>) -> Flight {
    let (w, ps) = (&g.world, &g.portals);
    let grav = g.gravity();
    let (mut pos, mut vel) = (pos, vel);
    let start = pos;
    let (mut pts, mut seg, mut times) = (vec![pos], vec![0u32], vec![0.0f32]);
    let mut used: HashMap<usize, f32> = HashMap::new();
    let (mut t, mut cross, mut cool, mut max_h) = (0.0f32, 0u32, 0.0f32, pos.y);
    let mut passes = 0;
    let floor_y = if ghost { w.solids.iter().map(|b| b.min.y).fold(start.y, f32::min) - 10.0 } else { -300.0 };
    let mut end: Option<(String, Vec3)> = None;
    while t < max_t && end.is_none() {
        vel += grav.at(pos) * dt;
        if vel.length() > MAX_FALL {
            vel = vel.normalize() * MAX_FALL;
        }
        let step = vel * dt;
        let len = step.length();
        let prev = pos;
        // placa de lançamento (mesmas regras do jogo)
        if plates {
            for (k, p) in w.plates.iter().enumerate() {
                if t - used.get(&k).copied().unwrap_or(-9.0) < 0.9 {
                    continue;
                }
                let top = p.pos.y + 0.2;
                let feet = pos.y - half.y;
                if (pos.x - p.pos.x).abs() < 1.05 && (pos.z - p.pos.z).abs() < 1.05 && feet > top - 0.25 && feet < top + 0.45 && vel.y <= 0.5 {
                    vel = p.vel;
                    pos.y = pos.y.max(top + half.y + 0.05);
                    used.insert(k, t);
                }
            }
        }
        let next = pos + step;
        // portal: o centro do corpo atravessou a boca?
        let crossed = if cool <= 0.0 && len > 1e-6 { ps.crossing(prev, next, Who::Player) } else { None };
        if let Some(p) = crossed {
            pos = next;
            let (q, _, _) = ps.carry(p, &mut pos, &mut vel);
            let n = ps.list[q].normal;
            if n.y.abs() < 0.5 {
                let need = n.x.abs() * half.x + n.z.abs() * half.z + 0.03;
                let dd = (pos - ps.list[q].center).dot(n);
                if dd < need {
                    pos += n * (need - dd);
                }
            }
            let side = Vec3::new(vel.x, 0.0, vel.z);
            let side = if side.length_squared() > 1e-6 { side.normalize() } else { Vec3::X };
            ps.exit_assist(q, pos, &mut vel, half, grav.at(pos), side);
            cross += 1;
            passes += 1;
            cool = 0.12;
            pts.push(pos);
            seg.push(cross);
            times.push(t);
            t += dt;
            continue;
        }
        cool -= dt;
        // rocha fundida e grades
        if !ghost {
            let hot = w.hazards.iter().any(|&h| {
                let b = &w.solids[h];
                next.x > b.min.x && next.x < b.max.x && next.y - half.y < b.max.y && next.y + half.y > b.min.y && next.z > b.min.z && next.z < b.max.z
            });
            if hot || w.segment_fizzler(prev, next, Vec3::ZERO).is_some() {
                pos = next;
                end = Some((if hot { "mata" } else { "grade" }.into(), pos));
                pts.push(pos);
                seg.push(cross);
                times.push(t);
                break;
            }
            if len > 1e-6 {
                let d = step / len;
                let mut hit = sweep(w, prev, d, len, half, ignore);
                // sobre a boca de um portal ligado a parede some: o corpo passa
                if let Some((dist, _, solid)) = hit {
                    let at = prev + d * dist;
                    if (0..ps.list.len()).any(|i| {
                        let p = &ps.list[i];
                        if !ps.is_linked(i) || p.delta > 0.0 || p.solid != Some(solid) {
                            return false;
                        }
                        let l = p.local(at);
                        l.x.abs() <= PORTAL_A + 0.15 && l.y.abs() <= PORTAL_B + 0.15
                    }) {
                        hit = None;
                    }
                }
                if let Some((dist, n, _)) = hit {
                    pos = prev + d * dist;
                    let up = -grav.at(pos);
                    let gl = up.length();
                    let ground = gl > 0.01 && n.dot(up / gl) > 0.7;
                    end = Some((if ground { "pouso" } else { "parede" }.into(), pos));
                    pts.push(pos);
                    seg.push(cross);
                    times.push(t);
                    break;
                }
            }
        }
        pos = next;
        max_h = max_h.max(pos.y);
        pts.push(pos);
        seg.push(cross);
        times.push(t);
        t += dt;
        if pos.y < floor_y || pos.length() > 5000.0 {
            end = Some(("abismo".into(), pos));
        }
    }
    let end = end.unwrap_or(("tempo".into(), pos));
    let last = end.1;
    Flight { passes, max_h: max_h - start.y, range: (last.x - start.x).hypot(last.z - start.z), time: t, speed: vel.length(), path: Path { pts, seg, times, end } }
}

/// bola de energia: reta com reflexos nas paredes e passagem por portais
pub fn pellet(g: &Game, pos: Vec3, dir: Vec3, speed: f32, life: f32) -> (Path, usize, u32, f32) {
    let (w, ps) = (&g.world, &g.portals);
    let (mut p, mut d) = (pos, dir.normalize());
    let (mut pts, mut seg) = (vec![p], vec![0u32]);
    let dt = 1.0 / 60.0;
    let (mut t, mut bounces, mut cross, mut cool) = (0.0f32, 0usize, 0u32, 0.0f32);
    let mut end = "vida";
    while t < life {
        let step = speed * dt;
        let next = p + d * step;
        if let Some(q) = if cool <= 0.0 { ps.crossing(p, next, Who::Ball) } else { None } {
            p = next;
            let m = ps.transform(q, ps.list[q].partner);
            p = m.transform_point3(p);
            d = m.transform_vector3(d).normalize();
            cross += 1;
            cool = 0.1;
            pts.push(p);
            seg.push(cross);
            t += dt;
            continue;
        }
        cool -= dt;
        if let Some(h) = w.raycast(p, d, step + 0.2) {
            p = h.point + h.normal * 0.2;
            d = (d - h.normal * 2.0 * d.dot(h.normal)).normalize();
            pts.push(p);
            seg.push(cross);
            bounces += 1;
            if bounces > 40 {
                end = "rebates";
                break;
            }
            t += dt;
            continue;
        }
        p = next;
        pts.push(p);
        seg.push(cross);
        t += dt;
        if p.length() > 3000.0 {
            end = "abismo";
            break;
        }
    }
    let n = pts.len();
    (Path { pts, seg, times: vec![0.0; n], end: (end.into(), p) }, bounces, cross, t)
}

// ------------------------------------------------------------------ alcance (reach.js)
const RCELL: f32 = 0.5;
const MAX_CELLS: usize = 14000;

fn rkey(p: Vec3) -> (i32, i32, i32) {
    ((p.x / RCELL).round() as i32, (p.y / 0.25).round() as i32, (p.z / RCELL).round() as i32)
}

impl ReachJob {
    fn new(g: &Game, start: Vec3, ignore_doors: bool) -> Self {
        let ignore: HashSet<usize> = if ignore_doors { g.world.doors.iter().map(|d| d.solid).collect() } else { HashSet::new() };
        let mut j = ReachJob { visited: HashMap::new(), queue: VecDeque::new(), truncated: false, ignore };
        let y0 = j.floor_at(g, start.x, start.z, start.y + 1.2, 6.0).unwrap_or(start.y);
        j.push(start.x, y0, start.z);
        j
    }
    fn floor_at(&self, g: &Game, x: f32, z: f32, from_y: f32, drop: f32) -> Option<f32> {
        let h = g.world.raycast_f(Vec3::new(x, from_y, z), Vec3::NEG_Y, drop, |i| !self.ignore.contains(&i))?;
        if h.normal.y < 0.7 || g.world.solids[h.solid].is_hazard {
            return None;
        }
        Some(h.point.y)
    }
    fn headroom(&self, g: &Game, x: f32, y: f32, z: f32) -> bool {
        g.world.raycast_f(Vec3::new(x, y + 0.05, z), Vec3::Y, 1.75, |i| !self.ignore.contains(&i)).is_none()
    }
    /// corredor livre do ponto a ao b, na altura dos joelhos e do peito, com a largura do corpo
    fn free(&self, g: &Game, a: Vec3, b: Vec3, y: f32) -> bool {
        let mut d = b - a;
        d.y = 0.0;
        let len = d.length();
        if len < 1e-6 {
            return true;
        }
        let d = d / len;
        let side = Vec3::new(-d.z, 0.0, d.x) * PLAYER_HALF.x * 0.9;
        for dy in [0.45, 1.5] {
            for s in [-1.0, 0.0, 1.0] {
                let mut o = a + side * s;
                o.y = y + dy;
                if g.world.raycast_f(o, d, len + 0.05, |i| !self.ignore.contains(&i)).is_some() {
                    return false;
                }
            }
        }
        true
    }
    fn push(&mut self, x: f32, y: f32, z: f32) {
        let p = Vec3::new((x / RCELL).round() * RCELL, y, (z / RCELL).round() * RCELL);
        let k = rkey(p);
        if self.visited.contains_key(&k) {
            return;
        }
        if self.visited.len() >= MAX_CELLS {
            self.truncated = true;
            return;
        }
        self.visited.insert(k, p);
        self.queue.push_back(p);
    }
    fn fly(&mut self, g: &Game, pos: Vec3, vel: Vec3, plates: bool) {
        let f = flight(g, pos, vel, PLAYER_HALF, 1.0 / 90.0, 6.0, plates, false, &self.ignore);
        if f.path.end.0 != "pouso" {
            return;
        }
        let e = f.path.end.1;
        let feet = e.y - PLAYER_HALF.y - 0.02;
        if let Some(y) = self.floor_at(g, e.x, e.z, feet + 0.6, 1.2) {
            self.push(e.x, y, e.z);
        }
    }
    /// processa a fila por até `budget`; devolve true quando acabou
    fn step(&mut self, g: &Game, plates: bool, portals: bool, budget: std::time::Duration) -> bool {
        let t0 = std::time::Instant::now();
        let dirs: Vec<Vec3> = (0..8).map(|i| Vec3::new((i as f32 * std::f32::consts::FRAC_PI_4).cos(), 0.0, (i as f32 * std::f32::consts::FRAC_PI_4).sin())).collect();
        while let Some(c) = self.queue.pop_front() {
            let center = Vec3::new(c.x, c.y + PLAYER_HALF.y + 0.05, c.z);
            let mut edge = false;
            // andar
            for d in &dirs {
                let (nx, nz) = (c.x + d.x * RCELL, c.z + d.z * RCELL);
                let ny = self.floor_at(g, nx, nz, c.y + 0.7, 1.4);
                match ny {
                    Some(ny) if (ny - c.y).abs() <= 0.5 => {
                        if self.free(g, c, Vec3::new(nx, c.y, nz), c.y) && self.headroom(g, nx, ny, nz) {
                            self.push(nx, ny, nz);
                        } else {
                            edge = true;
                        }
                    }
                    _ => {
                        edge = true;
                        // sem chão adiante: cai andando
                        if ny.is_none() && g.world.raycast_f(Vec3::new(nx, c.y + 0.7, nz), Vec3::NEG_Y, 0.9, |i| !self.ignore.contains(&i)).is_none() && self.free(g, c, Vec3::new(nx, c.y, nz), c.y) {
                            self.fly(g, center + *d * RCELL * 0.8, *d * WALK, plates);
                        }
                    }
                }
            }
            // pular (só de beiradas e paredes)
            if edge {
                for d in &dirs {
                    self.fly(g, center, *d * WALK + Vec3::Y * JUMP, plates);
                    self.fly(g, center, *d * WALK * 0.5 + Vec3::Y * JUMP, plates);
                }
                self.fly(g, center, Vec3::Y * JUMP, plates);
            }
            // placas de lançamento
            if plates {
                let hits: Vec<Vec3> = g.world.plates.iter().filter(|p| (c.x - p.pos.x).abs() < 1.0 && (c.z - p.pos.z).abs() < 1.0 && (c.y - (p.pos.y + 0.2)).abs() < 0.4).map(|_| center).collect();
                for p in hits {
                    self.fly(g, p, Vec3::ZERO, plates);
                }
            }
            // portais fixos: andar até a boca (parede) ou pisar nela (chão)
            if portals {
                let ps = &g.portals;
                for i in 0..ps.list.len() {
                    let p = &ps.list[i];
                    if !ps.is_linked(i) || p.delta > 0.0 {
                        continue;
                    }
                    let rel = c + Vec3::Y * 0.9 - p.center;
                    if p.normal.y.abs() > 0.7 {
                        if rel.x.hypot(rel.z) < 0.9 && (c.y - p.center.y).abs() < 0.5 {
                            self.fly(g, center - Vec3::Y * 0.2, Vec3::NEG_Y, plates);
                        }
                    } else if rel.length() < 2.4 && rel.dot(p.normal) > 0.0 {
                        let n = p.normal;
                        self.fly(g, center, -n * WALK, plates);
                    }
                }
            }
            if t0.elapsed() > budget {
                return false;
            }
        }
        true
    }
}

/// a lista de células contém um ponto a ≤ `r` m (horizontal) de `p` e na mesma altura (± `dy`)?
pub fn reached(cells: &[Vec3], p: Vec3, r: f32, dy: f32) -> bool {
    cells.iter().any(|c| (c.x - p.x).hypot(c.z - p.z) <= r && (c.y - p.y).abs() <= dy)
}

// ------------------------------------------------------------------ validação (validate.js)
pub fn validate(g: &Game, doc: &Doc) -> Vec<Issue> {
    let w = &g.world;
    let mut out: Vec<Issue> = vec![];
    let items = &doc.items;
    let of = |t: &str| items.iter().filter(|i| st(i, "type") == t).collect::<Vec<_>>();
    let id = |i: &serde_json::Map<String, serde_json::Value>| st(i, "id");
    let mut err = |text: String, ids: Vec<String>| out.push(Issue { level: "erro", text, ids });
    let open: HashSet<&String> = doc.chamber.open.iter().collect();
    if open.is_empty() && !items.iter().any(|i| ["block", "ramp"].contains(&st(i, "type").as_str())) {
        err(tl("A câmara está vazia: abra células na aba Câmara."), vec![]);
    }
    let spawns = of("spawn");
    let exits = of("exit");
    if spawns.is_empty() {
        err(tl("Falta o ponto de partida."), vec![]);
    }
    if exits.is_empty() {
        err(tl("Falta o elevador de saída: ninguém consegue completar o nível."), vec![]);
    }
    let mut issues = out;
    let warn = |issues: &mut Vec<Issue>, text: String, ids: Vec<String>| issues.push(Issue { level: "aviso", text, ids });
    let error = |issues: &mut Vec<Issue>, text: String, ids: Vec<String>| issues.push(Issue { level: "erro", text, ids });
    // partida dentro de sólido ou sem chão
    for s in &spawns {
        let p = v3(s, "p");
        let c = p + Vec3::Y * (PLAYER_HALF.y + 0.05);
        if w.point_in_solid(c, None).is_some() || w.point_in_solid(c + Vec3::Y * (PLAYER_HALF.y - 0.1), None).is_some() {
            error(&mut issues, tl("O ponto de partida está dentro de um bloco."), vec![id(s)]);
        }
        match w.raycast(p + Vec3::Y * 0.5, Vec3::NEG_Y, 60.0) {
            None => warn(&mut issues, tl("Sob o ponto de partida não há chão: o jogador cai no vazio."), vec![id(s)]),
            Some(h) if w.solids[h.solid].is_hazard => error(&mut issues, tl("O ponto de partida está sobre rocha fundida."), vec![id(s)]),
            Some(h) if p.y - h.point.y > 1.5 => warn(&mut issues, tlv("O ponto de partida fica {h} m acima do chão: o jogador começa caindo.", &[("h", num(p.y - h.point.y, 1))]), vec![id(s)]),
            _ => {}
        }
    }
    for e in &exits {
        if w.raycast(v3(e, "p") + Vec3::Y * 0.5, Vec3::NEG_Y, 8.0).is_none() {
            warn(&mut issues, tl("O elevador de saída está sem chão embaixo."), vec![id(e)]);
        }
    }
    // sinais: cada porta precisa de quem a abra, e cada botão precisa de algo para abrir
    let mut sources: HashMap<String, Vec<String>> = HashMap::new();
    let mut sinks: HashMap<String, Vec<String>> = HashMap::new();
    for it in items {
        let e = elem(&st(it, "type")).unwrap();
        for p in e.params.iter().filter(|p| p.t == PT::Sig) {
            let v = st(it, p.k);
            if v.is_empty() {
                continue;
            }
            (if p.k == "opens" { &mut sources } else { &mut sinks }).entry(v).or_default().push(id(it));
        }
    }
    for it in items {
        let t = st(it, "type");
        let e = elem(&t).unwrap();
        if t == "door" || t == "platform" {
            let s = st(it, "sig");
            if s.is_empty() {
                if t == "door" {
                    warn(&mut issues, tl("Porta sem sinal: ela nunca abre."), vec![id(it)]);
                }
            } else if !sources.contains_key(&s) && !(t == "platform" && bo(it, "always")) {
                warn(&mut issues, tlv("A porta/plataforma do sinal “{s}” não tem botão nem receptor que a ligue.", &[("s", s)]), vec![id(it)]);
            }
        }
        if ["button", "catcher", "laserCatcher", "incinerator"].contains(&t.as_str()) {
            let o = st(it, "opens");
            if o.is_empty() {
                warn(&mut issues, tlv("{label} sem sinal: não liga nada.", &[("label", tl(e.label))]), vec![id(it)]);
            } else if !sinks.contains_key(&o) {
                warn(&mut issues, tlv("{label} liga o sinal “{s}”, mas nenhuma porta/plataforma/funil usa esse sinal.", &[("label", tl(e.label)), ("s", o)]), vec![id(it)]);
            }
        }
    }
    let lasers = of("laser");
    for it in of("laserCatcher") {
        if lasers.is_empty() {
            warn(&mut issues, tl("Receptor de laser sem nenhum emissor de laser no nível."), vec![id(it)]);
        }
    }
    if !lasers.is_empty() && of("laserCatcher").is_empty() {
        warn(&mut issues, tl("Há emissor de laser, mas nenhum receptor: o feixe não liga nada."), lasers.iter().map(|i| id(i)).collect());
    }
    for (name, list) in &sources {
        if list.len() > 1 && sinks.contains_key(name) {
            warn(&mut issues, tlv("O sinal “{s}” tem {n} ligadores: a porta só abre com todos ativos ao mesmo tempo.", &[("s", name.clone()), ("n", list.len().to_string())]), list.clone());
        }
    }
    // peças de chão dentro da parede (fora da câmara)
    for it in items {
        let t = st(it, "type");
        if !["button", "cube", "turret", "crystal", "pedestal", "plate", "dino", "exit", "spawn"].contains(&t.as_str()) {
            continue;
        }
        if w.point_in_solid(v3(it, "p") + Vec3::Y * 0.4, None).is_some() {
            warn(&mut issues, tlv("{label} está dentro de uma parede ou bloco (fora da câmara?).", &[("label", tl(elem(&t).unwrap().label))]), vec![id(it)]);
        }
    }
    // coisas enterradas em blocos
    let blocks: Vec<_> = items.iter().filter(|i| ["block", "ramp"].contains(&st(i, "type").as_str())).collect();
    for it in items {
        let t = st(it, "type");
        if !["button", "cube", "turret", "crystal", "pedestal", "plate", "dispenser"].contains(&t.as_str()) {
            continue;
        }
        let c = obb_of(it).0;
        for b in &blocks {
            if st(b, "mat") == "glass" && st(b, "type") == "block" {
                continue;
            }
            let (mn, mx) = minmax(b);
            if c.cmpgt(mn + Vec3::splat(0.05)).all() && c.cmplt(mx - Vec3::splat(0.05)).all() {
                warn(&mut issues, tlv("{label} está dentro de um bloco.", &[("label", tl(elem(&t).unwrap().label))]), vec![id(it), id(b)]);
                break;
            }
        }
    }
    // portais: precisa de arma, de superfície que aceita e de portais fixos que assentam
    let gun = doc.cfg.get("gun").and_then(|v| v.as_str()).unwrap_or("both");
    let can_shoot = gun != "none" || !of("pedestal").is_empty();
    let mut chamber_white = false;
    for s in &doc.chamber.open {
        let [i, j, k] = parse_key(s);
        for (f, d) in FACE_DIRS.iter().enumerate() {
            if !open.contains(&cell_key([i + d[0], j + d[1], k + d[2]])) && doc.chamber.paint_of([i, j, k], f) == "white" {
                chamber_white = true;
            }
        }
    }
    let has_white = chamber_white || items.iter().any(|i| st(i, "type") == "block" && st(i, "mat") == "white" && bo(i, "portal")) || !of("panel").is_empty() || items.iter().any(|i| st(i, "type") == "ramp" && st(i, "mat") == "white");
    if can_shoot && !has_white {
        warn(&mut issues, tl("Há arma de portais mas nenhuma superfície aceita portal: use concreto claro (bloco “Aceita portal”) ou um painel diagonal."), vec![]);
    }
    let fixed = of("portal");
    let placed = g.portals.list.iter().take(2).filter(|p| p.placed && p.fixed).count();
    if !fixed.is_empty() && placed < fixed.len().min(2) {
        warn(&mut issues, tl("Algum portal fixo não achou parede atrás dele (ele precisa encostar numa superfície)."), fixed.iter().map(|i| id(i)).collect());
    }
    if fixed.iter().filter(|p| st(p, "which") == "blue").count() > 1 || fixed.iter().filter(|p| st(p, "which") == "orange").count() > 1 {
        warn(&mut issues, tl("Só cabe um portal fixo de cada cor: os extras são ignorados."), fixed.iter().map(|i| id(i)).collect());
    }
    if fixed.len() == 1 {
        warn(&mut issues, tl("Portal fixo sozinho não leva a lugar nenhum: ponha o par."), vec![id(fixed[0])]);
    }
    let auto = doc.cfg.get("autoLight").and_then(|v| v.as_bool()) != Some(false);
    if of("light").is_empty() && !(auto && !open.is_empty()) {
        warn(&mut issues, tl("O nível não tem nenhuma luz: ele fica escuro no jogo (o editor tem luz própria)."), vec![]);
    }
    for p in of("plate") {
        let (t, q) = (v3(p, "target"), v3(p, "p"));
        if st(p, "mode") == "alvo" && (t.x - q.x).hypot(t.z - q.z) < 0.5 && (t.y - q.y).abs() < 0.5 {
            warn(&mut issues, tl("A placa de lançamento aponta para o próprio lugar."), vec![id(p)]);
        }
    }
    for t in of("turret") {
        if gun == "none" {
            warn(&mut issues, tl("Há torreta mas o jogador não tem arma de portais: cuidado com o equilíbrio."), vec![id(t)]);
        }
    }
    if doc.cfg.get("relogio").and_then(|v| v.as_bool()).unwrap_or(false) && !items.iter().any(|i| ["button", "door"].contains(&st(i, "type").as_str())) {
        warn(&mut issues, tl("O relógio do tempo está ligado mas o nível não tem botões nem portas para o passado ajudar."), vec![]);
    }
    if issues.is_empty() {
        issues.push(Issue { level: "ok", text: tl("Nada de errado encontrado. (Confira também o alcance e jogue: nenhuma verificação substitui o teste.)"), ids: vec![] });
    }
    issues
}

// ------------------------------------------------------------------ robô gravado (recorder.js)
/// impressão do conteúdo do nível (sem a gravação): a prova só vale enquanto ela não muda
pub fn doc_hash(doc: &Doc) -> String {
    let items: Vec<serde_json::Value> = doc
        .items
        .iter()
        .map(|i| {
            let mut m = i.clone();
            m.remove("id");
            serde_json::Value::Object(m)
        })
        .collect();
    let s = serde_json::to_string(&serde_json::json!({ "c": doc.cfg, "h": doc.chamber, "i": items })).unwrap_or_default();
    let mut h: u32 = 5381;
    for c in s.encode_utf16() {
        h = (h << 5).wrapping_add(h).wrapping_add(c as u32);
    }
    radix36(h)
}

fn radix36(mut n: u32) -> String {
    let d = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut s = vec![];
    while n > 0 {
        s.push(d[(n % 36) as usize]);
        n /= 36;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

/// a prova gravada: "nenhuma", "válida ✔" ou "desatualizada ⚠"
pub fn proof_state(doc: &Doc) -> &'static str {
    match &doc.recording {
        None => "nenhuma",
        Some(r) if r.get("hash").and_then(|h| h.as_str()) == Some(doc_hash(doc).as_str()) => "válida ✔",
        _ => "desatualizada ⚠",
    }
}

fn rec_samples(doc: &Doc) -> Option<(f32, Vec<Vec<f32>>)> {
    let r = doc.recording.as_ref()?;
    let dt = r.get("dt").and_then(|v| v.as_f64()).unwrap_or(1.0 / 30.0) as f32;
    let s: Vec<Vec<f32>> = r.get("samples")?.as_array()?.iter().map(|a| a.as_array().map(|a| a.iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect()).unwrap_or_default()).filter(|v: &Vec<f32>| v.len() >= 7).collect();
    (!s.is_empty()).then_some((dt, s))
}

/// velocidade do robô no quadro n: a gravada; nas provas antigas, pela diferença entre quadros
fn vel_at(dt: f32, s: &[Vec<f32>], n: usize) -> Vec3 {
    if s[n].len() >= 10 {
        return Vec3::new(s[n][7], s[n][8], s[n][9]);
    }
    let p = |i: usize| Vec3::new(s[i][0], s[i][1], s[i][2]);
    let jump = |i: usize, j: usize| p(i).distance(p(j)) > 40.0 * dt * (j as f32 - i as f32).abs();
    let a = if n > 0 && !jump(n - 1, n) { n - 1 } else { n };
    let b = if n + 1 < s.len() && !jump(n, n + 1) { n + 1 } else { n };
    if b > a { (p(b) - p(a)) / ((b - a) as f32 * dt) } else { Vec3::ZERO }
}

fn fmt_time(t: f32) -> String {
    format!("{}:{:02}", (t / 60.0).floor() as i32, (t % 60.0).floor() as i32)
}

impl Game {
    /// grava o caminho do teste (30 quadros por segundo)
    pub fn record_run(&mut self, dt: f32) {
        if !self.editor.as_ref().is_some_and(|e| e.testing) {
            return;
        }
        self.rec_acc += dt;
        while self.rec_acc >= 1.0 / 30.0 {
            self.rec_acc -= 1.0 / 30.0;
            let r = |v: f32| (v * 100.0).round() / 100.0;
            let p = &self.player;
            self.rec.push(vec![r(p.pos.x), r(p.pos.y), r(p.pos.z), r(p.yaw), r(p.pitch), if p.grounded { 1.0 } else { 0.0 }, p.up_sign, r(p.vel.x), r(p.vel.y), r(p.vel.z)]);
        }
    }

    /// completou o teste: o caminho vira a prova de que o nível tem solução
    pub fn save_proof(&mut self) {
        if self.rec.len() <= 10 {
            return;
        }
        let Some(ed) = self.editor.as_mut().filter(|e| e.testing) else { return };
        let hash = doc_hash(&ed.doc);
        ed.doc.recording = Some(serde_json::json!({ "dt": 1.0 / 30.0, "samples": self.rec, "time": self.level_time, "hash": hash }));
        super::store::save(&ed.doc);
        self.toast(&tl("Prova gravada: o seu caminho até a saída ficou no editor (aba Robô)."));
    }
}

// ------------------------------------------------------------------ clique e desenho
/// a ferramenta ativa trata o clique? (true = tratou)
pub fn click(ed: &mut Editor, w: &GameWorld, o: Vec3, d: Vec3) -> bool {
    match ed.tool {
        Some(Tool::Measure) => {
            let Some((p, _)) = ed.surface_at(w, o, d) else { return true };
            match ed.tools.pending.take() {
                None => ed.tools.pending = Some(p),
                Some(a) => ed.tools.rulers.push((a, p)),
            }
            true
        }
        Some(Tool::Traj) if ed.tools.traj.picking => {
            if let Some((sp, sn)) = ed.surface_at(w, o, d) {
                let up = sn.y > 0.5;
                let mut origin = if up { sp + Vec3::Y * (PLAYER_HALF.y + 0.05) } else { sp + sn * 0.4 };
                if !up {
                    origin.y = sp.y + 0.5;
                }
                ed.tools.traj.origin = Some(origin);
                ed.tools.traj.picking = false;
                ed.tools.traj.dirty = true;
            }
            true
        }
        Some(Tool::Reach) if ed.tools.reach.picking => {
            if let Some((sp, _)) = ed.surface_at(w, o, d) {
                ed.tools.reach.start = Some(sp);
                ed.tools.reach.picking = false;
            }
            true
        }
        Some(Tool::Bot) => {
            // clique perto do caminho verde: o robô vai para aquele ponto
            let Some((dt, s)) = rec_samples(&ed.doc) else { return false };
            let mut best = None;
            let mut bd = f32::INFINITY;
            for (i, x) in s.iter().enumerate() {
                let p = Vec3::new(x[0], x[1] - 0.8, x[2]);
                let t = (p - o).dot(d);
                let q = o + d * t.max(0.0);
                let dd = p.distance_squared(q) / p.distance(o).max(1.0).powi(2);
                if dd < bd {
                    bd = dd;
                    best = Some(i);
                }
            }
            match best {
                Some(i) if bd <= 0.03f32.powi(2) => {
                    ed.tools.bot.playing = false;
                    ed.tools.bot.t = i as f32 * dt;
                    true
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn cross(out: &mut Vec<(Vec3, Vec3, Color)>, p: Vec3, r: f32, c: Color) {
    for a in [Vec3::X, Vec3::Y, Vec3::Z] {
        out.push((p - a * r, p + a * r, c));
    }
}

/// as linhas que a ferramenta ativa desenha
pub fn lines(ecs: &mut Ecs) -> Vec<(Vec3, Vec3, Color)> {
    let g = ecs.resource::<Game>();
    let Some(ed) = g.editor.as_ref() else { return vec![] };
    let mut out = vec![];
    match ed.tool {
        Some(Tool::Measure) => {
            for (a, b) in &ed.tools.rulers {
                out.push((*a, *b, color(0xffee66)));
                let c = Vec3::new(b.x, a.y, b.z);
                out.push((*a, c, color(0x66d9ff)));
                out.push((c, *b, color(0x66d9ff)));
                cross(&mut out, *a, 0.12, Color::WHITE);
                cross(&mut out, *b, 0.12, Color::WHITE);
            }
            if let Some(p) = ed.tools.pending {
                cross(&mut out, p, 0.15, color(0x66ff99));
            }
        }
        Some(Tool::Traj) => {
            for p in &ed.tools.traj.paths {
                for i in 1..p.pts.len() {
                    out.push((p.pts[i - 1], p.pts[i], color(COLORS[p.seg[i] as usize % COLORS.len()])));
                }
                // marcas a cada meio segundo
                let mut next = 0.5;
                for (i, t) in p.times.iter().enumerate() {
                    if *t >= next {
                        cross(&mut out, p.pts[i], 0.06, Color::WHITE);
                        next += 0.5;
                    }
                }
                cross(&mut out, p.end.1, 0.25, color(end_color(&p.end.0)));
            }
            if let Some(o) = ed.tools.traj.origin {
                out.push((o + Vec3::Y * 0.6, o + Vec3::Y * 0.15, Color::WHITE));
                cross(&mut out, o + Vec3::Y * 0.15, 0.1, Color::WHITE);
            }
        }
        Some(Tool::Bot) => {
            if let Some((dt, s)) = rec_samples(&ed.doc) {
                for i in 1..s.len() {
                    out.push((Vec3::new(s[i - 1][0], s[i - 1][1] - 0.8, s[i - 1][2]), Vec3::new(s[i][0], s[i][1] - 0.8, s[i][2]), color(0x66ff99)));
                }
                let n = ed.tools.bot.n.min(s.len() - 1);
                let v = vel_at(dt, &s, n);
                if v.length() > 0.05 {
                    let p = Vec3::new(s[n][0], s[n][1], s[n][2]);
                    out.push((p, p + v.normalize() * (v.length() * 0.25).max(0.6), color(0xffd84a)));
                }
            }
        }
        _ => {}
    }
    out
}

// ------------------------------------------------------------------ a cada quadro (com o mundo)
pub fn update(ecs: &mut Ecs, dt: f32) {
    let root = ecs.resource::<Game>().world.root();
    ecs.resource_scope(|ecs, mut g: Mut<Game>| {
        let g = &mut *g;
        let Some(mut ed) = g.editor.take() else { return };
        // o nível mudou: a trajetória e o alcance se refazem/invalidam
        if ed.tools.version != ed.version {
            ed.tools.version = ed.version;
            ed.tools.traj.dirty = true;
            ed.tools.validate = ed.tool == Some(Tool::Validate) || ed.tools.validate;
            if !ed.tools.reach.cells.is_empty() || ed.tools.reach.job.is_some() {
                ed.tools.reach.cells.clear();
                ed.tools.reach.job = None;
                ed.tools.reach.report = vec![tl("O nível mudou: calcule de novo.")];
            }
        }
        if ed.tool == Some(Tool::Traj) && std::mem::take(&mut ed.tools.traj.dirty) {
            traj_refresh(g, &mut ed);
        }
        if ed.tool == Some(Tool::Validate) && std::mem::take(&mut ed.tools.validate) {
            ed.tools.issues = validate(g, &ed.doc);
        }
        // alcance: a busca anda um pouco a cada quadro
        if std::mem::take(&mut ed.tools.reach.run) {
            let spawn = ed.doc.items.iter().find(|i| st(i, "type") == "spawn").map(|i| v3(i, "p"));
            match ed.tools.reach.start.or(spawn) {
                Some(s) => {
                    ed.tools.reach.job = Some(ReachJob::new(g, s, ed.tools.reach.ignore_doors));
                    ed.tools.reach.report = vec![tl("Calculando…")];
                }
                None => g.toast(&tl("O nível não tem ponto de partida.")),
            }
        }
        if let Some(mut job) = ed.tools.reach.job.take() {
            let (pl, po) = (ed.tools.reach.plates, ed.tools.reach.portals);
            if job.step(g, pl, po, std::time::Duration::from_millis(12)) {
                let cells: Vec<Vec3> = job.visited.values().copied().collect();
                let mut lines = vec![tlv(if job.truncated { "{n} posições alcançáveis (busca cortada: o nível é grande demais)." } else { "{n} posições alcançáveis." }, &[("n", cells.len().to_string())])];
                for e in ed.doc.items.iter().filter(|i| st(i, "type") == "exit") {
                    lines.push(tl(if reached(&cells, v3(e, "p"), 1.6, 1.4) { "✔ O elevador de saída é alcançável." } else { "✖ O elevador de saída NÃO é alcançável com o que o jogador tem aqui (talvez falte um portal, uma porta aberta por botão ou um cubo)." }));
                }
                let un: Vec<String> = ed
                    .doc
                    .items
                    .iter()
                    .filter(|i| ["button", "pedestal", "cube"].contains(&st(i, "type").as_str()) && !reached(&cells, v3(i, "p"), 1.6, 1.4))
                    .map(|i| {
                        let t = st(i, "type");
                        let what = tl(if t == "button" { "botão" } else if t == "cube" { "cubo" } else { "pedestal" });
                        let p = v3(i, "p");
                        tlv("{what} em {p}", &[("what", what), ("p", format!("{:.0}, {:.0}, {:.0}", p.x, p.y, p.z))])
                    })
                    .collect();
                if !un.is_empty() {
                    lines.push(tlv("Fora do alcance: {list}.", &[("list", un.join("; "))]));
                }
                ed.tools.reach.report = lines;
                ed.tools.reach.cells = cells;
            } else {
                ed.tools.reach.report = vec![tlv("Calculando… {n} posições", &[("n", job.visited.len().to_string())])];
                ed.tools.reach.job = Some(job);
            }
        }
        // as células alcançadas: quadradinhos verdes (uma malha só)
        let want = ed.tool == Some(Tool::Reach) && !ed.tools.reach.cells.is_empty();
        if let Some(m) = ed.tools.reach.mesh {
            if !want || ecs.get_entity(m).is_err() {
                if let Ok(e) = ecs.get_entity_mut(m) {
                    e.despawn();
                }
                ed.tools.reach.mesh = None;
            }
        }
        if want && ed.tools.reach.mesh.is_none() {
            let geo = crate::geo::Geo::merge(ed.tools.reach.cells.iter().map(|c| crate::geo::plane_geo(0.42, 0.42).rotate_x(-std::f32::consts::FRAC_PI_2).translate(c.x, c.y + 0.04, c.z)));
            let mesh = crate::world::mesh_h(ecs, &geo);
            let mat = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color: Color::srgba(0.21, 0.88, 0.48, 0.45), unlit: true, alpha_mode: AlphaMode::Blend, double_sided: true, cull_mode: None, ..default() });
            let e = ecs.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::default(), bevy::camera::visibility::RenderLayers::layer(1), bevy::camera::visibility::NoFrustumCulling, ChildOf(root))).id();
            ed.tools.reach.mesh = Some(e);
        }
        // robô: reproduz o caminho gravado com um fantasma
        let bot = ed.tool == Some(Tool::Bot);
        if let Some((rdt, s)) = rec_samples(&ed.doc).filter(|_| bot) {
            let total = (s.len() - 1) as f32 * rdt;
            if ed.tools.bot.playing {
                ed.tools.bot.t += dt * ed.tools.bot.speed;
                if ed.tools.bot.t >= total {
                    ed.tools.bot.t = total;
                    ed.tools.bot.playing = false;
                }
            }
            let n = ((ed.tools.bot.t / rdt + 1e-6).floor() as usize).min(s.len() - 1);
            ed.tools.bot.n = n;
            let (a, b) = (&s[n], &s[(n + 1).min(s.len() - 1)]);
            let k = (ed.tools.bot.t / rdt - n as f32).clamp(0.0, 1.0);
            let up = a.get(6).copied().unwrap_or(1.0);
            let feet = Vec3::new(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 0.9 * up, a[2] + (b[2] - a[2]) * k);
            let moving = (b[0] - a[0]).hypot(b[2] - a[2]) > 0.02;
            if ed.tools.bot.ghost.as_ref().is_none_or(|gh| ecs.get_entity(gh.root).is_err()) {
                let gh = crate::characters::Cast::add_dino(ecs, root, "raptor", Some(0x8fe3ff), Some(0x38d8ff), 1.0);
                ed.tools.bot.ghost = Some(gh);
            }
            let t = g.t;
            let gh = ed.tools.bot.ghost.as_mut().unwrap();
            gh.pose = if moving { "walk".into() } else { "idle".into() };
            ecs.entity_mut(gh.root).insert((Transform::from_translation(feet).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, a[3] + std::f32::consts::PI, if up < 0.0 { std::f32::consts::PI } else { 0.0 })), Visibility::Inherited));
            gh.animate(ecs, t, dt);
        } else if let Some(gh) = &ed.tools.bot.ghost {
            if let Ok(mut e) = ecs.get_entity_mut(gh.root) {
                e.insert(Visibility::Hidden);
            }
        }
        g.editor = Some(ed);
    });
}

fn traj_refresh(g: &Game, ed: &mut Editor) {
    let tr = &mut ed.tools.traj;
    tr.paths.clear();
    tr.report.clear();
    let none = HashSet::new();
    let add = |tr: &mut Traj, title: String, f: Flight, ball: Option<(usize, u32)>| {
        let mut f = f;
        if tr.ghost && ball.is_none() && f.path.end.0 == "abismo" {
            f.path.end.0 = "fundo".into();
        }
        let end = tl(end_text(&f.path.end.0));
        let line = match ball {
            Some((b, p)) => tlv("{title}: {end}; {b} rebate(s), {p} portal(is), {t} s", &[("title", title), ("end", end), ("b", b.to_string()), ("p", p.to_string()), ("t", num(f.time, 1))]),
            None => {
                let mut s = tlv("{title}: {end}. Sobe {h} m · alcance {r} m · {t} s · chega a {v} m/s", &[("title", title), ("end", end), ("h", num(f.max_h, 1)), ("r", num(f.range, 1)), ("t", num(f.time, 1)), ("v", num(f.speed, 1))]);
                if f.passes > 0 {
                    s += &format!(" · {}", tlv("{n} portal(is)", &[("n", f.passes.to_string())]));
                }
                s
            }
        };
        tr.report.push(line);
        tr.paths.push(f.path);
    };
    if tr.plates {
        for (n, p) in g.world.plates.iter().enumerate() {
            let f = flight(g, p.pos + Vec3::Y * (0.2 + PLAYER_HALF.y + 0.05), p.vel, PLAYER_HALF, 1.0 / 120.0, 14.0, true, tr.ghost, &none);
            add(tr, tlv("Placa {n}", &[("n", (n + 1).to_string())]), f, None);
        }
    }
    if tr.pellets {
        for (n, l) in g.world.launchers.iter().enumerate() {
            let (path, b, p, t) = pellet(g, l.pos, l.dir, l.speed, l.life);
            let f = Flight { path, passes: p as usize, max_h: 0.0, range: 0.0, time: t, speed: l.speed };
            add(tr, tlv("Bola {n}", &[("n", (n + 1).to_string())]), f, Some((b, p)));
        }
    }
    if let Some(o) = tr.origin {
        let (y, p) = (tr.yaw.to_radians(), tr.pitch.to_radians());
        let v = Vec3::new(-y.sin() * p.cos(), p.sin(), -y.cos() * p.cos()) * tr.speed;
        let f = flight(g, o, v, PLAYER_HALF, 1.0 / 120.0, 14.0, tr.plates, tr.ghost, &none);
        add(tr, tl("Lançamento livre"), f, None);
    }
    if tr.report.is_empty() {
        tr.report.push(tl("Nada para mostrar: ponha uma placa de lançamento ou um lançador no nível, ou escolha uma origem."));
    }
}

// ------------------------------------------------------------------ painéis
pub fn panel(ui: &mut egui::Ui, ed: &mut Editor) {
    let Some(tool) = ed.tool else { return };
    ui.group(|ui| {
        match tool {
            Tool::Measure => {
                ui.heading(tl("Régua"));
                ui.label(egui::RichText::new(tl("Clique em dois pontos do cenário. O jogador tem 1,8 m de altura, pula ~1,1 m e anda a 4,6 m/s.")).small());
                if ui.button(tl("Limpar")).clicked() {
                    ed.tools.rulers.clear();
                    ed.tools.pending = None;
                }
                for (n, (a, b)) in ed.tools.rulers.iter().enumerate() {
                    let d = *b - *a;
                    let h = d.x.hypot(d.z);
                    ui.label(tlv("{n}: {d} m (horizontal {h} m · altura {y} m · {p} jogadores de altura · {s} s andando)", &[("n", (n + 1).to_string()), ("d", num(d.length(), 2)), ("h", num(h, 2)), ("y", format!("{}{}", if d.y >= 0.0 { "+" } else { "−" }, num(d.y.abs(), 2))), ("p", num(d.y.abs() / 1.8, 2)), ("s", num(h / 4.6, 2))]));
                }
            }
            Tool::Traj => {
                let tr = &mut ed.tools.traj;
                ui.heading(tl("Trajetória"));
                let mut ch = false;
                ch |= ui.checkbox(&mut tr.ghost, tl("Atravessar tudo (sem colisão; só portais e placas mudam o voo)")).changed();
                ch |= ui.checkbox(&mut tr.plates, tl("Arco das placas de lançamento")).changed();
                ch |= ui.checkbox(&mut tr.pellets, tl("Caminho das bolas de energia")).changed();
                ui.label(egui::RichText::new(tl("Lançamento livre: escolha de onde sai e para onde vai.")).small());
                let label = if tr.picking {
                    tl("Clique no cenário para escolher a origem…")
                } else if let Some(o) = tr.origin {
                    tlv("Origem: {p} (trocar)", &[("p", format!("{}, {}, {}", num(o.x, 1), num(o.y, 1), num(o.z, 1)))])
                } else {
                    tl("Escolher origem no cenário")
                };
                if ui.selectable_label(tr.picking, label).clicked() {
                    tr.picking = !tr.picking;
                }
                ch |= ui.add(egui::Slider::new(&mut tr.yaw, -180.0..=180.0).step_by(5.0).text(tl("Direção (° — 0 = norte, 90 = oeste)"))).changed();
                ch |= ui.add(egui::Slider::new(&mut tr.pitch, -90.0..=90.0).step_by(1.0).text(tl("Subida (°)"))).changed();
                ch |= ui.add(egui::Slider::new(&mut tr.speed, 0.0..=40.0).step_by(0.5).text(tl("Velocidade (m/s)"))).changed();
                ui.horizontal(|ui| {
                    for (k, l) in [("andar", "Andar"), ("pular", "Pular"), ("cair", "Cair")] {
                        if ui.button(tl(l)).clicked() {
                            (tr.pitch, tr.speed) = match k {
                                "andar" => (0.0, 4.6),
                                "pular" => (45.0, 6.5),
                                _ => (0.0, 0.0),
                            };
                            ch = true;
                        }
                    }
                });
                if ch {
                    tr.dirty = true;
                }
                if ui.button(tl("Criar placa de lançamento com este arco")).clicked() {
                    match tr.origin {
                        None => ed.status = tl("Escolha a origem primeiro."),
                        Some(o) => {
                            let feet = o - Vec3::Y * (PLAYER_HALF.y + 0.05);
                            let (y, p) = (tr.yaw.to_radians(), tr.pitch.to_radians());
                            let v = Vec3::new(-y.sin() * p.cos(), p.sin(), -y.cos() * p.cos()) * tr.speed;
                            let q = |x: f32, k: f32| (x * k).round() / k;
                            let mut over = serde_json::Map::new();
                            over.insert("p".into(), serde_json::json!([q(feet.x, 4.0), q(feet.y, 4.0), q(feet.z, 4.0)]));
                            over.insert("mode".into(), serde_json::json!("vel"));
                            over.insert("vel".into(), serde_json::json!([q(v.x, 10.0), q(v.y, 10.0), q(v.z, 10.0)]));
                            ed.add_item("plate", over);
                            ed.status = tl("Placa criada. Ela lança com a velocidade do arco.");
                        }
                    }
                }
                for l in &ed.tools.traj.report {
                    ui.label(egui::RichText::new(l).small());
                }
            }
            Tool::Reach => {
                let r = &mut ed.tools.reach;
                ui.heading(tl("Alcance do jogador"));
                ui.label(egui::RichText::new(tl("Verde = o jogador chega andando, pulando, caindo, pelas placas de lançamento e pelos portais fixos. Estimativa: não conta cubos como degrau nem portais que o jogador abriria.")).small());
                ui.checkbox(&mut r.ignore_doors, tl("Considerar as portas abertas"));
                ui.checkbox(&mut r.plates, tl("Usar placas de lançamento"));
                ui.checkbox(&mut r.portals, tl("Usar portais fixos"));
                let label = if r.picking {
                    tl("Clique no cenário…")
                } else if let Some(s) = r.start {
                    tlv("Ponto de partida: {p} (trocar)", &[("p", format!("{:.1}, {:.1}, {:.1}", s.x, s.y, s.z))])
                } else {
                    tl("Partir do ponto de partida do nível (trocar…)")
                };
                if ui.selectable_label(r.picking, label).clicked() {
                    r.picking = !r.picking;
                }
                if ui.add_enabled(r.job.is_none(), egui::Button::new(tl("Calcular alcance"))).clicked() {
                    r.run = true;
                }
                for l in &r.report {
                    ui.label(egui::RichText::new(l).small());
                }
            }
            Tool::Validate => {
                ui.heading(tl("Validação"));
                let mut go: Option<Vec<String>> = None;
                for m in &ed.tools.issues {
                    let icon = match m.level {
                        "erro" => "✖",
                        "aviso" => "⚠",
                        _ => "✔",
                    };
                    let col = match m.level {
                        "erro" => egui::Color32::from_rgb(255, 110, 110),
                        "aviso" => egui::Color32::from_rgb(255, 200, 100),
                        _ => egui::Color32::from_rgb(110, 255, 150),
                    };
                    if ui.add(egui::Button::new(egui::RichText::new(format!("{icon} {}", m.text)).color(col)).wrap()).clicked() && !m.ids.is_empty() {
                        go = Some(m.ids.clone());
                    }
                }
                if let Some(ids) = go {
                    ed.select(ids, false);
                    ed.req.focus = true;
                }
                if ui.button(tl("Revalidar")).clicked() {
                    ed.tools.validate = true;
                }
            }
            Tool::Bot => {
                ui.heading(tl("Robô gravado"));
                ui.label(egui::RichText::new(tl("Teste o nível (F5) e chegue ao elevador de saída: o seu caminho é gravado como prova de que dá para completar. Quando você muda o nível, a prova fica desatualizada.")).small());
                let st = proof_state(&ed.doc);
                let rec = rec_samples(&ed.doc);
                let time = ed.doc.recording.as_ref().and_then(|r| r.get("time")).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                ui.label(match st {
                    "nenhuma" => tl("Ainda não há prova gravada."),
                    "válida ✔" => tlv("✔ Prova válida: {time} de jogo, {n} quadros.", &[("time", fmt_time(time)), ("n", rec.as_ref().map(|r| r.1.len()).unwrap_or(0).to_string())]),
                    _ => tlv("⚠ Prova desatualizada (o nível mudou depois dela): {time}.", &[("time", fmt_time(time))]),
                });
                if let Some((dt, s)) = rec {
                    let total = (s.len() - 1) as f32 * dt;
                    let b = &mut ed.tools.bot;
                    ui.horizontal(|ui| {
                        if ui.button(if b.playing { tl("⏸ Pausar") } else { tl("▶ Reproduzir") }).clicked() {
                            b.playing = !b.playing;
                            if b.playing && b.t >= total {
                                b.t = 0.0;
                            }
                        }
                        if ui.button(tlv("Velocidade {v}×", &[("v", num(b.speed, 1))])).clicked() {
                            b.speed = if b.speed == 1.0 { 2.0 } else if b.speed == 2.0 { 0.5 } else { 1.0 };
                        }
                    });
                    if ui.add(egui::Slider::new(&mut b.t, 0.0..=total).show_value(false)).changed() {
                        b.playing = false;
                    }
                    ui.horizontal(|ui| {
                        if ui.button("◀").on_hover_text(tl("Quadro anterior")).clicked() {
                            b.playing = false;
                            b.t = ((b.t / dt).round() - 1.0).max(0.0) * dt;
                        }
                        if ui.button("▶").on_hover_text(tl("Próximo quadro")).clicked() {
                            b.playing = false;
                            b.t = (((b.t / dt).round() + 1.0) * dt).min(total);
                        }
                        if ui.button(tl("Usar na Trajetória")).clicked() {
                            let n = b.n.min(s.len() - 1);
                            let v = vel_at(dt, &s, n);
                            let sp = v.length();
                            let tr = &mut ed.tools.traj;
                            tr.speed = (sp * 10.0).round() / 10.0;
                            if sp > 1e-3 {
                                tr.pitch = ((v.y / sp).clamp(-1.0, 1.0).asin().to_degrees() * 10.0).round() / 10.0;
                                if v.x.hypot(v.z) > 1e-3 {
                                    tr.yaw = ((-v.x).atan2(-v.z).to_degrees() * 10.0).round() / 10.0;
                                }
                            }
                            if tr.origin.is_none() {
                                tr.picking = true;
                            }
                            tr.dirty = true;
                            ed.tool = Some(Tool::Traj);
                            ed.status = tlv("Velocidade do robô: {v} m/s. Clique na plataforma de onde ele vai sair.", &[("v", num(sp, 1))]);
                        }
                    });
                    let n = ed.tools.bot.n.min(s.len() - 1);
                    let v = vel_at(dt, &s, n);
                    ui.label(egui::RichText::new(tlv("Em {time} (quadro {n}): {v} m/s", &[("time", fmt_time(n as f32 * dt)), ("n", n.to_string()), ("v", num(v.length(), 1))])).small());
                    if ui.button(egui::RichText::new(tl("Apagar prova")).color(egui::Color32::from_rgb(255, 110, 110))).clicked() {
                        ed.push_undo();
                        ed.doc.recording = None;
                        ed.changed();
                    }
                }
            }
        }
    });
}
