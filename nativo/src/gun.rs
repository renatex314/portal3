//! A arma de portais em primeira pessoa (a Mark III de models.js e o animateGun de main.js).
//!
//! Ela é desenhada por uma câmera própria (camada GUN_LAYER), por cima da imagem do mundo e com
//! a profundidade limpa: nada do mundo a cobre (como a profundidade "espremida" da versão web).
//! As luzes do mundo também iluminam a camada da arma.

use crate::fx::{kind, particles, Fx};
use crate::game::Game;
use crate::geo::plane_geo;
use crate::raster::Canvas;
use crate::world::{fx_mat, mesh_h, point_light, put_mesh};
use crate::{HeadlessTarget, MainCam, EV100, GRADE_EV};
use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::RenderLayers;
use bevy::camera::RenderTarget;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::ecs::world::World as Ecs;
use bevy::light::GeneratedEnvironmentMapLight;
use bevy::mesh::PrimitiveTopology;
use bevy::prelude::*;
use rand::Rng;
use std::collections::HashMap;

pub const GUN_LAYER: usize = 10;
const ARC_N: usize = 12;
const PAIRS: [(usize, usize); 4] = [(0, 3), (3, 1), (1, 2), (2, 0)];

/// estado da animação (o GUN de main.js)
#[derive(Default, Clone)]
pub struct GunAnim {
    pub look: Vec2,
    pub sway: Vec2,
    pub sway_v: Vec2,
    pub land: f32,
    pub land_v: f32,
    pub open: f32,
    pub walk: f32,
    pub heat: f32,
    pub pulse: f32,
    pub holo_t: f32,
    pub recoil: f32,
    /// cor do último disparo (×3)
    pub base: Vec3,
    pub arc_clock: f32,
}

#[derive(Resource)]
pub struct Gun {
    pub cam: Entity,
    pub root: Entity,
    parts: HashMap<String, Entity>,
    base_tf: HashMap<Entity, Transform>,
    mats: HashMap<String, Handle<StandardMaterial>>,
    plasma: Vec<Handle<Fx>>,
    conduit: Vec<Handle<Fx>>,
    motes: Option<Handle<Fx>>,
    /// brilhos (sprites): material e k
    halos: Vec<(Handle<Fx>, f32)>,
    win_halo: Option<Handle<Fx>>,
    tip_glow: Option<(Entity, Handle<Fx>)>,
    arcs: Option<(Handle<Mesh>, Handle<StandardMaterial>)>,
    holo: Option<(Handle<Image>, Canvas)>,
    light: Entity,
    pub anim: GunAnim,
}

/// cor (linear) de um StandardMaterial
fn set_rgb(ecs: &mut Ecs, h: &Handle<StandardMaterial>, c: Vec3) {
    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(h) {
        let a = m.base_color.alpha();
        m.base_color = Color::LinearRgba(LinearRgba::new(c.x, c.y, c.z, a));
    }
}

fn layer_all(ecs: &mut Ecs, e: Entity, l: &RenderLayers) {
    let mut stack = vec![e];
    while let Some(x) = stack.pop() {
        ecs.entity_mut(x).insert(l.clone());
        if let Some(ch) = ecs.get::<Children>(x) {
            stack.extend(ch.iter());
        }
    }
}

