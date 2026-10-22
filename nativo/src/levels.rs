//! As fases da versão web, exportadas para assets/levels/levels.json (tools/export-levels.mjs):
//! cada fase é a lista de chamadas que o `build(w)` dela fez na API do mundo, mais os dados que
//! ele devolveu (spawn, cubos, falas...). Aqui as chamadas são reproduzidas no `GameWorld`.

use crate::mats::asset_dir;
use crate::signs::{css_color, SignLine};
use crate::world::{EraObj, GameWorld};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct LevelDef {
    pub id: i64,
    pub name: String,
    pub who: String,
    pub music: String,
    pub lesson: String,
    pub series: Option<String>,
    pub code: Option<String>,
    pub n: Option<i64>,
    pub heat: bool,
    pub fin: bool,
    pub relogio: bool,
    pub free: bool,
    pub calls: Vec<Value>,
    pub data: Value,
    /// nível do editor: o id do documento
    pub mine: Option<String>,
    /// campanha original: o mapa da cópia do jogador
    pub campaign: Option<String>,
}

pub fn load_levels() -> Vec<LevelDef> {
    let txt = std::fs::read_to_string(asset_dir().join("levels/levels.json")).unwrap_or_else(|_| "[]".into());
    let v: Vec<Value> = serde_json::from_str(&txt).unwrap_or_default();
    v.into_iter()
        .map(|l| LevelDef {
            id: l["id"].as_i64().unwrap_or(0),
            name: s(&l["name"]),
            who: s(&l["who"]),
            music: l["music"].as_str().unwrap_or("lab").to_string(),
            lesson: s(&l["lesson"]),
            series: l["series"].as_str().map(String::from),
            code: l["code"].as_str().map(String::from),
            n: l["n"].as_i64(),
            heat: l["heat"].as_bool().unwrap_or(false),
            fin: l["final"].as_bool().unwrap_or(false),
            relogio: l["relogio"].as_bool().unwrap_or(false),
            free: l["free"].as_bool().unwrap_or(false),
            calls: l["calls"].as_array().cloned().unwrap_or_default(),
            data: l["data"].clone(),
            mine: None,
            campaign: None,
        })
        .collect()
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

/// argumentos de uma chamada, com os padrões da versão web
pub struct A<'a>(pub &'a [Value]);
impl<'a> A<'a> {
    pub fn f(&self, i: usize, d: f32) -> f32 {
        num(self.0.get(i)).unwrap_or(d)
    }
    pub fn s(&self, i: usize) -> Option<String> {
        self.0.get(i).and_then(|v| v.as_str()).map(String::from)
    }
    pub fn b(&self, i: usize, d: bool) -> bool {
        self.0.get(i).and_then(|v| v.as_bool()).unwrap_or(d)
    }
    pub fn v3(&self, i: usize) -> Vec3 {
        v3(self.0.get(i)).unwrap_or(Vec3::ZERO)
    }
    pub fn o(&self, i: usize) -> Opt<'a> {
        Opt(self.0.get(i))
    }
    pub fn get(&self, i: usize) -> Option<&'a Value> {
        self.0.get(i)
    }
}

/// objeto de opções (`{ axis, dist, ... }`)
pub struct Opt<'a>(pub Option<&'a Value>);
impl<'a> Opt<'a> {
    pub fn get(&self, k: &str) -> Option<&'a Value> {
        self.0.and_then(|o| o.get(k)).filter(|v| !v.is_null())
    }
    pub fn f(&self, k: &str, d: f32) -> f32 {
        num(self.get(k)).unwrap_or(d)
    }
    pub fn fo(&self, k: &str) -> Option<f32> {
        num(self.get(k))
    }
    pub fn s(&self, k: &str) -> Option<String> {
        self.get(k).and_then(|v| v.as_str()).map(String::from)
    }
    pub fn b(&self, k: &str, d: bool) -> bool {
        self.get(k).and_then(|v| v.as_bool()).unwrap_or(d)
    }
    pub fn v3(&self, k: &str) -> Option<Vec3> {
        v3(self.get(k))
    }
}

pub fn num(v: Option<&Value>) -> Option<f32> {
    match v? {
        Value::Number(n) => n.as_f64().map(|x| x as f32),
        Value::Object(o) => o.get("num").and_then(|s| s.as_str()).map(|s| if s.contains('-') { f32::NEG_INFINITY } else { f32::INFINITY }),
        _ => None,
    }
}

pub fn v3(v: Option<&Value>) -> Option<Vec3> {
    let v = v?;
    if let Some(a) = v.as_array() {
        return Some(Vec3::new(num(a.first())?, num(a.get(1))?, num(a.get(2))?));
    }
    if let Some(a) = v.get("v3").and_then(|x| x.as_array()) {
        return Some(Vec3::new(num(a.first())?, num(a.get(1))?, num(a.get(2))?));
    }
    None
}

