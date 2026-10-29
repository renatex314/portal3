//! O mundo do jogo (world.js): caixas alinhadas aos eixos (paredes, pisos, plataformas),
//! materiais (o que aceita portal e o que não aceita), volumes de perigo, gatilhos, portas,
//! botões, o elevador de saída e os mecanismos de cada série. A lógica fica aqui; os visuais
//! são entidades do Bevy guardadas em cada peça.

use crate::fx::{self, Fx};
use crate::geo::{self, Geo};
use crate::glb;
use crate::mats::{basic, basic_alpha, hex, hex_k, Mats};
use crate::physics::{Ent, Physics};
use crate::signs::{self, SignLine};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use rand::Rng;
use rapier3d::prelude::{ColliderHandle, RigidBodyHandle};
use std::collections::{HashMap, HashSet};
use std::f32::consts::{FRAC_PI_2, PI, TAU};

pub const TILE: f32 = 2.0; // metros por repetição de textura

/// intensidade de luz: a versão web usa candelas com queda 1/d^1,5; o Bevy usa lúmens com 1/d²
/// (a janela de alcance é a mesma). O fator compensa a queda mais forte na distância típica.
pub const LIGHT_K0: f32 = 4.0 * PI * 2.2;
#[allow(non_snake_case)]
pub fn LIGHT_K() -> f32 {
    static K: std::sync::OnceLock<f32> = std::sync::OnceLock::new();
    *K.get_or_init(|| LIGHT_K0 * std::env::var("PORTAL3_LIGHT").ok().and_then(|v| v.parse().ok()).unwrap_or(1.0))
}

#[derive(Clone, Copy, Debug)]
pub struct Obb {
    pub c: Vec3,
    pub q: Quat,
    pub qi: Quat,
    pub half: Vec3,
}

#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub n: Vec3,
    pub d: f32,
    pub portal: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct PanelInfo {
    pub n: Vec3,
    pub up: Vec3,
    pub right: Vec3,
    pub face: Vec3,
}

/// caixa do cenário (sólida, de perigo ou só visual)
#[derive(Clone, Debug)]
pub struct Solid {
    pub min: Vec3,
    pub max: Vec3,
    pub mat: String,
    pub portalable: bool,
    pub entity: Option<Entity>,
    pub solid: bool,
    pub no_ray: bool,
    pub see_through: bool,
    pub disabled: bool,
    pub collider: Option<ColliderHandle>,
    pub kbody: Option<RigidBodyHandle>,
    pub obb: Option<Obb>,
    /// sólido convexo (mapas importados): planos e vértices (já no lugar)
    pub planes: Option<Vec<Plane>>,
    pub pts: Option<Vec<Vec3>>,
    /// face a face (+x −x +y −y +z −z): aceita portal? (mapas importados)
    pub portal_faces: Option<[bool; 6]>,
    /// célula do editor (o editor esconde os andares de cima)
    pub cell: Option<IVec3>,
    pub surface_fit: bool,
    pub is_hazard: bool,
    /// existe na época atual (viagem no tempo)
    pub active: bool,
    pub bridge: bool,
    pub removed: bool,
    pub panel: Option<PanelInfo>,
    /// campanha original: posição de origem (para andar com a peça móvel), vidro quebrável
    /// (o nó de quem é) e peça de colisão de um modelo
    pub base0: Option<Box<SolidBase>>,
    pub breakable: Option<usize>,
    pub prop: bool,
}

/// a forma de um sólido na posição de origem (a peça anda somando um deslocamento)
#[derive(Clone, Debug)]
pub struct SolidBase {
    pub min: Vec3,
    pub max: Vec3,
    pub planes: Option<Vec<Plane>>,
    pub pts: Option<Vec<Vec3>>,
}

impl Solid {
    pub fn new(min: Vec3, max: Vec3, mat: &str) -> Self {
        Solid {
            min,
            max,
            mat: mat.to_string(),
            portalable: false,
            entity: None,
            solid: true,
            no_ray: false,
            see_through: false,
            disabled: false,
            collider: None,
            kbody: None,
            obb: None,
            planes: None,
            pts: None,
            portal_faces: None,
            cell: None,
            surface_fit: false,
            is_hazard: false,
            active: true,
            bridge: false,
            removed: false,
            panel: None,
            base0: None,
            breakable: None,
            prop: false,
        }
    }

