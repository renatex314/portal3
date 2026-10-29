//! Objetos físicos que o jogador pode pegar (props.js): a base comum (corpo rígido que atravessa
//! portais e é segurado na frente da câmera) e o cubo de amostra.

use crate::physics::{Ent, Physics};
use crate::portals::{Portals, Who};
use crate::world::GameWorld;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use rapier3d::prelude::{ColliderHandle, RigidBodyHandle};

const MAX_FALL: f32 = 40.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Cube,
    Turret,
}

pub struct Prop {
    pub kind: Kind,
    pub special: bool,
    /// cubo refletor de laser (o feixe sai pela face +z)
    pub redirect: bool,
    pub mesh: Entity,
    pub body: RigidBodyHandle,
    pub cols: Vec<ColliderHandle>,
    pub half: Vec3,
    pub radius: f32,
    pub pos: Vec3,
    pub vel: Vec3,
    pub quat: Quat,
    pub held: bool,
    pub gone: bool,
    pub cooldown: f32,
    /// ponto na frente da câmera enquanto segurado (lado do jogador)
    pub hold_local: Option<Vec3>,
    pub hold_quat_local: Quat,
    pub hold_target: Vec3,
    pub hold_quat: Quat,
    pub hold_base: Quat,
    /// segurado: leva coordenadas do lado do jogador para o lado em que o objeto está
    pub space: Mat4,
    pub far_time: f32,
    pub prev_center: Vec3,
    pub min: Vec3,
    pub max: Vec3,
    pub mouths: Vec<usize>,
    pub pass_wall: Option<usize>,
    pub home: Vec3,
    pub home_quat: Quat,
    pub mesh_offset: Vec3,
    pub mesh_scale: f32,
    /// entrou no ciano temporal neste passo (o relógio o manda ao passado)
    pub to_past: Option<usize>,
    /// multiplayer: outra pessoa mexendo neste objeto (posição, rotação, segurando, quando)
    pub remote: Option<(Vec3, Option<Quat>, bool, f32)>,
    pub dilated: bool,
    /// estado de torreta (mira, tiros, animação)
    pub turret: Option<Box<crate::turrets::TurretState>>,
    /// cubo refletor: o laser está batendo nele (a lente acende)
    pub lit: bool,
    pub lens: Option<Handle<StandardMaterial>>,
    /// a janela do núcleo (acende em cima de um botão)
    pub glow: Option<Handle<StandardMaterial>>,
    /// relógio: preso no lugar com o tempo parado (e a velocidade que tinha)
    pub frozen_bt: bool,
    /// preso no lugar pelo mapa (núcleo da campanha original até EnableMotion)
    pub pinned: bool,
    pub frozen_v: Option<(Vec3, Vec3)>,
    /// a cópia que aparece saindo do outro portal enquanto o objeto está na boca de um
    pub twin: Option<Twin>,
}

/// cópia só visual do modelo (raiz e pares origem → cópia de cada nó)
pub struct Twin {
    root: Entity,
    pairs: Vec<(Entity, Entity)>,
}

impl Twin {
    fn new(ecs: &mut Ecs, src: Entity, parent: Entity) -> Self {
        fn rec(ecs: &mut Ecs, s: Entity, parent: Option<Entity>, pairs: &mut Vec<(Entity, Entity)>) -> Entity {
            let t = ecs.get::<Transform>(s).copied().unwrap_or_default();
            let d = ecs.spawn((t, Visibility::Hidden)).id();
            if let Some(p) = parent {
                ecs.entity_mut(d).insert(ChildOf(p));
            }
            if let Some(m) = ecs.get::<Mesh3d>(s).cloned() {
                ecs.entity_mut(d).insert(m);
            }
            if let Some(m) = ecs.get::<MeshMaterial3d<StandardMaterial>>(s).cloned() {
                ecs.entity_mut(d).insert(m);
            }
            if let Some(m) = ecs.get::<MeshMaterial3d<crate::fx::Fx>>(s).cloned() {
                ecs.entity_mut(d).insert(m);
            }
            pairs.push((s, d));
            let kids: Vec<Entity> = ecs.get::<Children>(s).map(|c| c.iter().collect()).unwrap_or_default();
            for k in kids {
                rec(ecs, k, Some(d), pairs);
            }
            d
        }
        let mut pairs = vec![];
        let root = rec(ecs, src, Some(parent), &mut pairs);
        Twin { root, pairs }
    }
}

