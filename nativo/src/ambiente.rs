//! Poeira no ar e sombras de contato (fx.js: dust, ContactShadows): pontinhos claros flutuando num
//! cubo de 14 m em volta da câmera (só na vista principal; param junto com o relógio do tempo) e
//! uma mancha escura no chão embaixo de cada objeto, no sentido da gravidade.

use crate::fx::{kind, particles, Fx};
use crate::game::Game;
use bevy::asset::RenderAssetUsages;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

#[derive(Default)]
pub struct Ambient {
    dust: Option<(Entity, Handle<Fx>)>,
    root: Option<Entity>,
    blob: Option<(Handle<Image>, Handle<Mesh>)>,
    shadows: Vec<(Entity, Handle<StandardMaterial>)>,
}

/// mancha redonda: preto no meio, sumindo na borda
fn blob_image() -> Image {
    let n = 128usize;
    let mut px = vec![0u8; n * n * 4];
    for y in 0..n {
        for x in 0..n {
            let d = (((x as f32 + 0.5 - 64.0).powi(2) + (y as f32 + 0.5 - 64.0).powi(2)).sqrt() / 64.0).min(1.0);
            // degradê: 1 → 0,6 (em 0,45) → 0
            let a = if d < 0.45 { 1.0 - 0.4 * d / 0.45 } else { 0.6 * (1.0 - (d - 0.45) / 0.55) };
            px[(y * n + x) * 4 + 3] = (a.clamp(0.0, 1.0) * 255.0) as u8;
        }
    }
    Image::new(Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 1 }, TextureDimension::D2, px, TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::default())
}

impl Game {
    pub fn update_ambient(&mut self, ecs: &mut Ecs) {
        let root = self.world.root();
        let a = &mut self.ambient;
        // a raiz do mundo muda a cada fase: tudo refeito
        if a.root != Some(root) {
            *a = Ambient { blob: a.blob.clone(), root: Some(root), ..default() };
        }
        // ---- poeira
        if a.dust.is_none() {
            let mesh = particles(700, |_| Vec3::ZERO, |_| [rand::random(), rand::random(), rand::random(), rand::random()]);
            let mh = ecs.resource_mut::<Assets<Mesh>>().add(mesh);
            let mat = crate::world::fx_mat(ecs, Fx::new(kind::DUST));
            let e = ecs.spawn((Mesh3d(mh), MeshMaterial3d(mat.clone()), Transform::default(), bevy::camera::visibility::NoFrustumCulling, bevy::camera::visibility::RenderLayers::layer(1), ChildOf(root))).id();
            a.dust = Some((e, mat));
        }
        if let Some((_, m)) = &a.dust {
            let t = self.relogio.as_ref().map(|c| c.vt).unwrap_or(self.t);
            let cam = self.cam.translation;
            if let Some(mut f) = ecs.resource_mut::<Assets<Fx>>().get_mut(m) {
                f.u.p0 = cam.extend(14.0);
                f.u.time = t;
            }
        }
        // ---- sombras de contato
        if a.blob.is_none() {
            let img = ecs.resource_mut::<Assets<Image>>().add(blob_image());
            let quad = crate::world::mesh_h(ecs, &crate::geo::plane_geo(1.0, 1.0));
            a.blob = Some((img, quad));
        }
        let (img, quad) = a.blob.clone().unwrap();
        let grav = self.gravity();
        let level = self.level.is_some() && !self.menu;
        let n = if level { self.props.list.len() } else { 0 };
        while self.ambient.shadows.len() < n {
            let mat = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color: Color::BLACK, base_color_texture: Some(img.clone()), unlit: true, alpha_mode: AlphaMode::Blend, depth_bias: 4.0, double_sided: true, cull_mode: None, ..default() });
            let e = ecs.spawn((Mesh3d(quad.clone()), MeshMaterial3d(mat.clone()), Transform::default(), Visibility::Hidden, ChildOf(root))).id();
            self.ambient.shadows.push((e, mat));
        }
        for (i, (e, m)) in self.ambient.shadows.clone().into_iter().enumerate() {
            let Some(p) = self.props.list.get(i).filter(|p| !p.gone && level) else {
                ecs.entity_mut(e).insert(Visibility::Hidden);
                continue;
            };
            let mut down = grav.at(p.pos);
            if down.length_squared() < 1e-6 {
                down = Vec3::NEG_Y;
            }
            let down = down.normalize();
            let size = if p.kind == crate::props::Kind::Turret { 1.0 } else { 0.95 };
            let max = 4.0;
            let Some(hit) = self.world.raycast(p.pos, down, max) else {
                ecs.entity_mut(e).insert(Visibility::Hidden);
                continue;
            };
            let k = (1.0 - hit.dist / max).max(0.0);
            let at = hit.point + hit.normal * 0.004;
            let rot = Quat::from_rotation_arc(Vec3::Z, hit.normal);
            ecs.entity_mut(e).insert((Transform::from_translation(at).with_rotation(rot).with_scale(Vec3::splat(size * (1.0 + (1.0 - k) * 0.8))), Visibility::Inherited));
            if let Some(mut mm) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&m) {
                mm.base_color = Color::BLACK.with_alpha(0.62 * k * k);
            }
        }
    }
}

