//! Bolas e objetos pelo par temporal (o laranja aberto no passado e o ciano no presente), e as
//! torretas do passado que veem você pelo vermelho.

use super::*;
use crate::energy::EnergyEvent;
use std::collections::HashSet;

/// bola a caminho do ciano: entrou no laranja em `t_in` e sai `t_out`
#[derive(Clone, Debug)]
pub(super) struct BallQ {
    t_in: f32,
    t_out: f32,
    pos: Vec3,
    vel: Vec3,
    /// centro do laranja por onde entrou (se ele mudar de lugar, a bola se perde no tempo)
    key: Vec3,
    life: f32,
}

/// bola que entrou no ciano (o laço: se o tempo voltar para antes, ela tem de entrar de novo ali)
#[derive(Clone, Debug)]
pub(super) struct BlueEntry {
    uid: u64,
    li: Option<usize>,
    t: f32,
    pos: Vec3,
    closed_at: Option<f32>,
}

/// o voo no passado de uma bola mandada pelo ciano
#[derive(Clone, Debug)]
pub(super) struct BallDouble {
    from: f32,
    to: f32,
    track: Vec<(f32, Vec3)>,
    v0: Vec3,
    life: f32,
    uid: Option<u64>,
    live_from: Option<f32>,
}

/// objeto mandado ao passado: o "duplo" (o mais velho), de `from` até `to`
#[derive(Clone, Debug)]
pub(super) struct Double {
    k: usize,
    from: f32,
    to: f32,
    born: f32,
    track: Vec<(f32, Vec3, Quat)>,
    mesh: Option<Entity>,
    hid: bool,
}

#[derive(Default)]
pub(super) struct TimeBalls {
    queue: Vec<BallQ>,
    past_entries: Vec<(Option<usize>, f32)>,
    blue_entries: Vec<BlueEntry>,
    ball_doubles: Vec<BallDouble>,
    loop_tw: Option<f32>,
    scan_ts: HashMap<usize, f32>,
    past_hits: HashSet<(Option<usize>, i32)>,
    doubles: Vec<Double>,
    past_lock: HashMap<usize, f32>,
    past_acc: HashMap<usize, f32>,
    said_turret: bool,
    tracers: Vec<(Entity, f32)>,
}

