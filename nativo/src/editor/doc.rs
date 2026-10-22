//! Documento de um nível do editor (doc.js, elements.js, chamber.js) e o compilador que o transforma
//! numa fase como as de levels.json: a lista de chamadas da API do mundo mais os dados.
//!
//!   doc = { v, id, name, cfg:{ who, lesson, music, gun, relogio, gravity, autoLight }, chamber, items:[…] }
//!   item = { id, type, p:[x,y,z], s?:[sx,sy,sz], r?:[rx,ry,rz] (graus, YXZ), yaw?, …parâmetros do tipo }
//!   chamber = { open: ['i,j,k', …], paint: { 'i,j,k,f': 'white'|'metal'|'glass' } }
//!
//! A célula (i, j, k) ocupa x ∈ [4i−2, 4i+2], y ∈ [4j, 4j+4], z ∈ [4k−2, 4k+2].

use crate::levels::LevelDef;
use bevy::prelude::*;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};

pub const DOC_V: i64 = 1;
pub const CELL: f32 = 4.0;
pub const FACE_DIRS: [[i32; 3]; 6] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
pub const OPP: [usize; 6] = [1, 0, 3, 2, 5, 4];
pub const PAINTS: [(&str, &str); 3] = [("white", "Aceita portal"), ("metal", "Não aceita portal"), ("glass", "Vidro")];
const D2R: f32 = std::f32::consts::PI / 180.0;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Chamber {
    pub open: Vec<String>,
    pub paint: BTreeMap<String, String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Doc {
    pub v: i64,
    pub id: String,
    pub name: String,
    pub cfg: Map<String, Value>,
    pub chamber: Chamber,
    pub items: Vec<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording: Option<Value>,
}

pub fn cell_key(c: [i32; 3]) -> String {
    format!("{},{},{}", c[0], c[1], c[2])
}
pub fn parse_key(s: &str) -> [i32; 3] {
    let v: Vec<i32> = s.split(',').map(|x| x.parse().unwrap_or(0)).collect();
    [v.first().copied().unwrap_or(0), v.get(1).copied().unwrap_or(0), v.get(2).copied().unwrap_or(0)]
}
pub fn cell_min(c: [i32; 3]) -> Vec3 {
    Vec3::new(c[0] as f32 * CELL - CELL / 2.0, c[1] as f32 * CELL, c[2] as f32 * CELL - CELL / 2.0)
}
pub fn cell_center(c: [i32; 3]) -> Vec3 {
    Vec3::new(c[0] as f32 * CELL, c[1] as f32 * CELL + CELL / 2.0, c[2] as f32 * CELL)
}
/// célula que contém o ponto
pub fn cell_of(p: Vec3) -> [i32; 3] {
    [((p.x + CELL / 2.0) / CELL).floor() as i32, (p.y / CELL).floor() as i32, ((p.z + CELL / 2.0) / CELL).floor() as i32]
}

impl Chamber {
    pub fn new() -> Self {
        Chamber { open: vec![cell_key([0, 0, 0]), cell_key([0, 0, -1])], paint: BTreeMap::new() }
    }
    pub fn is_open(&self, c: [i32; 3]) -> bool {
        self.open.contains(&cell_key(c))
    }
    /// abre/fecha a célula; devolve se mudou
    pub fn set_open(&mut self, c: [i32; 3], on: bool) -> bool {
        let key = cell_key(c);
        let has = self.open.contains(&key);
        if on && !has {
            self.open.push(key);
        } else if !on && has {
            self.open.retain(|k| *k != key);
            for f in 0..6 {
                self.paint.remove(&format!("{key},{f}"));
            }
        }
        on != has
    }
    pub fn paint_of(&self, c: [i32; 3], f: usize) -> String {
        self.paint.get(&format!("{},{f}", cell_key(c))).cloned().unwrap_or_else(|| "white".into())
    }
    pub fn set_paint(&mut self, c: [i32; 3], f: usize, kind: &str) {
        let key = format!("{},{f}", cell_key(c));
        if kind == "white" {
            self.paint.remove(&key);
        } else {
            self.paint.insert(key, kind.into());
        }
    }
    /// caixa que envolve as células abertas
    pub fn bounds(&self) -> Option<(Vec3, Vec3)> {
        let mut b: Option<(Vec3, Vec3)> = None;
        for s in &self.open {
            let m = cell_min(parse_key(s));
            let x = m + Vec3::splat(CELL);
            b = Some(match b {
                None => (m, x),
                Some((a, z)) => (a.min(m), z.max(x)),
            });
        }
        b
    }
}

impl Default for Chamber {
    fn default() -> Self {
        Self::new()
    }
}

// ------------------------------------------------------------------ elementos
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PT {
    Num,
    Text,
    Select,
    Bool,
    Sig,
    V3,
    Color,
}

#[derive(Clone, Debug)]
pub struct Param {
    pub k: &'static str,
    pub label: &'static str,
    pub t: PT,
    pub d: Value,
    pub o: &'static [(&'static str, &'static str)],
    pub min: Option<f32>,
    pub max: Option<f32>,
    pub step: Option<f32>,
    /// v3 que dá para escolher no cenário (põe `mode` = isto)
    pub pick: Option<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Shape {
    Box,
    Point,
}
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Rot {
    None,
    Yaw,
    Euler,
}
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Place {
    Free,
    Floor,
    Wall,
    Ceiling,
    Face,
}

#[derive(Clone, Debug)]
pub struct Elem {
    pub key: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub color: u32,
    pub shape: Shape,
    pub rot: Rot,
    pub place: Place,
    pub size: Option<[f32; 3]>,
    pub hit: [f32; 3],
    pub lift: f32,
    pub unique: bool,
    pub params: Vec<Param>,
}

pub const GROUPS: [&str; 6] = ["Estrutura", "Mecanismos", "Energia e luz", "Movimento", "Objetos", "Ambiente"];
pub const DIRS: &[(&str, &str)] = &[("+x", "+X (leste)"), ("-x", "−X (oeste)"), ("+y", "+Y (cima)"), ("-y", "−Y (baixo)"), ("+z", "+Z (sul)"), ("-z", "−Z (norte)")];
const MATS: &[(&str, &str)] = &[("white", "Concreto claro (aceita portal)"), ("metal", "Metal"), ("rock", "Rocha"), ("glass", "Vidro"), ("grate", "Grade (tiros de portal passam)")];
pub const PUSH_MODES: &[(&str, &str)] = &[("timer", "Liga por um tempo (tique-taque)"), ("toggle", "Liga e desliga (interruptor)"), ("latch", "Liga e fica ligado"), ("unlatch", "Desliga e fica desligado")];
const PUSH_LOOKS: &[(&str, &str)] = &[("console", "Console inclinado"), ("classic", "Pedestal clássico"), ("mushroom", "Parada de emergência"), ("arcade", "Fliperama"), ("clock", "Torre do relógio")];
const BRIDGE_LOOKS: &[(&str, &str)] = &[("luz", "Luz sólida"), ("vidro", "Vidro gelado"), ("plasma", "Plasma"), ("aurora", "Aurora"), ("cristal", "Cristal líquido"), ("correnteza", "Correnteza"), ("nevoa", "Névoa sólida"), ("veios", "Veios vivos")];
const CUBE_KINDS: &[(&str, &str)] = &[("normal", "Comum"), ("laser", "Redirecionamento de laser"), ("special", "Especial (coração)")];
pub const SIG_KEYS: [&str; 4] = ["sig", "opens", "id", "power"];

fn p(k: &'static str, label: &'static str, t: PT, d: Value) -> Param {
    Param { k, label, t, d, o: &[], min: None, max: None, step: None, pick: None }
}
fn num(k: &'static str, label: &'static str, d: Value, min: Option<f32>, step: Option<f32>) -> Param {
    Param { min, step, ..p(k, label, PT::Num, d) }
}
fn sel(k: &'static str, label: &'static str, o: &'static [(&'static str, &'static str)], d: &str) -> Param {
    Param { o, ..p(k, label, PT::Select, json!(d)) }
}
fn sig(k: &'static str, label: &'static str, d: &str) -> Param {
    p(k, label, PT::Sig, json!(d))
}
fn dir(d: &str) -> Param {
    sel("dir", "Direção", DIRS, d)
}
fn push_params() -> Vec<Param> {
    vec![sig("opens", "Sinal que liga", ""), sel("look", "Modelo", PUSH_LOOKS, "console"), sel("mode", "Ao apertar (padrão)", PUSH_MODES, "timer"), num("time", "Tempo ligado (s, padrão)", json!(4), Some(0.5), Some(0.5))]
}

#[allow(clippy::too_many_arguments)]
fn e(key: &'static str, label: &'static str, group: &'static str, color: u32, shape: Shape, rot: Rot, place: Place, size: Option<[f32; 3]>, hit: [f32; 3], lift: f32, params: Vec<Param>) -> Elem {
    Elem { key, label, group, color, shape, rot, place, size, hit, lift, unique: false, params }
}

pub fn elements() -> &'static Vec<Elem> {
    static E: std::sync::OnceLock<Vec<Elem>> = std::sync::OnceLock::new();
    E.get_or_init(|| {
        use Place::*;
        use Rot::None as NoRot;
        use Shape::*;
        let z = [0.0; 3];
        let mut v = vec![
            e("block", "Bloco", "Estrutura", 0x9fb4c8, Box, NoRot, Free, Some([4.0, 4.0, 4.0]), z, 0.0, vec![sel("mat", "Material", MATS, "white"), p("portal", "Aceita portal", PT::Bool, json!(true))]),
            e("hazard", "Rocha fundida (mata)", "Estrutura", 0xff6a20, Box, NoRot, Free, Some([6.0, 1.0, 6.0]), z, 0.0, vec![]),
            e("ramp", "Rampa / bloco girado", "Estrutura", 0x9fb4c8, Box, Rot::Euler, Free, Some([4.0, 0.5, 6.0]), z, 0.0, vec![sel("mat", "Material", &MATS[..2], "metal")]),
            e("panel", "Painel diagonal (portal)", "Estrutura", 0x8fe3ff, Box, Rot::Euler, Free, Some([4.0, 5.0, 0.8]), z, 0.0, vec![num("stand", "Coluna até o chão y (vazio = sem)", Value::Null, None, Some(0.5))]),
            e("strip", "Faixa de luz", "Estrutura", 0x9fd8ff, Box, NoRot, Free, Some([2.0, 0.05, 0.1]), z, 0.0, vec![p("color", "Cor", PT::Color, json!("#9fd8ff"))]),
            e("sign", "Placa de texto", "Estrutura", 0xf3f2ee, Point, Rot::Yaw, Wall, None, [3.2, 1.6, 0.3], 0.0, vec![p("text1", "Título", PT::Text, json!("CÂMARA")), p("text2", "Subtítulo", PT::Text, json!("meu nível"))]),
            e("button", "Botão de piso", "Mecanismos", 0xff5a4a, Point, NoRot, Floor, None, [1.6, 0.4, 1.6], 0.2, vec![sig("opens", "Sinal que liga", ""), num("hold", "Segue ligado após soltar (s)", json!(0), Some(0.0), Some(0.5))]),
            e("pushButton", "Botão de apertar (pedestal)", "Mecanismos", 0xff5a4a, Point, Rot::Yaw, Floor, None, [0.7, 1.2, 0.7], 0.6, push_params()),
            e("wallButton", "Botão de apertar (parede)", "Mecanismos", 0xff5a4a, Point, NoRot, Wall, None, [0.55, 0.55, 0.3], 0.0, [vec![dir("+x")], push_params()].concat()),
            e("door", "Porta (célula inteira)", "Mecanismos", 0xffb347, Box, NoRot, Face, Some([4.0, 4.0, 0.3]), z, 0.0, vec![
                sig("sig", "Abre com o sinal", "A"),
                sel("axis", "Abre para", &[("plain", "Cima (porta comum)"), ("x", "Lado X"), ("y", "Cima/baixo (listrada)"), ("z", "Lado Z")], "plain"),
                num("dist", "Curso (m)", json!(3.85), Some(0.5), Some(0.5)),
                num("speed", "Velocidade", json!(1.4), Some(0.2), Some(0.2)),
                p("latch", "Fica aberta depois", PT::Bool, json!(false)),
            ]),
            e("platform", "Plataforma (liga e vai)", "Mecanismos", 0xffcc33, Box, NoRot, Free, Some([4.0, 0.4, 4.0]), z, 0.0, vec![
                sig("sig", "Sinal", "A"),
                sel("axis", "Eixo", &[("y", "Vertical"), ("x", "X"), ("z", "Z")], "y"),
                num("dist", "Curso (m)", json!(4), None, Some(0.5)),
                num("speed", "Velocidade (m/s)", json!(1.2), Some(0.2), Some(0.2)),
                num("loop", "Vai e volta: espera (s, 0 = não)", json!(0), Some(0.0), Some(0.5)),
                p("always", "Sempre ligada", PT::Bool, json!(false)),
            ]),
            e("mover", "Plataforma que vai e volta", "Mecanismos", 0xffcc33, Box, NoRot, Free, Some([4.0, 0.4, 4.0]), z, 0.0, vec![
                p("to", "Deslocamento (x, y, z)", PT::V3, json!([0, 0, 10])),
                num("speed", "Velocidade (m/s)", json!(3), Some(0.2), Some(0.5)),
                num("wait0", "Espera no início (s)", json!(1), Some(0.0), Some(0.5)),
                num("wait1", "Espera no fim (s)", json!(1), Some(0.0), Some(0.5)),
                Param { max: Some(1.0), ..num("phase", "Fase (0 a 1)", json!(0), Some(0.0), Some(0.1)) },
                p("crush", "Esmaga (pistão)", PT::Bool, json!(false)),
            ]),
            e("fizzler", "Grade de desintegração", "Mecanismos", 0x66d9ff, Box, NoRot, Face, Some([4.0, 4.0, 0.2]), z, 0.0, vec![sig("sig", "Sinal do botão (vazio = sempre ligada)", ""), sel("mode", "Quando o botão é apertado", &[("off", "Desativa a grade"), ("on", "Ativa a grade")], "off")]),
            e("incinerator", "Fornalha", "Mecanismos", 0xff7a2a, Box, NoRot, Free, Some([3.0, 2.0, 3.0]), z, 0.0, vec![sig("opens", "Sinal que liga ao queimar", "")]),
            e("launcher", "Lançador de bola de energia", "Energia e luz", 0xffb347, Point, NoRot, Wall, None, [0.9, 0.9, 0.9], 0.0, vec![dir("+x"), num("delay", "Atraso (s)", json!(1), Some(0.0), Some(0.5)), num("life", "Vida da bola (s)", json!(12), Some(1.0), None), num("speed", "Velocidade (m/s)", json!(6.5), Some(1.0), Some(0.5))]),
            e("catcher", "Receptor de bola de energia", "Energia e luz", 0x6fc8ff, Point, NoRot, Wall, None, [0.9, 0.9, 0.9], 0.0, vec![dir("-x"), sig("opens", "Sinal que liga", "A"), num("radius", "Raio (m)", json!(0.8), Some(0.3), Some(0.1))]),
            e("laser", "Emissor de laser", "Energia e luz", 0xff3030, Point, NoRot, Wall, None, [0.9, 0.9, 0.9], 0.1, vec![dir("+x"), sig("sig", "Sinal que liga (vazio = sempre ligado)", "")]),
            e("lightBridge", "Ponte de luz", "Energia e luz", 0x6fe0ff, Point, NoRot, Wall, None, [2.4, 0.6, 0.5], 0.0, vec![dir("+x"), sel("look", "Modelo", BRIDGE_LOOKS, "veios"), sig("sig", "Sinal que liga (vazio = sempre ligada)", "")]),
            e("laserCatcher", "Receptor de laser", "Energia e luz", 0xff9090, Point, NoRot, Wall, None, [0.9, 0.9, 0.9], 0.0, vec![dir("-x"), sig("opens", "Sinal que liga", "A")]),
            e("light", "Luz", "Energia e luz", 0xfff4e6, Point, NoRot, Ceiling, None, [1.2, 0.4, 0.6], 0.0, vec![num("intensity", "Intensidade", json!(45), Some(1.0), Some(5.0)), p("color", "Cor", PT::Color, json!("#fff4e6")), num("dist", "Alcance (m)", json!(30), Some(3.0), None), p("fixture", "Com luminária", PT::Bool, json!(true))]),
            e("plate", "Placa de lançamento", "Movimento", 0x66d9ff, Point, NoRot, Floor, None, [2.2, 0.4, 2.2], 0.2, vec![
                sel("mode", "Definir por", &[("vel", "Velocidade"), ("alvo", "Ponto de pouso")], "alvo"),
                p("vel", "Velocidade (x, y, z)", PT::V3, json!([0, 12, -6])),
                Param { pick: Some("alvo"), ..p("target", "Pouso (x, y, z)", PT::V3, json!([0, 0, -12])) },
                num("apex", "Altura acima do mais alto (m)", json!(4), Some(0.5), Some(0.5)),
            ]),
            e("funnel", "Funil de excursão", "Movimento", 0x66d9ff, Point, NoRot, Wall, None, [1.2, 1.2, 1.2], 0.0, vec![dir("+y"), num("speed", "Velocidade (m/s)", json!(4), Some(1.0), Some(0.5)), sig("id", "Inverte com o sinal", ""), sig("power", "Só liga com o sinal", ""), p("reversed", "Começa invertido", PT::Bool, json!(false))]),
            e("gravzone", "Zona de gravidade", "Movimento", 0xb06cff, Box, NoRot, Free, Some([8.0, 8.0, 8.0]), z, 0.0, vec![p("g", "Gravidade (x, y, z)", PT::V3, json!([0, 9.8, 0])), p("color", "Cor", PT::Color, json!("#b06cff"))]),
            e("blackhole", "Buraco negro", "Movimento", 0x7a3cff, Point, NoRot, Free, None, [2.4, 2.4, 2.4], 0.0, vec![num("strength", "Força", json!(900), Some(50.0), Some(50.0)), num("horizon", "Horizonte (m)", json!(1.2), Some(0.3), Some(0.1)), num("reach", "Alcance (m)", json!(40), Some(5.0), None)]),
            Elem { unique: true, ..e("spawn", "Ponto de partida", "Objetos", 0x66ff99, Point, Rot::Yaw, Floor, None, [0.8, 1.8, 0.8], 0.9, vec![]) },
            e("exit", "Elevador de saída", "Objetos", 0x66ff99, Point, NoRot, Floor, None, [2.6, 3.4, 2.6], 1.7, vec![p("flipped", "De cabeça para baixo", PT::Bool, json!(false))]),
            e("cube", "Cubo", "Objetos", 0xd9d9d9, Point, Rot::Yaw, Floor, None, [0.7, 0.7, 0.7], 0.35, vec![sel("kind", "Tipo de cubo", CUBE_KINDS, "normal")]),
            e("dispenser", "Dispensador de cubo", "Objetos", 0xcfe8ff, Point, Rot::Yaw, Ceiling, None, [1.4, 2.4, 1.4], -1.1, vec![sel("kind", "Tipo de cubo", CUBE_KINDS, "normal")]),
            e("turret", "Torreta", "Objetos", 0xff5050, Point, Rot::Yaw, Floor, None, [0.7, 1.4, 0.7], 0.7, vec![]),
            e("pedestal", "Pedestal da arma de portais", "Objetos", 0xffd84a, Point, NoRot, Floor, None, [1.2, 1.9, 1.2], 0.95, vec![sel("gives", "Entrega", &[("blue", "Só portal ciano"), ("both", "Os dois portais")], "both")]),
            e("portal", "Portal fixo", "Objetos", 0x3fa2ff, Point, NoRot, Wall, None, [1.4, 2.2, 0.4], 0.0, vec![sel("which", "Cor", &[("blue", "Ciano"), ("orange", "Vermelho")], "blue"), Param { label: "Aponta para", ..dir("+z") }]),
            e("crystal", "Cristal", "Objetos", 0xc77dff, Point, NoRot, Floor, None, [0.6, 0.8, 0.6], 0.4, vec![]),
            e("trigger", "Gatilho de fala", "Objetos", 0x99ccff, Box, NoRot, Free, Some([3.0, 2.0, 3.0]), z, 0.0, vec![p("who", "Quem fala", PT::Text, json!("Helena")), p("text", "Fala", PT::Text, json!("Bem-vindo ao meu nível."))]),
            e("dino", "Dinossauro", "Objetos", 0x8fd16f, Point, Rot::Yaw, Floor, None, [1.2, 1.2, 1.2], 0.6, vec![sel("sp", "Espécie", &[("raptor", "Raptor"), ("trice", "Tricerátops"), ("ptero", "Pterossauro")], "raptor"), num("scale", "Tamanho", json!(0.6), Some(0.1), Some(0.1))]),
            e("earth", "Terra no céu", "Ambiente", 0x6fb0ff, Point, NoRot, Free, None, [6.0, 6.0, 6.0], 0.0, vec![num("r", "Raio (m)", json!(70), Some(5.0), Some(5.0))]),
            Elem { unique: true, ..e("stars", "Céu estrelado", "Ambiente", 0xffffff, Point, NoRot, Free, None, [2.0, 2.0, 2.0], 0.0, vec![num("radius", "Raio (m)", json!(900), Some(100.0), Some(100.0)), num("n", "Estrelas", json!(3000), Some(200.0), Some(200.0))]) },
        ];
        v.shrink_to_fit();
        v
    })
}

pub fn elem(key: &str) -> Option<&'static Elem> {
    elements().iter().find(|e| e.key == key)
}

