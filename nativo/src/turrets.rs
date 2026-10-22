//! Torretas de segurança (turrets.js). Cada torreta é um objeto físico (tripé largo, centro de
//! massa baixo): cai, tomba quando empurrada ou atingida, atravessa portais e pode ser carregada.
//! Se ficar caída, desliga. Também desliga se você chegar por trás e apertar E, ou se for atingida
//! por uma amostra arremessada. Não gira para te seguir: enxerga num cone à frente do corpo, e
//! cubos no caminho bloqueiam a mira e os tiros.

use crate::physics::{Ent, Physics};
use crate::portals::{Portals, PORTAL_A, PORTAL_B};
use crate::props::{Kind, Prop, Props};
use crate::world::{bas_a, point_light, GameWorld, Solid};
use bevy::asset::RenderAssetUsages;
use bevy::ecs::world::World as Ecs;
use bevy::mesh::PrimitiveTopology;
use bevy::prelude::*;
use rand::Rng;
use std::collections::HashMap;

const RANGE: f32 = 26.0;
const FOV: f32 = 55.0 * std::f32::consts::PI / 180.0;

pub struct TurretState {
    pub scale: f32,
    pub active: bool,
    pub no_ammo: bool,
    pub lock: f32,
    pub fire_acc: f32,
    pub deploy: f32,
    pub fallen: f32,
    pub flash_t: f32,
    pub barrel_i: usize,
    pub eye_k: f32,
    pub spin: f32,
    pub head_yaw: f32,
    pub head_pitch: f32,
    pub down_t: f32,
    pub down_reason: String,
    pub target: Option<Vec3>,
    pub spotted_now: bool,
    pub was_spotted: bool,
    pub was_active: bool,
    pub via_past: bool,
    pub burn_t: Option<f32>,
    // peças do modelo
    parts: HashMap<String, Entity>,
    base: HashMap<Entity, Transform>,
    lens: Option<Handle<StandardMaterial>>,
    led: Option<Handle<StandardMaterial>>,
    ant: Option<Handle<StandardMaterial>>,
    flash_light: Entity,
    laser: Entity,
    laser_mat: Handle<StandardMaterial>,
    tracers: Vec<(Entity, Handle<StandardMaterial>, Vec3, f32)>,
    tracer_i: usize,
}

/// opções da torreta (os `topts` da fase)
#[derive(Default, Clone)]
pub struct TurretOpts {
    pub scale: Option<f32>,
    pub tippy: bool,
    pub inactive: bool,
    pub no_ammo: bool,
}

/// linha de 0 a +z (1 m): a mira e os rastros são ela esticada
fn unit_line(ecs: &mut Ecs) -> Handle<Mesh> {
    let m = Mesh::new(PrimitiveTopology::LineList, RenderAssetUsages::default()).with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0f32, 0.0, 0.0], [0.0, 0.0, 1.0]]);
    ecs.resource_mut::<Assets<Mesh>>().add(m)
}

fn segment(a: Vec3, b: Vec3) -> Transform {
    let d = b - a;
    let len = d.length().max(1e-4);
    let up = if d.normalize_or_zero().y.abs() > 0.99 { Vec3::X } else { Vec3::Y };
    Transform::from_translation(a).looking_to(-d, up).with_scale(Vec3::new(1.0, 1.0, len))
}

