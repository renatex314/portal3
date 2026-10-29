//! Bolas e objetos pelo par temporal (o laranja aberto no passado e o ciano no presente), e as
//! torretas do passado que veem você pelo vermelho.

use super::*;
use crate::energy::EnergyEvent;
use super::linha::{botao_por_outro, receptor_por_outra, Compromisso, Consequencias, Desfecho, Duplo, Estado, Linha, Quem, Saida, Sustenta, Voo, TOL_T};
use std::collections::HashSet;

#[derive(Default)]
pub(super) struct TimeBalls {
    /// a linha do tempo das bolas: voos no passado, saídas pelo ciano e compromissos
    pub(super) linha: Linha,
    past_entries: Vec<(Option<usize>, f32)>,
    scan_ts: HashMap<usize, f32>,
    past_hits: HashSet<(Option<usize>, i32)>,
    /// cubos da história que já entraram no vermelho de agora: (cubo, posição do vermelho)
    cube_hits: HashSet<(usize, [i32; 3])>,
    past_lock: HashMap<usize, f32>,
    past_acc: HashMap<usize, f32>,
    said_turret: bool,
    tracers: Vec<(Entity, f32)>,
}

struct SimBall {
    track: Vec<(f32, Vec3, Vec3)>,
    cons: Consequencias,
    reenter: Option<Saida>,
    alive: Option<(Vec3, Vec3, f32)>,
    paradox: Option<(&'static str, Vec3)>,
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
            EnergyEvent::IntoOrange { key, delta, pos, vel, life, from, uid } => self.ch_ball_into_orange(key, delta, pos, vel, life, from, uid),
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

    /// bola que bate num vermelho temporal (o seu, o de uma versão passada ou o de estática, que uma
    /// versão passada ainda vai abrir ali): entrou no portal aberto no passado e sai pelo ciano Δ s
    /// depois — a mesma bola (a mesma identidade)
    fn ch_ball_into_orange(&mut self, key: Vec3, delta: f32, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>, uid: u64) {
        let life = self.launcher_life(from, life);
        let Some(ch) = self.relogio.as_mut() else { return };
        let tw = ch.tw;
        ch.tb.linha.saidas.push(Saida { uid, t_in: tw, t_out: tw + delta, pos, vel, key, life });
        ch.tb.past_entries.push((from, tw));
        self.events.push(GameEvent::Energy(EnergyEvent::Pop(pos)));
    }

    /// bola que entra no ciano temporal: sai do laranja em Td = agora − Δ e voa Δ s lá (simulado agora).
    /// Se você voltou no tempo e um compromisso pede uma bola aqui agora, ela o cumpre (o laço fecha:
    /// é ela que já saiu do vermelho lá atrás) em vez de ir de novo.
    fn ch_ball_to_past(&mut self, ecs: &mut Ecs, blue: usize, pos: Vec3, vel: Vec3, life: f32, from: Option<usize>, uid: u64) -> bool {
        let o = self.portals.list[blue].partner;
        let delta = self.portals.list[o].delta;
        let Some(ch) = self.relogio.as_mut() else { return false };
        if !(delta > 0.0) {
            return false;
        }
        let tw = ch.tw;
        if ch.tb.linha.cumprir(uid, from, pos, tw).is_some() {
            return true;
        }
        let td = tw - delta;
        if td < ch.samples[0].t - 1e-6 {
            return false;
        }
        let (mut p, mut v) = (pos, vel);
        self.portals.carry(blue, &mut p, &mut v);
        p += self.portals.list[o].normal * 0.2;
        let full = life.max(self.launcher_life(from, 0.0));
        let sim = self.ch_sim_ball(p, v, full, td, delta);
        if let Some((why, at)) = sim.paradox {
            self.ch_paradox_fx(why, at);
            self.events.push(GameEvent::Energy(EnergyEvent::Pop(at)));
            return true;
        }
        // a versão mais velha da bola (a que voa no passado) tem identidade própria, fixa
        let elder = self.energy.new_uid();
        let ch = self.relogio.as_mut().unwrap();
        let end = if sim.alive.is_some() { tw } else { tw.min(sim.track.last().map(|x| x.0).unwrap_or(td) + RATE) };
        let voo = ch.tb.linha.voos.len();
        ch.tb.linha.voos.push(Voo { uid: elder, de: td, ate: end, track: sim.track, life: full, cons: sim.cons.clone(), ativo: true, no_mundo: true, no_mundo_desde: None });
        ch.tb.linha.compromissos.push(Compromisso { quem: Quem::Bola { uid, li: from }, t: tw, tol: TOL_T, onde: pos, estado: Estado::Cumprido(tw), sustenta: Sustenta::Voo(voo) });
        if let Some(mut r) = sim.reenter {
            r.uid = elder;
            ch.tb.linha.saidas.push(r);
        }
        for c in sim.cons.pegou {
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
            self.energy.pellets[i].uid = elder;
        }
        true
    }

    /// voo de uma bola no passado, de t0 a t0 + dur, contra o cenário de agora
    fn ch_sim_ball(&self, mut pos: Vec3, mut vel: Vec3, mut life: f32, t0: f32, dur: f32) -> SimBall {
        const R: f32 = 0.16;
        let ch = self.relogio.as_ref().unwrap();
        let mut out = SimBall { track: vec![], cons: Consequencias::default(), reenter: None, alive: None, paradox: None };
        let dt = 1.0 / 120.0;
        let (mut next, mut t) = (0.0f32, 0.0f32);
        let half = self.player.half;
        while t <= dur + 1e-6 {
            if t >= next - 1e-6 {
                out.track.push((t0 + t, pos, vel));
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
                    // de novo num vermelho temporal: entra e sai pelo ciano Δ s depois
                    if let Some((key, delta)) = self.portals.temporal_orange_at(h.point) {
                        out.reenter = Some(Saida { uid: 0, t_in: t0 + t, t_out: t0 + t + delta, pos, vel, key, life: life.max(1.0) });
                        out.cons.reentrou = true;
                        return out;
                    }
                    pos = h.point + h.normal * (R + 0.002);
                    vel -= h.normal * 2.0 * vel.dot(h.normal);
                    continue;
                }
                pos += dir * step;
            }
            if let Some(c) = self.world.catchers.iter().position(|c| !c.active && c.pos.distance(pos) < c.radius) {
                out.cons.pegou.push(c);
                return out;
            }
            t += dt;
        }
        out.alive = Some((pos, vel, life));
        out.cons.viva = true;
        out
    }

