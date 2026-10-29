//! O HUD (o #hud de jogo.html e game.css): mira com os dois colchetes, nome da câmara, tempo,
//! vida, avisos rápidos, legendas, teclas, zoom, e as camadas de tela (vinheta, dano, morte).
//! Feito com a interface do Bevy, nas medidas em px do CSS.

use crate::game::Game;
use crate::gun::Gun;
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use bevy::text::{FontSize, FontWeight, LetterSpacing};
use bevy::ui::{ColorStop, Gradient, RadialGradient, RadialGradientShape, UiPosition};

/// alfa de uma camada escura como o navegador mistura (no espaço sRGB); o Bevy mistura no linear
pub fn css_dark(a: f32) -> f32 {
    1.0 - (1.0 - a.clamp(0.0, 1.0)).powf(2.2)
}

const SQRT2: f32 = std::f32::consts::SQRT_2;
const BLUE: Color = Color::srgb(0.149, 0.949, 1.0); // #26f2ff
const ORANGE: Color = Color::srgb(1.0, 0.122, 0.102); // #ff1f1a
const MUTED: Color = Color::srgba(0.9, 0.925, 0.973, 0.6);

#[derive(Resource)]
pub struct Hud {
    root: Entity,
    hurt: Entity,
    flash: Entity,
    /// esmaecimento da tela (env_fade da campanha original)
    fade: Entity,
    xh: Entity,
    /// mira: por lado (esquerdo/direito), os tracinhos (portal ainda não aberto) e o arco cheio (aberto)
    xh_dash: [Vec<Entity>; 2],
    xh_solid: [Vec<Entity>; 2],
    xh_key: u32,
    keys_text: Entity,
    keys_relogio: Option<bool>,
    /// anel do tempo lento em volta da mira: o fundo, o arco que gasta e o pulso ao ligar/desligar
    ring: Entity,
    ring_bg: Vec<Entity>,
    ring_arc: Vec<Entity>,
    ring_pulse: Entity,
    ring_shown: usize,
    ring_low: bool,
    ring_on: bool,
    ring_t: f32,
    xh_dot: Entity,
    xh_ring: Entity,
    lvl_num: Entity,
    lvl_name: Entity,
    lvl_goal: Entity,
    timer: Entity,
    health: Entity,
    health_bar: Entity,
    field: Entity,
    field_v: Entity,
    field_fill: Entity,
    era: Entity,
    era_v: Entity,
    heat: Entity,
    heat_v: Entity,
    gems: Entity,
    gems_v: Entity,
    tube: Entity,
    tube_v: [Entity; 3],
    tube_phase: Entity,
    clock: Entity,
    clock_l: Entity,
    clock_v: Entity,
    clock_fill: Entity,
    clock_hint: Entity,
    clock_extra: Entity,
    paradox: Entity,
    paradox_why: Entity,
    verify: Entity,
    verify_v: Entity,
    verify_fill: Entity,
    slow: Entity,
    slow_l: Entity,
    slow_v: Entity,
    slow_fill: Entity,
    toast: Entity,
    toast_text: Entity,
    subs: Entity,
    subs_who: Entity,
    subs_text: Entity,
    zoom: Entity,
    zoom_text: Entity,
    use_hint: Entity,
    fonts: Fonts,
    level: Option<usize>,
    toast_t: f32,
    sub_t: f32,
    aim_clock: f32,
    aim: Option<bool>,
}

#[derive(Clone)]
struct Fonts {
    ui: Handle<Font>,
    display: Handle<Font>,
    mono: Handle<Font>,
}

const INK: Color = Color::srgb(0.957, 0.969, 0.98); // --hud-ink
const DIM: Color = Color::srgba(0.957, 0.969, 0.98, 0.72); // --hud-dim

fn txt(f: &Handle<Font>, size: f32, c: Color) -> (TextFont, TextColor) {
    (TextFont::from_font_size(FontSize::Px(size)).with_font(f.clone()), TextColor(c))
}

/// rótulo em monoespaçada com espaçamento (o "visual clínico" da versão web)
fn label(f: &Handle<Font>, size: f32, c: Color, spacing: f32) -> (TextFont, TextColor, LetterSpacing) {
    let (a, b) = txt(f, size, c);
    (a, b, LetterSpacing::Px(size * spacing))
}

fn shadow() -> TextShadow {
    TextShadow { offset: Vec2::new(0.0, 1.0), color: Color::srgba(0.0, 0.0, 0.0, 0.85) }
}

/// camada de tela inteira com um degradê radial (transparente no meio)
fn overlay(ecs: &mut Ecs, parent: Entity, inner: f32, c0: Color, c1: Color) -> Entity {
    let g = Gradient::Radial(RadialGradient::new(
        UiPosition::CENTER,
        RadialGradientShape::FarthestCorner,
        // (a elipse "farthest-corner" do Bevy tem os semieixos até as bordas; a do CSS passa pelo canto: ×√2)
        vec![ColorStop::new(c0.with_alpha(0.0), Val::Percent(inner * SQRT2)), ColorStop::new(c1, Val::Percent(100.0 * SQRT2))],
    ));
    ecs.spawn((Node { position_type: PositionType::Absolute, left: Val::Px(0.0), top: Val::Px(0.0), width: Val::Percent(100.0), height: Val::Percent(100.0), ..default() }, BackgroundGradient(vec![g]), ChildOf(parent))).id()
}

/// um traço pequeno de um anel: no ângulo `ang` (graus, no sentido horário a partir da direita), a `r` do
/// centro (cx, cy), `len` ao longo do anel e `thick` de espessura (os anéis do HUD, sem desenho de arco)
fn ring_seg(ecs: &mut Ecs, parent: Entity, cx: f32, cy: f32, r: f32, ang: f32, len: f32, thick: f32, color: Color) -> Entity {
    let a = ang.to_radians();
    let (x, y) = (cx + r * a.cos(), cy + r * a.sin());
    ecs.spawn((
        Node { position_type: PositionType::Absolute, left: Val::Px(x - len / 2.0), top: Val::Px(y - thick / 2.0), width: Val::Px(len), height: Val::Px(thick), ..default() },
        BackgroundColor(color),
        UiTransform::from_rotation(Rot2::degrees(ang + 90.0)),
        Visibility::Hidden,
        ChildOf(parent),
    ))
    .id()
}

