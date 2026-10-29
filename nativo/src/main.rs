// sem janela de console no Windows (versão final)
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use bevy::prelude::*;

/// se o jogo quebrar: grava o motivo em "erro.txt" (pasta de dados do jogo) e mostra um aviso
/// (no Windows não há console para ver a mensagem)
fn crash_report() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default(info);
        let bt = std::backtrace::Backtrace::force_capture();
        let text = format!("{info}\n\n{bt}");
        let dir = portal3::menu::data_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("erro.txt");
        let _ = std::fs::write(&path, &text);
        let first = info.to_string().lines().take(6).collect::<Vec<_>>().join("\n");
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Laboratório Antípoda")
            .set_description(format!("O jogo encontrou um erro e vai fechar.\n\n{first}\n\nDetalhes em:\n{}", path.display()))
            .show();
    }));
}

fn main() {
    crash_report();
    // aberto de dentro do .zip (sem extrair) ou longe da pasta "assets": avisa em vez de quebrar
    if !portal3::mats::asset_dir().join("levels/levels.json").exists() {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Laboratório Antípoda")
            .set_description("Não encontrei a pasta \"assets\" do jogo.\n\nExtraia o .zip inteiro para uma pasta (botão direito → \"Extrair tudo...\") e abra o portal3.exe de lá, sem tirar ele de perto da pasta \"assets\".")
            .show();
        return;
    }
    let mut app = App::new();
    app.add_plugins(
        DefaultPlugins
            // (o desenho do quadro anterior em outra thread dá mais quadros por segundo, mas põe um
            // quadro inteiro de atraso entre o clique e a imagem: aqui a resposta vem primeiro)
            .build()
            .disable::<bevy::render::pipelined_rendering::PipelinedRenderingPlugin>()
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: "Laboratório Antípoda".into(),
                    resolution: (1280u32, 720u32).into(),
                    present_mode: bevy::window::PresentMode::AutoNoVsync,
                    // no máximo um quadro na fila da tela
                    desired_maximum_frame_latency: std::num::NonZeroU32::new(1),
                    ..default()
                }),
                ..default()
            })
            .set(AssetPlugin { file_path: portal3::mats::asset_dir().to_string_lossy().into(), ..default() }),
    );
    if std::env::var("PORTAL3_PERF").is_ok() {
        app.add_plugins((bevy::diagnostic::FrameTimeDiagnosticsPlugin::default(), bevy::diagnostic::LogDiagnosticsPlugin::default()));
        app.add_systems(Last, |time: Res<Time<Real>>, mut n: Local<u32>| {
            *n += 1;
            let ms = time.delta_secs_f64() * 1000.0;
            if ms > 40.0 {
                eprintln!("[travada] quadro {} levou {ms:.0} ms (t = {:.1} s)", *n, time.elapsed_secs_f64());
            }
        });
    }
    app.add_plugins(portal3::GamePlugin).add_systems(PreUpdate, portal3::input::read_input.after(bevy::input::InputSystems)).run();
}