    /// a cada quadro: a linha do tempo anda (ou volta), os voos no passado entram no mundo quando é a
    /// hora deles, compromissos que passaram da hora se resolvem, as saídas pelo ciano acontecem e as
    /// bolas da história que bateram onde hoje está o vermelho entram nele; e os duplos dos objetos
    pub fn ch_past_pellets(&mut self, ecs: &mut Ecs) {
        let live = self.ch_live();
        self.energy.temporal = live;
        let Some(ch) = self.relogio.as_mut() else { return };
        let tw = ch.tw;
        if ch.tb.linha.ir_para(tw) {
            ch.tb.past_entries.retain(|e| e.1 <= tw + 1e-6);
        }
        if !live {
            ch.tb.scan_ts.clear();
            return;
        }
        // voos no passado: a bola mais velha está no mundo enquanto o instante cai no trecho dela
        let pellets: HashSet<u64> = self.energy.pellets.iter().map(|p| p.uid).collect();
        let go = ch.tb.linha.a_materializar(tw, |u| pellets.contains(&u));
        for (k, pos, vel, life) in go {
            let uid = self.relogio.as_ref().unwrap().tb.linha.voos[k].uid;
            let i = self.energy.spawn(ecs, &self.world, pos, vel, life, None);
            self.energy.pellets[i].cooldown = 0.15;
            self.energy.pellets[i].uid = uid;
            let v = &mut self.relogio.as_mut().unwrap().tb.linha.voos[k];
            v.no_mundo_desde = Some(v.no_mundo_desde.unwrap_or(f32::INFINITY).min(tw));
            self.events.push(GameEvent::Energy(EnergyEvent::Launch(pos)));
        }
        self.ch_commitments(ecs, tw);
        self.ch_scan_past_balls(ecs);
        let ch = self.relogio.as_mut().unwrap();
        let (due, keep): (Vec<Saida>, Vec<Saida>) = std::mem::take(&mut ch.tb.linha.saidas).into_iter().partition(|b| tw >= b.t_out);
        ch.tb.linha.saidas = keep;
        for b in due {
            // o vermelho mudou de lugar ou fechou: a bola se perdeu no tempo
            let Some(o) = (0..self.portals.list.len()).find(|&i| {
                let q = &self.portals.list[i];
                q.placed && q.delta > 0.0 && self.portals.is_linked(i) && q.center.distance(b.key) < 1e-3
            }) else {
                continue;
            };
            let (mut pos, mut vel) = (b.pos, b.vel);
            self.portals.carry(o, &mut pos, &mut vel);
            pos += vel.normalize_or_zero() * 0.25;
            // a mesma bola sai (se ela já estiver no mundo, é a da foto: não duplica)
            if b.uid != 0 && self.energy.pellets.iter().any(|p| p.uid == b.uid) {
                continue;
            }
            let i = self.energy.spawn(ecs, &self.world, pos, vel, b.life, None);
            self.energy.pellets[i].cooldown = 0.15;
            if b.uid != 0 {
                self.energy.pellets[i].uid = b.uid;
            }
            self.events.push(GameEvent::Energy(EnergyEvent::Launch(pos)));
        }
        let ch = self.relogio.as_mut().unwrap();
        ch.tb.linha.esquecer_antigos(tw, KEEP);
        self.ch_update_doubles(ecs);
    }

