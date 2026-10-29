//! Série Fronteira (frontier.js): o comportamento das mecânicas durante o jogo.
//!
//!  - lasers: o feixe atravessa portais, é desviado por cubos refletores, queima o jogador,
//!    derruba torretas e liga receptores;
//!  - pontes de luz: o mesmo caminho do laser, com um sólido fino por trecho para andar em cima;
//!  - funis de excursão: feixe largo (também atravessa portais) que carrega o que estiver dentro
//!    sem gravidade, nos dois sentidos;
//!  - placas de lançamento: arremessam quem pisa nelas;
//!  - buracos negros: o horizonte engole tudo;
//!  - portal para a Lua: o vácuo puxa para a boca.
//!
//! (As partes com o relógio do tempo — feixes mandados ao passado — vêm com o relógio.)

use crate::fx::{kind, Fx};
use crate::game::{Game, GameEvent};
use crate::geo::{cylinder_geo, plane_geo};
use crate::physics::Ent;
use crate::portals::{Portals, PORTAL_A, PORTAL_B};
use crate::props::{Kind, Props};
use crate::world::{bas, fx_mat, mesh_h, put_mesh, GameWorld};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;

pub const FUNNEL_R: f32 = 1.3;
const BRIDGE_W: f32 = 2.0;
const BRIDGE_T: f32 = 0.1;
const CORNER_R: f32 = 0.1;

/// trecho de feixe: início, fim, direção
pub type Seg = (Vec3, Vec3, Vec3);

pub const BRIDGE_LOOKS: [&str; 8] = ["luz", "vidro", "plasma", "aurora", "cristal", "correnteza", "nevoa", "veios"];

/// cor da lente do emissor de cada modelo de ponte
pub fn bridge_tint(look: &str) -> Vec3 {
    let c = match look {
        "luz" => [0.5, 1.9, 2.6],
        "vidro" => [1.8, 2.3, 2.7],
        "plasma" => [0.6, 1.6, 3.0],
        "aurora" => [0.5, 2.6, 1.6],
        "cristal" => [1.2, 2.2, 3.0],
        "correnteza" => [2.2, 2.4, 2.8],
        "nevoa" => [1.6, 1.8, 2.8],
        _ => [0.4, 2.6, 1.9],
    };
    Vec3::from(c)
}

fn look_index(look: &str) -> f32 {
    BRIDGE_LOOKS.iter().position(|l| *l == look).unwrap_or(7) as f32
}

struct BridgeMesh {
    panel: Entity,
    mat: Handle<Fx>,
    /// bordas: (grupo, material, ao longo?)
    corners: Vec<(Entity, Handle<Fx>, bool)>,
}

#[derive(Default)]
pub struct Frontier {
    /// trechos de cada funil (refeitos a cada quadro: os portais mudam)
    pub funnel_segs: Vec<Vec<Seg>>,
    funnel_meshes: Vec<Vec<(Entity, Handle<Fx>)>>,
    beams: Vec<(Entity, Entity)>,
    used: usize,
    sparks: Vec<Entity>,
    used_sparks: usize,
    bridges: Vec<BridgeMesh>,
    /// sólidos (índices em world.solids) de cada trecho de ponte
    bridge_boxes: Vec<usize>,
    pub in_funnel: bool,
    pub axis: Vec3,
    burn_t: f32,
    res: Option<Res>,
    /// para o som: distância até o feixe mais perto, perto de um funil (0..1), buraco negro, vácuo
    pub nearest_beam: f32,
    /// receptores de laser ligados neste quadro por um feixe de agora (não do passado)
    pub lit_present: std::collections::HashSet<usize>,
    pub funnel_near: f32,
    pub bh_loud: f32,
    pub gale: f32,
    /// feixes que entraram num ciano temporal neste quadro e no anterior
    pub live_entries: Vec<LaserEntry>,
    pub prev_entries: Vec<LaserEntry>,
    /// o que saiu do ciano (feixes do passado), por instante: para o laço de portais de frente um pro outro
    pub exit_hist: Vec<(f32, Vec<(Vec3, Vec3)>)>,
    /// o feixe do passado (só na vista do ciano)
    past_beams: Vec<(Entity, Entity)>,
    past_used: usize,
}

#[derive(Clone)]
struct Res {
    unit: Handle<Mesh>,
    plane: Handle<Mesh>,
    sprite: Handle<Mesh>,
    core: Handle<StandardMaterial>,
    glow: Handle<Fx>,
    spark: Handle<Fx>,
}

/// o que encerrou um feixe
#[derive(Default, Debug)]
pub struct Trace {
    pub segs: Vec<Seg>,
    pub point: Option<Vec3>,
    pub normal: Option<Vec3>,
    pub solid: Option<usize>,
    pub prop: Option<usize>,
    /// entrou num ciano temporal (o feixe vai para o passado): (ciano, direção)
    pub into_past: Option<(usize, Vec3)>,
    /// (feixe do passado) entrou no laranja temporal: (laranja, direção)
    pub temporal: Option<(usize, Vec3)>,
}