    /// a face com essa normal aceita portal? (mapas importados)
    pub fn portal_at(&self, n: Vec3) -> bool {
        if let Some(pl) = &self.planes {
            return pl.iter().any(|p| p.portal && p.n.dot(n) > 0.999);
        }
        match self.portal_faces {
            Some(f) => {
                let i = if n.x.abs() > 0.5 {
                    if n.x > 0.0 { 0 } else { 1 }
                } else if n.y.abs() > 0.5 {
                    if n.y > 0.0 { 2 } else { 3 }
                } else if n.z > 0.0 {
                    4
                } else {
                    5
                };
                f[i]
            }
            None => self.portalable,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RayHit {
    pub solid: usize,
    pub dist: f32,
    pub point: Vec3,
    pub normal: Vec3,
    /// eixo da face atingida numa caixa alinhada (−1 em caixa girada/convexa)
    pub axis: i32,
}

#[derive(Clone, Debug, Default)]
pub struct Door {
    pub id: Option<String>,
    pub solid: usize,
    pub plain: bool,
    pub lamps: Option<Vec<Handle<StandardMaterial>>>,
    pub open: f32,
    pub target: f32,
    pub base_min: Vec3,
    pub base_max: Vec3,
    pub axis: usize,
    pub latch: bool,
    pub dist: f32,
    pub speed: f32,
    pub speed_back: Option<f32>,
    pub delta: Vec3,
    pub offset: Vec3,
    pub path: Option<Vec3>,
    pub looping: f32,
    pub waits: Option<[f32; 2]>,
    pub always: bool,
    pub crush: bool,
    pub mover: bool,
    pub wait: f32,
    pub instant: bool,
    pub seen: bool,
    pub mesh: Option<Entity>,
    /// peças que andam junto (faixas acesas): entidade e posição de base
    pub followers: Vec<(Entity, Vec3)>,
    /// movida por fora (campanha original): o mundo não mexe, só lê `delta` para carregar o jogador
    pub external: bool,
}

#[derive(Clone, Debug)]
pub struct Trigger {
    pub min: Vec3,
    pub max: Vec3,
    pub done: bool,
    pub exit: bool,
    pub fin: bool,
    pub era: Option<String>,
    pub lines: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
pub struct FloorButton {
    pub pos: Vec3,
    pub opens: Option<String>,
    pub pressed: bool,
    pub hold: f32,
    pub count: f32,
    pub group: Entity,
    pub plate: Option<Entity>,
    pub plate_mat: Option<Handle<StandardMaterial>>,
    pub lights_mat: Option<Handle<StandardMaterial>>,
    pub spin: Option<Entity>,
    pub v: f32,
    pub k: f32,
    pub c: f32,
}

#[derive(Clone, Debug)]
pub struct Chan {
    pub sig: String,
    pub mode: String,
    pub time: f32,
    pub on: bool,
    pub left: f32,
}

#[derive(Clone, Debug)]
pub struct PushButton {
    pub pos: Vec3,
    pub opens: Option<String>,
    pub mode: String,
    pub time: f32,
    pub on: bool,
    pub left: f32,
    pub press: f32,
    pub tick: f32,
    pub group: Entity,
    pub cap: Option<Entity>,
    pub cap_base: Vec3,
    pub segs: Vec<Entity>,
    pub lamps: Vec<Entity>,
    pub on_mat: Handle<StandardMaterial>,
    pub off_mat: Handle<StandardMaterial>,
    pub cap_mat: Option<Handle<StandardMaterial>>,
    pub cap_em: LinearRgba,
    pub chans: Option<Vec<Chan>>,
}

#[derive(Clone, Debug)]
pub struct Fizzler {
    pub min: Vec3,
    pub max: Vec3,
    pub axis: usize,
    pub plane: Entity,
    pub motes: Entity,
    pub mats: Vec<Handle<Fx>>,
    pub field: Handle<Fx>,
    pub size: Vec2,
    pub center: Vec3,
    pub rot: Quat,
    pub sig: Option<String>,
    pub mode: String,
    pub on: bool,
}

#[derive(Clone, Debug)]
pub struct Launcher {
    pub pos: Vec3,
    pub dir: Vec3,
    pub group: Entity,
    pub glow: Handle<StandardMaterial>,
    pub spin: Entity,
    pub pellet: Option<usize>,
    pub wait: f32,
    pub life: f32,
    pub speed: f32,
    pub done: bool,
}

#[derive(Clone, Debug)]
pub struct Catcher {
    pub pos: Vec3,
    pub normal: Vec3,
    pub opens: Option<String>,
    pub active: bool,
    pub was_active: bool,
    pub group: Entity,
    pub glow: Handle<StandardMaterial>,
    pub spin: Entity,
    pub radius: f32,
}

#[derive(Clone, Debug)]
pub struct Incinerator {
    pub min: Vec3,
    pub max: Vec3,
    pub opens: Option<String>,
    pub active: bool,
    pub light: Entity,
}

#[derive(Clone, Debug)]
pub struct Pedestal {
    pub pos: Vec3,
    pub gives: String,
    pub holder: Entity,
    pub height: f32,
    pub taken: bool,
    pub light: Entity,
}

#[derive(Clone, Debug)]
pub struct LaserEmitter {
    pub pos: Vec3,
    pub dir: Vec3,
    pub group: Entity,
    pub lens: Handle<StandardMaterial>,
    pub sig: Option<String>,
    pub off: bool,
    /// ponte de luz: o modelo (BRIDGE_LOOKS); None = laser
    pub bridge: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LaserCatcher {
    pub pos: Vec3,
    pub normal: Vec3,
    pub opens: Option<String>,
    pub active: bool,
    pub was_active: bool,
    pub group: Entity,
    pub glow: Handle<StandardMaterial>,
    pub spin: Entity,
}

#[derive(Clone, Debug)]
pub struct Plate {
    pub pos: Vec3,
    pub vel: Vec3,
    pub hinge: Entity,
    pub glow: Handle<StandardMaterial>,
    pub cool: f32,
    pub kick: f32,
    pub ring: Option<Entity>,
}

#[derive(Clone, Debug)]
pub struct Funnel {
    pub pos: Vec3,
    pub dir: Vec3,
    pub id: Option<String>,
    pub reversed: bool,
    pub start_reversed: bool,
    pub speed: f32,
    pub power: Option<String>,
    pub off: bool,
    pub latch: bool,
    pub group: Entity,
    pub ring: Handle<StandardMaterial>,
}

#[derive(Clone, Debug)]
pub struct GravZone {
    pub min: Vec3,
    pub max: Vec3,
    pub g: Vec3,
}

#[derive(Clone, Debug)]
pub struct BlackHole {
    pub pos: Vec3,
    pub strength: f32,
    pub horizon: f32,
    pub reach: f32,
    pub group: Entity,
}

#[derive(Clone, Debug)]
pub struct MoonInfo {
    pub pos: Vec3,
    pub r: f32,
    pub spot: Option<serde_json::Value>,
}

#[derive(Clone, Debug)]
pub enum EraObj {
    Solid(usize),
    Entity(Entity),
    Light(Entity, f32),
}

#[derive(Clone, Debug)]
pub struct PushMode {
    pub base: String,
    pub mode: String,
    pub time: f32,
}

/// animações simples dos cenários (o `this.anim` da versão web)
#[derive(Clone, Debug)]
pub enum Anim {
    /// luz da fornalha tremendo
    Incinerator { light: Entity },
    /// anel do dispensador pulsando
    Dispenser { mat: Handle<StandardMaterial> },
    /// pedestal girando a arma
    Pedestal { holder: Entity, height: f32 },
    /// elevador de saída: vidro pulsando e anel subindo
    Elevator { tube: Handle<StandardMaterial>, scan: Entity, scan_mat: Handle<StandardMaterial>, s: f32 },
    /// anel do ponto de pouso da placa de lançamento
    PlateRing { ring: Entity },
    /// Lua e Terra girando
    Spin { e: Entity, speed: f32 },
}

#[derive(Default)]
pub struct GameWorld {
    pub root: Option<Entity>,
    pub solids: Vec<Solid>,
    pub hazards: Vec<usize>,
    pub lava_lights: Vec<(Entity, f32, f32)>,
    pub push_buttons: Vec<PushButton>,
    pub push_modes: HashMap<String, PushMode>,
    pub push_used: HashSet<String>,
    pub triggers: Vec<Trigger>,
    pub doors: Vec<Door>,
    pub buttons: Vec<FloorButton>,
    pub anims: Vec<Anim>,
    pub fizzlers: Vec<Fizzler>,
    pub launchers: Vec<Launcher>,
    pub catchers: Vec<Catcher>,
    pub incinerators: Vec<Incinerator>,
    pub pedestals: Vec<Pedestal>,
    pub lasers: Vec<LaserEmitter>,
    pub laser_catchers: Vec<LaserCatcher>,
    pub signals: HashMap<String, bool>,
    pub plates: Vec<Plate>,
    pub funnels: Vec<Funnel>,
    pub grav_zones: Vec<GravZone>,
    pub black_holes: Vec<BlackHole>,
    pub era_items: Vec<(EraObj, String)>,
    pub era: String,
    pub moon: Option<MoonInfo>,
    pub phys: Physics,
    /// grade espacial dos sólidos parados (mapas grandes: a campanha original)
    pub grid: std::sync::Mutex<Option<std::sync::Arc<SolidGrid>>>,
}

/// sólidos parados por célula; os que se mexem (e os enormes) ficam em `always`
pub struct SolidGrid {
    n: usize,
    doors: usize,
    min: Vec3,
    c: f32,
    dims: [i32; 3],
    cells: HashMap<i32, Vec<usize>>,
    always: Vec<usize>,
}

const GRID_MIN: usize = 600;

// ------------------------------------------------------------------ ajudantes de cena
pub enum M {
    Std(Handle<StandardMaterial>),
    Fx(Handle<Fx>),
}
impl From<Handle<StandardMaterial>> for M {
    fn from(h: Handle<StandardMaterial>) -> Self {
        M::Std(h)
    }
}
impl From<&Handle<StandardMaterial>> for M {
    fn from(h: &Handle<StandardMaterial>) -> Self {
        M::Std(h.clone())
    }
}
impl From<Handle<Fx>> for M {
    fn from(h: Handle<Fx>) -> Self {
        M::Fx(h)
    }
}

pub fn mesh_h(ecs: &mut Ecs, g: &Geo) -> Handle<Mesh> {
    ecs.resource_mut::<Assets<Mesh>>().add(g.mesh())
}

/// malha filha de `parent` (ou solta) com o material e a posição dados
pub fn put(ecs: &mut Ecs, parent: Entity, g: &Geo, mat: impl Into<M>, t: Transform) -> Entity {
    let mh = mesh_h(ecs, g);
    put_mesh(ecs, parent, mh, mat, t)
}

pub fn put_mesh(ecs: &mut Ecs, parent: Entity, mh: Handle<Mesh>, mat: impl Into<M>, t: Transform) -> Entity {
    let e = ecs.spawn((Mesh3d(mh), t, Visibility::default(), ChildOf(parent))).id();
    match mat.into() {
        M::Std(h) => ecs.entity_mut(e).insert(MeshMaterial3d(h)),
        M::Fx(h) => ecs.entity_mut(e).insert(MeshMaterial3d(h)),
    };
    e
}

pub fn group(ecs: &mut Ecs, parent: Entity, t: Transform) -> Entity {
    ecs.spawn((t, Visibility::default(), ChildOf(parent))).id()
}

pub fn std_mat(ecs: &mut Ecs, m: StandardMaterial) -> Handle<StandardMaterial> {
    ecs.resource_mut::<Assets<StandardMaterial>>().add(m)
}

pub fn fx_mat(ecs: &mut Ecs, m: Fx) -> Handle<Fx> {
    ecs.resource_mut::<Assets<Fx>>().add(m)
}

pub fn bas(ecs: &mut Ecs, c: LinearRgba) -> Handle<StandardMaterial> {
    basic(&mut ecs.resource_mut::<Assets<StandardMaterial>>(), c)
}

pub fn bas_a(ecs: &mut Ecs, c: LinearRgba, opacity: f32, additive: bool) -> Handle<StandardMaterial> {
    basic_alpha(&mut ecs.resource_mut::<Assets<StandardMaterial>>(), c, opacity, additive)
}

/// luz pontual da versão web (cor hex, candelas, alcance, queda)
pub fn point_light(color: Color, intensity: f32, dist: f32) -> PointLight {
    PointLight { color, intensity: intensity * LIGHT_K(), range: if dist > 0.0 { dist } else { 60.0 }, radius: 0.05, shadow_maps_enabled: false, ..default() }
}

fn rgb(r: f32, g: f32, b: f32) -> LinearRgba {
    LinearRgba::rgb(r, g, b)
}

pub(crate) fn mats(ecs: &Ecs) -> Mats {
    ecs.resource::<Mats>().clone()
}

/// quaternion que leva +y para `d` (setFromUnitVectors)
pub fn q_from_y(d: Vec3) -> Quat {
    Quat::from_rotation_arc(Vec3::Y, d.normalize())
}

/// base (x, y, z) → rotação (makeBasis)
pub fn q_basis(x: Vec3, y: Vec3, z: Vec3) -> Quat {
    Quat::from_mat3(&Mat3::from_cols(x, y, z))
}

pub fn aabb_overlap(a_min: Vec3, a_max: Vec3, b_min: Vec3, b_max: Vec3, eps: f32) -> bool {
    a_min.x < b_max.x - eps && a_max.x > b_min.x + eps && a_min.y < b_max.y - eps && a_max.y > b_min.y + eps && a_min.z < b_max.z - eps && a_max.z > b_min.z + eps
}

/// raio contra caixa girada
pub fn ray_obb(origin: Vec3, dir: Vec3, obb: &Obb, max_dist: f32) -> Option<(f32, Vec3, Vec3)> {
    let o = obb.qi * (origin - obb.c);
    let d = obb.qi * dir;
    let (mut tmin, mut tmax) = (f32::NEG_INFINITY, f32::INFINITY);
    let (mut axis, mut sign) = (-1i32, 0.0f32);
    for i in 0..3 {
        let (oi, di, h) = (o[i], d[i], obb.half[i]);
        if di.abs() < 1e-9 {
            if oi < -h || oi > h {
                return None;
            }
            continue;
        }
        let (mut t1, mut t2) = ((-h - oi) / di, (h - oi) / di);
        let mut s = -1.0;
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
            s = 1.0;
        }
        if t1 > tmin {
            tmin = t1;
            axis = i as i32;
            sign = s;
        }
        tmax = tmax.min(t2);
        if tmin > tmax {
            return None;
        }
    }
    if tmin < 0.0 || tmin > max_dist || axis < 0 {
        return None;
    }
    let mut n = Vec3::ZERO;
    n[axis as usize] = sign;
    Some((tmin, origin + dir * tmin, obb.q * n))
}

fn ray_hits_box(o: Vec3, d: Vec3, min: Vec3, max: Vec3, max_dist: f32) -> bool {
    let (mut t0, mut t1) = (0.0f32, max_dist + 1e-3);
    for a in 0..3 {
        if d[a].abs() < 1e-12 {
            if o[a] < min[a] - 1e-3 || o[a] > max[a] + 1e-3 {
                return false;
            }
            continue;
        }
        let (mut ta, mut tb) = ((min[a] - 1e-3 - o[a]) / d[a], (max[a] + 1e-3 - o[a]) / d[a]);
        if ta > tb {
            std::mem::swap(&mut ta, &mut tb);
        }
        t0 = t0.max(ta);
        t1 = t1.min(tb);
        if t0 > t1 {
            return false;
        }
    }
    true
}

fn ray_convex(origin: Vec3, dir: Vec3, planes: &[Plane], max_dist: f32) -> Option<(f32, Vec3, Vec3)> {
    let (mut tmin, mut tmax) = (0.0f32, max_dist);
    let mut hit_n = None;
    for pl in planes {
        let den = pl.n.dot(dir);
        let dist = pl.d - pl.n.dot(origin);
        if den.abs() < 1e-9 {
            if dist < 0.0 {
                return None;
            }
            continue;
        }
        let t = dist / den;
        if den < 0.0 {
            if t > tmin {
                tmin = t;
                hit_n = Some(pl.n);
            }
        } else if t < tmax {
            tmax = t;
        }
        if tmin > tmax {
            return None;
        }
    }
    hit_n.map(|n| (tmin, origin + dir * tmin, n))
}

fn mm(x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32) -> (Vec3, Vec3) {
    (Vec3::new(x0.min(x1), y0.min(y1), z0.min(z1)), Vec3::new(x0.max(x1), y0.max(y1), z0.max(z1)))
}

impl GameWorld {
    pub fn new(ecs: &mut Ecs) -> Self {
        let root = ecs.spawn((Transform::default(), Visibility::default(), Name::new("mundo"))).id();
        GameWorld { root: Some(root), era: "past".into(), ..default() }
    }

    pub fn root(&self) -> Entity {
        self.root.expect("mundo sem raiz")
    }

    /// apaga tudo (fim de fase)
    pub fn clear(&mut self, ecs: &mut Ecs) {
        if let Some(r) = self.root.take() {
            if let Ok(e) = ecs.get_entity_mut(r) {
                e.despawn();
            }
        }
        *self = GameWorld::new(ecs);
    }

    /// as caixas sólidas "na lista" (como world.solids: tiradas quando a época não é a delas)
    pub fn listed(&self, i: usize) -> bool {
        let b = &self.solids[i];
        b.solid && b.active && !b.removed
    }

    pub fn solid_ids(&self) -> impl Iterator<Item = usize> + '_ {
        (0..self.solids.len()).filter(|&i| self.listed(i))
    }

    // ------------------------------------------------------------------ caixas
    /// caixa do cenário (`opts`: solid=false, kinematic, noPortal, era)
    pub fn add_box(&mut self, ecs: &mut Ecs, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, mat: &str, solid: bool, kinematic: bool, no_portal: bool) -> usize {
        let m = mats(ecs);
        let grate = mat == "grate";
        let (min, max) = mm(x0, y0, z0, x1, y1, z1);
        let faces = geo::world_box_faces(min, max, TILE);
        let parent = ecs.spawn((Transform::default(), Visibility::default(), ChildOf(self.root()))).id();
        if grate {
            let g = crate::mats::grate_material(ecs);
            for f in &faces {
                put(ecs, parent, f, g.clone(), Transform::default());
            }
        } else {
            let bm = m.kind(mat).clone();
            for (i, f) in faces.iter().enumerate() {
                put(ecs, parent, f, bm.faces[i].clone(), Transform::default());
            }
            if mat == "glass" {
                self.glass_frame(ecs, parent, min, max);
            }
        }
        let portalable = !grate && m.kind(mat).portalable && !no_portal;
        let mut b = Solid::new(min, max, mat);
        b.portalable = portalable;
        b.entity = Some(parent);
        b.solid = solid;
        if grate {
            b.no_ray = true;
            b.see_through = true;
        }
        let id = self.solids.len();
        if solid {
            let (c, k) = self.phys.add_box(id, (min + max) * 0.5, (max - min) * 0.5, Quat::IDENTITY, kinematic);
            b.collider = Some(c);
            b.kbody = k;
        }
        self.solids.push(b);
        id
    }

    /// bloco com um material por face (+x, −x, +y, −y, +z, −z); None = a face não aparece
    pub fn imported_box(&mut self, ecs: &mut Ecs, min: Vec3, max: Vec3, faces: &[Option<String>], cell: Option<IVec3>) -> usize {
        let m = mats(ecs);
        let geos = geo::world_box_faces(min, max, TILE);
        let parent = ecs.spawn((Transform::default(), Visibility::default(), ChildOf(self.root()))).id();
        let mut portal = [false; 6];
        for (i, g) in geos.iter().enumerate() {
            let Some(k) = faces.get(i).cloned().flatten() else { continue };
            portal[i] = k == "white";
            put(ecs, parent, g, m.kind(&k).faces[i].clone(), Transform::default());
        }
        let mat = faces.iter().flatten().next().cloned().unwrap_or_else(|| "metal".into());
        let mut b = Solid::new(min, max, &mat);
        b.portalable = portal.iter().any(|&x| x);
        b.portal_faces = Some(portal);
        b.surface_fit = true;
        b.entity = Some(parent);
        b.cell = cell;
        let id = self.solids.len();
        let (c, k) = self.phys.add_box(id, (min + max) * 0.5, (max - min) * 0.5, Quat::IDENTITY, false);
        b.collider = Some(c);
        b.kbody = k;
        self.solids.push(b);
        id
    }

    /// cantoneiras escuras nas 12 arestas de uma caixa de vidro
    fn glass_frame(&mut self, ecs: &mut Ecs, parent: Entity, min: Vec3, max: Vec3) {
        let s = max - min;
        let c = (min + max) * 0.5;
        let t = 0.06;
        let frame = mats(ecs).frame;
        for ax in 0..3 {
            let others: Vec<usize> = (0..3).filter(|&k| k != ax).collect();
            for sa in [-1.0, 1.0] {
                for sb in [-1.0, 1.0] {
                    let mut size = Vec3::splat(t);
                    size[ax] = s[ax] + t;
                    let mut p = c;
                    p[others[0]] += sa * s[others[0]] / 2.0;
                    p[others[1]] += sb * s[others[1]] / 2.0;
                    put(ecs, parent, &geo::box_geo(size.x, size.y, size.z), frame.clone(), Transform::from_translation(p));
                }
            }
        }
    }

    /// volume que mata ao tocar (com superfície de rocha fundida)
    pub fn hazard(&mut self, ecs: &mut Ecs, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, light_k: Option<f32>, light_lift: Option<f32>) -> usize {
        let id = self.add_box(ecs, x0, y0, z0, x1, y1, z1, "magma", false, false, false);
        crate::lava::lava_box(ecs, self.solids[id].entity.unwrap(), self.solids[id].min, self.solids[id].max);
        self.solids[id].is_hazard = true;
        self.hazards.push(id);
        let base = light_k.unwrap_or(25.0);
        let p = Vec3::new((x0 + x1) / 2.0, y0.max(y1) + light_lift.unwrap_or(1.5), (z0 + z1) / 2.0);
        let l = ecs.spawn((point_light(hex(0xff6a20), base, 18.0), Transform::from_translation(p), ChildOf(self.root()))).id();
        self.lava_lights.push((l, base, rand::rng().random::<f32>() * 100.0));
        let b = &self.solids[id];
        if b.max.y - b.min.y < 3.0 {
            crate::lava::embers(ecs, self.root(), b.min, b.max, b.max.y);
        }
        id
    }

    pub fn trigger(&mut self, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, exit: bool, fin: bool, era: Option<String>, lines: Vec<(String, String)>) -> usize {
        let (min, max) = mm(x0, y0, z0, x1, y1, z1);
        self.triggers.push(Trigger { min, max, done: false, exit, fin, era, lines });
        self.triggers.len() - 1
    }

    /// luz pontual com luminária no teto (`fixture`: caixa escura, difusor aceso e grade)
    pub fn light(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, intensity: f32, color: u32, dist: f32, fixture: bool) -> Entity {
        let l = ecs.spawn((point_light(hex(color), intensity, dist), Transform::from_xyz(x, y, z), ChildOf(self.root()))).id();
        if !fixture {
            return l;
        }
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y + 0.27, z));
        put(ecs, g, &geo::box_geo(1.86, 0.14, 0.52), m.frame.clone(), Transform::from_xyz(0.0, 0.07, 0.0));
        let dif = bas(ecs, hex_k(color, 2.6));
        put(ecs, g, &geo::box_geo(1.66, 0.03, 0.36), dif, Transform::from_xyz(0.0, -0.005, 0.0));
        let slat = mesh_h(ecs, &geo::box_geo(0.02, 0.03, 0.42));
        for i in -3..=3 {
            put_mesh(ecs, g, slat.clone(), m.dark.clone(), Transform::from_xyz(i as f32 * 0.24, -0.025, 0.0));
        }
        let rod = mesh_h(ecs, &geo::cylinder_geo(0.012, 0.012, 0.5, 6, 1, false));
        for sx in [-1.0, 1.0] {
            put_mesh(ecs, g, rod.clone(), m.dark.clone(), Transform::from_xyz(sx * 0.7, 0.38, 0.0));
        }
        l
    }

    // ------------------------------------------------------------------ portas e plataformas
    /// porta que sobe quando aberta
    pub fn door(&mut self, ecs: &mut Ecs, id: Option<String>, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, axis: Option<&str>, dist: Option<f32>, speed: Option<f32>, latch: bool, mat: Option<&str>) -> usize {
        let mat_name = mat.unwrap_or(if axis.is_some() { "stripe" } else { "metal" });
        let b = self.add_box(ecs, x0, y0, z0, x1, y1, z1, mat_name, true, true, false);
        let plain = axis.is_none() && mat.is_none();
        let ent = self.solids[b].entity.unwrap();
        if plain {
            // porta de verdade: textura própria (UV de 0 a 1 na folha) nas duas faces largas
            let (min, max) = (self.solids[b].min, self.solids[b].max);
            let size = max - min;
            let c = (min + max) * 0.5;
            let m = mats(ecs);
            ecs.entity_mut(ent).despawn_children();
            let thin_x = size.x < size.z;
            for i in 0..6 {
                let f = geo::box_face(size.x, size.y, size.z, i).translate_v(c);
                let wide = if thin_x { i < 2 } else { i >= 4 };
                put(ecs, ent, &f, if wide { m.door.clone() } else { m.frame.clone() }, Transform::default());
            }
        }
        let (min, max) = (self.solids[b].min, self.solids[b].max);
        let ax = match axis.unwrap_or("y") {
            "x" => 0,
            "z" => 2,
            _ => 1,
        };
        let d = Door {
            id,
            solid: b,
            plain,
            base_min: min,
            base_max: max,
            axis: ax,
            latch,
            dist: dist.unwrap_or((y1 - y0).abs() - 0.15),
            speed: speed.unwrap_or(1.4),
            mesh: Some(ent),
            ..default()
        };
        self.doors.push(d);
        self.doors.len() - 1
    }

    /// plataforma (elevador) que sobe/anda quando o sinal liga; leva quem estiver em cima
    pub fn platform(&mut self, ecs: &mut Ecs, id: Option<String>, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, axis: &str, dist: f32, speed: f32, looping: f32, always: bool) -> usize {
        let d = self.door(ecs, id, x0, y0, z0, x1, y1, z1, Some(axis), Some(1.0), Some(speed / dist.abs()), false, Some("metal"));
        self.doors[d].dist = dist;
        self.doors[d].looping = looping;
        self.doors[d].always = always;
        self.doors[d].wait = looping;
        let top = y0.max(y1);
        let s1 = self.strip(ecs, x0.min(x1) + 0.05, top + 0.005, z0.min(z1) + 0.05, x0.max(x1) - 0.05, top + 0.02, z0.min(z1) + 0.12, 0xffcc33, 1.4);
        let s2 = self.strip(ecs, x0.min(x1) + 0.05, top + 0.005, z0.max(z1) - 0.12, x0.max(x1) - 0.05, top + 0.02, z0.max(z1) - 0.05, 0xffcc33, 1.4);
        for s in [s1, s2] {
            let p = ecs.get::<Transform>(s).unwrap().translation;
            self.doors[d].followers.push((s, p));
        }
        d
    }

    /// plataforma que vai e volta sozinha ao longo de `to`
    pub fn mover(&mut self, ecs: &mut Ecs, id: Option<String>, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, to: Vec3, speed: f32, back: Option<f32>, waits: [f32; 2], always: bool, phase: f32, crush: bool, mat: &str, marks: bool) -> usize {
        let d = self.door(ecs, id, x0, y0, z0, x1, y1, z1, None, None, None, false, Some(mat));
        let l = to.length();
        let dd = &mut self.doors[d];
        dd.path = Some(to);
        dd.speed = speed / l;
        dd.speed_back = Some(back.unwrap_or(speed) / l);
        dd.looping = 1.0;
        dd.waits = Some(waits);
        dd.always = always;
        dd.crush = crush;
        dd.mover = true;
        dd.open = phase;
        dd.target = 1.0;
        dd.wait = waits[1];
        if marks {
            let top = y0.max(y1);
            let (ax, bx, az, bz) = (x0.min(x1), x0.max(x1), z0.min(z1), z0.max(z1));
            let color = if crush { 0xff3a2a } else { 0xffcc33 };
            for (sx0, sz0, sx1, sz1) in [(ax + 0.05, az + 0.05, bx - 0.05, az + 0.15), (ax + 0.05, bz - 0.15, bx - 0.05, bz - 0.05), (ax + 0.05, az + 0.05, ax + 0.15, bz - 0.05), (bx - 0.15, az + 0.05, bx - 0.05, bz - 0.05)] {
                let (ya, yb) = if crush { (y0.min(y1) - 0.02, y0.min(y1) - 0.005) } else { (top + 0.005, top + 0.02) };
                let s = self.strip(ecs, sx0, ya, sz0, sx1, yb, sz1, color, 1.6);
                let p = ecs.get::<Transform>(s).unwrap().translation;
                self.doors[d].followers.push((s, p));
            }
        }
        d
    }

    /// rampa: caixa girada (euler `rot`); de concreto claro aceita portal na diagonal
    pub fn ramp(&mut self, ecs: &mut Ecs, c: Vec3, size: Vec3, rot: Vec3, mat: &str) -> usize {
        let m = mats(ecs);
        let half = size / 2.0;
        let q = Quat::from_euler(EulerRot::XYZ, rot.x, rot.y, rot.z);
        let parent = ecs.spawn((Transform::from_translation(c).with_rotation(q), Visibility::default(), ChildOf(self.root()))).id();
        let bm = m.kind(mat).clone();
        for (i, f) in geo::world_box_faces(-half, half, TILE).iter().enumerate() {
            put(ecs, parent, f, bm.faces[i].clone(), Transform::default());
        }
        let (mut min, mut max) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for x in [-1.0, 1.0] {
            for y in [-1.0, 1.0] {
                for z in [-1.0, 1.0] {
                    let p = q * (Vec3::new(x, y, z) * half) + c;
                    min = min.min(p);
                    max = max.max(p);
                }
            }
        }
        let mut b = Solid::new(min, max, mat);
        b.portalable = bm.portalable;
        b.entity = Some(parent);
        b.obb = Some(Obb { c, q, qi: q.inverse(), half });
        let id = self.solids.len();
        let (col, _) = self.phys.add_box(id, c, half, q, false);
        b.collider = Some(col);
        self.solids.push(b);
        id
    }

    /// painel diagonal de concreto claro (aceita portal), com moldura acesa
    pub fn panel(&mut self, ecs: &mut Ecs, at: Vec3, normal: Vec3, w: f32, h: f32, t: f32, up: Option<Vec3>, color: u32, stand: Option<f32>) -> usize {
        let n = normal.normalize();
        let mut u = up.unwrap_or(if n.y.abs() > 0.95 { Vec3::NEG_Z } else { Vec3::Y });
        u = (u - n * u.dot(n)).normalize();
        let rgt = u.cross(n).normalize();
        let q = q_basis(rgt, u, n);
        let face = at;
        let c = face - n * (t / 2.0);
        let (ex, ey, ez) = q.to_euler(EulerRot::XYZ);
        let b = self.ramp(ecs, c, Vec3::new(w, h, t), Vec3::new(ex, ey, ez), "white");
        let (hw, hh) = (w / 2.0, h / 2.0);
        let bar = 0.16;
        let bars = [(0.0, hh - bar / 2.0, w, bar), (0.0, -hh + bar / 2.0, w, bar), (-hw + bar / 2.0, 0.0, bar, h), (hw - bar / 2.0, 0.0, bar, h)];
        let frame = Geo::merge(bars.iter().map(|&(x, y, sx, sy)| geo::box_geo(sx, sy, 0.06).translate(x, y, 0.03)));
        let fm = bas(ecs, hex_k(color, 2.2));
        put(ecs, self.root(), &frame, fm, Transform::from_translation(face).with_rotation(q));
        let am = bas_a(ecs, hex_k(color, 1.6), 0.55, false);
        let arrow_pos = face + u * (hh - 0.45) + n * 0.3;
        put(ecs, self.root(), &geo::cone_geo(0.22, 0.5, 3), am, Transform::from_translation(arrow_pos).with_rotation(q_from_y(n)));
        if let Some(stand) = stand {
            let low = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)].iter().map(|&(x, y)| (face + rgt * x + u * y).y).fold(f32::INFINITY, f32::min) - 0.2;
            let base = face - n * t;
            if low > stand {
                self.add_box(ecs, base.x - 0.3, stand, base.z - 0.3, base.x + 0.3, low, base.z + 0.3, "metal", true, false, false);
            }
        }
        self.solids[b].panel = Some(PanelInfo { n, up: u, right: rgt, face });
        b
    }

    // ------------------------------------------------------------------ grade de desintegração
    pub fn fizzler(&mut self, ecs: &mut Ecs, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, sig: Option<String>, mode: &str) -> usize {
        let (min, max) = mm(x0, y0, z0, x1, y1, z1);
        let size = max - min;
        let thin = if size.y < size.x.min(size.z) { 1 } else if size.x < size.z { 0 } else { 2 };
        let w = if thin == 0 { size.z } else { size.x };
        let hgt = if thin == 1 { size.z } else { size.y };
        let center = (min + max) * 0.5;
        let rot = match thin {
            0 => Quat::from_rotation_y(FRAC_PI_2),
            1 => Quat::from_rotation_x(-FRAC_PI_2),
            _ => Quat::IDENTITY,
        };
        let field = fx_mat(ecs, Fx::new(fx::kind::FIZZ_FIELD).blend().p0(Vec4::new(w, hgt, 0.0, 0.0)).p1(Vec4::new(0.5, 0.5, -99.0, 1.0)));
        let field_add = {
            let mut f = ecs.resource::<Assets<Fx>>().get(&field).unwrap().clone();
            f.alpha = AlphaMode::Add;
            ecs.resource_mut::<Assets<Fx>>().insert(&field, f).ok();
            field.clone()
        };
        let plane = put(ecs, self.root(), &geo::plane_geo(w, hgt), field_add.clone(), Transform::from_translation(center).with_rotation(rot));
        let m = mats(ecs);
        let coil = fx_mat(ecs, Fx::new(fx::kind::COIL).opaque().p0(Vec4::new(1.0, 0.0, 0.0, 0.0)));
        let slit = fx_mat(ecs, Fx::new(fx::kind::SLIT).opaque().p0(Vec4::new(1.0, 0.0, 0.0, 0.0)));
        let along = if thin == 0 { 2 } else { 0 };
        if thin != 1 {
            for s in [-1.0f32, 1.0] {
                let mut p = center;
                p[along] += s * w / 2.0;
                let g = group(ecs, self.root(), Transform::from_translation(p).with_rotation(if thin == 0 { Quat::from_rotation_y(FRAC_PI_2) } else { Quat::IDENTITY }));
                put(ecs, g, &geo::box_geo(0.34, size.y, 0.34), m.frame.clone(), Transform::default());
                let n_coils = ((size.y / 0.55).floor() as i32).max(3);
                let coil_m = mesh_h(ecs, &geo::torus_geo(0.2, 0.035, 8, 20).rotate_x(FRAC_PI_2));
                let collar_m = mesh_h(ecs, &geo::cylinder_geo(0.24, 0.24, 0.05, 16, 1, false));
                for i in 0..n_coils {
                    let y = -size.y / 2.0 + 0.35 + (i as f32 * (size.y - 0.7)) / (n_coils - 1).max(1) as f32;
                    put_mesh(ecs, g, coil_m.clone(), coil.clone(), Transform::from_xyz(0.0, y, 0.0));
                    put_mesh(ecs, g, collar_m.clone(), m.dark.clone(), Transform::from_xyz(0.0, y + 0.06, 0.0));
                }
                put(ecs, g, &geo::box_geo(0.06, size.y - 0.4, 0.04), slit.clone(), Transform::from_xyz(-s * 0.19, 0.0, 0.0));
                for e in [-1.0, 1.0] {
                    let cy = e * (size.y - 0.16) / 2.0;
                    put(ecs, g, &geo::box_geo(0.5, 0.16, 0.5), m.dark.clone(), Transform::from_xyz(0.0, cy, 0.0));
                    for k in -1..=1 {
                        put(ecs, g, &geo::box_geo(0.04, 0.1, 0.5), m.frame.clone(), Transform::from_xyz(k as f32 * 0.12, cy + e * 0.12, 0.0));
                    }
                    put(ecs, g, &geo::box_geo(0.3, 0.025, 0.04), coil.clone(), Transform::from_xyz(0.0, cy, 0.255));
                }
            }
        }
        // faíscas soltas subindo junto ao campo
        let n = ((w * hgt * 4.0).floor() as usize).min(240);
        let mut r = rand::rng();
        let pm = fx::particles(n, |_| Vec3::ZERO, |_| [r.random(), r.random(), r.random(), 0.0]);
        let pmh = ecs.resource_mut::<Assets<Mesh>>().add(pm);
        // (diâmetro: 0,03 × 0,75 × 2 da versão web)
        let motes_m = fx_mat(ecs, Fx::new(fx::kind::FIZZ_MOTES).p0(Vec4::new(w, hgt, 0.0, 0.0)).size(0.045));
        let motes = put_mesh(ecs, self.root(), pmh, motes_m.clone(), Transform::from_translation(center).with_rotation(rot));
        ecs.entity_mut(motes).insert(bevy::camera::visibility::NoFrustumCulling);
        let mut pad = Vec3::ZERO;
        pad[thin] = 0.1;
        let f = Fizzler {
            min: min - pad,
            max: max + pad,
            axis: thin,
            plane,
            motes,
            mats: vec![coil, slit, motes_m],
            field: field_add,
            size: Vec2::new(w, hgt),
            center,
            rot,
            sig: sig.clone(),
            mode: mode.to_string(),
            on: true,
        };
        self.fizzlers.push(f);
        let i = self.fizzlers.len() - 1;
        if sig.is_some() {
            self.set_fizzler(ecs, i, mode != "on");
        }
        i
    }

    /// liga/desliga uma grade: desligada não apaga portais nem desintegra nada, e o campo some
    pub fn set_fizzler(&mut self, ecs: &mut Ecs, i: usize, on: bool) {
        let f = &mut self.fizzlers[i];
        if f.on == on {
            return;
        }
        f.on = on;
        let vis = if on { Visibility::Inherited } else { Visibility::Hidden };
        ecs.entity_mut(f.plane).insert(vis);
        ecs.entity_mut(f.motes).insert(vis);
        let p = if on { 1.0 } else { 0.0 };
        let mut fxs = ecs.resource_mut::<Assets<Fx>>();
        for h in f.mats.iter().chain(std::iter::once(&f.field)) {
            if let Some(mut m) = fxs.get_mut(h) {
                if m.u.kind == fx::kind::FIZZ_FIELD {
                    m.u.p1.w = p;
                } else {
                    m.u.p0.x = p;
                }
            }
        }
    }

    /// as grades ligadas (o que desintegra e barra tiros)
    pub fn live_fizzlers(&self) -> impl Iterator<Item = &Fizzler> {
        self.fizzlers.iter().filter(|f| f.on)
    }

    /// onda no campo da grade no ponto `p`
    pub fn fizzler_ripple(&self, ecs: &mut Ecs, i: usize, p: Vec3, t: f32) {
        let f = &self.fizzlers[i];
        let l = f.rot.inverse() * (p - f.center);
        if let Some(mut m) = ecs.resource_mut::<Assets<Fx>>().get_mut(&f.field) {
            m.u.p1 = Vec4::new(l.x / f.size.x + 0.5, l.y / f.size.y + 0.5, t, m.u.p1.w);
        }
    }

    /// o segmento a→b passa por alguma grade ligada?
    pub fn segment_fizzler(&self, a: Vec3, b: Vec3, pad: Vec3) -> Option<usize> {
        let d = b - a;
        let len = d.length();
        if len < 1e-6 {
            return self.fizzlers.iter().position(|f| f.on && (0..3).all(|k| a[k] > f.min[k] - pad[k] && a[k] < f.max[k] + pad[k]));
        }
        self.ray_fizzler(a, d / len, len, pad).map(|(i, _)| i)
    }

    /// o raio cruza uma grade ligada antes de `max_dist`? (`pad`: folga em cada eixo)
    pub fn ray_fizzler(&self, origin: Vec3, dir: Vec3, max_dist: f32, pad: Vec3) -> Option<(usize, Vec3)> {
        for (i, f) in self.fizzlers.iter().enumerate() {
            if !f.on {
                continue;
            }
            let (mut t0, mut t1) = (0.0f32, max_dist);
            for a in 0..3 {
                let (lo, hi) = (f.min[a] - pad[a], f.max[a] + pad[a]);
                if dir[a].abs() < 1e-9 {
                    if origin[a] < lo || origin[a] > hi {
                        t0 = f32::INFINITY;
                    }
                    continue;
                }
                let (mut ta, mut tb) = ((lo - origin[a]) / dir[a], (hi - origin[a]) / dir[a]);
                if ta > tb {
                    std::mem::swap(&mut ta, &mut tb);
                }
                t0 = t0.max(ta);
                t1 = t1.min(tb);
            }
            if t0 <= t1 {
                return Some((i, origin + dir * t0));
            }
        }
        None
    }

    // ------------------------------------------------------------------ dispensador e pedestal
    /// tubo no teto que solta a amostra; devolve onde ela nasce
    pub fn dispenser(&mut self, ecs: &mut Ecs, x: f32, top: f32, z: f32) -> Vec3 {
        let m = mats(ecs);
        let metal = m.metal.clone();
        let g = group(ecs, self.root(), Transform::from_xyz(x, top, z));
        let glass = std_mat(ecs, StandardMaterial { base_color: hex(0xcfe8ff).with_alpha(0.25), alpha_mode: AlphaMode::Blend, double_sided: true, cull_mode: None, ..default() });
        put(ecs, g, &geo::cylinder_geo(0.62, 0.62, 2.2, 32, 1, true), glass, Transform::from_xyz(0.0, -1.1, 0.0));
        put(ecs, g, &geo::cylinder_geo(0.75, 0.75, 0.35, 32, 1, false), metal.clone(), Transform::from_xyz(0.0, -0.17, 0.0));
        put(ecs, g, &geo::torus_geo(0.66, 0.06, 10, 32).rotate_x(FRAC_PI_2), metal.clone(), Transform::from_xyz(0.0, -2.2, 0.0));
        for i in 0..4 {
            let a = i as f32 / 4.0 * TAU + PI / 4.0;
            put(ecs, g, &geo::box_geo(0.06, 2.2, 0.06), metal.clone(), Transform::from_xyz(a.cos() * 0.64, -1.1, a.sin() * 0.64));
        }
        let lamp = bas(ecs, rgb(2.4, 1.6, 0.3));
        put(ecs, g, &geo::torus_geo(0.76, 0.025, 8, 40).rotate_x(FRAC_PI_2), lamp.clone(), Transform::from_xyz(0.0, -0.3, 0.0));
        put(ecs, g, &geo::torus_geo(0.6, 0.04, 8, 32).rotate_x(FRAC_PI_2), m.dark.clone(), Transform::from_xyz(0.0, -2.1, 0.0));
        for i in 0..3 {
            put(ecs, g, &geo::torus_geo(0.645, 0.02, 6, 32).rotate_x(FRAC_PI_2), metal.clone(), Transform::from_xyz(0.0, -0.6 - i as f32 * 0.6, 0.0));
        }
        self.anims.push(Anim::Dispenser { mat: lamp });
        Vec3::new(x, top - 1.6, z)
    }

    /// pedestal com a arma de portais (ou a melhoria dela)
    pub fn pedestal(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, gives: &str, model: Option<&str>, height: f32) -> usize {
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z));
        let col = (height - 0.45).max(0.15);
        let base = put(ecs, g, &geo::cylinder_geo(0.55, 0.7, 1.0, 32, 1, false), m.metal.clone(), Transform::from_xyz(0.0, col / 2.0, 0.0));
        ecs.get_mut::<Transform>(base).unwrap().scale.y = col;
        let ring = bas(ecs, rgb(0.4, 1.6, 2.6));
        put(ecs, g, &geo::torus_geo(0.5, 0.03, 8, 40).rotate_x(FRAC_PI_2), ring, Transform::from_xyz(0.0, col + 0.02, 0.0));
        let holder = group(ecs, g, Transform::from_xyz(0.0, height, 0.0));
        if let Some(name) = model {
            let (mroot, _) = glb::spawn_model(ecs, name);
            ecs.entity_mut(mroot).insert(ChildOf(holder));
        }
        let light = ecs.spawn((point_light(hex(0x9fd8ff), 4.0, 5.0), Transform::from_xyz(0.0, height + 0.15, 0.0), ChildOf(g))).id();
        self.anims.push(Anim::Pedestal { holder, height });
        self.pedestals.push(Pedestal { pos: Vec3::new(x, y + height - 0.45, z), gives: gives.to_string(), holder, height, taken: false, light });
        self.pedestals.len() - 1
    }

    // ------------------------------------------------------------------ bola de energia
    /// soquete redondo na parede (lançador/receptor) com o anel aceso; devolve (grupo, brilho, giro)
    fn socket(&mut self, ecs: &mut Ecs, n: Vec3, color: u32, pos: Vec3, scale: f32) -> (Entity, Handle<StandardMaterial>, Entity) {
        let m = mats(ecs);
        let metal = m.metal.clone();
        let g = group(ecs, self.root(), Transform::from_translation(pos).with_rotation(q_from_y(n)).with_scale(Vec3::splat(scale)));
        put(ecs, g, &geo::cylinder_geo(0.75, 0.85, 0.12, 32, 1, false), metal.clone(), Transform::from_xyz(0.0, 0.06, 0.0));
        let cup = std_mat(ecs, StandardMaterial { base_color: hex(0x1c1d20), metallic: 0.6, perceptual_roughness: 0.4, double_sided: true, cull_mode: None, ..default() });
        put(ecs, g, &geo::cylinder_geo(0.42, 0.5, 0.35, 32, 1, true), cup, Transform::from_xyz(0.0, 0.25, 0.0));
        let glow = bas(ecs, hex_k(color, 1.6));
        put(ecs, g, &geo::torus_geo(0.47, 0.04, 8, 40).rotate_x(FRAC_PI_2), glow.clone(), Transform::from_xyz(0.0, 0.42, 0.0));
        for i in 0..4 {
            let a = i as f32 / 4.0 * TAU;
            put(ecs, g, &geo::box_geo(0.08, 0.4, 0.3), metal.clone(), Transform::from_xyz(a.cos() * 0.62, 0.25, a.sin() * 0.62).with_rotation(Quat::from_rotation_y(-a)));
        }
        let spin = group(ecs, g, Transform::from_xyz(0.0, 0.15, 0.0));
        put(ecs, spin, &geo::torus_geo(0.3, 0.025, 8, 32).rotate_x(FRAC_PI_2), m.frame.clone(), Transform::default());
        for i in 0..6 {
            let a = i as f32 / 6.0 * TAU;
            put(ecs, spin, &geo::box_geo(0.2, 0.03, 0.05), glow.clone(), Transform::from_xyz(a.cos() * 0.2, 0.0, a.sin() * 0.2).with_rotation(Quat::from_rotation_y(-a)));
        }
        put(ecs, g, &geo::sphere_geo(0.1, 16, 10), m.dark.clone(), Transform::from_xyz(0.0, 0.12, 0.0));
        let bolt = mesh_h(ecs, &geo::cylinder_geo(0.025, 0.025, 0.03, 6, 1, false));
        for i in 0..8 {
            let a = i as f32 / 8.0 * TAU + PI / 8.0;
            put_mesh(ecs, g, bolt.clone(), m.frame.clone(), Transform::from_xyz(a.cos() * 0.7, 0.13, a.sin() * 0.7));
        }
        (g, glow, spin)
    }

    /// lançador de bola de energia na parede (normal = para onde atira)
    pub fn launcher(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, normal: Vec3, depth: f32, delay: f32, life: f32, speed: f32) -> usize {
        let n = normal;
        let (g, glow, spin) = self.socket(ecs, n, 0xffb347, Vec3::new(x, y, z), 1.0);
        if depth > 0.45 {
            let metal = mats(ecs).metal;
            put(ecs, g, &geo::cylinder_geo(0.55, 0.62, depth - 0.1, 32, 1, true), metal.clone(), Transform::from_xyz(0.0, (depth - 0.1) / 2.0, 0.0));
            put(ecs, g, &geo::torus_geo(0.52, 0.05, 8, 40).rotate_x(FRAC_PI_2), glow.clone(), Transform::from_xyz(0.0, depth - 0.08, 0.0));
            put(ecs, g, &geo::ring_geo(0.42, 0.6, 32, 1).rotate_x(-FRAC_PI_2), metal, Transform::from_xyz(0.0, depth - 0.1, 0.0));
        }
        let mouth = Vec3::new(x, y, z) + n * depth.max(0.35);
        self.launchers.push(Launcher { pos: mouth, dir: n, group: g, glow, spin, pellet: None, wait: delay, life, speed, done: false });
        self.launchers.len() - 1
    }

    /// receptor da bola de energia: liga o sinal `opens` quando recebe uma
    pub fn catcher(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, normal: Vec3, opens: Option<String>, radius: f32) -> usize {
        let (g, glow, spin) = self.socket(ecs, normal, 0x6fc8ff, Vec3::new(x, y, z), 1.0);
        self.catchers.push(Catcher { pos: Vec3::new(x, y, z) + normal * 0.25, normal, opens, active: false, was_active: false, group: g, glow, spin, radius });
        self.catchers.len() - 1
    }

    /// fornalha: o que cair dentro é destruído (e liga o sinal `opens`)
    pub fn incinerator(&mut self, ecs: &mut Ecs, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, opens: Option<String>) -> usize {
        let (min, max) = mm(x0, y0, z0, x1, y1, z1);
        let glow = bas(ecs, rgb(3.0, 1.1, 0.2));
        let p = Vec3::new((min.x + max.x) / 2.0, min.y + 0.02, (min.z + max.z) / 2.0);
        put(ecs, self.root(), &geo::box_geo(max.x - min.x, 0.05, max.z - min.z), glow, Transform::from_translation(p));
        let light = ecs.spawn((point_light(hex(0xff7a20), 18.0, 8.0), Transform::from_translation(p + Vec3::Y * 0.8), ChildOf(self.root()))).id();
        self.anims.push(Anim::Incinerator { light });
        self.incinerators.push(Incinerator { min, max, opens, active: false, light });
        self.incinerators.len() - 1
    }

    // ------------------------------------------------------------------ botões
    /// botão de piso; `hold` > 0: depois de solto o sinal continua ligado por `hold` s
    pub fn button(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, opens: Option<String>, hold: f32) -> usize {
        let (g, named, mats) = glb::spawn_model_full(ecs, "floor_button");
        ecs.entity_mut(g).insert((Transform::from_xyz(x, y, z), ChildOf(self.root())));
        let plate = named.get("plate").copied();
        let plate_mat = plate.and_then(|p| glb::unique_material(ecs, p));
        // (o anel de luzes é um material com nome no modelo, não uma peça)
        let lights_mat = named.get("lights").copied().and_then(|p| glb::unique_material(ecs, p)).or_else(|| mats.get("lights").cloned());
        let spin = named.get("spin").copied();
        self.buttons.push(FloorButton { pos: Vec3::new(x, y, z), opens, pressed: false, hold, count: 0.0, group: g, plate, plate_mat, lights_mat, spin, v: 0.0, k: 0.0, c: 0.0 });
        self.buttons.len() - 1
    }

    /// botão de apertar (E): pedestal virado para `yaw`, ou na parede com a frente para `dir`
    pub fn push_button(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, opens: Option<String>, mode: &str, time: f32, wall: bool, dir: Vec3, yaw: f32, look: &str) -> usize {
        let name = if wall { format!("push_{look}_wall") } else { format!("push_{look}") };
        let (g, named) = glb::spawn_model(ecs, &name);
        let rot = if wall { Quat::from_rotation_arc(Vec3::Z, dir.normalize()) } else { Quat::from_rotation_y(yaw) };
        ecs.entity_mut(g).insert((Transform::from_xyz(x, y, z).with_rotation(rot), ChildOf(self.root())));
        if !wall {
            let b = self.add_box(ecs, x - 0.18, y, z - 0.18, x + 0.18, y + 0.85, z + 0.18, "metal", true, false, false);
            if let Some(e) = self.solids[b].entity {
                ecs.entity_mut(e).insert(Visibility::Hidden);
            }
        }
        let cap = named.get("cap").copied();
        let cap_base = cap.and_then(|c| ecs.get::<Transform>(c)).map(|t| t.translation).unwrap_or_default();
        // posição do botão no mundo (a tampa)
        let cap_world = {
            let mut p = Vec3::new(x, y, z);
            if let Some(c) = cap {
                // soma as posições locais do caminho até a raiz do modelo
                let mut acc = Transform::IDENTITY;
                let mut e = c;
                let mut chain = vec![];
                while e != g {
                    if let Some(t) = ecs.get::<Transform>(e) {
                        chain.push(*t);
                    }
                    match ecs.get::<ChildOf>(e) {
                        Some(p) => e = p.parent(),
                        None => break,
                    }
                }
                for t in chain.iter().rev() {
                    acc = acc.mul_transform(*t);
                }
                p += rot * acc.translation;
            }
            p
        };
        let collect = |prefix: &str| -> Vec<Entity> {
            let mut v: Vec<(usize, Entity)> = named.iter().filter_map(|(k, e)| k.strip_prefix(prefix).and_then(|i| i.parse::<usize>().ok()).map(|i| (i, *e))).collect();
            v.sort();
            v.into_iter().map(|(_, e)| e).collect()
        };
        let segs = collect("segs_");
        let lamps = collect("lamps_");
        // cores da luz acesa/apagada e da tampa, do próprio modelo (extras da raiz)
        let x = glb::model_extras(ecs, &name);
        let f = |k: &str, d: f64| x.get(k).and_then(|v| v.as_f64()).unwrap_or(d) as f32;
        let on_mat = bas(ecs, rgb(f("onR", 2.4), f("onG", 0.3), f("onB", 0.12)));
        let off_mat = std_mat(ecs, StandardMaterial { base_color: hex(f("off", 0x3a1210 as f64) as u32), perceptual_roughness: 0.5, ..default() });
        let cap_mat = cap.and_then(|c| glb::unique_material(ecs, c));
        let cap_em = hex(f("capEm", 0x7a0c05 as f64) as u32).to_linear();
        let on = mode == "unlatch";
        self.push_buttons.push(PushButton { pos: cap_world, opens, mode: mode.to_string(), time, on, left: 0.0, press: 0.0, tick: 0.0, group: g, cap, cap_base, segs, lamps, on_mat, off_mat, cap_mat, cap_em, chans: None });
        self.push_buttons.len() - 1
    }

    /// sinal derivado para um item que reage ao botão do seu jeito
    pub fn push_sig(&mut self, sig: &str, mode: &str, time: f32) -> String {
        let id = format!("{sig}~{mode}~{}", fmt_num(time));
        self.push_modes.insert(id.clone(), PushMode { base: sig.into(), mode: mode.into(), time });
        id
    }

    /// os canais do botão: um por modo pedido pelos itens ligados
    pub fn push_chans(&mut self, i: usize) -> &mut Vec<Chan> {
        if self.push_buttons[i].chans.is_none() {
            let opens = self.push_buttons[i].opens.clone();
            let mut v: Vec<Chan> = self.push_modes.iter().filter(|(_, m)| Some(&m.base) == opens.as_ref()).map(|(sig, m)| Chan { sig: sig.clone(), mode: m.mode.clone(), time: m.time, on: m.mode == "unlatch", left: 0.0 }).collect();
            v.sort_by(|a, b| a.sig.cmp(&b.sig));
            self.push_buttons[i].chans = Some(v);
        }
        self.push_buttons[i].chans.as_mut().unwrap()
    }

    /// aperta o botão: cada canal do seu jeito
    pub fn press_button(&mut self, i: usize) {
        self.push_chans(i);
        let b = &mut self.push_buttons[i];
        b.press = 1.0;
        let press = |mode: &str, time: f32, on: &mut bool, left: &mut f32| match mode {
            "toggle" => *on = !*on,
            "latch" => *on = true,
            "unlatch" => *on = false,
            _ => {
                *on = true;
                *left = time;
            }
        };
        press(&b.mode.clone(), b.time, &mut b.on, &mut b.left);
        for c in b.chans.as_mut().unwrap() {
            press(&c.mode.clone(), c.time, &mut c.on, &mut c.left);
        }
    }

    // ------------------------------------------------------------------ saída e placas
    /// elevador de saída (tubo de vidro iluminado) + gatilho de fim de fase
    pub fn exit_elevator(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, flipped: bool, era: Option<String>) -> usize {
        let s = if flipped { -1.0 } else { 1.0 };
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z));
        let tube = std_mat(ecs, StandardMaterial { base_color: hex(0xbfe6ff).with_alpha(0.22), alpha_mode: AlphaMode::Blend, double_sided: true, cull_mode: None, ..default() });
        put(ecs, g, &geo::cylinder_geo(1.25, 1.25, 3.2, 40, 1, true), tube.clone(), Transform::from_xyz(0.0, 1.6 * s, 0.0));
        let ring_m = bas(ecs, rgb(0.4, 2.2, 1.2));
        let torus = mesh_h(ecs, &geo::torus_geo(1.28, 0.08, 10, 40));
        for yy in [0.18, 3.2] {
            put_mesh(ecs, g, torus.clone(), ring_m.clone(), Transform::from_xyz(0.0, yy * s, 0.0).with_rotation(Quat::from_rotation_x(FRAC_PI_2)));
        }
        put(ecs, g, &geo::cylinder_geo(1.4, 1.4, 0.15, 40, 1, false), m.metal.clone(), Transform::from_xyz(0.0, 0.075 * s, 0.0));
        let colm = mesh_h(ecs, &geo::box_geo(0.1, 3.2, 0.16));
        for i in 0..6 {
            let a = i as f32 / 6.0 * TAU;
            put_mesh(ecs, g, colm.clone(), m.frame.clone(), Transform::from_xyz(a.cos() * 1.3, 1.6 * s, a.sin() * 1.3).with_rotation(Quat::from_rotation_y(-a)));
        }
        put(ecs, g, &geo::cylinder_geo(1.45, 1.45, 0.22, 40, 1, false), m.frame.clone(), Transform::from_xyz(0.0, 3.3 * s, 0.0));
        let grate = crate::mats::grate_disc_material(ecs);
        put(ecs, g, &geo::ring_geo(0.25, 1.2, 40, 1).rotate_x(-FRAC_PI_2 * s), grate, Transform::from_xyz(0.0, 0.16 * s, 0.0));
        let scan_m = bas_a(ecs, rgb(0.4, 2.4, 1.3), 1.0, false);
        let scan = put(ecs, g, &geo::torus_geo(1.2, 0.025, 6, 48).rotate_x(FRAC_PI_2), scan_m.clone(), Transform::default());
        let mut r = rand::rng();
        let pm = fx::particles(60, |_| Vec3::ZERO, |_| [r.random(), r.random(), r.random(), 0.0]);
        let pmh = ecs.resource_mut::<Assets<Mesh>>().add(pm);
        let motes_m = fx_mat(ecs, Fx::new(fx::kind::ELEV_MOTES).color(LinearRgba::new(0.5, 2.2, 1.2, 0.8)).p0(Vec4::new(s, 0.0, 0.0, 0.0)).size(0.05));
        let motes = put_mesh(ecs, g, pmh, motes_m, Transform::default());
        ecs.entity_mut(motes).insert(bevy::camera::visibility::NoFrustumCulling);
        let l = ecs.spawn((point_light(hex(0x7dffb0), 14.0, 8.0), Transform::from_xyz(0.0, 2.0 * s, 0.0), ChildOf(g))).id();
        self.anims.push(Anim::Elevator { tube, scan, scan_mat: scan_m, s });
        if let Some(e) = &era {
            self.in_era(ecs, EraObj::Entity(g), e);
            self.in_era(ecs, EraObj::Light(l, 14.0), e);
        }
        self.trigger(x - 1.0, if flipped { y - 3.0 } else { y }, z - 1.0, x + 1.0, if flipped { y } else { y + 3.0 }, z + 1.0, true, false, era, vec![])
    }

    /// placa com texto (`lines` = [texto, tamanho, y, cor, fonte])
    pub fn sign(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, rot_y: f32, lines: Vec<SignLine>, w: f32, h: f32, rot_z: f32) -> Entity {
        let img = signs::sign_image(&lines);
        let ih = ecs.resource_mut::<Assets<Image>>().add(img);
        // (textura de canvas do three.js: v para cima)
        let uv_transform = bevy::math::Affine2::from_scale_angle_translation(Vec2::new(1.0, -1.0), 0.0, Vec2::new(0.0, 1.0));
        let mat = std_mat(ecs, StandardMaterial { base_color_texture: Some(ih), perceptual_roughness: 0.6, emissive: hex(0x222222).to_linear(), uv_transform, ..default() });
        put(ecs, self.root(), &geo::plane_geo(w, h), mat, Transform::from_xyz(x, y, z).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, rot_y, rot_z)))
    }

    /// indicadores acima da porta (vermelho fechada, verde aberta) e a moldura, dos dois lados
    fn door_lamps(&mut self, ecs: &mut Ecs, di: usize, t: f32) {
        if self.doors[di].lamps.is_none() {
            let mut lamps = vec![];
            let (bmin, bmax, dsolid) = (self.doors[di].base_min, self.doors[di].base_max, self.doors[di].solid);
            let size = bmax - bmin;
            let thin = if size.x < size.z { 0 } else { 2 };
            let wide = if thin == 0 { 2 } else { 0 };
            let c = (bmin + bmax) * 0.5;
            let m = mats(ecs);
            let door_boxes: HashSet<usize> = self.doors.iter().map(|d| d.solid).collect();
            for s in [-1.0f32, 1.0] {
                let mut dir = Vec3::ZERO;
                dir[thin] = -s;
                let mut from = Vec3::new(c.x, bmax.y + 0.32, c.z);
                from[thin] += s * 2.0;
                let Some(hit) = self.raycast_f(from, dir, 2.2, |i| i != dsolid && !door_boxes.contains(&i)) else { continue };
                let look = |p: Vec3, n: Vec3| Transform::from_translation(p).looking_to(-n, Vec3::Y);
                let g = group(ecs, self.root(), look(hit.point + hit.normal * 0.025, hit.normal));
                put(ecs, g, &geo::box_geo(0.9, 0.3, 0.05), m.frame.clone(), Transform::default());
                let mat = bas(ecs, rgb(2.6, 0.25, 0.12));
                let lens = mesh_h(ecs, &geo::cylinder_geo(0.07, 0.07, 0.04, 20, 1, false).rotate_x(FRAC_PI_2));
                for k in [-1.0, 0.0, 1.0] {
                    put_mesh(ecs, g, lens.clone(), mat.clone(), Transform::from_xyz(k * 0.26, 0.0, 0.03));
                }
                lamps.push(mat);
                let nc = hit.normal[thin];
                for e in [-1.0, 1.0] {
                    let mut p = c;
                    p[wide] += e * (size[wide] + 0.14) / 2.0;
                    p.y += 0.07;
                    p[thin] = hit.point[thin] + nc * 0.03;
                    put(ecs, self.root(), &geo::box_geo(0.14, size.y + 0.14, 0.06), m.frame.clone(), look(p, hit.normal));
                }
                let mut p = Vec3::new(c.x, bmax.y + 0.07, c.z);
                p[thin] = hit.point[thin] + nc * 0.03;
                put(ecs, self.root(), &geo::box_geo(size[wide] + 0.42, 0.14, 0.06), m.frame.clone(), look(p, hit.normal));
            }
            self.doors[di].lamps = Some(lamps);
        }
        let d = &self.doors[di];
        let blink = if d.open > 0.02 && d.open < 0.98 { 0.6 + 0.4 * (t * 18.0).sin() } else { 1.0 };
        let k = smoothstep(0.1, 0.9, d.open);
        let red = Vec3::new(2.6, 0.25, 0.12);
        let green = Vec3::new(0.3, 2.6, 0.7);
        let c = red.lerp(green, k) * blink;
        let mut mats_ = ecs.resource_mut::<Assets<StandardMaterial>>();
        for h in d.lamps.as_ref().unwrap() {
            if let Some(mut m) = mats_.get_mut(h) {
                m.base_color = Color::LinearRgba(LinearRgba::rgb(c.x, c.y, c.z));
            }
        }
    }

    // ------------------------------------------------------------------ épocas (Fronteira)
    pub fn in_era(&mut self, ecs: &mut Ecs, obj: EraObj, era: &str) {
        self.era_items.push((obj.clone(), era.to_string()));
        let i = self.era_items.len() - 1;
        self.apply_era(ecs, i);
    }

    fn apply_era(&mut self, ecs: &mut Ecs, i: usize) {
        let (obj, era) = self.era_items[i].clone();
        let on = era == self.era;
        match obj {
            EraObj::Light(e, k) => {
                if let Some(mut l) = ecs.get_mut::<PointLight>(e) {
                    l.intensity = if on { k * LIGHT_K() } else { 0.0 };
                }
            }
            EraObj::Entity(e) => {
                if let Ok(mut em) = ecs.get_entity_mut(e) {
                    em.insert(if on { Visibility::Inherited } else { Visibility::Hidden });
                }
            }
            EraObj::Solid(s) => {
                let b = &mut self.solids[s];
                if let Some(e) = b.entity {
                    ecs.entity_mut(e).insert(if on { Visibility::Inherited } else { Visibility::Hidden });
                }
                b.active = on;
                if b.is_hazard {
                    if on && !self.hazards.contains(&s) {
                        self.hazards.push(s);
                    }
                    if !on {
                        self.hazards.retain(|&h| h != s);
                    }
                }
                if let Some(c) = b.collider {
                    self.phys.set_enabled(c, on);
                }
            }
        }
    }

    pub fn set_era(&mut self, ecs: &mut Ecs, era: &str) {
        self.era = era.to_string();
        for i in 0..self.era_items.len() {
            self.apply_era(ecs, i);
        }
    }

    // ------------------------------------------------------------------ série Fronteira
    /// emissor de ponte de luz (fica na lista dos lasers com `bridge` = modelo)
    pub fn light_bridge(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, dir: Vec3, sig: Option<String>, look: &str) -> usize {
        let d = dir.normalize();
        let n = if d.y.abs() < 0.7 { (Vec3::Y - d * d.y).normalize() } else { (Vec3::X - d * d.x).normalize() };
        let side = n.cross(d).normalize();
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z).with_rotation(q_basis(side, n, d)));
        put(ecs, g, &geo::box_geo(2.5, 0.7, 0.16), m.frame.clone(), Transform::from_xyz(0.0, 0.0, 0.08));
        put(ecs, g, &geo::box_geo(2.3, 0.42, 0.34), m.dark.clone(), Transform::from_xyz(0.0, 0.0, 0.25));
        let lens = bas(ecs, rgb(0.5, 1.9, 2.6));
        put(ecs, g, &geo::box_geo(2.1, 0.06, 0.02), lens.clone(), Transform::from_xyz(0.0, 0.0, 0.425));
        for sx in [-1.0, 1.0] {
            put(ecs, g, &geo::box_geo(0.12, 0.56, 0.44), m.frame.clone(), Transform::from_xyz(sx * 1.2, 0.0, 0.26));
            put(ecs, g, &geo::box_geo(0.03, 0.4, 0.03), lens.clone(), Transform::from_xyz(sx * 1.2, 0.0, 0.49));
        }
        let off = sig.is_some();
        self.lasers.push(LaserEmitter { pos: Vec3::new(x, y, z) + d * 0.45, dir: d, group: g, lens, sig, off, bridge: Some(if look.is_empty() { "veios".into() } else { look.into() }) });
        self.lasers.len() - 1
    }

    /// emissor de laser; `sig`: só liga enquanto esse sinal estiver ligado
    pub fn laser(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, dir: Vec3, sig: Option<String>) -> usize {
        let d = dir.normalize();
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z).with_rotation(q_from_y(d)));
        put(ecs, g, &geo::box_geo(0.9, 0.12, 0.9), m.frame.clone(), Transform::from_xyz(0.0, 0.06, 0.0));
        put(ecs, g, &geo::cylinder_geo(0.22, 0.3, 0.35, 6, 1, false), m.dark.clone(), Transform::from_xyz(0.0, 0.3, 0.0));
        let lens = bas(ecs, rgb(3.0, 0.3, 0.2));
        put(ecs, g, &geo::cylinder_geo(0.1, 0.12, 0.05, 20, 1, false), lens.clone(), Transform::from_xyz(0.0, 0.5, 0.0));
        for i in 0..6 {
            let a = i as f32 / 6.0 * TAU;
            put(ecs, g, &geo::box_geo(0.04, 0.32, 0.14), m.frame.clone(), Transform::from_xyz(a.cos() * 0.3, 0.26, a.sin() * 0.3).with_rotation(Quat::from_rotation_y(-a)));
        }
        let off = sig.is_some();
        self.lasers.push(LaserEmitter { pos: Vec3::new(x, y, z) + d * 0.55, dir: d, group: g, lens, sig, off, bridge: None });
        self.lasers.len() - 1
    }

    /// receptor de laser: liga o sinal `opens` enquanto o feixe acerta
    pub fn laser_catcher(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, normal: Vec3, opens: Option<String>) -> usize {
        let n = normal.normalize();
        let (g, glow, spin) = self.socket(ecs, n, 0xff5a3a, Vec3::new(x, y, z), 0.72);
        self.laser_catchers.push(LaserCatcher { pos: Vec3::new(x, y, z), normal: n, opens, active: false, was_active: false, group: g, glow, spin });
        self.laser_catchers.len() - 1
    }

    /// placa de lançamento (no chão): quem pisa sai voando com a velocidade `vel`
    pub fn faith_plate(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, v: Vec3, target: Option<Vec3>) -> usize {
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z));
        put(ecs, g, &geo::box_geo(2.2, 0.16, 2.2), m.frame.clone(), Transform::from_xyz(0.0, 0.08, 0.0));
        let glow = bas(ecs, rgb(0.4, 1.6, 2.6));
        let flat = Vec3::new(v.x, 0.0, v.z);
        let yaw = if flat.length_squared() > 1e-4 { flat.x.atan2(flat.z) } else { 0.0 };
        let hinge = group(ecs, g, Transform::from_xyz(-yaw.sin() * 0.95, 0.17, -yaw.cos() * 0.95).with_rotation(Quat::from_rotation_y(yaw)));
        let white = m.kind("white").faces[0].clone();
        put(ecs, hinge, &geo::box_geo(1.8, 0.08, 1.9), white, Transform::from_xyz(0.0, 0.0, 0.95));
        let arrow = shape_geo(&[(-0.25, -0.35), (0.0, 0.1), (0.25, -0.35), (0.25, -0.15), (0.0, 0.3), (-0.25, -0.15)]);
        for dz in [0.6, 1.25] {
            put(ecs, hinge, &arrow, glow.clone(), Transform::from_xyz(0.0, 0.045, dz).with_rotation(Quat::from_rotation_x(-FRAC_PI_2)));
        }
        for sx in [-0.6f32, 0.6] {
            put(ecs, g, &geo::cylinder_geo(0.05, 0.05, 0.12, 10, 1, false), m.dark.clone(), Transform::from_xyz(yaw.cos() * sx, 0.12, -yaw.sin() * sx));
        }
        let mut ring_e = None;
        if let Some(tp) = target {
            let rm = bas_a(ecs, rgb(0.4, 1.6, 2.6), 0.6, false);
            let ring = put(ecs, self.root(), &geo::ring_geo(0.7, 0.85, 40, 1).rotate_x(-FRAC_PI_2), rm.clone(), Transform::from_xyz(tp.x, tp.y + 0.02, tp.z));
            put(ecs, self.root(), &geo::circle_geo(0.2, 24).rotate_x(-FRAC_PI_2), rm, Transform::from_xyz(tp.x, tp.y + 0.02, tp.z));
            self.anims.push(Anim::PlateRing { ring });
            ring_e = Some(ring);
        }
        self.plates.push(Plate { pos: Vec3::new(x, y, z), vel: v, hinge, glow, cool: 0.0, kick: 0.0, ring: ring_e });
        self.plates.len() - 1
    }

    /// placa que joga de (x, y, z) até (tx, ty, tz) passando `apex` m acima do mais alto
    pub fn faith_plate_to(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, tx: f32, ty: f32, tz: f32, apex: f32, g: f32) -> usize {
        let top = y.max(ty) + apex;
        let vy = (2.0 * g * (top - y)).sqrt();
        let t = vy / g + (2.0 * (top - ty) / g).sqrt();
        self.faith_plate(ecs, x, y, z, Vec3::new((tx - x) / t, vy, (tz - z) / t), Some(Vec3::new(tx, ty, tz)))
    }

    /// funil de excursão: um feixe que carrega o que estiver dentro a 4 m/s
    pub fn funnel(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, dir: Vec3, id: Option<String>, reversed: bool, speed: f32, power: Option<String>) -> usize {
        let d = dir.normalize();
        let m = mats(ecs);
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z).with_rotation(q_from_y(d)));
        put(ecs, g, &geo::cylinder_geo(1.5, 1.7, 0.25, 32, 1, false), m.frame.clone(), Transform::from_xyz(0.0, 0.12, 0.0));
        let ring = bas(ecs, rgb(0.4, 1.4, 2.8));
        put(ecs, g, &geo::torus_geo(1.32, 0.07, 10, 48).rotate_x(FRAC_PI_2), ring.clone(), Transform::from_xyz(0.0, 0.28, 0.0));
        for i in 0..8 {
            let a = i as f32 / 8.0 * TAU;
            put(ecs, g, &geo::box_geo(0.12, 0.5, 0.4), m.dark.clone(), Transform::from_xyz(a.cos() * 1.55, 0.3, a.sin() * 1.55).with_rotation(Quat::from_rotation_y(-a)));
        }
        let off = power.is_some();
        self.funnels.push(Funnel { pos: Vec3::new(x, y, z) + d * 0.3, dir: d, id, reversed, start_reversed: reversed, speed, power, off, latch: false, group: g, ring });
        self.funnels.len() - 1
    }

    /// volume com gravidade própria `g`
    pub fn grav_zone(&mut self, ecs: &mut Ecs, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, g: Vec3, color: u32) -> usize {
        let (min, max) = mm(x0, y0, z0, x1, y1, z1);
        let size = max - min;
        let dir = if g.length_squared() > 1e-4 { g.normalize() } else { Vec3::ZERO };
        let c = hex(color).to_linear();
        let mat = fx_mat(ecs, Fx::new(fx::kind::GRAV_ZONE).color(c).p0(dir.extend(0.0)));
        let center = (min + max) * 0.5;
        put(ecs, self.root(), &geo::box_geo(size.x, size.y, size.z), mat, Transform::from_translation(center));
        // contorno aceso nas arestas
        let em = bas(ecs, hex_k(color, 2.0));
        let t = 0.02;
        for ax in 0..3 {
            let others: Vec<usize> = (0..3).filter(|&k| k != ax).collect();
            for sa in [-1.0, 1.0] {
                for sb in [-1.0, 1.0] {
                    let mut s = Vec3::splat(t);
                    s[ax] = size[ax];
                    let mut p = center;
                    p[others[0]] += sa * size[others[0]] / 2.0;
                    p[others[1]] += sb * size[others[1]] / 2.0;
                    put(ecs, self.root(), &geo::box_geo(s.x, s.y, s.z), em.clone(), Transform::from_translation(p));
                }
            }
        }
        self.grav_zones.push(GravZone { min, max, g });
        self.grav_zones.len() - 1
    }

    /// buraco negro: puxa tudo com força `strength`/d² até `reach` metros
    pub fn black_hole(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, strength: f32, horizon: f32, reach: f32) -> usize {
        let g = group(ecs, self.root(), Transform::from_xyz(x, y, z));
        let black = bas(ecs, rgb(0.0, 0.0, 0.0));
        put(ecs, g, &geo::sphere_geo(horizon, 48, 32), black, Transform::default());
        let halo = fx_mat(ecs, Fx::new(fx::kind::BH_HALO));
        let he = put(ecs, g, &geo::plane_geo(horizon * 7.0, horizon * 7.0), halo, Transform::default());
        ecs.entity_mut(he).insert(bevy::camera::visibility::NoFrustumCulling);
        let disk = fx_mat(ecs, Fx::new(fx::kind::BH_DISK).p0(Vec4::new(horizon * 1.6, horizon * 5.5, 0.0, 0.0)));
        put(ecs, g, &geo::ring_geo(horizon * 1.6, horizon * 5.5, 96, 4), disk, Transform::from_rotation(Quat::from_rotation_x(-FRAC_PI_2 + 0.35)));
        let mut r = rand::rng();
        let pm = fx::particles(400, |_| Vec3::ZERO, |_| [r.random(), r.random(), r.random(), 0.0]);
        let pmh = ecs.resource_mut::<Assets<Mesh>>().add(pm);
        let motes = fx_mat(ecs, Fx::new(fx::kind::BH_MOTES).p0(Vec4::new(horizon, horizon * 9.0, 0.0, 0.0)).size(0.09));
        let me = put_mesh(ecs, g, pmh, motes, Transform::default());
        ecs.entity_mut(me).insert(bevy::camera::visibility::NoFrustumCulling);
        ecs.spawn((point_light(hex(0xffa060), 30.0, reach * 0.8), Transform::default(), ChildOf(g)));
        self.black_holes.push(BlackHole { pos: Vec3::new(x, y, z), strength, horizon, reach, group: g });
        self.black_holes.len() - 1
    }

    /// a Lua no céu
    pub fn moon(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, r: f32, spot: Option<serde_json::Value>) {
        let tex = crate::mats::moon_texture(ecs);
        let mat = std_mat(ecs, StandardMaterial { base_color_texture: Some(tex.clone()), emissive_texture: Some(tex), emissive: LinearRgba::rgb(0.55, 0.55, 0.55), perceptual_roughness: 1.0, ..default() });
        let m = put(ecs, self.root(), &geo::sphere_geo(r, 64, 48), mat, Transform::from_xyz(x, y, z));
        self.anims.push(Anim::Spin { e: m, speed: 0.01 });
        let glow = fx_mat(ecs, Fx::new(fx::kind::SPRITE).color(LinearRgba::new(hex(0xbcd0ff).to_linear().red, hex(0xbcd0ff).to_linear().green, hex(0xbcd0ff).to_linear().blue, 0.5)).p0(Vec4::new(1.0, 0.0, 0.0, 0.0)));
        put(ecs, self.root(), &geo::plane_geo(r * 3.4, r * 3.4), glow, Transform::from_xyz(x, y, z));
        self.moon = Some(MoonInfo { pos: Vec3::new(x, y, z), r, spot });
    }

    /// a Terra vista da Lua
    pub fn earth(&mut self, ecs: &mut Ecs, x: f32, y: f32, z: f32, r: f32) {
        let tex = crate::mats::earth_texture(ecs);
        let mat = std_mat(ecs, StandardMaterial { base_color_texture: Some(tex.clone()), emissive_texture: Some(tex), emissive: LinearRgba::rgb(0.6, 0.6, 0.6), perceptual_roughness: 0.8, ..default() });
        let m = put(ecs, self.root(), &geo::sphere_geo(r, 64, 48), mat, Transform::from_xyz(x, y, z).with_rotation(Quat::from_rotation_z(0.4)));
        self.anims.push(Anim::Spin { e: m, speed: 0.02 });
        let c = hex(0x6fb0ff).to_linear();
        let glow = fx_mat(ecs, Fx::new(fx::kind::SPRITE).color(LinearRgba::new(c.red, c.green, c.blue, 0.7)).p0(Vec4::new(1.0, 0.0, 0.0, 0.0)));
        put(ecs, self.root(), &geo::plane_geo(r * 3.0, r * 3.0), glow, Transform::from_xyz(x, y, z));
    }

    /// céu estrelado (esfera de pontos em volta de `center`)
    pub fn stars(&mut self, ecs: &mut Ecs, center: Vec3, radius: f32, n: usize) {
        let mut r = rand::rng();
        let mut pts = vec![];
        let mut cols = vec![];
        for _ in 0..n {
            let v = loop {
                let v = Vec3::new(r.random_range(-1.0..1.0), r.random_range(-1.0..1.0), r.random_range(-1.0..1.0));
                if v.length_squared() > 1e-4 && v.length_squared() <= 1.0 {
                    break v.normalize();
                }
            };
            pts.push(v * radius + center);
            let k = 0.5 + r.random::<f32>() * 1.5;
            let warm = r.random::<f32>();
            cols.push([k * (0.8 + warm * 0.2), k * 0.9, k * (1.1 - warm * 0.3), 0.0]);
        }
        let pm = fx::particles(n, |i| pts[i], |i| cols[i]);
        let pmh = ecs.resource_mut::<Assets<Mesh>>().add(pm);
        let mat = fx_mat(ecs, Fx::new(fx::kind::STARS).size(1.6));
        let e = put_mesh(ecs, self.root(), pmh, mat, Transform::default());
        ecs.entity_mut(e).insert(bevy::camera::visibility::NoFrustumCulling);
    }

    /// faixa de luz decorativa (não colide)
    pub fn strip(&mut self, ecs: &mut Ecs, x0: f32, y0: f32, z0: f32, x1: f32, y1: f32, z1: f32, color: u32, k: f32) -> Entity {
        let m = bas(ecs, hex_k(color, k));
        put(ecs, self.root(), &geo::box_geo((x1 - x0).abs(), (y1 - y0).abs(), (z1 - z0).abs()), m, Transform::from_xyz((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0))
    }

    // ------------------------------------------------------------------ consultas
    /// raio contra as caixas sólidas: a mais próxima, com a normal da face atingida
    pub fn raycast(&self, origin: Vec3, dir: Vec3, max_dist: f32) -> Option<RayHit> {
        self.raycast_f(origin, dir, max_dist, |_| true)
    }

    fn solid_grid(&self) -> std::sync::Arc<SolidGrid> {
        let mut g = self.grid.lock().unwrap();
        if let Some(x) = g.as_ref() {
            if x.n == self.solids.len() && x.doors == self.doors.len() {
                return x.clone();
            }
        }
        let moving: HashSet<usize> = self.doors.iter().map(|d| d.solid).collect();
        let c = 3.0;
        let (mut min, mut max) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        let (mut still, mut always) = (vec![], vec![]);
        for (i, b) in self.solids.iter().enumerate() {
            if b.kbody.is_some() || moving.contains(&i) || !b.min.is_finite() || b.base0.is_some() {
                always.push(i);
            } else {
                still.push(i);
                min = min.min(b.min);
                max = max.max(b.max);
            }
        }
        let dims = [0, 1, 2].map(|a| (((max[a] - min[a]) / c).ceil() as i32).max(1));
        let mut cells: HashMap<i32, Vec<usize>> = HashMap::new();
        let cl = |v: f32, a: usize| ((v - min[a]) / c).floor().clamp(0.0, (dims[a] - 1) as f32) as i32;
        for i in still {
            let b = &self.solids[i];
            let lo = [0, 1, 2].map(|a| cl(b.min[a], a));
            let hi = [0, 1, 2].map(|a| cl(b.max[a], a));
            if (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 400 {
                always.push(i);
                continue;
            }
            for z in lo[2]..=hi[2] {
                for y in lo[1]..=hi[1] {
                    for x in lo[0]..=hi[0] {
                        cells.entry(x + dims[0] * (y + dims[1] * z)).or_default().push(i);
                    }
                }
            }
        }
        let out = std::sync::Arc::new(SolidGrid { n: self.solids.len(), doors: self.doors.len(), min, c, dims, cells, always });
        *g = Some(out.clone());
        out
    }

    /// raio pela grade (Amanatides–Woo): só as células que ele cruza
    fn ray_grid(&self, origin: Vec3, dir: Vec3, max_dist: f32, filter: &dyn Fn(usize) -> bool) -> Option<RayHit> {
        let g = self.solid_grid();
        let mut best: Option<RayHit> = None;
        for &i in &g.always {
            if self.listed(i) && filter(i) {
                best = self.ray_solid(i, origin, dir, max_dist, best);
            }
        }
        let bmax = g.min + Vec3::new(g.dims[0] as f32, g.dims[1] as f32, g.dims[2] as f32) * g.c;
        let (mut t0, mut t1) = (0.0f32, best.as_ref().map(|h| h.dist).unwrap_or(max_dist));
        for a in 0..3 {
            if dir[a].abs() < 1e-12 {
                if origin[a] < g.min[a] || origin[a] > bmax[a] {
                    return best;
                }
                continue;
            }
            let (mut ta, mut tb) = ((g.min[a] - origin[a]) / dir[a], (bmax[a] - origin[a]) / dir[a]);
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
            }
            t0 = t0.max(ta);
            t1 = t1.min(tb);
        }
        if t0 > t1 {
            return best;
        }
        let p = origin + dir * (t0 + 1e-6);
        let mut cell = [0, 1, 2].map(|a| (((p[a] - g.min[a]) / g.c).floor() as i32).clamp(0, g.dims[a] - 1));
        let step = [0, 1, 2].map(|a| if dir[a] > 0.0 { 1 } else if dir[a] < 0.0 { -1 } else { 0 });
        let mut t_max = [0, 1, 2].map(|a| if dir[a] == 0.0 { f32::INFINITY } else { (g.min[a] + (cell[a] + if dir[a] > 0.0 { 1 } else { 0 }) as f32 * g.c - origin[a]) / dir[a] });
        let t_delta = [0, 1, 2].map(|a| if dir[a] == 0.0 { f32::INFINITY } else { g.c / dir[a].abs() });
        let mut seen: HashSet<usize> = HashSet::new();
        for _ in 0..4096 {
            if let Some(list) = g.cells.get(&(cell[0] + g.dims[0] * (cell[1] + g.dims[1] * cell[2]))) {
                for &i in list {
                    if seen.insert(i) && self.listed(i) && filter(i) {
                        best = self.ray_solid(i, origin, dir, max_dist, best);
                    }
                }
            }
            let a = if t_max[0] < t_max[1] { if t_max[0] < t_max[2] { 0 } else { 2 } } else if t_max[1] < t_max[2] { 1 } else { 2 };
            let exit = t_max[a];
            if best.as_ref().is_some_and(|h| h.dist <= exit) || exit > max_dist {
                break;
            }
            cell[a] += step[a];
            if cell[a] < 0 || cell[a] >= g.dims[a] {
                break;
            }
            t_max[a] += t_delta[a];
        }
        best
    }

    pub fn raycast_f(&self, origin: Vec3, dir: Vec3, max_dist: f32, filter: impl Fn(usize) -> bool) -> Option<RayHit> {
        if self.solids.len() > GRID_MIN {
            return self.ray_grid(origin, dir, max_dist, &filter);
        }
        let mut best: Option<RayHit> = None;
        for i in self.solid_ids() {
            if !filter(i) {
                continue;
            }
            best = self.ray_solid(i, origin, dir, max_dist, best);
        }
        best
    }

    pub fn ray_solid(&self, i: usize, origin: Vec3, dir: Vec3, max_dist: f32, best: Option<RayHit>) -> Option<RayHit> {
        let b = &self.solids[i];
        if b.no_ray || b.disabled {
            return best;
        }
        let better = |d: f32, best: &Option<RayHit>| best.as_ref().map(|h| d < h.dist).unwrap_or(true);
        if let Some(planes) = &b.planes {
            if !ray_hits_box(origin, dir, b.min, b.max, best.as_ref().map(|h| h.dist).unwrap_or(max_dist)) {
                return best;
            }
            if let Some((d, p, n)) = ray_convex(origin, dir, planes, max_dist) {
                if better(d, &best) {
                    return Some(RayHit { solid: i, dist: d, point: p, normal: n, axis: -1 });
                }
            }
            return best;
        }
        if let Some(o) = &b.obb {
            if let Some((d, p, n)) = ray_obb(origin, dir, o, max_dist) {
                if better(d, &best) {
                    return Some(RayHit { solid: i, dist: d, point: p, normal: n, axis: -1 });
                }
            }
            return best;
        }
        let (mut tmin, mut tmax) = (f32::NEG_INFINITY, f32::INFINITY);
        let (mut axis, mut sign) = (-1i32, 0.0f32);
        for k in 0..3 {
            let (o, d, lo, hi) = (origin[k], dir[k], b.min[k], b.max[k]);
            if d.abs() < 1e-9 {
                if o < lo || o > hi {
                    return best;
                }
                continue;
            }
            let (mut t1, mut t2) = ((lo - o) / d, (hi - o) / d);
            let mut s = -1.0;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
                s = 1.0;
            }
            if t1 > tmin {
                tmin = t1;
                axis = k as i32;
                sign = s;
            }
            tmax = tmax.min(t2);
            if tmin > tmax {
                return best;
            }
        }
        if tmin < 0.0 || tmin > max_dist || axis < 0 {
            return best;
        }
        if better(tmin, &best) {
            let mut n = Vec3::ZERO;
            n[axis as usize] = sign;
            return Some(RayHit { solid: i, dist: tmin, point: origin + dir * tmin, normal: n, axis });
        }
        best
    }

    pub fn point_in_solid(&self, p: Vec3, except: Option<usize>) -> Option<usize> {
        let grid = (self.solids.len() > GRID_MIN).then(|| self.solid_grid());
        let ids: Box<dyn Iterator<Item = usize>> = match &grid {
            Some(g) => {
                let c = [0, 1, 2].map(|a| ((p[a] - g.min[a]) / g.c).floor() as i32);
                let inside = (0..3).all(|a| c[a] >= 0 && c[a] < g.dims[a]);
                let cell = if inside { g.cells.get(&(c[0] + g.dims[0] * (c[1] + g.dims[1] * c[2]))).cloned().unwrap_or_default() } else { vec![] };
                Box::new(g.always.iter().copied().chain(cell).filter(|&i| self.listed(i)))
            }
            None => Box::new(self.solid_ids()),
        };
        for i in ids {
            let b = &self.solids[i];
            if Some(i) == except || b.disabled {
                continue;
            }
            if let Some(planes) = &b.planes {
                if p.cmplt(b.min).any() || p.cmpgt(b.max).any() {
                    continue;
                }
                if planes.iter().all(|pl| pl.n.dot(p) < pl.d) {
                    return Some(i);
                }
                continue;
            }
            if let Some(o) = &b.obb {
                let l = o.qi * (p - o.c);
                if l.x.abs() < o.half.x && l.y.abs() < o.half.y && l.z.abs() < o.half.z {
                    return Some(i);
                }
                continue;
            }
            if p.cmpgt(b.min).all() && p.cmplt(b.max).all() {
                return Some(i);
            }
        }
        None
    }

    /// ent → caixa (para a física saber o que é cada colisor)
    pub fn solid_of(e: Ent) -> Option<usize> {
        match e {
            Ent::Static(s) => Some(s),
            _ => None,
        }
    }

    // ------------------------------------------------------------------ quadro
    pub fn update(&mut self, ecs: &mut Ecs, t: f32, dt: f32) {
        // animações simples
        for a in self.anims.clone() {
            match a {
                Anim::Incinerator { light } => {
                    if let Some(mut l) = ecs.get_mut::<PointLight>(light) {
                        l.intensity = (14.0 + (t * 9.0).sin() * 3.0 + (t * 23.0).sin() * 2.0) * LIGHT_K();
                    }
                }
                Anim::Dispenser { mat } => {
                    if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&mat) {
                        let k = 0.7 + 0.3 * (t * 2.2).sin();
                        m.base_color = Color::LinearRgba(rgb(2.4 * k, 1.6 * k, 0.3 * k));
                    }
                }
                Anim::Pedestal { holder, height } => {
                    if let Some(mut tr) = ecs.get_mut::<Transform>(holder) {
                        tr.rotation = Quat::from_rotation_y(t * 0.8);
                        tr.translation.y = height + (t * 2.0).sin() * 0.05;
                    }
                }
                Anim::Elevator { tube, scan, scan_mat, s } => {
                    let mut mm_ = ecs.resource_mut::<Assets<StandardMaterial>>();
                    if let Some(mut m) = mm_.get_mut(&tube) {
                        m.base_color.set_alpha(0.18 + (t * 3.0).sin() * 0.06);
                    }
                    let k = (t * 0.45) % 1.0;
                    if let Some(mut m) = mm_.get_mut(&scan_mat) {
                        m.base_color.set_alpha((k * PI).sin());
                    }
                    if let Some(mut tr) = ecs.get_mut::<Transform>(scan) {
                        tr.translation.y = (0.2 + k * 3.0) * s;
                    }
                }
                Anim::PlateRing { ring } => {
                    if let Some(mut tr) = ecs.get_mut::<Transform>(ring) {
                        tr.scale = Vec3::splat(1.0 + (t * 3.0).sin() * 0.06);
                    }
                }
                Anim::Spin { e, speed } => {
                    if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                        let base_z = if speed == 0.02 { 0.4 } else { 0.0 };
                        tr.rotation = Quat::from_rotation_z(base_z) * Quat::from_rotation_y(t * speed);
                    }
                }
            }
        }
        // botões de apertar: contagem, o botão afundando e o anel de luzes
        for i in 0..self.push_buttons.len() {
            self.push_chans(i);
            let used = self.push_buttons[i].opens.as_ref().map(|o| self.push_used.contains(o)).unwrap_or(false);
            let b = &mut self.push_buttons[i];
            if b.mode == "timer" && b.on {
                b.left -= dt;
                if b.left <= 0.0 {
                    b.on = false;
                }
            }
            for c in b.chans.as_mut().unwrap() {
                if c.mode == "timer" && c.on {
                    c.left -= dt;
                    if c.left <= 0.0 {
                        c.on = false;
                    }
                }
            }
            b.press = (b.press - dt * 4.0).max(0.0);
            let chans = b.chans.clone().unwrap();
            let mut shown: Vec<(String, f32, f32, bool)> = vec![];
            if chans.is_empty() || used {
                shown.push((b.mode.clone(), b.time, b.left, b.on));
            }
            shown.extend(chans.iter().map(|c| (c.mode.clone(), c.time, c.left, c.on)));
            let s = shown.iter().find(|c| c.3 && c.0 == "timer").or_else(|| shown.iter().find(|c| c.3)).cloned().unwrap_or((b.mode.clone(), b.time, b.left, b.on));
            let on = s.3;
            let lit = if s.0 != "timer" { if on { 12 } else { 0 } } else if on { ((s.2 / s.1) * 12.0).ceil() as usize } else { 0 };
            let (press, cap, cap_base) = (b.press, b.cap, b.cap_base);
            let (segs, lamps, on_m, off_m, cap_m, cap_em) = (b.segs.clone(), b.lamps.clone(), b.on_mat.clone(), b.off_mat.clone(), b.cap_mat.clone(), b.cap_em);
            if let Some(c) = cap {
                if let Some(mut tr) = ecs.get_mut::<Transform>(c) {
                    tr.translation = cap_base + Vec3::new(0.0, -0.028 * (press * 2.5).min(1.0), 0.0);
                }
            }
            for (k, seg) in segs.iter().enumerate() {
                set_mat(ecs, *seg, if k < lit { &on_m } else { &off_m });
            }
            let lamp_on = on && (s.0 != "timer" || (t * 10.0).sin() > -0.3);
            for l in &lamps {
                set_mat(ecs, *l, if lamp_on { &on_m } else { &off_m });
            }
            if let Some(cm) = cap_m {
                if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&cm) {
                    let k = if on { 1.8 + 0.4 * (t * 8.0).sin() } else { 0.6 };
                    m.emissive = cap_em * k;
                }
            }
        }
        crate::lava::set_time(ecs, t);
        for (l, base, seed) in self.lava_lights.clone() {
            if let Some(mut pl) = ecs.get_mut::<PointLight>(l) {
                if pl.intensity == 0.0 {
                    continue;
                }
                pl.intensity = base * LIGHT_K() * (0.86 + 0.09 * (t * 2.3 + seed).sin() + 0.05 * (t * 7.1 + seed * 3.0).sin());
            }
        }
        for di in 0..self.doors.len() {
            let d = &mut self.doors[di];
            if d.external {
                continue;
            }
            let path = d.path.unwrap_or_else(|| {
                let mut p = Vec3::ZERO;
                p[d.axis] = d.dist;
                p
            });
            let before = d.open;
            let sp = if d.instant { f32::INFINITY } else if d.target < d.open && d.speed_back.is_some() { d.speed_back.unwrap() } else { d.speed };
            d.instant = false;
            d.open += (d.target - d.open).signum() * (d.target - d.open).abs().min(dt * sp);
            if (d.target - d.open).abs() < 1e-9 {
                d.open = d.target;
            }
            d.delta = path * (d.open - before);
            d.offset = path * d.open;
            let at = d.offset;
            let (s, bmin, bmax, mesh, plain) = (d.solid, d.base_min, d.base_max, d.mesh, d.plain);
            let followers = d.followers.clone();
            self.solids[s].min = bmin + at;
            self.solids[s].max = bmax + at;
            if let Some(m) = mesh {
                if let Some(mut tr) = ecs.get_mut::<Transform>(m) {
                    tr.translation = at;
                }
            }
            for (e, base) in followers {
                if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                    tr.translation = base + at;
                }
            }
            if let Some(k) = self.solids[s].kbody {
                self.phys.move_kinematic(k, (bmin + bmax) * 0.5 + at);
            }
            if plain {
                self.door_lamps(ecs, di, t);
            }
        }
        for p in self.plates.clone().iter().enumerate() {
            let (i, p) = p;
            let kick = (p.kick - dt * 1.6).max(0.0);
            self.plates[i].kick = kick;
            if let Some(mut tr) = ecs.get_mut::<Transform>(p.hinge) {
                let yaw = tr.rotation.to_euler(EulerRot::YXZ).0;
                tr.rotation = Quat::from_euler(EulerRot::YXZ, yaw, -(kick * 3.0).min(1.0) * 0.85, 0.0);
            }
            let ready = p.cool <= 0.0;
            if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&p.glow) {
                let k = if ready { 0.8 + 0.2 * (t * 6.0).sin() } else { 0.25 };
                m.base_color = Color::LinearRgba(rgb(0.4 * k, 1.6 * k, 2.6 * k));
            }
        }
        for b in &mut self.buttons {
            let k = if b.pressed { 1.0 } else { 0.0 };
            b.v += ((k - b.k) * 260.0 - b.v * 18.0) * dt;
            b.k += b.v * dt;
            if let Some(p) = b.plate {
                if let Some(mut tr) = ecs.get_mut::<Transform>(p) {
                    tr.translation.y = 0.16 - 0.07 * b.k.clamp(-0.3, 1.3);
                }
            }
            b.c += (k - b.c) * (dt * 8.0).min(1.0);
            let lerp = |a: u32, z: u32, c: f32| -> LinearRgba {
                let (a, z) = (hex(a).to_linear(), hex(z).to_linear());
                LinearRgba::rgb(a.red + (z.red - a.red) * c, a.green + (z.green - a.green) * c, a.blue + (z.blue - a.blue) * c)
            };
            let mut mm_ = ecs.resource_mut::<Assets<StandardMaterial>>();
            if let Some(h) = &b.plate_mat {
                if let Some(mut m) = mm_.get_mut(h) {
                    m.base_color = Color::LinearRgba(lerp(0xc0392b, 0x27ae60, b.c));
                    m.emissive = lerp(0x5a0a05, 0x0a4a20, b.c);
                }
            }
            if let Some(h) = &b.lights_mat {
                if let Some(mut m) = mm_.get_mut(h) {
                    let (r, g) = (Vec3::new(2.6, 0.25, 0.12), Vec3::new(0.3, 2.6, 0.7));
                    let c = r.lerp(g, b.c);
                    m.base_color = Color::LinearRgba(rgb(c.x, c.y, c.z));
                }
            }
            if let Some(s) = b.spin {
                if let Some(mut tr) = ecs.get_mut::<Transform>(s) {
                    tr.rotate_y(dt * (0.4 + b.c * 2.5));
                }
            }
        }
    }
}

