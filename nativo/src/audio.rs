//! Som (audio.js, sfx.js e narrator.js da versão web), com a Web Audio API em Rust
//! (crate web-audio-api): o mesmo grafo — compressor, master, reverb gerado, eco, filtro
//! "abafado" do tempo lento — as músicas gravadas em streaming com transição entre as faixas,
//! as falas gravadas (public/vozes) e os efeitos (gravações CC0 com variação de altura,
//! varreduras e laços controlados pelo jogo; os sintetizados que não têm gravação).
//!
//! Os arquivos vêm de `public/` da versão web (sfx, music, vozes): no pacote, de `assets/`.

use bevy::prelude::*;
use rand::Rng;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use web_audio_api::context::{AudioContext, AudioContextLatencyCategory, AudioContextOptions, BaseAudioContext};
use web_audio_api::node::{AudioBufferSourceNode, AudioNode, AudioScheduledSourceNode, BiquadFilterNode, BiquadFilterType, GainNode, OscillatorNode, OscillatorType};
use web_audio_api::{AudioBuffer, AudioBufferOptions, MediaElement};

/// onde estão os sons: `assets/<sub>` (pacote) ou `public/<sub>` da versão web (desenvolvimento)
pub fn sound_dir(sub: &str) -> PathBuf {
    let a = crate::mats::asset_dir().join(sub);
    if a.exists() {
        return a;
    }
    crate::mats::asset_dir().join("..").join("..").join("public").join(sub)
}

fn mtof(m: f32) -> f32 {
    440.0 * 2f32.powf((m - 69.0) / 12.0)
}

// ------------------------------------------------------------------ gravações
fn seq(base: &str, n: usize) -> Vec<String> {
    (0..n).map(|i| format!("{base}_{i:03}.ogg")).collect()
}
fn n3(base: &str, ns: &[usize]) -> Vec<String> {
    ns.iter().map(|i| format!("{base}_{i:03}.ogg")).collect()
}

/// os mesmos SAMPLES de sfx.js: cada nome, um ou mais arquivos (um é sorteado)
fn samples() -> Vec<(&'static str, Vec<String>)> {
    let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    vec![
        ("shot", seq("laserLarge", 5)),
        ("blast", v(&["portalgun_blast.wav"])),
        ("enter", v(&["portal_enter.wav"])),
        ("tick", v(&["tick.wav"])),
        ("turretFire", v(&["turret_fire.wav"])),
        ("slowHum", v(&["slow_mo_hum.wav"])),
        ("fieldBlast", v(&["slow_time_blast.wav"])),
        ("open", seq("forceField", 5)),
        ("fail", seq("impactMetal", 5)),
        ("pass", v(&["spaceEngineLow_000.ogg", "spaceEngineLow_003.ogg"])),
        ("hum", v(&["spaceEngineSmall_000.ogg"])),
        ("stepConcrete", seq("footstep_concrete", 5)),
        ("stepMetal", [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].iter().map(|i| format!("metal_steps_{i:02}.wav")).collect()),
        ("stepGlass", n3("impactGlass_light", &[0, 1, 2])),
        ("land", n3("impactPlate_medium", &[0, 1, 2])),
        ("btnDown", [n3("impactMetal_light", &[0, 1, 2, 3, 4]), v(&["mw_metal_hit_01.ogg", "mw_metal_hit_03.ogg", "mw_metal_hit_04.ogg", "mw_metal_hit_05.ogg"])].concat()),
        ("btnUp", [n3("impactPlate_light", &[0, 1, 2, 3, 4]), v(&["mw_metal_spring_01.ogg", "mw_metal_spring_02.ogg"])].concat()),
        ("latch", v(&["mw_metal_close_01.ogg", "mw_lock_open_01.ogg"])),
        ("tele", v(&["sf_teleport_02.ogg"])),
        ("teleS", v(&["sf_teleport_01.ogg"])),
        ("door", [v(&["mw_metal_open_01.ogg", "mw_door_open_01.ogg"]), seq("doorOpen", 3)].concat()),
        ("hiss", v(&["thrusterFire_000.ogg", "thrusterFire_002.ogg"])),
        ("bell", seq("impactBell_heavy", 5)),
        ("plate", [v(&["mw_metal_slam_01.ogg"]), n3("impactMetal_heavy", &[0, 1, 2])].concat()),
        ("spring", v(&["mw_metal_spring_01.ogg", "mw_metal_spring_02.ogg"])),
        ("thud", n3("impactPlate_heavy", &[0, 1, 2])),
        ("sweepS", n3("spaceEngineSmall", &[1, 2, 3])),
        ("sweepL", n3("spaceEngineLow", &[0, 1, 2])),
        ("turret", seq("laserSmall", 5)),
        ("pop", n3("explosionCrunch", &[0, 2])),
        ("burn", n3("explosionCrunch", &[1, 3])),
        ("boom", seq("lowFrequency_explosion", 2)),
        ("death", seq("explosionCrunch", 5)),
        ("heart", n3("impactSoft_heavy", &[0, 1])),
        ("laserLoop", v(&["sf_loop_machine_03.ogg"])),
        ("funnelLoop", v(&["sf_loop_machine_01.ogg"])),
        ("bhLoop", v(&["lowFrequency_explosion_000.ogg"])),
        ("bhLoop2", v(&["spaceEngineLow_001.ogg"])),
        ("wind", v(&["wind.ogg"])),
        ("roar", v(&["t-rex_calls.mp3"])),
    ]
}

/// as faixas de cada clima (TRACKS de audio.js): arquivo e ganho que iguala o volume
fn tracks(mood: &str) -> Vec<(&'static str, f32)> {
    match mood {
        "labTense" => vec![("urgent.mp3", 15.0), ("depths.mp3", 1.76), ("infestation.mp3", 8.2), ("searching.ogg", 0.53)],
        "labEpic" => vec![("menacing.mp3", 0.33), ("surreal.mp3", 5.0), ("transmission.mp3", 4.3)],
        _ => vec![("sector.mp3", 7.5), ("pulse.mp3", 4.5), ("airy.mp3", 12.0)],
    }
}

