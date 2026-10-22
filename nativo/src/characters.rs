//! Personagens (mine.js: makeWorker/poseWorker; dinos.js: makeDino/poseDino/orbit): a equipe nas
//! cabines de observação (fala com a boca e os braços enquanto a narração toca, vira a cabeça para
//! o jogador), o raptor-mascote de cada cabine, os dinossauros das fases (andando em elipse,
//! pastando, voando, o T-rex do mapa livre que ruge e empurra) e o corpo do próprio jogador — um
//! raptor de capacete que só aparece nas vistas pelos portais.

use crate::game::Game;
use bevy::camera::visibility::RenderLayers;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use std::collections::HashMap;
use std::f32::consts::{PI, TAU};

/// a camada do corpo do jogador: as câmeras dos portais veem; a principal, não
pub const BODY_LAYER: usize = 4;

fn damp(a: f32, b: f32, k: f32, dt: f32) -> f32 {
    a + (b - a) * (1.0 - (-k * dt).exp())
}

/// ruído suave 2D (o noise2 de noise.js: valor com interpolação)
fn noise2(x: f32, y: f32) -> f32 {
    let h = |i: f32, j: f32| ((i * 127.1 + j * 311.7).sin() * 43758.547).fract().abs();
    let (ix, iy) = (x.floor(), y.floor());
    let (fx, fy) = (x - ix, y - iy);
    let (ux, uy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let a = h(ix, iy) + (h(ix + 1.0, iy) - h(ix, iy)) * ux;
    let b = h(ix, iy + 1.0) + (h(ix + 1.0, iy + 1.0) - h(ix, iy + 1.0)) * ux;
    a + (b - a) * uy
}

/// esqueleto de um modelo: as peças com nome, os ângulos (Euler XYZ) e a posição de base
pub struct Rig {
    pub parts: HashMap<String, Entity>,
    euler: HashMap<Entity, Vec3>,
    pos: HashMap<Entity, Vec3>,
    scale: HashMap<Entity, Vec3>,
}

impl Rig {
    fn new(ecs: &Ecs, parts: HashMap<String, Entity>) -> Self {
        let mut euler = HashMap::new();
        let mut pos = HashMap::new();
        let mut scale = HashMap::new();
        for &e in parts.values() {
            if let Some(t) = ecs.get::<Transform>(e) {
                let (x, y, z) = t.rotation.to_euler(EulerRot::XYZ);
                euler.insert(e, Vec3::new(x, y, z));
                pos.insert(e, t.translation);
                scale.insert(e, t.scale);
            }
        }
        Rig { parts, euler, pos, scale }
    }
    fn e(&self, name: &str) -> Option<Entity> {
        self.parts.get(name).copied()
    }
    fn rot(&self, name: &str) -> Vec3 {
        self.e(name).and_then(|e| self.euler.get(&e).copied()).unwrap_or_default()
    }
    fn set_rot(&mut self, name: &str, r: Vec3) {
        if let Some(e) = self.e(name) {
            self.euler.insert(e, r);
        }
    }
    fn base_pos(&self, name: &str) -> Vec3 {
        self.e(name).and_then(|e| self.pos.get(&e).copied()).unwrap_or_default()
    }
    fn set_pos(&mut self, name: &str, p: Vec3) {
        if let Some(e) = self.e(name) {
            self.pos.insert(e, p);
        }
    }
    fn set_scale(&mut self, name: &str, s: Vec3) {
        if let Some(e) = self.e(name) {
            self.scale.insert(e, s);
        }
    }
    fn base_scale(&self, name: &str) -> Vec3 {
        self.e(name).and_then(|e| self.scale.get(&e).copied()).unwrap_or(Vec3::ONE)
    }
    /// escreve tudo nas transformações
    fn apply(&self, ecs: &mut Ecs) {
        for (&e, r) in &self.euler {
            if let Some(mut t) = ecs.get_mut::<Transform>(e) {
                t.rotation = Quat::from_euler(EulerRot::XYZ, r.x, r.y, r.z);
                t.translation = self.pos[&e];
                t.scale = self.scale[&e];
            }
        }
    }
}

fn spawn_rig(ecs: &mut Ecs, model: &str, parent: Entity) -> (Entity, Rig, serde_json::Value) {
    let (root, parts) = crate::glb::spawn_model(ecs, model);
    ecs.entity_mut(root).insert(ChildOf(parent));
    crate::glb::attach_sprites(ecs, model, &parts);
    let extras = crate::glb::model_extras(ecs, model);
    let rig = Rig::new(ecs, parts);
    (root, rig, extras)
}

// ------------------------------------------------------------------ pessoas
pub struct Worker {
    pub who: String,
    pub root: Entity,
    rig: Rig,
    pose: String,
    phase: f32,
    pub talking: bool,
}

const SPEAKERS: [(&str, &str); 8] = [("Helena", "helena"), ("Luciana", "luciana"), ("Kelly", "kelly"), ("Bigode", "bigode"), ("Seu Tião", "tiao"), ("Rodrigo", "rodrigo"), ("Marquinho", "marquinho"), ("Dona Cida", "cida")];

impl Worker {
    fn pose(&mut self, ecs: &mut Ecs, t: f32, dt: f32, look_at: Option<Vec3>) {
        let tt = t + self.phase;
        let r = &mut self.rig;
        let pre = |i: usize, s: &str| format!("worker_arms_{i}_{s}");
        let breathe = (tt * 1.6).sin() * 0.012;
        let ts = r.base_scale("worker_torso");
        r.set_scale("worker_torso", Vec3::new(ts.x, 1.0 + breathe, ts.z));
        let set = |r: &mut Rig, i: usize, sx: f32, sz: f32, ex: f32| {
            r.set_rot(&pre(i, "sh"), Vec3::new(sx, 0.0, sz));
            r.set_rot(&pre(i, "el"), Vec3::new(ex, 0.0, 0.0));
        };
        set(r, 0, 0.05, -0.12, -0.15);
        set(r, 1, 0.05, 0.12, -0.15);
        r.set_rot("worker_torso", Vec3::ZERO);
        for i in 0..2 {
            r.set_rot(&format!("worker_legs_{i}_hip"), Vec3::ZERO);
            r.set_rot(&format!("worker_legs_{i}_knee"), Vec3::ZERO);
        }
        let talk = self.talking;
        let amp = if talk { 1.0 } else { 0.25 };
        match self.pose.as_str() {
            "gesture" => {
                set(r, 0, -0.45 + (tt * 2.1).sin() * 0.25 * amp, -0.25, -1.3 + (tt * 2.7).sin() * 0.35 * amp);
                set(r, 1, -0.5 + (tt * 1.7 + 1.0).sin() * 0.3 * amp, 0.3, -1.2 + (tt * 2.3).sin() * 0.4 * amp);
            }
            "handsHips" => {
                set(r, 0, 0.15, -0.65, -1.9);
                set(r, 1, 0.15, 0.65, -1.9);
                r.set_rot(&pre(0, "el"), Vec3::new(-0.3, 0.0, 1.5));
                r.set_rot(&pre(1, "el"), Vec3::new(-0.3, 0.0, -1.5));
                if talk {
                    set(r, 1, -0.4 + (tt * 2.0).sin() * 0.25, 0.25, -1.1 + (tt * 2.6).sin() * 0.3);
                }
            }
            "pointing" => {
                set(r, 1, -1.25 + (tt * 0.7).sin() * 0.08, 0.15, -0.1);
                if talk {
                    set(r, 0, -0.45 + (tt * 2.2).sin() * 0.2, -0.25, -1.2 + (tt * 2.8).sin() * 0.3);
                }
            }
            "thermos" => {
                set(r, 1, -0.45, 0.2, -1.45);
                if talk {
                    set(r, 0, -0.4 + (tt * 2.0).sin() * 0.2, -0.3, -1.25 + (tt * 2.6).sin() * 0.3);
                }
            }
            "tablet" => {
                set(r, 0, -0.35, -0.1, -1.25);
                set(r, 1, -0.35, 0.1, -1.25);
                if talk {
                    set(r, 0, -0.5 + (tt * 2.0).sin() * 0.25, -0.3, -1.2 + (tt * 2.5).sin() * 0.35);
                }
            }
            "radio" => {
                set(r, 1, -0.75, -0.25, -2.05);
                if talk {
                    set(r, 0, -0.45 + (tt * 2.0).sin() * 0.25, -0.25, -1.2 + (tt * 2.6).sin() * 0.3);
                }
            }
            "hammer" => {
                set(r, 1, 0.05, 0.15, -0.35);
                if talk {
                    set(r, 0, -0.5 + (tt * 2.1).sin() * 0.25, -0.3, -1.25 + (tt * 2.7).sin() * 0.35);
                }
            }
            "pickaxe" => {
                let c = ((tt * 1.6).sin() + 1.0) / 2.0;
                let k = c.powf(0.6);
                set(r, 0, -0.4 - k * 2.2, -0.05, -0.4 - (1.0 - k) * 0.5);
                set(r, 1, -0.4 - k * 2.2, 0.05, -0.4 - (1.0 - k) * 0.5);
                r.set_rot("worker_torso", Vec3::new(0.35 * (1.0 - k), 0.0, 0.0));
            }
            "walk" => {
                let s = (tt * 5.0).sin();
                r.set_rot("worker_legs_0_hip", Vec3::new(s * 0.45, 0.0, 0.0));
                r.set_rot("worker_legs_1_hip", Vec3::new(-s * 0.45, 0.0, 0.0));
                r.set_rot("worker_legs_0_knee", Vec3::new((-s).max(0.0) * 0.6, 0.0, 0.0));
                r.set_rot("worker_legs_1_knee", Vec3::new(s.max(0.0) * 0.6, 0.0, 0.0));
                set(r, 0, -s * 0.35, -0.1, -0.25);
                set(r, 1, s * 0.35, 0.1, -0.25);
            }
            _ => {
                if talk {
                    set(r, 1, -0.45 + (tt * 2.0).sin() * 0.25, 0.25, -1.2 + (tt * 2.6).sin() * 0.35);
                }
            }
        }
        // boca e cabeça
        let ms = r.base_scale("worker_mouth");
        r.set_scale("worker_mouth", Vec3::new(ms.x, if talk { 1.0 + (noise2(tt * 9.0, 3.3) - 0.35).abs() * 9.0 } else { 1.0 }, ms.z));
        let hx = (tt * 0.7).sin() * 0.04 + if talk { (tt * 3.1).sin() * 0.05 } else { 0.0 };
        let mut yaw = (tt * 0.31).sin() * 0.15;
        if let Some(p) = look_at {
            if let Some(gt) = ecs.get::<GlobalTransform>(self.root) {
                let l = gt.affine().inverse().transform_point3(p);
                yaw = l.x.atan2(l.z).clamp(-0.7, 0.7);
            }
        }
        let r = &mut self.rig;
        let hr = r.rot("worker_head");
        r.set_rot("worker_head", Vec3::new(hx, damp(hr.y, yaw, 3.0, dt), 0.0));
        r.apply(ecs);
    }
}

// ------------------------------------------------------------------ dinossauros
#[derive(Clone, Default)]
pub struct Orbit {
    pub cx: f32,
    pub cz: f32,
    pub rx: f32,
    pub rz: f32,
    pub speed: Option<f32>,
    pub phase: f32,
    pub dir: f32,
    pub y: f32,
    pub bank: f32,
    pub bob: f32,
}

pub struct Dino {
    pub root: Entity,
    rig: Rig,
    x: serde_json::Value,
    pub pose: String,
    phase: f32,
    seed: f32,
    pub roar_t: f32,
    roar_dur: f32,
    pub speed: Option<f32>,
    pub orbit: Option<Orbit>,
    pub look: bool,
    pub rex: bool,
}

impl Dino {
    fn n(&self, k: &str) -> f32 {
        self.x.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
    }

    pub fn roar(&mut self, dur: f32) {
        self.roar_t = dur;
        self.roar_dur = dur;
    }

    fn orbit(&mut self, ecs: &mut Ecs, t: f32) {
        let Some(o) = self.orbit.clone() else { return };
        let speed = o.speed.unwrap_or_else(|| { let w = self.n("walkSpeed"); if w > 0.0 { w } else { 2.0 } });
        let rm = (o.rx + o.rz) / 2.0;
        let a = o.phase + o.dir * t * speed / rm;
        let (x, z) = (o.cx + a.cos() * o.rx, o.cz + a.sin() * o.rz);
        let (vx, vz) = (-a.sin() * o.rx * o.dir, a.cos() * o.rz * o.dir);
        let y = o.y + if o.bob != 0.0 { (t * 0.7 + o.phase).sin() * o.bob } else { 0.0 };
        if let Some(mut tr) = ecs.get_mut::<Transform>(self.root) {
            tr.translation = Vec3::new(x, y, z);
            tr.rotation = Quat::from_euler(EulerRot::XYZ, 0.0, vx.atan2(vz), if o.bank != 0.0 { o.dir * o.bank } else { 0.0 });
        }
        self.speed = Some(speed);
    }

    /// anima (sem olhar para nada em especial)
    pub fn animate(&mut self, ecs: &mut Ecs, t: f32, dt: f32) {
        self.pose_it(ecs, t, dt, None);
    }

    fn pose_it(&mut self, ecs: &mut Ecs, t: f32, dt: f32, look_at: Option<Vec3>) {
        let moving = self.pose == "walk" || self.pose == "run";
        let walk = { let w = self.n("walkSpeed"); if w > 0.0 { w } else { 1.0 } };
        let speed = self.speed.unwrap_or(walk * if self.pose == "run" { 2.4 } else { 1.0 });
        let cycle = { let c = self.n("cycle"); if c > 0.0 { c } else { 1.0 } };
        if moving {
            self.phase += dt * TAU * speed / cycle;
        }
        let (phase, seed) = (self.phase, self.seed);
        let species = self.x.get("species").and_then(|v| v.as_str()).unwrap_or("").to_string();
        // pernas: balanço da coxa + joelho dobrando na volta
        for i in 0..self.n("legs") as usize {
            let off = self.n(&format!("leg{i}_offset"));
            let amp0 = self.n(&format!("leg{i}_amp"));
            let (r1, r2) = (self.n(&format!("leg{i}_rest1")), self.n(&format!("leg{i}_rest2")));
            let ph = phase + off;
            let amp = if moving { amp0 * if self.pose == "run" { 1.25 } else { 1.0 } } else { 0.0 };
            let a1 = r1 + ph.sin() * amp;
            let a2 = r2 + ph.cos().max(0.0) * amp * 1.3;
            let (h, k, an) = (format!("dino_legs_{i}_hip"), format!("dino_legs_{i}_knee"), format!("dino_legs_{i}_ankle"));
            let r = &mut self.rig;
            let hx = damp(r.rot(&h).x, a1, 12.0, dt);
            let kx = damp(r.rot(&k).x, a2, 12.0, dt);
            let hr = r.rot(&h);
            r.set_rot(&h, Vec3::new(hx, hr.y, hr.z));
            let kr = r.rot(&k);
            r.set_rot(&k, Vec3::new(kx, kr.y, kr.z));
            let ar = r.rot(&an);
            r.set_rot(&an, Vec3::new(-(hx + kx) + if moving { ph.cos().max(0.0) * 0.3 } else { 0.0 }, ar.y, ar.z));
        }
        let (hip_h, bob) = (self.n("hipH"), self.n("bob"));
        if species != "ptero" {
            let r = &mut self.rig;
            let p = r.base_pos("dino_hips");
            r.set_pos("dino_hips", Vec3::new(p.x, hip_h + if moving { phase.cos().abs() * bob } else { (t * 1.3 + seed).sin() * bob * 0.25 }, p.z));
            let hr = r.rot("dino_hips");
            r.set_rot("dino_hips", Vec3::new(hr.x, hr.y, if moving { phase.sin() * 0.025 } else { 0.0 }));
        }
        // cauda (atrasada ao longo dos segmentos) e pescoço
        let stiff = { let s = self.n("tailStiff"); if s > 0.0 { s } else { 1.0 } };
        let tail_amp = if moving { 0.09 } else { 0.05 } * stiff;
        for i in 0..self.n("tail") as usize {
            let name = format!("dino_tail_{i}_p");
            let r = &mut self.rig;
            let cur = r.rot(&name);
            let y = if i == 0 { PI } else { 0.0 } + (t * 1.4 + phase * 0.5 + seed - i as f32 * 0.55).sin() * tail_amp;
            r.set_rot(&name, Vec3::new(cur.x, y, cur.z));
        }
        for i in 1..self.n("neck") as usize {
            let name = format!("dino_neck_{i}_p");
            let r = &mut self.rig;
            let cur = r.rot(&name);
            r.set_rot(&name, Vec3::new(cur.x, (t * 0.6 + seed - i as f32 * 0.4).sin() * 0.04, cur.z));
        }
        // braços
        for i in 0..self.n("arms") as usize {
            let side = self.n(&format!("arm{i}_side"));
            let name = format!("dino_arms_{i}_sh");
            let r = &mut self.rig;
            let cur = r.rot(&name);
            r.set_rot(&name, Vec3::new(-0.9 + (t * 2.0 + phase + side).sin() * if moving { 0.15 } else { 0.05 }, cur.y, cur.z));
        }
        // olhar
        let yaw = match look_at {
            Some(p) if self.rig.e("dino_neckBase").is_some() => ecs
                .get::<GlobalTransform>(self.root)
                .map(|g| {
                    let l = g.affine().inverse().transform_point3(p);
                    l.x.atan2(l.z).clamp(-0.8, 0.8)
                })
                .unwrap_or(0.0),
            _ => (t * 0.35 + seed).sin() * 0.25,
        };
        let mut neck_x = self.n("neckRest");
        if self.pose == "graze" {
            neck_x += (t * 0.35 + seed).sin().max(0.0) * if species == "titan" { 0.9 } else { 0.6 };
        }
        // rugido: cabeça para cima, bocarra aberta, tremendo
        let mut jaw = 0.0;
        let mut head_x = self.n("headRest");
        if self.roar_t > 0.0 {
            self.roar_t = (self.roar_t - dt).max(0.0);
            let u = 1.0 - self.roar_t / self.roar_dur;
            let k = (u * 5.0).min(1.0) * ((1.0 - u) * 3.0).min(1.0);
            jaw = k * (0.75 + (t * 40.0).sin() * 0.06);
            neck_x -= k * 0.35;
            head_x -= k * 0.35;
        } else {
            jaw = ((t * 0.5 + seed).sin() - 0.9).max(0.0) * 0.8;
        }
        let r = &mut self.rig;
        for (name, x, kx, ky) in [("dino_neckBase", neck_x, 4.0, 3.0), ("dino_head", head_x, 5.0, 3.0)] {
            if r.e(name).is_some() {
                let cur = r.rot(name);
                r.set_rot(name, Vec3::new(damp(cur.x, x, kx, dt), damp(cur.y, yaw * 0.5, ky, dt), cur.z));
            }
        }
        if r.e("dino_jaw").is_some() {
            let cur = r.rot("dino_jaw");
            r.set_rot("dino_jaw", Vec3::new(damp(cur.x, jaw, 14.0, dt), cur.y, cur.z));
        }
        // asas
        for i in 0..self.n("wings") as usize {
            let side = self.x.get(format!("wing{i}_side")).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let flap = if self.pose == "fly" { (t * 5.0 + seed).sin() * 0.55 } else { -1.1 };
            let name = format!("dino_wings_{i}_p");
            let r = &mut self.rig;
            let cur = r.rot(&name);
            r.set_rot(&name, Vec3::new(cur.x, cur.y, side * (0.1 + flap)));
        }
        if species == "ptero" && self.pose == "fly" {
            let r = &mut self.rig;
            let p = r.base_pos("dino_hips");
            r.set_pos("dino_hips", Vec3::new(p.x, -(t * 5.0 + seed).sin() * 0.12, p.z));
        }
        self.rig.apply(ecs);
    }
}

// ------------------------------------------------------------------ o elenco da fase
#[derive(Default)]
pub struct Cast {
    pub workers: Vec<Worker>,
    pub dinos: Vec<Dino>,
    pub body: Option<Dino>,
    rex_cooldown: f32,
    rex_warned: bool,
}

fn dino_model(s: &str, helmet: Option<u32>, vest: Option<u32>) -> String {
    let mut m = format!("dino_{s}");
    if let Some(h) = helmet {
        m += &format!("_h{h:06x}");
    }
    if let Some(v) = vest {
        m += &format!("_v{v:06x}");
    }
    m
}

impl Cast {
    pub fn clear(&mut self, ecs: &mut Ecs) {
        for w in self.workers.drain(..) {
            if let Ok(e) = ecs.get_entity_mut(w.root) {
                e.despawn();
            }
        }
        for d in self.dinos.drain(..) {
            if let Ok(e) = ecs.get_entity_mut(d.root) {
                e.despawn();
            }
        }
        self.rex_cooldown = 3.0;
        self.rex_warned = false;
    }

    pub fn add_dino(ecs: &mut Ecs, parent: Entity, s: &str, helmet: Option<u32>, vest: Option<u32>, scale: f32) -> Dino {
        let mut model = dino_model(s, helmet, vest);
        if !crate::mats::asset_dir().join("models").join(format!("{model}.glb")).exists() {
            model = format!("dino_{s}"); // (variante não exportada: sem capacete)
        }
        let (root, rig, x) = spawn_rig(ecs, &model, parent);
        let group = ecs.spawn((Transform::default().with_scale(Vec3::splat(scale)), Visibility::default(), ChildOf(parent))).id();
        ecs.entity_mut(root).insert(ChildOf(group));
        let seed = rand::random::<f32>() * 100.0;
        Dino { root: group, rig, x, pose: "idle".into(), phase: rand::random::<f32>() * TAU, seed, roar_t: 0.0, roar_dur: 1.0, speed: None, orbit: None, look: false, rex: false }
    }

    /// as pessoas, os mascotes e os dinossauros da fase (`booths`, `npcs`, `dinos` dos dados)
    pub fn build(&mut self, ecs: &mut Ecs, world_root: Entity, data: &serde_json::Value) {
        self.clear(ecs);
        let f = |v: &serde_json::Value, k: &str, d: f32| v.get(k).and_then(|x| x.as_f64()).map(|x| x as f32).unwrap_or(d);
        let booths: Vec<serde_json::Value> = data.get("booths").and_then(|b| b.as_array()).cloned().unwrap_or_default();
        let npcs: Vec<serde_json::Value> = data.get("npcs").and_then(|b| b.as_array()).cloned().unwrap_or_default();
        for b in booths.iter().chain(npcs.iter()) {
            let who = b.get("who").and_then(|w| w.as_str()).unwrap_or("helena").to_string();
            let model = format!("worker_{who}");
            let (root, rig, x) = spawn_rig(ecs, &model, world_root);
            let flipped = b.get("flipped").and_then(|v| v.as_bool()).unwrap_or(false);
            ecs.entity_mut(root).insert(Transform::from_xyz(f(b, "x", 0.0), f(b, "y", 0.0), f(b, "z", 0.0)).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, f(b, "rotY", 0.0), if flipped { PI } else { 0.0 })));
            let pose = x.get("pose").and_then(|p| p.as_str()).unwrap_or("idle").to_string();
            self.workers.push(Worker { who, root, rig, pose, phase: rand::random::<f32>() * 10.0, talking: false });
        }
        // cada cabine de observação tem um raptor-mascote de capacete (o Pipoca)
        for b in &booths {
            let ry = f(b, "rotY", 0.0);
            let (lx, lz) = (-ry.cos(), ry.sin());
            let mut d = Self::add_dino(ecs, world_root, "raptor", Some(0xf2c200), None, 0.55);
            let p = Vec3::new(f(b, "x", 0.0) - 1.8 * lx + 0.95 * ry.sin(), f(b, "y", 0.0) + 0.95, f(b, "z", 0.0) - 1.8 * lz + 0.95 * ry.cos());
            if let Some(mut tr) = ecs.get_mut::<Transform>(d.root) {
                tr.translation = p;
                tr.rotation = Quat::from_rotation_y(lx.atan2(lz));
            }
            d.look = true;
            self.dinos.push(d);
        }
        for o in data.get("dinos").and_then(|d| d.as_array()).cloned().unwrap_or_default() {
            let s = o.get("s").and_then(|v| v.as_str()).unwrap_or("rex").to_string();
            let helmet = o.get("helmet").and_then(|v| v.as_u64()).map(|v| v as u32);
            let vest = o.get("vest").and_then(|v| v.as_u64()).map(|v| v as u32);
            let mut d = Self::add_dino(ecs, world_root, &s, helmet, vest, f(&o, "scale", 1.0));
            let orbit = o.get("orbit").cloned();
            d.pose = o.get("pose").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(|| if s == "ptero" { "fly".into() } else if orbit.is_some() { "walk".into() } else { "idle".into() });
            let flipped = o.get("flipped").and_then(|v| v.as_bool()).unwrap_or(false);
            if let Some(ob) = orbit {
                let rx = f(&ob, "rx", 10.0);
                d.orbit = Some(Orbit { cx: f(&ob, "cx", 0.0), cz: f(&ob, "cz", 0.0), rx, rz: f(&ob, "rz", rx), speed: ob.get("speed").and_then(|v| v.as_f64()).map(|v| v as f32), phase: f(&ob, "phase", 0.0), dir: f(&ob, "dir", 1.0), y: f(&ob, "y", 0.0), bank: f(&ob, "bank", 0.0), bob: f(&ob, "bob", 0.0) });
            } else if let Some(mut tr) = ecs.get_mut::<Transform>(d.root) {
                tr.translation = Vec3::new(f(&o, "x", 0.0), f(&o, "y", 0.0), f(&o, "z", 0.0));
                tr.rotation = Quat::from_euler(EulerRot::XYZ, 0.0, f(&o, "rotY", 0.0), if flipped { PI } else { 0.0 });
            }
            d.look = d.orbit.is_none() && !flipped;
            d.rex = o.get("rex").and_then(|v| v.as_bool()).unwrap_or(false);
            self.dinos.push(d);
        }
    }

    /// o corpo do jogador (raptor de capacete branco e colete laranja), na camada das vistas pelos portais
    pub fn ensure_body(&mut self, ecs: &mut Ecs) {
        if self.body.is_some() {
            return;
        }
        let parent = ecs.spawn((Transform::default(), Visibility::default(), Name::new("corpo do jogador"))).id();
        let d = Self::add_dino(ecs, parent, "raptor", Some(0xffffff), Some(0xe8762a), 1.0);
        let mut stack = vec![parent];
        while let Some(x) = stack.pop() {
            ecs.entity_mut(x).insert(RenderLayers::layer(BODY_LAYER));
            if let Some(ch) = ecs.get::<Children>(x) {
                stack.extend(ch.iter());
            }
        }
        let mut d = d;
        d.root = parent;
        self.body = Some(d);
    }
}