    /// compromissos: a bola atrasada que ainda está chegando à boca entra agora (o laço fecha); os
    /// que passaram da hora quebram — sem dependentes, o trecho que sustentavam some da história
    /// (o voo da bola, o duplo do objeto, a emissão do laser); com uma âncora (receptor, botão), é
    /// paradoxo, a não ser que outra coisa a mantenha (outro caminho)
    fn ch_commitments(&mut self, ecs: &mut Ecs, tw: f32) {
        let pend: Vec<(usize, Compromisso)> = self.relogio.as_ref().unwrap().tb.linha.compromissos.iter().cloned().enumerate().filter(|(_, c)| c.estado == Estado::Pendente && tw >= c.t).collect();
        for (k, c) in pend {
            // o objeto no trilho da gravação repete exatamente o que aconteceu — inclusive entrar no
            // ciano: o laço fecha (ele segue de onde o duplo chegou)
            if let Quem::Objeto { k: j } = c.quem {
                let ch = self.relogio.as_mut().unwrap();
                if ch.driven.contains_key(&j) {
                    ch.tb.linha.compromissos[k].estado = Estado::Cumprido(tw);
                }
                continue;
            }
            let Quem::Bola { uid, li } = c.quem else { continue };
            let near = self.energy.pellets.iter().position(|q| (q.uid == uid || (li.is_some() && li == q.from)) && q.pos.distance(c.onde) < 2.5);
            if let Some(i) = near {
                self.energy.kill_pub(ecs, &mut self.world, i);
                self.relogio.as_mut().unwrap().tb.linha.compromissos[k].estado = Estado::Cumprido(tw);
            }
        }
        let out = self.relogio.as_mut().unwrap().tb.linha.vencidos(tw);
        for (k, d) in out {
            let c = self.relogio.as_ref().unwrap().tb.linha.compromissos[k].clone();
            let (s, kept) = match d {
                Desfecho::Apagar(s) => (s, true),
                Desfecho::Ancora { sustenta, receptores, botoes } => (sustenta, self.ch_anchors_kept(sustenta, &receptores, &botoes)),
            };
            if kept {
                self.ch_erase(ecs, s);
                continue;
            }
            match c.quem {
                Quem::Bola { .. } => self.ch_paradox_fx("a esfera que foi para o passado não chegou ao ciano desta vez", c.onde),
                Quem::Objeto { .. } => self.ch_paradox_fx("o objeto que foi para o passado não entrou no ciano desta vez (ele apertou um botão lá)", c.onde),
                Quem::Laser { clone } => {
                    // o laser do passado ligou um receptor: sem ele, o loop se desfaz
                    let cp = self.relogio.as_ref().unwrap().arena.get(&clone).map(|x| x.cp.clone());
                    if let (Some(cp), true) = (cp, self.rollback_pending.is_none()) {
                        self.rollback_pending = Some((cp, "o laser não voltou a entrar no ciano (era ele que saía do vermelho)", Some(c.onde)));
                    }
                }
            }
        }
    }