/// `faixa:x` → só essa faixa (em repetição); um clima → as faixas dele
fn mood_tracks(name: &str) -> (Vec<(&'static str, f32)>, bool) {
    if let Some(id) = name.strip_prefix("faixa:") {
        for m in ["lab", "labTense", "labEpic"] {
            if let Some(t) = tracks(m).into_iter().find(|t| t.0.split('.').next() == Some(id)) {
                return (vec![t], true);
            }
        }
        return (tracks("lab"), false);
    }
    (tracks(name), false)
}

const FADE: f64 = 4.0;

struct Track {
    el: MediaElement,
    _src: web_audio_api::node::MediaElementAudioSourceNode,
    g: GainNode,
    start: f64,
    dur: f64,
    ending: bool,
}

struct Mood {
    key: String,
    bus: GainNode,
    list: Vec<(&'static str, f32)>,
    i: usize,
    cur: Option<Track>,
    old: Vec<(Track, f64)>,
}

/// um laço contínuo com volume controlado pelo jogo
struct Loop {
    out: GainNode,
    max: f32,
    v: f32,
    /// fontes e filtro (para afinar)
    filter: Option<BiquadFilterNode>,
    srcs: Vec<AudioBufferSourceNode>,
    oscs: Vec<OscillatorNode>,
}

/// falas: (quem, texto) na fila; a legenda fica enquanto a gravação toca
#[derive(Default)]
pub struct Dialog {
    queue: std::collections::VecDeque<(String, String)>,
    /// a fala na tela e até quando (relógio do áudio)
    pub showing: Option<(String, String)>,
    until: f64,
    gap_until: f64,
    voice: Option<(MediaElement, web_audio_api::node::MediaElementAudioSourceNode, GainNode)>,
}

/// (recurso "não Send": os elementos de mídia só vivem na thread principal)
pub struct Audio {
    pub ctx: AudioContext,
    master: GainNode,
    music: GainNode,
    slow_lp: BiquadFilterNode,
    sfx: GainNode,
    noise: AudioBuffer,
    bufs: Arc<Mutex<HashMap<String, Vec<AudioBuffer>>>>,
    rev_cache: HashMap<(String, usize), AudioBuffer>,
    loops: HashMap<String, Loop>,
    mood: Option<Mood>,
    dying: Vec<(GainNode, f64)>,
    durations: HashMap<String, f64>,
    clips: std::collections::HashSet<String>,
    pub music_on: bool,
    pub voice_on: bool,
    ducked: bool,
    pub dialog: Dialog,
    step_side: f32,
    // reverb e eco ficam vivos
    _reverb: web_audio_api::node::ConvolverNode,
    _delay: web_audio_api::node::DelayNode,
    _comp: web_audio_api::node::DynamicsCompressorNode,
    /// medidor do que sai (testes)
    meter: web_audio_api::node::AnalyserNode,
    /// falas e sons da campanha original
    pub camp: crate::campaign::dialogue::Player,
}

/// chave de uma fala gravada: FNV-1a de 32 bits de "quem|texto" (em UTF-16, como o charCodeAt)
pub fn voice_key(who: &str, text: &str) -> String {
    let s = format!("{who}|{text}");
    let mut h: u32 = 0x811c9dc5;
    for c in s.encode_utf16() {
        h ^= c as u32;
        h = h.wrapping_mul(0x01000193);
    }
    format!("{h:08x}")
}

fn biquad(ctx: &AudioContext, t: BiquadFilterType, f: f32, q: f32) -> BiquadFilterNode {
    let mut n = ctx.create_biquad_filter();
    n.set_type(t);
    n.frequency().set_value(f);
    n.q().set_value(q);
    n
}

fn gain(ctx: &AudioContext, v: f32) -> GainNode {
    let g = ctx.create_gain();
    g.gain().set_value(v);
    g
}

/// opções de `sample` (as mesmas de sfx.js)
#[derive(Clone)]
pub struct S {
    pub vol: f32,
    pub rate: f32,
    pub rate_to: f32,
    pub jitter: f32,
    pub delay: f64,
    pub filter: Option<(BiquadFilterType, f32)>,
    pub dur: f64,
    pub from: f64,
    pub reverse: bool,
    /// direto no master (fora do abafado do tempo lento)
    pub master: bool,
}

impl Default for S {
    fn default() -> Self {
        S { vol: 0.5, rate: 1.0, rate_to: 0.0, jitter: 0.04, delay: 0.0, filter: None, dur: 0.0, from: 0.0, reverse: false, master: false }
    }
}

impl Audio {
    pub fn new() -> Self {
        let mute = std::env::var("PORTAL3_MUTE").is_ok();
        let ctx = AudioContext::new(AudioContextOptions { latency_hint: AudioContextLatencyCategory::Interactive, sink_id: if mute { "none".into() } else { String::new() }, ..Default::default() });
        let comp = ctx.create_dynamics_compressor();
        comp.threshold().set_value(-16.0);
        comp.ratio().set_value(3.0);
        comp.connect(&ctx.destination());
        let master = gain(&ctx, 0.85);
        master.connect(&comp);
        let mut meter = ctx.create_analyser();
        meter.set_fft_size(2048);
        comp.connect(&meter);
        // reverb gerado (ruído com decaimento exponencial)
        let sr = ctx.sample_rate();
        let len = (sr * 3.6) as usize;
        let mut ir = AudioBuffer::new(AudioBufferOptions { number_of_channels: 2, length: len, sample_rate: sr });
        let mut rng = rand::rng();
        for c in 0..2 {
            let d = ir.get_channel_data_mut(c);
            for (i, x) in d.iter_mut().enumerate() {
                *x = (rng.random::<f32>() * 2.0 - 1.0) * (1.0 - i as f32 / len as f32).powf(2.6);
            }
        }
        let mut reverb = ctx.create_convolver();
        reverb.set_buffer(ir);
        let wet = gain(&ctx, 0.55);
        reverb.connect(&wet);
        wet.connect(&master);
        let music = gain(&ctx, 0.5);
        let slow_lp = biquad(&ctx, BiquadFilterType::Lowpass, 20000.0, 0.9);
        slow_lp.connect(&master);
        music.connect(&slow_lp);
        music.connect(&reverb);
        // eco rítmico (só a música sintetizada usa; fica no grafo como na versão web)
        let delay = ctx.create_delay(1.5);
        delay.delay_time().set_value(0.4);
        let fb = gain(&ctx, 0.34);
        let dlp = biquad(&ctx, BiquadFilterType::Lowpass, 2600.0, 1.0);
        let d_out = gain(&ctx, 0.6);
        delay.connect(&dlp);
        dlp.connect(&fb);
        fb.connect(&delay);
        dlp.connect(&d_out);
        d_out.connect(&music);
        let sfx = gain(&ctx, 0.9);
        sfx.connect(&slow_lp);
        // ruído branco reaproveitável
        let mut noise = AudioBuffer::new(AudioBufferOptions { number_of_channels: 1, length: (sr * 2.0) as usize, sample_rate: sr });
        for x in noise.get_channel_data_mut(0) {
            *x = rng.random::<f32>() * 2.0 - 1.0;
        }
        // gravações: carregadas em segundo plano
        let bufs: Arc<Mutex<HashMap<String, Vec<AudioBuffer>>>> = Default::default();
        {
            let bufs = bufs.clone();
            let dir = sound_dir("sfx");
            std::thread::spawn(move || {
                let ctx = web_audio_api::context::OfflineAudioContext::new(1, 1, sr);
                for (name, files) in samples() {
                    let mut list = vec![];
                    for f in files {
                        let Ok(file) = std::fs::File::open(dir.join(&f)) else { continue };
                        if let Ok(b) = ctx.decode_audio_data_sync(file) {
                            list.push(b);
                        }
                    }
                    bufs.lock().unwrap().insert(name.to_string(), list);
                }
            });
        }
        let durations = std::fs::read_to_string(crate::mats::asset_dir().join("music.json")).ok().and_then(|s| serde_json::from_str::<HashMap<String, f64>>(&s).ok()).unwrap_or_default();
        let clips = std::fs::read_to_string(sound_dir("vozes").join("index.json")).ok().and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()).unwrap_or_default().into_iter().collect();
        Audio {
            ctx,
            master,
            music,
            slow_lp,
            sfx,
            noise,
            bufs,
            rev_cache: HashMap::new(),
            loops: HashMap::new(),
            mood: None,
            dying: vec![],
            durations,
            clips,
            music_on: true,
            voice_on: true,
            ducked: false,
            dialog: Dialog::default(),
            step_side: 1.0,
            _reverb: reverb,
            _delay: delay,
            _comp: comp,
            meter,
            camp: Default::default(),
        }
    }

    /// nível (RMS) do som que está saindo agora
    pub fn level(&mut self) -> f32 {
        let mut b = vec![0.0f32; 2048];
        self.meter.get_float_time_domain_data(&mut b);
        (b.iter().map(|x| x * x).sum::<f32>() / b.len() as f32).sqrt()
    }

    pub fn t(&self) -> f64 {
        self.ctx.current_time()
    }

    /// todas as gravações carregadas?
    pub fn ready(&self) -> bool {
        self.bufs.lock().map(|b| b.len() == samples().len()).unwrap_or(false)
    }

    fn buf(&self, name: &str) -> Option<(AudioBuffer, usize)> {
        let b = self.bufs.lock().ok()?;
        let list = b.get(name)?;
        if list.is_empty() {
            return None;
        }
        let i = rand::rng().random_range(0..list.len());
        Some((list[i].clone(), i))
    }

    // ------------------------------------------------------------------ música
    pub fn set_music(&mut self, on: bool) {
        self.music_on = on;
        let t = self.t();
        self.music.gain().set_target_at_time(if on { if self.ducked { 0.18 } else { 0.5 } } else { 0.0 }, t, 0.4);
    }

    pub fn duck(&mut self, on: bool) {
        self.ducked = on;
        if !self.music_on {
            return;
        }
        let t = self.t();
        self.music.gain().set_target_at_time(if on { 0.18 } else { 0.5 }, t, if on { 0.15 } else { 0.8 });
    }

    pub fn stop_mood(&mut self) {
        let t = self.t();
        if let Some(m) = self.mood.take() {
            m.bus.gain().cancel_scheduled_values(t);
            m.bus.gain().set_value_at_time(m.bus.gain().value(), t);
            m.bus.gain().linear_ramp_to_value_at_time(0.0, t + 3.0);
            self.dying.push((m.bus, t + 3.2));
            for tr in m.cur.into_iter().chain(m.old.into_iter().map(|o| o.0)) {
                pause_later(tr.el, 3.2);
            }
        }
    }

    pub fn set_mood(&mut self, name: &str) {
        if self.mood.as_ref().is_some_and(|m| m.key == name) {
            return;
        }
        self.stop_mood();
        let (mut list, fixed) = mood_tracks(name);
        if !fixed {
            // sorteia a ordem
            let mut rng = rand::rng();
            for i in (1..list.len()).rev() {
                list.swap(i, rng.random_range(0..=i));
            }
        }
        let t = self.t();
        let bus = self.ctx.create_gain();
        bus.gain().set_value_at_time(0.0, t);
        bus.gain().linear_ramp_to_value_at_time(1.0, t + 3.0);
        bus.connect(&self.music);
        self.mood = Some(Mood { key: name.to_string(), bus, list, i: 0, cur: None, old: vec![] });
        self.next_track(0.3);
    }

    fn next_track(&mut self, fade: f64) {
        let t = self.t();
        let dir = sound_dir("music");
        let Some(m) = self.mood.as_mut() else { return };
        if m.list.is_empty() {
            return;
        }
        let (f, g0) = m.list[m.i % m.list.len()];
        m.i += 1;
        let Ok(mut el) = MediaElement::new(dir.join(f)) else { return };
        let src = self.ctx.create_media_element_source(&mut el);
        let g = self.ctx.create_gain();
        g.gain().set_value_at_time(0.0, t);
        g.gain().linear_ramp_to_value_at_time(g0.max(0.01), t + fade);
        src.connect(&g);
        g.connect(&m.bus);
        el.play();
        let dur = self.durations.get(f).copied().unwrap_or(120.0);
        if let Some(mut old) = m.cur.take() {
            old.g.gain().cancel_scheduled_values(t);
            old.g.gain().set_value_at_time(old.g.gain().value(), t);
            old.g.gain().linear_ramp_to_value_at_time(0.0, t + fade);
            old.ending = true;
            m.old.push((old, t + fade + 0.3));
        }
        m.cur = Some(Track { el, _src: src, g, start: t, dur, ending: false });
    }

    /// tempo lento: abafa música e efeitos (o som do próprio efeito passa por fora)
    pub fn set_slowmo(&mut self, on: bool) {
        let t = self.t();
        self.slow_lp.frequency().set_target_at_time(if on { 650.0 } else { 20000.0 }, t, if on { 0.12 } else { 0.25 });
    }

    // ------------------------------------------------------------------ falas
    /// põe falas na fila (a legenda aparece com a gravação)
    pub fn say(&mut self, lines: &[(String, String)]) {
        self.dialog.queue.extend(lines.iter().cloned());
    }

    /// corta as falas (troca de fase)
    pub fn cancel_dialog(&mut self) {
        self.dialog.queue.clear();
        self.dialog.showing = None;
        if let Some((el, _, _)) = self.dialog.voice.take() {
            el.pause();
        }
        self.duck(false);
    }

    fn dialog_tick(&mut self) {
        let t = self.t();
        let d = &mut self.dialog;
        if d.showing.is_some() && t >= d.until {
            d.showing = None;
            d.gap_until = t + 0.3;
            if let Some((el, _, _)) = d.voice.take() {
                el.pause();
            }
            self.duck(false);
        }
        let d = &mut self.dialog;
        if d.showing.is_none() && t >= d.gap_until {
            if let Some((who, text)) = d.queue.pop_front() {
                let key = voice_key(&who, &text);
                let mut min = (text.chars().count() as f64 * 0.065).max(2.6);
                if self.voice_on && self.clips.contains(&key) {
                    if let Ok(mut el) = MediaElement::new(sound_dir("vozes").join(format!("{key}.mp3"))) {
                        let src = self.ctx.create_media_element_source(&mut el);
                        let g = gain(&self.ctx, 1.0);
                        src.connect(&g);
                        g.connect(&self.master);
                        el.play();
                        // duração da gravação: pelo tamanho do mp3 (as vozes são 128 kbps)
                        let bytes = std::fs::metadata(sound_dir("vozes").join(format!("{key}.mp3"))).map(|m| m.len()).unwrap_or(0);
                        min = (bytes as f64 * 8.0 / 128_000.0).max(0.9);
                        self.dialog.voice = Some((el, src, g));
                        self.duck(true);
                    }
                }
                let d = &mut self.dialog;
                d.showing = Some((who, text));
                d.until = t + min;
            }
        }
    }

    /// pedidos da campanha original (cenas, sons soltos) e a legenda dela
    pub fn campaign(&mut self, reqs: Vec<crate::campaign::dialogue::Req>) {
        if !reqs.is_empty() {
            self.camp.handle(&self.ctx, &self.master, reqs);
        }
        let t = self.t();
        self.camp.tick(t);
    }

    /// a cada quadro: emenda as faixas, solta o que acabou, as falas
    pub fn tick(&mut self) {
        let t = self.t();
        let need_next = self.mood.as_ref().and_then(|m| m.cur.as_ref()).is_some_and(|c| !c.ending && c.dur > FADE * 2.0 && t - c.start > c.dur - FADE - 0.2);
        if need_next {
            self.next_track(FADE);
        }
        if let Some(m) = self.mood.as_mut() {
            m.old.retain(|(tr, until)| {
                if t > *until {
                    tr.el.pause();
                    false
                } else {
                    true
                }
            });
        }
        self.dying.retain(|(g, until)| {
            if t > *until {
                g.disconnect();
                false
            } else {
                true
            }
        });
        self.dialog_tick();
    }

    // ------------------------------------------------------------------ peças dos efeitos
    /// toca uma gravação (se já carregou); false se não tocou
    pub fn sample(&mut self, name: &str, o: S) -> bool {
        let Some((mut buf, idx)) = self.buf(name) else { return false };
        if o.reverse {
            buf = self.rev_cache.entry((name.to_string(), idx)).or_insert_with(|| reverse(&buf)).clone();
        }
        let ctx = &self.ctx;
        let mut src = ctx.create_buffer_source();
        let bdur = buf.duration();
        src.set_buffer(buf);
        let j = 1.0 + (rand::rng().random::<f32>() * 2.0 - 1.0) * o.jitter;
        let t0 = self.t() + o.delay;
        src.playback_rate().set_value_at_time(o.rate * j, t0);
        let span = if o.dur > 0.0 { o.dur } else { (bdur / o.rate as f64).min(4.0) };
        if o.rate_to > 0.0 {
            src.playback_rate().linear_ramp_to_value_at_time(o.rate_to * j, t0 + span);
        }
        let g = gain(ctx, o.vol);
        let dest: &dyn AudioNode = if o.master { &self.master } else { &self.sfx };
        if let Some((ft, freq)) = o.filter {
            let f = biquad(ctx, ft, freq, 1.0);
            src.connect(&f);
            f.connect(&g);
        } else {
            src.connect(&g);
        }
        g.connect(dest);
        if o.dur > 0.0 {
            g.gain().set_value_at_time(0.0001, t0);
            g.gain().exponential_ramp_to_value_at_time(o.vol, t0 + (o.dur / 4.0).min(0.03));
            g.gain().set_value_at_time(o.vol, t0 + o.dur * 0.6);
            g.gain().exponential_ramp_to_value_at_time(0.0001, t0 + o.dur);
            src.start_at_with_offset(t0, o.from);
            src.stop_at(t0 + o.dur + 0.05);
        } else {
            src.start_at_with_offset(t0, o.from);
        }
        true
    }

    fn env(&self, node: &dyn AudioNode, t: f64, a: f64, peak: f32, d: f64, master: bool) -> GainNode {
        let g = self.ctx.create_gain();
        g.gain().set_value_at_time(0.0001, t);
        g.gain().exponential_ramp_to_value_at_time(peak, t + a);
        g.gain().exponential_ramp_to_value_at_time(0.0001, t + a + d);
        node.connect(&g);
        g.connect(if master { &self.master } else { &self.sfx });
        g
    }

    fn osc(&self, ty: OscillatorType, f0: f32, f1: f32, t: f64, dur: f64, peak: f32, a: f64, master: bool) {
        let mut o = self.ctx.create_oscillator();
        o.set_type(ty);
        o.frequency().set_value_at_time(f0, t);
        o.frequency().exponential_ramp_to_value_at_time(f1.max(1.0), t + dur);
        self.env(&o, t, a, peak, dur, master);
        o.start_at(t);
        o.stop_at(t + a + dur + 0.05);
    }

    /// síntese FM: portadora f0→f1 modulada por razão `ratio` com índice que decai
    #[allow(clippy::too_many_arguments)]
    fn fm(&self, f0: f32, f1: f32, t: f64, dur: f64, ratio: f32, index: f32, peak: f32, ty: OscillatorType, master: bool) {
        let ctx = &self.ctx;
        let mut car = ctx.create_oscillator();
        car.set_type(ty);
        car.frequency().set_value_at_time(f0, t);
        car.frequency().exponential_ramp_to_value_at_time(f1.max(1.0), t + dur);
        let mut m = ctx.create_oscillator();
        m.frequency().set_value_at_time(f0 * ratio, t);
        m.frequency().exponential_ramp_to_value_at_time((f1 * ratio).max(1.0), t + dur);
        let mg = ctx.create_gain();
        mg.gain().set_value_at_time(f0 * index, t);
        mg.gain().exponential_ramp_to_value_at_time((f1 * 0.05).max(1.0), t + dur);
        m.connect(&mg);
        mg.connect(car.frequency());
        self.env(&car, t, 0.004, peak, dur, master);
        car.start_at(t);
        m.start_at(t);
        car.stop_at(t + 0.004 + dur + 0.05);
        m.stop_at(t + 0.004 + dur + 0.05);
    }

    #[allow(clippy::too_many_arguments)]
    fn noise(&self, t: f64, dur: f64, ty: BiquadFilterType, f0: f32, f1: f32, peak: f32, q: f32, master: bool) {
        let ctx = &self.ctx;
        let mut s = ctx.create_buffer_source();
        s.set_buffer(self.noise.clone());
        let f = ctx.create_biquad_filter();
        let mut f = f;
        f.set_type(ty);
        f.q().set_value(q);
        f.frequency().set_value_at_time(f0, t);
        f.frequency().exponential_ramp_to_value_at_time(f1.max(20.0), t + dur);
        s.connect(&f);
        self.env(&f, t, 0.01, peak, dur, master);
        s.start_at_with_offset(t, rand::rng().random::<f64>());
        s.stop_at(t + dur + 0.1);
    }

    // ------------------------------------------------------------------ laços contínuos
    /// laço de uma gravação em repetição (volume 0..1 pelo jogo); false se ainda não carregou
    #[allow(clippy::too_many_arguments)]
    fn sloop(&mut self, name: &str, key: &str, v: f32, max: f32, rate: f32, filter: Option<(BiquadFilterType, f32, f32)>, boost: f32, master: bool) -> bool {
        if !self.loops.contains_key(name) {
            let Some((buf, _)) = self.buf(key) else { return false };
            let ctx = &self.ctx;
            let out = gain(ctx, 0.0);
            out.connect(if master { &self.master } else { &self.sfx });
            let pre = gain(ctx, boost);
            pre.connect(&out);
            let mut src = ctx.create_buffer_source();
            src.set_buffer(buf);
            src.set_loop(true);
            src.playback_rate().set_value(rate);
            let fl = filter.map(|(t, f, q)| biquad(ctx, t, f, q));
            if let Some(f) = &fl {
                src.connect(f);
                f.connect(&pre);
            } else {
                src.connect(&pre);
            }
            src.start();
            self.loops.insert(name.to_string(), Loop { out, max, v: 0.0, filter: fl, srcs: vec![src], oscs: vec![] });
        }
        self.set_loop(name, v);
        true
    }

    fn set_loop(&mut self, name: &str, v: f32) {
        let t = self.t();
        if let Some(l) = self.loops.get_mut(name) {
            if (l.v - v).abs() < 1e-3 {
                return;
            }
            l.v = v;
            l.out.gain().set_target_at_time(v.clamp(0.0, 1.0) * l.max, t, 0.08);
        }
    }

    fn tune(&mut self, name: &str, f: f32, tc: f64) {
        let t = self.t();
        if let Some(fl) = self.loops.get(name).and_then(|l| l.filter.as_ref()) {
            fl.frequency().set_target_at_time(f, t, tc);
        }
    }

    pub fn silence_loops(&mut self) {
        let names: Vec<String> = self.loops.keys().cloned().collect();
        for n in names {
            self.set_loop(&n, 0.0);
        }
    }
}

impl Default for Audio {
    fn default() -> Self {
        Self::new()
    }
}

fn reverse(b: &AudioBuffer) -> AudioBuffer {
    let mut out = AudioBuffer::new(AudioBufferOptions { number_of_channels: b.number_of_channels(), length: b.length(), sample_rate: b.sample_rate() });
    for c in 0..b.number_of_channels() {
        let mut d = b.get_channel_data(c).to_vec();
        d.reverse();
        out.copy_to_channel(&d, c);
    }
    out
}

fn pause_later(el: MediaElement, secs: f64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs_f64(secs));
        el.pause();
    });
}

