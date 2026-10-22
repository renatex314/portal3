//! O laço do jogo (main.js): carrega fases, lê a entrada, roda o mundo, o jogador, os portais,
//! a física e os mecanismos, na mesma ordem da versão web. Tudo fica no recurso `Game` e roda
//! num sistema exclusivo (`tick`), com acesso direto ao mundo do Bevy para os visuais.

use crate::input::{Controls, Key};
use crate::levels::{self, LevelDef};
use crate::player::{Input, Player};
use crate::portals::{Portals, BLUE, ORANGE};
use crate::shots::Bolts;
use crate::world::GameWorld;
use crate::MainCam;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use serde_json::Value;

pub const G: f32 = 9.8;
/// botões juntos: espera um instante para ver se o outro botão vem (campo de dilatação)
pub const CHORD_MS: f32 = 0.09;

#[derive(Resource)]
pub struct Game {
    pub levels: Vec<LevelDef>,
    pub level: Option<usize>,
    pub data: Value,
    pub world: GameWorld,
    pub portals: Portals,
    pub player: Player,
    pub input: Input,
    pub t: f32,
    pub level_time: f32,
    pub running: bool,
    pub paused: bool,
    pub completed: bool,
    pub gun_mode: String,
    pub held: Option<usize>,
    pub props: crate::props::Props,
    pub energy: crate::energy::Energy,
    /// relógio do tempo (série Experimento)
    pub relogio: Option<Box<crate::relogio::Chronos>>,
    pub rollback_pending: Option<(std::sync::Arc<crate::relogio::Checkpoint>, &'static str, Option<Vec3>)>,
    /// a linha do tempo rodando adiantada até a saída: (até, paradoxos no começo, mortes no começo)
    pub verify: Option<(f32, f32, u32, u32)>,
    pub cast: crate::characters::Cast,
    pub frontier: crate::frontier::Frontier,
    pub want: Option<i64>,
    pub bolts: Bolts,
    /// tiro esperando um instante (para os dois botões juntos)
    pub pending_shot: Option<(usize, f32)>,
    pub fire_held: [bool; 3],
    pub deaths: u32,
    /// o tempo de verdade do quadro (o relógio e a roda usam)
    pub real_dt: f32,
    done_prev: Option<f32>,
    /// o menu está aberto (a câmara 1 gira ao fundo)
    pub menu: bool,
    pub final_shown: bool,
    pub progress: crate::menu::Progress,
    /// câmara a carregar no próximo quadro (e se é só o fundo do menu)
    pub want_idx: Option<(usize, bool)>,
    pub slow: Slow,
    pub field: Field,
    /// passo do jogador em relação ao do mundo (1/rate dentro do campo)
    pub p_scale: f32,
    /// legendas a mostrar (quem, fala)
    pub subs: std::collections::VecDeque<(String, String)>,
    pub dead_flash: f32,
    hints_fired: Vec<bool>,
    /// giro da câmera neste quadro (a arma fica para trás e volta) e o tiro (cor) para a arma
    pub gun_look: Vec2,
    pub gun_kick: Option<Vec3>,
    pub health: f32,
    pub hurt_t: f32,
    pub hurt_flash: f32,
    pub last_player_pos: Vec3,
    pub in_fizzler: bool,
    pub fizzle_before_portal: bool,
    pub zoom: (bool, f32, f32),
    pub look_vel: Vec2,
    pub cam: Transform,
    /// mensagens rápidas (toast) e falas a mostrar (o HUD lê)
    pub toasts: Vec<(String, f32)>,
    pub events: Vec<GameEvent>,
    /// grades ligadas a sinal: (índice, ligada) a aplicar no fim do quadro
    pub fizz_pending: Vec<(usize, bool)>,
    /// portal da fase que troca de lugar sozinho (`cycle`): (qual, a cada, lugares, índice, falta)
    pub cycle: Option<Cycle>,
    /// fase final: dentro do túnel; e a "ajuda da borda" do outro lado (de, para, progresso)
    pub in_tube: bool,
    pub assist: Option<(Vec3, Vec3, f32)>,
    pub moon_visited: bool,
    /// mapa livre: cristais pegos / total (None fora dele)
    pub gems: Option<(usize, usize)>,
    pub crystals: Vec<crate::achados::Crystal>,
    /// todos os cristais pegos: o fim de câmara vem depois de um instante
    pub gems_done: Option<f32>,
    /// título do fim de câmara no lugar do "concluída" (o mapa livre)
    pub done_title: Option<String>,
    /// a luta contra o chefe (série Chefes)
    pub boss: Option<Box<crate::chefe::Boss>>,
    /// há quanto tempo uma peça em movimento prende você dentro de outra
    crush_t: f32,
    /// abertura da câmera (graus): abre com a velocidade, fecha um pouco no tempo lento
    fov_deg: f32,
    pub dissolve_pending: Vec<(Entity, Transform, Vec3, bool)>,
    pub dissolves: Vec<crate::dissolver::Dissolve>,
    pub ambient: crate::ambiente::Ambient,
    /// editor de níveis aberto (o mundo é o nível sendo editado; o jogo não anda)
    pub editing: bool,
    pub editor: Option<Box<crate::editor::state::Editor>>,
    /// pedido do menu: abrir o editor (um nível ou um novo)
    pub editor_req: Option<Option<String>>,
    /// o caminho do teste de um nível do editor (a prova: x, y, z, giro, olhar, no chão, cima, vx, vy, vz)
    pub rec: Vec<Vec<f32>>,
    pub rec_acc: f32,
    /// multiplayer na rede local
    pub mp: crate::mp::Mp,
    /// campanha original: as entidades do mapa, os pedidos de som, a câmera de cena, o
    /// esmaecimento da tela e os créditos
    pub camp: Option<Box<crate::campaign::io::Runtime>>,
    pub camp_audio: Vec<crate::campaign::dialogue::Req>,
    pub camp_view: Option<crate::campaign::View>,
    pub camp_fade: Option<crate::campaign::Fade>,
    pub camp_credits: Option<f32>,
}

/// o que aconteceu no quadro (para o som, o HUD e os testes)
#[derive(Clone, Debug, PartialEq)]
pub enum GameEvent {
    PortalOpen(usize),
    PortalFail,
    Shot(usize),
    Died(String),
    Complete,
    Fizzle,
    Lines(Vec<(String, String)>),
    Teleport(usize),
    /// pegou um cristal
    Gem,
    /// um foguete acertou o chefe
    BossHit,
    /// a torreta de foguete disparou (distância até você)
    RocketShot(f32),
    /// chegou à Lua (o som do vácuo)
    Vacuum,
    Pick,
    Drop,
    Toss,
    Burn,
    Press(usize),
    PropPortal,
    Freeze(bool),
    Scrub,
    Echo(bool),
    TimeJump(f32),
    Paradox(String, Option<Vec3>),
    SlowIn,
    SlowOut,
    Heartbeat,
    LowTime,
    FieldBurst(Vec3),
    FieldEnd,
    TimeShift(bool),
    Roar(f32),
    Button(bool),
    Door,
    Denied,
    FunnelIn,
    Plate,
    LaserOn,
    Sizzle,
    TurretSpot(usize),
    TurretOff(usize),
    Hit(u32),
    Gun(String),
    Energy(crate::energy::EnergyEvent),
}

/// tempo lento (o SLOW de main.js): gasta a reserva enquanto ligado; desligado, recarrega
#[derive(Clone, Debug)]
pub struct Slow {
    pub max: f32,
    pub left: f32,
    pub on: bool,
    pub k: f32,
    beat: f32,
    warn: f32,
    pub scale: f32,
}

impl Default for Slow {
    fn default() -> Self {
        Slow { max: 6.0, left: 6.0, on: false, k: 1.0, beat: 0.0, warn: 0.0, scale: 0.28 }
    }
}

/// portal da fase que troca de lugar sozinho a cada `every` segundos
#[derive(Clone, Debug)]
pub struct Cycle {
    pub which: usize,
    pub every: f32,
    pub spots: Vec<(Vec3, Vec3, Vec3)>,
    pub i: usize,
    pub t: f32,
}

/// um campo de dilatação temporal ativo
#[derive(Clone, Debug)]
pub struct FieldInst {
    pub center: Vec3,
    /// segundos do mundo que ainda restam
    pub left: f32,
    /// é seu (desta volta), não de uma versão do passado
    pub own: bool,
}

/// campo de dilatação (o FIELD de main.js): os dois botões seguros por 5 s criam um campo parado
/// onde você está; dentro, o tempo passa 10× mais devagar
#[derive(Clone, Debug)]
pub struct Field {
    pub need: f32,
    pub rate: usize,
    pub r: f32,
    pub life: f32,
    pub charge: f32,
    pub armed: bool,
    pub shake: f32,
    pub active: Vec<FieldInst>,
    /// com o relógio do tempo: cada campo criado entra na linha do tempo (voltando, a sua versão do passado o cria de novo)
    pub events: Vec<FieldEv>,
    pub last_tw: f32,
}

/// a criação de um campo na linha do tempo: em `t0`, por você na volta `loop_n`
#[derive(Clone, Debug)]
pub struct FieldEv {
    pub t0: f32,
    pub center: Vec3,
    pub life: f32,
    pub loop_n: u32,
}

impl Default for Field {
    fn default() -> Self {
        Field { need: 5.0, rate: 10, r: 3.2, life: 20.0, charge: 0.0, armed: true, shake: 0.0, active: vec![], events: vec![], last_tw: 0.0 }
    }
}

impl Field {
    /// fator de tempo em `p` no instante `t` da linha do tempo (dentro de um campo ativo então: 1/rate)
    pub fn scale_at(&self, p: Vec3, t: f32) -> f32 {
        if self.events.iter().any(|e| t >= e.t0 - 1e-6 && t < e.t0 + e.life && p.distance(e.center) < self.r) {
            1.0 / self.rate as f32
        } else {
            1.0
        }
    }
}

impl Field {
    pub fn inside(&self, p: Vec3) -> bool {
        self.active.iter().any(|f| p.distance(f.center) < self.r)
    }
    pub fn own(&self) -> Option<&FieldInst> {
        self.active.iter().find(|f| f.own)
    }
}

pub struct Gravity {
    level: i64,
    base: f32,
    zones: Vec<crate::world::GravZone>,
    holes: Vec<crate::world::BlackHole>,
    flows: Vec<(Vec<crate::frontier::Seg>, f32, bool)>,
}

impl Gravity {
    pub fn at(&self, p: Vec3) -> Vec3 {
        let mut g = match self.level {
            6 => {
                let in_tube = p.x.abs() < 2.6 && p.z.abs() < 2.6;
                if p.y >= 0.0 || (!in_tube && p.y > -100.0) {
                    Vec3::new(0.0, -G, 0.0)
                } else if p.y <= -160.0 {
                    Vec3::new(0.0, G, 0.0)
                } else if in_tube {
                    Vec3::new(0.0, -G * (p.y + 80.0) / 80.0, 0.0)
                } else {
                    Vec3::new(0.0, G, 0.0)
                }
            }
            403 => Vec3::new(0.0, if p.y > 900.0 { -1.62 } else { -G }, 0.0),
            _ => Vec3::new(0.0, -self.base, 0.0),
        };
        for z in &self.zones {
            if p.cmpgt(z.min).all() && p.cmplt(z.max).all() {
                g = z.g;
                break;
            }
        }
        for b in &self.holes {
            let v = b.pos - p;
            let r = v.length();
            if r > b.reach || r < 1e-3 {
                continue;
            }
            let fall = 1.0 - crate::world::smoothstep(b.reach * 0.6, b.reach, r);
            let a = (b.strength / (r * r).max((b.horizon * 2.0).powi(2))).min(60.0) * fall;
            g += v * (a / r);
        }
        // dentro de um funil de excursão não há gravidade
        if !self.flows.is_empty() && crate::frontier::flow_at(&self.flows, p).is_some() {
            g = Vec3::ZERO;
        }
        g
    }

