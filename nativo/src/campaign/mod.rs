//! Campanha original (src/game/campaign): os mapas do Portal (Valve) lidos da cópia do próprio
//! jogador e montados com as peças deste jogo. Nenhum arquivo da Valve fica no projeto: o jogador
//! escolhe o pacote .zip (npm run pacote) ou a pasta do Portal dele (ver source.rs).

pub mod bsp;
pub mod build;
pub mod convert;
pub mod dialogue;
pub mod io;
pub mod mdl;
pub mod source;
pub mod visuals;

use crate::levels::LevelDef;
use bsp::Bsp;
use mdl::StaticModel;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// os 18 mapas da campanha original, em ordem, com as câmaras de cada um
pub const MAPS: [(&str, &str); 18] = [
    ("testchmb_a_00", "00–01"),
    ("testchmb_a_01", "02–03"),
    ("testchmb_a_02", "04–05"),
    ("testchmb_a_03", "06–07"),
    ("testchmb_a_04", "08"),
    ("testchmb_a_05", "09"),
    ("testchmb_a_06", "10"),
    ("testchmb_a_07", "11–12"),
    ("testchmb_a_08", "13"),
    ("testchmb_a_09", "14"),
    ("testchmb_a_10", "15"),
    ("testchmb_a_11", "16"),
    ("testchmb_a_13", "17"),
    ("testchmb_a_14", "18"),
    ("testchmb_a_15", "19"),
    ("escape_00", "F1"),
    ("escape_01", "F2"),
    ("escape_02", "F3"),
];

/// id das fases da campanha (fora da faixa das fases do jogo)
pub const ID_BASE: i64 = 9000;

pub const NO_SOURCE: &str = "Para jogar a campanha original, escolha o pacote da campanha (.zip) ou a pasta do Portal.";

/// as fases da campanha original (entram no menu depois das do jogo)
pub fn levels() -> Vec<LevelDef> {
    MAPS.iter()
        .enumerate()
        .map(|(n, (map, code))| {
            let name = if map.starts_with("escape") {
                if *map == "escape_02" { "Fuga 3 · o final".to_string() } else { format!("Fuga {}", n - 14) }
            } else if code.contains('–') {
                format!("Câmaras {code}")
            } else {
                format!("Câmara {code}")
            };
            LevelDef {
                id: ID_BASE + n as i64,
                name,
                who: "GLaDOS".into(),
                music: if map.starts_with("escape") { "labTense" } else { "lab" }.into(),
                lesson: "Campanha original, lida da sua instalação".into(),
                series: Some("campaign".into()),
                code: Some(code.to_string()),
                n: Some(n as i64),
                campaign: Some(map.to_string()),
                ..LevelDef::default()
            }
        })
        .collect()
}

/// mapa já lido (uma cópia por mapa: a conversão muda as entidades dos moldes)
pub struct MapData {
    pub bsp: Bsp,
    pub models: HashMap<String, Arc<Option<StaticModel>>>,
    pub anim_durations: HashMap<String, HashMap<String, f32>>,
}

static MODELS: OnceLock<Mutex<HashMap<String, Arc<Option<StaticModel>>>>> = OnceLock::new();

fn model_file(c: &source::Campaign, base: &str, ext: &str) -> Option<Vec<u8>> {
    c.read(&format!("{base}{ext}"))
}