impl Props {
    pub fn add_turret(&mut self, ecs: &mut Ecs, w: &mut GameWorld, x: f32, y: f32, z: f32, yaw: f32, o: &TurretOpts) -> usize {
        let k = o.scale.unwrap_or(1.0);
        let (mesh, parts, mats) = crate::glb::spawn_model_full(ecs, "turret");
        ecs.entity_mut(mesh).insert(ChildOf(w.root()));
        let home = Vec3::new(x, y + 0.62 * k, z);
        let home_quat = Quat::from_rotation_y(yaw);
        let feet = if o.tippy { 0.2 } else { 0.34 };
        let i = self.list.len();
        let shapes = [(Vec3::new(0.21, 0.4, 0.17) * k, Vec3::new(0.0, 0.2, 0.0) * k), (Vec3::new(feet, 0.05, feet) * k, Vec3::new(0.0, -0.55, -0.06) * k)];
        let (body, cols) = w.phys.add_prop(i, &shapes, if o.tippy { 14.0 } else { 35.0 }, 0.9, 0.02, home, home_quat);
        let radius = shapes.iter().map(|(h, a)| h.length() + a.length()).fold(0.0, f32::max);
        // a luz do clarão fica fora do modelo
        if let Some(&fl) = parts.get("flashLight") {
            ecs.entity_mut(fl).despawn();
        }
        let flash_light = ecs.spawn((point_light(crate::mats::hex(0xffc060), 0.0, 6.0), Transform::default(), ChildOf(w.root()))).id();
        let line = unit_line(ecs);
        let laser_mat = bas_a(ecs, crate::mats::hex(0xff2a1a).to_linear(), 0.85, false);
        let laser = crate::world::put_mesh(ecs, w.root(), line.clone(), &laser_mat, Transform::default());
        ecs.entity_mut(laser).insert(Visibility::Hidden);
        let tracers = (0..3)
            .map(|_| {
                let m = bas_a(ecs, crate::mats::hex(0xffd28a).to_linear(), 0.0, false);
                let e = crate::world::put_mesh(ecs, w.root(), line.clone(), &m, Transform::default());
                ecs.entity_mut(e).insert(Visibility::Hidden);
                (e, m, Vec3::ZERO, 0.0)
            })
            .collect();
        let base = parts.values().filter_map(|&e| ecs.get::<Transform>(e).map(|t| (e, *t))).collect();
        let st = TurretState {
            scale: k,
            active: !o.inactive,
            no_ammo: o.no_ammo,
            lock: 0.0,
            fire_acc: 0.0,
            deploy: 0.0,
            fallen: 0.0,
            flash_t: 0.0,
            barrel_i: 0,
            eye_k: 1.0,
            spin: 0.0,
            head_yaw: 0.0,
            head_pitch: 0.0,
            down_t: 9.0,
            down_reason: String::new(),
            target: None,
            spotted_now: false,
            was_spotted: false,
            was_active: !o.inactive,
            via_past: false,
            burn_t: None,
            parts,
            base,
            lens: mats.get("lensMat").cloned(),
            led: mats.get("ledMat").cloned(),
            ant: mats.get("antMat").cloned(),
            flash_light,
            laser,
            laser_mat,
            tracers,
            tracer_i: 0,
        };
        let mut p = Prop::new(Kind::Turret, mesh, body, cols, Vec3::new(0.28, 0.6, 0.28) * k, radius, home, home_quat);
        p.mesh_offset = Vec3::new(0.0, -0.6 * k, 0.0);
        p.mesh_scale = k;
        p.turret = Some(Box::new(st));
        p.body_state(&w.phys);
        self.list.push(p);
        i
    }
}

/// raio contra o cenário e os objetos (menos `skip`): distância do primeiro
pub fn cast_ray(ph: &Physics, solids: &[Solid], props: &[Prop], origin: Vec3, dir: Vec3, max: f32, skip: usize) -> Option<f32> {
    if max <= 0.0 {
        return None;
    }
    ph.cast_ray(origin, dir, max, |e| match e {
        Ent::Static(s) => solids.get(s).is_some_and(|b| !b.no_ray && !b.disabled && !b.see_through),
        Ent::Dyn(i) => i != skip && props.get(i).is_some_and(|p| !p.gone),
        Ent::Player => false,
    })
    .map(|(d, _)| d)
}

impl Prop {
    pub fn turret_forward(&self) -> Vec3 {
        self.quat * Vec3::Z
    }

    pub fn turret_eye(&self) -> Vec3 {
        let k = self.turret.as_ref().map(|t| t.scale).unwrap_or(1.0);
        self.quat * (Vec3::new(0.0, 0.35, 0.2) * k) + self.pos
    }

    /// desliga; `push`: tranco para tombar para a frente (desligada à mão)
    pub fn disable(&mut self, ph: &mut Physics, reason: &str, push: f32) -> bool {
        let fwd = self.turret_forward();
        let top = self.quat * Vec3::new(0.0, 0.55, 0.0) + self.pos;
        let Some(t) = self.turret.as_mut() else { return false };
        if !t.active {
            return false;
        }
        t.active = false;
        t.down_reason = reason.to_string();
        t.down_t = 0.0;
        if push > 0.0 {
            if let Some(b) = ph.body_mut(self.body) {
                let f = fwd * push;
                b.apply_impulse_at_point(Vec3::new(f.x, 0.0, f.z), top, true);
            }
        }
        true
    }