/// o que o filtro de contato precisa saber de cada objeto (cópia, para poder rodar em paralelo)
#[derive(Clone)]
pub struct Filter {
    gone: bool,
    held: bool,
    pass_wall: Option<usize>,
    mouths: Vec<usize>,
    min: Vec3,
    max: Vec3,
}

#[derive(Default)]
pub struct Props {
    pub list: Vec<Prop>,
}

impl Prop {
    #[allow(clippy::too_many_arguments)]
    pub fn new(kind: Kind, mesh: Entity, body: RigidBodyHandle, cols: Vec<ColliderHandle>, half: Vec3, radius: f32, home: Vec3, home_quat: Quat) -> Self {
        Prop {
            kind,
            special: false,
            redirect: false,
            mesh,
            body,
            cols,
            half,
            radius,
            pos: home,
            vel: Vec3::ZERO,
            quat: home_quat,
            held: false,
            gone: false,
            cooldown: 0.0,
            hold_local: None,
            hold_quat_local: Quat::IDENTITY,
            hold_target: home,
            hold_quat: Quat::IDENTITY,
            hold_base: Quat::IDENTITY,
            space: Mat4::IDENTITY,
            far_time: 0.0,
            prev_center: home,
            min: home,
            max: home,
            mouths: vec![],
            pass_wall: None,
            home,
            home_quat,
            mesh_offset: Vec3::ZERO,
            mesh_scale: 1.0,
            to_past: None,
            remote: None,
            dilated: false,
            turret: None,
            lit: false,
            lens: None,
            glow: None,
            frozen_bt: false,
            pinned: false,
            frozen_v: None,
            twin: None,
        }
    }

    pub fn body_state(&mut self, ph: &Physics) {
        if let Some(b) = ph.body(self.body) {
            self.pos = b.translation();
            self.quat = *b.rotation();
            self.vel = b.linvel();
        }
    }

    /// alvo de quem segura levado para o lado do portal em que o objeto está
    pub fn update_hold(&mut self) {
        let Some(l) = self.hold_local else { return };
        self.hold_target = self.space.transform_point3(l);
        let (_, r, _) = self.space.to_scale_rotation_translation();
        self.hold_quat = r * self.hold_quat_local;
    }

    /// antes de cada passo: gravidade ou controle de quem segura
    fn pre(&mut self, ph: &mut Physics, h: f32, g: Vec3) {
        self.cooldown -= h;
        if self.held && self.hold_local.is_some() {
            self.update_hold();
            let (target, hq) = (self.hold_target, self.hold_quat);
            let Some(b) = ph.body_mut(self.body) else { return };
            let mut v = (target - b.translation()) * 16.0;
            if v.length() > 20.0 {
                v = v.normalize() * 20.0;
            }
            b.set_linvel(v, true);
            let mut d = hq * b.rotation().inverse();
            if d.w < 0.0 {
                d = -d;
            }
            let ang = 2.0 * d.w.min(1.0).acos();
            let s = (1.0 - d.w * d.w).max(1e-9).sqrt();
            b.set_angvel(Vec3::new(d.x / s, d.y / s, d.z / s) * ang * 10.0, true);
            return;
        }
        let Some(b) = ph.body_mut(self.body) else { return };
        if b.is_sleeping() {
            return;
        }
        let mut v = b.linvel() + g * h;
        if v.length() > MAX_FALL {
            v = v.normalize() * MAX_FALL;
        }
        b.set_linvel(v, false);
    }

