#![allow(deprecated)]
//! Menus (o #menu, #pause, #done e #final de jogo.html): o menu com as séries e as câmaras
//! (cadeado, recorde), a pausa com as opções, o fim de câmara e o final. O progresso fica num
//! arquivo JSON na pasta de dados do usuário (o localStorage 'tunel-jogo' da versão web).

use crate::game::{Game, GameEvent};
use crate::hud::{fmt_time, level_label};
use bevy::ecs::world::World as Ecs;
use bevy::input::mouse::{AccumulatedMouseScroll, MouseScrollUnit};
use bevy::prelude::*;
use bevy::text::{FontSize, FontWeight, LetterSpacing};
use bevy::window::{CursorGrabMode, CursorOptions, PrimaryWindow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

const BLUE: Color = Color::srgb(0.149, 0.949, 1.0);
const INK: Color = Color::srgb(0.957, 0.969, 0.98);
const DIM: Color = Color::srgba(0.957, 0.969, 0.98, 0.72);
const MUTED: Color = Color::srgba(0.9, 0.925, 0.973, 0.6);
const LINE: Color = Color::srgba(1.0, 1.0, 1.0, 0.14);

// ------------------------------------------------------------------ progresso
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Progress {
    pub unlocked: i64,
    /// por série: até qual câmara (n + 1) está liberada
    pub series: HashMap<String, i64>,
    pub best: HashMap<String, f32>,
    pub last: Option<usize>,
    pub music: bool,
    pub voice: bool,
    pub blur: bool,
    /// sincronia vertical: liga evita rasgos na imagem, mas atrasa os controles em um quadro ou mais
    pub vsync: bool,
    /// qualidade gráfica (0 baixa, 1 média, 2 alta); vazio = escolhida pela placa de vídeo
    pub quality: Option<u8>,
    /// idioma dos textos ("pt" ou "en")
    pub lang: String,
}

impl Default for Progress {
    fn default() -> Self {
        Progress { unlocked: 1, series: HashMap::new(), best: HashMap::new(), last: None, music: true, voice: true, blur: true, vsync: false, quality: None, lang: "pt".into() }
    }
}

pub fn data_dir() -> PathBuf {
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support/Laboratorio Antipoda")
    } else if cfg!(target_os = "windows") {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or(home).join("Laboratorio Antipoda")
    } else {
        std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".local/share")).join("laboratorio-antipoda")
    }
}

impl Progress {
    pub fn load() -> Self {
        if std::env::var("PORTAL3_TODAS").is_ok() {
            crate::i18n::set_en(std::env::var("PORTAL3_LANG").is_ok_and(|l| l == "en"));
            return Progress { unlocked: 999, series: ["classic", "hard", "momentum", "frontier", "boss", "experiment", "campaign"].iter().map(|s| (s.to_string(), 99)).collect(), ..default() };
        }
        let p: Progress = std::fs::read_to_string(data_dir().join("progresso.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        crate::i18n::set_en(std::env::var("PORTAL3_LANG").map(|l| l == "en").unwrap_or(p.lang == "en"));
        p
    }

    pub fn save(&self) {
        if std::env::var("PORTAL3_MUTE").is_ok() {
            return; // (testes: não mexe no progresso de quem joga)
        }
        let d = data_dir();
        let _ = std::fs::create_dir_all(&d);
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(d.join("progresso.json"), s);
        }
    }

    pub fn series_n(&self, s: &str) -> i64 {
        self.series.get(s).copied().unwrap_or(1)
    }

    /// a câmara está trancada?
    pub fn locked(&self, l: &crate::levels::LevelDef) -> bool {
        // os seus níveis (do editor) nunca ficam trancados: terminar um não destrava o próximo
        if l.free || l.series.as_deref() == Some("mine") {
            return false;
        }
        match &l.series {
            Some(s) => l.n.unwrap_or(0) + 1 > self.series_n(s),
            None => l.id > self.unlocked,
        }
    }
}

// ------------------------------------------------------------------ telas
#[derive(Component, Clone, Copy, Debug, PartialEq)]
enum Act {
    Level(usize),
    Play,
    Music,
    Voice,
    Blur,
    Vsync,
    Quality,
    Lang,
    Resume,
    Restart,
    ToMenu,
    Next,
    Again,
    /// editor: nível novo, importar um arquivo, editar o nível k de Meus níveis, voltar do teste
    NewLevel,
    ImportLevel,
    EditLevel(usize),
    BackToEditor,
    /// campanha original: escolher o pacote .zip ou a pasta do Portal
    CampPack,
    CampFolder,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Shown {
    None,
    Menu,
    Pause,
    Done,
    Final,
}

#[derive(Resource)]
pub struct Menus {
    root: Option<Entity>,
    shown: Shown,
    scroll: Option<Entity>,
    fonts: (Handle<Font>, Handle<Font>),
    /// o fim de câmara: título, tempo, há próxima
    pub done: Option<(String, String, bool)>,
}

fn text(f: &Handle<Font>, size: f32, c: Color) -> (TextFont, TextColor) {
    (TextFont::from_font_size(FontSize::Px(size)).with_font(f.clone()), TextColor(c))
}

fn label(ecs: &mut Ecs, parent: Entity, f: &Handle<Font>, s: &str, size: f32, c: Color, spacing: f32) -> Entity {
    let (a, b) = text(f, size, c);
    ecs.spawn((Text::new(s), a, b, LetterSpacing::Px(size * spacing), ChildOf(parent))).id()
}

fn button(ecs: &mut Ecs, parent: Entity, act: Act, node: Node, bg: Color, border: Color) -> Entity {
    ecs.spawn((Interaction::default(), bevy::ui::FocusPolicy::Block, act, node, BackgroundColor(bg), BorderColor::all(border), ChildOf(parent))).id()
}

impl Menus {
    fn clear(&mut self, ecs: &mut Ecs) {
        if let Some(r) = self.root.take() {
            if let Ok(e) = ecs.get_entity_mut(r) {
                e.despawn();
            }
        }
        self.scroll = None;
        self.shown = Shown::None;
    }