pub fn update_characters(ecs: &mut Ecs) {
    let dt = ecs.resource::<Time>().delta_secs().min(0.05);
    let talking: Option<String> = ecs.get_non_send::<crate::audio::Audio>().and_then(|a| a.dialog.showing.as_ref().map(|s| s.0.clone()));
    ecs.resource_scope(|ecs, mut g: Mut<Game>| {
        let g = &mut *g;
        let t = g.t;
        let cam = g.cam.translation;
        let mut cast = std::mem::take(&mut g.cast);
        let speaker = talking.and_then(|w| SPEAKERS.iter().find(|s| s.0 == w).map(|s| s.1.to_string()));
        for w in &mut cast.workers {
            w.talking = speaker.as_deref() == Some(w.who.as_str());
            w.pose(ecs, t, dt, Some(cam));
        }
        for d in &mut cast.dinos {
            d.orbit(ecs, t);
            let look = if d.look { Some(cam) } else { None };
            d.pose_it(ecs, t, dt, look);
        }
        // o T-rex do mapa livre: ruge quando você chega perto e empurra quem fica na frente
        if let Some(rex) = cast.dinos.iter_mut().find(|d| d.rex) {
            cast.rex_cooldown -= dt;
            if let Some(tr) = ecs.get::<Transform>(rex.root).copied() {
                let ry = tr.rotation.to_euler(EulerRot::YXZ).0;
                let fwd = Vec3::new(ry.sin(), 0.0, ry.cos());
                let rp = g.player.pos - tr.translation;
                let along = rp.dot(fwd);
                let side = (rp.x - fwd.x * along).hypot(rp.z - fwd.z * along);
                let dist = rp.x.hypot(rp.z);
                if along > -8.0 && along < 6.0 && side < 1.8 && g.player.pos.y < tr.translation.y + 6.0 {
                    let mut push = Vec3::new(rp.x, 0.0, rp.z) - fwd * along;
                    push = push.normalize_or_zero();
                    if push.length_squared() < 0.5 {
                        push = fwd;
                    }
                    let mut v = push * 11.0 + fwd * if along > 0.0 { 6.0 } else { -3.0 };
                    v.y = 7.0;
                    g.player.vel = v;
                    g.player.grounded = false;
                    if cast.rex_cooldown < 1.0 {
                        rex.roar(2.2);
                        g.events.push(crate::game::GameEvent::Roar(0.0));
                        cast.rex_cooldown = 6.0;
                        g.hurt_flash = (g.hurt_flash + 0.4).min(1.0);
                        if !cast.rex_warned {
                            cast.rex_warned = true;
                            g.say(vec![("Marquinho".into(), "Eu falei! Não fica na frente do Rex!".into())]);
                        }
                    }
                } else if dist < 14.0 && cast.rex_cooldown <= 0.0 {
                    rex.roar(2.2);
                    g.events.push(crate::game::GameEvent::Roar(dist));
                    cast.rex_cooldown = 9.0 + rand::random::<f32>() * 5.0;
                }
            }
        }
        // o corpo do jogador
        cast.ensure_body(ecs);
        if let Some(b) = cast.body.as_mut() {
            let moving = g.input.f || g.input.b || g.input.l || g.input.r;
            b.pose = if moving && g.player.grounded { "walk".into() } else { "idle".into() };
            b.speed = Some(4.5);
            let feet = g.player.pos + Vec3::new(0.0, -0.9 * g.player.up_sign, 0.0);
            if let Some(mut tr) = ecs.get_mut::<Transform>(b.root) {
                tr.translation = feet;
                tr.rotation = Quat::from_euler(EulerRot::XYZ, 0.0, g.player.yaw + PI, if g.player.up_sign < 0.0 { PI } else { 0.0 });
            }
            b.pose_it(ecs, t, dt, None);
            let vis = if g.player.in_transit || g.menu { Visibility::Hidden } else { Visibility::Inherited };
            ecs.entity_mut(b.root).insert(vis);
        }
        g.cast = cast;
    });
}
