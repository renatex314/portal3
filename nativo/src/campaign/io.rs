//! Sistema de entradas/saídas (I/O) das entidades dos mapas importados (io.js): liga botões,
//! portas, elevadores, dispensadores e portais da fase. Implementa a semântica documentada do
//! motor Source (fila de eventos com atraso, alvos com curinga e !activator/!caller/!self/!player)
//! sobre as peças deste jogo.

use super::bsp::{parse_f, parse_vec, Entity as Ent, Output};
use super::convert::{self as cv, cube_opts, is_cube, model_bounds, model_index, to_v, vec_kv, yaw_from_source, Built, CubeOpts, S};
use super::dialogue::Req;
use super::visuals;
use super::MapData;
use crate::game::Game;
use crate::portals::{BLUE, ORANGE, PORTAL_A, PORTAL_B};
use crate::world::Door;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use std::collections::HashMap;

/// vetores frente/cima de ângulos Source (graus) já no espaço daqui
pub fn angles_to_vectors(pitch: f32, yaw: f32, roll: f32) -> (Vec3, Vec3) {
    let (sp, cp) = pitch.to_radians().sin_cos();
    let (sy, cy) = yaw.to_radians().sin_cos();
    let (sr, cr) = roll.to_radians().sin_cos();
    let f = [cp * cy, cp * sy, -sp];
    let u = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
    (Vec3::new(f[0], f[2], -f[1]), Vec3::new(u[0], u[2], -u[1]))
}

const PLAYER: usize = 0;
const BALL: usize = 1;

#[derive(Clone, Debug)]
struct Ev {
    t: f32,
    seq: u64,
    target: String,
    input: String,
    param: String,
    act: Option<usize>,
    caller: Option<usize>,
}

/// peça que anda num caminho (func_door, func_movelinear)
struct Mover {
    door: usize,
    solid: usize,
    path: Vec3,
    open: f32,
    target: f32,
    speed: f32,
    /// nó cujo deslocamento soma (peça presa a outra que se move)
    carry: Option<usize>,
    offset: Vec3,
}

struct Train {
    speed_max: f32,
    speed: f32,
    height: f32,
    dir: f32,
    last_dir: f32,
    origin: Vec3,
    offset: Vec3,
    solids: Vec<usize>,
    doors: Vec<usize>,
    node: Option<usize>,
    next: Option<usize>,
    shuttle_trig: Option<usize>,
    shuttle_wait: Option<f32>,
    shuttle_dir: f32,
}

#[derive(Default)]
enum St {
    #[default]
    None,
    Timer { refire: f32, random: bool, lo: f32, hi: f32, left: f32 },
    Counter { value: f32, min: f32, max: f32 },
    Compare { value: f32, cmp: f32 },
    Hurt { lethal: bool },
    Change,
    Teleport,
    Push { dir: Vec3, speed: f32 },
    Detector { had: [bool; 2] },
    NoPortal { active: bool },
    Cleanser { fizz: usize },
    Door { state: i8, wait_close: f32, close_in: Option<f32> },
    Linear { state: i8 },
    Track { pos: Vec3 },
    Train(Box<Train>),
    Portal { which: usize, center: Vec3, normal: Vec3, up: Vec3 },
    Rot { is_open: bool, angle: f32, speed: Option<f32>, group: Option<usize> },
    Tpl { templates: Vec<String> },
    Gun { picked: bool, parent: Option<String>, refa: f32, baked: f32 },
    Credits { rolling: bool },
    Ambient { sound: Option<u64> },
    Phys { talking: bool, talk_t: f32, k: usize },
    View { viewing: bool },
    Breakable { broken: bool },
    Brush { unit: Option<(usize, String)> },
    Dyn(Box<Dyn>),
}

#[derive(Default)]
struct Dyn {
    at: Vec3,
    machine: Option<visuals::Machine>,
    shell: Option<Entity>,
    switch: Option<visuals::Switch>,
    core: Option<Entity>,
    pressed: bool,
    root: Option<usize>,
    parent: Option<usize>,
    base: Vec3,
    boss: bool,
}

struct Node {
    e: Option<usize>,
    cls: String,
    name: String,
    enabled: bool,
    outputs: Vec<Output>,
    fired: Vec<u32>,
    dead: bool,
    cube: Option<usize>,
    st: St,
    /// volume (gatilhos), na posição atual
    vol: Option<(Vec3, Vec3)>,
    vol_base: Option<(Vec3, Vec3)>,
    vol_root: Option<usize>,
    touching: Vec<usize>,
    wait: f32,
    next_trigger: f32,
    useable: bool,
    movers: Vec<usize>,
    carry_root: Option<usize>,
    parent_node: Option<Option<usize>>,
    cur_parent: Option<String>,
    ticks: bool,
}

impl Node {
    fn new(e: Option<usize>, cls: &str, name: &str, outputs: Vec<Output>) -> Node {
        let n = outputs.len();
        Node {
            e,
            cls: cls.into(),
            name: name.into(),
            enabled: true,
            outputs,
            fired: vec![0; n],
            dead: false,
            cube: None,
            st: St::None,
            vol: None,
            vol_base: None,
            vol_root: None,
            touching: vec![],
            wait: 0.2,
            next_trigger: 0.0,
            useable: false,
            movers: vec![],
            carry_root: None,
            parent_node: None,
            cur_parent: None,
            ticks: false,
        }
    }
}

struct Follow {
    solid: usize,
    door: usize,
    root: usize,
    prev: Vec3,
}

struct RotRt {
    g: cv::RotGroup,
    node: usize,
    root: Option<usize>,
    k: f32,
    units: HashMap<String, (i32, bool)>,
    launchers: Vec<(usize, String, Vec3, Vec3, Transform)>,
    last: Vec<f32>,
}

struct TrainCopyRt {
    copy: cv::TrainCopy,
    node: Option<usize>,
    door: usize,
    prev: Vec3,
}

struct Rocket {
    e: Entity,
    pos: Vec3,
    dir: Vec3,
    life: f32,
}

pub struct Runtime {
    pub map: String,
    data: MapData,
    built: Built,
    pub time: f32,
    queue: Vec<Ev>,
    seq: u64,
    nodes: Vec<Node>,
    by_name: HashMap<String, Vec<usize>>,
    node_of_ent: HashMap<usize, usize>,
    brush_of: HashMap<usize, usize>,
    cube_nodes: HashMap<usize, usize>,
    cube_info: HashMap<usize, CubeOpts>,
    movers: Vec<Mover>,
    follows: Vec<Follow>,
    rots: Vec<RotRt>,
    pools: HashMap<String, Vec<TrainCopyRt>>,
    /// volumes onde o original não deixa abrir portal
    no_portal: Vec<usize>,
    hit_targets: Vec<(usize, Vec3, Vec3, f32)>,
    rockets: Vec<Rocket>,
    booms: Vec<(Entity, Handle<StandardMaterial>, f32)>,
    shards: Vec<(Entity, Vec3, Vec3, f32)>,
    sound_id: u64,
    voice_end: f32,
    rocket_turrets: Vec<(usize, Entity, Vec3, f32, bool)>,
    credits_node: Option<usize>,
    /// eventos que ninguém tratou (para os testes): classe.entrada → vezes
    pub missing: HashMap<String, u32>,
    pub log: bool,
}

static EMPTY: std::sync::OnceLock<Ent> = std::sync::OnceLock::new();

fn empty() -> &'static Ent {
    EMPTY.get_or_init(Ent::default)
}

impl Runtime {
    pub fn new(map: &str, data: MapData, built: Built, g: &mut Game, ecs: &mut Ecs) -> Runtime {
        let mut rt = Runtime {
            map: map.into(),
            data,
            built,
            time: 0.0,
            queue: vec![],
            seq: 0,
            nodes: vec![],
            by_name: HashMap::new(),
            node_of_ent: HashMap::new(),
            brush_of: HashMap::new(),
            cube_nodes: HashMap::new(),
            cube_info: HashMap::new(),
            movers: vec![],
            follows: vec![],
            rots: vec![],
            pools: HashMap::new(),
            no_portal: vec![],
            hit_targets: vec![],
            rockets: vec![],
            booms: vec![],
            shards: vec![],
            sound_id: 0,
            voice_end: 0.0,
            rocket_turrets: vec![],
            credits_node: None,
            missing: HashMap::new(),
            log: std::env::var("PORTAL3_IO_LOG").is_ok(),
        };
        rt.nodes.push(Node::new(None, "player", "!player", vec![]));
        rt.nodes.push(Node::new(None, "prop_energy_ball", "energy_ball", vec![]));
        for (k, b) in rt.built.brush_ents.iter().enumerate() {
            rt.brush_of.insert(b.e, k);
        }
        for ei in 0..rt.data.bsp.entities.len() {
            rt.add(g, ecs, ei);
        }
        for i in 0..rt.nodes.len() {
            rt.init(g, ecs, i);
        }
        rt.setup_followers(g, ecs);
        let pools = std::mem::take(&mut rt.built.train_pools);
        for (k, v) in pools {
            let list = v
                .into_iter()
                .map(|copy| {
                    let s = copy.children.first().or(copy.train_solids.first()).copied().unwrap_or(0);
                    let door = push_door(g, s);
                    TrainCopyRt { copy, node: None, door, prev: Vec3::ZERO }
                })
                .collect();
            rt.pools.insert(k, list);
        }
        rt
    }

    fn ent(&self, n: usize) -> &Ent {
        self.nodes[n].e.map(|e| &self.data.bsp.entities[e]).unwrap_or_else(|| empty())
    }

    fn add(&mut self, g: &mut Game, ecs: &mut Ecs, ei: usize) -> usize {
        let e = &self.data.bsp.entities[ei];
        let mut n = Node::new(Some(ei), &e.classname, &e.name(), e.outputs.clone());
        n.enabled = e.get("startdisabled") != Some("1");
        let id = self.nodes.len();
        self.nodes.push(n);
        self.node_of_ent.insert(ei, id);
        if !self.nodes[id].name.is_empty() {
            let nm = self.nodes[id].name.clone();
            self.by_name.entry(nm).or_default().push(id);
        }
        self.setup(g, ecs, id);
        id
    }

    // ------------------------------------------------------------------ configuração por classe
    fn setup_trigger(&mut self, id: usize) -> bool {
        let e = self.ent(id);
        let Some(mi) = model_index(e).filter(|&m| m < self.data.bsp.models.len()) else { return false };
        let b = model_bounds(&self.data.bsp, mi, e);
        let wait = e.num("wait", 0.2);
        let n = &mut self.nodes[id];
        n.vol = Some(b);
        n.wait = wait;
        n.ticks = true;
        true
    }