    pub fn flow(&self, p: Vec3) -> Option<(Vec3, Vec3)> {
        crate::frontier::flow_at(&self.flows, p)
    }
}

pub fn setup_game(ecs: &mut Ecs) {
    let world = GameWorld::new(ecs);
    let mut levels = levels::load_levels();
    let free = levels.iter().position(|l| l.free).unwrap_or(levels.len());
    levels.splice(free..free, crate::campaign::levels());
    for (i, d) in crate::editor::store::list().iter().enumerate() {
        levels.push(d.compile(i));
    }
    // com PORTAL3_LEVEL (testes, atalho) entra direto na câmara; senão, o menu
    let direct: Option<i64> = std::env::var("PORTAL3_LEVEL").ok().and_then(|v| v.parse().ok());
    let want = direct;
    let bolts = Bolts::new(ecs);
    ecs.insert_resource(Game {
        levels,
        level: None,
        data: Value::Null,
        world,
        portals: Portals::new(),
        player: Player::default(),
        input: Input::default(),
        t: 0.0,
        level_time: 0.0,
        running: false,
        paused: false,
        completed: false,
        gun_mode: "both".into(),
        held: None,
        props: Default::default(),
        energy: Default::default(),
        relogio: None,
        rollback_pending: None,
        verify: None,
        cast: Default::default(),
        frontier: Default::default(),
        want,
        bolts,
        pending_shot: None,
        fire_held: [false; 3],
        deaths: 0,
        real_dt: 1.0 / 60.0,
        done_prev: None,
        menu: direct.is_none(),
        final_shown: false,
        progress: crate::menu::Progress::load(),
        want_idx: if direct.is_none() { Some((0, true)) } else { None },
        slow: Default::default(),
        field: Default::default(),
        p_scale: 1.0,
        subs: Default::default(),
        dead_flash: 0.0,
        hints_fired: vec![],
        gun_look: Vec2::ZERO,
        gun_kick: None,
        health: 100.0,
        hurt_t: 9.0,
        hurt_flash: 0.0,
        last_player_pos: Vec3::ZERO,
        in_fizzler: false,
        fizzle_before_portal: false,
        zoom: (false, 3.0, 1.0),
        look_vel: Vec2::ZERO,
        cam: Transform::default(),
        toasts: vec![],
        events: vec![],
        fizz_pending: vec![],
        cycle: None,
        in_tube: false,
        assist: None,
        moon_visited: false,
        gems: None,
        crystals: vec![],
        gems_done: None,
        done_title: None,
        boss: None,
        crush_t: 0.0,
        fov_deg: 75.0,
        dissolve_pending: vec![],
        dissolves: vec![],
        ambient: Default::default(),
        editing: false,
        editor: None,
        editor_req: None,
        rec: vec![],
        rec_acc: 0.0,
        mp: Default::default(),
        camp: None,
        camp_audio: vec![],
        camp_view: None,
        camp_fade: None,
        camp_credits: None,
    });
}

fn f(v: &Value, i: usize) -> f32 {
    v.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32
}

impl Game {
    pub fn level_id(&self) -> i64 {
        self.level.map(|i| self.levels[i].id).unwrap_or(0)
    }

    pub fn load(&mut self, ecs: &mut Ecs, idx: usize) {
        self.ch_clear(ecs);
        self.verify = None;
        self.energy.reset(ecs);
        self.frontier.reset();
        self.cast.clear(ecs);
        self.world.clear(ecs);
        self.props.clear();
        self.portals.reset();
        self.bolts.clear(ecs);
        let def = self.levels[idx].clone();
        let tl = |s: &str| crate::i18n::tl(s);
        levels::build(&mut self.world, ecs, &def, &tl);
        self.level = Some(idx);
        self.data = def.data.clone();
        self.camp = None;
        self.camp_view = None;
        self.camp_fade = None;
        self.camp_credits = None;
        self.camp_audio.push(crate::campaign::dialogue::Req::StopAll);
        let mut camp_err = None;
        if let Some(map) = &def.campaign {
            if let Err(e) = crate::campaign::load_level(self, ecs, map) {
                camp_err = Some(e);
            }
        }
        self.gun_mode = self.data.get("gun").and_then(|g| g.as_str()).unwrap_or("both").to_string();
        self.running = true;
        self.paused = false;
        self.completed = false;
        self.level_time = 0.0;
        self.held = None;
        self.pending_shot = None;
        self.respawn();
        self.last_player_pos = self.player.pos;
        self.in_fizzler = false;
        for c in self.data.get("cubes").and_then(|c| c.as_array()).cloned().unwrap_or_default() {
            let o = c.get(3);
            let flag = |k: &str| o.and_then(|o| o.get(k)).and_then(|v| v.as_bool()).unwrap_or(false);
            let yaw = o.and_then(|o| o.get("yaw")).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            self.props.add_cube(ecs, &mut self.world, f(&c, 0), f(&c, 1), f(&c, 2), flag("special"), flag("laser"), yaw);
        }
        for tt in self.data.get("turrets").and_then(|c| c.as_array()).cloned().unwrap_or_default() {
            let o = tt.get(4);
            let flag = |k: &str| o.and_then(|o| o.get(k)).and_then(|v| v.as_bool()).unwrap_or(false);
            let opts = crate::turrets::TurretOpts {
                scale: o.and_then(|o| o.get("scale")).and_then(|v| v.as_f64()).map(|v| v as f32),
                tippy: flag("tippy"),
                inactive: flag("inactive"),
                no_ammo: flag("noAmmo"),
            };
            self.props.add_turret(ecs, &mut self.world, f(&tt, 0), f(&tt, 1), f(&tt, 2), f(&tt, 3), &opts);
        }
        let root = self.world.root();
        let data = self.data.clone();
        self.cast.build(ecs, root, &data);
        if data.get("relogio").is_some_and(|v| !v.is_null() && v != &Value::Bool(false)) {
            self.ch_start();
        }
        self.health = 100.0;
        self.hurt_t = 9.0;
        self.subs.clear();
        self.field = Field::default();
        if self.slow.on {
            self.toggle_slow(Some(false));
        }
        self.hints_fired = vec![false; self.data.get("hints").and_then(|h| h.as_array()).map(|a| a.len()).unwrap_or(0)];
        if !self.menu && !self.editing {
            if let Some(intro) = self.data.get("intro").cloned() {
                self.say_value(&intro);
            }
        }
        // portais fixos da fase (`portals: [{ which, c, n, u }, ...]`)
        if let Some(list) = self.data.get("portals").and_then(|p| p.as_array()).cloned() {
            for p in list {
                let which = if p.get("which").and_then(|w| w.as_str()) == Some("blue") { BLUE } else { ORANGE };
                let v = |k: &str| levels::v3(p.get(k)).unwrap_or(Vec3::ZERO);
                self.portals.place_fixed(&self.world, which, v("c"), v("n"), v("u"));
            }
        }
        // portal que troca de lugar sozinho
        self.cycle = self.data.get("cycle").map(|c| {
            let which = if c.get("which").and_then(|w| w.as_str()) == Some("blue") { BLUE } else { ORANGE };
            let every = c.get("every").and_then(|v| v.as_f64()).unwrap_or(4.0) as f32;
            let spots = c.get("spots").and_then(|s| s.as_array()).map(|a| a.iter().map(|sp| (levels::v3(sp.get("c")).unwrap_or(Vec3::ZERO), levels::v3(sp.get("n")).unwrap_or(Vec3::Z), levels::v3(sp.get("u")).unwrap_or(Vec3::Y))).collect()).unwrap_or_default();
            Cycle { which, every, spots, i: 0, t: every }
        });
        if let Some(c) = self.cycle.clone() {
            if let Some(&(cc, n, u)) = c.spots.first() {
                self.portals.place_fixed(&self.world, c.which, cc, n, u);
            }
        }
        self.in_tube = false;
        self.assist = None;
        self.moon_visited = false;
        self.done_title = None;
        self.rec.clear();
        self.rec_acc = 0.0;
        self.spawn_finds(ecs);
        self.boss_load(ecs);
        if let Some(mut rt) = self.camp.take() {
            rt.spawn_initial(self, ecs);
            rt.start();
            self.camp = Some(rt);
        }
        if let Some(e) = camp_err {
            self.to_menu();
            self.toast(&e);
        }
    }