struct SimBall {
    track: Vec<(f32, Vec3)>,
    caught: Vec<usize>,
    reenter: Vec<BallQ>,
    alive: Option<(Vec3, Vec3, f32)>,
    paradox: Option<(&'static str, Vec3)>,
}

fn in_mouth(p: &crate::portals::Portal, at: Vec3, depth: f32) -> bool {
    let l = p.local(at);
    l.z.abs() < depth && (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 1.0
}

impl Game {
    fn ch_live(&self) -> bool {
        self.relogio.as_ref().is_some_and(|c| !c.paused && c.sweep.is_none())
    }

    /// só o efeito do paradoxo (letreiro, som, onda) — sem desfazer nada: o que causaria o paradoxo não acontece
    fn ch_paradox_fx(&mut self, why: &str, at: Vec3) {
        self.events.push(GameEvent::Paradox(why.to_string(), Some(at)));
        let Some(ch) = self.relogio.as_mut() else { return };
        ch.fx_paradox = 1.1;
        ch.paradox_why = Some((why.to_string(), 2.6));
        ch.fx_kick = Some((1.3, 0.0, false));
    }

    fn launcher_life(&self, from: Option<usize>, life: f32) -> f32 {
        from.and_then(|l| self.world.launchers.get(l)).map(|l| l.life).unwrap_or(life)
    }

    /// os eventos do relógio vindos da física das bolas
    pub fn ch_energy_event(&mut self, ecs: &mut Ecs, e: &EnergyEvent) {
        match *e {
            EnergyEvent::IntoPast { orange, pos, vel, life, from, .. } => self.ch_ball_into_past(orange, pos, vel, life, from),
            EnergyEvent::ToPast { blue, pos, vel, life, from, uid } => {
                if !self.ch_ball_to_past(ecs, blue, pos, vel, life, from, uid) {
                    // antes do começo da gravação: a bola quica na parede, como sem o relógio
                    let i = self.energy.spawn(ecs, &self.world, pos, vel - self.portals.list[blue].normal * 2.0 * vel.dot(self.portals.list[blue].normal), life, from);
                    self.energy.pellets[i].cooldown = 0.2;
                }
            }
            _ => {}
        }
    }

    /// bola que bate no laranja temporal: entrou no portal aberto no passado e sai pelo ciano Δ s depois
    fn ch_ball_into_past(&mut self, o: usize, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>) {
        let delta = self.portals.list[o].delta;
        let key = self.portals.list[o].center;
        let life = self.launcher_life(from, life);
        let Some(ch) = self.relogio.as_mut() else { return };
        let tw = ch.tw;
        ch.tb.queue.push(BallQ { t_in: tw, t_out: tw + delta, pos, vel, key, life });
        ch.tb.past_entries.push((from, tw));
        self.events.push(GameEvent::Energy(EnergyEvent::Pop(pos)));
    }

    /// bola que entra no ciano temporal: sai do laranja em Td = agora − Δ e voa Δ s lá (simulado agora)
    fn ch_ball_to_past(&mut self, ecs: &mut Ecs, blue: usize, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>, uid: u64) -> bool {
        let o = self.portals.list[blue].partner;
        let delta = self.portals.list[o].delta;
        let Some(ch) = self.relogio.as_mut() else { return false };
        if !(delta > 0.0) {
            return false;
        }
        let tw = ch.tw;
        // repetição: o laço fechando (a sua versão passada já mandou esta bola por aqui agora)
        if let Some(e) = ch.tb.blue_entries.iter_mut().find(|e| (e.uid == uid || (e.li.is_some() && e.li == from)) && (e.t - tw).abs() < 0.6) {
            e.closed_at = Some(tw);
            return true;
        }
        let td = tw - delta;
        if td < ch.samples[0].t - 1e-6 {
            return false;
        }
        let (mut p, mut v) = (pos, vel);
        self.portals.carry(blue, &mut p, &mut v);
        p += self.portals.list[o].normal * 0.2;
        let v0 = v;
        let full = life.max(self.launcher_life(from, 0.0));
        let sim = self.ch_sim_ball(p, v, full, td, delta);
        if let Some((why, at)) = sim.paradox {
            self.ch_paradox_fx(why, at);
            self.events.push(GameEvent::Energy(EnergyEvent::Pop(at)));
            return true;
        }
        let ch = self.relogio.as_mut().unwrap();
        let end = if sim.alive.is_some() { tw } else { tw.min(sim.track.last().map(|x| x.0).unwrap_or(td) + RATE) };
        ch.tb.ball_doubles.push(BallDouble { from: td, to: end, track: sim.track.clone(), v0, life: full, uid: None, live_from: None });
        ch.tb.blue_entries.push(BlueEntry { uid, li: from, t: tw, pos, closed_at: Some(tw) });
        ch.tb.queue.extend(sim.reenter.iter().cloned());
        for c in sim.caught {
            if self.world.catchers[c].active {
                continue;
            }
            self.world.catchers[c].active = true;
            if let Some(l) = from.and_then(|l| self.world.launchers.get_mut(l)) {
                l.done = true;
            }
            self.events.push(GameEvent::Energy(EnergyEvent::Caught(c)));
        }
        if let Some((sp, sv, sl)) = sim.alive {
            let i = self.energy.spawn(ecs, &self.world, sp, sv, sl, None);
            self.energy.pellets[i].cooldown = 0.1;
            let nu = self.energy.pellets[i].uid;
            if let Some(d) = self.relogio.as_mut().unwrap().tb.ball_doubles.last_mut() {
                d.uid = Some(nu);
            }
        }
        true
    }

    /// voo de uma bola no passado, de t0 a t0 + dur, contra o cenário de agora
    fn ch_sim_ball(&self, mut pos: Vec3, mut vel: Vec3, mut life: f32, t0: f32, dur: f32) -> SimBall {
        const R: f32 = 0.16;
        let ch = self.relogio.as_ref().unwrap();
        let o = &self.portals.list[1];
        let mut out = SimBall { track: vec![], caught: vec![], reenter: vec![], alive: None, paradox: None };
        let dt = 1.0 / 120.0;
        let (mut next, mut t) = (0.0f32, 0.0f32);
        let half = self.player.half;
        while t <= dur + 1e-6 {
            if t >= next - 1e-6 {
                out.track.push((t0 + t, pos));
                next += RATE;
            }
            let ks = self.field.scale_at(pos, t0 + t);
            life -= dt * ks;
            if life <= 0.0 {
                return out;
            }
            // você estava ali naquele instante?
            let s = &ch.samples[ch.index_at(t0 + t)];
            let d = pos - s.p;
            if d.x.abs() < half.x + R && d.y.abs() < half.y + R && d.z.abs() < half.z + R {
                out.paradox = Some(("a bola mandada ao passado teria acertado você", pos));
                return out;
            }
            let mut rest = vel.length() * dt * ks;
            while rest > 1e-5 {
                let step = rest.min(0.12);
                rest -= step;
                let dir = vel.normalize();
                if let Some(h) = self.world.raycast(pos, dir, step + R) {
                    // de novo no laranja: entra e sai pelo ciano Δ s depois
                    if o.placed && in_mouth(o, h.point, 0.1) {
                        out.reenter.push(BallQ { t_in: t0 + t, t_out: t0 + t + o.delta, pos, vel, key: o.center, life: life.max(1.0) });
                        return out;
                    }
                    pos = h.point + h.normal * (R + 0.002);
                    vel -= h.normal * 2.0 * vel.dot(h.normal);
                    continue;
                }
                pos += dir * step;
            }
            if let Some(c) = self.world.catchers.iter().position(|c| !c.active && c.pos.distance(pos) < c.radius) {
                out.caught.push(c);
                return out;
            }
            t += dt;
        }
        out.alive = Some((pos, vel, life));
        out
    }

    /// a cada quadro: fecha os laços, solta pelo ciano as bolas cuja hora chegou, procura bolas
    /// da história que bateram onde hoje está o laranja; e os duplos dos objetos
    pub fn ch_past_pellets(&mut self, ecs: &mut Ecs) {
        let live = self.ch_live();
        self.energy.temporal = live;
        let Some(ch) = self.relogio.as_ref() else { return };
        let tw = ch.tw;
        let prev = ch.tb.loop_tw.unwrap_or(tw);
        self.relogio.as_mut().unwrap().tb.loop_tw = Some(tw);
        if !live {
            self.relogio.as_mut().unwrap().tb.scan_ts.clear();
            return;
        }
        self.ch_close_ball_loops(ecs, prev, tw);
        // bolas mandadas ao passado: o tempo chegou de novo à hora em que saíram do vermelho
        if tw > prev {
            let ch = self.relogio.as_mut().unwrap();
            let mut again = vec![];
            for d in &mut ch.tb.ball_doubles {
                if !(d.from > prev && d.from <= tw) || d.track.is_empty() {
                    continue;
                }
                d.live_from = Some(d.live_from.unwrap_or(f32::INFINITY).min(d.from));
                again.push((d.track[0].1, d.v0, d.life, d.uid));
            }
            for (a, v, l, _uid) in again {
                let i = self.energy.spawn(ecs, &self.world, a, v, l, None);
                self.energy.pellets[i].cooldown = 0.15;
                self.events.push(GameEvent::Energy(EnergyEvent::Launch(a)));
            }
        }
        let ch = self.relogio.as_mut().unwrap();
        ch.tb.past_entries.retain(|e| e.1 <= tw + 1e-6);
        ch.tb.queue.retain(|b| b.t_in <= tw + 1e-6);
        self.ch_scan_past_balls(ecs);
        let ch = self.relogio.as_mut().unwrap();
        let (due, keep): (Vec<BallQ>, Vec<BallQ>) = std::mem::take(&mut ch.tb.queue).into_iter().partition(|b| tw >= b.t_out);
        ch.tb.queue = keep;
        for b in due {
            // o laranja mudou de lugar ou fechou: a bola se perdeu no tempo
            let Some(o) = (0..self.portals.list.len()).find(|&i| {
                let q = &self.portals.list[i];
                q.placed && q.delta > 0.0 && self.portals.is_linked(i) && q.center.distance(b.key) < 1e-3
            }) else {
                continue;
            };
            let (mut pos, mut vel) = (b.pos, b.vel);
            self.portals.carry(o, &mut pos, &mut vel);
            pos += vel.normalize_or_zero() * 0.25;
            let i = self.energy.spawn(ecs, &self.world, pos, vel, b.life, None);
            self.energy.pellets[i].cooldown = 0.15;
            self.events.push(GameEvent::Energy(EnergyEvent::Launch(pos)));
        }
        self.ch_update_doubles(ecs);
    }

    /// bolas que entraram no ciano: o tempo voltou e passa de novo por aquele instante — a mesma bola tem de entrar ali
    fn ch_close_ball_loops(&mut self, ecs: &mut Ecs, prev: f32, tw: f32) {
        let ch = self.relogio.as_mut().unwrap();
        if ch.tb.blue_entries.is_empty() {
            return;
        }
        ch.tb.blue_entries.retain(|e| tw - e.t < KEEP);
        for e in &mut ch.tb.blue_entries {
            if e.closed_at.is_some_and(|c| c > tw + 1e-6) {
                e.closed_at = None;
            }
        }
        if !(tw > prev) {
            return;
        }
        let entries = ch.tb.blue_entries.clone();
        for (k, e) in entries.iter().enumerate() {
            if !(e.t > prev && e.t <= tw) || e.closed_at.is_some() {
                continue;
            }
            let found = self.energy.pellets.iter().position(|q| q.uid == e.uid || (e.li.is_some() && e.li == q.from));
            match found {
                None => self.ch_paradox_fx("a esfera que foi para o passado não chegou ao ciano desta vez", e.pos),
                Some(i) if self.energy.pellets[i].pos.distance(e.pos) < 2.5 => {
                    self.energy.kill_pub(ecs, &mut self.world, i);
                    self.relogio.as_mut().unwrap().tb.blue_entries[k].closed_at = Some(tw);
                }
                Some(i) => {
                    let at = self.energy.pellets[i].pos;
                    self.ch_paradox_fx("a esfera que foi para o passado não passou pelo ciano desta vez", at);
                }
            }
        }
    }

    /// bolas que JÁ estavam na história: conforme o instante mostrado pelo laranja anda, procura nas fotos
    /// uma bola que bateu onde hoje está o laranja; ela entrou nele (laço fechado) e sai agora pelo ciano
    fn ch_scan_past_balls(&mut self, ecs: &mut Ecs) {
        let oranges: Vec<usize> = (0..self.portals.list.len()).filter(|&i| self.portals.list[i].placed && self.portals.list[i].delta > 0.0 && self.portals.is_linked(i)).collect();
        if oranges.is_empty() {
            self.relogio.as_mut().unwrap().tb.scan_ts.clear();
            return;
        }
        for oi in oranges {
            let o = self.portals.list[oi].clone();
            let ch = self.relogio.as_mut().unwrap();
            let cur = ch.tw - o.delta;
            let from = *ch.tb.scan_ts.get(&oi).unwrap_or(&cur);
            ch.tb.scan_ts.insert(oi, cur);
            let limit = cur.min(o.placed_tw.unwrap_or(f32::NEG_INFINITY)); // depois de abrir, quem cuida é a entrada direta
            if !(limit > from) {
                continue;
            }
            const R: f32 = 0.16;
            let n = o.normal;
            let mut found = vec![];
            for i in ch.index_at(from).max(1)..=ch.index_at(limit) {
                let (a_s, b_s) = (&ch.samples[i - 1], &ch.samples[i]);
                if b_s.t <= from - 1e-6 {
                    continue;
                }
                for a in &a_s.w.pellets {
                    let vn = a.vel.dot(n);
                    if vn >= -1e-3 {
                        continue;
                    }
                    let la = o.local(a.pos);
                    if la.z < -0.05 {
                        continue;
                    }
                    let s_hit = (la.z - R) / -vn;
                    if !(0.0..=RATE * 1.5).contains(&s_hit) {
                        continue;
                    }
                    let at = a.pos + a.vel * s_hit;
                    let l = o.local(at);
                    if (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) > 1.0 {
                        continue;
                    }
                    let t_hit = a_s.t + s_hit;
                    let key = (a.li, (t_hit * 30.0).round() as i32);
                    if !ch.tb.past_hits.insert(key) {
                        continue;
                    }
                    // essa bola ligou um receptor depois? então tirá-la da história é paradoxo
                    let mut caught_later = false;
                    for j in ch.index_at(t_hit) + 1..ch.samples.len() {
                        let (s, p0) = (&ch.samples[j].w, &ch.samples[j - 1].w);
                        let Some(ball) = p0.pellets.iter().find(|q| q.li == a.li) else { break };
                        if s.catchers.iter().enumerate().any(|(c, &on)| on && !p0.catchers.get(c).copied().unwrap_or(true) && self.world.catchers.get(c).is_some_and(|x| x.pos.distance(ball.pos) < 1.5)) {
                            caught_later = true;
                            break;
                        }
                        if !s.pellets.iter().any(|q| q.li == a.li) {
                            break;
                        }
                    }
                    found.push((a.li, a.vel, a.life, at, t_hit, caught_later));
                }
            }
            for (li, vel, life, at, t_hit, caught_later) in found {
                if caught_later {
                    self.ch_paradox_fx("essa bola do passado ligou um receptor depois: ela não pode ter entrado no vermelho", at);
                    continue;
                }
                // a mesma bola ainda existe agora? então ela some (foi para o portal lá atrás)
                let tw = self.relogio.as_ref().unwrap().tw;
                let mut k = self.energy.pellets.len();
                while k > 0 {
                    k -= 1;
                    let p = &self.energy.pellets[k];
                    let full = self.launcher_life(p.from, p.life);
                    let born = tw - (full - p.life);
                    if li.is_some() && p.from == li && born <= t_hit + 0.05 {
                        self.energy.kill_pub(ecs, &mut self.world, k);
                    }
                }
                let life = self.launcher_life(li, life);
                let ch = self.relogio.as_mut().unwrap();
                ch.tb.past_entries.push((li, t_hit));
                ch.tb.queue.push(BallQ { t_in: t_hit, t_out: t_hit + o.delta, pos: at, vel, key: o.center, life });
            }
        }
    }

    // ------------------------------------------------------------------ objetos mandados ao passado
    /// objeto solto que entra no ciano temporal: sai do laranja em Td = agora − Δ e cai/quica até agora
    /// (simulado de uma vez); entre Td e agora existem DOIS dele — o duplo (o mais velho) aparece na vista
    /// do ciano e, se você voltar para dentro do intervalo, existe de verdade
    pub fn ch_send_to_past(&mut self, ecs: &mut Ecs, k: usize, blue: usize) {
        let o = self.portals.list[blue].partner;
        let delta = self.portals.list[o].delta;
        if !(delta > 0.0) || !self.ch_live() {
            return;
        }
        let ch = self.relogio.as_ref().unwrap();
        let (tw, first) = (ch.tw, ch.samples[0].t);
        let td = tw - delta;
        if td < first - 1e-6 {
            return;
        }
        let c = &self.props.list[k];
        let (mut pos, mut vel) = (c.pos, c.vel);
        let (_, _, rot) = self.portals.carry(blue, &mut pos, &mut vel);
        let quat = rot * c.quat;
        let h = c.half.y * 0.95;
        pos += self.portals.list[o].normal * (h + 0.05);
        let g = self.gravity().at(pos);
        let mut track = vec![];
        let dt = 1.0 / 120.0;
        let (mut next, mut t) = (0.0f32, 0.0f32);
        while t <= delta + 1e-6 {
            if t >= next - 1e-6 {
                track.push((td + t, pos, quat));
                next += RATE;
            }
            let ks = self.field.scale_at(pos, td + t);
            vel += g * dt * ks;
            let mv = vel.length() * dt * ks;
            if mv > 1e-6 {
                let dir = vel.normalize();
                match self.world.raycast(pos, dir, mv + h) {
                    Some(hit) if hit.dist < mv + h => {
                        pos += dir * (hit.dist - h - 0.002).max(0.0);
                        let vn = vel.dot(hit.normal);
                        vel -= hit.normal * 1.15 * vn;
                    }
                    _ => pos += dir * mv,
                }
            }
            // apoio: nunca dentro do chão; no chão, sem afundar e com atrito
            let down = g.normalize_or_zero();
            if let Some(f) = self.world.raycast(pos - down * 0.2, down, h + 0.22) {
                if f.dist < h + 0.2 {
                    pos -= down * (h + 0.2 - f.dist);
                    let vd = vel.dot(down);
                    if vd > 0.0 {
                        vel -= down * vd;
                    }
                    vel *= (1.0 - 6.0 * dt).max(0.0);
                }
            }
            t += dt;
        }
        let ch = self.relogio.as_mut().unwrap();
        let born = ch.samples.iter().find(|s| s.w.props.get(k).is_some_and(|p| !p.gone)).map(|s| s.t).unwrap_or(f32::INFINITY);
        ch.tb.doubles.push(Double { k, from: td, to: tw, born, track, mesh: None, hid: false });
        ch.free.insert(k);
        ch.driven.remove(&k);
        let c = &mut self.props.list[k];
        c.place(&mut self.world.phys, pos, Some(quat), Some(vel));
        self.events.push(GameEvent::PropPortal);
        self.dissolve(k, crate::dissolver::TIME, true);
        let _ = ecs;
    }

    fn double_at(d: &Double, t: f32) -> Option<(Vec3, Quat)> {
        if t < d.from - 1e-6 || t >= d.to {
            return None;
        }
        let i = (((t - d.from) / RATE).floor().max(0.0) as usize).min(d.track.len() - 1);
        let a = d.track[i];
        let b = d.track[(i + 1).min(d.track.len() - 1)];
        let k = if i + 1 >= d.track.len() { 0.0 } else { ((t - a.0) / RATE).clamp(0.0, 1.0) };
        Some((a.1.lerp(b.1, k), a.2.slerp(b.2, k)))
    }

    /// a cada quadro: duplos visíveis só dentro do intervalo deles; o objeto real some enquanto
    /// só o duplo existe na história e reaparece onde o duplo chegou
    fn ch_update_doubles(&mut self, ecs: &mut Ecs) {
        let Some(mut ch) = self.relogio.take() else { return };
        if ch.tb.doubles.is_empty() {
            self.relogio = Some(ch);
            return;
        }
        let tw = ch.tw;
        let root = self.world.root();
        let present = bevy::camera::visibility::RenderLayers::layer(PRESENT_LAYER);
        let mut changed = vec![];
        for d in &mut ch.tb.doubles {
            let st = Self::double_at(d, tw);
            let c = &mut self.props.list[d.k];
            if d.mesh.is_none() {
                let m = copy_model(ecs, c.mesh, root);
                set_layers(ecs, m, &present);
                d.mesh = Some(m);
            }
            let m = d.mesh.unwrap();
            match st {
                Some((p, q)) => {
                    ecs.entity_mut(m).insert((Transform::from_translation(q * c.mesh_offset + p).with_rotation(q), Visibility::Inherited));
                }
                None => {
                    ecs.entity_mut(m).insert(Visibility::Hidden);
                }
            }
            let younger_here = tw >= d.born - 1e-6;
            if (st.is_some() || tw < d.from) && !younger_here && !c.gone && !c.held {
                changed.push((d.k, false));
                c.vanish(&mut self.world.phys);
                d.hid = true;
            } else if st.is_none() && d.hid && tw >= d.to {
                d.hid = false;
                c.gone = false;
                if let Some(b) = self.world.phys.body_mut(c.body) {
                    b.set_enabled(true);
                }
                let end = *d.track.last().unwrap();
                c.place(&mut self.world.phys, end.1, Some(end.2), None);
                changed.push((d.k, true));
            }
        }
        let (keep, old): (Vec<Double>, Vec<Double>) = std::mem::take(&mut ch.tb.doubles).into_iter().partition(|d| tw - d.to < KEEP);
        for d in old {
            if let Some(m) = d.mesh {
                if let Ok(e) = ecs.get_entity_mut(m) {
                    e.despawn();
                }
            }
        }
        ch.tb.doubles = keep;
        self.relogio = Some(ch);
        // algo do presente mudou por causa do passado: some (desintegra) ou aparece (materializa)
        for (k, appear) in changed {
            self.dissolve(k, crate::dissolver::TIME, appear);
        }
    }

    /// para a vista do ciano: os duplos e as bolas mandadas ao passado como estavam em T
    pub(super) fn ch_doubles_at(ch: &Chronos, t: f32) -> (Vec<(usize, Vec3, Quat)>, Vec<Vec3>) {
        let ds = ch.tb.doubles.iter().filter_map(|d| Self::double_at(d, t).map(|(p, q)| (d.k, p, q))).collect();
        let bs = ch
            .tb
            .ball_doubles
            .iter()
            .filter(|d| t >= d.from - 1e-6 && t < d.to && t < d.live_from.unwrap_or(f32::INFINITY) - 1e-6 && !d.track.is_empty())
            .map(|d| d.track[(((t - d.from) / RATE).floor().max(0.0) as usize).min(d.track.len() - 1)].1)
            .collect();
        (ds, bs)
    }

    /// bolas que (na história nova) já tinham entrado no laranja no instante T não aparecem na vista
    pub(super) fn ch_entered_by(&self, ch: &Chronos, p: &PelletSnap, t: f32) -> bool {
        let Some(li) = p.li else { return false };
        let born = t - (self.launcher_life(Some(li), p.life) - p.life);
        ch.tb.past_entries.iter().any(|e| e.0 == Some(li) && e.1 <= t + 1e-6 && born <= e.1 + 0.05)
    }

    // ------------------------------------------------------------------ torretas do passado
    /// torretas do passado: cada uma, na pose de Δ s atrás, olhando para o laranja (aberto então) vê você
    /// agora pelo ciano e atira — as balas saem do ciano. Devolve quantos tiros acertaram neste quadro.
    pub fn ch_past_turret_shots(&mut self, ecs: &mut Ecs, dt: f32, eye: Vec3) -> u32 {
        let (o, b) = (&self.portals.list[1], &self.portals.list[0]);
        if dt <= 0.0 || !self.ch_live() || !o.placed || !(o.delta > 0.0) || !b.placed || !self.portals.is_linked(1) {
            return 0;
        }
        let ch = self.relogio.as_ref().unwrap();
        let snap = ch.samples[ch.index_at(ch.tw - o.delta)].w.clone();
        let aim = self.portals.transform(0, 1).transform_point3(eye);
        let to_b = self.portals.transform(1, 0);
        let mut shots = 0;
        let mut tracers = vec![];
        let mut locks: Vec<(usize, Option<f32>)> = vec![];
        for (k, t) in self.props.list.iter().enumerate() {
            let st = snap.props.get(k);
            let Some(st) = st.filter(|s| t.turret.is_some() && !s.gone) else {
                locks.push((k, None));
                continue;
            };
            if (st.q * Vec3::Y).y < 0.6 {
                locks.push((k, None));
                continue;
            }
            let sc = t.mesh_scale;
            let t_eye = st.q * (Vec3::new(0.0, 0.35, 0.2) * sc) + st.p;
            let fwd = st.q * Vec3::Z;
            let to = aim - t_eye;
            let dist = to.length();
            let dir = to / dist;
            let mut ok = dist < 26.0 && dir.dot(fwd).clamp(-1.0, 1.0).acos() < 55f32.to_radians();
            let mut x = Vec3::ZERO;
            if ok {
                let sa = (t_eye - o.center).dot(o.normal);
                let den = dir.dot(o.normal);
                ok = sa > 0.02 && den < -1e-4;
                if ok {
                    let s_hit = -sa / den;
                    x = t_eye + dir * s_hit;
                    let l = o.local(x);
                    ok = (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 0.85 && self.world.raycast(t_eye, dir, (s_hit - 0.12).max(0.0)).is_none();
                }
            }
            if ok {
                // do lado de agora: da boca do ciano até você
                let xb = to_b.transform_point3(x);
                let d2 = eye - xb;
                let l = d2.length();
                let d2 = d2 / l;
                ok = !(l > 0.6 && self.world.raycast(xb + d2 * 0.12, d2, l - 0.55).is_some());
                if ok {
                    let ch = self.relogio.as_ref().unwrap();
                    let lock = (ch.tb.past_lock.get(&k).copied().unwrap_or(0.0) + dt / 0.7).min(1.0);
                    locks.push((k, Some(lock)));
                    if lock >= 1.0 {
                        let acc = ch.tb.past_acc.get(&k).copied().unwrap_or(0.0) + dt;
                        let n = (acc / 0.1).floor();
                        let ch = self.relogio.as_mut().unwrap();
                        ch.tb.past_acc.insert(k, acc - n * 0.1);
                        shots += n as u32;
                        if n > 0.0 {
                            tracers.push((xb, eye));
                        }
                    }
                    continue;
                }
            }
            locks.push((k, None));
        }
        let ch = self.relogio.as_mut().unwrap();
        for (k, l) in locks {
            match l {
                Some(v) => {
                    ch.tb.past_lock.insert(k, v);
                }
                None => {
                    ch.tb.past_lock.remove(&k);
                }
            }
        }
        for (a, b) in tracers {
            self.ch_tracer(ecs, a, b);
        }
        if shots > 0 {
            let ch = self.relogio.as_mut().unwrap();
            if !ch.tb.said_turret {
                ch.tb.said_turret = true;
                self.toast("Uma torreta do passado viu você pelo vermelho: as balas saem do ciano.");
            }
        }
        shots
    }

    /// risco de bala saindo da boca do ciano
    fn ch_tracer(&mut self, ecs: &mut Ecs, from: Vec3, to: Vec3) {
        let root = self.world.root();
        let ch = self.relogio.as_mut().unwrap();
        let d = (to - from).normalize_or_zero();
        let a = from + (to - from) * rand::random::<f32>() * 0.3;
        let k = ch.tb.tracers.iter().position(|t| t.1 <= 0.05);
        let e = match k {
            Some(k) => ch.tb.tracers[k].0,
            None => {
                let mat = crate::world::bas_a(ecs, LinearRgba::rgb(1.0, 0.82, 0.54), 0.9, false);
                let mesh = ecs.resource_mut::<Assets<Mesh>>().add(Cuboid::new(0.012, 0.012, 1.4));
                let e = ecs.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::default(), Visibility::Hidden, ChildOf(root))).id();
                ch.tb.tracers.push((e, 0.0));
                e
            }
        };
        let k = ch.tb.tracers.iter().position(|t| t.0 == e).unwrap();
        ch.tb.tracers[k].1 = 0.9;
        ecs.entity_mut(e).insert((Transform::from_translation(a + d * 0.7).looking_to(d, Vec3::Y), Visibility::Inherited));
    }

    /// os riscos somem em poucos quadros
    pub fn ch_fade_tracers(&mut self, ecs: &mut Ecs) {
        let Some(ch) = self.relogio.as_mut() else { return };
        for t in &mut ch.tb.tracers {
            if t.1 > 0.05 {
                t.1 *= 0.6;
                if t.1 <= 0.05 {
                    ecs.entity_mut(t.0).insert(Visibility::Hidden);
                }
            }
        }
    }
}