pub fn setup_hud(ecs: &mut Ecs) {
    let Some(cam) = ecs.get_resource::<Gun>().map(|g| g.cam) else { return };
    let assets = ecs.resource::<AssetServer>().clone();
    let fonts = Fonts { ui: assets.load("fonts/IBMPlexSans.ttf"), display: assets.load("fonts/IBMPlexSans.ttf"), mono: assets.load("fonts/IBMPlexMono-Regular.ttf") };
    let root = ecs.spawn((Node { width: Val::Percent(100.0), height: Val::Percent(100.0), position_type: PositionType::Absolute, ..default() }, UiTargetCamera(cam), Pickable::IGNORE, Name::new("hud"))).id();
    // vinheta, dano e morte
    let v = overlay(ecs, root, 62.0, Color::srgba(0.0, 0.0, 0.0, 0.0), Color::srgba(0.0, 0.0, 0.0, css_dark(0.3)));
    let _ = v;
    let hurt = overlay(ecs, root, 40.0, Color::srgba(0.86, 0.08, 0.08, 0.0), Color::srgba(0.86, 0.08, 0.08, 0.75));
    let flash = ecs.spawn((Node { position_type: PositionType::Absolute, width: Val::Percent(100.0), height: Val::Percent(100.0), ..default() }, BackgroundColor(Color::srgba(0.63, 0.08, 0.0, 0.0)), ChildOf(root))).id();
    let fade = ecs.spawn((Node { position_type: PositionType::Absolute, width: Val::Percent(100.0), height: Val::Percent(100.0), ..default() }, BackgroundColor(Color::NONE), ChildOf(root))).id();
    // zoom: escurece em volta e mostra o aumento
    let zoom = overlay(ecs, root, 38.0, Color::srgba(0.0, 0.0, 0.0, 0.0), Color::srgba(0.0, 0.0, 0.0, css_dark(0.85)));
    let zoom_text = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, left: Val::Percent(50.0), top: Val::Percent(50.0), margin: UiRect { left: Val::Px(-20.0), top: Val::Px(36.0), ..default() }, ..default() },
            Text::new("1,0×"),
            txt(&fonts.mono, 13.0, Color::srgb(0.81, 0.91, 1.0)),
            shadow(),
            ChildOf(zoom),
        ))
        .id();
    // mira: dois arcos ( ) num círculo de 34 px — o ciano à esquerda, o vermelho à direita
    let xh = ecs
        .spawn((Node { position_type: PositionType::Absolute, left: Val::Percent(50.0), top: Val::Percent(50.0), width: Val::Px(48.0), height: Val::Px(48.0), margin: UiRect::all(Val::Px(-24.0)), ..default() }, ChildOf(root)))
        .id();
    // (como na versão web: um quarto de círculo de cada lado; tracejado e fraco enquanto o portal não
    // existe, arco cheio e mais grosso quando ele está aberto)
    let mut xh_dash: [Vec<Entity>; 2] = [vec![], vec![]];
    let mut xh_solid: [Vec<Entity>; 2] = [vec![], vec![]];
    for (side, base) in [(0usize, 180.0f32), (1usize, 0.0f32)] {
        for off in [-36.0f32, -18.0, 0.0, 18.0, 36.0] {
            xh_dash[side].push(ring_seg(ecs, xh, 24.0, 24.0, 16.35, base + off, 3.4, 1.3, Color::NONE));
        }
        for k in -6..=6 {
            xh_solid[side].push(ring_seg(ecs, xh, 24.0, 24.0, 15.8, base + k as f32 * 7.0, 3.0, 2.4, Color::NONE));
        }
    }
    // anel do tempo lento (70 px): o fundo, o arco que gasta (começa em cima, no sentido horário) e o pulso
    let ring = ecs
        .spawn((Node { position_type: PositionType::Absolute, left: Val::Percent(50.0), top: Val::Percent(50.0), width: Val::Px(70.0), height: Val::Px(70.0), margin: UiRect::all(Val::Px(-35.0)), ..default() }, Visibility::Hidden, ChildOf(root)))
        .id();
    let ring_n = 96usize;
    let (mut ring_bg, mut ring_arc) = (vec![], vec![]);
    for k in 0..ring_n {
        let ang = -90.0 + (k as f32 + 0.5) * 360.0 / ring_n as f32;
        let e = ring_seg(ecs, ring, 35.0, 35.0, 29.75, ang, 2.5, 3.85, Color::srgba(1.0, 1.0, 1.0, 0.14));
        ecs.entity_mut(e).insert(Visibility::Inherited);
        ring_bg.push(e);
        ring_arc.push(ring_seg(ecs, ring, 35.0, 35.0, 29.75, ang, 2.5, 3.85, Color::srgb(0.5, 0.83, 1.0)));
    }
    let ring_pulse = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, left: Val::Px(0.0), top: Val::Px(0.0), width: Val::Px(70.0), height: Val::Px(70.0), border: UiRect::all(Val::Px(2.0)), border_radius: BorderRadius::MAX, ..default() },
            BorderColor::all(Color::NONE),
            UiTransform::default(),
            ChildOf(ring),
        ))
        .id();
    let xh_ring = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, left: Val::Px(21.0), top: Val::Px(21.0), width: Val::Px(6.0), height: Val::Px(6.0), border_radius: BorderRadius::MAX, ..default() },
            BoxShadow::new(Color::srgba(0.59, 0.86, 1.0, 0.9), Val::Px(0.0), Val::Px(0.0), Val::Px(1.0), Val::Px(6.0)),
            Visibility::Hidden,
            ChildOf(xh),
        ))
        .id();
    let xh_dot = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, left: Val::Px(22.2), top: Val::Px(22.2), width: Val::Px(3.6), height: Val::Px(3.6), border_radius: BorderRadius::MAX, ..default() },
            BackgroundColor(Color::WHITE),
            BoxShadow::new(Color::srgba(0.0, 0.0, 0.0, 0.6), Val::Px(0.0), Val::Px(0.0), Val::Px(0.8), Val::Px(0.0)),
            ChildOf(xh),
        ))
        .id();
    // câmara (em cima à esquerda)
    let lvl = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, left: Val::Px(40.0), top: Val::Px(36.0), padding: UiRect::left(Val::Px(17.0)), border: UiRect::left(Val::Px(1.0)), flex_direction: FlexDirection::Column, row_gap: Val::Px(4.0), ..default() },
            BorderColor::all(BLUE),
            ChildOf(root),
        ))
        .id();
    let lvl_num = ecs.spawn((Text::new(""), label(&fonts.mono, 11.0, BLUE, 0.3), shadow(), ChildOf(lvl))).id();
    let (f, c) = txt(&fonts.display, 26.0, INK);
    let lvl_name = ecs.spawn((Text::new(""), f.with_font_weight(FontWeight(300)), c, LetterSpacing::Px(0.5), shadow(), ChildOf(lvl))).id();
    let lvl_goal = ecs.spawn((Text::new(""), txt(&fonts.ui, 13.0, DIM), shadow(), ChildOf(lvl))).id();
    let tbox = ecs
        .spawn((Node { position_type: PositionType::Absolute, right: Val::Px(40.0), top: Val::Px(36.0), flex_direction: FlexDirection::Column, align_items: AlignItems::End, row_gap: Val::Px(4.0), ..default() }, ChildOf(root)))
        .id();
    ecs.spawn((Text::new("TEMPO"), label(&fonts.mono, 11.0, Color::srgba(0.957, 0.969, 0.98, 0.6), 0.3), shadow(), ChildOf(tbox)));
    let timer = ecs.spawn((Text::new("0:00"), txt(&fonts.mono, 22.0, INK), shadow(), ChildOf(tbox))).id();
    // medidores: campo e vida empilhados à esquerda, tempo lento à direita (rótulo + valor sobre um fio de 2 px)
    let left_col = ecs
        .spawn((Node { position_type: PositionType::Absolute, left: Val::Px(40.0), bottom: Val::Px(40.0), width: Val::Px(240.0), flex_direction: FlexDirection::Column, row_gap: Val::Px(14.0), ..default() }, ChildOf(root)))
        .id();
    let gauge = |ecs: &mut Ecs, parent: Option<Entity>, w: f32, name: &str, value: &str, c: Color| {
        let node = match parent {
            Some(_) => Node { width: Val::Px(w), flex_direction: FlexDirection::Column, row_gap: Val::Px(6.0), ..default() },
            None => Node { position_type: PositionType::Absolute, right: Val::Px(40.0), bottom: Val::Px(40.0), width: Val::Px(w), flex_direction: FlexDirection::Column, row_gap: Val::Px(6.0), ..default() },
        };
        let g = ecs.spawn((node, ChildOf(parent.unwrap_or(root)))).id();
        let row = ecs.spawn((Node { justify_content: JustifyContent::SpaceBetween, ..default() }, ChildOf(g))).id();
        let l = ecs.spawn((Text::new(name), label(&fonts.mono, 11.0, c, 0.24), shadow(), ChildOf(row))).id();
        let v = ecs.spawn((Text::new(value), label(&fonts.mono, 11.0, c, 0.08), shadow(), ChildOf(row))).id();
        let bar = ecs
            .spawn((Node { height: Val::Px(2.0), width: Val::Percent(100.0), overflow: Overflow::clip(), ..default() }, BackgroundColor(Color::srgba(1.0, 1.0, 1.0, 0.18)), ChildOf(g)))
            .id();
        let fill = ecs.spawn((Node { height: Val::Percent(100.0), width: Val::Percent(100.0), ..default() }, BackgroundColor(INK), ChildOf(bar))).id();
        (g, l, v, fill)
    };
    let violet = Color::srgb(0.77, 0.66, 1.0);
    let (field, _, field_v, field_fill) = gauge(ecs, Some(left_col), 240.0, "CAMPO TEMPORAL", "0%", violet);
    ecs.entity_mut(field_fill).insert(BackgroundColor(Color::srgb(0.71, 0.55, 1.0)));
    let (health, _, _, health_bar) = gauge(ecs, Some(left_col), 240.0, "VIDA", "", DIM);
    // relógio do tempo (série Experimento): estado, Δ ou tempo do mundo, barra, dica e extras
    let (clock, clock_l, clock_v, clock_fill) = gauge(ecs, Some(left_col), 240.0, "TEMPO NORMAL", "0:00", DIM);
    ecs.entity_mut(clock_fill).insert(BackgroundColor(BLUE));
    let clock_hint = ecs.spawn((Text::new("2 — parar o tempo"), label(&fonts.mono, 10.0, DIM, 0.06), shadow(), ChildOf(clock))).id();
    let clock_extra = ecs.spawn((Text::new(""), label(&fonts.mono, 10.0, Color::srgb(1.0, 0.81, 0.56), 0.06), shadow(), ChildOf(clock))).id();
    for e in [field, health, clock] {
        if let Some(mut n) = ecs.get_mut::<Node>(e) {
            n.display = Display::None;
        }
    }
    // paradoxo: letreiro grande no meio da tela
    let paradox = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, top: Val::Percent(30.0), width: Val::Percent(100.0), flex_direction: FlexDirection::Column, align_items: AlignItems::Center, row_gap: Val::Px(6.0), ..default() },
            Visibility::Hidden,
            ChildOf(root),
        ))
        .id();
    let (pf, pc) = txt(&fonts.display, 74.0, Color::WHITE);
    let paradox_t = ecs.spawn((Text::new("PARADOXO"), pf, pc, LetterSpacing::Px(74.0 * 0.12), TextShadow { offset: Vec2::ZERO, color: Color::srgb(1.0, 0.16, 0.42) }, ChildOf(paradox))).id();
    let paradox_why = ecs.spawn((Text::new(""), txt(&fonts.ui, 18.0, Color::srgb(1.0, 0.69, 0.78)), shadow(), ChildOf(paradox))).id();
    // ao chegar na saída: o resto da linha do tempo roda adiantado (tela de carregamento)
    let verify = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, width: Val::Percent(100.0), height: Val::Percent(100.0), justify_content: JustifyContent::Center, align_items: AlignItems::Center, ..default() },
            BackgroundColor(Color::srgba(0.03, 0.03, 0.06, 0.97)),
            Visibility::Hidden,
            ChildOf(root),
        ))
        .id();
    let vb = ecs.spawn((Node { flex_direction: FlexDirection::Column, row_gap: Val::Px(10.0), width: Val::Px(420.0), ..default() }, ChildOf(verify))).id();
    let vrow = ecs.spawn((Node { justify_content: JustifyContent::SpaceBetween, ..default() }, ChildOf(vb))).id();
    ecs.spawn((Text::new("VERIFICANDO A LINHA DO TEMPO…"), label(&fonts.mono, 12.0, Color::srgb(0.77, 0.66, 1.0), 0.24), ChildOf(vrow)));
    let verify_v = ecs.spawn((Text::new("0%"), label(&fonts.mono, 12.0, Color::srgb(0.77, 0.66, 1.0), 0.0), ChildOf(vrow))).id();
    let vbar = ecs.spawn((Node { height: Val::Px(2.0), width: Val::Percent(100.0), overflow: Overflow::clip(), ..default() }, BackgroundColor(Color::srgba(1.0, 1.0, 1.0, 0.18)), ChildOf(vb))).id();
    let verify_fill = ecs.spawn((Node { height: Val::Percent(100.0), width: Val::Percent(0.0), ..default() }, BackgroundColor(Color::srgb(0.71, 0.55, 1.0)), ChildOf(vbar))).id();
    ecs.spawn((Text::new("o seu passado ainda está agindo: o resto da história roda adiantado antes de sair"), txt(&fonts.ui, 13.0, MUTED), ChildOf(vb)));
    let _ = paradox_t;
    let (slow, slow_l, slow_v, slow_fill) = gauge(ecs, None, 200.0, "TEMPO LENTO", "6,0 s", DIM);
    // época (viagem no tempo)
    let era = ecs
        .spawn((Node { position_type: PositionType::Absolute, right: Val::Px(40.0), top: Val::Px(200.0), flex_direction: FlexDirection::Column, align_items: AlignItems::End, ..default() }, ChildOf(root)))
        .id();
    ecs.spawn((Text::new("ÉPOCA"), label(&fonts.mono, 11.0, DIM, 0.24), shadow(), ChildOf(era)));
    let (ef, ec) = txt(&fonts.display, 26.0, Color::srgb(0.5, 0.89, 0.77));
    let era_v = ecs.spawn((Text::new("PASSADO"), ef.with_font_weight(FontWeight(300)), ec, shadow(), ChildOf(era))).id();
    ecs.spawn((Text::new("T — viajar no tempo"), txt(&fonts.ui, 11.0, DIM), shadow(), ChildOf(era)));
    display(ecs, era, false);
    // temperatura do ar (fases quentes)
    let heat = ecs
        .spawn((Node { position_type: PositionType::Absolute, right: Val::Px(40.0), top: Val::Px(150.0), flex_direction: FlexDirection::Column, align_items: AlignItems::End, ..default() }, ChildOf(root)))
        .id();
    ecs.spawn((Text::new("TEMPERATURA DO AR"), label(&fonts.mono, 11.0, DIM, 0.24), shadow(), ChildOf(heat)));
    let (hf, hc) = txt(&fonts.display, 22.0, Color::srgb(1.0, 0.48, 0.23));
    let heat_v = ecs.spawn((Text::new("38 °C"), hf.with_font_weight(FontWeight(300)), hc, shadow(), ChildOf(heat))).id();
    display(ecs, heat, false);
    // cristais (mapa livre)
    let gems = ecs
        .spawn((Node { position_type: PositionType::Absolute, left: Val::Px(40.0), top: Val::Px(120.0), flex_direction: FlexDirection::Column, ..default() }, ChildOf(root)))
        .id();
    ecs.spawn((Text::new("CRISTAIS"), label(&fonts.mono, 11.0, DIM, 0.24), shadow(), ChildOf(gems)));
    let (gf, gc) = txt(&fonts.display, 26.0, Color::srgb(1.0, 0.56, 0.78));
    let gems_v = ecs.spawn((Text::new("0/12"), gf.with_font_weight(FontWeight(300)), gc, shadow(), ChildOf(gems))).id();
    display(ecs, gems, false);
    // o túnel até o outro lado do mundo: velocidade, gravidade, distância do centro
    let tube = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, right: Val::Px(40.0), top: Val::Percent(50.0), margin: UiRect::top(Val::Px(-120.0)), flex_direction: FlexDirection::Column, row_gap: Val::Px(10.0), padding: UiRect::axes(Val::Px(18.0), Val::Px(14.0)), min_width: Val::Px(200.0), border: UiRect::all(Val::Px(1.0)), ..default() },
            BackgroundColor(Color::srgba(0.03, 0.04, 0.055, 0.6)),
            BorderColor::all(Color::srgba(1.0, 1.0, 1.0, 0.12)),
            ChildOf(root),
        ))
        .id();
    let mut tube_v = [Entity::PLACEHOLDER; 3];
    for (k, (name, unit)) in [("VELOCIDADE", "km/h"), ("GRAVIDADE AQUI", "m/s²"), ("DISTÂNCIA DO CENTRO", "m")].into_iter().enumerate() {
        let row = ecs.spawn((Node { flex_direction: FlexDirection::Column, ..default() }, ChildOf(tube))).id();
        ecs.spawn((Text::new(name), label(&fonts.mono, 11.0, DIM, 0.24), ChildOf(row)));
        let (vf, vc) = txt(&fonts.display, 30.0, Color::WHITE);
        tube_v[k] = ecs.spawn((Text::new("0"), vf.with_font_weight(FontWeight(300)), vc, ChildOf(row))).id();
        ecs.spawn((Text::new(unit), txt(&fonts.ui, 11.0, MUTED), ChildOf(row)));
    }
    let tube_phase = ecs.spawn((Text::new(""), txt(&fonts.ui, 13.0, Color::srgb(0.62, 0.85, 1.0)), ChildOf(tube))).id();
    display(ecs, tube, false);
    ecs.entity_mut(slow_fill).insert(BackgroundColor(Color::srgb(0.62, 0.86, 1.0)));
    // aviso rápido (em cima, no meio)
    let toast = ecs
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(70.0),
                width: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                ..default()
            },
            Visibility::Hidden,
            ChildOf(root),
        ))
        .id();
    let pill = ecs
        .spawn((
            Node { padding: UiRect::axes(Val::Px(16.0), Val::Px(8.0)), border: UiRect::all(Val::Px(1.0)), ..default() },
            BackgroundColor(Color::srgba(0.03, 0.04, 0.055, 0.82)),
            BorderColor::all(Color::srgba(1.0, 1.0, 1.0, 0.14)),
            ChildOf(toast),
        ))
        .id();
    let toast_text = ecs.spawn((Text::new(""), txt(&fonts.ui, 13.0, Color::srgb(0.933, 0.949, 0.973)), ChildOf(pill))).id();
    // legendas (embaixo, no meio)
    let subs = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, bottom: Val::Px(96.0), width: Val::Percent(100.0), flex_direction: FlexDirection::Column, align_items: AlignItems::Center, row_gap: Val::Px(6.0), ..default() },
            Visibility::Hidden,
            ChildOf(root),
        ))
        .id();
    let subs_who = ecs.spawn((Text::new(""), label(&fonts.mono, 11.0, BLUE, 0.3), shadow(), ChildOf(subs))).id();
    let subs_text = ecs
        .spawn((
            Node { max_width: Val::Px(700.0), ..default() },
            Text::new(""),
            txt(&fonts.ui, 20.0, Color::srgb(0.933, 0.949, 0.973)),
            TextLayout::justify(Justify::Center),
            TextShadow { offset: Vec2::new(0.0, 2.0), color: Color::BLACK },
            ChildOf(subs),
        ))
        .id();
    // dica de uso (embaixo da mira)
    let use_hint = ecs
        .spawn((
            Node { position_type: PositionType::Absolute, top: Val::Percent(50.0), width: Val::Percent(100.0), justify_content: JustifyContent::Center, margin: UiRect::top(Val::Px(46.0)), ..default() },
            Visibility::Hidden,
            ChildOf(root),
        ))
        .id();
    let uh = ecs
        .spawn((Node { padding: UiRect::axes(Val::Px(10.0), Val::Px(4.0)), ..default() }, BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.5)), ChildOf(use_hint)))
        .id();
    ecs.spawn((Text::new("E — pegar a amostra"), txt(&fonts.mono, 13.0, Color::WHITE), ChildOf(uh)));
    // teclas (embaixo)
    let keys = ecs
        .spawn((Node { position_type: PositionType::Absolute, bottom: Val::Px(12.0), width: Val::Percent(100.0), justify_content: JustifyContent::Center, ..default() }, ChildOf(root)))
        .id();
    let keys_text = ecs
        .spawn((
        Text::new("Esquerdo/Q: portal ciano · Direito/F: portal vermelho · Setas: olhar · Meio/G: tempo lento · Rodinha/Z/X: zoom · E: pegar/soltar · Esquerdo/Q segurando: arremessar · Espaço: pular · R: reiniciar · Enter: jogar · Esc: pausa"),
        label(&fonts.mono, 10.0, Color::srgba(0.957, 0.969, 0.98, 0.4), 0.04),
        TextLayout::no_wrap(),
        ChildOf(keys),
    ))
        .id();
    ecs.insert_resource(Hud {
        root,
        hurt,
        flash,
        fade,
        xh,
        xh_dash,
        xh_solid,
        xh_key: u32::MAX,
        keys_text,
        keys_relogio: None,
        ring,
        ring_bg,
        ring_arc,
        ring_pulse,
        ring_shown: usize::MAX,
        ring_low: false,
        ring_on: false,
        ring_t: 9.0,
        xh_dot,
        xh_ring,
        lvl_num,
        lvl_name,
        lvl_goal,
        timer,
        health,
        health_bar,
        field,
        field_v,
        field_fill,
        era,
        era_v,
        heat,
        heat_v,
        gems,
        gems_v,
        tube,
        tube_v,
        tube_phase,
        clock,
        clock_l,
        clock_v,
        clock_fill,
        clock_hint,
        clock_extra,
        paradox,
        paradox_why,
        verify,
        verify_v,
        verify_fill,
        slow,
        slow_l,
        slow_v,
        slow_fill,
        toast,
        toast_text,
        subs,
        subs_who,
        subs_text,
        zoom,
        zoom_text,
        use_hint,
        fonts,
        level: None,
        toast_t: 0.0,
        sub_t: 0.0,
        aim_clock: 0.0,
        aim: None,
    });
}