    /// o portal da fase que troca de lugar, a ajuda da borda do túnel, o guincho de quem caiu sem portal
    fn level_extras(&mut self, dt: f32) {
        if let Some(c) = self.cycle.as_mut() {
            c.t -= dt;
            if c.t <= 0.0 && !c.spots.is_empty() {
                c.t = c.every;
                c.i = (c.i + 1) % c.spots.len();
                let (which, (cc, n, u)) = (c.which, c.spots[c.i]);
                self.portals.place_fixed(&self.world, which, cc, n, u);
                self.events.push(GameEvent::PortalOpen(which));
            }
        }
        if let Some((from, to, t)) = self.assist.as_mut() {
            *t += dt / 0.5;
            let k = t.min(1.0);
            self.player.pos = from.lerp(*to, k * k * (3.0 - 2.0 * k));
            self.player.vel = Vec3::ZERO;
            if *t >= 1.0 {
                self.assist = None;
            }
        }
        // caiu sem portal: o guincho puxa de volta
        if let Some(st) = self.data.get("stuck").cloned() {
            let below = st.get("below").and_then(|v| v.as_f64()).unwrap_or(f64::MIN) as f32;
            if self.player.pos.y < below && self.player.ground_time > 1.3 {
                if let Some(l) = st.get("lines") {
                    self.say_value(l);
                }
                self.respawn();
            }
        }
        // fase final: o túnel até o outro lado do mundo
        if let Some(tube) = self.data.get("tube").cloned() {
            let bottom = tube.get("bottom").and_then(|v| v.as_f64()).unwrap_or(-160.0) as f32;
            let p = self.player.pos;
            let now_in = p.x.abs() < 2.6 && p.z.abs() < 2.6 && p.y < -0.5 && p.y > bottom - 1.0;
            if now_in != self.in_tube {
                self.in_tube = now_in;
                if now_in {
                    self.say(vec![("Helena".into(), "Lá vai! Repara na gravidade diminuindo...".into())]);
                }
            }
            // "agarra na borda": do outro lado, ajuda a sair da boca do túnel
            if self.assist.is_none() && self.player.up_sign < 0.0 && p.y < bottom + 3.0 && p.x.abs() < 2.4 && p.z.abs() < 2.4 && self.player.vel.y.abs() < 3.5 {
                let mut d = self.cam_forward();
                d.y = 0.0;
                let d = if d.length_squared() < 1e-4 { Vec3::Z } else { d.normalize() };
                let dir = if d.x.abs() > d.z.abs() { Vec3::new(d.x.signum(), 0.0, 0.0) } else { Vec3::new(0.0, 0.0, d.z.signum()) };
                self.assist = Some((p, Vec3::new(dir.x * 3.3, bottom - 0.92, dir.z * 3.3), 0.0));
                self.say(vec![("Dona Cida".into(), "Agarra na borda, menino!".into())]);
            }
        }
    }

    pub fn respawn(&mut self) {
        let sp = self.data.get("spawn").cloned().unwrap_or(Value::Null);
        self.player.spawn(&mut self.world, f(&sp, 0), f(&sp, 1), f(&sp, 2), f(&sp, 3));
    }

    /// gravidade no ponto (a da fase, zonas de gravidade, buracos negros)
    pub fn gravity_at(&self, p: Vec3) -> Vec3 {
        self.gravity().at(p)
    }

    /// a gravidade da fase (cópia que pode ser usada enquanto o mundo está emprestado)
    pub fn gravity(&self) -> Gravity {
        Gravity {
            level: self.level_id(),
            base: self.data.get("gravity").and_then(|g| g.as_f64()).unwrap_or(G as f64) as f32,
            zones: self.world.grav_zones.clone(),
            holes: self.world.black_holes.clone(),
            flows: self.flows(),
        }
    }

    /// onde os portais podem abrir (a fase do túnel não deixa lá dentro)
    pub fn portals_allowed(&self, p: Vec3) -> bool {
        match self.level_id() {
            6 => p.y > -1.0,
            _ => true,
        }
    }

    pub fn cam_forward(&self) -> Vec3 {
        self.cam.rotation * Vec3::NEG_Z
    }

    // ------------------------------------------------------------------ tiro
    pub fn shoot(&mut self, ecs: &mut Ecs, which: usize) {
        if !self.running || self.paused || self.completed || self.gun_mode == "none" {
            return;
        }
        let blue = which == BLUE;
        if self.gun_mode == "blue" && !blue {
            self.events.push(GameEvent::PortalFail);
            self.events.push(GameEvent::Denied);
            return;
        }
        self.events.push(GameEvent::Shot(which));
        self.gun_kick = Some(self.portals.list[which].color);
        let allowed = self.portals_allowed(self.player.pos);
        let origin = self.cam.translation;
        let dir = self.cam_forward();
        // relógio parado: o vermelho mira as paredes do passado (Δ s atrás)
        let ch_paused = self.relogio.as_ref().is_some_and(|c| c.paused);
        let temporal = !blue && ch_paused && self.relogio.as_ref().is_some_and(|c| c.max_delta() >= 0.5);
        if !blue && ch_paused && !temporal {
            self.toast("Ainda não há passado para mirar: espere o tempo andar um pouco.");
        }
        let wall = if temporal {
            let d = self.relogio.as_ref().unwrap().delta;
            self.ch_in_past(ecs, d, |g| g.world.raycast(origin, dir, 400.0))
        } else {
            self.world.raycast(origin, dir, 400.0)
        };
        let fz = self.world.ray_fizzler(origin, dir, wall.as_ref().map(|w| w.dist).unwrap_or(400.0), Vec3::ZERO);
        let end = fz.map(|f| f.1).or(wall.as_ref().map(|w| w.point)).unwrap_or(origin + dir * 60.0);
        let tip = origin + self.cam.rotation * Vec3::new(0.18, -0.12, -0.6);
        let color = self.portals.list[which].color;
        self.bolts.fire(ecs, which, color, tip, end, crate::shots::Landing { origin, dir, allowed, level: self.level, temporal });
    }

    /// o projétil chegou: abre o portal (ou faísca, se a superfície não aceita)
    pub fn land_shot(&mut self, ecs: &mut Ecs, which: usize, l: &crate::shots::Landing) {
        if l.level != self.level || !self.running || self.completed {
            return;
        }
        let wall = self.world.raycast(l.origin, l.dir, 400.0);
        let fz = self.world.ray_fizzler(l.origin, l.dir, wall.as_ref().map(|w| w.dist).unwrap_or(400.0), Vec3::ZERO);
        let ok = if l.temporal && self.relogio.is_some() {
            let ok = l.allowed && fz.is_none() && self.ch_place_orange(ecs, l.origin, l.dir);
            if ok {
                let d = self.portals.list[1].delta;
                self.toast(&crate::i18n::tlv("Portal aberto {d} s no passado: entre no ciano para voltar.", &[("d", crate::world::fmt_num(d))]));
            }
            ok
        } else {
            let ok = l.allowed && fz.is_none() && self.portals.try_place(&self.world, which, l.origin, l.dir, false).ok;
            // fora da pausa, o vermelho é um portal normal (Δ = 0)
            if ok && which == ORANGE {
                self.portals.list[1].delta = 0.0;
            }
            ok
        };
        if ok {
            self.events.push(GameEvent::PortalOpen(which));
            self.mp_portal(which);
            self.world.phys.wake_all();
        } else {
            self.events.push(GameEvent::PortalFail);
            if !l.allowed {
                self.toast("Aqui dentro o campo do túnel não deixa abrir portal.");
            }
        }
    }

    /// falas (lista de [quem, texto]) para as legendas
    pub fn say_value(&mut self, lines: &Value) {
        let lines: Vec<(String, String)> = lines
            .as_array()
            .map(|a| a.iter().filter_map(|l| Some((l.get(0)?.as_str()?.to_string(), l.get(1)?.as_str()?.to_string()))).collect())
            .unwrap_or_default();
        self.say(lines);
    }

    pub fn say(&mut self, lines: Vec<(String, String)>) {
        self.subs.extend(lines.iter().cloned());
        self.events.push(GameEvent::Lines(lines));
    }

    /// a superfície na mira aceita portal? (None: sem arma ou segurando algo)
    pub fn aim_ok(&mut self) -> Option<bool> {
        if self.gun_mode == "none" || self.held.is_some() || self.level.is_none() {
            return None;
        }
        let origin = self.cam.translation;
        let dir = self.cam_forward();
        let allowed = self.portals_allowed(self.player.pos);
        let wall = self.world.raycast(origin, dir, 400.0);
        let fz = wall.as_ref().and_then(|w| self.world.ray_fizzler(origin, dir, w.dist, Vec3::ZERO));
        let which = if !self.portals.list[BLUE].fixed { Some(BLUE) } else if self.gun_mode == "both" && !self.portals.list[ORANGE].fixed { Some(ORANGE) } else { None };
        let Game { portals, world, .. } = self;
        let ok = allowed && wall.is_some() && fz.is_none() && which.is_some_and(|w| portals.try_place(world, w, origin, dir, true).ok);
        Some(ok)
    }

    pub fn toast(&mut self, s: &str) {
        self.toasts.push((s.to_string(), 3.0));
    }

    pub fn die(&mut self, why: &str) {
        self.deaths += 1;
        // o relógio recomeça com você
        if self.relogio.is_some() {
            if let Some(mut ch) = self.relogio.take() {
                ch.clones.clear();
                self.relogio = Some(ch);
            }
            self.relogio = None;
            self.ch_start();
        }
        self.field.active.clear();
        self.field.charge = 0.0;
        self.dead_flash = 1.0;
        if let Some(i) = self.level {
            let who = self.levels[i].who.clone();
            let opts = ["Opa. Volta pro começo e tenta de novo.", "Essa doeu. De novo!", "Calma, sô. Mais uma vez."];
            self.say(vec![(who, opts[self.deaths as usize % 3].to_string())]);
        }
        self.health = 100.0;
        self.release(false);
        self.events.push(GameEvent::Died(why.to_string()));
        self.respawn();
        self.last_player_pos = self.player.pos;
    }

    pub fn complete(&mut self, fin: bool) {
        if self.completed {
            return;
        }
        self.completed = true;
        self.final_shown = fin;
        self.events.push(GameEvent::Complete);
        self.save_proof();
        let Some(i) = self.level else { return };
        let l = self.levels[i].clone();
        let t = self.level_time;
        let key = l.id.to_string();
        let prev = self.progress.best.get(&key).copied();
        if prev.is_none_or(|p| t < p) {
            self.progress.best.insert(key, t);
        }
        match l.series.as_deref() {
            Some("mine") => {}
            Some(s) => {
                let n = (self.progress.series_n(s)).max(l.n.unwrap_or(0) + 2);
                self.progress.series.insert(s.to_string(), n);
            }
            None => self.progress.unlocked = self.progress.unlocked.max((l.id + 1).min(self.levels.len() as i64)),
        }
        if fin {
            self.progress.unlocked = self.levels.len() as i64;
            self.say(vec![
                ("Dona Cida".into(), "Chegou, meu filho? Eu falei que lá do outro lado era mar.".into()),
                ("Helena".into(), "Num túnel de verdade, de um lado ao outro da Terra, essa viagem levaria quarenta e dois minutos.".into()),
                ("Helena".into(), "Mas agora você sabe por quê. Obrigada por cavar com a gente.".into()),
            ]);
        }
        self.progress.save();
        self.done_prev = prev;
    }

