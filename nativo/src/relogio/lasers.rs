//! Lasers pelo par temporal: o feixe que entra no ciano sai do laranja Δ s atrás (gravado e repetido
//! pelas suas versões passadas); com o laranja temporal aberto, o feixe do passado é refeito como era
//! Δ s antes e o que entra no laranja sai agora pelo ciano.

use super::*;
use crate::frontier::{closest, trace_t, LaserEntry, PastCube};

/// laser que uma versão passada sua mandou para o passado: sai de `exit` em `t`, entrou no ciano em `entry_t`
#[derive(Clone, Debug)]
pub(super) struct LaserEmit {
    t: f32,
    entry_t: f32,
    at: Vec3,
    exit: Vec3,
    dir: Vec3,
}

/// as saídas de laser gravadas num trecho de história (para o clone)
pub(super) fn laser_emits(tail: &[Arc<Sample>]) -> Vec<LaserEmit> {
    tail.iter().flat_map(|s| s.lz.iter().map(|e: &LaserEntry| LaserEmit { t: s.t - e.delta, entry_t: s.t, at: e.at, exit: e.exit, dir: e.dir })).collect()
}

const TOL: f32 = RATE * 0.6;

impl Game {
    /// os feixes que as versões passadas mandaram ao passado e saem do laranja delas agora
    pub fn ch_laser_emissions(&self) -> Vec<(Vec3, Vec3)> {
        let Some(ch) = self.relogio.as_ref() else { return vec![] };
        if ch.clones.is_empty() || ch.paused || ch.sweep.is_some() {
            return vec![];
        }
        let mut out: Vec<(Vec3, Vec3)> = vec![];
        for id in &ch.clones {
            let Some(c) = ch.arena.get(id) else { continue };
            for e in &c.laser_emits {
                if (e.t - ch.tw).abs() > TOL || out.iter().any(|x| x.0.distance(e.exit) < 0.2 && x.1.dot(e.dir) > 0.98) {
                    continue;
                }
                out.push((e.exit, e.dir));
            }
        }
        out
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

    /// depois dos feixes do quadro: no instante gravado, o feixe tem de entrar de novo no ciano
    pub fn ch_check_laser_loops(&mut self, dt: f32) {
        let entries = self.frontier.live_entries.clone();
        let Some(ch) = self.relogio.as_mut() else { return };
        if ch.clones.is_empty() || ch.paused || ch.sweep.is_some() {
            return;
        }
        let tw = ch.tw;
        for id in ch.clones.clone() {
            let Some(c) = ch.arena.get_mut(&id) else { continue };
            let need = c.laser_emits.iter().filter(|e| (e.entry_t - tw).abs() <= TOL).last().cloned();
            let Some(need) = need else {
                c.laser_miss = 0.0;
                continue;
            };
            let ok = entries.iter().any(|x| x.at.distance(need.at) < 0.5);
            c.laser_miss = if ok { 0.0 } else { c.laser_miss + dt };
            if c.laser_miss > 0.2 && self.rollback_pending.is_none() {
                self.rollback_pending = Some((c.cp.clone(), "o laser não voltou a entrar no ciano (era ele que saía do vermelho)", Some(need.at)));
                return;
            }
        }
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
