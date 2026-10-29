//! Desenho dos portais (PortalSystem.render e a classe Portal de portals.js): cada portal tem
//! uma câmera virtual que olha o mundo saindo pelo par dele, com o plano próximo oblíquo no
//! plano do portal de saída (corta o que está atrás da parede). A tela do portal lê essa imagem
//! na posição do pixel na tela. Duas imagens por portal se alternam a cada quadro: quando o
//! portal aparece na própria vista (corredor entre os dois), essa cópia mostra o quadro anterior,
//! como na versão web.
//!
//! Camadas: 0 = mundo; 1 = só a câmera principal (as telas que mostram o quadro atual);
//! 2 + i = o que a câmera do portal i também vê (o próprio portal i, com a tela do quadro anterior);
//! os pares extras (clones do tempo, outros jogadores) usam 20 + i (4, 5, 6 e 10 já são de outros).

/// quantos portais têm vista (o par do jogador e até três pares extras)
const MAX_VIEWS: usize = 8;

/// a camada própria do portal i
pub fn own_layer(i: usize) -> usize {
    if i < 2 { 2 + i } else { 20 + i }
}

use crate::fx::{kind, particles, Fx};
use crate::game::Game;
use crate::geo::{box_geo, plane_geo};
use crate::portals::{transform, Portal, PORTAL_A, PORTAL_B};
use crate::world::{point_light, put, put_mesh};
use crate::{HeadlessTarget, MainCam, EV100};
use bevy::camera::visibility::RenderLayers;
use bevy::camera::{Hdr, RenderTarget};
use bevy::core_pipeline::tonemapping::{DebandDither, Tonemapping};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use bevy::render::render_resource::TextureFormat;
use bevy::window::PrimaryWindow;

const RIM: f32 = 1.42;
const GLOW: f32 = 2.3;
const PORTAL_DEPTH: f32 = 0.6;

pub struct View {
    pub cam: Entity,
    pub group: Entity,
    pub light: Entity,
    pub images: [Handle<Image>; 2],
    /// a imagem em que a câmera desenha neste quadro
    pub write: usize,
    /// telas: (principal, recursiva) × (frente, caixa)
    pub screens: [Handle<Fx>; 4],
    pub rim: Handle<Fx>,
    pub glow: Handle<Fx>,
    pub sparks: Handle<Fx>,
}

#[derive(Resource)]
pub struct PortalViews {
    pub views: Vec<View>,
    /// vermelhos de estática (do relógio: onde a sua versão do futuro abriu o vermelho): só imagem
    pub statics: Vec<View>,
    pub size: UVec2,
    /// quadros em que as vistas desenham mesmo sem portal (fase nova: os shaders delas já ficam
    /// prontos e o primeiro olhar pelo portal não engasga)
    pub warm: u32,
    pub level: Option<usize>,
    /// fase nova: por alguns quadros nada da fase é descartado por estar fora da vista. Cada câmera
    /// prepara um objeto (o shader dele para ela) na primeira vez que o vê: sem isso, atravessar um portal
    /// num mapa grande (a câmera passa a ver uma região nova de uma vez) engasgava uns 100 ms
    pub unculled: Vec<Entity>,
    pub unculled_frames: u32,
    /// fase nova ainda sendo montada: (quadros esperando, modelos no quadro anterior, quadros sem mudar).
    /// O aquecimento só vale com tudo já criado (logo na troca de fase ele aquecia uma cena vazia)
    pub settle: Option<(u32, usize, u32)>,
}

fn new_image(ecs: &mut Ecs, size: UVec2) -> Handle<Image> {
    let img = Image::new_target_texture(size.x.max(1), size.y.max(1), TextureFormat::Rgba16Float, None);
    ecs.resource_mut::<Assets<Image>>().add(img)
}

fn screen_size(ecs: &mut Ecs) -> UVec2 {
    if let Some(t) = ecs.get_resource::<HeadlessTarget>().cloned() {
        if let Some(img) = ecs.resource::<Assets<Image>>().get(&t.0) {
            return img.size();
        }
    }
    let mut q = ecs.query_filtered::<&Window, With<PrimaryWindow>>();
    q.single(ecs).map(|w| UVec2::new(w.physical_width(), w.physical_height())).unwrap_or(UVec2::new(1280, 720))
}

