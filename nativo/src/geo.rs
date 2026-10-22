//! Geometrias com os mesmos vértices, normais e UVs das do three.js (BoxGeometry,
//! CylinderGeometry, TorusGeometry, ...), para que as texturas e os modelos da versão web
//! caiam exatamente igual. `Geo` é uma malha em construção (dá para girar, mover e juntar)
//! que vira um `Mesh` do Bevy no fim.

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, Mesh, PrimitiveTopology};
use bevy::prelude::*;
use std::f32::consts::{PI, TAU};

#[derive(Clone, Default, Debug)]
pub struct Geo {
    pub pos: Vec<Vec3>,
    pub nor: Vec<Vec3>,
    pub uv: Vec<Vec2>,
    pub idx: Vec<u32>,
}

impl Geo {
    fn push(&mut self, p: Vec3, n: Vec3, uv: Vec2) -> u32 {
        self.pos.push(p);
        self.nor.push(n);
        self.uv.push(uv);
        (self.pos.len() - 1) as u32
    }

    pub fn translate(mut self, x: f32, y: f32, z: f32) -> Self {
        let t = Vec3::new(x, y, z);
        for p in &mut self.pos {
            *p += t;
        }
        self
    }

    pub fn translate_v(self, t: Vec3) -> Self {
        self.translate(t.x, t.y, t.z)
    }

    pub fn rotate(mut self, q: Quat) -> Self {
        for p in &mut self.pos {
            *p = q * *p;
        }
        for n in &mut self.nor {
            *n = q * *n;
        }
        self
    }

    pub fn rotate_x(self, a: f32) -> Self {
        self.rotate(Quat::from_rotation_x(a))
    }
    pub fn rotate_y(self, a: f32) -> Self {
        self.rotate(Quat::from_rotation_y(a))
    }
    pub fn rotate_z(self, a: f32) -> Self {
        self.rotate(Quat::from_rotation_z(a))
    }

    pub fn scale(mut self, s: Vec3) -> Self {
        for p in &mut self.pos {
            *p *= s;
        }
        let inv = Vec3::new(1.0 / s.x, 1.0 / s.y, 1.0 / s.z);
        for n in &mut self.nor {
            *n = (*n * inv).normalize_or_zero();
        }
        self
    }

    /// aplica uma transformação completa (posição, giro, escala)
    pub fn transform(mut self, m: &Mat4) -> Self {
        let nm = Mat3::from_mat4(*m).inverse().transpose();
        for p in &mut self.pos {
            *p = m.transform_point3(*p);
        }
        for n in &mut self.nor {
            *n = (nm * *n).normalize_or_zero();
        }
        self
    }

    /// junta várias geometrias numa só (mergeGeometries)
    pub fn merge(parts: impl IntoIterator<Item = Geo>) -> Geo {
        let mut out = Geo::default();
        for g in parts {
            let base = out.pos.len() as u32;
            out.pos.extend(g.pos);
            out.nor.extend(g.nor);
            out.uv.extend(g.uv);
            out.idx.extend(g.idx.into_iter().map(|i| i + base));
        }
        out
    }

    pub fn mesh(&self) -> Mesh {
        let mut m = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, self.nor.iter().map(|p| p.to_array()).collect::<Vec<_>>())
            .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, self.uv.iter().map(|p| p.to_array()).collect::<Vec<_>>())
            .with_inserted_indices(Indices::U32(self.idx.clone()));
        let _ = m.generate_tangents();
        m
    }

    /// recalcula as normais pela média das faces (computeVertexNormals)
    pub fn compute_normals(mut self) -> Self {
        let mut n = vec![Vec3::ZERO; self.pos.len()];
        for t in self.idx.chunks(3) {
            let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let f = (self.pos[c] - self.pos[b]).cross(self.pos[a] - self.pos[b]);
            n[a] += f;
            n[b] += f;
            n[c] += f;
        }
        self.nor = n.into_iter().map(|v| v.normalize_or_zero()).collect();
        self
    }
}

