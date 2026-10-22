//! Série Chefes — B01 "Sistema Nervoso" (chefe.js, chefeSala.js, campaign/boss.js): o crânio gigante
//! com veias e nervos, as torretas de foguete, os foguetes que voltam pelo portal, os núcleos que
//! caem da boca e vão para a fornalha. O salão e o chefe vêm prontos no modelo `boss` (exportado da
//! versão web); aqui ficam a animação e a luta.

use crate::fx::{kind, Fx};
use crate::game::{Game, GameEvent};
use crate::portals::{PORTAL_A, PORTAL_B};
use bevy::ecs::world::World as Ecs;
use bevy::mesh::VertexAttributeValues;
use bevy::prelude::*;
use std::collections::HashMap;

/// centro do crânio
const SK: Vec3 = Vec3::new(0.0, 26.0, -55.0);
const TURRETS: [Vec3; 2] = [Vec3::new(-8.0, 0.0, -38.0), Vec3::new(8.0, 0.0, -38.0)];
/// rápido: dá para ver o laser travar, mas o foguete chega logo
const ROCKET_SPEED: f32 = 21.0;
const MOUTH: Vec3 = Vec3::new(0.0, 20.2, -50.0);
/// onde um foguete "acerta" o chefe: o crânio e o pescoço (a, b, raio)
const HURT: [(Vec3, Vec3, f32); 2] = [(SK, SK, 7.4), (Vec3::new(0.0, 3.0, -59.0), Vec3::new(0.0, 19.0, -56.5), 3.4)];
const TURRET_SCALE: f32 = 1.7;

struct Vein {
    mat: Handle<Fx>,
    amp: f32,
    calm: bool,
}

/// torreta de foguetes: base giratória, cabeça com tubo lançador e sensor; mira com laser, trava, dispara
struct RocketTurret {
    root: Entity,
    pos: Vec3,
    turn: Option<Entity>,
    head: Option<Entity>,
    tube: Option<Entity>,
    loaded: Option<Entity>,
    flash: Option<Entity>,
    lens_glow: Option<Entity>,
    lens: Option<Handle<StandardMaterial>>,
    laser: Entity,
    laser_mesh: Handle<Mesh>,
    laser_mat: Handle<StandardMaterial>,
    enabled: bool,
    lock: f32,
    cool: f32,
    lock_time: f32,
    cool_time: f32,
    yaw: f32,
    pitch: f32,
    kick: f32,
    last_aim: Option<Vec3>,
    rise_y: f32,
}

struct Rocket {
    e: Entity,
    spin: Option<Entity>,
    flame: Option<Entity>,
    pos: Vec3,
    dir: Vec3,
    life: f32,
    homing: bool,
    puff_t: f32,
}

pub struct Boss {
    skull: Option<Entity>,
    jaw: Option<Entity>,
    eyes: Vec<Entity>,
    eye_mat: Option<Handle<StandardMaterial>>,
    port_mat: Option<Handle<StandardMaterial>>,
    veins: Vec<Vein>,
    straps: Vec<(Entity, f32)>,
    fans: Vec<(Entity, f32)>,
    beacons: Vec<(Handle<StandardMaterial>, f32)>,
    leds: Option<(Handle<Mesh>, usize, usize)>,
    led_t: f32,
    /// as luzes quente e fria (com a intensidade de partida)
    warm: Option<(Entity, f32)>,
    cold: Option<(Entity, f32)>,
    // estado (o S da versão web)
    pub stage: u32,
    pub calm: bool,
    flash: f32,
    gape: f32,
    chaos: f32,
    retract: f32,
    grow: f32,
    settled: bool,
    skull_yaw: f32,
    // a luta
    turrets: Vec<RocketTurret>,
    rise: f32,
    tipped: bool,
    tip: u32,
    rockets: Vec<Rocket>,
    booms: Vec<(Entity, Handle<StandardMaterial>, f32)>,
    puffs: Vec<(Entity, Handle<Fx>, f32, f32, f32)>,
    pub core: Option<usize>,
    pub burned: u32,
    spitting: bool,
}

fn named_mat(ecs: &mut Ecs, e: Entity) -> Option<Handle<StandardMaterial>> {
    // uma cópia só desta peça (para animar a cor)
    let m = crate::glb::meshes_of(ecs, e).into_iter().next()?;
    let h = ecs.get::<MeshMaterial3d<StandardMaterial>>(m)?.0.clone();
    let mat = ecs.resource::<Assets<StandardMaterial>>().get(&h)?.clone();
    let nh = ecs.resource_mut::<Assets<StandardMaterial>>().add(mat);
    for m in crate::glb::meshes_of(ecs, e) {
        ecs.entity_mut(m).insert(MeshMaterial3d(nh.clone()));
    }
    Some(nh)
}