    /// o fim de câmara: título, tempo (e recorde), há próxima câmara
    pub fn done_info(&self) -> Option<(String, String, bool)> {
        let i = self.level?;
        let l = &self.levels[i];
        let ending = if l.code.is_some() { "o" } else { "a" };
        let label = crate::hud::level_label(l);
        let title = self.done_title.clone().map(|t| crate::i18n::tl(&t)).unwrap_or_else(|| if crate::i18n::is_en() { crate::i18n::tlv("{label} concluído", &[("label", label.clone())]) } else { format!("{label} concluíd{ending}") });
        let t = self.level_time;
        let rec = match self.done_prev {
            Some(p) if p <= t => format!(" · {}", crate::i18n::tlv("recorde {time}", &[("time", crate::hud::fmt_time(p))])),
            _ => format!(" · {}", crate::i18n::tl("novo recorde!")),
        };
        let next = self.levels.get(i + 1).is_some_and(|n| n.series == l.series && !n.free) && l.series.as_deref() != Some("mine") && !l.free;
        Some((title, format!("{}{rec}", crate::i18n::tlv("Tempo: {time}", &[("time", crate::hud::fmt_time(t))])), next))
    }

    /// começa a câmara `i` (no próximo quadro)
    pub fn start_level(&mut self, i: usize) {
        if self.mp_set_level(i) {
            return;
        }
        if self.levels.get(i).is_some_and(|l| self.progress.locked(l)) {
            return;
        }
        self.want_idx = Some((i, false));
        self.progress.last = Some(i);
        self.progress.save();
    }

    /// volta ao menu (a câmara 1 ao fundo)
    pub fn to_menu(&mut self) {
        // (saindo de um teste do editor: o editor fecha; o nível já foi salvo)
        if !self.editing {
            self.editor = None;
        }
        self.menu = true;
        self.running = false;
        self.paused = false;
        self.completed = false;
        self.final_shown = false;
        self.want_idx = Some((0, true));
    }

    // ------------------------------------------------------------------ entrada
    fn controls(&mut self, ecs: &mut Ecs, c: &mut Controls, real_dt: f32) {
        self.input.f = c.f;
        self.input.b = c.b;
        self.input.l = c.l;
        self.input.r = c.r;
        self.input.crouch = c.crouch;
        // câmera de cena "jogador parado"
        if self.camp_view.is_some_and(|v| v.freeze) {
            self.input.f = false;
            self.input.b = false;
            self.input.l = false;
            self.input.r = false;
        }
        if !self.running || self.paused {
            c.pressed.clear();
            c.released.clear();
            c.mouse = Vec2::ZERO;
            return;
        }
        // mouse (com zoom, mais fino)
        let fov_k = 1.0 / self.zoom.2.max(1.0);
        self.player.look(c.mouse.x * fov_k, c.mouse.y * fov_k);
        self.gun_look += c.mouse;
        // roda do mouse: com o tempo parado escolhe Δ; senão, zoom (para cima aproxima)
        let wheel = std::mem::take(&mut c.wheel);
        let ch_paused = self.relogio.as_ref().is_some_and(|ch| ch.paused);
        if ch_paused {
            if wheel != 0.0 {
                self.ch_scrub_by((wheel / 40.0) * 0.5);
            }
            let k = (c.scrub_in as i32 - c.scrub_out as i32) as f32;
            if k != 0.0 {
                self.ch_scrub_by(k * 4.0 * real_dt);
            }
        } else if wheel > 0.0 {
            self.zoom_step(true);
        } else if wheel < 0.0 {
            self.zoom_step(false);
        }
        c.mouse = Vec2::ZERO;
        // setas: aceleração suave (até ~150°/s de lado e ~100°/s para cima/baixo)
        let wx = (c.look_r as i32 - c.look_l as i32) as f32;
        let wy = (c.look_d as i32 - c.look_u as i32) as f32;
        let ease = |v: f32, w: f32| if w != 0.0 { v + (w - v) * (real_dt * 6.0).min(1.0) } else { 0.0 };
        self.look_vel = Vec2::new(ease(self.look_vel.x, wx), ease(self.look_vel.y, wy));
        if self.look_vel != Vec2::ZERO {
            let px = 2.6 * real_dt / 0.0022;
            let py = 1.75 * real_dt / 0.0022;
            self.player.look(self.look_vel.x * px * fov_k, self.look_vel.y * py * fov_k);
            self.gun_look += Vec2::new(self.look_vel.x * px, self.look_vel.y * py);
        }
        for k in std::mem::take(&mut c.pressed) {
            match k {
                Key::Jump => self.input.jump = true,
                Key::FireBlue => self.fire_down(0),
                Key::FireOrange => self.fire_down(2),
                Key::Restart => {
                    if let Some(i) = self.level {
                        self.load(ecs, i);
                    }
                }
                Key::Use => self.use_key(ecs),
                Key::Slow => self.toggle_slow(None),
                Key::TimeTravel => self.time_travel(ecs),
                Key::StopTime => self.ch_pause(),
                Key::ZoomIn if self.relogio.as_ref().is_some_and(|c| c.paused) => {}
                Key::ZoomOut if self.relogio.as_ref().is_some_and(|c| c.paused) => {}
                Key::ZoomIn => self.zoom_step(true),
                Key::ZoomOut => self.zoom_step(false),
                _ => {}
            }
        }
        for k in std::mem::take(&mut c.released) {
            match k {
                Key::FireBlue => self.fire_up(ecs, 0),
                Key::FireOrange => self.fire_up(ecs, 2),
                _ => {}
            }
        }
        if !c.jump {
            self.input.jump = false; // (o pulo só vale enquanto a tecla está apertada; o jogador consome)
        }
    }

    fn fire_down(&mut self, button: usize) {
        self.fire_held[button] = true;
        // segurando um objeto: o ciano arremessa (e não sai portal)
        if button == 0 && self.held.is_some() {
            self.release(true);
            self.fire_held[0] = false;
            return;
        }
        if self.fire_held[0] && self.fire_held[2] {
            self.pending_shot = None;
            return;
        }
        self.pending_shot = Some((if button == 0 { BLUE } else { ORANGE }, 0.0));
    }

    fn fire_up(&mut self, ecs: &mut Ecs, button: usize) {
        if !self.fire_held[button] {
            return;
        }
        self.fire_held[button] = false;
        let which = if button == 0 { BLUE } else { ORANGE };
        if let Some((w, _)) = self.pending_shot {
            if w == which {
                self.pending_shot = None;
                self.shoot(ecs, which);
            }
        }
    }

    /// viagem no tempo (T, série Fronteira): troca a sala entre o passado e o futuro
    pub fn time_travel(&mut self, ecs: &mut Ecs) {
        if !self.running || self.paused || self.completed || !self.data.get("timeTravel").and_then(|v| v.as_bool()).unwrap_or(false) {
            return;
        }
        let target = if self.world.era == "past" { "future" } else { "past" };
        // na outra época o jogador ficaria dentro de algo?
        let (mn, mx) = (self.player.pos - self.player.half, self.player.pos + self.player.half);
        let blocked = self.world.era_items.iter().any(|(o, era)| {
            let crate::world::EraObj::Solid(i) = o else { return false };
            let b = &self.world.solids[*i];
            era == target && b.solid && crate::world::aabb_overlap(mn, mx, b.min, b.max, 0.0)
        });
        if blocked {
            self.events.push(GameEvent::Denied);
            self.toast("Não dá: na outra época você ficaria dentro de uma parede.");
            return;
        }
        self.world.set_era(ecs, target);
        self.events.push(GameEvent::TimeShift(target == "past"));
        // portais em paredes que não existem nesta época se apagam
        for i in [BLUE, ORANGE] {
            let p = &self.portals.list[i];
            if p.placed && p.solid.is_some_and(|s| !self.world.listed(s)) {
                self.portals.list[i].remove();
            }
        }
        // objetos que ficariam dentro de algo voltam ao ponto de partida
        for k in 0..self.props.list.len() {
            let c = &self.props.list[k];
            if c.gone || self.held == Some(k) {
                continue;
            }
            if self.world.point_in_solid(c.pos, None).is_some() {
                let c = &mut self.props.list[k];
                if c.kind == crate::props::Kind::Cube {
                    c.respawn(&mut self.world.phys);
                } else {
                    c.vanish(&mut self.world.phys);
                }
            }
        }
        self.world.phys.wake_all();
    }

    /// liga/desliga o tempo lento (botão do meio / G)
    pub fn toggle_slow(&mut self, force: Option<bool>) {
        let want = force.unwrap_or(!self.slow.on);
        if want == self.slow.on {
            return;
        }
        if want {
            if !self.running || self.paused || self.completed {
                return;
            }
            if self.slow.left < 0.6 {
                self.events.push(GameEvent::Denied);
                self.toast("Reserva de tempo lento vazia — espere recarregar.");
                return;
            }
        }
        self.slow.on = want;
        self.slow.beat = 0.0;
        self.events.push(if want { GameEvent::SlowIn } else { GameEvent::SlowOut });
    }

    fn update_slowmo(&mut self, real_dt: f32) {
        let s = &mut self.slow;
        if s.on {
            s.left -= real_dt;
            s.beat -= real_dt;
            if s.beat <= 0.0 {
                s.beat = 0.8;
                self.events.push(GameEvent::Heartbeat);
            }
            if s.left < 1.5 {
                s.warn -= real_dt;
                if s.warn <= 0.0 {
                    s.warn = 0.25;
                    self.events.push(GameEvent::LowTime);
                }
            }
            if s.left <= 0.0 {
                s.left = 0.0;
                self.toggle_slow(Some(false));
            }
        } else {
            s.left = (s.left + real_dt).min(s.max);
        }
        let s = &mut self.slow;
        s.k += ((if s.on { s.scale } else { 1.0 }) - s.k) * (real_dt * 7.0).min(1.0);
    }

