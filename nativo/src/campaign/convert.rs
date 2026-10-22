//! Converte um mapa BSP da campanha original para o mundo do jogo (convert.js): pincéis viram
//! caixas (ou sólidos convexos) com os materiais PRÓPRIOS do laboratório, e as entidades viram
//! as mecânicas daqui. Coordenadas: 1 unidade Source = 2,5 cm, Z para cima → Y para cima.

use super::bsp::{contents as C, parse_f, parse_vec, surf as SF, Bsp, Entity, TexInfo};
use super::build::{Batch, Opts};
use super::mdl::StaticModel;
use crate::geo::Geo;
use crate::mats::hex;
use crate::world::{put, GameWorld};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

pub const S: f32 = 0.025;

pub fn to_v(x: f32, y: f32, z: f32) -> Vec3 {
    Vec3::new(x * S, z * S, -y * S)
}

pub fn vec_kv(e: &Entity, k: &str) -> Vec3 {
    let [x, y, z] = parse_vec(e.get(k));
    to_v(x, y, z)
}

/// ângulo de visão Source (graus, 0 = +X) → yaw do jogador daqui
pub fn yaw_from_source(deg: f32) -> f32 {
    deg.to_radians() - std::f32::consts::FRAC_PI_2
}

/// direção "para frente" de ângulos Source (graus), no espaço daqui
pub fn forward_of(pitch: f32, yaw: f32) -> Vec3 {
    let (p, y) = (pitch.to_radians(), yaw.to_radians());
    Vec3::new(p.cos() * y.cos(), -p.sin(), -p.cos() * y.sin())
}

/// vetores frente/cima (espaço daqui) de ângulos Source em graus
pub fn frame_of(pitch: f32, yaw: f32, roll: f32) -> (Vec3, Vec3) {
    let (sp, cp) = pitch.to_radians().sin_cos();
    let (sy, cy) = yaw.to_radians().sin_cos();
    let (sr, cr) = roll.to_radians().sin_cos();
    let f = Vec3::new(cp * cy, -sp, -(cp * sy));
    let u = Vec3::new(cr * sp * cy + sr * sy, cr * cp, -(cr * sp * sy - sr * cy));
    (f, u)
}

/// categoria visual/física de uma face, a partir do material e das flags
pub fn face_kind(t: Option<&TexInfo>) -> Option<&'static str> {
    let t = t?;
    let (name, flags) = (t.name.as_str(), t.flags);
    if name == "tools/toolsblack" {
        return Some("dark");
    }
    if flags & (SF::NODRAW | SF::SKY | SF::SKY2D | SF::HINT | SF::SKIP | SF::TRIGGER) != 0 || name.starts_with("tools/") {
        return None;
    }
    if name.contains("glass") {
        return Some("glass");
    }
    if name.contains("toxicslime") || name.contains("water") || flags & SF::WARP != 0 {
        return Some("goo");
    }
    if name.starts_with("lights/") || flags & SF::LIGHT != 0 {
        return Some("lamp");
    }
    if name.contains("metalgrate") {
        return Some("grate");
    }
    if flags & SF::NOPORTAL != 0 {
        return Some("metal");
    }
    Some("white")
}

struct BP {
    n: Vec3,
    d: f32,
    tex: Option<String>,
    kind: Option<&'static str>,
}

/// pontos de um pincel convexo: interseção de cada trio de planos, dentro de todos
fn brush_points(planes: &[BP]) -> Vec<Vec3> {
    let mut pts: Vec<Vec3> = vec![];
    let n = planes.len();
    for i in 0..n {
        for j in i + 1..n {
            for k in j + 1..n {
                let (a, b, c) = (&planes[i], &planes[j], &planes[k]);
                let m = Mat3::from_cols(a.n, b.n, c.n).transpose();
                if m.determinant().abs() < 1e-6 {
                    continue;
                }
                let v = m.inverse() * Vec3::new(a.d, b.d, c.d);
                if planes.iter().all(|p| p.n.dot(v) - p.d < 1e-3) && !pts.iter().any(|q| q.distance_squared(v) < 1e-8) {
                    pts.push(v);
                }
            }
        }
    }
    pts
}

#[derive(Default)]
pub struct BrushOpts {
    pub visual_only: bool,
    pub kinematic: bool,
    pub fallback: Option<&'static str>,
    pub rot: Option<Mat3>,
}