// ------------------------------------------------------------------ os efeitos (sfx.js)
use BiquadFilterType as F;
use OscillatorType as O;

impl Audio {
    // ---- laços
    /// rajada das torretas (laço enquanto alguma atira)
    pub fn turret_fire(&mut self, v: f32) {
        self.sloop("turretFireL", "turretFire", v, 0.55, 1.0, None, 1.0, false);
    }
    pub fn slow_hum(&mut self, v: f32) {
        self.sloop("slowHumL", "slowHum", v, 0.6, 1.0, None, 1.0, true);
    }
    /// zumbido do campo da arma segurando um objeto
    pub fn hold(&mut self, v: f32) {
        self.sloop("holdS", "hum", v, 0.5, 1.35, Some((F::Bandpass, 900.0, 0.8)), 1.0, false);
    }
    /// chiado do laser (volume pela distância até o feixe mais próximo)
    pub fn laser_hum(&mut self, v: f32) {
        self.sloop("laserS", "laserLoop", v, 0.5, 1.0, Some((F::Highpass, 700.0, 0.7)), 1.0, false);
    }
    /// zumbido do funil (dir −1: invertido, mais grave)
    pub fn funnel_hum(&mut self, v: f32, dir: f32) {
        if self.sloop("funnelS", "funnelLoop", v, 0.5, 0.9, Some((F::Lowpass, 1500.0, 0.7)), 1.0, false) {
            self.tune("funnelS", if dir < 0.0 { 500.0 } else { 1500.0 }, 0.05);
        }
    }
    pub fn black_hole(&mut self, v: f32) {
        if self.sloop("bhS", "bhLoop", v, 0.34, 0.55, None, 1.0, false) {
            self.sloop("bhS2", "bhLoop2", v, 0.3, 0.5, Some((F::Lowpass, 220.0, 0.7)), 1.0, false);
        }
    }
    /// carga do campo de dilatação (k 0..1): o zumbido do tempo lento, abrindo com a carga
    pub fn dilate_charge(&mut self, v: f32, k: f32) {
        if self.sloop("dilChargeL", "slowHum", v, 0.95, 1.0, Some((F::Lowpass, 350.0, 1.4)), 1.1, true) && k.is_finite() {
            self.tune("dilChargeL", 350.0 + 7600.0 * k * k, 0.12);
        }
    }
    /// vento forte (vácuo do portal para a Lua)
    pub fn gale(&mut self, v: f32) {
        self.sloop("galeS", "wind", v, 0.6, 1.1, Some((F::Lowpass, 2400.0, 0.7)), 5.0, false);
    }
    /// vento da velocidade (0..1)
    pub fn wind(&mut self, v: f32) {
        if self.sloop("windS", "wind", (v * 1.7).min(1.0), 0.8, 0.95, Some((F::Lowpass, 900.0, 0.5)), 5.0, false) {
            self.tune("windS", 900.0 + v * 6500.0, 0.05);
        }
    }