/// linhas da placa: [texto, tamanho, y, cor, fonte]
pub fn sign_lines(v: &Value, tl: &dyn Fn(&str) -> String) -> Vec<SignLine> {
    v.as_array()
        .map(|ls| {
            ls.iter()
                .filter_map(|l| {
                    let a = l.as_array()?;
                    let font = a.get(4).and_then(|f| f.as_str()).unwrap_or("Arial Black, Impact, sans-serif");
                    Some(SignLine {
                        text: tl(a.first()?.as_str()?),
                        size: num(a.get(1)).unwrap_or(40.0),
                        y: num(a.get(2)).unwrap_or(100.0),
                        color: a.get(3).and_then(|c| c.as_str()).map(css_color).unwrap_or([0x1d, 0x1d, 0x1f]),
                        black: font.contains("Black") || font.contains("Impact"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// o que cada chamada devolveu (para `inEra(ref)` e atribuições depois)
#[derive(Clone, Debug)]
pub enum Made {
    Solid(usize),
    Door(usize),
    Entity(Entity),
    Light(Entity, f32),
    Trigger(usize),
    Launcher(usize),
    Funnel(usize),
    Other,
}

/// reproduz as chamadas da fase no mundo
pub fn build(w: &mut GameWorld, ecs: &mut Ecs, level: &LevelDef, tl: &dyn Fn(&str) -> String) {
    let mut made: HashMap<String, Made> = HashMap::new();
    for c in &level.calls {
        if let Some(set) = c.get("set").and_then(|v| v.as_str()) {
            let (id, field) = set.split_once('.').unwrap_or((set, ""));
            let value = &c["value"];
            match (made.get(id), field) {
                (Some(Made::Door(d)), "speedBack") => w.doors[*d].speed_back = num(Some(value)),
                (Some(Made::Door(d)), "latch") => w.doors[*d].latch = value.as_bool().unwrap_or(false),
                (Some(Made::Trigger(t)), "final") => w.triggers[*t].fin = value.as_bool().unwrap_or(false),
                // funil que, ligado uma vez, fica ligado
                (Some(Made::Funnel(f)), "latch") => w.funnels[*f].latch = value.as_bool().unwrap_or(false),
                // lançador escondido (os olhos do chefe cospem as bolas)
                (Some(Made::Launcher(l)), "group.visible") => {
                    let g = w.launchers[*l].group;
                    ecs.entity_mut(g).insert(if value.as_bool().unwrap_or(true) { Visibility::Inherited } else { Visibility::Hidden });
                }
                _ => warn!("atribuição ignorada: {set}"),
            }
            continue;
        }
        let Some(call) = c.get("call").and_then(|v| v.as_str()) else { continue };
        let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let args = c.get("args").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let a = A(&args);
        // célula do editor: um bloco com a tinta de cada face (as voltadas para fora somem)
        if call == "importedBox" {
            let faces: Vec<Option<String>> = args.get(2).and_then(|v| v.as_array()).map(|f| f.iter().map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            let cell = c.get("cell").and_then(|v| v.as_array()).map(|a| IVec3::new(a[0].as_i64().unwrap_or(0) as i32, a[1].as_i64().unwrap_or(0) as i32, a[2].as_i64().unwrap_or(0) as i32));
            let id = w.imported_box(ecs, a.v3(0), a.v3(1), &faces, cell);
            made.insert(id_of(c), Made::Solid(id));
            continue;
        }
        let r = call_world(w, ecs, call, &a, &made, tl);
        made.insert(id, r);
    }
}

fn call_world(w: &mut GameWorld, ecs: &mut Ecs, call: &str, a: &A, made: &HashMap<String, Made>, tl: &dyn Fn(&str) -> String) -> Made {
    let (x0, y0, z0, x1, y1, z1) = (a.f(0, 0.0), a.f(1, 0.0), a.f(2, 0.0), a.f(3, 0.0), a.f(4, 0.0), a.f(5, 0.0));
    match call {
        "box" => {
            let o = a.o(7);
            let id = w.add_box(ecs, x0, y0, z0, x1, y1, z1, &a.s(6).unwrap_or_else(|| "white".into()), o.b("solid", true), o.b("kinematic", false), o.b("noPortal", false));
            if let Some(era) = o.s("era") {
                w.in_era(ecs, EraObj::Solid(id), &era);
            }
            Made::Solid(id)
        }
        "hazard" => {
            let o = a.o(6);
            let id = w.hazard(ecs, x0, y0, z0, x1, y1, z1, o.fo("light"), o.fo("lightLift"));
            if let Some(era) = o.s("era") {
                w.in_era(ecs, EraObj::Solid(id), &era);
            }
            Made::Solid(id)
        }
        "trigger" => {
            let o = a.o(6);
            let lines = o.get("lines").and_then(|l| l.as_array()).map(|ls| ls.iter().filter_map(|l| Some((tl(l.get(0)?.as_str()?), tl(l.get(1)?.as_str()?)))).collect()).unwrap_or_default();
            Made::Trigger(w.trigger(x0, y0, z0, x1, y1, z1, o.b("exit", false), o.b("final", false), o.s("era"), lines))
        }
        "light" => {
            let k = a.f(3, 40.0);
            let e = w.light(ecs, x0, y0, z0, k, a.f(4, 0xfff4e6 as f32) as u32, a.f(5, 30.0), a.b(6, true));
            Made::Light(e, k)
        }
        "door" => {
            let o = a.o(7);
            let (x0, y0, z0, x1, y1, z1) = (a.f(1, 0.0), a.f(2, 0.0), a.f(3, 0.0), a.f(4, 0.0), a.f(5, 0.0), a.f(6, 0.0));
            let d = w.door(ecs, a.s(0), x0, y0, z0, x1, y1, z1, o.s("axis").as_deref(), o.fo("dist"), o.fo("speed"), o.b("latch", false), o.s("mat").as_deref());
            Made::Door(d)
        }
        "platform" => {
            let o = a.o(7);
            let (x0, y0, z0, x1, y1, z1) = (a.f(1, 0.0), a.f(2, 0.0), a.f(3, 0.0), a.f(4, 0.0), a.f(5, 0.0), a.f(6, 0.0));
            Made::Door(w.platform(ecs, a.s(0), x0, y0, z0, x1, y1, z1, &o.s("axis").unwrap_or_else(|| "y".into()), o.f("dist", 4.0), o.f("speed", 1.2), o.f("loop", 0.0), o.b("always", false)))
        }
        "mover" => {
            let o = a.o(7);
            let (x0, y0, z0, x1, y1, z1) = (a.f(1, 0.0), a.f(2, 0.0), a.f(3, 0.0), a.f(4, 0.0), a.f(5, 0.0), a.f(6, 0.0));
            let waits = o.get("waits").and_then(|v| v.as_array()).map(|w| [num(w.first()).unwrap_or(0.6), num(w.get(1)).unwrap_or(0.6)]).unwrap_or([0.6, 0.6]);
            Made::Door(w.mover(ecs, a.s(0), x0, y0, z0, x1, y1, z1, o.v3("to").unwrap_or(Vec3::Y), o.f("speed", 4.0), o.fo("back"), waits, o.b("always", true), o.f("phase", 0.0), o.b("crush", false), &o.s("mat").unwrap_or_else(|| "metal".into()), o.b("marks", true)))
        }
        "ramp" => Made::Solid(w.ramp(ecs, Vec3::new(x0, y0, z0), Vec3::new(x1, y1, z1), a.v3(6), &a.s(7).unwrap_or_else(|| "metal".into()))),
        "panel" => {
            let o = a.o(2);
            Made::Solid(w.panel(ecs, a.v3(0), a.v3(1), o.f("w", 4.0), o.f("h", 5.0), o.f("t", 0.8), o.v3("up"), o.f("color", 0x8fe3ff as f32) as u32, o.fo("stand")))
        }
        "fizzler" => {
            let o = a.o(6);
            w.fizzler(ecs, x0, y0, z0, x1, y1, z1, o.s("sig"), &o.s("mode").unwrap_or_else(|| "off".into()));
            Made::Other
        }
        "dispenser" => {
            w.dispenser(ecs, x0, y0, z0);
            Made::Other
        }
        "pedestal" => {
            let o = a.o(5);
            w.pedestal(ecs, x0, y0, z0, &a.s(3).unwrap_or_default(), a.get(4).filter(|v| !v.is_null()).map(|_| "gun"), o.f("height", 1.45));
            Made::Other
        }
        "launcher" => {
            let o = a.o(4);
            w.launcher(ecs, x0, y0, z0, a.v3(3), o.f("depth", 0.0), o.f("delay", 1.0), o.f("life", 12.0), o.f("speed", 6.5));
            Made::Launcher(w.launchers.len() - 1)
        }
        "catcher" => {
            let o = a.o(5);
            w.catcher(ecs, x0, y0, z0, a.v3(3), a.s(4), o.f("radius", 0.8));
            Made::Other
        }
        "incinerator" => {
            w.incinerator(ecs, x0, y0, z0, x1, y1, z1, a.s(6));
            Made::Other
        }
        "button" => {
            w.button(ecs, x0, y0, z0, a.s(3), a.o(4).f("hold", 0.0));
            Made::Other
        }
        "pushButton" => {
            let o = a.o(4);
            w.push_button(ecs, x0, y0, z0, a.s(3), &o.s("mode").unwrap_or_else(|| "timer".into()), o.f("time", 4.0), o.b("wall", false), o.v3("dir").unwrap_or(Vec3::Z), o.f("yaw", 0.0), &o.s("look").unwrap_or_else(|| "console".into()));
            Made::Other
        }
        "exitElevator" => {
            let o = a.o(4);
            Made::Trigger(w.exit_elevator(ecs, x0, y0, z0, a.b(3, false), o.s("era")))
        }
        "sign" => {
            let lines = sign_lines(a.get(4).unwrap_or(&Value::Null), tl);
            Made::Entity(w.sign(ecs, x0, y0, z0, a.f(3, 0.0), lines, a.f(5, 3.2), a.f(6, 1.6), a.f(7, 0.0)))
        }
        "strip" => Made::Entity(w.strip(ecs, x0, y0, z0, x1, y1, z1, a.f(6, 0x9fd8ff as f32) as u32, a.f(7, 2.0))),
        "inEra" => {
            let era = a.s(1).unwrap_or_else(|| "past".into());
            let rid = a.get(0).and_then(|v| v.get("ref")).and_then(|r| r.as_str()).unwrap_or("");
            match made.get(rid) {
                Some(Made::Solid(s)) => w.in_era(ecs, EraObj::Solid(*s), &era),
                Some(Made::Door(d)) => {
                    let s = w.doors[*d].solid;
                    w.in_era(ecs, EraObj::Solid(s), &era)
                }
                Some(Made::Entity(e)) => w.in_era(ecs, EraObj::Entity(*e), &era),
                Some(Made::Light(e, k)) => w.in_era(ecs, EraObj::Light(*e, *k), &era),
                other => warn!("inEra sem objeto: {rid} {other:?}"),
            }
            Made::Other
        }
        "lightBridge" => {
            let o = a.o(4);
            w.light_bridge(ecs, x0, y0, z0, a.v3(3), o.s("sig"), &o.s("look").unwrap_or_else(|| "veios".into()));
            Made::Other
        }
        "laser" => {
            w.laser(ecs, x0, y0, z0, a.v3(3), a.o(4).s("sig"));
            Made::Other
        }
        "laserCatcher" => {
            w.laser_catcher(ecs, x0, y0, z0, a.v3(3), a.s(4));
            Made::Other
        }
        "faithPlate" => {
            w.faith_plate(ecs, x0, y0, z0, a.v3(3), a.o(4).v3("target"));
            Made::Other
        }
        "faithPlateTo" => {
            w.faith_plate_to(ecs, x0, y0, z0, x1, y1, z1, a.f(6, 4.0), a.f(7, 9.8));
            Made::Other
        }
        "funnel" => {
            let o = a.o(4);
            w.funnel(ecs, x0, y0, z0, a.v3(3), o.s("id"), o.b("reversed", false), o.f("speed", 4.0), o.s("power"));
            Made::Funnel(w.funnels.len() - 1)
        }
        "gravZone" => {
            w.grav_zone(ecs, x0, y0, z0, x1, y1, z1, a.v3(6), a.f(7, 0xb06cff as f32) as u32);
            Made::Other
        }
        "blackHole" => {
            let o = a.o(3);
            w.black_hole(ecs, x0, y0, z0, o.f("strength", 900.0), o.f("horizon", 1.2), o.f("reach", 40.0));
            Made::Other
        }
        "moon" => {
            w.moon(ecs, x0, y0, z0, a.f(3, 10.0), a.get(4).cloned());
            Made::Other
        }
        "earth" => {
            w.earth(ecs, x0, y0, z0, a.f(3, 10.0));
            Made::Other
        }
        // botões de apertar: o item ligado reage do seu jeito; ou usa o modo do botão
        "pushSig" => {
            w.push_sig(&a.s(0).unwrap_or_default(), &a.s(1).unwrap_or_else(|| "timer".into()), a.f(2, 4.0));
            Made::Other
        }
        "pushUsed" => {
            if let Some(s) = a.s(0) {
                w.push_used.insert(s);
            }
            Made::Other
        }
        "stars" => {
            w.stars(ecs, a.v3(0), a.f(1, 900.0), a.f(2, 3000.0) as usize);
            Made::Other
        }
        other => {
            warn!("chamada da fase sem equivalente: {other}");
            Made::Other
        }
    }
}

fn id_of(c: &Value) -> String {
    c.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string()
}