fn set_text(ecs: &mut Ecs, e: Entity, s: &str) {
    if let Some(mut t) = ecs.get_mut::<Text>(e) {
        if t.0 != s {
            t.0 = s.to_string();
        }
    }
}

/// some do layout (não ocupa lugar na coluna)
fn display(ecs: &mut Ecs, e: Entity, on: bool) {
    if let Some(mut n) = ecs.get_mut::<Node>(e) {
        let d = if on { Display::Flex } else { Display::None };
        if n.display != d {
            n.display = d;
        }
    }
}

fn fill(ecs: &mut Ecs, e: Entity, k: f32) {
    if let Some(mut n) = ecs.get_mut::<Node>(e) {
        n.width = Val::Percent(k.clamp(0.0, 1.0) * 100.0);
    }
}

fn show(ecs: &mut Ecs, e: Entity, on: bool) {
    let v = if on { Visibility::Inherited } else { Visibility::Hidden };
    if ecs.get::<Visibility>(e) != Some(&v) {
        ecs.entity_mut(e).insert(v);
    }
}

impl Hud {
    pub fn root(&self) -> Entity {
        self.root
    }
}

/// a etiqueta da câmara (levelLabel de main.js)
pub fn level_label(l: &crate::levels::LevelDef) -> String {
    use crate::i18n::{tl, tlv};
    if l.free {
        return tl("Mapa livre");
    }
    let code = l.code.clone().unwrap_or_default();
    let c = || vec![("c", code.clone())];
    match l.series.as_deref() {
        Some("campaign") => {
            let n = &l.name;
            if n == "Fuga 3 · o final" {
                tl(n)
            } else if let Some(k) = n.strip_prefix("Fuga ") {
                tlv("Fuga {n}", &[("n", k.to_string())])
            } else if n.starts_with("Câmaras ") {
                tlv("Câmaras {c}", &c())
            } else {
                tlv("Câmara {c}", &c())
            }
        }
        Some("hard") => tlv("Desafio {c}", &c()),
        Some("momentum") => tlv("Momento {c}", &c()),
        Some("boss") => tlv("Chefe {c}", &c()),
        Some("experiment") => tlv("Experimento {c}", &c()),
        _ if !code.is_empty() => tlv("Teste {c}", &c()),
        _ => tlv("Câmara {n}", &[("n", format!("{:02}", l.id))]),
    }
}

