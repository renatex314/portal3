//! Bolas de energia (energy.js): saem do lançador em linha reta, quicam nas superfícies,
//! atravessam portais (conservando a velocidade) e, se entrarem no receptor, ligam o sinal dele.
//! Encostar mata. Depois de um tempo a bola se desfaz e o lançador solta outra.

use crate::fx::{kind, Fx};
use crate::geo::{plane_geo, sphere_geo};
use crate::portals::{Portals, Who, PORTAL_A, PORTAL_B};
use crate::props::{Kind, Props};
use crate::world::{bas, bas_a, fx_mat, mesh_h, point_light, put, put_mesh, GameWorld};
use bevy::asset::RenderAssetUsages;
use bevy::ecs::world::World as Ecs;
use bevy::mesh::PrimitiveTopology;
use bevy::prelude::*;

pub const R: f32 = 0.16;
const TRAIL: usize = 14;

pub struct Pellet {
    /// identidade (o relógio do tempo acompanha cada bola)
    pub uid: u64,
    pub pos: Vec3,
    pub vel: Vec3,
    pub life: f32,
    /// lançador de onde saiu (None: bola solta)
    pub from: Option<usize>,
    pub group: Entity,
    shell: Entity,
    sprite: Entity,
    trail: Vec<Entity>,
    hist: Vec<Vec3>,
    light: Entity,
    pub cooldown: f32,
}

/// o que aconteceu com as bolas neste quadro
#[derive(Clone, Debug, PartialEq)]
pub enum EnergyEvent {
    Launch(Vec3),
    Bounce(Vec3),
    Caught(usize),
    Pop(Vec3),
    HitPlayer,
    /// bateu no laranja temporal (aberto no passado): sai pelo ciano Δ s depois (o relógio cuida)
    IntoPast { orange: usize, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>, uid: u64 },
    /// entrou no ciano temporal: vai para o passado (o relógio simula o voo)
    ToPast { blue: usize, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>, uid: u64 },
}

#[derive(Default)]
pub struct Energy {
    pub pellets: Vec<Pellet>,
    mats: Option<(Handle<StandardMaterial>, Handle<StandardMaterial>, Handle<Fx>, Vec<Handle<Fx>>, Handle<Mesh>, Handle<Mesh>, Handle<Mesh>)>,
    hints: Vec<(Entity, usize)>,
    hint_mat: Option<Handle<Fx>>,
    hint_t: i32,
    uid_seq: u64,
    /// fase com relógio do tempo (e o tempo andando): as bolas atravessam o par temporal
    pub temporal: bool,
}

/// arestas de um icosaedro subdividido uma vez (a casca "wireframe" da versão web)
fn ico_lines(r: f32) -> Mesh {
    let t = (1.0 + 5f32.sqrt()) / 2.0;
    let mut v: Vec<Vec3> = [
        [-1.0, t, 0.0], [1.0, t, 0.0], [-1.0, -t, 0.0], [1.0, -t, 0.0],
        [0.0, -1.0, t], [0.0, 1.0, t], [0.0, -1.0, -t], [0.0, 1.0, -t],
        [t, 0.0, -1.0], [t, 0.0, 1.0], [-t, 0.0, -1.0], [-t, 0.0, 1.0],
    ]
    .iter()
    .map(|a| Vec3::from(*a).normalize())
    .collect();
    let faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    let mut mid = std::collections::HashMap::new();
    let mut m = |a: usize, b: usize, v: &mut Vec<Vec3>| -> usize {
        *mid.entry((a.min(b), a.max(b))).or_insert_with(|| {
            v.push(((v[a] + v[b]) * 0.5).normalize());
            v.len() - 1
        })
    };
    let mut edges = std::collections::HashSet::new();
    for f in faces {
        let (a, b, c) = (f[0], f[1], f[2]);
        let ab = m(a, b, &mut v);
        let bc = m(b, c, &mut v);
        let ca = m(c, a, &mut v);
        for tri in [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] {
            for k in 0..3 {
                let (x, y) = (tri[k], tri[(k + 1) % 3]);
                edges.insert((x.min(y), x.max(y)));
            }
        }
    }
    let pos: Vec<[f32; 3]> = edges.iter().flat_map(|&(a, b)| [(v[a] * r).to_array(), (v[b] * r).to_array()]).collect();
    Mesh::new(PrimitiveTopology::LineList, RenderAssetUsages::default()).with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
}

