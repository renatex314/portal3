//! Lasers pelo par temporal: o feixe que entra no ciano sai do laranja Δ s atrás (gravado e repetido
//! pelas suas versões passadas); com o laranja temporal aberto, o feixe do passado é refeito como era
//! Δ s antes e o que entra no laranja sai agora pelo ciano.

use super::*;
use crate::frontier::{closest, trace_t, LaserEntry, PastCube};

/// laser que uma versão passada sua mandou para o passado: sai de `exit` em `t`, entrou no ciano em `entry_t`
#[derive(Clone, Debug)]
pub(super) struct LaserEmit {
    pub(super) t: f32,
    pub(super) entry_t: f32,
    pub(super) at: Vec3,
    pub(super) exit: Vec3,
    pub(super) dir: Vec3,
}

/// as saídas de laser gravadas num trecho de história (vão para a linha do tempo no salto)
pub(super) fn laser_emits(tail: &[Arc<Sample>]) -> Vec<LaserEmit> {
    tail.iter().flat_map(|s| s.lz.iter().map(|e: &LaserEntry| LaserEmit { t: s.t - e.delta, entry_t: s.t, at: e.at, exit: e.exit, dir: e.dir })).collect()
}

const TOL: f32 = RATE * 0.6;

impl Game {
    /// os feixes que as versões passadas mandaram ao passado e saem do laranja delas agora:
    /// (emissão na linha do tempo, saída, direção)
    pub fn ch_laser_emissions(&self) -> Vec<(usize, Vec3, Vec3)> {
        let Some(ch) = self.relogio.as_ref() else { return vec![] };
        if ch.clones.is_empty() || ch.paused || ch.sweep.is_some() {
            return vec![];
        }
        ch.tb.linha.emissoes_em(ch.tw, TOL, |id| ch.clones.contains(&id))
    }

    /// o feixe do passado (a emissão `e`) ligou o receptor de laser `c`: uma consequência dela (âncora)
    pub fn ch_laser_lit(&mut self, e: usize, c: usize) {
        let Some(ch) = self.relogio.as_mut() else { return };
        if let Some(em) = ch.tb.linha.emissoes.get_mut(e) {
            if !em.liga.contains(&c) {
                em.liga.push(c);
            }
        }
    }

    /// o feixe que veio do passado acertaria a sua versão passada? (paradoxo)
    pub fn ch_laser_hits_past_self(&mut self, a: Vec3, b: Vec3) {
        let Some(ch) = self.relogio.as_ref() else { return };
        if self.rollback_pending.is_some() {
            return;
        }
        for id in &ch.clones {
            let Some(c) = ch.arena.get(id) else { continue };
            let Some(pose) = clone_pose(c, ch.tw) else { continue };
            if pose.jumped {
                continue;
            }
            let q = closest(a, b, pose.p);
            if (q.x - pose.p.x).hypot(q.z - pose.p.z) < 0.4 && (q.y - pose.p.y).abs() < 0.95 {
                self.rollback_pending = Some((c.cp.clone(), "o laser mandado ao passado acertaria a sua versão passada", Some(q)));
                return;
            }
        }
    }

    /// depois dos feixes do quadro: os que entraram num ciano cumprem os compromissos de laser de
    /// agora (no instante gravado, o feixe tem de entrar de novo ali; os que não entram quebram na
    /// resolução dos compromissos — paradoxo só se o feixe do passado ligou um receptor sozinho)
    pub fn ch_check_laser_loops(&mut self, _dt: f32) {
        let entries: Vec<Vec3> = self.frontier.live_entries.iter().map(|x| x.at).collect();
        let Some(ch) = self.relogio.as_mut() else { return };
        if ch.clones.is_empty() || ch.paused || ch.sweep.is_some() {
            return;
        }
        let tw = ch.tw;
        ch.tb.linha.cumprir_laser(&entries, tw);
    }

