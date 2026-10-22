//! Multiplayer na rede local (a parte de main.js que usa net.js): os outros jogadores como raptores
//! de capacete com o nome em cima, o par de portais de cada um (na cor da vaga), os cubos que eles
//! seguram, as torretas derrubadas e os cristais pegos, e a sala inteira trocando de câmara junto.

use crate::game::{Game, GameEvent};
use crate::net::Net;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct Avatar {
    dino: crate::characters::Dino,
    tag: Entity,
    target: Vec3,
    yaw: f32,
    up: f32,
    moving: bool,
    lvl: i64,
    t: f32,
    placed: bool,
}

/// o painel do menu (nome, sala, servidor)
pub struct MpUi {
    pub name: String,
    pub room: String,
    pub server: String,
    pub status: String,
}

impl Default for MpUi {
    fn default() -> Self {
        MpUi { name: String::new(), room: "mina".into(), server: std::env::var("PORTAL3_SERVIDOR").unwrap_or_else(|_| "ws://127.0.0.1:5181/ws".into()), status: crate::i18n::tl("Quem usar o mesmo servidor e o mesmo nome de sala joga junto (a versão web também).") }
    }
}

#[derive(Default)]
pub struct Mp {
    pub net: Option<Net>,
    pub avatars: HashMap<u64, Avatar>,
    pub ui: MpUi,
    acc: f32,
    cube_until: HashMap<usize, f32>,
    clock: f32,
    /// a câmara que a sala pediu (com atraso, para dar tempo do aviso)
    pending: Option<(usize, f32)>,
    /// a mensagem de entrada (portais e o que já aconteceu na sala), aplicada quando a câmara carregar
    welcome: Option<Value>,
}

fn v3(v: Option<&Value>) -> Vec3 {
    let a = v.and_then(|v| v.as_array());
    let g = |i: usize| a.and_then(|a| a.get(i)).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
    Vec3::new(g(0), g(1), g(2))
}

fn r3(v: f32) -> f64 {
    (v as f64 * 1000.0).round() / 1000.0
}

fn tag_font() -> &'static ab_glyph::FontVec {
    static F: std::sync::OnceLock<ab_glyph::FontVec> = std::sync::OnceLock::new();
    F.get_or_init(|| ab_glyph::FontVec::try_from_vec(std::fs::read(crate::mats::asset_dir().join("fonts").join("Arimo-Bold.ttf")).unwrap_or_default()).expect("fonte"))
}

/// plaquinha com o nome do jogador, na cor da vaga
fn name_tag(ecs: &mut Ecs, name: &str, color: Vec3) -> Entity {
    let mut c = crate::raster::Canvas::new(256, 64);
    c.fill_rect(0.0, 0.0, 256.0, 64.0, [0.04, 0.05, 0.07, 0.6]);
    let col = [color.x.min(1.0), color.y.min(1.0), color.z.min(1.0), 1.0];
    c.fill_rect(0.0, 58.0, 256.0, 6.0, col);
    let w = c.text(tag_font(), name, 34.0, 0.0, 0.0, [0.0; 4]);
    c.text(tag_font(), name, 34.0, ((256.0 - w) / 2.0).max(4.0), 44.0, [1.0, 1.0, 1.0, 1.0]);
    let img = ecs.resource_mut::<Assets<Image>>().add(c.image(true, false));
    let mat = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color_texture: Some(img), unlit: true, alpha_mode: AlphaMode::Blend, double_sided: true, cull_mode: None, ..default() });
    let mesh = crate::world::mesh_h(ecs, &crate::geo::plane_geo(1.2, 0.3).rotate_z(std::f32::consts::PI));
    ecs.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::default(), Visibility::Hidden)).id()
}

impl Game {
    pub fn mp(&self) -> bool {
        self.mp.net.as_ref().is_some_and(|n| n.connected())
    }

    pub fn mp_join(&mut self) {
        let name = if self.mp.ui.name.trim().is_empty() { crate::i18n::tlv("Mineiro {n}", &[("n", (rand::random::<u32>() % 90 + 10).to_string())]) } else { self.mp.ui.name.trim().to_string() };
        let room = if self.mp.ui.room.trim().is_empty() { "mina".to_string() } else { self.mp.ui.room.trim().to_string() };
        self.mp.ui.name = name.clone();
        self.mp.ui.status = crate::i18n::tl("Conectando…");
        self.mp.net = Some(Net::connect(&self.mp.ui.server, &room, &name));
    }

    pub fn mp_leave(&mut self, ecs: &mut Ecs) {
        if let Some(n) = self.mp.net.as_mut() {
            n.leave();
        }
        self.mp.net = None;
        for id in self.mp.avatars.keys().copied().collect::<Vec<_>>() {
            self.mp_remove_avatar(ecs, id);
        }
        self.portals.set_slot(0);
        self.mp.ui.status = crate::i18n::tl("Fora da sala.");
    }