/// pincel → sólido do mundo. `offset`: origem da entidade (pincéis de entidade ficam relativos a ela)
pub fn add_brush(w: &mut GameWorld, ecs: &mut Ecs, bsp: &Bsp, bi: usize, offset: Vec3, o: &BrushOpts, batch: Option<&mut Batch>) -> Option<usize> {
    let brush = bsp.brushes[bi];
    let c = brush.contents;
    let is_goo = c & (C::WATER | C::SLIME) != 0;
    let solid = c & (C::SOLID | C::WINDOW | C::GRATE | C::PLAYERCLIP | C::MOVEABLE) != 0;
    if !is_goo && !solid && !o.visual_only {
        return None;
    }
    let mut planes = vec![];
    for s in brush.first..brush.first + brush.count {
        let side = bsp.sides[s];
        if side.bevel {
            continue;
        }
        let p = bsp.planes[side.plane];
        let mut n = Vec3::new(p.n[0], p.n[2], -p.n[1]);
        if let Some(r) = o.rot {
            n = (r * n).normalize();
        }
        let ti = (side.texinfo >= 0).then(|| bsp.texinfo.get(side.texinfo as usize)).flatten();
        planes.push(BP { n, d: p.d * S + n.dot(offset), tex: ti.map(|t| t.name.clone()), kind: face_kind(ti) });
    }
    let pts = brush_points(&planes);
    if pts.len() < 4 {
        return None;
    }
    let (mut min, mut max) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
    for p in &pts {
        min = min.min(*p);
        max = max.max(*p);
    }
    if (max - min).min_element() < 1e-3 {
        return None;
    }
    if is_goo {
        // luz mais alta e mais fraca: nos mapas do original há pedestais e plataformas logo acima da gosma
        w.hazard(ecs, min.x, min.y, min.z, max.x, max.y, max.z, Some(9.0), Some(3.5));
        return None;
    }
    let clip_only = c & (C::SOLID | C::WINDOW | C::GRATE | C::MOVEABLE) == 0;
    let grate = c & C::GRATE != 0;
    let mut kinds: Vec<Option<&str>> = planes.iter().map(|p| if clip_only { None } else { p.kind }).collect();
    // portas e placas de botão da Valve são pincéis invisíveis (o visual era um modelo)
    if let Some(fb) = o.fallback {
        if kinds.iter().all(|k| k.is_none()) {
            kinds = vec![Some(fb); planes.len()];
        }
    }
    let opts = Opts { solid: !o.visual_only, no_ray: clip_only || grate || o.visual_only, kinematic: o.kinematic };
    let see_through = kinds.contains(&Some("grate"));
    // pincel sólido todo em "nodraw": invisível, mas aceita portal (como no Portal 1)
    let nodraw_portal = !clip_only && !grate && !o.visual_only && planes.iter().all(|p| p.tex.as_deref() == Some("tools/toolsnodraw"));
    let axial = planes.len() == 6 && planes.iter().all(|p| p.n.abs().max_element() > 0.9999);
    let id = if axial {
        const FACE_N: [Vec3; 6] = [Vec3::X, Vec3::NEG_X, Vec3::Y, Vec3::NEG_Y, Vec3::Z, Vec3::NEG_Z];
        let faces: [Option<String>; 6] = std::array::from_fn(|f| planes.iter().position(|q| q.n.dot(FACE_N[f]) > 0.999).and_then(|i| kinds[i]).map(String::from));
        let id = w.imp_box(ecs, min, max, &faces, &opts, batch);
        if nodraw_portal {
            w.solids[id].portalable = true;
            w.solids[id].portal_faces = Some([true; 6]);
        }
        id
    } else {
        let pl: Vec<(Vec3, f32, Option<String>)> = planes.iter().zip(&kinds).map(|(p, k)| (p.n, p.d, k.map(String::from))).collect();
        let id = w.imp_convex(ecs, pts, &pl, &opts, batch);
        if nodraw_portal {
            if let Some(pl) = w.solids[id].planes.as_mut() {
                for p in pl {
                    p.portal = true;
                }
            }
            w.solids[id].portalable = true;
        }
        id
    };
    if see_through {
        w.solids[id].see_through = true;
        w.solids[id].no_ray = true;
    }
    Some(id)
}

pub fn is_cube(e: &Entity) -> bool {
    matches!(e.classname.as_str(), "prop_physics" | "prop_physics_override" | "prop_physics_multiplayer" | "prop_weighted_cube") && e.model().contains("metal_box")
}

#[derive(Clone, Debug, Default)]
pub struct CubeOpts {
    pub io_name: String,
    pub special: bool,
    pub core: Option<i32>,
    pub core_delay: f32,
    pub frozen: bool,
    pub grab_unlock: bool,
}

pub fn cube_opts(e: &Entity) -> CubeOpts {
    if e.classname == "prop_glados_core" {
        let sf = e.flags();
        CubeOpts { io_name: e.name(), core: Some(e.num("coretype", 0.0) as i32), core_delay: e.num("delaybetweenlines", 0.4).max(0.0), frozen: sf & 8 != 0, grab_unlock: sf & 64 != 0, ..default() }
    } else {
        CubeOpts { io_name: e.name(), special: e.get("skin") == Some("1"), ..default() }
    }
}

/// caixa (no mundo daqui) que envolve o modelo de pincel `mi` da entidade `e`
pub fn model_bounds(bsp: &Bsp, mi: usize, e: &Entity) -> (Vec3, Vec3) {
    let o = parse_vec(e.get("origin"));
    let m = bsp.models[mi];
    if let Some(rot) = e.rot {
        let at = vec_kv(e, "origin");
        let (mut min, mut max) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for k in 0..8 {
            let c = rot * to_v(if k & 1 != 0 { m.maxs[0] } else { m.mins[0] }, if k & 2 != 0 { m.maxs[1] } else { m.mins[1] }, if k & 4 != 0 { m.maxs[2] } else { m.mins[2] }) + at;
            min = min.min(c);
            max = max.max(c);
        }
        return (min, max);
    }
    let a = to_v(m.mins[0] + o[0], m.mins[1] + o[1], m.mins[2] + o[2]);
    let b = to_v(m.maxs[0] + o[0], m.maxs[1] + o[1], m.maxs[2] + o[2]);
    (a.min(b), a.max(b))
}

pub fn model_index(e: &Entity) -> Option<usize> {
    let m = e.get("model")?;
    m.strip_prefix('*')?.parse().ok()
}

