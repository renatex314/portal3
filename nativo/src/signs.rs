//! Placas das câmaras (o `sign()` do world.js): uma imagem 1024×512 com faixas pretas em cima e
//! embaixo e linhas de texto em negrito, como o canvas da versão web.

use crate::mats::asset_dir;
use ab_glyph::{Font, FontVec, PxScale, ScaleFont};
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use std::sync::OnceLock;

/// uma linha: texto, tamanho (px), linha de base (px), cor (#rrggbb) e fonte ("Arial..." ou "Arial Black...")
#[derive(Clone, Debug)]
pub struct SignLine {
    pub text: String,
    pub size: f32,
    pub y: f32,
    pub color: [u8; 3],
    pub black: bool,
}

fn fonts() -> &'static (FontVec, FontVec) {
    static F: OnceLock<(FontVec, FontVec)> = OnceLock::new();
    F.get_or_init(|| {
        let load = |n: &str| FontVec::try_from_vec(std::fs::read(asset_dir().join("fonts").join(n)).unwrap_or_default()).expect("fonte");
        (load("ArchivoBlack-Regular.ttf"), load("Arimo-Bold.ttf"))
    })
}

pub fn css_color(s: &str) -> [u8; 3] {
    let s = s.trim_start_matches('#');
    let v = u32::from_str_radix(s, 16).unwrap_or(0x1d1d1f);
    if s.len() == 3 {
        let r = (v >> 8) & 15;
        let g = (v >> 4) & 15;
        let b = v & 15;
        [(r * 17) as u8, (g * 17) as u8, (b * 17) as u8]
    } else {
        [(v >> 16) as u8, (v >> 8) as u8, v as u8]
    }
}

fn blend(px: &mut [u8], c: [u8; 3], a: f32) {
    for i in 0..3 {
        px[i] = (px[i] as f32 * (1.0 - a) + c[i] as f32 * a).round() as u8;
    }
}

/// escreve `text` com a fonte em `size` px (tamanho CSS: o "em"), linha de base em `y`
pub fn draw_text(buf: &mut [u8], w: usize, h: usize, font: &FontVec, text: &str, size: f32, x0: f32, y: f32, color: [u8; 3]) -> f32 {
    let em = font.units_per_em().unwrap_or(1000.0);
    let scale = PxScale::from(size * font.height_unscaled() / em);
    let sf = font.as_scaled(scale);
    let mut x = x0;
    let mut prev = None;
    for ch in text.chars() {
        let id = font.glyph_id(ch);
        if let Some(p) = prev {
            x += sf.kern(p, id);
        }
        let g = id.with_scale_and_position(scale, ab_glyph::point(x, y));
        if let Some(out) = font.outline_glyph(g) {
            let b = out.px_bounds();
            out.draw(|gx, gy, cov| {
                let px = b.min.x as i32 + gx as i32;
                let py = b.min.y as i32 + gy as i32;
                if px >= 0 && py >= 0 && (px as usize) < w && (py as usize) < h {
                    let i = (py as usize * w + px as usize) * 4;
                    blend(&mut buf[i..i + 4], color, cov.min(1.0));
                }
            });
        }
        x += sf.h_advance(id);
        prev = Some(id);
    }
    x
}

pub fn sign_image(lines: &[SignLine]) -> Image {
    let (w, h) = (1024usize, 512usize);
    let mut buf = vec![0u8; w * h * 4];
    for px in buf.chunks_mut(4) {
        px.copy_from_slice(&[0xf3, 0xf2, 0xee, 255]);
    }
    for y in (0..22).chain(490..512) {
        for x in 0..w {
            let i = (y * w + x) * 4;
            buf[i..i + 3].copy_from_slice(&[0x1d, 0x1d, 0x1f]);
        }
    }
    let (black, arial) = fonts();
    for l in lines {
        draw_text(&mut buf, w, h, if l.black { black } else { arial }, &l.text, l.size, 60.0, l.y, l.color);
    }
    let mut img = Image::new(Extent3d { width: w as u32, height: h as u32, depth_or_array_layers: 1 }, TextureDimension::D2, buf, TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD);
    img.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor { anisotropy_clamp: 8, ..ImageSamplerDescriptor::linear() });
    img
}
