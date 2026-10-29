//! Materiais do cenário (o `materials()` do world.js): texturas exportadas da versão web
//! (assets/textures/*.png), com mipmaps gerados aqui e a mesma repetição/orientação do three.js.

use bevy::asset::RenderAssetUsages;
use bevy::image::{CompressedImageFormats, ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor, ImageType};
use bevy::math::Affine2;
use bevy::prelude::*;
use std::collections::HashMap;
use std::path::PathBuf;

/// pasta `assets` (ao lado do executável no pacote; no desenvolvimento, a do projeto)
pub fn asset_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PORTAL3_ASSETS") {
        return PathBuf::from(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        for p in exe.ancestors().skip(1).take(4) {
            // (no .app do Mac: Contents/Resources/assets)
            for a in [p.join("assets"), p.join("Resources").join("assets")] {
                if a.join("levels/levels.json").exists() {
                    return a;
                }
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")
}

/// cor do three.js `new Color(hex)` (sRGB → linear)
pub fn hex(h: u32) -> Color {
    Color::srgb_u8((h >> 16) as u8, (h >> 8 & 255) as u8, (h & 255) as u8)
}

/// `new Color(hex).multiplyScalar(k)` (linear, pode passar de 1)
pub fn hex_k(h: u32, k: f32) -> LinearRgba {
    let c = hex(h).to_linear();
    LinearRgba::rgb(c.red * k, c.green * k, c.blue * k)
}

/// imagem de um PNG, com mipmaps (média 2×2 por nível) e amostragem repetida
pub fn load_png(path: &std::path::Path, srgb: bool, fix_rough: bool) -> Option<Image> {
    let bytes = std::fs::read(path).ok()?;
    let sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::Repeat,
        address_mode_v: ImageAddressMode::Repeat,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        anisotropy_clamp: 8,
        ..default()
    });
    // (o carregador de PNG já entrega RGBA8, em sRGB ou linear conforme `srgb`)
    let mut img = Image::from_buffer(&bytes, ImageType::Extension("png"), CompressedImageFormats::NONE, srgb, sampler, RenderAssetUsages::RENDER_WORLD).ok()?;
    let w = img.width() as usize;
    let h = img.height() as usize;
    let mut level = img.data.take().unwrap_or_default();
    if level.len() != w * h * 4 {
        return None;
    }
    if fix_rough {
        // rugosidade do three.js vem do canal verde; o Bevy lê o metal do azul: azul = 1
        for px in level.chunks_mut(4) {
            px[2] = 255;
        }
    }
    let mut data = level.clone();
    let (mut lw, mut lh) = (w, h);
    let mut count = 1;
    while lw > 1 || lh > 1 {
        let (nw, nh) = ((lw / 2).max(1), (lh / 2).max(1));
        let mut next = vec![0u8; nw * nh * 4];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let mut s = 0u32;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let sx = (x * 2 + dx).min(lw - 1);
                        let sy = (y * 2 + dy).min(lh - 1);
                        s += level[(sy * lw + sx) * 4 + c] as u32;
                    }
                    next[(y * nw + x) * 4 + c] = (s / 4) as u8;
                }
            }
        }
        data.extend_from_slice(&next);
        level = next;
        lw = nw;
        lh = nh;
        count += 1;
    }
    img.data = Some(data);
    img.texture_descriptor.mip_level_count = count;
    Some(img)
}

/// um conjunto de mapas (cor, relevo, rugosidade) de uma textura exportada
#[derive(Clone, Default)]
pub struct TexSet {
    pub map: Option<Handle<Image>>,
    pub normal: Option<Handle<Image>>,
    pub rough: Option<Handle<Image>>,
    pub repeat: f32,
}

/// os materiais de caixa por tipo: `faces` = um material para cada face (+x −x +y −y +z −z)
#[derive(Clone)]
pub struct BoxMat {
    pub faces: [Handle<StandardMaterial>; 6],
    pub portalable: bool,
}