    /// as âncoras de um trecho que deixou a história continuam de pé por outro caminho? (os receptores
    /// alcançados por outra bola / ligados por outro laser; os botões apertados também por outra coisa)
    fn ch_anchors_kept(&self, s: Sustenta, receptores: &[usize], botoes: &[(usize, f32)]) -> bool {
        let l = &self.relogio.as_ref().unwrap().tb.linha;
        match s {
            Sustenta::Voo(v) => receptores.iter().all(|&c| self.ch_catcher_reached_otherwise(c, l.voos[v].uid)),
            Sustenta::Emissao(_) => receptores.iter().all(|&c| self.frontier.lit_present.contains(&c)),
            Sustenta::Duplo(_) => {
                let ch = self.relogio.as_ref().unwrap();
                botoes.iter().all(|&(b, t)| {
                    let Some(btn) = self.world.buttons.get(b) else { return true };
                    let smp = &ch.samples[ch.index_at(t)];
                    // o próprio objeto (o mais novo) em cima do botão também conta como outra coisa
                    botao_por_outro(btn.pos, smp.w.props.iter().map(|q| (q.p, q.gone)), usize::MAX, smp.p)
                })
            }
        }
    }

    /// some da história um trecho cujo compromisso quebrou sem que nada dependesse dele: a bola
    /// mais velha se desfaz; o duplo do objeto some; a emissão de laser deixa de sair do vermelho
    fn ch_erase(&mut self, ecs: &mut Ecs, s: Sustenta) {
        let uid = self.relogio.as_mut().unwrap().tb.linha.apagar(s);
        if let Sustenta::Voo(_) = s {
            if let Some(i) = self.energy.pellets.iter().position(|p| p.uid == uid) {
                self.events.push(GameEvent::Energy(EnergyEvent::Pop(self.energy.pellets[i].pos)));
                self.energy.kill_pub(ecs, &mut self.world, i);
            }
        }
        if let Sustenta::Duplo(d) = s {
            let dd = &self.relogio.as_ref().unwrap().tb.linha.duplos[d];
            if let Some(m) = dd.mesh {
                if let Ok(mut e) = ecs.get_entity_mut(m) {
                    e.insert(Visibility::Hidden);
                }
            }
        }
    }

    /// outra bola (não `uid`) chegou ao receptor `c`? Agora, ou na história gravada (as fotos desta
    /// passada e as gravações das suas versões passadas): então ele continua ligado sem o voo
    fn ch_catcher_reached_otherwise(&self, c: usize, uid: u64) -> bool {
        let Some(cat) = self.world.catchers.get(c) else { return false };
        if receptor_por_outra(cat.pos, cat.radius, self.energy.pellets.iter().map(|p| (p.uid, p.from, p.pos)), uid, None) {
            return true;
        }
        let ch = self.relogio.as_ref().unwrap();
        let near = |w: &WorldSnap| receptor_por_outra(cat.pos, cat.radius, w.pellets.iter().map(|p| (p.uid, p.li, p.pos)), uid, None);
        ch.samples.iter().any(|s| near(&s.w)) || ch.clones.iter().filter_map(|id| ch.arena.get(id)).any(|c| c.script.iter().any(|s| near(&s.w)))
    }

    /// na história gravada a partir de `from`, outra bola (não `uid`, não do lançador `li`) chegou ao receptor `c`?
    fn catcher_in_history(catchers: &[crate::world::Catcher], from: &[Arc<Sample>], c: usize, uid: u64, li: Option<usize>) -> bool {
        let Some(cat) = catchers.get(c) else { return false };
        from.iter().any(|s| receptor_por_outra(cat.pos, cat.radius, s.w.pellets.iter().map(|p| (p.uid, p.li, p.pos)), uid, li))
    }