// ------------------------------------------------------------------ BoxGeometry
/// caixa centrada na origem, faces na ordem do three.js: +x, −x, +y, −y, +z, −z
/// (cada uma com 4 vértices; `face_geo(i)` devolve só uma delas)
pub fn box_geo(w: f32, h: f32, d: f32) -> Geo {
    Geo::merge((0..6).map(|i| box_face(w, h, d, i)))
}

pub fn box_face(w: f32, h: f32, d: f32, face: usize) -> Geo {
    // buildPlane(u, v, w, udir, vdir, width, height, depth) do three.js
    let (u, v, wa, udir, vdir, pw, ph, pd) = match face {
        0 => (2, 1, 0, -1.0, -1.0, d, h, w),
        1 => (2, 1, 0, 1.0, -1.0, d, h, -w),
        2 => (0, 2, 1, 1.0, 1.0, w, d, h),
        3 => (0, 2, 1, 1.0, -1.0, w, d, -h),
        4 => (0, 1, 2, 1.0, -1.0, w, h, d),
        _ => (0, 1, 2, -1.0, -1.0, w, h, -d),
    };
    let mut g = Geo::default();
    for iy in 0..2 {
        let y = iy as f32 * ph - ph / 2.0;
        for ix in 0..2 {
            let x = ix as f32 * pw - pw / 2.0;
            let mut p = [0.0f32; 3];
            p[u] = x * udir;
            p[v] = y * vdir;
            p[wa] = pd / 2.0;
            let mut n = [0.0f32; 3];
            n[wa] = if pd > 0.0 { 1.0 } else { -1.0 };
            g.push(Vec3::from(p), Vec3::from(n), Vec2::new(ix as f32, 1.0 - iy as f32));
        }
    }
    // a = 0, b = 2, c = 3, d = 1  →  (a, b, d), (b, c, d)
    g.idx = vec![0, 2, 1, 2, 3, 1];
    g
}

// ------------------------------------------------------------------ PlaneGeometry
pub fn plane_geo(w: f32, h: f32) -> Geo {
    let mut g = Geo::default();
    for iy in 0..2 {
        let y = iy as f32 * h - h / 2.0;
        for ix in 0..2 {
            let x = ix as f32 * w - w / 2.0;
            g.push(Vec3::new(x, -y, 0.0), Vec3::Z, Vec2::new(ix as f32, 1.0 - iy as f32));
        }
    }
    g.idx = vec![0, 2, 1, 2, 3, 1];
    g
}

// ------------------------------------------------------------------ CylinderGeometry
pub fn cylinder_geo(rt: f32, rb: f32, h: f32, radial: u32, height_seg: u32, open: bool) -> Geo {
    cylinder_geo_arc(rt, rb, h, radial, height_seg, open, 0.0, TAU)
}

pub fn cylinder_geo_arc(rt: f32, rb: f32, h: f32, radial: u32, hs: u32, open: bool, t0: f32, tl: f32) -> Geo {
    let mut g = Geo::default();
    let half = h / 2.0;
    let slope = (rb - rt) / h;
    let mut grid = vec![];
    for y in 0..=hs {
        let v = y as f32 / hs as f32;
        let r = v * (rb - rt) + rt;
        let mut row = vec![];
        for x in 0..=radial {
            let u = x as f32 / radial as f32;
            let th = u * tl + t0;
            let (s, c) = th.sin_cos();
            let p = Vec3::new(r * s, -v * h + half, r * c);
            let n = Vec3::new(s, slope, c).normalize();
            row.push(g.push(p, n, Vec2::new(u, 1.0 - v)));
        }
        grid.push(row);
    }
    for x in 0..radial as usize {
        for y in 0..hs as usize {
            let a = grid[y][x];
            let b = grid[y + 1][x];
            let c = grid[y + 1][x + 1];
            let d = grid[y][x + 1];
            if rt > 0.0 || y != 0 {
                g.idx.extend([a, b, d]);
            }
            if rb > 0.0 || y != hs as usize - 1 {
                g.idx.extend([b, c, d]);
            }
        }
    }
    if !open {
        for top in [true, false] {
            let r = if top { rt } else { rb };
            if r <= 0.0 {
                continue;
            }
            let sign = if top { 1.0 } else { -1.0 };
            let c0 = g.pos.len() as u32;
            for _ in 1..=radial {
                g.push(Vec3::new(0.0, half * sign, 0.0), Vec3::new(0.0, sign, 0.0), Vec2::splat(0.5));
            }
            let e0 = g.pos.len() as u32;
            for x in 0..=radial {
                let u = x as f32 / radial as f32;
                let th = u * tl + t0;
                let (s, c) = th.sin_cos();
                g.push(Vec3::new(r * s, half * sign, r * c), Vec3::new(0.0, sign, 0.0), Vec2::new(c * 0.5 + 0.5, s * 0.5 * sign + 0.5));
            }
            for x in 0..radial {
                let c = c0 + x;
                let i = e0 + x;
                if top {
                    g.idx.extend([i, i + 1, c]);
                } else {
                    g.idx.extend([i + 1, i, c]);
                }
            }
        }
    }
    g
}

