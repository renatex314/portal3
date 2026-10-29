//! Relógio do tempo (relogio.js, série Experimento) — inspirado no jogo Flash "Time Experiment"
//! e no mod "Thinking with Time Machine".
//!
//!  • Tecla 2: PAUSA o tempo do mundo (portas, plataformas, bolas de energia, cubos, torretas…).
//!    Você anda, pega e atira à vontade.
//!  • Na pausa, a roda do mouse escolhe Δ (quantos segundos voltar) e o tiro VERMELHO cai nas
//!    paredes daquele instante. O ciano cai no presente.
//!  • Entrar no ciano leva você ao vermelho Δ segundos antes (LOOP FECHADO: uma só linha do
//!    tempo). O mundo volta ao instante de destino e o seu eu que saltou vira um CLONE que repete
//!    o que você fez — pisa em botões — até o momento do salto, quando mergulha no ciano e some.
//!  • O QUE ACONTECEU SE REPETE: cubos e torretas seguem a gravação ("no trilho") até você os
//!    perturbar; o objeto que você leva no salto existe duas vezes até o instante do salto.
//!  • A LINHA DO TEMPO (relogio/linha.rs): bolas, objetos e o laser que vão ao passado têm trechos
//!    de vida lá e compromissos (entrar de novo no ciano na hora). Um compromisso que não se cumpre
//!    só é paradoxo se algo dependia do trecho (um receptor, um botão) e nada mais mantém isso;
//!    coisas iguais (bolas, cubos do mesmo modelo) fazem o papel umas das outras.
//!  • PARADOXO: se o clone não puder repetir o passado, o loop colapsa e você volta ao instante
//!    do salto, com os portais como estavam.

mod bolas;
pub mod linha;
mod lasers;

use crate::game::{Game, GameEvent};
use crate::physics::Ent;
use crate::portals::{PORTAL_A, PORTAL_B};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use rapier3d::prelude::RigidBodyType;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub const RATE: f32 = 1.0 / 30.0;
const KEEP: f32 = 120.0;
const MAX_DELTA: f32 = 30.0;
const STEP: f32 = 0.5;
const MIN_DELTA: f32 = 0.25;
const ECHO: f32 = 0.8;
const MERGE: usize = 12;
const MISPLACED: f32 = 0.6;

fn overlap(a_min: Vec3, a_max: Vec3, b_min: Vec3, b_max: Vec3, eps: f32) -> bool {
    a_min.x < b_max.x - eps && a_max.x > b_min.x + eps && a_min.y < b_max.y - eps && a_max.y > b_min.y + eps && a_min.z < b_max.z - eps && a_max.z > b_min.z + eps
}

// ------------------------------------------------------------------ fotos do mundo
#[derive(Clone, Debug)]
pub struct PropSnap {
    pub p: Vec3,
    pub q: Quat,
    pub v: Vec3,
    pub a: Vec3,
    pub gone: bool,
    /// não existe mais ali POR CAUSA de um portal (caiu no vermelho e foi para o futuro)
    pub portaled: bool,
}

#[derive(Clone, Debug)]
pub struct PelletSnap {
    pub uid: u64,
    pub li: Option<usize>,
    pub pos: Vec3,
    pub vel: Vec3,
    pub life: f32,
    pub cd: f32,
}

#[derive(Clone, Debug, Default)]
pub struct WorldSnap {
    pub doors: Vec<(f32, f32, f32)>,
    pub buttons: Vec<(bool, f32)>,
    pub push: Vec<(bool, f32, Vec<(bool, f32)>)>,
    pub catchers: Vec<bool>,
    pub lasers_off: Vec<bool>,
    pub incin: Vec<bool>,
    pub launchers: Vec<(f32, bool)>,
    pub pellets: Vec<PelletSnap>,
    pub props: Vec<PropSnap>,
}

/// um portal seu num instante: centro, normal, cima, parede e Δ (laranja no passado)
#[derive(Clone, Debug, PartialEq)]
pub struct PFrame {
    pub c: Vec3,
    pub n: Vec3,
    pub u: Vec3,
    pub solid: usize,
    pub delta: f32,
}

#[derive(Clone, Debug, Default)]
pub struct PortalSt {
    pub b: Option<Arc<PFrame>>,
    pub o: Option<Arc<PFrame>>,
}

/// um ponto do caminho andado com o tempo parado
#[derive(Clone, Debug)]
pub struct FrozenPt {
    pub p: Vec3,
    pub up: f32,
    pub grounded: bool,
    pub in_mouth: bool,
}

#[derive(Clone, Debug)]
pub struct Sample {
    pub t: f32,
    pub p: Vec3,
    pub up: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub grounded: bool,
    pub mv: bool,
    pub pt: Arc<PortalSt>,
    /// objeto segurado (índice) ou −1
    pub h: i32,
    /// objetos empurrados
    pub hm: Vec<usize>,
    pub gap: bool,
    /// objetos mexidos com o mundo parado
    pub pm: Vec<usize>,
    pub fz: Option<Arc<Vec<FrozenPt>>>,
    pub arrive: bool,
    pub in_mouth: bool,
    pub w: Arc<WorldSnap>,
    /// feixes que entraram num ciano temporal neste instante (laser mandado ao passado)
    pub lz: Vec<crate::frontier::LaserEntry>,
}

#[derive(Clone, Debug)]
struct Episode {
    k: usize,
    j0: usize,
    j1: usize,
}

/// o que o jogador era logo antes de entrar no ciano (para o desfazer)
#[derive(Clone, Debug)]
pub struct Pre {
    pos: Vec3,
    vel: Vec3,
    yaw: f32,
    pitch: f32,
    up: f32,
}

#[derive(Clone, Debug)]
struct SavedPortal {
    placed: bool,
    c: Vec3,
    n: Vec3,
    u: Vec3,
    solid: Option<usize>,
    delta: f32,
}

#[derive(Clone, Debug)]
pub struct Checkpoint {
    samples: Vec<Arc<Sample>>,
    clones: Vec<u32>,
    tw: f32,
    next: f32,
    arrival: f32,
    w: Arc<WorldSnap>,
    player: Pre,
    entered: SavedPortal,
    blue: SavedPortal,
    orange: SavedPortal,
    loop_n: u32,
    presses: usize,
    fields: usize,
    /// a linha do tempo das bolas como estava (o loop desfeito não aconteceu)
    linha: linha::Linha,
}

/// a versão passada sua que refaz a gravação
pub struct CloneData {
    pub id: u32,
    pub born: f32,
    pub end: f32,
    script: Vec<Arc<Sample>>,
    eps: Vec<Episode>,
    /// o objeto que viajou com você: a cópia do passado (índice e o modelo cinza)
    echo: Option<(usize, Entity)>,
    pub ghost: Option<crate::characters::Dino>,
    cp: Arc<Checkpoint>,
    exit: (Vec3, Vec3, Vec3),
    echoed: bool,
    closed: bool,
    fz_last: Option<f32>,
    marker: Option<Entity>,
    /// o par de portais (cinza) que o clone disparou, e o que está mostrado em cada um
    pair: Option<(usize, usize)>,
    shown: [Option<Arc<PFrame>>; 2],
    /// vermelhos temporais que essa versão abriu (de, até, quadro): no passado dela eles aparecem
    /// como um vermelho de estática (ghostWindows de relogio.js)
    ghost_wins: Option<Vec<(f32, f32, Arc<PFrame>)>>,
}

pub struct Sweep {
    tail: Vec<Arc<Sample>>,
    t: f32,
    dur: f32,
}

pub struct Chronos {
    pub paused: bool,
    pub tw: f32,
    /// tempo "visual" do mundo (só anda quando o mundo anda)
    pub vt: f32,
    pub delta: f32,
    delta_goal: Option<f32>,
    pub samples: Vec<Arc<Sample>>,
    pub clones: Vec<u32>,
    arena: HashMap<u32, CloneData>,
    clone_seq: u32,
    arrival: f32,
    pub sweep: Option<Sweep>,
    frozen_props: bool,
    next: f32,
    pre: Option<Pre>,
    pub blocked: bool,
    gap: bool,
    frozen_path: Option<Vec<FrozenPt>>,
    mark_arrive: bool,
    /// objetos no trilho (índice → clone de onde vem a gravação)
    driven: HashMap<usize, u32>,
    free: HashSet<usize>,
    snap: HashSet<usize>,
    pub paradoxes: u32,
    pub rollbacks: u32,
    /// voltas completas (cada salto bem-sucedido: os apertos e campos passam a ser "do passado")
    pub loop_n: u32,
    /// vezes em que um objeto igual fez o papel do que o seu passado usou (para os testes)
    pub stand_ins: u32,
    /// apertos de botões na linha do tempo: (tw, botão, volta)
    pub presses: Vec<(f32, usize, u32)>,
    press_last: f32,
    /// a marca do laranja no passado ("−N s")
    eco: Option<(Entity, Entity, Handle<StandardMaterial>, Handle<Image>, f32, bool)>,
    /// holograma do passado na pausa
    holo: Option<Holo>,
    /// a sala Δ s atrás, vista pelo ciano temporal (cópias numa camada só da câmera daquele portal)
    past: PastView,
    /// bolas e objetos pelo par temporal, torretas do passado
    tb: bolas::TimeBalls,
    pub said_pause: u32,
    /// efeitos de tela: tempo desde o salto e o paradoxo (0 = acabou)
    pub fx_jump: f32,
    pub fx_paradox: f32,
    /// o último paradoxo (o porquê), para o letreiro
    pub paradox_why: Option<(String, f32)>,
    /// pedidos para o pós-processamento: (aberração, túnel, onda grande)
    pub fx_kick: Option<(f32, f32, bool)>,
}

struct Holo {
    root: Entity,
    doors: HashMap<usize, Entity>,
    props: HashMap<usize, Entity>,
    pellets: Vec<Entity>,
    me: Option<crate::characters::Dino>,
    mat: Handle<crate::fx::Fx>,
}

impl Chronos {

    pub fn new() -> Self {
        Chronos {
            paused: false,
            tw: 0.0,
            vt: 0.0,
            delta: 5.0,
            delta_goal: None,
            samples: vec![],
            clones: vec![],
            arena: HashMap::new(),
            clone_seq: 0,
            arrival: f32::NEG_INFINITY,
            sweep: None,
            frozen_props: false,
            next: 0.0,
            pre: None,
            blocked: false,
            gap: false,
            frozen_path: None,
            mark_arrive: false,
            driven: HashMap::new(),
            free: HashSet::new(),
            snap: HashSet::new(),
            paradoxes: 0,
            rollbacks: 0,
            loop_n: 0,
            stand_ins: 0,
            presses: vec![],
            press_last: 0.0,
            eco: None,
            holo: None,
            past: PastView::default(),
            tb: Default::default(),
            said_pause: 0,
            fx_jump: 0.0,
            fx_paradox: 0.0,
            paradox_why: None,
            fx_kick: None,
        }
    }

    pub fn frozen(&self) -> bool {
        self.paused || self.sweep.is_some()
    }

    fn index_at(&self, t: f32) -> usize {
        let s = &self.samples;
        let i = ((t - s[0].t) / RATE + 1e-6).floor() as i64;
        i.clamp(0, s.len() as i64 - 1) as usize
    }

    /// limite do Δ: a história guardada e 30 s
    pub fn max_delta(&self) -> f32 {
        (self.tw - self.samples[0].t).clamp(0.0, MAX_DELTA)
    }

    fn clone_pose(&self, c: &CloneData, t: f32) -> Option<ClonePose> {
        clone_pose(c, t)
    }

    pub fn open_until(&self) -> f32 {
        self.clones.iter().filter_map(|id| self.arena.get(id)).map(|c| c.end).filter(|&e| e > self.tw + 1e-3).fold(0.0, f32::max)
    }

    /// quantos clones estão agindo agora
    pub fn live_clones(&self) -> usize {
        self.clones.iter().filter_map(|id| self.arena.get(id)).filter(|c| clone_pose(c, self.tw).is_some()).count()
    }

    /// pés dos clones agora (eles pisam em botões)
    pub fn feet(&self) -> Vec<Vec3> {
        self.clones.iter().filter_map(|id| self.arena.get(id)).filter_map(|c| clone_pose(c, self.tw)).map(|p| p.p + Vec3::new(0.0, -0.9 * p.up, 0.0)).collect()
    }

    /// cópias do passado (do objeto que viajou com você) que apertam botões agora
    pub fn echoes(&self) -> Vec<Vec3> {
        let mut out = vec![];
        for id in &self.clones {
            let Some(c) = self.arena.get(id) else { continue };
            let Some((k, _)) = c.echo else { continue };
            if clone_pose(c, self.tw).is_none() {
                continue;
            }
            if let Some(st) = prop_at(&c.script, (self.tw - c.script[0].t) / RATE, k) {
                if !st.gone && !st.held {
                    out.push(st.p);
                }
            }
        }
        // os duplos (a versão mais velha de um objeto mandado ao passado) também apertam botões
        out.extend(self.tb.linha.duplos.iter().filter_map(|d| d.em(self.tw, RATE).map(|x| x.0)));
        out
    }

    /// o objeto `k` está sendo segurado por um clone agora? (não aperta botão)
    pub fn clone_held(&self, k: usize) -> bool {
        self.driven.get(&k).and_then(|id| self.arena.get(id)).is_some_and(|c| prop_at(&c.script, (self.tw - c.script[0].t) / RATE, k).is_some_and(|s| s.held))
    }
}

