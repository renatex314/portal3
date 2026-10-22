//! Peças do mundo para os mapas importados (importedBox/convex/setSolidEnabled de world.js):
//! caixas e sólidos convexos com um tipo de material por face. O mapa fixo vira poucas malhas
//! (uma por material); as peças das entidades têm malha própria (andam, somem, giram).

use crate::geo::Geo;
use crate::mats::{grate_material, hex};
use crate::world::{mats, put, GameWorld, Plane, Solid, SolidBase, TILE};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use std::collections::HashMap;

/// materiais próprios das faces importadas (lâmpada, botão, grade…)
#[derive(Resource, Clone)]
pub struct ImpMats {
    lamp: Handle<StandardMaterial>,
    button: Handle<StandardMaterial>,
    grate: Handle<StandardMaterial>,
}

fn imp_mats(ecs: &mut Ecs) -> ImpMats {
    if let Some(m) = ecs.get_resource::<ImpMats>() {
        return m.clone();
    }
    let grate = grate_material(ecs);
    let mut mm = ecs.resource_mut::<Assets<StandardMaterial>>();
    let c = hex(0xfff6e8).to_linear();
    let lamp = mm.add(StandardMaterial { base_color: Color::LinearRgba(LinearRgba::rgb(c.red * 2.2, c.green * 2.2, c.blue * 2.2)), unlit: true, ..default() });
    let button = mm.add(StandardMaterial { base_color: hex(0xc0392b), emissive: hex(0x5a0a05).to_linear(), perceptual_roughness: 0.5, ..default() });
    let m = ImpMats { lamp, button, grate };
    ecs.insert_resource(m.clone());
    m
}

/// material de uma face importada (`face`: 0..6 na ordem +x −x +y −y +z −z)
pub fn imported_mat(ecs: &mut Ecs, kind: &str, face: usize) -> Handle<StandardMaterial> {
    let im = imp_mats(ecs);
    let m = mats(ecs);
    match kind {
        "lamp" => im.lamp,
        "button" => im.button,
        "grate" => im.grate,
        "door" => m.door.clone(),
        "dark" => m.dark.clone(),
        "goo" => m.kind("magma").faces[face].clone(),
        k => m.kind(k).faces[face].clone(),
    }
}

/// faces do mapa fixo juntadas por material
#[derive(Default)]
pub struct Batch {
    geos: HashMap<(String, usize), Geo>,
}

impl Batch {
    fn add(&mut self, kind: &str, face: usize, g: Geo) {
        let e = self.geos.entry((kind.to_string(), face)).or_default();
        let base = e.pos.len() as u32;
        e.pos.extend(g.pos);
        e.nor.extend(g.nor);
        e.uv.extend(g.uv);
        e.idx.extend(g.idx.into_iter().map(|i| i + base));
    }

    /// as malhas juntadas (uma por material)
    pub fn finish(self, w: &GameWorld, ecs: &mut Ecs) {
        let root = w.root();
        for ((kind, face), g) in self.geos {
            let mat = imported_mat(ecs, &kind, face);
            put(ecs, root, &g, mat, Transform::default());
        }
    }
}

pub struct Opts {
    pub solid: bool,
    pub no_ray: bool,
    pub kinematic: bool,
}

/// face convexa: os pontos do plano em volta do centro (sentido anti-horário visto de fora)
fn convex_face(pts: &[Vec3], n: Vec3, d: f32) -> Option<Geo> {
    let mut on: Vec<Vec3> = pts.iter().copied().filter(|p| (n.dot(*p) - d).abs() < 2e-3).collect();
    if on.len() < 3 {
        return None;
    }
    let c = on.iter().copied().sum::<Vec3>() / on.len() as f32;
    let t = (on[0] - c).normalize_or_zero();
    let bt = n.cross(t);
    on.sort_by(|a, b| {
        let (da, db) = (*a - c, *b - c);
        da.dot(bt).atan2(da.dot(t)).partial_cmp(&db.dot(bt).atan2(db.dot(t))).unwrap_or(std::cmp::Ordering::Equal)
    });
    let ax = if n.x.abs() > n.y.abs() && n.x.abs() > n.z.abs() {
        0
    } else if n.y.abs() > n.z.abs() {
        1
    } else {
        2
    };
    let mut g = Geo::default();
    for p in &on {
        g.pos.push(*p);
        g.nor.push(n);
        g.uv.push(match ax {
            0 => Vec2::new(p.z, p.y),
            1 => Vec2::new(p.x, p.z),
            _ => Vec2::new(p.x, p.y),
        } / TILE);
    }
    for i in 1..on.len() as u32 - 1 {
        g.idx.extend([0, i, i + 1]);
    }
    Some(g)
}

/// índice do material da face convexa (cima, baixo ou lado)
fn convex_slot(n: Vec3) -> usize {
    if n.y > 0.7 {
        2
    } else if n.y < -0.7 {
        3
    } else {
        0
    }
}