/// o tamanho das imagens das vistas: a tela vezes a escala da qualidade gráfica
fn view_size(ecs: &mut Ecs) -> UVec2 {
    let full = screen_size(ecs);
    let q = ecs.get_resource::<crate::quality::QualityState>().map(|s| s.current).unwrap_or(2);
    let k = crate::quality::portal_scale(q);
    UVec2::new(((full.x as f32 * k).round() as u32).max(1), ((full.y as f32 * k).round() as u32).max(1))
}

fn spawn_view(ecs: &mut Ecs, i: usize, size: UVec2, color: Vec3) -> View {
    let images = [new_image(ecs, size), new_image(ecs, size)];
    let main_layer = RenderLayers::layer(1);
    let own = RenderLayers::layer(own_layer(i));
    let both = RenderLayers::from_layers(&[1, own_layer(i)]);
    let group = ecs.spawn((Transform::default(), Visibility::Hidden, Name::new(format!("portal {i}")))).id();
    let c = Vec4::new(color.x, color.y, color.z, 0.0);
    let screen = |ecs: &mut Ecs, back: bool| {
        let mut m = Fx::new(kind::PORTAL_VIEW).opaque();
        m.u.color = c;
        m.double = !back;
        m.back = back;
        crate::world::fx_mat(ecs, m)
    };
    let screens = [screen(ecs, false), screen(ecs, true), screen(ecs, false), screen(ecs, true)];
    let front = plane_geo(PORTAL_A * 2.0, PORTAL_B * 2.0);
    let inner = box_geo(PORTAL_A * 2.0, PORTAL_B * 2.0, PORTAL_DEPTH).translate(0.0, 0.0, -PORTAL_DEPTH / 2.0);
    for (k, layer) in [(0, &main_layer), (2, &own)] {
        let e = put(ecs, group, &front, screens[k].clone(), Transform::from_xyz(0.0, 0.0, 0.006));
        ecs.entity_mut(e).insert(layer.clone());
        let e = put(ecs, group, &inner, screens[k + 1].clone(), Transform::default());
        ecs.entity_mut(e).insert(layer.clone());
    }
    let deco = |ecs: &mut Ecs, kd: u32| {
        let mut m = Fx::new(kd).blend();
        m.u.color = color.extend(1.0);
        crate::world::fx_mat(ecs, m)
    };
    let rim = deco(ecs, kind::PORTAL_RIM);
    let glow = deco(ecs, kind::PORTAL_GLOW);
    let e = put(ecs, group, &plane_geo(PORTAL_A * 2.0 * RIM, PORTAL_B * 2.0 * RIM), rim.clone(), Transform::from_xyz(0.0, 0.0, 0.012));
    ecs.entity_mut(e).insert(both.clone());
    let e = put(ecs, group, &plane_geo(PORTAL_A * 2.0 * GLOW, PORTAL_B * 2.0 * GLOW), glow.clone(), Transform::from_xyz(0.0, 0.0, 0.01));
    ecs.entity_mut(e).insert(both.clone());
    let mut sm = Fx::new(kind::PORTAL_SPARKS).size(0.035);
    sm.u.color = color.extend(1.0);
    let sparks = crate::world::fx_mat(ecs, sm);
    let mut rng = rand::rng();
    let mesh = particles(90, |_| Vec3::ZERO, |_| [rand::Rng::random::<f32>(&mut rng), 0.0, 0.0, 1.0]);
    let mh = ecs.resource_mut::<Assets<Mesh>>().add(mesh);
    let e = put_mesh(ecs, group, mh, sparks.clone(), Transform::default());
    ecs.entity_mut(e).insert((both, bevy::camera::visibility::NoFrustumCulling));
    let light = ecs.spawn((point_light(Color::linear_rgb(color.x, color.y, color.z), 0.0, 6.0), Transform::default())).id();
    // câmera virtual
    let mut cam = ecs.spawn((
        Camera3d::default(),
        Camera { order: -1 - i as isize, is_active: false, clear_color: ClearColorConfig::Default, ..default() },
        RenderTarget::Image(images[0].clone().into()),
        Hdr,
        Tonemapping::None,
        DebandDither::Disabled,
        bevy::camera::Exposure { ev100: EV100 },
        Projection::Perspective(PerspectiveProjection { fov: 75f32.to_radians(), near: 0.03, ..default() }),
        // (como na versão web: a vista do portal sem MSAA — com 4× ela custava quatro vezes mais)
        Msaa::Off,
        Transform::default(),
        RenderLayers::from_layers(&[0, own_layer(i), crate::characters::BODY_LAYER, crate::relogio::PRESENT_LAYER]),
        Name::new(format!("câmera do portal {i}")),
    ));
    cam.insert(crate::env::WantsEnv { gun: false, intensity: 1.0 });
    let cam = cam.id();
    View { cam, group, light, images, write: 0, screens, rim, glow, sparks }
}

