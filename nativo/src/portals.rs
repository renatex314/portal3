//! Portais (portals.js): colocar (mira, paredes que aceitam, escorregar para caber), as bocas
//! por onde os corpos passam, atravessar conservando o momento e o filtro de colisão com a parede
//! do portal. A renderização (câmera virtual com plano de corte oblíquo) fica em portal_render.rs.

use crate::world::{aabb_overlap, GameWorld, RayHit, Solid};
use bevy::prelude::*;

pub const PORTAL_A: f32 = 0.68; // meia largura (m)
pub const PORTAL_B: f32 = 1.08; // meia altura (m)

/// cores dos pares de portais de cada jogador (multiplayer: até 4)
pub const SLOT_COLORS: [[[f32; 3]; 2]; 4] = [
    [[0.15, 0.95, 1.0], [1.0, 0.12, 0.1]],
    [[0.58, 0.32, 1.0], [1.0, 0.5, 0.08]],
    [[0.2, 1.0, 0.5], [1.0, 0.9, 0.2]],
    [[0.2, 0.62, 1.0], [1.0, 0.35, 0.8]],
];

#[derive(Clone, Debug)]
pub struct Portal {
    pub blue: bool,
    pub color: Vec3,
    pub partner: usize,
    pub placed: bool,
    pub open: f32,
    pub age: f32,
    pub center: Vec3,
    pub normal: Vec3,
    pub up: Vec3,
    pub right: Vec3,
    pub matrix: Mat4,
    pub inverse: Mat4,
    pub solid: Option<usize>,
    /// segundos no passado (laranja temporal); 0 = portal normal
    pub delta: f32,
    /// tw do relógio em que o laranja temporal abriu (antes disso, as bolas da história contam pelas fotos)
    pub placed_tw: Option<f32>,
    pub fixed: bool,
    pub owner: Option<String>,
    pub gray: bool,
    pub moon: bool,
    pub axis: usize,
    /// laranja "de estática" (só imagem)
    pub statik: bool,
}

impl Portal {
    pub fn new(blue: bool, color: [f32; 3], partner: usize) -> Self {
        Portal {
            blue,
            color: Vec3::from(color),
            partner,
            placed: false,
            open: 0.0,
            age: 0.0,
            center: Vec3::ZERO,
            normal: Vec3::Z,
            up: Vec3::Y,
            right: Vec3::X,
            matrix: Mat4::IDENTITY,
            inverse: Mat4::IDENTITY,
            solid: None,
            delta: 0.0,
            placed_tw: None,
            fixed: false,
            owner: None,
            gray: false,
            moon: false,
            axis: 2,
            statik: false,
        }
    }

    pub fn set_frame(&mut self, center: Vec3, normal: Vec3, up: Vec3, solid: Option<usize>) {
        let Some(s) = solid else {
            if self.placed {
                self.remove();
            }
            return;
        };
        self.center = center;
        self.normal = normal;
        self.up = up;
        self.right = up.cross(normal).normalize();
        self.solid = Some(s);
        self.axis = if normal.x.abs() > 0.5 { 0 } else if normal.y.abs() > 0.5 { 1 } else { 2 };
        self.matrix = Mat4::from_cols(self.right.extend(0.0), self.up.extend(0.0), self.normal.extend(0.0), center.extend(1.0));
        self.inverse = self.matrix.inverse();
        self.placed = true;
        self.moon = false;
        self.delta = 0.0;
        self.open = 0.0;
        self.age = 0.0;
    }

    pub fn remove(&mut self) {
        self.placed = false;
        self.delta = 0.0;
        self.solid = None;
    }

    pub fn local(&self, p: Vec3) -> Vec3 {
        self.inverse.transform_point3(p)
    }
}

/// matriz que leva o espaço "na frente de P" para "na frente de Q"
pub fn transform(p: &Portal, q: &Portal) -> Mat4 {
    q.matrix * Mat4::from_rotation_y(std::f32::consts::PI) * p.inverse
}