    // ---- arma de portais
    pub fn shot(&mut self, blue: bool) {
        if self.sample("blast", S { vol: 0.6, jitter: 0.02, ..default() }) {
            return;
        }
        let t = self.t();
        if self.sample("shot", S { vol: 0.42, rate: if blue { 1.12 } else { 0.86 }, ..default() }) {
            self.osc(O::Sine, 150.0, 50.0, t, 0.16, 0.12, 0.005, false);
        }
    }
    pub fn open(&mut self, blue: bool) {
        self.sample("open", S { vol: 0.3, rate: if blue { 1.15 } else { 0.92 }, delay: 0.04, ..default() });
    }
    pub fn fail(&mut self) {
        self.sample("fail", S { vol: 0.35, rate: 1.1, jitter: 0.08, ..default() });
    }
    pub fn fizzle(&mut self) {
        let from = 0.3 + rand::random::<f64>();
        if self.sample("hiss", S { vol: 0.4, rate: 1.5, from, dur: 0.7, ..default() }) {
            self.sample("sweepS", S { vol: 0.4, rate: 1.8, rate_to: 0.5, dur: 0.7, ..default() });
            self.sample("btnUp", S { vol: 0.3, rate: 1.1, delay: 0.05, ..default() });
        }
    }
    /// passagem por um portal
    pub fn whoosh(&mut self) {
        if !self.sample("enter", S { vol: 0.6, jitter: 0.02, ..default() }) {
            self.sample("pass", S { vol: 0.32, rate: 1.7, dur: 0.6, from: rand::random::<f64>() * 3.0, filter: Some((F::Highpass, 220.0)), ..default() });
        }
    }