    fn mp_remove_avatar(&mut self, ecs: &mut Ecs, id: u64) {
        if let Some(a) = self.mp.avatars.remove(&id) {
            for e in [a.dino.root, a.tag] {
                if let Ok(x) = ecs.get_entity_mut(e) {
                    x.despawn();
                }
            }
        }
        let key = id.to_string();
        for p in self.portals.list.iter_mut().skip(2) {
            if p.owner.as_deref() == Some(key.as_str()) && p.placed {
                p.remove();
            }
        }
    }

    fn mp_send(&self, m: Value) {
        if let Some(n) = self.mp.net.as_ref() {
            n.send(m);
        }
    }

    fn level_index(&self) -> i64 {
        self.level.map(|i| i as i64).unwrap_or(-1)
    }

    /// um portal meu abriu: os outros veem
    pub fn mp_portal(&self, which: usize) {
        if !self.mp() {
            return;
        }
        let p = &self.portals.list[which];
        self.mp_send(json!({ "t": "portal", "which": if which == 0 { "blue" } else { "orange" }, "lvl": self.level_index(), "c": [p.center.x, p.center.y, p.center.z], "n": [p.normal.x, p.normal.y, p.normal.z], "u": [p.up.x, p.up.y, p.up.z], "b": p.solid }));
    }

    /// derrubei uma torreta
    pub fn mp_turret(&self, k: usize) {
        if !self.mp() {
            return;
        }
        let p = self.props.list[k].pos;
        self.mp_send(json!({ "t": "turret", "idx": k, "p": [p.x, p.y, p.z], "lvl": self.level_index() }));
    }

    /// peguei um cristal
    pub fn mp_gem(&self, k: usize) {
        if !self.mp() {
            return;
        }
        self.mp_send(json!({ "t": "gem", "idx": k, "name": self.mp.ui.name, "lvl": self.level_index() }));
    }

    /// cheguei à saída: na sala, todos vão juntos para a próxima (true = a sala cuida)
    pub fn mp_exit(&self, fin: bool) -> bool {
        if !self.mp() {
            return false;
        }
        self.mp_send(json!({ "t": "exit", "level": self.level_index(), "final": fin }));
        true
    }

    /// escolher uma câmara na sala: a sala inteira troca
    pub fn mp_set_level(&self, i: usize) -> bool {
        if !self.mp() {
            return false;
        }
        if self.levels.get(i).is_some_and(|l| l.series.as_deref() == Some("mine")) {
            return false;
        }
        self.mp_send(json!({ "t": "setLevel", "level": i }));
        true
    }