#[derive(Clone, Debug, Default)]
pub struct PlaceResult {
    pub ok: bool,
    pub point: Option<Vec3>,
    pub normal: Option<Vec3>,
    pub up: Option<Vec3>,
    pub solid: Option<usize>,
}

pub struct Portals {
    pub list: Vec<Portal>,
    /// laranjas "de estática" (onde um laser vai/vem pelo tempo): só imagem
    pub statics: Vec<Portal>,
    /// volumes sem portal (func_noportal_volume, campanha)
    pub no_portal: Vec<(Vec3, Vec3)>,
}

pub const BLUE: usize = 0;
pub const ORANGE: usize = 1;

impl Default for Portals {
    fn default() -> Self {
        Self::new()
    }
}

impl Portals {
    pub fn new() -> Self {
        let c = SLOT_COLORS[0];
        Portals {
            list: vec![Portal::new(true, c[0], ORANGE), Portal::new(false, c[1], BLUE)],
            statics: (0..2).map(|_| {
                let mut p = Portal::new(false, c[1], 0);
                p.statik = true;
                p
            }).collect(),
            no_portal: vec![],
        }
    }

    pub fn blue(&self) -> &Portal {
        &self.list[BLUE]
    }
    pub fn orange(&self) -> &Portal {
        &self.list[ORANGE]
    }

    pub fn linked(&self) -> bool {
        self.list[BLUE].placed && self.list[ORANGE].placed
    }

    pub fn is_linked(&self, i: usize) -> bool {
        self.list[i].placed && self.list[self.list[i].partner].placed
    }

    pub fn any_linked(&self) -> bool {
        (0..self.list.len()).any(|i| self.is_linked(i))
    }

    pub fn set_slot(&mut self, slot: usize) {
        let c = SLOT_COLORS[slot % 4];
        self.list[BLUE].color = Vec3::from(c[0]);
        self.list[ORANGE].color = Vec3::from(c[1]);
    }

    /// par de outro jogador (ou de um clone do tempo, em cinza)
    pub fn remote_pair(&mut self, id: &str, slot: usize, gray: bool) -> (usize, usize) {
        if let Some(i) = self.list.iter().position(|p| p.owner.as_deref() == Some(id) && p.blue) {
            return (i, self.list[i].partner);
        }
        let c = if gray { [[0.85, 0.85, 0.85], [0.85, 0.85, 0.85]] } else { SLOT_COLORS[slot % 4] };
        let b = self.list.len();
        let mut pb = Portal::new(true, c[0], b + 1);
        let mut po = Portal::new(false, c[1], b);
        pb.owner = Some(id.to_string());
        po.owner = Some(id.to_string());
        pb.gray = gray;
        po.gray = gray;
        self.list.push(pb);
        self.list.push(po);
        (b, b + 1)
    }

    pub fn reset(&mut self) {
        for p in &mut self.list {
            p.remove();
            p.fixed = false;
        }
        self.list.truncate(2);
        for s in &mut self.statics {
            s.remove();
        }
        self.no_portal.clear();
    }

    /// grade de desintegração: some com os portais do jogador (os fixos da fase ficam)
    pub fn fizzle(&mut self) -> bool {
        let mut any = false;
        for i in [BLUE, ORANGE] {
            let p = &mut self.list[i];
            if p.placed && !p.fixed {
                p.remove();
                any = true;
            }
        }
        any
    }