pub fn setup_gun(ecs: &mut Ecs) {
    let layer = RenderLayers::layer(GUN_LAYER);
    // câmera da arma: depois da principal, sem limpar a cor, profundidade limpa
    // os modelos da versão web têm o próprio mapa de reflexo (a sala, ~0,55): mais brilho que o do cenário
    let env = Some(crate::env::environment_cubemap_k(&mut ecs.resource_mut::<Assets<Image>>(), 0.55));
    let target = ecs.get_resource::<HeadlessTarget>().cloned();
    let mut cam = ecs.spawn((
        Camera3d::default(),
        // câmera sem HDR (o tom é aplicado nos próprios materiais): desenha a arma num fundo transparente
        // e a imagem é composta por cima da do mundo (que já passou pelo tom uma vez só)
        Camera {
            order: 1,
            clear_color: ClearColorConfig::Custom(Color::NONE),
            output_mode: bevy::camera::CameraOutputMode::Write { blend_state: Some(bevy::render::render_resource::BlendState::PREMULTIPLIED_ALPHA_BLENDING), clear_color: ClearColorConfig::None },
            ..default()
        },
        Tonemapping::AcesFitted,
        bevy::camera::Exposure { ev100: EV100 },
        bevy::render::view::ColorGrading { global: bevy::render::view::ColorGradingGlobal { exposure: GRADE_EV, ..default() }, ..default() },
        Projection::Perspective(PerspectiveProjection { fov: 75f32.to_radians(), near: 0.01, ..default() }),
        Msaa::Sample4,
        Transform::default(),
        layer.clone(),
        Name::new("câmera da arma"),
    ));
    if let Some(env) = env {
        let k = std::env::var("PORTAL3_GUNENV").ok().and_then(|v| v.parse().ok()).unwrap_or(1.8); // (calibrado contra a versão web)
        cam.insert(GeneratedEnvironmentMapLight { environment_map: env, intensity: k, ..default() });
    }
    if let Some(t) = target {
        cam.insert(RenderTarget::Image(t.0.clone().into()));
    }
    let cam = cam.id();
    let (root, parts, mats) = crate::glb::spawn_model_full(ecs, "gun");
    ecs.entity_mut(root).insert((ChildOf(cam), Transform::from_xyz(0.21, -0.19, -0.5).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.05, 0.09, 0.0)).with_scale(Vec3::splat(0.55))));
    // shaders da arma: o glTF trouxe um material provisório; aqui viram os efeitos
    let mut plasma = vec![];
    let mut conduit = vec![];
    let mut motes = None;
    // os nós com shader (pelos extras) — a malha é filha direta do nó
    let model = ecs.resource::<crate::glb::Models>().cache["gun"].clone();
    let mut unnamed_shader_nodes = vec![];
    for n in &model.nodes {
        if let Some(sh) = n.extras.get("mat").and_then(|m| m.get("shader")).and_then(|v| v.as_str()) {
            unnamed_shader_nodes.push((n.prims.iter().map(|p| p.0.clone()).collect::<Vec<_>>(), sh.to_string()));
        }
    }
    // troca o material das malhas com aquelas formas
    let mut q = ecs.query::<(Entity, &Mesh3d)>();
    let meshes: Vec<(Entity, Handle<Mesh>)> = q.iter(ecs).map(|(e, m)| (e, m.0.clone())).collect();
    for (e, mh) in meshes {
        let Some((_, sh)) = unnamed_shader_nodes.iter().find(|(ms, _)| ms.contains(&mh)) else { continue };
        let m = match sh.as_str() {
            "plasma" => {
                let h = fx_mat(ecs, Fx::new(kind::GUN_PLASMA).opaque());
                plasma.push(h.clone());
                h
            }
            "conduit" => {
                let h = fx_mat(ecs, Fx::new(kind::GUN_CONDUIT).opaque());
                conduit.push(h.clone());
                h
            }
            _ => continue,
        };
        ecs.entity_mut(e).remove::<MeshMaterial3d<StandardMaterial>>().insert(MeshMaterial3d(m));
    }
    // partículas da boca
    if let Some(&pn) = parts.get("points") {
        let h = fx_mat(ecs, Fx::new(kind::GUN_MOTES));
        let mut rng = rand::rng();
        let mesh = particles(30, |_| Vec3::ZERO, |_| [rng.random::<f32>(), 0.0, 0.0, 1.0]);
        let mh = ecs.resource_mut::<Assets<Mesh>>().add(mesh);
        let e = put_mesh(ecs, pn, mh, h.clone(), Transform::default());
        ecs.entity_mut(e).insert(bevy::camera::visibility::NoFrustumCulling);
        motes = Some(h);
    }
    // brilhos (sprites): quadrados virados para a câmera na cor do brilho
    let quad = mesh_h(ecs, &plane_geo(1.0, 1.0));
    let mut halos = vec![];
    let mut win_halo = None;
    let mut tip_glow = None;
    for (name, &e) in &parts {
        let x = crate::glb::node_extras(ecs, "gun", name);
        if x.get("sprite").is_none() {
            continue;
        }
        let f = |k: &str| x.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
        let m = fx_mat(ecs, Fx::new(kind::SPRITE).color(LinearRgba::new(f("cr"), f("cg"), f("cb"), 1.0)));
        let s = put_mesh(ecs, e, quad.clone(), m.clone(), Transform::from_scale(Vec3::new(f("sx"), f("sy"), 1.0)));
        if name == "tipGlow" {
            tip_glow = Some((s, m));
        } else if name == "sprite_0" {
            win_halo = Some(m);
        } else {
            halos.push((m, f("k")));
        }
    }
    // arcos elétricos: malha própria (as posições mudam)
    let arcs = parts.get("arcs").map(|&e| {
        let n = PAIRS.len() * (ARC_N - 1) * 2;
        let mesh = Mesh::new(PrimitiveTopology::LineList, RenderAssetUsages::default()).with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0f32; 3]; n]);
        let mh = ecs.resource_mut::<Assets<Mesh>>().add(mesh);
        let m = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color: Color::BLACK, unlit: true, alpha_mode: AlphaMode::Add, ..default() });
        for c in crate::glb::meshes_of(ecs, e) {
            ecs.entity_mut(c).despawn();
        }
        let a = put_mesh(ecs, e, mh.clone(), &m, Transform::default());
        ecs.entity_mut(a).insert(bevy::camera::visibility::NoFrustumCulling);
        (mh, m)
    });
    // painel holográfico: imagem redesenhada ~12 vezes por segundo
    let holo = parts.get("holo").map(|&e| {
        let cv = Canvas::new(256, 128);
        let mut img = cv.image(true, false);
        img.asset_usage = RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD;
        let ih = ecs.resource_mut::<Assets<Image>>().add(img);
        for c in crate::glb::meshes_of(ecs, e) {
            let h = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial {
                base_color_texture: Some(ih.clone()),
                unlit: true,
                alpha_mode: AlphaMode::Blend,
                // (textura de canvas do three.js: v para cima)
                uv_transform: bevy::math::Affine2::from_scale_angle_translation(Vec2::new(1.0, -1.0), 0.0, Vec2::new(0.0, 1.0)),
                double_sided: true,
                cull_mode: None,
                ..default()
            });
            ecs.entity_mut(c).insert(MeshMaterial3d(h));
        }
        (ih, cv)
    });
    let light = ecs.spawn((point_light(crate::mats::hex(0x9fd8ff), 0.6, 1.2), Transform::from_xyz(0.16, -0.04, -1.2), ChildOf(cam), layer.clone())).id();
    layer_all(ecs, root, &layer);
    let base_tf = parts.values().filter_map(|&e| ecs.get::<Transform>(e).map(|t| (e, *t))).collect();
    ecs.insert_resource(Gun {
        cam,
        root,
        parts,
        base_tf,
        mats,
        plasma,
        conduit,
        motes,
        halos,
        win_halo,
        tip_glow,
        arcs,
        holo,
        light,
        anim: GunAnim { pulse: -1.0, base: Vec3::new(0.5, 1.6, 3.2), ..default() },
    });
}