/// lê o mapa da cópia do jogador e os modelos dos objetos estáticos dele
pub fn read_map(map: &str) -> Result<MapData, String> {
    let c = source::get().ok_or_else(|| crate::i18n::tl(NO_SOURCE))?;
    let bytes = c.src.file(&format!("portal/maps/{map}.bsp")).ok_or_else(|| crate::i18n::tlv("O mapa {map} não está nesse pacote/instalação do Portal.", &[("map", map.to_string())]))?;
    let bsp = Bsp::parse(&bytes)?;
    let cache = MODELS.get_or_init(Default::default);
    let mut models = HashMap::new();
    let mut names: Vec<String> = bsp.static_props.iter().map(|p| p.model.clone()).collect();
    names.sort();
    names.dedup();
    for name in names {
        let got = cache.lock().unwrap().get(&name).cloned();
        let m = match got {
            Some(m) => m,
            None => {
                let base = name.trim_end_matches(".mdl");
                let parsed = match (model_file(c, base, ".mdl"), model_file(c, base, ".vvd"), model_file(c, base, ".dx90.vtx")) {
                    (Some(a), Some(b), Some(x)) => mdl::parse_model(&a, &b, &x, model_file(c, base, ".phy").as_deref()),
                    _ => None,
                };
                let m = Arc::new(parsed);
                cache.lock().unwrap().insert(name.clone(), m.clone());
                m
            }
        };
        models.insert(name, m);
    }
    // duração das animações que a lógica do mapa espera terminar (OnAnimationDone)
    let mut anim_durations = HashMap::new();
    for e in &bsp.entities {
        if e.classname.starts_with("prop_dynamic") && e.outputs.iter().any(|o| o.output == "onanimationdone") && e.get("model").is_some() {
            let m = e.model();
            if !anim_durations.contains_key(&m) {
                if let Some(b) = c.read(&m) {
                    anim_durations.insert(m, mdl::sequence_durations(&b));
                }
            }
        }
    }
    Ok(MapData { bsp, models, anim_durations })
}

/// câmera de cena (point_viewcontrol): enquanto ligada, a tela mostra esse ponto de vista
#[derive(Clone, Copy, Debug)]
pub struct View {
    pub pos: bevy::math::Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub freeze: bool,
}

/// tela escurecendo/clareando (env_fade): `from` começa na cor, segura `hold` s e clareia em
/// `dur` s; senão escurece em `dur` s, segura e volta — a não ser com `stay`
#[derive(Clone, Copy, Debug)]
pub struct Fade {
    pub color: bevy::math::Vec3,
    pub dur: f32,
    pub hold: f32,
    pub from: bool,
    pub stay: bool,
    pub t: f32,
}

impl Fade {
    /// opacidade agora (e se já acabou)
    pub fn alpha(&self) -> (f32, bool) {
        let (d, h) = (self.dur.max(1e-3), self.hold.max(0.0));
        if self.from {
            if self.t < h {
                return (1.0, false);
            }
            let k = (self.t - h) / d;
            return ((1.0 - k).max(0.0), k >= 1.0);
        }
        if self.t < d {
            return (self.t / d, false);
        }
        if self.stay {
            return (1.0, false);
        }
        let back = self.t - d - h.max(0.3);
        if back < 0.0 {
            return (1.0, false);
        }
        let k = back / 0.5;
        ((1.0 - k).max(0.0), k >= 1.0)
    }
}

/// monta o mapa da campanha no mundo: geometria, luzes, peças, e as entidades ganham vida
pub fn load_level(g: &mut crate::game::Game, ecs: &mut bevy::ecs::world::World, map: &str) -> Result<(), String> {
    let mut data = read_map(map)?;
    let built = convert::build_map(&mut g.world, ecs, &mut data.bsp, &data.models);
    let turrets: Vec<serde_json::Value> = built.turrets.iter().map(|(p, yaw, off, no_ammo)| serde_json::json!([p.x, p.y, p.z, yaw, { "scale": 0.8, "tippy": true, "inactive": off, "noAmmo": no_ammo }])).collect();
    g.data = serde_json::json!({
        "spawn": built.spawn,
        "gun": built.gun,
        "killY": built.kill_y,
        "turrets": turrets,
    });
    let (solids, lights, props) = built.stats;
    if std::env::var("PORTAL3_IO_LOG").is_ok() {
        eprintln!("[campanha] {map}: {solids} sólidos, {lights} luzes, {props} objetos");
    }
    let rt = io::Runtime::new(map, data, built, g, ecs);
    g.camp = Some(Box::new(rt));
    Ok(())
}