    // ---- mecanismos
    pub fn click(&mut self, down: bool) {
        if down {
            self.sample("btnDown", S { vol: 0.5, rate: 0.7, ..default() });
        } else {
            self.sample("btnUp", S { vol: 0.35, rate: 1.4, ..default() });
        }
    }
    pub fn door(&mut self) {
        if self.sample("door", S { vol: 0.55, rate: 0.6, jitter: 0.03, ..default() }) {
            self.sample("hiss", S { vol: 0.2, rate: 1.2, dur: 0.7, from: 0.2, ..default() });
            self.sample("latch", S { vol: 0.4, rate: 1.0, delay: 0.75, ..default() });
        }
    }
    pub fn pick(&mut self) {
        self.sample("open", S { vol: 0.22, rate: 1.6, dur: 0.35, ..default() });
    }
    pub fn drop_(&mut self) {
        self.sample("open", S { vol: 0.18, rate: 0.7, dur: 0.3, ..default() });
    }
    /// passo: o material do chão muda o timbre
    pub fn step(&mut self, mat: &str, speed: f32) {
        let key = match mat {
            "metal" | "stripe" => "stepMetal",
            "glass" => "stepGlass",
            _ => "stepConcrete",
        };
        self.step_side = -self.step_side;
        self.sample(key, S { vol: 0.3 + speed.min(1.5) * 0.22, rate: if mat == "rock" || mat == "moon" { 0.85 } else { 1.0 }, jitter: 0.07, ..default() });
    }
    pub fn land(&mut self, strength: f32) {
        let k = (strength / 15.0).min(1.0);
        self.sample("land", S { vol: 0.35 + k * 0.5, rate: 1.1 - k * 0.3, ..default() });
    }
    pub fn death(&mut self) {
        if self.sample("death", S { vol: 0.6, rate: 0.9, ..default() }) {
            self.sample("boom", S { vol: 0.5, rate: 0.9, delay: 0.05, ..default() });
        }
    }