    /// carga do campo (tempo real): os dois botões seguros, sem nada nas mãos
    fn update_field(&mut self, real_dt: f32, live: bool) {
        let both = live && self.fire_held[0] && self.fire_held[2] && self.held.is_none();
        let f = &mut self.field;
        if !both {
            f.armed = true; // precisa soltar antes de carregar de novo
        }
        if both && f.armed && f.own().is_none() {
            f.charge += real_dt;
            if f.charge >= f.need {
                f.charge = 0.0;
                f.armed = false;
                let c = self.player.pos;
                f.active.push(FieldInst { center: c, left: f.life, own: true });
                if let Some(ch) = self.relogio.as_ref() {
                    f.events.push(FieldEv { t0: ch.tw, center: c, life: f.life, loop_n: ch.loop_n });
                    f.last_tw = ch.tw;
                }
                f.shake = 0.7;
                self.events.push(GameEvent::FieldBurst(c));
            }
        } else {
            f.charge = (f.charge - real_dt * 3.0).max(0.0);
        }
        let f = &mut self.field;
        f.shake = (f.shake - real_dt).max(0.0);
    }

    /// E: solta o que está segurando, aperta o botão na mira ou pega o objeto na mira
    pub fn use_key(&mut self, ecs: &mut Ecs) {
        if !self.running || self.paused {
            return;
        }
        if self.held.is_some() {
            self.release(false);
            return;
        }
        let origin = self.cam.translation;
        let dir = self.cam_forward();
        if let Some(mut rt) = self.camp.take() {
            let used = rt.use_(self, ecs, origin, dir);
            self.camp = Some(rt);
            if used {
                return;
            }
        }
        if let Some(b) = self.aim_button(origin, dir) {
            self.world.press_button(b);
            self.events.push(GameEvent::Press(b));
            // os apertos entram na linha do tempo: voltando, a sua versão do passado aperta de novo
            if let Some(ch) = self.relogio.as_mut() {
                let (tw, ln) = (ch.tw, ch.loop_n);
                ch.presses.push((tw, b, ln));
            }
            return;
        }
        let hit = self.props.ray(origin, dir, 2.8);
        // por trás de uma torreta ativa: E desliga (e ela tomba)
        let pp = self.player.pos;
        if let Some(ti) = (0..self.props.list.len()).find(|&k| self.props.list[k].can_disable_from(pp) && hit.is_none_or(|h| h.0 == k)) {
            if self.props.list[ti].disable(&mut self.world.phys, "desligada", 55.0) {
                self.events.push(GameEvent::TurretOff(ti));
                self.mp_turret(ti);
                self.toast("Torreta desligada.");
            }
            return;
        }
        let Some((i, t)) = hit else { return };
        if self.world.raycast(origin, dir, t).is_some() {
            return;
        }
        self.held = Some(i);
        if let Some(mut rt) = self.camp.take() {
            rt.on_pickup(self, i);
            self.camp = Some(rt);
        }
        let yaw_q = Quat::from_rotation_y(self.player.yaw);
        let c = &mut self.props.list[i];
        c.held = true;
        c.far_time = 0.0;
        c.space = Mat4::IDENTITY;
        // segura mantendo o giro relativo ao olhar (no múltiplo de 90° mais perto);
        // torreta e cubo refletor: virados para a frente
        c.hold_base = if c.kind == crate::props::Kind::Turret || c.redirect {
            Quat::from_rotation_y(std::f32::consts::PI)
        } else {
            let f = (yaw_q.inverse() * c.quat) * Vec3::Z;
            let step = std::f32::consts::FRAC_PI_2;
            Quat::from_rotation_y((f.x.atan2(f.z) / step).round() * step)
        };
        self.events.push(GameEvent::Pick);
    }

    /// o botão de apertar na mira (até 2,3 m, sem parede no meio)
    fn aim_button(&self, origin: Vec3, dir: Vec3) -> Option<usize> {
        let mut best = None;
        let mut bt = 2.3;
        for (i, b) in self.world.push_buttons.iter().enumerate() {
            let to = b.pos - origin;
            let t = to.dot(dir);
            if t <= 0.0 || t > bt || (to - dir * t).length() > 0.22 {
                continue;
            }
            if self.world.raycast(origin, dir, t - 0.12).is_some() {
                continue;
            }
            best = Some(i);
            bt = t;
        }
        best
    }

    /// solta o objeto segurado; `toss`: arremessa na direção da mira
    pub fn release(&mut self, toss: bool) {
        let Some(i) = self.held.take() else { return };
        let fwd = self.cam_forward();
        let pv = self.player.vel;
        let c = &mut self.props.list[i];
        c.held = false;
        c.hold_local = None;
        if toss {
            // a mira e a velocidade do jogador levadas para o lado em que o objeto está
            let (_, rot, _) = c.space.to_scale_rotation_translation();
            let v = rot * (pv * 0.8 + fwd * 7.0);
            c.throw(&mut self.world.phys, v);
            self.events.push(GameEvent::Toss);
        } else {
            self.events.push(GameEvent::Drop);
        }
    }

    /// até onde o objeto segurado vai à frente da mira (no máximo 1,7 m); o raio atravessa portais
    fn hold_distance(&self, eye: Vec3, fwd: Vec3) -> f32 {
        const MAX: f32 = 1.7;
        let mut o = eye;
        let mut d = fwd;
        let mut dist = 0.0;
        for _ in 0..3 {
            let rest = MAX - dist;
            let wall = self.world.raycast(o, d, rest);
            let end = o + d * wall.as_ref().map(|w| w.dist + 0.01).unwrap_or(rest);
            if self.portals.temporal_crossing(o, end).is_some() {
                return MAX;
            }
            let Some(p) = self.portals.crossing(o, end, crate::portals::Who::Player) else {
                return wall.map(|w| (dist + w.dist - 0.45).max(0.5)).unwrap_or(MAX);
            };
            let pp = &self.portals.list[p];
            let tc = (pp.center - o).dot(pp.normal) / d.dot(pp.normal);
            dist += tc;
            let m = self.portals.transform(p, pp.partner);
            o = m.transform_point3(o + d * (tc + 0.01));
            d = m.transform_vector3(d);
        }
        MAX
    }

    fn zoom_step(&mut self, zin: bool) {
        let (on, level, _) = &mut self.zoom;
        if zin {
            if !*on {
                *on = true;
                *level = level.max(2.0);
            } else {
                *level = (*level * 1.25).clamp(1.5, 8.0);
            }
        } else if *on {
            if *level <= 1.6 {
                *on = false;
            } else {
                *level = (*level / 1.25).clamp(1.5, 8.0);
            }
        }
    }

    /// com o relógio: os campos ativos são os da linha do tempo no instante tw (os da sua versão do
    /// passado reaparecem na hora e no lugar em que ela os criou); num salto, só as marcas de "dentro" são refeitas
    fn sync_field_timeline(&mut self, dt: f32) {
        let Some(ch) = self.relogio.as_ref() else { return };
        let (tw, ln) = (ch.tw, ch.loop_n);
        let f = &mut self.field;
        let jumped = tw < f.last_tw - 1e-6 || tw - f.last_tw > dt + 0.05;
        f.last_tw = tw;
        let before: Vec<Vec3> = f.active.iter().map(|x| x.center).collect();
        f.active = f.events.iter().filter(|e| tw >= e.t0 - 1e-6 && tw < e.t0 + e.life).map(|e| FieldInst { center: e.center, left: e.t0 + e.life - tw, own: e.loop_n == ln }).collect();
        if !jumped {
            for x in &f.active {
                if !x.own && !before.iter().any(|c| c.distance(x.center) < 1e-4) {
                    self.events.push(GameEvent::FieldBurst(x.center));
                    // a sua versão do passado criando o campo agora: o tranco chega até você
                    let d = self.player.pos.distance(x.center);
                    if d < 12.0 {
                        f.shake = f.shake.max(0.7 * (1.0 - d / 12.0).max(0.3));
                    }
                }
            }
            if f.active.len() < before.len() {
                self.events.push(GameEvent::FieldEnd);
            }
        } else {
            let field = self.field.clone();
            for c in &mut self.props.list {
                c.dilated = field.inside(c.pos) && !c.held && !c.gone;
            }
        }
    }

    /// uma peça em movimento encostada empurrou você para dentro de outra (por mais de 0,12 s)
    fn crushed(&mut self, dt: f32) -> bool {
        let pl = &self.player;
        let (mn, mx) = (pl.pos - pl.half + Vec3::splat(0.12), pl.pos + pl.half - Vec3::splat(0.12));
        let near = |a: Vec3, b: Vec3, m: f32| b.x > mn.x - m && a.x < mx.x + m && b.y > mn.y - m && a.y < mx.y + m && b.z > mn.z - m && a.z < mx.z + m;
        let pushing = self.world.doors.iter().any(|d| {
            let b = &self.world.solids[d.solid];
            d.delta.length_squared() > 1e-8 && !b.disabled && near(b.min, b.max, 0.2)
        });
        // entrando/saindo de um portal (ou logo depois de atravessar, ou no salto no tempo) não conta
        let at_portal = !self.portals.mouths(pl.pos, true, 0.5).is_empty() || pl.cooldown > -0.4 || self.relogio.as_ref().is_some_and(|c| c.sweep.is_some());
        if at_portal {
            self.crush_t = 0.0;
        }
        let mut inside = false;
        if pushing && !at_portal {
            let mut pts = vec![pl.pos];
            for sx in [mn.x, mx.x] {
                for sy in [mn.y, mx.y] {
                    for sz in [mn.z, mx.z] {
                        pts.push(Vec3::new(sx, sy, sz));
                    }
                }
            }
            for i in self.world.solid_ids() {
                let b = &self.world.solids[i];
                if b.disabled || !b.solid || !near(b.min, b.max, 0.0) {
                    continue;
                }
                if let Some(o) = &b.obb {
                    if pts.iter().any(|p| {
                        let l = o.qi * (*p - o.c);
                        l.x.abs() < o.half.x && l.y.abs() < o.half.y && l.z.abs() < o.half.z
                    }) {
                        inside = true;
                        break;
                    }
                    continue;
                }
                match &b.planes {
                    None => {
                        inside = true;
                        break;
                    }
                    Some(planes) => {
                        if pts.iter().any(|p| planes.iter().all(|pl| pl.n.dot(*p) < pl.d - 0.02)) {
                            inside = true;
                            break;
                        }
                    }
                }
            }
        }
        self.crush_t = if inside { self.crush_t + dt } else { 0.0 };
        self.crush_t > 0.12
    }