/// moldes (point_template) criados por um env_entity_maker: as entidades já ficam no lugar e no
/// ângulo do "maker" desde o começo (os cubos ficam de fora: o dispensador os cria na hora)
pub fn relocate_templates(bsp: &mut Bsp) {
    if bsp.relocated {
        return;
    }
    bsp.relocated = true;
    let named = |ents: &[Entity], n: &str| -> Vec<usize> { ents.iter().enumerate().filter(|(_, e)| e.name() == n.to_lowercase()).map(|(i, _)| i).collect() };
    let mut makers_of: Vec<(usize, Vec<usize>)> = vec![];
    for (mi, m) in bsp.entities.iter().enumerate() {
        if m.classname != "env_entity_maker" {
            continue;
        }
        let Some(tpl) = named(&bsp.entities, m.get_or("entitytemplate", "")).into_iter().find(|&x| bsp.entities[x].classname == "point_template") else { continue };
        match makers_of.iter_mut().find(|(t, _)| *t == tpl) {
            Some((_, v)) => v.push(mi),
            None => makers_of.push((tpl, vec![mi])),
        }
    }
    let fmt = |v: Vec3| format!("{:.3} {:.3} {:.3}", v.x / S, -v.z / S, v.y / S);
    for (tpl, makers) in makers_of {
        let mut members0 = vec![];
        for (k, v) in bsp.entities[tpl].kv.clone() {
            if is_template_key(&k) {
                members0.extend(named(&bsp.entities, &v));
            }
        }
        if members0.is_empty() || members0.iter().all(|&e| is_cube(&bsp.entities[e]) || bsp.entities[e].classname == "prop_glados_core") {
            continue;
        }
        for (mk, &maker) in makers.iter().enumerate() {
            let members: Vec<usize> = if mk > 0 {
                // um molde com vários "makers": uma cópia das entidades para cada maker a mais
                let keep = bsp.entities[tpl].flags() & 2 != 0;
                let names: HashSet<String> = members0.iter().map(|&e| bsp.entities[e].name()).filter(|n| !n.is_empty()).collect();
                let ren = |v: &str| if !keep && !v.is_empty() && names.contains(&v.to_lowercase()) { format!("{v}&{mk}") } else { v.to_string() };
                let mut out = vec![];
                for &e in &members0 {
                    let src = &bsp.entities[e];
                    let mut c = Entity { classname: src.classname.clone(), kv: src.kv.clone(), outputs: src.outputs.clone(), ..default() };
                    for k in ["targetname", "parentname", "filtername", "target"] {
                        if let Some(v) = c.get(k).map(String::from) {
                            c.set(k, ren(&v));
                        }
                    }
                    for o in &mut c.outputs {
                        o.target = ren(&o.target);
                    }
                    if let Some(o0) = src.origin0.clone() {
                        c.set("origin", o0);
                    }
                    bsp.entities.push(c);
                    out.push(bsp.entities.len() - 1);
                }
                out
            } else {
                for &e in &members0 {
                    bsp.entities[e].origin0 = bsp.entities[e].get("origin").map(String::from);
                }
                members0.clone()
            };
            let t = vec_kv(&bsp.entities[tpl], "origin");
            let m = vec_kv(&bsp.entities[maker], "origin");
            let [mp, my, mr] = parse_vec(bsp.entities[maker].get("angles"));
            let (f, u) = frame_of(mp, my, mr);
            let rot = Mat3::from_cols(f, u, f.cross(u));
            for e in members {
                let ent = &mut bsp.entities[e];
                if is_cube(ent) || ent.classname == "prop_glados_core" {
                    continue;
                }
                let p = rot * (vec_kv(ent, "origin") - t) + m;
                ent.set("origin", fmt(p));
                let [ep, ey, er] = parse_vec(ent.get("angles"));
                let (ff, uu) = frame_of(ep, ey, er);
                ent.forward = Some((rot * ff).normalize());
                ent.up = Some((rot * uu).normalize());
                if ent.get("model").is_some_and(|m| m.starts_with('*')) {
                    ent.rot = Some(rot);
                }
            }
        }
    }
}

pub fn is_template_key(k: &str) -> bool {
    k.len() > 8 && k.starts_with("template") && k[8..].chars().all(|c| c.is_ascii_digit())
}

/// cascos (meia largura x, meia largura y, base z, topo z — unidades Source) das plataformas
fn model_hull(model: &str) -> Option<[f32; 4]> {
    match model {
        "models/props/light_rail_platform.mdl" => Some([64.0, 64.0, 30.0, 42.0]),
        "models/props/light_rail_platform_02.mdl" => Some([48.0, 48.0, 30.0, 42.0]),
        "models/props/lift_platform.mdl" => Some([63.7, 63.7, 20.0, 30.4]),
        _ => None,
    }
}

/// entidades de pincel que não viram geometria (gatilhos, volumes, áreas)
fn not_geometry(c: &str) -> bool {
    c.starts_with("trigger_")
        || c.starts_with("env_")
        || [
            "func_areaportal", "func_portal_", "func_noportal_volume", "func_occluder", "func_viscluster", "func_clip_vphysics", "func_ladderendpoint", "water_lod", "func_precipitation", "func_smokevolume", "func_vehicleclip", "func_dustmotes", "func_dustcloud",
        ]
        .iter()
        .any(|p| c.starts_with(p))
}

pub fn is_moving(c: &str) -> bool {
    ["func_door", "func_movelinear", "func_tracktrain", "func_rotating", "func_door_rotating", "func_platrot", "func_train", "func_physbox", "func_water_analog"].iter().any(|p| c.starts_with(p))
}

pub struct BrushEnt {
    pub e: usize,
    pub solids: Vec<usize>,
    pub bounds: Option<(Vec3, Vec3)>,
}

pub struct Follower {
    pub solids: Vec<usize>,
    pub root: usize,
}

pub struct RotPart {
    pub e: usize,
    pub unit: String,
    pub closed: Vec<usize>,
    pub states: Vec<Vec<usize>>,
}

pub struct RotGroup {
    pub e: usize,
    pub hinge: Vec3,
    pub deg: f32,
    pub axis: Vec3,
    pub turns: i32,
    pub closed: Vec<usize>,
    pub parts: Vec<RotPart>,
}

pub struct TrainCopy {
    pub train: usize,
    pub train_solids: Vec<usize>,
    pub children: Vec<usize>,
}

