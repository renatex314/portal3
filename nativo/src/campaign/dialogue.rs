//! Falas e sons da campanha original (dialogue.js, scenes.js), tocados a partir dos arquivos da
//! cópia do jogador: cenas (scenes.image) → nomes de som (scripts de som) → .wav do pacote;
//! legendas do arquivo de legendas do jogo, em português do Brasil quando houver.
//!
//! A lógica do mapa (Send) só pede: `Game::camp_audio` recebe os pedidos e o som (que vive na
//! thread principal) toca e mostra as legendas.

use super::bsp::{parse_kv, Kv};
use super::source;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use web_audio_api::context::{AudioContext, BaseAudioContext};
use web_audio_api::node::{AudioBufferSourceNode, AudioNode, AudioScheduledSourceNode, GainNode};
use web_audio_api::AudioBuffer;

pub struct Data {
    /// nome do som (minúsculo) → arquivos .wav
    pub sounds: HashMap<String, Vec<String>>,
    /// nome do som (minúsculo) → (legenda, é efeito)
    pub captions: HashMap<String, (String, bool)>,
    /// crc do caminho da cena → (duração em ms, sons em ordem)
    pub scenes: HashMap<u32, (u32, Vec<String>)>,
}

static DATA: OnceLock<Mutex<Option<(std::path::PathBuf, Arc<Data>)>>> = OnceLock::new();

/// os dados das falas da cópia escolhida (lidos uma vez)
pub fn data() -> Option<Arc<Data>> {
    let c = source::get()?;
    let slot = DATA.get_or_init(Default::default);
    if let Some((p, d)) = slot.lock().unwrap().as_ref() {
        if *p == c.path {
            return Some(d.clone());
        }
    }
    let d = Arc::new(load(c));
    *slot.lock().unwrap() = Some((c.path.clone(), d.clone()));
    Some(d)
}

pub fn crc32(s: &str) -> u32 {
    let mut c = 0xffffffffu32;
    for ch in s.chars() {
        let mut x = (c ^ (ch as u32 & 0xffff)) & 0xff;
        for _ in 0..8 {
            x = if x & 1 != 0 { 0xedb88320 ^ (x >> 1) } else { x >> 1 };
        }
        c = x ^ (c >> 8);
    }
    c ^ 0xffffffff
}

pub fn decode_text(b: &[u8]) -> String {
    if b.len() >= 2 && b[0] == 0xff && b[1] == 0xfe {
        let u: Vec<u16> = b[2..].chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&u)
    } else {
        b.iter().map(|&c| c as char).collect()
    }
}

/// nome de arquivo de som sem os prefixos de mixagem do motor (*, #, @, ^…)
pub fn clean_wave(w: &str) -> String {
    format!("sound/{}", w.trim_start_matches(['*', '#', '@', '<', '>', '^', ')', '}', '$', '!', '?', '&']).replace('\\', "/"))
}