/// as luzes do mundo também iluminam a arma (que fica numa camada só dela)
pub fn light_layers(mut commands: Commands, q: Query<Entity, (With<PointLight>, Without<RenderLayers>)>) {
    for e in &q {
        commands.entity(e).insert(RenderLayers::from_layers(&[0, GUN_LAYER, crate::characters::BODY_LAYER, crate::relogio::PRESENT_LAYER, crate::relogio::PAST_LAYER]));
    }
}

/// o quadro da arma (animateGun + o animate da Mark III)
pub fn update_gun(ecs: &mut Ecs) {
    if std::env::var("PORTAL3_SEMARMA").is_ok() {
        return;
    }
    if !ecs.contains_resource::<Gun>() {
        setup_gun(ecs);
    }
    let dt = ecs.resource::<Time>().delta_secs().min(0.05);
    let (cam_tr, fov) = {
        let mut q = ecs.query_filtered::<(&Transform, &Projection), With<MainCam>>();
        let Ok((t, p)) = q.single(ecs) else { return };
        (*t, if let Projection::Perspective(pp) = p { pp.fov } else { 1.3 })
    };
    let (t, input, grounded, bob, held, gun_mode, portals_on, look, recoil_kick) = {
        let mut g = ecs.resource_mut::<Game>();
        let look = std::mem::take(&mut g.gun_look);
        let kick = std::mem::take(&mut g.gun_kick);
        (g.t, g.input, g.player.grounded, g.player.bob, g.held.is_some(), g.gun_mode.clone(), [g.portals.list[0].placed, g.portals.list[1].placed], look, kick)
    };
    ecs.resource_scope(|ecs, mut gun: Mut<Gun>| {
        let gun = &mut *gun;
        let visible = {
            let g = ecs.resource::<Game>();
            gun_mode != "none" && !g.menu && !g.paused && !g.completed && !g.editing
        };
        ecs.entity_mut(gun.root).insert(if visible { Visibility::Inherited } else { Visibility::Hidden });
        if let Some(mut tr) = ecs.get_mut::<Transform>(gun.cam) {
            *tr = cam_tr;
        }
        if let Some(mut p) = ecs.get_mut::<Projection>(gun.cam) {
            if let Projection::Perspective(pp) = &mut *p {
                pp.fov = fov;
            }
        }
        if recoil_kick.is_some() {
            if let Some(mut st) = ecs.get_resource_mut::<crate::post::PostState>() {
                st.shockwave(false);
            }
        }
        let a = &mut gun.anim;
        if let Some(c) = recoil_kick {
            a.recoil = 1.0;
            a.pulse = 0.0;
            a.heat = (a.heat + 0.3).min(1.0);
            a.base = c * 3.0;
            if let Some(mut l) = ecs.get_mut::<PointLight>(gun.light) {
                l.color = Color::linear_rgb(c.x, c.y, c.z);
            }
        }
        a.look += look;
        a.recoil = (a.recoil - dt * 6.0).max(0.0);
        // mola: a arma fica um pouco para trás quando a câmera gira e volta balançando
        let tx = (-a.look.x * 0.0007).clamp(-0.05, 0.05);
        let ty = (a.look.y * 0.0007).clamp(-0.04, 0.04);
        a.look = Vec2::ZERO;
        a.sway_v.x += ((tx - a.sway.x) * 160.0 - a.sway_v.x * 16.0) * dt;
        a.sway_v.y += ((ty - a.sway.y) * 160.0 - a.sway_v.y * 16.0) * dt;
        a.sway += a.sway_v * dt;
        a.land_v += (-a.land * 220.0 - a.land_v * 15.0) * dt;
        a.land += a.land_v * dt;
        let moving = (input.f || input.b || input.l || input.r) && grounded;
        a.walk += ((if moving { 1.0 } else { 0.0 }) - a.walk) * (dt * 8.0).min(1.0);
        a.open += ((if held { 1.0 } else { 0.0 }) - a.open) * (dt * 9.0).min(1.0);
        let b = bob * 0.5;
        let bx = b.sin() * 0.012 * a.walk;
        let by = -b.cos().abs() * 0.01 * a.walk;
        let breathe = (t * 1.7).sin() * 0.0025;
        let pos = Vec3::new(0.21 + a.sway.x + bx, -0.19 + a.sway.y + by + breathe + a.land + a.recoil * 0.015 + a.open * 0.01, -0.5 + a.recoil * 0.06 - a.open * 0.02);
        let rot = Quat::from_euler(EulerRot::XYZ, 0.05 + a.recoil * 0.22 + a.sway.y * 1.5 - a.land * 1.2, 0.09 + a.sway.x * 2.0, -a.sway.x * 2.5 + (t * 1.1).sin() * 0.008 + bx * 0.8);
        if let Some(mut tr) = ecs.get_mut::<Transform>(gun.root) {
            tr.translation = pos;
            tr.rotation = rot;
        }
        let (recoil, open) = (a.recoil, a.open);
        if let Some(&c) = gun.parts.get("coil") {
            if let Some(mut tr) = ecs.get_mut::<Transform>(c) {
                tr.rotate_local_z(dt * (1.5 + open * 14.0 + recoil * 25.0));
            }
        }
        let base = a.base;
        // LEDs de carga: correm quando segurando, ficam acesos parados (×2,6 acima do limiar do bloom)
        for i in 0..3 {
            let on = if open > 0.5 { if (t * 10.0).floor() as i32 % 3 == i { 1.6 } else { 0.3 } } else { 1.0 };
            if let Some(h) = gun.mats.get(&format!("leds_{i}")).cloned() {
                set_rgb(ecs, &h, base * 0.5 * on * 2.6);
            }
        }
        // condutos: fluxo contínuo e um pulso correndo para a frente depois do tiro
        if a.pulse >= 0.0 {
            a.pulse += dt * 4.5;
        }
        if a.pulse > 1.3 {
            a.pulse = -1.0;
        }
        let pulse = a.pulse;
        // calor: cada tiro esquenta, as aletas abrem e o brilho de dentro esfria aos poucos
        a.heat = (a.heat - dt * 0.45).max(0.0);
        let heat = a.heat;
        for i in 0..6 {
            if let Some(&v) = gun.parts.get(&format!("vents_{i}")) {
                let side = if i < 3 { -1.0 } else { 1.0 };
                if let Some(mut tr) = ecs.get_mut::<Transform>(v) {
                    tr.rotation = Quat::from_rotation_z(side * (heat * 1.4).min(1.0) * 0.9);
                }
            }
        }
        if let Some(h) = gun.mats.get("heatMat").cloned() {
            set_rgb(ecs, &h, Vec3::new(2.4 * heat, 0.7 * heat * heat, 0.08 * heat));
        }
        // plasma na ponta
        if let Some((e, m)) = gun.tip_glow.clone() {
            let s = 0.05 + rand::random::<f32>() * 0.012 + recoil * 0.14 + open * 0.03;
            if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                tr.scale = Vec3::new(s, s, 1.0);
            }
            if let Some(mut fx) = ecs.resource_mut::<Assets<Fx>>().get_mut(&m) {
                fx.u.color = (base * 0.35).extend(1.0);
            }
        }
        // ---- efeitos da Mark III
        let slow = 0.0f32;
        let beat = (0.5 + 0.5 * (t * 3.2).sin()).powi(3);
        let slow_col = Vec3::new(0.8, 0.55, 2.6) * (1.0 + beat * 0.8);
        {
            let mut fx = ecs.resource_mut::<Assets<Fx>>();
            for h in &gun.plasma {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.color = (base * 0.45).lerp(slow_col * 0.45, slow).extend(1.0);
                    m.u.p0.x = recoil * 1.6 + open * 0.4;
                }
            }
            for h in &gun.conduit {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.color = (base * 0.45 * (1.0 + open * 0.6)).lerp(slow_col * 0.55, slow).extend(1.0) * 2.3;
                    m.u.p0.x = pulse;
                }
            }
            if let Some(h) = &gun.motes {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.color = (base * 0.5).extend(1.0);
                    m.u.p0.x = (open + recoil * 2.0).min(1.5);
                }
            }
            let glow_col = slow_col.lerp(base, 1.0 - slow);
            for (h, k) in &gun.halos {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.color = (glow_col * *k * (1.0 + recoil * 1.5 + open * 0.5) * (0.85 + 0.15 * (t * 5.0).sin())).extend(1.0);
                }
            }
            if let Some(h) = &gun.win_halo {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.color = (slow_col * 0.35 * slow * (0.6 + 0.4 * beat)).extend(1.0);
                }
            }
        }
        if let Some(h) = gun.mats.get("innerGlow").cloned() {
            set_rgb(ecs, &h, base * (0.24 + 0.05 * (t * 2.0).sin() + recoil * 0.3));
        }
        let hot = (recoil * 1.8 + open * 0.6 + heat * 0.5 + 0.05 + 0.04 * (t * 4.0).sin()).min(1.6);
        if let Some(h) = gun.mats.get("copper").cloned() {
            if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&h) {
                let e = base * 0.045 * hot;
                m.emissive = LinearRgba::rgb(e.x, e.y, e.z);
            }
        }
        for i in 0..4 {
            if let Some(&rod) = gun.parts.get(&format!("rod_{i}")) {
                let b = gun.base_tf.get(&rod).map(|t| t.translation).unwrap_or_default();
                let j = open * 0.0015 * (t * 61.0 + i as f32 * 2.0).sin();
                if let Some(mut tr) = ecs.get_mut::<Transform>(rod) {
                    tr.translation = Vec3::new(b.x + j, b.y + j * 0.7, b.z + recoil * 0.012 * (1.0 + (i % 2) as f32 * 0.4));
                }
            }
        }
        // arcos elétricos entre as pontas vizinhas
        let power = (recoil * 1.4 + open * 0.85).min(1.0);
        let mut rng = rand::rng();
        let idle = if rng.random::<f32>() < 0.05 { 0.4 } else { 0.0 };
        let op = power.max(idle) * (0.6 + 0.4 * rng.random::<f32>());
        a.arc_clock -= dt;
        if let Some((mh, m)) = gun.arcs.clone() {
            let c = (base * 1.4 + Vec3::splat(0.5)) * op;
            set_rgb(ecs, &m, c);
            if op > 0.01 && a.arc_clock <= 0.0 {
                a.arc_clock = 1.0 / 40.0;
                // pontas das bobinas (no espaço da arma): base da bobina + comprimento
                let tips: Vec<Vec3> = (0..4)
                    .map(|i| {
                        let rod = gun.parts.get(&format!("rod_{i}")).and_then(|e| ecs.get::<Transform>(*e)).map(|t| t.translation).unwrap_or_default();
                        let len = if i < 2 { 0.2 } else { 0.16 };
                        rod + Vec3::new(0.0, 0.0, -len - 0.012)
                    })
                    .collect();
                let mut pos = vec![];
                for (ia, ib) in PAIRS {
                    let (pa, pb) = (tips[ia], tips[ib]);
                    let mut prev: Option<Vec3> = None;
                    for k in 0..ARC_N {
                        let f = k as f32 / (ARC_N - 1) as f32;
                        let mut v = pa.lerp(pb, f);
                        let amp = (f * std::f32::consts::PI).sin() * 0.02 * (0.6 + power);
                        v.x += (rng.random::<f32>() - 0.5) * amp;
                        v.y += (rng.random::<f32>() - 0.5) * amp;
                        v.z += (rng.random::<f32>() - 0.5) * amp * 0.6 - (f * std::f32::consts::PI).sin() * 0.012;
                        if let Some(p) = prev {
                            pos.push(p.to_array());
                            pos.push(v.to_array());
                        }
                        prev = Some(v);
                    }
                }
                if let Some(mut mesh) = ecs.resource_mut::<Assets<Mesh>>().get_mut(&mh) {
                    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos);
                }
            }
        }
        // painel holográfico (~12 vezes por segundo)
        a.holo_t -= dt;
        if a.holo_t <= 0.0 {
            a.holo_t = 1.0 / 12.0;
            if let Some((ih, cv)) = gun.holo.as_mut() {
                draw_holo(cv, portals_on, held, &gun_mode, t);
                let data = cv.rgba8();
                if let Some(mut img) = ecs.resource_mut::<Assets<Image>>().get_mut(&*ih) {
                    img.data = Some(data);
                }
            }
        }
    });
}