impl Default for Chronos {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
struct ClonePose {
    p: Vec3,
    yaw: f32,
    up: f32,
    mv: bool,
    grounded: bool,
    jumped: bool,
    in_mouth: bool,
}

fn clone_pose(c: &CloneData, t: f32) -> Option<ClonePose> {
    let s = &c.script;
    if t < c.born - 1e-6 || t > c.end + 1e-6 {
        return None;
    }
    let f = (t - s[0].t) / RATE;
    let i = (f.floor().max(0.0) as usize).min(s.len() - 1);
    let a = &s[i];
    let b = &s[(i + 1).min(s.len() - 1)];
    // um salto de posição entre dois quadros guardados (tempo parado, portal): sem interpolar
    let jumped = b.gap || b.arrive || a.p.distance(b.p) > 2.5;
    let k = if jumped { 0.0 } else { (f - i as f32).clamp(0.0, 1.0) };
    Some(ClonePose { p: a.p.lerp(b.p, k), yaw: a.yaw + (b.yaw - a.yaw) * k, up: a.up, mv: a.mv && !jumped, grounded: a.grounded, jumped, in_mouth: a.in_mouth || b.in_mouth })
}

struct PropAt {
    p: Vec3,
    q: Quat,
    v: Vec3,
    a: Vec3,
    gone: bool,
    portaled: bool,
    held: bool,
}

/// estado gravado do objeto `k` no quadro fracionário `f` do script
fn prop_at(script: &[Arc<Sample>], f: f32, k: usize) -> Option<PropAt> {
    let i = (f.floor().max(0.0) as usize).min(script.len() - 1);
    let a = &script[i];
    let b = &script[(i + 1).min(script.len() - 1)];
    let pa = a.w.props.get(k)?;
    let pb = b.w.props.get(k);
    let smooth = pb.is_some_and(|pb| !b.gap && !pa.gone && !pb.gone && pa.p.distance(pb.p) < 2.5);
    let t = if smooth { (f - i as f32).clamp(0.0, 1.0) } else { 0.0 };
    let (bp, bq) = if smooth { let pb = pb.unwrap(); (pb.p, pb.q) } else { (pa.p, pa.q) };
    Some(PropAt { p: pa.p.lerp(bp, t), q: pa.q.slerp(bq, t), v: pa.v, a: pa.a, gone: pa.gone, portaled: pa.portaled, held: a.h == k as i32 })
}

/// trechos do script em que você mexeu em cada objeto
/// o corpo (caixa mn–mx) entra mais de `eps` na peça? Pela forma de verdade: a caixa alinhada aos eixos
/// de uma peça girada ou convexa (mapas importados, paredes em diagonal, rampas) é bem maior que ela —
/// perto de uma, no ar, o corpo "encostava" e o seu passado acusava um bloqueio que não existe
fn solid_touches(b: &crate::world::Solid, mn: Vec3, mx: Vec3, eps: f32) -> bool {
    if !overlap(mn, mx, b.min, b.max, eps) {
        return false;
    }
    let planes: Vec<(Vec3, f32)> = if let Some(pl) = &b.planes {
        pl.iter().map(|p| (p.n, p.d)).collect()
    } else if let Some(o) = &b.obb {
        let mut v = vec![];
        for k in 0..3 {
            for sgn in [1.0f32, -1.0] {
                let mut a = Vec3::ZERO;
                a[k] = sgn;
                let n = o.q * a;
                v.push((n, n.dot(o.c) + o.half[k]));
            }
        }
        v
    } else {
        return true;
    };
    // a caixa encolhida da folga: separada por algum plano da peça? então não entra nela
    let (a, b2) = (mn + Vec3::splat(eps), mx - Vec3::splat(eps));
    let mut corners = [Vec3::ZERO; 8];
    for (i, c) in corners.iter_mut().enumerate() {
        *c = Vec3::new(if i & 1 == 0 { a.x } else { b2.x }, if i & 2 == 0 { a.y } else { b2.y }, if i & 4 == 0 { a.z } else { b2.z });
    }
    !planes.iter().any(|(n, d)| corners.iter().all(|c| n.dot(*c) > *d))
}

/// a partir do quadro `from`, a gravação passa a dizer que o seu passado usou o objeto `j` no lugar de `k`
/// (e o `k` fez o que o `j` fazia): troca os dois em cada foto, no objeto segurado e nos empurrados
fn swap_in_script(script: &mut [Arc<Sample>], from: usize, k: usize, j: usize) {
    let sw = |x: usize| if x == k { j } else if x == j { k } else { x };
    for smp in script.iter_mut().skip(from) {
        let s = Arc::make_mut(smp);
        if s.h >= 0 {
            s.h = sw(s.h as usize) as i32;
        }
        s.hm.iter_mut().for_each(|x| *x = sw(*x));
        s.pm.iter_mut().for_each(|x| *x = sw(*x));
        let w = Arc::make_mut(&mut s.w);
        if k < w.props.len() && j < w.props.len() {
            w.props.swap(k, j);
        }
    }
}

fn episodes(script: &[Arc<Sample>], skip: i32) -> Vec<Episode> {
    let mut open: HashMap<usize, Episode> = HashMap::new();
    let mut out = vec![];
    for (j, s) in script.iter().enumerate() {
        let mut ks: HashSet<usize> = s.hm.iter().chain(s.pm.iter()).copied().collect();
        if s.h >= 0 {
            ks.insert(s.h as usize);
        }
        for k in ks {
            if k as i32 == skip {
                continue;
            }
            match open.get_mut(&k) {
                Some(e) if j - e.j1 <= MERGE => e.j1 = j,
                Some(e) => {
                    out.push(e.clone());
                    *e = Episode { k, j0: j, j1: j };
                }
                None => {
                    open.insert(k, Episode { k, j0: j, j1: j });
                }
            }
        }
    }
    out.extend(open.into_values());
    out
}

// ------------------------------------------------------------------ o relógio no jogo
impl Game {
    /// o holograma da pausa: (grupo, o seu eu do passado) — para os testes
    pub fn ch_holo_entities(&self) -> Option<(Entity, Option<Entity>)> {
        self.relogio.as_ref()?.holo.as_ref().map(|h| (h.root, h.me.as_ref().map(|m| m.root)))
    }

    pub fn ch_linha(&self) -> Option<&linha::Linha> {
        self.relogio.as_deref().map(|c| &c.tb.linha)
    }

    pub fn ch(&self) -> Option<&Chronos> {
        self.relogio.as_deref()
    }

    /// foto do mundo agora
    fn snapshot(&mut self) -> WorldSnap {
        let w = &mut self.world;
        let push: Vec<(bool, f32, Vec<(bool, f32)>)> = (0..w.push_buttons.len())
            .map(|i| {
                let ch = w.push_chans(i).iter().map(|c| (c.on, c.left)).collect();
                (w.push_buttons[i].on, w.push_buttons[i].left, ch)
            })
            .collect();
        WorldSnap {
            doors: w.doors.iter().map(|d| (d.open, d.target, d.wait)).collect(),
            buttons: w.buttons.iter().map(|b| (b.pressed, b.count)).collect(),
            push,
            catchers: w.catchers.iter().map(|c| c.active).collect(),
            lasers_off: w.lasers.iter().map(|l| l.off).collect(),
            incin: w.incinerators.iter().map(|i| i.active).collect(),
            launchers: w.launchers.iter().map(|l| (l.wait, l.done)).collect(),
            pellets: self.energy.pellets.iter().map(|p| PelletSnap { uid: p.uid, li: p.from, pos: p.pos, vel: p.vel, life: p.life, cd: p.cooldown }).collect(),
            props: self
                .props
                .list
                .iter()
                .map(|c| {
                    let (v, a) = w.phys.body(c.body).map(|b| (b.linvel(), b.angvel())).unwrap_or_default();
                    PropSnap { p: c.pos, q: c.quat, v, a, gone: c.gone, portaled: false }
                })
                .collect(),
        }
    }

    fn portal_state(&self, ch: &Chronos) -> Arc<PortalSt> {
        let old = ch.samples.last().map(|s| s.pt.clone());
        let fr = |i: usize, old: Option<&Arc<PFrame>>| -> Option<Arc<PFrame>> {
            let p = &self.portals.list[i];
            if !p.placed {
                return None;
            }
            let f = PFrame { c: p.center, n: p.normal, u: p.up, solid: p.solid?, delta: p.delta.max(0.0) };
            match old {
                Some(o) if **o == f => Some(o.clone()),
                _ => Some(Arc::new(f)),
            }
        };
        let b = fr(0, old.as_ref().and_then(|o| o.b.as_ref()));
        let o = fr(1, old.as_ref().and_then(|o| o.o.as_ref()));
        if let Some(old) = old {
            let same = |x: &Option<Arc<PFrame>>, y: &Option<Arc<PFrame>>| match (x, y) {
                (Some(a), Some(b)) => Arc::ptr_eq(a, b),
                (None, None) => true,
                _ => false,
            };
            if same(&old.b, &b) && same(&old.o, &o) {
                return old;
            }
        }
        Arc::new(PortalSt { b, o })
    }

    /// cubos que você está empurrando (perto e se mexendo): o clone também os empurra
    fn pushed(&self, ch: &Chronos) -> Vec<usize> {
        let prev = ch.samples.last().map(|s| s.w.clone());
        let mut out = vec![];
        for (k, p) in self.props.list.iter().enumerate() {
            let Some(q) = prev.as_ref().and_then(|w| w.props.get(k).cloned()) else { continue };
            if self.held == Some(k) || p.gone || p.kind != crate::props::Kind::Cube || q.gone || ch.driven.contains_key(&k) {
                continue;
            }
            let pl = &self.player;
            if (p.pos.x - pl.pos.x).hypot(p.pos.z - pl.pos.z) < 1.0 && (p.pos.y - pl.pos.y).abs() < 1.4 && p.pos.distance(q.p) > 0.012 {
                out.push(k);
            }
        }
        out
    }

    fn in_mouth(&self) -> bool {
        !self.portals.mouths(self.player.pos, true, 0.5).is_empty() || self.player.cooldown > -0.4
    }

    fn ch_record(&mut self, t: f32) {
        let Some(mut ch) = self.relogio.take() else { return };
        let w = Arc::new(self.snapshot());
        let pt = self.portal_state(&ch);
        let hm = self.pushed(&ch);
        // primeiro quadro depois de uma pausa: os objetos que mudaram de lugar foram mexidos por você
        let (gap, pm, fz) = if ch.gap {
            ch.gap = false;
            let prev = ch.samples.last().map(|s| s.w.clone());
            let pm = self
                .props
                .list
                .iter()
                .enumerate()
                .filter(|(k, p)| prev.as_ref().and_then(|w| w.props.get(*k)).is_some_and(|q| q.gone != p.gone || (!p.gone && p.pos.distance(q.p) > 0.05)))
                .map(|(k, _)| k)
                .collect();
            let fz = ch.frozen_path.take().filter(|f| f.len() > 1).map(Arc::new);
            (true, pm, fz)
        } else {
            (false, vec![], None)
        };
        let pl = &self.player;
        let s = Sample {
            t,
            p: pl.pos,
            up: pl.up_sign,
            yaw: pl.yaw,
            pitch: pl.pitch,
            grounded: pl.grounded,
            mv: pl.grounded && Vec3::new(pl.vel.x, 0.0, pl.vel.z).length_squared() > 0.4,
            pt,
            h: self.held.map(|h| h as i32).unwrap_or(-1),
            hm,
            gap,
            pm,
            fz,
            arrive: ch.mark_arrive,
            in_mouth: self.in_mouth(),
            w,
            lz: self.frontier.live_entries.clone(),
        };
        ch.mark_arrive = false;
        ch.samples.push(Arc::new(s));
        while ch.samples.len() > 2 && t - ch.samples[0].t > KEEP {
            ch.samples.remove(0);
        }
        self.relogio = Some(ch);
    }

    /// começa o relógio da fase
    pub fn ch_start(&mut self) {
        self.relogio = Some(Box::new(Chronos::new()));
        self.ch_record(0.0);
        if let Some(ch) = self.relogio.as_mut() {
            ch.next = RATE;
        }
    }