impl Energy {
    /// as entidades visíveis de cada bola (o grupo e o rastro)
    pub fn pellet_parts(&self) -> Vec<Entity> {
        self.pellets.iter().flat_map(|p| std::iter::once(p.group).chain(p.trail.iter().copied())).collect()
    }

    pub fn reset(&mut self, ecs: &mut Ecs) {
        for p in self.pellets.drain(..) {
            despawn(ecs, &p);
        }
        // (as dicas ficam no mundo, que é apagado junto)
        self.hints.clear();
    }

    fn mats(&mut self, ecs: &mut Ecs) -> (Handle<StandardMaterial>, Handle<StandardMaterial>, Handle<Fx>, Vec<Handle<Fx>>, Handle<Mesh>, Handle<Mesh>, Handle<Mesh>) {
        if self.mats.is_none() {
            let core = bas(ecs, LinearRgba::rgb(3.2, 2.2, 1.0));
            let shell = bas_a(ecs, LinearRgba::rgb(2.4, 1.2, 0.3), 0.5, true);
            let glow = fx_mat(ecs, Fx::new(kind::SPRITE).color(LinearRgba::new(1.0, 0.67, 0.24, 1.0)));
            // rastro: brilho cai até a cauda
            let trail = (0..TRAIL)
                .map(|i| {
                    let k = 1.0 - i as f32 / TRAIL as f32;
                    fx_mat(ecs, Fx::new(kind::SPRITE).color(LinearRgba::new(2.6 * k, 1.3 * k, 0.4 * k, k * k)))
                })
                .collect();
            let cg = mesh_h(ecs, &sphere_geo(R, 20, 14));
            let sg = ecs.resource_mut::<Assets<Mesh>>().add(ico_lines(R * 1.45));
            let pg = mesh_h(ecs, &plane_geo(1.0, 1.0));
            self.mats = Some((core, shell, glow, trail, cg, sg, pg));
        }
        self.mats.clone().unwrap()
    }

    pub fn spawn(&mut self, ecs: &mut Ecs, w: &GameWorld, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>) -> usize {
        let (core, shell_m, glow, trail_m, cg, sg, pg) = self.mats(ecs);
        let group = ecs.spawn((Transform::from_translation(pos), Visibility::Visible, ChildOf(w.root()))).id();
        put_mesh(ecs, group, cg, core, Transform::default());
        let shell = put_mesh(ecs, group, sg, shell_m, Transform::default());
        let sprite = put_mesh(ecs, group, pg.clone(), glow, Transform::from_scale(Vec3::splat(1.3)));
        let trail = (0..TRAIL)
            .map(|i| {
                let k = 1.0 - i as f32 / TRAIL as f32;
                put_mesh(ecs, w.root(), pg.clone(), trail_m[i].clone(), Transform::from_translation(pos).with_scale(Vec3::splat(R * 2.2 * k)))
            })
            .collect();
        let light = ecs.spawn((point_light(crate::mats::hex(0xffa040), 6.0, 6.0), Transform::from_translation(pos), ChildOf(w.root()))).id();
        self.uid_seq += 1;
        let uid = self.uid_seq;
        self.pellets.push(Pellet { uid, pos, vel, life, from, group, shell, sprite, trail, hist: vec![pos; TRAIL], light, cooldown: 0.0 });
        self.pellets.len() - 1
    }

    /// tira a bola `i` (o relógio refazendo o mundo)
    pub fn kill_pub(&mut self, ecs: &mut Ecs, w: &mut GameWorld, i: usize) {
        self.kill(ecs, w, i);
    }

    /// põe a bola `i` num estado gravado
    pub fn set_pellet(&mut self, ecs: &mut Ecs, i: usize, pos: Vec3, vel: Vec3, life: f32, cd: f32) {
        let p = &mut self.pellets[i];
        p.pos = pos;
        p.vel = vel;
        p.life = life;
        p.cooldown = cd;
        p.hist.iter_mut().for_each(|h| *h = pos);
        ecs.entity_mut(p.group).insert(Transform::from_translation(pos));
        ecs.entity_mut(p.light).insert(Transform::from_translation(pos));
    }