#[derive(Resource, Clone)]
pub struct Mats {
    pub kinds: HashMap<String, BoxMat>,
    pub door: Handle<StandardMaterial>,
    pub frame: Handle<StandardMaterial>,
    pub dark: Handle<StandardMaterial>,
    pub metal: Handle<StandardMaterial>,
    pub tex: HashMap<String, TexSet>,
}

impl Mats {
    pub fn kind(&self, name: &str) -> &BoxMat {
        self.kinds.get(name).unwrap_or_else(|| &self.kinds["metal"])
    }
}

fn textured(t: &TexSet, color: Color, rough: f32, metal: f32) -> StandardMaterial {
    let r = t.repeat.max(1e-3);
    StandardMaterial {
        base_color: color,
        base_color_texture: t.map.clone(),
        normal_map_texture: t.normal.clone(),
        metallic_roughness_texture: t.rough.clone(),
        perceptual_roughness: rough,
        metallic: metal,
        // repetição do three.js (texture.repeat) e a textura de canvas virada (flipY)
        uv_transform: Affine2::from_scale(Vec2::new(r, -r)),
        ..default()
    }
}

/// carrega as texturas e monta os materiais (uma vez, na partida)
pub fn build_mats(images: &mut Assets<Image>, materials: &mut Assets<StandardMaterial>) -> Mats {
    let dir = asset_dir().join("textures");
    let manifest: serde_json::Value = std::fs::read_to_string(dir.join("manifest.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    // decodifica os PNGs (e monta os mipmaps) em paralelo: é a maior parte do tempo de abertura
    struct Job {
        name: String,
        slot: usize,
        path: String,
        srgb: bool,
        rough: bool,
    }
    let mut jobs: Vec<Job> = vec![];
    let mut repeats = HashMap::new();
    if let Some(obj) = manifest.as_object() {
        for (name, v) in obj {
            repeats.insert(name.clone(), v.get("repeat").and_then(|r| r.as_f64()).unwrap_or(1.0) as f32);
            for (slot, (k, srgb, rough)) in [("map", true, false), ("normal", false, false), ("rough", false, true)].into_iter().enumerate() {
                if let Some(p) = v.get(k).and_then(|p| p.as_str()) {
                    jobs.push(Job { name: name.clone(), slot, path: p.to_string(), srgb, rough });
                }
            }
        }
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let done: std::sync::Mutex<Vec<(usize, Option<Image>)>> = Default::default();
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
    std::thread::scope(|sc| {
        for _ in 0..workers {
            sc.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(j) = jobs.get(i) else { break };
                let img = load_png(&asset_dir().join(&j.path), j.srgb, j.rough);
                done.lock().unwrap().push((i, img));
            });
        }
    });
    let mut loaded: HashMap<usize, Option<Image>> = done.into_inner().unwrap().into_iter().collect();
    let mut tex: HashMap<String, TexSet> = HashMap::new();
    for (i, j) in jobs.iter().enumerate() {
        let h = loaded.remove(&i).flatten().map(|im| images.add(im));
        let t = tex.entry(j.name.clone()).or_insert_with(|| TexSet { repeat: repeats[&j.name], ..default() });
        match j.slot {
            0 => t.map = h,
            1 => t.normal = h,
            _ => t.rough = h,
        }
    }
    let t = |n: &str| tex.get(n).cloned().unwrap_or_default();
    let wall = materials.add(textured(&t("whiteWall"), Color::WHITE, 1.0, 0.0));
    let floor = materials.add(textured(&t("whiteFloor"), Color::WHITE, 1.0, 0.0));
    let ceil = materials.add(textured(&t("ceiling"), hex(0xc8c8c8), 1.0, 0.0));
    let mwall = materials.add(textured(&t("metalWall"), hex(0xc4c8d0), 1.0, 0.65));
    let mfloor = materials.add(textured(&t("metalFloor"), hex(0xc8ccd2), 1.0, 0.7));
    let rock = materials.add(textured(&t("rock"), Color::WHITE, 0.95, 0.0));
    let stripe = materials.add(textured(&t("hazardStripe"), Color::WHITE, 0.6, 0.0));
    let moon = materials.add(textured(&t("moonGround"), Color::WHITE, 1.0, 0.0));
    let glass = materials.add(StandardMaterial {
        base_color: hex(0xa8dcff).with_alpha(0.16),
        alpha_mode: AlphaMode::Blend,
        perceptual_roughness: 0.04,
        metallic: 0.1,
        clearcoat: 1.0,
        clearcoat_perceptual_roughness: 0.04,
        ..default()
    });
    // (a rocha fundida tem material próprio: lava.rs troca este pelo shader)
    let magma = materials.add(StandardMaterial { base_color: hex(0x401006), emissive: LinearRgba::rgb(2.0, 0.4, 0.05), ..default() });
    let six = |h: &Handle<StandardMaterial>| std::array::from_fn::<_, 6, _>(|_| h.clone());
    let side6 = |side: &Handle<StandardMaterial>, top: &Handle<StandardMaterial>, bottom: &Handle<StandardMaterial>| [side.clone(), side.clone(), top.clone(), bottom.clone(), side.clone(), side.clone()];
    let mut kinds = HashMap::new();
    kinds.insert("white".into(), BoxMat { faces: side6(&wall, &floor, &ceil), portalable: true });
    kinds.insert("metal".into(), BoxMat { faces: side6(&mwall, &mfloor, &mwall), portalable: false });
    kinds.insert("rock".into(), BoxMat { faces: six(&rock), portalable: false });
    kinds.insert("glass".into(), BoxMat { faces: six(&glass), portalable: false });
    kinds.insert("magma".into(), BoxMat { faces: six(&magma), portalable: false });
    kinds.insert("stripe".into(), BoxMat { faces: six(&stripe), portalable: false });
    kinds.insert("moon".into(), BoxMat { faces: six(&moon), portalable: true });
    let door = materials.add(textured(&t("doorPanel"), hex(0xd0d4dc), 0.55, 0.6));
    let frame = materials.add(StandardMaterial { base_color: hex(0x2a2c30), perceptual_roughness: 0.45, metallic: 0.8, ..default() });
    let dark = materials.add(StandardMaterial { base_color: hex(0x15161a), perceptual_roughness: 0.5, metallic: 0.6, ..default() });
    Mats { kinds, door, frame, dark, metal: mwall, tex }
}

/// material "básico" do three.js (sem luz): cor linear que pode passar de 1 (brilha com o bloom)
pub fn basic(materials: &mut Assets<StandardMaterial>, c: LinearRgba) -> Handle<StandardMaterial> {
    materials.add(StandardMaterial { base_color: Color::LinearRgba(c), unlit: true, ..default() })
}

/// básico transparente (aditivo ou não)
pub fn basic_alpha(materials: &mut Assets<StandardMaterial>, c: LinearRgba, opacity: f32, additive: bool) -> Handle<StandardMaterial> {
    materials.add(StandardMaterial {
        base_color: Color::LinearRgba(LinearRgba { alpha: opacity, ..c }),
        unlit: true,
        alpha_mode: if additive { AlphaMode::Add } else { AlphaMode::Blend },
        ..default()
    })
}

// ------------------------------------------------------------------ texturas desenhadas na hora
use crate::raster::{css, Canvas};
use bevy::ecs::world::World as Ecs;
use rand::Rng;

#[derive(Resource, Default)]
pub struct SmallTex {
    pub grate_box: Option<Handle<StandardMaterial>>,
    pub grate_disc: Option<Handle<StandardMaterial>>,
    pub moon: Option<Handle<Image>>,
    pub earth: Option<Handle<Image>>,
}

/// grade de metal vazada (a das salas de torretas): só as barras são desenhadas
pub fn grate_material(ecs: &mut Ecs) -> Handle<StandardMaterial> {
    if let Some(h) = ecs.resource::<SmallTex>().grate_box.clone() {
        return h;
    }
    let mut c = Canvas::new(256, 256);
    let step = 256.0 / 12.0;
    for i in 0..12 {
        c.fill_rect(i as f32 * step, 0.0, 4.0, 256.0, css("#5c6268"));
        c.fill_rect(0.0, i as f32 * step, 256.0, 4.0, css("#5c6268"));
    }
    for i in 0..12 {
        c.fill_rect(i as f32 * step, 0.0, 1.0, 256.0, css("rgba(255,255,255,0.18)"));
        c.fill_rect(0.0, i as f32 * step, 256.0, 1.0, css("rgba(255,255,255,0.18)"));
    }
    let img = ecs.resource_mut::<Assets<Image>>().add(c.image(true, true));
    let m = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial {
        base_color_texture: Some(img),
        alpha_mode: AlphaMode::Mask(0.5),
        double_sided: true,
        cull_mode: None,
        metallic: 0.7,
        perceptual_roughness: 0.45,
        uv_transform: Affine2::from_scale(Vec2::new(1.0, -1.0)),
        ..default()
    });
    ecs.resource_mut::<SmallTex>().grate_box = Some(m.clone());
    m
}