/// feixe que entrou num ciano temporal neste quadro (sai do laranja Δ s atrás)
#[derive(Clone, Debug)]
pub struct LaserEntry {
    pub blue: usize,
    pub delta: f32,
    pub at: Vec3,
    pub exit: Vec3,
    pub dir: Vec3,
}

/// cubo numa foto do passado (para o feixe do passado): centro, rotação, índice, refletor?
pub type PastCube = (Vec3, Quat, usize, bool);

/// raio contra a caixa girada de um cubo (meia aresta 0.3): distância de entrada
fn ray_cube(o: Vec3, d: Vec3, c: Vec3, q: Quat, max: f32) -> Option<f32> {
    let inv = q.inverse();
    let (lo, ld) = (inv * (o - c), inv * d);
    let h = 0.3;
    let (mut t0, mut t1) = (0.0f32, max);
    for a in 0..3 {
        if ld[a].abs() < 1e-8 {
            if lo[a].abs() > h {
                return None;
            }
            continue;
        }
        let (mut ta, mut tb) = ((-h - lo[a]) / ld[a], (h - lo[a]) / ld[a]);
        if ta > tb {
            std::mem::swap(&mut ta, &mut tb);
        }
        t0 = t0.max(ta);
        t1 = t1.min(tb);
        if t0 > t1 {
            return None;
        }
    }
    Some(t0)
}