pub struct Built {
    pub kill_y: f32,
    pub spawn: [f32; 4],
    pub gun: String,
    pub cubes: Vec<(Vec3, CubeOpts)>,
    /// (posição, yaw, desligada, sem munição)
    pub turrets: Vec<(Vec3, f32, bool, bool)>,
    pub launchers: HashMap<usize, usize>,
    pub catchers: HashMap<usize, usize>,
    pub pedestals: Vec<(usize, usize)>,
    pub by_name: HashMap<String, Vec<usize>>,
    pub brush_ents: Vec<BrushEnt>,
    pub followers: Vec<Follower>,
    pub rot_groups: Vec<RotGroup>,
    pub train_pools: HashMap<String, Vec<TrainCopy>>,
    pub stats: (usize, usize, usize),
}

pub fn by_name(bsp: &Bsp) -> HashMap<String, Vec<usize>> {
    let mut m: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, e) in bsp.entities.iter().enumerate() {
        let n = e.name();
        if !n.is_empty() {
            m.entry(n).or_default().push(i);
        }
    }
    m
}

/// a peça que se move (porta, plataforma, trilho) de que esta depende (cadeia de pais)
pub fn moving_root(bsp: &Bsp, names: &HashMap<String, Vec<usize>>, e: usize) -> Option<usize> {
    let mut seen = HashSet::new();
    let mut cur = e;
    while seen.insert(cur) {
        let pn = bsp.entities[cur].get_or("parentname", "").to_lowercase();
        if pn.is_empty() {
            return None;
        }
        let par = *names.get(&pn)?.first()?;
        if is_moving(&bsp.entities[par].classname) {
            return Some(par);
        }
        cur = par;
    }
    None
}

fn hull_box(o: [f32; 3], angles: Option<&str>, hull: [f32; 4]) -> (Vec3, Vec3) {
    let yaw = ((parse_vec(angles)[1] / 90.0).round() as i64) & 1;
    let (hx, hy) = if yaw != 0 { (hull[1], hull[0]) } else { (hull[0], hull[1]) };
    let a = to_v(o[0] - hx, o[1] - hy, o[2] + hull[2]);
    let b = to_v(o[0] + hx, o[1] + hy, o[2] + hull[3]);
    (a.min(b), a.max(b))
}

const METAL6: [&str; 6] = ["metal"; 6];

fn metal_faces() -> [Option<String>; 6] {
    METAL6.map(|s| Some(s.to_string()))
}