    /// põe o mundo exatamente como estava na foto (o jogador não é mexido)
    fn ch_restore(&mut self, ecs: &mut Ecs, snap: &WorldSnap, keep: Option<usize>, pellets: bool) {
        let mut moved = vec![];
        for (k, d) in self.world.doors.iter_mut().enumerate() {
            let Some(s) = snap.doors.get(k) else { continue };
            if (d.open - s.0).abs() > 1e-5 {
                moved.push(d.solid);
            }
            d.open = s.0;
            d.target = s.1;
            d.wait = s.2;
            d.instant = true;
        }
        for k in 0..self.world.push_buttons.len() {
            let st = snap.push.get(k);
            self.world.push_buttons[k].on = st.is_some_and(|s| s.0);
            self.world.push_buttons[k].left = st.map(|s| s.1).unwrap_or(0.0);
            let chans = self.world.push_chans(k);
            for (j, c) in chans.iter_mut().enumerate() {
                match st.and_then(|s| s.2.get(j)) {
                    Some(v) => {
                        c.on = v.0;
                        c.left = v.1;
                    }
                    // (gravação sem este canal: o estado do começo)
                    None => {
                        c.on = c.mode == "unlatch";
                        c.left = 0.0;
                    }
                }
            }
        }
        for (k, b) in self.world.buttons.iter_mut().enumerate() {
            let s = snap.buttons.get(k);
            b.pressed = s.is_some_and(|s| s.0);
            b.count = s.map(|s| s.1).unwrap_or(0.0);
        }
        for (k, c) in self.world.catchers.iter_mut().enumerate() {
            c.active = snap.catchers.get(k).copied().unwrap_or(false);
        }
        for (k, f) in self.world.incinerators.iter_mut().enumerate() {
            f.active = snap.incin.get(k).copied().unwrap_or(false);
        }
        if pellets {
            // bolas de energia, pela identidade: reaproveita, cria as que faltam, tira as que sobram
            let mut want: HashMap<u64, PelletSnap> = snap.pellets.iter().map(|p| (p.uid, p.clone())).collect();
            let mut i = 0;
            while i < self.energy.pellets.len() {
                let uid = self.energy.pellets[i].uid;
                match want.remove(&uid) {
                    Some(w) => {
                        self.energy.set_pellet(ecs, i, w.pos, w.vel, w.life, w.cd);
                        i += 1;
                    }
                    None => self.energy.kill_pub(ecs, &mut self.world, i),
                }
            }
            for w in want.into_values() {
                let li = w.li.filter(|&l| self.world.launchers.get(l).is_some_and(|l| l.pellet.is_none()));
                let i = self.energy.spawn(ecs, &self.world, w.pos, w.vel, w.life, li);
                if let Some(l) = li {
                    self.world.launchers[l].pellet = Some(i);
                }
                self.energy.pellets[i].uid = w.uid;
                self.energy.set_pellet(ecs, i, w.pos, w.vel, w.life, w.cd);
            }
            for (k, l) in self.world.launchers.iter_mut().enumerate() {
                if let Some(s) = snap.launchers.get(k) {
                    l.wait = s.0;
                    l.done = s.1;
                }
            }
        }
        for k in 0..self.props.list.len() {
            if Some(k) == keep {
                continue;
            }
            let Some(s) = snap.props.get(k) else { continue };
            let c = &mut self.props.list[k];
            if s.gone {
                if !c.gone {
                    c.vanish(&mut self.world.phys);
                }
                continue;
            }
            if c.gone {
                c.gone = false;
                if let Some(b) = self.world.phys.body_mut(c.body) {
                    b.set_enabled(true);
                }
            }
            c.place(&mut self.world.phys, s.p, Some(s.q), Some(s.v));
            if let Some(b) = self.world.phys.body_mut(c.body) {
                b.set_angvel(s.a, true);
            }
        }
        // portas e plataformas andam para onde estavam (e não esmagam quem está no caminho)
        let vt = self.relogio.as_ref().map(|c| c.vt).unwrap_or(self.t);
        self.world.update(ecs, vt, 0.0);
        for d in &mut self.world.doors {
            d.delta = Vec3::ZERO;
        }
        for s in moved {
            let b = self.world.solids[s].clone();
            let p = &mut self.player;
            let pen = [0, 1, 2].map(|a| (p.pos[a] + p.half[a] - b.min[a]).min(b.max[a] - (p.pos[a] - p.half[a])));
            if pen.iter().any(|&v| v <= 0.02) {
                continue;
            }
            let i = (0..3).min_by(|&x, &y| pen[x].partial_cmp(&pen[y]).unwrap()).unwrap();
            p.pos[i] += if p.pos[i] > (b.min[i] + b.max[i]) / 2.0 { 1.0 } else { -1.0 } * (pen[i] + 0.01);
        }
    }

    /// roda `f` com as portas/plataformas nas posições de Δ s atrás (raios, colocar o vermelho)
    pub fn ch_in_past<R>(&mut self, ecs: &mut Ecs, delta: f32, f: impl FnOnce(&mut Game) -> R) -> R {
        let (snap, vt) = {
            let ch = self.relogio.as_ref().unwrap();
            (ch.samples[ch.index_at(ch.tw - delta)].w.clone(), ch.vt)
        };
        let saved: Vec<(f32, f32)> = self.world.doors.iter().map(|d| (d.open, d.target)).collect();
        for (k, d) in self.world.doors.iter_mut().enumerate() {
            if let Some(s) = snap.doors.get(k) {
                d.open = s.0;
                d.target = s.0;
            }
        }
        self.world.update(ecs, vt, 0.0);
        let r = f(self);
        for (k, d) in self.world.doors.iter_mut().enumerate() {
            d.open = saved[k].0;
            d.target = saved[k].1;
        }
        self.world.update(ecs, vt, 0.0);
        for d in &mut self.world.doors {
            d.delta = Vec3::ZERO;
        }
        r
    }

    // ------------------------------------------------------------------ pausa
    pub fn ch_pause(&mut self) {
        let Some(ch) = self.relogio.as_mut() else { return };
        if ch.sweep.is_some() {
            return;
        }
        let on = !ch.paused;
        ch.paused = on;
        if on {
            ch.frozen_path = Some(vec![]);
            let max = ch.max_delta().max(MIN_DELTA);
            ch.delta = ch.delta.clamp(MIN_DELTA, max);
            ch.delta_goal = Some(ch.delta);
        } else {
            ch.gap = true;
        }
        self.ch_track_frozen();
        self.ch_set_freeze(on);
        self.events.push(GameEvent::Freeze(on));
        let ch = self.relogio.as_mut().unwrap();
        // parar/continuar o tempo: uma onda de distorção abrindo do centro da tela
        ch.fx_kick = Some((if on { 0.45 } else { 0.3 }, 0.0, true));
        if on {
            ch.said_pause += 1;
            if ch.said_pause <= 2 {
                self.toast("Tempo parado. Roda do mouse: quantos segundos voltar. Vermelho = passado, ciano = presente.");
            }
        }
    }

    /// com o tempo parado: o caminho que você anda (um ponto a cada ~25 cm)
    fn ch_track_frozen(&mut self) {
        // na boca: o centro no meio dela (in_mouth), ou o corpo na região de um portal ligado (em alta
        // velocidade, o quadro antes de atravessar pega o corpo já entrando na parede, fora do centro)
        let pos = self.player.pos;
        let near_portal = (0..self.portals.list.len()).any(|i| {
            let p = &self.portals.list[i];
            if !self.portals.is_linked(i) {
                return false;
            }
            let l = p.local(pos);
            l.x.abs() < PORTAL_A + 0.45 && l.y.abs() < PORTAL_B + 0.45 && l.z > -1.6 && l.z < 1.6
        });
        let in_mouth = self.in_mouth() || near_portal;
        let pl = &self.player;
        let Some(ch) = self.relogio.as_mut() else { return };
        let Some(path) = ch.frozen_path.as_mut() else { return };
        if let Some(last) = path.last_mut() {
            if last.p.distance(pl.pos) < 0.25 && last.grounded == pl.grounded {
                return;
            }
            // um salto entre dois pontos seguidos é um portal atravessado: os dois lados estão na boca
            if last.p.distance(pl.pos) > 1.5 {
                last.in_mouth = true;
                if path.len() <= 4000 {
                    path.push(FrozenPt { p: pl.pos, up: pl.up_sign, grounded: pl.grounded, in_mouth: true });
                }
                return;
            }
        }
        if path.len() > 4000 {
            return;
        }
        path.push(FrozenPt { p: pl.pos, up: pl.up_sign, grounded: pl.grounded, in_mouth });
    }

    /// na pausa os cubos/torretas ficam fixos no lugar (ainda colidem); o que você segura continua solto
    fn ch_set_freeze(&mut self, on: bool) {
        if let Some(ch) = self.relogio.as_mut() {
            ch.frozen_props = on;
        }
        for c in &mut self.props.list {
            if c.gone {
                continue;
            }
            let Some(b) = self.world.phys.body_mut(c.body) else { continue };
            if on {
                c.frozen_v = Some((b.linvel(), b.angvel()));
            } else if c.frozen_bt {
                b.set_body_type(RigidBodyType::Dynamic, true);
                if let Some((v, a)) = c.frozen_v {
                    b.set_linvel(v, true);
                    b.set_angvel(a, true);
                }
                c.frozen_bt = false;
            }
        }
    }

    fn ch_sync_freeze(&mut self) {
        for (k, c) in self.props.list.iter_mut().enumerate() {
            if c.gone {
                continue;
            }
            let want = self.held != Some(k);
            if c.frozen_bt != want {
                if let Some(b) = self.world.phys.body_mut(c.body) {
                    if want {
                        b.set_body_type(RigidBodyType::KinematicPositionBased, true);
                    } else {
                        b.set_body_type(RigidBodyType::Dynamic, true);
                        b.set_linvel(Vec3::ZERO, true);
                    }
                }
                c.frozen_bt = want;
            }
        }
    }

    /// roda do mouse / Z X na pausa: move o ALVO do Δ
    pub fn ch_scrub_by(&mut self, seconds: f32) {
        let Some(ch) = self.relogio.as_mut() else { return };
        if !ch.paused {
            return;
        }
        let max = ch.max_delta().max(MIN_DELTA);
        let from = ch.delta_goal.unwrap_or(ch.delta);
        ch.delta_goal = Some((from + seconds).clamp(MIN_DELTA, max));
    }

    /// o Δ anda até o alvo; um "tique" a cada meio segundo atravessado
    fn ch_smooth_delta(&mut self, real_dt: f32) {
        let Some(ch) = self.relogio.as_mut() else { return };
        let Some(goal) = ch.delta_goal else { return };
        let before = ch.delta;
        let k = 1.0 - (-real_dt.max(1.0 / 240.0) * 14.0).exp();
        ch.delta += (goal - ch.delta) * k;
        if (goal - ch.delta).abs() < 0.004 {
            ch.delta = goal;
        }
        if (before / STEP).floor() != (ch.delta / STEP).floor() {
            self.events.push(GameEvent::Scrub);
        }
    }

    // ------------------------------------------------------------------ quadro
    /// devolve o quanto o mundo avança neste quadro (0 = parado)
    pub fn ch_frame(&mut self, ecs: &mut Ecs, dt: f32, real_dt: f32) -> f32 {
        let Some(ch) = self.relogio.as_mut() else { return dt };
        ch.fx_jump = (ch.fx_jump - real_dt).max(0.0);
        ch.fx_paradox = (ch.fx_paradox - real_dt).max(0.0);
        if let Some((_, t)) = ch.paradox_why.as_mut() {
            *t -= real_dt;
            if *t <= 0.0 {
                ch.paradox_why = None;
            }
        }
        ch.pre = Some(Pre { pos: self.player.pos, vel: self.player.vel, yaw: self.player.yaw, pitch: self.player.pitch, up: self.player.up_sign });
        if ch.sweep.is_some() {
            self.ch_sync_freeze();
            self.ch_step_sweep(ecs, dt);
            self.ch_sync_all(ecs, real_dt);
            return 0.0;
        }
        if ch.paused {
            self.ch_sync_freeze();
            self.ch_track_frozen();
            self.ch_smooth_delta(real_dt);
            self.ch_holo_update(ecs);
            self.ch_sync_all(ecs, real_dt);
            self.ch_drive_props();
            return 0.0;
        }
        // o tempo voltou a andar: o holograma do passado (só da pausa) some
        if ch.holo.is_some() {
            self.ch_set_holo(ecs, false);
        }
        let ch = self.relogio.as_mut().unwrap();
        ch.tw += dt;
        ch.vt += dt;
        loop {
            let ch = self.relogio.as_mut().unwrap();
            if ch.tw < ch.next {
                break;
            }
            let n = ch.next;
            ch.next += RATE;
            self.ch_record(n);
        }
        self.ch_sync_all(ecs, real_dt);
        self.ch_replay_presses();
        if !self.ch_drive_props() {
            self.ch_check_paradox(ecs, dt);
        }
        dt
    }

    /// com o relógio: os apertos das suas versões do passado acontecem de novo na hora certa
    fn ch_replay_presses(&mut self) {
        let Some(ch) = self.relogio.as_mut() else { return };
        let tw = ch.tw;
        let last = ch.press_last;
        ch.press_last = tw;
        if tw <= last {
            return;
        }
        let todo: Vec<usize> = ch.presses.iter().filter(|e| e.2 < ch.loop_n && e.0 > last && e.0 <= tw).map(|e| e.1).collect();
        for i in todo {
            if i < self.world.push_buttons.len() {
                self.world.press_button(i);
                self.events.push(GameEvent::Press(i));
            }
        }
    }