    /// o jogador está atrás da torreta e perto o bastante para desligá-la?
    pub fn can_disable_from(&self, p: Vec3) -> bool {
        if !self.turret.as_ref().is_some_and(|t| t.active) {
            return false;
        }
        let to = p - self.pos;
        if to.length() > 1.9 {
            return false;
        }
        let flat = Vec3::new(to.x, 0.0, to.z).normalize_or_zero();
        let mut f = self.turret_forward();
        f.y = 0.0;
        flat.dot(f.normalize_or_zero()) < 0.2
    }
}

/// alvo pelos portais: o ponto real (do lado de Q) e o par (P do lado da torreta)
pub struct Via {
    pub real: Vec3,
    pub p: usize,
    pub q: usize,
    pub past: bool,
}

fn set_rgb(ecs: &mut Ecs, h: &Option<Handle<StandardMaterial>>, c: Vec3) {
    if let Some(h) = h {
        if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(h) {
            let a = m.base_color.alpha();
            m.base_color = Color::LinearRgba(LinearRgba::new(c.x, c.y, c.z, a));
        }
    }
}

fn set_alpha(ecs: &mut Ecs, h: &Handle<StandardMaterial>, a: f32) {
    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(h) {
        m.base_color.set_alpha(a);
    }
}

/// a peça `name` (a transformação de base mais `f`)
fn pose(ecs: &mut Ecs, t: &TurretState, name: &str, f: impl FnOnce(&mut Transform)) {
    let Some(&e) = t.parts.get(name) else { return };
    let mut tr = t.base.get(&e).copied().unwrap_or_default();
    f(&mut tr);
    if let Some(mut x) = ecs.get_mut::<Transform>(e) {
        *x = tr;
    }
}

/// Mira, tiros e animação de todas as torretas; `target` = olho do jogador. Devolve os tiros
/// que acertaram o jogador neste quadro.
#[allow(clippy::too_many_arguments)]
pub fn update(ecs: &mut Ecs, dt: f32, t_now: f32, w: &mut GameWorld, portals: &Portals, props: &mut Props, g_up_at: &dyn Fn(Vec3) -> Vec3, target: Option<Vec3>, via: &[Via]) -> u32 {
    let mut rng = rand::rng();
    let mut shots_total = 0;
    let cubes: Vec<(Vec3, Vec3, bool)> = props.list.iter().filter(|c| c.kind == Kind::Cube && !c.gone).map(|c| (c.pos, c.vel, c.held)).collect();
    for i in 0..props.list.len() {
        if props.list[i].turret.is_none() {
            continue;
        }
        animate(ecs, &mut props.list[i], dt, t_now, &mut rng);
        // caída (deitada) por um tempinho: desliga
        let up = props.list[i].quat * Vec3::Y;
        let gu = g_up_at(props.list[i].pos);
        {
            let p = &mut props.list[i];
            let t = p.turret.as_mut().unwrap();
            t.fallen = if up.dot(gu) < 0.6 { t.fallen + dt } else { 0.0 };
        }
        if props.list[i].turret.as_ref().unwrap().fallen > 0.3 {
            props.list[i].disable(&mut w.phys, "queda", 0.0);
        }
        // amostra arremessada derruba
        let pos = props.list[i].pos;
        if cubes.iter().any(|(cp, cv, held)| !held && cv.length() > 4.0 && cp.distance(pos) < 0.8) {
            props.list[i].disable(&mut w.phys, "amostra", 0.0);
        }
        let shots = aim(ecs, i, dt, w, portals, props, target, via, &mut rng);
        shots_total += shots;
    }
    shots_total
}