fn set_color(ecs: &mut Ecs, h: &Handle<StandardMaterial>, c: LinearRgba) {
    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(h) {
        m.base_color = Color::LinearRgba(c);
    }
}

fn lerp_c(a: Vec3, b: Vec3, k: f32) -> Vec3 {
    a + (b - a) * k
}

impl RocketTurret {
    fn new(ecs: &mut Ecs, root: Entity, pos: Vec3, i: usize) -> Self {
        let (e, named, mats) = crate::glb::spawn_model_full(ecs, "rocket_turret");
        crate::glb::attach_sprites(ecs, "rocket_turret", &named);
        ecs.entity_mut(e).insert((Transform::from_translation(pos).with_scale(Vec3::splat(TURRET_SCALE)), ChildOf(root)));
        let line = Mesh::new(bevy::mesh::PrimitiveTopology::LineList, bevy::asset::RenderAssetUsages::default()).with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0f32; 3]; 4]);
        let laser_mesh = ecs.resource_mut::<Assets<Mesh>>().add(line);
        let laser_mat = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color: Color::LinearRgba(LinearRgba::new(1.0, 0.16, 0.1, 0.85)), unlit: true, alpha_mode: AlphaMode::Blend, ..default() });
        let laser = ecs.spawn((Mesh3d(laser_mesh.clone()), MeshMaterial3d(laser_mat.clone()), Transform::default(), Visibility::Hidden, bevy::camera::visibility::NoFrustumCulling, ChildOf(root))).id();
        let g = |k: &str| named.get(k).copied();
        RocketTurret {
            root: e,
            pos,
            turn: g("turn"),
            head: g("head"),
            tube: g("tube"),
            loaded: g("loaded"),
            flash: g("flash"),
            lens_glow: g("lensGlow"),
            lens: mats.get("lensMat").cloned(),
            laser,
            laser_mesh,
            laser_mat,
            enabled: false,
            lock: 0.0,
            // as duas atiram, uma defasada da outra
            cool: 0.8 + i as f32,
            lock_time: 0.9,
            cool_time: 2.3,
            yaw: 0.0,
            pitch: -0.45,
            kick: 0.0,
            last_aim: None,
            rise_y: 0.0,
        }
    }

    fn base(&self) -> Vec3 {
        self.pos + Vec3::Y * self.rise_y
    }

    /// a boca do tubo no mundo
    fn muzzle(&self) -> Vec3 {
        let head = Vec3::new(0.0, 1.55, 0.0) + Quat::from_rotation_x(self.pitch) * Vec3::new(0.0, 0.0, -1.35);
        self.base() + Quat::from_rotation_y(self.yaw) * head * TURRET_SCALE
    }

    /// gira a base e inclina a cabeça na direção de `eye` (suave), ou abaixa a cabeça desligada
    fn aim(&mut self, ecs: &mut Ecs, dt: f32, eye: Option<Vec3>) {
        let mut yaw = self.yaw;
        let mut pitch = -0.45;
        if let Some(e) = eye {
            let mut d = (e - self.base()) / TURRET_SCALE;
            d.y -= 1.55;
            yaw = (-d.x).atan2(-d.z);
            pitch = d.y.atan2(d.x.hypot(d.z));
        }
        let k = 1.0 - (-dt * if eye.is_some() { 12.0 } else { 3.0 }).exp();
        let tau = std::f32::consts::TAU;
        let dy = ((yaw - self.yaw + std::f32::consts::PI).rem_euclid(tau)) - std::f32::consts::PI;
        self.yaw += dy * k;
        self.pitch += (pitch.clamp(-1.2, 1.2) - self.pitch) * k;
        if let Some(t) = self.turn {
            ecs.entity_mut(t).insert(Transform::from_rotation(Quat::from_rotation_y(self.yaw)));
        }
        if let Some(h) = self.head {
            ecs.entity_mut(h).insert(Transform::from_xyz(0.0, 1.55, 0.0).with_rotation(Quat::from_rotation_x(self.pitch)));
        }
    }

    fn glow(&self, ecs: &mut Ecs, v: f32) {
        if let Some(l) = &self.lens {
            set_color(ecs, l, LinearRgba::rgb(0.3 + 2.2 * v, 0.03 + 0.15 * v, 0.02 + 0.1 * v));
        }
        if let Some(g) = self.lens_glow {
            if let Some(mut tr) = ecs.get_mut::<Transform>(g) {
                tr.scale = Vec3::splat((0.25 + 0.3 * v) / 0.35);
            }
        }
    }

    /// devolve (boca, direção) quando dispara; também enxerga através dos portais
    fn update(&mut self, ecs: &mut Ecs, dt: f32, eye: Vec3, g: &Game, t: f32) -> Option<(Vec3, Vec3)> {
        ecs.entity_mut(self.laser).insert(Visibility::Hidden);
        self.kick = (self.kick - dt * 2.5).max(0.0);
        if let Some(tb) = self.tube {
            ecs.entity_mut(tb).insert(Transform::from_xyz(0.0, 0.03, 0.16 * self.kick * self.kick));
        }
        if let Some(f) = self.flash {
            ecs.entity_mut(f).insert(if self.kick > 0.82 { Visibility::Inherited } else { Visibility::Hidden });
        }
        if let Some(l) = self.loaded {
            ecs.entity_mut(l).insert(if self.cool < self.cool_time - 0.8 { Visibility::Inherited } else { Visibility::Hidden });
        }
        if !self.enabled {
            self.lock = 0.0;
            self.aim(ecs, dt, None);
            self.glow(ecs, 0.05);
            return None;
        }
        self.cool -= dt;
        let Some((aim, pts)) = sight(self.muzzle(), eye, g) else {
            let last = self.last_aim.unwrap_or(eye);
            self.aim(ecs, dt, Some(last)); // fica olhando para onde viu você por último
            self.lock = (self.lock - dt).max(0.0);
            self.glow(ecs, 0.35);
            return None;
        };
        self.last_aim = Some(aim);
        self.aim(ecs, dt, Some(aim));
        let from = self.muzzle();
        let to = (aim - from).normalize_or_zero();
        let p = (self.lock / self.lock_time).min(1.0);
        // travando: a lente pisca cada vez mais rápido
        self.glow(ecs, 0.5 + 0.5 * p * (0.6 + 0.4 * (t * (8.0 + 30.0 * p)).sin()));
        let mut pts = pts;
        pts[0] = from;
        if let Some(mut m) = ecs.resource_mut::<Assets<Mesh>>().get_mut(&self.laser_mesh) {
            m.insert_attribute(Mesh::ATTRIBUTE_POSITION, pts.iter().map(|p| p.to_array()).collect::<Vec<_>>());
        }
        set_color(ecs, &self.laser_mat.clone(), LinearRgba::new(1.0, 0.16, 0.1, 0.4 + 0.5 * p));
        ecs.entity_mut(self.laser).insert(Visibility::Inherited);
        self.lock += dt;
        if self.lock > self.lock_time && self.cool <= 0.0 {
            self.lock = 0.0;
            self.cool = self.cool_time;
            self.kick = 1.0;
            return Some((from, to));
        }
        None
    }
}