/// o painel holográfico da arma (drawGunHolo)
fn draw_holo(c: &mut Canvas, on: [bool; 2], holding: bool, mode: &str, t: f32) {
    use crate::raster::css;
    let fonts = holo_fonts();
    let (w, h) = (256.0, 128.0);
    c.clear();
    c.fill_rect(3.0, 3.0, w - 6.0, h - 6.0, css("rgba(4,18,32,0.62)"));
    let mut y = 4.0;
    while y < h {
        c.fill_rect(3.0, y, w - 6.0, 1.0, css("rgba(120,200,255,0.06)"));
        y += 4.0;
    }
    c.stroke_rect(3.0, 3.0, w - 6.0, h - 6.0, 2.0, css("rgba(140,210,255,0.55)"));
    for (x, y) in [(3.0, 3.0), (w - 13.0, 3.0), (3.0, h - 6.0), (w - 13.0, h - 6.0)] {
        c.fill_rect(x, y, 10.0, 3.0, css("rgba(140,210,255,0.9)"));
    }
    c.text(&fonts.1, if mode == "none" { "SEM ARMA" } else { "PORTAIS" }, 18.0, 12.0, 24.0, css("rgba(170,225,255,0.95)"));
    let cols = [css("#26f2ff"), css("#ff1f1a")];
    let dot = |c: &mut Canvas, x: f32, lit: bool, col: [f32; 4]| {
        c.fill_ellipse(x, 50.0, 13.0, 13.0, if lit { col } else { css("rgba(255,255,255,0.08)") });
        c.stroke_arc(x, 50.0, 13.0, 0.0, std::f32::consts::TAU, 3.0, col);
        c.text(&fonts.1, if lit { "ON" } else { "--" }, 14.0, x + 19.0, 55.0, css("rgba(200,230,255,0.9)"));
    };
    dot(c, 26.0, on[0], cols[0]);
    if mode == "both" {
        dot(c, 140.0, on[1], cols[1]);
    }
    // onda de energia
    let mut pts = vec![];
    let mut x = 12.0;
    while x < w - 12.0 {
        let k: f32 = (x - 12.0) / (w - 24.0);
        let yy = 82.0 + (k * 18.0 - t * 8.0).sin() * if holding { 9.0 } else { 4.0 } * (k * std::f32::consts::PI).sin() + (k * 51.0 + t * 13.0).sin() * 1.5;
        pts.push((x, yy));
        x += 3.0;
    }
    c.stroke_path(&pts, 3.0, if holding { css("rgba(255,220,120,0.9)") } else { css("rgba(120,200,255,0.8)") });
    // barra do tempo lento (cheia: o tempo lento ainda não foi portado)
    let slow = 1.0;
    c.fill_rect(12.0, 104.0, w - 24.0, 10.0, css("rgba(140,210,255,0.18)"));
    c.fill_rect(12.0, 104.0, (w - 24.0) * slow, 10.0, if slow < 0.25 { css("rgba(255,120,90,0.9)") } else { css("rgba(150,230,255,0.85)") });
    c.text(&fonts.0, if holding { "CAMPO DE FORÇA" } else { "TEMPO" }, 10.0, w - 112.0, 100.0, css("rgba(200,230,255,0.7)"));
}

fn holo_fonts() -> &'static (ab_glyph::FontVec, ab_glyph::FontVec) {
    static F: std::sync::OnceLock<(ab_glyph::FontVec, ab_glyph::FontVec)> = std::sync::OnceLock::new();
    F.get_or_init(|| {
        let load = |n: &str| ab_glyph::FontVec::try_from_vec(std::fs::read(crate::mats::asset_dir().join("fonts").join(n)).unwrap_or_default()).expect("fonte");
        (load("IBMPlexMono-Regular.ttf"), load("IBMPlexMono-Medium.ttf"))
    })
}