    /// depois de cada passo: passagem pelos portais; devolve o portal atravessado
    fn post(&mut self, ph: &mut Physics, portals: &Portals, solids: &[crate::world::Solid], g: &dyn Fn(Vec3) -> Vec3) -> Option<usize> {
        let Some(b) = ph.body(self.body) else { return None };
        self.pos = b.translation();
        if self.cooldown > 0.0 {
            return None;
        }
        let p = portals
            .crossing(self.prev_center, self.pos, Who::Prop { held: self.held })
            .or_else(|| portals.stuck_in(solids, self.pos, self.pos - Vec3::splat(0.3), self.pos + Vec3::splat(0.3), 0.45))?;
        if portals.list[portals.list[p].partner].delta > 0.0 {
            // ciano temporal: o objeto solto vai para o passado (o relógio cuida)
            if !self.held {
                self.to_past = Some(p);
            }
            return None;
        }
        let b = ph.body_mut(self.body)?;
        let mut pos = b.translation();
        let mut vel = b.linvel();
        let (q, _, rot) = portals.carry(p, &mut pos, &mut vel);
        let r = rot * *b.rotation();
        let av = rot * b.angvel();
        if !self.held {
            portals.exit_assist(q, pos, &mut vel, self.half, g(pos), portals.list[q].up);
        }
        b.set_translation(pos, true);
        b.set_rotation(r, true);
        b.set_linvel(vel, true);
        b.set_angvel(av, true);
        if self.held {
            self.space = portals.transform(p, q) * self.space;
        }
        self.pos = pos;
        self.cooldown = 0.15;
        Some(p)
    }

    /// teletransporta (respawn, passagem junto com o jogador)
    pub fn place(&mut self, ph: &mut Physics, p: Vec3, q: Option<Quat>, v: Option<Vec3>) {
        if let Some(b) = ph.body_mut(self.body) {
            b.set_translation(p, true);
            if let Some(q) = q {
                b.set_rotation(q, true);
            }
            b.set_linvel(v.unwrap_or(Vec3::ZERO), true);
            b.set_angvel(Vec3::ZERO, true);
        }
        self.prev_center = p;
        self.cooldown = 0.15;
        self.body_state(ph);
    }

    /// desintegrado / queimado: sai da simulação até voltar
    pub fn vanish(&mut self, ph: &mut Physics) {
        self.gone = true;
        self.held = false;
        if let Some(b) = ph.body_mut(self.body) {
            b.set_enabled(false);
        }
    }

    pub fn respawn(&mut self, ph: &mut Physics) {
        self.held = false;
        self.gone = false;
        if let Some(b) = ph.body_mut(self.body) {
            b.set_enabled(true);
        }
        let (h, q) = (self.home, self.home_quat);
        self.place(ph, h, Some(q), None);
    }

    pub fn throw(&mut self, ph: &mut Physics, v: Vec3) {
        if let Some(b) = ph.body_mut(self.body) {
            b.set_linvel(v, true);
        }
    }

    fn filter(&self) -> Filter {
        Filter { gone: self.gone, held: self.held, pass_wall: self.pass_wall, mouths: self.mouths.clone(), min: self.min, max: self.max }
    }
}

impl Props {
    pub fn clear(&mut self) {
        self.list.clear();
    }

    /// cubo de amostra (`special`: o do coração; `laser`: refletor)
    pub fn add_cube(&mut self, ecs: &mut Ecs, w: &mut GameWorld, x: f32, y: f32, z: f32, special: bool, laser: bool, yaw: f32) -> usize {
        let name = if special { "cube_special" } else if laser { "cube_laser" } else { "cube" };
        let i = self.add_named(ecs, w, x, y, z, name, yaw);
        self.list[i].special = special;
        self.list[i].redirect = laser;
        i
    }

