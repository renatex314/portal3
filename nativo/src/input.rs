//! Entrada (o `input` e os ouvintes de teclado/mouse do main.js): WASD anda, setas olham,
//! Q/botão esquerdo = portal ciano, F/botão direito = vermelho, G/meio = tempo lento, Z/X ou
//! roda = zoom, espaço pula, Ctrl/C agacha, E pega/usa, R reinicia, T viaja no tempo, 2 para o tempo.
//! Os testes sem janela escrevem direto neste recurso.

use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll, MouseScrollUnit};
use bevy::prelude::*;

#[derive(Resource, Default, Clone, Debug)]
pub struct Controls {
    // contínuos
    pub f: bool,
    pub b: bool,
    pub l: bool,
    pub r: bool,
    pub jump: bool,
    pub crouch: bool,
    pub look_l: bool,
    pub look_r: bool,
    pub look_u: bool,
    pub look_d: bool,
    pub scrub_in: bool,
    pub scrub_out: bool,
    /// botões de tiro seguros (0 = ciano, 2 = vermelho)
    pub fire: [bool; 3],
    // acumulados no quadro
    pub mouse: Vec2,
    pub wheel: f32,
    // apertos (o jogo consome)
    pub pressed: Vec<Key>,
    pub released: Vec<Key>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    FireBlue,
    FireOrange,
    Slow,
    ZoomIn,
    ZoomOut,
    Use,
    Restart,
    TimeTravel,
    StopTime,
    Play,
    Pause,
    Jump,
}

/// lê o teclado e o mouse (só com janela)
pub fn read_input(keys: Res<ButtonInput<KeyCode>>, buttons: Res<ButtonInput<MouseButton>>, motion: Res<AccumulatedMouseMotion>, scroll: Res<AccumulatedMouseScroll>, mut c: ResMut<Controls>) {
    c.f = keys.pressed(KeyCode::KeyW);
    c.b = keys.pressed(KeyCode::KeyS);
    c.l = keys.pressed(KeyCode::KeyA);
    c.r = keys.pressed(KeyCode::KeyD);
    c.crouch = keys.any_pressed([KeyCode::ControlLeft, KeyCode::ControlRight, KeyCode::KeyC]);
    c.look_l = keys.pressed(KeyCode::ArrowLeft);
    c.look_r = keys.pressed(KeyCode::ArrowRight);
    c.look_u = keys.pressed(KeyCode::ArrowUp);
    c.look_d = keys.pressed(KeyCode::ArrowDown);
    c.scrub_in = keys.pressed(KeyCode::KeyZ);
    c.scrub_out = keys.pressed(KeyCode::KeyX);
    if keys.just_pressed(KeyCode::Space) {
        c.jump = true;
        c.pressed.push(Key::Jump);
    }
    if keys.just_released(KeyCode::Space) {
        c.jump = false;
    }
    let mut press = |k: KeyCode, key: Key| {
        if keys.just_pressed(k) {
            c.pressed.push(key);
        }
    };
    press(KeyCode::KeyQ, Key::FireBlue);
    press(KeyCode::KeyF, Key::FireOrange);
    press(KeyCode::KeyG, Key::Slow);
    press(KeyCode::KeyZ, Key::ZoomIn);
    press(KeyCode::KeyX, Key::ZoomOut);
    press(KeyCode::KeyE, Key::Use);
    press(KeyCode::KeyR, Key::Restart);
    press(KeyCode::KeyT, Key::TimeTravel);
    press(KeyCode::Digit2, Key::StopTime);
    press(KeyCode::Enter, Key::Play);
    press(KeyCode::Escape, Key::Pause);
    for (k, key) in [(KeyCode::KeyQ, Key::FireBlue), (KeyCode::KeyF, Key::FireOrange)] {
        if keys.just_released(k) {
            c.released.push(key);
        }
    }
    if buttons.just_pressed(MouseButton::Left) {
        c.pressed.push(Key::FireBlue);
    }
    if buttons.just_pressed(MouseButton::Right) {
        c.pressed.push(Key::FireOrange);
    }
    if buttons.just_pressed(MouseButton::Middle) {
        c.pressed.push(Key::Slow);
    }
    if buttons.just_released(MouseButton::Left) {
        c.released.push(Key::FireBlue);
    }
    if buttons.just_released(MouseButton::Right) {
        c.released.push(Key::FireOrange);
    }
    c.fire[0] = keys.pressed(KeyCode::KeyQ) || buttons.pressed(MouseButton::Left);
    c.fire[2] = keys.pressed(KeyCode::KeyF) || buttons.pressed(MouseButton::Right);
    c.mouse += motion.delta;
    c.wheel += match scroll.unit {
        MouseScrollUnit::Line => scroll.delta.y * 40.0,
        MouseScrollUnit::Pixel => scroll.delta.y,
    };
}
