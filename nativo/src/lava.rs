//! Rocha fundida (lava.js): material procedural sobre o PBR padrão (luz e névoa continuam
//! valendo) e brasas subindo. O padrão sai da posição no MUNDO: placas de crosta (Voronoi)
//! boiando numa correnteza lenta, frestas incandescentes, poças que borbulham e relevo.

use crate::fx::{self, Fx};
use crate::mats::hex;
use crate::world::{fx_mat, put_mesh};
use bevy::ecs::world::World as Ecs;
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy::shader::ShaderRef;
use rand::Rng;

#[derive(ShaderType, Clone, Copy, Debug, Default, Reflect)]
pub struct LavaU {
    pub time: f32,
    pub _a: f32,
    pub _b: f32,
    pub _c: f32,
}

#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct LavaExt {
    #[uniform(100)]
    pub u: LavaU,
}

impl MaterialExtension for LavaExt {
    fn fragment_shader() -> ShaderRef {
        "shaders/lava.wesl".into()
    }
}

pub type LavaMat = ExtendedMaterial<StandardMaterial, LavaExt>;

#[derive(Resource, Default)]
pub struct LavaShared {
    pub mat: Option<Handle<LavaMat>>,
}

fn shared(ecs: &mut Ecs) -> Handle<LavaMat> {
    if let Some(h) = ecs.resource::<LavaShared>().mat.clone() {
        return h;
    }
    let m = LavaMat {
        base: StandardMaterial { base_color: Color::WHITE, perceptual_roughness: 0.85, metallic: 0.0, ..default() },
        extension: LavaExt { u: LavaU::default() },
    };
    let h = ecs.resource_mut::<Assets<LavaMat>>().add(m);
    ecs.resource_mut::<LavaShared>().mat = Some(h.clone());
    h
}

/// troca o material das faces da caixa pelo da lava
pub fn lava_box(ecs: &mut Ecs, parent: Entity, _min: Vec3, _max: Vec3) {
    let h = shared(ecs);
    let kids: Vec<Entity> = ecs.get::<Children>(parent).map(|c| c.iter().collect()).unwrap_or_default();
    for k in kids {
        ecs.entity_mut(k).remove::<MeshMaterial3d<StandardMaterial>>().insert(MeshMaterial3d(h.clone()));
    }
}

/// brasas que sobem da superfície (y = top) de um retângulo de lava; quantidade pela área
pub fn embers(ecs: &mut Ecs, parent: Entity, min: Vec3, max: Vec3, top: f32) {
    let area = (max.x - min.x) * (max.z - min.z);
    let n = (area * 0.12).clamp(10.0, 320.0).round() as usize;
    let mut r = rand::rng();
    let pts: Vec<Vec3> = (0..n).map(|_| Vec3::new(r.random_range(min.x..=max.x), top, r.random_range(min.z..=max.z))).collect();
    let seeds: Vec<[f32; 4]> = (0..n).map(|_| [r.random(), r.random(), r.random(), r.random()]).collect();
    let mesh = fx::particles(n, |i| pts[i], |i| seeds[i]);
    let mh = ecs.resource_mut::<Assets<Mesh>>().add(mesh);
    let mat = fx_mat(ecs, Fx::new(fx::kind::EMBERS));
    let e = put_mesh(ecs, parent, mh, mat, Transform::default());
    ecs.entity_mut(e).insert(bevy::camera::visibility::NoFrustumCulling);
}

/// o tempo do padrão (para com o tempo do mundo)
pub fn set_time(ecs: &mut Ecs, t: f32) {
    if let Some(h) = ecs.resource::<LavaShared>().mat.clone() {
        if let Some(mut m) = ecs.resource_mut::<Assets<LavaMat>>().get_mut(&h) {
            m.extension.u.time = t;
        }
    }
    let _ = hex(0);
}
