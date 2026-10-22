//! Peças com desenho PRÓPRIO deste jogo para a campanha importada (boss.js): núcleos, a máquina
//! central, a cabine do elevador, o botão de pedestal e a explosão dos foguetes.

use crate::geo::{self, Geo};
use crate::mats::hex;
use crate::world::{bas, group, put, std_mat};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use std::f32::consts::{FRAC_PI_2, PI, TAU};

const CORE_TINT: [u32; 4] = [0x8fe3ff, 0xff5a3a, 0xffc233, 0xb07cff];

fn std_(ecs: &mut Ecs, c: u32, metal: f32, rough: f32) -> Handle<StandardMaterial> {
    std_mat(ecs, StandardMaterial { base_color: hex(c), metallic: metal, perceptual_roughness: rough, ..default() })
}

fn glow(ecs: &mut Ecs, c: u32, k: f32) -> Handle<StandardMaterial> {
    let l = hex(c).to_linear();
    bas(ecs, LinearRgba::rgb(l.red * k, l.green * k, l.blue * k))
}

/// núcleo: esfera metálica com duas faixas acesas (a cor indica o tipo)
pub fn core_model(ecs: &mut Ecs, parent: Entity, ty: usize) -> Entity {
    let g = group(ecs, parent, Transform::default());
    let shell = std_(ecs, 0xd7dbe0, 0.6, 0.35);
    put(ecs, g, &geo::sphere_geo(0.3, 32, 20), shell, Transform::default());
    let gl = glow(ecs, CORE_TINT[ty % 4], 2.2);
    for rx in [0.0, FRAC_PI_2] {
        put(ecs, g, &geo::torus_geo(0.305, 0.022, 8, 48), gl.clone(), Transform::from_rotation(Quat::from_rotation_x(rx)));
    }
    let cap = std_(ecs, 0x2a2c30, 0.8, 0.4);
    put(ecs, g, &geo::cylinder_geo(0.11, 0.11, 0.05, 24, 1, false), cap, Transform::from_xyz(0.0, 0.29, 0.0));
    g
}

/// máquina central: tambor escuro suspenso, anéis girando e faixa de luzes âmbar
pub struct Machine {
    pub root: Entity,
    pub rings: Vec<Entity>,
    pub amber: Handle<StandardMaterial>,
    pub stress: f32,
}

pub fn boss_machine(ecs: &mut Ecs, parent: Entity, at: Vec3) -> Machine {
    let g = group(ecs, parent, Transform::from_translation(at));
    let dark = std_(ecs, 0x24272c, 0.75, 0.45);
    let steel = std_(ecs, 0x8c939c, 0.85, 0.3);
    let amber = glow(ecs, 0xffb347, 2.4);
    for a in [0.0, FRAC_PI_2] {
        put(ecs, g, &geo::box_geo(6.0, 0.35, 0.35), steel.clone(), Transform::from_rotation(Quat::from_rotation_y(a)));
    }
    put(ecs, g, &geo::cylinder_geo(0.35, 0.5, 1.6, 20, 1, false), dark.clone(), Transform::from_xyz(0.0, -0.9, 0.0));
    put(ecs, g, &geo::cylinder_geo(1.5, 1.2, 3.2, 40, 1, false), dark.clone(), Transform::from_xyz(0.0, -3.3, 0.0));
    put(ecs, g, &geo::cylinder_geo(1.52, 1.52, 0.18, 40, 1, true), amber.clone(), Transform::from_xyz(0.0, -2.6, 0.0));
    let mut rings = vec![];
    for i in 0..3 {
        let r = put(ecs, g, &geo::torus_geo(1.9 + i as f32 * 0.35, 0.07, 10, 64), steel.clone(), Transform::from_xyz(0.0, -3.3 + (i as f32 - 1.0) * 0.9, 0.0).with_rotation(Quat::from_rotation_x(FRAC_PI_2 + (i as f32 - 1.0) * 0.25)));
        rings.push(r);
    }
    for k in 0..6 {
        let a = k as f32 / 6.0 * TAU;
        put(ecs, g, &geo::box_geo(0.12, 1.4, 0.7), steel.clone(), Transform::from_xyz(a.cos(), -5.2, a.sin()).with_rotation(Quat::from_rotation_y(-a)));
    }
    put(ecs, g, &geo::cone_geo(0.6, 1.2, 24), dark, Transform::from_xyz(0.0, -5.5, 0.0).with_rotation(Quat::from_rotation_x(PI)));
    Machine { root: g, rings, amber, stress: 0.0 }
}

pub fn animate_machine(ecs: &mut Ecs, m: &Machine, t: f32, dt: f32) {
    for (i, r) in m.rings.iter().enumerate() {
        if let Some(mut tr) = ecs.get_mut::<Transform>(*r) {
            tr.rotate_local_z(dt * (0.4 + i as f32 * 0.25) * (1.0 + m.stress * 1.5) * if i % 2 == 1 { -1.0 } else { 1.0 });
        }
    }
    let f = if m.stress > 0.0 { 0.6 + 0.4 * (t * (6.0 + m.stress * 10.0)).sin().abs() } else { 1.0 };
    if let Some(mut mm) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&m.amber) {
        mm.base_color = Color::LinearRgba(LinearRgba::rgb(2.4 * f, 1.68 * f, 0.67 * f));
    }
}