pub fn build_map(w: &mut GameWorld, ecs: &mut Ecs, bsp: &mut Bsp, models: &HashMap<String, std::sync::Arc<Option<StaticModel>>>) -> Built {
    relocate_templates(bsp);
    let bsp: &Bsp = bsp;
    let names = by_name(bsp);
    let ents = &bsp.entities;

    // mundo (modelo 0): o mapa fixo vira poucas malhas (uma por material)
    let mut count = 0;
    let mut batch = Batch::default();
    for bi in bsp.model_brushes(0) {
        if add_brush(w, ecs, bsp, bi, Vec3::ZERO, &BrushOpts::default(), Some(&mut batch)).is_some() {
            count += 1;
        }
    }
    batch.finish(w, ecs);

    let mut followers = vec![];
    // entidades de pincel: na posição inicial (as que se mexem ganham corpo cinemático)
    let mut brush_ents: Vec<BrushEnt> = vec![];
    for (ei, e) in ents.iter().enumerate() {
        let Some(mi) = model_index(e) else { continue };
        if not_geometry(&e.classname) || mi >= bsp.models.len() {
            continue;
        }
        // a porta giratória do botão de pedestal não gira aqui: anda junto com o pedestal
        let root = if is_moving(&e.classname) && e.classname != "func_door_rotating" { None } else { moving_root(bsp, &names, ei) };
        let moving = is_moving(&e.classname) || root.is_some();
        let hidden = e.get("startdisabled") == Some("1") || e.get("rendermode") == Some("10");
        let visual_only = e.classname == "func_illusionary" || e.get("solidity") == Some("1");
        let mut fallback = if e.classname == "func_tracktrain" || e.classname == "func_movelinear" { Some("metal") } else { None };
        if e.classname == "func_door" {
            let pitch = parse_vec(e.get("movedir"))[0];
            let m = bsp.models[mi];
            let flat_wide = (m.maxs[0] - m.mins[0]).min(m.maxs[1] - m.mins[1]) >= 24.0 && m.maxs[2] - m.mins[2] <= 24.0; // placa de botão
            fallback = Some(if pitch > 45.0 && e.num("speed", 100.0) <= 60.0 { if flat_wide { "button" } else { "metal" } } else { "door" });
        }
        let o = BrushOpts { kinematic: moving, visual_only, fallback, rot: e.rot };
        let mut solids = vec![];
        for bi in bsp.model_brushes(mi) {
            if let Some(s) = add_brush(w, ecs, bsp, bi, vec_kv(e, "origin"), &o, None) {
                solids.push(s);
            }
        }
        if hidden {
            for &s in &solids {
                w.set_solid_enabled(ecs, s, false);
            }
        }
        // func_door "não sólida para o jogador" (flags 4/8): só visual
        if e.classname == "func_door" && e.flags() & 12 != 0 {
            for &s in &solids {
                if let Some(c) = w.solids[s].collider {
                    w.phys.set_enabled(c, false);
                }
            }
        }
        count += solids.len();
        if let Some(r) = root {
            if !solids.is_empty() {
                followers.push(Follower { solids: solids.clone(), root: r });
            }
        }
        brush_ents.push(BrushEnt { e: ei, solids, bounds: Some(model_bounds(bsp, mi, e)) });
    }

    // portas giratórias com peças presas (a cunha que inclina na câmara 18): além das peças na
    // posição fechada, cópias invisíveis já giradas, só para colisão
    let mut rot_groups = vec![];
    for bei in 0..brush_ents.len() {
        let ei = brush_ents[bei].e;
        let e = &ents[ei];
        let sf = e.flags();
        if e.classname != "func_door_rotating" || sf & 256 != 0 {
            continue;
        }
        let members: Vec<usize> = (0..brush_ents.len()).filter(|&x| x == bei || moving_root(bsp, &names, brush_ents[x].e) == Some(ei)).collect();
        if members.len() < 2 {
            continue;
        }
        let dist = e.num("distance", 90.0);
        let dist = if dist == 0.0 { 90.0 } else { dist };
        let axis = if sf & 64 != 0 { Vec3::X } else if sf & 128 != 0 { Vec3::NEG_Z } else { Vec3::Y };
        let deg = (if sf & (64 | 128) != 0 { dist } else { -dist }) * if sf & 2 != 0 { -1.0 } else { 1.0 };
        let hinge = vec_kv(e, "origin");
        let turns = if 360.0 % deg.abs() < 1e-6 { (360.0 / deg.abs()).round() as i32 } else { 2 };
        let parent_of = |x: usize| names.get(&ents[x].get_or("parentname", "").to_lowercase()).and_then(|v| v.first().copied());
        let unit_of = |x: usize| -> String {
            let mut cur = Some(x);
            for _ in 0..16 {
                let Some(c) = cur else { break };
                if c == ei {
                    break;
                }
                let par = parent_of(c);
                if par == Some(ei) {
                    let n = ents[c].name();
                    return if n.is_empty() { format!("#{c}") } else { n };
                }
                cur = par;
            }
            String::new()
        };
        let mut parts = vec![];
        for &m in &members {
            let me = brush_ents[m].e;
            let mut states = vec![vec![]];
            for k in 1..turns {
                let qk = Quat::from_axis_angle(axis, (deg * k as f32).to_radians());
                let rot = Mat3::from_quat(qk);
                let off = qk * (vec_kv(&ents[me], "origin") - hinge) + hinge;
                let mi = model_index(&ents[me]).unwrap_or(0);
                let mut list = vec![];
                for bi in bsp.model_brushes(mi) {
                    if let Some(sd) = add_brush(w, ecs, bsp, bi, off, &BrushOpts { kinematic: true, rot: Some(rot), ..default() }, None) {
                        w.set_solid_enabled(ecs, sd, false);
                        list.push(sd);
                    }
                }
                states.push(list);
            }
            parts.push(RotPart { e: me, unit: if me == ei { String::new() } else { unit_of(me) }, closed: brush_ents[m].solids.clone(), states });
        }
        let closed: Vec<usize> = members.iter().flat_map(|&m| brush_ents[m].solids.clone()).collect();
        followers.retain(|f: &Follower| !f.solids.iter().any(|s| closed.contains(s)));
        rot_groups.push(RotGroup { e: ei, hinge, deg, axis, turns, closed, parts });
    }

    // luzes: as mais fortes viram luzes de verdade (o resto fica no brilho dos painéis)
    let mut lights = vec![];
    for e in ents {
        if e.classname != "light" && e.classname != "light_spot" {
            continue;
        }
        let v: Vec<f32> = e.get_or("_light", "").split_whitespace().map(|x| x.parse().unwrap_or(0.0)).collect();
        let bright = v.get(3).copied().unwrap_or(0.0);
        if !(bright > 0.0) {
            continue;
        }
        let rgb = |i: usize| (v.get(i).copied().unwrap_or(0.0).clamp(0.0, 255.0)) as u32;
        lights.push((vec_kv(e, "origin"), (rgb(0) << 16) | (rgb(1) << 8) | rgb(2), bright, e.classname == "light_spot"));
    }
    lights.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut picked: Vec<(Vec3, u32, f32, bool)> = vec![];
    for l in lights {
        if picked.len() >= 10 {
            break;
        }
        if picked.iter().any(|q| q.0.distance(l.0) < 6.0) {
            continue;
        }
        picked.push(l);
    }
    // luz forte em sala pequena estoura a imagem: a intensidade cai com o tamanho do lugar
    for (p, color, bright, spot) in &picked {
        let dists: Vec<f32> = [Vec3::X, Vec3::NEG_X, Vec3::Y, Vec3::NEG_Y, Vec3::Z, Vec3::NEG_Z].iter().map(|d| w.raycast(*p, *d, 20.0).map(|h| h.dist).unwrap_or(20.0)).collect();
        let room = dists.iter().sum::<f32>() / 6.0;
        let k = (room / 7.0).clamp(0.3, 1.0);
        let near = (dists.iter().copied().fold(f32::INFINITY, f32::min) / 2.0).powi(2).clamp(0.12, 1.0);
        let sk = if *spot { 0.5 } else { 1.0 };
        w.light(ecs, p.x, p.y, p.z, (bright / 6.0).clamp(15.0, 90.0) * k * near * sk, *color, 30.0, false);
    }

    // início
    let start = ents.iter().find(|e| e.classname == "info_player_start");
    let sp = start.map(|s| vec_kv(s, "origin")).unwrap_or(Vec3::ZERO);
    let yaw = start.map(|s| yaw_from_source(parse_vec(s.get("angles"))[1])).unwrap_or(0.0);

    // plataformas que no original são só modelo: um bloco de metal do tamanho do casco
    for (ei, e) in ents.iter().enumerate() {
        if !e.classname.starts_with("prop_dynamic") || e.get("solid") == Some("0") {
            continue;
        }
        let Some(hull) = model_hull(&e.model()) else { continue };
        let has_parent = e.get("parentname").is_some_and(|p| !p.is_empty());
        let root = if has_parent { moving_root(bsp, &names, ei) } else { None };
        if has_parent && root.is_none() {
            continue;
        }
        let (min, max) = hull_box(parse_vec(e.get("origin")), e.get("angles"), hull);
        if root.is_none() && w.point_in_solid((min + max) * 0.5, None).is_some() {
            continue;
        }
        let b = w.imp_box(ecs, min, max, &metal_faces(), &Opts { solid: true, no_ray: false, kinematic: root.is_some() }, None);
        if let Some(r) = root {
            followers.push(Follower { solids: vec![b], root: r });
        }
    }

    // moldes com um carrinho (func_tracktrain) criados de tempos em tempos (a esteira da câmara 15)
    let mut train_pools = HashMap::new();
    for tpl in ents {
        if tpl.classname != "point_template" {
            continue;
        }
        let members: Vec<usize> = tpl.kv.iter().filter(|(k, _)| is_template_key(k)).flat_map(|(_, v)| names.get(&v.to_lowercase()).cloned().unwrap_or_default()).collect();
        let Some(&train) = members.iter().find(|&&m| ents[m].classname == "func_tracktrain") else { continue };
        let tn = tpl.name();
        let makers: Vec<String> = ents.iter().filter(|m| m.classname == "env_entity_maker" && m.get_or("entitytemplate", "").to_lowercase() == tn).map(|m| m.name()).collect();
        let timed = ents.iter().any(|t| t.classname == "logic_timer" && t.outputs.iter().any(|o| makers.contains(&o.target.to_lowercase()) && o.input.eq_ignore_ascii_case("forcespawn")));
        if !timed {
            continue;
        }
        let tname = ents[train].name();
        let mut pool = vec![];
        for _ in 0..6 {
            let solids_of = |w: &mut GameWorld, ecs: &mut Ecs, e: &Entity, kind: Option<&'static str>| -> Vec<usize> {
                let Some(mi) = model_index(e).filter(|&m| m < bsp.models.len()) else { return vec![] };
                bsp.model_brushes(mi).into_iter().filter_map(|bi| add_brush(w, ecs, bsp, bi, vec_kv(e, "origin"), &BrushOpts { kinematic: true, fallback: kind, rot: e.rot, ..default() }, None)).collect()
            };
            let train_solids = solids_of(w, ecs, &ents[train], Some("metal"));
            let mut children = vec![];
            for &m in &members {
                let me = &ents[m];
                if m == train || me.get_or("parentname", "").to_lowercase() != tname {
                    continue;
                }
                if me.get("model").is_some_and(|x| x.starts_with('*')) {
                    children.extend(solids_of(w, ecs, me, None));
                }
                if let Some(hull) = model_hull(&me.model()) {
                    let (min, max) = hull_box(parse_vec(me.get("origin")), me.get("angles"), hull);
                    children.push(w.imp_box(ecs, min, max, &metal_faces(), &Opts { solid: true, no_ray: false, kinematic: true }, None));
                }
            }
            for &sd in train_solids.iter().chain(&children) {
                w.set_solid_enabled(ecs, sd, false);
            }
            pool.push(TrainCopy { train, train_solids, children });
        }
        train_pools.insert(tn, pool);
    }

    // dispensadores de cubo: o tubo do dispensador do laboratório
    for e in ents {
        if e.classname.starts_with("prop_dynamic") && e.model().ends_with("box_dropper.mdl") {
            let p = vec_kv(e, "origin");
            w.dispenser(ecs, p.x, p.y + 2.2, p.z);
        }
    }

    // arma de portais: a do ponto de início o jogador já traz; as outras ficam num pedestal
    let mut gun = "none".to_string();
    let gives = |e: &Entity| {
        let one = e.get("canfireportal1") != Some("0");
        let two = e.get("canfireportal2") == Some("1");
        if two {
            "both"
        } else if one {
            "blue"
        } else {
            "none"
        }
    };
    let mut pedestals = vec![];
    for (ei, e) in ents.iter().enumerate() {
        if e.classname != "weapon_portalgun" {
            continue;
        }
        let p = vec_kv(e, "origin");
        if p.distance(sp) < 4.0 {
            gun = gives(e).into();
            continue;
        }
        let solids = &w.solids;
        let floor = w.raycast_f(p, Vec3::NEG_Y, 6.0, |i| {
            let b = &solids[i];
            b.max.x - b.min.x > 0.9 || b.max.z - b.min.z > 0.9
        });
        let floor_y = floor.map(|h| h.point.y).unwrap_or(p.y - 1.45);
        let height = (p.y - floor_y).clamp(0.6, 4.0);
        let pd = w.pedestal(ecs, p.x, p.y - height, p.z, gives(e), Some("gun"), height);
        pedestals.push((pd, ei));
    }

    // amostras (cubos): as que estão num point_template só aparecem quando o dispensador as cria
    let mut templated = HashSet::new();
    for e in ents {
        if e.classname == "point_template" {
            for (k, v) in &e.kv {
                if is_template_key(k) {
                    templated.insert(v.to_lowercase());
                }
            }
        }
    }
    let mut cubes = vec![];
    for e in ents {
        if !is_cube(e) && e.classname != "prop_glados_core" {
            continue;
        }
        if templated.contains(&e.name()) {
            continue;
        }
        let p = vec_kv(e, "origin");
        cubes.push((Vec3::new(p.x, p.y - 0.3, p.z), cube_opts(e)));
    }

    // torretas (o modelo daqui, no lugar e na direção das originais)
    let mut turrets = vec![];
    for e in ents {
        if e.classname != "npc_portal_turret_floor" {
            continue;
        }
        let p = vec_kv(e, "origin");
        let sf = e.flags();
        let ay = parse_vec(e.get("angles"))[1];
        turrets.push((p, yaw_from_source(ay) + std::f32::consts::PI, sf & 64 != 0, sf & 256 != 0));
    }

    // bolas de energia
    let mut launchers = HashMap::new();
    let launcher_props: Vec<&Entity> = ents.iter().filter(|e| e.classname.starts_with("prop_dynamic") && e.model().contains("combine_ball_launcher")).collect();
    for (ei, e) in ents.iter().enumerate() {
        if e.classname != "point_energy_ball_launcher" {
            continue;
        }
        let p = vec_kv(e, "origin");
        // a direção vem da carcaça (o modelo do lançador) quando há uma perto
        let housing = launcher_props.iter().map(|cp| (*cp, vec_kv(cp, "origin").distance(p))).filter(|x| x.1 < 3.0).min_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        let src = housing.map(|h| h.0).unwrap_or(e);
        let [pt, yw, _] = parse_vec(src.get("angles"));
        let n = housing.and_then(|h| h.0.forward).unwrap_or_else(|| forward_of(pt, yw));
        // o soquete daqui vai para a parede atrás do ponto de lançamento
        let mut at = p;
        let solids = &w.solids;
        let back = w.raycast_f(p + n * 0.05, -n, 3.0, |i| {
            let b = &solids[i];
            let s = b.max - b.min;
            !b.no_ray && [s.x, s.y, s.z].iter().filter(|&&d| d > 0.9).count() >= 2
        });
        if let Some(h) = back {
            at = h.point;
        }
        for _ in 0..40 {
            let Some(s) = w.point_in_solid(at + n * 0.05, None) else { break };
            if w.solids[s].no_ray {
                break;
            }
            at += n * 0.05;
        }
        let depth = (p - at).dot(n).max(0.0);
        let life = e.num("balllifetime", 12.0);
        let delay = e.num("ballrespawntime", 2.0);
        let speed = e.num("minspeed", 260.0);
        let li = w.launcher(ecs, at.x, at.y, at.z, n, depth, if delay == 0.0 { 2.0 } else { delay }, if life == 0.0 { 12.0 } else { life }, (if speed == 0.0 { 260.0 } else { speed }) * S);
        w.launchers[li].done = e.get("startdisabled") == Some("1");
        launchers.insert(ei, li);
    }
    // receptores: gatilho com filtro de bola de energia + o modelo do receptor ao lado
    let ball_filters: HashSet<String> = ents.iter().filter(|e| e.classname == "filter_combineball_type").map(|e| e.name()).collect();
    let catcher_props: Vec<&Entity> = ents.iter().filter(|e| e.classname.starts_with("prop_dynamic") && e.model().contains("combine_ball_catcher")).collect();
    let mut catchers = HashMap::new();
    for (ei, e) in ents.iter().enumerate() {
        if !e.classname.starts_with("trigger_") || !ball_filters.contains(&e.get_or("filtername", "").to_lowercase()) {
            continue;
        }
        let Some(mi) = model_index(e).filter(|&m| m < bsp.models.len()) else { continue };
        let (bmin, bmax) = model_bounds(bsp, mi, e);
        let c = (bmin + bmax) * 0.5;
        let best = catcher_props.iter().map(|cp| (*cp, vec_kv(cp, "origin"))).filter(|x| x.1.distance(c) < 4.0).min_by(|a, b| a.1.distance(c).partial_cmp(&b.1.distance(c)).unwrap());
        let [pt, yw, _] = best.map(|b| parse_vec(b.0.get("angles"))).unwrap_or([0.0; 3]);
        let n = best.and_then(|b| b.0.forward).unwrap_or_else(|| forward_of(pt, yw));
        let mut at = best.map(|b| b.1).unwrap_or(c);
        for _ in 0..40 {
            if w.point_in_solid(at + n * 0.25, None).is_none() {
                break;
            }
            at += n * 0.05;
        }
        catchers.insert(ei, w.catcher(ecs, at.x, at.y, at.z, n, None, 0.8));
        for b in &brush_ents {
            if ents[b.e].classname == "func_tracktrain" {
                if let Some((mn, mx)) = b.bounds {
                    if ((mn + mx) * 0.5).distance(at) < 3.0 {
                        for &sd in &b.solids {
                            w.set_solid_enabled(ecs, sd, false);
                        }
                    }
                }
            }
        }
    }

    // objetos estáticos (canos, tubos de vidro, corrimãos…): a forma do modelo e a colisão do .phy
    let props = add_static_props(w, ecs, bsp, models);

    // abaixo de tudo o que existe no mapa não há chão: quem cai ali morre logo
    let floor = w.solids.iter().map(|b| b.min.y).fold(f32::INFINITY, f32::min);
    let kill_y = if floor.is_finite() { floor } else { -400.0 } - 15.0;
    Built {
        kill_y,
        spawn: [sp.x, sp.y, sp.z, yaw],
        gun,
        cubes,
        turrets,
        launchers,
        catchers,
        pedestals,
        by_name: names.clone(),
        brush_ents,
        followers,
        rot_groups,
        train_pools,
        stats: (count, picked.len(), props),
    }
}

