//! Testes sem janela: a câmera desenha numa imagem, o tempo anda 1/60 s por quadro e os cenários
//! salvam capturas e estado (JSON) — como os testes com puppeteer da versão web.
//!
//!   cargo run --bin teste -- shot --level 1 --eye 0,1.65,3.5 --yaw 0 --pitch 0 --out a.png

use bevy::app::SubApps;
use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::render::render_resource::{PollType, TextureFormat};
use bevy::render::renderer::RenderDevice;
use bevy::render::view::screenshot::{save_to_disk, Screenshot};
use bevy::render::RenderPlugin;
use bevy::time::TimeUpdateStrategy;
use bevy::window::ExitCondition;
use bevy::winit::WinitPlugin;
use portal3::input::{Controls, Key};
use portal3::{game::{Game, GameEvent}, HeadlessTarget, MainCam};
use std::time::Duration;

thread_local! {
    static INVARIANTS: std::cell::RefCell<std::collections::HashSet<String>> = Default::default();
}

pub struct Harness {
    apps: SubApps,
    pub target: Handle<Image>,
}

impl Harness {
    pub fn new(w: u32, h: u32, level: Option<i64>) -> Self {
        if let Some(l) = level {
            // (a fase inicial é lida na partida)
            unsafe { std::env::set_var("PORTAL3_LEVEL", l.to_string()) };
        } else {
            unsafe { std::env::remove_var("PORTAL3_LEVEL") };
        }
        let mut app = App::new();
        app.add_plugins(
            DefaultPlugins
                .set(WindowPlugin { primary_window: None, exit_condition: ExitCondition::DontExit, ..default() })
                .set(RenderPlugin { synchronous_pipeline_compilation: true, ..default() })
                .set(AssetPlugin { file_path: portal3::mats::asset_dir().to_string_lossy().into(), ..default() })
                .disable::<WinitPlugin>(),
        );
        let mut img = Image::new_target_texture(w, h, TextureFormat::Rgba8UnormSrgb, None);
        img.asset_usage = RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD;
        let target = app.world_mut().resource_mut::<Assets<Image>>().add(img);
        app.insert_resource(HeadlessTarget(target.clone()));
        app.insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs_f64(1.0 / 60.0)));
        app.add_plugins(portal3::GamePlugin);
        // sem saída de som nos testes, e os eventos do jogo ficam para os cenários lerem
        unsafe { std::env::set_var("PORTAL3_MUTE", "1") };
        app.insert_resource(portal3::audio::KeepEvents);
        app.finish();
        app.cleanup();
        Harness { apps: std::mem::take(app.sub_apps_mut()), target }
    }

    pub fn world(&mut self) -> &mut World {
        self.apps.main.world_mut()
    }

    pub fn update(&mut self) {
        self.apps.update();
        let _ = self.apps.main.world().resource::<RenderDevice>().wgpu_device().poll(PollType::Wait { submission_index: None, timeout: None });
        // as regras da linha do tempo, a cada quadro de todo cenário (cada uma avisada uma vez)
        if let Some(g) = self.apps.main.world().get_resource::<Game>() {
            for v in g.ch_invariants() {
                let key: String = v.chars().filter(|c| !c.is_ascii_digit() && *c != '.').collect();
                if INVARIANTS.with(|s| s.borrow_mut().insert(key)) {
                    println!("FALHA invariante: {v}");
                }
            }
        }
    }

    pub fn frames(&mut self, n: usize) {
        for _ in 0..n {
            self.update();
        }
    }

    pub fn shot(&mut self, path: &str) {
        let _ = std::fs::remove_file(path);
        let t = self.target.clone();
        self.world().spawn(Screenshot::image(t)).observe(save_to_disk(path.to_string()));
        // a leitura da GPU e a gravação do arquivo acontecem alguns quadros depois
        for _ in 0..200 {
            self.update();
            if std::fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false) {
                std::thread::sleep(Duration::from_millis(50));
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        eprintln!("captura não gravada: {path}");
    }

    pub fn set_cam(&mut self, eye: Vec3, yaw: f32, pitch: f32) {
        let w = self.world();
        let mut q = w.query_filtered::<&mut Transform, With<MainCam>>();
        if let Ok(mut t) = q.single_mut(w) {
            *t = Transform::from_translation(eye).with_rotation(Quat::from_rotation_y(yaw) * Quat::from_rotation_x(pitch));
        }
    }
}

// ------------------------------------------------------------------ ações dos cenários
impl Harness {
    pub fn game(&mut self) -> Mut<'_, Game> {
        self.world().resource_mut::<Game>()
    }

    /// vira o jogador para olhar o ponto `p`
    pub fn aim(&mut self, p: Vec3) {
        let mut g = self.game();
        let d = (p - g.player.eye()).normalize();
        g.player.yaw = (-d.x).atan2(-d.z);
        g.player.pitch = d.y.asin();
    }

    pub fn controls(&mut self) -> Mut<'_, Controls> {
        self.world().resource_mut::<Controls>()
    }

    /// aperta e solta uma tecla
    pub fn tap(&mut self, k: Key) {
        self.controls().pressed.push(k);
        self.update();
        self.controls().released.push(k);
        self.update();
    }

    /// atira no ponto e espera o projétil chegar
    pub fn shoot_at(&mut self, k: Key, p: Vec3) -> Vec<GameEvent> {
        self.aim(p);
        self.update();
        self.game().events.clear();
        self.tap(k);
        for _ in 0..60 {
            self.update();
            if !self.game().bolts.flying() && self.game().pending_shot.is_none() {
                break;
            }
        }
        std::mem::take(&mut self.game().events)
    }

    /// anda com as teclas dadas por `secs` segundos
    pub fn walk(&mut self, f: bool, b: bool, l: bool, r: bool, secs: f32) -> Vec<GameEvent> {
        {
            let mut c = self.controls();
            (c.f, c.b, c.l, c.r) = (f, b, l, r);
        }
        let mut ev = vec![];
        for _ in 0..(secs * 60.0) as usize {
            self.update();
            ev.extend(std::mem::take(&mut self.game().events));
        }
        let mut c = self.controls();
        (c.f, c.b, c.l, c.r) = (false, false, false, false);
        ev
    }

    pub fn state(&mut self) -> String {
        let g = self.game();
        let p = g.player.pos;
        let pl: Vec<String> = g.portals.list.iter().map(|q| if q.placed { format!("[{:.2},{:.2},{:.2}]", q.center.x, q.center.y, q.center.z) } else { "null".into() }).collect();
        format!("{{\"pos\":[{:.2},{:.2},{:.2}],\"chao\":{},\"portais\":[{}],\"mortes\":{},\"completa\":{}}}", p.x, p.y, p.z, g.player.grounded, pl.join(","), g.deaths, g.completed)
    }
}

fn check(ok: bool, what: &str, fails: &mut u32) {
    println!("{} {what}", if ok { "ok  " } else { "FALHA" });
    if !ok {
        *fails += 1;
    }
}

fn arg<'a>(args: &'a [String], k: &str) -> Option<&'a str> {
    args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).map(|s| s.as_str())
}

fn v3(s: &str) -> Vec3 {
    let v: Vec<f32> = s.split(',').map(|x| x.trim().parse().unwrap_or(0.0)).collect();
    Vec3::new(v[0], v[1], v[2])
}

/// portal pelo raio (como o tiro), com Δ no vermelho temporal
fn place_portal(h: &mut Harness, which: usize, origin: Vec3, dir: Vec3, delta: f32) -> bool {
    h.world().resource_scope(|_, mut g: Mut<Game>| {
        let g = &mut *g;
        let ok = g.portals.try_place(&g.world, which, origin, dir, false).ok;
        if delta > 0.0 {
            g.portals.list[which].delta = delta;
            g.portals.list[which].placed_tw = g.relogio.as_ref().map(|c| c.tw);
        }
        ok
    })
}

/// salta pelo ciano (o jogador vai para a boca dele) e fica num canto longe das bolas
fn jump_blue(h: &mut Harness, rest: Vec3) -> bool {
    h.world().resource_scope(|ecs, mut g: Mut<Game>| {
        let g = &mut *g;
        g.player.pos = g.portals.list[0].center + g.portals.list[0].normal * 0.5 - Vec3::Y * 0.15;
        let ok = g.ch_jump(ecs, 0);
        g.player.pos = rest;
        ok
    })
}

fn tw(h: &mut Harness) -> f32 {
    h.game().relogio.as_ref().map(|c| c.tw).unwrap_or(0.0)
}

/// conta os paradoxos (e mostra o motivo) nos eventos do quadro
fn paradoxes(h: &mut Harness) -> u32 {
    let t = tw(h);
    let mut n = 0;
    for e in std::mem::take(&mut h.game().events) {
        if let GameEvent::Paradox(why, _) = e {
            println!("  tw {t:.2} paradoxo: {why}");
            n += 1;
        }
    }
    n
}

/// fase 604: bola na sala 2 vai ao passado pelo ciano (parede leste) e sai do vermelho Δ s antes na
/// sala 1; depois de mandar, salta para antes disso. Devolve (instante e lugar da entrada no ciano)
fn ball_loop_then_jump(h: &mut Harness, delta: f32) -> Option<(f32, Vec3)> {
    h.frames(30);
    h.game().player.pos = Vec3::new(8.0, 0.92, 12.0);
    h.frames(60 * 12);
    let ok = place_portal(h, 0, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 0.0) && place_portal(h, 1, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, delta);
    check(ok, "portais (ciano onde a bola bate, vermelho temporal na sala 1)", &mut 0);
    let mut sent = None;
    for _ in 0..60 * 12 {
        h.update();
        paradoxes(h);
        let g = h.game();
        if let Some(c) = g.ch_linha().and_then(|l| l.compromissos.first()) {
            sent = Some((c.t, c.onde));
            break;
        }
    }
    let (t1, at) = sent?;
    h.frames(60);
    if !jump_blue(h, Vec3::new(0.0, 0.92, 12.0)) {
        return None;
    }
    println!("bola mandada em {t1:.2}; chegada do salto {:.2}", tw(h));
    Some((t1, at))
}

