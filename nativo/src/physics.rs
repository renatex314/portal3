//! Física (Rapier), como a physics.js: cubos e torretas tombam, giram, empilham e são
//! empurrados; o jogador é um "character controller" que colide com tudo isso. A regra dos
//! portais vira um filtro de contato: enquanto o centro de um corpo está na boca de um portal
//! ligado, o que estiver ATRÁS do plano do portal deixa de colidir com ele.
//!
//! A gravidade não é a do motor: cada corpo recebe a do ponto em que está (quem chama aplica).

use bevy::prelude::*;
use rapier3d::control::{CharacterAutostep, CharacterCollision, CharacterLength, KinematicCharacterController};
use rapier3d::prelude::*;
use std::collections::HashMap;

pub const STEP: f32 = 1.0 / 60.0;

/// o que é cada colisor
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ent {
    /// caixa do cenário (índice em `GameWorld::solids`)
    Static(usize),
    /// objeto dinâmico (índice em `Props`)
    Dyn(usize),
    Player,
}

pub struct Physics {
    pub pw: PhysicsWorld,
    pub ents: HashMap<ColliderHandle, Ent>,
    pub kcc: KinematicCharacterController,
    pub player_col: Option<ColliderHandle>,
    pub player_half: Vec3,
}

/// um filtro de contato feito de uma função (o PhysicsHooks do Rapier)
pub struct Hooks<F: Fn(ColliderHandle, ColliderHandle) -> bool + Send + Sync>(pub F);
impl<F: Fn(ColliderHandle, ColliderHandle) -> bool + Send + Sync> PhysicsHooks for Hooks<F> {
    fn filter_contact_pair(&self, c: &PairFilterContext) -> Option<SolverFlags> {
        if (self.0)(c.collider1, c.collider2) { None } else { Some(SolverFlags::COMPUTE_RIGID_IMPULSES) }
    }
}

/// resultado do movimento do jogador
pub struct MoveResult {
    pub grounded: bool,
    /// normais das superfícies tocadas (apontando para fora delas)
    pub normals: Vec<Vec3>,
    /// em que o jogador está apoiado
    pub ground: Option<Ent>,
}

impl Default for Physics {
    fn default() -> Self {
        Self::new()
    }
}