    // ------------------------------------------------------------------ quadro
    pub fn update(&mut self, ecs: &mut Ecs, dt: f32, t: f32) {
        let pdt = dt * self.p_scale; // tempo do jogador (menor dentro do campo de dilatação)
        if self.relogio.is_some() {
            self.sync_field_timeline(dt);
        } else if !self.field.active.is_empty() {
            for f in &mut self.field.active {
                f.left -= dt;
            }
            if self.field.active.iter().any(|f| f.left <= 0.0) {
                self.field.active.retain(|f| f.left > 0.0);
                self.events.push(GameEvent::FieldEnd);
            }
        }
        self.level_time += dt;
        self.level_extras(dt);
        self.update_finds(ecs, dt, t);
        self.boss_update(ecs, dt, t);
        self.dead_flash = (self.dead_flash - dt * 1.5).max(0.0);
        // dicas por tempo (`hints: [{ after, lines }]`)
        if let Some(hints) = self.data.get("hints").and_then(|h| h.as_array()).cloned() {
            for (k, h) in hints.iter().enumerate() {
                let after = h.get("after").and_then(|v| v.as_f64()).unwrap_or(f64::MAX) as f32;
                if self.level_time >= after && !self.hints_fired.get(k).copied().unwrap_or(true) {
                    self.hints_fired[k] = true;
                    if let Some(l) = h.get("lines") {
                        self.say_value(l);
                    }
                }
            }
        }
        // tiro esperando o outro botão
        if let Some((w, age)) = self.pending_shot {
            if age + dt > CHORD_MS {
                self.pending_shot = None;
                self.shoot(ecs, w);
            } else {
                self.pending_shot = Some((w, age + dt));
            }
        }
        for (which, landing) in self.bolts.update(ecs, dt, t) {
            self.land_shot(ecs, which, &landing);
        }
        // relógio do tempo: 0 enquanto o mundo está parado ou voltando
        let real_dt = self.real_dt;
        let (wdt, tv) = if self.relogio.is_some() {
            let w = self.ch_frame(ecs, dt, real_dt);
            (w, self.relogio.as_ref().unwrap().vt)
        } else {
            (dt, t)
        };
        self.world.update(ecs, tv, wdt);
        if let Some(mut rt) = self.camp.take() {
            rt.update(self, ecs, wdt);
            // créditos do final: (sem a sequência cantada) a campanha termina logo depois
            if let Some(t) = self.camp_credits.as_mut() {
                *t += wdt;
                if *t > 1.0 {
                    self.camp_credits = None;
                    rt.credits_done(self);
                }
            }
            self.camp = Some(rt);
        }
        crate::portal_render::animate(&mut self.portals, dt);
        // ---- jogador
        // dentro de um funil de excursão: a velocidade vai para a do fluxo; as teclas (na direção
        // da mira) empurram para os lados — é assim que se sai
        if let Some((mut flow, axis)) = self.gravity().flow(self.player.pos) {
            let look = self.cam_forward();
            let right = look.cross(Vec3::Y).normalize_or_zero();
            let b = |x: bool| if x { 1.0 } else { 0.0 };
            let mut wish = look * (b(self.input.f) - b(self.input.b)) + right * (b(self.input.r) - b(self.input.l));
            wish -= axis * wish.dot(axis);
            if wish.length_squared() > 1e-4 {
                flow += wish.normalize() * 4.5;
            }
            self.player.vel = self.player.vel.lerp(flow, 1.0 - (-pdt * 5.0).exp());
        }
        let g = self.gravity_at(self.player.pos);
        let mut input = self.input;
        let portals = std::mem::take(&mut self.portals);
        let mut teleported = vec![];
        let last = self.last_player_pos;
        let mut fizz = false;
        {
            let world = &mut self.world;
            let held = self.held;
            let gone_list: Vec<bool> = self.props.list.iter().map(|p| p.gone).collect();
            let gone = |p: usize| gone_list.get(p).copied().unwrap_or(true);
            let mut on_tp = |p: usize, pl: &mut Player| {
                let pp = &portals.list[p];
                let to_mouth = last - pp.normal * (last - pp.center).dot(pp.normal);
                teleported.push((p, to_mouth, pl.pos));
            };
            self.player.update(pdt, &mut input, world, &portals, g, held, &gone, &mut on_tp);
        }
        let mut jumps = vec![];
        for (p, to_mouth, after) in teleported {
            if self.world.segment_fizzler(last, to_mouth, self.player.half).is_some() {
                fizz = true;
            }
            self.last_player_pos = after;
            self.events.push(GameEvent::Teleport(p));
            // chegou à Lua pela primeira vez
            if portals.list[portals.list[p].partner].moon && !self.moon_visited {
                self.moon_visited = true;
                self.events.push(GameEvent::Vacuum);
                if let Some(l) = self.data.get("moonLines").cloned() {
                    self.say_value(&l);
                }
            }
            // ciano temporal: o jogador viaja no tempo (o relógio restaura o mundo e cria o clone)
            if self.relogio.is_some() && portals.list[portals.list[p].partner].delta > 0.0 {
                jumps.push(p);
                continue;
            }
            // o jogador mudou de lado: o objeto segurado continua onde está e passa a seguir a
            // mira "através" do portal (até atravessar também)
            if let Some(h) = self.held {
                let m = portals.transform(p, portals.list[p].partner).inverse();
                self.props.list[h].space *= m;
            }
        }
        self.portals = portals;
        for p in jumps {
            self.ch_jump(ecs, p);
            self.last_player_pos = self.player.pos;
        }
        self.input.jump = input.jump;
        if fizz {
            self.fizzle_before_portal = true;
        }
        // porta/plataforma em movimento entrou no jogador: pistão esmaga; o resto empurra
        for d in &self.world.doors {
            let b = &self.world.solids[d.solid];
            if d.delta.length_squared() == 0.0 || self.player.ground == Some(crate::physics::Ent::Static(d.solid)) {
                continue;
            }
            let p = self.player.pos;
            let h = self.player.half;
            let pen = [0, 1, 2].map(|a| (p[a] + h[a] - b.min[a]).min(b.max[a] - (p[a] - h[a])));
            if pen.iter().any(|&v| v <= 0.06) {
                continue;
            }
            if d.crush {
                self.die("esmagado");
                break;
            }
            let i = (0..3).min_by(|&x, &y| pen[x].partial_cmp(&pen[y]).unwrap()).unwrap();
            let center = (b.min[i] + b.max[i]) / 2.0;
            self.player.pos[i] += if p[i] > center { 1.0 } else { -1.0 } * (pen[i] + 0.01);
        }
        if self.crushed(dt) {
            self.die("esmagado");
        }
        // ---- objetos (cubos e torretas): corpos rígidos
        self.props_step(ecs, dt, t);
        // ---- série Fronteira: lasers, pontes, funis, placas, buracos negros, Lua
        self.frontier_update(ecs, dt, t);
        // ---- sinais: botões, portas
        self.signals(wdt);
        // ---- grade de desintegração: passar por ela some com os seus portais
        let now_in = self.fizzle_before_portal || self.world.segment_fizzler(self.last_player_pos, self.player.pos, self.player.half).is_some();
        self.fizzle_before_portal = false;
        self.last_player_pos = self.player.pos;
        if now_in && !self.in_fizzler {
            let fzs: Vec<usize> = (0..self.world.fizzlers.len()).filter(|&i| self.world.fizzlers[i].on).collect();
            for i in fzs {
                let f = &self.world.fizzlers[i];
                let c = self.player.pos.clamp(f.min, f.max);
                if c.distance(self.player.pos) < 1.2 {
                    self.world.fizzler_ripple(ecs, i, c, t);
                }
            }
            if self.portals.fizzle() {
                self.events.push(GameEvent::Fizzle);
            }
            if let Some(h) = self.held {
                self.release(false);
                self.dissolve(h, crate::dissolver::FIZZLE, false);
                let c = &mut self.props.list[h];
                if c.kind == crate::props::Kind::Cube {
                    c.respawn(&mut self.world.phys);
                } else {
                    c.vanish(&mut self.world.phys);
                }
            }
        }
        self.in_fizzler = now_in;
        // ---- pedestal da arma
        for i in 0..self.world.pedestals.len() {
            let pd = &self.world.pedestals[i];
            if pd.taken || self.player.pos.distance(pd.pos) >= 1.5 {
                continue;
            }
            let (holder, light, gives) = (pd.holder, pd.light, pd.gives.clone());
            self.world.pedestals[i].taken = true;
            ecs.entity_mut(holder).insert(Visibility::Hidden);
            if let Some(mut l) = ecs.get_mut::<PointLight>(light) {
                l.intensity = 0.0;
            }
            self.gun_mode = gives.clone();
            if let Some(rt) = self.camp.as_mut() {
                rt.pickup_gun(i);
            }
            self.events.push(GameEvent::Gun(gives.clone()));
            self.toast(if gives == "blue" { "Você pegou a arma de portais (por enquanto, só o portal ciano)." } else { "Arma completa: agora ela abre os dois portais!" });
        }
        // ---- bolas de energia
        let pb = (self.player.pos - self.player.half, self.player.pos + self.player.half);
        let field = self.field.clone();
        let rate = field.rate as f32;
        let ev = self.energy.update(ecs, wdt, t, &mut self.world, &self.portals, &mut self.props, Some(pb), &|p| if field.inside(p) { 1.0 / rate } else { 1.0 });
        for e in ev {
            if e == crate::energy::EnergyEvent::HitPlayer {
                self.die("bola de energia");
            }
            if matches!(e, crate::energy::EnergyEvent::IntoPast { .. } | crate::energy::EnergyEvent::ToPast { .. }) {
                self.ch_energy_event(ecs, &e);
                continue;
            }
            self.events.push(GameEvent::Energy(e));
        }
        // bolas do passado que entraram no vermelho temporal saem pelo ciano; duplos dos objetos
        self.ch_past_pellets(ecs);
        // ---- torretas
        if self.props.list.iter().any(|p| p.turret.is_some()) {
            let eye = self.player.eye();
            let mut via = vec![];
            for p in [BLUE, ORANGE] {
                let pp = &self.portals.list[p];
                if !pp.placed || !self.portals.is_linked(p) || pp.delta > 0.0 || self.portals.list[pp.partner].delta > 0.0 {
                    continue;
                }
                via.push(crate::turrets::Via { real: eye, p, q: pp.partner, past: false });
            }
            let grav = self.gravity();
            let g_up = |p: Vec3| -grav.at(p).normalize_or_zero();
            let mut shots = crate::turrets::update(ecs, wdt, t, &mut self.world, &self.portals, &mut self.props, &g_up, Some(eye), &via);
            // torretas do passado veem você pelo vermelho: as balas saem do ciano
            shots += self.ch_past_turret_shots(ecs, wdt, eye);
            for (k, p) in self.props.list.iter_mut().enumerate() {
                let Some(tu) = p.turret.as_mut() else { continue };
                if tu.spotted_now && !tu.was_spotted {
                    self.events.push(GameEvent::TurretSpot(k));
                }
                if !tu.active && tu.was_active {
                    self.events.push(GameEvent::TurretOff(k));
                }
                tu.was_spotted = tu.spotted_now;
                tu.was_active = tu.active;
            }
            // torreta queimada pelo laser: some depois de um instante
            for k in 0..self.props.list.len() {
                let p = &mut self.props.list[k];
                let Some(tu) = p.turret.as_mut() else { continue };
                if let Some(b) = tu.burn_t.as_mut() {
                    if !p.gone {
                        *b -= dt;
                        if *b <= 0.0 {
                            tu.burn_t = None;
                            let at = Transform::from_translation(p.quat * p.mesh_offset + p.pos).with_rotation(p.quat).with_scale(Vec3::splat(p.mesh_scale));
                            self.dissolve_pending.push((p.mesh, at, crate::dissolver::BURN, false));
                            p.vanish(&mut self.world.phys);
                            self.events.push(GameEvent::Burn);
                        }
                    }
                }
            }
            if shots > 0 {
                self.health -= shots as f32 * 6.0;
                self.hurt_t = 0.0;
                self.hurt_flash = (self.hurt_flash + 0.25 * shots as f32).min(1.0);
                self.events.push(GameEvent::Hit(shots));
            } else {
                self.hurt_t += dt;
            }
            if self.hurt_t > 2.5 {
                self.health = (self.health + dt * 30.0).min(100.0);
            }
            if self.health <= 0.0 {
                self.die("torreta");
            }
        }
        self.hurt_flash = (self.hurt_flash - dt * 1.8).max(0.0);
        // ---- perigos, gatilhos, saída
        let (mn, mx) = (self.player.pos - self.player.half, self.player.pos + self.player.half);
        if self.world.hazards.iter().any(|&h| {
            let b = &self.world.solids[h];
            mn.cmplt(b.max).all() && mx.cmpgt(b.min).all()
        }) {
            self.die("lava");
        }
        let kill_y = self.data.get("killY").and_then(|v| v.as_f64()).unwrap_or(-400.0) as f32;
        if self.player.pos.y < kill_y {
            self.die("queda");
        }
        let p = self.player.pos;
        for i in 0..self.world.triggers.len() {
            let tr = &self.world.triggers[i];
            if tr.done || !(p.cmpgt(tr.min).all() && p.cmplt(tr.max).all()) || tr.era.as_ref().is_some_and(|e| *e != self.world.era) {
                continue;
            }
            if tr.exit {
                if self.verify.is_some() {
                    continue; // (rodando a linha do tempo adiantada: já está na saída)
                }
                // com o relógio: se o seu passado ainda está agindo, o resto da história roda antes de sair
                if let Some(ch) = self.relogio.as_ref() {
                    if ch.sweep.is_some() {
                        continue;
                    }
                    let until = ch.open_until();
                    if until > ch.tw {
                        self.verify = Some((until, ch.tw, ch.rollbacks, self.deaths));
                        continue;
                    }
                }
                let fin = tr.fin;
                self.world.triggers[i].done = true;
                // na sala, todos vão juntos para a próxima câmara
                if self.mp_exit(fin) {
                    continue;
                }
                self.complete(fin);
            } else if !tr.lines.is_empty() {
                let lines = tr.lines.clone();
                self.world.triggers[i].done = true;
                self.say(lines);
            }
        }
    }