pub fn setup_portal_views(ecs: &mut Ecs) {
    let size = view_size(ecs);
    let colors: Vec<Vec3> = ecs.resource::<Game>().portals.list.iter().take(2).map(|p| p.color).collect();
    let views = colors.iter().enumerate().map(|(i, c)| spawn_view(ecs, i, size, *c)).collect();
    let sc: Vec<Vec3> = ecs.resource::<Game>().portals.statics.iter().map(|p| p.color).collect();
    // (a câmera delas nunca liga: imagem pequena)
    let statics = sc.iter().enumerate().map(|(k, c)| spawn_view(ecs, MAX_VIEWS + k, UVec2::new(4, 4), *c)).collect();
    ecs.insert_resource(PortalViews { views, statics, size, warm: 0, level: None, unculled: vec![], unculled_frames: 0, settle: None });
}

/// fase nova: tira o descarte por campo de visão de todos os modelos da fase por alguns quadros (a câmera
/// principal e as dos portais preparam todos eles enquanto a fase abre)
fn uncull_level(ecs: &mut Ecs, pv: &mut PortalViews) {
    use bevy::camera::visibility::NoFrustumCulling;
    let ents: Vec<Entity> = ecs.query_filtered::<Entity, (With<Mesh3d>, Without<NoFrustumCulling>)>().iter(ecs).collect();
    for &e in &ents {
        ecs.entity_mut(e).insert(NoFrustumCulling);
    }
    pv.unculled.extend(ents);
    pv.unculled_frames = 3;
}

/// a abertura com "passar do ponto" (portals.js update)
fn open_curve(o: f32) -> f32 {
    if o >= 1.0 {
        1.0
    } else {
        1.0 + 2.2 * (o - 1.0).powi(3) + 1.2 * (o - 1.0).powi(2)
    }
}

/// anima a abertura dos portais (PortalSystem.update)
pub fn animate(portals: &mut crate::portals::Portals, dt: f32) {
    for p in portals.list.iter_mut().chain(portals.statics.iter_mut()) {
        p.open = (p.open + dt * 4.5).min(1.0);
        p.age += dt;
    }
}

/// o plano de corte (no espaço da câmera) que deixa só o que está na frente de Q
fn clip_plane(v: &Transform, q: &Portal, near: f32) -> Vec4 {
    let n = v.rotation.inverse() * q.normal;
    let c = v.to_matrix().inverse().transform_point3(q.center);
    let w = -n.dot(c);
    // câmera do lado de fora do plano: corte comum
    if w >= -1e-3 {
        return Vec4::new(0.0, 0.0, -1.0, -near);
    }
    n.extend(w)
}

