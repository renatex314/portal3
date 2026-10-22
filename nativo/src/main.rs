// sem janela de console no Windows (versão final)
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]


use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(
            DefaultPlugins
                .set(WindowPlugin { primary_window: Some(Window { title: "Portal".into(), resolution: (1280u32, 720u32).into(), ..default() }), ..default() })
                .set(AssetPlugin { file_path: portal3::mats::asset_dir().to_string_lossy().into(), ..default() }),
        )
        .add_plugins(portal3::GamePlugin)
        .add_systems(PreUpdate, portal3::input::read_input.after(bevy::input::InputSystems))
        .run();
}