    fn props_step(&mut self, ecs: &mut Ecs, dt: f32, t: f32) {
        let fwd = self.cam_forward();
        if let Some(h) = self.held {
            let eye = self.player.eye();
            let d = self.hold_distance(eye, fwd);
            let yaw = self.player.yaw;
            let c = &mut self.props.list[h];
            c.hold_local = Some(eye + fwd * d);
            c.hold_quat_local = Quat::from_rotation_y(yaw) * c.hold_base;
        }
        // no campo o objeto anda no tempo de dentro: velocidades ÷ rate ao entrar (× ao sair), gravidade ÷ rate²
        let rate = self.field.rate as f32;
        for c in &mut self.props.list {
            let inf = self.field.inside(c.pos) && !c.held && !c.gone;
            if inf {
                if let Some(b) = self.world.phys.body_mut(c.body) {
                    b.wake_up(true);
                }
            }
            if inf == c.dilated {
                continue;
            }
            let k = if inf { 1.0 / rate } else { rate };
            if let Some(b) = self.world.phys.body_mut(c.body) {
                let (v, w) = (b.linvel() * k, b.angvel() * k);
                b.set_linvel(v, true);
                b.set_angvel(w, true);
            }
            c.dilated = inf;
        }
        let grav = self.gravity();
        let field = self.field.clone();
        let g = |p: Vec3| if field.inside(p) { grav.at(p) / (rate * rate) } else { grav.at(p) };
        // funil: o objeto vai para a velocidade do fluxo
        let mut flow = |p: &mut crate::props::Prop, ph: &mut crate::physics::Physics, h: f32| {
            if p.held {
                return;
            }
            let Some((f, _)) = grav.flow(p.prev_center) else { return };
            if let Some(b) = ph.body_mut(p.body) {
                let v = b.linvel();
                let k = 1.0 - (-h * 5.0).exp();
                b.set_linvel(v + (f - v) * k, true);
            }
        };
        let crossed = self.props.step(&mut self.world, &self.portals, dt, &g, &mut flow);
        // objeto solto que entrou no ciano temporal: vai para o passado
        for k in 0..self.props.list.len() {
            if let Some(b) = self.props.list[k].to_past.take() {
                self.ch_send_to_past(ecs, k, b);
            }
        }
        if !crossed.is_empty() {
            self.events.push(GameEvent::PropPortal);
        }
        self.props.sync(ecs, &self.world.phys);
        if let Some(h) = self.held {
            // longe do alvo por um tempo = preso em algo: solta
            let c = &mut self.props.list[h];
            c.update_hold();
            c.far_time = if c.pos.distance(c.hold_target) > 2.6 { c.far_time + dt } else { 0.0 };
            if c.far_time > 0.4 {
                self.release(false);
            }
        }
        let inside = |p: Vec3, mn: Vec3, mx: Vec3| p.cmpgt(mn).all() && p.cmplt(mx).all();
        for i in 0..self.props.list.len() {
            let c = &self.props.list[i];
            if c.gone {
                continue;
            }
            let (pos, half) = (c.pos, c.half);
            // fornalha: queima a amostra e liga o sinal
            if let Some(k) = self.world.incinerators.iter().position(|f| inside(pos, f.min, f.max)) {
                if self.held == Some(i) {
                    self.release(false);
                }
                self.dissolve(i, crate::dissolver::BURN, false);
                self.props.list[i].vanish(&mut self.world.phys);
                self.world.incinerators[k].active = true;
                self.events.push(GameEvent::Burn);
                continue;
            }
            // rocha fundida ou grade: a amostra volta ao dispensador; a torreta some
            let hot = self.world.hazards.iter().any(|&h| {
                let b = &self.world.solids[h];
                crate::world::aabb_overlap(pos - half, pos + half, b.min, b.max, 0.0)
            });
            let fz: Vec<usize> = (0..self.world.fizzlers.len()).filter(|&k| self.world.fizzlers[k].on && inside(pos, self.world.fizzlers[k].min, self.world.fizzlers[k].max)).collect();
            if hot || !fz.is_empty() {
                if self.held == Some(i) {
                    self.release(false);
                }
                for k in fz {
                    self.world.fizzler_ripple(ecs, k, pos, t);
                }
                self.dissolve(i, if hot { crate::dissolver::BURN } else { crate::dissolver::FIZZLE }, false);
                let c = &mut self.props.list[i];
                if c.kind == crate::props::Kind::Cube {
                    c.respawn(&mut self.world.phys);
                } else {
                    c.vanish(&mut self.world.phys);
                }
                self.events.push(GameEvent::Fizzle);
                continue;
            }
            if !(-300.0..=400.0).contains(&pos.y) {
                let c = &mut self.props.list[i];
                if c.kind == crate::props::Kind::Cube {
                    c.respawn(&mut self.world.phys);
                } else {
                    c.vanish(&mut self.world.phys);
                }
            }
        }
    }

