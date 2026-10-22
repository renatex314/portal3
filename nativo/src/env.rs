//! Luz ambiente. A versão web tem uma luz hemisférica (céu 0xdfe8ff, chão 0x4a3a30) e um mapa
//! de reflexo (RoomEnvironment) nos materiais. O Bevy não tem luz hemisférica: as duas viram um
//! só cubemap (gradiente/π + sala neutra × intensidade do reflexo), filtrado pelo
//! GeneratedEnvironmentMapLight.

use crate::mats::{asset_dir, hex};
use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension};

/// intensidade média do mapa de reflexo nos materiais do cenário (envMapIntensity 0,25–0,7)
const ENV_K: f32 = 0.35;

fn f32_to_f16(v: f32) -> u16 {
    let b = v.to_bits();
    let sign = ((b >> 16) & 0x8000) as u16;
    let exp = ((b >> 23) & 0xff) as i32;
    let man = b & 0x7f_ffff;
    if exp == 255 {
        return sign | 0x7c00;
    }
    let e = exp - 127 + 15;
    if e >= 31 {
        return sign | 0x7bff;
    }
    if e <= 0 {
        return sign;
    }
    sign | ((e as u16) << 10) | ((man >> 13) as u16)
}

/// lê o .hdr (RGBE sem RLE) que o exportador escreveu: (lado, pixels RGB das 6 faces)
fn read_hdr() -> Option<(usize, Vec<[f32; 3]>)> {
    let bytes = std::fs::read(asset_dir().join("textures/env.hdr")).ok()?;
    let head_end = bytes.windows(2).position(|w| w == b"\n\n")? + 2;
    let line_end = bytes[head_end..].iter().position(|&b| b == b'\n')? + head_end;
    let res = std::str::from_utf8(&bytes[head_end..line_end]).ok()?;
    let parts: Vec<&str> = res.split_whitespace().collect();
    let h: usize = parts.get(1)?.parse().ok()?;
    let w: usize = parts.get(3)?.parse().ok()?;
    let data = &bytes[line_end + 1..];
    let mut px = Vec::with_capacity(w * h);
    for c in data.chunks(4).take(w * h) {
        if c[3] == 0 {
            px.push([0.0; 3]);
            continue;
        }
        let f = 2f32.powi(c[3] as i32 - 128 - 8);
        px.push([c[0] as f32 * f, c[1] as f32 * f, c[2] as f32 * f]);
    }
    Some((w, px))
}

/// direção do texel (x, y) da face `f` (convenção wgpu/D3D: +x −x +y −y +z −z)
fn dir(f: usize, x: usize, y: usize, n: usize) -> Vec3 {
    let u = (x as f32 + 0.5) / n as f32 * 2.0 - 1.0;
    let v = (y as f32 + 0.5) / n as f32 * 2.0 - 1.0;
    match f {
        0 => Vec3::new(1.0, -v, -u),
        1 => Vec3::new(-1.0, -v, u),
        2 => Vec3::new(u, 1.0, v),
        3 => Vec3::new(u, -1.0, -v),
        4 => Vec3::new(u, -v, 1.0),
        _ => Vec3::new(-u, -v, -1.0),
    }
    .normalize()
}

pub fn environment_cubemap(images: &mut Assets<Image>) -> Handle<Image> {
    environment_cubemap_k(images, ENV_K)
}

/// o mesmo, com o reflexo da sala em `room_k` (os modelos da versão web usam o próprio mapa, a ~0,55)
pub fn environment_cubemap_k(images: &mut Assets<Image>, room_k: f32) -> Handle<Image> {
    let (n, room) = read_hdr().unwrap_or((64, vec![[0.4, 0.4, 0.42]; 64 * 64 * 6]));
    let sky = hex(0xdfe8ff).to_linear();
    let ground = hex(0x4a3a30).to_linear();
    let mut data = Vec::with_capacity(n * n * 6 * 8);
    for f in 0..6 {
        for y in 0..n {
            for x in 0..n {
                let d = dir(f, x, y, n);
                let w = 0.5 * d.y + 0.5;
                let hemi = [ground.red + (sky.red - ground.red) * w, ground.green + (sky.green - ground.green) * w, ground.blue + (sky.blue - ground.blue) * w];
                let r = room[f * n * n + y * n + x];
                for c in 0..3 {
                    let v = hemi[c] / std::f32::consts::PI + r[c] * room_k;
                    data.extend_from_slice(&f32_to_f16(v).to_le_bytes());
                }
                data.extend_from_slice(&f32_to_f16(1.0).to_le_bytes());
            }
        }
    }
    let mut img = Image::new(Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 6 }, TextureDimension::D2, data, TextureFormat::Rgba16Float, RenderAssetUsages::RENDER_WORLD);
    img.texture_view_descriptor = Some(TextureViewDescriptor { dimension: Some(TextureViewDimension::Cube), ..default() });
    images.add(img)
}