// ---------------------------------------------------------------- objetos estáticos
/// material pelo nome da textura do modelo (as texturas em si não são lidas)
fn prop_kind(tex: &str, model: &str) -> &'static str {
    let tm = format!("{tex}{model}");
    let has = |ws: &[&str]| ws.iter().any(|w| tm.contains(w));
    if has(&["fence", "grate", "chainlink", "mesh"]) {
        "grate"
    } else if tex.contains("glass") {
        "glass"
    } else if model.contains("clear_tube") {
        "tubeframe"
    } else if has(&["pipe"]) {
        "pipe"
    } else if has(&["rail", "fence", "metal", "grate", "lever", "light", "spot"]) {
        "metal"
    } else if has(&["concrete", "debris", "rock"]) {
        "concrete"
    } else if has(&["desk", "chair", "stool", "monitor", "speaker"]) {
        "office"
    } else {
        "default"
    }
}

fn prop_material(ecs: &mut Ecs, kind: &str) -> Handle<StandardMaterial> {
    if kind == "grate" {
        return super::build::imported_mat(ecs, "grate", 0);
    }
    let m = match kind {
        "glass" => StandardMaterial {
            base_color: hex(0xc8ecff).with_alpha(0.22),
            metallic: 0.1,
            perceptual_roughness: 0.05,
            alpha_mode: AlphaMode::Blend,
            double_sided: true,
            cull_mode: None,
            emissive: hex(0x16303c).to_linear(),
            ..default()
        },
        "tubeframe" => StandardMaterial { base_color: hex(0xd5dade), metallic: 0.65, perceptual_roughness: 0.32, ..default() },
        "pipe" => StandardMaterial { base_color: hex(0x737a80), metallic: 0.7, perceptual_roughness: 0.45, ..default() },
        "metal" => StandardMaterial { base_color: hex(0x8a9096), metallic: 0.75, perceptual_roughness: 0.4, ..default() },
        "concrete" => StandardMaterial { base_color: hex(0x8e8b85), metallic: 0.0, perceptual_roughness: 0.92, ..default() },
        "office" => StandardMaterial { base_color: hex(0xb9bcbf), metallic: 0.25, perceptual_roughness: 0.55, ..default() },
        _ => StandardMaterial { base_color: hex(0x9da2a7), metallic: 0.35, perceptual_roughness: 0.55, ..default() },
    };
    ecs.resource_mut::<Assets<StandardMaterial>>().add(m)
}