    /// sinais (main.js): uma porta abre quando TODOS os botões ligados a ela estão ativos
    fn signals(&mut self, wdt: f32) {
        use std::collections::HashMap;
        let feet = self.player.pos + Vec3::new(0.0, -0.9 * self.player.up_sign, 0.0);
        let props = &self.props.list;
        // pés dos clones do relógio e as cópias do passado dos objetos
        let (peers, echoes, clone_held) = match self.relogio.as_ref() {
            Some(ch) => (ch.feet(), ch.echoes(), (0..props.len()).filter(|&k| ch.clone_held(k)).collect::<Vec<_>>()),
            None => (vec![], vec![], vec![]),
        };
        for b in &mut self.world.buttons {
            let near = |q: Vec3, dy0: f32, dy1: f32| (q.x - b.pos.x).hypot(q.z - b.pos.z) < 0.85 && q.y - b.pos.y > dy0 && q.y - b.pos.y < dy1;
            let pressed = props.iter().enumerate().any(|(k, c)| !c.held && !c.gone && !clone_held.contains(&k) && near(c.pos, 0.0, 1.0))
                || echoes.iter().any(|&p| near(p, 0.0, 1.0))
                || near(feet, -0.1, 0.5)
                || peers.iter().any(|&f| near(f, -0.1, 0.5));
            if b.hold > 0.0 {
                b.count = if pressed { b.hold } else { (b.count - wdt).max(0.0) };
            }
            if pressed != b.pressed {
                b.pressed = pressed; // a placa e as luzes se animam em world.update
                self.events.push(GameEvent::Button(pressed));
            }
        }
        let mut sig: HashMap<String, bool> = HashMap::new();
        let and = |sig: &mut HashMap<String, bool>, id: &Option<String>, v: bool| {
            if let Some(id) = id {
                let cur = *sig.get(id).unwrap_or(&true);
                sig.insert(id.clone(), cur && v);
            }
        };
        for b in &self.world.buttons {
            and(&mut sig, &b.opens, b.pressed || b.count > 0.0);
        }
        for c in &self.world.catchers {
            and(&mut sig, &c.opens, c.active);
        }
        for i in &self.world.incinerators {
            and(&mut sig, &i.opens, i.active);
        }
        for c in &self.world.laser_catchers {
            and(&mut sig, &c.opens, c.active);
        }
        let before = sig.clone();
        for i in 0..self.world.push_buttons.len() {
            self.world.push_chans(i);
            let b = &self.world.push_buttons[i];
            and(&mut sig, &b.opens, b.on);
            for c in b.chans.clone().unwrap_or_default() {
                and(&mut sig, &Some(c.sig.clone()), c.on);
            }
        }
        for (id, v) in self.world.push_modes.clone() {
            if let Some(x) = before.get(&v.base) {
                and(&mut sig, &Some(id), *x);
            }
        }
        for (id, v) in self.world.signals.clone() {
            and(&mut sig, &Some(id), v);
        }
        for l in &mut self.world.lasers {
            if let Some(s) = &l.sig {
                l.off = !sig.get(s).copied().unwrap_or(false);
            }
        }
        for f in &mut self.world.funnels {
            if let Some(id) = &f.id {
                f.reversed = f.start_reversed != sig.get(id).copied().unwrap_or(false);
            }
            if let Some(p) = &f.power {
                f.off = !sig.get(p).copied().unwrap_or(false) && !(f.latch && !f.off);
            }
        }
        for d in &mut self.world.doors {
            if d.looping > 0.0 {
                let on = d.always || d.id.as_ref().and_then(|id| sig.get(id)).copied().unwrap_or(false);
                if !on {
                    d.target = 0.0;
                    continue;
                }
                if (d.open - d.target).abs() < 1e-4 {
                    d.wait -= wdt;
                    if d.wait <= 0.0 {
                        d.target = 1.0 - d.target;
                        d.wait = d.waits.map(|w| w[d.target as usize]).unwrap_or(d.looping);
                    }
                }
                continue;
            }
            let Some(id) = &d.id else { continue };
            let Some(&v) = sig.get(id) else { continue };
            let target = if v || (d.latch && d.target == 1.0) { 1.0 } else { 0.0 };
            if d.target != target {
                d.target = target;
                if !d.seen {
                    d.instant = true;
                } else {
                    self.events.push(GameEvent::Door);
                }
            }
            d.seen = true;
        }
        // grades ligadas a sinal
        let fz: Vec<(usize, bool)> = self.world.fizzlers.iter().enumerate().filter_map(|(i, f)| f.sig.as_ref().map(|s| (i, if f.mode == "on" { sig.get(s).copied().unwrap_or(false) } else { !sig.get(s).copied().unwrap_or(false) }))).collect();
        self.fizz_pending = fz;
    }
}

pub fn tick(ecs: &mut Ecs) {
    let real_dt = ecs.resource::<Time>().delta_secs().min(0.05);
    let mut controls = std::mem::take(&mut *ecs.resource_mut::<Controls>());
    ecs.resource_scope(|ecs, mut game: Mut<Game>| {
        let game = &mut *game;
        if let Some(id) = game.want.take() {
            if let Some(i) = game.levels.iter().position(|l| l.id == id) {
                game.load(ecs, i);
            }
        }
        if let Some((i, backdrop)) = game.want_idx.take() {
            game.menu = backdrop;
            game.final_shown = false;
            game.load(ecs, i);
            if backdrop {
                game.running = false;
            }
        }
        // teclas das telas: Esc pausa/continua, Enter joga/próxima/continua, R reinicia na pausa
        let playing = game.running && !game.paused && !game.completed && !game.menu;
        let keys: Vec<Key> = controls.pressed.clone();
        for k in keys {
            match k {
                Key::Pause if playing => {
                    game.paused = true;
                    controls.pressed.retain(|x| *x != Key::Pause);
                }
                Key::Pause if game.paused => game.paused = false,
                Key::Play if game.menu => {
                    let i = game.progress.last.unwrap_or(0).min((game.progress.unlocked - 1).max(0) as usize);
                    game.start_level(i);
                }
                Key::Play if game.completed => {
                    match game.done_info() {
                        Some((_, _, true)) => game.start_level((game.level.unwrap_or(0) + 1).min(game.levels.len() - 1)),
                        _ => game.to_menu(),
                    }
                }
                Key::Play if game.paused => game.paused = false,
                Key::Restart if game.paused => {
                    if let Some(i) = game.level {
                        game.start_level(i);
                    }
                }
                _ => {}
            }
        }
        game.controls(ecs, &mut controls, real_dt);
        game.real_dt = real_dt;
        if game.verify.is_some() && game.running && !game.completed {
            // a linha do tempo roda adiantada (sem desenhar) até a última versão sua do passado terminar
            let t0 = std::time::Instant::now();
            game.input = Default::default();
            while t0.elapsed().as_millis() < 25 {
                game.t += 1.0 / 60.0;
                let t = game.t;
                game.update(ecs, 1.0 / 60.0, t);
                game.ch_flush(ecs);
                let Some((until, _, rb, deaths)) = game.verify else { break };
                let Some(ch) = game.relogio.as_ref() else {
                    game.verify = None;
                    break;
                };
                if ch.rollbacks != rb || game.deaths != deaths {
                    game.verify = None; // paradoxo ou morte: volta a jogar
                    break;
                }
                if ch.sweep.is_none() && ch.tw >= until + 0.1 {
                    game.verify = None;
                    let fin = game.world.triggers.iter().find(|t| t.exit).map(|t| t.fin).unwrap_or(false);
                    for tr in &mut game.world.triggers {
                        if tr.exit {
                            tr.done = true;
                        }
                    }
                    game.complete(fin);
                    break;
                }
            }
        } else if game.running && !game.paused && !game.completed {
            game.t += real_dt;
            let t = game.t;
            game.update_slowmo(real_dt);
            game.update_field(real_dt, true);
            let dt = real_dt * game.slow.k;
            // dentro do campo o mundo dá `rate` passos e o jogador anda 1/rate em cada
            if !game.field.inside(game.player.pos) {
                game.update(ecs, dt, t);
            } else {
                game.p_scale = 1.0 / game.field.rate as f32;
                for _ in 0..game.field.rate {
                    if !game.field.inside(game.player.pos) {
                        break;
                    }
                    game.update(ecs, dt, t);
                }
                game.p_scale = 1.0;
            }
            game.ch_flush(ecs);
            game.record_run(real_dt);
        } else if game.slow.on {
            game.toggle_slow(Some(false));
        }
        for (i, on) in std::mem::take(&mut game.fizz_pending) {
            game.world.set_fizzler(ecs, i, on);
        }
        game.ch_past_view(ecs, real_dt);
        game.update_dissolves(ecs, real_dt);
        game.mp_tick(ecs, real_dt);
        game.update_ambient(ecs);
        game.ch_fade_tracers(ecs);
        // câmera (no menu: a câmara 1 girando devagar)
        let shake = 0.0;
        // vibração do campo: cresce com a carga e dá um pico quando a bolha nasce
        let charging = game.field.charge / game.field.need;
        let rumble = (charging * 0.6).max(if game.field.shake > 0.0 { 1.25 * game.field.shake / 0.7 } else { 0.0 }).min(1.25);
        let tr = if game.editing {
            // (o editor põe a câmera dele)
            game.t += real_dt;
            let t = game.t;
            game.world.update(ecs, t, real_dt);
            game.cam
        } else if game.menu {
            game.t += real_dt;
            let t = game.t;
            game.world.update(ecs, t, real_dt);
            Transform::from_xyz((t * 0.05).sin() * 4.0, 5.0, 2.0 + (t * 0.05).cos() * 3.0).looking_at(Vec3::new(0.0, 3.0, -14.0), Vec3::Y)
        } else if let Some(v) = game.camp_view {
            // câmera de cena da campanha original
            game.player.camera(real_dt, &game.portals, shake, rumble);
            Transform::from_translation(v.pos).with_rotation(Quat::from_euler(EulerRot::YXZ, v.yaw, v.pitch, 0.0))
        } else {
            game.player.camera(real_dt, &game.portals, shake, rumble)
        };
        game.cam = tr;
        if let Some(f) = game.camp_fade.as_mut() {
            f.t += real_dt;
            if f.alpha().1 {
                game.camp_fade = None;
            }
        }
        if !game.menu && !game.editing {
            let speed = game.player.vel.length();
            let base = 75.0 + ((speed - 8.0) / 22.0).clamp(0.0, 1.0) * 16.0 - if game.slow.on { 7.0 } else { 0.0 };
            game.fov_deg += (base - game.fov_deg) * (1.0 - (-real_dt * if game.slow.on { 10.0 } else { 4.0 }).exp());
        } else {
            game.fov_deg = 75.0;
        }
        let fov = game.fov_deg.to_radians();
        let zk = if game.zoom.0 { game.zoom.1 } else { 1.0 };
        game.zoom.2 += (zk - game.zoom.2) * (1.0 - (-real_dt * 12.0).exp());
        let mut q = ecs.query_filtered::<(&mut Transform, &mut Projection), With<MainCam>>();
        if let Ok((mut t, mut p)) = q.single_mut(ecs) {
            *t = tr;
            if let Projection::Perspective(pp) = &mut *p {
                pp.fov = 2.0 * ((fov / 2.0).tan() / game.zoom.2).atan();
            }
        }
        ecs.resource_mut::<crate::fx::FxClock>().t = game.t;
    });
    // os estados contínuos continuam; os apertos já foram consumidos
    controls.pressed.clear();
    controls.released.clear();
    controls.mouse = Vec2::ZERO;
    controls.wheel = 0.0;
    *ecs.resource_mut::<Controls>() = controls;
}
