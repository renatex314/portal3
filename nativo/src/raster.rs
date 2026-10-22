//! Um "canvas 2D" mínimo para as texturas que a versão web desenha na hora (grades, Lua,
//! Terra, holograma da arma...): retângulos, gradientes radiais, círculos, elipses, polígonos.

use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use rand::Rng;

pub struct Canvas {
    pub w: usize,
    pub h: usize,
    /// RGBA em 0..1 (sRGB, como o canvas)
    pub px: Vec<[f32; 4]>,
}

pub fn css(s: &str) -> [f32; 4] {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("rgba(").or_else(|| s.strip_prefix("rgb(")) {
        let v: Vec<f32> = inner.trim_end_matches(')').split(',').map(|x| x.trim().parse().unwrap_or(0.0)).collect();
        return [v[0] / 255.0, v[1] / 255.0, v[2] / 255.0, *v.get(3).unwrap_or(&1.0)];
    }
    let c = crate::signs::css_color(s);
    [c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0, 1.0]
}

impl Canvas {
    pub fn new(w: usize, h: usize) -> Self {
        Canvas { w, h, px: vec![[0.0; 4]; w * h] }
    }

    fn blend_px(&mut self, x: i32, y: i32, c: [f32; 4]) {
        if x < 0 || y < 0 || x as usize >= self.w || y as usize >= self.h {
            return;
        }
        let d = &mut self.px[y as usize * self.w + x as usize];
        let a = c[3];
        let out_a = a + d[3] * (1.0 - a);
        for i in 0..3 {
            d[i] = if out_a > 0.0 { (c[i] * a + d[i] * d[3] * (1.0 - a)) / out_a } else { 0.0 };
        }
        d[3] = out_a;
    }