    fn ch_sync_all(&mut self, ecs: &mut Ecs, real_dt: f32) {
        let Some(mut ch) = self.relogio.take() else { return };
        let t = self.t;
        let first_t = ch.samples[0].t;
        let ids = ch.clones.clone();
        let mut drop_ids = vec![];
        for id in ids {
            let tw = ch.tw;
            let Some(c) = ch.arena.get_mut(&id) else { continue };
            let pose = clone_pose(c, tw);
            sync_clone_portals(&mut self.portals, c, tw, pose.is_some());
            let Some(pose) = pose else {
                if let Some((_, e)) = c.echo {
                    ecs.entity_mut(e).insert(Visibility::Hidden);
                }
                if let Some(g) = &c.ghost {
                    ecs.entity_mut(g.root).insert(Visibility::Hidden);
                }
                if let Some(m) = c.marker {
                    ecs.entity_mut(m).insert(Visibility::Hidden);
                }
                if c.end < first_t - 1.0 {
                    drop_ids.push(id);
                }
                continue;
            };
            if tw < c.end - ECHO - 0.02 {
                c.echoed = false;
                c.closed = false;
            }
            if c.ghost.is_none() {
                c.ghost = Some(make_ghost(ecs, self.world.root()));
            }
            let g = c.ghost.as_mut().unwrap();
            let feet = pose.p + Vec3::new(0.0, -0.9 * pose.up, 0.0);
            g.pose = if pose.mv { "walk".into() } else { "idle".into() };
            g.speed = Some(4.5);
            ecs.entity_mut(g.root).insert((
                Transform::from_translation(feet).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, pose.yaw + std::f32::consts::PI, if pose.up < 0.0 { std::f32::consts::PI } else { 0.0 })),
                Visibility::Inherited,
            ));
            g.animate(ecs, t, real_dt);
            // a cópia do passado do objeto que viajou com você
            if let Some((k, e)) = c.echo {
                match prop_at(&c.script, (tw - c.script[0].t) / RATE, k) {
                    Some(st) if !st.gone => {
                        let off = self.props.list.get(k).map(|p| p.mesh_offset).unwrap_or_default();
                        ecs.entity_mut(e).insert((Transform::from_translation(st.q * off + st.p).with_rotation(st.q), Visibility::Inherited));
                    }
                    _ => {
                        ecs.entity_mut(e).insert(Visibility::Hidden);
                    }
                }
            }
            // o ciano de saída do clone: um portal em tons de cinza, sempre visível
            if c.marker.is_none() {
                c.marker = Some(clone_marker(ecs, self.world.root(), c.exit));
            }
            if let Some(m) = c.marker {
                ecs.entity_mut(m).insert(Visibility::Inherited);
            }
            // últimos instantes: o azul "eco" abre para o clone mergulhar
            if !c.echoed && tw > c.end - ECHO {
                c.echoed = true;
                self.events.push(GameEvent::Echo(true));
            }
            if !c.closed && tw >= c.end - 0.05 {
                c.closed = true;
                self.events.push(GameEvent::Echo(false));
            }
        }
        for id in drop_ids {
            if let Some(c) = ch.arena.get_mut(&id) {
                drop_clone_visuals(ecs, c);
            }
            ch.clones.retain(|x| *x != id);
        }
        // pares de clones que não existem mais nesta história (paradoxo, salto para antes deles)
        for i in 2..self.portals.list.len() {
            let gone = self.portals.list[i].owner.as_deref().and_then(|o| o.strip_prefix("clone")).and_then(|n| n.parse::<u32>().ok()).is_some_and(|id| !ch.clones.contains(&id));
            if gone && self.portals.list[i].placed {
                self.portals.list[i].remove();
            }
        }
        self.relogio = Some(ch);
        self.ch_update_eco(ecs);
        self.ch_ghost_statics();
    }

    /// os vermelhos do passado abertos neste instante do mundo: um vermelho de estática onde a sua
    /// versão do futuro abriu o vermelho temporal (setGhostStatics de relogio.js)
    fn ch_ghost_statics(&mut self) {
        let mut frames: Vec<Arc<PFrame>> = vec![];
        if let Some(ch) = self.relogio.as_mut() {
            let tw = ch.tw;
            for id in ch.clones.clone() {
                let Some(c) = ch.arena.get_mut(&id) else { continue };
                let wins = c.ghost_wins.get_or_insert_with(|| {
                    let mut out: Vec<(f32, f32, Arc<PFrame>)> = vec![];
                    for smp in &c.script {
                        let Some(o) = &smp.pt.o else { continue };
                        if !(o.delta > 0.0) || smp.pt.b.is_none() {
                            continue;
                        }
                        let t = smp.t - o.delta;
                        if let Some(last) = out.last_mut() {
                            if Arc::ptr_eq(&last.2, o) && t - last.1 < RATE * 1.5 {
                                last.1 = t;
                                continue;
                            }
                        }
                        out.push((t, t, o.clone()));
                    }
                    out
                });
                for (from, to, f) in wins.iter() {
                    if tw >= from - 1e-6 && tw <= to + RATE && !frames.iter().any(|g| g.c.distance(f.c) < 0.3) {
                        frames.push(f.clone());
                    }
                }
            }
        }
        for (k, st) in self.portals.statics.iter_mut().enumerate() {
            match frames.get(k) {
                Some(f) => {
                    if !st.placed || st.center.distance(f.c) > 1e-3 || st.normal.dot(f.n) < 0.999 {
                        st.set_frame(f.c, f.n, f.u, Some(f.solid));
                    }
                    // as bolas que batem nele entram (e saem pelo ciano Δ s depois)
                    st.delta = f.delta;
                }
                None => {
                    if st.placed {
                        st.remove();
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ objetos no trilho
    /// o viajante (você, depois do salto) mexeu nesse objeto? então ele sai do trilho
    fn ch_disturbed(&self, ch: &Chronos, k: usize, st: &PropAt) -> bool {
        if self.held == Some(k) {
            return true;
        }
        let prop = &self.props.list[k];
        let h = prop.half;
        let (pmin, pmax) = (prop.pos - h, prop.pos + h);
        let pl = &self.player;
        if overlap(pl.pos - pl.half - Vec3::splat(0.06), pl.pos + pl.half + Vec3::splat(0.06), pmin, pmax, 0.0) && pl.vel.x.hypot(pl.vel.z) > 0.3 {
            return true;
        }
        for &o in &ch.free {
            if o == k {
                continue;
            }
            let op = &self.props.list[o];
            if !op.gone && overlap(op.pos - op.half, op.pos + op.half, pmin, pmax, -0.03) {
                return true;
            }
        }
        // um portal seu (que não existia na gravação) no caminho gravado
        for i in 0..2 {
            let p = &self.portals.list[i];
            if !p.placed || p.delta > 0.0 || self.portals.list[p.partner].delta > 0.0 || !self.portals.is_linked(i) {
                continue;
            }
            let a = p.local(prop.pos);
            let b = p.local(st.p);
            if a.z.signum() != b.z.signum() && (a.z - b.z).abs() < 2.5 {
                let kk = a.z / (a.z - b.z);
                let x = a.x + (b.x - a.x) * kk;
                let y = a.y + (b.y - a.y) * kk;
                if (x / (PORTAL_A + 0.3)).powi(2) + (y / (PORTAL_B + 0.3)).powi(2) <= 1.0 {
                    return true;
                }
            }
        }
        // uma porta/plataforma diferente da gravação perto dele
        if let Some(src) = rail_source(ch) {
            let s = &src.script[index_in(src, ch.tw)].w;
            for (k2, d) in self.world.doors.iter().enumerate() {
                let Some(was) = s.doors.get(k2) else { continue };
                if (was.0 - d.open).abs() < 0.05 {
                    continue;
                }
                let b = &self.world.solids[d.solid];
                if overlap(b.min - Vec3::splat(0.4), b.max + Vec3::splat(0.4), pmin, pmax, 0.0) {
                    return true;
                }
            }
        }
        false
    }

    /// sai do trilho: continua com a velocidade gravada (a física assume)
    fn ch_leave_rail(&mut self, k: usize, st: Option<PropAt>, frozen: bool) {
        let Some(st) = st else { return };
        let c = &mut self.props.list[k];
        if st.gone || c.gone || self.held == Some(k) {
            return;
        }
        let (p, q) = (c.pos, c.quat);
        c.place(&mut self.world.phys, p, Some(q), if frozen { None } else { Some(st.v) });
        if !frozen {
            if let Some(b) = self.world.phys.body_mut(c.body) {
                b.set_angvel(st.a, true);
            }
        }
    }

    /// Depois de um salto, o mundo refaz a gravação: cada cubo/torreta fica no trilho até você o
    /// perturbar. Os usos que o seu passado faz de um objeto são obrigatórios. true = paradoxo.
    fn ch_drive_props(&mut self) -> bool {
        let Some(mut ch) = self.relogio.take() else { return false };
        if ch.sweep.is_some() {
            self.relogio = Some(ch);
            return false;
        }
        let tw = ch.tw;
        // os usos que os clones fazem agora
        for id in ch.clones.clone() {
            let Some(c) = ch.arena.get(&id) else { continue };
            if c.eps.is_empty() || clone_pose(c, tw).is_none() {
                continue;
            }
            let f = (tw - c.script[0].t) / RATE;
            let echo_k = c.echo.map(|e| e.0);
            for e in c.eps.clone() {
                if f < e.j0 as f32 - 1e-6 || f >= (e.j1 + 1) as f32 || echo_k == Some(e.k) {
                    continue;
                }
                let Some(prop) = self.props.list.get(e.k) else { continue };
                let Some(st) = prop_at(&c.script, f, e.k) else { continue };
                // âncora: o seu passado usa este objeto agora. Se ele não pode (foi para o futuro por um
                // vermelho, está na sua mão, saiu do lugar), outro igual que esteja onde ele estaria faz
                // o papel dele (outro caminho); só sem nenhum é paradoxo. "O lugar" é onde o seu passado o
                // encontrou: a foto de logo antes de ele começar a usá-lo (mexido com o tempo parado, a foto
                // do instante já o tem onde ele o deixou)
                let found = e.j0.checked_sub(1).and_then(|j| prop_at(&c.script, j as f32, e.k)).filter(|q| !q.gone).map(|q| q.p).unwrap_or(st.p);
                let misplaced = |p: Vec3| p.distance(found).min(p.distance(st.p)) > MISPLACED;
                let why = if st.gone {
                    // o seu passado usa um cubo que, nesta história, já caiu num vermelho e foi para o futuro
                    if !st.portaled {
                        continue;
                    }
                    Some("o seu passado usou um cubo que já tinha entrado no vermelho")
                } else if self.held == Some(e.k) {
                    Some("você pegou o objeto que o seu passado estava usando")
                } else if ch.free.contains(&e.k) && (prop.gone || misplaced(prop.pos)) {
                    Some("o objeto que o seu passado usou não estava mais no lugar")
                } else {
                    None
                };
                if let Some(why) = why {
                    let at = prop.pos;
                    let fi = f.floor().max(0.0) as usize;
                    let want = if st.gone { c.script[..fi.min(c.script.len())].iter().rev().find_map(|s| s.w.props.get(e.k).filter(|q| !q.gone).map(|q| q.p)) } else { Some(found) };
                    let busy: Vec<usize> = c.eps.iter().filter(|x| f >= x.j0 as f32 - 1e-6 && f < (x.j1 + 1) as f32).map(|x| x.k).collect();
                    let sub = want.and_then(|w| self.ch_stand_in(e.k, w, &busy));
                    let Some(j) = sub else {
                        let cp = c.cp.clone();
                        self.relogio = Some(ch);
                        self.ch_rollback_later(cp, why, Some(at));
                        return true;
                    };
                    let echo = c.echo.map(|x| x.0 as i32).unwrap_or(-1);
                    let c = ch.arena.get_mut(&id).unwrap();
                    swap_in_script(&mut c.script, fi, e.k, j);
                    c.eps = episodes(&c.script, echo);
                    ch.free.insert(e.k);
                    ch.snap.remove(&e.k);
                    ch.free.remove(&j);
                    ch.snap.insert(j);
                    ch.stand_ins += 1;
                    break;
                }
                if ch.free.contains(&e.k) {
                    ch.free.remove(&e.k);
                    ch.snap.insert(e.k);
                }
            }
        }
        let src_id = rail_source(&ch).map(|c| c.id);
        let frozen = ch.frozen_props;
        let mut next = HashMap::new();
        for k in 0..self.props.list.len() {
            let was = ch.driven.get(&k).copied();
            let st = src_id.and_then(|sid| {
                let src = &ch.arena[&sid];
                if src.echo.map(|e| e.0) == Some(k) || ch.free.contains(&k) {
                    None
                } else {
                    prop_at(&src.script, (tw - src.script[0].t) / RATE, k)
                }
            });
            let Some(st) = st else {
                if let Some(w) = was {
                    let wst = ch.arena.get(&w).and_then(|c| prop_at(&c.script, (tw - c.script[0].t) / RATE, k));
                    self.ch_leave_rail(k, wst, frozen);
                }
                continue;
            };
            let prop = &self.props.list[k];
            if was == src_id || ch.snap.contains(&k) {
                if !ch.snap.contains(&k) && self.ch_disturbed(&ch, k, &st) {
                    ch.free.insert(k);
                    self.ch_leave_rail(k, Some(st), frozen);
                    continue;
                }
            } else if prop.gone != st.gone || (!st.gone && prop.pos.distance(st.p) > 0.2) {
                // entrou numa gravação nova mas não está como ela diz: segue livre
                ch.free.insert(k);
                if was.is_some() {
                    self.ch_leave_rail(k, Some(st), frozen);
                }
                continue;
            }
            ch.snap.remove(&k);
            let c = &mut self.props.list[k];
            if st.gone {
                if !c.gone {
                    c.vanish(&mut self.world.phys);
                }
            } else {
                if c.gone {
                    c.gone = false;
                    if let Some(b) = self.world.phys.body_mut(c.body) {
                        b.set_enabled(true);
                    }
                }
                c.place(&mut self.world.phys, st.p, Some(st.q), None);
            }
            next.insert(k, src_id.unwrap());
        }
        ch.driven = next;
        self.relogio = Some(ch);
        false
    }

    /// um objeto igual a `k` (mesmo tipo e mesmo modelo), solto, que não está na sua mão nem em uso pelo
    /// seu passado agora, e que está onde `k` deveria estar: ele faz o papel de `k`
    fn ch_stand_in(&self, k: usize, at: Vec3, busy: &[usize]) -> Option<usize> {
        let a = self.props.list.get(k)?;
        self.props
            .list
            .iter()
            .enumerate()
            .filter(|(j, b)| *j != k && !busy.contains(j) && self.held != Some(*j) && !b.gone && b.kind == a.kind && b.special == a.special && b.redirect == a.redirect && b.pos.distance(at) <= MISPLACED)
            .min_by(|x, y| x.1.pos.distance(at).total_cmp(&y.1.pos.distance(at)))
            .map(|(j, _)| j)
    }

    // ------------------------------------------------------------------ colocar o vermelho no passado
    /// tiro vermelho com Δ: o raio vê as paredes (portas) do instante tw − Δ
    pub fn ch_place_orange(&mut self, ecs: &mut Ecs, origin: Vec3, dir: Vec3) -> bool {
        let delta = self.relogio.as_ref().map(|c| c.delta).unwrap_or(0.0);
        let tw = self.relogio.as_ref().map(|c| c.tw);
        self.ch_in_past(ecs, delta, |g| {
            // mirou num cubo (como ele estava no passado): o portal abre na superfície mais perto dele
            let (origin, dir) = g.ch_past_cube_target(origin, dir, delta).unwrap_or((origin, dir));
            let hit = g.world.raycast(origin, dir, 400.0);
            if hit.as_ref().is_some_and(|h| g.world.solids[h.solid].kbody.is_some()) {
                g.toast("Não dá para abrir portal numa porta que se mexe, no passado.");
                return false;
            }
            let Game { portals, world, .. } = g;
            let ok = portals.try_place(world, crate::portals::ORANGE, origin, dir, false).ok;
            if ok {
                portals.list[1].delta = delta;
                portals.list[1].placed_tw = tw;
                portals.list[1].fixed = false;
            }
            ok
        })
    }

    /// o raio de quem mira (com o passado à mostra) passa por um cubo como ele estava em tw − Δ? Então o
    /// portal abre na superfície mais perto dele (o chão embaixo, ou a parede onde ele encosta), como se
    /// o tiro tivesse acertado o cubo: devolve a origem e a direção do tiro de verdade
    fn ch_past_cube_target(&self, origin: Vec3, dir: Vec3, delta: f32) -> Option<(Vec3, Vec3)> {
        let ch = self.relogio.as_ref()?;
        let snap = &ch.samples[ch.index_at(ch.tw - delta)].w;
        let limit = self.world.raycast(origin, dir, 400.0).map(|h| h.dist).unwrap_or(400.0);
        let mut best: Option<(f32, Vec3, f32)> = None;
        for (k, pr) in snap.props.iter().enumerate() {
            let Some(c) = self.props.list.get(k) else { continue };
            if c.kind != crate::props::Kind::Cube || pr.gone {
                continue;
            }
            let h = c.half.y;
            let (mut t0, mut t1) = (0.0f32, limit);
            let mut miss = false;
            for a in 0..3 {
                let (lo, hi) = (pr.p[a] - h, pr.p[a] + h);
                if dir[a].abs() < 1e-9 {
                    if origin[a] < lo || origin[a] > hi {
                        miss = true;
                        break;
                    }
                    continue;
                }
                let (mut ta, mut tb) = ((lo - origin[a]) / dir[a], (hi - origin[a]) / dir[a]);
                if ta > tb {
                    std::mem::swap(&mut ta, &mut tb);
                }
                t0 = t0.max(ta);
                t1 = t1.min(tb);
                if t0 > t1 {
                    miss = true;
                    break;
                }
            }
            if !miss && best.is_none_or(|b| t0 < b.0) {
                best = Some((t0, pr.p, h));
            }
        }
        let (_, c, h) = best?;
        // a superfície mais perto do cubo (as que aceitam portal têm prioridade)
        let ok = |hit: &crate::world::RayHit| self.world.solids[hit.solid].portal_at(hit.normal);
        let mut surf: Option<crate::world::RayHit> = None;
        for d in [Vec3::NEG_Y, Vec3::X, Vec3::NEG_X, Vec3::Z, Vec3::NEG_Z, Vec3::Y] {
            let Some(hit) = self.world.raycast(c, d, h + 0.7) else { continue };
            let better = match &surf {
                None => true,
                Some(s) => (ok(&hit) && !ok(s)) || (ok(&hit) == ok(s) && hit.dist < s.dist - 0.05),
            };
            if better {
                surf = Some(hit);
            }
        }
        let s = surf?;
        Some((s.point + s.normal * 1.2, -s.normal))
    }

    /// o espaço de chegada (no vermelho, no instante de destino) está ocupado?
    fn ch_destination_blocked(&mut self, ecs: &mut Ecs, sample: &Sample) -> bool {
        let o = self.portals.list[1].clone();
        if !(o.placed && o.delta > 0.0) {
            return false;
        }
        let half = self.player.half;
        let need = o.normal.x.abs() * half.x + o.normal.z.abs() * half.z + 0.05;
        let mut pos = o.center + o.normal * if o.normal.y.abs() > 0.5 { half.y + 0.1 } else { need };
        if o.normal.y.abs() < 0.5 {
            pos.y = pos.y.max(o.center.y - 0.1);
        }
        let (mn, mx) = (pos - half, pos + half);
        let snap = sample.w.clone();
        let t = sample.t;
        self.ch_in_past(ecs, o.delta, |g| {
            if g.world.solids.iter().enumerate().any(|(i, b)| g.world.listed(i) && overlap(mn, mx, b.min, b.max, 0.1)) {
                return true;
            }
            let ch = g.relogio.as_ref().unwrap();
            for id in &ch.clones {
                if let Some(p) = ch.arena.get(id).and_then(|c| clone_pose(c, t)) {
                    if overlap(mn, mx, p.p - half, p.p + half, 0.05) {
                        return true;
                    }
                }
            }
            // (um cubo que cai neste vermelho logo depois não bloqueia a chegada: ele sai de lá)
            let ch = g.relogio.as_ref().unwrap();
            let falling = ch.samples.get((ch.index_at(ch.tw - o.delta) + 1).min(ch.samples.len() - 1)).map(|s| s.w.clone());
            snap.props.iter().enumerate().any(|(k, p)| !p.gone && !falling.as_ref().is_some_and(|f| f.props.get(k).is_some_and(|q| q.portaled)) && overlap(mn, mx, p.p - Vec3::splat(0.32), p.p + Vec3::splat(0.32), 0.05))
        })
    }

    // ------------------------------------------------------------------ o salto
    fn ch_checkpoint(&mut self, blue: usize) -> Checkpoint {
        let frame = |p: &crate::portals::Portal| SavedPortal { placed: p.placed, c: p.center, n: p.normal, u: p.up, solid: p.solid, delta: p.delta };
        let w = Arc::new(self.snapshot());
        let ch = self.relogio.as_ref().unwrap();
        Checkpoint {
            samples: ch.samples.clone(),
            clones: ch.clones.clone(),
            tw: ch.tw,
            next: ch.next,
            arrival: ch.arrival,
            w,
            player: ch.pre.clone().unwrap_or(Pre { pos: self.player.pos, vel: self.player.vel, yaw: self.player.yaw, pitch: self.player.pitch, up: self.player.up_sign }),
            entered: frame(&self.portals.list[blue]),
            blue: frame(&self.portals.list[0]),
            orange: frame(&self.portals.list[1]),
            loop_n: ch.loop_n,
            presses: ch.presses.len(),
            linha: ch.tb.linha.clone(),
            fields: self.field.events.len(),
        }
    }

    /// o jogador atravessou o ciano temporal (já levado ao vermelho pelo portal)
    pub fn ch_jump(&mut self, ecs: &mut Ecs, blue: usize) -> bool {
        let orange = self.portals.list[blue].partner;
        let delta = self.portals.list[orange].delta;
        if !(delta > 0.0) || self.relogio.is_none() {
            return false;
        }
        // o que você fez com o mundo parado logo antes de saltar também é passado
        {
            let ch = self.relogio.as_mut().unwrap();
            if (ch.paused || ch.gap) && ch.samples.len() > 1 {
                let last = ch.samples.pop().unwrap();
                ch.gap = true;
                let pre = ch.pre.clone();
                self.ch_record(last.t);
                let ch = self.relogio.as_mut().unwrap();
                if let (Some(s), Some(pre)) = (ch.samples.last_mut(), pre) {
                    let s = Arc::make_mut(s);
                    s.p = pre.pos;
                    s.yaw = pre.yaw;
                    s.pitch = pre.pitch;
                    s.up = pre.up;
                }
            }
        }
        let cp = Arc::new(self.ch_checkpoint(blue));
        let ch = self.relogio.as_ref().unwrap();
        let td = ch.tw - delta;
        if td < ch.samples[0].t - 1e-6 {
            self.ch_rollback(ecs, cp, "não há história guardada tão longe assim", None);
            return false;
        }
        let i = ch.index_at(td);
        let tail: Vec<Arc<Sample>> = ch.samples[i..].to_vec();
        let dest = ch.samples[i].w.clone();
        // 1) o mundo volta ao instante de destino
        self.ch_restore(ecs, &dest, self.held, true);
        // 2) o destino não pode estar ocupado
        if self.ch_player_blocked(&[orange]) {
            self.ch_rollback(ecs, cp, "o destino está ocupado", None);
            return false;
        }
        {
            let ch = self.relogio.as_mut().unwrap();
            ch.driven.clear();
            ch.free.clear();
            ch.snap.clear();
        }
        // 3) o objeto segurado viaja com você; até o instante do salto ele existe duas vezes
        let held_k = self.held.map(|h| h as i32).unwrap_or(-1);
        let mut echo = None;
        if let Some(h) = self.held {
            let pos = self.player.eye() + self.player.forward() * 1.4;
            let q = self.props.list[h].quat;
            self.props.list[h].place(&mut self.world.phys, pos, Some(q), None);
            echo = Some((h, make_echo(ecs, self.world.root(), &self.props.list[h])));
        }
        // 4) o seu passado vira um clone
        let exit = (self.portals.list[blue].center, self.portals.list[blue].normal, self.portals.list[blue].up);
        let ch = self.relogio.as_mut().unwrap();
        let mut keep = vec![];
        for id in ch.clones.clone() {
            if ch.arena.get(&id).is_some_and(|c| c.end >= td) {
                keep.push(id);
            } else if let Some(c) = ch.arena.get_mut(&id) {
                drop_clone_visuals(ecs, c);
            }
        }
        ch.clones = keep;
        ch.clone_seq += 1;
        let id = ch.clone_seq;
        let born = ch.samples[i].t;
        let end = tail.last().unwrap().t;
        let eps = episodes(&tail, held_k);
        // a linha do tempo: o trecho da sua versão passada (com as âncoras de caminho) e o laser que ela
        // mandou ao passado (cada entrada no ciano é um compromisso; a saída do vermelho, uma emissão)
        ch.tb.linha.trechos.push(linha::Trecho { clone: id, de: born, ate: end, ruim: [0.0; 5] });
        for e in lasers::laser_emits(&tail) {
            let i = ch.tb.linha.emissoes.len();
            ch.tb.linha.emissoes.push(linha::Emissao { clone: id, t: e.t, entrada: e.entry_t, at: e.at, exit: e.exit, dir: e.dir, ativo: true, liga: vec![] });
            ch.tb.linha.compromissos.push(linha::Compromisso { quem: linha::Quem::Laser { clone: id }, t: e.entry_t, tol: linha::TOL_LASER, onde: e.at, estado: linha::Estado::Pendente, sustenta: linha::Sustenta::Emissao(i) });
        }
        ch.arena.insert(id, CloneData { id, born, end, script: tail, eps, echo, ghost: None, cp, exit, echoed: false, closed: false, fz_last: None, marker: None, pair: None, shown: [None, None], ghost_wins: None });
        ch.clones.push(id);
        ch.samples.truncate(i + 1);
        ch.tw = ch.samples[i].t;
        ch.next = ch.tw + RATE;
        ch.arrival = ch.tw;
        ch.mark_arrive = true;
        ch.loop_n += 1;
        // 5) os portais se desfazem; o mundo já aparece no instante de chegada (sem mostrar o
        // "rebobinar": a duração 0 encerra a varredura no primeiro quadro)
        let tail_sweep = ch.arena[&id].script.clone();
        ch.paused = false;
        self.portals.fizzle();
        self.ch_set_freeze(true);
        self.ch_set_holo(ecs, false);
        let ch = self.relogio.as_mut().unwrap();
        ch.sweep = Some(Sweep { tail: tail_sweep, t: 0.0, dur: 0.0 });
        ch.fx_jump = 0.8;
        ch.fx_kick = Some((1.1, 1.0, false));
        self.events.push(GameEvent::TimeJump(delta));
        self.toast(&crate::i18n::tlv("Você voltou {d} s no tempo.", &[("d", crate::world::fmt_num(delta))]));
        true
    }

    /// o destino está ocupado? (o corpo, saindo do vermelho, entra numa peça sólida ou num objeto)
    fn ch_player_blocked(&self, mouths: &[usize]) -> bool {
        let pl = &self.player;
        let m = 0.1;
        let (mn, mx) = (pl.pos - pl.half + Vec3::splat(m), pl.pos + pl.half - Vec3::splat(m));
        for i in self.world.solid_ids() {
            let b = &self.world.solids[i];
            if b.disabled || !overlap(mn, mx, b.min, b.max, 0.0) {
                continue;
            }
            if !mouths.is_empty() && self.portals.passes(&self.world.solids, i, mouths, mn, mx) {
                continue;
            }
            if let Some(planes) = &b.planes {
                let mut corners = Vec::with_capacity(8);
                for x in [mn.x, mx.x] {
                    for y in [mn.y, mx.y] {
                        for z in [mn.z, mx.z] {
                            corners.push(Vec3::new(x, y, z));
                        }
                    }
                }
                if planes.iter().any(|pl| corners.iter().all(|c| pl.n.dot(*c) > pl.d)) {
                    continue;
                }
            }
            return true;
        }
        self.props.list.iter().any(|c| !c.gone && overlap(mn, mx, c.pos - Vec3::splat(0.3), c.pos + Vec3::splat(0.3), 0.05))
    }

    /// "rebobina" o trecho que você viveu (T_j → T_d) com o mundo parado
    fn ch_step_sweep(&mut self, ecs: &mut Ecs, dt: f32) {
        let Some(ch) = self.relogio.as_mut() else { return };
        let Some(s) = ch.sweep.as_mut() else { return };
        s.t += dt;
        let k = (s.t / s.dur).min(1.0);
        let idx = ((1.0 - k) * (s.tail.len() - 1) as f32).round() as usize;
        let snap = s.tail[idx].w.clone();
        let done = k >= 1.0;
        let last = ch.samples.last().unwrap().w.clone();
        if !done {
            self.ch_restore(ecs, &snap, self.held, false);
            // as bolas não aparecem no "rebobinar"
            for p in &self.energy.pellets {
                ecs.entity_mut(p.group).insert(Visibility::Hidden);
            }
        } else {
            let ch = self.relogio.as_mut().unwrap();
            ch.sweep = None;
            self.ch_restore(ecs, &last, self.held, true);
            for p in &self.energy.pellets {
                ecs.entity_mut(p.group).insert(Visibility::Inherited);
            }
            self.ch_set_freeze(false);
        }
    }

    // ------------------------------------------------------------------ paradoxo
    fn ch_pose_problems(&self, p: Vec3, up: f32, grounded: bool, in_mouth: bool) -> (bool, bool, bool, bool, bool) {
        let half = self.player.half;
        let (mn, mx) = (p - half, p + half);
        let mut solid = false;
        if !in_mouth {
            solid = self.world.solid_ids().any(|i| solid_touches(&self.world.solids[i], mn, mx, 0.14));
        }
        let ch = self.relogio.as_ref().unwrap();
        let cube = self.props.list.iter().enumerate().any(|(k, c)| !c.gone && !c.held && !ch.driven.contains_key(&k) && overlap(mn, mx, c.pos - Vec3::splat(0.3), c.pos + Vec3::splat(0.3), 0.08));
        let hazard = self.world.hazards.iter().any(|&h| overlap(mn, mx, self.world.solids[h].min, self.world.solids[h].max, 0.05)) || self.world.incinerators.iter().any(|f| overlap(mn, mx, f.min, f.max, 0.05));
        let ball = self.energy.pellets.iter().any(|b| b.pos.clamp(mn, mx).distance(b.pos) < 0.34);
        let mut no_floor = false;
        if grounded && up > 0.0 {
            let feet = p + Vec3::new(0.0, -half.y + 0.25, 0.0);
            let (hx, hz) = (half.x - 0.05, half.z - 0.05);
            let hit = [(0.0, 0.0), (hx, hz), (-hx, hz), (hx, -hz), (-hx, -hz)].iter().any(|&(x, z)| self.world.raycast(feet + Vec3::new(x, 0.0, z), Vec3::NEG_Y, 0.75).is_some())
                || self.world.solids.iter().any(|b| b.bridge && !b.removed && feet.x + hx > b.min.x && feet.x - hx < b.max.x && feet.z + hz > b.min.z && feet.z - hz < b.max.z && b.max.y <= feet.y + 0.05 && b.max.y >= feet.y - 0.75);
            let on_prop = self.props.list.iter().any(|c| !c.gone && (c.pos.x - p.x).abs() < 0.5 && (c.pos.z - p.z).abs() < 0.5 && (c.pos.y + 0.3 - (p.y - half.y)).abs() < 0.5);
            no_floor = !hit && !on_prop;
        }
        (solid, cube, hazard, ball, no_floor)
    }

    fn ch_check_paradox(&mut self, ecs: &mut Ecs, dt: f32) {
        let ids = self.relogio.as_ref().map(|c| c.clones.clone()).unwrap_or_default();
        for id in ids {
            // o caminho andado com o tempo parado: conferido inteiro quando o clone chega naquele instante
            if let Some((why, at, cp)) = self.ch_check_frozen_paths(id) {
                self.ch_rollback(ecs, cp, why, Some(at));
                return;
            }
            let ch = self.relogio.as_ref().unwrap();
            let tw = ch.tw;
            let Some(c) = ch.arena.get(&id) else { continue };
            let Some(pose) = clone_pose(c, tw) else { continue };
            if pose.jumped || tw < c.born + 0.25 || tw > c.end - 0.05 {
                continue;
            }
            let (solid, cube, hazard, ball, no_floor) = self.ch_pose_problems(pose.p, pose.up, pose.grounded, pose.in_mouth);
            // as âncoras de caminho do trecho dela, cada uma com a sua folga (linha::CAMINHO)
            let ch = self.relogio.as_mut().unwrap();
            let why = ch.tb.linha.conferir_caminho(id, [solid, cube, hazard, ball, no_floor], dt);
            if let Some(why) = why {
                let cp = ch.arena[&id].cp.clone();
                self.ch_rollback(ecs, cp, why, Some(pose.p));
                return;
            }
        }
    }

    /// diagnóstico (paradoxo-caminho.json, na pasta de dados do jogo): o caminho andado com o tempo parado,
    /// os portais daquele instante e as peças em que o corpo entrou — para achar um bloqueio que não devia
    fn ch_dump_blocked(&self, fz: &[FrozenPt], frames: &[Arc<PFrame>], at: Vec3) {
        let half = self.player.half;
        let (mn, mx) = (at - half, at + half);
        let solids: Vec<serde_json::Value> = self
            .world
            .solid_ids()
            .filter(|&i| solid_touches(&self.world.solids[i], mn, mx, 0.14))
            .map(|i| {
                let b = &self.world.solids[i];
                serde_json::json!({ "i": i, "min": b.min.to_array(), "max": b.max.to_array(), "mat": b.mat, "planos": b.planes.as_ref().map(|p| p.len()), "girada": b.obb.is_some(), "porta": b.kbody.is_some() })
            })
            .collect();
        let v = serde_json::json!({
            "fase": self.level.and_then(|l| self.levels.get(l)).map(|l| format!("{} {}", l.id, l.name)),
            "ponto": at.to_array(),
            "pecas": solids,
            "portais": frames.iter().map(|f| serde_json::json!({ "c": f.c.to_array(), "n": f.n.to_array(), "delta": f.delta })).collect::<Vec<_>>(),
            "portais_agora": self.portals.list.iter().filter(|p| p.placed).map(|p| serde_json::json!({ "c": p.center.to_array(), "n": p.normal.to_array(), "delta": p.delta })).collect::<Vec<_>>(),
            "caminho": fz.iter().map(|q| serde_json::json!([q.p.x, q.p.y, q.p.z, q.in_mouth, q.grounded])).collect::<Vec<_>>(),
        });
        // (testes: na pasta temporária, nunca na de quem joga)
        let dir = if std::env::var("PORTAL3_MUTE").is_ok() { std::env::temp_dir() } else { crate::menu::data_dir() };
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("paradoxo-caminho.json"), serde_json::to_string_pretty(&v).unwrap_or_default());
    }

    /// o caminho que o seu passado andou com o tempo parado, conferido contra o mundo de agora
    fn ch_check_frozen_paths(&mut self, id: u32) -> Option<(&'static str, Vec3, Arc<Checkpoint>)> {
        let ch = self.relogio.as_mut().unwrap();
        let tw = ch.tw;
        let c = ch.arena.get_mut(&id)?;
        if c.fz_last.is_none_or(|l| tw < l - 1e-6) {
            c.fz_last = Some(c.fz_last.unwrap_or(f32::NEG_INFINITY).min(tw));
        }
        let last = c.fz_last.unwrap();
        // (com os portais que a sua versão passada tinha abertos nesse trecho — os de antes da pausa e os
        // colocados com o tempo parado: perto da boca deles, o corpo entra na parede de propósito)
        let mut todo = vec![];
        for (j, s) in c.script.iter().enumerate() {
            if let Some(fz) = &s.fz {
                if s.t > last + 1e-6 && s.t <= tw + 1e-6 {
                    let mut frames: Vec<Arc<PFrame>> = vec![];
                    for pt in [Some(&s.pt), j.checked_sub(1).map(|i| &c.script[i].pt)].into_iter().flatten() {
                        frames.extend([pt.b.clone(), pt.o.clone()].into_iter().flatten());
                    }
                    todo.push((s.t, fz.clone(), frames));
                }
            }
        }
        let cp = c.cp.clone();
        let near = |frames: &[Arc<PFrame>], p: Vec3| {
            frames.iter().any(|f| {
                let d = p - f.c;
                let right = f.u.cross(f.n).normalize_or_zero();
                let (lx, ly, lz) = (d.dot(right), d.dot(f.u), d.dot(f.n));
                lx.abs() < PORTAL_A + 0.45 && ly.abs() < PORTAL_B + 0.45 && lz > -1.6 && lz < 1.6
            })
        };
        for (t, fz, frames) in todo {
            self.relogio.as_mut().unwrap().arena.get_mut(&id).unwrap().fz_last = Some(t);
            // (com folga, como as âncoras de caminho: um ponto só raspando numa parede não basta — dois
            // seguidos dentro de algo sólido sim)
            let (mut gaps, mut walls) = (0, 0);
            for q in fz.iter() {
                let (solid, cube, hazard, _, no_floor) = self.ch_pose_problems(q.p, q.up, q.grounded, q.in_mouth || near(&frames, q.p));
                walls = if solid { walls + 1 } else { 0 };
                if walls >= 2 {
                    self.ch_dump_blocked(&fz, &frames, q.p);
                    return Some(("algo bloqueou o caminho do seu passado (com o tempo parado)", q.p, cp));
                }
                if cube {
                    return Some(("um objeto ficou no caminho do seu passado (com o tempo parado)", q.p, cp));
                }
                if hazard {
                    return Some(("o seu passado caiu num perigo (com o tempo parado)", q.p, cp));
                }
                gaps = if no_floor { gaps + 1 } else { 0 };
                if gaps >= 2 {
                    return Some(("o chão do seu passado sumiu (com o tempo parado)", q.p, cp));
                }
            }
        }
        None
    }

    /// (do meio de uma passada por todos os objetos: o desfazer espera o fim do quadro)
    fn ch_rollback_later(&mut self, cp: Arc<Checkpoint>, why: &'static str, at: Option<Vec3>) {
        self.rollback_pending = Some((cp, why, at));
    }

    /// o loop colapsa: tudo volta ao instante do salto
    pub fn ch_rollback(&mut self, ecs: &mut Ecs, cp: Arc<Checkpoint>, why: &str, at: Option<Vec3>) {
        let Some(ch) = self.relogio.as_mut() else { return };
        ch.rollbacks += 1;
        ch.paradoxes += 1;
        for id in ch.clones.clone() {
            if !cp.clones.contains(&id) {
                if let Some(c) = ch.arena.get_mut(&id) {
                    drop_clone_visuals(ecs, c);
                }
            }
        }
        ch.sweep = None;
        ch.driven.clear();
        ch.free.clear();
        ch.snap.clear();
        ch.samples = cp.samples.clone();
        // os modelos dos duplos são refeitos (os da linha desfeita somem)
        for d in &ch.tb.linha.duplos {
            if let Some(m) = d.mesh {
                if let Ok(e) = ecs.get_entity_mut(m) {
                    e.despawn();
                }
            }
        }
        ch.tb.linha = cp.linha.clone();
        for d in &mut ch.tb.linha.duplos {
            d.mesh = None;
        }
        ch.clones = cp.clones.clone();
        ch.tw = cp.tw;
        ch.next = cp.next;
        ch.arrival = cp.arrival;
        ch.loop_n = cp.loop_n;
        ch.presses.truncate(cp.presses);
        self.field.events.truncate(cp.fields);
        ch.press_last = ch.tw;
        let w = cp.w.clone();
        self.ch_restore(ecs, &w, None, true);
        // os seus portais como estavam
        for (i, f) in [(0usize, &cp.blue), (1usize, &cp.orange)] {
            let p = &mut self.portals.list[i];
            if f.placed && f.solid.is_some() {
                p.set_frame(f.c, f.n, f.u, f.solid);
            } else if p.placed {
                p.remove();
            }
            p.fixed = false;
        }
        self.portals.list[1].delta = if cp.orange.placed { cp.orange.delta } else { 0.0 };
        // você volta para onde estava logo antes de entrar no ciano (um passo para trás, parado)
        let pl = &mut self.player;
        pl.pos = cp.player.pos;
        pl.vel = Vec3::ZERO;
        let e = &cp.entered;
        let l = e.n.dot(pl.pos - e.c);
        if l < 0.8 {
            pl.pos += e.n * (0.8 - l);
        }
        pl.yaw = cp.player.yaw;
        pl.pitch = cp.player.pitch;
        pl.view_offset = Vec3::ZERO;
        pl.view_rot = Quat::IDENTITY;
        pl.cooldown = 0.5;
        self.last_player_pos = pl.pos;
        let ch = self.relogio.as_mut().unwrap();
        ch.paused = false;
        self.ch_set_freeze(false);
        self.ch_set_holo(ecs, false);
        self.events.push(GameEvent::Paradox(why.to_string(), at));
        let ch = self.relogio.as_mut().unwrap();
        ch.fx_paradox = 1.1;
        ch.paradox_why = Some((why.to_string(), 2.6));
        ch.fx_kick = Some((1.3, 0.0, false));
        self.toast(&crate::i18n::tlv("Paradoxo: {why}. O loop se desfez.", &[("why", crate::i18n::tl(why))]));
    }

    // ------------------------------------------------------------------ marca do vermelho no passado e holograma
    fn ch_update_eco(&mut self, ecs: &mut Ecs) {
        let o = self.portals.list[1].clone();
        let on = o.placed && o.delta > 0.0;
        let blocked = self.relogio.as_ref().is_some_and(|c| c.blocked && c.paused);
        let root = self.world.root();
        let t = self.t;
        let Some(ch) = self.relogio.as_mut() else { return };
        if ch.eco.is_none() {
            if !on {
                return;
            }
            ch.eco = Some(make_eco(ecs, root));
        }
        let (g, label, ring, img, shown, was_blocked) = ch.eco.clone().unwrap();
        ecs.entity_mut(g).insert(if on { Visibility::Inherited } else { Visibility::Hidden });
        if !on {
            return;
        }
        ecs.entity_mut(g).insert(Transform::from_matrix(o.matrix));
        let pulse = 0.75 + 0.25 * (t * 4.0).sin();
        let c = if blocked { Vec3::new(2.4, 0.25, 0.2) } else { Vec3::new(1.6, 1.0, 0.4) } * pulse;
        if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&ring) {
            m.base_color = Color::linear_rgb(c.x, c.y, c.z);
        }
        if shown != o.delta || was_blocked != blocked {
            let mut cv = crate::raster::Canvas::new(256, 96);
            let col = if blocked { crate::raster::css("#ff6a5a") } else { crate::raster::css("#9fe8ff") };
            let txt = format!("−{} s", crate::world::fmt_num(o.delta));
            let font = eco_font();
            let w = text_width(font, &txt, 54.0);
            cv.text(font, &txt, 54.0, 128.0 - w / 2.0, 62.0, col);
            if let Some(mut im) = ecs.resource_mut::<Assets<Image>>().get_mut(&img) {
                im.data = Some(cv.rgba8());
            }
            ch.eco = Some((g, label, ring, img, o.delta, blocked));
        }
    }

    fn ch_set_holo(&mut self, ecs: &mut Ecs, on: bool) {
        let root = self.world.root();
        let Some(ch) = self.relogio.as_mut() else { return };
        if on && ch.holo.is_none() {
            let r = ecs.spawn((Transform::default(), Visibility::Hidden, ChildOf(root))).id();
            let mat = crate::world::fx_mat(ecs, crate::fx::Fx::new(crate::fx::kind::HOLO));
            ch.holo = Some(Holo { root: r, doors: HashMap::new(), props: HashMap::new(), pellets: vec![], me: None, mat });
        }
        if let Some(h) = &ch.holo {
            ecs.entity_mut(h.root).insert(if on { Visibility::Inherited } else { Visibility::Hidden });
            // o seu eu do passado fica fora do grupo do holograma (na raiz do mundo): some junto
            if !on {
                if let Some(me) = &h.me {
                    if let Ok(mut e) = ecs.get_entity_mut(me.root) {
                        e.insert(Visibility::Hidden);
                    }
                }
            }
        }
    }

    /// mostra no holograma só o que ERA diferente de agora, no instante tw − Δ
    fn ch_holo_update(&mut self, ecs: &mut Ecs) {
        self.ch_set_holo(ecs, true);
        let t = self.t;
        let (s, snap) = {
            let ch = self.relogio.as_ref().unwrap();
            let s = ch.samples[ch.index_at(ch.tw - ch.delta)].clone();
            let w = s.w.clone();
            (s, w)
        };
        let blocked = self.ch_destination_blocked(ecs, &s);
        let doors: Vec<(usize, Option<Entity>, f32, Vec3)> = self.world.doors.iter().enumerate().map(|(k, d)| {
            let path = d.path.unwrap_or_else(|| { let mut p = Vec3::ZERO; p[d.axis] = d.dist; p });
            (k, d.mesh, d.open, path)
        }).collect();
        let props: Vec<(usize, Vec3, bool, Entity, Vec3)> = self.props.list.iter().enumerate().map(|(k, c)| (k, c.pos, c.gone, c.mesh, c.mesh_offset)).collect();
        let root = self.world.root();
        let ch = self.relogio.as_mut().unwrap();
        ch.blocked = blocked;
        let h = ch.holo.as_mut().unwrap();
        for (k, mesh, open, path) in doors {
            let Some(past) = snap.doors.get(k) else { continue };
            let differs = (past.0 - open).abs() > 0.02;
            if !h.doors.contains_key(&k) && differs {
                let Some(mesh) = mesh else { continue };
                let copy = holo_copy(ecs, mesh, h.root, &h.mat);
                h.doors.insert(k, copy);
            }
            if let Some(&e) = h.doors.get(&k) {
                ecs.entity_mut(e).insert((Transform::from_translation(path * past.0), if differs { Visibility::Inherited } else { Visibility::Hidden }));
            }
        }
        for (k, pos, gone, mesh, off) in props {
            let Some(p) = snap.props.get(k) else { continue };
            let differs = p.gone != gone || (!p.gone && p.p.distance(pos) > 0.15);
            if !h.props.contains_key(&k) && differs && !p.gone {
                let copy = holo_copy(ecs, mesh, h.root, &h.mat);
                h.props.insert(k, copy);
            }
            if let Some(&e) = h.props.get(&k) {
                let vis = differs && !p.gone;
                ecs.entity_mut(e).insert((Transform::from_translation(p.q * off + p.p).with_rotation(p.q), if vis { Visibility::Inherited } else { Visibility::Hidden }));
            }
        }
        let sphere = crate::world::mesh_h(ecs, &crate::geo::sphere_geo(0.34, 14, 10));
        for (i, p) in snap.pellets.iter().enumerate() {
            if i >= h.pellets.len() {
                let e = crate::world::put_mesh(ecs, h.root, sphere.clone(), h.mat.clone(), Transform::default());
                h.pellets.push(e);
            }
            ecs.entity_mut(h.pellets[i]).insert((Transform::from_translation(p.pos), Visibility::Inherited));
        }
        for i in snap.pellets.len()..h.pellets.len() {
            ecs.entity_mut(h.pellets[i]).insert(Visibility::Hidden);
        }
        // o seu eu do passado
        if h.me.is_none() {
            h.me = Some(make_ghost(ecs, root));
        }
        let me = h.me.as_mut().unwrap();
        let feet = s.p + Vec3::new(0.0, -0.9 * s.up, 0.0);
        me.pose = if s.mv { "walk".into() } else { "idle".into() };
        ecs.entity_mut(me.root).insert((Transform::from_translation(feet).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, s.yaw + std::f32::consts::PI, if s.up < 0.0 { std::f32::consts::PI } else { 0.0 })), Visibility::Inherited));
        me.animate(ecs, t, 1.0 / 60.0);
    }

    /// some com os visuais do relógio (troca de fase)
    pub fn ch_clear(&mut self, ecs: &mut Ecs) {
        if let Some(mut ch) = self.relogio.take() {
            for c in ch.arena.values_mut() {
                drop_clone_visuals(ecs, c);
            }
            if let Some(h) = ch.holo.take() {
                if let Ok(e) = ecs.get_entity_mut(h.root) {
                    e.despawn();
                }
                if let Some(me) = h.me {
                    if let Ok(e) = ecs.get_entity_mut(me.root) {
                        e.despawn();
                    }
                }
            }
        }
        self.rollback_pending = None;
    }

    /// o paradoxo esperando o fim do quadro (achado no meio de uma passada pelos objetos)
    pub fn ch_flush(&mut self, ecs: &mut Ecs) {
        if let Some((cp, why, at)) = self.rollback_pending.take() {
            self.ch_rollback(ecs, cp, why, at);
        }
    }
}