pub fn is_push(t: &str) -> bool {
    t == "pushButton" || t == "wallButton"
}

pub fn dir_vec(d: &str) -> Vec3 {
    let mut v = Vec3::ZERO;
    let b = d.as_bytes();
    if b.len() == 2 {
        let a = match b[1] {
            b'x' => 0,
            b'y' => 1,
            _ => 2,
        };
        v[a] = if b[0] == b'-' { -1.0 } else { 1.0 };
    }
    v
}

// ------------------------------------------------------------------ leitura dos itens
pub fn f(it: &Map<String, Value>, k: &str) -> f32 {
    it.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
}
pub fn fo(it: &Map<String, Value>, k: &str) -> Option<f32> {
    it.get(k).and_then(|v| v.as_f64()).map(|v| v as f32)
}
pub fn st(it: &Map<String, Value>, k: &str) -> String {
    it.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
pub fn bo(it: &Map<String, Value>, k: &str) -> bool {
    it.get(k).and_then(|v| v.as_bool()).unwrap_or(false)
}
pub fn v3(it: &Map<String, Value>, k: &str) -> Vec3 {
    let a = it.get(k).and_then(|v| v.as_array());
    let g = |i: usize| a.and_then(|a| a.get(i)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    Vec3::new(g(0), g(1), g(2))
}
pub fn set_v3(it: &mut Map<String, Value>, k: &str, v: Vec3) {
    it.insert(k.into(), json!([r2(v.x), r2(v.y), r2(v.z)]));
}
pub fn r2(n: f32) -> f32 {
    (n * 100.0).round() / 100.0
}

/// caixa alinhada aos eixos a partir de centro/tamanho
pub fn minmax(it: &Map<String, Value>) -> (Vec3, Vec3) {
    let (p, s) = (v3(it, "p"), v3(it, "s"));
    (p - s / 2.0, p + s / 2.0)
}
/// rotação de um item com `r` em graus (YXZ)
pub fn quat_of(it: &Map<String, Value>) -> Quat {
    let r = v3(it, "r") * D2R;
    Quat::from_euler(EulerRot::YXZ, r.y, r.x, r.z)
}
/// caixa orientada de um item: (centro, meia-medida, rotação)
pub fn obb_of(it: &Map<String, Value>) -> (Vec3, Vec3, Quat) {
    let t = elem(&st(it, "type"));
    let Some(t) = t else { return (v3(it, "p"), Vec3::splat(0.3), Quat::IDENTITY) };
    if t.shape == Shape::Box {
        return (v3(it, "p"), v3(it, "s") / 2.0, if t.rot == Rot::Euler { quat_of(it) } else { Quat::IDENTITY });
    }
    let q = if t.rot == Rot::Yaw { Quat::from_rotation_y(f(it, "yaw") * D2R) } else { Quat::IDENTITY };
    (v3(it, "p") + Vec3::Y * t.lift, Vec3::from(t.hit) / 2.0, q)
}

fn color_hex(s: &str, fallback: u32) -> u32 {
    u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(fallback)
}

// ------------------------------------------------------------------ documento
pub fn uid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let r: u32 = rand::random::<u32>() % 1296;
    format!("{}{}{}", radix36(t as u64), radix36(SEQ.fetch_add(1, Ordering::Relaxed)), radix36(r as u64))
}

fn radix36(mut n: u64) -> String {
    let d = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut s = vec![];
    while n > 0 {
        s.push(d[(n % 36) as usize]);
        n /= 36;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

pub fn default_cfg() -> Map<String, Value> {
    let tl = crate::i18n::tl;
    json!({ "who": tl("Você"), "lesson": tl("Chegue ao elevador de saída."), "music": "lab", "gun": "both", "relogio": false, "gravity": 9.8, "autoLight": true }).as_object().unwrap().clone()
}

impl Doc {
    pub fn new(name: &str) -> Self {
        let mut d = Doc { v: DOC_V, id: uid(), name: name.into(), cfg: default_cfg(), chamber: Chamber::new(), items: vec![], recording: None };
        // câmara inicial: duas células, o ponto de partida numa e o elevador de saída na outra
        let mut sp = Map::new();
        sp.insert("p".into(), json!([0, 0, 0]));
        sp.insert("yaw".into(), json!(0));
        d.add("spawn", sp);
        let mut ex = Map::new();
        ex.insert("p".into(), json!([0, 0, -4]));
        d.add("exit", ex);
        d
    }

    /// cria o item com os padrões do tipo e o põe no documento; devolve o índice
    pub fn add(&mut self, t: &str, over: Map<String, Value>) -> usize {
        let e = elem(t).expect("tipo");
        let mut it = Map::new();
        it.insert("id".into(), json!(uid()));
        it.insert("type".into(), json!(t));
        it.insert("p".into(), json!([0, 0, 0]));
        if let Some(s) = e.size {
            it.insert("s".into(), json!(s));
        }
        if e.rot == Rot::Euler {
            it.insert("r".into(), json!([0, 0, 0]));
        }
        for p in &e.params {
            it.insert(p.k.into(), p.d.clone());
        }
        for (k, v) in over {
            it.insert(k, v);
        }
        self.items.push(it);
        self.items.len() - 1
    }

    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.items.iter().position(|i| i.get("id").and_then(|v| v.as_str()) == Some(id))
    }

    /// confere e completa um documento vindo de fora (importado ou de versão antiga)
    pub fn normalize(raw: &Value) -> Result<Doc, String> {
        let items = raw.get("items").and_then(|v| v.as_array()).ok_or("arquivo não é um nível do editor")?;
        let mut cfg = default_cfg();
        if let Some(c) = raw.get("cfg").and_then(|v| v.as_object()) {
            for (k, v) in c {
                cfg.insert(k.clone(), v.clone());
            }
        }
        let mut chamber = Chamber { open: vec![], paint: BTreeMap::new() };
        if let Some(c) = raw.get("chamber") {
            let ok = |s: &str| {
                let v: Vec<&str> = s.split(',').collect();
                v.len() == 3 && v.iter().all(|x| x.parse::<i32>().is_ok())
            };
            let mut seen = HashSet::new();
            for s in c.get("open").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                if let Some(s) = s.as_str().filter(|s| ok(s)) {
                    if seen.insert(s.to_string()) {
                        chamber.open.push(s.to_string());
                    }
                }
            }
            for (k, v) in c.get("paint").and_then(|v| v.as_object()).cloned().unwrap_or_default() {
                if let Some(v) = v.as_str().filter(|v| ["white", "metal", "glass"].contains(v)) {
                    chamber.paint.insert(k, v.to_string());
                }
            }
        }
        let mut d = Doc {
            v: DOC_V,
            id: raw.get("id").and_then(|v| v.as_str()).map(String::from).unwrap_or_else(uid),
            name: raw.get("name").and_then(|v| v.as_str()).unwrap_or("Nível importado").chars().take(60).collect(),
            cfg,
            chamber,
            items: vec![],
            recording: raw.get("recording").cloned(),
        };
        let num3 = |v: Option<&Value>| v.and_then(|v| v.as_array()).is_some_and(|a| a.len() == 3 && a.iter().all(|x| x.as_f64().is_some_and(|f| f.is_finite())));
        for r in items {
            let Some(r) = r.as_object() else { continue };
            let Some(e) = r.get("type").and_then(|v| v.as_str()).and_then(elem) else { continue };
            if !num3(r.get("p")) {
                continue;
            }
            let mut it = r.clone();
            if it.get("id").and_then(|v| v.as_str()).is_none() {
                it.insert("id".into(), json!(uid()));
            }
            if let Some(s) = e.size {
                if !num3(it.get("s")) {
                    it.insert("s".into(), json!(s));
                }
            }
            if e.rot == Rot::Euler && !num3(it.get("r")) {
                it.insert("r".into(), json!([0, 0, 0]));
            }
            for p in &e.params {
                if !it.contains_key(p.k) {
                    it.insert(p.k.into(), p.d.clone());
                }
            }
            d.items.push(it);
        }
        Ok(d)
    }

    /// fase para o jogo (`index` só rotula: U01…)
    pub fn compile(&self, index: usize) -> LevelDef {
        let mut c = Compiler { calls: vec![], seq: 0 };
        let mut data = json!({ "spawn": [0, 0, 0, 0], "cubes": [], "turrets": [], "portals": [], "crystals": [], "dinos": [], "booths": [], "gun": self.cfg.get("gun").cloned().unwrap_or(json!("both")), "relogio": self.cfg.get("relogio").and_then(|v| v.as_bool()).unwrap_or(false), "intro": [] });
        self.build_chamber(&mut c);
        if self.cfg.get("autoLight").and_then(|v| v.as_bool()) != Some(false) {
            self.auto_lights(&mut c, 14, 9.0);
        }
        // botões de apertar: o item ligado pode reagir do seu jeito (pmode/ptime) em vez do modo do botão
        let push_sigs: HashSet<String> = self.items.iter().filter(|i| is_push(&st(i, "type"))).map(|i| st(i, "opens")).filter(|s| !s.is_empty()).collect();
        for it in &self.items {
            let t = st(it, "type");
            let Some(e) = elem(&t) else { continue };
            let mut bi = it.clone();
            for p in &e.params {
                if p.t != PT::Sig || p.k == "opens" {
                    continue;
                }
                let s = st(it, p.k);
                if !push_sigs.contains(&s) {
                    continue;
                }
                if let Some(mode) = it.get("pmode").and_then(|v| v.as_str()) {
                    let time = fo(it, "ptime").unwrap_or(4.0);
                    bi.insert(p.k.into(), json!(format!("{s}~{mode}~{}", crate::world::fmt_num(time))));
                    c.call("pushSig", vec![json!(s), json!(mode), json!(time)]);
                } else {
                    c.call("pushUsed", vec![json!(s)]);
                }
            }
            build_item(&mut c, &bi, &mut data);
        }
        let g = self.cfg.get("gravity").and_then(|v| v.as_f64()).unwrap_or(9.8);
        if (g - 9.8).abs() > 1e-6 {
            data["gravity"] = json!(g);
        }
        let s = |k: &str, d: &str| self.cfg.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or(d).to_string();
        LevelDef {
            id: 100_000 + index as i64,
            name: self.name.clone(),
            who: s("who", "Você"),
            music: s("music", "lab"),
            lesson: s("lesson", ""),
            series: Some("mine".into()),
            code: Some(format!("U{:02}", index + 1)),
            n: Some(index as i64),
            heat: false,
            fin: false,
            relogio: data["relogio"].as_bool().unwrap_or(false),
            free: false,
            calls: c.calls,
            data,
            mine: Some(self.id.clone()),
            campaign: None,
        }
    }

    /// as paredes: toda célula FECHADA encostada (até na diagonal) numa aberta vira um bloco; as faces
    /// voltadas para dentro levam a tinta, o resto some
    fn build_chamber(&self, c: &mut Compiler) {
        let open: HashSet<&String> = self.chamber.open.iter().collect();
        let mut shell: Vec<[i32; 3]> = vec![];
        let mut seen = HashSet::new();
        for s in &self.chamber.open {
            let [i, j, k] = parse_key(s);
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        let n = [i + dx, j + dy, k + dz];
                        let key = cell_key(n);
                        if !open.contains(&key) && seen.insert(key) {
                            shell.push(n);
                        }
                    }
                }
            }
        }
        for cl in shell {
            let faces: Vec<Value> = FACE_DIRS
                .iter()
                .enumerate()
                .map(|(fi, d)| {
                    let n = [cl[0] + d[0], cl[1] + d[1], cl[2] + d[2]];
                    if open.contains(&cell_key(n)) {
                        json!(self.chamber.paint_of(n, OPP[fi]))
                    } else {
                        Value::Null
                    }
                })
                .collect();
            let m = cell_min(cl);
            let x = m + Vec3::splat(CELL);
            let id = format!("#{}", c.next());
            c.calls.push(json!({ "call": "importedBox", "args": [[m.x, m.y, m.z], [x.x, x.y, x.z], faces], "cell": cl, "id": id }));
        }
    }

    /// luzes de teto automáticas: uma por célula aberta com teto fechado (no máximo `max`, espalhadas)
    fn auto_lights(&self, c: &mut Compiler, max: usize, intensity: f32) {
        let open: HashSet<&String> = self.chamber.open.iter().collect();
        let cells: Vec<[i32; 3]> = self.chamber.open.iter().map(|s| parse_key(s)).filter(|[i, j, k]| !open.contains(&cell_key([*i, j + 1, *k]))).collect();
        let step = cells.len().div_ceil(max).max(1);
        for (n, cl) in cells.iter().enumerate() {
            if n % step != 0 {
                continue;
            }
            let ce = cell_center(*cl);
            c.call("light", vec![json!(ce.x), json!(cl[1] as f32 * CELL + CELL - 0.35), json!(ce.z), json!(intensity), json!(0xfff4e6), json!(13)]);
        }
    }
}