    fn setup(&mut self, g: &mut Game, ecs: &mut Ecs, id: usize) {
        let cls = self.nodes[id].cls.clone();
        let e = self.ent(id).clone();
        match cls.as_str() {
            "logic_timer" => {
                let (refire, random, lo, hi) = (e.num("refiretime", 1.0), e.get("userandomtime") == Some("1"), e.num("lowerrandombound", 1.0), e.num("upperrandombound", 2.0));
                let left = if random { lo + rand::random::<f32>() * (hi - lo) } else { refire.max(0.01) };
                self.nodes[id].st = St::Timer { refire, random, lo, hi, left };
                self.nodes[id].ticks = true;
            }
            "math_counter" => self.nodes[id].st = St::Counter { value: e.num("startvalue", 0.0), min: e.num("min", 0.0), max: e.num("max", 0.0) },
            "logic_compare" => self.nodes[id].st = St::Compare { value: e.num("initialvalue", 0.0), cmp: e.num("comparevalue", 0.0) },
            "trigger_once" | "trigger_multiple" | "trigger_look" | "trigger_vphysics_motion" => {
                self.setup_trigger(id);
            }
            "trigger_hurt" => {
                if self.setup_trigger(id) {
                    self.nodes[id].st = St::Hurt { lethal: e.num("damage", 10.0) >= 50.0 };
                }
            }
            "trigger_changelevel" => {
                if self.setup_trigger(id) {
                    self.nodes[id].st = St::Change;
                    if e.flags() & 2 != 0 {
                        self.nodes[id].ticks = false;
                    }
                }
            }
            "trigger_teleport" => {
                if self.setup_trigger(id) {
                    self.nodes[id].st = St::Teleport;
                }
            }
            "trigger_portal_cleanser" => {
                if !self.setup_trigger(id) {
                    return;
                }
                self.nodes[id].ticks = false;
                let (mut min, mut max) = self.nodes[id].vol.unwrap();
                // a grade vai de parede a parede: um vão estreito até o sólido mais próximo é coberto
                let size = max - min;
                let thin = if size.y < size.x.min(size.z) { 1 } else if size.x < size.z { 0 } else { 2 };
                let mid = (min + max) * 0.5;
                for ax in 0..3 {
                    if ax == thin {
                        continue;
                    }
                    for sgn in [-1.0f32, 1.0] {
                        let edge = if sgn > 0.0 { max[ax] } else { min[ax] };
                        let mut q = mid;
                        let mut reach = 0.0;
                        let mut d = 0.05;
                        while d <= 2.0 {
                            q[ax] = edge + sgn * d;
                            if g.world.point_in_solid(q, None).is_some() {
                                reach = d - 0.05;
                                break;
                            }
                            d += 0.05;
                        }
                        if reach > 0.1 {
                            if sgn > 0.0 {
                                max[ax] += reach;
                            } else {
                                min[ax] -= reach;
                            }
                        }
                    }
                }
                self.nodes[id].vol = Some((min, max));
                let fz = g.world.fizzler(ecs, min.x, min.y, min.z, max.x, max.y, max.z, None, "on");
                self.nodes[id].st = St::Cleanser { fizz: fz };
            }
            "func_door" => {
                let [p, y, _] = parse_vec(e.get("movedir"));
                let (dir, _) = angles_to_vectors(p, y, 0.0);
                let Some(&bi) = self.brush_of.get(&self.nodes[id].e.unwrap()) else { return };
                let Some((bmin, bmax)) = self.built.brush_ents[bi].bounds else { return };
                let size = bmax - bmin;
                // como no Source: o curso é o tamanho na direção do movimento menos 2 unidades e o "lip"
                let dist = (dir.x.abs() * size.x + dir.y.abs() * size.y + dir.z.abs() * size.z - (2.0 + e.num("lip", 0.0)) * S).max(0.0);
                let start_open = if e.flags() & 1 != 0 || e.get("spawnpos") == Some("1") { 1.0 } else { 0.0 };
                self.make_movers(g, ecs, id, dir * dist, e.num("speed", 100.0), start_open);
                if e.flags() & 256 != 0 {
                    self.nodes[id].useable = true;
                }
                self.nodes[id].st = St::Door { state: start_open as i8, wait_close: e.num("wait", -1.0), close_in: None };
                self.nodes[id].ticks = true;
            }
            "func_movelinear" | "func_water_analog" => {
                let [p, y, _] = parse_vec(e.get("movedir"));
                let (dir, _) = angles_to_vectors(p, y, 0.0);
                self.make_movers(g, ecs, id, dir * e.num("movedistance", 100.0) * S, e.num("speed", 100.0), e.num("startposition", 0.0));
                self.nodes[id].st = St::Linear { state: -1 };
                self.nodes[id].ticks = true;
            }
            "path_track" => self.nodes[id].st = St::Track { pos: vec_kv(&e, "origin") },
            "func_tracktrain" => {
                let Some(&bi) = self.brush_of.get(&self.nodes[id].e.unwrap()) else { return };
                let solids = self.built.brush_ents[bi].solids.clone();
                self.make_train(g, id, &e, solids);
            }
            "prop_portal" => {
                let which = if e.get("portaltwo") == Some("1") { ORANGE } else { BLUE };
                let [p, y, r] = parse_vec(e.get("angles"));
                let (normal, up) = angles_to_vectors(p, y, r);
                self.nodes[id].st = St::Portal { which, center: vec_kv(&e, "origin"), normal, up };
            }
            "npc_rocket_turret" => {
                let at = vec_kv(&e, "origin");
                let (m, _, _) = crate::glb::spawn_model_full(ecs, "rocket_turret");
                ecs.entity_mut(m).insert((Transform::from_translation(at), ChildOf(g.world.root())));
                self.rocket_turrets.push((id, m, at, 1.0, e.flags() & 1 == 0));
                self.nodes[id].ticks = true;
            }
            "prop_dynamic" | "prop_dynamic_override" => {
                let model = e.model();
                let at = vec_kv(&e, "origin");
                let mut d = Dyn { at, base: at, ..default() };
                let root = g.world.root();
                if model.ends_with("glados_body.mdl") {
                    // a máquina central (desenho próprio) e o volume que recebe os foguetes
                    d.machine = Some(visuals::boss_machine(ecs, root, at));
                    d.boss = true;
                    self.hit_targets.push((id, at + Vec3::new(0.0, -1.6, 0.0), at + Vec3::new(0.0, -5.6, 0.0), 1.9));
                } else if model.contains("round_elevator_body") {
                    d.shell = Some(visuals::elevator_shell(ecs, root, at));
                } else if model.contains("switch001") {
                    d.switch = Some(visuals::pedestal_switch(ecs, root, at));
                    d.root = cv::moving_root(&self.data.bsp, &self.built.by_name, self.nodes[id].e.unwrap());
                } else if model.contains("glados_ball") {
                    let c = visuals::core_model(ecs, root, 0);
                    ecs.entity_mut(c).insert(Transform::from_translation(at));
                    d.core = Some(c);
                } else {
                    return;
                }
                if e.get("startdisabled") == Some("1") {
                    self.set_dyn_visible(ecs, &d, false);
                }
                self.nodes[id].st = St::Dyn(Box::new(d));
                self.nodes[id].ticks = true;
            }
            "func_breakable_surf" | "func_breakable" => {
                if let Some(&bi) = self.brush_of.get(&self.nodes[id].e.unwrap()) {
                    for &s in &self.built.brush_ents[bi].solids {
                        g.world.solids[s].breakable = Some(id);
                    }
                }
                self.nodes[id].st = St::Breakable { broken: false };
            }
            "func_door_rotating" => {
                if e.flags() & 256 != 0 {
                    self.nodes[id].useable = true;
                }
                self.nodes[id].st = St::Rot { is_open: false, angle: 0.0, speed: None, group: None };
            }
            "func_portal_detector" => {
                if self.setup_trigger(id) {
                    self.nodes[id].st = St::Detector { had: [false; 2] };
                }
            }
            "func_noportal_volume" => {
                if self.setup_trigger(id) {
                    self.nodes[id].ticks = false;
                    self.nodes[id].st = St::NoPortal { active: e.flags() & 1 == 0 };
                    self.no_portal.push(id);
                }
            }
            "trigger_push" => {
                if self.setup_trigger(id) {
                    let [p, y, _] = parse_vec(e.get("pushdir"));
                    self.nodes[id].st = St::Push { dir: angles_to_vectors(p, y, 0.0).0, speed: e.num("speed", 40.0) * S };
                }
            }
            "func_rot_button" | "func_button" => self.nodes[id].useable = true,
            "point_template" => self.nodes[id].st = St::Tpl { templates: e.kv.iter().filter(|(k, _)| cv::is_template_key(k)).map(|(_, v)| v.to_lowercase()).collect() },
            "weapon_portalgun" => self.nodes[id].st = St::Gun { picked: false, parent: None, refa: 0.0, baked: 0.0 },
            "env_portal_credits" => self.nodes[id].st = St::Credits { rolling: false },
            "ambient_generic" => self.nodes[id].st = St::Ambient { sound: None },
            "point_viewcontrol" => self.nodes[id].st = St::View { viewing: false },
            "func_brush" | "func_wall_toggle" => self.nodes[id].st = St::Brush { unit: None },
            _ => {}
        }
    }

    fn init(&mut self, g: &mut Game, ecs: &mut Ecs, id: usize) {
        match &self.nodes[id].st {
            St::Cleanser { .. } => {
                let on = self.nodes[id].enabled;
                self.cleanser_on(g, ecs, id, on);
            }
            St::Train(_) => self.train_init(g, ecs, id),
            St::Portal { .. } => {
                if self.ent(id).get("activated") == Some("1") {
                    self.portal_open(g, id);
                }
            }
            St::Dyn(d) if d.shell.is_some() || d.core.is_some() => {
                // cabine do elevador acompanhando o trem em que está presa
                let pn = self.ent(id).get_or("parentname", "").to_string();
                let t = if pn.is_empty() { None } else { self.find_static(&pn).into_iter().find(|&x| self.nodes[x].cls == "func_tracktrain") };
                if let St::Dyn(d) = &mut self.nodes[id].st {
                    d.parent = t;
                }
            }
            _ => {}
        }
    }

    fn cleanser_on(&mut self, g: &mut Game, ecs: &mut Ecs, id: usize, on: bool) {
        self.nodes[id].enabled = on;
        if let St::Cleanser { fizz } = self.nodes[id].st {
            g.world.set_fizzler(ecs, fizz, on);
        }
    }

    /// um "door" do mundo para cada sólido da entidade (o jogador vai junto quando ele anda)
    fn make_movers(&mut self, g: &mut Game, ecs: &mut Ecs, id: usize, path: Vec3, speed_units: f32, start: f32) {
        let Some(&bi) = self.brush_of.get(&self.nodes[id].e.unwrap()) else { return };
        let len = path.length();
        for &s in &self.built.brush_ents[bi].solids.clone() {
            let door = push_door(g, s);
            let m = Mover { door, solid: s, path, open: start, target: start, speed: if len > 1e-6 { speed_units * S / len } else { 1.0 }, carry: None, offset: path * start };
            if start != 0.0 {
                g.world.offset_solid(ecs, s, m.offset);
            }
            self.movers.push(m);
            self.nodes[id].movers.push(self.movers.len() - 1);
        }
    }

    fn make_train(&mut self, g: &mut Game, id: usize, e: &Ent, solids: Vec<usize>) {
        let speed_max = (if e.num("speed", 0.0) != 0.0 { e.num("speed", 0.0) } else if e.num("startspeed", 0.0) != 0.0 { e.num("startspeed", 0.0) } else { 100.0 }) * S;
        let doors = solids.iter().map(|&s| push_door(g, s)).collect();
        self.nodes[id].st = St::Train(Box::new(Train {
            speed_max,
            speed: speed_max,
            height: e.num("height", 0.0) * S,
            dir: 0.0,
            last_dir: 0.0,
            origin: vec_kv(e, "origin"),
            offset: Vec3::ZERO,
            solids,
            doors,
            node: None,
            next: None,
            shuttle_trig: None,
            shuttle_wait: None,
            shuttle_dir: 0.0,
        }));
    }

    fn train_init(&mut self, g: &mut Game, ecs: &mut Ecs, id: usize) {
        let target = self.ent(id).get_or("target", "").to_string();
        let node = self.find_static(&target).into_iter().find(|&x| self.nodes[x].cls == "path_track");
        let next = node.and_then(|n| self.next_track(n, 1));
        // plataforma com gatilho "subiu → volta, desceu → vai" (câmara 11): depois de ligada,
        // ela vai e volta sozinha
        let name = self.nodes[id].name.clone();
        let to = |o: &Output, out: &str, inp: &str| o.output == out && o.target.to_lowercase() == name && o.input.to_lowercase() == inp;
        let shuttle = if name.is_empty() {
            None
        } else {
            (0..self.nodes.len()).find(|&t| self.nodes[t].cls.starts_with("trigger_") && self.nodes[t].outputs.iter().any(|o| to(o, "onstarttouch", "startbackward")) && self.nodes[t].outputs.iter().any(|o| to(o, "onendtouch", "startforward")))
        };
        let pos = node.map(|n| self.track_pos(n));
        if let St::Train(t) = &mut self.nodes[id].st {
            t.node = node;
            t.next = next;
            t.shuttle_trig = shuttle;
            if let Some(p) = pos {
                t.offset = p + Vec3::new(0.0, t.height, 0.0) - t.origin;
            }
        }
        self.train_place(g, ecs, id, Vec3::ZERO);
    }

    fn track_pos(&self, n: usize) -> Vec3 {
        match &self.nodes[n].st {
            St::Track { pos } => *pos,
            _ => Vec3::ZERO,
        }
    }

    /// leva os sólidos do trem para o deslocamento atual (e o quanto andou, para carregar o jogador)
    fn train_place(&mut self, g: &mut Game, ecs: &mut Ecs, id: usize, delta: Vec3) {
        let St::Train(t) = &self.nodes[id].st else { return };
        let off = t.offset;
        for &s in &t.solids {
            g.world.offset_solid(ecs, s, off);
        }
        for &d in &t.doors {
            g.world.doors[d].delta = delta;
            g.world.doors[d].offset = off;
        }
    }

    /// próximo ponto do trilho (dir > 0) ou o anterior (dir < 0)
    fn next_track(&self, node: usize, dir: i32) -> Option<usize> {
        if dir > 0 {
            let t = self.ent(node).get_or("target", "").to_string();
            if t.is_empty() {
                return None;
            }
            return self.find_static(&t).into_iter().find(|&x| self.nodes[x].cls == "path_track");
        }
        let me = self.nodes[node].name.clone();
        (0..self.nodes.len()).find(|&x| self.nodes[x].cls == "path_track" && self.ent(x).get_or("target", "").to_lowercase() == me)
    }
}

fn push_door(g: &mut Game, solid: usize) -> usize {
    let b = &g.world.solids[solid];
    g.world.doors.push(Door { solid, base_min: b.min, base_max: b.max, external: true, ..default() });
    g.world.doors.len() - 1
}

const CORE_VOICES: [&str; 3] = ["Portal.Glados_core.Curiosity_", "Portal.Glados_core.Aggressive_", "Portal.Glados_core.Crazy_"];