#[allow(clippy::too_many_arguments)]
fn aim(ecs: &mut Ecs, i: usize, dt: f32, w: &GameWorld, portals: &Portals, props: &mut Props, target: Option<Vec3>, via: &[Via], rng: &mut impl Rng) -> u32 {
    let (eye, fwd, held, gone) = {
        let p = &props.list[i];
        (p.turret_eye(), p.turret_forward(), p.held, p.gone)
    };
    // abre as metades quando está mirando em alguém
    {
        let t = props.list[i].turret.as_mut().unwrap();
        t.deploy += ((if t.active && t.lock > 0.0 { 1.0 } else { 0.0 }) - t.deploy) * (dt * 8.0).min(1.0);
        let dp = t.deploy;
        for k in 0..2 {
            let s = if k == 1 { 1.0 } else { -1.0 };
            for (name, x) in [(format!("halves_{k}"), s * (0.006 + dp * 0.07)), (format!("guns_{k}"), -s * (0.02 - dp * 0.06))] {
                if let Some(&e) = t.parts.get(&name) {
                    if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                        tr.translation.x = x;
                    }
                }
            }
        }
    }
    let laser = props.list[i].turret.as_ref().unwrap().laser;
    ecs.entity_mut(laser).insert(Visibility::Hidden);
    let active = props.list[i].turret.as_ref().unwrap().active;
    let Some(target) = target.filter(|_| active && !held && !gone) else {
        let t = props.list[i].turret.as_mut().unwrap();
        t.lock = 0.0;
        t.spotted_now = false;
        return 0;
    };
    props.list[i].turret.as_mut().unwrap().target = Some(target);
    let to = target - eye;
    let dist = to.length();
    let dir = to / dist;
    let mut sees = dist < RANGE && dir.dot(fwd).clamp(-1.0, 1.0).acos() < FOV;
    if sees && cast_ray(&w.phys, &w.solids, &props.list, eye, dir, dist - 0.4, i).is_some() {
        sees = false;
    }
    // pelos portais (o laser vai até a boca; as balas, para o alvo visto lá dentro)
    let mut aim_at = target;
    let mut laser_to = None;
    let mut via_past = false;
    if !sees {
        for v in via {
            if let Some((a, x)) = see_through(w, portals, &props.list, i, eye, fwd, v) {
                sees = true;
                aim_at = a;
                laser_to = Some(x);
                via_past = v.past;
                break;
            }
        }
    }
    let mut shots = 0;
    let t = props.list[i].turret.as_mut().unwrap();
    t.via_past = via_past;
    if sees {
        t.lock = (t.lock + dt / 0.7).min(1.0);
        let end = laser_to.unwrap_or(aim_at + Vec3::new((rng.random::<f32>() - 0.5) * 0.05, -0.15, 0.0));
        ecs.entity_mut(t.laser).insert((segment(eye, end), Visibility::Visible));
        let lm = t.laser_mat.clone();
        set_alpha(ecs, &lm, 0.4 + t.lock * 0.5);
        if t.lock >= 1.0 && !t.no_ammo {
            t.fire_acc += dt;
            while t.fire_acc > 0.1 {
                t.fire_acc -= 0.1;
                shots += 1;
                muzzle(ecs, t, eye, fwd, aim_at, rng);
            }
        }
    } else {
        t.lock = (t.lock - dt).max(0.0);
        // laser parado, apontando para a frente
        let laser = t.laser;
        let lm = t.laser_mat.clone();
        let hit = cast_ray(&w.phys, &w.solids, &props.list, eye, fwd, RANGE, i);
        ecs.entity_mut(laser).insert((segment(eye, eye + fwd * hit.unwrap_or(RANGE)), Visibility::Visible));
        set_alpha(ecs, &lm, 0.35);
    }
    props.list[i].turret.as_mut().unwrap().spotted_now = sees;
    shots
}

/// enxerga `v.real` pelo portal P (do lado da torreta), que sai em Q? (alvo visto, ponto da boca)
#[allow(clippy::too_many_arguments)]
fn see_through(w: &GameWorld, portals: &Portals, props: &[Prop], me: usize, eye: Vec3, fwd: Vec3, v: &Via) -> Option<(Vec3, Vec3)> {
    let (pp, qq) = (&portals.list[v.p], &portals.list[v.q]);
    if !pp.placed || !qq.placed || !portals.is_linked(v.p) {
        return None;
    }
    let aim = portals.transform(v.q, v.p).transform_point3(v.real);
    let to = aim - eye;
    let dist = to.length();
    if !(0.3..=RANGE).contains(&dist) {
        return None;
    }
    let dir = to / dist;
    if dir.dot(fwd).clamp(-1.0, 1.0).acos() >= FOV {
        return None;
    }
    let sa = (eye - pp.center).dot(pp.normal);
    let den = dir.dot(pp.normal);
    if sa <= 0.02 || den >= -1e-4 {
        return None;
    }
    let s = -sa / den;
    let x = eye + dir * s;
    let l = pp.local(x);
    if (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) > 0.85 {
        return None;
    }
    if cast_ray(&w.phys, &w.solids, props, eye, dir, (s - 0.12).max(0.0), me).is_some() {
        return None;
    }
    // do outro lado: da boca de Q até o alvo
    let xq = portals.transform(v.p, v.q).transform_point3(x);
    let d2 = v.real - xq;
    let len = d2.length();
    let d2 = d2 / len;
    if len > 0.6 && cast_ray(&w.phys, &w.solids, props, xq + d2 * 0.12, d2, len - 0.55, me).is_some() {
        return None;
    }
    Some((aim, x))
}

