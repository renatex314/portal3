//! Jogo de portais (versão nativa em Rust + Bevy). Veja PLANO.md.

pub mod characters;
pub mod chefe;
pub mod dissolver;
pub mod editor;
pub mod energy;
pub mod achados;
pub mod campaign;
pub mod ambiente;
pub mod audio;
pub mod env;
pub mod frontier;
pub mod fx;
pub mod game;
pub mod geo;
pub mod glb;
pub mod gun;
pub mod hud;
pub mod i18n;
pub mod input;
pub mod lava;
pub mod levels;
pub mod mats;
pub mod menu;
pub mod mp;
pub mod net;
pub mod physics;
pub mod player;
pub mod portal_render;
pub mod portals;
pub mod post;
pub mod props;
pub mod relogio;
pub mod raster;
pub mod shots;
pub mod signs;
pub mod turrets;
pub mod world;

use bevy::camera::RenderTarget;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::light::GeneratedEnvironmentMapLight;
use bevy::post_process::bloom::Bloom;
use bevy::prelude::*;
use bevy::camera::Hdr;

/// a câmera principal (a do jogador)
#[derive(Component)]
pub struct MainCam;

/// o mapa de ambiente (as câmeras dos portais usam o mesmo)
#[derive(Resource, Clone)]
pub struct EnvMap(pub Handle<Image>);

/// quando existe: a câmera principal desenha nesta imagem (testes sem janela)
#[derive(Resource, Clone)]
pub struct HeadlessTarget(pub Handle<Image>);

pub struct GamePlugin;

impl Plugin for GamePlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins((MaterialPlugin::<fx::Fx>::default(), MaterialPlugin::<lava::LavaMat>::default(), post::PostPlugin))
            .insert_resource(ClearColor(mats::hex(0x101216)))
            // (a luz ambiente vem do mapa de ambiente; a global padrão do Bevy estouraria a imagem)
            .insert_resource(bevy::light::GlobalAmbientLight { brightness: 0.0, ..default() })
            .init_resource::<glb::Models>()
            .init_resource::<lava::LavaShared>()
            .init_resource::<mats::SmallTex>()
            .init_resource::<fx::FxClock>()
            .init_resource::<input::Controls>()
            .add_systems(Startup, (setup_assets, setup_camera, game::setup_game).chain())
            .add_systems(Update, (game::tick, editor::input::editor_tick, characters::update_characters, portal_render::update_portal_views, gun::update_gun, audio::audio_tick, hud::update_hud, menu::menu_system, fx::tick_fx, editor::panel::attach_context).chain())
            .add_systems(Update, editor::input::draw_gizmos.after(editor::input::editor_tick))
            .add_systems(PostUpdate, (gun::light_layers, i18n::translate_texts));
        // editor de níveis: a interface em egui (o contexto só existe enquanto ele está aberto) e os contornos em gizmos
        app.add_plugins(bevy_egui::EguiPlugin::default())
            .insert_resource(bevy_egui::EguiGlobalSettings { auto_create_primary_context: false, ..default() })
            .init_resource::<editor::input::EdDraw>()
            .init_resource::<editor::input::UiFlags>()
            .init_gizmo_group::<editor::input::EdGizmos>()
            .add_systems(Startup, editor::input::setup_gizmos)
            .add_systems(bevy_egui::EguiPrimaryContextPass, editor::panel::editor_ui);
    }
}

fn setup_assets(mut commands: Commands, mut images: ResMut<Assets<Image>>, mut materials: ResMut<Assets<StandardMaterial>>) {
    let m = mats::build_mats(&mut images, &mut materials);
    commands.insert_resource(m);
}

/// exposição equivalente à da versão web: ACES com toneMappingExposure 1,1 (o three.js divide
/// por 0,6 antes do ACES) → multiplicador 1,833 em TODOS os pixels (inclusive os sem luz). No
/// Bevy a exposição da câmera só vale para a luz, então ela fica em 1 (EV100 = log2(1/1,2)) e o
/// multiplicador entra na correção de cor, que é aplicada à imagem toda antes do ACES.
pub const EV100: f32 = -0.263;
pub const GRADE_EV: f32 = 0.8745; // log2(1,1 / 0,6)

/// o brilho da versão web (UnrealBloomPass: força 0,45, raio 0,4, limiar de luminância 1,6):
/// só o que passa do limiar brilha, somado por cima (PORTAL3_BLOOM ajusta a força)
pub fn bloom() -> Bloom {
    use bevy::post_process::bloom::{BloomCompositeMode, BloomPrefilter};
    Bloom {
        intensity: std::env::var("PORTAL3_BLOOM").ok().and_then(|v| v.parse().ok()).unwrap_or(0.25),
        low_frequency_boost: 0.5,
        prefilter: BloomPrefilter { threshold: 1.6, threshold_softness: 0.1 },
        composite_mode: BloomCompositeMode::Additive,
        ..Bloom::NATURAL
    }
}

fn setup_camera(mut commands: Commands, mut images: ResMut<Assets<Image>>, target: Option<Res<HeadlessTarget>>) {
    let envmap = env::environment_cubemap(&mut images);
    commands.insert_resource(EnvMap(envmap.clone()));
    let mut cam = commands.spawn((
        Camera3d::default(),
        Hdr,
        Projection::Perspective(PerspectiveProjection { fov: 75f32.to_radians(), near: 0.03, ..default() }),
        Tonemapping::AcesFitted,
        bevy::camera::Exposure { ev100: std::env::var("PORTAL3_EV").ok().and_then(|v| v.parse().ok()).unwrap_or(EV100) },
        bevy::render::view::ColorGrading { global: bevy::render::view::ColorGradingGlobal { exposure: GRADE_EV, ..default() }, ..default() },
        bloom(),
        GeneratedEnvironmentMapLight { environment_map: envmap, intensity: std::env::var("PORTAL3_ENV").ok().and_then(|v| v.parse().ok()).unwrap_or(1.0), ..default() },
        Msaa::Sample4,
        Transform::from_xyz(0.0, 1.6, 4.0),
        MainCam,
        bevy::camera::visibility::RenderLayers::from_layers(&[0, 1, relogio::PRESENT_LAYER]),
        // a profundidade da cena serve ao desfoque de movimento e à névoa de calor
        bevy::core_pipeline::prepass::DepthPrepass,
    ));
    if let Some(t) = target {
        cam.insert(RenderTarget::Image(t.0.clone().into()));
    }
}