    // ---- torretas
    pub fn turret_shot(&mut self, dist: f32) {
        let v = (0.22 - dist * 0.006).max(0.03);
        if self.sample("turret", S { vol: v * 2.0, rate: 1.5, jitter: 0.14, ..default() }) {
            self.sample("btnDown", S { vol: v * 2.4, rate: 1.2, jitter: 0.12, ..default() });
        }
    }
    pub fn turret_spot(&mut self) {
        self.sample("sweepS", S { vol: 0.32, rate: 0.7, rate_to: 1.9, dur: 0.45, ..default() });
    }
    pub fn turret_lost(&mut self) {
        self.sample("sweepS", S { vol: 0.26, rate: 1.5, rate_to: 0.8, dur: 0.4, ..default() });
    }
    pub fn turret_down(&mut self) {
        if self.sample("sweepL", S { vol: 0.45, rate: 1.3, rate_to: 0.3, dur: 1.2, ..default() }) {
            self.sample("btnDown", S { vol: 0.4, rate: 0.6, delay: 0.9, ..default() });
        }
    }

    // ---- criaturas e recompensas
    pub fn roar(&mut self, dist: f32) {
        const ROARS: [(f64, f64); 4] = [(26.35, 3.4), (36.6, 3.4), (4.25, 3.0), (10.5, 3.0)];
        let v = (1.0 - dist / 45.0).max(0.15);
        let (from, dur) = ROARS[rand::rng().random_range(0..ROARS.len())];
        self.sample("roar", S { vol: 0.75 * v, from, dur, jitter: 0.06, filter: if dist > 25.0 { Some((F::Lowpass, 1800.0)) } else { None }, ..default() });
    }
    pub fn chirp(&mut self) {
        const CHIRPS: [(f64, f64); 2] = [(0.3, 1.1), (2.4, 0.9)];
        let (from, dur) = CHIRPS[rand::rng().random_range(0..2)];
        self.sample("roar", S { vol: 0.4, rate: 2.1, from, dur: dur / 2.1, jitter: 0.12, ..default() });
    }
    pub fn gem(&mut self) {
        let r = 1.7 + rand::random::<f32>() * 0.5;
        self.sample("bell", S { vol: 0.4, rate: r, ..default() });
    }
    pub fn win(&mut self) {
        if self.sample("bell", S { vol: 0.45, rate: 1.0, ..default() }) {
            self.sample("bell", S { vol: 0.35, rate: 1.5, delay: 0.22, ..default() });
            self.sample("open", S { vol: 0.25, rate: 0.7, rate_to: 1.5, dur: 0.9, ..default() });
        }
    }

    // ---- tempo lento e relógio (direto no master)
    pub fn slow_in(&mut self) {
        if self.sample("sweepL", S { vol: 0.6, rate: 1.3, rate_to: 0.3, dur: 1.0, master: true, ..default() }) {
            self.sample("boom", S { vol: 0.3, rate: 1.1, delay: 0.05, master: true, ..default() });
        }
    }
    pub fn slow_out(&mut self) {
        self.sample("sweepL", S { vol: 0.5, rate: 0.4, rate_to: 1.5, dur: 0.5, master: true, ..default() });
    }
    pub fn freeze(&mut self) {
        self.sample("sweepL", S { vol: 0.55, rate: 0.9, rate_to: 0.25, dur: 0.9, master: true, ..default() });
    }
    pub fn unfreeze(&mut self) {
        if self.sample("sweepL", S { vol: 0.5, rate: 0.35, rate_to: 1.6, dur: 0.55, master: true, ..default() }) {
            self.sample("tick", S { vol: 0.5, jitter: 0.01, delay: 0.3, master: true, ..default() });
        }
    }
    pub fn scrub(&mut self) {
        self.sample("tick", S { vol: 0.5, jitter: 0.01, master: true, ..default() });
    }
    pub fn timer_tick(&mut self, dist: f32) {
        let v = (0.45 - dist * 0.02).max(0.08);
        self.sample("tick", S { vol: v, rate: 1.5, jitter: 0.02, ..default() });
    }
    /// o campo de dilatação nasce
    pub fn thunder(&mut self, vol: f32) {
        self.sample("fieldBlast", S { vol: 0.9 * vol, rate: 1.0, jitter: 0.0, master: true, ..default() });
    }
    /// salto no tempo: o mundo rebobina e termina num baque surdo
    pub fn time_jump(&mut self) {
        self.time_shift(true);
        let t = self.t();
        self.osc(O::Sine, 90.0, 900.0, t, 0.7, 0.2, 0.01, true);
        self.noise(t, 0.8, F::Highpass, 900.0, 6000.0, 0.22, 1.0, true);
        self.osc(O::Sine, 48.0, 28.0, t + 0.7, 0.9, 0.45, 0.005, true);
    }
    /// paradoxo: ruído picotado, dois tons desafinados e um estalo grave
    pub fn paradox(&mut self) {
        let t = self.t();
        let mut rng = rand::rng();
        for i in 0..6 {
            self.noise(t + i as f64 * 0.07, 0.05, F::Highpass, 2500.0 + rng.random::<f32>() * 4000.0, 1200.0, 0.28, 2.0, true);
        }
        self.osc(O::Sawtooth, 220.0, 61.0, t, 0.55, 0.16, 0.005, true);
        self.osc(O::Square, 233.0, 55.0, t, 0.55, 0.12, 0.005, true);
        self.osc(O::Sine, 70.0, 30.0, t + 0.1, 0.7, 0.4, 0.004, true);
        self.sample("boom", S { vol: 0.5, rate: 0.7, delay: 0.1, master: true, ..default() });
    }
    /// o azul "eco" abre / o clone mergulha
    pub fn echo(&mut self, open: bool) {
        let t = self.t();
        self.fm(if open { 400.0 } else { 1600.0 }, if open { 1500.0 } else { 300.0 }, t, 0.5, 2.0, 5.0, 0.1, O::Sine, true);
        self.noise(t, 0.35, F::Bandpass, if open { 800.0 } else { 4000.0 }, if open { 4000.0 } else { 500.0 }, 0.12, 2.0, true);
    }
    pub fn heartbeat(&mut self) {
        if self.sample("heart", S { vol: 0.75, rate: 0.65, master: true, ..default() }) {
            self.sample("heart", S { vol: 0.5, rate: 0.6, delay: 0.2, master: true, ..default() });
        }
    }
    pub fn low_time(&mut self) {
        self.sample("tick", S { vol: 0.5, jitter: 0.01, master: true, ..default() });
    }
    pub fn denied(&mut self) {
        self.sample("thud", S { vol: 0.45, rate: 0.75, ..default() });
    }