fn slab(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3, pad: f32, t1: f32) -> Option<f32> {
    let (mut t0, mut t1) = (0.0f32, t1);
    for a in 0..3 {
        let (lo, hi) = (min[a] - pad, max[a] + pad);
        if dir[a].abs() < 1e-9 {
            if origin[a] < lo || origin[a] > hi {
                return None;
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
    (t0 <= t1).then_some(t0)
}

fn overlap(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3, m: f32) -> bool {
    a0.x < b1.x + m && a1.x > b0.x - m && a0.y < b1.y + m && a1.y > b0.y - m && a0.z < b1.z + m && a1.z > b0.z - m
}

impl Runtime {
    // ------------------------------------------------------------------ alvos e eventos
    fn find_static(&self, target: &str) -> Vec<usize> {
        let t = target.to_lowercase();
        let mut out: Vec<usize> = vec![];
        if let Some(pre) = t.strip_suffix('*') {
            for (k, list) in &self.by_name {
                if k.starts_with(pre) {
                    out.extend(list);
                }
            }
        } else if let Some(l) = self.by_name.get(&t) {
            out.extend(l);
        }
        out.retain(|&n| !self.nodes[n].dead);
        out
    }

    fn cube_node(&mut self, k: usize) -> usize {
        if let Some(&n) = self.cube_nodes.get(&k) {
            return n;
        }
        let info = self.cube_info.get(&k).cloned().unwrap_or_default();
        let cls = if info.core.is_some() { "prop_glados_core" } else { "prop_physics" };
        let mut n = Node::new(None, cls, &info.io_name, vec![]);
        n.cube = Some(k);
        n.st = St::Phys { talking: false, talk_t: 0.0, k: 0 };
        self.nodes.push(n);
        let id = self.nodes.len() - 1;
        self.cube_nodes.insert(k, id);
        id
    }

    fn find(&mut self, g: &Game, target: &str, caller: Option<usize>, act: Option<usize>) -> Vec<usize> {
        let t = target.to_lowercase();
        match t.as_str() {
            "!self" | "!caller" => return caller.into_iter().filter(|&n| !self.nodes[n].dead).collect(),
            "!activator" => return act.into_iter().filter(|&n| !self.nodes[n].dead).collect(),
            "!player" => return vec![PLAYER],
            _ => {}
        }
        let mut out = self.find_static(&t);
        let cubes: Vec<usize> = self
            .cube_info
            .iter()
            .filter(|(k, info)| {
                let p = &g.props.list[**k];
                !p.gone && if let Some(pre) = t.strip_suffix('*') { info.io_name.starts_with(pre) } else { info.io_name == t }
            })
            .map(|(k, _)| *k)
            .collect();
        for k in cubes {
            let n = self.cube_node(k);
            if !self.nodes[n].dead {
                out.push(n);
            }
        }
        out
    }

    fn fire(&mut self, n: usize, output: &str, act: Option<usize>, value: Option<String>) {
        let mut evs = vec![];
        let node = &mut self.nodes[n];
        for (k, o) in node.outputs.iter().enumerate() {
            if o.output != output {
                continue;
            }
            if node.fired.len() <= k {
                node.fired.resize(k + 1, 0);
            }
            let used = node.fired[k];
            if o.times > 0 && used >= o.times as u32 {
                continue;
            }
            node.fired[k] = used + 1;
            let param = if !o.param.is_empty() { o.param.clone() } else { value.clone().unwrap_or_default() };
            evs.push((o.delay, o.target.clone(), o.input.clone(), param));
        }
        for (d, t, i, p) in evs {
            self.schedule(d, &t, &i, &p, act, Some(n));
        }
    }

    fn schedule(&mut self, delay: f32, target: &str, input: &str, param: &str, act: Option<usize>, caller: Option<usize>) {
        self.seq += 1;
        let ev = Ev { t: self.time + delay, seq: self.seq, target: target.into(), input: input.into(), param: param.into(), act, caller };
        let mut i = self.queue.len();
        while i > 0 && (self.queue[i - 1].t > ev.t || (self.queue[i - 1].t == ev.t && self.queue[i - 1].seq > ev.seq)) {
            i -= 1;
        }
        self.queue.insert(i, ev);
    }

    fn unschedule(&mut self, caller: usize, input: Option<&str>) {
        self.queue.retain(|ev| !(ev.caller == Some(caller) && input.is_none_or(|i| ev.input.eq_ignore_ascii_case(i))));
    }

    fn dispatch(&mut self, g: &mut Game, ecs: &mut Ecs, ev: Ev) {
        let input = ev.input.to_lowercase();
        if self.log {
            let who = ev.caller.map(|c| if self.nodes[c].name.is_empty() { self.nodes[c].cls.clone() } else { self.nodes[c].name.clone() }).unwrap_or("?".into());
            eprintln!("[io {:.2}] {who} → {}.{}({})", self.time, ev.target, ev.input, ev.param);
        }
        for n in self.find(g, &ev.target, ev.caller, ev.act) {
            if self.generic(g, ecs, n, &input, &ev) {
                continue;
            }
            if !self.input(g, ecs, n, &input, &ev.param, &ev) {
                *self.missing.entry(format!("{}.{input}", self.nodes[n].cls)).or_default() += 1;
            }
        }
    }

    /// entradas que valem para qualquer entidade
    fn generic(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, input: &str, ev: &Ev) -> bool {
        match input {
            "kill" => self.kill(g, ecs, n),
            "killhierarchy" => self.kill_tree(g, ecs, n, 0),
            "fireuser1" | "fireuser2" | "fireuser3" | "fireuser4" => {
                let out = format!("onuser{}", &input[input.len() - 1..]);
                self.fire(n, &out, ev.act, None);
            }
            "addoutput" => {
                let p = ev.param.trim();
                if let Some((name, rest)) = p.split_once(char::is_whitespace) {
                    let parts: Vec<&str> = rest.trim().split(':').collect();
                    if name.to_lowercase().starts_with("on") && (parts.len() == 4 || parts.len() == 5) {
                        self.nodes[n].outputs.push(Output {
                            output: name.to_lowercase(),
                            target: parts[0].into(),
                            input: parts[1].into(),
                            param: parts[2].into(),
                            delay: parse_f(parts[3]).unwrap_or(0.0),
                            times: parts.get(4).and_then(|t| super::bsp::parse_i(t)).filter(|&t| t != 0).unwrap_or(-1) as i32,
                        });
                    }
                }
            }
            _ => return false,
        }
        true
    }

    /// KillHierarchy: a entidade e tudo o que está preso nela
    fn kill_tree(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, depth: usize) {
        self.kill(g, ecs, n);
        let name = self.nodes[n].name.clone();
        if name.is_empty() || depth > 8 {
            return;
        }
        for m in 0..self.nodes.len() {
            if self.nodes[m].dead || m == n {
                continue;
            }
            let pn = self.nodes[m].cur_parent.clone().unwrap_or_else(|| self.ent(m).get_or("parentname", "").to_lowercase());
            if pn == name {
                self.kill_tree(g, ecs, m, depth + 1);
            }
        }
    }

    fn kill(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize) {
        if let St::Ambient { sound: Some(id) } = self.nodes[n].st {
            g.camp_audio.push(Req::StopSound { id, fade: 0.0 });
            self.nodes[n].st = St::Ambient { sound: None };
        }
        if let St::Dyn(d) = &self.nodes[n].st {
            self.set_dyn_visible(ecs, d, false);
        }
        if let St::View { viewing: true } = self.nodes[n].st {
            g.camp_view = None;
        }
        self.nodes[n].dead = true;
        if let Some(k) = self.nodes[n].cube {
            remove_cube(g, k);
        }
        if let Some(e) = self.nodes[n].e {
            if let Some(&bi) = self.brush_of.get(&e) {
                for s in self.built.brush_ents[bi].solids.clone() {
                    g.world.set_solid_enabled(ecs, s, false);
                }
            }
        }
        // carrinho da esteira: as peças presas somem junto
        for pool in self.pools.values() {
            for c in pool {
                if c.node == Some(n) {
                    for &sd in &c.copy.children {
                        g.world.set_solid_enabled(ecs, sd, false);
                    }
                }
            }
        }
        if let St::Train(t) = &mut self.nodes[n].st {
            t.dir = 0.0;
        }
    }

    fn set_dyn_visible(&self, ecs: &mut Ecs, d: &Dyn, on: bool) {
        let v = if on { Visibility::Inherited } else { Visibility::Hidden };
        for e in [d.machine.as_ref().map(|m| m.root), d.shell, d.switch.as_ref().map(|s| s.root), d.core].into_iter().flatten() {
            if let Ok(mut em) = ecs.get_entity_mut(e) {
                em.insert(v);
            }
        }
    }

    /// o mapa começa: logic_auto
    pub fn start(&mut self) {
        for n in 0..self.nodes.len() {
            if self.nodes[n].cls == "logic_auto" {
                self.fire(n, "onmapspawn", None, None);
                self.fire(n, "onnewgame", None, None);
                if self.ent(n).flags() & 1 != 0 {
                    self.nodes[n].dead = true;
                }
            }
        }
    }

    // ------------------------------------------------------------------ gatilhos
    /// quem está dentro do volume (jogador e cubos), respeitando flags e filtro
    fn insiders(&mut self, g: &Game, n: usize) -> Vec<usize> {
        let Some((min, max)) = self.nodes[n].vol else { return vec![] };
        let sf = self.ent(n).flags();
        let all = sf & 64 != 0;
        let mut out = vec![];
        if all || sf & 1 != 0 || self.nodes[n].cls == "trigger_changelevel" {
            let (pmin, pmax) = (g.player.pos - g.player.half, g.player.pos + g.player.half);
            if overlap(pmin, pmax, min, max, 0.0) {
                out.push(PLAYER);
            }
        }
        if all || sf & 8 != 0 {
            let ks: Vec<usize> = self.cube_info.keys().copied().filter(|&k| !g.props.list[k].gone).collect();
            for k in ks {
                let p = g.props.list[k].pos;
                if p.cmpgt(min - Vec3::splat(0.3)).all() && p.cmplt(max + Vec3::splat(0.3)).all() {
                    out.push(self.cube_node(k));
                }
            }
        }
        out.into_iter().filter(|&a| self.pass_filter(n, a)).collect()
    }

    fn pass_filter(&self, n: usize, a: usize) -> bool {
        let fname = self.ent(n).get_or("filtername", "").to_string();
        if fname.is_empty() {
            return true;
        }
        let Some(f) = self.find_static(&fname).first().copied() else { return true };
        let fe = self.ent(f);
        let fcls = self.nodes[f].cls.as_str();
        let m = |v: &str, pat: &str| if let Some(p) = pat.strip_suffix('*') { v.starts_with(p) } else { v == pat };
        let ok = if a == BALL {
            fcls == "filter_combineball_type"
        } else if fcls == "filter_combineball_type" {
            false
        } else if fcls == "filter_activator_name" {
            m(&self.nodes[a].name, &fe.get_or("filtername", "").to_lowercase())
        } else if fcls == "filter_activator_class" {
            m(&self.nodes[a].cls, &fe.get_or("filterclass", "").to_lowercase())
        } else {
            true
        };
        let neg = fe.get_or("negated", "0");
        if neg == "1" || neg.to_lowercase().starts_with("disallow") { !ok } else { ok }
    }

    /// entradas e saídas do volume; devolve quem disparou o OnTrigger agora
    fn tick_trigger(&mut self, g: &Game, n: usize) -> Vec<usize> {
        if !self.nodes[n].enabled {
            self.nodes[n].touching.clear();
            return vec![];
        }
        let mut now = self.insiders(g, n);
        if let Some(&ci) = self.nodes[n].e.and_then(|e| self.built.catchers.get(&e)) {
            if g.world.catchers[ci].active {
                now.push(BALL);
            }
        }
        let mut entered = vec![];
        let was_empty = self.nodes[n].touching.is_empty();
        for &a in &now {
            if self.nodes[n].touching.contains(&a) {
                continue;
            }
            if was_empty {
                self.fire(n, "onstarttouchall", Some(a), None);
            }
            self.fire(n, "onstarttouch", Some(a), None);
            if self.time >= self.nodes[n].next_trigger {
                self.nodes[n].next_trigger = self.time + self.nodes[n].wait.max(0.0);
                self.fire(n, "ontrigger", Some(a), None);
                entered.push(a);
                if self.nodes[n].cls == "trigger_once" {
                    self.nodes[n].dead = true;
                    return entered;
                }
            }
        }
        for a in self.nodes[n].touching.clone() {
            if !now.contains(&a) {
                self.fire(n, "onendtouch", Some(a), None);
                if now.is_empty() {
                    self.fire(n, "onendtouchall", Some(a), None);
                }
            }
        }
        self.nodes[n].touching = now;
        entered
    }

    // ------------------------------------------------------------------ deslocamentos
    /// deslocamento de uma peça móvel somado ao das peças-mãe que a carregam
    fn total_offset(&self, n: usize) -> Vec3 {
        let mut off = Vec3::ZERO;
        let mut cur = Some(n);
        for _ in 0..9 {
            let Some(c) = cur else { break };
            off += self.own_offset(c);
            cur = self.nodes[c].carry_root;
        }
        off
    }

    fn own_offset(&self, n: usize) -> Vec3 {
        if let Some(&m) = self.nodes[n].movers.first() {
            return self.movers[m].offset;
        }
        if let St::Train(t) = &self.nodes[n].st {
            return t.offset;
        }
        Vec3::ZERO
    }

    fn moves(&self, n: usize) -> bool {
        !self.nodes[n].movers.is_empty() || matches!(self.nodes[n].st, St::Train(_))
    }

    /// deslocamento atual da entidade-mãe (porta, plataforma ou trem) de `n`
    fn parent_offset(&mut self, n: usize) -> Vec3 {
        if self.nodes[n].parent_node.is_none() {
            let pn = self.ent(n).get_or("parentname", "").to_string();
            let p = if pn.is_empty() { None } else { self.find_static(&pn).into_iter().find(|&x| self.moves(x)) };
            self.nodes[n].parent_node = Some(p);
        }
        match self.nodes[n].parent_node.unwrap() {
            Some(p) => self.total_offset(p),
            None => Vec3::ZERO,
        }
    }

    /// peças presas a algo que se move: pincéis, caixas e gatilhos andam com a peça raiz
    fn setup_followers(&mut self, g: &mut Game, ecs: &mut Ecs) {
        let names = self.built.by_name.clone();
        // peças que se movem presas a outras que se movem: o deslocamento soma o da mãe
        for n in 0..self.nodes.len() {
            let Some(e) = self.nodes[n].e else { continue };
            if self.nodes[n].movers.is_empty() || self.ent(n).get("parentname").is_none_or(|p| p.is_empty()) {
                continue;
            }
            let Some(root) = cv::moving_root(&self.data.bsp, &names, e).and_then(|r| self.node_of_ent.get(&r).copied()) else { continue };
            if root == n {
                continue;
            }
            self.nodes[n].carry_root = Some(root);
            for &m in &self.nodes[n].movers {
                self.movers[m].carry = Some(root);
            }
        }
        // portas giratórias com peças presas
        let groups = std::mem::take(&mut self.built.rot_groups);
        for grp in groups {
            let Some(&node) = self.node_of_ent.get(&grp.e) else { continue };
            let root = cv::moving_root(&self.data.bsp, &names, grp.e).and_then(|r| self.node_of_ent.get(&r).copied());
            let ri = self.rots.len();
            if let St::Rot { group, .. } = &mut self.nodes[node].st {
                *group = Some(ri);
            }
            let mut units = HashMap::new();
            for p in &grp.parts {
                units.entry(p.unit.clone()).or_insert((0, true));
                if !p.unit.is_empty() {
                    if let Some(&pn) = self.node_of_ent.get(&p.e) {
                        if self.nodes[pn].name == p.unit || format!("#{}", p.e) == p.unit {
                            if let St::Brush { unit } = &mut self.nodes[pn].st {
                                *unit = Some((ri, p.unit.clone()));
                            }
                        }
                    }
                }
            }
            // lançadores presos numa peça do grupo giram junto
            let mut launchers = vec![];
            for (&e, &li) in &self.built.launchers {
                if reaches(&self.data.bsp, &names, e, grp.e) {
                    let l = &g.world.launchers[li];
                    let tr = ecs.get::<Transform>(l.group).copied().unwrap_or_default();
                    launchers.push((li, unit_of(&self.data.bsp, &names, grp.e, e), l.pos, l.dir, tr));
                }
            }
            let last = vec![f32::NAN; grp.parts.len()];
            self.rots.push(RotRt { g: grp, node, root, k: 0.0, units, launchers, last });
        }
        // o resto: andam com a raiz
        for f in std::mem::take(&mut self.built.followers) {
            let Some(&root) = self.node_of_ent.get(&f.root) else { continue };
            for s in f.solids {
                let door = push_door(g, s);
                self.follows.push(Follow { solid: s, door, root, prev: Vec3::ZERO });
            }
        }
        // gatilhos presos (ex.: o que sobe o elevador): o volume anda com a raiz
        for n in 0..self.nodes.len() {
            let (Some(e), Some(v)) = (self.nodes[n].e, self.nodes[n].vol) else { continue };
            if self.ent(n).get("parentname").is_none_or(|p| p.is_empty()) {
                continue;
            }
            if let Some(root) = cv::moving_root(&self.data.bsp, &names, e).and_then(|r| self.node_of_ent.get(&r).copied()) {
                self.nodes[n].vol_root = Some(root);
                self.nodes[n].vol_base = Some(v);
            }
        }
    }
}

/// a cadeia de pais de `e` chega em `target`?
fn reaches(bsp: &super::bsp::Bsp, names: &HashMap<String, Vec<usize>>, e: usize, target: usize) -> bool {
    let mut cur = e;
    for _ in 0..16 {
        let pn = bsp.entities[cur].get_or("parentname", "").to_lowercase();
        if pn.is_empty() {
            return false;
        }
        let Some(&p) = names.get(&pn).and_then(|v| v.first()) else { return false };
        if p == target {
            return true;
        }
        cur = p;
    }
    false
}

/// a peça presa direto na porta giratória `g` (as dela vão junto); a própria porta é ''
fn unit_of(bsp: &super::bsp::Bsp, names: &HashMap<String, Vec<usize>>, g: usize, x: usize) -> String {
    let parent = |c: usize| names.get(&bsp.entities[c].get_or("parentname", "").to_lowercase()).and_then(|v| v.first().copied());
    let mut cur = Some(x);
    for _ in 0..16 {
        let Some(c) = cur else { break };
        if c == g {
            break;
        }
        let par = parent(c);
        if par == Some(g) {
            let n = bsp.entities[c].name();
            return if n.is_empty() { format!("#{c}") } else { n };
        }
        cur = par;
    }
    String::new()
}

/// tira um cubo do jogo (desintegrado)
pub fn remove_cube(g: &mut Game, k: usize) {
    if g.props.list[k].gone {
        return;
    }
    if g.held == Some(k) {
        g.release(false);
    }
    g.dissolve(k, Vec3::new(0.4, 1.0, 0.8), false);
    let Game { props, world, .. } = g;
    props.list[k].vanish(&mut world.phys);
}

impl Runtime {
    // ------------------------------------------------------------------ quadro
    pub fn update(&mut self, g: &mut Game, ecs: &mut Ecs, dt: f32) {
        self.time += dt;
        let mut guard = 0;
        while self.queue.first().is_some_and(|e| e.t <= self.time) && guard < 2000 {
            guard += 1;
            let ev = self.queue.remove(0);
            self.dispatch(g, ecs, ev);
        }
        self.drive_movers(g, ecs, dt);
        self.drive_trains(g, ecs, dt);
        self.drive_follows(g, ecs);
        self.drive_rots(g, ecs, dt);
        for n in 0..self.nodes.len() {
            if !self.nodes[n].dead {
                self.tick(g, ecs, n, dt);
            }
        }
        self.update_rockets(g, ecs, dt);
        // volumes onde o original não deixa abrir portal
        g.portals.no_portal = self
            .no_portal
            .iter()
            .filter(|&&n| matches!(self.nodes[n].st, St::NoPortal { active: true }) && !self.nodes[n].dead)
            .filter_map(|&n| self.nodes[n].vol.map(|(a, b)| (a - Vec3::splat(0.3), b + Vec3::splat(0.3))))
            .collect();
    }

    fn drive_movers(&mut self, g: &mut Game, ecs: &mut Ecs, dt: f32) {
        for i in 0..self.movers.len() {
            let carry = self.movers[i].carry.map(|c| self.total_offset(c)).unwrap_or(Vec3::ZERO);
            let m = &mut self.movers[i];
            let before = m.offset + carry;
            let d = m.target - m.open;
            m.open += d.signum() * d.abs().min(dt * m.speed);
            if (m.target - m.open).abs() < 1e-6 {
                m.open = m.target;
            }
            m.offset = m.path * m.open;
            let at = m.offset + carry;
            let (s, door) = (m.solid, m.door);
            let prev = g.world.doors[door].offset;
            if at != prev || g.world.solids[s].base0.is_none() {
                g.world.offset_solid(ecs, s, at);
            }
            g.world.doors[door].delta = at - before;
            g.world.doors[door].offset = at;
        }
    }

    fn drive_follows(&mut self, g: &mut Game, ecs: &mut Ecs) {
        for i in 0..self.follows.len() {
            let off = self.total_offset(self.follows[i].root);
            let f = &mut self.follows[i];
            let delta = off - f.prev;
            if delta != Vec3::ZERO || g.world.solids[f.solid].base0.is_none() {
                g.world.offset_solid(ecs, f.solid, off);
            }
            f.prev = off;
            g.world.doors[f.door].delta = delta;
            g.world.doors[f.door].offset = off;
        }
        // gatilhos presos andam com a raiz
        for n in 0..self.nodes.len() {
            if let (Some(r), Some((a, b))) = (self.nodes[n].vol_root, self.nodes[n].vol_base) {
                let off = self.total_offset(r);
                self.nodes[n].vol = Some((a + off, b + off));
            }
        }
    }

    fn drive_trains(&mut self, g: &mut Game, ecs: &mut Ecs, dt: f32) {
        for id in 0..self.nodes.len() {
            if self.nodes[id].dead || !matches!(self.nodes[id].st, St::Train(_)) {
                continue;
            }
            let St::Train(t) = &mut self.nodes[id].st else { continue };
            if t.dir == 0.0 {
                if let Some(w) = t.shuttle_wait.as_mut() {
                    *w -= dt;
                    if *w <= 0.0 {
                        t.dir = t.shuttle_dir;
                        t.speed = t.speed_max;
                        t.shuttle_wait = None;
                    }
                }
            }
            if t.dir != 0.0 {
                t.last_dir = t.dir;
            }
            let (dir, node, next, speed, height, origin, offset) = (t.dir, t.node, t.next, t.speed, t.height, t.origin, t.offset);
            if dir == 0.0 || node.is_none() {
                self.train_place(g, ecs, id, Vec3::ZERO);
                continue;
            }
            let goal = if dir > 0.0 { next } else { self.next_track(node.unwrap(), -1) };
            let shuttle_on = |rt: &Runtime| match &rt.nodes[id].st {
                St::Train(t) => t.shuttle_trig.is_some_and(|s| rt.nodes[s].enabled),
                _ => false,
            };
            let Some(goal) = goal else {
                let on = shuttle_on(self);
                if let St::Train(t) = &mut self.nodes[id].st {
                    if on {
                        t.shuttle_wait = Some(2.0);
                        t.shuttle_dir = -t.dir;
                    }
                    t.dir = 0.0;
                }
                self.fire(id, "onnextpoint", None, None);
                self.train_place(g, ecs, id, Vec3::ZERO);
                continue;
            };
            let target = self.track_pos(goal) + Vec3::new(0.0, height, 0.0) - origin;
            let to = target - offset;
            let step = speed.max(0.05) * dt;
            if to.length() <= step {
                let nn = self.next_track(goal, 1);
                let prev_of_goal = self.next_track(goal, -1);
                let sp = self.ent(goal).num("speed", 0.0);
                let stop_flag = self.ent(goal).flags() & 16 != 0;
                if let St::Train(t) = &mut self.nodes[id].st {
                    t.offset = target;
                    t.node = Some(goal);
                    t.next = nn;
                    if sp > 0.0 {
                        t.speed = sp * S;
                    }
                }
                self.train_place(g, ecs, id, to);
                self.fire(goal, "onpass", Some(id), None);
                let ahead = if dir > 0.0 { nn } else { prev_of_goal };
                if stop_flag || ahead.is_none() {
                    let on = shuttle_on(self);
                    if let St::Train(t) = &mut self.nodes[id].st {
                        let was = t.dir;
                        t.dir = 0.0;
                        if on {
                            t.shuttle_wait = Some(2.0);
                            t.shuttle_dir = -was;
                        }
                    }
                    self.fire(id, "onnextpoint", None, None);
                }
            } else {
                let mv = to.normalize() * step;
                if let St::Train(t) = &mut self.nodes[id].st {
                    t.offset += mv;
                }
                self.train_place(g, ecs, id, mv);
            }
        }
        // carrinhos da esteira: as peças presas seguem o carrinho
        for pool in self.pools.values_mut() {
            for c in pool.iter_mut() {
                let Some(n) = c.node else { continue };
                if self.nodes[n].dead {
                    continue;
                }
                let St::Train(t) = &self.nodes[n].st else { continue };
                let off = t.offset;
                let delta = off - c.prev;
                c.prev = off;
                for &sd in &c.copy.children {
                    g.world.offset_solid(ecs, sd, off);
                }
                g.world.doors[c.door].delta = delta;
            }
        }
    }

    fn turn_of(r: &RotRt, unit: &str) -> f32 {
        let (count, attached) = r.units.get(unit).copied().unwrap_or((0, true));
        count as f32 + if attached { r.k } else { 0.0 }
    }

    fn drive_rots(&mut self, g: &mut Game, ecs: &mut Ecs, dt: f32) {
        for ri in 0..self.rots.len() {
            let off = self.rots[ri].root.map(|r| self.total_offset(r)).unwrap_or(Vec3::ZERO);
            let node = self.rots[ri].node;
            let (is_open, speed) = match &self.nodes[node].st {
                St::Rot { is_open, speed, .. } => (*is_open, *speed),
                _ => (false, None),
            };
            let ent_speed = self.ent(node).num("speed", 100.0);
            let r = &mut self.rots[ri];
            let rate = speed.unwrap_or(ent_speed).max(1.0) / r.g.deg.abs().max(1.0);
            let target = if is_open { 1.0 } else { 0.0 };
            r.k += (target - r.k).signum() * (target - r.k).abs().min(rate * dt);
            let rad = r.g.deg.to_radians();
            let hinge = r.g.hinge;
            for pi in 0..r.g.parts.len() {
                let x = Self::turn_of(r, &r.g.parts[pi].unit.clone());
                let p = &r.g.parts[pi];
                // portal num pedaço que vai girar some (como no original)
                if !r.last[pi].is_nan() && r.last[pi] != x {
                    for w in [BLUE, ORANGE] {
                        let pp = &g.portals.list[w];
                        if pp.placed && pp.solid.is_some_and(|s| p.closed.contains(&s) || p.states.iter().any(|st| st.contains(&s))) {
                            g.portals.list[w].remove();
                        }
                    }
                }
                r.last[pi] = x;
                let q = Quat::from_axis_angle(r.g.axis, x * rad);
                let turns = r.g.turns;
                let st = ((x.round() as i32 % turns) + turns) % turns;
                for &sd in &p.closed {
                    g.world.offset_solid(ecs, sd, off);
                    if let Some(e) = g.world.solids[sd].entity {
                        if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                            tr.rotation = q;
                            tr.translation = hinge - q * hinge + off;
                        }
                    }
                    g.world.set_solid_collide(sd, st == 0);
                }
                for (k, list) in p.states.iter().enumerate() {
                    for &sd in list {
                        g.world.offset_solid(ecs, sd, off);
                        if let Some(e) = g.world.solids[sd].entity {
                            if let Ok(mut em) = ecs.get_entity_mut(e) {
                                em.insert(Visibility::Hidden);
                            }
                        }
                        g.world.set_solid_collide(sd, st == k as i32);
                    }
                }
            }
            for (li, unit, pos, dir, tr) in r.launchers.clone() {
                let q = Quat::from_axis_angle(r.g.axis, Self::turn_of(r, &unit) * rad);
                let about = |p: Vec3| q * (p - hinge) + hinge + off;
                g.world.launchers[li].pos = about(pos);
                g.world.launchers[li].dir = q * dir;
                let e = g.world.launchers[li].group;
                if let Some(mut t) = ecs.get_mut::<Transform>(e) {
                    t.translation = about(tr.translation);
                    t.rotation = q * tr.rotation;
                }
            }
        }
    }

    // ------------------------------------------------------------------ cada nó
    fn tick(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, dt: f32) {
        // cubo falante (núcleos)
        if let St::Phys { talking: true, talk_t, k } = self.nodes[n].st {
            let mut talk_t = talk_t - dt;
            let mut k = k;
            if talk_t <= 0.0 {
                let ck = self.nodes[n].cube.unwrap();
                let info = self.cube_info.get(&ck).cloned().unwrap_or_default();
                let lines = super::dialogue::data().map(|d| d.sound_names(CORE_VOICES[info.core.unwrap_or(0).clamp(0, 2) as usize])).unwrap_or_default();
                if !lines.is_empty() && !g.props.list[ck].gone {
                    let name = lines[k % lines.len()].clone();
                    k += 1;
                    self.sound_id += 1;
                    g.camp_audio.push(Req::Sound { id: self.sound_id, name, vol: 1.0 });
                }
                talk_t = 2.6 + info.core_delay;
            }
            self.nodes[n].st = St::Phys { talking: true, talk_t, k };
            return;
        }
        if !self.nodes[n].ticks {
            return;
        }
        let cls = self.nodes[n].cls.clone();
        let enabled = self.nodes[n].enabled;
        let mover = self.nodes[n].movers.first().copied();
        match &mut self.nodes[n].st {
            St::Timer { refire, random, lo, hi, left } => {
                if !enabled {
                    return;
                }
                *left -= dt;
                if *left <= 0.0 {
                    *left = if *random { *lo + rand::random::<f32>() * (*hi - *lo) } else { refire.max(0.01) };
                    self.fire(n, "ontimer", None, None);
                }
                return;
            }
            St::Door { state, wait_close, close_in } => {
                let Some(m) = mover else { return };
                let (open, target) = (self.movers[m].open, self.movers[m].target);
                let mut fire = None;
                if open >= 1.0 && *state != 1 && target == 1.0 {
                    *state = 1;
                    fire = Some("onfullyopen");
                    if *wait_close >= 0.0 {
                        *close_in = Some(*wait_close);
                    }
                }
                if open <= 0.0 && *state != 0 && target == 0.0 {
                    *state = 0;
                    fire = Some("onfullyclosed");
                }
                let mut close = false;
                if let Some(c) = close_in.as_mut() {
                    *c -= dt;
                    if *c <= 0.0 {
                        *close_in = None;
                        close = true;
                    }
                }
                if let Some(f) = fire {
                    self.fire(n, f, None, None);
                }
                if close {
                    self.door_set(n, 0.0);
                }
                return;
            }
            St::Linear { state } => {
                let Some(m) = mover else { return };
                let open = self.movers[m].open;
                let s: i8 = if open >= 1.0 { 1 } else if open <= 0.0 { 0 } else { -1 };
                let fire = s != *state && s >= 0 && *state != -2;
                *state = s;
                if fire {
                    self.fire(n, if s == 1 { "onfullyopen" } else { "onfullyclosed" }, None, None);
                }
                return;
            }
            St::Dyn(_) => {
                self.tick_dyn(g, ecs, n, dt);
                return;
            }
            St::Detector { had } => {
                let had0 = *had;
                if !self.nodes[n].enabled {
                    if let St::Detector { had } = &mut self.nodes[n].st {
                        *had = [false; 2];
                    }
                    return;
                }
                let (min, max) = self.nodes[n].vol.unwrap();
                let inside = |w: usize| {
                    let p = &g.portals.list[w];
                    p.placed && (0..3).all(|a| {
                        let r = p.right[a].abs() * PORTAL_A + p.up[a].abs() * PORTAL_B + 0.6;
                        p.center[a] + r > min[a] && p.center[a] - r < max[a]
                    })
                };
                let now = [inside(BLUE), inside(ORANGE)];
                for w in [BLUE, ORANGE] {
                    if now[w] && !had0[w] {
                        self.fire(n, if w == BLUE { "onstarttouchportal1" } else { "onstarttouchportal2" }, None, None);
                        if g.portals.is_linked(w) {
                            self.fire(n, "onstarttouchlinkedportal", None, None);
                        }
                    }
                }
                if now[0] && now[1] && !(had0[0] && had0[1]) {
                    self.fire(n, "onstarttouchbothlinkedportals", None, None);
                }
                for w in [BLUE, ORANGE] {
                    if had0[w] && !now[w] {
                        self.fire(n, if w == BLUE { "onendtouchportal1" } else { "onendtouchportal2" }, None, None);
                    }
                }
                if let St::Detector { had } = &mut self.nodes[n].st {
                    *had = now;
                }
                return;
            }
            _ => {}
        }
        if cls == "npc_rocket_turret" {
            self.tick_rocket_turret(g, ecs, n, dt);
            return;
        }
        if self.nodes[n].vol.is_none() {
            return;
        }
        // gatilhos
        let entered = self.tick_trigger(g, n);
        match &self.nodes[n].st {
            St::Hurt { lethal: true } => {
                for &a in &entered {
                    if let Some(k) = self.nodes[a].cube {
                        remove_cube(g, k);
                    }
                }
                if self.nodes[n].enabled && self.nodes[n].touching.contains(&PLAYER) {
                    g.die("trigger_hurt");
                }
            }
            St::Change => {
                if entered.contains(&PLAYER) {
                    let map = self.ent(n).get_or("map", "").to_string();
                    complete_map(g, &map);
                }
            }
            St::Teleport => {
                if entered.contains(&PLAYER) {
                    let t = self.ent(n).get_or("target", "").to_string();
                    if let Some(&dest) = self.find_static(&t).first() {
                        let e = self.ent(dest);
                        let (p, yaw) = (vec_kv(e, "origin"), yaw_from_source(parse_vec(e.get("angles"))[1]));
                        let Game { player, world, .. } = g;
                        player.spawn(world, p.x, p.y, p.z, yaw);
                    }
                }
            }
            St::Push { dir, speed } => {
                if self.nodes[n].enabled && self.nodes[n].touching.contains(&PLAYER) {
                    *g.player.push.get_or_insert(Vec3::ZERO) += *dir * *speed;
                }
            }
            _ => {}
        }
    }

    fn tick_dyn(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, dt: f32) {
        let root_off = match &self.nodes[n].st {
            St::Dyn(d) => d.root.and_then(|r| self.node_of_ent.get(&r).copied()).map(|r| self.own_offset(r)),
            _ => None,
        };
        let parent_off = match &self.nodes[n].st {
            St::Dyn(d) => d.parent.map(|p| self.own_offset(p)),
            _ => None,
        };
        let t = self.time;
        let St::Dyn(d) = &mut self.nodes[n].st else { return };
        if let Some(m) = &d.machine {
            visuals::animate_machine(ecs, m, t, dt);
        }
        if let Some(s) = d.switch.as_mut() {
            let p = d.pressed;
            visuals::animate_switch(ecs, s, p, dt);
            if let Some(mut tr) = ecs.get_mut::<Transform>(s.root) {
                tr.translation = d.at + root_off.unwrap_or(Vec3::ZERO);
            }
        }
        for e in [d.shell, d.core].into_iter().flatten() {
            if let Some(off) = parent_off {
                if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                    tr.translation = d.base + off;
                }
            }
        }
        let _ = g;
    }

    fn tick_rocket_turret(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, dt: f32) {
        let off = self.parent_offset(n);
        let Some(ti) = self.rocket_turrets.iter().position(|t| t.0 == n) else { return };
        let (_, e, base, cool, on) = self.rocket_turrets[ti];
        let at = base + off;
        let eye = g.player.eye();
        let mut tr = Transform::from_translation(at);
        let to = eye - at;
        if to.length_squared() > 1e-4 {
            tr.look_to(to, Vec3::Y);
        }
        if let Ok(mut em) = ecs.get_entity_mut(e) {
            em.insert(tr);
        }
        let mut cool = cool - dt;
        if on && cool <= 0.0 {
            let dir = to.normalize_or_zero();
            let clear = g.world.raycast(at + dir * 0.8, dir, to.length() - 0.9).is_none();
            if clear && to.length() < 40.0 {
                let (m, _, _) = crate::glb::spawn_model_full(ecs, "rocket");
                let p = at + dir * 0.8;
                ecs.entity_mut(m).insert((Transform::from_translation(p).looking_to(dir, Vec3::Y), ChildOf(g.world.root())));
                self.rockets.push(Rocket { e: m, pos: p, dir, life: 12.0 });
                self.sound_id += 1;
                g.camp_audio.push(Req::Sound { id: self.sound_id, name: "Portal.rocket_fire".into(), vol: 1.0 });
                self.fire(n, "onfoundtarget", Some(PLAYER), None);
                cool = 3.0;
            } else {
                cool = 0.3;
            }
        }
        self.rocket_turrets[ti].3 = cool;
    }

    /// foguetes, explosões e cacos de vidro
    fn update_rockets(&mut self, g: &mut Game, ecs: &mut Ecs, dt: f32) {
        let mut i = 0;
        while i < self.rockets.len() {
            let prev = self.rockets[i].pos;
            let r = &mut self.rockets[i];
            r.pos += r.dir * 9.0 * dt;
            r.life -= dt;
            if let Some(p) = g.portals.crossing(prev, r.pos, crate::portals::Who::Ball) {
                let q = g.portals.list[p].partner;
                let m = g.portals.transform(p, q);
                r.pos = m.transform_point3(r.pos);
                r.dir = m.transform_vector3(r.dir).normalize();
            }
            let (pos, dir) = (r.pos, r.dir);
            let mut boom = r.life <= 0.0;
            for h in self.hit_targets.clone() {
                if self.nodes[h.0].dead {
                    continue;
                }
                let ab = h.2 - h.1;
                let t = ((pos - h.1).dot(ab) / ab.length_squared()).clamp(0.0, 1.0);
                if pos.distance(h.1 + ab * t) < h.3 {
                    self.fire(h.0, "ontakedamage", Some(PLAYER), None);
                    boom = true;
                }
            }
            if !boom && pos.distance(g.player.pos) < 0.8 {
                g.health -= 45.0;
                g.hurt_t = 0.0;
                g.hurt_flash = 1.0;
                if g.health <= 0.0 {
                    g.die("foguete");
                }
                boom = true;
            }
            let step = pos - prev;
            if !boom && step.length_squared() > 0.0 {
                if let Some(h) = g.world.raycast(prev, step.normalize(), step.length()) {
                    boom = true;
                    if let Some(b) = g.world.solids[h.solid].breakable {
                        self.break_glass(g, ecs, b, h.point);
                    }
                }
            }
            if boom {
                let (e, m) = visuals::explosion(ecs, g.world.root(), pos);
                self.booms.push((e, m, 0.0));
                self.sound_id += 1;
                g.camp_audio.push(Req::Sound { id: self.sound_id, name: "Portal.rocket_explode".into(), vol: 1.0 });
                if let Ok(em) = ecs.get_entity_mut(self.rockets[i].e) {
                    em.despawn();
                }
                self.rockets.remove(i);
            } else {
                if let Some(mut tr) = ecs.get_mut::<Transform>(self.rockets[i].e) {
                    *tr = Transform::from_translation(pos).looking_to(dir, Vec3::Y);
                }
                i += 1;
            }
        }
        self.booms.retain_mut(|(e, m, t)| {
            *t += dt;
            if let Some(mut tr) = ecs.get_mut::<Transform>(*e) {
                tr.scale = Vec3::splat(1.0 + *t * 9.0);
            }
            if let Some(mut mm) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(m) {
                mm.base_color.set_alpha((1.0 - *t * 2.5).max(0.0));
            }
            if *t > 0.4 {
                if let Ok(em) = ecs.get_entity_mut(*e) {
                    em.despawn();
                }
                return false;
            }
            true
        });
        self.shards.retain_mut(|(e, v, w, t)| {
            *t += dt;
            v.y -= 9.8 * dt;
            if let Some(mut tr) = ecs.get_mut::<Transform>(*e) {
                tr.translation += *v * dt;
                tr.rotate_x(w.x * dt);
                tr.rotate_y(w.y * dt);
            }
            if *t > 2.2 {
                if let Ok(em) = ecs.get_entity_mut(*e) {
                    em.despawn();
                }
                return false;
            }
            true
        });
    }

    /// vidro quebrável: some em cacos e avisa o mapa
    fn break_glass(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, at: Vec3) {
        if let St::Breakable { broken: true } = self.nodes[n].st {
            return;
        }
        self.nodes[n].st = St::Breakable { broken: true };
        let solids = self.nodes[n].e.and_then(|e| self.brush_of.get(&e)).map(|&bi| self.built.brush_ents[bi].solids.clone()).unwrap_or_default();
        for &s in &solids {
            g.world.set_solid_enabled(ecs, s, false);
        }
        self.fire(n, "onbreak", Some(PLAYER), None);
        self.sound_id += 1;
        g.camp_audio.push(Req::Sound { id: self.sound_id, name: "Glass.Break".into(), vol: 1.0 });
        let (c, size) = solids.first().map(|&s| ((g.world.solids[s].min + g.world.solids[s].max) * 0.5, g.world.solids[s].max - g.world.solids[s].min)).unwrap_or((at, Vec3::ONE));
        let mat = crate::world::std_mat(ecs, StandardMaterial { base_color: crate::mats::hex(0xcfe9f2).with_alpha(0.7), alpha_mode: AlphaMode::Blend, perceptual_roughness: 0.1, metallic: 0.2, double_sided: true, cull_mode: None, ..default() });
        let r = || rand::random::<f32>();
        for _ in 0..46 {
            let p = c + Vec3::new((r() - 0.5) * size.x, (r() - 0.5) * size.y, (r() - 0.5) * size.z);
            let e = visuals::shard(ecs, g.world.root(), p, Vec3::new(r() * 6.0, r() * 6.0, r() * 6.0), 0.08 + r() * 0.14, 0.08 + r() * 0.18, mat.clone());
            let mut v = (p - at).normalize_or_zero() * (1.5 + r() * 3.0);
            v.y += r() * 2.0;
            self.shards.push((e, v, Vec3::new(r() - 0.5, r() - 0.5, r() - 0.5) * 12.0, 0.0));
        }
    }
}

/// troca de mapa pedida pelo mapa: a próxima câmara (o elevador de chegada também tem uma, de volta)
pub fn complete_map(g: &mut Game, map: &str) {
    if map == "final" {
        g.done_title = Some("Campanha original concluída".into());
        g.complete(false);
        return;
    }
    let to = g.levels.iter().position(|l| l.campaign.as_deref() == Some(&map.to_lowercase()));
    if let (Some(to), Some(cur)) = (to, g.level) {
        if to <= cur {
            return;
        }
    }
    g.complete(false);
}

impl Runtime {
    // ------------------------------------------------------------------ ganchos do jogo
    /// E apertado: botões de apertar (func_button, func_rot_button, porta "abre com uso")
    pub fn use_(&mut self, g: &mut Game, ecs: &mut Ecs, origin: Vec3, dir: Vec3) -> bool {
        let mut best: Option<(usize, f32)> = None;
        for n in 0..self.nodes.len() {
            if self.nodes[n].dead || !self.nodes[n].useable {
                continue;
            }
            let Some(e) = self.nodes[n].e else { continue };
            let b = match self.brush_of.get(&e).map(|&bi| &self.built.brush_ents[bi]) {
                Some(be) if !be.solids.is_empty() => {
                    let mut mn = g.world.solids[be.solids[0]].min;
                    let mut mx = g.world.solids[be.solids[0]].max;
                    for &s in &be.solids {
                        mn = mn.min(g.world.solids[s].min);
                        mx = mx.max(g.world.solids[s].max);
                    }
                    Some((mn, mx))
                }
                Some(be) => be.bounds,
                None => None,
            };
            let Some((mn, mx)) = b else { continue };
            if let Some(t) = slab(origin, dir, mn, mx, 0.15, 2.6) {
                if best.is_none_or(|b| t < b.1) {
                    best = Some((n, t));
                }
            }
        }
        let Some((n, _)) = best else { return false };
        if !self.nodes[n].enabled {
            return false;
        }
        match self.nodes[n].cls.as_str() {
            "func_door" => {
                let open = self.nodes[n].movers.first().is_some_and(|&m| self.movers[m].target != 0.0);
                self.door_set(n, if open { 0.0 } else { 1.0 });
            }
            "func_door_rotating" => {
                if !matches!(self.nodes[n].st, St::Rot { is_open: true, .. }) {
                    let ev = Ev { t: self.time, seq: 0, target: String::new(), input: "Open".into(), param: String::new(), act: Some(PLAYER), caller: None };
                    self.input(g, ecs, n, "open", "", &ev);
                }
            }
            _ => {
                self.fire(n, "onpressed", Some(PLAYER), None);
                self.fire(n, "onin", Some(PLAYER), None);
            }
        }
        true
    }

    /// o jogador pegou a arma de um pedestal: as saídas do mapa
    pub fn pickup_gun(&mut self, pedestal: usize) {
        let Some(&(_, e)) = self.built.pedestals.iter().find(|p| p.0 == pedestal) else { return };
        let Some(&n) = self.node_of_ent.get(&e) else { return };
        if let St::Gun { picked, .. } = &mut self.nodes[n].st {
            *picked = true;
        }
        self.fire(n, "onplayerpickup", Some(PLAYER), None);
    }

    /// o jogador pegou um cubo
    pub fn on_pickup(&mut self, g: &mut Game, k: usize) {
        if !self.cube_info.contains_key(&k) {
            return;
        }
        let n = self.cube_node(k);
        if self.cube_info[&k].grab_unlock {
            self.unfreeze(g, k);
        }
        self.fire(n, "onplayerpickup", Some(PLAYER), None);
    }

    fn unfreeze(&mut self, g: &mut Game, k: usize) {
        let n = self.cube_node(k);
        if g.props.list[k].pinned {
            set_frozen(g, k, false);
            self.fire(n, "onmotionenabled", None, None);
        }
    }

    /// os cubos e núcleos do começo do mapa
    pub fn spawn_initial(&mut self, g: &mut Game, ecs: &mut Ecs) {
        for (p, o) in self.built.cubes.clone() {
            self.spawn_cube(g, ecs, p, o, vec![]);
        }
    }

    fn spawn_cube(&mut self, g: &mut Game, ecs: &mut Ecs, p: Vec3, o: CubeOpts, outputs: Vec<Output>) -> usize {
        let k = {
            let Game { props, world, .. } = g;
            match o.core {
                Some(c) => props.add_model(ecs, world, p.x, p.y, p.z, &format!("core_{}", c.clamp(0, 2))),
                None => props.add_cube(ecs, world, p.x, p.y, p.z, o.special, false, 0.0),
            }
        };
        if o.frozen {
            set_frozen(g, k, true);
        }
        self.cube_info.insert(k, o);
        let n = self.cube_node(k);
        self.nodes[n].fired = vec![0; outputs.len()];
        self.nodes[n].outputs = outputs;
        k
    }

    fn spawn_template(&mut self, g: &mut Game, ecs: &mut Ecs, tpl: usize, at: Option<Vec3>) {
        let origin = vec_kv(self.ent(tpl), "origin");
        let St::Tpl { templates } = &self.nodes[tpl].st else { return };
        let mut seen = std::collections::HashSet::new();
        let mut todo = vec![];
        for name in templates {
            for e in &self.data.bsp.entities {
                if &e.name() != name || !(is_cube(e) || e.classname == "prop_glados_core") {
                    continue;
                }
                if !seen.insert(format!("{name}|{}", e.get_or("origin", ""))) {
                    continue;
                }
                let mut p = vec_kv(e, "origin");
                if let Some(a) = at {
                    p = p - origin + a;
                }
                todo.push((Vec3::new(p.x, p.y - 0.3, p.z), cube_opts(e), e.outputs.clone()));
            }
        }
        for (p, o, outs) in todo {
            self.spawn_cube(g, ecs, p, o, outs);
        }
    }

    /// uma cópia de carrinho do molde: cria o nó dela na primeira vez e a põe para andar
    fn spawn_train(&mut self, g: &mut Game, ecs: &mut Ecs, pool: &str) {
        let Some(list) = self.pools.get(pool) else { return };
        let Some(ci) = list.iter().position(|c| c.node.is_none_or(|n| self.nodes[n].dead)) else { return };
        let c = &self.pools[pool][ci];
        let (train_e, train_solids, children) = (c.copy.train, c.copy.train_solids.clone(), c.copy.children.clone());
        let n = match c.node {
            Some(n) => n,
            None => {
                let e = self.data.bsp.entities[train_e].clone();
                let mut node = Node::new(Some(train_e), "func_tracktrain", &e.name(), e.outputs.clone());
                node.ticks = false;
                self.nodes.push(node);
                let n = self.nodes.len() - 1;
                if !e.name().is_empty() {
                    self.by_name.entry(e.name()).or_default().push(n);
                }
                self.make_train(g, n, &e, train_solids.clone());
                self.pools.get_mut(pool).unwrap()[ci].node = Some(n);
                n
            }
        };
        self.nodes[n].dead = false;
        for &sd in train_solids.iter().chain(&children) {
            g.world.set_solid_enabled(ecs, sd, true);
        }
        self.train_init(g, ecs, n);
        if let St::Train(t) = &mut self.nodes[n].st {
            t.speed = t.speed_max;
            t.dir = 1.0;
        }
    }

    fn portal_open(&mut self, g: &mut Game, n: usize) {
        let St::Portal { which, center, normal, up } = self.nodes[n].st else { return };
        // o portal do original tem meia altura de 56 unidades (1,4 m); o daqui é menor: em
        // parede, mantém a borda de baixo onde era (rente ao chão)
        let mut c = center;
        if normal.y.abs() < 0.5 {
            c -= up * (56.0 * S - PORTAL_B);
        }
        if g.portals.place_fixed(&g.world, which, c, normal, up) {
            g.portals.list[which].owner = Some(format!("io{n}"));
        }
    }

    fn portal_close(&mut self, g: &mut Game, n: usize) {
        let St::Portal { which, .. } = self.nodes[n].st else { return };
        let p = &mut g.portals.list[which];
        // só apaga se o portal da cor ainda for este
        if p.fixed && p.owner.as_ref().is_none_or(|o| *o == format!("io{n}")) {
            p.remove();
            p.fixed = false;
        }
    }

    fn door_set(&mut self, n: usize, t: f32) {
        let Some(&m0) = self.nodes[n].movers.first() else { return };
        if self.movers[m0].target == t {
            return;
        }
        for &m in &self.nodes[n].movers {
            self.movers[m].target = t;
        }
        self.fire(n, if t != 0.0 { "onopen" } else { "onclose" }, None, None);
        if t == 0.0 {
            if let St::Door { close_in, .. } = &mut self.nodes[n].st {
                *close_in = None;
            }
        }
    }

    // ------------------------------------------------------------------ entradas por classe
    fn input(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, input: &str, param: &str, ev: &Ev) -> bool {
        let cls = self.nodes[n].cls.clone();
        let e = self.ent(n).clone();
        let pf = || parse_f(param).unwrap_or(0.0);
        match cls.as_str() {
            "logic_relay" => match input {
                "trigger" => {
                    if self.nodes[n].enabled {
                        self.fire(n, "ontrigger", ev.act, None);
                        if e.flags() & 1 != 0 {
                            self.nodes[n].dead = true;
                        }
                    }
                }
                "enable" | "enablerefire" => self.nodes[n].enabled = true,
                "disable" => self.nodes[n].enabled = false,
                "toggle" => self.nodes[n].enabled = !self.nodes[n].enabled,
                "cancelpending" => self.unschedule(n, None),
                _ => return false,
            },
            "logic_timer" => {
                let St::Timer { refire, random, lo, hi, left } = &mut self.nodes[n].st else { return false };
                let reset = |refire: f32, random: bool, lo: f32, hi: f32| if random { lo + rand::random::<f32>() * (hi - lo) } else { refire.max(0.01) };
                match input {
                    "enable" => {
                        *left = reset(*refire, *random, *lo, *hi);
                        self.nodes[n].enabled = true;
                    }
                    "disable" => self.nodes[n].enabled = false,
                    "toggle" => self.nodes[n].enabled = !self.nodes[n].enabled,
                    "resettimer" => *left = reset(*refire, *random, *lo, *hi),
                    "firetimer" => {
                        *left = reset(*refire, *random, *lo, *hi);
                        self.fire(n, "ontimer", None, None);
                    }
                    "refiretime" => {
                        if pf() != 0.0 {
                            *refire = pf();
                        }
                    }
                    "lowerrandombound" => *lo = pf(),
                    "upperrandombound" => *hi = pf(),
                    _ => return false,
                }
            }
            "math_counter" => {
                if !self.nodes[n].enabled && input != "enable" {
                    return true;
                }
                let St::Counter { value, min, max } = self.nodes[n].st else { return false };
                let v = pf();
                let new = match input {
                    "add" => Some((value + v, true)),
                    "subtract" => Some((value - v, true)),
                    "multiply" => Some((value * v, true)),
                    "divide" => Some((if v != 0.0 { value / v } else { value }, true)),
                    "setvalue" => Some((v, true)),
                    "setvaluenofire" => Some((v, false)),
                    "getvalue" => {
                        self.fire(n, "ongetvalue", None, Some(fmt_num(value)));
                        None
                    }
                    "enable" => {
                        self.nodes[n].enabled = true;
                        None
                    }
                    "disable" => {
                        self.nodes[n].enabled = false;
                        None
                    }
                    _ => return false,
                };
                if let Some((mut x, fire)) = new {
                    let has_max = max != 0.0 || min != 0.0;
                    if has_max {
                        x = x.clamp(min, max);
                    }
                    self.nodes[n].st = St::Counter { value: x, min, max };
                    if fire {
                        self.fire(n, "outvalue", None, Some(fmt_num(x)));
                        if has_max && x >= max {
                            self.fire(n, "onhitmax", None, None);
                        }
                        if has_max && x <= min {
                            self.fire(n, "onhitmin", None, None);
                        }
                    }
                }
            }
            "logic_compare" => {
                let St::Compare { value, cmp } = &mut self.nodes[n].st else { return false };
                let mut do_cmp = false;
                match input {
                    "setvalue" => *value = pf(),
                    "setvaluecompare" => {
                        *value = pf();
                        do_cmp = true;
                    }
                    "setcomparevalue" => *cmp = pf(),
                    "compare" => do_cmp = true,
                    _ => return false,
                }
                if do_cmp {
                    let (v, c) = (*value, *cmp);
                    let o = if v == c { "onequalto" } else if v < c { "onlessthan" } else { "ongreaterthan" };
                    self.fire(n, o, None, Some(fmt_num(v)));
                    if v != c {
                        self.fire(n, "onnotequalto", None, Some(fmt_num(v)));
                    }
                }
            }
            "logic_case" => {
                let cases: Vec<(usize, String)> = (1..=16).filter_map(|i| e.get(&format!("case{i:02}")).map(|v| (i, v.to_string()))).collect();
                match input {
                    "invalue" => {
                        let hit = cases.iter().find(|(_, v)| v == param || (!param.is_empty() && parse_f(v).is_some() && parse_f(v) == parse_f(param)));
                        let out = hit.map(|h| format!("oncase{:02}", h.0)).unwrap_or("ondefault".into());
                        self.fire(n, &out, ev.act, None);
                    }
                    "pickrandom" | "pickrandomshuffle" => {
                        if !cases.is_empty() {
                            let h = &cases[rand::random_range(0..cases.len())];
                            self.fire(n, &format!("oncase{:02}", h.0), ev.act, None);
                        }
                    }
                    _ => return false,
                }
            }
            "func_door" => match input {
                "open" => self.door_set(n, 1.0),
                "close" => self.door_set(n, 0.0),
                "toggle" => {
                    let open = self.nodes[n].movers.first().is_some_and(|&m| self.movers[m].target != 0.0);
                    self.door_set(n, if open { 0.0 } else { 1.0 });
                }
                _ => return false,
            },
            "func_movelinear" | "func_water_analog" => {
                let t = match input {
                    "open" => 1.0,
                    "close" => 0.0,
                    "setposition" => pf().clamp(0.0, 1.0),
                    _ => return false,
                };
                for &m in &self.nodes[n].movers {
                    self.movers[m].target = t;
                }
            }
            "func_tracktrain" => {
                // no vai e volta sozinho, o gatilho de cima da plataforma não manda mais
                let St::Train(t) = &mut self.nodes[n].st else { return false };
                if t.shuttle_trig.is_some_and(|s| ev.caller == Some(s) && self.nodes[s].enabled) {
                    return true;
                }
                let St::Train(t) = &mut self.nodes[n].st else { return false };
                match input {
                    "startforward" | "resume" => {
                        t.dir = 1.0;
                        t.speed = t.speed_max;
                    }
                    "startbackward" => {
                        t.dir = -1.0;
                        t.speed = t.speed_max;
                    }
                    "stop" => t.dir = 0.0,
                    "toggle" => t.dir = if t.dir != 0.0 { 0.0 } else { 1.0 },
                    "setspeed" => {
                        t.speed = t.speed_max * pf().abs();
                        t.dir = if t.speed > 0.0 { if t.dir != 0.0 { t.dir } else { 1.0 } } else { 0.0 };
                    }
                    "setspeedreal" => {
                        t.speed = pf() * S;
                        t.dir = if t.speed > 0.0 { if t.dir != 0.0 { t.dir } else { 1.0 } } else { 0.0 };
                    }
                    "setspeeddir" => {
                        let v = pf();
                        t.speed = t.speed_max * v.abs();
                        t.dir = v.signum() * if v == 0.0 { 0.0 } else { 1.0 };
                    }
                    "teleporttopathtrack" => {
                        let tp = self.find_static(param).into_iter().find(|&x| self.nodes[x].cls == "path_track");
                        if let Some(tp) = tp {
                            let nx = self.next_track(tp, 1);
                            if let St::Train(t) = &mut self.nodes[n].st {
                                t.node = Some(tp);
                                t.next = nx;
                            }
                        }
                    }
                    _ => return false,
                }
            }
            "func_brush" | "func_wall_toggle" => {
                // peça presa numa porta giratória (catraca): solta, fica com o giro; presa, volta a girar
                if let St::Brush { unit: Some((ri, unit)) } = &self.nodes[n].st {
                    if input == "clearparent" || input == "setparent" {
                        let r = &mut self.rots[*ri];
                        let k = r.k.round() as i32;
                        let u = r.units.entry(unit.clone()).or_insert((0, true));
                        if input == "clearparent" && u.1 {
                            u.0 += k;
                            u.1 = false;
                        } else if input == "setparent" && !u.1 {
                            u.0 -= k;
                            u.1 = true;
                        }
                        return true;
                    }
                }
                let Some(&bi) = self.nodes[n].e.and_then(|e| self.brush_of.get(&e)) else { return true };
                let solids = self.built.brush_ents[bi].solids.clone();
                let on = match input {
                    "enable" => Some(true),
                    "disable" => Some(false),
                    "toggle" => solids.first().map(|&s| g.world.solids[s].disabled),
                    _ => None,
                };
                match on {
                    Some(on) => {
                        for s in solids {
                            g.world.set_solid_enabled(ecs, s, on);
                        }
                    }
                    None => return input == "setparent" || input == "clearparent",
                }
            }
            "trigger_portal_cleanser" => match input {
                "enable" => self.cleanser_on(g, ecs, n, true),
                "disable" => self.cleanser_on(g, ecs, n, false),
                "toggle" => {
                    let on = !self.nodes[n].enabled;
                    self.cleanser_on(g, ecs, n, on);
                }
                _ => return false,
            },
            "trigger_once" | "trigger_multiple" | "trigger_hurt" | "trigger_teleport" | "trigger_look" | "trigger_vphysics_motion" | "trigger_changelevel" | "trigger_push" => match input {
                "enable" => self.nodes[n].enabled = true,
                "disable" => self.nodes[n].enabled = false,
                "toggle" => self.nodes[n].enabled = !self.nodes[n].enabled,
                "changelevel" if cls == "trigger_changelevel" => complete_map(g, e.get_or("map", "")),
                _ => return false,
            },
            "prop_portal" => match input {
                "setactivatedstate" => {
                    if param.trim() == "1" {
                        self.portal_open(g, n)
                    } else {
                        self.portal_close(g, n)
                    }
                }
                "open" => self.portal_open(g, n),
                "fizzle" | "close" => self.portal_close(g, n),
                "newlocation" => {
                    let v: Vec<f32> = param.split_whitespace().map(|x| x.parse().unwrap_or(0.0)).collect();
                    let get = |i: usize| v.get(i).copied().unwrap_or(0.0);
                    let (normal, up) = angles_to_vectors(get(3), get(4), get(5));
                    if let St::Portal { center, normal: nn, up: uu, .. } = &mut self.nodes[n].st {
                        *center = to_v(get(0), get(1), get(2));
                        *nn = normal;
                        *uu = up;
                    }
                    self.portal_close(g, n);
                    self.portal_open(g, n);
                }
                _ => return false,
            },
            "point_template" => {
                if input != "forcespawn" {
                    return false;
                }
                self.spawn_template(g, ecs, n, None);
                self.fire(n, "onentityspawned", None, None);
            }
            "env_entity_maker" => {
                if input != "forcespawn" {
                    return false;
                }
                let tpl = self.find_static(e.get_or("entitytemplate", "")).into_iter().find(|&x| self.nodes[x].cls == "point_template");
                let Some(tpl) = tpl else { return true };
                let tname = self.nodes[tpl].name.clone();
                if self.pools.contains_key(&tname) {
                    self.spawn_train(g, ecs, &tname);
                } else {
                    self.spawn_template(g, ecs, tpl, Some(vec_kv(&e, "origin")));
                }
                self.fire(n, "onentityspawned", None, None);
            }
            "prop_physics" | "prop_physics_override" | "prop_glados_core" => {
                let Some(k) = self.nodes[n].cube else { return true };
                match input {
                    "dissolve" | "break" | "kill" => {
                        if input == "break" {
                            self.fire(n, "onbreak", None, None);
                        }
                        self.kill(g, ecs, n);
                    }
                    "enablemotion" | "wake" => self.unfreeze(g, k),
                    "disablemotion" => set_frozen(g, k, true),
                    "starttalking" => {
                        if let St::Phys { talking, talk_t, .. } = &mut self.nodes[n].st {
                            if !*talking {
                                *talking = true;
                                *talk_t = 0.0;
                            }
                        }
                    }
                    "stoptalking" => {
                        if let St::Phys { talking, .. } = &mut self.nodes[n].st {
                            *talking = false;
                        }
                    }
                    _ => return false,
                }
            }
            "point_servercommand" => {
                let p = param.to_lowercase();
                if input == "command" {
                    if let Some(i) = p.find("changelevel") {
                        if let Some(m) = param[i + 11..].split_whitespace().next() {
                            complete_map(g, m);
                        }
                    }
                }
            }
            "logic_choreographed_scene" => match input {
                "start" => {
                    self.fire(n, "onstart", ev.act, None);
                    let file = e.get_or("scenefile", "").to_string();
                    let busy = e.get("busyactor") == Some("1");
                    let ms = super::dialogue::data().and_then(|d| d.scene(&file).map(|s| s.0));
                    let dur = match ms {
                        Some(ms) => {
                            let start = if busy { self.time.max(self.voice_end) } else { self.time };
                            self.voice_end = start + ms as f32 / 1000.0;
                            g.camp_audio.push(Req::Scene { file, wait: busy });
                            start - self.time + ms as f32 / 1000.0
                        }
                        None => 3.0,
                    };
                    self.schedule(dur, "!self", "FireCompletion", "", None, Some(n));
                }
                "firecompletion" => self.fire(n, "oncompletion", None, None),
                "cancel" => {
                    self.unschedule(n, Some("FireCompletion"));
                    g.camp_audio.push(Req::StopVoice(Some(e.get_or("scenefile", "").to_string())));
                }
                _ => return false,
            },
            "ambient_generic" => {
                let sf = e.flags();
                let cur = match self.nodes[n].st {
                    St::Ambient { sound } => sound,
                    _ => None,
                };
                let stop = |rt: &mut Runtime, g: &mut Game, fade: f32| {
                    if let Some(id) = cur {
                        g.camp_audio.push(Req::StopSound { id, fade });
                    }
                    rt.nodes[n].st = St::Ambient { sound: None };
                };
                match input {
                    "playsound" | "togglesound" if input == "playsound" || cur.is_none() => {
                        // músicas e sons de uma vez; os em laço posicionados ficam de fora
                        if sf & 32 == 0 && sf & 1 == 0 {
                            return true;
                        }
                        let Some(name) = e.get("message").map(String::from) else { return true };
                        let mut vol = (e.num("health", 10.0) / 10.0).min(1.0);
                        if sf & 1 == 0 {
                            let r = e.num("radius", 1250.0) * S;
                            vol *= (1.0 - g.player.pos.distance(vec_kv(&e, "origin")) / r.max(1.0)).max(0.0);
                            if vol < 0.03 {
                                return true;
                            }
                        }
                        stop(self, g, 0.0);
                        self.sound_id += 1;
                        g.camp_audio.push(Req::Sound { id: self.sound_id, name, vol });
                        self.nodes[n].st = St::Ambient { sound: Some(self.sound_id) };
                    }
                    "stopsound" | "togglesound" => stop(self, g, 0.0),
                    "fadeout" => stop(self, g, if pf() != 0.0 { pf() } else { 1.0 }),
                    "volume" => {
                        if let Some(id) = cur {
                            g.camp_audio.push(Req::Volume { id, v: (pf() / 10.0).min(1.0) });
                        }
                    }
                    _ => return false,
                }
            }
            "point_energy_ball_launcher" => {
                let Some(&li) = self.built.launchers.get(&self.nodes[n].e.unwrap()) else { return true };
                match input {
                    "launchball" => {
                        let l = &mut g.world.launchers[li];
                        l.done = false;
                        l.wait = l.wait.min(0.1);
                        self.fire(n, "onpostspawnball", None, None);
                    }
                    "disable" => g.world.launchers[li].done = true,
                    "enable" => g.world.launchers[li].done = false,
                    _ => return false,
                }
            }
            "weapon_portalgun" => return self.gun_input(g, n, input, param),
            "func_door_rotating" => return self.rot_input(g, ecs, n, input, param),
            "func_breakable_surf" | "func_breakable" => {
                if input == "shatter" || input == "break" {
                    self.break_glass(g, ecs, n, vec_kv(&e, "origin"));
                } else {
                    return false;
                }
            }
            "func_rotating" => {} // (os modelos do original presos nele ainda não são desenhados)
            "func_noportal_volume" => {
                let St::NoPortal { active } = &mut self.nodes[n].st else { return false };
                match input {
                    "activate" => *active = true,
                    "deactivate" => *active = false,
                    "toggle" => *active = !*active,
                    _ => return false,
                }
            }
            "npc_rocket_turret" => {
                let Some(t) = self.rocket_turrets.iter_mut().find(|t| t.0 == n) else { return true };
                match input {
                    "enable" => t.4 = true,
                    "disable" => t.4 = false,
                    "toggle" => t.4 = !t.4,
                    _ => return false,
                }
            }
            "prop_dynamic" | "prop_dynamic_override" => return self.dyn_input(g, ecs, n, input, param, ev),
            "scripted_sequence" => match input {
                // sem as animações do original: os eventos saem no tempo aproximado da sequência
                "beginsequence" => {
                    self.fire(n, "onbeginsequence", None, None);
                    self.schedule(8.0, "!self", "FireScriptEvent", "", None, Some(n));
                    self.schedule(12.0, "!self", "FireEndSequence", "", None, Some(n));
                }
                "firescriptevent" => self.fire(n, "onscriptevent01", None, None),
                "fireendsequence" => self.fire(n, "onendsequence", None, None),
                "cancelsequence" => self.unschedule(n, None),
                _ => return false,
            },
            "point_viewcontrol" => match input {
                "enable" => {
                    let [p, y, _] = parse_vec(e.get("angles"));
                    // flag 4: o jogador fica parado enquanto a câmera de cena está ligada
                    g.camp_view = Some(super::View { pos: vec_kv(&e, "origin"), yaw: yaw_from_source(y), pitch: -p.to_radians(), freeze: e.flags() & 4 != 0 });
                    self.nodes[n].st = St::View { viewing: true };
                }
                "disable" => {
                    self.nodes[n].st = St::View { viewing: false };
                    g.camp_view = None;
                }
                _ => return false,
            },
            "env_fade" => {
                if input != "fade" && input != "fadereverse" {
                    return false;
                }
                let [r, gg, b] = parse_vec(Some(e.get_or("rendercolor", "0 0 0")));
                let sf = e.flags();
                g.camp_fade = Some(super::Fade {
                    color: Vec3::new(r, gg, b) / 255.0,
                    dur: e.num("duration", 2.0),
                    hold: e.num("holdtime", 0.0),
                    from: input == "fadereverse" || sf & 1 != 0,
                    stay: sf & 8 != 0,
                    t: 0.0,
                });
            }
            "env_portal_credits" => {
                if !(input.starts_with("roll") && input.ends_with("credits")) {
                    return false;
                }
                if let St::Credits { rolling } = &mut self.nodes[n].st {
                    if *rolling {
                        return true;
                    }
                    *rolling = true;
                }
                g.camp_credits = Some(0.0);
                self.credits_node = Some(n);
            }
            _ => return false,
        }
        true
    }

    /// fim dos créditos (a tela de créditos avisa): o mapa termina a campanha
    pub fn credits_done(&mut self, g: &mut Game) {
        if let Some(n) = self.credits_node.take() {
            self.fire(n, "oncreditsdone", None, None);
            complete_map(g, "final");
        }
    }

    fn gun_input(&mut self, g: &mut Game, n: usize, input: &str, param: &str) -> bool {
        let St::Gun { picked, .. } = &self.nodes[n].st else { return false };
        if *picked {
            return true;
        }
        // arma "de cena" que dispara portais sozinha (câmara 02: num pedestal que gira)
        let door_angle = |rt: &Runtime, name: &str| -> Option<f32> {
            rt.find_static(name).into_iter().find(|&x| rt.nodes[x].cls == "func_door_rotating").map(|d| match rt.nodes[d].st {
                St::Rot { angle, .. } => angle,
                _ => 0.0,
            })
        };
        match input {
            "setparent" => {
                let a = door_angle(self, param.trim()).unwrap_or(0.0);
                if let St::Gun { parent, refa, .. } = &mut self.nodes[n].st {
                    *parent = Some(param.trim().to_string());
                    *refa = a;
                }
            }
            "clearparent" => {
                let pname = match &self.nodes[n].st {
                    St::Gun { parent, .. } => parent.clone(),
                    _ => None,
                };
                let a = pname.as_deref().and_then(|p| door_angle(self, p));
                if let St::Gun { parent, refa, baked, .. } = &mut self.nodes[n].st {
                    if let Some(a) = a {
                        *baked += a - *refa;
                    }
                    *parent = Some(String::new());
                }
            }
            "fireportal1" | "fireportal2" => {
                let pe = self.ent(n).get_or("parentname", "").to_string();
                if let St::Gun { parent, refa, .. } = &mut self.nodes[n].st {
                    if parent.is_none() {
                        *parent = Some(pe);
                        *refa = 0.0;
                    }
                }
                let St::Gun { parent, refa, baked, .. } = &self.nodes[n].st else { return true };
                let (pname, refa, baked) = (parent.clone().unwrap_or_default(), *refa, *baked);
                let turn = baked + door_angle(self, &pname).map(|a| a - refa).unwrap_or(0.0);
                let e = self.ent(n);
                let [p, y, _] = parse_vec(e.get("angles"));
                let (dir, _) = angles_to_vectors(p, y + turn, 0.0);
                let from = vec_kv(e, "origin") + dir * 0.3;
                let Some(hit) = g.world.raycast(from, dir, 400.0) else { return true };
                let which = if input == "fireportal1" { BLUE } else { ORANGE };
                let wall = hit.normal.y.abs() < 0.5;
                let up = if wall { Vec3::Y } else { Vec3::NEG_Z };
                let mut at = hit.point;
                if wall {
                    at.y -= 56.0 * S - PORTAL_B;
                }
                // é um portal comum: depois de pegar a arma, os tiros do jogador o movem
                if g.portals.place_fixed(&g.world, which, at, hit.normal, up) {
                    g.portals.list[which].fixed = false;
                    g.portals.list[which].owner = None;
                }
            }
            _ => return false,
        }
        true
    }

    fn rot_input(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, input: &str, param: &str) -> bool {
        let e = self.ent(n).clone();
        let St::Rot { is_open, speed, group, .. } = &mut self.nodes[n].st else { return false };
        if input == "setspeed" {
            if let Some(v) = parse_f(param).filter(|v| *v != 0.0) {
                *speed = Some(v);
            }
            return true;
        }
        let (was, sp, grp) = (*is_open, *speed, *group);
        let dist = e.num("distance", 90.0);
        let t = dist.abs() / sp.unwrap_or(e.num("speed", 100.0)).max(1.0);
        let go = |rt: &mut Runtime, g: &mut Game, ecs: &mut Ecs, open: bool| {
            if was == open {
                return;
            }
            rt.nodes[n].st = St::Rot { is_open: open, angle: if open { dist * if e.flags() & 2 != 0 { 1.0 } else { -1.0 } } else { 0.0 }, speed: sp, group: grp };
            if grp.is_none() {
                if let Some(&bi) = rt.nodes[n].e.and_then(|x| rt.brush_of.get(&x)) {
                    for s in rt.built.brush_ents[bi].solids.clone() {
                        g.world.set_solid_enabled(ecs, s, !open);
                    }
                }
            }
            rt.fire(n, if open { "onopen" } else { "onclose" }, None, None);
            rt.unschedule(n, Some("FireFully"));
            rt.schedule(t, "!self", "FireFully", if open { "open" } else { "closed" }, None, Some(n));
        };
        match input {
            "open" => go(self, g, ecs, true),
            "close" => go(self, g, ecs, false),
            "toggle" => go(self, g, ecs, !was),
            "firefully" => {
                let opened = param == "open";
                self.fire(n, if opened { "onfullyopen" } else { "onfullyclosed" }, None, None);
                // botão: volta sozinho depois de `wait` segundos (−1 = fica)
                let wait = e.num("wait", -1.0);
                if opened && wait >= 0.0 {
                    self.schedule(wait, "!self", "Close", "", None, Some(n));
                }
            }
            _ => return false,
        }
        true
    }

    fn dyn_input(&mut self, g: &mut Game, ecs: &mut Ecs, n: usize, input: &str, param: &str, ev: &Ev) -> bool {
        let e = self.ent(n).clone();
        // fim da animação: no tempo da sequência no .mdl da cópia do jogador (ou ~3 s)
        if input == "setanimation" && e.outputs.iter().any(|o| o.output == "onanimationdone") {
            let dur = self.data.anim_durations.get(&e.model()).and_then(|m| m.get(&param.trim().to_lowercase())).copied().unwrap_or(3.0);
            self.unschedule(n, Some("FireAnimDone"));
            self.schedule(dur, "!self", "FireAnimDone", "", ev.act, Some(n));
        } else if input == "fireanimdone" {
            self.fire(n, "onanimationdone", None, None);
        }
        let St::Dyn(d) = &mut self.nodes[n].st else { return true };
        if let Some(m) = d.machine.as_mut() {
            if input == "setdefaultanimation" || input == "setanimation" {
                let p = param.to_lowercase();
                if let Some(i) = p.find("insanity_") {
                    if let Some(v) = p[i + 9..].trim_start_matches('0').chars().next().and_then(|c| c.to_digit(10)) {
                        m.stress = v as f32;
                    }
                }
                if p.contains("death") {
                    m.stress = 4.0;
                    let at = d.at + Vec3::new(0.0, -3.0, 0.0);
                    let (x, mm) = visuals::explosion(ecs, g.world.root(), at);
                    self.booms.push((x, mm, 0.0));
                }
            }
        }
        let St::Dyn(d) = &mut self.nodes[n].st else { return true };
        if d.switch.is_some() && (input == "setanimation" || input == "setdefaultanimation") {
            let p = param.to_lowercase();
            if p.contains("down") {
                d.pressed = true;
            } else if p.contains("up") {
                d.pressed = false;
            }
        }
        if input == "setparent" && (d.shell.is_some() || d.core.is_some()) {
            if let Some(t) = self.find_static(param).into_iter().find(|&x| self.nodes[x].cls == "func_tracktrain") {
                let off = self.own_offset(t);
                if let St::Dyn(d) = &mut self.nodes[n].st {
                    let cur = d.base + d.parent.map(|_| off).unwrap_or(Vec3::ZERO);
                    d.parent = Some(t);
                    d.base = if d.parent.is_some() { cur - off } else { cur };
                }
            }
        }
        let St::Dyn(d) = &self.nodes[n].st else { return true };
        match input {
            "disable" | "turnoff" => self.set_dyn_visible(ecs, d, false),
            "enable" | "turnon" => self.set_dyn_visible(ecs, d, true),
            _ => {}
        }
        true
    }
}

fn set_frozen(g: &mut Game, k: usize, on: bool) {
    let p = &mut g.props.list[k];
    p.pinned = on;
    if let Some(b) = g.world.phys.body_mut(p.body) {
        b.set_body_type(if on { rapier3d::prelude::RigidBodyType::Fixed } else { rapier3d::prelude::RigidBodyType::Dynamic }, true);
    }
}

/// número como o JS escreve (1, 2.5)
fn fmt_num(v: f32) -> String {
    if v.fract() == 0.0 && v.abs() < 1e9 { format!("{}", v as i64) } else { format!("{v}") }
}