/// fizzler e trilhos do original já têm o visual daqui
fn skip_prop(m: &str) -> bool {
    m.contains("portal_cleanser") || m.contains("light_rail_wall_emitter")
}

/// peça convexa de colisão de um modelo (pontos já no mundo)
pub fn add_hull(w: &mut GameWorld, ecs: &mut Ecs, pts: &[Vec3], kinematic: bool) -> Option<usize> {
    let p: Vec<rapier3d::math::Vector> = pts.iter().map(|v| rapier3d::math::Vector::new(v.x, v.y, v.z)).collect();
    let (verts, tris) = std::panic::catch_unwind(|| rapier3d::parry::transformation::convex_hull(&p)).ok()?;
    if verts.len() < 4 {
        return None;
    }
    let vs: Vec<Vec3> = verts.iter().map(|v| Vec3::new(v.x, v.y, v.z)).collect();
    let mut planes: Vec<(Vec3, f32, Option<String>)> = vec![];
    for t in &tris {
        let (a, b, c) = (vs[t[0] as usize], vs[t[1] as usize], vs[t[2] as usize]);
        let n = (b - a).cross(c - a);
        if n.length_squared() < 1e-12 {
            continue;
        }
        let n = n.normalize();
        let d = n.dot(a);
        if planes.iter().any(|q| q.0.dot(n) > 0.9999 && (q.1 - d).abs() < 1e-4) {
            continue;
        }
        planes.push((n, d, None));
    }
    if planes.len() < 4 {
        return None;
    }
    let s = w.imp_convex(ecs, vs, &planes, &Opts { solid: true, no_ray: false, kinematic }, None);
    w.solids[s].prop = true;
    Some(s)
}

