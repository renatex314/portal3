//! Projétil do tiro (makeBolt/fireBolt/updateBolts do main.js): uma bola de energia na cor do
//! portal voa até a parede a 150 m/s e o portal só abre quando ela chega. Um por cor, sempre na
//! cena (só fica invisível).

use crate::geo::{cone_geo, sphere_geo};
use crate::world::{bas, bas_a, point_light, put, put_mesh};
use bevy::asset::RenderAssetUsages;
use bevy::ecs::world::World as Ecs;
use bevy::mesh::PrimitiveTopology;
use bevy::prelude::*;

pub const BOLT_SPEED: f32 = 150.0;
const SPIRAL_L: f32 = 2.4;

/// o que é preciso para abrir o portal quando o projétil chega
#[derive(Clone, Debug)]
pub struct Landing {
    pub origin: Vec3,
    pub dir: Vec3,
    pub allowed: bool,
    pub level: Option<usize>,
    /// relógio: o vermelho com o tempo parado cai nas paredes do passado
    pub temporal: bool,
}

pub struct Bolt {
    pub g: Entity,
    core: Entity,
    halo: Entity,
    trail: Entity,
    spiral: Entity,
    light: Entity,
    core_mat: Handle<StandardMaterial>,
    halo_mat: Handle<StandardMaterial>,
    trail_mat: Handle<StandardMaterial>,
    spiral_mat: Handle<StandardMaterial>,
    pub active: bool,
    pub from: Vec3,
    pub to: Vec3,
    pub t: f32,
    pub dur: f32,
    pub done: Option<Landing>,
}

pub struct Bolts {
    pub list: [Bolt; 2],
}

fn spiral_mesh() -> Mesh {
    let mut pos = vec![];
    let mut col = vec![];
    for phase in [0.0, std::f32::consts::PI] {
        let n = 96;
        let at = |i: usize| {
            let f = i as f32 / n as f32;
            let a = phase + f * std::f32::consts::TAU * 7.0;
            let r = 0.1 * (1.0 - 0.55 * f);
            ([a.cos() * r, a.sin() * r, -f * SPIRAL_L], 1.0 - f)
        };
        for i in (0..n).step_by(2) {
            for j in [i, i + 1] {
                let (p, k) = at(j);
                pos.push(p);
                col.push([k, k, k, 1.0]);
            }
        }
    }
    Mesh::new(PrimitiveTopology::LineList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, col)
}

impl Bolt {
    fn new(ecs: &mut Ecs) -> Self {
        let g = ecs.spawn((Transform::default(), Visibility::Hidden, Name::new("projétil"))).id();
        let core_mat = bas(ecs, LinearRgba::WHITE);
        let halo_mat = bas_a(ecs, LinearRgba::WHITE, 0.45, true);
        let trail_mat = bas_a(ecs, LinearRgba::WHITE, 0.55, true);
        let spiral_mat = bas_a(ecs, LinearRgba::WHITE, 1.0, true);
        let core = put(ecs, g, &sphere_geo(0.055, 16, 12), &core_mat, Transform::default());
        let halo = put(ecs, g, &sphere_geo(0.15, 16, 12), &halo_mat, Transform::default());
        // rastro: cone com a base no núcleo e a ponta para trás (−z)
        let cone = cone_geo(0.06, 1.0, 12).rotate_x(-std::f32::consts::FRAC_PI_2).translate(0.0, 0.0, -0.5);
        let trail = put(ecs, g, &cone, &trail_mat, Transform::default());
        let sm = ecs.resource_mut::<Assets<Mesh>>().add(spiral_mesh());
        let spiral = put_mesh(ecs, g, sm, &spiral_mat, Transform::default());
        let light = ecs.spawn((point_light(Color::WHITE, 0.0, 6.0), Transform::default(), Visibility::Hidden)).id();
        Bolt { g, core, halo, trail, spiral, light, core_mat, halo_mat, trail_mat, spiral_mat, active: false, from: Vec3::ZERO, to: Vec3::ZERO, t: 0.0, dur: 0.0, done: None }
    }
}

fn set_color(ecs: &mut Ecs, h: &Handle<StandardMaterial>, c: Vec3) {
    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(h) {
        let a = m.base_color.alpha();
        m.base_color = LinearRgba::rgb(c.x, c.y, c.z).with_alpha(a).into();
    }
}