    /// a cada quadro: mensagens, o meu estado (20 por segundo) e os outros jogadores
    pub fn mp_tick(&mut self, ecs: &mut Ecs, dt: f32) {
        self.mp.clock += dt;
        let now = self.mp.clock;
        if let Some((lvl, at)) = self.mp.pending {
            if now >= at {
                self.mp.pending = None;
                self.want_idx = Some((lvl.min(self.levels.len() - 1), false));
                self.menu = false;
                self.paused = false;
                self.completed = false;
            }
        }
        let Some(net) = self.mp.net.as_mut() else { return };
        let msgs = net.poll();
        if let Some(e) = net.error.take() {
            self.mp.ui.status = crate::i18n::tlv("Não deu para entrar: {e}", &[("e", e)]);
        }
        let my_id = net.id;
        for m in msgs {
            let t = m.get("t").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let id = m.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let lvl = m.get("lvl").and_then(|v| v.as_i64()).unwrap_or(-2);
            match t.as_str() {
                "welcome" => {
                    let slot = self.mp.net.as_ref().map(|n| n.slot).unwrap_or(0);
                    self.portals.set_slot(slot);
                    let room = self.mp.net.as_ref().map(|n| n.room.clone()).unwrap_or_default();
                    self.mp.ui.status = crate::i18n::tlv("Na sala “{room}”.", &[("room", room)]);
                    let level = m.get("level").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    self.mp.pending = Some((level, now));
                    // portais e o que já aconteceu na sala
                    self.mp.welcome = Some(m.clone());
                }
                "joined" => self.toast(&crate::i18n::tlv("{name} entrou na sala", &[("name", m.get("name").and_then(|v| v.as_str()).unwrap_or("").into())])),
                "left" => {
                    self.toast(&crate::i18n::tlv("{name} saiu da sala", &[("name", m.get("name").and_then(|v| v.as_str()).unwrap_or("Alguém").into())]));
                    self.mp_remove_avatar(ecs, id);
                }
                "disconnect" => {
                    self.toast(&crate::i18n::tl("Conexão com a sala perdida — jogando sozinho."));
                    for k in self.mp.avatars.keys().copied().collect::<Vec<_>>() {
                        self.mp_remove_avatar(ecs, k);
                    }
                    self.portals.set_slot(0);
                    self.mp.ui.status = crate::i18n::tl("Desconectado.");
                }
                "state" => {
                    if Some(id) == my_id {
                        continue;
                    }
                    let Some(peer) = self.mp.net.as_ref().and_then(|n| n.peers.get(&id)).map(|p| (p.name.clone(), p.slot)) else { continue };
                    if !self.mp.avatars.contains_key(&id) {
                        let root = ecs.spawn((Transform::default(), Visibility::Hidden)).id();
                        let dino = crate::characters::Cast::add_dino(ecs, root, &format!("avatar_{}", peer.1 % 4), None, None, 1.0);
                        let color = Vec3::from(crate::portals::SLOT_COLORS[peer.1 % 4][0]);
                        let tag = name_tag(ecs, &peer.0, color);
                        ecs.entity_mut(dino.root).remove::<ChildOf>();
                        ecs.entity_mut(root).despawn();
                        self.mp.avatars.insert(id, Avatar { dino, tag, target: Vec3::ZERO, yaw: 0.0, up: 1.0, moving: false, lvl: -1, t: 0.0, placed: false });
                    }
                    let a = self.mp.avatars.get_mut(&id).unwrap();
                    a.target = v3(m.get("p"));
                    if a.lvl != lvl {
                        a.placed = false;
                    }
                    a.yaw = m.get("yaw").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                    a.up = m.get("up").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
                    a.moving = m.get("mv").and_then(|v| v.as_bool()).unwrap_or(false);
                    a.lvl = lvl;
                    a.t = now;
                }
                "portal" if lvl == self.level_index() => {
                    let slot = self.mp.net.as_ref().and_then(|n| n.peers.get(&id)).map(|p| p.slot).unwrap_or(1);
                    self.mp_place_remote(id, slot, &m);
                }
                "cube" if lvl == self.level_index() => {
                    let k = m.get("idx").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
                    if k < self.props.list.len() && self.held != Some(k) {
                        let q = m.get("q").and_then(|v| v.as_array()).map(|a| Quat::from_xyzw(a[0].as_f64().unwrap_or(0.0) as f32, a[1].as_f64().unwrap_or(0.0) as f32, a[2].as_f64().unwrap_or(0.0) as f32, a[3].as_f64().unwrap_or(1.0) as f32));
                        self.props.list[k].remote = Some((v3(m.get("p")), q, m.get("held").and_then(|v| v.as_bool()).unwrap_or(false), now));
                    }
                }
                "turret" if lvl == self.level_index() => {
                    let k = m.get("idx").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
                    self.mp_turret_down(k, v3(m.get("p")));
                }
                "gem" if lvl == self.level_index() => {
                    let k = m.get("idx").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
                    self.take_gem(ecs, k);
                }
                "level" => {
                    let level = m.get("level").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let by = m.get("by").and_then(|v| v.as_str()).map(String::from);
                    if m.get("final").and_then(|v| v.as_bool()).unwrap_or(false) {
                        self.toast(&crate::i18n::tlv("{who} atravessou a Terra!", &[("who", by.unwrap_or_default())]));
                        self.completed = true;
                        self.final_shown = true;
                        continue;
                    }
                    let delay = match &by {
                        Some(who) if self.running => {
                            self.events.push(GameEvent::Complete);
                            self.toast(&crate::i18n::tlv("{who} chegou ao elevador — câmara {n}!", &[("who", who.clone()), ("n", format!("{:02}", level + 1))]));
                            1.4
                        }
                        _ => 0.2,
                    };
                    self.mp.pending = Some((level, now + delay));
                }
                _ => {}
            }
        }
        // o que já estava na sala quando entrei (depois que a câmara carregou)
        if self.mp.pending.is_none() {
            if let Some(w) = self.mp.welcome.take() {
                for p in w.get("portals").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                    if p.get("lvl").and_then(|v| v.as_i64()) == Some(self.level_index()) {
                        let id = p.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                        let slot = self.mp.net.as_ref().and_then(|n| n.peers.get(&id)).map(|x| x.slot).unwrap_or(1);
                        self.mp_place_remote(id, slot, &p);
                    }
                }
                if let Some(f) = w.get("flags") {
                    for t in f.get("turrets").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                        if let Some(a) = t.as_array() {
                            self.mp_turret_down(a[0].as_u64().unwrap_or(u64::MAX) as usize, v3(a.get(1)));
                        }
                    }
                    for g in f.get("gems").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                        if let Some(a) = g.as_array() {
                            self.take_gem(ecs, a[0].as_u64().unwrap_or(u64::MAX) as usize);
                        }
                    }
                }
            }
        }
        if !self.mp() {
            return;
        }
        // o meu estado, 20 vezes por segundo; os cubos que eu seguro (e um pouco depois de soltar)
        self.mp.acc += dt;
        if self.mp.acc >= 0.05 && self.running {
            self.mp.acc = 0.0;
            let p = self.player.pos;
            let moving = self.input.f || self.input.b || self.input.l || self.input.r;
            self.mp_send(json!({ "t": "state", "p": [r3(p.x), r3(p.y), r3(p.z)], "yaw": r3(self.player.yaw), "up": self.player.up_sign, "mv": moving && self.player.grounded, "lvl": self.level_index() }));
            if let Some(h) = self.held {
                self.mp.cube_until.insert(h, now + 2.5);
            }
            for k in 0..self.props.list.len() {
                let c = &self.props.list[k];
                let remote_recent = c.remote.as_ref().is_some_and(|r| now - r.3 < 0.3);
                if self.mp.cube_until.get(&k).copied().unwrap_or(0.0) > now && !remote_recent {
                    let q = c.quat;
                    self.mp_send(json!({ "t": "cube", "idx": k, "p": [r3(c.pos.x), r3(c.pos.y), r3(c.pos.z)], "q": [q.x, q.y, q.z, q.w], "held": self.held == Some(k), "lvl": self.level_index() }));
                }
            }
        }
        // cubos que outra pessoa está mexendo: vão para onde ela diz
        for c in &mut self.props.list {
            let Some((p, q, _, t)) = c.remote else { continue };
            if now - t > 0.4 || c.held {
                continue;
            }
            if let Some(b) = self.world.phys.body_mut(c.body) {
                let k = (dt * 18.0).min(1.0);
                let cur = b.translation();
                b.set_translation(cur.lerp(p, k), true);
                if let Some(q) = q {
                    let r = (*b.rotation()).slerp(q, k);
                    b.set_rotation(r, true);
                }
                b.set_linvel(Vec3::ZERO, true);
            }
        }
        // os outros jogadores
        let lvl = self.level_index();
        let (cam, t) = (self.cam.translation, self.t);
        let running = self.running;
        for a in self.mp.avatars.values_mut() {
            let visible = a.lvl == lvl && now - a.t < 3.0 && running;
            ecs.entity_mut(a.dino.root).insert(if visible { Visibility::Inherited } else { Visibility::Hidden });
            ecs.entity_mut(a.tag).insert(if visible { Visibility::Inherited } else { Visibility::Hidden });
            if !visible {
                continue;
            }
            let feet = a.target + Vec3::Y * (-0.9 * a.up);
            let cur = ecs.get::<Transform>(a.dino.root).map(|t| t.translation).unwrap_or(feet);
            let pos = if a.placed { cur.lerp(feet, 1.0 - (-dt * 14.0).exp()) } else { feet };
            a.placed = true;
            ecs.entity_mut(a.dino.root).insert(Transform::from_translation(pos).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, a.yaw + std::f32::consts::PI, if a.up < 0.0 { std::f32::consts::PI } else { 0.0 })));
            a.dino.pose = if a.moving { "walk".into() } else { "idle".into() };
            a.dino.animate(ecs, t, dt);
            // o nome em cima da cabeça, virado para a câmera
            let head = pos + Vec3::Y * 2.25 * a.up;
            ecs.entity_mut(a.tag).insert(Transform::from_translation(head).looking_at(Vec3::new(cam.x, head.y, cam.z), Vec3::Y));
        }
    }

    fn mp_place_remote(&mut self, id: u64, slot: usize, m: &Value) {
        let (b, o) = self.portals.remote_pair(&id.to_string(), slot, false);
        let which = if m.get("which").and_then(|v| v.as_str()) == Some("blue") { b } else { o };
        let solid = m.get("b").and_then(|v| v.as_u64()).map(|x| x as usize).filter(|&i| i < self.world.solids.len());
        let p = &mut self.portals.list[which];
        p.set_frame(v3(m.get("c")), v3(m.get("n")), v3(m.get("u")), solid);
    }

    fn mp_turret_down(&mut self, k: usize, p: Vec3) {
        let Some(c) = self.props.list.get_mut(k) else { return };
        if c.turret.as_ref().is_some_and(|t| t.active) {
            c.place(&mut self.world.phys, p, None, None);
            c.disable(&mut self.world.phys, "desligada", 0.0);
        }
    }
}