fn add_static_props(w: &mut GameWorld, ecs: &mut Ecs, bsp: &Bsp, models: &HashMap<String, std::sync::Arc<Option<StaticModel>>>) -> usize {
    let mut shown = 0;
    // tudo o que tem o mesmo material vira uma malha só
    let mut batches: HashMap<&'static str, Geo> = HashMap::new();
    for p in &bsp.static_props {
        if skip_prop(&p.model) {
            continue;
        }
        let Some(model) = models.get(&p.model).and_then(|m| m.as_ref().as_ref()) else { continue };
        let see_through = ["fence", "grate", "chainlink"].iter().any(|k| p.model.contains(k));
        let (f, u) = frame_of(p.angles[0], p.angles[1], p.angles[2]);
        let left = u.cross(f);
        // eixos locais daqui: x = frente do Source, y = cima, z = −esquerda
        let m = Mat4::from_cols(f.extend(0.0), u.extend(0.0), (-left).extend(0.0), to_v(p.origin[0], p.origin[1], p.origin[2]).extend(1.0));
        for g in &model.groups {
            let kind = prop_kind(&g.material, &p.model);
            let out = batches.entry(kind).or_default();
            let base = out.pos.len() as u32;
            for (i, q) in g.positions.iter().enumerate() {
                out.pos.push(m.transform_point3(Vec3::new(q[0] * S, q[2] * S, -q[1] * S)));
                let nn = g.normals[i];
                out.nor.push(m.transform_vector3(Vec3::new(nn[0], nn[2], -nn[1])).normalize_or_zero());
                out.uv.push(Vec2::new(g.uvs[i][0], g.uvs[i][1]));
            }
            // o Source desenha a frente no sentido horário; aqui é o anti-horário
            for t in g.indices.chunks(3) {
                if t.len() == 3 {
                    out.idx.extend([base + t[0], base + t[2], base + t[1]]);
                }
            }
        }
        shown += 1;
        if p.solid == 0 {
            continue;
        }
        for hull in &model.hulls {
            let pts: Vec<Vec3> = hull.iter().map(|q| m.transform_point3(Vec3::new(q[0] * S, q[2] * S, -q[1] * S))).collect();
            if let Some(s) = add_hull(w, ecs, &pts, false) {
                if see_through {
                    w.solids[s].see_through = true;
                    w.solids[s].no_ray = true;
                }
            }
        }
    }
    let root = w.root();
    for (kind, g) in batches {
        if g.idx.is_empty() {
            continue;
        }
        let mat = prop_material(ecs, kind);
        put(ecs, root, &g, mat, Transform::default());
    }
    let _ = parse_f;
    shown
}