/// ponto do segmento a–b mais perto de p
pub fn closest(a: Vec3, b: Vec3, p: Vec3) -> Vec3 {
    let ab = b - a;
    let l2 = ab.length_squared();
    let t = if l2 > 0.0 { ((p - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
    a + ab * t
}

/// Segue um feixe a partir de `o` na direção `d`: bate no cenário, num objeto ou entra num
/// portal ligado e continua do outro lado. `glass`: atravessa vidro (o laser; o funil não).
#[allow(clippy::too_many_arguments)]
pub fn trace(w: &GameWorld, portals: &Portals, props: Option<&Props>, o: Vec3, d: Vec3, ignore: Option<usize>, max_seg: usize, max_dist: f32, glass: bool) -> Trace {
    trace_t(w, portals, props, o, d, ignore, max_seg, max_dist, glass, None, None)
}

/// `trace` com o par temporal: `temporal` = o laranja que vale para este feixe (o feixe do passado);
/// `past` = os cubos como estavam (no lugar dos de agora)
#[allow(clippy::too_many_arguments)]
pub fn trace_t(w: &GameWorld, portals: &Portals, props: Option<&Props>, o: Vec3, d: Vec3, mut ignore: Option<usize>, max_seg: usize, max_dist: f32, glass: bool, temporal: Option<usize>, past: Option<&[PastCube]>) -> Trace {
    let mut out = Trace::default();
    let mut o = o;
    let mut d = d.normalize();
    for _ in 0..max_seg {
        let hit = w.raycast_f(o, d, max_dist, |i| !glass || w.solids[i].mat != "glass");
        let lim = hit.as_ref().map(|h| h.dist).unwrap_or(max_dist);
        let ph = match past {
            Some(cubes) => cubes.iter().filter(|c| Some(c.2) != ignore).filter_map(|c| ray_cube(o, d, c.0, c.1, lim).map(|t| (t, Ent::Dyn(c.2)))).min_by(|a, b| a.0.total_cmp(&b.0)),
            None => props.and_then(|pr| w.phys.cast_ray(o, d, lim, |e| matches!(e, Ent::Dyn(i) if Some(i) != ignore && pr.list.get(i).is_some_and(|p| !p.gone)))),
        };
        if let Some((dist, Ent::Dyn(i))) = ph {
            if hit.as_ref().is_none_or(|h| dist < h.dist) {
                let end = o + d * dist;
                out.segs.push((o, end, d));
                out.point = Some(end);
                out.prop = Some(i);
                return out;
            }
        }
        let Some(hit) = hit else {
            out.segs.push((o, o + d * max_dist, d));
            return out;
        };
        out.segs.push((o, hit.point, d));
        let in_mouth = |q: &crate::portals::Portal| {
            let l = q.local(hit.point);
            (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 1.0 && l.z.abs() < 0.05
        };
        // (o laranja do passado só vale para o feixe do passado, cada um no Δ dele)
        let through = portals.list.iter().enumerate().find(|(qi, q)| {
            if !portals.is_linked(*qi) || portals.list[q.partner].delta > 0.0 || q.solid != Some(hit.solid) {
                return false;
            }
            if q.delta > 0.0 && temporal != Some(*qi) {
                return false;
            }
            in_mouth(q)
        });
        if let Some((p, q)) = through {
            if q.delta > 0.0 {
                out.point = Some(hit.point);
                out.temporal = Some((p, d));
                return out;
            }
        }
        if through.is_none() {
            // ciano temporal (o par com o laranja no passado): o feixe vai para o passado
            let tb = portals.list.iter().enumerate().find(|(qi, q)| portals.is_linked(*qi) && q.delta == 0.0 && portals.list[q.partner].delta > 0.0 && q.solid == Some(hit.solid) && in_mouth(q));
            if let Some((b, _)) = tb {
                out.point = Some(hit.point);
                out.into_past = Some((b, d));
                return out;
            }
        }
        let Some((p, _)) = through else {
            out.point = Some(hit.point);
            out.normal = Some(hit.normal);
            out.solid = Some(hit.solid);
            return out;
        };
        let mut pos = hit.point;
        let mut vel = d;
        portals.carry(p, &mut pos, &mut vel);
        d = vel.normalize();
        o = pos + d * 0.03;
        ignore = None;
    }
    out
}

/// velocidade que o funil impõe em `p` (e o eixo do trecho), ou None fora de qualquer funil
pub fn flow_at(funnels: &[(Vec<Seg>, f32, bool)], p: Vec3) -> Option<(Vec3, Vec3)> {
    let mut best: Option<(Vec3, f32, bool, Vec3)> = None;
    let mut best_r = FUNNEL_R;
    for (segs, speed, rev) in funnels {
        for &(a, b, d) in segs {
            let len = (b - a).length();
            let v = p - a;
            let t = v.dot(d);
            if t < -0.3 || t > len + 0.3 {
                continue;
            }
            let radial = v - d * t;
            let r = radial.length();
            if r > best_r {
                continue;
            }
            best_r = r;
            best = Some((d, *speed, *rev, radial));
        }
    }
    best.map(|(d, sp, rev, radial)| (d * sp * if rev { -1.0 } else { 1.0 } - radial * 2.2, d))
}

impl Frontier {
    pub fn reset(&mut self) {
        // (as malhas são filhas da raiz do mundo, apagada junto)
        *self = Frontier { res: self.res.clone(), ..default() };
        self.beams.clear();
    }

    fn res(&mut self, ecs: &mut Ecs) -> Res {
        if self.res.is_none() {
            let unit = mesh_h(ecs, &cylinder_geo(1.0, 1.0, 1.0, 16, 1, true).translate(0.0, 0.5, 0.0));
            let plane = mesh_h(ecs, &plane_geo(1.0, 1.0).translate(0.0, 0.5, 0.0));
            let sprite = mesh_h(ecs, &plane_geo(1.0, 1.0));
            let core = bas(ecs, LinearRgba::rgb(3.2, 0.22, 0.12));
            let glow = fx_mat(ecs, Fx::new(kind::LASER_GLOW));
            let spark = fx_mat(ecs, Fx::new(kind::SPRITE).color(LinearRgba::new(1.0, 0.45, 0.2, 1.0)));
            self.res = Some(Res { unit, plane, sprite, core, glow, spark });
        }
        self.res.clone().unwrap()
    }

    /// pontos do mundo que as peças desta fase usam (a raiz do mundo muda a cada fase)
    fn draw_beam(&mut self, ecs: &mut Ecs, root: Entity, a: Vec3, b: Vec3) {
        let r = self.res(ecs);
        if self.used >= self.beams.len() {
            let core = put_mesh(ecs, root, r.unit.clone(), &r.core, Transform::default());
            let glow = put_mesh(ecs, root, r.unit.clone(), r.glow.clone(), Transform::default());
            for e in [core, glow] {
                ecs.entity_mut(e).insert(bevy::camera::visibility::NoFrustumCulling);
            }
            self.beams.push((core, glow));
        }
        let (core, glow) = self.beams[self.used];
        self.used += 1;
        let d = b - a;
        let len = d.length();
        if len < 1e-4 {
            return;
        }
        let q = Quat::from_rotation_arc(Vec3::Y, d / len);
        for (e, rad) in [(core, 0.022), (glow, 0.11)] {
            ecs.entity_mut(e).insert((Transform { translation: a, rotation: q, scale: Vec3::new(rad, len, rad) }, Visibility::Visible));
        }
    }

    /// os trechos do feixe do passado (na camada do passado: só a câmera do ciano temporal os vê)
    pub fn draw_past_beams(&mut self, ecs: &mut Ecs, root: Entity, segs: &[(Vec3, Vec3)]) {
        let r = self.res(ecs);
        let layer = bevy::camera::visibility::RenderLayers::layer(crate::relogio::PAST_LAYER);
        self.past_used = 0;
        for &(a, b) in segs {
            if self.past_used >= self.past_beams.len() {
                let core = put_mesh(ecs, root, r.unit.clone(), &r.core, Transform::default());
                let glow = put_mesh(ecs, root, r.unit.clone(), r.glow.clone(), Transform::default());
                for e in [core, glow] {
                    ecs.entity_mut(e).insert((bevy::camera::visibility::NoFrustumCulling, layer.clone()));
                }
                self.past_beams.push((core, glow));
            }
            let (core, glow) = self.past_beams[self.past_used];
            self.past_used += 1;
            let d = b - a;
            let len = d.length().max(1e-4);
            let q = Quat::from_rotation_arc(Vec3::Y, d / len);
            for (e, rad) in [(core, 0.022), (glow, 0.11)] {
                ecs.entity_mut(e).insert((Transform { translation: a, rotation: q, scale: Vec3::new(rad, len, rad) }, Visibility::Visible));
            }
        }
        for i in self.past_used..self.past_beams.len() {
            let (a, b) = self.past_beams[i];
            ecs.entity_mut(a).insert(Visibility::Hidden);
            ecs.entity_mut(b).insert(Visibility::Hidden);
        }
    }

    /// as malhas dos feixes de agora (o relógio as põe na camada do presente)
    pub fn beam_entities(&self) -> Vec<Entity> {
        self.beams.iter().flat_map(|b| [b.0, b.1]).chain(self.sparks.iter().copied()).collect()
    }

    fn spark(&mut self, ecs: &mut Ecs, root: Entity, p: Vec3, t: f32) {
        let r = self.res(ecs);
        if self.used_sparks >= self.sparks.len() {
            let e = put_mesh(ecs, root, r.sprite.clone(), r.spark.clone(), Transform::default());
            self.sparks.push(e);
        }
        let e = self.sparks[self.used_sparks];
        self.used_sparks += 1;
        let s = 0.35 + (t * 50.0 + p.x * 9.0).sin() * 0.08 + rand::random::<f32>() * 0.1;
        ecs.entity_mut(e).insert((Transform::from_translation(p).with_scale(Vec3::splat(s)), Visibility::Visible));
    }

    fn bridge_mesh(&mut self, ecs: &mut Ecs, root: Entity) -> usize {
        let r = self.res(ecs);
        let mut m = Fx::new(kind::BRIDGE).blend();
        m.depth_write = false;
        let mat = fx_mat(ecs, m);
        let panel = put_mesh(ecs, root, r.plane.clone(), mat.clone(), Transform::default());
        ecs.entity_mut(panel).insert(bevy::camera::visibility::NoFrustumCulling);
        // as bordas de luz, filhas do painel: as duas ao longo e a da ponta
        let mut corners = vec![];
        for (i, (p, rz)) in [(Vec3::new(-0.5, 0.0, 0.0), 0.0), (Vec3::new(0.5, 0.0, 0.0), 0.0), (Vec3::new(-0.5, 1.0, 0.0), -std::f32::consts::FRAC_PI_2)].into_iter().enumerate() {
            let along = i < 2;
            let mut cm = Fx::new(kind::BRIDGE_CORNER).single();
            cm.u.p0.w = if along { 1.0 } else { 0.0 };
            let cmat = fx_mat(ecs, cm);
            let g = ecs.spawn((Transform::from_translation(p).with_rotation(Quat::from_rotation_z(rz)), Visibility::default(), ChildOf(panel))).id();
            let c = put_mesh(ecs, g, r.unit.clone(), cmat.clone(), Transform::default());
            ecs.entity_mut(c).insert(bevy::camera::visibility::NoFrustumCulling);
            corners.push((g, cmat, along));
        }
        self.bridges.push(BridgeMesh { panel, mat, corners });
        self.bridges.len() - 1
    }

    /// a base do trecho: largura deitada (anda-se por cima); subindo/descendo vira uma parede
    fn bridge_basis(d: Vec3) -> (Vec3, Vec3) {
        let n = if d.y.abs() < 0.7 { (Vec3::Y - d * d.y).normalize() } else { (Vec3::X - d * d.x).normalize() };
        let side = d.cross(n).normalize();
        (n, side)
    }

    fn pose_bridge(&mut self, ecs: &mut Ecs, i: usize, portals: &Portals, (a, b, d, look): (Vec3, Vec3, Vec3, &str)) {
        let len = a.distance(b);
        let (n, side) = Self::bridge_basis(d);
        let q = Quat::from_mat3(&Mat3::from_cols(side, d, n));
        let bm = &self.bridges[i];
        ecs.entity_mut(bm.panel).insert((Transform { translation: a, rotation: q, scale: Vec3::new(BRIDGE_W, len.max(1e-4), 1.0) }, Visibility::Visible));
        let at_portal = |p: Vec3| portals.list.iter().any(|pp| pp.placed && (p - pp.center).dot(pp.normal).abs() < 0.15 && (p - pp.center).length() < 1.8);
        let capped = !at_portal(b);
        let wall = capped && len < 399.0;
        let fa = if at_portal(a) { 0.0 } else { 0.25 };
        let fb = if wall { 0.45 } else { 0.0 };
        let c = bridge_tint(look);
        let k = 0.75 / c.max_element();
        let gc = c * k * 1.7;
        let l = len.max(1e-4);
        let mats: Vec<(Handle<Fx>, bool)> = bm.corners.iter().map(|c| (c.1.clone(), c.2)).collect();
        let groups: Vec<(Entity, bool)> = bm.corners.iter().map(|c| (c.0, c.2)).collect();
        {
            let mut fx = ecs.resource_mut::<Assets<Fx>>();
            if let Some(mut m) = fx.get_mut(&bm.mat) {
                m.u.p0 = Vec4::new(len, look_index(look), fa, fb);
            }
            for (h, along) in &mats {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.p0 = Vec4::new(len, fa, fb, if *along { 1.0 } else { 0.0 });
                    m.u.color = gc.extend(1.0);
                }
            }
        }
        // as bordas: o raio em metros, descontando a escala (largura, comprimento, 1) do painel;
        // a da ponta só aparece com a ponte acabando no ar
        for (g, along) in groups {
            let vis = along || (capped && !wall);
            let scale = if along { Vec3::new(CORNER_R / BRIDGE_W, 1.0, CORNER_R) } else { Vec3::new(CORNER_R / l, 1.0, CORNER_R) };
            if let Some(mut tr) = ecs.get_mut::<Transform>(g) {
                // (a peça é o filho do grupo)
                let _ = &mut tr;
            }
            if let Some(ch) = ecs.get::<Children>(g).map(|c| c.to_vec()) {
                for c in ch {
                    if let Some(mut tr) = ecs.get_mut::<Transform>(c) {
                        tr.scale = scale;
                    }
                }
            }
            ecs.entity_mut(g).insert(if vis { Visibility::Inherited } else { Visibility::Hidden });
        }
    }

    /// desenha os trechos e põe um sólido fino em cada um (o jogador e os cubos andam por cima)
    fn update_bridges(&mut self, ecs: &mut Ecs, w: &mut GameWorld, portals: &Portals, segs: &[(Vec3, Vec3, Vec3, String)]) {
        let root = w.root();
        for (i, (a, b, d, look)) in segs.iter().enumerate() {
            if i >= self.bridges.len() {
                self.bridge_mesh(ecs, root);
            }
            self.pose_bridge(ecs, i, portals, (*a, *b, *d, look));
            let (n, side) = Self::bridge_basis(*d);
            let mut min = Vec3::splat(f32::INFINITY);
            let mut max = Vec3::splat(f32::NEG_INFINITY);
            for p in [*a, *b] {
                for sx in [-1.0, 1.0] {
                    for sn in [-1.0, 1.0] {
                        let c = p + side * (sx * BRIDGE_W / 2.0) + n * (sn * BRIDGE_T / 2.0 - BRIDGE_T / 2.0);
                        min = min.min(c);
                        max = max.max(c);
                    }
                }
            }
            let mut bi = self.bridge_boxes.get(i).copied();
            if let Some(k) = bi {
                let bx = &w.solids[k];
                let same = ((bx.max - bx.min) - (max - min)).abs().max_element() < 1e-3;
                if !same {
                    drop_box(w, k);
                    bi = None;
                }
            }
            match bi {
                None => {
                    let k = w.add_box(ecs, min.x, min.y, min.z, max.x, max.y, max.z, "metal", true, false, true);
                    if let Some(e) = w.solids[k].entity {
                        ecs.entity_mut(e).insert(Visibility::Hidden);
                    }
                    w.solids[k].no_ray = true; // tiros de portal, lasers e bolas atravessam a luz
                    w.solids[k].bridge = true;
                    if i < self.bridge_boxes.len() {
                        self.bridge_boxes[i] = k;
                    } else {
                        self.bridge_boxes.push(k);
                    }
                }
                Some(k) => {
                    if w.solids[k].min != min || w.solids[k].max != max {
                        w.solids[k].min = min;
                        w.solids[k].max = max;
                        place_box(w, k);
                    }
                }
            }
        }
        for i in segs.len()..self.bridge_boxes.len() {
            let k = self.bridge_boxes[i];
            if w.solids[k].min.y > -4000.0 {
                w.solids[k].min = Vec3::new(0.0, -5001.0, 0.0);
                w.solids[k].max = Vec3::new(0.1, -5000.0, 0.1);
                place_box(w, k);
            }
        }
        for i in segs.len()..self.bridges.len() {
            ecs.entity_mut(self.bridges[i].panel).insert(Visibility::Hidden);
        }
    }
}

/// leva o colisor (fixo) de um sólido de ponte para onde a caixa está agora
fn place_box(w: &mut GameWorld, k: usize) {
    let b = &w.solids[k];
    if let Some(c) = b.collider {
        let center = (b.min + b.max) * 0.5;
        w.phys.place_collider(c, center);
        w.phys.wake_all();
    }
}

/// tira um sólido de ponte do mundo e da física (o índice continua, marcado como removido)
fn drop_box(w: &mut GameWorld, k: usize) {
    if let Some(c) = w.solids[k].collider.take() {
        w.phys.remove_collider(c);
        w.phys.wake_all();
    }
    w.solids[k].removed = true;
    w.solids[k].solid = false;
}

impl Game {
    /// o quadro da série Fronteira (frontier.update)
    pub fn frontier_update(&mut self, ecs: &mut Ecs, dt: f32, t: f32) {
        let root = self.world.root();
        let fr = &mut self.frontier;
        fr.used = 0;
        fr.used_sparks = 0;
        let r = fr.res(ecs);
        // ---- funis: refaz o caminho de cada um
        fr.funnel_segs.resize(self.world.funnels.len(), vec![]);
        fr.funnel_meshes.resize(self.world.funnels.len(), vec![]);
        for fi in 0..self.world.funnels.len() {
            let f = &self.world.funnels[fi];
            let segs = if f.off { vec![] } else { trace(&self.world, &self.portals, None, f.pos, f.dir, None, 6, 400.0, false).segs };
            let color = if f.reversed { Vec3::new(2.4, 0.9, 0.2) } else { Vec3::new(0.3, 1.0, 2.4) };
            let sign = if f.reversed { -1.0 } else { 1.0 };
            if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&f.ring) {
                let c = color * 1.2;
                m.base_color = Color::linear_rgb(c.x, c.y, c.z);
            }
            for (i, &(a, b, d)) in segs.iter().enumerate() {
                if i >= fr.funnel_meshes[fi].len() {
                    let mat = fx_mat(ecs, Fx::new(kind::FUNNEL));
                    let e = put_mesh(ecs, root, r.unit.clone(), mat.clone(), Transform::default());
                    ecs.entity_mut(e).insert(bevy::camera::visibility::NoFrustumCulling);
                    fr.funnel_meshes[fi].push((e, mat));
                }
                let (e, mat) = fr.funnel_meshes[fi][i].clone();
                if let Some(mut m) = ecs.resource_mut::<Assets<Fx>>().get_mut(&mat) {
                    m.u.color = color.extend(1.0);
                    m.u.p0.x = sign;
                }
                let q = Quat::from_rotation_arc(Vec3::Y, d);
                ecs.entity_mut(e).insert((Transform { translation: a, rotation: q, scale: Vec3::new(FUNNEL_R, a.distance(b), FUNNEL_R) }, Visibility::Visible));
            }
            for i in segs.len()..fr.funnel_meshes[fi].len() {
                ecs.entity_mut(fr.funnel_meshes[fi][i].0).insert(Visibility::Hidden);
            }
            fr.funnel_segs[fi] = segs;
        }
        let flows = self.flows();
        let flow = flow_at(&flows, self.player.pos);
        let fr = &mut self.frontier;
        // perto de um funil: zumbido mais baixo
        fr.funnel_near = if flow.is_some() { 1.0 } else { 0.0 };
        if flow.is_none() {
            for segs in &fr.funnel_segs {
                for &(a, b, _) in segs {
                    let c = closest(a, b, self.player.pos);
                    fr.funnel_near = fr.funnel_near.max(1.0 - ((c.distance(self.player.pos) - FUNNEL_R) / 8.0).clamp(0.0, 1.0));
                }
            }
        }
        if flow.is_some() != fr.in_funnel {
            self.events.push(GameEvent::FunnelIn);
        }
        fr.in_funnel = flow.is_some();
        if let Some((_, axis)) = flow {
            fr.axis = axis;
        }

        // ---- placas de lançamento
        for pi in 0..self.world.plates.len() {
            let p = &mut self.world.plates[pi];
            p.cool -= dt;
            if p.cool > 0.0 {
                continue;
            }
            let top = p.pos.y + 0.2;
            let pl = &mut self.player;
            let feet = pl.pos.y - pl.half.y;
            if (pl.pos.x - p.pos.x).abs() < 1.05 && (pl.pos.z - p.pos.z).abs() < 1.05 && feet > top - 0.25 && feet < top + 0.45 && pl.vel.y <= 0.5 {
                pl.vel = p.vel;
                pl.pos.y = pl.pos.y.max(top + pl.half.y + 0.05);
                pl.grounded = false;
                p.kick = 1.0;
                p.cool = 0.9;
                self.events.push(GameEvent::Plate);
                continue;
            }
            let (ppos, pvel) = (p.pos, p.vel);
            for c in &mut self.props.list {
                if c.held || c.gone {
                    continue;
                }
                if (c.pos.x - ppos.x).abs() < 1.05 && (c.pos.z - ppos.z).abs() < 1.05 && c.pos.y - top > -0.1 && c.pos.y - top < 0.9 {
                    if let Some(b) = self.world.phys.body_mut(c.body) {
                        b.set_linvel(pvel, true);
                        b.set_translation(Vec3::new(c.pos.x, c.pos.y.max(top + 0.35), c.pos.z), true);
                    }
                    let p = &mut self.world.plates[pi];
                    p.kick = 1.0;
                    p.cool = 0.9;
                    self.events.push(GameEvent::Plate);
                    break;
                }
            }
        }

        // ---- lasers e pontes
        for c in &mut self.world.laser_catchers {
            c.was_active = c.active;
            c.active = false;
        }
        for c in &mut self.props.list {
            c.lit = false;
        }
        let mut burn = false;
        self.frontier.nearest_beam = f32::INFINITY;
        let mut bridge_segs: Vec<(Vec3, Vec3, Vec3, String)> = vec![];
        // os feixes de agora, os que saem do ciano vindos do laranja do passado e os que saem do
        // laranja de uma versão passada sua (laser que você mandou para o passado)
        // (o último: a emissão na linha do tempo, se o feixe vem do vermelho de uma versão passada)
        let mut lasers: Vec<(Vec3, Vec3, Option<String>, Option<usize>)> = self.world.lasers.iter().filter(|l| !l.off).map(|l| (l.pos, l.dir, l.bridge.clone(), None)).collect();
        self.frontier.prev_entries = std::mem::take(&mut self.frontier.live_entries);
        let from_blue = self.ch_laser_past(ecs);
        lasers.extend(from_blue.into_iter().map(|(o, d)| (o, d, None, None)));
        lasers.extend(self.ch_laser_emissions().into_iter().map(|(e, o, d)| (o, d, None, Some(e))));
        self.frontier.lit_present.clear();
        for (pos, dir, bridge, emission) in lasers {
            let from_past = emission.is_some();
            if let Some(look) = bridge {
                let res = trace(&self.world, &self.portals, None, pos, dir, None, 8, 400.0, false);
                for (a, b, d) in res.segs {
                    bridge_segs.push((a, b, d, look.clone()));
                }
                continue;
            }
            let (mut o, mut d) = (pos, dir);
            let mut ignore = None;
            for _hop in 0..6 {
                let res = trace(&self.world, &self.portals, Some(&self.props), o, d, ignore, 8, 400.0, true);
                if from_past {
                    for &(a, b, _) in &res.segs {
                        self.ch_laser_hits_past_self(a, b);
                    }
                }
                if let (Some((bi, dir)), Some(at)) = (res.into_past, res.point) {
                    // entrou no ciano temporal: some aqui e sai do laranja Δ s atrás (gravado no relógio)
                    let (mut pos, mut vel) = (at, dir);
                    self.portals.carry(bi, &mut pos, &mut vel);
                    let vel = vel.normalize();
                    let delta = self.portals.list[self.portals.list[bi].partner].delta;
                    self.frontier.live_entries.push(LaserEntry { blue: bi, delta, at, exit: pos + vel * 0.03, dir: vel });
                    for &(a, b, _) in &res.segs {
                        self.frontier.draw_beam(ecs, root, a, b);
                    }
                    break;
                }
                for &(a, b, _) in &res.segs {
                    self.frontier.draw_beam(ecs, root, a, b);
                    // o jogador encostou no feixe?
                    let pl = &mut self.player;
                    let c = closest(a, b, pl.pos);
                    self.frontier.nearest_beam = self.frontier.nearest_beam.min(c.distance(pl.pos));
                    let dy = (c.y - pl.pos.y).abs();
                    if (c.x - pl.pos.x).hypot(c.z - pl.pos.z) < 0.42 && dy < pl.half.y + 0.05 {
                        burn = true;
                        let mut push = pl.pos - c;
                        push.y = 0.0;
                        if push.length_squared() < 1e-6 {
                            push = Vec3::new(-d.z, 0.0, d.x);
                        }
                        // queima 70 por segundo e empurra para fora do feixe
                        self.health -= 70.0 * dt;
                        self.hurt_t = 0.0;
                        self.hurt_flash = (self.hurt_flash + dt * 3.0).min(1.0);
                        pl.vel += push.normalize() * 25.0 * dt;
                    }
                }
                // torretas no caminho do feixe (o corpo é mais alto que o colisor das pernas)
                for k in 0..self.props.list.len() {
                    let tu = &self.props.list[k];
                    if tu.kind != Kind::Turret || tu.gone || !tu.turret.as_ref().is_some_and(|x| x.active) {
                        continue;
                    }
                    let tp = tu.pos;
                    if res.segs.iter().any(|&(a, b, _)| {
                        let c = closest(a, b, tp);
                        (c.x - tp.x).hypot(c.z - tp.z) < 0.35 && (c.y - tp.y).abs() < 0.7
                    }) {
                        self.kill_turret(k);
                    }
                }
                let Some(point) = res.point else { break };
                self.frontier.spark(ecs, root, point, t);
                let mut lit = vec![];
                for (ci, c) in self.world.laser_catchers.iter_mut().enumerate() {
                    if c.pos.distance(point) < 0.75 {
                        c.active = true;
                        lit.push(ci);
                    }
                }
                // quem ligou o receptor: um feixe do passado (consequência dele) ou um de agora
                for ci in lit {
                    match emission {
                        Some(e) => self.ch_laser_lit(e, ci),
                        None => {
                            self.frontier.lit_present.insert(ci);
                        }
                    }
                }
                let Some(pi) = res.prop else { break };
                let p = &mut self.props.list[pi];
                if p.redirect {
                    // cubo refletor: sai pela lente da frente (segurado: vale a mira de quem segura)
                    p.lit = true;
                    let q = if p.held && p.hold_local.is_some() { p.hold_quat } else { p.quat };
                    let f = (q * Vec3::Z).normalize();
                    o = p.pos + f * 0.36;
                    d = f;
                    ignore = Some(pi);
                    continue;
                }
                if p.kind == Kind::Turret && p.turret.as_ref().is_some_and(|x| x.active) {
                    self.kill_turret(pi);
                }
                break;
            }
        }
        // o laço de cada laser mandado ao passado fechou?
        self.ch_check_laser_loops(dt);
        let portals = std::mem::take(&mut self.portals);
        self.frontier.update_bridges(ecs, &mut self.world, &portals, &bridge_segs);
        self.portals = portals;
        // receptores, lentes dos cubos e dos emissores
        for c in &self.world.laser_catchers {
            if c.active && !c.was_active {
                self.events.push(GameEvent::LaserOn);
            }
            let k = if c.active { 2.4 } else { 0.6 + (t * 3.0).sin() * 0.15 };
            if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&c.glow) {
                m.base_color = Color::linear_rgb(2.4 * k, 0.4 * k, 0.25 * k);
            }
            if let Some(mut tr) = ecs.get_mut::<Transform>(c.spin) {
                tr.rotate_local_y(dt * if c.active { 7.0 } else { 0.6 });
            }
        }
        for c in &self.props.list {
            if let Some(lens) = &c.lens {
                if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(lens) {
                    m.base_color = if c.lit { Color::linear_rgb(4.0, 0.6, 0.4) } else { Color::linear_rgb(0.6, 0.08, 0.05) };
                }
            }
        }
        for l in &self.world.lasers {
            let c = if let Some(look) = &l.bridge {
                bridge_tint(look) * if l.off { 0.07 } else { 1.0 }
            } else if l.off {
                Vec3::new(0.25, 0.03, 0.02)
            } else {
                Vec3::new(3.0 + (t * 20.0).sin() * 0.4, 0.3, 0.2)
            };
            if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&l.lens) {
                m.base_color = Color::linear_rgb(c.x, c.y, c.z);
            }
        }
        let fr = &mut self.frontier;
        for i in fr.used..fr.beams.len() {
            let (a, b) = fr.beams[i];
            ecs.entity_mut(a).insert(Visibility::Hidden);
            ecs.entity_mut(b).insert(Visibility::Hidden);
        }
        for i in fr.used_sparks..fr.sparks.len() {
            ecs.entity_mut(fr.sparks[i]).insert(Visibility::Hidden);
        }
        fr.burn_t -= dt;
        if burn && fr.burn_t <= 0.0 {
            self.events.push(GameEvent::Sizzle);
            fr.burn_t = 0.15;
        }
        if self.health <= 0.0 {
            self.die("laser");
        }

        // ---- buracos negros: o horizonte engole tudo
        self.frontier.bh_loud = 0.0;
        for bi in 0..self.world.black_holes.len() {
            let b = self.world.black_holes[bi].clone();
            let r = b.pos.distance(self.player.pos);
            self.frontier.bh_loud = self.frontier.bh_loud.max(1.0 - ((r - b.horizon) / b.reach).clamp(0.0, 1.0));
            if b.pos.distance(self.player.pos) < b.horizon * 1.25 {
                self.die("engolido pelo buraco negro");
            }
            for k in 0..self.props.list.len() {
                let c = &self.props.list[k];
                if !c.gone && c.pos.distance(b.pos) < b.horizon * 1.3 {
                    self.lose_prop(k);
                }
            }
        }

        // ---- vácuo do portal para a Lua
        let link = self.portals.list.iter().position(|p| p.moon && p.placed && self.portals.list[p.partner].placed).map(|m| self.portals.list[m].partner);
        self.frontier.gale = 0.0;
        if let Some(q) = link {
            let qq = self.portals.list[q].clone();
            let pull = |pos: Vec3| -> Option<(Vec3, f32)> {
                let v = qq.center - pos;
                let r = v.length();
                if r > 18.0 || v.dot(qq.normal) > 0.5 {
                    return None;
                }
                Some((v / r, (6.0 + 1500.0 / (r * r).max(2.0)).min(40.0)))
            };
            if pull(self.player.pos).is_some() {
                self.frontier.gale = 1.0 - (qq.center - self.player.pos).length() / 18.0;
            }
            if let Some((dir, a)) = pull(self.player.pos) {
                // o vácuo arranca do chão (senão o atrito dos pés segura) e puxa para a boca
                if self.player.grounded {
                    self.player.vel.y = self.player.vel.y.max(1.6);
                }
                self.player.vel += dir * a * dt;
            }
            for c in &self.props.list {
                if c.held || c.gone {
                    continue;
                }
                if let Some((dir, a)) = pull(c.pos) {
                    if let Some(b) = self.world.phys.body_mut(c.body) {
                        let v = b.linvel() + dir * a * dt;
                        b.set_linvel(v, true);
                    }
                }
            }
        }
    }

    /// os funis (trechos, velocidade, invertido) para a gravidade e o fluxo
    pub fn flows(&self) -> Vec<(Vec<Seg>, f32, bool)> {
        self.world.funnels.iter().enumerate().map(|(i, f)| (self.frontier.funnel_segs.get(i).cloned().unwrap_or_default(), f.speed, f.reversed)).collect()
    }

    /// torreta atingida pelo laser: desliga e queima depois de um instante
    pub fn kill_turret(&mut self, k: usize) {
        let p = &mut self.props.list[k];
        p.disable(&mut self.world.phys, "laser", 3.0);
        if let Some(t) = p.turret.as_mut() {
            t.burn_t.get_or_insert(1.4);
        }
    }

    /// objeto perdido (buraco negro): o cubo volta ao dispensador, a torreta some
    pub fn lose_prop(&mut self, k: usize) {
        if self.held == Some(k) {
            self.release(false);
        }
        self.dissolve(k, crate::dissolver::FIZZLE, false);
        let c = &mut self.props.list[k];
        if c.kind == Kind::Cube {
            c.respawn(&mut self.world.phys);
        } else {
            c.vanish(&mut self.world.phys);
        }
        self.events.push(GameEvent::Fizzle);
    }
}