impl Physics {
    pub fn new() -> Self {
        let mut pw = PhysicsWorld::new();
        pw.gravity = Vec3::ZERO;
        pw.integration_parameters.dt = STEP;
        let kcc = KinematicCharacterController {
            up: Vec3::Y,
            offset: CharacterLength::Absolute(0.02),
            slide: true,
            // degraus baixos (até 0,45 m, o mesmo do Source) sobem sozinhos; descendo, gruda no chão
            autostep: Some(CharacterAutostep { max_height: CharacterLength::Absolute(0.45), min_width: CharacterLength::Absolute(0.12), include_dynamic_bodies: false }),
            max_slope_climb_angle: 50f32.to_radians(),
            min_slope_slide_angle: 55f32.to_radians(),
            snap_to_ground: Some(CharacterLength::Absolute(0.2)),
            ..default()
        };
        Self { pw, ents: HashMap::new(), kcc, player_col: None, player_half: Vec3::new(0.3, 0.9, 0.3) }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    // ------------------------------------------------------------------ cenário
    /// caixa do cenário; `kinematic`: porta/plataforma que se move (empurra o que estiver em cima)
    pub fn add_box(&mut self, solid: usize, center: Vec3, half: Vec3, rot: Quat, kinematic: bool) -> (ColliderHandle, Option<RigidBodyHandle>) {
        let desc = ColliderBuilder::cuboid(half.x, half.y, half.z).friction(0.8);
        if kinematic {
            let body = self.pw.bodies.insert(RigidBodyBuilder::kinematic_position_based().pose(Pose::from_parts(center, rot)));
            let col = self.pw.colliders.insert_with_parent(desc, body, &mut self.pw.bodies);
            self.ents.insert(col, Ent::Static(solid));
            (col, Some(body))
        } else {
            let col = self.pw.colliders.insert(desc.position(Pose::from_parts(center, rot)));
            self.ents.insert(col, Ent::Static(solid));
            (col, None)
        }
    }

    /// sólido convexo (pincel inclinado de mapa importado)
    pub fn add_convex(&mut self, solid: usize, center: Vec3, local_pts: &[Vec3], kinematic: bool) -> Option<(ColliderHandle, Option<RigidBodyHandle>)> {
        let desc = ColliderBuilder::convex_hull(local_pts)?.friction(0.8);
        if kinematic {
            let body = self.pw.bodies.insert(RigidBodyBuilder::kinematic_position_based().translation(center));
            let col = self.pw.colliders.insert_with_parent(desc, body, &mut self.pw.bodies);
            self.ents.insert(col, Ent::Static(solid));
            Some((col, Some(body)))
        } else {
            let col = self.pw.colliders.insert(desc.translation(center));
            self.ents.insert(col, Ent::Static(solid));
            Some((col, None))
        }
    }

    /// acompanha uma caixa que mudou de lugar (porta)
    pub fn move_kinematic(&mut self, body: RigidBodyHandle, center: Vec3) {
        if let Some(b) = self.pw.bodies.get_mut(body) {
            b.set_next_kinematic_translation(center);
        }
    }

    /// leva um colisor fixo para outro lugar (ponte de luz)
    pub fn place_collider(&mut self, col: ColliderHandle, center: Vec3) {
        if let Some(c) = self.pw.colliders.get_mut(col) {
            c.set_translation(center);
        }
    }

    pub fn remove_collider(&mut self, col: ColliderHandle) {
        self.ents.remove(&col);
        self.pw.remove_collider(col);
    }

    pub fn remove_body(&mut self, body: RigidBodyHandle) {
        if let Some(b) = self.pw.bodies.get(body) {
            for c in b.colliders().to_vec() {
                self.ents.remove(&c);
            }
        }
        self.pw.remove_body_with_colliders(body, true);
    }

    pub fn set_enabled(&mut self, col: ColliderHandle, on: bool) {
        if let Some(c) = self.pw.colliders.get_mut(col) {
            c.set_enabled(on);
        }
    }

    // ------------------------------------------------------------------ objetos
    /// corpo dinâmico: `shapes` = (meia caixa, centro relativo); `mass` total em kg
    pub fn add_prop(&mut self, prop: usize, shapes: &[(Vec3, Vec3)], mass: f32, friction: f32, restitution: f32, pos: Vec3, rot: Quat) -> (RigidBodyHandle, Vec<ColliderHandle>) {
        let body = self.pw.bodies.insert(RigidBodyBuilder::dynamic().pose(Pose::from_parts(pos, rot)).ccd_enabled(true).linear_damping(0.05).angular_damping(0.4));
        let n = shapes.len().max(1) as f32;
        let cols = shapes
            .iter()
            .map(|(half, at)| {
                let cd = ColliderBuilder::cuboid(half.x, half.y, half.z).translation(*at).mass(mass / n).friction(friction).restitution(restitution).active_hooks(ActiveHooks::FILTER_CONTACT_PAIRS);
                let c = self.pw.colliders.insert_with_parent(cd, body, &mut self.pw.bodies);
                self.ents.insert(c, Ent::Dyn(prop));
                c
            })
            .collect();
        (body, cols)
    }

    pub fn wake_all(&mut self) {
        self.pw.wake_up_all(true);
    }

    // ------------------------------------------------------------------ jogador
    pub fn set_player(&mut self, half: Vec3) {
        if let Some(c) = self.player_col.take() {
            self.ents.remove(&c);
            self.pw.remove_collider(c);
        }
        let col = self.pw.colliders.insert(ColliderBuilder::cuboid(half.x, half.y, half.z).friction(0.0));
        self.ents.insert(col, Ent::Player);
        self.player_col = Some(col);
        self.player_half = half;
    }

    /// um corpo do tamanho `half` cabe em `center` sem tocar no cenário? (levantar)
    pub fn fits(&self, center: Vec3, half: Vec3, solid_live: impl Fn(usize) -> bool) -> bool {
        let shape = rapier3d::geometry::Cuboid::new(half - Vec3::splat(0.01));
        let q = self.pw.query_pipeline_with_filter(QueryFilter::default());
        let mut blocked = false;
        for (h, _) in q.intersect_shape(Pose::from_translation(center), &shape) {
            if let Some(Ent::Static(s)) = self.ents.get(&h) {
                if solid_live(*s) {
                    blocked = true;
                    break;
                }
            }
        }
        !blocked
    }

    /// Move o jogador o quanto der em `delta`, colidindo com o cenário e com os objetos (e
    /// empurrando-os). `allow(ent)` diz com o que ele colide (portais, objeto segurado...).
    pub fn move_player(&mut self, pos: &mut Vec3, delta: Vec3, up: Vec3, dt: f32, allow: impl Fn(Ent) -> bool) -> MoveResult {
        let Some(col) = self.player_col else {
            *pos += delta;
            return MoveResult { grounded: false, normals: vec![], ground: None };
        };
        if let Some(c) = self.pw.colliders.get_mut(col) {
            c.set_translation(*pos);
        }
        let shape = rapier3d::geometry::Cuboid::new(self.player_half);
        self.kcc.up = up;
        let ents = &self.ents;
        let pred = |h: ColliderHandle, c: &Collider| -> bool { !c.is_sensor() && ents.get(&h).map(|e| allow(*e)).unwrap_or(true) };
        let mut collisions: Vec<CharacterCollision> = vec![];
        let res = {
            let filter = QueryFilter { exclude_collider: Some(col), predicate: Some(&pred), ..QueryFilter::default() };
            let q = self.pw.query_pipeline_with_filter(filter);
            self.kcc.move_shape(dt.max(1e-4), &q, &shape, &Pose::from_translation(*pos), delta, |c| collisions.push(c))
        };
        // empurra os objetos dinâmicos (personagem de 75 kg)
        {
            let Physics { pw, ents, kcc, .. } = self;
            let pred2 = |h: ColliderHandle, c: &Collider| -> bool { !c.is_sensor() && ents.get(&h).map(|e| allow(*e)).unwrap_or(true) };
            let filter = QueryFilter { exclude_collider: Some(col), predicate: Some(&pred2), ..QueryFilter::default() };
            let mut qm = pw.broad_phase.as_query_pipeline_mut(pw.narrow_phase.query_dispatcher(), &mut pw.bodies, &mut pw.colliders, filter);
            kcc.solve_character_collision_impulses(dt.max(1e-4), &mut qm, &shape, 75.0, collisions.iter());
        }
        *pos += res.translation;
        if let Some(c) = self.pw.colliders.get_mut(col) {
            c.set_translation(*pos);
        }
        let mut normals = vec![];
        let mut ground = None;
        for c in &collisions {
            let n = -c.hit.normal1;
            normals.push(n);
            if n.dot(up) > 0.7 {
                if let Some(e) = self.ents.get(&c.handle) {
                    ground = Some(*e);
                }
            }
        }
        MoveResult { grounded: res.grounded, normals, ground }
    }

    // ------------------------------------------------------------------ passo
    /// Avança `dt` segundos em passos de até 1/60 s. `pre(h)` antes de cada passo (gravidade,
    /// controle), `blocked(c1, c2)` é o filtro de contato dos portais, `post()` depois.
    pub fn step(&mut self, dt: f32, mut pre: impl FnMut(&mut Physics, f32), blocked: &(dyn Fn(Option<Ent>, Option<Ent>) -> bool + Sync), mut post: impl FnMut(&mut Physics)) {
        if dt <= 0.0 {
            return;
        }
        let n = ((dt / STEP) - 1e-6).ceil().max(1.0) as usize;
        let h = dt / n as f32;
        for _ in 0..n {
            pre(self, h);
            let Physics { pw, ents, .. } = self;
            pw.integration_parameters.dt = h;
            let hooks = Hooks(|a, b| blocked(ents.get(&a).copied(), ents.get(&b).copied()));
            pw.step_with_events(&hooks, &());
            post(self);
        }
    }

    /// um passo de `h` segundos com o filtro de contato dos portais
    pub fn step_once(&mut self, h: f32, blocked: &(dyn Fn(Option<Ent>, Option<Ent>) -> bool + Sync)) {
        let Physics { pw, ents, .. } = self;
        pw.integration_parameters.dt = h;
        let hooks = Hooks(|a, b| blocked(ents.get(&a).copied(), ents.get(&b).copied()));
        pw.step_with_events(&hooks, &());
    }

    /// primeiro objeto (ou cenário) que o raio acerta; `accept(ent)` filtra
    pub fn cast_ray(&self, origin: Vec3, dir: Vec3, max_dist: f32, accept: impl Fn(Ent) -> bool) -> Option<(f32, Ent)> {
        let pred = |h: ColliderHandle, c: &Collider| -> bool { !c.is_sensor() && self.ents.get(&h).map(|e| accept(*e)).unwrap_or(false) };
        let filter = QueryFilter { predicate: Some(&pred), ..QueryFilter::default() };
        let q = self.pw.query_pipeline_with_filter(filter);
        let ray = Ray::new(origin, dir);
        q.cast_ray(&ray, max_dist, true).and_then(|(h, toi)| self.ents.get(&h).map(|e| (toi, *e)))
    }

    pub fn body(&self, h: RigidBodyHandle) -> Option<&RigidBody> {
        self.pw.bodies.get(h)
    }
    pub fn body_mut(&mut self, h: RigidBodyHandle) -> Option<&mut RigidBody> {
        self.pw.bodies.get_mut(h)
    }
}