    pub fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, c: [f32; 4]) {
        let (x0, y0) = (x.floor() as i32, y.floor() as i32);
        let (x1, y1) = ((x + w).ceil() as i32, (y + h).ceil() as i32);
        for yy in y0..y1 {
            for xx in x0..x1 {
                // cobertura parcial nas bordas
                let cx = ((xx as f32 + 1.0).min(x + w) - (xx as f32).max(x)).clamp(0.0, 1.0);
                let cy = ((yy as f32 + 1.0).min(y + h) - (yy as f32).max(y)).clamp(0.0, 1.0);
                let k = cx * cy;
                if k > 0.0 {
                    self.blend_px(xx, yy, [c[0], c[1], c[2], c[3] * k]);
                }
            }
        }
    }

    pub fn clear_rect(&mut self, x: usize, y: usize, w: usize, h: usize) {
        for yy in y..(y + h).min(self.h) {
            for xx in x..(x + w).min(self.w) {
                self.px[yy * self.w + xx] = [0.0; 4];
            }
        }
    }

    /// pinta toda a área com um gradiente radial (cores por paradas) — fillRect com createRadialGradient
    pub fn radial(&mut self, cx: f32, cy: f32, r0: f32, r1: f32, stops: &[(f32, [f32; 4])]) {
        for y in 0..self.h {
            for x in 0..self.w {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let t = ((d - r0) / (r1 - r0).max(1e-6)).clamp(0.0, 1.0);
                let mut c = stops[0].1;
                for k in 0..stops.len() - 1 {
                    let (a, b) = (stops[k], stops[k + 1]);
                    if t >= a.0 && t <= b.0 {
                        let u = (t - a.0) / (b.0 - a.0).max(1e-6);
                        c = [0, 1, 2, 3].map(|i| a.1[i] + (b.1[i] - a.1[i]) * u);
                        break;
                    }
                    if t > b.0 {
                        c = b.1;
                    }
                }
                if c[3] > 0.0 {
                    self.blend_px(x as i32, y as i32, c);
                }
            }
        }
    }

    /// elipse cheia (com antisserrilhado simples)
    pub fn fill_ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, c: [f32; 4]) {
        let (x0, x1) = ((cx - rx - 1.0) as i32, (cx + rx + 1.0) as i32);
        let (y0, y1) = ((cy - ry - 1.0) as i32, (cy + ry + 1.0) as i32);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let dx = (x as f32 + 0.5 - cx) / rx.max(1e-3);
                let dy = (y as f32 + 0.5 - cy) / ry.max(1e-3);
                let d = (dx * dx + dy * dy).sqrt();
                let k = ((1.0 - d) * rx.min(ry) + 0.5).clamp(0.0, 1.0);
                if k > 0.0 {
                    self.blend_px(x, y, [c[0], c[1], c[2], c[3] * k]);
                }
            }
        }
    }

    /// arco (contorno) entre os ângulos a0..a1
    pub fn stroke_arc(&mut self, cx: f32, cy: f32, r: f32, a0: f32, a1: f32, lw: f32, c: [f32; 4]) {
        let x0 = (cx - r - lw - 1.0) as i32;
        let x1 = (cx + r + lw + 1.0) as i32;
        let y0 = (cy - r - lw - 1.0) as i32;
        let y1 = (cy + r + lw + 1.0) as i32;
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                let d = (dx * dx + dy * dy).sqrt();
                let mut ang = dy.atan2(dx);
                if ang < 0.0 {
                    ang += std::f32::consts::TAU;
                }
                let inside_ang = if a1 - a0 >= std::f32::consts::TAU - 1e-3 { true } else { ang >= a0 && ang <= a1 };
                if !inside_ang {
                    continue;
                }
                let k = (lw / 2.0 + 0.5 - (d - r).abs()).clamp(0.0, 1.0);
                if k > 0.0 {
                    self.blend_px(x, y, [c[0], c[1], c[2], c[3] * k]);
                }
            }
        }
    }

    /// polígono cheio (regra par-ímpar)
    pub fn fill_poly(&mut self, pts: &[(f32, f32)], c: [f32; 4]) {
        let miny = pts.iter().map(|p| p.1).fold(f32::INFINITY, f32::min).floor() as i32;
        let maxy = pts.iter().map(|p| p.1).fold(f32::NEG_INFINITY, f32::max).ceil() as i32;
        for y in miny..=maxy {
            let fy = y as f32 + 0.5;
            let mut xs = vec![];
            for i in 0..pts.len() {
                let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
                if (a.1 <= fy && b.1 > fy) || (b.1 <= fy && a.1 > fy) {
                    xs.push(a.0 + (fy - a.1) / (b.1 - a.1) * (b.0 - a.0));
                }
            }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for pair in xs.chunks(2) {
                if pair.len() == 2 {
                    for x in pair[0].round() as i32..pair[1].round() as i32 {
                        self.blend_px(x, y, c);
                    }
                }
            }
        }
    }

    /// pontinhos claros/escuros (o grain() da versão web)
    pub fn grain(&mut self, x: f32, y: f32, w: f32, h: f32, n: usize, amp: f32, size: f32) {
        let mut r = rand::rng();
        for _ in 0..n {
            let a = r.random::<f32>() * amp;
            let c = if r.random::<bool>() { [0.0, 0.0, 0.0, a] } else { [1.0, 1.0, 1.0, a] };
            let s = 0.6 + r.random::<f32>() * size;
            self.fill_rect(x + r.random::<f32>() * w, y + r.random::<f32>() * h, s, s, c);
        }
    }

    /// texto com a fonte (tamanho CSS em px), linha de base em `y`; devolve o x do fim
    pub fn text(&mut self, font: &ab_glyph::FontVec, text: &str, size: f32, x0: f32, y: f32, c: [f32; 4]) -> f32 {
        use ab_glyph::{Font, PxScale, ScaleFont};
        let em = font.units_per_em().unwrap_or(1000.0);
        let scale = PxScale::from(size * font.height_unscaled() / em);
        let sf = font.as_scaled(scale);
        let mut x = x0;
        for ch in text.chars() {
            let id = font.glyph_id(ch);
            let g = id.with_scale_and_position(scale, ab_glyph::point(x, y));
            if let Some(out) = font.outline_glyph(g) {
                let b = out.px_bounds();
                let mut cov = vec![];
                out.draw(|gx, gy, k| cov.push((b.min.x as i32 + gx as i32, b.min.y as i32 + gy as i32, k)));
                for (px, py, k) in cov {
                    self.blend_px(px, py, [c[0], c[1], c[2], c[3] * k.min(1.0)]);
                }
            }
            x += sf.h_advance(id);
        }
        x
    }

    /// linha grossa (carimbos redondos ao longo do caminho)
    pub fn stroke_path(&mut self, pts: &[(f32, f32)], lw: f32, c: [f32; 4]) {
        let r = lw / 2.0;
        let mut cov = vec![0.0f32; self.w * self.h];
        for s in pts.windows(2) {
            let (a, b) = (s[0], s[1]);
            let (x0, x1) = ((a.0.min(b.0) - r - 1.0).floor().max(0.0) as usize, ((a.0.max(b.0) + r + 1.0).ceil() as usize).min(self.w));
            let (y0, y1) = ((a.1.min(b.1) - r - 1.0).floor().max(0.0) as usize, ((a.1.max(b.1) + r + 1.0).ceil() as usize).min(self.h));
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let l2 = (dx * dx + dy * dy).max(1e-6);
            for y in y0..y1 {
                for x in x0..x1 {
                    let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                    let t = (((px - a.0) * dx + (py - a.1) * dy) / l2).clamp(0.0, 1.0);
                    let d = ((px - a.0 - dx * t).powi(2) + (py - a.1 - dy * t).powi(2)).sqrt();
                    let k = (r + 0.5 - d).clamp(0.0, 1.0);
                    let i = y * self.w + x;
                    cov[i] = cov[i].max(k);
                }
            }
        }
        for (i, k) in cov.into_iter().enumerate() {
            if k > 0.0 {
                self.blend_px((i % self.w) as i32, (i / self.w) as i32, [c[0], c[1], c[2], c[3] * k]);
            }
        }
    }

    /// contorno de retângulo
    pub fn stroke_rect(&mut self, x: f32, y: f32, w: f32, h: f32, lw: f32, c: [f32; 4]) {
        self.stroke_path(&[(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)], lw, c);
    }

    /// limpa tudo (transparente)
    pub fn clear(&mut self) {
        self.px.iter_mut().for_each(|p| *p = [0.0; 4]);
    }

    /// os pixels em RGBA8 (para atualizar uma imagem já criada)
    pub fn rgba8(&self) -> Vec<u8> {
        self.px.iter().flat_map(|p| p.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)).collect()
    }

    pub fn image(&self, srgb: bool, repeat: bool) -> Image {
        let data: Vec<u8> = self.px.iter().flat_map(|p| p.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)).collect();
        let mut img = Image::new(
            Extent3d { width: self.w as u32, height: self.h as u32, depth_or_array_layers: 1 },
            TextureDimension::D2,
            data,
            if srgb { TextureFormat::Rgba8UnormSrgb } else { TextureFormat::Rgba8Unorm },
            RenderAssetUsages::RENDER_WORLD,
        );
        let mode = if repeat { ImageAddressMode::Repeat } else { ImageAddressMode::ClampToEdge };
        img.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor { address_mode_u: mode, address_mode_v: mode, anisotropy_clamp: 4, ..ImageSamplerDescriptor::linear() });
        img
    }
}