pub fn cone_geo(r: f32, h: f32, radial: u32) -> Geo {
    cylinder_geo(0.0, r, h, radial, 1, false)
}

// ------------------------------------------------------------------ TorusGeometry
pub fn torus_geo(radius: f32, tube: f32, radial: u32, tubular: u32) -> Geo {
    torus_geo_arc(radius, tube, radial, tubular, TAU)
}

pub fn torus_geo_arc(radius: f32, tube: f32, radial: u32, tubular: u32, arc: f32) -> Geo {
    let mut g = Geo::default();
    for j in 0..=radial {
        for i in 0..=tubular {
            let u = i as f32 / tubular as f32 * arc;
            let v = j as f32 / radial as f32 * TAU;
            let p = Vec3::new((radius + tube * v.cos()) * u.cos(), (radius + tube * v.cos()) * u.sin(), tube * v.sin());
            let c = Vec3::new(radius * u.cos(), radius * u.sin(), 0.0);
            g.push(p, (p - c).normalize(), Vec2::new(i as f32 / tubular as f32, j as f32 / radial as f32));
        }
    }
    let t1 = tubular + 1;
    for j in 1..=radial {
        for i in 1..=tubular {
            let a = t1 * j + i - 1;
            let b = t1 * (j - 1) + i - 1;
            let c = t1 * (j - 1) + i;
            let d = t1 * j + i;
            g.idx.extend([a, b, d, b, c, d]);
        }
    }
    g
}

// ------------------------------------------------------------------ RingGeometry
pub fn ring_geo(inner: f32, outer: f32, theta_seg: u32, phi_seg: u32) -> Geo {
    let mut g = Geo::default();
    let step = (outer - inner) / phi_seg as f32;
    let mut r = inner;
    for _ in 0..=phi_seg {
        for i in 0..=theta_seg {
            let s = i as f32 / theta_seg as f32 * TAU;
            let p = Vec3::new(r * s.cos(), r * s.sin(), 0.0);
            g.push(p, Vec3::Z, Vec2::new((p.x / outer + 1.0) / 2.0, (p.y / outer + 1.0) / 2.0));
        }
        r += step;
    }
    for j in 0..phi_seg {
        let level = j * (theta_seg + 1);
        for i in 0..theta_seg {
            let s = i + level;
            let (a, b, c, d) = (s, s + theta_seg + 1, s + theta_seg + 2, s + 1);
            g.idx.extend([a, b, d, b, c, d]);
        }
    }
    g
}

// ------------------------------------------------------------------ CircleGeometry
pub fn circle_geo(r: f32, segments: u32) -> Geo {
    let mut g = Geo::default();
    g.push(Vec3::ZERO, Vec3::Z, Vec2::splat(0.5));
    for s in 0..=segments {
        let a = s as f32 / segments as f32 * TAU;
        let p = Vec3::new(r * a.cos(), r * a.sin(), 0.0);
        g.push(p, Vec3::Z, Vec2::new((p.x / r + 1.0) / 2.0, (p.y / r + 1.0) / 2.0));
    }
    for i in 1..=segments {
        g.idx.extend([i, i + 1, 0]);
    }
    g
}

// ------------------------------------------------------------------ SphereGeometry
pub fn sphere_geo(r: f32, ws: u32, hs: u32) -> Geo {
    sphere_geo_part(r, ws, hs, 0.0, TAU, 0.0, PI)
}