    /// objeto com a física do cubo e outro modelo (o núcleo do chefe)
    pub fn add_model(&mut self, ecs: &mut Ecs, w: &mut GameWorld, x: f32, y: f32, z: f32, name: &str) -> usize {
        self.add_named(ecs, w, x, y, z, name, 0.0)
    }

    fn add_named(&mut self, ecs: &mut Ecs, w: &mut GameWorld, x: f32, y: f32, z: f32, name: &str, yaw: f32) -> usize {
        let (mesh, _, mats) = crate::glb::spawn_model_full(ecs, name);
        ecs.entity_mut(mesh).insert(ChildOf(w.root()));
        let home = Vec3::new(x, y + 0.31, z);
        let home_quat = Quat::from_rotation_y(yaw);
        let i = self.list.len();
        let (body, cols) = w.phys.add_prop(i, &[(Vec3::splat(0.29), Vec3::ZERO)], 30.0, 0.85, 0.04, home, home_quat);
        let mut p = Prop::new(Kind::Cube, mesh, body, cols, Vec3::splat(0.3), Vec3::splat(0.29).length(), home, home_quat);
        p.lens = mats.get("lens").cloned();
        p.glow = mats.get("glow").cloned();
        p.body_state(&w.phys);
        self.list.push(p);
        i
    }

    /// Avança a física `dt` segundos (em passos de até 1/60 s), como physics.step da versão web:
    /// antes de cada passo calcula as bocas de portal de cada objeto e aplica gravidade/controle;
    /// o filtro de contato deixa passar a parede do portal; depois trata a passagem.
    /// Devolve os objetos que atravessaram (objeto, portal).
    pub fn step(&mut self, w: &mut GameWorld, portals: &Portals, dt: f32, g: &dyn Fn(Vec3) -> Vec3, extra: &mut dyn FnMut(&mut Prop, &mut Physics, f32)) -> Vec<(usize, usize)> {
        let mut crossed = vec![];
        if dt <= 0.0 {
            return crossed;
        }
        let n = ((dt / crate::physics::STEP) - 1e-6).ceil().max(1.0) as usize;
        let h = dt / n as f32;
        for _ in 0..n {
            for p in &mut self.list {
                if p.gone {
                    continue;
                }
                let Some(b) = w.phys.body(p.body) else { continue };
                p.prev_center = b.translation();
                let step = b.linvel() * h;
                let end = p.prev_center + step;
                p.min = p.prev_center.min(end) - Vec3::splat(p.radius);
                p.max = p.prev_center.max(end) + Vec3::splat(p.radius);
                p.mouths = portals.mouths(p.prev_center, false, step.length());
                // segurado perto do azul temporal: atravessa a parede dele (vai junto no salto)
                let tp = if p.held { portals.temporal_wall_near(p.prev_center) } else { None };
                p.pass_wall = tp.and_then(|i| portals.list[i].solid);
                if let Some(i) = tp {
                    if !p.mouths.contains(&i) {
                        p.mouths.push(i);
                    }
                }
                if !p.mouths.is_empty() {
                    if let Some(b) = w.phys.body_mut(p.body) {
                        if b.is_sleeping() {
                            b.wake_up(true);
                        }
                    }
                }
                let gp = g(p.prev_center);
                p.pre(&mut w.phys, h, gp);
                extra(p, &mut w.phys, h);
            }
            let filters: Vec<Filter> = self.list.iter().map(|p| p.filter()).collect();
            let solids = &w.solids;
            let skip = |f: &Filter, other: Option<Ent>| -> bool {
                if f.gone {
                    return true;
                }
                match other {
                    Some(Ent::Player) => f.held,
                    Some(Ent::Static(s)) => f.pass_wall == Some(s) || (!f.mouths.is_empty() && portals.passes(solids, s, &f.mouths, f.min, f.max)),
                    Some(Ent::Dyn(o)) => filters.get(o).is_some_and(|x| x.gone),
                    None => false,
                }
            };
            let blocked = |a: Option<Ent>, b: Option<Ent>| -> bool {
                let (Some(x), Some(y)) = (a, b) else { return false };
                (matches!(x, Ent::Dyn(i) if filters.get(i).is_some_and(|f| skip(f, Some(y))))) || (matches!(y, Ent::Dyn(i) if filters.get(i).is_some_and(|f| skip(f, Some(x)))))
            };
            w.phys.step_once(h, &blocked);
            for (i, p) in self.list.iter_mut().enumerate() {
                if p.gone {
                    continue;
                }
                let GameWorld { phys, solids, .. } = &mut *w;
                let r = p.post(phys, portals, solids, g);
                if let Some(pp) = r {
                    crossed.push((i, pp));
                }
            }
        }
        crossed
    }