    fn kill(&mut self, ecs: &mut Ecs, w: &mut GameWorld, i: usize) {
        let p = self.pellets.remove(i);
        despawn(ecs, &p);
        if let Some(l) = p.from {
            if let Some(l) = w.launchers.get_mut(l) {
                l.pellet = None;
                l.wait = 1.6;
            }
        }
        // os índices das bolas seguintes mudaram
        for l in &mut w.launchers {
            if let Some(k) = l.pellet {
                if k > i {
                    l.pellet = Some(k - 1);
                }
            }
        }
    }

    /// dica de mira: luz verde suave na parede em frente a cada lançador e receptor
    fn update_hints(&mut self, ecs: &mut Ecs, w: &GameWorld, t: f32) {
        self.hint_t -= 1;
        let recast = self.hint_t <= 0;
        if recast {
            self.hint_t = 12;
        }
        let items: Vec<(Vec3, Vec3)> = w.launchers.iter().map(|l| (l.pos, l.dir)).chain(w.catchers.iter().map(|c| (c.pos, c.normal))).collect();
        if self.hint_mat.is_none() {
            self.hint_mat = Some(fx_mat(ecs, Fx::new(kind::HINT)));
        }
        let hm = self.hint_mat.clone().unwrap();
        while self.hints.len() < items.len() {
            let e = put(ecs, w.root(), &plane_geo(1.6, 1.6), hm.clone(), Transform::default());
            ecs.entity_mut(e).insert(Visibility::Hidden);
            self.hints.push((e, self.hints.len()));
        }
        if recast {
            for (k, (from, dir)) in items.iter().enumerate() {
                let hit = w.raycast(*from + *dir * 0.3, *dir, 60.0);
                let ok = hit.as_ref().is_some_and(|h| w.solids[h.solid].portal_at(h.normal));
                let e = self.hints[k].0;
                if let (true, Some(h)) = (ok, hit) {
                    let tr = Transform::from_translation(h.point + h.normal * 0.02).with_rotation(Quat::from_rotation_arc(Vec3::Z, h.normal));
                    ecs.entity_mut(e).insert((tr, Visibility::Visible));
                } else {
                    ecs.entity_mut(e).insert(Visibility::Hidden);
                }
            }
        }
        let _ = t;
    }