/// clarão no cano da vez, recuo e um rastro até perto do alvo
fn muzzle(ecs: &mut Ecs, t: &mut TurretState, eye: Vec3, fwd: Vec3, target: Vec3, rng: &mut impl Rng) {
    t.barrel_i = (t.barrel_i + 1) % 2;
    t.flash_t = 0.05;
    let from = t.parts.get(&format!("flashes_{}", t.barrel_i)).and_then(|&e| ecs.get::<GlobalTransform>(e)).map(|g| g.translation()).unwrap_or(eye + fwd * 0.3);
    let to = target + Vec3::new((rng.random::<f32>() - 0.5) * 0.6, (rng.random::<f32>() - 0.5) * 0.5 - 0.1, (rng.random::<f32>() - 0.5) * 0.6);
    let k = t.tracer_i % t.tracers.len();
    t.tracer_i += 1;
    let d = to - from;
    let a = from + d * rng.random::<f32>() * 0.4;
    let b = a + d.normalize() * 1.6;
    let tr = &mut t.tracers[k];
    tr.2 = d * 60.0;
    tr.3 = 0.9;
    ecs.entity_mut(tr.0).insert((segment(a, b), Visibility::Visible));
    let m = tr.1.clone();
    set_alpha(ecs, &m, 0.9);
    if let Some(&e) = t.parts.get(&format!("barrels_{}", t.barrel_i)) {
        // recuo (o "kick" decai em animate)
        let _ = e;
    }
}

