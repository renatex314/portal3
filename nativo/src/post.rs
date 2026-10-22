//! Pós-processamento (fx.js da versão web), em dois passes de tela cheia na câmera principal:
//!
//!  1) antes do tom (cena em HDR, com a profundidade do pré-passe): desfoque de movimento por
//!     reprojeção (e o borrão radial em alta velocidade), névoa de calor sobre a rocha fundida,
//!     a lente do campo de dilatação e a onda de choque do tiro;
//!  2) depois do tom (o FinishPass): aberração cromática, vinheta, grão, o gelo do tempo parado,
//!     o "glitch" do paradoxo e o visual do tempo lento (o filtro de CSS da tela da versão web).
//!
//! A arma é desenhada por outra câmera, por cima: nenhum dos dois passes a afeta.

use crate::game::Game;
use crate::MainCam;
use bevy::camera::CameraProjection;
use bevy::core_pipeline::fullscreen_material::{FullscreenMaterial, FullscreenMaterialPlugin};
use bevy::core_pipeline::prepass::ViewPrepassTextures;
use bevy::core_pipeline::tonemapping::tonemapping;
use bevy::core_pipeline::{Core3d, Core3dSystems, FullscreenShader};
use bevy::ecs::schedule::ScheduleConfigs;
use bevy::ecs::system::BoxedSystem;
use bevy::prelude::*;
use bevy::render::extract_component::{ComponentUniforms, DynamicUniformIndex, ExtractComponent, ExtractComponentPlugin, UniformComponentPlugin};
use bevy::render::render_resource::binding_types::{sampler, texture_2d, texture_depth_2d, texture_depth_2d_multisampled, uniform_buffer};
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice, ViewQuery};
use bevy::render::view::{ExtractedView, ViewTarget};
use bevy::render::{Render, RenderApp, RenderStartup, RenderSystems};
use bevy::shader::ShaderRef;

pub const LAKES: usize = 12;

/// parâmetros do passe 1 (copiados para a placa a cada quadro)
#[derive(Component, ExtractComponent, Clone, Copy, ShaderType)]
#[extract_app(RenderApp)]
pub struct SceneFx {
    pub world_from_clip: Mat4,
    pub prev_clip_from_world: Mat4,
    /// posição da câmera e o tempo
    pub cam: Vec4,
    /// desfoque: força, rastro máximo, radial, ligado
    pub blur: Vec4,
    /// lagos de rocha fundida (x0, z0, x1, z1) e o topo de cada um
    pub lakes: [Vec4; LAKES],
    pub tops: [Vec4; LAKES / 4],
    /// número de lagos, proporção da tela
    pub misc: Vec4,
    /// onda de choque: centro (uv), t (0..1), raio máximo
    pub shock: Vec4,
    /// força e largura da onda
    pub shock2: Vec4,
    /// lente do campo: centro (uv), raio (em alturas de tela), esmaecimento
    pub lens: Vec4,
    /// lente: dentro?
    pub lens2: Vec4,
}

impl Default for SceneFx {
    fn default() -> Self {
        SceneFx {
            world_from_clip: Mat4::IDENTITY,
            prev_clip_from_world: Mat4::IDENTITY,
            cam: Vec4::ZERO,
            blur: Vec4::new(0.6, 0.045, 0.0, 1.0),
            lakes: [Vec4::ZERO; LAKES],
            tops: [Vec4::ZERO; LAKES / 4],
            misc: Vec4::new(0.0, 16.0 / 9.0, 0.0, 0.0),
            shock: Vec4::new(0.5, 0.5, 1.0, 0.14),
            shock2: Vec4::new(0.03, 1.0, 0.0, 0.0),
            lens: Vec4::ZERO,
            lens2: Vec4::ZERO,
        }
    }
}

/// parâmetros do acabamento (FinishPass)
#[derive(Component, ExtractComponent, Clone, Copy, ShaderType, Default)]
#[extract_app(RenderApp)]
pub struct FinishFx {
    /// tempo, aberração, vinheta, grão
    pub a: Vec4,
    /// gelo (tempo parado), glitch (paradoxo), visual do tempo lento, —
    pub b: Vec4,
}

impl FullscreenMaterial for FinishFx {
    fn fragment_shader() -> ShaderRef {
        "shaders/finish.wesl".into()
    }
    fn schedule_configs(system: ScheduleConfigs<BoxedSystem>) -> ScheduleConfigs<BoxedSystem> {
        system.in_set(Core3dSystems::PostProcess).after(tonemapping)
    }
}