    /// portal colocado pela própria fase (não sai com a grade nem com tiro)
    pub fn place_fixed(&mut self, w: &GameWorld, which: usize, center: Vec3, normal: Vec3, up: Vec3) -> bool {
        let c = center;
        let mut n = normal;
        let mut u = up;
        let behind = |d: Vec3, ofs: f32, reach: f32| w.raycast(c + d * ofs, -d, reach);
        let mut hit = behind(n, 0.3, 0.45);
        if hit.is_none() {
            for d in [Vec3::X, Vec3::NEG_X, Vec3::Z, Vec3::NEG_Z, Vec3::Y, Vec3::NEG_Y] {
                if let Some(h) = behind(d, 0.3, 0.45) {
                    if h.normal.dot(d) > 0.99 {
                        hit = Some(h);
                        n = d;
                        if n.y.abs() < 0.5 {
                            u = Vec3::Y;
                        } else if u.dot(n).abs() > 0.5 {
                            u = Vec3::NEG_Z;
                        }
                        break;
                    }
                }
            }
        }
        for ofs in [0.6, 1.0, 1.6] {
            if hit.is_some() {
                break;
            }
            hit = behind(n, ofs, ofs + 0.7);
        }
        let Some(h) = hit else { return false };
        self.list[which].set_frame(h.point + n * 0.002, n, u, Some(h.solid));
        self.list[which].fixed = true;
        true
    }