/// piso de grade do elevador (furos quadrados transparentes)
pub fn grate_disc_material(ecs: &mut Ecs) -> Handle<StandardMaterial> {
    if let Some(h) = ecs.resource::<SmallTex>().grate_disc.clone() {
        return h;
    }
    let mut c = Canvas::new(256, 256);
    c.fill_rect(0.0, 0.0, 256.0, 256.0, css("#9aa0a8"));
    for x in (0..256).step_by(16) {
        for y in (0..256).step_by(16) {
            c.clear_rect(x + 3, y + 3, 10, 10);
        }
    }
    let img = ecs.resource_mut::<Assets<Image>>().add(c.image(true, true));
    let m = ecs.resource_mut::<Assets<StandardMaterial>>().add(StandardMaterial {
        base_color: hex(0x2a2c30),
        base_color_texture: Some(img),
        alpha_mode: AlphaMode::Mask(0.5),
        perceptual_roughness: 0.5,
        metallic: 0.8,
        uv_transform: Affine2::from_scale(Vec2::new(4.0, -4.0)),
        ..default()
    });
    ecs.resource_mut::<SmallTex>().grate_disc = Some(m.clone());
    m
}

/// superfície da Lua: cinza com mares escuros e crateras
pub fn moon_texture(ecs: &mut Ecs) -> Handle<Image> {
    if let Some(h) = ecs.resource::<SmallTex>().moon.clone() {
        return h;
    }
    let mut c = Canvas::new(1024, 512);
    let mut r = rand::rng();
    c.fill_rect(0.0, 0.0, 1024.0, 512.0, css("#9a9a96"));
    c.grain(0.0, 0.0, 1024.0, 512.0, 30000, 0.12, 2.0);
    for _ in 0..9 {
        let (x, y, rr) = (r.random::<f32>() * 1024.0, 120.0 + r.random::<f32>() * 280.0, 60.0 + r.random::<f32>() * 120.0);
        c.radial(x, y, 0.0, rr, &[(0.0, css("rgba(60,60,64,0.55)")), (1.0, css("rgba(60,60,64,0)"))]);
    }
    for _ in 0..260 {
        let (x, y) = (r.random::<f32>() * 1024.0, r.random::<f32>() * 512.0);
        let rr = 2.0 + r.random::<f32>().powi(3) * 30.0;
        c.stroke_arc(x, y, rr, 0.0, std::f32::consts::TAU, (rr * 0.25).max(1.0), css("rgba(40,40,40,0.35)"));
        c.stroke_arc(x - rr * 0.15, y - rr * 0.15, rr, std::f32::consts::PI, std::f32::consts::PI * 1.6, (rr * 0.25).max(1.0), css("rgba(230,230,225,0.25)"));
    }
    let h = ecs.resource_mut::<Assets<Image>>().add(c.image(true, false));
    ecs.resource_mut::<SmallTex>().moon = Some(h.clone());
    h
}