    /// o laser do passado: com o laranja temporal aberto, refeito como era Δ s antes (portas e cubos da
    /// foto); o que entra no laranja sai agora pelo ciano — devolve essas saídas. Os trechos do passado
    /// ficam desenhados para a vista do ciano.
    pub fn ch_laser_past(&mut self, ecs: &mut Ecs) -> Vec<(Vec3, Vec3)> {
        let root = self.world.root();
        let oranges: Vec<usize> = if self.relogio.is_some() && !self.world.lasers.is_empty() {
            (0..self.portals.list.len()).filter(|&i| self.portals.list[i].placed && self.portals.list[i].delta > 0.0 && self.portals.is_linked(i)).collect()
        } else {
            vec![]
        };
        if oranges.is_empty() {
            self.frontier.exit_hist.clear();
            self.frontier.draw_past_beams(ecs, root, &[]);
            return vec![];
        }
        let ch = self.relogio.as_ref().unwrap();
        let (tw, live) = (ch.tw, !ch.paused && ch.sweep.is_none());
        self.frontier.exit_hist.retain(|e| e.0 <= tw + 1e-6 && tw - e.0 < 31.0);
        let mut segs: Vec<(Vec3, Vec3)> = vec![];
        let mut extra: Vec<(Vec3, Vec3)> = vec![];
        for oi in oranges {
            let delta = self.portals.list[oi].delta;
            let tt = tw - delta;
            let ch = self.relogio.as_ref().unwrap();
            let snap = ch.samples[ch.index_at(tt)].w.clone();
            let cubes: Vec<PastCube> = self
                .props
                .list
                .iter()
                .enumerate()
                .filter(|(_, c)| c.kind == crate::props::Kind::Cube)
                .filter_map(|(k, c)| snap.props.get(k).filter(|s| !s.gone).map(|s| (s.p, s.q, k, c.redirect)))
                .collect();
            // o feixe que entra no ciano agora sai deste laranja no passado; e o que já saiu do ciano Δ s atrás
            let mut emit: Vec<(Vec3, Vec3)> = self.world.lasers.iter().enumerate().filter(|(k, l)| l.bridge.is_none() && !snap.lasers_off.get(*k).copied().unwrap_or(l.off)).map(|(_, l)| (l.pos, l.dir)).collect();
            emit.extend(self.frontier.prev_entries.iter().filter(|e| self.portals.list[e.blue].partner == oi).map(|e| (e.exit, e.dir)));
            let before = self.frontier.exit_hist.iter().filter(|e| (e.0 - tt).abs() <= RATE).min_by(|a, b| (a.0 - tt).abs().total_cmp(&(b.0 - tt).abs())).map(|e| e.1.clone()).unwrap_or_default();
            emit.extend(before.into_iter().take(8));
            let (s, x) = self.ch_in_past(ecs, delta, |g| {
                let (mut segs, mut extra) = (vec![], vec![]);
                for (o0, d0) in emit {
                    let (mut o, mut d, mut ignore) = (o0, d0, None);
                    for _hop in 0..6 {
                        let res = trace_t(&g.world, &g.portals, None, o, d, ignore, 8, 400.0, true, Some(oi), Some(&cubes));
                        segs.extend(res.segs.iter().map(|s| (s.0, s.1)));
                        if let (Some((p, dir)), Some(at)) = (res.temporal, res.point) {
                            let (mut pos, mut vel) = (at, dir);
                            g.portals.carry(p, &mut pos, &mut vel);
                            let vel = vel.normalize();
                            extra.push((pos + vel * 0.03, vel));
                            break;
                        }
                        let Some(k) = res.prop else { break };
                        let Some(c) = cubes.iter().find(|c| c.2 == k && c.3) else { break };
                        let f = (c.1 * Vec3::Z).normalize();
                        o = c.0 + f * 0.36;
                        d = f;
                        ignore = Some(k);
                    }
                }
                (segs, extra)
            });
            segs.extend(s);
            extra.extend(x);
        }
        self.frontier.draw_past_beams(ecs, root, &segs);
        if live && self.frontier.exit_hist.last().is_none_or(|l| tw - l.0 >= 1.0 / 60.0 - 1e-6) {
            self.frontier.exit_hist.push((tw, extra.clone()));
        }
        extra
    }
}