    // ------------------------------------------------------------------ colocar portal
    /// `dry`: só verifica se o portal caberia (para a mira), sem abri-lo
    pub fn try_place(&mut self, w: &GameWorld, which: usize, origin: Vec3, dir: Vec3, dry: bool) -> PlaceResult {
        if self.list[which].fixed {
            return PlaceResult::default();
        }
        let Some(hit) = w.raycast(origin, dir, 400.0) else { return PlaceResult::default() };
        let b = &w.solids[hit.solid];
        if b.surface_fit {
            return self.try_place_surface(w, which, &hit, dir, dry);
        }
        let fail = PlaceResult { ok: false, point: Some(hit.point), normal: Some(hit.normal), ..default() };
        if !b.portalable {
            return fail;
        }
        let n = hit.normal;
        let lim = if b.obb.is_some() { 0.9 } else { 0.5 };
        let up = if n.y.abs() > lim {
            // piso/teto: o portal fica alinhado com a direção do olhar
            let mut up = dir - n * dir.dot(n);
            if up.length_squared() < 1e-6 {
                up = Vec3::NEG_Z;
            }
            up = up.normalize();
            if n.y < 0.0 {
                up = -up;
            }
            up
        } else {
            (Vec3::Y - n * n.y).normalize()
        };
        let right = up.cross(n).normalize();
        let obb = b.obb;
        let to_local = |v: Vec3| obb.map(|o| o.qi * v).unwrap_or(v);
        let to_world = |v: Vec3| obb.map(|o| o.q * v).unwrap_or(v);
        let origin0 = obb.map(|o| o.c).unwrap_or(Vec3::ZERO);
        let nl = to_local(n);
        let face_axis = if obb.is_some() { (0..3).fold(0, |a, i| if nl[i].abs() > nl[a].abs() { i } else { a }) } else { hit.axis.max(0) as usize };
        let axes: Vec<usize> = (0..3).filter(|&i| i != face_axis).collect();
        let (rl, ul) = (to_local(right), to_local(up));
        let lo = |i: usize| obb.map(|o| -o.half[i]).unwrap_or(b.min[i]);
        let hi = |i: usize| obb.map(|o| o.half[i]).unwrap_or(b.max[i]);
        let ext = |i: usize| rl[i].abs() * PORTAL_A + ul[i].abs() * PORTAL_B;
        let solid_i = hit.solid;
        let list = &self.list;
        let fits = |c: Vec3| -> bool {
            let cl = to_local(c - origin0);
            for &i in &axes {
                if cl[i] - ext(i) < lo(i) - 1e-3 || cl[i] + ext(i) > hi(i) + 1e-3 {
                    return false;
                }
            }
            for k in 0..16 {
                let a = k as f32 / 16.0 * std::f32::consts::TAU;
                let p = c + right * (a.cos() * PORTAL_A * 0.96) + up * (a.sin() * PORTAL_B * 0.96) + n * 0.06;
                if w.point_in_solid(p, Some(solid_i)).is_some() {
                    return false;
                }
            }
            for (j, o) in list.iter().enumerate() {
                if j == which || !o.placed {
                    continue;
                }
                if o.normal.dot(n) > 0.99 && (o.normal.dot(c) - o.normal.dot(o.center)).abs() < 0.02 {
                    let d = c - o.center;
                    let du = d.dot(right) / (PORTAL_A * 2.0);
                    let dv = d.dot(up) / (PORTAL_B * 2.0);
                    if du * du + dv * dv < 1.0 {
                        return false;
                    }
                }
            }
            true
        };
        // empurra para dentro da face
        let mut cl = to_local(hit.point - origin0);
        for &i in &axes {
            let (a, bb) = (lo(i) + ext(i), hi(i) - ext(i));
            if a > bb {
                return fail;
            }
            cl[i] = cl[i].clamp(a, bb);
        }
        let mut center = to_world(cl) + origin0;
        // em parede, se a base ficou perto do chão, encosta no chão (dá para entrar andando)
        if obb.is_none() && n.y.abs() < 0.5 {
            let probe = center + n * 0.4;
            if let Some(floor) = w.raycast(probe, Vec3::NEG_Y, PORTAL_B + 3.0) {
                if floor.dist - PORTAL_B < 2.5 {
                    let snapped = Vec3::new(center.x, probe.y - floor.dist + PORTAL_B + 0.01, center.z);
                    if fits(snapped) {
                        center = snapped;
                    }
                }
            }
        }
        let mut fin = if fits(center) { Some(center) } else { None };
        if fin.is_none() {
            // procura uma posição válida por perto (o portal "escorrega")
            'outer: for ri in 1..=9 {
                let r = ri as f32 * 0.2;
                for k in 0..12 {
                    let a = k as f32 / 12.0 * std::f32::consts::TAU;
                    let c = center + right * (a.cos() * r) + up * (a.sin() * r);
                    if fits(c) {
                        fin = Some(c);
                        break 'outer;
                    }
                }
            }
        }
        let Some(fc) = fin else { return fail };
        if !dry {
            self.list[which].set_frame(fc + n * 0.002, n, up, Some(solid_i));
        }
        PlaceResult { ok: true, point: Some(fc), normal: Some(n), up: Some(up), solid: Some(solid_i) }
    }

    /// mapas importados: a parede é feita de vários pincéis; cabe se cada ponto da borda tiver,
    /// logo atrás, uma face que aceita portal no mesmo plano — e nada sólido na frente
    fn try_place_surface(&mut self, w: &GameWorld, which: usize, hit: &RayHit, dir: Vec3, dry: bool) -> PlaceResult {
        let fail = PlaceResult { ok: false, point: Some(hit.point), normal: Some(hit.normal), ..default() };
        let n = hit.normal;
        if !w.solids[hit.solid].portal_at(n) {
            return fail;
        }
        let up = if n.y.abs() > 0.5 {
            let mut up = dir - n * dir.dot(n);
            if up.length_squared() < 1e-6 {
                up = Vec3::NEG_Z;
            }
            up = up.normalize();
            if n.y < 0.0 { -up } else { up }
        } else {
            (Vec3::Y - n * n.y).normalize()
        };
        let right = up.cross(n).normalize();
        let plane = n.dot(hit.point);
        let backed = |q: Vec3| -> bool {
            match w.raycast(q + n * 0.05, -n, 0.12) {
                Some(h) => h.normal.dot(n) > 0.999 && (n.dot(h.point) - plane).abs() < 0.01 && w.solids[h.solid].portal_at(h.normal),
                None => false,
            }
        };
        let blocked = |q: Vec3| -> bool {
            let f = q + n * 0.06;
            for i in w.solid_ids() {
                let b = &w.solids[i];
                if b.no_ray || b.disabled {
                    continue;
                }
                let inside = if let Some(pl) = &b.planes { pl.iter().all(|p| p.n.dot(f) < p.d) } else { b.obb.is_none() && f.cmpgt(b.min).all() && f.cmplt(b.max).all() };
                if inside {
                    return true;
                }
            }
            false
        };
        let list = &self.list;
        let no_portal = &self.no_portal;
        let fits = |c: Vec3| -> bool {
            if no_portal.iter().any(|(mn, mx)| c.cmpgt(*mn).all() && c.cmplt(*mx).all()) {
                return false;
            }
            let mut samples = vec![c];
            for k in 0..16 {
                let a = k as f32 / 16.0 * std::f32::consts::TAU;
                samples.push(c + right * (a.cos() * PORTAL_A * 0.98) + up * (a.sin() * PORTAL_B * 0.98));
            }
            for (x, y) in [(0.5, 0.5), (-0.5, 0.5), (0.5, -0.5), (-0.5, -0.5)] {
                samples.push(c + right * (x * PORTAL_A) + up * (y * PORTAL_B));
            }
            if samples.iter().any(|&q| !backed(q) || blocked(q)) {
                return false;
            }
            for (j, o) in list.iter().enumerate() {
                if j == which || !o.placed {
                    continue;
                }
                if o.normal.dot(n) > 0.99 && (o.normal.dot(c) - o.normal.dot(o.center)).abs() < 0.02 {
                    let d = c - o.center;
                    let du = d.dot(right) / (PORTAL_A * 2.0);
                    let dv = d.dot(up) / (PORTAL_B * 2.0);
                    if du * du + dv * dv < 1.0 {
                        return false;
                    }
                }
            }
            true
        };
        let center = hit.point;
        let mut fin = if fits(center) { Some(center) } else { None };
        'outer: for ri in 1..=12 {
            if fin.is_some() {
                break;
            }
            let r = ri as f32 * 0.15;
            for k in 0..16 {
                let a = k as f32 / 16.0 * std::f32::consts::TAU;
                let c = center + right * (a.cos() * r) + up * (a.sin() * r);
                if fits(c) {
                    fin = Some(c);
                    break 'outer;
                }
            }
        }
        let Some(fc) = fin else { return fail };
        if !dry {
            self.list[which].set_frame(fc + n * 0.002, n, up, Some(hit.solid));
        }
        PlaceResult { ok: true, point: Some(fc), normal: Some(n), up: Some(up), solid: Some(hit.solid) }
    }

    // ------------------------------------------------------------------ física
    /// portais ligados em cuja boca está o centro de um corpo. `wall`: jogador
    pub fn mouths(&self, center: Vec3, wall: bool, reach: f32) -> Vec<usize> {
        let mut out = vec![];
        for (i, p) in self.list.iter().enumerate() {
            if !self.is_linked(i) || p.solid.is_none() || p.delta > 0.0 {
                continue;
            }
            let l = p.local(center);
            if l.z < -2.5 || l.z > 1.2 + reach {
                continue;
            }
            let mv = if wall && p.normal.y.abs() < 0.5 { 0.45 } else { 0.25 };
            if l.x.abs() <= PORTAL_A - 0.25 && l.y.abs() <= PORTAL_B - mv {
                out.push(i);
            }
        }
        out
    }

    /// como `mouths`, mas olhando o caminho inteiro do passo (a, b): em velocidade alta o ponto
    /// de partida pode estar fora da abertura estreita enquanto o caminho cruza o portal
    pub fn mouths_swept(&self, a: Vec3, b: Vec3, wall: bool) -> Vec<usize> {
        let reach = (b - a).length();
        let n = ((reach / 0.4).ceil() as usize).clamp(1, 12);
        let mut out: Vec<usize> = vec![];
        for k in 0..=n {
            let c = a.lerp(b, k as f32 / n as f32);
            for i in self.mouths(c, wall, reach) {
                if !out.contains(&i) {
                    out.push(i);
                }
            }
        }
        out
    }

    /// a caixa deixa de colidir com um corpo (min..max) que está na boca de um dos portais?
    pub fn passes(&self, solids: &[Solid], solid: usize, mouths: &[usize], min: Vec3, max: Vec3) -> bool {
        let b = &solids[solid];
        if !aabb_overlap(min, max, b.min, b.max, 0.0) {
            return false;
        }
        for &i in mouths {
            let p = &self.list[i];
            let n = p.normal;
            let plane = n.dot(p.center) + 0.01;
            if let Some(pts) = &b.pts {
                if pts.iter().all(|q| n.dot(*q) <= plane) {
                    return true;
                }
                continue;
            }
            if let Some(o) = &b.obb {
                let mut far = n.dot(o.c);
                for k in 0..3 {
                    let mut ax = Vec3::ZERO;
                    ax[k] = 1.0;
                    far += o.half[k] * n.dot(o.q * ax).abs();
                }
                if far <= plane {
                    return true;
                }
                continue;
            }
            let mut front = 0.0;
            for a in 0..3 {
                let l = min[a].max(b.min[a]);
                let h = max[a].min(b.max[a]);
                front += if n[a] > 0.0 { n[a] * h } else { n[a] * l };
            }
            if front <= plane {
                return true;
            }
        }
        false
    }

    /// o azul temporal, se `p` está perto da boca dele (o objeto segurado atravessa a parede)
    pub fn temporal_wall_near(&self, p: Vec3) -> Option<usize> {
        for (i, pp) in self.list.iter().enumerate() {
            if !self.is_linked(i) || pp.solid.is_none() || pp.delta > 0.0 || !(self.list[pp.partner].delta > 0.0) {
                continue;
            }
            let l = pp.local(p);
            if l.z < 1.4 && l.z > -2.0 && l.x.abs() < PORTAL_A + 0.5 && l.y.abs() < PORTAL_B + 0.5 {
                return Some(i);
            }
        }
        None
    }

    /// o segmento a→b cruza a boca de um azul temporal?
    pub fn temporal_crossing(&self, a: Vec3, b: Vec3) -> Option<usize> {
        for (i, p) in self.list.iter().enumerate() {
            if !self.is_linked(i) || p.delta > 0.0 || !(self.list[p.partner].delta > 0.0) {
                continue;
            }
            let sa = (a - p.center).dot(p.normal);
            let sb = (b - p.center).dot(p.normal);
            if sa > 0.0 && sb <= 0.0 {
                let l = p.local(a.lerp(b, sa / (sa - sb)));
                if (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 1.0 {
                    return Some(i);
                }
            }
        }
        None
    }

    /// quem atravessa: o jogador, um objeto (solto ou segurado) ou nada (bola/tiro)
    pub fn crossing(&self, a: Vec3, b: Vec3, who: Who) -> Option<usize> {
        for (i, p) in self.list.iter().enumerate() {
            if !self.is_linked(i) || p.delta > 0.0 {
                continue;
            }
            // azul temporal: atravessam o jogador (salto) e o objeto solto (vai para o passado)
            if self.list[p.partner].delta > 0.0 && !matches!(who, Who::Player | Who::Prop { held: false }) {
                continue;
            }
            let sa = (a - p.center).dot(p.normal);
            let sb = (b - p.center).dot(p.normal);
            if sa > 0.0 && sb <= 0.0 {
                let l = p.local(a.lerp(b, sa / (sa - sb)));
                if l.x.abs() <= PORTAL_A && l.y.abs() <= PORTAL_B {
                    return Some(i);
                }
            }
        }
        None
    }

    /// a boca de vermelho temporal em `point` (na superfície) neste instante do mundo: o seu ou o de uma
    /// versão passada, abertos, ou o de estática (que uma versão passada ainda vai abrir ali). A mesma
    /// resposta para o desenho e para a física: (centro, Δ)
    pub fn temporal_orange_at(&self, point: Vec3) -> Option<(Vec3, f32)> {
        let inside = |q: &Portal| {
            let l = q.local(point);
            l.z.abs() < 0.1 && (l.x / PORTAL_A).powi(2) + (l.y / PORTAL_B).powi(2) <= 1.0
        };
        let open = (0..self.list.len()).find(|&i| self.list[i].placed && self.list[i].delta > 0.0 && self.is_linked(i) && inside(&self.list[i]));
        if let Some(i) = open {
            return Some((self.list[i].center, self.list[i].delta));
        }
        self.statics.iter().find(|q| q.placed && q.delta > 0.0 && inside(q)).map(|q| (q.center, q.delta))
    }

    /// a boca de portal ligado (não temporal) que um objeto de raio `r` em `c` atravessa agora
    pub fn straddled(&self, c: Vec3, r: f32) -> Option<usize> {
        (0..self.list.len()).find(|&i| {
            let p = &self.list[i];
            if !self.is_linked(i) || p.delta > 0.0 || self.list[p.partner].delta > 0.0 {
                return false;
            }
            let l = p.local(c);
            l.z.abs() < r && l.x.abs() < PORTAL_A && l.y.abs() < PORTAL_B
        })
    }

    /// o ponto terminou atrás do plano de um portal sem cruzá-lo (entrou rápido demais)
    pub fn stuck_in(&self, solids: &[Solid], point: Vec3, min: Vec3, max: Vec3, margin: f32) -> Option<usize> {
        for (i, p) in self.list.iter().enumerate() {
            if !self.is_linked(i) || p.delta > 0.0 {
                continue;
            }
            let Some(s) = p.solid else { continue };
            let b = &solids[s];
            if !aabb_overlap(min, max, b.min, b.max, 0.0) {
                continue;
            }
            let l = p.local(point);
            if l.z < -0.02 && l.z > -1.6 && l.x.abs() < PORTAL_A + margin && l.y.abs() < PORTAL_B + margin {
                return Some(i);
            }
        }
        None
    }

    /// ponto (a câmera) logo atrás da boca de um portal ligado
    pub fn behind(&self, point: Vec3) -> Option<usize> {
        for (i, p) in self.list.iter().enumerate() {
            if !self.is_linked(i) || p.delta > 0.0 {
                continue;
            }
            let l = p.local(point);
            if l.z < 0.0 && l.z > -1.5 && l.x.abs() < PORTAL_A && l.y.abs() < PORTAL_B {
                return Some(i);
            }
        }
        None
    }

    pub fn transform(&self, p: usize, q: usize) -> Mat4 {
        transform(&self.list[p], &self.list[q])
    }

    /// leva um corpo de P para o par conservando o momento; devolve (Q, M, rotação)
    pub fn carry(&self, p: usize, pos: &mut Vec3, vel: &mut Vec3) -> (usize, Mat4, Quat) {
        let q = self.list[p].partner;
        let m = self.transform(p, q);
        let rot = Quat::from_mat4(&m);
        *pos = m.transform_point3(*pos);
        *vel = rot * *vel;
        (q, m, rot)
    }

    /// saída por um portal virado para cima com pouca velocidade: sai inteiro e para a frente
    pub fn exit_assist(&self, q: usize, pos: Vec3, vel: &mut Vec3, half: Vec3, g: Vec3, side: Vec3) {
        let gm = g.length();
        if gm < 0.01 {
            return;
        }
        let up = g * (-1.0 / gm);
        let qq = &self.list[q];
        if qq.normal.dot(up) < 0.7 {
            return;
        }
        let h = (pos - qq.center).dot(up);
        let clear = up.x.abs() * half.x + up.y.abs() * half.y + up.z.abs() * half.z + 0.3;
        let need = (2.0 * gm * (clear - h).max(0.0)).sqrt();
        let v_up = vel.dot(up);
        if v_up >= 7.0 {
            return;
        }
        if v_up < need {
            *vel += up * (need - v_up);
        }
        let lat = *vel - up * vel.dot(up);
        let dir = side - up * side.dot(up);
        if dir.length_squared() < 1e-6 {
            return;
        }
        let dir = dir.normalize();
        let along = lat.dot(dir);
        if along < 2.0 {
            *vel += dir * (2.0 - along);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Who {
    Player,
    Prop { held: bool },
    Ball,
}