    fn target(ecs: &mut Ecs) -> Option<Entity> {
        ecs.get_resource::<crate::gun::Gun>().map(|g| g.cam)
    }

    /// o menu: título, texto, as séries com as câmaras e as ações
    fn build_menu(&mut self, ecs: &mut Ecs) {
        let Some(cam) = Self::target(ecs) else { return };
        let (ui, mono) = self.fonts.clone();
        let (levels, progress) = {
            let g = ecs.resource::<Game>();
            (g.levels.clone(), g.progress.clone())
        };
        // fundo escuro à esquerda, a câmara 1 aparecendo à direita
        let grad = Gradient::Linear(LinearGradient::new(
            std::f32::consts::FRAC_PI_2,
            vec![
                ColorStop::new(Color::srgba(0.02, 0.027, 0.047, crate::hud::css_dark(0.94)), Val::Percent(0.0)),
                ColorStop::new(Color::srgba(0.02, 0.027, 0.047, crate::hud::css_dark(0.82)), Val::Percent(45.0)),
                ColorStop::new(Color::srgba(0.02, 0.027, 0.047, crate::hud::css_dark(0.25)), Val::Percent(100.0)),
            ],
        ));
        let root = ecs
            .spawn((Node { position_type: PositionType::Absolute, width: Val::Percent(100.0), height: Val::Percent(100.0), ..default() }, BackgroundGradient(vec![grad]), UiTargetCamera(cam), GlobalZIndex(10)))
            .id();
        let scroll = ecs
            .spawn((
                Node { width: Val::Percent(100.0), height: Val::Percent(100.0), overflow: Overflow::scroll_y(), flex_direction: FlexDirection::Column, padding: UiRect::all(Val::Px(24.0)), ..default() },
                ScrollPosition::default(),
                ChildOf(root),
            ))
            .id();
        let bx = ecs
            .spawn((Node { width: Val::Px(760.0), max_width: Val::Percent(100.0), margin: UiRect::left(Val::Px(64.0)), flex_direction: FlexDirection::Column, row_gap: Val::Px(14.0), padding: UiRect::vertical(Val::Px(20.0)), ..default() }, ChildOf(scroll)))
            .id();
        label(ecs, bx, &mono, "TÚNEL GRAVITACIONAL · PARTE IV · FICÇÃO CIENTÍFICA", 11.0, BLUE, 0.28);
        let (f, c) = text(&ui, 64.0, INK);
        ecs.spawn((Text::new("Laboratório Antípoda"), f.with_font_weight(FontWeight(300)), c, ChildOf(bx)));
        let (f, c) = text(&ui, 16.0, Color::srgba(0.933, 0.949, 0.973, 0.88));
        ecs.spawn((
            Node { max_width: Val::Px(640.0), ..default() },
            Text::new(crate::i18n::html("lead", "Embaixo de Nova Lima, a equipe do documentário montou um laboratório secreto. Em vez de furar a rocha, a nova \"sonda\" dobra o espaço: abre dois portais ligados entre si. Passe pelas seis câmaras de teste — e, na última, atravesse a Terra. Ou encare a bateria clássica: doze testes que todo laboratório de portais faz, do primeiro botão até a fornalha. 🦖 Cuidado: o laboratório está cheio de dinossauros (de capacete).")),
            f.with_font_weight(FontWeight(300)),
            c,
            ChildOf(bx),
        ));
        let groups: [(&str, &str, fn(&crate::levels::LevelDef) -> bool); 9] = [
            ("Laboratório Antípoda", "as seis câmaras do documentário", |l| !l.free && l.series.is_none()),
            ("Bateria clássica", "os testes clássicos do gênero, refeitos aqui embaixo", |l| l.series.as_deref() == Some("classic")),
            ("Desafios hardcore", "salas enormes, plataformas diagonais, pistões — use o tempo lento", |l| l.series.as_deref() == Some("hard")),
            ("Série Momento", "arremessos encadeados: abra os portais nos painéis diagonais em pleno voo", |l| l.series.as_deref() == Some("momentum")),
            ("Série Fronteira", "mapas enormes com tudo junto: lasers, funis, placas de lançamento, viagem no tempo, antigravidade, buracos negros e a Lua", |l| l.series.as_deref() == Some("frontier")),
            ("Série Chefes", "um inimigo gigante por fase: devolva os foguetes dele pelos portais, queime os núcleos que caem e abra a saída", |l| l.series.as_deref() == Some("boss")),
            ("Série Experimento", "o relógio do tempo: 1 volta, 2 para, 3 anda — e o seu passado vira um clone que ajuda você", |l| l.series.as_deref() == Some("experiment")),
            ("Campanha original", "precisa da sua cópia do Portal (Valve): escolha o pacote gerado com \"npm run pacote\" ou a pasta do jogo — tudo é lido só neste computador", |l| l.series.as_deref() == Some("campaign")),
            ("Exploração", "", |l| l.free),
        ];
        for (title, sub, pick) in groups {
            if !levels.iter().any(pick) {
                continue;
            }
            let head = ecs.spawn((Node { column_gap: Val::Px(10.0), align_items: AlignItems::Baseline, margin: UiRect::top(Val::Px(10.0)), ..default() }, ChildOf(bx))).id();
            label(ecs, head, &mono, &title.to_uppercase(), 12.0, INK, 0.24);
            if !sub.is_empty() {
                label(ecs, head, &ui, sub, 12.0, MUTED, 0.0);
            }
            if title == "Campanha original" {
                let tools = ecs.spawn((Node { column_gap: Val::Px(8.0), align_items: AlignItems::Center, ..default() }, ChildOf(bx))).id();
                for (act, s) in [(Act::CampPack, "Escolher pacote (.zip)"), (Act::CampFolder, "Escolher pasta do Portal")] {
                    let b = button(ecs, tools, act, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
                    label(ecs, b, &ui, s, 13.0, INK, 0.0);
                }
                let st = match crate::campaign::source::get() {
                    Some(c) => c.path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
                    None => "nenhuma cópia escolhida".to_string(),
                };
                label(ecs, tools, &ui, &st, 12.0, MUTED, 0.0);
            }
            let grid = ecs.spawn((Node { display: Display::Grid, grid_template_columns: RepeatedGridTrack::flex(4, 1.0), column_gap: Val::Px(10.0), row_gap: Val::Px(10.0), ..default() }, ChildOf(bx))).id();
            for (i, l) in levels.iter().enumerate() {
                if !pick(l) {
                    continue;
                }
                let locked = progress.locked(l);
                let b = button(
                    ecs,
                    grid,
                    Act::Level(i),
                    Node { flex_direction: FlexDirection::Column, row_gap: Val::Px(2.0), padding: UiRect::axes(Val::Px(14.0), Val::Px(12.0)), border: UiRect::all(Val::Px(1.0)), min_height: Val::Px(74.0), ..default() },
                    Color::srgba(1.0, 1.0, 1.0, 0.02),
                    LINE,
                );
                if locked {
                    ecs.entity_mut(b).remove::<Act>();
                }
                let a = if locked { 0.35 } else { 1.0 };
                let n = if l.free { "MAPA LIVRE".to_string() } else { l.code.clone().unwrap_or_else(|| format!("{:02}", l.id)) };
                label(ecs, b, &mono, &n, 11.0, BLUE.with_alpha(a), 0.2);
                let nm = if l.series.as_deref() == Some("campaign") { crate::hud::level_label(l) } else { l.name.clone() };
                label(ecs, b, &ui, &nm, 18.0, INK.with_alpha(a), 0.0);
                label(ecs, b, &ui, &l.who, 12.0, MUTED.with_alpha(MUTED.alpha() * a), 0.0);
                if let Some(best) = progress.best.get(&l.id.to_string()) {
                    let e = label(ecs, b, &mono, &fmt_time(*best), 11.0, Color::srgb(0.49, 1.0, 0.69), 0.0);
                    ecs.entity_mut(e).insert(Node { position_type: PositionType::Absolute, right: Val::Px(12.0), top: Val::Px(12.0), ..default() });
                }
                if locked {
                    let e = label(ecs, b, &ui, "🔒", 13.0, INK.with_alpha(0.5), 0.0);
                    ecs.entity_mut(e).insert(Node { position_type: PositionType::Absolute, right: Val::Px(12.0), bottom: Val::Px(10.0), ..default() });
                }
            }
        }
        // meus níveis (feitos no editor)
        let head = ecs.spawn((Node { column_gap: Val::Px(10.0), align_items: AlignItems::Baseline, margin: UiRect::top(Val::Px(10.0)), ..default() }, ChildOf(bx))).id();
        label(ecs, head, &mono, "MEUS NÍVEIS", 12.0, INK, 0.24);
        label(ecs, head, &ui, "feitos por você no editor — ficam neste computador; exporte para compartilhar", 12.0, MUTED, 0.0);
        let tools = ecs.spawn((Node { column_gap: Val::Px(8.0), ..default() }, ChildOf(bx))).id();
        for (act, s) in [(Act::NewLevel, "＋ Novo nível"), (Act::ImportLevel, "⇪ Importar .json")] {
            let b = button(ecs, tools, act, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
            label(ecs, b, &ui, s, 13.0, INK, 0.0);
        }
        let mine: Vec<(usize, crate::levels::LevelDef)> = levels.iter().enumerate().filter(|(_, l)| l.series.as_deref() == Some("mine")).map(|(i, l)| (i, l.clone())).collect();
        if !mine.is_empty() {
            let docs = crate::editor::store::list();
            let grid = ecs.spawn((Node { display: Display::Grid, grid_template_columns: RepeatedGridTrack::flex(4, 1.0), column_gap: Val::Px(10.0), row_gap: Val::Px(10.0), ..default() }, ChildOf(bx))).id();
            for (k, (i, l)) in mine.iter().enumerate() {
                let b = button(ecs, grid, Act::Level(*i), Node { flex_direction: FlexDirection::Column, row_gap: Val::Px(2.0), padding: UiRect::axes(Val::Px(14.0), Val::Px(12.0)), border: UiRect::all(Val::Px(1.0)), min_height: Val::Px(74.0), ..default() }, Color::srgba(1.0, 1.0, 1.0, 0.02), LINE);
                label(ecs, b, &mono, l.code.as_deref().unwrap_or(""), 11.0, BLUE, 0.2);
                label(ecs, b, &ui, &l.name, 18.0, INK, 0.0);
                let n = docs.get(k).map(|d| d.items.len()).unwrap_or(0);
                label(ecs, b, &ui, &crate::i18n::tlv("{n} itens", &[("n", n.to_string())]), 12.0, MUTED, 0.0);
                if let Some(best) = progress.best.get(&l.id.to_string()) {
                    let e = label(ecs, b, &mono, &fmt_time(*best), 11.0, Color::srgb(0.49, 1.0, 0.69), 0.0);
                    ecs.entity_mut(e).insert(Node { position_type: PositionType::Absolute, right: Val::Px(12.0), top: Val::Px(12.0), ..default() });
                }
                let e = button(ecs, b, Act::EditLevel(k), Node { position_type: PositionType::Absolute, right: Val::Px(8.0), bottom: Val::Px(8.0), padding: UiRect::axes(Val::Px(7.0), Val::Px(3.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
                label(ecs, e, &ui, "✎ editar", 11.0, INK, 0.0);
            }
        }
        // ações
        let row = ecs.spawn((Node { column_gap: Val::Px(8.0), row_gap: Val::Px(8.0), flex_wrap: FlexWrap::Wrap, align_items: AlignItems::Center, margin: UiRect::top(Val::Px(10.0)), ..default() }, ChildOf(bx))).id();
        let big = button(ecs, row, Act::Play, Node { padding: UiRect::axes(Val::Px(22.0), Val::Px(12.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, BLUE.with_alpha(0.08), BLUE);
        label(ecs, big, &ui, "▶ Jogar sozinho", 16.0, BLUE, 0.02);
        for (act, s, on) in [(Act::Music, "♪ Música", progress.music), (Act::Voice, "Narração", progress.voice), (Act::Blur, "Desfoque", progress.blur), (Act::Vsync, "VSync", progress.vsync)] {
            let b = button(ecs, row, act, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, if on { BLUE.with_alpha(0.08) } else { Color::NONE }, if on { BLUE } else { Color::srgba(1.0, 1.0, 1.0, 0.18) });
            label(ecs, b, &ui, s, 13.0, if on { BLUE } else { INK }, 0.0);
        }
        // qualidade gráfica (o botão passa por alta, média e baixa)
        let q = ecs.resource::<crate::quality::QualityState>().current as usize;
        let b = button(ecs, row, Act::Quality, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
        label(ecs, b, &ui, &format!("Qualidade: {}", crate::quality::NAMES[q.min(2)]), 13.0, INK, 0.0);
        // idioma dos textos (o botão diz o outro idioma)
        let b = button(ecs, row, Act::Lang, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
        let other = if crate::i18n::is_en() { "🌐 Português" } else { "🌐 English" };
        label(ecs, b, &ui, other, 13.0, INK, 0.0);
        // teclas
        let keys = ecs.spawn((Node { display: Display::Grid, grid_template_columns: RepeatedGridTrack::flex(3, 1.0), column_gap: Val::Px(14.0), row_gap: Val::Px(6.0), margin: UiRect::top(Val::Px(6.0)), ..default() }, ChildOf(bx))).id();
        for k in [
            "W A S D — andar",
            "Mouse / setas — olhar",
            "Botão esquerdo / Q — portal ciano",
            "Botão direito / F — portal vermelho",
            "Botão do meio / G — tempo lento",
            "Rodinha / Z X — zoom",
            "Espaço — pular",
            "E — pegar / soltar objeto",
            "T — viajar no tempo (série Fronteira)",
            "Botão esquerdo — segurando: arremessar",
            "R — reiniciar câmara",
            "Esc — pausa",
        ] {
            label(ecs, keys, &ui, k, 13.0, MUTED, 0.0);
        }
        let (f, c) = text(&ui, 12.0, MUTED);
        ecs.spawn((
            Node { max_width: Val::Px(700.0), ..default() },
            Text::new(crate::i18n::html("rules", "Portais só abrem em concreto claro (não em rocha, metal ou vidro). O que entra rápido sai rápido. O botão do meio liga o tempo lento, que gasta uma reserva de alguns segundos. Jogo original inspirado no gênero de quebra-cabeças com portais; sem nomes ou arquivos de outros jogos.")),
            f,
            c,
            ChildOf(bx),
        ));
        self.root = Some(root);
        self.scroll = Some(scroll);
        self.shown = Shown::Menu;
    }

    /// camada escura por cima do jogo, com uma caixa
    fn overlay(ecs: &mut Ecs, cam: Entity) -> Entity {
        ecs.spawn((
            Node { position_type: PositionType::Absolute, width: Val::Percent(100.0), height: Val::Percent(100.0), justify_content: JustifyContent::Center, align_items: AlignItems::Center, ..default() },
            BackgroundColor(Color::srgba(0.016, 0.024, 0.04, crate::hud::css_dark(0.7))),
            UiTargetCamera(cam),
            GlobalZIndex(11),
        ))
        .id()
    }

    fn opt(ecs: &mut Ecs, parent: Entity, ui: &Handle<Font>, mono: &Handle<Font>, act: Act, s: &str, key: &str, main: bool, size: f32) -> Entity {
        let b = button(
            ecs,
            parent,
            act,
            Node { justify_content: JustifyContent::SpaceBetween, align_items: AlignItems::Center, column_gap: Val::Px(16.0), min_height: Val::Px(if size > 18.0 { 52.0 } else { 48.0 }), border: UiRect::bottom(Val::Px(1.0)), ..default() },
            Color::NONE,
            LINE,
        );
        let (f, c) = text(ui, size, if main { BLUE } else { INK });
        ecs.spawn((Text::new(s), f.with_font_weight(FontWeight(if main { 400 } else { 300 })), c, ChildOf(b)));
        if !key.is_empty() {
            label(ecs, b, mono, key, 12.0, Color::srgba(0.957, 0.969, 0.98, 0.5), 0.2);
        }
        b
    }

    fn build_pause(&mut self, ecs: &mut Ecs) {
        let Some(cam) = Self::target(ecs) else { return };
        let (ui, mono) = self.fonts.clone();
        let (info, progress) = {
            let g = ecs.resource::<Game>();
            let info = g.level.map(|i| format!("{} · {} · {}", level_label(&g.levels[i]), g.levels[i].name, fmt_time(g.level_time))).unwrap_or_default();
            (info, g.progress.clone())
        };
        let root = Self::overlay(ecs, cam);
        // (a pausa da versão web: tela inteira, lista à esquerda, opções à direita, fio de 1 px em x = 120)
        ecs.spawn((Node { position_type: PositionType::Absolute, left: Val::Px(120.0), top: Val::Px(0.0), bottom: Val::Px(0.0), width: Val::Px(1.0), ..default() }, BackgroundColor(Color::srgba(1.0, 1.0, 1.0, 0.16)), ChildOf(root)));
        let bx = ecs
            .spawn((
                Node { position_type: PositionType::Absolute, left: Val::Px(0.0), top: Val::Px(0.0), width: Val::Percent(100.0), height: Val::Percent(100.0), padding: UiRect::new(Val::Px(160.0), Val::Px(120.0), Val::Px(120.0), Val::Px(48.0)), justify_content: JustifyContent::SpaceBetween, ..default() },
                ChildOf(root),
            ))
            .id();
        let main = ecs.spawn((Node { flex_direction: FlexDirection::Column, row_gap: Val::Px(8.0), min_width: Val::Px(210.0), max_width: Val::Px(420.0), ..default() }, ChildOf(bx))).id();
        label(ecs, main, &mono, &info.to_uppercase(), 11.0, BLUE, 0.24);
        let (f, c) = text(&ui, 56.0, INK);
        ecs.spawn((Node { margin: UiRect::bottom(Val::Px(28.0)), ..default() }, Text::new("Pausado"), f.with_font_weight(FontWeight(300)), c, ChildOf(main)));
        Self::opt(ecs, main, &ui, &mono, Act::Resume, "Continuar", "Esc", true, 20.0);
        Self::opt(ecs, main, &ui, &mono, Act::Restart, "Reiniciar câmara", "R", false, 20.0);
        if ecs.resource::<Game>().editor.as_ref().is_some_and(|e| e.testing) {
            Self::opt(ecs, main, &ui, &mono, Act::BackToEditor, "Voltar ao editor", "F5", false, 20.0);
        }
        Self::opt(ecs, main, &ui, &mono, Act::ToMenu, "Voltar ao menu", "", false, 20.0);
        let opts = ecs.spawn((Node { flex_direction: FlexDirection::Column, min_width: Val::Px(244.0), max_width: Val::Px(360.0), ..default() }, ChildOf(bx))).id();
        let h = label(ecs, opts, &mono, "OPÇÕES", 11.0, Color::srgba(0.957, 0.969, 0.98, 0.6), 0.24);
        ecs.entity_mut(h).insert(Node { margin: UiRect::new(Val::Px(0.0), Val::Px(0.0), Val::Px(6.0), Val::Px(10.0)), ..default() });
        for (act, s, on) in [(Act::Music, "Música", progress.music), (Act::Voice, "Narração", progress.voice), (Act::Blur, "Desfoque de movimento", progress.blur), (Act::Vsync, "Sincronia vertical (VSync)", progress.vsync)] {
            let b = Self::opt(ecs, opts, &ui, &mono, act, s, "", false, 16.0);
            label(ecs, b, &mono, if on { "LIGADO" } else { "DESLIGADO" }, 11.0, if on { BLUE } else { Color::srgba(0.957, 0.969, 0.98, 0.45) }, 0.2);
        }
        let q = ecs.resource::<crate::quality::QualityState>().current as usize;
        let b = Self::opt(ecs, opts, &ui, &mono, Act::Quality, "Qualidade gráfica", "", false, 16.0);
        label(ecs, b, &mono, &crate::quality::NAMES[q.min(2)].to_uppercase(), 11.0, BLUE, 0.2);
        let foot = label(ecs, root, &mono, "LABORATÓRIO ANTÍPODA · NOVA LIMA", 11.0, Color::srgba(0.957, 0.969, 0.98, 0.45), 0.24);
        ecs.entity_mut(foot).insert(Node { position_type: PositionType::Absolute, left: Val::Px(160.0), bottom: Val::Px(48.0), ..default() });
        self.root = Some(root);
        self.shown = Shown::Pause;
    }

    fn build_done(&mut self, ecs: &mut Ecs) {
        let Some(cam) = Self::target(ecs) else { return };
        let (ui, mono) = self.fonts.clone();
        let (title, time, next) = self.done.clone().unwrap_or_default();
        let root = Self::overlay(ecs, cam);
        let bx = ecs
            .spawn((
                Node { flex_direction: FlexDirection::Column, row_gap: Val::Px(12.0), padding: UiRect::axes(Val::Px(36.0), Val::Px(26.0)), border: UiRect::left(Val::Px(1.0)), min_width: Val::Px(320.0), ..default() },
                BackgroundColor(Color::srgba(0.04, 0.05, 0.08, crate::hud::css_dark(0.78))),
                BorderColor::all(BLUE),
                ChildOf(root),
            ))
            .id();
        label(ecs, bx, &mono, "TESTE CONCLUÍDO", 11.0, BLUE, 0.24);
        let (f, c) = text(&ui, 30.0, INK);
        ecs.spawn((Text::new(title), f.with_font_weight(FontWeight(300)), c, ChildOf(bx)));
        label(ecs, bx, &ui, &time, 15.0, Color::srgba(0.933, 0.949, 0.973, 0.88), 0.0);
        if next {
            let b = button(ecs, bx, Act::Next, Node { padding: UiRect::axes(Val::Px(22.0), Val::Px(12.0)), border: UiRect::all(Val::Px(1.0)), align_self: AlignSelf::Start, ..default() }, BLUE.with_alpha(0.08), BLUE);
            label(ecs, b, &ui, "Próxima câmara →", 16.0, BLUE, 0.02);
        }
        let row = ecs.spawn((Node { column_gap: Val::Px(8.0), ..default() }, ChildOf(bx))).id();
        if ecs.resource::<Game>().editor.as_ref().is_some_and(|e| e.testing) {
            let b = button(ecs, row, Act::BackToEditor, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, BLUE.with_alpha(0.08), BLUE);
            label(ecs, b, &ui, "✎ Voltar ao editor", 13.0, BLUE, 0.0);
        }
        for (act, s) in [(Act::Again, "↺ Repetir"), (Act::ToMenu, "Menu")] {
            let b = button(ecs, row, act, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
            label(ecs, b, &ui, s, 13.0, INK, 0.0);
        }
        self.root = Some(root);
        self.shown = Shown::Done;
    }

    fn build_final(&mut self, ecs: &mut Ecs) {
        let Some(cam) = Self::target(ecs) else { return };
        let (ui, mono) = self.fonts.clone();
        let t = ecs.resource::<Game>().level_time;
        let root = Self::overlay(ecs, cam);
        let bx = ecs
            .spawn((
                Node { flex_direction: FlexDirection::Column, row_gap: Val::Px(12.0), padding: UiRect::axes(Val::Px(36.0), Val::Px(26.0)), border: UiRect::left(Val::Px(1.0)), max_width: Val::Px(620.0), ..default() },
                BackgroundColor(Color::srgba(0.04, 0.05, 0.08, crate::hud::css_dark(0.78))),
                BorderColor::all(BLUE),
                ChildOf(root),
            ))
            .id();
        label(ecs, bx, &mono, "CÂMARA 06 · ANTÍPODA", 11.0, BLUE, 0.24);
        let (f, c) = text(&ui, 30.0, INK);
        ecs.spawn((Text::new("Você atravessou a Terra"), f.with_font_weight(FontWeight(300)), c, ChildOf(bx)));
        label(ecs, bx, &ui, &format!("Caiu, passou pelo centro sem peso nenhum, foi freando e chegou parado do outro lado — de cabeça para baixo em relação a quem ficou em Minas. Tempo da câmara: {}.", fmt_time(t)), 15.0, Color::srgba(0.933, 0.949, 0.973, 0.88), 0.0);
        label(ecs, bx, &ui, "No túnel de verdade, de 12.742 km, essa mesma queda levaria ~42 minutos e chegaria a ~28.000 km/h no centro — para você, para a Dona Cida e para um T-rex de 8 toneladas: no vácuo, todo mundo cai igual.", 14.0, MUTED, 0.0);
        let b = button(ecs, bx, Act::ToMenu, Node { padding: UiRect::axes(Val::Px(13.0), Val::Px(7.0)), border: UiRect::all(Val::Px(1.0)), align_self: AlignSelf::Start, ..default() }, Color::NONE, Color::srgba(1.0, 1.0, 1.0, 0.18));
        label(ecs, b, &ui, "Menu do jogo", 13.0, INK, 0.0);
        self.root = Some(root);
        self.shown = Shown::Final;
    }
}

/// o que deve aparecer agora
fn wanted(g: &Game) -> Shown {
    if g.menu {
        Shown::Menu
    } else if g.completed && g.final_shown {
        Shown::Final
    } else if g.completed {
        Shown::Done
    } else if g.paused {
        Shown::Pause
    } else {
        Shown::None
    }
}

pub fn menu_system(ecs: &mut Ecs) {
    if !ecs.contains_resource::<Menus>() {
        if ecs.get_resource::<crate::gun::Gun>().is_none() {
            return;
        }
        let assets = ecs.resource::<AssetServer>().clone();
        ecs.insert_resource(Menus { root: None, shown: Shown::None, scroll: None, fonts: (assets.load("fonts/IBMPlexSans.ttf"), assets.load("fonts/IBMPlexMono-Regular.ttf")), done: None });
    }
    // cliques
    let mut acts = vec![];
    {
        let mut q = ecs.query_filtered::<(&Interaction, &Act), Changed<Interaction>>();
        for (i, a) in q.iter(ecs) {
            if *i == Interaction::Pressed {
                acts.push(*a);
            }
        }
        let mut q = ecs.query_filtered::<(&Interaction, &mut BackgroundColor), (With<Act>, Changed<Interaction>)>();
        for (i, mut bg) in q.iter_mut(ecs) {
            // (realce ao passar o mouse)
            let a = bg.0.alpha();
            match i {
                Interaction::Hovered => bg.0 = bg.0.with_alpha((a + 0.06).min(0.3)),
                Interaction::None => bg.0 = bg.0.with_alpha((a - 0.06).max(if a > 0.07 { 0.08 } else { 0.0 })),
                _ => {}
            }
        }
    }
    let mut rebuild = false;
    let mut relang = false;
    let cur_q = ecs.resource::<crate::quality::QualityState>().current;
    for a in acts {
        let mut g = ecs.resource_mut::<Game>();
        match a {
            Act::Level(i) => g.start_level(i),
            Act::Play => {
                let i = g.progress.last.unwrap_or(0).min((g.progress.unlocked - 1).max(0) as usize);
                g.start_level(i);
            }
            Act::Music => {
                g.progress.music = !g.progress.music;
                g.progress.save();
                rebuild = true;
            }
            Act::Voice => {
                g.progress.voice = !g.progress.voice;
                g.progress.save();
                rebuild = true;
            }
            Act::Blur => {
                g.progress.blur = !g.progress.blur;
                g.progress.save();
                rebuild = true;
            }
            Act::Quality => {
                g.progress.quality = Some((cur_q + 2) % 3); // alta → média → baixa → alta
                g.progress.save();
                rebuild = true;
            }
            Act::Vsync => {
                g.progress.vsync = !g.progress.vsync;
                g.progress.save();
                rebuild = true;
            }
            Act::Lang => {
                let en = !crate::i18n::is_en();
                crate::i18n::set_en(en);
                g.progress.lang = if en { "en".into() } else { "pt".into() };
                g.progress.save();
                rebuild = true;
                relang = true;
            }
            Act::Resume => g.paused = false,
            Act::Restart => {
                if let Some(i) = g.level {
                    g.start_level(i);
                }
            }
            Act::ToMenu => g.to_menu(),
            Act::NewLevel => g.editor_req = Some(None),
            Act::EditLevel(k) => {
                if let Some(d) = crate::editor::store::list().get(k) {
                    g.editor_req = Some(Some(d.id.clone()));
                }
            }
            Act::ImportLevel => {
                if let Some(path) = rfd::FileDialog::new().add_filter("nível", &["json"]).pick_file() {
                    match crate::editor::store::import_from(&path) {
                        Ok(d) => {
                            crate::editor::store::save(&d);
                            g.toast(&crate::i18n::tlv("“{name}” importado.", &[("name", d.name.clone())]));
                            g.refresh_mine();
                            rebuild = true;
                        }
                        Err(e) => g.toast(&crate::i18n::tlv("Não deu para importar: {msg}", &[("msg", e)])),
                    }
                }
            }
            Act::BackToEditor => g.editor_resume(),
            Act::CampPack | Act::CampFolder => {
                let pick = if matches!(a, Act::CampPack) { rfd::FileDialog::new().add_filter("Pacote da campanha", &["zip"]).pick_file() } else { rfd::FileDialog::new().pick_folder() };
                if let Some(path) = pick {
                    if !crate::campaign::source::use_path(&path, true) {
                        g.toast(crate::i18n::tl(if matches!(a, Act::CampPack) { "Esse arquivo não é o pacote da campanha. Gere-o com \"npm run pacote\" (veja o LEIA-ME do projeto)." } else { "Essa pasta não parece ser a do Portal. Escolha a pasta \"Portal\" (a que tem as pastas \"portal\" e \"hl2\" dentro)." }).as_str());
                    }
                    rebuild = true;
                }
            }
            Act::Next => {
                if let Some(i) = g.level {
                    let n = (i + 1).min(g.levels.len() - 1);
                    g.start_level(n);
                }
            }
            Act::Again => {
                if let Some(i) = g.level {
                    g.start_level(i);
                }
            }
        }
    }
    // outro idioma: o HUD é refeito e a câmara do fundo recarregada (as placas 3D também)
    if relang {
        if let Some(h) = ecs.remove_resource::<crate::hud::Hud>() {
            if let Ok(e) = ecs.get_entity_mut(h.root()) {
                e.despawn();
            }
        }
        let mut g = ecs.resource_mut::<Game>();
        if g.menu {
            g.want_idx = Some((g.level.unwrap_or(0), true));
        }
    }
    let want = wanted(ecs.resource::<Game>());
    ecs.resource_scope(|ecs, mut m: Mut<Menus>| {
        if want == Shown::Done {
            m.done = ecs.resource::<Game>().done_info();
        }
        if want != m.shown || rebuild {
            m.clear(ecs);
            match want {
                Shown::Menu => m.build_menu(ecs),
                Shown::Pause => m.build_pause(ecs),
                Shown::Done => m.build_done(ecs),
                Shown::Final => m.build_final(ecs),
                Shown::None => {}
            }
        }
        // rolagem do menu com a rodinha
        if let Some(s) = m.scroll {
            let sc = *ecs.resource::<AccumulatedMouseScroll>();
            let dy = match sc.unit {
                MouseScrollUnit::Line => sc.delta.y * 40.0,
                MouseScrollUnit::Pixel => sc.delta.y,
            };
            if dy != 0.0 {
                if let Some(mut p) = ecs.get_mut::<ScrollPosition>(s) {
                    p.0.y = (p.0.y - dy).max(0.0);
                }
            }
        }
    });
    // desfoque por trás da pausa e do fim de câmara (o backdrop-filter: blur da versão web)
    let blur = matches!(want, Shown::Pause | Shown::Done | Shown::Final);
    if let Some(mut st) = ecs.get_resource_mut::<crate::post::PostState>() {
        st.backdrop = blur;
    }
    // o HUD some nos menus
    let playing = want == Shown::None && !ecs.resource::<Game>().editing;
    if let Some(root) = ecs.get_resource::<crate::hud::Hud>().map(|h| h.root()) {
        let vis = if playing && !ecs.resource::<Game>().menu { Visibility::Inherited } else { Visibility::Hidden };
        ecs.entity_mut(root).insert(vis);
    }
    // mouse preso enquanto joga
    let mut q = ecs.query_filtered::<(&Window, &mut CursorOptions), With<PrimaryWindow>>();
    if let Ok((w, mut c)) = q.single_mut(ecs) {
        let lock = playing && w.focused;
        let mode = if lock { CursorGrabMode::Locked } else { CursorGrabMode::None };
        if c.grab_mode != mode {
            c.grab_mode = mode;
            c.visible = !lock;
        }
    }
    let _ = GameEvent::Complete;
}