/// linha de visão da boca até `eye`: direta ou por um par de portais (mira no "você" visto dentro
/// do portal). Devolve (para onde apontar, os pedaços do laser)
fn sight(from: Vec3, eye: Vec3, g: &Game) -> Option<(Vec3, [Vec3; 4])> {
    // vê através de vidro (o foguete quebraria o vidro)
    let clear = |a: Vec3, b: Vec3| {
        let d = b - a;
        let len = d.length();
        len < 1e-4 || g.world.raycast_f(a, d / len, len, |i| g.world.solids[i].mat != "glass").is_none()
    };
    if clear(from, eye) {
        return Some((eye, [from, eye, eye, eye]));
    }
    let ps = &g.portals;
    let mut best: Option<(f32, Vec3, [Vec3; 4])> = None;
    for i in 0..ps.list.len() {
        let p = &ps.list[i];
        if !ps.is_linked(i) || p.delta > 0.0 || ps.list[p.partner].delta > 0.0 {
            continue;
        }
        // você, visto pelo portal P (o mundo do outro lado trazido para cá)
        let ghost = ps.transform(p.partner, i).transform_point3(eye);
        let n = p.normal;
        let sa = (from - p.center).dot(n);
        let sb = (ghost - p.center).dot(n);
        if !(sa > 0.0 && sb < 0.0) {
            continue;
        }
        let hit = from.lerp(ghost, sa / (sa - sb));
        let l = p.local(hit);
        if l.x.abs() > PORTAL_A * 0.95 || l.y.abs() > PORTAL_B * 0.95 {
            continue;
        }
        let dir = (ghost - from).normalize();
        let out = ps.transform(i, p.partner).transform_point3(hit);
        if !clear(from, hit - dir * 0.05) {
            continue;
        }
        let dir_out = (eye - out).normalize();
        if !clear(out + dir_out * 0.05, eye) {
            continue;
        }
        let dist = from.distance(ghost);
        if best.as_ref().is_none_or(|b| dist < b.0) {
            best = Some((dist, ghost, [from, hit, out, eye]));
        }
    }
    best.map(|b| (b.1, b.2))
}