pub fn update_portal_views(ecs: &mut Ecs) {
    if !ecs.contains_resource::<PortalViews>() {
        setup_portal_views(ecs);
    }
    // a tela mudou de tamanho: novas imagens
    let size = view_size(ecs);
    ecs.resource_scope(|ecs, mut pv: Mut<PortalViews>| {
        if size != pv.size && size.x > 0 && size.y > 0 {
            pv.size = size;
            for v in &mut pv.views {
                v.images = [new_image(ecs, size), new_image(ecs, size)];
            }
        }
        let (cam_tr, proj) = {
            let mut q = ecs.query_filtered::<(&Transform, &Projection), With<MainCam>>();
            let Ok((t, p)) = q.single(ecs) else { return };
            let Projection::Perspective(pp) = p else { return };
            (*t, pp.clone())
        };
        // pares extras (clones do tempo, outros jogadores): uma vista para cada portal
        let more: Vec<(usize, Vec3)> = {
            let g = ecs.resource::<Game>();
            (pv.views.len()..g.portals.list.len().min(MAX_VIEWS)).map(|i| (i, g.portals.list[i].color)).collect()
        };
        for (i, c) in more {
            let v = spawn_view(ecs, i, pv.size, c);
            pv.views.push(v);
        }
        let game = ecs.resource::<Game>();
        if game.level != pv.level {
            pv.level = game.level;
            pv.settle = Some((0, 0, 0));
        }
        let _ = game;
        // espera a fase terminar de ser montada (o número de modelos para de mudar) e então aquece: tudo
        // visível para todas as câmeras por alguns quadros, com as vistas dos portais desenhando
        if let Some((waited, last, stable)) = pv.settle {
            let n = ecs.query_filtered::<(), With<Mesh3d>>().iter(ecs).count();
            // (e com o mapa de ambiente já nas câmeras: ele muda a configuração delas e o que foi preparado antes)
            let env_missing = ecs.query_filtered::<(), (With<crate::env::WantsEnv>, Without<bevy::light::EnvironmentMapLight>)>().iter(ecs).count();
            let stable = if n == last && n > 0 && env_missing == 0 { stable + 1 } else { 0 };
            if stable >= 3 || waited >= 600 {
                pv.settle = None;
                pv.warm = 4;
                uncull_level(ecs, &mut pv);
            } else {
                pv.settle = Some((waited + 1, n, stable));
            }
        } else if pv.unculled_frames > 0 {
            pv.unculled_frames -= 1;
            if pv.unculled_frames == 0 {
                for e in std::mem::take(&mut pv.unculled) {
                    if let Ok(mut x) = ecs.get_entity_mut(e) {
                        x.remove::<bevy::camera::visibility::NoFrustumCulling>();
                    }
                }
            }
        }
        let game = ecs.resource::<Game>();
        let warming = pv.warm > 0;
        pv.warm = pv.warm.saturating_sub(1);
        let t = game.t;
        let statics: Vec<Portal> = game.portals.statics.clone();
        let portals: Vec<Portal> = game.portals.list.iter().take(pv.views.len()).cloned().collect();
        // vermelhos de estática: só estática por cima, sem vista e sem levar a lugar nenhum
        for (v, p) in pv.statics.iter().zip(statics.iter()) {
            ecs.entity_mut(v.group).insert((Transform::from_matrix(p.matrix), if p.placed { Visibility::Visible } else { Visibility::Hidden }));
            let li = if p.placed { 3.0 + 2.0 * (t * 23.0).sin() * (t * 7.0).sin() } else { 0.0 };
            ecs.entity_mut(v.light).insert((point_light(Color::linear_rgb(p.color.x, p.color.y, p.color.z), li, 6.0), Transform::from_translation(p.center + p.normal * 0.6)));
            let open = open_curve(p.open);
            let mut fx = ecs.resource_mut::<Assets<Fx>>();
            for h in &v.screens {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.p0 = p.center.extend(open);
                    m.u.p1 = p.right.extend(1.0);
                    m.u.p2 = p.up.extend(0.0);
                    m.u.p3 = p.normal.extend(1.0);
                    m.u.color = p.color.extend(1.0);
                }
            }
            for h in [&v.rim, &v.glow] {
                if let Some(mut m) = fx.get_mut(h) {
                    m.u.p0 = Vec4::new(open, 0.0, 0.0, 0.0);
                    m.u.color = p.color.extend(1.0);
                }
            }
            if let Some(mut m) = fx.get_mut(&v.sparks) {
                m.u.p0 = Vec4::new(PORTAL_A, PORTAL_B, open, 0.0);
                m.u.color = p.color.extend(1.0);
            }
        }
        let game = ecs.resource::<Game>();
        let linked: Vec<bool> = (0..portals.len()).map(|i| game.portals.is_linked(i)).collect();
        let cam_fwd = cam_tr.rotation * Vec3::NEG_Z;
        for (i, v) in pv.views.iter_mut().enumerate() {
            if i >= portals.len() {
                // o par saiu da lista (troca de fase)
                ecs.entity_mut(v.group).insert(Visibility::Hidden);
                ecs.entity_mut(v.light).insert(point_light(Color::BLACK, 0.0, 6.0));
                if let Some(mut c) = ecs.entity_mut(v.cam).get_mut::<Camera>() {
                    c.is_active = false;
                }
                continue;
            }
            let p = &portals[i];
            let q = &portals[p.partner];
            let shown = p.placed && p.delta == 0.0;
            ecs.entity_mut(v.group).insert((Transform::from_matrix(p.matrix), if shown { Visibility::Visible } else { Visibility::Hidden }));
            let open = open_curve(p.open);
            let flash = (1.0 - p.age / 0.5).max(0.0).powi(2);
            let li = if shown { 2.8 + 0.5 * (t * 2.6).sin() + 0.4 * flash } else { 0.0 }; // (a luz do Bevy cai com 1/d², a do three.js com 1/d^1,6: perto da parede o clarão aqui estourava mais)
            let lp = point_light(Color::linear_rgb(p.color.x, p.color.y, p.color.z), li, 6.0);
            ecs.entity_mut(v.light).insert((lp, Transform::from_translation(p.center + p.normal * 0.6)));
            // a vista: só quando ligado e (mais ou menos) na frente da câmera
            let to = p.center - cam_tr.translation;
            let facing = to.dot(p.normal) < PORTAL_DEPTH; // câmera na frente do portal (ou dentro da caixa)
            let ahead = to.dot(cam_fwd) > -PORTAL_B * 1.5 || to.length() < PORTAL_B * 2.0;
            let real = shown && linked[i] && facing && ahead;
            // a câmera fica ligada enquanto o portal existe: ligar e desligar a cada olhada jogava fora e
            // refazia as texturas dela (um tranco a cada vez); fora da vista ela não desenha nada
            let active = real || warming || (shown && linked[i]);
            let w = 1 - v.write;
            if real || warming {
                v.write = w;
            }
            let current = v.images[v.write].clone();
            let previous = v.images[1 - v.write].clone();
            let past = if q.delta > 0.0 || p.gray { 1.0 } else { 0.0 };
            // pelo ciano temporal: a sala de Δ s atrás (as cópias do passado, sem as coisas de agora)
            let when = if q.delta > 0.0 { crate::relogio::PAST_LAYER } else { crate::relogio::PRESENT_LAYER };
            // o seu corpo de agora não existe no passado (lá só a sua versão de então, a cópia cinza)
            let layers = if !(real || warming) {
                RenderLayers::none()
            } else if q.delta > 0.0 {
                RenderLayers::from_layers(&[0, own_layer(i), when])
            } else {
                RenderLayers::from_layers(&[0, own_layer(i), crate::characters::BODY_LAYER, when])
            };
            ecs.entity_mut(v.cam).insert(layers);
            {
                let mut fx = ecs.resource_mut::<Assets<Fx>>();
                for (k, h) in v.screens.iter().enumerate() {
                    if let Some(mut m) = fx.get_mut(h) {
                        m.u.p0 = p.center.extend(open);
                        m.u.p1 = p.right.extend(if linked[i] { 1.0 } else { 0.0 });
                        m.u.p2 = p.up.extend(past);
                        m.u.p3 = p.normal.extend(0.0);
                        m.u.color = p.color.extend(0.0);
                        m.view = Some(if k < 2 { current.clone() } else { previous.clone() });
                    }
                }
                for h in [&v.rim, &v.glow] {
                    if let Some(mut m) = fx.get_mut(h) {
                        m.u.p0 = Vec4::new(open, flash, 0.0, 0.0);
                        m.u.color = p.color.extend(1.0);
                    }
                }
                if let Some(mut m) = fx.get_mut(&v.sparks) {
                    m.u.p0 = Vec4::new(PORTAL_A, PORTAL_B, open, 0.0);
                    m.u.color = p.color.extend(1.0);
                }
            }
            let mut e = ecs.entity_mut(v.cam);
            if let Some(mut c) = e.get_mut::<Camera>() {
                c.is_active = active;
            }
            if !(real || warming) {
                continue;
            }
            let m = if real { transform(p, q) } else { Mat4::IDENTITY };
            let vt = Transform::from_matrix(m * cam_tr.to_matrix());
            let plane = clip_plane(&vt, q, proj.near);
            e.insert((vt, Projection::Perspective(PerspectiveProjection { near_clip_plane: plane, ..proj.clone() }), RenderTarget::Image(current.into())));
        }
    });
}