/// cabine de elevador: tubo de vidro com anéis de metal
pub fn elevator_shell(ecs: &mut Ecs, parent: Entity, at: Vec3) -> Entity {
    let g = group(ecs, parent, Transform::from_translation(at));
    let glass = std_mat(
        ecs,
        StandardMaterial { base_color: hex(0xa8dcff).with_alpha(0.14), alpha_mode: AlphaMode::Blend, perceptual_roughness: 0.05, metallic: 0.1, double_sided: true, cull_mode: None, ..default() },
    );
    let metal = std_(ecs, 0x9aa0a8, 0.8, 0.35);
    put(ecs, g, &geo::cylinder_geo(1.45, 1.45, 3.2, 40, 1, true), glass, Transform::from_xyz(0.0, 1.6, 0.0));
    for y in [0.05, 1.6, 3.15] {
        put(ecs, g, &geo::torus_geo(1.47, 0.06, 8, 48).rotate_x(FRAC_PI_2), metal.clone(), Transform::from_xyz(0.0, y, 0.0));
    }
    put(ecs, g, &geo::cylinder_geo(1.5, 1.5, 0.12, 40, 1, false), metal, Transform::from_xyz(0.0, 3.25, 0.0));
    g
}

/// botão de pedestal: base, coluna, cabeça e botão vermelho (fica verde apertado)
pub struct Switch {
    pub root: Entity,
    pub cap: Entity,
    pub cap_mat: Handle<StandardMaterial>,
    pub k: f32,
}

pub const SWITCH_CAP_Y: f32 = 1.22;

pub fn pedestal_switch(ecs: &mut Ecs, parent: Entity, at: Vec3) -> Switch {
    let g = group(ecs, parent, Transform::from_translation(at));
    let dark = std_(ecs, 0x2a2d32, 0.7, 0.4);
    let white = std_(ecs, 0xe2e2de, 0.1, 0.35);
    put(ecs, g, &geo::cylinder_geo(0.22, 0.28, 0.08, 28, 1, false), dark.clone(), Transform::from_xyz(0.0, 0.04, 0.0));
    put(ecs, g, &geo::cylinder_geo(0.06, 0.08, 1.0, 20, 1, false), white.clone(), Transform::from_xyz(0.0, 0.58, 0.0));
    put(ecs, g, &geo::cylinder_geo(0.14, 0.12, 0.12, 28, 1, false), dark, Transform::from_xyz(0.0, 1.14, 0.0));
    let cap_mat = std_mat(ecs, StandardMaterial { base_color: hex(0xc0140d), emissive: hex(0x5a0805).to_linear(), perceptual_roughness: 0.35, ..default() });
    let cap = put(ecs, g, &geo::cylinder_geo(0.1, 0.1, 0.05, 28, 1, false), cap_mat.clone(), Transform::from_xyz(0.0, SWITCH_CAP_Y, 0.0));
    put(ecs, g, &geo::torus_geo(0.12, 0.012, 8, 32).rotate_x(FRAC_PI_2), white, Transform::from_xyz(0.0, 1.2, 0.0));
    Switch { root: g, cap, cap_mat, k: 0.0 }
}

pub fn animate_switch(ecs: &mut Ecs, s: &mut Switch, pressed: bool, dt: f32) {
    s.k += ((if pressed { 1.0 } else { 0.0 }) - s.k) * (dt * 14.0).min(1.0);
    let k = s.k;
    if let Some(mut tr) = ecs.get_mut::<Transform>(s.cap) {
        tr.translation.y = SWITCH_CAP_Y - 0.03 * k;
    }
    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&s.cap_mat) {
        m.base_color = Color::srgb(0.75 - 0.6 * k, 0.08 + 0.75 * k, 0.05 + 0.15 * k);
        m.emissive = Color::srgb(0.35 - 0.3 * k, 0.02 + 0.4 * k, 0.02 + 0.05 * k).to_linear();
    }
}

/// explosão do foguete: bola acesa que cresce e some
pub fn explosion(ecs: &mut Ecs, parent: Entity, at: Vec3) -> (Entity, Handle<StandardMaterial>) {
    let m = crate::world::bas_a(ecs, LinearRgba::rgb(2.0, 1.38, 0.75), 1.0, false);
    let e = put(ecs, parent, &geo::sphere_geo(0.4, 20, 14), m.clone(), Transform::from_translation(at));
    (e, m)
}

/// cacos de vidro (func_breakable): plaquinhas soltas
pub fn shard(ecs: &mut Ecs, parent: Entity, at: Vec3, rot: Vec3, w: f32, h: f32, mat: Handle<StandardMaterial>) -> Entity {
    let g: Geo = geo::plane_geo(w, h);
    put(ecs, parent, &g, mat, Transform::from_translation(at).with_rotation(Quat::from_euler(EulerRot::XYZ, rot.x, rot.y, rot.z)))
}