/// os portais que o clone disparou, no instante t do script dele (o par cinza)
fn sync_clone_portals(portals: &mut crate::portals::Portals, c: &mut CloneData, t: f32, alive: bool) {
    let s = &c.script[index_in(c, t)];
    for k in 0..2 {
        let f = if alive { if k == 0 { s.pt.b.clone() } else { s.pt.o.clone() } } else { None };
        if f.is_none() && c.pair.is_none() {
            continue;
        }
        let (b, o) = *c.pair.get_or_insert_with(|| portals.remote_pair(&format!("clone{}", c.id), 0, true));
        let p = &mut portals.list[if k == 0 { b } else { o }];
        match f {
            None => {
                if p.placed {
                    p.remove();
                }
                p.delta = 0.0;
                c.shown[k] = None;
            }
            Some(f) => {
                if !p.placed || !c.shown[k].as_ref().is_some_and(|x| Arc::ptr_eq(x, &f)) {
                    p.set_frame(f.c, f.n, f.u, Some(f.solid));
                    // laranja temporal da versão passada: aberto no passado dela
                    p.delta = f.delta;
                    c.shown[k] = Some(f);
                }
            }
        }
    }
}

fn rail_source(ch: &Chronos) -> Option<&CloneData> {
    for id in ch.clones.iter().rev() {
        let c = ch.arena.get(id)?;
        if ch.tw >= c.born - 1e-6 && ch.tw <= c.end + 1e-6 {
            return Some(c);
        }
    }
    None
}