impl GameWorld {
    fn push_imported(&mut self, ecs: &mut Ecs, mut b: Solid, parts: Vec<(String, usize, Geo)>, o: &Opts, batch: Option<&mut Batch>) -> usize {
        let id = self.solids.len();
        if !parts.is_empty() {
            match batch {
                Some(bt) => {
                    for (k, f, g) in parts {
                        bt.add(&k, f, g);
                    }
                }
                None => {
                    let parent = ecs.spawn((Transform::default(), Visibility::default(), ChildOf(self.root()))).id();
                    for (k, f, g) in parts {
                        let m = imported_mat(ecs, &k, f);
                        put(ecs, parent, &g, m, Transform::default());
                    }
                    b.entity = Some(parent);
                }
            }
        }
        b.solid = o.solid;
        b.no_ray = o.no_ray;
        b.surface_fit = true;
        if o.solid {
            let c = (b.min + b.max) * 0.5;
            let res = match &b.pts {
                Some(pts) if b.planes.is_some() => {
                    let local: Vec<Vec3> = pts.iter().map(|p| *p - c).collect();
                    self.phys.add_convex(id, c, &local, o.kinematic)
                }
                _ => Some(self.phys.add_box(id, c, (b.max - b.min) * 0.5, Quat::IDENTITY, o.kinematic)),
            };
            if let Some((col, k)) = res {
                b.collider = Some(col);
                b.kbody = k;
            }
        }
        self.solids.push(b);
        id
    }

    /// caixa alinhada com um tipo por face (+x −x +y −y +z −z); aceita portal face a face
    pub fn imp_box(&mut self, ecs: &mut Ecs, min: Vec3, max: Vec3, faces: &[Option<String>; 6], o: &Opts, batch: Option<&mut Batch>) -> usize {
        let geos = crate::geo::world_box_faces(min, max, TILE);
        let mut parts = vec![];
        for (i, g) in geos.into_iter().enumerate() {
            if let Some(k) = &faces[i] {
                parts.push((k.clone(), i, g));
            }
        }
        let portal: [bool; 6] = std::array::from_fn(|i| faces[i].as_deref() == Some("white"));
        let mut b = Solid::new(min, max, faces.iter().flatten().next().map(|s| s.as_str()).unwrap_or("metal"));
        b.portalable = portal.iter().any(|&x| x);
        b.portal_faces = Some(portal);
        self.push_imported(ecs, b, parts, o, batch)
    }

    /// sólido convexo: `pts` os vértices, `planes` as faces (n para fora; dentro: n·p ≤ d)
    pub fn imp_convex(&mut self, ecs: &mut Ecs, pts: Vec<Vec3>, planes: &[(Vec3, f32, Option<String>)], o: &Opts, batch: Option<&mut Batch>) -> usize {
        let mut parts = vec![];
        for (n, d, k) in planes {
            if let Some(k) = k {
                if let Some(g) = convex_face(&pts, *n, *d) {
                    parts.push((k.clone(), convex_slot(*n), g));
                }
            }
        }
        let (mut min, mut max) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for p in &pts {
            min = min.min(*p);
            max = max.max(*p);
        }
        let mut b = Solid::new(min, max, planes.iter().find_map(|p| p.2.as_deref()).unwrap_or("metal"));
        b.planes = Some(planes.iter().map(|(n, d, k)| Plane { n: *n, d: *d, portal: k.as_deref() == Some("white") }).collect());
        b.portalable = planes.iter().any(|p| p.2.as_deref() == Some("white"));
        b.pts = Some(pts);
        self.push_imported(ecs, b, parts, o, batch)
    }

    /// liga/desliga um sólido importado (func_brush com Enable/Disable)
    pub fn set_solid_enabled(&mut self, ecs: &mut Ecs, i: usize, on: bool) {
        let b = &mut self.solids[i];
        b.disabled = !on;
        if let Some(e) = b.entity {
            if let Some(mut v) = ecs.get_mut::<Visibility>(e) {
                *v = if on { Visibility::Inherited } else { Visibility::Hidden };
            }
        }
        if let Some(c) = b.collider {
            self.phys.set_enabled(c, on);
        }
    }

    /// só a colisão (a peça continua visível)
    pub fn set_solid_collide(&mut self, i: usize, on: bool) {
        self.solids[i].disabled = !on;
        if let Some(c) = self.solids[i].collider {
            self.phys.set_enabled(c, on);
        }
    }

    /// leva o sólido para a posição de origem + `off` (a malha, os planos e o colisor juntos)
    pub fn offset_solid(&mut self, ecs: &mut Ecs, i: usize, off: Vec3) {
        let b = &mut self.solids[i];
        if b.base0.is_none() {
            b.base0 = Some(Box::new(SolidBase { min: b.min, max: b.max, planes: b.planes.clone(), pts: b.pts.clone() }));
        }
        let base = b.base0.as_ref().unwrap();
        b.min = base.min + off;
        b.max = base.max + off;
        if let (Some(pl), Some(bp)) = (b.planes.as_mut(), base.planes.as_ref()) {
            for (p, q) in pl.iter_mut().zip(bp) {
                p.d = q.d + q.n.dot(off);
            }
        }
        if let (Some(pt), Some(bp)) = (b.pts.as_mut(), base.pts.as_ref()) {
            for (p, q) in pt.iter_mut().zip(bp) {
                *p = *q + off;
            }
        }
        let c = (b.min + b.max) * 0.5;
        if let Some(e) = b.entity {
            if let Some(mut tr) = ecs.get_mut::<Transform>(e) {
                tr.translation = off;
                tr.rotation = Quat::IDENTITY;
            }
        }
        if let Some(k) = b.kbody {
            self.phys.move_kinematic(k, c);
        } else if let Some(col) = b.collider {
            self.phys.place_collider(col, c);
        }
    }
}