/// depois do salto (o mundo refeito no quadro seguinte), tira do mundo as bolas da história (a que foi ao
/// passado inclusive) e desliga os lançadores; ficam só as mais velhas (os voos no passado)
fn remove_young_balls(h: &mut Harness) {
    h.frames(2);
    h.world().resource_scope(|ecs, mut g: Mut<Game>| {
        let g = &mut *g;
        let elder: Vec<u64> = g.ch_linha().map(|l| l.voos.iter().map(|v| v.uid).collect()).unwrap_or_default();
        let mut i = g.energy.pellets.len();
        while i > 0 {
            i -= 1;
            if !elder.contains(&g.energy.pellets[i].uid) {
                g.energy.kill_pub(ecs, &mut g.world, i);
            }
        }
        for l in &mut g.world.launchers {
            l.done = true;
            l.pellet = None;
        }
    });
}
fn main() {
    // modo de teste desde a primeira linha: os níveis, o progresso e os diagnósticos vão para arquivos
    // próprios, nunca os de quem joga (o cenário do editor apagava os níveis de verdade antes do harness)
    unsafe { std::env::set_var("PORTAL3_MUTE", "1") };
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("shot");
    match cmd {
        // desempenho: tempo de carga da fase e milissegundos por quadro (sem janela; a GPU é a daqui)
        "perf" => {
            let level: i64 = arg(&args, "--level").and_then(|s| s.parse().ok()).unwrap_or(1);
            let t0 = std::time::Instant::now();
            let (rw, rh) = std::env::var("PORTAL3_RES").ok().and_then(|v| v.split_once('x').map(|(a, b)| (a.parse().unwrap_or(1280), b.parse().unwrap_or(720)))).unwrap_or((1280, 720));
            let mut h = Harness::new(rw, rh, Some(level));
            h.update();
            println!("abertura + 1º quadro: {:.0} ms", t0.elapsed().as_secs_f64() * 1000.0);
            let mut worst = 0.0f64;
            let mut total = 0.0f64;
            let mut all: Vec<f64> = vec![];
            let t1 = std::time::Instant::now();
            if let Some(ps) = arg(&args, "--portals") {
                for item in ps.split(';').filter(|s| !s.is_empty()) {
                    let (w, v) = item.split_once(':').unwrap();
                    let v: Vec<f32> = v.split(',').map(|x| x.parse().unwrap()).collect();
                    let which = if w == "b" { 0 } else { 1 };
                    let mut g = h.game();
                    let g = &mut *g;
                    g.portals.place_fixed(&g.world, which, Vec3::new(v[0], v[1], v[2]), Vec3::new(v[3], v[4], v[5]), Vec3::Y);
                }
            }
            let look_yaw: Option<f32> = arg(&args, "--yaw").and_then(|s| s.parse().ok());
            let look_pitch: Option<f32> = arg(&args, "--pitch").and_then(|s| s.parse().ok());
            let look_eye = arg(&args, "--eye").map(v3);
            for i in 0..std::env::var("PORTAL3_FRAMES").ok().and_then(|v| v.parse().ok()).unwrap_or(240) {
                if let Some(p) = look_pitch {
                    h.game().player.pitch = p;
                }
                if let Some(y) = look_yaw {
                    h.game().player.yaw = y;
                }
                if args.iter().any(|a| a == "--sweep") {
                    // gira devagar de um lado ao outro: os portais entram e saem da vista
                    h.game().player.yaw = (i as f32 * 0.02).sin() * 2.2;
                }
                if let Some(e) = look_eye {
                    let mut g = h.game();
                    g.player.pos = e - Vec3::new(0.0, g.player.eye_off, 0.0);
                    g.player.vel = Vec3::ZERO;
                }
                let t = std::time::Instant::now();
                h.update();
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                if i < 6 {
                    println!("  quadro {i}: {ms:.0} ms");
                }
                if i >= 30 {
                    worst = worst.max(ms);
                    total += ms;
                    all.push(ms);
                }
            }
            all.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let med = all.get(all.len() / 2).copied().unwrap_or(0.0);
            let spikes = all.iter().filter(|&&m| m > med * 2.0 + 2.0).count();
            println!("médio {:.1} ms · mediana {:.1} · pior {:.0} ms · picos (>2× a mediana) {} de {} · total {:.1} s", total / all.len().max(1) as f64, med, worst, spikes, all.len(), t1.elapsed().as_secs_f64());
            std::process::exit(0);
        }
        // entrar numa fase vindo do menu: o que cada quadro custa logo depois do clique
        // atravessar portais numa fase (--level): abre o ciano e o vermelho pelo raio a partir da partida
        // (em volta, na altura do olho) e passa por eles várias vezes, medindo os quadros perto da travessia
        "perf-travessia" => {
            let level: i64 = arg(&args, "--level").and_then(|s| s.parse().ok()).unwrap_or(7);
            let mut h = Harness::new(1280, 720, Some(level));
            h.frames(60 * 2);
            // procura duas paredes que aceitem portal, girando em volta da partida
            let (eye, ok) = h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                let eye = g.player.eye();
                let mut got = [false, false];
                for k in 0..24 {
                    let a = k as f32 / 24.0 * std::f32::consts::TAU;
                    let dir = Vec3::new(a.sin(), -0.05, a.cos());
                    let which = if got[0] { 1 } else { 0 };
                    if got[which] {
                        break;
                    }
                    if let Some(hit) = g.world.raycast(eye, dir, 60.0) {
                        if hit.dist > 4.0 && g.portals.try_place(&g.world, which, eye, dir, false).ok {
                            if which == 1 && g.portals.list[1].center.distance(g.portals.list[0].center) < 6.0 {
                                g.portals.list[1].remove();
                                continue;
                            }
                            got[which] = true;
                        }
                    }
                }
                (eye, got[0] && got[1])
            });
            let (cb, co) = {
                let g = h.game();
                (g.portals.list[0].center, g.portals.list[1].center)
            };
            println!("portais: {ok} · ciano {cb:.1} vermelho {co:.1}");
            if !ok {
                std::process::exit(1);
            }
            let _ = eye;
            let mut all = vec![];
            for round in 0..6 {
                // na frente do ciano (ou do vermelho, em rodadas alternadas), correndo para ele
                let k = round % 2;
                {
                    let mut g = h.game();
                    let p = &g.portals.list[k];
                    let (c, n) = (p.center, p.normal);
                    let start = c + n * 4.0 - Vec3::Y * 0.2;
                    g.player.pos = start;
                    g.player.vel = -n * 12.0;
                    // ENCARAR: já olhando para o portal (a vista dele é desenhada antes de chegar)
                    if std::env::var("ENCARAR").is_ok() {
                        g.player.yaw = (n.x).atan2(n.z);
                        g.player.pitch = 0.0;
                    }
                }
                let mut times = vec![];
                let mut tp_at = None;
                for f in 0..90usize {
                    let before = h.game().player.pos;
                    let t = std::time::Instant::now();
                    h.update();
                    let ms = t.elapsed().as_secs_f64() * 1000.0;
                    times.push(ms);
                    if ms > 40.0 {
                        println!("    quadro {f}: {ms:.0} ms");
                    }
                    if tp_at.is_none() && h.game().player.pos.distance(before) > 2.0 {
                        tp_at = Some(f);
                    }
                }
                let around: Vec<f64> = match tp_at {
                    Some(f) => times[f.saturating_sub(3)..(f + 10).min(times.len())].to_vec(),
                    None => vec![],
                };
                let mut sorted = times.clone();
                sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let med = sorted[sorted.len() / 2];
                let peak = around.iter().cloned().fold(0.0, f64::max);
                println!("  rodada {round}: travessia no quadro {tp_at:?} · mediana {med:.1} ms · pior perto da travessia {peak:.1} ms · quadros {:?}", around.iter().map(|x| x.round() as i64).collect::<Vec<_>>());
                all.push((med, peak));
            }
            std::process::exit(0);
        }
        "perf-entrar" => {
            let level: usize = arg(&args, "--level").and_then(|s| s.parse().ok()).unwrap_or(1);
            let t0 = std::time::Instant::now();
            let mut h = Harness::new(1280, 720, None);
            for i in 0..8 {
                let t = std::time::Instant::now();
                h.update();
                println!("  menu, quadro {i}: {:.0} ms", t.elapsed().as_secs_f64() * 1000.0);
            }
            println!("abertura até o menu: {:.0} ms", t0.elapsed().as_secs_f64() * 1000.0);
            h.game().start_level(level);
            for i in 0..12 {
                let t = std::time::Instant::now();
                h.update();
                println!("  fase {level}, quadro {i}: {:.0} ms", t.elapsed().as_secs_f64() * 1000.0);
            }
            std::process::exit(0);
        }
        "shot" => {
            let level: i64 = arg(&args, "--level").and_then(|s| s.parse().ok()).unwrap_or(1);
            let mut h = Harness::new(1280, 720, Some(level));
            h.frames(5);
            // portais: "b:cx,cy,cz,nx,ny,nz;o:..."
            if let Some(ps) = arg(&args, "--portals") {
                for item in ps.split(';').filter(|s| !s.is_empty()) {
                    let (w, v) = item.split_once(':').unwrap();
                    let v: Vec<f32> = v.split(',').map(|x| x.parse().unwrap()).collect();
                    let which = if w == "b" { 0 } else { 1 };
                    let mut g = h.game();
                    let g = &mut *g;
                    g.portals.place_fixed(&g.world, which, Vec3::new(v[0], v[1], v[2]), Vec3::new(v[3], v[4], v[5]), Vec3::Y);
                }
            }
            if args.iter().any(|a| a == "--slow") {
                h.game().toggle_slow(Some(true));
            }
            if args.iter().any(|a| a == "--stop") {
                h.tap(Key::StopTime);
            }
            let eye = arg(&args, "--eye").map(v3);
            let yaw: f32 = arg(&args, "--yaw").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let pitch: f32 = arg(&args, "--pitch").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let n: usize = arg(&args, "--frames").and_then(|s| s.parse().ok()).unwrap_or(30);
            let open: Option<f32> = arg(&args, "--open").and_then(|s| s.parse().ok());
            for _ in 0..n.max(1) {
                // portal congelado num ponto da abertura (comparação com a versão web)
                if let Some(o) = open {
                    let mut g = h.game();
                    for p in g.portals.list.iter_mut() {
                        p.open = (o - 4.5 / 60.0).max(0.0);
                        p.age = o / 4.5 - 1.0 / 60.0;
                    }
                }
                if let Some(e) = eye {
                    let mut g = h.game();
                    g.player.pos = e - Vec3::new(0.0, g.player.eye_off, 0.0);
                    g.player.vel = Vec3::ZERO;
                    g.player.yaw = yaw;
                    g.player.pitch = pitch;
                }
                h.update();
            }
            if args.iter().any(|a| a == "--probe") {
                let g = h.world().resource::<Game>();
                let o = g.player.eye();
                let d = Quat::from_euler(EulerRot::YXZ, g.player.yaw, g.player.pitch, 0.0) * Vec3::NEG_Z;
                if let Some(hit) = g.world.raycast(o, d, 100.0) {
                    println!("alvo {:.3},{:.3},{:.3} normal {:.3},{:.3},{:.3}", hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z);
                }
            }
            let out = arg(&args, "--out").unwrap_or("shot.png");
            h.shot(out);
            let g = h.world().resource::<Game>();
            println!("{{\"fase\":{:?},\"solidos\":{},\"portas\":{}}}", g.level.map(|i| g.levels[i].name.clone()), g.world.solids.len(), g.world.doors.len());
        }
        // fase 1: dois portais na parede da esquerda atravessam o vão de lama quente
        "travessia" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(1));
            h.frames(40);
            println!("início {}", h.state());
            check(h.game().player.grounded, "jogador começa no chão", &mut fails);
            let ev = h.shoot_at(Key::FireBlue, Vec3::new(-6.0, 1.3, 1.0));
            println!("tiro ciano {:?} {}", ev, h.state());
            check(ev.contains(&GameEvent::PortalOpen(0)), "portal ciano abre na parede branca", &mut fails);
            let ev = h.shoot_at(Key::FireOrange, Vec3::new(-6.0, 1.3, -15.0));
            println!("tiro vermelho {:?} {}", ev, h.state());
            check(ev.contains(&GameEvent::PortalOpen(1)), "portal vermelho abre do outro lado do vão", &mut fails);
            let ev = h.shoot_at(Key::FireBlue, Vec3::new(-6.0, 1.3, -7.0));
            check(ev.contains(&GameEvent::PortalFail), "rocha não aceita portal", &mut fails);
            check(h.game().portals.list[0].placed && h.game().portals.list[0].center.z > 0.0, "o ciano antigo continua", &mut fails);
            h.aim(Vec3::new(-6.0, 1.2, 1.0));
            h.frames(30);
            h.shot("travessia-vista.png");
            h.aim(Vec3::new(-6.0, 1.2, -15.0));
            h.frames(2);
            h.shot("travessia-vermelho.png");
            h.aim(Vec3::new(-6.0, 1.3, 1.0));
            {
                let mut g = h.game();
                g.player.pitch = 0.0;
            }
            let ev = h.walk(true, false, false, false, 3.0);
            println!("andando {:?} {}", ev, h.state());
            check(ev.iter().any(|e| matches!(e, GameEvent::Teleport(0))), "entrou no portal ciano", &mut fails);
            let p = h.game().player.pos;
            check(p.z < -10.0 && p.y > -0.5, "saiu do outro lado do vão", &mut fails);
            check(h.game().deaths == 0, "não caiu na lama", &mut fails);
            h.shot("travessia-depois.png");
            // anda até o elevador de saída
            h.aim(Vec3::new(0.0, 1.6, -21.0));
            h.game().player.pitch = 0.0;
            let ev = h.walk(true, false, false, false, 6.0);
            println!("saída {:?} {}", ev, h.state());
            check(h.game().completed, "chegou na saída", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 2: pegar o cubo, levar até o botão, a porta abre; arremessar
        "cubo" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(2));
            h.frames(30);
            check(h.game().props.list.len() == 1, "a fase tem um cubo", &mut fails);
            let y0 = h.game().props.list[0].pos.y;
            h.frames(60);
            let y1 = h.game().props.list[0].pos.y;
            println!("cubo no pilar: y {y0:.2} → {y1:.2}");
            check((y1 - 7.31).abs() < 0.1, "o cubo fica parado em cima do pilar", &mut fails);
            // traz o cubo para perto (como se tivesse vindo pelos portais)
            {
                let mut g = h.game();
                let g = &mut *g;
                g.props.list[0].place(&mut g.world.phys, Vec3::new(-4.0, 0.31, -3.0), None, None);
                g.player.pos = Vec3::new(-4.0, 0.92, -1.0);
            }
            h.frames(30);
            h.aim(Vec3::new(-4.0, 0.31, -3.0));
            h.update();
            h.tap(Key::Use);
            check(h.game().held == Some(0), "E pega o cubo", &mut fails);
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(-4.0, 0.92, -4.0);
                g.player.yaw = 0.0;
                g.player.pitch = -0.75;
            }
            h.frames(40);
            let c = h.game().props.list[0].pos;
            println!("segurado em {c:.2}");
            check(c.distance(h.game().props.list[0].hold_target) < 0.3, "o cubo segue a mira", &mut fails);
            h.tap(Key::Use);
            check(h.game().held.is_none(), "E solta", &mut fails);
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(-1.0, 0.92, -1.0);
            }
            h.frames(120);
            let g = h.game();
            println!("cubo {:.2} botão {} porta {:.2}", g.props.list[0].pos, g.world.buttons[0].pressed, g.world.doors[0].open);
            check(g.world.buttons[0].pressed, "o cubo aperta o botão", &mut fails);
            check(g.world.doors[0].open > 0.9, "a porta abre", &mut fails);
            drop(g);
            h.shot("cubo-botao.png");
            // arremesso
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(-4.0, 0.92, -3.8);
            }
            let cp = h.game().props.list[0].pos;
            h.aim(cp);
            h.update();
            h.tap(Key::Use);
            check(h.game().held == Some(0), "pega de novo", &mut fails);
            h.frames(20);
            h.game().player.pitch = 0.3;
            h.game().player.yaw = std::f32::consts::PI; // para +z
            h.frames(20);
            check(h.game().player.vel.y.abs() < 0.5, "parado no chão não acumula queda", &mut fails);
            h.tap(Key::FireBlue);
            let v = h.game().props.list[0].vel;
            println!("arremesso v {v:.2}");
            check(h.game().held.is_none() && v.z > 4.0 && v.y > 0.0, "o ciano arremessa para a frente e para cima", &mut fails);
            h.frames(10);
            check(!h.game().portals.list[0].placed, "arremessar não abre portal", &mut fails);
            h.frames(120);
            check(!h.game().world.buttons[0].pressed, "sem o cubo o botão solta", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 106: a bola de energia entra no ciano, sai pelo vermelho fixo e cai no receptor
        "energia" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(106));
            h.frames(20);
            check(h.game().portals.list[1].placed && h.game().portals.list[1].fixed, "o vermelho fixo da fase está no lugar", &mut fails);
            let ev = h.shoot_at(Key::FireOrange, Vec3::new(8.0, 1.5, 0.0));
            check(!ev.contains(&GameEvent::PortalOpen(1)), "o vermelho fixo não se move (arma só ciano)", &mut fails);
            let ev = h.shoot_at(Key::FireBlue, Vec3::new(8.0, 1.09, -2.0));
            check(ev.contains(&GameEvent::PortalOpen(0)), "ciano na parede onde a bola bate", &mut fails);
            let mut launched = false;
            let mut caught = false;
            let mut crossed = false;
            for k in 0..60 * 20 {
                h.update();
                for e in std::mem::take(&mut h.game().events) {
                    match e {
                        GameEvent::Energy(portal3::energy::EnergyEvent::Launch(_)) => launched = true,
                        GameEvent::Energy(portal3::energy::EnergyEvent::Caught(_)) => caught = true,
                        _ => {}
                    }
                }
                if h.game().energy.pellets.first().is_some_and(|p| p.pos.z > -9.9 && p.pos.x < -4.0) {
                    crossed = true;
                }
                if k == 60 * 4 {
                    h.aim(Vec3::new(-5.0, 4.0, -5.0));
                    h.shot("energia-bola.png");
                }
                if caught {
                    break;
                }
            }
            check(launched, "o lançador solta a bola", &mut fails);
            check(crossed, "a bola atravessa os portais", &mut fails);
            check(caught, "o receptor pega a bola", &mut fails);
            h.frames(120);
            check(h.game().world.doors[0].open > 0.9, "a porta abre", &mut fails);
            check(h.game().deaths == 0, "ninguém se queimou", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 102: sem arma não atira; o pedestal dá a arma só ciano
        "arma" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(102));
            h.frames(20);
            check(h.game().gun_mode == "none", "começa sem arma", &mut fails);
            let ev = h.shoot_at(Key::FireBlue, Vec3::new(0.0, 1.5, -10.0));
            check(ev.is_empty(), "sem arma o tiro não sai", &mut fails);
            h.aim(Vec3::new(0.0, 1.0, 3.0));
            h.game().player.pitch = 0.0;
            let ev = h.walk(true, false, false, false, 2.0);
            check(ev.contains(&GameEvent::Gun("blue".into())) && h.game().gun_mode == "blue", "o pedestal dá a arma ciano", &mut fails);
            h.shot("arma-pedestal.png");
            let ev = h.shoot_at(Key::FireOrange, Vec3::new(0.0, 1.5, -10.0));
            let o = h.game().portals.list[1].center;
            check(ev.contains(&GameEvent::PortalFail) && o.distance(Vec3::new(-5.0, 1.09, -9.0)) < 0.1, "o vermelho ainda não sai (o fixo da fase fica)", &mut fails);
            let ev = h.shoot_at(Key::FireBlue, Vec3::new(0.0, 1.5, -10.0));
            println!("tiro ciano: {ev:?}");
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 110: torretas enxergam, atiram, desligam por trás e tombam
        "torretas" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(110));
            h.frames(30);
            let n = h.game().props.list.iter().filter(|p| p.turret.is_some()).count();
            check(n == 3, "três torretas", &mut fails);
            for p in h.game().props.list.iter().filter(|p| p.turret.is_some()) {
                println!("torreta {:.2} cima {:.2} ligada {} motivo {:?}", p.pos, (p.quat * Vec3::Y).y, p.turret.as_ref().unwrap().active, p.turret.as_ref().unwrap().down_reason);
            }
            let up = h.game().props.list.iter().filter(|p| p.turret.is_some()).all(|p| (p.quat * Vec3::Y).y > 0.95 && p.turret.as_ref().is_some_and(|t| t.active));
            check(up, "em pé e ligadas", &mut fails);
            // na frente delas
            let mut spotted = false;
            let mut hit = false;
            let mut min_h = 100.0f32;
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(0.0, 0.92, -12.0);
            }
            for _ in 0..90 {
                h.aim(Vec3::new(0.0, 1.0, -20.0));
                h.update();
                for e in std::mem::take(&mut h.game().events) {
                    match e {
                        GameEvent::TurretSpot(_) => spotted = true,
                        GameEvent::Hit(_) => hit = true,
                        _ => {}
                    }
                }
                min_h = min_h.min(h.game().health);
            }
            println!("vida mínima {min_h:.0}");
            check(spotted, "a torreta enxerga o jogador", &mut fails);
            check(hit && min_h < 100.0, "e atira (a vida cai)", &mut fails);
            h.shot("torretas-mira.png");
            check(h.game().deaths > 0, "parado na frente delas, morre", &mut fails);
            check(h.game().health > 90.0, "e volta com a vida cheia", &mut fails);
            // por trás da da esquerda (em -4, -18, olhando para +z): E desliga e ela tomba
            let i = h.game().props.list.iter().position(|p| p.turret.is_some() && (p.home.x + 4.0).abs() < 0.1).unwrap();
            let tp = h.game().props.list[i].pos;
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(tp.x, 0.92, tp.z - 1.2);
            }
            h.frames(2);
            h.aim(tp);
            h.update();
            h.tap(Key::Use);
            check(!h.game().props.list[i].turret.as_ref().unwrap().active, "E por trás desliga", &mut fails);
            h.frames(120);
            let up = (h.game().props.list[i].quat * Vec3::Y).y;
            println!("em pé: {up:.2}");
            check(up < 0.6, "e ela tomba", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 400: laser queima, cubo refletor manda o feixe ao receptor, placa arremessa, funil carrega
        "fronteira" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(400));
            h.frames(20);
            // no feixe (x de −20 a ..., z = 6, altura 0,32): queima e empurra para fora
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(-10.0, 0.92, 6.0);
            }
            let mut min_h = 100.0f32;
            for _ in 0..20 {
                h.update();
                min_h = min_h.min(h.game().health);
            }
            println!("laser: vida {min_h:.0} pos {:.2}", h.game().player.pos);
            check(min_h < 100.0, "o laser queima", &mut fails);
            check((h.game().player.pos.z - 6.0).abs() > 0.1, "e empurra para fora do feixe", &mut fails);
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(0.0, 0.92, 11.0);
            }
            h.frames(60);
            // cubo refletor no feixe, lente para −z (o receptor está em 6, 0,75, −3)
            {
                let mut g = h.game();
                let g = &mut *g;
                let i = g.props.list.iter().position(|p| p.redirect).unwrap();
                g.props.list[i].place(&mut g.world.phys, Vec3::new(6.0, 0.31, 6.0), Some(Quat::from_rotation_y(std::f32::consts::PI)), None);
            }
            h.frames(30);
            let lit = h.game().props.list.iter().any(|p| p.redirect && p.lit);
            check(lit, "o feixe bate no cubo refletor", &mut fails);
            check(h.game().world.laser_catchers[0].active, "e sai pela lente até o receptor", &mut fails);
            h.frames(120);
            check(h.game().world.doors.iter().any(|d| d.id.as_deref() == Some("c1") && d.open > 0.9), "a porta c1 abre", &mut fails);
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(2.0, 0.92, 9.0);
            }
            h.aim(Vec3::new(6.0, 0.4, 0.0));
            h.frames(2);
            h.shot("fronteira-laser.png");
            // placa de lançamento em (0, 0, −9) para (0, 4, −31)
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(0.0, 1.25, -9.0);
                g.player.vel = Vec3::ZERO;
            }
            let mut launched = false;
            let mut landed = Vec3::ZERO;
            for k in 0..240 {
                h.update();
                launched |= std::mem::take(&mut h.game().events).contains(&GameEvent::Plate);
                if k > 30 && h.game().player.grounded {
                    landed = h.game().player.pos;
                    break;
                }
            }
            println!("placa: pousou em {landed:.2}");
            check(launched, "a placa arremessa", &mut fails);
            check(landed.distance(Vec3::new(0.0, 4.92, -31.0)) < 2.0, "e o jogador cai no alvo", &mut fails);
            // funil em (−4, 4, −39,2) para cima
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(-4.0, 5.5, -39.2);
                g.player.vel = Vec3::ZERO;
            }
            h.frames(5);
            let y0 = h.game().player.pos.y;
            h.frames(60);
            let y1 = h.game().player.pos.y;
            println!("funil: y {y0:.2} → {y1:.2}");
            check(h.game().frontier.in_funnel && y1 > y0 + 3.0, "o funil carrega para cima", &mut fails);
            h.aim(Vec3::new(-4.0, y1 + 3.0, -36.0));
            h.frames(2);
            h.shot("fronteira-funil.png");
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 1 com uma ponte de luz sobre o vão: o jogador atravessa andando; os 8 modelos
        "ponte" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(1));
            h.frames(10);
            {
                let w = h.world();
                w.resource_scope(|ecs, mut g: Mut<Game>| {
                    g.world.light_bridge(ecs, 0.0, 0.01, 5.9, Vec3::NEG_Z, None, "veios");
                });
            }
            h.frames(10);
            let n = h.game().world.solids.iter().filter(|s| s.bridge && !s.removed).count();
            check(n >= 1, "a ponte tem um sólido para andar", &mut fails);
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(0.0, 0.93, -2.0);
                g.player.yaw = 0.0;
                g.player.pitch = 0.0;
            }
            let ev = h.walk(true, false, false, false, 2.5);
            let p = h.game().player.pos;
            println!("depois da ponte: {p:.2} {:?}", ev.iter().filter(|e| matches!(e, GameEvent::Died(_))).collect::<Vec<_>>());
            check(p.z < -10.5 && p.y > 0.5 && h.game().deaths == 0, "atravessa o vão por cima da ponte", &mut fails);
            let mut shots = vec![];
            for (k, look) in portal3::frontier::BRIDGE_LOOKS.iter().enumerate() {
                {
                    let mut g = h.game();
                    let i = g.world.lasers.iter().position(|l| l.bridge.is_some()).unwrap();
                    g.world.lasers[i].bridge = Some(look.to_string());
                    g.player.pos = Vec3::new(3.5, 2.6, -2.5);
                }
                h.aim(Vec3::new(0.0, 0.0, -8.0));
                h.frames(3);
                let f = format!("ponte-{k}.png");
                h.shot(&f);
                shots.push(f);
            }
            println!("capturas: {}", shots.join(" "));
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // som: gravações carregadas, música da fase tocando, tiro e falas com legenda
        "som" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(1));
            let mut ready = false;
            for _ in 0..600 {
                h.update();
                if h.world().get_non_send::<portal3::audio::Audio>().is_some_and(|a| a.ready()) {
                    ready = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            check(ready, "as gravações dos efeitos carregam", &mut fails);
            let level = |h: &mut Harness| h.world().get_non_send_mut::<portal3::audio::Audio>().map(|mut a| a.level()).unwrap_or(0.0);
            // música (o tempo do áudio anda sozinho: espera um pouco de verdade)
            std::thread::sleep(std::time::Duration::from_millis(1500));
            h.frames(5);
            let m = level(&mut h);
            println!("nível com a música: {m:.4}");
            check(m > 0.002, "a música da fase toca", &mut fails);
            let sub = h.world().get_non_send::<portal3::audio::Audio>().and_then(|a| a.dialog.showing.clone());
            println!("legenda: {sub:?}");
            check(sub.as_ref().is_some_and(|s| s.0 == "Helena"), "a fala de abertura aparece com a narração", &mut fails);
            // tiro: o nível sobe
            {
                let mut a = h.world().get_non_send_mut::<portal3::audio::Audio>().unwrap();
                a.set_music(false);
                a.cancel_dialog();
            }
            std::thread::sleep(std::time::Duration::from_millis(1600));
            h.frames(2);
            let q = level(&mut h);
            h.shoot_at(Key::FireBlue, Vec3::new(-6.0, 1.3, 1.0));
            let mut peak = 0.0f32;
            for _ in 0..20 {
                std::thread::sleep(std::time::Duration::from_millis(15));
                h.update();
                peak = peak.max(level(&mut h));
            }
            println!("nível: silêncio {q:.4}, tiro {peak:.4}");
            check(peak > q * 3.0 + 0.003, "o tiro e o portal abrindo fazem som", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // tempo lento (G) e campo de dilatação (os dois tiros seguros por 5 s)
        "tempo" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(1));
            h.frames(30);
            let walk = |h: &mut Harness| {
                let z0 = h.game().player.pos.z;
                h.walk(true, false, false, false, 0.5);
                let d = z0 - h.game().player.pos.z;
                h.game().player.pos = Vec3::new(0.0, 0.92, 3.5);
                h.frames(20);
                d
            };
            let normal = walk(&mut h);
            h.tap(Key::Slow);
            check(h.game().slow.on, "G liga o tempo lento", &mut fails);
            h.frames(40);
            let k = h.game().slow.k;
            let slow = walk(&mut h);
            println!("andando 0,5 s: normal {normal:.2} m, lento {slow:.2} m (k {k:.2})");
            check(k < 0.35 && slow < normal * 0.6, "no tempo lento tudo anda mais devagar", &mut fails);
            let mut off_at = None;
            for k in 0..60 * 7 {
                h.update();
                if off_at.is_none() && !h.game().slow.on {
                    off_at = Some((k, h.game().slow.left));
                }
            }
            println!("desligou: {off_at:?}");
            check(off_at.is_some_and(|(_, l)| l < 0.1), "a reserva acaba e o tempo lento desliga", &mut fails);
            h.frames(60 * 7);
            check(h.game().slow.left > 5.9, "e recarrega", &mut fails);
            // campo: os dois botões juntos por 5 s
            {
                let mut c = h.controls();
                c.pressed.push(Key::FireBlue);
                c.pressed.push(Key::FireOrange);
            }
            h.frames(60 * 5 + 10);
            {
                let mut c = h.controls();
                c.released.push(Key::FireBlue);
                c.released.push(Key::FireOrange);
            }
            h.update();
            let n = h.game().field.active.len();
            let shot = h.game().portals.list.iter().any(|p| p.placed);
            check(n == 1 && !shot, "o campo nasce (e nenhum portal sai)", &mut fails);
            // de fora: a lente do campo
            {
                let c = h.game().field.active[0].center;
                h.game().player.pos = c + Vec3::new(0.0, 0.0, 7.0);
                h.aim(c);
            }
            h.frames(3);
            h.shot("campo.png");
            {
                let c = h.game().field.active[0].center;
                h.game().player.pos = c;
            }
            h.frames(2);
            let t0 = h.game().level_time;
            h.frames(60);
            let dt = h.game().level_time - t0;
            println!("1 s dentro do campo: o mundo andou {dt:.1} s");
            check(dt > 8.0, "dentro do campo o mundo corre 10× (você anda devagar)", &mut fails);
            h.frames(60 * 2);
            check(h.game().field.active.is_empty(), "o campo some depois de 20 s do mundo", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 601: pisa no botão, para o tempo, vermelho no passado perto da porta, ciano perto do botão;
        // entrando no ciano você sai no passado e o seu eu de antes continua no botão
        "relogio" => {
            let mut fails = 0;
            let mut h = Harness::new(960, 540, Some(601));
            h.frames(30);
            check(h.game().relogio.is_some(), "a fase tem o relógio", &mut fails);
            h.game().player.pos = Vec3::new(-9.0, 0.92, -10.0);
            h.frames(60 * 5);
            let open0 = h.game().world.doors[0].open;
            check(h.game().world.buttons[0].pressed && open0 > 0.5, "no botão a porta abre", &mut fails);
            let tw0 = h.game().relogio.as_ref().unwrap().tw;
            h.tap(Key::StopTime);
            check(h.game().relogio.as_ref().unwrap().paused, "2 para o tempo", &mut fails);
            h.game().ch_scrub_by(-100.0);
            h.game().ch_scrub_by(3.0);
            h.frames(40);
            let delta = h.game().relogio.as_ref().unwrap().delta;
            println!("tw {tw0:.2} · Δ {delta:.2}");
            check(delta > 2.5 && delta < 4.0, "a roda escolhe quantos segundos voltar", &mut fails);
            h.shot("relogio-pausa.png");
            let ev = h.shoot_at(Key::FireOrange, Vec3::new(-5.5, 1.6, -15.9));
            check(ev.iter().any(|e| matches!(e, GameEvent::PortalOpen(..))), "vermelho no passado (perto da porta)", &mut fails);
            let ev = h.shoot_at(Key::FireBlue, Vec3::new(-11.9, 1.6, -9.0));
            check(ev.iter().any(|e| matches!(e, GameEvent::PortalOpen(..))), "ciano no presente (perto do botão)", &mut fails);
            let pd = h.game().portals.list[1].delta;
            println!("Δ do vermelho {pd:.2}");
            check((pd - delta).abs() < 0.01, "o vermelho guarda o Δ", &mut fails);
            // o tempo volta a andar: pelo ciano se vê a sala de Δ s atrás (você no botão, a porta aberta)
            h.tap(Key::StopTime);
            h.aim(Vec3::new(-11.9, 1.4, -9.0));
            h.frames(20);
            let cam_past = {
                let w = h.world();
                let mut q = w.query::<(&Name, &bevy::camera::visibility::RenderLayers)>();
                q.iter(w).any(|(n, l)| n.as_str() == "câmera do portal 0" && l.intersects(&bevy::camera::visibility::RenderLayers::layer(portal3::relogio::PAST_LAYER)))
            };
            check(cam_past, "a câmera do ciano temporal vê a camada do passado", &mut fails);
            let (n_past, me_at) = {
                let w = h.world();
                let past = bevy::camera::visibility::RenderLayers::layer(portal3::relogio::PAST_LAYER);
                let mut q = w.query::<(&bevy::camera::visibility::RenderLayers, &InheritedVisibility, &GlobalTransform)>();
                let v: Vec<Vec3> = q.iter(w).filter(|(l, v, _)| l.intersects(&past) && v.get()).map(|(_, _, t)| t.translation()).collect();
                (v.len(), v.iter().filter(|p| p.xz().distance(Vec2::new(-9.0, -10.0)) < 1.5).count())
            };
            println!("cópias do passado visíveis: {n_past} ({me_at} no botão)");
            check(n_past > 10 && me_at > 5, "o passado tem cópias (você no botão, a porta, os botões)", &mut fails);
            h.game().zoom = (true, 2.6, 2.6);
            h.shot("relogio-vista.png");
            h.game().zoom = (false, 2.6, 1.0);
            // entra no ciano
            h.aim(Vec3::new(-11.9, 0.92, -9.0));
            h.game().player.pitch = 0.0;
            h.game().events.clear();
            let mut jumped = false;
            {
                h.controls().f = true;
            }
            for _ in 0..120 {
                h.update();
                if h.game().events.iter().any(|e| matches!(e, GameEvent::TimeJump(_))) {
                    jumped = true;
                    break;
                }
            }
            h.controls().f = false;
            let (tw1, clones, pos) = {
                let g = h.game();
                let c = g.relogio.as_ref().unwrap();
                (c.tw, c.live_clones(), g.player.pos)
            };
            println!("saltou {jumped} · tw {tw1:.2} · clones {clones} · você em {pos:.2}");
            check(jumped && clones == 1, "entrar no ciano salta para o passado e deixa um clone", &mut fails);
            check(tw1 < tw0, "o mundo voltou no tempo", &mut fails);
            check(pos.distance(Vec3::new(-5.5, 0.92, -15.0)) < 3.0, "você sai no vermelho, perto da porta", &mut fails);
            // o vermelho que a sua versão do futuro abriu aparece no passado como vermelho de estática
            h.update();
            let st = {
                let g = h.game();
                g.portals.statics.iter().find(|p| p.placed).map(|p| p.center)
            };
            println!("vermelho de estática: {st:?}");
            check(st.is_some_and(|c| c.distance(Vec3::new(-5.5, 1.6, -15.9)) < 1.5), "no passado aparece o vermelho de estática onde ele foi aberto", &mut fails);
            {
                h.aim(Vec3::new(-5.5, 1.6, -15.9));
                h.shot("relogio-estatica.png");
            }
            // (sem o "rebobinar", o mundo anda desde a chegada: o tempo até o clone sair do botão é curto)
            h.frames(10);
            check(!h.game().relogio.as_ref().unwrap().paused, "o tempo volta a andar", &mut fails);
            let feet = h.game().relogio.as_ref().unwrap().feet();
            println!("pés dos clones {feet:?}");
            h.frames(5);
            let held = h.game().world.buttons[0].pressed;
            let door = h.game().world.doors[0].open;
            println!("botão {held} · porta {door:.2}");
            check(held && door > 0.5, "o clone continua no botão e a porta segue aberta", &mut fails);
            h.shot("relogio-clone.png");
            // e você passa pela porta até o elevador
            h.aim(Vec3::new(0.0, 0.92, -19.0));
            h.game().player.pitch = 0.0;
            let mut done = false;
            h.controls().f = true;
            for k in 0..60 * 6 {
                h.update();
                if k % 20 == 0 {
                    h.aim(Vec3::new(0.0, 0.92, -19.0));
                }
                if h.game().player.pos.z < -16.9 || h.game().verify.is_some() {
                    done = true;
                    break;
                }
            }
            h.controls().f = false;
            let p = h.game().player.pos;
            println!("chegou {done} · {p:.2}");
            check(h.game().world.doors[0].open > 0.5 || done, "a porta segue aberta pelo clone", &mut fails);
            check(done, "com o clone segurando, você atravessa a porta", &mut fails);
            h.shot("relogio-porta.png");
            // o par do clone (cinza) aparece quando ele chega ao instante em que disparou
            let mut pair = false;
            for _ in 0..150 {
                h.update();
                let g = h.game();
                if g.portals.list.len() >= 4 && g.portals.list[2].placed && g.portals.list[3].placed && g.portals.list[2].gray {
                    pair = true;
                    break;
                }
            }
            let (n, d3) = {
                let g = h.game();
                (g.portals.list.len(), g.portals.list.get(3).map(|p| p.delta).unwrap_or(0.0))
            };
            println!("portais: {n} · Δ do vermelho do clone {d3:.2}");
            check(pair && (d3 - delta).abs() < 0.01, "o clone tem o par dele (cinza, o vermelho no passado)", &mut fails);
            h.shot("relogio-par.png");
            // paradoxo: um cubo cai em cima do seu passado → o mundo volta ao ponto do salto
            let feet = h.game().relogio.as_ref().unwrap().feet();
            check(!feet.is_empty(), "o clone ainda está vivo", &mut fails);
            if let Some(&f) = feet.first() {
                h.world().resource_scope(|w, mut g: Mut<Game>| {
                    let g = &mut *g;
                    g.props.add_cube(w, &mut g.world, f.x, f.y + 0.8, f.z, false, false, 0.0);
                });
                h.game().events.clear();
                let mut why = None;
                for _ in 0..60 {
                    h.update();
                    if let Some(GameEvent::Paradox(w, _)) = h.game().events.iter().find(|e| matches!(e, GameEvent::Paradox(..))) {
                        why = Some(w.clone());
                        break;
                    }
                }
                println!("paradoxo: {why:?}");
                check(why.is_some(), "um objeto no caminho do passado causa paradoxo", &mut fails);
                h.frames(20);
                let (n, pz, pdx) = {
                    let g = h.game();
                    let c = g.relogio.as_ref().unwrap();
                    (c.live_clones(), g.player.pos.z, c.paradoxes)
                };
                println!("depois: clones {n} · você z {pz:.2} · paradoxos {pdx}");
                check(pz > -16.0 && pdx == 1, "o paradoxo desfaz: você volta para antes do problema", &mut fails);
                h.shot("relogio-paradoxo.png");
            }
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 604: bolas pelo par temporal. O laranja (Δ 2 s) onde a bola do lançador bate: ela sai pelo
        // ciano 2 s depois; depois o contrário: a bola entra no ciano e vai para o passado (sai do laranja)
        "relogio-bolas" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.game().player.pos = Vec3::new(8.0, 0.92, 12.0);
            h.frames(60 * 5);
            let place = |h: &mut Harness, which: usize, origin: Vec3, dir: Vec3, delta: f32| -> bool {
                h.world().resource_scope(|_, mut g: Mut<Game>| {
                    let g = &mut *g;
                    let ok = g.portals.try_place(&g.world, which, origin, dir, false).ok;
                    if delta > 0.0 {
                        g.portals.list[which].delta = delta;
                        g.portals.list[which].placed_tw = g.relogio.as_ref().map(|c| c.tw);
                    }
                    ok
                })
            };
            let room1 = |h: &mut Harness| h.game().energy.pellets.iter().filter(|p| p.pos.z > -5.5).count();
            // 1) laranja temporal na parede leste da sala 2 (onde a bola bate); ciano na parede oeste da sala 1
            let a = place(&mut h, 1, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 2.0);
            let b = place(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0);
            check(a && b, "portais no lugar (vermelho Δ 2 s, ciano)", &mut fails);
            h.game().events.clear();
            let (mut entered, mut out_at) = (None, None);
            for k in 0..60 * 8 {
                h.update();
                let tw = h.game().relogio.as_ref().unwrap().tw;
                if entered.is_none() && h.game().events.iter().any(|e| matches!(e, GameEvent::Energy(portal3::energy::EnergyEvent::Pop(_)))) {
                    entered = Some(tw);
                }
                if entered.is_some() && out_at.is_none() && room1(&mut h) > 0 {
                    out_at = Some(tw);
                }
                h.game().events.clear();
                if out_at.is_some() && k > 60 {
                    break;
                }
            }
            println!("entrou no vermelho em {entered:?}, saiu do ciano em {out_at:?}");
            check(entered.is_some(), "a bola entra no vermelho temporal", &mut fails);
            check(matches!((entered, out_at), (Some(a), Some(b)) if (b - a - 2.0).abs() < 0.3), "e sai pelo ciano Δ s depois", &mut fails);
            // 2) o contrário: ciano onde a bola bate, vermelho (Δ 2 s) na sala 1
            h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.portals.list[0].remove();
                g.portals.list[1].remove();
                g.energy.reset(ecs);
                for l in &mut g.world.launchers {
                    l.pellet = None;
                    l.wait = 0.5;
                }
            });
            h.frames(5);
            let b = place(&mut h, 0, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 0.0);
            let a = place(&mut h, 1, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 2.0);
            check(a && b, "portais trocados (ciano onde a bola bate)", &mut fails);
            let mut sent = false;
            for _ in 0..60 * 6 {
                h.update();
                if room1(&mut h) > 0 {
                    sent = true;
                    break;
                }
            }
            let p = h.game().energy.pellets.iter().map(|p| p.pos).find(|p| p.z > -5.5);
            println!("bola no passado, agora em {p:?}");
            check(sent, "a bola que entra no ciano vai para o passado e aparece onde estaria agora", &mut fails);
            check(p.is_some_and(|p| p.x > -11.0 && p.x < 3.0), "depois de voar Δ s a partir do vermelho", &mut fails);
            h.shot("relogio-bolas.png");
            // 3) um cubo jogado no ciano vai para o passado: sai do vermelho Δ s atrás e cai até agora
            let k = h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.energy.reset(ecs);
                for l in &mut g.world.launchers {
                    l.done = true;
                }
                let k = g.props.add_cube(ecs, &mut g.world, 10.0, 1.3, -12.0, false, false, 0.0);
                let body = g.props.list[k].body;
                if let Some(b) = g.world.phys.body_mut(body) {
                    b.set_linvel(Vec3::new(5.0, 0.5, 0.0), true);
                }
                k
            });
            h.game().events.clear();
            let mut moved = None;
            for _ in 0..60 * 2 {
                h.update();
                let p = h.game().props.list[k].pos;
                if p.z > -5.5 {
                    moved = Some(p);
                    break;
                }
            }
            h.frames(60);
            let p = h.game().props.list[k].pos;
            println!("cubo: saiu em {moved:?}, agora em {p:.2}");
            check(moved.is_some(), "o cubo que entra no ciano vai para o passado (sai do vermelho)", &mut fails);
            check(p.z > -5.5 && p.y < 1.0 && p.x > -11.9, "e já caiu no chão da sala 1 (o voo de Δ s simulado)", &mut fails);
            // 4) torreta do passado: na sala 2, olhando para o vermelho; você na sala 1 na frente do ciano
            h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.portals.list[0].remove();
                g.portals.list[1].remove();
                let opts = portal3::turrets::TurretOpts { scale: None, tippy: false, inactive: false, no_ammo: false };
                g.props.add_turret(ecs, &mut g.world, 0.0, 0.0, -12.0, std::f32::consts::FRAC_PI_2, &opts);
                g.player.pos = Vec3::new(-8.0, 0.92, 6.0);
            });
            h.frames(60 * 3);
            let a = place(&mut h, 1, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 2.0);
            let b = place(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0);
            check(a && b, "portais (vermelho na frente da torreta)", &mut fails);
            h.game().player.pos = Vec3::new(-8.0, 0.92, 6.0);
            h.game().health = 100.0;
            let mut hits = 0;
            let mut min_h = 100.0f32;
            for _ in 0..60 * 2 {
                h.aim(Vec3::new(-11.9, 1.5, 6.0));
                h.update();
                for e in std::mem::take(&mut h.game().events) {
                    if let GameEvent::Hit(n) = e {
                        hits += n;
                    }
                }
                min_h = min_h.min(h.game().health);
            }
            println!("tiros da torreta do passado: {hits} · vida mínima {min_h:.0}");
            check(hits > 0 && min_h < 100.0, "a torreta do passado vê você pelo vermelho e as balas saem do ciano", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // o vermelho de estática (o temporal que a sua versão passada ainda vai abrir): voltando para
        // antes dele (dois laços), a bola que bate ali entra e sai pelo ciano Δ s depois, como da primeira vez
        "relogio-bola-volta" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.game().player.pos = Vec3::new(8.0, 0.92, 12.0);
            h.frames(60 * 12);
            let place = |h: &mut Harness, which: usize, origin: Vec3, dir: Vec3, delta: f32| -> bool {
                h.world().resource_scope(|_, mut g: Mut<Game>| {
                    let g = &mut *g;
                    let ok = g.portals.try_place(&g.world, which, origin, dir, false).ok;
                    if delta > 0.0 {
                        g.portals.list[which].delta = delta;
                        g.portals.list[which].placed_tw = g.relogio.as_ref().map(|c| c.tw);
                    }
                    ok
                })
            };
            let jump = |h: &mut Harness| -> bool {
                h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                    let g = &mut *g;
                    g.player.pos = g.portals.list[0].center + g.portals.list[0].normal * 0.5 - Vec3::Y * 0.15;
                    let ok = g.ch_jump(ecs, 0);
                    g.player.pos = Vec3::new(0.0, 0.92, 12.0);
                    ok
                })
            };
            let tw = |h: &mut Harness| h.game().relogio.as_ref().unwrap().tw;
            // 1º laço: vermelho Δ 8 s na parede leste da sala 2 (onde a bola bate), ciano na sala 1
            let a = place(&mut h, 1, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 8.0);
            let b = place(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0);
            check(a && b, "portais do 1º laço", &mut fails);
            let t_open = tw(&mut h);
            h.frames(60 * 2);
            check(jump(&mut h), "1º salto (8 s)", &mut fails);
            // 2º laço: um par com Δ 4 s leva para antes de o vermelho do 1º laço existir
            h.frames(10);
            let b = place(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0);
            let a = place(&mut h, 1, Vec3::new(-8.0, 1.3, 1.5), Vec3::NEG_X, 4.0);
            check(a && b, "portais do 2º laço", &mut fails);
            check(jump(&mut h), "2º salto (4 s)", &mut fails);
            let arrive = tw(&mut h);
            println!("vermelho do 1º laço aberto em {t_open:.2} (estática a partir de {:.2}); chegada do 2º salto {arrive:.2}", t_open - 8.0);
            let near_o = |p: Vec3| p.x > 10.5 && (p.z + 12.0).abs() < 1.0 && (p.y - 1.2).abs() < 1.2;
            let (mut bounces, mut pops, mut out) = (0, 0, 0);
            let mut seen_static = false;
            h.game().events.clear();
            for k in 0..60 * 12 {
                h.update();
                let t = tw(&mut h);
                let stat = h.game().portals.statics.iter().any(|s| s.placed && s.delta > 0.0 && near_o(s.center));
                seen_static |= stat;
                for e in std::mem::take(&mut h.game().events) {
                    match e {
                        GameEvent::Energy(portal3::energy::EnergyEvent::Bounce(p)) if near_o(p) => {
                            if stat {
                                bounces += 1;
                            }
                            println!("  {k} tw {t:.2} quicou no vermelho em {p:.2} (estática {stat})");
                        }
                        GameEvent::Energy(portal3::energy::EnergyEvent::Pop(p)) if near_o(p) => {
                            pops += 1;
                            println!("  {k} tw {t:.2} entrou no vermelho em {p:.2} (estática {stat})");
                        }
                        GameEvent::Energy(portal3::energy::EnergyEvent::Launch(p)) if p.z > -5.5 => {
                            out += 1;
                            println!("  {k} tw {t:.2} saiu pelo ciano em {p:.2}");
                        }
                        _ => {}
                    }
                }
            }
            check(seen_static, "o vermelho de estática aparece no passado", &mut fails);
            check(bounces == 0, "com a estática lá, a bola não quica na parede", &mut fails);
            check(pops > 0, "ela entra no vermelho de estática", &mut fails);
            check(out > 0, "e sai pelo ciano Δ s depois", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // a bola vai ao passado pelo ciano; voltando no tempo, ela entra no ciano de novo (laço fechado):
        // nada de "a esfera não chegou ao ciano"
        // outra bola cumpre o compromisso: voltando no tempo, a bola que foi ao passado não vem, mas
        // outra entra no mesmo ciano na mesma hora — as bolas são iguais, o laço fecha com ela
        "linha-outra-bola" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            let Some((t1, at)) = ball_loop_then_jump(&mut h, 4.0) else {
                check(false, "a bola vai ao passado e o salto acontece", &mut fails);
                std::process::exit(1);
            };
            // a bola daquela vez não existe mais (nem os lançadores)
            remove_young_balls(&mut h);
            let mut n = 0;
            let mut injected = false;
            while tw(&mut h) < t1 + 3.0 {
                h.update();
                n += paradoxes(&mut h);
                if !injected && tw(&mut h) >= t1 - 0.3 {
                    injected = true;
                    h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                        let g = &mut *g;
                        let blue = (0..g.portals.list.len()).find(|&i| g.portals.list[i].placed && g.portals.list[i].delta == 0.0 && g.portals.list[i].center.distance(at) < 2.0).unwrap();
                        let ev = portal3::energy::EnergyEvent::ToPast { blue, pos: at + Vec3::Y * 0.3, vel: Vec3::X * 6.0, life: 20.0, from: None, uid: 4242 };
                        g.ch_energy_event(ecs, &ev);
                    });
                }
            }
            let g = h.game();
            let l = g.ch_linha().unwrap();
            println!("compromisso {:?}; voos {}", l.compromissos[0].estado, l.voos.len());
            check(n == 0, "sem paradoxo", &mut fails);
            check(matches!(l.compromissos[0].estado, portal3::relogio::linha::Estado::Cumprido(_)), "a outra bola cumpre o compromisso", &mut fails);
            check(l.voos.len() == 1 && l.voos[0].ativo, "ela não vai ao passado de novo (o voo de antes continua)", &mut fails);
            drop(g);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // compromisso quebrado sem dependentes: a bola não volta a entrar no ciano e nada dependia do voo
        // dela no passado — ele some da história, sem paradoxo
        "linha-apagar" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            let Some((t1, _)) = ball_loop_then_jump(&mut h, 4.0) else {
                check(false, "a bola vai ao passado e o salto acontece", &mut fails);
                std::process::exit(1);
            };
            remove_young_balls(&mut h);
            let mut n = 0;
            let mut elder_seen = false;
            while tw(&mut h) < t1 + 2.5 {
                h.update();
                n += paradoxes(&mut h);
                let g = h.game();
                let uid = g.ch_linha().unwrap().voos[0].uid;
                elder_seen |= g.energy.pellets.iter().any(|p| p.uid == uid);
            }
            let g = h.game();
            let l = g.ch_linha().unwrap();
            let uid = l.voos[0].uid;
            println!("compromisso {:?}; voo ativo {} pegou {:?}", l.compromissos[0].estado, l.voos[0].ativo, l.voos[0].cons.pegou);
            check(elder_seen, "a bola mais velha voava no passado depois do salto", &mut fails);
            check(n == 0, "sem paradoxo", &mut fails);
            check(l.compromissos[0].estado == portal3::relogio::linha::Estado::Quebrado && !l.voos[0].ativo, "o compromisso quebra e o voo some da história", &mut fails);
            check(!g.energy.pellets.iter().any(|p| p.uid == uid), "a bola mais velha não está mais no mundo", &mut fails);
            drop(g);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // outro cubo igual faz o papel do que o seu passado usou: você tira o cubo do lugar antes de a sua
        // versão passada pegá-lo, mas deixa outro igual ali — sem paradoxo
        "linha-substituto" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            let a_home = Vec3::new(6.0, 0.0, 12.0);
            let (a, b) = h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = Vec3::new(8.0, 0.92, 12.0);
                let a = g.props.add_cube(ecs, &mut g.world, a_home.x, a_home.y, a_home.z, false, false, 0.0);
                let b = g.props.add_cube(ecs, &mut g.world, 2.0, 0.0, 9.0, false, false, 0.0);
                for l in &mut g.world.launchers {
                    l.done = true;
                }
                (a, b)
            });
            h.frames(60 * 3);
            let a_pos = h.game().props.list[a].pos;
            h.aim(a_pos);
            h.update();
            h.tap(Key::Use);
            check(h.game().held == Some(a), "o jogador pega o cubo A", &mut fails);
            let t_pick = tw(&mut h);
            h.frames(60);
            h.tap(Key::Use);
            h.frames(60);
            let delta = (tw(&mut h) - t_pick) + 1.5;
            let ok = place_portal(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0) && place_portal(&mut h, 1, Vec3::new(-8.0, 1.3, 1.5), Vec3::NEG_X, delta);
            check(ok, "portais para voltar antes de pegar o cubo", &mut fails);
            check(jump_blue(&mut h, Vec3::new(4.0, 0.92, 6.0)), "salto", &mut fails);
            h.frames(3);
            println!("pegou em {t_pick:.2}; chegada {:.2}", tw(&mut h));
            // tira o A do lugar (pega e larga longe) e põe o B onde o A estava
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.held = Some(a);
                g.props.list[a].held = true;
            });
            h.frames(3);
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.release(false);
                g.props.list[a].place(&mut g.world.phys, Vec3::new(0.0, 0.31, 3.0), None, None);
                g.held = Some(b);
                g.props.list[b].held = true;
            });
            h.frames(3);
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.release(false);
                g.props.list[b].place(&mut g.world.phys, a_pos, None, None);
            });
            let r0 = h.game().relogio.as_ref().unwrap().rollbacks;
            let mut n = 0;
            while tw(&mut h) < t_pick + 1.5 {
                h.update();
                n += paradoxes(&mut h);
            }
            let g = h.game();
            let ch = g.relogio.as_ref().unwrap();
            println!("substitutos {} · voltas desfeitas {} · B em {:.2}", ch.stand_ins, ch.rollbacks - r0, g.props.list[b].pos);
            check(n == 0 && ch.rollbacks == r0, "sem paradoxo", &mut fails);
            check(ch.stand_ins >= 1, "o cubo B fez o papel do A", &mut fails);
            check(g.props.list[b].pos.distance(a_pos) > 0.5, "a sua versão passada pegou o B", &mut fails);
            drop(g);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // o laser mandado ao passado: voltando no tempo, a versão passada o manda de novo pelo ciano dela
        // e ele sai do vermelho dela. Se o laser deixa de entrar no ciano (desligado): paradoxo só se o
        // feixe do passado ligou um receptor sozinho ("ancora"); sem consequência, a emissão some ("apagar")
        "linha-laser-ancora" | "linha-laser-apagar" => {
            let mut fails = 0;
            let ancora = cmd == "linha-laser-ancora";
            let mut h = Harness::new(640, 360, Some(400));
            h.frames(10);
            h.game().ch_start();
            h.game().player.pos = Vec3::new(0.0, 0.92, 11.0);
            h.frames(60 * 3);
            let frame = |h: &mut Harness, which: usize, c: Vec3, n: Vec3, delta: f32| -> bool {
                let mut g = h.game();
                let g = &mut *g;
                let solid = (0..g.world.solids.len()).find(|&i| {
                    let b = &g.world.solids[i];
                    let q = c - n * 0.05;
                    q.cmpgt(b.min).all() && q.cmplt(b.max).all()
                });
                g.portals.list[which].set_frame(c, n, Vec3::Y, solid);
                g.portals.list[which].delta = delta;
                g.portals.list[which].placed_tw = g.relogio.as_ref().map(|c| c.tw);
                solid.is_some()
            };
            // 1º laço: o laser entra no ciano (parede x = 20) e vai ao passado; ele sai do vermelho Δ 2 s
            // antes, na parede do fundo: na frente do receptor ("ancora") ou longe dele
            let back = if ancora { Vec3::new(6.0, 1.2, 14.0) } else { Vec3::new(-6.0, 1.2, 14.0) };
            let ok = frame(&mut h, 0, Vec3::new(20.0, 1.2, 6.0), Vec3::NEG_X, 0.0) && frame(&mut h, 1, back, Vec3::NEG_Z, 2.0);
            let t_open = tw(&mut h);
            h.frames(60 * 3);
            let j1 = jump_blue(&mut h, Vec3::new(0.0, 0.92, 11.0));
            // 2º laço: um par com Δ 4 s leva para antes de o feixe sair do vermelho do 1º laço
            h.frames(5);
            let ok2 = frame(&mut h, 0, Vec3::new(-2.0, 1.2, 14.0), Vec3::NEG_Z, 0.0) && frame(&mut h, 1, Vec3::new(-10.0, 1.2, 14.0), Vec3::NEG_Z, 4.0);
            let j2 = jump_blue(&mut h, Vec3::new(0.0, 0.92, 11.0));
            println!("vermelho do 1º laço em {t_open:.2} (o feixe sai dele de {:.2}); chegada do 2º salto {:.2}", t_open - 2.0, tw(&mut h));
            check(ok && ok2 && j1 && j2, "dois laços", &mut fails);
            // o feixe do passado sai do vermelho da versão passada
            let mut lit = false;
            while tw(&mut h) < t_open - 2.0 + 1.0 {
                h.update();
                paradoxes(&mut h);
            }
            {
                let g = h.game();
                let l = g.ch_linha().unwrap();
                lit = lit || l.emissoes.iter().any(|e| !e.liga.is_empty());
                println!("emissões {} · alguma ligou o receptor: {lit}", l.emissoes.len());
                check(l.emissoes.len() > 30, "o laser mandado ao passado está na linha do tempo (as emissões)", &mut fails);
            }
            check(lit == ancora, if ancora { "o feixe do passado liga o receptor (âncora)" } else { "o feixe do passado não liga nada" }, &mut fails);
            let r0 = h.game().relogio.as_ref().unwrap().rollbacks;
            // o laser deixa de entrar no ciano (desligado antes da hora das entradas)
            for l in &mut h.game().world.lasers {
                l.off = true;
            }
            let mut n = 0;
            while tw(&mut h) < t_open + 1.0 && h.game().relogio.as_ref().unwrap().rollbacks == r0 {
                h.update();
                n += paradoxes(&mut h);
            }
            let r1 = h.game().relogio.as_ref().unwrap().rollbacks;
            println!("paradoxos {n} · voltas desfeitas {}", r1 - r0);
            if ancora {
                check(r1 > r0, "sem o laser, o receptor que só ele ligava no passado: paradoxo (o loop se desfaz)", &mut fails);
            } else {
                check(n == 0 && r1 == r0, "sem consequência: a emissão some da história, sem paradoxo", &mut fails);
                let g = h.game();
                let l = g.ch_linha().unwrap();
                check(l.compromissos.iter().any(|c| c.estado == portal3::relogio::linha::Estado::Quebrado) && l.emissoes.iter().any(|e| !e.ativo), "compromissos de laser quebrados e emissões apagadas", &mut fails);
            }
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // um cubo mandado ao passado pelo ciano; voltando para antes, o laço tem de fechar: o mesmo cubo
        // entra de novo ("mesmo"), outro igual entra no lugar dele ("outro") ou nenhum ("apagar": o duplo
        // não apertou nada, então some da história, sem paradoxo)
        "linha-duplo-mesmo" | "linha-duplo-outro" | "linha-duplo-apagar" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            // os dois cubos existem desde o começo da história
            let (k, other) = h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = Vec3::new(8.0, 0.92, 12.0);
                for l in &mut g.world.launchers {
                    l.done = true;
                    l.pellet = None;
                }
                let k = g.props.add_cube(ecs, &mut g.world, 6.0, 0.0, -12.0, false, false, 0.0);
                let o = g.props.add_cube(ecs, &mut g.world, 4.0, 0.0, -9.0, false, false, 0.0);
                (k, o)
            });
            h.frames(60 * 4);
            let ok = place_portal(&mut h, 0, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 0.0) && place_portal(&mut h, 1, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 3.0);
            check(ok, "portais (ciano na sala 2, vermelho Δ 3 s na sala 1)", &mut fails);
            h.frames(60);
            // joga o cubo no ciano
            {
                let mut g = h.game();
                let g = &mut *g;
                g.props.list[k].place(&mut g.world.phys, Vec3::new(10.6, 1.0, -12.0), None, Some(Vec3::new(5.0, 0.5, 0.0)));
            }
            let mut sent = None;
            for _ in 0..120 {
                h.update();
                if let Some(c) = h.game().ch_linha().and_then(|l| l.compromissos.first().cloned()) {
                    sent = Some(c);
                    break;
                }
            }
            let Some(c0) = sent else {
                check(false, "o cubo vai ao passado", &mut fails);
                std::process::exit(1);
            };
            let end = h.game().ch_linha().unwrap().duplos[0].fim().unwrap().0;
            println!("cubo mandado em {:.2}; o duplo chega em {end:.2}", c0.t);
            h.frames(30);
            check(jump_blue(&mut h, Vec3::new(0.0, 0.92, 12.0)), "salto para antes", &mut fails);
            h.frames(3);
            let t_arr = tw(&mut h);
            println!("chegada {t_arr:.2}");
            // "mesmo": o cubo segue a gravação (o trilho) e entra de novo no ciano na hora. Nos outros,
            // você o pega (sai do trilho) e o larga longe; em "outro", joga um cubo igual no ciano na hora
            if cmd != "linha-duplo-mesmo" {
                h.world().resource_scope(|_, mut g: Mut<Game>| {
                    let g = &mut *g;
                    g.held = Some(k);
                    g.props.list[k].held = true;
                });
                h.frames(3);
                h.world().resource_scope(|_, mut g: Mut<Game>| {
                    let g = &mut *g;
                    g.release(false);
                    g.props.list[k].place(&mut g.world.phys, Vec3::new(0.0, 0.31, -9.0), None, None);
                });
            }
            if cmd == "linha-duplo-outro" {
                // o outro cubo também sai do trilho (você o pega e larga)
                h.world().resource_scope(|_, mut g: Mut<Game>| {
                    let g = &mut *g;
                    g.held = Some(other);
                    g.props.list[other].held = true;
                });
                h.frames(3);
                h.game().release(false);
            }
            let mut thrown = cmd != "linha-duplo-outro";
            let mut n = 0;
            while tw(&mut h) < c0.t + 2.0 {
                if !thrown && tw(&mut h) >= c0.t - 0.25 {
                    thrown = true;
                    let mut g = h.game();
                    let g = &mut *g;
                    g.props.list[other].place(&mut g.world.phys, Vec3::new(10.6, 1.0, -12.0), None, Some(Vec3::new(5.0, 0.5, 0.0)));
                }
                h.update();
                n += paradoxes(&mut h);
            }
            let g = h.game();
            let l = g.ch_linha().unwrap();
            let est = l.compromissos[0].estado;
            println!("compromisso {est:?} · duplos {} (ativo {}) · cubo {:.2} · outro {:.2}", l.duplos.len(), l.duplos[0].ativo, g.props.list[k].pos, g.props.list[other].pos);
            check(n == 0, "sem paradoxo", &mut fails);
            check(l.duplos.len() == 1, "nenhum duplo novo (o laço fecha com o que já existia)", &mut fails);
            match cmd {
                "linha-duplo-mesmo" => {
                    check(matches!(est, portal3::relogio::linha::Estado::Cumprido(_)), "o mesmo cubo cumpre o compromisso", &mut fails);
                    check(g.props.list[k].pos.distance(end) < 1.0, "e segue de onde o duplo chegou", &mut fails);
                }
                "linha-duplo-outro" => {
                    check(matches!(est, portal3::relogio::linha::Estado::Cumprido(_)), "o outro cubo cumpre o compromisso", &mut fails);
                    check(g.props.list[other].pos.distance(end) < 1.0, "e é ele que segue de onde o duplo chegou", &mut fails);
                }
                _ => {
                    check(est == portal3::relogio::linha::Estado::Quebrado && !l.duplos[0].ativo, "o compromisso quebra e o duplo some da história", &mut fails);
                }
            }
            drop(g);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // o seu passado pega um cubo com o tempo parado; depois do salto você mexe nele e o deixa no
        // mesmo lugar: ele está onde o seu passado o encontrou — sem paradoxo
        "linha-parado" | "linha-parado-longe" => {
            let mut fails = 0;
            // "longe": você o deixa a 2 m de onde estava — aí sim é paradoxo
            let longe = cmd == "linha-parado-longe";
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            let a_home = Vec3::new(6.0, 0.0, 12.0);
            let a = h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = Vec3::new(8.0, 0.92, 12.0);
                for l in &mut g.world.launchers {
                    l.done = true;
                    l.pellet = None;
                }
                g.props.add_cube(ecs, &mut g.world, a_home.x, a_home.y, a_home.z, false, false, 0.0)
            });
            h.frames(60 * 3);
            let a_pos = h.game().props.list[a].pos;
            // tempo parado: pega o cubo, anda e larga em outro lugar
            h.tap(Key::StopTime);
            h.aim(a_pos);
            h.update();
            h.tap(Key::Use);
            check(h.game().held == Some(a), "com o tempo parado, o passado pega o cubo", &mut fails);
            let t_freeze = tw(&mut h);
            for _ in 0..40 {
                h.game().player.pos.z -= 0.06;
                h.update();
            }
            h.tap(Key::Use);
            h.frames(10);
            let moved = h.game().props.list[a].pos;
            h.tap(Key::StopTime);
            h.frames(60 * 2);
            println!("cubo em {a_pos:.2}, levado (tempo parado em {t_freeze:.2}) para {moved:.2}");
            check(moved.distance(a_pos) > 1.0, "o cubo foi levado para outro lugar", &mut fails);
            let delta = tw(&mut h) - t_freeze + 1.5;
            let ok = place_portal(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0) && place_portal(&mut h, 1, Vec3::new(-8.0, 1.3, 1.5), Vec3::NEG_X, delta);
            check(ok && jump_blue(&mut h, Vec3::new(4.0, 0.92, 6.0)), "salto para antes", &mut fails);
            h.frames(3);
            // você mexe no cubo e o deixa no mesmo lugar
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.held = Some(a);
                g.props.list[a].held = true;
            });
            h.frames(3);
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.release(false);
                let to = if longe { a_pos + Vec3::new(-2.0, 0.0, 0.0) } else { a_pos };
                g.props.list[a].place(&mut g.world.phys, to, None, None);
            });
            let r0 = h.game().relogio.as_ref().unwrap().rollbacks;
            let mut n = 0;
            while tw(&mut h) < t_freeze + 1.5 {
                h.update();
                n += paradoxes(&mut h);
            }
            let g = h.game();
            let r1 = g.relogio.as_ref().unwrap().rollbacks;
            println!("paradoxos {n} · voltas desfeitas {} · cubo {:.2}", r1 - r0, g.props.list[a].pos);
            if longe {
                check(r1 > r0, "o cubo não está onde o seu passado o encontrou: paradoxo", &mut fails);
            } else {
                check(n == 0 && r1 == r0, "o cubo está onde o seu passado o encontrou: sem paradoxo", &mut fails);
                check(g.props.list[a].pos.distance(moved) < 0.8, "e o seu passado o leva para onde levou", &mut fails);
            }
            drop(g);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // com o tempo parado, você entra correndo (muito rápido, VEL m/s, OFF fora do centro) no ciano temporal:
        // o caminho andado com o tempo parado não pode acusar "algo bloqueou" na boca do portal
        "linha-parado-rapido" => {
            let mut fails = 0;
            let f = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse::<f32>().ok()).unwrap_or(d);
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = Vec3::new(2.0, 0.92, -12.0);
                for l in &mut g.world.launchers {
                    l.done = true;
                    l.pellet = None;
                }
            });
            h.frames(60 * 4);
            h.tap(Key::StopTime);
            // CHAO: o ciano no chão (você cai nele de cima); senão, na parede
            let chao = std::env::var("CHAO").is_ok();
            let blue = if chao { place_portal(&mut h, 0, Vec3::new(2.0, 3.0, -12.0), Vec3::NEG_Y, 0.0) } else { place_portal(&mut h, 0, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 0.0) };
            let ok = blue && place_portal(&mut h, 1, Vec3::new(8.0, 1.3, -16.5), Vec3::X, 2.0);
            check(ok, "portais (ciano e vermelho Δ 2 s, com o tempo parado)", &mut fails);
            let (vel, off) = (f("VEL", 30.0), f("OFF", 0.3));
            let n0 = h.game().relogio.as_ref().unwrap().clones.len();
            let mut jumped = false;
            for _ in 0..120 {
                {
                    let mut g = h.game();
                    if !jumped && chao {
                        g.player.vel = Vec3::new(0.0, -vel, 0.0);
                        if g.player.pos.y < 2.0 && g.player.pos.y > 0.5 {
                            g.player.pos = Vec3::new(2.0 + off, 8.0, -12.0 + off * 0.5);
                        }
                    } else if !jumped {
                        g.player.vel = Vec3::new(vel, 0.0, 0.0);
                        if g.player.pos.x < 3.0 {
                            g.player.pos = Vec3::new(3.0, 0.92, -12.0 + off);
                        }
                    }
                }
                h.update();
                jumped = h.game().relogio.as_ref().unwrap().clones.len() > n0;
                if jumped {
                    break;
                }
            }
            check(jumped, "entrou no ciano correndo com o tempo parado (salto)", &mut fails);
            let r0 = h.game().relogio.as_ref().unwrap().rollbacks;
            let mut n = 0;
            for _ in 0..60 * 4 {
                h.update();
                n += paradoxes(&mut h);
            }
            let r1 = h.game().relogio.as_ref().unwrap().rollbacks;
            println!("paradoxos {n} · voltas desfeitas {}", r1 - r0);
            check(n == 0 && r1 == r0, "sem paradoxo de caminho na boca do portal", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // com o tempo parado você abre um par de portais na parede e passa por ele correndo; depois volta no
        // tempo para antes disso: a sua versão passada refaz o caminho (pelo par dela) sem "algo bloqueou"
        "linha-parado-portal" => {
            let mut fails = 0;
            let vel = std::env::var("VEL").ok().and_then(|v| v.parse::<f32>().ok()).unwrap_or(30.0);
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = Vec3::new(2.0, 0.92, -12.0);
                for l in &mut g.world.launchers {
                    l.done = true;
                    l.pellet = None;
                }
            });
            h.frames(60 * 4);
            let t_pause = tw(&mut h);
            h.tap(Key::StopTime);
            // o par normal (Δ 0) na parede branca, com o tempo parado
            let ok = place_portal(&mut h, 0, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 0.0) && place_portal(&mut h, 1, Vec3::new(8.0, 1.3, -16.5), Vec3::X, 0.0);
            check(ok, "portais na parede com o tempo parado", &mut fails);
            let mut crossed = false;
            for _ in 0..90 {
                {
                    let mut g = h.game();
                    if !crossed {
                        g.player.vel = Vec3::new(vel, 0.0, 0.0);
                    }
                }
                h.update();
                let p = h.game().player.pos;
                if !crossed && (p.z + 16.5).abs() < 1.5 {
                    crossed = true;
                }
            }
            check(crossed, "passou pelo portal correndo com o tempo parado", &mut fails);
            h.tap(Key::StopTime);
            h.frames(60 * 2);
            // volta para antes da pausa
            let delta = tw(&mut h) - t_pause + 1.0;
            let ok2 = place_portal(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0) && place_portal(&mut h, 1, Vec3::new(-8.0, 1.3, 1.5), Vec3::NEG_X, delta);
            check(ok2 && jump_blue(&mut h, Vec3::new(0.0, 0.92, 4.0)), "salto para antes da pausa", &mut fails);
            let r0 = h.game().relogio.as_ref().unwrap().rollbacks;
            let mut n = 0;
            while tw(&mut h) < t_pause + 2.0 {
                h.update();
                n += paradoxes(&mut h);
            }
            let r1 = h.game().relogio.as_ref().unwrap().rollbacks;
            println!("paradoxos {n} · voltas desfeitas {}", r1 - r0);
            check(n == 0 && r1 == r0, "a sua versão passada refaz o caminho pelo portal sem paradoxo", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // o contrário: com o tempo parado você anda por um caminho; voltando no tempo, uma parede aparece no
        // meio dele — aí sim "algo bloqueou o caminho do seu passado (com o tempo parado)"
        "linha-parado-bloqueio" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = Vec3::new(2.0, 0.92, -12.0);
                for l in &mut g.world.launchers {
                    l.done = true;
                    l.pellet = None;
                }
            });
            h.frames(60 * 4);
            let t_pause = tw(&mut h);
            h.tap(Key::StopTime);
            for _ in 0..40 {
                h.game().player.vel = Vec3::new(5.0, 0.0, 0.0);
                h.update();
            }
            h.tap(Key::StopTime);
            h.frames(60 * 2);
            let delta = tw(&mut h) - t_pause + 1.0;
            let ok = place_portal(&mut h, 0, Vec3::new(-8.0, 1.3, 6.0), Vec3::NEG_X, 0.0) && place_portal(&mut h, 1, Vec3::new(-8.0, 1.3, 1.5), Vec3::NEG_X, delta);
            check(ok && jump_blue(&mut h, Vec3::new(0.0, 0.92, 4.0)), "salto para antes da pausa", &mut fails);
            // uma parede no meio do caminho que você andou com o tempo parado
            h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.world.add_box(ecs, 4.0, 0.0, -14.0, 4.6, 3.0, -10.0, "metal", true, false, true);
            });
            let r0 = h.game().relogio.as_ref().unwrap().rollbacks;
            let mut why = vec![];
            while tw(&mut h) < t_pause + 2.0 && h.game().relogio.as_ref().unwrap().rollbacks == r0 {
                h.update();
                for e in std::mem::take(&mut h.game().events) {
                    if let GameEvent::Paradox(w, _) = e {
                        why.push(w);
                    }
                }
            }
            println!("paradoxos {why:?}");
            check(why.iter().any(|w| w.contains("bloqueou") && w.contains("tempo parado")), "a parede no caminho andado com o tempo parado: paradoxo", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // o holograma do passado aparece com o tempo parado e some (inteiro, com o seu eu do passado) quando
        // o tempo volta a andar
        "holograma" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.game().player.pos = Vec3::new(2.0, 0.92, -12.0);
            h.frames(60 * 3);
            for _ in 0..30 {
                h.game().player.vel = Vec3::new(4.0, 0.0, 0.0);
                h.update();
            }
            h.tap(Key::StopTime);
            h.frames(10);
            let vis = |h: &mut Harness| -> (bool, bool) {
                let ents = h.game().ch_holo_entities();
                let Some((root, me)) = ents else { return (false, false) };
                let w = h.world();
                let on = |e: Entity| w.get::<Visibility>(e).is_some_and(|v| *v != Visibility::Hidden);
                (on(root), me.is_some_and(on))
            };
            let (r1, m1) = vis(&mut h);
            println!("parado: holograma {r1} · eu do passado {m1}");
            check(r1 && m1, "com o tempo parado, o holograma e o seu eu do passado aparecem", &mut fails);
            h.tap(Key::StopTime);
            h.frames(10);
            let (r2, m2) = vis(&mut h);
            println!("andando: holograma {r2} · eu do passado {m2}");
            check(!r2 && !m2, "com o tempo andando, os dois somem", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        "relogio-bola-laco" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(604));
            h.frames(30);
            h.game().player.pos = Vec3::new(8.0, 0.92, 12.0);
            let f = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse::<f32>().ok()).unwrap_or(d);
            h.frames((60.0 * f("PRE", 12.0)) as usize);
            let place = |h: &mut Harness, which: usize, origin: Vec3, dir: Vec3, delta: f32| -> bool {
                h.world().resource_scope(|_, mut g: Mut<Game>| {
                    let g = &mut *g;
                    let ok = g.portals.try_place(&g.world, which, origin, dir, false).ok;
                    if delta > 0.0 {
                        g.portals.list[which].delta = delta;
                        g.portals.list[which].placed_tw = g.relogio.as_ref().map(|c| c.tw);
                    }
                    ok
                })
            };
            let d = f("DELTA", 4.0);
            // SWAP: vermelho onde a bola bate e ciano na sala 1 (a bola sai do ciano, volta e entra nele)
            let swap = std::env::var("SWAP").is_ok();
            let (wa, wb) = if swap { (1, 0) } else { (0, 1) };
            let b = place(&mut h, wa, Vec3::new(8.0, 1.3, -12.0), Vec3::X, if swap { d } else { 0.0 });
            let a = place(&mut h, wb, Vec3::new(-8.0, 1.3, f("OZ", 6.0)), Vec3::NEG_X, if swap { 0.0 } else { d });
            check(a && b, "portais (ciano onde a bola bate, vermelho temporal na sala 1)", &mut fails);
            let mut paradox = 0;
            let mut count = |h: &mut Harness, tag: &str| {
                let tw = h.game().relogio.as_ref().unwrap().tw;
                for e in std::mem::take(&mut h.game().events) {
                    if let GameEvent::Paradox(why, _) = e {
                        println!("  {tag} tw {tw:.2} paradoxo: {why}");
                        paradox += 1;
                    }
                }
            };
            // espera a bola ir ao passado (aparece na sala 1) e mais AFTER s; salta logo depois
            let mut sent_at = None;
            for _ in 0..(60.0 * f("WAIT", 8.0)) as usize {
                h.update();
                count(&mut h, "antes");
                let tw = h.game().relogio.as_ref().unwrap().tw;
                if sent_at.is_none() && h.game().energy.pellets.iter().any(|p| p.pos.z > -5.5) {
                    sent_at = Some(tw);
                }
                if sent_at.is_some_and(|t| tw > t + f("AFTER", 1.0)) {
                    break;
                }
            }
            println!("a bola chegou na sala 1 em {sent_at:?}");
            let ok = h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                let g = &mut *g;
                g.player.pos = g.portals.list[0].center + g.portals.list[0].normal * 0.5 - Vec3::Y * 0.15;
                let ok = g.ch_jump(ecs, 0);
                g.player.pos = Vec3::new(0.0, 0.92, 12.0);
                ok
            });
            check(ok, "salto", &mut fails);
            let mut room1_after = false;
            for _ in 0..(60.0 * (d + 3.0)) as usize {
                h.update();
                count(&mut h, "depois");
                let tw = h.game().relogio.as_ref().unwrap().tw;
                if sent_at.is_some_and(|t| tw > t + 0.3 && tw < t + 0.8) && h.game().energy.pellets.iter().any(|p| p.pos.z > -5.5) {
                    room1_after = true;
                }
            }
            if !swap && sent_at.is_some() {
                check(room1_after, "voltando, a bola que voava no passado continua lá", &mut fails);
            }
            check(paradox == 0, "sem paradoxo falso", &mut fails);
            // a mesma bola entra no ciano duas vezes seguidas (voltou do passado e entrou de novo):
            // as duas vão ao passado (a segunda não é a "repetição" da primeira)
            if !swap {
                let ok = place(&mut h, 0, Vec3::new(8.0, 1.3, -12.0), Vec3::X, 0.0) && place(&mut h, 1, Vec3::new(-8.0, 1.3, f("OZ", 6.0)), Vec3::NEG_X, d);
                check(ok, "portais de novo", &mut fails);
                h.frames(5);
                let n_room1 = |g: &Game| g.energy.pellets.iter().filter(|p| p.pos.z > -5.5).count();
                let (n0, n1, n2) = h.world().resource_scope(|ecs, mut g: Mut<Game>| {
                    let g = &mut *g;
                    g.energy.reset(ecs);
                    for l in &mut g.world.launchers {
                        l.done = true;
                    }
                    let c = g.portals.list.iter().position(|p| p.placed && p.delta == 0.0 && p.center.x > 10.0);
                    let Some(c) = c else { return (9, 9, 9) };
                    let n = g.portals.list[c].normal;
                    let at = g.portals.list[c].center + n * 0.1;
                    let ev = portal3::energy::EnergyEvent::ToPast { blue: c, pos: at, vel: -n * 6.0, life: 20.0, from: None, uid: 777 };
                    let n0 = n_room1(g);
                    g.ch_energy_event(ecs, &ev);
                    let n1 = n_room1(g);
                    g.relogio.as_mut().unwrap().tw += 0.3;
                    g.ch_energy_event(ecs, &ev);
                    (n0, n1, n_room1(g))
                });
                println!("bolas na sala 1: {n0} → {n1} → {n2}");
                check(n1 == n0 + 1 && n2 == n1 + 1, "a mesma bola entrando no ciano de novo vai ao passado de novo", &mut fails);
            }
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 601: o campo de dilatação entra na linha do tempo; voltando para antes dele, a sua versão
        // do passado o cria de novo na mesma hora e no mesmo lugar
        "relogio-campo" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(601));
            h.frames(30);
            h.game().player.pos = Vec3::new(2.0, 0.92, 0.0);
            h.frames(60);
            {
                let mut c = h.controls();
                c.pressed.push(Key::FireBlue);
                c.pressed.push(Key::FireOrange);
            }
            h.frames(60 * 5 + 10);
            {
                let mut c = h.controls();
                c.released.push(Key::FireBlue);
                c.released.push(Key::FireOrange);
            }
            h.update();
            let (n_ev, t0) = {
                let g = h.game();
                (g.field.events.len(), g.field.events.first().map(|e| e.t0).unwrap_or(0.0))
            };
            println!("campo criado em tw {t0:.2} ({n_ev} na linha do tempo)");
            check(n_ev == 1 && h.game().field.active.len() == 1, "o campo nasce e entra na linha do tempo", &mut fails);
            // (dentro do campo o mundo corre 10×: sai dele)
            h.game().player.pos = Vec3::new(-4.0, 0.92, -6.0);
            h.frames(30);
            h.tap(Key::StopTime);
            h.game().ch_scrub_by(-100.0);
            h.game().ch_scrub_by(4.0);
            h.frames(40);
            h.shoot_at(Key::FireOrange, Vec3::new(-5.5, 1.6, -15.9));
            h.shoot_at(Key::FireBlue, Vec3::new(-11.9, 1.6, -9.0));
            h.tap(Key::StopTime);
            h.game().player.pos = Vec3::new(-10.0, 0.92, -9.0);
            h.aim(Vec3::new(-11.9, 0.92, -9.0));
            h.game().player.pitch = 0.0;
            h.game().events.clear();
            h.controls().f = true;
            let mut jumped = false;
            for _ in 0..120 {
                h.update();
                if h.game().events.iter().any(|e| matches!(e, GameEvent::TimeJump(_))) {
                    jumped = true;
                    break;
                }
            }
            h.controls().f = false;
            h.frames(2);
            let (tw, active) = {
                let g = h.game();
                (g.relogio.as_ref().unwrap().tw, g.field.active.len())
            };
            println!("saltou {jumped} para tw {tw:.2}: campos ativos {active}");
            check(jumped && tw < t0 && active == 0, "voltando para antes do campo, ele ainda não existe", &mut fails);
            h.game().events.clear();
            let mut burst = None;
            for _ in 0..60 * 5 {
                h.update();
                if h.game().events.iter().any(|e| matches!(e, GameEvent::FieldBurst(_))) {
                    let g = h.game();
                    burst = Some((g.relogio.as_ref().unwrap().tw, g.field.active.len(), g.field.active.first().map(|f| f.own)));
                    break;
                }
            }
            println!("reapareceu: {burst:?}");
            check(matches!(burst, Some((t, 1, Some(false))) if (t - t0).abs() < 0.1), "na hora em que foi criado, a sua versão do passado o cria de novo", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // o seu passado pega um cubo que, nesta história, já caiu no vermelho e foi para o futuro: paradoxo
        "relogio-cubo-paradoxo" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(600));
            h.frames(30);
            let k = {
                let mut k = 0;
                h.world().resource_scope(|w, mut g: Mut<Game>| {
                    let g = &mut *g;
                    k = g.props.add_cube(w, &mut g.world, -7.4, 0.4, 5.0, false, false, 0.0);
                });
                k
            };
            h.frames(60 * 6); // o cubo fica parado na história
            // pega o cubo e solta no mesmo lugar: o seu passado tem essa ação gravada
            h.game().player.pos = Vec3::new(-5.6, 0.92, 5.0);
            h.game().player.vel = Vec3::ZERO;
            h.frames(4);
            let cube_pos = h.game().props.list[k].pos;
            h.aim(cube_pos);
            h.update();
            h.tap(Key::Use);
            h.frames(50);
            check(h.game().held == Some(k), "o jogador pega o cubo", &mut fails);
            h.tap(Key::Use); // solta
            h.frames(100);
            h.game().player.pos = Vec3::new(0.0, 0.92, 6.0);
            h.frames(80);
            // tempo parado: o laranja no passado (de antes de pegar o cubo), mirando o cubo; o ciano no presente
            h.tap(Key::StopTime);
            h.game().ch_scrub_by(-100.0);
            let tw = h.game().relogio.as_ref().unwrap().tw;
            h.game().ch_scrub_by(tw - 3.0);
            h.frames(40);
            h.shoot_at(Key::FireBlue, Vec3::new(7.95, 1.09, 5.0));
            h.shoot_at(Key::FireOrange, cube_pos);
            let d = h.game().portals.list[1].delta;
            println!("Δ {d:.2} (tw {tw:.2})");
            h.tap(Key::StopTime);
            h.frames(90);
            let moved = h.game().props.list[k].pos.x > 3.0;
            check(moved, "o cubo sai pelo ciano do presente", &mut fails);
            // tira o cubo da frente do ciano e entra nele: o passado volta
            h.world().resource_scope(|_, mut g: Mut<Game>| {
                let g = &mut *g;
                g.props.list[k].place(&mut g.world.phys, Vec3::new(3.0, 0.31, 8.5), None, Some(Vec3::ZERO));
            });
            h.game().player.pos = Vec3::new(5.5, 0.92, 5.0);
            h.aim(Vec3::new(7.9, 0.92, 5.0));
            h.game().player.pitch = 0.0;
            h.game().events.clear();
            h.controls().f = true;
            let mut jumped = false;
            let mut why: Option<String> = None;
            for _ in 0..60 * 14 {
                h.update();
                let (jump_now, par) = {
                    let g = h.game();
                    (g.events.iter().any(|e| matches!(e, GameEvent::TimeJump(_))), g.events.iter().find_map(|e| if let GameEvent::Paradox(w, _) = e { Some(w.clone()) } else { None }))
                };
                if jump_now {
                    jumped = true;
                    h.controls().f = false;
                }
                if par.is_some() {
                    why = par;
                    break;
                }
            }
            h.controls().f = false;
            println!("saltou {jumped}; paradoxo: {why:?}");
            check(jumped, "o jogador salta para o passado pelo ciano", &mut fails);
            check(why.as_deref().is_some_and(|w| w.contains("cubo que já tinha entrado no vermelho")), "o seu passado usa o cubo que foi para o futuro: paradoxo", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // sequência de efeitos para comparar com a versão web: parado, tiro azul (110, 250, 500 ms depois),
        // tempo lento, tiro vermelho com o tempo lento
        "fx-seq" => {
            let mut h = Harness::new(1280, 720, Some(1));
            h.frames(60 * 7);
            let place = |h: &mut Harness| {
                let mut g = h.game();
                let f = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
                g.player.pos = Vec3::new(f("BX", -2.0), 0.95, f("BZ", 3.5));
                g.player.vel = Vec3::ZERO;
                g.player.yaw = f("BYAW", 1.5708);
                g.player.pitch = 0.0;
            };
            let pre = arg(&args, "--pre").unwrap_or("fxn").to_string();
            place(&mut h);
            h.frames(24);
            h.shot(&format!("{pre}-idle.png"));
            h.controls().pressed.push(Key::FireBlue);
            h.update();
            let mut t = 1;
            for (name, ms) in [("f1", 110.0f32), ("f2", 250.0), ("f3", 500.0)] {
                let n = (ms / 16.67).round() as usize - t;
                for _ in 0..n {
                    place(&mut h);
                    h.update();
                }
                t += n;
                h.shot(&format!("{pre}-{name}.png"));
            }
            h.frames(72);
            h.game().toggle_slow(Some(true));
            for _ in 0..54 {
                place(&mut h);
                h.update();
            }
            h.shot(&format!("{pre}-slow.png"));
            h.controls().pressed.push(Key::FireOrange);
            for _ in 0..18 {
                place(&mut h);
                h.update();
            }
            h.shot(&format!("{pre}-slowfire.png"));
            std::process::exit(0);
        }
        // tiro azul quadro a quadro (comparação com a versão web): "fx-quadros --pre x --n 3,6,9"
        "fx-quadros" => {
            let mut h = Harness::new(1280, 720, Some(1));
            h.frames(60 * 7);
            let place = |h: &mut Harness| {
                let mut g = h.game();
                let f = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
                g.player.pos = Vec3::new(f("BX", -2.0), 0.95, f("BZ", 3.5));
                g.player.vel = Vec3::ZERO;
                g.player.yaw = f("BYAW", 1.5708);
                g.player.pitch = 0.0;
            };
            let pre = arg(&args, "--pre").unwrap_or("sn").to_string();
            let list: Vec<usize> = arg(&args, "--n").unwrap_or("3,6,9,12,18,30,60").split(',').filter_map(|v| v.parse().ok()).collect();
            for _ in 0..30 {
                place(&mut h);
                h.update();
            }
            if std::env::var("SLOWBOLT").is_ok() {
                h.game().toggle_slow(Some(true));
                for _ in 0..40 {
                    place(&mut h);
                    h.update();
                }
            }
            h.shot(&format!("{pre}-s0.png"));
            h.controls().pressed.push(Key::FireBlue);
            h.controls().released.push(Key::FireBlue);
            let mut done = 0;
            for f in list {
                while done < f {
                    place(&mut h);
                    h.update();
                    done += 1;
                }
                h.shot(&format!("{pre}-s{f}.png"));
            }
            std::process::exit(0);
        }
        // andar em cima de uma plataforma que se move: o jogador precisa ficar parado em relação a ela
        "plataforma" => {
            let mut fails = 0;
            for (level, start, label) in [(107i64, Vec3::new(0.0, 0.93, -3.5), "plataforma horizontal"), (108, Vec3::new(5.6, 0.93, 2.5), "plataforma vertical"), (200, Vec3::new(0.0, 0.93, 0.5), "pistão diagonal")] {
                let mut h = Harness::new(640, 360, Some(level));
                h.frames(30);
                // a plataforma que se move (o primeiro "door" que anda: o jogador está em cima dela)
                // (a plataforma da fase 200 vai e volta: espera ela voltar ao começo e põe o jogador no meio dela)
                let start = if level == 200 {
                    let mut at = start;
                    for _ in 0..60 * 12 {
                        h.update();
                        let g = h.game();
                        let d = &g.world.doors[0];
                        if d.open < 0.03 && d.target < 0.5 {
                            let b = &g.world.solids[d.solid];
                            at = Vec3::new((b.min.x + b.max.x) * 0.5, b.max.y + g.player.half.y + 0.02, (b.min.z + b.max.z) * 0.5);
                            break;
                        }
                    }
                    at
                } else {
                    start
                };
                h.game().player.pos = start;
                h.game().player.vel = Vec3::ZERO;
                h.frames(10);
                let (mut worst_dy, mut worst_slip, mut airborne, mut n) = (0.0f32, 0.0f32, 0, 0);
                let mut rel0: Option<Vec3> = None;
                let mut max_vy = 0.0f32;
                for i in 0..60 * 8 {
                    h.update();
                    let g = h.game();
                    let p = g.player.pos;
                    // a plataforma sob os pés: a caixa que andou e está mais perto do jogador
                    let feet = p.y - g.player.half.y;
                    let under = g.world.doors.iter().map(|d| &g.world.solids[d.solid]).filter(|b| p.x > b.min.x - 0.4 && p.x < b.max.x + 0.4 && p.z > b.min.z - 0.4 && p.z < b.max.z + 0.4 && (b.max.y - feet).abs() < 0.6).min_by(|a, b| (a.max.y - feet).abs().total_cmp(&(b.max.y - feet).abs()));
                    if level == 200 && (230..330).contains(&i) && i % 4 == 0 && std::env::var("PORTAL3_DEBUG2").is_ok() {
                        let d = &g.world.doors[0];
                        let b = &g.world.solids[d.solid];
                        println!("  [{i}] open={:.3} tgt={:.0} delta={:?} plat_top={:.2} centro=({:.2},{:.2}) jogador=({:.2},{:.2},{:.2}) chão={:?} ground={:?} vy={:.2}", d.open, d.target, d.delta, b.max.y, (b.min.x + b.max.x) * 0.5, (b.min.z + b.max.z) * 0.5, p.x, p.y, p.z, g.player.grounded, g.player.ground, g.player.vel.y);
                    }
                    if i % 60 == 0 && std::env::var("PORTAL3_DEBUG").is_ok() {
                        let moving: Vec<String> = g.world.doors.iter().map(|d| format!("{:.2}", d.open)).collect();
                        println!("  [{label}] t={}s pos={p:?} chão={:?} doors={moving:?} sob={}", i / 60, g.player.grounded, under.is_some());
                    }
                    let Some(b) = under else { continue };
                    let rel = p - (b.min + b.max) * 0.5;
                    if i < 30 {
                        rel0 = Some(rel);
                        continue;
                    }
                    n += 1;
                    if !g.player.grounded {
                        airborne += 1;
                    }
                    let r0 = rel0.unwrap();
                    worst_dy = worst_dy.max((rel.y - r0.y).abs());
                    worst_slip = worst_slip.max(Vec3::new(rel.x - r0.x, 0.0, rel.z - r0.z).length());
                    max_vy = max_vy.max(g.player.vel.y.abs());
                }
                println!("{label}: quadros {n} · no ar {airborne} · maior variação de altura {worst_dy:.3} m · maior deslize {worst_slip:.3} m · |vy| máx {max_vy:.1}");
                check(n > 0 && airborne * 20 < n && worst_dy < 0.06 && worst_slip < 0.25, &format!("{label}: o jogador acompanha a plataforma sem tremer nem escorregar"), &mut fails);
            }
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // um cubo que estava no passado onde o vermelho abre: cai no portal e sai pelo ciano
        "relogio-cubo" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(600));
            h.frames(30);
            // um cubo no chão, encostado na parede branca da esquerda (x = −8)
            let k = {
                let mut k = 0;
                h.world().resource_scope(|w, mut g: Mut<Game>| {
                    let g = &mut *g;
                    k = g.props.add_cube(w, &mut g.world, -7.4, 0.4, 5.0, false, false, 0.0);
                });
                k
            };
            h.frames(60 * 4); // a história guarda o cubo parado
            h.tap(Key::StopTime);
            h.game().ch_scrub_by(-100.0);
            h.game().ch_scrub_by(2.0);
            h.frames(40);
            let before = h.game().props.list[k].pos;
            println!("cubo antes: {before:?}");
            // ciano no presente (parede da direita) e vermelho no passado, mirando o cubo
            h.game().player.pos = Vec3::new(0.0, 0.92, 6.0);
            h.frames(2);
            h.shoot_at(Key::FireBlue, Vec3::new(7.95, 1.4, 5.0));
            let eye = h.game().player.eye();
            let _ = eye;
            h.shoot_at(Key::FireOrange, before);
            let (placed, delta) = {
                let g = h.game();
                (g.portals.list[1].placed, g.portals.list[1].delta)
            };
            println!("vermelho aberto: {placed} (Δ {delta:.2}) em {:?}", h.game().portals.list[1].center);
            check(placed && delta > 0.5, "mirar no cubo do passado abre o vermelho temporal junto dele", &mut fails);
            h.tap(Key::StopTime);
            h.frames(90);
            let after = h.game().props.list[k].pos;
            let blue = h.game().portals.list[0].center;
            println!("cubo depois: {after:?} (ciano em {blue:?})");
            check(after.distance(before) > 5.0 && after.distance(blue) < 3.5, "o cubo do passado sai pelo ciano do presente", &mut fails);
            // a história: depois de ele cair no portal, o cubo não está mais lá (nem ao olhar nem ao voltar)
            let (gone_mid, gone_n, total) = {
                let g = h.game();
                let ch = g.relogio.as_ref().unwrap();
                let (tp, d) = (g.portals.list[1].placed_tw.unwrap_or(ch.tw), g.portals.list[1].delta);
                // do instante mostrado pelo vermelho quando abriu até o momento em que ele foi aberto
                let after_enter: Vec<_> = ch.samples.iter().filter(|s| s.t > tp - d + 0.3 && s.t < tp - 0.3).collect();
                let gone = after_enter.iter().filter(|s| s.w.props.get(k).is_some_and(|p| p.gone)).count();
                (after_enter.len(), gone, ch.samples.len())
            };
            println!("amostras depois da queda: {gone_mid}, com o cubo ausente: {gone_n} (de {total})");
            check(gone_mid > 5 && gone_n == gone_mid, "na história o cubo some a partir do instante em que caiu no portal", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 400 com o relógio ligado: o laser pelo par temporal
        "relogio-laser" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(400));
            h.frames(10);
            h.game().ch_start();
            h.game().player.pos = Vec3::new(0.0, 0.92, 11.0);
            h.frames(60 * 3);
            println!("vida antes {:.0}", h.game().health);
            // a parede onde o laser bate (x = 20) e a parede do fundo (z = 14), na frente do receptor
            let frame = |h: &mut Harness, which: usize, c: Vec3, n: Vec3, delta: f32| {
                let mut g = h.game();
                let g = &mut *g;
                let solid = (0..g.world.solids.len()).find(|&i| {
                    let b = &g.world.solids[i];
                    let q = c - n * 0.05;
                    q.cmpgt(b.min).all() && q.cmplt(b.max).all()
                });
                g.portals.list[which].set_frame(c, n, Vec3::Y, solid);
                g.portals.list[which].delta = delta;
                g.portals.list[which].placed_tw = g.relogio.as_ref().map(|c| c.tw);
            };
            let wall = Vec3::new(20.0, 1.2, 6.0);
            let back = Vec3::new(6.0, 1.2, 14.0);
            // 1) o laser entra no ciano: vai para o passado (some aqui; nada liga o receptor)
            frame(&mut h, 0, wall, Vec3::NEG_X, 0.0);
            frame(&mut h, 1, back, Vec3::NEG_Z, 2.0);
            h.frames(10);
            let (entries, lz) = {
                let g = h.game();
                let ch = g.relogio.as_ref().unwrap();
                (g.frontier.live_entries.len(), ch.samples.last().map(|s| s.lz.len()).unwrap_or(0))
            };
            let on1 = h.game().world.laser_catchers[0].active;
            println!("entradas no ciano: {entries} (gravadas {lz}) · receptor {on1}");
            check(entries == 1 && lz == 1, "o laser que entra no ciano temporal vai para o passado (gravado)", &mut fails);
            check(!on1, "e não sai de lugar nenhum agora", &mut fails);
            // 2) o contrário: o vermelho (Δ 2 s) onde o laser bate; o feixe do passado entra nele e sai
            // agora pelo ciano, na frente do receptor
            frame(&mut h, 1, wall, Vec3::NEG_X, 2.0);
            frame(&mut h, 0, back, Vec3::NEG_Z, 0.0);
            h.frames(20);
            let on2 = h.game().world.laser_catchers[0].active;
            println!("receptor com o feixe do passado: {on2}");
            check(on2, "o feixe do passado entra no vermelho e sai pelo ciano agora (liga o receptor)", &mut fails);
            h.frames(60);
            let door = h.game().world.doors[0].open;
            check(door > 0.5, "e a porta abre", &mut fails);
            println!("vida {:.0}", h.game().health);
            h.shot("relogio-laser.png");
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // detalhes de fases: o portal que troca de lugar (101), o guincho do poço (4), o túnel (6), o calor (5)
        "extras" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(101));
            h.frames(20);
            let c0 = h.game().portals.list[1].center;
            h.frames(60 * 4 + 10);
            let c1 = h.game().portals.list[1].center;
            println!("portal que troca: {c0:.2} → {c1:.2}");
            check(c0.distance(Vec3::new(14.0, 1.09, -1.0)) < 0.3 && c1.distance(Vec3::new(2.0, 1.09, 4.0)) < 0.3, "o laranja da fase troca de lugar a cada 4 s", &mut fails);
            // o poço: caiu sem portal, o guincho puxa de volta
            {
                let mut g = h.game();
                g.want_idx = g.levels.iter().position(|l| l.id == 4).map(|i| (i, false));
            }
            h.frames(20);
            h.game().player.pos = Vec3::new(0.0, -39.0, 0.0);
            h.frames(60 * 2 + 30);
            let p = h.game().player.pos;
            println!("depois de cair no poço: {p:.2}");
            check(p.y > -1.0, "caiu sem portal: o guincho puxa de volta", &mut fails);
            // o túnel
            {
                let mut g = h.game();
                g.want_idx = g.levels.iter().position(|l| l.id == 6).map(|i| (i, false));
            }
            h.frames(20);
            h.game().player.pos = Vec3::new(0.0, -20.0, 0.0);
            h.game().player.vel = Vec3::new(0.0, -20.0, 0.0);
            h.frames(10);
            let (inside, g) = {
                let g = h.game();
                (g.in_tube, g.gravity().at(g.player.pos).y)
            };
            println!("no túnel: {inside} · gravidade {g:.2}");
            check(inside && g.abs() < 9.0, "dentro do túnel (a gravidade diminui)", &mut fails);
            h.shot("extras-tubo.png");
            // do outro lado: a ajuda da borda
            let mut assisted = false;
            for _ in 0..60 * 20 {
                h.update();
                if h.game().assist.is_some() {
                    assisted = true;
                }
                if h.game().player.up_sign < 0.0 && h.game().player.grounded && !h.game().in_tube {
                    break;
                }
            }
            let p = h.game().player.pos;
            println!("do outro lado: {p:.2} (ajuda {assisted})");
            check(h.game().player.up_sign < 0.0 && p.y < -150.0, "atravessa até o outro lado do mundo", &mut fails);
            check(assisted && (p.x.abs() > 2.6 || p.z.abs() > 2.6), "e a borda ajuda a sair da boca do túnel", &mut fails);
            // calor
            {
                let mut g = h.game();
                g.want_idx = g.levels.iter().position(|l| l.id == 5).map(|i| (i, false));
            }
            h.frames(30);
            h.shot("extras-calor.png");
            // a amostra na rocha fundida: queima (cópia se desfazendo, faíscas) e volta ao dispensador
            h.game().player.pos = Vec3::new(5.0, 0.92, 3.0);
            h.aim(Vec3::new(4.0, -1.0, -1.5));
            h.frames(5);
            {
                let mut g = h.game();
                let g = &mut *g;
                g.props.list[0].place(&mut g.world.phys, Vec3::new(4.0, -1.5, -1.5), None, None);
            }
            h.frames(3);
            let n = h.game().dissolves.len();
            let home = h.game().props.list[0].pos;
            println!("desfazendo: {n} · amostra em {home:.2}");
            check(n == 1 && home.y > -1.0, "na rocha fundida a amostra queima e volta", &mut fails);
            h.frames(12);
            h.shot("extras-queima.png");
            h.frames(60);
            check(h.game().dissolves.is_empty(), "e a cópia some em ~1,2 s", &mut fails);
            {
                let mut g = h.game();
                g.player.pos = Vec3::new(5.0, 0.92, 5.2);
                let at = Transform::from_xyz(5.0, 1.2, 3.0);
                let m = g.props.list[0].mesh;
                g.dissolve_at(m, at, portal3::dissolver::BURN, false);
            }
            h.aim(Vec3::new(5.0, 0.3, 3.0));
            h.frames(1);
            {
                let w = h.world();
                let m = w.resource::<Game>().props.list[0].mesh;
                w.entity_mut(m).insert(Visibility::Hidden);
            }
            h.frames(24);
            h.shot("extras-queima2.png");
            // fósseis (fase 5) e o mapa livre: cristais
            {
                let mut g = h.game();
                g.want_idx = g.levels.iter().position(|l| l.id == 7).map(|i| (i, false));
            }
            h.frames(30);
            let n = h.game().crystals.len();
            check(n == 12 && h.game().gems == Some((0, 12)), "o mapa livre tem 12 cristais", &mut fails);
            let spots: Vec<Vec3> = h.game().crystals.iter().map(|c| c.pos).collect();
            h.game().player.pos = spots[0];
            h.frames(3);
            check(h.game().gems == Some((1, 12)), "chegando perto, o cristal é pego", &mut fails);
            for p in spots.iter().skip(1) {
                h.game().player.pos = *p;
                h.frames(2);
            }
            h.frames(60 * 3);
            let (done, title) = { let g = h.game(); (g.completed, g.done_info().map(|d| d.0)) };
            println!("todos os cristais: fim {done} · {title:?}");
            check(done && title.as_deref() == Some("Mina explorada!"), "os doze: a mina foi explorada", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // chefe B01: o foguete travado em você passa pelo ciano e sai do vermelho no crânio; o núcleo
        // que cai vai para a fornalha; três vezes, e a porta de trás abre
        "chefe" => {
            let mut fails = 0;
            let mut h = Harness::new(960, 540, Some(500));
            h.frames(20);
            check(h.game().boss.is_some(), "a fase tem o chefe", &mut fails);
            // (as bolas dos olhos varrem o salão: fora do teste)
            for l in &mut h.game().world.launchers {
                l.done = true;
            }
            {
                let mut g = h.game();
                let g = &mut *g;
                let c = Vec3::new(0.0, 1.7, -10.2);
                let solid = (0..g.world.solids.len()).find(|&i| {
                    let b = &g.world.solids[i];
                    let q = c + Vec3::Z * 0.05;
                    q.cmpgt(b.min).all() && q.cmplt(b.max).all()
                });
                g.portals.list[0].set_frame(c, Vec3::NEG_Z, Vec3::Y, solid);
            }
            h.frames(60 * 3);
            for round in 0..3u32 {
                h.game().player.pos = Vec3::new(0.0, 0.92, -11.4);
                h.aim(Vec3::new(0.0, 2.0, -38.0));
                h.game().events.clear();
                let mut fired = false;
                for _ in 0..60 * 10 {
                    h.update();
                    if h.game().events.iter().any(|e| matches!(e, GameEvent::RocketShot(_))) {
                        fired = true;
                        break;
                    }
                    h.game().events.clear();
                }
                // sai da frente: o foguete segue reto até o ciano
                h.game().player.pos = Vec3::new(9.0, 0.92, -16.0);
                let mut hit = false;
                for _ in 0..60 * 5 {
                    h.update();
                    if h.game().boss.as_ref().unwrap().stage == round + 1 {
                        hit = true;
                        break;
                    }
                }
                println!("rodada {}: disparou {fired} · acertou o crânio {hit} · vida {:.0}", round + 1, h.game().health);
                check(fired && hit, "o foguete volta pelo portal e acerta o crânio", &mut fails);
                if round == 0 {
                    h.shot("chefe-acerto.png");
                }
                h.frames(60);
                let core = h.game().boss.as_ref().unwrap().core;
                check(core.is_some(), "cai um núcleo da boca", &mut fails);
                // leva o núcleo até a fornalha
                if let Some(k) = core {
                    let mut g = h.game();
                    let g = &mut *g;
                    let body = g.props.list[k].body;
                    g.props.list[k].place(&mut g.world.phys, Vec3::new(0.0, 1.2, -28.0), None, None);
                    let _ = body;
                }
                let mut burned = false;
                for _ in 0..60 * 4 {
                    h.update();
                    if h.game().boss.as_ref().unwrap().burned == round + 1 {
                        burned = true;
                        break;
                    }
                }
                check(burned, "o núcleo queima na fornalha", &mut fails);
            }
            h.frames(60 * 3);
            let (calm, door) = {
                let g = h.game();
                (g.boss.as_ref().unwrap().calm, g.world.doors.iter().find(|d| d.id.as_deref() == Some("exit")).map(|d| d.open).unwrap_or(0.0))
            };
            println!("calmo {calm} · porta {door:.2}");
            check(calm && door > 0.5, "com os três queimados ele se acalma e a porta de trás abre", &mut fails);
            h.set_cam(Vec3::new(0.0, 1.65, -14.0), 0.0, 0.42);
            h.shot("chefe-calmo.png");
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // inglês: os textos da tela, as placas e o fim de câmara traduzidos
        "idioma" => {
            let mut fails = 0;
            unsafe { std::env::set_var("PORTAL3_LANG", "en") };
            let mut h = Harness::new(960, 540, Some(1));
            h.frames(30);
            let texts: Vec<String> = {
                let w = h.world();
                let mut q = w.query::<&Text>();
                q.iter(w).map(|t| t.0.clone()).collect()
            };
            let has = |s: &str| texts.iter().any(|t| t.contains(s));
            println!("textos: {:?}", texts.iter().filter(|t| t.len() < 40).take(12).collect::<Vec<_>>());
            check(has("The Workbench") && has("CHAMBER 01"), "o nome e o rótulo da câmara em inglês", &mut fails);
            check(!has("Câmara") && !has("TEMPO LENTO"), "sem português na tela", &mut fails);
            let t = h.game().done_info().map(|d| d.0).unwrap_or_default();
            println!("fim: {t}");
            check(t.contains("complete"), "o fim de câmara em inglês", &mut fails);
            portal3::i18n::set_en(false);
            check(portal3::i18n::tl("Mapa livre") == "Mapa livre" && portal3::hud::level_label(&h.game().levels[0].clone()) == "Câmara 01", "e de volta ao português", &mut fails);
            h.shot("idioma.png");
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // editor de níveis: abre um nível novo, abre células, põe botão + porta ligados e um cubo,
        // desfaz/refaz, testa (o nível vira fase jogável) e volta, sai (aparece em Meus níveis)
        // abre um nível do editor salvo em arquivo (NIVEL=caminho) e anda alguns segundos, medindo cada quadro
        "nivel" => {
            let mut fails = 0;
            let path = std::env::var("NIVEL").expect("NIVEL=arquivo.json");
            let txt = std::fs::read_to_string(&path).unwrap();
            let v: serde_json::Value = serde_json::from_str(&txt).unwrap();
            let doc = portal3::editor::doc::Doc::normalize(&v).unwrap();
            let mut h = Harness::new(1280, 720, None);
            h.frames(10);
            let i = {
                let mut g = h.game();
                let n = g.levels.len();
                let def = doc.compile(n);
                g.levels.push(def);
                n
            };
            let t0 = std::time::Instant::now();
            h.game().start_level(i);
            let mut worst = 0.0f64;
            for k in 0..240 {
                let t = std::time::Instant::now();
                h.update();
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                worst = worst.max(ms);
                if k < 8 || ms > 200.0 {
                    let g = h.game();
                    println!("  quadro {k}: {ms:.0} ms · rodando {} · menu {} · fase {:?}", g.running, g.menu, g.level);
                }
            }
            let g = h.game();
            println!("total {:.1} s · pior quadro {worst:.0} ms · rodando {} · jogador {:.2}", t0.elapsed().as_secs_f64(), g.running, g.player.pos);
            check(g.running && !g.menu, "a fase abre e anda", &mut fails);
            drop(g);
            h.shot("nivel.png");
            h.frames(3);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        "editor" => {
            let mut fails = 0;
            portal3::editor::store::clear();
            let mut h = Harness::new(1280, 720, None);
            h.frames(30);
            h.game().editor_req = Some(None);
            h.frames(10);
            let (editing, n_cells, solids) = {
                let g = h.game();
                (g.editing, g.editor.as_ref().map(|e| e.doc.chamber.open.len()).unwrap_or(0), g.world.solids.iter().filter(|s| s.cell.is_some()).count())
            };
            println!("editando {editing} · células {n_cells} · blocos {solids}");
            check(editing && n_cells == 2 && solids > 10, "o editor abre um nível novo (duas células, paredes em volta)", &mut fails);
            // abre mais células: um corredor de 4 × 2
            {
                let mut g = h.game();
                let ed = g.editor.as_mut().unwrap();
                ed.push_undo();
                for i in -1..=1 {
                    for k in -2..=0 {
                        ed.doc.chamber.set_open([i, 0, k], true);
                    }
                }
                ed.changed();
            }
            h.frames(5);
            let cells = h.game().editor.as_ref().unwrap().doc.chamber.open.len();
            check(cells == 9, "abre células (a câmara cresce)", &mut fails);
            // itens: botão de piso, porta numa face, cubo — e liga o botão à porta
            let (b, d) = {
                let mut g = h.game();
                let ed = g.editor.as_mut().unwrap();
                let mut o = serde_json::Map::new();
                o.insert("p".into(), serde_json::json!([4, 0, -4]));
                let b = ed.add_item("button", o);
                let mut o = serde_json::Map::new();
                o.insert("p".into(), serde_json::json!([0, 2, -10]));
                o.insert("sig".into(), serde_json::json!(""));
                let d = ed.add_item("door", o);
                let mut o = serde_json::Map::new();
                o.insert("p".into(), serde_json::json!([-4, 0, -4]));
                ed.add_item("cube", o);
                (b, d)
            };
            let linked = h.game().editor.as_mut().unwrap().link(&b, &d);
            h.frames(5);
            let (doors, buttons, cubes, sig) = {
                let g = h.game();
                let ed = g.editor.as_ref().unwrap();
                let bo = portal3::editor::doc::st(ed.item(&b).unwrap(), "opens");
                let ds = portal3::editor::doc::st(ed.item(&d).unwrap(), "sig");
                (g.world.doors.len(), g.world.buttons.len(), g.props.list.len(), (bo, ds))
            };
            println!("portas {doors} · botões {buttons} · cubos {cubes} · sinal {sig:?} · cubo em {:?}", h.game().props.list.first().map(|p| p.pos));
            check(linked && sig.0 == sig.1 && !sig.0.is_empty(), "liga o botão à porta (mesmo sinal)", &mut fails);
            check(doors == 1 && buttons == 1 && cubes == 1, "o mundo se refaz com os itens", &mut fails);
            // desfazer e refazer
            let n = h.game().editor.as_ref().unwrap().doc.items.len();
            h.game().editor.as_mut().unwrap().do_undo();
            h.frames(3);
            let n1 = h.game().editor.as_ref().unwrap().doc.items.len();
            h.game().editor.as_mut().unwrap().do_redo();
            h.frames(3);
            let n2 = h.game().editor.as_ref().unwrap().doc.items.len();
            println!("itens {n} → desfaz {n1} → refaz {n2}");
            check(n1 == n && n2 == n, "desfazer volta a ligação e refazer a refaz", &mut fails);
            // o mouse: na aba Câmara, um clique abre a célula apontada; na de Itens, põe o item armado
            {
                let mut g = h.game();
                let g = &mut *g;
                let mut ed = g.editor.take().unwrap();
                ed.set_tab(portal3::editor::state::Tab::Chamber);
                ed.build = portal3::editor::state::Build::Add;
                portal3::editor::input::click(&mut ed, &g.world, Vec3::new(0.0, 10.0, 4.0), Vec3::NEG_Y, false);
                ed.end_stroke();
                let opened = ed.doc.chamber.is_open([0, 0, 1]);
                ed.set_tab(portal3::editor::state::Tab::Items);
                ed.armed = Some("crystal");
                portal3::editor::input::click(&mut ed, &g.world, Vec3::new(4.3, 3.0, -0.6), Vec3::NEG_Y, false);
                let placed = ed.doc.items.iter().find(|i| portal3::editor::doc::st(i, "type") == "crystal").map(|i| portal3::editor::doc::v3(i, "p"));
                println!("célula aberta pelo clique {opened} · cristal em {placed:?}");
                g.editor = Some(ed);
                check(opened && placed == Some(Vec3::new(4.0, 0.0, 0.0)), "clique abre célula e põe o item armado no encaixe", &mut fails);
            }
            h.frames(3);
            // colocar pelo encaixe: um botão de piso no chão da célula
            let (p, _) = h.game().editor.as_ref().unwrap().placement_for("button", Vec3::new(4.7, 0.0, -7.3), Vec3::Y, 0);
            check(p == Vec3::new(4.0, 0.0, -8.0), "o item de chão encaixa no centro da célula", &mut fails);
            h.frames(40);
            {
                let m = h.game().props.list[0].mesh;
                let w = h.world();
                println!("malha do cubo: {:?} · {:?} · {:?}", w.get::<Transform>(m).map(|t| t.translation), w.get::<GlobalTransform>(m).map(|t| t.translation()), w.get::<InheritedVisibility>(m));
            }
            h.shot("editor.png");
            {
                let mut g = h.game();
                let ed = g.editor.as_mut().unwrap();
                ed.cam.pos = Vec3::new(-1.5, 2.2, -1.5);
                ed.cam.yaw = std::f32::consts::FRAC_PI_4;
                ed.cam.pitch = -0.45;
            }
            h.frames(5);
            h.shot("editor-perto.png");
            // ferramentas: validação, alcance, trajetória
            portal3::editor::tools::set_tool(h.game().editor.as_mut().unwrap(), portal3::editor::state::Tool::Validate);
            h.frames(3);
            let issues: Vec<(String, String)> = h.game().editor.as_ref().unwrap().tools.issues.iter().map(|i| (i.level.to_string(), i.text.clone())).collect();
            println!("validação: {issues:?}");
            check(!issues.is_empty() && !issues.iter().any(|i| i.0 == "erro"), "validar: sem erros (partida, saída, câmara)", &mut fails);
            {
                let mut g = h.game();
                let ed = g.editor.as_mut().unwrap();
                portal3::editor::tools::set_tool(ed, portal3::editor::state::Tool::Reach);
                ed.tools.reach.run = true;
            }
            let mut done = false;
            for _ in 0..600 {
                h.update();
                let g = h.game();
                let r = &g.editor.as_ref().unwrap().tools.reach;
                if r.job.is_none() && !r.cells.is_empty() {
                    done = true;
                    break;
                }
            }
            let rep = h.game().editor.as_ref().unwrap().tools.reach.report.clone();
            println!("alcance: {rep:?}");
            check(done && rep.iter().any(|l| l.contains("✔")), "alcance: o elevador de saída é alcançável", &mut fails);
            h.shot("editor-alcance.png");
            {
                let mut g = h.game();
                let ed = g.editor.as_mut().unwrap();
                let mut o = serde_json::Map::new();
                o.insert("p".into(), serde_json::json!([-4, 0, 0]));
                o.insert("mode".into(), serde_json::json!("vel"));
                o.insert("vel".into(), serde_json::json!([0, 9, -4]));
                ed.add_item("plate", o);
            }
            h.frames(3);
            portal3::editor::tools::set_tool(h.game().editor.as_mut().unwrap(), portal3::editor::state::Tool::Traj);
            h.frames(3);
            let traj = h.game().editor.as_ref().unwrap().tools.traj.report.clone();
            println!("trajetória: {traj:?}");
            check(traj.iter().any(|l| l.starts_with("Placa 1")), "trajetória: o arco da placa de lançamento", &mut fails);
            h.shot("editor-trajetoria.png");
            portal3::editor::tools::set_tool(h.game().editor.as_mut().unwrap(), portal3::editor::state::Tool::Traj);
            // testar: vira fase jogável
            h.game().editor.as_mut().unwrap().req.test = true;
            h.frames(30);
            let (running, mine, sp) = {
                let g = h.game();
                (g.running && !g.editing, g.level.map(|i| g.levels[i].series.as_deref() == Some("mine")).unwrap_or(false), g.player.pos)
            };
            println!("testando: jogando {running} · nível do editor {mine} · jogador {sp:.2}");
            check(running && mine && sp.distance(Vec3::new(0.0, 0.92, 0.0)) < 0.3, "▶ Testar joga o nível (no ponto de partida)", &mut fails);
            // pisa no botão: a porta abre
            h.game().player.pos = Vec3::new(4.0, 0.92, -4.0);
            h.frames(90);
            let open = h.game().world.doors[0].open;
            check(open > 0.5, "no teste, o botão abre a porta ligada", &mut fails);
            h.shot("editor-teste.png");
            // até a saída: o caminho vira a prova gravada
            h.game().player.pos = Vec3::new(0.0, 0.92, -4.0);
            for _ in 0..240 {
                h.update();
                if h.game().completed {
                    break;
                }
            }
            let proof = portal3::editor::tools::proof_state(&h.game().editor.as_ref().unwrap().doc);
            println!("completou {} · prova {proof}", h.game().completed);
            check(h.game().completed && proof == "válida ✔", "completar o teste grava a prova (robô)", &mut fails);
            h.game().editor_resume();
            h.frames(10);
            check(h.game().editing && !h.game().running, "volta do teste para o editor", &mut fails);
            h.game().editor.as_mut().unwrap().req.exit = true;
            h.frames(10);
            let (menu, saved, listed) = {
                let g = h.game();
                (g.menu, portal3::editor::store::list().len(), g.levels.iter().filter(|l| l.series.as_deref() == Some("mine")).count())
            };
            check(menu && saved == 1 && listed == 1, "sai salvo: aparece em Meus níveis", &mut fails);
            h.frames(30);
            h.shot("editor-menu.png");
            portal3::editor::store::clear();
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // mecanismos: dispensador, grade de desintegração, dicas por tempo, gatilho de fala, rocha
        // fundida, esmagadores, zona de gravidade e buraco negro, botão de apertar (modos)
        "mecanismos" => {
            let mut fails = 0;
            let goto = |h: &mut Harness, id: i64| {
                let mut g = h.game();
                g.want_idx = g.levels.iter().position(|l| l.id == id).map(|i| (i, false));
            };
            let lines = |h: &mut Harness| -> Vec<String> {
                h.game().events.iter().filter_map(|e| if let GameEvent::Lines(l) = e { Some(l.iter().map(|x| x.1.clone()).collect::<Vec<_>>().join(" ")) } else { None }).collect()
            };
            let died = |h: &mut Harness| h.game().events.iter().find_map(|e| if let GameEvent::Died(w) = e { Some(w.clone()) } else { None });
            let mut h = Harness::new(640, 360, Some(100));
            h.frames(30);
            let cube = h.game().props.list.first().map(|p| p.pos);
            println!("cubo do dispensador: {cube:?}");
            check(cube.is_some_and(|p| (p.x - 3.0).abs() < 0.5 && (p.z + 3.0).abs() < 0.5), "o dispensador solta o cubo embaixo dele", &mut fails);
            // grade: com portais abertos, atravessá-la apaga os portais
            {
                let mut g = h.game();
                let g = &mut *g;
                // (em qualquer parede que aceita portal: as duas bocas lado a lado)
                // (a única superfície que aceita portal na fase é o chão branco)
                let i = (0..g.world.solids.len()).find(|&i| g.world.solids[i].portalable).unwrap();
                g.portals.list[0].set_frame(Vec3::new(-3.0, 0.0, 0.0), Vec3::Y, Vec3::NEG_Z, Some(i));
                g.portals.list[1].set_frame(Vec3::new(3.0, 0.0, 0.0), Vec3::Y, Vec3::NEG_Z, Some(i));
                g.player.pos = Vec3::new(0.0, 0.92, -14.6);
            }
            h.frames(2);
            {
                let g = h.game();
                println!("antes da grade: portais {} {} · grades {:?}", g.portals.list[0].placed, g.portals.list[1].placed, g.world.fizzlers.iter().map(|f| (f.on, f.min, f.max)).collect::<Vec<_>>());
            }
            h.game().events.clear();
            h.game().player.pos = Vec3::new(0.0, 0.92, -15.9);
            h.frames(2);
            let fizz = h.game().events.iter().any(|e| matches!(e, GameEvent::Fizzle));
            let gone = !h.game().portals.list[0].placed && !h.game().portals.list[1].placed;
            check(fizz && gone, "atravessar a grade apaga os portais", &mut fails);
            // dica por tempo (aos 35 s)
            h.game().level_time = 34.9;
            h.game().events.clear();
            h.frames(12);
            let l = lines(&mut h);
            check(!l.is_empty(), "a dica da fase aparece na hora marcada", &mut fails);
            // gatilho de fala (fase 1)
            goto(&mut h, 1);
            h.frames(20);
            h.game().events.clear();
            h.game().player.pos = Vec3::new(0.0, 0.92, -3.0);
            h.frames(5);
            let l = lines(&mut h);
            println!("gatilho: {l:?}");
            check(l.iter().any(|x| x.contains("vão é largo")), "entrar no gatilho dispara a fala", &mut fails);
            // rocha fundida mata (fase 5)
            goto(&mut h, 5);
            h.frames(20);
            h.game().events.clear();
            h.game().player.pos = Vec3::new(0.0, -1.0, -10.0);
            h.frames(5);
            let d = died(&mut h);
            println!("morte: {d:?}");
            check(d.is_some(), "encostar na rocha fundida mata", &mut fails);
            // esmagadores (fase 201): andam, e quem fica embaixo morre esmagado
            goto(&mut h, 201);
            h.frames(20);
            let o0 = h.game().world.doors[0].open;
            h.frames(30);
            let o1 = h.game().world.doors[0].open;
            check((o0 - o1).abs() > 1e-3, "os pistões se movem", &mut fails);
            h.game().events.clear();
            let mut d = None;
            for _ in 0..60 * 4 {
                h.game().player.pos = Vec3::new(0.0, 0.92, -8.0);
                h.update();
                if let Some(w) = died(&mut h) {
                    d = Some(w);
                    break;
                }
            }
            println!("esmagado: {d:?}");
            check(d.as_deref() == Some("esmagado"), "embaixo do pistão, morre esmagado", &mut fails);
            // gravidade (fase 402): zona invertida e buraco negro
            goto(&mut h, 402);
            h.frames(20);
            let (gz, bh) = {
                let g = h.game();
                let gr = g.gravity();
                (gr.at(Vec3::new(-8.0, 5.0, -10.0)), gr.at(Vec3::new(6.0, 8.0, -58.0)))
            };
            println!("gravidade na zona {gz:.2} · perto do buraco negro {bh:.2}");
            check(gz.y > 5.0, "a zona de gravidade puxa para cima", &mut fails);
            check(bh.z < -1.0, "o buraco negro puxa na direção dele", &mut fails);
            // botão de apertar (nível do editor): modo interruptor liga e desliga a porta
            {
                let mut d = portal3::editor::doc::Doc::new("botões");
                for k in -2..=0 {
                    d.chamber.set_open([0, 0, k], true);
                }
                let mut o = serde_json::Map::new();
                o.insert("p".into(), serde_json::json!([0, 0, -2]));
                o.insert("opens".into(), serde_json::json!("A"));
                o.insert("mode".into(), serde_json::json!("toggle"));
                d.add("pushButton", o);
                let mut o = serde_json::Map::new();
                o.insert("p".into(), serde_json::json!([0, 2, -10]));
                o.insert("sig".into(), serde_json::json!("A"));
                d.add("door", o);
                let def = d.compile(0);
                let mut g = h.game();
                g.levels.push(def);
                let i = g.levels.len() - 1;
                g.want_idx = Some((i, false));
            }
            h.frames(20);
            let n = h.game().world.push_buttons.len();
            h.world().resource_scope(|_, mut g: Mut<Game>| g.world.press_button(0));
            h.frames(90);
            let open1 = h.game().world.doors.first().map(|d| d.open).unwrap_or(0.0);
            h.world().resource_scope(|_, mut g: Mut<Game>| g.world.press_button(0));
            h.frames(150);
            let open2 = h.game().world.doors.first().map(|d| d.open).unwrap_or(1.0);
            println!("botões {n} · porta depois de apertar {open1:.2} · de novo {open2:.2}");
            check(n == 1 && open1 > 0.9 && open2 < 0.1, "botão de apertar no modo interruptor liga e desliga a porta", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // todas as fases: carregam sem chamada desconhecida, o jogador começa parado no chão e vivo
        "todas" => {
            let mut fails = 0;
            let mut h = Harness::new(480, 270, Some(1));
            h.frames(10);
            let ids: Vec<(usize, i64, String)> = h.game().levels.iter().enumerate().filter(|(_, l)| l.series.as_deref() != Some("mine")).map(|(i, l)| (i, l.id, l.name.clone())).collect();
            let mut bad = vec![];
            for (i, id, name) in &ids {
                h.game().want_idx = Some((*i, false));
                h.frames(2);
                h.game().events.clear();
                h.frames(60);
                let (died, fell, solids, grounded) = {
                    let g = h.game();
                    let died = g.events.iter().any(|e| matches!(e, GameEvent::Died(_)));
                    let sp = g.data.get("spawn").and_then(|v| v.as_array()).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect::<Vec<_>>()).unwrap_or_default();
                    let fell = sp.len() >= 3 && (g.player.pos.y - sp[1]).abs() > 2.0 && *id != 6;
                    (died, fell, g.world.solids.len(), g.player.grounded)
                };
                if died || fell || solids == 0 || !grounded {
                    bad.push(format!("{id} {name}: morreu {died} · caiu {fell} · sólidos {solids} · no chão {grounded}"));
                }
            }
            for b in &bad {
                println!("problema: {b}");
            }
            println!("{} fases carregadas", ids.len());
            check(bad.is_empty(), "todas as fases carregam e o jogador começa no chão", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // a esfera do campo de dilatação vista de fora (para comparar com a versão web)
        // cubo parado na boca do ciano no chão: a metade que passou aparece saindo do vermelho
        "cubo-portal" => {
            let mut fails = 0;
            let mut h = Harness::new(1280, 720, Some(2));
            h.frames(30);
            let f = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
            let (ok_b, ok_o) = {
                let mut g = h.game();
                let g = &mut *g;
                let b = g.portals.try_place(&g.world, 0, Vec3::new(-4.0, 1.5, -3.0), Vec3::NEG_Y, false).ok;
                let o = g.portals.try_place(&g.world, 1, Vec3::new(-4.0, 1.2, f("OOZ", -9.0)), Vec3::new(f("OX", -1.0), 0.0, f("OZ", 0.0)).normalize(), false).ok;
                (b, o)
            };
            check(ok_b && ok_o, "os dois portais abrem", &mut fails);
            let (c, oc, on) = { let g = h.game(); (g.portals.list[0].center, g.portals.list[1].center, g.portals.list[1].normal) };
            println!("ciano {c:.2} vermelho {oc:.2} n {on:.2}");
            for _ in 0..40 {
                {
                    let mut g = h.game();
                    let g = &mut *g;
                    g.props.list[0].place(&mut g.world.phys, c + Vec3::Y * f("CUBEY", 0.05), Some(Quat::from_rotation_y(0.4)), None);
                    let eye = oc + on * f("DIST", 3.0) + Vec3::Y * 0.4 + on.cross(Vec3::Y) * f("SIDE", 1.2);
                    g.player.pos = eye - Vec3::new(0.0, g.player.eye_off, 0.0);
                    g.player.vel = Vec3::ZERO;
                }
                h.aim(oc);
                h.update();
            }
            let tw = h.game().props.list[0].twin.is_some();
            check(tw, "a cópia aparece no vermelho", &mut fails);
            h.shot(&std::env::var("CSHOT").unwrap_or("cubo-portal.png".into()));
            h.frames(3);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        "campo-vista" => {
            let mut h = Harness::new(1280, 720, Some(1));
            h.frames(30);
            {
                let mut g = h.game();
                g.field.active.push(portal3::game::FieldInst { center: Vec3::new(0.0, 0.92, 0.0), left: 18.0, own: true });
                let f = |k: &str, d: f32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
                g.player.pos = Vec3::new(f("CX", 0.0), 0.95, f("CZ", 7.0));
                g.player.yaw = f("CYAW", 0.0);
                g.player.pitch = -0.05;
            }
            h.frames(5);
            h.shot(&std::env::var("CSHOT").unwrap_or("campo-n.png".into()));
            std::process::exit(0);
        }
        // multiplayer: o servidor da versão web, um jogador de mentira (node) e a versão nativa na mesma sala
        "multiplayer" => {
            let mut fails = 0;
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
            let port = 5190 + (std::process::id() % 500) as u16;
            let mut server = std::process::Command::new("node").arg("server.js").current_dir(&root).env("PORT", port.to_string()).stdout(std::process::Stdio::null()).spawn().expect("node");
            std::thread::sleep(Duration::from_millis(1200));
            let mut h = Harness::new(640, 360, Some(1));
            h.frames(20);
            let room = format!("teste-{}", std::process::id());
            {
                let mut g = h.game();
                g.mp.ui.server = format!("ws://127.0.0.1:{port}/ws");
                g.mp.ui.room = room.clone();
                g.mp.ui.name = "Nativo".into();
                g.mp_join();
            }
            let wait = |h: &mut Harness, secs: f32, f: &dyn Fn(&mut Harness) -> bool| -> bool {
                let t0 = std::time::Instant::now();
                while t0.elapsed().as_secs_f32() < secs {
                    h.update();
                    std::thread::sleep(Duration::from_millis(10));
                    if f(h) {
                        return true;
                    }
                }
                false
            };
            let joined = wait(&mut h, 5.0, &|h| h.game().mp());
            check(joined, "entra na sala do servidor da versão web", &mut fails);
            wait(&mut h, 1.0, &|_| false);
            // um portal do outro jogador numa parede branca daqui
            let portal = {
                let g = h.game();
                let i = (0..g.world.solids.len()).filter(|&i| g.world.solids[i].portalable && g.world.solids[i].max.y - g.world.solids[i].min.y > 2.5).max_by(|&a, &b| {
                    let w = |i: usize| { let s = g.world.solids[i].max - g.world.solids[i].min; s.x.max(s.z) };
                    w(a).total_cmp(&w(b))
                });
                i.map(|i| {
                    let b = &g.world.solids[i];
                    let s = b.max - b.min;
                    let (n, _) = if s.z >= s.x { (Vec3::X, Vec3::Z) } else { (Vec3::Z, Vec3::X) };
                    let c = (b.min + b.max) / 2.0 + n * (s.dot(n) / 2.0);
                    serde_json::json!({ "c": [c.x, 1.3, c.z], "n": [n.x, n.y, n.z], "u": [0, 1, 0], "b": i }).to_string()
                }).unwrap_or_default()
            };
            let out = std::env::temp_dir().join(format!("peer-{}.json", std::process::id()));
            let _ = std::fs::remove_file(&out);
            let mut peer = std::process::Command::new("node").arg(root.join("nativo/tools/peer.mjs")).arg(format!("ws://127.0.0.1:{port}/ws")).arg(&room).arg(&out).arg(&portal).current_dir(&root).spawn().expect("node");
            let seen = wait(&mut h, 6.0, &|h| {
                let g = h.game();
                !g.mp.avatars.is_empty() && g.portals.list.iter().skip(2).any(|p| p.placed)
            });
            let (avatars, remote) = {
                let g = h.game();
                (g.mp.avatars.len(), g.portals.list.iter().skip(2).filter(|p| p.placed).count())
            };
            println!("outros jogadores {avatars} · portais deles {remote}");
            check(seen, "o outro jogador aparece (raptor) e o portal dele abre aqui", &mut fails);
            h.shot("multiplayer.png");
            let got: serde_json::Value = std::fs::read_to_string(&out).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            println!("o outro recebeu: {got}");
            check(got.get("states").and_then(|v| v.as_u64()).unwrap_or(0) > 5, "o outro jogador recebe a minha posição", &mut fails);
            // trocar de câmara: a sala inteira vai junto
            h.game().start_level(1);
            let moved = wait(&mut h, 5.0, &|h| h.game().level == Some(1));
            wait(&mut h, 0.5, &|_| false);
            let got: serde_json::Value = std::fs::read_to_string(&out).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            check(moved && got.get("level").and_then(|v| v.as_u64()) == Some(1), "trocar de câmara leva a sala inteira", &mut fails);
            let _ = peer.kill();
            let _ = server.kill();
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // fase 401: T troca a época (as paredes de cada época aparecem e somem)
        "epoca" => {
            let mut fails = 0;
            let mut h = Harness::new(640, 360, Some(401));
            h.frames(30);
            let count = |h: &mut Harness| {
                let g = h.game();
                (0..g.world.solids.len()).filter(|&i| g.world.listed(i)).count()
            };
            let era0 = h.game().world.era.clone();
            let n0 = count(&mut h);
            h.shot("epoca-0.png");
            h.tap(Key::TimeTravel);
            let era1 = h.game().world.era.clone();
            let n1 = count(&mut h);
            println!("{era0}: {n0} sólidos · {era1}: {n1} sólidos");
            check(era0 != era1, "T troca a época", &mut fails);
            check(n0 != n1, "e a sala muda (paredes de cada época)", &mut fails);
            h.frames(10);
            h.shot("epoca-1.png");
            h.tap(Key::TimeTravel);
            check(h.game().world.era == era0 && count(&mut h) == n0, "T de novo volta", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // menus: o menu ao abrir, Enter joga, Esc pausa, a saída mostra o fim de câmara, Enter vai para a próxima
        "menu" => {
            let mut fails = 0;
            unsafe { std::env::set_var("PORTAL3_TODAS", "1") };
            let mut h = Harness::new(1280, 720, None);
            h.frames(90);
            check(h.game().menu && !h.game().running, "abre no menu (a câmara 1 ao fundo)", &mut fails);
            h.shot("menu.png");
            h.tap(Key::Play);
            h.frames(30);
            check(!h.game().menu && h.game().running && h.game().level == Some(0), "Enter começa a câmara", &mut fails);
            h.tap(Key::Pause);
            h.frames(5);
            check(h.game().paused, "Esc pausa", &mut fails);
            let t0 = h.game().level_time;
            h.frames(30);
            check(h.game().level_time == t0, "pausado o tempo não anda", &mut fails);
            h.shot("pausa.png");
            h.tap(Key::Pause);
            h.frames(5);
            check(!h.game().paused, "Esc de novo continua", &mut fails);
            // chega na saída
            {
                let mut g = h.game();
                let ex = g.world.triggers.iter().find(|t| t.exit).map(|t| (t.min + t.max) * 0.5).unwrap();
                g.player.pos = Vec3::new(ex.x, ex.y - 0.4, ex.z);
                g.player.vel = Vec3::ZERO;
            }
            h.frames(20);
            check(h.game().completed, "a saída conclui a câmara", &mut fails);
            h.frames(10);
            h.shot("fim.png");
            h.tap(Key::Play);
            h.frames(30);
            println!("depois de Enter: câmara {:?}", h.game().level.map(|i| h.game().levels[i].id));
            check(h.game().level == Some(1) && !h.game().completed, "Enter vai para a próxima câmara", &mut fails);
            std::process::exit(if fails > 0 { 1 } else { 0 });
        }
        // capturas dos efeitos de tela: névoa de calor, tempo lento, o campo (de fora e de dentro), o tiro
        "efeitos" => {
            let mut h = Harness::new(1280, 720, Some(1));
            h.frames(30);
            let put = |h: &mut Harness, p: Vec3, look: Vec3| {
                h.game().player.pos = p;
                h.game().player.vel = Vec3::ZERO;
                h.aim(look);
            };
            put(&mut h, Vec3::new(0.0, 0.92, -3.0), Vec3::new(0.0, -2.0, -8.0));
            h.frames(30);
            h.shot("fx-lava.png");
            h.tap(Key::Slow);
            h.frames(40);
            h.shot("fx-lento.png");
            h.tap(Key::Slow);
            h.frames(30);
            // campo: carrega 5 s parado, depois anda para fora e olha para ele
            put(&mut h, Vec3::new(2.0, 0.92, 3.0), Vec3::new(2.0, 1.0, -5.0));
            {
                let mut c = h.controls();
                c.pressed.push(Key::FireBlue);
                c.pressed.push(Key::FireOrange);
            }
            h.frames(60 * 5 + 10);
            {
                let mut c = h.controls();
                c.released.push(Key::FireBlue);
                c.released.push(Key::FireOrange);
            }
            h.frames(5);
            h.shot("fx-campo-dentro.png");
            put(&mut h, Vec3::new(-3.0, 0.92, -2.0), Vec3::new(2.0, 1.0, 3.0));
            h.frames(10);
            h.shot("fx-campo-fora.png");
            // tiro: a onda de choque sai da boca da arma
            h.tap(Key::FireBlue);
            h.frames(4);
            h.shot("fx-tiro.png");
            println!("capturas: fx-lava fx-lento fx-campo-dentro fx-campo-fora fx-tiro");
        }
        other => eprintln!("cenário desconhecido: {other}"),
    }
}