fn index_in(c: &CloneData, t: f32) -> usize {
    (((t - c.script[0].t) / RATE + 1e-6).floor().max(0.0) as usize).min(c.script.len() - 1)
}

fn drop_clone_visuals(ecs: &mut Ecs, c: &mut CloneData) {
    for e in [c.echo.map(|e| e.1), c.ghost.as_ref().map(|g| g.root), c.marker].into_iter().flatten() {
        if let Ok(x) = ecs.get_entity_mut(e) {
            x.despawn();
        }
    }
    if let Some((k, _)) = c.echo {
        c.echo = Some((k, Entity::PLACEHOLDER));
    }
    c.ghost = None;
    c.marker = None;
}

/// o clone: o raptor de capacete azul-claro, em tons de cinza
fn make_ghost(ecs: &mut Ecs, parent: Entity) -> crate::characters::Dino {
    let d = crate::characters::Cast::add_dino(ecs, parent, "raptor", Some(0x8fe3ff), Some(0x38d8ff), 1.0);
    grayscale(ecs, d.root, 1.0);
    d
}

/// tira a cor dos materiais de um modelo (cópias só dele)
fn grayscale(ecs: &mut Ecs, root: Entity, emissive_k: f32) {
    let meshes = crate::glb::meshes_of(ecs, root);
    for m in meshes {
        let Some(h) = ecs.get::<MeshMaterial3d<StandardMaterial>>(m).map(|h| h.0.clone()) else { continue };
        let Some(mut mat) = ecs.resource::<Assets<StandardMaterial>>().get(&h).cloned() else { continue };
        let c = mat.base_color.to_linear();
        let l = c.red * 0.3 + c.green * 0.59 + c.blue * 0.11;
        mat.base_color = Color::LinearRgba(LinearRgba::new(l, l, l, c.alpha));
        let e = mat.emissive;
        let le = (e.red * 0.3 + e.green * 0.59 + e.blue * 0.11) * 0.6 * emissive_k;
        mat.emissive = LinearRgba::rgb(le, le, le);
        let nh = ecs.resource_mut::<Assets<StandardMaterial>>().add(mat);
        ecs.entity_mut(m).insert(MeshMaterial3d(nh));
    }
}