/// a Terra: oceanos, continentes e nuvens
pub fn earth_texture(ecs: &mut Ecs) -> Handle<Image> {
    if let Some(h) = ecs.resource::<SmallTex>().earth.clone() {
        return h;
    }
    let mut c = Canvas::new(1024, 512);
    let mut r = rand::rng();
    c.fill_rect(0.0, 0.0, 1024.0, 512.0, css("#1d4f9a"));
    for _ in 0..40 {
        let (x, y) = (r.random::<f32>() * 1024.0, 80.0 + r.random::<f32>() * 350.0);
        let col = if r.random::<bool>() { css("#3f7a3a") } else { css("#8a7a4a") };
        let pts: Vec<(f32, f32)> = (0..9)
            .map(|k| {
                let a = k as f32 / 9.0 * std::f32::consts::TAU;
                let rr = 20.0 + r.random::<f32>() * 60.0;
                (x + a.cos() * rr * 1.6, y + a.sin() * rr)
            })
            .collect();
        c.fill_poly(&pts, col);
    }
    c.fill_rect(0.0, 0.0, 1024.0, 30.0, css("rgba(240,245,255,0.9)"));
    c.fill_rect(0.0, 482.0, 1024.0, 30.0, css("rgba(240,245,255,0.9)"));
    for _ in 0..120 {
        let a = 0.2 + r.random::<f32>() * 0.4;
        c.fill_ellipse(r.random::<f32>() * 1024.0, r.random::<f32>() * 512.0, 20.0 + r.random::<f32>() * 60.0, 4.0 + r.random::<f32>() * 10.0, [1.0, 1.0, 1.0, a]);
    }
    let h = ecs.resource_mut::<Assets<Image>>().add(c.image(true, false));
    ecs.resource_mut::<SmallTex>().earth = Some(h.clone());
    h
}