/// troca o material de todas as malhas de uma peça
pub fn set_mat(ecs: &mut Ecs, e: Entity, h: &Handle<StandardMaterial>) {
    for m in glb::meshes_of(ecs, e) {
        ecs.entity_mut(m).insert(MeshMaterial3d(h.clone()));
    }
}

pub fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// número como o JavaScript escreve (`String(4)` = "4", `String(2.5)` = "2.5")
pub fn fmt_num(x: f32) -> String {
    if (x - x.round()).abs() < 1e-6 { format!("{}", x.round() as i64) } else { format!("{}", x) }
}

/// polígono plano (ShapeGeometry): leque a partir do primeiro ponto (as setas são convexas por partes)
fn shape_geo(pts: &[(f32, f32)]) -> Geo {
    // triangula em orelhas (o contorno da seta não é convexo)
    let mut g = Geo::default();
    for &(x, y) in pts {
        g.pos.push(Vec3::new(x, y, 0.0));
        g.nor.push(Vec3::Z);
        g.uv.push(Vec2::new(x, y));
    }
    let mut idx: Vec<usize> = (0..pts.len()).collect();
    let area: f32 = (0..pts.len()).map(|i| {
        let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
        a.0 * b.1 - b.0 * a.1
    }).sum();
    let ccw = area > 0.0;
    let mut guard = 0;
    while idx.len() > 2 && guard < 100 {
        guard += 1;
        let n = idx.len();
        for k in 0..n {
            let (i0, i1, i2) = (idx[(k + n - 1) % n], idx[k], idx[(k + 1) % n]);
            let (a, b, c) = (pts[i0], pts[i1], pts[i2]);
            let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
            if (cross > 0.0) != ccw {
                continue;
            }
            let inside = idx.iter().any(|&j| {
                if j == i0 || j == i1 || j == i2 {
                    return false;
                }
                let p = pts[j];
                let s = |u: (f32, f32), v: (f32, f32)| (v.0 - u.0) * (p.1 - u.1) - (v.1 - u.1) * (p.0 - u.0);
                let (d1, d2, d3) = (s(a, b), s(b, c), s(c, a));
                (d1 >= 0.0 && d2 >= 0.0 && d3 >= 0.0) || (d1 <= 0.0 && d2 <= 0.0 && d3 <= 0.0)
            });
            if inside {
                continue;
            }
            if ccw {
                g.idx.extend([i0 as u32, i1 as u32, i2 as u32]);
            } else {
                g.idx.extend([i0 as u32, i2 as u32, i1 as u32]);
            }
            idx.remove(k);
            break;
        }
    }
    g
}