    /// copia o estado dos corpos para os campos e para os modelos; o objeto atravessando a boca
    /// de um portal também aparece saindo do outro (a cópia)
    pub fn sync(&mut self, ecs: &mut Ecs, ph: &Physics, portals: &Portals) {
        for p in &mut self.list {
            p.body_state(ph);
            let t = Transform::from_translation(p.quat * p.mesh_offset + p.pos).with_rotation(p.quat).with_scale(Vec3::splat(p.mesh_scale));
            if let Ok(mut e) = ecs.get_entity_mut(p.mesh) {
                e.insert((t, if p.gone { Visibility::Hidden } else { Visibility::Inherited }));
            }
            let mouth = if p.gone { None } else { portals.straddled(p.pos, p.radius) };
            let Some(i) = mouth else {
                if let Some(tw) = &p.twin {
                    if let Ok(mut e) = ecs.get_entity_mut(tw.root) {
                        e.insert(Visibility::Hidden);
                    }
                }
                continue;
            };
            if p.twin.as_ref().is_none_or(|tw| ecs.get_entity(tw.root).is_err()) {
                let Some(parent) = ecs.get::<ChildOf>(p.mesh).map(|c| c.parent()) else { continue };
                p.twin = Some(Twin::new(ecs, p.mesh, parent));
            }
            let tw = p.twin.as_ref().unwrap();
            let m = portals.transform(i, portals.list[i].partner) * t.to_matrix();
            for (k, &(s, d)) in tw.pairs.iter().enumerate() {
                let local = if k == 0 { Transform::from_matrix(m) } else { ecs.get::<Transform>(s).copied().unwrap_or_default() };
                let vis = if k == 0 { Visibility::Inherited } else { ecs.get::<Visibility>(s).copied().unwrap_or_default() };
                if let Ok(mut e) = ecs.get_entity_mut(d) {
                    e.insert((local, vis));
                }
            }
        }
    }

    /// o objeto na mira (raio contra as caixas dos objetos)
    pub fn ray(&self, origin: Vec3, dir: Vec3, max_d: f32) -> Option<(usize, f32)> {
        let mut best: Option<(usize, f32)> = None;
        for (i, c) in self.list.iter().enumerate() {
            if c.gone {
                continue;
            }
            let (mn, mx) = (c.pos - c.half, c.pos + c.half);
            let (mut t0, mut t1) = (0.0f32, max_d);
            let mut ok = true;
            for a in 0..3 {
                if dir[a].abs() < 1e-9 {
                    if origin[a] < mn[a] || origin[a] > mx[a] {
                        ok = false;
                    }
                    continue;
                }
                let mut ta = (mn[a] - origin[a]) / dir[a];
                let mut tb = (mx[a] - origin[a]) / dir[a];
                if ta > tb {
                    std::mem::swap(&mut ta, &mut tb);
                }
                t0 = t0.max(ta);
                t1 = t1.min(tb);
            }
            if ok && t0 <= t1 && best.is_none_or(|b| t0 < b.1) {
                best = Some((i, t0));
            }
        }
        best
    }
}