/// cor de antes da curva de tom que sai como `c` (com o brilho da câmera principal): para os materiais
/// que na versão web não passam pela curva (`toneMapped: false`) — lá a cor sai direto, cortada em 1
pub fn untonemap(c: LinearRgba) -> LinearRgba {
    // ACES ajustado do Bevy: rrt = R·v; curva por canal; odt = O·curva
    let r = Mat3::from_cols(Vec3::new(0.59719, 0.07600, 0.02840), Vec3::new(0.35458, 0.90834, 0.13383), Vec3::new(0.04823, 0.01566, 0.83777));
    let o = Mat3::from_cols(Vec3::new(1.60475, -0.10208, -0.00327), Vec3::new(-0.53108, 1.10813, -0.07276), Vec3::new(-0.07367, -0.00605, 1.07602));
    let t = Vec3::new(c.red, c.green, c.blue).clamp(Vec3::ZERO, Vec3::splat(0.97));
    let y = (o.inverse() * t).clamp(Vec3::ZERO, Vec3::splat(0.97));
    // a/b = y, com a = v(v + 0,0245786) − 0,000090537 e b = v(0,983729 v + 0,4329510) + 0,238081
    let inv = |y: f32| {
        let (a, b, cc) = (1.0 - 0.983729 * y, 0.0245786 - 0.432951 * y, -(0.000090537 + 0.238081 * y));
        (-b + (b * b - 4.0 * a * cc).max(0.0).sqrt()) / (2.0 * a)
    };
    let v = Vec3::new(inv(y.x), inv(y.y), inv(y.z));
    let x = (r.inverse() * v).max(Vec3::ZERO) / 2f32.powf(crate::GRADE_EV);
    LinearRgba::new(x.x, x.y, x.z, c.alpha)
}