/// legenda: tira as marcações de formatação (<clr:…>, <I>, <len:…> etc.)
fn clean_caption(s: &str) -> String {
    let mut out = String::new();
    let mut tag = false;
    for c in s.chars() {
        match c {
            '<' => tag = true,
            '>' if tag => tag = false,
            _ if !tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_scenes_image(img: &[u8]) -> HashMap<u32, (u32, Vec<String>)> {
    let d = super::mdl::D(img);
    let n_scenes = d.i32(8).max(0) as usize;
    let n_strings = d.i32(12).max(0) as usize;
    let entry = d.i32(16) as usize;
    let s = |k: usize| d.cstr(d.i32(20 + k * 4) as usize);
    let mut out = HashMap::new();
    for i in 0..n_scenes {
        let at = entry + i * 16;
        let sum = d.i32(at + 12) as usize;
        let count = d.i32(sum + 4).max(0) as usize;
        let sounds = (0..count.min(n_strings)).map(|k| s(d.i32(sum + 8 + k * 4) as usize)).collect();
        out.insert(d.u32(at), (d.u32(sum), sounds));
    }
    out
}

fn load(c: &source::Campaign) -> Data {
    let mut sounds = HashMap::new();
    if let Some(m) = c.read("scripts/game_sounds_manifest.txt") {
        let manifest = parse_kv(&decode_text(&m));
        let files: Vec<String> = manifest.first().map(|r| r.children.iter().filter(|c| c.key.to_lowercase().ends_with("file")).filter_map(|c| c.value.clone()).collect()).unwrap_or_default();
        for f in files {
            let Some(bytes) = c.read(&f) else { continue };
            for node in parse_kv(&decode_text(&bytes)) {
                if node.children.is_empty() {
                    continue;
                }
                let mut waves = vec![];
                if let Some(w) = node.val("wave") {
                    waves.push(w.to_string());
                }
                if let Some(r) = node.get("rndwave") {
                    waves.extend(r.children.iter().filter_map(|w| w.value.clone()));
                }
                if !waves.is_empty() {
                    sounds.insert(node.key.to_lowercase(), waves.iter().map(|w| clean_wave(w)).collect());
                }
            }
        }
    }
    let scenes = c.read("scenes/scenes.image").map(|b| parse_scenes_image(&b)).unwrap_or_default();
    let mut captions = HashMap::new();
    let langs: &[&str] = if crate::i18n::is_en() { &["english", "brazilian", "portuguese"] } else { &["brazilian", "portuguese", "english"] };
    for lang in langs {
        let Some(bytes) = c.src.file(&format!("portal/resource/closecaption_{lang}.txt")) else { continue };
        let root = parse_kv(&decode_text(&bytes));
        let tokens: Option<&Kv> = root.first().and_then(|r| r.get("Tokens"));
        for t in tokens.map(|t| t.children.as_slice()).unwrap_or(&[]) {
            let v = t.value.clone().unwrap_or_default();
            captions.insert(t.key.to_lowercase(), (clean_caption(&v), v.to_lowercase().contains("<sfx>")));
        }
        if !captions.is_empty() {
            break;
        }
    }
    Data { sounds, captions, scenes }
}

impl Data {
    /// cena pelo caminho do arquivo (.vcd), como está no mapa
    pub fn scene(&self, file: &str) -> Option<&(u32, Vec<String>)> {
        let name = file.to_lowercase().replace('/', "\\");
        self.scenes.get(&crc32(&name)).or_else(|| self.scenes.get(&crc32(&name.replace('\\', "/"))))
    }

    /// nomes de som que começam com `prefix`, em ordem numérica (falas dos núcleos)
    pub fn sound_names(&self, prefix: &str) -> Vec<String> {
        let p = prefix.to_lowercase();
        let mut v: Vec<String> = self.sounds.keys().filter(|k| k.starts_with(&p)).cloned().collect();
        v.sort_by_key(|k| super::bsp::parse_i(&k[p.len()..]).unwrap_or(0));
        v
    }
}

// ------------------------------------------------------------------ pedidos (lógica → som)
#[derive(Clone, Debug)]
pub enum Req {
    /// cena falada: `wait` entra depois da fala atual; senão interrompe
    Scene { file: String, wait: bool },
    StopVoice(Option<String>),
    Sound { id: u64, name: String, vol: f32 },
    StopSound { id: u64, fade: f32 },
    Volume { id: u64, v: f32 },
    StopAll,
}

// ------------------------------------------------------------------ o som (thread principal)
struct Voice {
    file: String,
    srcs: Vec<(AudioBufferSourceNode, GainNode)>,
    subs: Vec<(f64, String, f64)>,
}

#[derive(Default)]
pub struct Player {
    buffers: HashMap<String, Option<AudioBuffer>>,
    voice: Option<Voice>,
    voice_end: f64,
    handles: HashMap<u64, (AudioBufferSourceNode, GainNode)>,
    /// legendas soltas (sons fora de cena): início, texto, duração
    subs: Vec<(f64, String, f64)>,
    pub showing: Option<(String, String)>,
}

impl Player {
    fn buffer(&mut self, ctx: &AudioContext, data: &Data, name: &str) -> Option<AudioBuffer> {
        let lname = name.to_lowercase();
        let waves = data.sounds.get(&lname).cloned().or_else(|| (lname.ends_with(".wav") || lname.ends_with(".mp3")).then(|| vec![clean_wave(name)]))?;
        let path = waves[rand::random_range(0..waves.len())].to_lowercase();
        if let Some(b) = self.buffers.get(&path) {
            return b.clone();
        }
        let b = source::get().and_then(|c| c.read(&path)).and_then(|bytes| ctx.decode_audio_data_sync(std::io::Cursor::new(bytes)).ok());
        self.buffers.insert(path, b.clone());
        b
    }

    fn schedule(&self, ctx: &AudioContext, out: &dyn AudioNode, buf: &AudioBuffer, when: f64, vol: f32) -> (AudioBufferSourceNode, GainNode) {
        let mut src = ctx.create_buffer_source();
        src.set_buffer(buf.clone());
        let g = ctx.create_gain();
        g.gain().set_value(vol);
        src.connect(&g);
        g.connect(out);
        src.start_at(when);
        (src, g)
    }

    fn caption(data: &Data, name: &str) -> Option<String> {
        data.captions.get(&name.to_lowercase()).filter(|c| !c.1 && !c.0.is_empty()).map(|c| c.0.clone())
    }

    fn stop_voice(&mut self, now: f64, file: Option<&str>) {
        let Some(v) = &self.voice else { return };
        if file.is_some_and(|f| f.to_lowercase() != v.file) {
            return;
        }
        let v = self.voice.take().unwrap();
        for (mut s, g) in v.srcs {
            g.gain().set_value_at_time(g.gain().value(), now);
            g.gain().linear_ramp_to_value_at_time(0.0, now + 0.15);
            s.stop_at(now + 0.2);
        }
        self.voice_end = now;
        self.showing = None;
    }

    pub fn handle(&mut self, ctx: &AudioContext, out: &dyn AudioNode, reqs: Vec<Req>) {
        let Some(data) = data() else { return };
        let now = ctx.current_time();
        for r in reqs {
            match r {
                Req::Scene { file, wait } => {
                    let Some((ms, sounds)) = data.scene(&file).cloned() else { continue };
                    let start = if wait { now.max(self.voice_end) } else { now };
                    if !wait {
                        self.stop_voice(now, None);
                    }
                    let bufs: Vec<Option<AudioBuffer>> = sounds.iter().map(|s| self.buffer(ctx, &data, s)).collect();
                    // os sons da cena em sequência, com o tempo que sobra dividido entre as pausas
                    let total: f64 = bufs.iter().flatten().map(|b| b.duration()).sum();
                    let gap = ((ms as f64 / 1000.0 - total) / (sounds.len() + 1) as f64).clamp(0.12, 1.5);
                    let mut t = start.max(now) + 0.05;
                    let mut v = Voice { file: file.to_lowercase(), srcs: vec![], subs: vec![] };
                    for (k, name) in sounds.iter().enumerate() {
                        let Some(b) = &bufs[k] else { continue };
                        v.srcs.push(self.schedule(ctx, out, b, t, 1.0));
                        if let Some(c) = Self::caption(&data, name) {
                            v.subs.push((t, c, b.duration() + 0.4));
                        }
                        t += b.duration() + gap;
                    }
                    self.voice_end = (start + ms as f64 / 1000.0).max(t);
                    self.voice = Some(v);
                }
                Req::StopVoice(f) => self.stop_voice(now, f.as_deref()),
                Req::Sound { id, name, vol } => {
                    let Some(b) = self.buffer(ctx, &data, &name) else { continue };
                    let h = self.schedule(ctx, out, &b, now + 0.02, vol);
                    if let Some(c) = Self::caption(&data, &name) {
                        self.subs.push((now + 0.02, c, b.duration() + 0.4));
                    }
                    self.handles.insert(id, h);
                }
                Req::StopSound { id, fade } => {
                    if let Some((mut s, g)) = self.handles.remove(&id) {
                        if fade > 0.0 {
                            g.gain().set_value_at_time(g.gain().value(), now);
                            g.gain().linear_ramp_to_value_at_time(0.0, now + fade as f64);
                            s.stop_at(now + fade as f64 + 0.05);
                        } else {
                            s.stop();
                        }
                    }
                }
                Req::Volume { id, v } => {
                    if let Some((_, g)) = self.handles.get(&id) {
                        g.gain().set_target_at_time(v, now, 0.05);
                    }
                }
                Req::StopAll => {
                    self.stop_voice(now, None);
                    for (_, (mut s, _)) in self.handles.drain() {
                        s.stop();
                    }
                    self.subs.clear();
                    self.showing = None;
                }
            }
        }
    }

    /// a legenda que deve estar na tela agora
    pub fn tick(&mut self, now: f64) {
        self.subs.retain(|s| now < s.0 + s.2);
        let cur = self.voice.as_ref().map(|v| v.subs.as_slice()).unwrap_or(&[]).iter().chain(self.subs.iter()).filter(|s| now >= s.0 && now < s.0 + s.2).max_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        self.showing = cur.map(|s| ("GLaDOS".to_string(), s.1.clone()));
    }
}