impl Boss {
    pub fn new(ecs: &mut Ecs, root: Entity) -> Self {
        let (e, named, mats) = crate::glb::spawn_model_full(ecs, "boss");
        ecs.entity_mut(e).insert(ChildOf(root));
        let g = |k: &str| named.get(k).copied();
        let x = |ecs: &Ecs, k: &str, f: &str| crate::glb::node_extras(ecs, "boss", k).get(f).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
        // veias: o material de shader (o centro do tubo e a semente vêm na cor do vértice)
        let mut veins = vec![];
        for (name, &n) in &named {
            if !name.starts_with("vein_") {
                continue;
            }
            let ex = crate::glb::node_extras(ecs, "boss", name);
            let f = |k: &str| ex.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            let calm = f("calm") > 0.5;
            let mut fx = Fx::new(kind::VEIN).opaque();
            fx.u.color = Vec4::new(f("cr"), f("cg"), f("cb"), 1.0);
            fx.u.p0 = Vec4::new(f("amp"), 1.0, 0.0, if calm { 0.0 } else { 2.0 });
            let h = crate::world::fx_mat(ecs, fx);
            for m in crate::glb::meshes_of(ecs, n) {
                ecs.entity_mut(m).remove::<MeshMaterial3d<StandardMaterial>>().insert((MeshMaterial3d(h.clone()), bevy::camera::visibility::NoFrustumCulling));
            }
            veins.push(Vein { mat: h, amp: f("amp"), calm });
        }
        let mut straps = vec![];
        let mut fans = vec![];
        let mut beacons = vec![];
        let names: Vec<(String, Entity)> = named.iter().map(|(k, v)| (k.clone(), *v)).collect();
        for (name, n) in &names {
            if name.starts_with("strap_") {
                straps.push((*n, x(ecs, name, "u")));
                ecs.entity_mut(*n).insert(Visibility::Hidden);
            } else if name.starts_with("fan_") {
                fans.push((*n, x(ecs, name, "spd")));
            } else if name.starts_with("beacon_") {
                let ph = x(ecs, name, "ph");
                if let Some(h) = named_mat(ecs, *n) {
                    beacons.push((h, ph));
                }
            }
        }
        let leds = g("leds").and_then(|n| {
            let m = crate::glb::meshes_of(ecs, n).into_iter().next()?;
            let h = ecs.get::<Mesh3d>(m)?.0.clone();
            Some((h, x(ecs, "leds", "n") as usize, x(ecs, "leds", "per") as usize))
        });
        let eyes: Vec<Entity> = ["eye_0", "eye_1"].iter().filter_map(|k| g(k)).collect();
        // as luzes quente e fria do chefe (as da fase, perto de x = ∓9)
        let mut q = ecs.query::<(Entity, &Transform, &PointLight)>();
        let lights: Vec<(Entity, Vec3)> = q.iter(ecs).map(|(e, t, _)| (e, t.translation)).collect();
        let find = |p: Vec3| lights.iter().filter(|l| l.1.distance(p) < 0.5).map(|l| l.0).next();
        let base = |ecs: &Ecs, e: Option<Entity>| e.map(|e| (e, ecs.get::<PointLight>(e).map(|l| l.intensity).unwrap_or(0.0)));
        let turrets = TURRETS.iter().enumerate().map(|(i, &p)| RocketTurret::new(ecs, root, p, i)).collect();
        Boss {
            skull: g("skull"),
            jaw: g("jaw"),
            eyes,
            eye_mat: mats.get("eye").cloned(),
            port_mat: mats.get("port").cloned(),
            veins,
            straps,
            fans,
            beacons,
            leds,
            led_t: 0.0,
            warm: base(ecs, find(Vec3::new(-9.0, 15.0, -43.0))),
            cold: base(ecs, find(Vec3::new(9.0, 15.0, -43.0))),
            stage: 0,
            calm: false,
            flash: 0.0,
            gape: 0.0,
            chaos: 1.0,
            retract: 0.0,
            grow: 0.0,
            settled: false,
            skull_yaw: 0.0,
            turrets,
            rise: 0.0,
            tipped: false,
            tip: 0,
            rockets: vec![],
            booms: vec![],
            puffs: vec![],
            core: None,
            burned: 0,
            spitting: true,
        }
    }