/// a cópia do passado do objeto que viajou com você (cinza)
fn make_echo(ecs: &mut Ecs, parent: Entity, prop: &crate::props::Prop) -> Entity {
    let model = match prop.kind {
        crate::props::Kind::Turret => "turret",
        _ if prop.special => "cube_special",
        _ if prop.redirect => "cube_laser",
        _ => "cube",
    };
    let (root, _) = crate::glb::spawn_model(ecs, model);
    ecs.entity_mut(root).insert((ChildOf(parent), Visibility::Hidden));
    grayscale(ecs, root, 1.0);
    root
}

/// o ciano de saída de um clone: anel claro sobre um disco escuro, sempre visível
fn clone_marker(ecs: &mut Ecs, parent: Entity, exit: (Vec3, Vec3, Vec3)) -> Entity {
    let (c, n, u) = exit;
    let right = u.cross(n).normalize();
    let m = Mat4::from_cols(right.extend(0.0), u.extend(0.0), n.extend(0.0), c.extend(1.0));
    let g = ecs.spawn((Transform::from_matrix(m), Visibility::Inherited, ChildOf(parent))).id();
    let ring = crate::world::bas_a(ecs, LinearRgba::rgb(1.5, 1.5, 1.5), 0.95, false);
    let disc = crate::world::bas_a(ecs, LinearRgba::rgb(0.08, 0.08, 0.08), 0.85, false);
    let s = Vec3::new(PORTAL_A, PORTAL_B, 1.0);
    crate::world::put(ecs, g, &crate::geo::circle_geo(0.87, 48), disc, Transform::from_xyz(0.0, 0.0, 0.02).with_scale(s));
    crate::world::put(ecs, g, &crate::geo::ring_geo(0.86, 1.0, 48, 1), ring, Transform::from_xyz(0.0, 0.0, 0.03).with_scale(s));
    g
}

/// a marca do vermelho no passado: anel, holograma e o "−N s"
fn make_eco(ecs: &mut Ecs, parent: Entity) -> (Entity, Entity, Handle<StandardMaterial>, Handle<Image>, f32, bool) {
    let g = ecs.spawn((Transform::default(), Visibility::Inherited, ChildOf(parent))).id();
    let ring = crate::world::bas_a(ecs, LinearRgba::rgb(1.6, 1.0, 0.4), 1.0, true);
    let s = Vec3::new(PORTAL_A, PORTAL_B, 1.0);
    crate::world::put(ecs, g, &crate::geo::ring_geo(0.88, 1.0, 48, 1), ring.clone(), Transform::from_xyz(0.0, 0.0, 0.03).with_scale(s));
    let holo = crate::world::fx_mat(ecs, crate::fx::Fx::new(crate::fx::kind::HOLO));
    crate::world::put(ecs, g, &crate::geo::circle_geo(0.88, 48), holo, Transform::from_xyz(0.0, 0.0, 0.02).with_scale(s));
    let cv = crate::raster::Canvas::new(256, 96);
    let mut img = cv.image(true, false);
    img.asset_usage = bevy::asset::RenderAssetUsages::RENDER_WORLD | bevy::asset::RenderAssetUsages::MAIN_WORLD;
    let ih = ecs.resource_mut::<Assets<Image>>().add(img);
    let lm = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color_texture: Some(ih.clone()), unlit: true, alpha_mode: AlphaMode::Blend, double_sided: true, cull_mode: None, uv_transform: bevy::math::Affine2::from_scale_angle_translation(Vec2::new(1.0, -1.0), 0.0, Vec2::new(0.0, 1.0)), ..default() });
    let label = crate::world::put(ecs, g, &crate::geo::plane_geo(1.5, 0.56), lm, Transform::from_xyz(0.0, PORTAL_B + 0.55, 0.1));
    (g, label, ring, ih, -1.0, false)
}