pub struct PostPlugin;

impl Plugin for PostPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins((ExtractComponentPlugin::<SceneFx>::default(), UniformComponentPlugin::<SceneFx>::default(), FullscreenMaterialPlugin::<FinishFx>::default()))
            .init_resource::<PostState>()
            .add_systems(PostUpdate, update_post.after(bevy::transform::TransformSystems::Propagate));
        let Some(render_app) = app.get_sub_app_mut(RenderApp) else { return };
        render_app
            .add_systems(RenderStartup, init_pipeline)
            .add_systems(Render, prepare_pipelines.in_set(RenderSystems::Prepare))
            .add_systems(Core3d, scene_fx_system.in_set(Core3dSystems::PostProcess).before(tonemapping));
    }
}

#[derive(Resource)]
struct ScenePipeline {
    layout: BindGroupLayoutDescriptor,
    layout_ms: BindGroupLayoutDescriptor,
    sampler: Sampler,
    shader: Handle<Shader>,
    fullscreen: FullscreenShader,
}

#[derive(Component)]
struct ScenePipelineId(CachedRenderPipelineId, bool);

fn init_pipeline(mut commands: Commands, render_device: Res<RenderDevice>, asset_server: Res<AssetServer>, fullscreen: Res<FullscreenShader>) {
    let entries = |ms: bool| {
        BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                texture_2d(TextureSampleType::Float { filterable: true }),
                sampler(SamplerBindingType::Filtering),
                uniform_buffer::<SceneFx>(true),
                if ms { texture_depth_2d_multisampled() } else { texture_depth_2d() },
            ),
        )
    };
    let layout = BindGroupLayoutDescriptor::new("pos_cena", &entries(false));
    let layout_ms = BindGroupLayoutDescriptor::new("pos_cena_ms", &entries(true));
    let sampler = render_device.create_sampler(&SamplerDescriptor { mag_filter: FilterMode::Linear, min_filter: FilterMode::Linear, address_mode_u: AddressMode::ClampToEdge, address_mode_v: AddressMode::ClampToEdge, ..default() });
    commands.insert_resource(ScenePipeline { layout, layout_ms, sampler, shader: asset_server.load("shaders/scene_fx.wesl"), fullscreen: fullscreen.clone() });
}

fn prepare_pipelines(mut commands: Commands, cache: Res<PipelineCache>, pipeline: Option<Res<ScenePipeline>>, views: Query<(Entity, &ExtractedView, &Msaa), With<SceneFx>>, mut ids: Local<std::collections::HashMap<(TextureFormat, bool), CachedRenderPipelineId>>) {
    let Some(p) = pipeline else { return };
    for (e, view, msaa) in &views {
        let ms = msaa.samples() > 1;
        let key = (view.target_format, ms);
        let id = *ids.entry(key).or_insert_with(|| {
            cache.queue_render_pipeline(RenderPipelineDescriptor {
                label: Some("pos_cena".into()),
                layout: vec![if ms { p.layout_ms.clone() } else { p.layout.clone() }],
                vertex: p.fullscreen.to_vertex_state(),
                fragment: Some(FragmentState {
                    shader: p.shader.clone(),
                    shader_defs: if ms { vec!["MULTISAMPLED".into()] } else { vec![] },
                    targets: vec![Some(ColorTargetState { format: view.target_format, blend: None, write_mask: ColorWrites::ALL })],
                    ..default()
                }),
                ..default()
            })
        });
        commands.entity(e).insert(ScenePipelineId(id, ms));
    }
}