/// animação que não depende de estar ligada: clarões, rastros, olho, cabeça, canos
fn animate(ecs: &mut Ecs, p: &mut Prop, dt: f32, now: f32, rng: &mut impl Rng) {
    let gone = p.gone;
    let (pos, quat) = (p.pos, p.quat);
    let t = p.turret.as_mut().unwrap();
    t.flash_t -= dt;
    for k in 0..2 {
        let on = t.flash_t > 0.0 && k == t.barrel_i;
        if let Some(&e) = t.parts.get(&format!("flashes_{k}")) {
            ecs.entity_mut(e).insert(if on { Visibility::Inherited } else { Visibility::Hidden });
        }
        if on {
            let s = 0.16 + rng.random::<f32>() * 0.1;
            pose(ecs, t, &format!("flashes_{k}"), |tr| tr.scale = Vec3::splat(s / 0.16));
        }
    }
    let li = if t.flash_t > 0.0 && !gone { point_light(Color::WHITE, 6.0, 6.0).intensity } else { 0.0 };
    let fl = t.flash_light;
    if let Some(mut l) = ecs.get_mut::<PointLight>(fl) {
        l.intensity = li;
    }
    ecs.entity_mut(fl).insert(Transform::from_translation(pos + quat * Vec3::new(0.0, 0.8 - 0.6, 0.35) * t.scale));
    for k in 0..t.tracers.len() {
        let (e, m, v, a) = t.tracers[k].clone();
        if a <= 0.0 {
            continue;
        }
        let a2 = (a - dt * 12.0).max(0.0);
        t.tracers[k].3 = a2;
        set_alpha(ecs, &m, a2);
        if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
            tr.translation += v * dt;
        }
        if a2 <= 0.0 {
            ecs.entity_mut(e).insert(Visibility::Hidden);
        }
    }
    // olho: respira devagar procurando, acende forte mirando, apaga desligada
    let target = if !t.active { 0.0 } else if t.lock > 0.0 { 1.4 + t.lock * 0.6 } else { 0.85 + (now * 1000.0 / 300.0).sin() * 0.15 };
    t.eye_k += (target - t.eye_k) * (dt * if t.active { 10.0 } else { 2.5 }).min(1.0);
    let ek = t.eye_k;
    set_rgb(ecs, &t.lens, Vec3::new(3.0 * ek + 0.12, 0.15 * ek + 0.02, 0.1 * ek + 0.02));
    if let Some(&e) = t.parts.get("eyeGlow") {
        ecs.entity_mut(e).insert(if ek > 0.05 { Visibility::Inherited } else { Visibility::Hidden });
    }
    pose(ecs, t, "eyeGlow", |tr| tr.scale *= (0.22 + ek * 0.1) / 0.32);
    let lk = t.lock;
    let act = t.active;
    pose(ecs, t, "iris", |tr| tr.scale = Vec3::splat(1.0 - lk * 0.45 + if act { 0.0 } else { 0.3 }));
    // cabeça: parada olhando para a frente, segue o alvo, cai e treme desligada
    let (mut yaw, mut pitch) = (0.0, 0.0);
    if t.active && t.lock > 0.0 {
        if let Some(tg) = t.target {
            let mut l = quat.inverse() * (tg - (pos - quat * Vec3::new(0.0, 0.6 * t.scale, 0.0))) / t.scale;
            l.y -= 0.45;
            yaw = l.x.atan2(l.z).clamp(-0.3, 0.3);
            pitch = (-(l.y.atan2(l.x.hypot(l.z))) * 0.5).clamp(-0.15, 0.15);
        }
    } else if !t.active {
        t.down_t += dt;
        pitch = 0.22;
        if t.down_t < 2.5 {
            yaw = (rng.random::<f32>() - 0.5) * 0.15 * (1.0 - t.down_t / 2.5);
            pitch += (rng.random::<f32>() - 0.5) * 0.1;
        }
    }
    let k = (dt * if t.active { 5.0 } else { 12.0 }).min(1.0);
    t.head_yaw += (yaw - t.head_yaw) * k;
    t.head_pitch += (pitch - t.head_pitch) * k;
    let (hy, hp) = (t.head_yaw, t.head_pitch);
    pose(ecs, t, "head", |tr| tr.rotation = Quat::from_euler(EulerRot::XYZ, hp, hy, 0.0));
    // faíscas logo depois de desligar
    let spark = !t.active && t.down_t < 2.5 && rng.random::<f32>() < 0.35;
    if let Some(&e) = t.parts.get("spark") {
        ecs.entity_mut(e).insert(if spark { Visibility::Inherited } else { Visibility::Hidden });
    }
    // metralhadoras: giram mirando e disparando
    let want = if !t.active { 0.0 } else if t.lock >= 1.0 { 45.0 } else if t.lock > 0.0 { 14.0 } else { 0.0 };
    t.spin += (want - t.spin) * (dt * 3.0).min(1.0);
    for k in 0..2 {
        if let Some(&e) = t.parts.get(&format!("barrels_{k}")) {
            let a = t.spin * dt * if k == 1 { 1.0 } else { -1.0 };
            if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                tr.rotate_local_z(a);
            }
        }
    }
    let dp = t.deploy;
    for k in 0..2 {
        let s = if k == 1 { -1.0 } else { 1.0 };
        if let Some(&e) = t.parts.get(&format!("halves_{k}")) {
            if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                tr.rotation = Quat::from_rotation_z(s * dp * 0.06);
            }
        }
    }
    // LEDs da fenda: vermelho mirando, âmbar procurando
    let lit = if t.active { 0.3 + t.deploy * 0.7 } else { 0.0 };
    let led = if t.lock > 0.0 { Vec3::new(2.6 * lit, 0.15 * lit, 0.05 * lit) } else { Vec3::new(2.2 * lit * 0.4, 1.1 * lit * 0.4, 0.1 * lit * 0.4) };
    set_rgb(ecs, &t.led, led);
    // antena: pisca uma vez por segundo ligada
    let blink = t.active && now % 1.0 < 0.12;
    set_rgb(ecs, &t.ant, if blink { Vec3::new(3.0, 0.3, 0.15) } else { Vec3::new(0.15, 0.02, 0.02) });
}
