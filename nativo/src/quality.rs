//! Qualidade gráfica: Alta (como a versão web), Média (antisserrilhado 2× e vistas dos portais a
//! 75%) e Baixa (sem antisserrilhado, vistas a 50% e sem brilho). O padrão é escolhido pela placa
//! de vídeo: dedicada = Alta; integrada ou desconhecida = Média; por software = Baixa.

use crate::game::Game;
use crate::{gun, MainCam};
use bevy::post_process::bloom::Bloom;
use bevy::prelude::*;
use bevy::render::renderer::RenderAdapterInfo;

pub const NAMES: [&str; 3] = ["Baixa", "Média", "Alta"];

/// a qualidade em uso: PORTAL3_QUALIDADE (0, 1 ou 2), a escolha do jogador, ou a automática
pub fn level(g: &Game, auto: u8) -> u8 {
    std::env::var("PORTAL3_QUALIDADE").ok().and_then(|v| v.parse::<u8>().ok()).map(|v| v.min(2)).or(g.progress.quality.map(|q| q.min(2))).unwrap_or(auto)
}

/// escala das vistas dos portais (largura e altura) para cada qualidade
pub fn portal_scale(q: u8) -> f32 {
    match q {
        0 => 0.5,
        1 => 0.75,
        _ => 1.0,
    }
}

fn msaa(q: u8) -> Msaa {
    match q {
        0 => Msaa::Off,
        1 => Msaa::Sample2,
        _ => Msaa::Sample4,
    }
}

#[derive(Resource, Default)]
pub struct QualityState {
    /// a escolha automática (pela placa de vídeo) e o que já foi aplicado
    pub auto: Option<u8>,
    pub applied: Option<u8>,
    pub current: u8,
}

pub fn apply_quality(
    mut commands: Commands,
    game: Option<Res<Game>>,
    info: Option<Res<RenderAdapterInfo>>,
    mut st: ResMut<QualityState>,
    main: Query<Entity, With<MainCam>>,
    gun: Option<Res<gun::Gun>>,
) {
    let Some(game) = game else { return };
    if st.auto.is_none() {
        st.auto = Some(match info.as_ref().map(|i| format!("{:?}", i.device_type)).as_deref() {
            Some("DiscreteGpu") | Some("VirtualGpu") => 2,
            Some("Cpu") => 0,
            // (placa integrada, ou não deu para saber: o meio-termo)
            _ => 1,
        });
        if let Some(i) = info.as_ref() {
            info!("placa de vídeo: {} ({:?}) → qualidade automática: {}", i.name, i.device_type, NAMES[st.auto.unwrap() as usize]);
        }
    }
    let q = level(&game, st.auto.unwrap_or(1));
    st.current = q;
    if st.applied == Some(q) {
        return;
    }
    st.applied = Some(q);
    for e in &main {
        let mut c = commands.entity(e);
        c.insert(msaa(q));
        if q == 0 {
            c.remove::<Bloom>();
        } else {
            c.insert(crate::bloom());
        }
    }
    if let Some(g) = gun {
        commands.entity(g.cam).insert(msaa(q));
        if q == 0 {
            commands.entity(g.cam).remove::<Bloom>();
        } else {
            commands.entity(g.cam).insert(gun::gun_bloom());
        }
    }
}