    // ---- bola de energia, grade e fornalha
    pub fn launch(&mut self) {
        self.sample("open", S { vol: 0.3, rate: 0.6, rate_to: 1.7, dur: 0.5, ..default() });
    }
    pub fn bounce(&mut self, dist: f32) {
        let v = (0.16 - dist * 0.006).max(0.02);
        let r = 1.6 + rand::random::<f32>() * 0.5;
        if self.sample("btnUp", S { vol: v * 3.2, rate: r, ..default() }) {
            self.sample("open", S { vol: v * 1.6, rate: 2.0, dur: 0.15, ..default() });
        }
    }
    pub fn caught(&mut self) {
        if self.sample("bell", S { vol: 0.45, rate: 1.2, ..default() }) {
            self.sample("open", S { vol: 0.3, rate: 0.7, rate_to: 1.6, dur: 0.6, ..default() });
        }
    }
    pub fn pop(&mut self) {
        self.sample("pop", S { vol: 0.28, rate: 1.4, ..default() });
    }
    pub fn burn(&mut self) {
        if self.sample("burn", S { vol: 0.5, rate: 0.9, ..default() }) {
            self.sample("hiss", S { vol: 0.3, rate: 0.8, dur: 1.2, from: 0.2, ..default() });
        }
    }
    pub fn gun(&mut self) {
        if self.sample("open", S { vol: 0.35, rate: 0.7, rate_to: 1.6, dur: 1.0, ..default() }) {
            self.sample("bell", S { vol: 0.4, rate: 1.0, delay: 0.7, ..default() });
            self.sample("shot", S { vol: 0.25, rate: 1.3, delay: 0.35, ..default() });
        }
    }
    pub fn toss(&mut self) {
        if self.sample("hiss", S { vol: 0.32, rate: 1.7, from: 0.4, dur: 0.28, ..default() }) {
            self.sample("sweepS", S { vol: 0.25, rate: 1.4, rate_to: 0.8, dur: 0.3, ..default() });
        }
    }
    pub fn plate(&mut self) {
        if self.sample("plate", S { vol: 0.55, rate: 0.9, ..default() }) {
            self.sample("spring", S { vol: 0.5, rate: 0.8, delay: 0.04, ..default() });
            self.sample("hiss", S { vol: 0.35, rate: 1.4, dur: 0.5, from: 0.2, ..default() });
        }
    }
    pub fn laser_on(&mut self) {
        if self.sample("open", S { vol: 0.4, rate: 0.6, rate_to: 1.8, dur: 0.7, ..default() }) {
            self.sample("bell", S { vol: 0.25, rate: 2.0, delay: 0.35, ..default() });
        }
    }
    pub fn sizzle(&mut self) {
        let from = 0.3 + rand::random::<f64>();
        self.sample("hiss", S { vol: 0.16, rate: 2.2, from, dur: 0.14, jitter: 0.2, ..default() });
    }
    pub fn funnel_in(&mut self) {
        self.sample("teleS", S { vol: 0.5, rate: 1.1, ..default() });
    }
    /// salto no tempo: varredura dobrando + motor e disparo ao contrário
    pub fn time_shift(&mut self, to_past: bool) {
        if self.sample("tele", S { vol: 0.7, rate: if to_past { 0.8 } else { 1.1 }, reverse: to_past, master: true, ..default() }) {
            self.sample("sweepL", S { vol: 0.5, rate: if to_past { 0.5 } else { 0.9 }, rate_to: if to_past { 1.5 } else { 0.4 }, dur: 0.8, reverse: true, master: true, ..default() });
            self.sample("shot", S { vol: 0.35, rate: 0.55, reverse: true, master: true, ..default() });
            self.sample("boom", S { vol: 0.4, rate: 1.3, delay: 0.7, master: true, ..default() });
        }
    }
    pub fn vacuum(&mut self) {
        if self.sample("boom", S { vol: 0.55, rate: 0.85, ..default() }) {
            self.sample("sweepL", S { vol: 0.4, rate: 1.4, rate_to: 0.5, dur: 1.2, ..default() });
            self.sample("hiss", S { vol: 0.4, rate: 0.7, dur: 1.4, from: 0.2, ..default() });
        }
    }
    pub fn note(&mut self, m: f32) {
        let t = self.t();
        self.fm(mtof(m), mtof(m), t, 0.6, 3.5, 1.5, 0.05, O::Sine, false);
    }
}

// ------------------------------------------------------------------ o jogo → o som
/// testes: os eventos do jogo ficam para quem os lê (o som não os apaga)
#[derive(Resource)]
pub struct KeepEvents;

/// estado do som entre quadros (passos, pouso, torretas, música da fase)
#[derive(Resource, Default)]
pub struct SoundState {
    cursor: usize,
    level: Option<usize>,
    last_grounded: bool,
    last_vy: f32,
    step_acc: f32,
    fire_at: f64,
    fire_dist: f32,
    mood: String,
    click_up: Vec<f64>,
}

