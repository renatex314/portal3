//! Fósseis no cenário (`fossils`) e os cristais colecionáveis do mapa livre (`crystals`).

use crate::game::{Game, GameEvent};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;

pub struct Crystal {
    pub e: Entity,
    pub pos: Vec3,
    pub taken: bool,
}

/// troca a cor base de todas as malhas de um modelo (cópias só dele)
fn tint(ecs: &mut Ecs, root: Entity, c: Color) {
    for m in crate::glb::meshes_of(ecs, root) {
        let Some(h) = ecs.get::<MeshMaterial3d<StandardMaterial>>(m).map(|h| h.0.clone()) else { continue };
        let Some(mut mat) = ecs.resource::<Assets<StandardMaterial>>().get(&h).cloned() else { continue };
        mat.base_color = c;
        let nh = ecs.resource_mut::<Assets<StandardMaterial>>().add(mat);
        ecs.entity_mut(m).insert(MeshMaterial3d(nh));
    }
}

impl Game {
    /// os fósseis e os cristais da fase (na carga)
    pub fn spawn_finds(&mut self, ecs: &mut Ecs) {
        let root = self.world.root();
        let n = |v: &serde_json::Value, k: &str, d: f64| v.get(k).and_then(|x| x.as_f64()).unwrap_or(d) as f32;
        for f in self.data.get("fossils").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            let (m, _) = crate::glb::spawn_model(ecs, "fossil");
            // (o modelo é o de 6 m; a cor da fase é a do arenito)
            tint(ecs, m, crate::mats::hex(0xd8ccb0));
            let s = n(&f, "len", 5.0) / 6.0;
            let rot = Quat::from_euler(EulerRot::XYZ, n(&f, "rotX", 0.0), n(&f, "rotY", 0.0), n(&f, "rotZ", 0.0));
            ecs.entity_mut(m).insert((Transform::from_xyz(n(&f, "x", 0.0), n(&f, "y", 0.0), n(&f, "z", 0.0)).with_rotation(rot).with_scale(Vec3::splat(s)), ChildOf(root)));
        }
        self.crystals.clear();
        for c in self.data.get("crystals").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            let p = crate::levels::v3(Some(&c)).unwrap_or(Vec3::ZERO);
            let (m, _) = crate::glb::spawn_model(ecs, "crystal");
            ecs.entity_mut(m).insert((Transform::from_translation(p), ChildOf(root)));
            self.crystals.push(Crystal { e: m, pos: p + Vec3::Y * 0.4, taken: false });
        }
        self.gems = (!self.crystals.is_empty()).then_some((0, self.crystals.len()));
        self.gems_done = None;
    }

    /// cristais girando; perto de você, são pegos; todos: a mina foi explorada
    pub fn update_finds(&mut self, ecs: &mut Ecs, dt: f32, t: f32) {
        if self.crystals.is_empty() {
            return;
        }
        let pl = self.player.pos;
        let mut took = false;
        let mut mine = vec![];
        for (i, g) in self.crystals.iter_mut().enumerate() {
            if g.taken {
                continue;
            }
            if let Some(mut tr) = ecs.get_mut::<Transform>(g.e) {
                tr.rotate_y(dt * 0.8);
                tr.translation.y = g.pos.y - 0.4 + (t * 2.0 + i as f32).sin() * 0.08;
            }
            if g.pos.distance(pl) < 1.4 {
                g.taken = true;
                ecs.entity_mut(g.e).insert(Visibility::Hidden);
                took = true;
                mine.push(i);
            }
        }
        for i in mine {
            self.mp_gem(i);
        }
        if took {
            self.events.push(GameEvent::Gem);
            let n = self.crystals.iter().filter(|c| c.taken).count();
            self.gems = Some((n, self.crystals.len()));
            if n == self.crystals.len() && self.gems_done.is_none() {
                self.say(vec![("Helena".into(), "Todos os doze cristais! A mina foi explorada de ponta a ponta.".into())]);
                self.gems_done = Some(2.5);
            }
        }
        if let Some(left) = self.gems_done.as_mut() {
            *left -= dt;
            if *left <= 0.0 && !self.completed {
                self.done_title = Some("Mina explorada!".into());
                self.complete(false);
            }
        }
    }

    /// o cristal k foi pego (por você ou, na sala, por outra pessoa)
    pub fn take_gem(&mut self, ecs: &mut Ecs, k: usize) {
        let Some(g) = self.crystals.get_mut(k) else { return };
        if g.taken {
            return;
        }
        g.taken = true;
        ecs.entity_mut(g.e).insert(Visibility::Hidden);
        self.events.push(GameEvent::Gem);
        let n = self.crystals.iter().filter(|c| c.taken).count();
        self.gems = Some((n, self.crystals.len()));
        if n == self.crystals.len() && self.gems_done.is_none() {
            self.say(vec![("Helena".into(), "Todos os doze cristais! A mina foi explorada de ponta a ponta.".into())]);
            self.gems_done = Some(2.5);
        }
    }
}