    /// a animação do chefe e do salão (o w.anim de buildBoss e de dressHall)
    fn animate(&mut self, ecs: &mut Ecs, t: f32, dt: f32, look: Vec3) {
        // cada foguete que acerta tira um terço da raiva; com o último núcleo queimado vem a calma
        let n = self.stage as f32;
        self.chaos += (1.0 - n / 3.0 - self.chaos) * (dt * 1.4).min(1.0);
        self.retract += (n / 3.0 - self.retract) * (dt * 0.7).min(1.0);
        if self.stage >= 3 {
            self.retract = (self.retract + dt * 0.3).min(1.0);
            if !self.settled && self.retract > 0.97 {
                self.settled = true;
            }
        }
        if self.calm {
            self.grow += (1.05 - self.grow) * (dt * 0.45).min(1.0);
        }
        self.flash = (self.flash - dt * 1.6).max(0.0);
        self.gape = (self.gape - dt * 0.9).max(0.0);
        let (chaos, flash) = (self.chaos, self.flash);
        let retract = if self.settled { 1.0 } else { self.retract * 0.99 };
        {
            let mut fx = ecs.resource_mut::<Assets<Fx>>();
            for v in &self.veins {
                if let Some(mut m) = fx.get_mut(&v.mat) {
                    m.u.p0 = Vec4::new(v.amp, chaos, if v.calm { 0.0 } else { retract }, if v.calm { self.grow } else { 2.0 });
                    m.u.p1.x = flash * flash;
                }
            }
        }
        for &(s, u) in &self.straps {
            ecs.entity_mut(s).insert(if self.grow > u + 0.05 { Visibility::Inherited } else { Visibility::Hidden });
        }
        // olhos: vermelhos e tremendo → ciano e firmes
        let flick = if chaos > 0.05 { 0.75 + 0.25 * (t * (9.0 + 10.0 * chaos)).sin().abs() } else { 1.0 };
        if let Some(h) = self.eye_mat.clone() {
            let c = lerp_c(Vec3::new(0.5, 1.7, 2.3), Vec3::new(3.0, 0.15, 0.1), chaos) * (flick + flash * 0.8);
            set_color(ecs, &h, LinearRgba::rgb(c.x, c.y, c.z));
        }
        if let Some(h) = self.port_mat.clone() {
            let c = lerp_c(Vec3::new(0.3, 1.2, 1.7), Vec3::new(2.6, 0.5, 0.3), chaos);
            set_color(ecs, &h, LinearRgba::rgb(c.x, c.y, c.z));
        }
        for (i, &e) in self.eyes.clone().iter().enumerate() {
            if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                tr.scale = Vec3::splat(1.0 + 0.12 * (t * 3.0 + i as f32).sin() * chaos);
            }
        }
        // crânio: acompanha o jogador, balança e treme com a raiva; recua a cada acerto
        let l = look - SK;
        let yaw = l.x.atan2(l.z).clamp(-0.7, 0.7);
        self.skull_yaw += (yaw * (0.4 + 0.6 * chaos) + (t * 0.45).sin() * 0.05 * chaos - self.skull_yaw) * (dt * 2.5).min(1.0);
        if let Some(s) = self.skull {
            let pos = Vec3::new(SK.x + ((t * 31.0).sin() * 0.05 + (t * 17.0).sin() * 0.04) * (chaos * chaos + flash), SK.y + (t * 23.0).sin() * 0.04 * chaos, SK.z - flash * 0.4);
            let rx = (t * 0.37).sin() * 0.025 + flash * 0.05;
            ecs.entity_mut(s).insert(Transform::from_translation(pos).with_rotation(Quat::from_euler(EulerRot::XYZ, rx, self.skull_yaw, 0.0)));
        }
        // mandíbula: bate os dentes; escancara quando leva um acerto; fecha quando calmo
        if let Some(j) = self.jaw {
            let rx = (0.06 + 0.14 * (t * 11.0).sin().abs() * chaos) * if chaos > 0.05 { 1.0 } else { 0.2 } + self.gape * 0.42;
            if let Some(mut tr) = ecs.get_mut::<Transform>(j) {
                tr.rotation = Quat::from_rotation_x(rx);
            }
        }
        // luzes: ardem em vermelho/azul e esfriam para branco-azulado
        if let Some((w, k)) = self.warm {
            if let Some(mut pl) = ecs.get_mut::<PointLight>(w) {
                pl.color = Color::linear_rgb(1.0, 0.25 + 0.5 * (1.0 - chaos), 0.2 + 0.7 * (1.0 - chaos));
                pl.intensity = k * (0.8 + 0.2 * (t * 7.0).sin() * chaos + 0.3 * (1.0 - chaos));
            }
        }
        if let Some((c, k)) = self.cold {
            if let Some(mut pl) = ecs.get_mut::<PointLight>(c) {
                pl.intensity = k * (0.9 + 0.1 * (t * 5.0 + 1.0).sin() * chaos);
            }
        }
        // cenário: ventiladores, luzes de alerta e os LEDs das máquinas
        for &(f, spd) in &self.fans {
            if let Some(mut tr) = ecs.get_mut::<Transform>(f) {
                tr.rotate_local_z(dt * spd);
            }
        }
        for (h, ph) in self.beacons.clone() {
            let k = 0.15 + 0.85 * (t * 3.0 + ph).sin().max(0.0).powi(2);
            set_color(ecs, &h, LinearRgba::rgb(3.0 * k, 1.1 * k, 0.2 * k));
        }
        self.led_t -= dt;
        if self.led_t <= 0.0 {
            self.led_t = 0.18;
            if let Some((h, n, per)) = self.leds.clone() {
                let pal = [[0.2, 2.4, 0.5, 1.0], [2.6, 0.5, 0.2, 1.0], [0.3, 0.9, 2.6, 1.0], [0.02, 0.02, 0.02, 1.0]];
                if let Some(mut m) = ecs.resource_mut::<Assets<Mesh>>().get_mut(&h) {
                    if let Some(VertexAttributeValues::Float32x4(c)) = m.attribute_mut(Mesh::ATTRIBUTE_COLOR) {
                        for i in 0..n {
                            if rand::random::<f32>() < 0.08 {
                                let col = pal[(rand::random::<f32>() * 4.0) as usize % 4];
                                for v in c.iter_mut().skip(i * per).take(per) {
                                    *v = col;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

impl Game {
    /// a fase tem a luta? (`fight` nos dados): monta o chefe
    pub fn boss_load(&mut self, ecs: &mut Ecs) {
        self.boss = None;
        if self.data.get("fight").is_none() {
            return;
        }
        let root = self.world.root();
        self.boss = Some(Box::new(Boss::new(ecs, root)));
    }

    fn boss_hit(&mut self, ecs: &mut Ecs) {
        let Some(b) = self.boss.as_mut() else { return };
        b.stage += 1;
        b.flash = 1.0;
        b.gape = 1.0;
        let stage = b.stage;
        self.events.push(GameEvent::BossHit);
        // o núcleo cai da boca para o chão, em frente ao pescoço (cuspido para a frente: cai a meio caminho da fornalha)
        let k = self.props.add_model(ecs, &mut self.world, MOUTH.x, MOUTH.y, MOUTH.z, &format!("core_{}", (stage - 1) % 3));
        if let Some(body) = self.world.phys.body_mut(self.props.list[k].body) {
            body.set_linvel(Vec3::new((rand::random::<f32>() - 0.5) * 3.0, 1.0, 4.5), true);
        }
        self.boss.as_mut().unwrap().core = Some(k);
        let line = match stage {
            1 => "Acertou! Caiu um núcleo da boca dele. Pegue com E, leve até a fornalha no meio do salão e solte lá dentro.",
            2 => "Mais um núcleo. Mesma coisa: fornalha.",
            _ => "O último! Fornalha nele também.",
        };
        self.say(vec![("Helena".into(), line.into())]);
    }

    /// a luta (createFight.update) e a animação do chefe, a cada quadro do mundo
    pub fn boss_update(&mut self, ecs: &mut Ecs, dt: f32, t: f32) {
        let Some(mut b) = self.boss.take() else { return };
        let eye = self.player.eye();
        b.animate(ecs, t, dt, eye);
        // os olhos cospem bolas de energia que varrem o salão
        for (i, l) in self.world.launchers.iter_mut().take(2).enumerate() {
            let yaw = (t * 1.3 + i as f32 * 2.4).sin() * 0.9;
            let pitch = -0.3 - 0.25 * (t * 1.9 + i as f32).sin();
            l.dir = Vec3::new(yaw.sin(), pitch, yaw.cos()).normalize();
        }
        if b.calm && b.spitting {
            b.spitting = false;
            for li in 0..self.world.launchers.len().min(2) {
                self.world.launchers[li].done = true;
                if let Some(pi) = self.world.launchers[li].pellet {
                    if let Some(p) = self.energy.pellets.get_mut(pi) {
                        p.life = p.life.min(0.25);
                    }
                }
            }
        }
        let idle = b.core.is_some() || b.calm;
        b.rise = (b.rise + dt * if b.calm { -0.7 } else { 0.55 }).clamp(0.0, 1.0);
        let lift = b.rise * b.rise * (3.0 - 2.0 * b.rise);
        let mut shots = vec![];
        let mut say = None;
        for tu in &mut b.turrets {
            tu.rise_y = -3.8 * (1.0 - lift);
            ecs.entity_mut(tu.root).insert((Transform::from_translation(tu.base()).with_scale(Vec3::splat(TURRET_SCALE)), if b.rise > 0.01 { Visibility::Inherited } else { Visibility::Hidden }));
            tu.enabled = !idle && b.rise >= 0.999;
            let shot = tu.update(ecs, dt, eye, self, t);
            if tu.lock == 0.0 {
                b.tipped = false;
            }
            if tu.enabled && tu.lock > 0.3 && !b.tipped && b.tip < 2 {
                b.tipped = true;
                b.tip += 1;
                say = Some(if self.portals.list[0].placed {
                    "O laser travou em você! Saia do caminho: o foguete vai reto até o portal ciano."
                } else {
                    "O laser travou! Ponha o portal ciano numa parede branca atrás de você e saia da frente do foguete."
                });
            }
            if let Some(s) = shot {
                shots.push(s);
            }
        }
        if let Some(l) = say {
            self.say(vec![("Helena".into(), l.into())]);
        }
        let root = self.world.root();
        for (pos, dir) in shots {
            let (e, named) = crate::glb::spawn_model(ecs, "rocket");
            crate::glb::attach_sprites(ecs, "rocket", &named);
            ecs.entity_mut(e).insert((Transform::from_translation(pos).looking_to(dir, Vec3::Y), ChildOf(root)));
            b.rockets.push(Rocket { e, spin: named.get("spin").copied(), flame: named.get("flame").copied(), pos, dir, life: 12.0, homing: false, puff_t: 0.0 });
            self.events.push(GameEvent::RocketShot(pos.distance(eye)));
        }
        // foguetes: voam reto, atravessam portais (e depois corrigem a rota rumo ao crânio), explodem no que tocar
        let mut i = b.rockets.len();
        let mut hits = 0;
        let mut hurt = 0.0;
        let mut booms = vec![];
        while i > 0 {
            i -= 1;
            let r = &mut b.rockets[i];
            let mut prev = r.pos;
            r.pos += r.dir * ROCKET_SPEED * dt;
            r.life -= dt;
            if let Some(p) = self.portals.crossing(prev, r.pos, crate::portals::Who::Ball) {
                let q = self.portals.list[p].partner;
                let m = self.portals.transform(p, q);
                r.pos = m.transform_point3(r.pos);
                r.dir = m.transform_vector3(r.dir).normalize();
                prev = r.pos - r.dir * 0.05;
                r.homing = true;
            }
            if r.homing {
                let to = (SK - r.pos).normalize();
                if to.dot(r.dir) > 0.8 {
                    r.dir = r.dir.lerp(to, (dt * 1.6).min(1.0)).normalize();
                }
            }
            let mut boom = r.life <= 0.0;
            for (a, bb, rad) in HURT {
                let ab = bb - a;
                let l2 = ab.length_squared();
                let k = if l2 > 0.0 { ((r.pos - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
                if r.pos.distance(a + ab * k) < rad {
                    hits += 1;
                    boom = true;
                }
            }
            if !boom && r.pos.distance(self.player.pos) < 0.8 {
                hurt += 45.0;
                boom = true;
            }
            let step = r.pos - prev;
            if !boom && step.length_squared() > 0.0 && self.world.raycast(prev, step.normalize(), step.length()).is_some() {
                boom = true;
            }
            if boom {
                booms.push(r.pos);
                let e = r.e;
                ecs.entity_mut(e).despawn();
                b.rockets.remove(i);
                continue;
            }
            ecs.entity_mut(r.e).insert(Transform::from_translation(r.pos).looking_to(r.dir, Vec3::Y));
            if let Some(s) = r.spin {
                if let Some(mut tr) = ecs.get_mut::<Transform>(s) {
                    tr.rotation = Quat::from_rotation_z(t * 5.0);
                }
            }
            if let Some(f) = r.flame {
                if let Some(mut tr) = ecs.get_mut::<Transform>(f) {
                    let k = 0.85 + 0.3 * rand::random::<f32>();
                    tr.scale = Vec3::new(k, k, 0.8 + 0.5 * rand::random::<f32>());
                }
            }
            r.puff_t -= dt;
            if r.puff_t <= 0.0 {
                r.puff_t = 0.025;
                let at = r.pos - r.dir * 0.4;
                spawn_puff(ecs, &mut b.puffs, root, at);
            }
        }
        for p in booms {
            spawn_boom(ecs, &mut b.booms, root, p);
            self.events.push(GameEvent::Energy(crate::energy::EnergyEvent::Pop(p)));
        }
        age_fx(ecs, &mut b.booms, &mut b.puffs, dt);
        self.boss = Some(b);
        for _ in 0..hits {
            let b = self.boss.as_ref().unwrap();
            if b.core.is_none() && b.stage < 3 && !b.calm {
                self.boss_hit(ecs);
            }
        }
        if hurt > 0.0 {
            self.health -= hurt;
            self.hurt_t = 0.0;
            self.hurt_flash = 1.0;
            self.events.push(GameEvent::Hit(1));
            if self.health <= 0.0 {
                self.die("foguete");
                return;
            }
        }
        // núcleo na fornalha
        let gone = self.boss.as_ref().and_then(|b| b.core).is_some_and(|k| self.props.list.get(k).is_none_or(|p| p.gone));
        if gone {
            let b = self.boss.as_mut().unwrap();
            b.core = None;
            b.burned += 1;
            if b.burned >= 3 {
                b.calm = true;
                for tu in &mut b.turrets {
                    tu.enabled = false;
                }
                self.world.signals.insert("exit".into(), true);
                self.say(vec![("Helena".into(), "Ele se acalmou. Os nervos se recolheram e a porta atrás dele abriu: pode ir.".into())]);
            } else {
                self.say(vec![("Helena".into(), "Queimou! A torreta vai voltar a atirar: mesma tática.".into())]);
            }
        }
    }
}

/// clarão da explosão: esfera que cresce e some
fn spawn_boom(ecs: &mut Ecs, list: &mut Vec<(Entity, Handle<StandardMaterial>, f32)>, root: Entity, p: Vec3) {
    let mesh = ecs.resource_mut::<Assets<Mesh>>().add(Sphere::new(0.4).mesh().uv(20, 14));
    let c = crate::mats::hex(0xffb060).to_linear() * 2.0;
    let mat = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color: Color::LinearRgba(c.with_alpha(1.0)), unlit: true, alpha_mode: AlphaMode::Blend, ..default() });
    let e = ecs.spawn((Mesh3d(mesh), MeshMaterial3d(mat.clone()), Transform::from_translation(p), ChildOf(root))).id();
    list.push((e, mat, 0.0));
}

/// fumaça do foguete: bolinhas cinza que crescem, sobem devagar e se apagam
fn spawn_puff(ecs: &mut Ecs, list: &mut Vec<(Entity, Handle<Fx>, f32, f32, f32)>, root: Entity, p: Vec3) {
    let life = 0.9 + rand::random::<f32>() * 0.4;
    let mesh = crate::world::mesh_h(ecs, &crate::geo::plane_geo(1.0, 1.0));
    let mat = crate::world::fx_mat(ecs, Fx::new(kind::SPRITE).color(LinearRgba::new(0.5, 0.5, 0.5, 0.5)).blend());
    let e = crate::world::put_mesh(ecs, root, mesh, mat.clone(), Transform::from_translation(p).with_scale(Vec3::splat(0.12)));
    list.push((e, mat, 0.0, life, p.y));
}

fn age_fx(ecs: &mut Ecs, booms: &mut Vec<(Entity, Handle<StandardMaterial>, f32)>, puffs: &mut Vec<(Entity, Handle<Fx>, f32, f32, f32)>, dt: f32) {
    booms.retain_mut(|(e, m, t)| {
        *t += dt;
        if *t > 0.4 {
            ecs.entity_mut(*e).despawn();
            return false;
        }
        if let Some(mut tr) = ecs.get_mut::<Transform>(*e) {
            tr.scale = Vec3::splat(1.0 + *t * 9.0);
        }
        if let Some(mut mm) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(m) {
            mm.base_color.set_alpha((1.0 - *t * 2.5).max(0.0));
        }
        true
    });
    puffs.retain_mut(|(e, m, t, life, y0)| {
        *t += dt;
        let a = *t / *life;
        if a >= 1.0 {
            ecs.entity_mut(*e).despawn();
            return false;
        }
        if let Some(mut tr) = ecs.get_mut::<Transform>(*e) {
            tr.scale = Vec3::splat(0.12 + 0.55 * a.sqrt());
            tr.translation.y = *y0 + 0.3 * a;
        }
        if let Some(mut mm) = ecs.resource_mut::<Assets<Fx>>().get_mut(m) {
            mm.u.color.w = 0.5 * (1.0 - a).powf(1.5);
        }
        true
    });
}

#[allow(dead_code)]
fn _unused(_: HashMap<String, Entity>) {}