pub fn fmt_time(s: f32) -> String {
    format!("{}:{:02}", (s / 60.0).floor() as i32, (s % 60.0).floor() as i32)
}

pub fn update_hud(ecs: &mut Ecs) {
    if !ecs.contains_resource::<Hud>() {
        setup_hud(ecs);
        if !ecs.contains_resource::<Hud>() {
            return;
        }
    }
    let dt = ecs.resource::<Time>().delta_secs().min(0.05);
    ecs.resource_scope(|ecs, mut hud: Mut<Hud>| {
        let hud = &mut *hud;
        // o que o HUD precisa do jogo (cópias: o mundo do Bevy fica livre)
        let era = {
            let g = ecs.resource::<Game>();
            g.data.get("timeTravel").and_then(|v| v.as_bool()).unwrap_or(false).then(|| {
                let past = g.world.era == "past";
                let names = g.data.get("eraNames").and_then(|v| v.as_array());
                let n = |i: usize, d: &str| names.and_then(|a| a.get(i)).and_then(|v| v.as_str()).unwrap_or(d).to_string();
                (if past { n(0, "PASSADO") } else { n(1, "FUTURO") }, past)
            })
        };
        display(ecs, hud.era, era.is_some());
        // temperatura do ar, cristais e o túnel
        let (heat, gems, tube) = {
            let g = ecs.resource::<Game>();
            let heat = g.level.and_then(|i| g.levels.get(i)).is_some_and(|l| l.heat).then(|| format!("{} °C", (38.0 + g.level_time.min(300.0) * 0.06).round() as i32));
            let gems = g.gems.map(|(n, of)| format!("{n}/{of}"));
            let tube = g.in_tube.then(|| {
                let center = g.data.get("tube").and_then(|t| t.get("center")).and_then(|v| v.as_f64()).unwrap_or(-80.0) as f32;
                let p = g.player.pos;
                let gy = g.gravity().at(p).y.abs();
                let int = |x: f32| thousands(x.round() as i64);
                ([int(g.player.vel.length() * 3.6), crate::i18n::num(gy, 1), int((p.y - center).abs())], if p.y > center { "caindo para o centro ↓" } else { "subindo para o outro lado ↑" })
            });
            (heat, gems, tube)
        };
        display(ecs, hud.heat, heat.is_some());
        if let Some(h) = heat {
            set_text(ecs, hud.heat_v, &h);
        }
        display(ecs, hud.gems, gems.is_some());
        if let Some(gm) = gems {
            set_text(ecs, hud.gems_v, &gm);
        }
        display(ecs, hud.tube, tube.is_some());
        if let Some((vals, phase)) = tube {
            for k in 0..3 {
                set_text(ecs, hud.tube_v[k], &vals[k]);
            }
            set_text(ecs, hud.tube_phase, phase);
        }
        if let Some((name, past)) = era {
            set_text(ecs, hud.era_v, &name);
            ecs.entity_mut(hud.era_v).insert(TextColor(if past { Color::srgb(0.5, 0.89, 0.77) } else { Color::srgb(1.0, 0.69, 0.44) }));
        }
        // relógio do tempo
        let clock = {
            let g = ecs.resource::<Game>();
            g.relogio.as_ref().map(|c| {
                let blocked = c.paused && c.blocked && g.portals.list[1].placed && g.portals.list[1].delta > 0.0;
                let verify = g.verify.map(|(until, from, _, _)| ((c.tw - from) / (until - from).max(1e-3)).clamp(0.0, 1.0));
                (c.paused, c.sweep.is_some(), c.delta, c.max_delta(), c.tw, c.live_clones(), c.paradoxes, blocked, c.paradox_why.clone(), verify)
            })
        };
        display(ecs, hud.clock, clock.is_some());
        let mut verify_k = None;
        let mut why = None;
        if let Some((paused, sweep, delta, max, tw, clones, paradoxes, blocked, pw, vk)) = clock {
            verify_k = vk;
            why = pw;
            set_text(ecs, hud.clock_l, if paused { "TEMPO PARADO" } else if sweep { "SALTANDO NO TEMPO" } else { "TEMPO NORMAL" });
            set_text(ecs, hud.clock_v, &if paused { format!("−{} s", crate::world::fmt_num(delta)) } else { fmt_time(tw) });
            fill(ecs, hud.clock_fill, if paused { delta / max.max(0.5) } else { 0.0 });
            set_text(ecs, hud.clock_hint, if paused { "roda do mouse: voltar mais/menos · vermelho = passado · ciano = presente · 2: continuar" } else { "2 — parar o tempo" });
            let mut extra = vec![];
            if clones > 0 {
                extra.push(if clones > 1 { format!("{clones} clones do passado") } else { format!("{clones} clone do passado") });
            }
            if paradoxes > 0 {
                extra.push(if paradoxes > 1 { format!("{paradoxes} paradoxos") } else { format!("{paradoxes} paradoxo") });
            }
            if blocked {
                extra.push("⚠ destino ocupado".into());
            }
            set_text(ecs, hud.clock_extra, &extra.join(" · "));
            let c = if paused { BLUE } else if blocked { Color::srgb(1.0, 0.48, 0.42) } else { DIM };
            for e in [hud.clock_l, hud.clock_v] {
                ecs.entity_mut(e).insert(TextColor(c));
            }
        }
        show(ecs, hud.paradox, why.is_some());
        if let Some((w, _)) = &why {
            set_text(ecs, hud.paradox_why, w);
        }
        show(ecs, hud.verify, verify_k.is_some());
        if let Some(k) = verify_k {
            set_text(ecs, hud.verify_v, &format!("{}%", (k * 100.0).floor() as i32));
            fill(ecs, hud.verify_fill, k);
        }
        let (slow, field) = {
            let g = ecs.resource::<Game>();
            (g.slow.clone(), (g.field.charge / g.field.need, g.field.own().map(|f| (f.left, g.field.life, g.field.rate))))
        };
        let (level, label, name, goal, time, health, show_health, hurt, dead, gun_mode, placed, zoom, toast, held, aim_ok, can_use) = {
            let mut g = ecs.resource_mut::<Game>();
            let lv = g.level;
            let (label, name, goal) = lv.map(|i| (level_label(&g.levels[i]), g.levels[i].name.clone(), g.levels[i].lesson.clone())).unwrap_or_default();
            let show_health = g.props.list.iter().any(|p| p.turret.is_some()) || g.world.lasers.iter().any(|l| l.bridge.is_none()) || g.boss.is_some();
            let toast = g.toasts.pop().map(|t| t.0);
            g.toasts.clear();
            g.subs.clear();
            // a mira diz se a superfície aceita portal (~10 vezes por segundo)
            hud.aim_clock -= dt;
            let mut aim = hud.aim;
            if hud.aim_clock <= 0.0 {
                hud.aim_clock = 0.1;
                aim = g.aim_ok();
            }
            // dica de uso: um cubo na mira, perto
            let o = g.cam.translation;
            let d = g.cam_forward();
            let can_use = g.held.is_none() && g.props.ray(o, d, 2.8).is_some_and(|(_, t)| g.world.raycast(o, d, t).is_none());
            let zk = if g.zoom.0 { Some(g.zoom.2) } else { None };
            (lv, label, name, goal, g.level_time, g.health, show_health, g.hurt_flash, g.dead_flash, g.gun_mode.clone(), [g.portals.list[0].placed, g.portals.list[1].placed], zk, toast, g.held.is_some(), aim, can_use)
        };
        hud.aim = aim_ok;
        // legenda: a fala que a narração está tocando
        let sub = ecs.get_non_send::<crate::audio::Audio>().and_then(|a| a.dialog.showing.clone().or_else(|| a.camp.showing.clone()));
        let _ = held;
        if level != hud.level {
            hud.level = level;
            set_text(ecs, hud.lvl_num, &label.to_uppercase());
            set_text(ecs, hud.lvl_name, &name);
            set_text(ecs, hud.lvl_goal, &goal);
        }
        set_text(ecs, hud.timer, &fmt_time(time));
        // vida
        display(ecs, hud.health, show_health);
        // campo de dilatação: a carga ou o tempo que resta do seu campo
        let (k, own) = field;
        display(ecs, hud.field, k > 0.0 || own.is_some());
        match own {
            Some((left, life, rate)) => {
                set_text(ecs, hud.field_v, &format!("{} s", crate::i18n::num(left / rate as f32, 1)));
                fill(ecs, hud.field_fill, left / life);
            }
            None => {
                set_text(ecs, hud.field_v, &format!("{}%", (k * 100.0).round() as i32));
                fill(ecs, hud.field_fill, k);
            }
        }
        // tempo lento: cheio fica apagado; ligado acende em azul; pouco, vermelho
        let f = slow.left / slow.max;
        fill(ecs, hud.slow_fill, f);
        set_text(ecs, hud.slow_v, &format!("{} s", crate::i18n::num(slow.left, 1)));
        let c = if slow.on { Color::srgb(0.62, 0.86, 1.0) } else { DIM };
        for e in [hud.slow_l, hud.slow_v] {
            ecs.entity_mut(e).insert(TextColor(c));
        }
        ecs.entity_mut(hud.slow_fill).insert(BackgroundColor(if f < 0.25 { Color::srgb(1.0, 0.23, 0.19) } else { Color::srgb(0.62, 0.86, 1.0) }));
        // as teclas mudam nas fases com o relógio do tempo (como na versão web)
        let rel = ecs.resource::<Game>().relogio.is_some();
        if hud.keys_relogio != Some(rel) {
            hud.keys_relogio = Some(rel);
            let t = if rel {
                "Esquerdo/Q: portal ciano · Direito/F: portal vermelho (parado: no passado) · Setas: olhar · 2: parar/continuar o tempo · Rodinha/Z/X parado: voltar mais/menos · Meio/G: tempo lento · E: pegar/soltar · Espaço: pular · R: reiniciar · Enter: jogar · Esc: pausa"
            } else {
                "Esquerdo/Q: portal ciano · Direito/F: portal vermelho · Setas: olhar · Meio/G: tempo lento · Rodinha/Z/X: zoom · E: pegar/soltar · Esquerdo/Q segurando: arremessar · Espaço: pular · R: reiniciar · Enter: jogar · Esc: pausa"
            };
            set_text(ecs, hud.keys_text, t);
        }
        // anel em volta da mira (só com o tempo lento ligado): o arco gasta junto com a reserva
        show(ecs, hud.ring, slow.on);
        if slow.on {
            let n = hud.ring_arc.len();
            let lit = ((f * n as f32).ceil() as usize).min(n);
            let low = f < 0.25;
            if hud.ring_shown != lit || hud.ring_low != low {
                let col = if low { Color::srgb(1.0, 0.416, 0.29) } else { Color::srgb(0.498, 0.831, 1.0) };
                for (k, &e) in hud.ring_arc.clone().iter().enumerate() {
                    ecs.entity_mut(e).insert((BackgroundColor(col), if k < lit { Visibility::Inherited } else { Visibility::Hidden }));
                }
                hud.ring_shown = lit;
                hud.ring_low = low;
            }
        }
        // pulso ao ligar ou desligar: um anel que cresce e some em 0,55 s
        if slow.on != hud.ring_on {
            hud.ring_on = slow.on;
            hud.ring_t = 0.0;
        }
        hud.ring_t += dt;
        let pk = (hud.ring_t / 0.55).min(1.0);
        let ease = 1.0 - (1.0 - pk) * (1.0 - pk);
        let sc = 0.6 + (4.5 - 0.6) * ease;
        ecs.entity_mut(hud.ring_pulse).insert((
            UiTransform { scale: Vec2::splat(sc), ..default() },
            BorderColor::all(if pk < 1.0 { Color::srgba(0.624, 0.863, 1.0, 0.9 * (1.0 - pk)) } else { Color::NONE }),
        ));
        let full = f >= 0.999 && !slow.on;
        let _ = hud.slow;
        let a = if full { 0.6 } else { 1.0 };
        for e in [hud.slow_l, hud.slow_v] {
            if let Some(mut tc) = ecs.get_mut::<TextColor>(e) {
                tc.0 = tc.0.with_alpha(tc.0.alpha() * a);
            }
        }
        if let Some(mut n) = ecs.get_mut::<Node>(hud.health_bar) {
            n.width = Val::Percent(health.clamp(0.0, 100.0));
        }
        let low = health < 35.0;
        ecs.entity_mut(hud.health_bar).insert(BackgroundColor(if low { Color::srgb(1.0, 0.23, 0.19) } else { INK }));
        // dano e morte
        set_alpha_gradient(ecs, hud.hurt, hurt);
        ecs.entity_mut(hud.flash).insert(BackgroundColor(Color::srgba(0.63, 0.08, 0.0, css_dark(0.85 * dead))));
        let cf = ecs.resource::<Game>().camp_fade.map(|f| (f.color, f.alpha().0));
        ecs.entity_mut(hud.fade).insert(BackgroundColor(match cf {
            Some((c, a)) => Color::srgba(c.x, c.y, c.z, a),
            None => Color::NONE,
        }));
        // mira: tracinhos fracos = portal não colocado; arco cheio = colocado
        let none = gun_mode == "none";
        let fade = if aim_ok == Some(false) { 0.4 } else { 1.0 };
        let key = (placed[0] as u32) | ((placed[1] as u32) << 1) | ((none as u32) << 2) | (((gun_mode == "blue") as u32) << 3) | (((aim_ok == Some(false)) as u32) << 4);
        if hud.xh_key != key {
            hud.xh_key = key;
            for side in 0..2 {
                let on = !none && !(side == 1 && gun_mode == "blue");
                let col = if side == 0 { BLUE } else { ORANGE };
                for (set, shown, a) in [(&hud.xh_dash[side], on && !placed[side], 0.55 * fade), (&hud.xh_solid[side], on && placed[side], fade)] {
                    for &e in set {
                        ecs.entity_mut(e).insert((BackgroundColor(col.with_alpha(a)), if shown { Visibility::Inherited } else { Visibility::Hidden }));
                    }
                }
            }
        }
        show(ecs, hud.xh_ring, aim_ok == Some(true) && !none);
        ecs.entity_mut(hud.xh_dot).insert(BackgroundColor(if aim_ok == Some(false) { Color::srgb(1.0, 0.35, 0.29) } else { Color::WHITE }));
        // zoom
        show(ecs, hud.zoom, zoom.is_some());
        if let Some(z) = zoom {
            set_text(ecs, hud.zoom_text, &format!("{}×", crate::i18n::num(z, 1)));
        }
        // aviso rápido
        if let Some(t) = toast {
            set_text(ecs, hud.toast_text, &t);
            hud.toast_t = 2.6;
        }
        hud.toast_t -= dt;
        show(ecs, hud.toast, hud.toast_t > 0.0);
        // legendas
        if let Some((who, line)) = &sub {
            set_text(ecs, hud.subs_who, &who.to_uppercase());
            set_text(ecs, hud.subs_text, line);
        }
        show(ecs, hud.subs, sub.is_some());
        show(ecs, hud.use_hint, can_use && !none);
        let _ = (&hud.fonts, hud.xh, hud.root);
    });
}

/// a opacidade de uma camada com degradê (o dano)
fn set_alpha_gradient(ecs: &mut Ecs, e: Entity, a: f32) {
    let g = Gradient::Radial(RadialGradient::new(
        UiPosition::CENTER,
        RadialGradientShape::FarthestCorner,
        vec![ColorStop::new(Color::srgba(0.86, 0.08, 0.08, 0.0), Val::Percent(40.0 * SQRT2)), ColorStop::new(Color::srgba(0.86, 0.08, 0.08, css_dark(0.75 * a)), Val::Percent(100.0 * SQRT2))],
    ));
    ecs.entity_mut(e).insert(BackgroundGradient(vec![g]));
    let _ = FontWeight::BOLD;
}

/// inteiro com separador de milhar (pt-BR: 12.345)
fn thousands(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(if crate::i18n::is_en() { ',' } else { '.' });
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}