fn scale_of(ecs: &mut Ecs, e: Entity, s: Vec3) {
    if let Some(mut t) = ecs.get_mut::<Transform>(e) {
        t.scale = s;
    }
}

impl Bolts {
    pub fn new(ecs: &mut Ecs) -> Self {
        Bolts { list: [Bolt::new(ecs), Bolt::new(ecs)] }
    }

    pub fn clear(&mut self, ecs: &mut Ecs) {
        for b in &mut self.list {
            b.active = false;
            b.done = None;
            ecs.entity_mut(b.g).insert(Visibility::Hidden);
            ecs.entity_mut(b.light).insert(Visibility::Hidden);
        }
    }

    /// dispara de `from` até `to`; um tiro novo da mesma cor substitui o que ainda está voando
    pub fn fire(&mut self, ecs: &mut Ecs, which: usize, c: Vec3, from: Vec3, to: Vec3, done: Landing) {
        let b = &mut self.list[which];
        set_color(ecs, &b.core_mat, c * 4.0 + Vec3::splat(0.6)); // núcleo quase branco: o bloom acende
        set_color(ecs, &b.halo_mat, c * 2.2);
        set_color(ecs, &b.trail_mat, c * 2.6);
        set_color(ecs, &b.spiral_mat, c * 3.2 + Vec3::splat(0.3));
        if let Some(mut l) = ecs.get_mut::<PointLight>(b.light) {
            l.color = Color::linear_rgb(c.x, c.y, c.z);
        }
        b.from = from;
        b.to = to;
        b.t = 0.0;
        b.dur = (from.distance(to) / BOLT_SPEED).max(0.04);
        b.done = Some(done);
        b.active = true;
        let tr = Transform::from_translation(from).looking_at(to, if (to - from).normalize_or_zero().y.abs() > 0.999 { Vec3::Z } else { Vec3::Y });
        ecs.entity_mut(b.g).insert((tr, Visibility::Visible));
        scale_of(ecs, b.trail, Vec3::new(1.0, 1.0, 0.01));
        scale_of(ecs, b.spiral, Vec3::new(1.0, 1.0, 0.01));
    }

    /// anda os projéteis; devolve os que chegaram (qual, pouso)
    pub fn update(&mut self, ecs: &mut Ecs, dt: f32, t: f32) -> Vec<(usize, Landing)> {
        let mut out = vec![];
        for (i, b) in self.list.iter_mut().enumerate() {
            if !b.active {
                continue;
            }
            b.t += dt;
            let k = (b.t / b.dur).min(1.0);
            let p = b.from.lerp(b.to, k);
            let flown = b.from.distance(p);
            if let Some(mut tr) = ecs.get_mut::<Transform>(b.g) {
                tr.translation = p;
            }
            scale_of(ecs, b.trail, Vec3::new(1.0, 1.0, flown.min(1.6)));
            if let Some(mut tr) = ecs.get_mut::<Transform>(b.spiral) {
                tr.scale = Vec3::new(1.0, 1.0, (flown / SPIRAL_L).min(1.0));
                tr.rotation = Quat::from_rotation_z(-t * 38.0);
            }
            let pulse = 1.0 + 0.18 * (t * 60.0).sin();
            scale_of(ecs, b.core, Vec3::splat(pulse));
            scale_of(ecs, b.halo, Vec3::splat(1.1 - 0.1 * pulse));
            let lp = point_light(Color::WHITE, 6.0, 6.0).intensity;
            if let Some(mut l) = ecs.get_mut::<PointLight>(b.light) {
                l.intensity = lp;
            }
            ecs.entity_mut(b.light).insert((Transform::from_translation(p), Visibility::Visible));
            if k >= 1.0 {
                b.active = false;
                ecs.entity_mut(b.g).insert(Visibility::Hidden);
                ecs.entity_mut(b.light).insert(Visibility::Hidden);
                if let Some(d) = b.done.take() {
                    out.push((i, d));
                }
            }
        }
        out
    }

    pub fn flying(&self) -> bool {
        self.list.iter().any(|b| b.active)
    }
}
