//! Cópias "queimando" de objetos que somem (Dissolver de fx.js): o modelo se desfaz em buracos de
//! ruído com a borda acesa (azul na grade, laranja na fornalha) e solta faíscas; ~1,2 s. Com
//! `appear`, ao contrário (o objeto se materializa: mudança vinda do passado).

use crate::fx::{kind, Fx};
use crate::game::Game;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;

pub const FIZZLE: Vec3 = Vec3::new(0.45, 0.8, 1.0);
pub const BURN: Vec3 = Vec3::new(1.0, 0.45, 0.1);
pub const TIME: Vec3 = Vec3::new(0.75, 0.45, 1.0);

pub struct Dissolve {
    ghost: Entity,
    mat: Handle<Fx>,
    sparks: Vec<(Entity, Vec3)>,
    spark_mat: Handle<Fx>,
    color: Vec3,
    t: f32,
    appear: bool,
}

impl Game {
    /// pede o efeito para o modelo `mesh` na pose `at` (feito no fim do quadro)
    pub fn dissolve_at(&mut self, mesh: Entity, at: Transform, color: Vec3, appear: bool) {
        self.dissolve_pending.push((mesh, at, color, appear));
    }

    /// o objeto `k` some (ou aparece) onde está agora
    pub fn dissolve(&mut self, k: usize, color: Vec3, appear: bool) {
        let p = &self.props.list[k];
        let at = Transform::from_translation(p.quat * p.mesh_offset + p.pos).with_rotation(p.quat).with_scale(Vec3::splat(p.mesh_scale));
        self.dissolve_at(p.mesh, at, color, appear);
    }

    pub fn update_dissolves(&mut self, ecs: &mut Ecs, dt: f32) {
        let root = self.world.root();
        for (src, at, color, appear) in std::mem::take(&mut self.dissolve_pending) {
            if ecs.get_entity(src).is_err() {
                continue;
            }
            let mut fx = Fx::new(kind::DISSOLVE).opaque();
            fx.u.color = color.extend(1.0);
            fx.u.p0.x = if appear { 1.0 } else { 0.0 };
            let mat = crate::world::fx_mat(ecs, fx);
            let gt = ecs.get::<GlobalTransform>(src).copied().unwrap_or_default();
            let ghost = ecs.spawn((at, Visibility::Inherited, ChildOf(root))).id();
            let inv = gt.affine().inverse();
            for m in crate::glb::meshes_of(ecs, src) {
                // (os brilhos e linhas do modelo não entram)
                if ecs.get::<MeshMaterial3d<Fx>>(m).is_some() {
                    continue;
                }
                let Some(mesh) = ecs.get::<Mesh3d>(m).cloned() else { continue };
                let Some(mg) = ecs.get::<GlobalTransform>(m).copied() else { continue };
                let local = Transform::from_matrix(Mat4::from(inv * mg.affine()));
                ecs.spawn((mesh, MeshMaterial3d(mat.clone()), local, ChildOf(ghost)));
            }
            if std::env::var("PORTAL3_DEBUG").is_ok() {
                eprintln!("dissolver: {} malhas em {:?}", crate::glb::meshes_of(ecs, ghost).len(), at.translation);
            }
            // faíscas saindo do objeto
            let c = at.translation;
            let spark_mat = crate::world::fx_mat(ecs, Fx::new(kind::SPRITE).color(LinearRgba::new(color.x * 3.0, color.y * 3.0, color.z * 3.0, 1.0)));
            let quad = crate::world::mesh_h(ecs, &crate::geo::plane_geo(1.0, 1.0));
            let mut sparks = vec![];
            for _ in 0..40 {
                let r = || rand::random::<f32>();
                let p = c + Vec3::new(r() - 0.5, r() - 0.5, r() - 0.5) * 0.5;
                let v = Vec3::new((r() - 0.5) * 1.2, r() * 1.5 + 0.3, (r() - 0.5) * 1.2);
                let e = crate::world::put_mesh(ecs, root, quad.clone(), spark_mat.clone(), Transform::from_translation(p).with_scale(Vec3::splat(0.04)));
                sparks.push((e, v));
            }
            self.dissolves.push(Dissolve { ghost, mat, sparks, spark_mat, color, t: 0.0, appear });
        }
        self.dissolves.retain_mut(|d| {
            d.t += dt;
            let k = d.t / 1.2;
            if let Some(mut m) = ecs.resource_mut::<Assets<Fx>>().get_mut(&d.mat) {
                m.u.p0.x = if d.appear { (1.0 - k).max(0.0) } else { k.min(1.0) };
            }
            if !d.appear {
                if let Some(mut tr) = ecs.get_mut::<Transform>(d.ghost) {
                    tr.translation.y += dt * 0.25;
                }
            }
            for (e, v) in &mut d.sparks {
                *v *= 1.0 - dt * 1.5;
                if let Some(mut tr) = ecs.get_mut::<Transform>(*e) {
                    tr.translation += *v * dt;
                }
            }
            let a = (1.0 - k).max(0.0);
            if let Some(mut m) = ecs.resource_mut::<Assets<Fx>>().get_mut(&d.spark_mat) {
                m.u.color = (d.color * 3.0 * a).extend(a);
            }
            if k >= 1.0 {
                for e in std::iter::once(d.ghost).chain(d.sparks.iter().map(|s| s.0)) {
                    if let Ok(x) = ecs.get_entity_mut(e) {
                        x.despawn();
                    }
                }
                return false;
            }
            true
        });
    }
}