    /// avança as bolas; `player` = (min, max) do corpo; `time_scale(p)`: tempo da bola no ponto
    #[allow(clippy::too_many_arguments)]
    pub fn update(&mut self, ecs: &mut Ecs, dt: f32, t: f32, w: &mut GameWorld, portals: &Portals, props: &mut Props, player: Option<(Vec3, Vec3)>, time_scale: &dyn Fn(Vec3) -> f32) -> Vec<EnergyEvent> {
        let mut ev = vec![];
        self.update_hints(ecs, w, t);
        for li in 0..w.launchers.len() {
            let l = &w.launchers[li];
            set_color(ecs, &l.glow.clone(), LinearRgba::rgb(2.6, 1.4 + (t * 6.0).sin() * 0.3, 0.5));
            let l = &mut w.launchers[li];
            if l.done || l.pellet.is_some() {
                continue;
            }
            l.wait -= dt;
            if l.wait <= 0.0 {
                let (pos, vel, life) = (l.pos, l.dir * l.speed, l.life);
                let i = self.spawn(ecs, w, pos, vel, life, Some(li));
                w.launchers[li].pellet = Some(i);
                ev.push(EnergyEvent::Launch(pos));
            }
        }
        for c in &w.catchers {
            let k = if c.active { 2.4 } else { 0.9 + (t * 3.0).sin() * 0.2 };
            set_color(ecs, &c.glow, LinearRgba::rgb(0.5 * k, 1.2 * k, 1.8 * k));
            spin(ecs, c.spin, dt * if c.active { 6.0 } else { 0.8 });
        }
        for l in &w.launchers {
            spin(ecs, l.spin, -dt * if l.pellet.is_some() { 1.5 } else { 0.4 + (2.0 - l.wait).max(0.0) * 3.0 });
        }
        let mut i = 0;
        while i < self.pellets.len() {
            let pdt = dt * time_scale(self.pellets[i].pos);
            let p = &mut self.pellets[i];
            p.life -= pdt;
            p.cooldown -= pdt;
            // buraco negro: a trajetória curva (a velocidade não muda); no horizonte, some
            let mut swallowed = false;
            for b in &w.black_holes {
                let d = b.pos - p.pos;
                let r = d.length();
                if r < b.horizon * 1.2 {
                    swallowed = true;
                }
                if r > b.reach {
                    continue;
                }
                let sp = p.vel.length();
                p.vel += d / r * (b.strength / (r * r).max(1.0)).min(60.0) * pdt;
                p.vel = p.vel.normalize() * sp;
            }
            if swallowed {
                ev.push(EnergyEvent::Pop(p.pos));
                self.kill(ecs, w, i);
                continue;
            }
            // passos curtos: a bola nunca atravessa uma parede fina
            let mut rest = p.vel.length() * pdt;
            let mut entered = None;
            while rest > 1e-4 {
                let step = rest.min(0.12);
                rest -= step;
                let dir = p.vel.normalize();
                let next = p.pos + dir * step;
                // ciano temporal: a bola vai para o passado
                if self.temporal && p.cooldown <= 0.0 {
                    if let Some(b) = portals.temporal_crossing(p.pos, next) {
                        entered = Some(EnergyEvent::ToPast { blue: b, pos: p.pos, vel: p.vel, life: p.life, from: p.from, uid: p.uid });
                        break;
                    }
                }
                let crossed = if p.cooldown <= 0.0 { portals.crossing(p.pos, next, Who::Ball) } else { None };
                if let Some(pp) = crossed {
                    p.pos = next;
                    portals.carry(pp, &mut p.pos, &mut p.vel);
                    p.cooldown = 0.1;
                    // passou pelo portal: o tempo recomeça
                    let full = p.from.and_then(|l| w.launchers.get(l)).map(|l| l.life).unwrap_or(0.0);
                    p.life = p.life.max(full);
                    continue;
                }
                // cubos e torretas desviam a bola (e levam um empurrão dela)
                if let Some((pi, dist, n)) = ray_props(props, p.pos, dir, step + R) {
                    p.pos = p.pos + dir * dist + n * 0.002;
                    p.vel -= n * 2.0 * p.vel.dot(n);
                    let pr = &props.list[pi];
                    if !pr.held {
                        let turret = pr.kind == Kind::Turret;
                        let (body, ppos, pq, half) = (pr.body, pr.pos, pr.quat, pr.half);
                        if let Some(b) = w.phys.body_mut(body) {
                            let mut d = dir;
                            d.y = d.y.max(if turret { 0.0 } else { 0.15 });
                            let imp = d.normalize() * b.mass() * if turret { 5.0 } else { 4.0 };
                            let at = if turret { ppos + pq * Vec3::Y * half.y * 0.75 } else { p.pos - n * R };
                            b.apply_impulse_at_point(imp, at, true);
                        }
                    }
                    ev.push(EnergyEvent::Bounce(p.pos));
                    continue;
                }
                let hit = w.raycast(p.pos, dir, step + R);
                // bateu onde há um portal ligado: não quica, segue até cruzar o plano dele
                let into_portal = hit.as_ref().is_some_and(|h| {
                    portals.list.iter().enumerate().any(|(qi, q)| {
                        if !portals.is_linked(qi) || q.delta > 0.0 || (portals.list[q.partner].delta > 0.0 && !self.temporal) || q.solid != Some(h.solid) {
                            return false;
                        }
                        let l = q.local(h.point);
                        (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 1.0
                    })
                });
                // o laranja temporal (aberto no passado): a bola entra e sai pelo ciano Δ s depois
                if let (Some(h), false, true) = (&hit, into_portal, self.temporal) {
                    let o = portals.list.iter().enumerate().position(|(qi, q)| {
                        let l = q.local(h.point);
                        q.placed && q.delta > 0.0 && portals.is_linked(qi) && l.z.abs() < 0.1 && (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 1.0
                    });
                    if let Some(o) = o {
                        entered = Some(EnergyEvent::IntoPast { orange: o, pos: p.pos, vel: p.vel, life: p.life, from: p.from, uid: p.uid });
                        break;
                    }
                }
                if let (Some(h), false) = (&hit, into_portal) {
                    p.pos = h.point + h.normal * (R + 0.002);
                    p.vel -= h.normal * 2.0 * p.vel.dot(h.normal);
                    ev.push(EnergyEvent::Bounce(p.pos));
                    continue;
                }
                p.pos = next;
            }
            if let Some(e) = entered {
                ev.push(e);
                self.kill(ecs, w, i);
                continue;
            }
            let p = &mut self.pellets[i];
            ecs.entity_mut(p.group).insert(Transform::from_translation(p.pos));
            ecs.entity_mut(p.light).insert(Transform::from_translation(p.pos));
            if let Some(mut tr) = ecs.get_mut::<Transform>(p.shell) {
                tr.rotation = Quat::from_euler(EulerRot::XYZ, t * 3.1, t * 4.3, t * 2.2);
            }
            if let Some(mut tr) = ecs.get_mut::<Transform>(p.sprite) {
                tr.scale = Vec3::splat(1.2 + (t * 25.0).sin() * 0.12);
            }
            // rastro (pula a amostra quando a bola atravessa um portal)
            if p.hist[0].distance(p.pos) > 1.5 {
                p.hist.iter_mut().for_each(|h| *h = p.pos);
            }
            p.hist.pop();
            p.hist.insert(0, p.pos);
            for (k, e) in p.trail.iter().enumerate() {
                if let Some(mut tr) = ecs.get_mut::<Transform>(*e) {
                    tr.translation = p.hist[k];
                }
            }
            // receptor
            let pos = p.pos;
            if let Some(ci) = w.catchers.iter().position(|c| !c.active && c.pos.distance(pos) < c.radius) {
                w.catchers[ci].active = true;
                if let Some(l) = self.pellets[i].from {
                    w.launchers[l].done = true;
                }
                self.kill(ecs, w, i);
                ev.push(EnergyEvent::Caught(ci));
                continue;
            }
            // encostou no jogador
            if let Some((mn, mx)) = player {
                if pos.cmpgt(mn - Vec3::splat(R)).all() && pos.cmplt(mx + Vec3::splat(R)).all() {
                    ev.push(EnergyEvent::HitPlayer);
                    self.kill(ecs, w, i);
                    continue;
                }
            }
            if self.pellets[i].life <= 0.0 {
                ev.push(EnergyEvent::Pop(pos));
                self.kill(ecs, w, i);
                continue;
            }
            i += 1;
        }
        ev
    }
}

fn despawn(ecs: &mut Ecs, p: &Pellet) {
    for e in [p.group, p.light].iter().chain(p.trail.iter()) {
        if let Ok(e) = ecs.get_entity_mut(*e) {
            e.despawn();
        }
    }
}

fn set_color(ecs: &mut Ecs, h: &Handle<StandardMaterial>, c: LinearRgba) {
    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(h) {
        m.base_color = Color::LinearRgba(c);
    }
}

fn spin(ecs: &mut Ecs, e: Entity, a: f32) {
    if let Some(mut t) = ecs.get_mut::<Transform>(e) {
        t.rotate_local_y(a);
    }
}

/// raio (a bola, com raio R) contra as caixas orientadas dos objetos: (objeto, distância, normal)
fn ray_props(props: &Props, origin: Vec3, dir: Vec3, max_d: f32) -> Option<(usize, f32, Vec3)> {
    let mut best: Option<(usize, f32, Vec3)> = None;
    for (k, pr) in props.list.iter().enumerate() {
        if pr.gone {
            continue;
        }
        let qi = pr.quat.inverse();
        let o = qi * (origin - pr.pos);
        let d = qi * dir;
        let (mut t0, mut t1) = (0.0f32, max_d);
        let mut axis: i32 = -1;
        let mut sign = 0.0;
        for a in 0..3 {
            let h = pr.half[a] + R;
            if d[a].abs() < 1e-9 {
                if o[a] < -h || o[a] > h {
                    t0 = f32::INFINITY;
                }
                continue;
            }
            let mut ta = (-h - o[a]) / d[a];
            let mut tb = (h - o[a]) / d[a];
            let s = -d[a].signum();
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
            }
            if ta > t0 {
                t0 = ta;
                axis = a as i32;
                sign = s;
            }
            t1 = t1.min(tb);
        }
        if axis < 0 || t0 > t1 || best.is_some_and(|b| t0 >= b.1) {
            continue;
        }
        let mut n = Vec3::ZERO;
        n[axis as usize] = sign;
        best = Some((k, t0, pr.quat * n));
    }
    best
}