fn scene_fx_system(
    view: ViewQuery<(&ViewTarget, &DynamicUniformIndex<SceneFx>, &ScenePipelineId, &ViewPrepassTextures)>,
    pipeline: Option<Res<ScenePipeline>>,
    cache: Res<PipelineCache>,
    uniforms: Res<ComponentUniforms<SceneFx>>,
    render_device: Res<RenderDevice>,
    mut ctx: RenderContext,
) {
    let (target, index, id, prepass) = view.into_inner();
    let Some(p) = pipeline else { return };
    let Some(rp) = cache.get_render_pipeline(id.0) else { return };
    let Some(binding) = uniforms.uniforms().binding() else { return };
    let Some(depth) = prepass.depth_only_view() else { return };
    let post = target.post_process_write();
    let bind_group = render_device.create_bind_group("pos_cena", &cache.get_bind_group_layout(if id.1 { &p.layout_ms } else { &p.layout }), &BindGroupEntries::sequential((post.source, &p.sampler, binding, depth)));
    let desc = RenderPassDescriptor {
        label: Some("pos_cena"),
        color_attachments: &[Some(RenderPassColorAttachment { view: post.destination, depth_slice: None, resolve_target: None, ops: Operations::default() })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    };
    let mut pass = ctx.command_encoder().begin_render_pass(&desc);
    pass.set_pipeline(rp);
    pass.set_bind_group(0, &bind_group, &[index.index()]);
    pass.draw(0..3, 0..1);
}

// ------------------------------------------------------------------ do jogo para os passes
#[derive(Resource, Default)]
pub struct PostState {
    prev_clip_from_world: Option<Mat4>,
    prev_pos: Vec3,
    prev_fwd: Vec3,
    pub shock_t: f32,
    shock_big: bool,
    pub warp: f32,
    pub tunnel: f32,
    pub freeze: f32,
    pub glitch: f32,
    slow_look: f32,
    t: f32,
}

impl PostState {
    /// dispara a onda de choque (a do tiro sai da boca da arma; `big`: do centro da tela)
    pub fn shockwave(&mut self, big: bool) {
        self.shock_t = 0.0;
        self.shock_big = big;
    }
}

fn update_post(
    mut commands: Commands,
    time: Res<Time>,
    game: Option<ResMut<Game>>,
    mut st: ResMut<PostState>,
    cams: Query<(Entity, &GlobalTransform, &Projection, &Camera, Option<&SceneFx>), With<MainCam>>,
    gun: Option<Res<crate::gun::Gun>>,
    gt: Query<&GlobalTransform>,
    names: Query<(&Name, &GlobalTransform)>,
) {
    let Some(mut game) = game else { return };
    let kick = game.relogio.as_mut().and_then(|c| c.fx_kick.take());
    let Ok((cam_e, cam_t, proj, camera, has)) = cams.single() else { return };
    let dt = time.delta_secs().min(0.05);
    st.t += dt;
    let Projection::Perspective(pp) = proj else { return };
    let mut pp = pp.clone();
    if let Some(vp) = camera.logical_viewport_size() {
        pp.aspect_ratio = vp.x / vp.y.max(1.0);
    }
    let clip_from_view = pp.get_clip_from_view();
    let view_from_world = cam_t.affine().inverse();
    let clip_from_world = clip_from_view * Mat4::from(view_from_world);
    let pos = cam_t.translation();
    let fwd = cam_t.forward().as_vec3();
    // pulo grande de posição ou de direção = passou por um portal / renasceu: não borra
    let fresh = st.prev_clip_from_world.is_none() || pos.distance(st.prev_pos) > 2.5 || fwd.dot(st.prev_fwd) < 0.75;
    let prev = if fresh { clip_from_world } else { st.prev_clip_from_world.unwrap() };
    st.prev_clip_from_world = Some(clip_from_world);
    st.prev_pos = pos;
    st.prev_fwd = fwd;
    // tempo lento, velocidade, salto
    let slow = ((1.0 - game.slow.k) / (1.0 - game.slow.scale)).clamp(0.0, 1.0);
    let speed = game.player.vel.length();
    let ahead = if speed > 0.1 { game.player.vel.dot(fwd) / speed } else { 0.0 };
    let fast = crate::world::smoothstep(8.0, 32.0, speed);
    // relógio do tempo: parado = gelo; salto = túnel e aberração; paradoxo = glitch
    let (paused, jumped, paradox) = game.relogio.as_ref().map(|c| (c.paused, c.fx_jump > 0.0, c.fx_paradox)).unwrap_or((false, false, 0.0));
    st.freeze += ((if paused { 1.0 } else { 0.0 }) - st.freeze) * (dt * 6.0).min(1.0);
    st.glitch = (paradox * 1.5).min(1.0);
    let _ = jumped;
    if let Some((warp, tunnel, big)) = kick {
        st.warp = st.warp.max(warp);
        st.tunnel = st.tunnel.max(tunnel);
        if big {
            st.shockwave(true);
        }
    }
    st.warp = (st.warp - dt * 1.5).max(0.0);
    st.tunnel = (st.tunnel - dt * 1.3).max(0.0);
    let blur_on = game.progress.blur && !game.menu;
    let mut strength = (0.6 + slow * 1.4) * (1.0 + fast * 2.2) + st.tunnel * 3.0;
    if !blur_on {
        strength = 0.0;
    }
    let max_len = 0.045 + fast * 0.075;
    let radial = if fresh { 0.0 } else { fast * 0.05 * ahead + st.tunnel * st.tunnel * 0.16 };
    // lagos de rocha fundida mais perto da câmera
    let mut lakes: Vec<(f32, Vec3, Vec3)> = game
        .world
        .hazards
        .iter()
        .map(|&h| &game.world.solids[h])
        .filter(|b| b.max.y - b.min.y < 3.0)
        .map(|b| {
            let d = Vec3::new((b.min.x - pos.x).max(0.0).max(pos.x - b.max.x), (b.max.y - pos.y).max(0.0).max(pos.y - b.max.y - 3.2), (b.min.z - pos.z).max(0.0).max(pos.z - b.max.z)).length();
            (d, b.min, b.max)
        })
        .filter(|l| l.0 < 120.0)
        .collect();
    lakes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    lakes.truncate(LAKES);
    let mut fx = SceneFx { world_from_clip: clip_from_world.inverse(), prev_clip_from_world: prev, cam: pos.extend(st.t), blur: Vec4::new(strength, max_len, radial, if blur_on { 1.0 } else { 0.0 }), ..default() };
    for (i, (_, mn, mx)) in lakes.iter().enumerate() {
        fx.lakes[i] = Vec4::new(mn.x, mn.z, mx.x, mx.z);
        fx.tops[i / 4][i % 4] = mx.y;
    }
    fx.misc = Vec4::new(lakes.len() as f32, pp.aspect_ratio, 0.0, 0.0);
    // onda de choque do tiro: sai da boca da arma (a arma dispara em gun.rs)
    st.shock_t = (st.shock_t + dt * if st.shock_big { 1.4 } else { 2.6 }).min(1.0);
    let mut center = Vec2::new(0.5, 0.5);
    if !st.shock_big {
        let tip = gun.as_ref().and_then(|_| names.iter().find(|(n, _)| n.as_str() == "tip").map(|(_, g)| g.translation()));
        if let Some(p) = tip {
            let c = clip_from_world * p.extend(1.0);
            if c.w > 0.0 {
                center = Vec2::new(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5);
            }
        }
    }
    let _ = &gt;
    fx.shock = Vec4::new(center.x, center.y, st.shock_t, if st.shock_big { 0.8 } else { 0.14 });
    fx.shock2 = Vec4::new(if st.shock_big { 0.05 } else { 0.03 }, if st.shock_big { 2.6 } else { 1.0 }, 0.0, 0.0);
    // lente do campo de dilatação: o campo mais perto (de dentro, a tela inteira)
    let f = &game.field;
    if let Some(field) = f.active.iter().min_by(|a, b| a.center.distance(pos).partial_cmp(&b.center.distance(pos)).unwrap()) {
        let born = ((f.life - field.left) * 2.5).min(1.0);
        let fade = (field.left / (f.life * 0.6)).min(1.0).min(born);
        let dist = pos.distance(field.center);
        if dist < f.r {
            fx.lens = Vec4::new(0.5, 0.5, 0.62, fade);
            fx.lens2 = Vec4::new(1.0, 0.0, 0.0, 0.0);
        } else {
            let c = clip_from_world * field.center.extend(1.0);
            if c.w > 0.05 {
                let ang = (f.r / dist).min(0.999).asin();
                let scale = 0.2 + 0.8 * (1.0 - (1.0 - born).powi(3));
                let r = ang.tan() / (pp.fov / 2.0).tan() * 0.5 * scale;
                fx.lens = Vec4::new(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5, r, fade);
                // a esfera de verdade: raio no mundo, distância e a escala da projeção
                fx.lens2 = Vec4::new(0.0, f.r * scale, dist, 0.5 / (pp.fov / 2.0).tan());
            }
        }
    }
    commands.entity(cam_e).insert(fx);
    // acabamento
    let field_k = f.charge / f.need;
    let dilate = field_k * 0.6;
    st.slow_look += ((if game.slow.on { 1.0 } else { 0.0 }) - st.slow_look) * (dt / 0.3).min(1.0);
    let finish = FinishFx {
        a: Vec4::new(st.t, slow * 0.012 + st.warp * st.warp * 0.08 + dilate * 0.005, 0.18 + slow * 0.25 + st.warp * 0.4, 0.035),
        b: Vec4::new(st.freeze, st.glitch, st.slow_look, 0.0),
    };
    commands.entity(cam_e).insert(finish);
    let _ = has;
}