pub fn audio_tick(ecs: &mut World) {
    use crate::energy::EnergyEvent as E;
    use crate::game::{Game, GameEvent as G};
    if ecs.get_non_send::<Audio>().is_none() {
        ecs.insert_non_send(Audio::new());
        ecs.init_resource::<SoundState>();
    }
    let keep = ecs.contains_resource::<KeepEvents>();
    let dt = ecs.resource::<Time>().delta_secs().min(0.05);
    let Some(mut audio) = ecs.remove_non_send::<Audio>() else { return };
    ecs.resource_scope(|ecs, mut st: Mut<SoundState>| {
        {
            let mut g = ecs.resource_mut::<Game>();
            let a = &mut audio;
            let st = &mut *st;
            let now = a.t();
            // opções do menu
            if a.music_on != g.progress.music {
                a.set_music(g.progress.music);
            }
            a.voice_on = g.progress.voice;
            // fase nova: a música dela, falas da anterior cortadas
            if g.level != st.level {
                st.level = g.level;
                a.cancel_dialog();
                a.silence_loops();
                st.mood.clear();
            }
            if let Some(i) = g.level {
                let lv = &g.levels[i];
                let base = if lv.music.is_empty() { "lab".to_string() } else { lv.music.clone() };
                let want = if g.in_tube { "labTense".to_string() } else if g.player.up_sign < 0.0 { "labEpic".to_string() } else { base };
                if lv.series.as_deref() != Some("campaign") && want != st.mood {
                    st.mood = want.clone();
                    a.set_mood(&want);
                }
            }
            let reqs = std::mem::take(&mut g.camp_audio);
            a.campaign(reqs);
            if st.cursor > g.events.len() {
                st.cursor = 0;
            }
            let eye = g.player.eye();
            let evs: Vec<G> = g.events[st.cursor..].to_vec();
            st.cursor = g.events.len();
            if !keep {
                g.events.clear();
                st.cursor = 0;
            }
            for e in evs {
                match e {
                    G::Shot(w) => a.shot(w == 0),
                    G::PortalOpen(w) => a.open(w == 0),
                    G::PortalFail => a.fail(),
                    G::Denied => a.denied(),
                    G::Teleport(_) => a.whoosh(),
                    G::Vacuum => a.vacuum(),
                    G::Gem => a.gem(),
                    G::BossHit => a.death(),
                    G::RocketShot(d) => a.turret_shot(d),
                    G::Fizzle => a.fizzle(),
                    G::Died(_) => a.death(),
                    G::Complete => a.win(),
                    G::Pick => a.pick(),
                    G::Drop => a.drop_(),
                    G::Toss => a.toss(),
                    G::Burn => a.burn(),
                    G::Press(_) => {
                        a.click(true);
                        st.click_up.push(now + 0.18);
                    }
                    G::Button(p) => a.click(p),
                    G::Door => a.door(),
                    G::Gun(_) => a.gun(),
                    G::TurretSpot(_) => a.turret_spot(),
                    G::TurretOff(_) => a.turret_down(),
                    G::Hit(_) => {
                        st.fire_at = now;
                        let d = g.props.list.iter().filter(|p| p.turret.as_ref().is_some_and(|t| t.lock >= 1.0)).map(|p| p.pos.distance(eye)).fold(f32::INFINITY, f32::min);
                        st.fire_dist = d.min(60.0);
                    }
                    G::Energy(E::Launch(_)) => a.launch(),
                    G::Energy(E::Bounce(p)) => a.bounce(p.distance(eye)),
                    G::Energy(E::Caught(_)) => a.caught(),
                    G::Energy(E::Pop(_)) => a.pop(),
                    G::Energy(E::HitPlayer) => {}
                    G::FunnelIn => a.funnel_in(),
                    G::Plate => a.plate(),
                    G::LaserOn => a.laser_on(),
                    G::Sizzle => a.sizzle(),
                    G::Lines(l) => a.say(&l),
                    G::SlowIn => {
                        a.slow_in();
                        a.set_slowmo(true);
                    }
                    G::SlowOut => {
                        a.slow_out();
                        a.set_slowmo(false);
                    }
                    G::FieldEnd => a.slow_out(),
                    G::TimeShift(p) => a.time_shift(p),
                    G::Roar(d) => a.roar(d),
                    G::Freeze(on) => {
                        if on {
                            a.freeze()
                        } else {
                            a.unfreeze()
                        }
                    }
                    G::Scrub => a.scrub(),
                    G::Echo(open) => a.echo(open),
                    G::TimeJump(_) => a.time_jump(),
                    G::Paradox(_, _) => a.paradox(),
                    G::Heartbeat => a.heartbeat(),
                    G::LowTime => a.low_time(),
                    G::FieldBurst(c) => a.thunder((1.0 - g.player.pos.distance(c) / 20.0).max(0.35)),
                    _ => {}
                }
            }
            st.click_up.retain(|&t| {
                if now >= t {
                    a.click(false);
                    false
                } else {
                    true
                }
            });
            // pouso e passos (cadência pela velocidade de verdade)
            let live = g.running && g.level.is_some() && !g.paused && !g.completed;
            let pl = &g.player;
            if pl.grounded && !st.last_grounded && st.last_vy.abs() > 3.0 {
                a.land(st.last_vy.abs());
            }
            st.last_grounded = pl.grounded;
            st.last_vy = pl.vel.y;
            let walk = (pl.vel - Vec3::Y * pl.vel.y).length();
            if live && pl.grounded && walk > 0.6 {
                st.step_acc += dt * walk / 4.6;
                if st.step_acc > 0.42 {
                    st.step_acc = 0.0;
                    let mat = match pl.ground {
                        Some(crate::physics::Ent::Static(s)) => g.world.solids.get(s).map(|b| b.mat.clone()).unwrap_or_default(),
                        _ => "white".into(),
                    };
                    a.step(&mat, walk / 4.6);
                }
            } else if !pl.grounded {
                st.step_acc = 0.3; // o primeiro passo depois de pousar vem logo
            }
            // laços contínuos
            if live {
                a.hold(if g.held.is_some() { 1.0 } else { 0.0 });
                a.slow_hum(if g.slow.on { 1.0 } else { 0.0 });
                let k = g.field.charge / g.field.need;
                a.dilate_charge(if k > 0.0 { 0.3 + 0.7 * k } else { 0.0 }, k);
                a.turret_fire(if now - st.fire_at < 0.16 { (1.0 - st.fire_dist / 30.0).max(0.2) } else { 0.0 });
                let spd = g.player.vel.length();
                a.wind(if g.in_tube { (spd / 28.0).min(1.0) } else { ((spd - 5.0) / 18.0).clamp(0.0, 1.0) });
                let lasers = g.world.lasers.iter().any(|l| !l.off && l.bridge.is_none());
                a.laser_hum(if lasers { 1.0 - ((g.frontier.nearest_beam - 0.5) / 6.0).clamp(0.0, 1.0) } else { 0.0 });
                if !g.world.funnels.is_empty() {
                    let rev = g.world.funnels.iter().any(|f| f.reversed);
                    a.funnel_hum(g.frontier.funnel_near * 0.8, if rev { -1.0 } else { 1.0 });
                }
                let fv = if g.field.inside(g.player.pos) { 0.8 } else if !g.field.active.is_empty() { 0.25 } else { 0.0 };
                if !g.world.black_holes.is_empty() || fv > 0.0 {
                    a.black_hole((g.frontier.bh_loud * g.frontier.bh_loud).max(fv));
                }
                a.gale(g.frontier.gale);
            } else {
                a.silence_loops();
            }
            a.tick();
        }
    });
    ecs.insert_non_send(audio);
}