pub fn sphere_geo_part(r: f32, ws: u32, hs: u32, phi0: f32, phil: f32, th0: f32, thl: f32) -> Geo {
    let mut g = Geo::default();
    let th_end = (th0 + thl).min(PI);
    let mut grid = vec![];
    for iy in 0..=hs {
        let v = iy as f32 / hs as f32;
        let uoff = if iy == 0 && th0 == 0.0 {
            0.5 / ws as f32
        } else if iy == hs && th_end == PI {
            -0.5 / ws as f32
        } else {
            0.0
        };
        let mut row = vec![];
        for ix in 0..=ws {
            let u = ix as f32 / ws as f32;
            let p = Vec3::new(
                -r * (phi0 + u * phil).cos() * (th0 + v * thl).sin(),
                r * (th0 + v * thl).cos(),
                r * (phi0 + u * phil).sin() * (th0 + v * thl).sin(),
            );
            row.push(g.push(p, p.normalize_or_zero(), Vec2::new(u + uoff, 1.0 - v)));
        }
        grid.push(row);
    }
    for iy in 0..hs as usize {
        for ix in 0..ws as usize {
            let a = grid[iy][ix + 1];
            let b = grid[iy][ix];
            let c = grid[iy + 1][ix];
            let d = grid[iy + 1][ix + 1];
            if iy != 0 || th0 > 0.0 {
                g.idx.extend([a, b, d]);
            }
            if iy != hs as usize - 1 || th_end < PI {
                g.idx.extend([b, c, d]);
            }
        }
    }
    g
}

// ------------------------------------------------------------------ LatheGeometry
/// sólido de revolução em torno de y (pontos = (raio, altura))
pub fn lathe_geo(points: &[Vec2], segments: u32) -> Geo {
    let mut g = Geo::default();
    let n = points.len();
    // normais iniciais do perfil (como no three.js)
    let mut init = vec![Vec3::ZERO; n];
    let mut prev = Vec3::ZERO;
    for j in 0..n {
        let cur = if j == n - 1 {
            prev
        } else {
            let dx = points[j + 1].x - points[j].x;
            let dy = points[j + 1].y - points[j].y;
            let nn = Vec3::new(dy, -dx, 0.0);
            if j == 0 { nn } else { nn }
        };
        init[j] = if j == 0 || j == n - 1 { cur.normalize_or_zero() } else { (cur + prev).normalize_or_zero() };
        prev = cur;
    }
    for i in 0..=segments {
        let phi = i as f32 / segments as f32 * TAU;
        let (s, c) = phi.sin_cos();
        for j in 0..n {
            let p = Vec3::new(points[j].x * s, points[j].y, points[j].x * c);
            let nn = Vec3::new(init[j].x * s, init[j].y, init[j].x * c).normalize_or_zero();
            g.push(p, nn, Vec2::new(i as f32 / segments as f32, j as f32 / (n - 1) as f32));
        }
    }
    for i in 0..segments {
        for j in 0..(n as u32 - 1) {
            let base = j + i * n as u32;
            let (a, b, c, d) = (base, base + n as u32, base + n as u32 + 1, base + 1);
            g.idx.extend([a, b, d, c, d, b]);
        }
    }
    g
}

/// caixa do cenário com UV em metros (worldBoxGeo da versão web): a textura não estica
/// em caixas compridas. Devolve as 6 faces separadas (+x −x +y −y +z −z).
pub fn world_box_faces(min: Vec3, max: Vec3, tile: f32) -> [Geo; 6] {
    let size = max - min;
    let c = (min + max) * 0.5;
    std::array::from_fn(|i| {
        let mut g = box_face(size.x, size.y, size.z, i).translate_v(c);
        for k in 0..g.pos.len() {
            let (p, n) = (g.pos[k], g.nor[k]);
            let (u, v) = if n.x.abs() > 0.5 {
                (p.z, p.y)
            } else if n.y.abs() > 0.5 {
                (p.x, p.z)
            } else {
                (p.x, p.y)
            };
            g.uv[k] = Vec2::new(u / tile, v / tile);
        }
        g
    })
}