struct Compiler {
    calls: Vec<Value>,
    seq: usize,
}

impl Compiler {
    fn next(&mut self) -> usize {
        self.seq += 1;
        self.seq
    }
    fn call(&mut self, name: &str, args: Vec<Value>) {
        let id = format!("#{}", self.next());
        self.calls.push(json!({ "call": name, "args": args, "id": id }));
    }
}

fn nul(s: String) -> Value {
    if s.is_empty() { Value::Null } else { json!(s) }
}

fn arr(v: Vec3) -> Value {
    json!([v.x, v.y, v.z])
}

/// o que o jogo precisa para construir cada peça (o `build` de elements.js)
fn build_item(c: &mut Compiler, it: &Map<String, Value>, data: &mut Value) {
    let t = st(it, "type");
    let p = v3(it, "p");
    let (mn, mx) = if it.contains_key("s") { minmax(it) } else { (p, p) };
    let bx = |o: Value| vec![json!(mn.x), json!(mn.y), json!(mn.z), json!(mx.x), json!(mx.y), json!(mx.z), o];
    let yaw = f(it, "yaw") * D2R;
    let cube_opts = || json!({ "yaw": yaw, "laser": st(it, "kind") == "laser", "special": st(it, "kind") == "special" });
    match t.as_str() {
        "block" => {
            let mut a = bx(json!(st(it, "mat")));
            a.push(json!({ "noPortal": !bo(it, "portal") }));
            c.call("box", a);
        }
        "hazard" => {
            let mut a = bx(Value::Null);
            a.pop();
            c.call("hazard", a);
        }
        "ramp" => {
            let s = v3(it, "s");
            let r = v3(it, "r") * D2R;
            c.call("ramp", vec![json!(p.x), json!(p.y), json!(p.z), json!(s.x), json!(s.y), json!(s.z), json!([r.x, r.y, r.z]), json!(st(it, "mat"))]);
        }
        "panel" => {
            let q = quat_of(it);
            let n = q * Vec3::Z;
            let u = q * Vec3::Y;
            let s = v3(it, "s");
            let at = p + n * (s.z / 2.0);
            let stand = fo(it, "stand").map(|v| json!(v)).unwrap_or(Value::Null);
            c.call("panel", vec![arr(at), arr(n), json!({ "w": s.x, "h": s.y, "t": s.z, "up": arr(u), "stand": stand })]);
        }
        "strip" => {
            let mut a = bx(json!(color_hex(&st(it, "color"), 0x9fd8ff)));
            a.push(json!(2));
            c.call("strip", a);
        }
        "sign" => {
            c.call("sign", vec![json!(p.x), json!(p.y), json!(p.z), json!(yaw), json!([[st(it, "text1"), 96, 190], [st(it, "text2"), 56, 330, "#c0392b", "Arial, sans-serif"]])]);
        }
        "button" => c.call("button", vec![json!(p.x), json!(p.y), json!(p.z), nul(st(it, "opens")), json!({ "hold": f(it, "hold") })]),
        "pushButton" => c.call("pushButton", vec![json!(p.x), json!(p.y), json!(p.z), nul(st(it, "opens")), json!({ "mode": st(it, "mode"), "time": f(it, "time"), "yaw": yaw, "look": st(it, "look") })]),
        "wallButton" => c.call("pushButton", vec![json!(p.x), json!(p.y), json!(p.z), nul(st(it, "opens")), json!({ "mode": st(it, "mode"), "time": f(it, "time"), "wall": true, "dir": arr(dir_vec(&st(it, "dir"))), "look": st(it, "look") })]),
        "door" => {
            let mut o = json!({ "speed": f(it, "speed"), "latch": bo(it, "latch") });
            if st(it, "axis") != "plain" {
                o["axis"] = json!(st(it, "axis"));
                o["dist"] = json!(f(it, "dist"));
            }
            let mut a = vec![nul(st(it, "sig"))];
            a.extend(bx(o));
            c.call("door", a);
        }
        "platform" => {
            let mut a = vec![nul(st(it, "sig"))];
            a.extend(bx(json!({ "axis": st(it, "axis"), "dist": f(it, "dist"), "speed": f(it, "speed"), "loop": f(it, "loop"), "always": bo(it, "always") })));
            c.call("platform", a);
        }
        "mover" => {
            let mut a = vec![Value::Null];
            a.extend(bx(json!({ "to": arr(v3(it, "to")), "speed": f(it, "speed"), "waits": [f(it, "wait0"), f(it, "wait1")], "phase": f(it, "phase"), "crush": bo(it, "crush") })));
            c.call("mover", a);
        }
        "fizzler" => c.call("fizzler", bx(json!({ "sig": nul(st(it, "sig")), "mode": st(it, "mode") }))),
        "incinerator" => {
            let mut a = bx(Value::Null);
            a.pop();
            a.push(nul(st(it, "opens")));
            c.call("incinerator", a);
        }
        "launcher" => c.call("launcher", vec![json!(p.x), json!(p.y), json!(p.z), arr(dir_vec(&st(it, "dir"))), json!({ "delay": f(it, "delay"), "life": f(it, "life"), "speed": f(it, "speed") })]),
        "catcher" => c.call("catcher", vec![json!(p.x), json!(p.y), json!(p.z), arr(dir_vec(&st(it, "dir"))), nul(st(it, "opens")), json!({ "radius": f(it, "radius") })]),
        "laser" => c.call("laser", vec![json!(p.x), json!(p.y), json!(p.z), arr(dir_vec(&st(it, "dir"))), json!({ "sig": nul(st(it, "sig")) })]),
        "lightBridge" => c.call("lightBridge", vec![json!(p.x), json!(p.y), json!(p.z), arr(dir_vec(&st(it, "dir"))), json!({ "sig": nul(st(it, "sig")), "look": st(it, "look") })]),
        "laserCatcher" => c.call("laserCatcher", vec![json!(p.x), json!(p.y), json!(p.z), arr(dir_vec(&st(it, "dir"))), nul(st(it, "opens"))]),
        "light" => c.call("light", vec![json!(p.x), json!(p.y), json!(p.z), json!(f(it, "intensity")), json!(color_hex(&st(it, "color"), 0xfff4e6)), json!(f(it, "dist")), json!(bo(it, "fixture"))]),
        "plate" => {
            if st(it, "mode") == "alvo" {
                let tg = v3(it, "target");
                c.call("faithPlateTo", vec![json!(p.x), json!(p.y), json!(p.z), json!(tg.x), json!(tg.y), json!(tg.z), json!(f(it, "apex"))]);
            } else {
                c.call("faithPlate", vec![json!(p.x), json!(p.y), json!(p.z), arr(v3(it, "vel"))]);
            }
        }
        "funnel" => c.call("funnel", vec![json!(p.x), json!(p.y), json!(p.z), arr(dir_vec(&st(it, "dir"))), json!({ "id": nul(st(it, "id")), "power": nul(st(it, "power")), "reversed": bo(it, "reversed"), "speed": f(it, "speed") })]),
        "gravzone" => {
            let mut a = bx(arr(v3(it, "g")));
            a.push(json!(color_hex(&st(it, "color"), 0xb06cff)));
            c.call("gravZone", a);
        }
        "blackhole" => c.call("blackHole", vec![json!(p.x), json!(p.y), json!(p.z), json!({ "strength": f(it, "strength"), "horizon": f(it, "horizon"), "reach": f(it, "reach") })]),
        "spawn" => data["spawn"] = json!([p.x, p.y, p.z, yaw]),
        "exit" => c.call("exitElevator", vec![json!(p.x), json!(p.y), json!(p.z), json!(bo(it, "flipped"))]),
        "cube" => data["cubes"].as_array_mut().unwrap().push(json!([p.x, p.y, p.z, cube_opts()])),
        "dispenser" => {
            c.call("dispenser", vec![json!(p.x), json!(p.y), json!(p.z)]);
            data["cubes"].as_array_mut().unwrap().push(json!([p.x, p.y - 1.6, p.z, cube_opts()]));
        }
        "turret" => data["turrets"].as_array_mut().unwrap().push(json!([p.x, p.y, p.z, yaw])),
        "pedestal" => c.call("pedestal", vec![json!(p.x), json!(p.y), json!(p.z), json!(st(it, "gives")), json!("gun")]),
        "portal" => {
            let n = dir_vec(&st(it, "dir"));
            let u = if n.y.abs() > 0.5 { json!([0, 0, -1]) } else { json!([0, 1, 0]) };
            data["portals"].as_array_mut().unwrap().push(json!({ "which": st(it, "which"), "c": arr(p), "n": arr(n), "u": u }));
        }
        "crystal" => data["crystals"].as_array_mut().unwrap().push(json!([p.x, p.y, p.z])),
        "trigger" => {
            let who = st(it, "who");
            c.call("trigger", bx(json!({ "lines": [[if who.is_empty() { "Helena".to_string() } else { who }, st(it, "text")]] })));
        }
        "dino" => data["dinos"].as_array_mut().unwrap().push(json!({ "s": st(it, "sp"), "scale": f(it, "scale"), "x": p.x, "y": p.y, "z": p.z, "rotY": yaw })),
        "earth" => c.call("earth", vec![json!(p.x), json!(p.y), json!(p.z), json!(f(it, "r"))]),
        "stars" => c.call("stars", vec![arr(p), json!(f(it, "radius")), json!(f(it, "n"))]),
        _ => {}
    }
}