    /// o botão estava apertado também por outra coisa (outro objeto, ou você) naquela foto?
    fn button_held_otherwise(b: &crate::world::FloorButton, s: &WorldSnap, me: Vec3, k: usize) -> bool {
        botao_por_outro(b.pos, s.props.iter().map(|q| (q.p, q.gone)), k, me)
    }

    /// a cada quadro (testes e depuração): regras que a linha do tempo nunca pode quebrar
    pub fn ch_invariants(&self) -> Vec<String> {
        let mut out = vec![];
        let mut seen = HashSet::new();
        for p in &self.energy.pellets {
            if !seen.insert(p.uid) {
                out.push(format!("a bola {} existe duas vezes ao mesmo tempo", p.uid));
            }
        }
        if let Some(ch) = self.relogio.as_ref() {
            if ch.sweep.is_none() && !ch.paused {
                for c in &ch.tb.linha.compromissos {
                    if c.estado == Estado::Pendente && ch.tw > c.t + c.tol + 0.5 {
                        out.push(format!("compromisso de {:.2} s ainda pendente em {:.2} s", c.t, ch.tw));
                    }
                }
            }
        }
        out
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
                        let flip = s.catchers.iter().enumerate().position(|(c, &on)| on && !p0.catchers.get(c).copied().unwrap_or(true) && self.world.catchers.get(c).is_some_and(|x| x.pos.distance(ball.pos) < 1.5));
                        if let Some(c) = flip {
                            // âncora: o receptor ligado por ela. Outra bola chegou a ele depois? então ele
                            // continua ligado sem ela (outro caminho) e ela pode ter entrado no vermelho
                            caught_later = !Self::catcher_in_history(&self.world.catchers, &ch.samples[j..], c, a.uid, a.li);
                            break;
                        }
                        if !s.pellets.iter().any(|q| q.li == a.li) {
                            break;
                        }
                    }
                    found.push((a.li, a.vel, a.life, at, t_hit, caught_later, a.uid));
                }
            }
            self.ch_scan_past_cubes(ecs, oi, from, limit);
            for (li, vel, life, at, t_hit, caught_later, uid) in found {
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
                ch.tb.linha.saidas.push(Saida { uid, t_in: t_hit, t_out: t_hit + o.delta, pos: at, vel, key: o.center, life });
            }
        }
    }

    /// cubos que JÁ estavam na história (antes de você abrir o vermelho): quando o instante mostrado
    /// pelo vermelho chega a um cubo dentro da boca dele, o cubo cai no portal e sai agora pelo ciano
    /// (o cubo de agora é o mesmo: some de onde está e aparece no ciano). Se, depois, esse cubo segurou
    /// um botão na história, tirá-lo de lá é um paradoxo e ele fica onde estava
    fn ch_scan_past_cubes(&mut self, ecs: &mut Ecs, oi: usize, from: f32, limit: f32) {
        let o = self.portals.list[oi].clone();
        let blue = o.partner;
        if !self.portals.list[blue].placed {
            return;
        }
        let key_c = [(o.center.x * 100.0).round() as i32, (o.center.y * 100.0).round() as i32, (o.center.z * 100.0).round() as i32];
        let mut moves: Vec<(usize, Vec3, Quat, Vec3, usize)> = vec![];
        let mut paradox: Vec<Vec3> = vec![];
        {
            let ch = self.relogio.as_mut().unwrap();
            let (i0, i1) = (ch.index_at(from).max(1), ch.index_at(limit));
            for i in i0..=i1 {
                let (a_s, b_s) = (&ch.samples[i - 1], &ch.samples[i]);
                if b_s.t <= from - 1e-6 {
                    continue;
                }
                for (k, pr) in a_s.w.props.iter().enumerate() {
                    let Some(c) = self.props.list.get(k) else { continue };
                    if c.kind != crate::props::Kind::Cube || pr.gone {
                        continue;
                    }
                    let l = o.local(pr.p);
                    let h = c.half.y;
                    if l.z < -0.1 || l.z > h + 0.3 {
                        continue;
                    }
                    if (l.x / (PORTAL_A + 0.08)).powi(2) + (l.y / (PORTAL_B + 0.08)).powi(2) > 1.0 {
                        continue;
                    }
                    if !ch.tb.cube_hits.insert((k, key_c)) {
                        continue;
                    }
                    if c.gone || c.held {
                        continue;
                    }
                    // consequências: depois disso, esse cubo segurou um botão sozinho? (âncora; com outra
                    // coisa em cima do botão ao mesmo tempo, o botão continua apertado sem ele)
                    let mut holds = false;
                    for j in i + 1..ch.samples.len() {
                        let smp = &ch.samples[j];
                        let s = &smp.w;
                        let Some(q) = s.props.get(k) else { break };
                        if q.gone {
                            break;
                        }
                        let on = s.buttons.iter().enumerate().find(|(b, (pressed, _))| *pressed && self.world.buttons.get(*b).is_some_and(|x| x.pos.distance(q.p) < 0.9));
                        if let Some((b, _)) = on {
                            if !Self::button_held_otherwise(&self.world.buttons[b], s, smp.p, k) {
                                holds = true;
                                break;
                            }
                        }
                    }
                    if holds {
                        paradox.push(pr.p);
                        continue;
                    }
                    moves.push((k, pr.p, pr.q, pr.v, i));
                }
            }
        }
        for at in paradox {
            self.ch_paradox_fx("esse cubo do passado segurou um botão depois: ele não pode ter entrado no vermelho", at);
        }
        for (k, p, q, v, from_i) in moves {
            let (mut pos, mut vel) = (p, v);
            let (_, _, rot) = self.portals.carry(oi, &mut pos, &mut vel);
            let quat = rot * q;
            let out = self.portals.list[blue].normal;
            // cai para fora do ciano: no mínimo um empurrãozinho no sentido dele
            let vn = vel.dot(out);
            if vn < 2.5 {
                vel += out * (2.5 - vn);
            }
            let h = self.props.list[k].half.y;
            pos += out * (h * 0.95 + 0.08);
            let ch = self.relogio.as_mut().unwrap();
            ch.free.insert(k);
            ch.driven.remove(&k);
            // a história: daquele instante até agora o cubo não estava mais lá (caiu no portal e ainda
            // não tinha saído); só volta a existir, no ciano, a partir de agora
            for j in from_i..ch.samples.len() {
                let smp = std::sync::Arc::make_mut(&mut ch.samples[j]);
                let w = std::sync::Arc::make_mut(&mut smp.w);
                if let Some(q) = w.props.get_mut(k) {
                    q.gone = true;
                    q.portaled = true;
                }
            }
            self.dissolve(k, crate::dissolver::TIME, false);
            self.props.list[k].place(&mut self.world.phys, pos, Some(quat), Some(vel));
            self.dissolve(k, crate::dissolver::TIME, true);
            self.events.push(GameEvent::PropPortal);
        }
        let _ = ecs;
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
        // você voltou no tempo e um compromisso pede um objeto aqui agora: este (ou um igual a ele) o
        // cumpre — é ele a versão mais velha que já saiu do vermelho lá atrás; ele segue dali, de onde
        // o duplo chegou (o laço fecha, sem outro duplo)
        let at = self.props.list[k].pos;
        let same = |a: &crate::props::Prop, b: &crate::props::Prop| a.kind == b.kind && a.special == b.special && a.redirect == b.redirect;
        let props = &self.props.list;
        let ch = self.relogio.as_mut().unwrap();
        if let Some(i) = ch.tb.linha.cumprir_objeto(k, at, tw, |j| props.get(j).is_some_and(|b| same(&props[k], b))) {
            let Sustenta::Duplo(d) = ch.tb.linha.compromissos[i].sustenta else { return };
            let end = ch.tb.linha.duplos[d].fim();
            ch.free.insert(k);
            ch.driven.remove(&k);
            if let Some((p, q)) = end {
                self.props.list[k].place(&mut self.world.phys, p, Some(q), None);
            }
            self.events.push(GameEvent::PropPortal);
            self.dissolve(k, crate::dissolver::TIME, true);
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
        let d = ch.tb.linha.duplos.len();
        ch.tb.linha.duplos.push(Duplo { k, de: td, ate: tw, nasce: born, track, ativo: true, oculto: false, botoes: vec![], mesh: None });
        // o laço: voltando para antes de agora, um objeto (este ou um igual) tem de entrar aqui de novo
        ch.tb.linha.compromissos.push(Compromisso { quem: Quem::Objeto { k }, t: tw, tol: TOL_T, onde: at, estado: Estado::Cumprido(tw), sustenta: Sustenta::Duplo(d) });
        ch.free.insert(k);
        ch.driven.remove(&k);
        let c = &mut self.props.list[k];
        c.place(&mut self.world.phys, pos, Some(quat), Some(vel));
        self.events.push(GameEvent::PropPortal);
        self.dissolve(k, crate::dissolver::TIME, true);
        let _ = ecs;
    }

    /// a cada quadro: duplos visíveis só dentro do intervalo deles; o objeto real some enquanto
    /// só o duplo existe na história e reaparece onde o duplo chegou. Os botões que o duplo aperta
    /// ficam anotados (as consequências dele: âncoras)
    fn ch_update_doubles(&mut self, ecs: &mut Ecs) {
        let Some(mut ch) = self.relogio.take() else { return };
        if ch.tb.linha.duplos.is_empty() {
            self.relogio = Some(ch);
            return;
        }
        let tw = ch.tw;
        let root = self.world.root();
        let present = bevy::camera::visibility::RenderLayers::layer(PRESENT_LAYER);
        let mut changed = vec![];
        for d in &mut ch.tb.linha.duplos {
            let st = d.em(tw, RATE);
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
                    for (b, btn) in self.world.buttons.iter().enumerate() {
                        if btn.pressed && (btn.pos.x - p.x).hypot(btn.pos.z - p.z) < 0.85 && p.y - btn.pos.y > 0.0 && p.y - btn.pos.y < 1.0 && d.botoes.last().is_none_or(|x| x.0 != b || tw - x.1 > 0.25) {
                            d.botoes.push((b, tw));
                        }
                    }
                }
                None => {
                    ecs.entity_mut(m).insert(Visibility::Hidden);
                }
            }
            if !d.ativo {
                continue;
            }
            let younger_here = tw >= d.nasce - 1e-6;
            if (st.is_some() || tw < d.de) && !younger_here && !c.gone && !c.held {
                changed.push((d.k, false));
                c.vanish(&mut self.world.phys);
                d.oculto = true;
            } else if st.is_none() && d.oculto && tw >= d.ate {
                d.oculto = false;
                c.gone = false;
                if let Some(b) = self.world.phys.body_mut(c.body) {
                    b.set_enabled(true);
                }
                if let Some((p, q)) = d.fim() {
                    c.place(&mut self.world.phys, p, Some(q), None);
                }
                changed.push((d.k, true));
            }
        }
        self.relogio = Some(ch);
        // algo do presente mudou por causa do passado: some (desintegra) ou aparece (materializa)
        for (k, appear) in changed {
            self.dissolve(k, crate::dissolver::TIME, appear);
        }
    }

    /// para a vista do ciano: os duplos e as bolas mandadas ao passado como estavam em T
    pub(super) fn ch_doubles_at(ch: &Chronos, t: f32) -> (Vec<(usize, Vec3, Quat)>, Vec<Vec3>) {
        let ds = ch.tb.linha.duplos.iter().filter_map(|d| d.em(t, RATE).map(|(p, q)| (d.k, p, q))).collect();
        let bs = ch
            .tb
            .linha
            .voos
            .iter()
            .filter(|v| v.ativo && t < v.no_mundo_desde.unwrap_or(f32::INFINITY) - 1e-6)
            .filter_map(|v| v.em(t).map(|x| x.0))
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