/// cópia holográfica de um modelo (mesmas malhas, o material do holograma)
fn holo_copy(ecs: &mut Ecs, src: Entity, parent: Entity, mat: &Handle<crate::fx::Fx>) -> Entity {
    let root = ecs.spawn((Transform::default(), Visibility::Hidden, ChildOf(parent))).id();
    let src_t = ecs.get::<GlobalTransform>(src).copied().unwrap_or_default();
    let inv = src_t.affine().inverse();
    for m in crate::glb::meshes_of(ecs, src) {
        let Some(mesh) = ecs.get::<Mesh3d>(m).map(|h| h.0.clone()) else { continue };
        let Some(gt) = ecs.get::<GlobalTransform>(m).copied() else { continue };
        let local = Transform::from_matrix(Mat4::from(inv * gt.affine()));
        crate::world::put_mesh(ecs, root, mesh, mat.clone(), local);
    }
    root
}

fn eco_font() -> &'static ab_glyph::FontVec {
    static F: std::sync::OnceLock<ab_glyph::FontVec> = std::sync::OnceLock::new();
    F.get_or_init(|| ab_glyph::FontVec::try_from_vec(std::fs::read(crate::mats::asset_dir().join("fonts").join("Arimo-Bold.ttf")).unwrap_or_default()).expect("fonte"))
}

fn text_width(font: &ab_glyph::FontVec, s: &str, size: f32) -> f32 {
    use ab_glyph::{Font, PxScale, ScaleFont};
    let em = font.units_per_em().unwrap_or(1000.0);
    let sf = font.as_scaled(PxScale::from(size * font.height_unscaled() / em));
    s.chars().map(|c| sf.h_advance(font.glyph_id(c))).sum()
}

#[allow(dead_code)]
fn _ent(_: Ent) {}

// ------------------------------------------------------------------ o passado visto pelo ciano
/// o que muda com o tempo (portas, botões, objetos, bolas, clones) fica nesta camada: a câmera principal
/// e as dos portais comuns a veem; a do ciano temporal vê a PAST_LAYER (as cópias como estavam Δ s atrás)
pub const PRESENT_LAYER: usize = 5;
pub const PAST_LAYER: usize = 6;

#[derive(Default)]
struct PastView {
    tagged: std::collections::HashSet<Entity>,
    doors: HashMap<usize, Entity>,
    props: HashMap<usize, Entity>,
    plates: HashMap<usize, (Entity, Handle<StandardMaterial>)>,
    pellets: Vec<Entity>,
    doubles: Vec<Entity>,
    ghosts: HashMap<u32, crate::characters::Dino>,
    me: Option<crate::characters::Dino>,
    ball: Option<(Handle<Mesh>, Handle<StandardMaterial>)>,
    shown: bool,
}

fn set_layers(ecs: &mut Ecs, root: Entity, layers: &bevy::camera::visibility::RenderLayers) {
    for m in crate::glb::meshes_of(ecs, root) {
        ecs.entity_mut(m).insert(layers.clone());
    }
}

/// cópia de um modelo com os mesmos materiais (as malhas relativas a `src`)
fn copy_model(ecs: &mut Ecs, src: Entity, parent: Entity) -> Entity {
    let root = ecs.spawn((Transform::default(), Visibility::Hidden, ChildOf(parent))).id();
    let inv = ecs.get::<GlobalTransform>(src).copied().unwrap_or_default().affine().inverse();
    let layer = bevy::camera::visibility::RenderLayers::layer(PAST_LAYER);
    for m in crate::glb::meshes_of(ecs, src) {
        let Some(mesh) = ecs.get::<Mesh3d>(m).cloned() else { continue };
        let Some(gt) = ecs.get::<GlobalTransform>(m).copied() else { continue };
        let local = Transform::from_matrix(Mat4::from(inv * gt.affine()));
        let e = ecs.spawn((mesh, local, layer.clone(), ChildOf(root))).id();
        if let Some(h) = ecs.get::<MeshMaterial3d<StandardMaterial>>(m).cloned() {
            ecs.entity_mut(e).insert(h);
        } else if let Some(h) = ecs.get::<MeshMaterial3d<crate::fx::Fx>>(m).cloned() {
            ecs.entity_mut(e).insert(h);
        }
    }
    root
}

fn pose_dino(ecs: &mut Ecs, g: &mut crate::characters::Dino, p: Vec3, up: f32, yaw: f32, mv: bool, t: f32, dt: f32) {
    let feet = p + Vec3::new(0.0, -0.9 * up, 0.0);
    g.pose = if mv { "walk".into() } else { "idle".into() };
    g.speed = Some(4.5);
    ecs.entity_mut(g.root).insert((
        Transform::from_translation(feet).with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, yaw + std::f32::consts::PI, if up < 0.0 { std::f32::consts::PI } else { 0.0 })),
        Visibility::Inherited,
    ));
    g.animate(ecs, t, dt);
}

impl Game {
    /// a cada quadro (fases com relógio): separa o presente do passado nas camadas e posa as cópias do passado
    pub fn ch_past_view(&mut self, ecs: &mut Ecs, real_dt: f32) {
        use bevy::camera::visibility::RenderLayers;
        let Some(mut ch) = self.relogio.take() else { return };
        let present = RenderLayers::layer(PRESENT_LAYER);
        let main_only = RenderLayers::layer(1);
        // o que muda com o tempo vai para a camada do presente (uma vez por entidade; as bolas nascem sempre)
        let mut roots: Vec<Entity> = vec![];
        roots.extend(self.world.doors.iter().filter_map(|d| d.mesh));
        roots.extend(self.world.buttons.iter().filter_map(|b| b.plate));
        roots.extend(self.props.list.iter().filter(|c| !c.gone).map(|c| c.mesh));
        roots.extend(self.energy.pellet_parts());
        roots.extend(self.frontier.beam_entities());
        for c in ch.arena.values() {
            roots.extend(c.ghost.as_ref().map(|g| g.root));
            roots.extend(c.echo.map(|e| e.1).filter(|e| *e != Entity::PLACEHOLDER));
        }
        for r in roots {
            if ch.past.tagged.insert(r) && ecs.get_entity(r).is_ok() {
                set_layers(ecs, r, &present);
            }
        }
        // o holograma e o eco da pausa: só para quem está no presente (na câmera principal)
        let mut mains: Vec<Entity> = ch.holo.as_ref().map(|h| h.root).into_iter().collect();
        mains.extend(ch.holo.as_ref().and_then(|h| h.me.as_ref().map(|m| m.root)));
        mains.extend(ch.eco.as_ref().map(|e| e.0));
        for r in mains {
            set_layers(ecs, r, &main_only);
        }
        ch.past.tagged.retain(|e| ecs.get_entity(*e).is_ok());

        // o ciano temporal aberto e ligado: a sala como estava em T = tw − Δ
        let (blue, orange) = (&self.portals.list[0], &self.portals.list[1]);
        let on = blue.placed && orange.placed && orange.delta > 0.0 && self.portals.is_linked(0) && !ch.paused && ch.sweep.is_none();
        let root = self.world.root();
        if !on {
            if ch.past.shown {
                ch.past.shown = false;
                let all: Vec<Entity> = ch.past.doors.values().chain(ch.past.props.values()).copied().chain(ch.past.plates.values().map(|p| p.0)).chain(ch.past.pellets.iter().copied()).chain(ch.past.doubles.iter().copied()).chain(ch.past.ghosts.values().map(|g| g.root)).chain(ch.past.me.as_ref().map(|m| m.root)).collect();
                for e in all {
                    if let Ok(mut x) = ecs.get_entity_mut(e) {
                        x.insert(Visibility::Hidden);
                    }
                }
            }
            self.relogio = Some(ch);
            return;
        }
        ch.past.shown = true;
        let tt = ch.tw - orange.delta;
        let s = ch.samples[ch.index_at(tt)].clone();
        let snap = s.w.clone();
        let (dbl, dballs) = Game::ch_doubles_at(&ch, tt);
        let past = RenderLayers::layer(PAST_LAYER);
        // portas
        for (k, d) in self.world.doors.iter().enumerate() {
            let (Some(mesh), Some(st)) = (d.mesh, snap.doors.get(k)) else { continue };
            let e = *ch.past.doors.entry(k).or_insert_with(|| copy_model(ecs, mesh, root));
            let path = d.path.unwrap_or_else(|| { let mut p = Vec3::ZERO; p[d.axis] = d.dist; p });
            ecs.entity_mut(e).insert((Transform::from_translation(path * st.0), Visibility::Inherited));
        }
        // botões: afundados e verdes se estavam pisados
        for (k, b) in self.world.buttons.iter().enumerate() {
            let (Some(plate), Some(st)) = (b.plate, snap.buttons.get(k)) else { continue };
            if !ch.past.plates.contains_key(&k) {
                let e = copy_model(ecs, plate, root);
                let base = b.plate_mat.as_ref().and_then(|h| ecs.resource::<Assets<StandardMaterial>>().get(h).cloned()).unwrap_or_default();
                let h = ecs.resource_mut::<Assets<StandardMaterial>>().add(base);
                for m in crate::glb::meshes_of(ecs, e) {
                    ecs.entity_mut(m).insert(MeshMaterial3d(h.clone()));
                }
                ch.past.plates.insert(k, (e, h));
            }
            let (e, h) = ch.past.plates[&k].clone();
            let on = if st.0 { 1.0 } else { 0.0 };
            let gt = ecs.get::<GlobalTransform>(plate).copied().unwrap_or_default();
            let mut at = gt.translation();
            let ly = ecs.get::<Transform>(plate).map(|t| t.translation.y).unwrap_or(0.16);
            at.y += (0.16 - 0.07 * on) - ly;
            ecs.entity_mut(e).insert((Transform::from_translation(at).with_rotation(gt.rotation()), Visibility::Inherited));
            if let Some(mut m) = ecs.resource_mut::<Assets<StandardMaterial>>().get_mut(&h) {
                m.base_color = crate::mats::hex(if st.0 { 0x27ae60 } else { 0xc0392b });
                m.emissive = crate::mats::hex(if st.0 { 0x0a4a20 } else { 0x5a0a05 }).to_linear();
            }
        }
        // objetos
        for (k, c) in self.props.list.iter().enumerate() {
            let Some(st) = snap.props.get(k) else { continue };
            if c.gone && !ch.past.props.contains_key(&k) {
                continue;
            }
            let e = *ch.past.props.entry(k).or_insert_with(|| copy_model(ecs, c.mesh, root));
            ecs.entity_mut(e).insert((Transform::from_translation(st.q * c.mesh_offset + st.p).with_rotation(st.q), if st.gone { Visibility::Hidden } else { Visibility::Inherited }));
        }
        // objetos mandados ao passado: o duplo, como estava então (uma segunda cópia do objeto)
        for (n, (k, dp, dq)) in dbl.iter().enumerate() {
            let Some(c) = self.props.list.get(*k) else { continue };
            if n >= ch.past.doubles.len() {
                let e = copy_model(ecs, c.mesh, root);
                ch.past.doubles.push(e);
            }
            let e = ch.past.doubles[n];
            ecs.entity_mut(e).insert((Transform::from_translation(*dq * c.mesh_offset + *dp).with_rotation(*dq), Visibility::Inherited));
        }
        for n in dbl.len()..ch.past.doubles.len() {
            ecs.entity_mut(ch.past.doubles[n]).insert(Visibility::Hidden);
        }
        // as bolas de então: esferas brilhantes
        if ch.past.ball.is_none() {
            let m = ecs.resource_mut::<Assets<Mesh>>().add(Sphere::new(0.26).mesh().uv(14, 10));
            let mat = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial { base_color: Color::BLACK, emissive: LinearRgba::rgb(3.0, 1.8, 0.6), unlit: true, ..default() });
            ch.past.ball = Some((m, mat));
        }
        let (bm, bmat) = ch.past.ball.clone().unwrap();
        // (as que já tinham entrado no laranja nesse instante não aparecem; as mandadas ao passado, sim)
        let balls: Vec<Vec3> = snap.pellets.iter().filter(|p| !self.ch_entered_by(&ch, p, tt)).map(|p| p.pos).chain(dballs).collect();
        for (i, p) in balls.iter().enumerate() {
            if i >= ch.past.pellets.len() {
                let e = ecs.spawn((Mesh3d(bm.clone()), MeshMaterial3d(bmat.clone()), Transform::default(), past.clone(), ChildOf(root))).id();
                ch.past.pellets.push(e);
            }
            ecs.entity_mut(ch.past.pellets[i]).insert((Transform::from_translation(*p), Visibility::Inherited));
        }
        for i in balls.len()..ch.past.pellets.len() {
            ecs.entity_mut(ch.past.pellets[i]).insert(Visibility::Hidden);
        }
        // clones onde estavam então, e você mesmo
        let t = self.t;
        for id in ch.clones.clone() {
            let Some(c) = ch.arena.get(&id) else { continue };
            let pose = clone_pose(c, tt);
            if !ch.past.ghosts.contains_key(&id) {
                let g = make_ghost(ecs, root);
                set_layers(ecs, g.root, &past);
                ch.past.ghosts.insert(id, g);
            }
            let g = ch.past.ghosts.get_mut(&id).unwrap();
            match pose {
                Some(pose) => pose_dino(ecs, g, pose.p, pose.up, pose.yaw, pose.mv, t, real_dt),
                None => {
                    ecs.entity_mut(g.root).insert(Visibility::Hidden);
                }
            }
        }
        let gone: Vec<u32> = ch.past.ghosts.keys().filter(|id| !ch.clones.contains(id)).copied().collect();
        for id in gone {
            if let Some(g) = ch.past.ghosts.remove(&id) {
                if let Ok(x) = ecs.get_entity_mut(g.root) {
                    x.despawn();
                }
            }
        }
        if ch.past.me.is_none() {
            let g = make_ghost(ecs, root);
            set_layers(ecs, g.root, &past);
            ch.past.me = Some(g);
        }
        pose_dino(ecs, ch.past.me.as_mut().unwrap(), s.p, s.up, s.yaw, s.mv, t, real_dt);
        self.relogio = Some(ch);
    }
}
