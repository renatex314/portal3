//! Material de efeitos: os ShaderMaterial da versão web (grade de desintegração, bobinas,
//! zonas de gravidade, buraco negro, partículas...) num só shader (assets/shaders/fx.wesl),
//! escolhido por `kind`. Partículas (os `THREE.Points`) viram quadrados virados para a câmera:
//! a malha tem 4 vértices por partícula com a semente em COLOR e o canto em UV.

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, MeshVertexBufferLayoutRef, PrimitiveTopology};
use bevy::pbr::{MaterialPipeline, MaterialPipelineKey};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, CompareFunction, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError};
use bevy::shader::ShaderRef;

pub mod kind {
    pub const FIZZ_FIELD: u32 = 1;
    pub const COIL: u32 = 2;
    pub const SLIT: u32 = 3;
    pub const FIZZ_MOTES: u32 = 4;
    pub const GRAV_ZONE: u32 = 5;
    pub const BH_HALO: u32 = 6;
    pub const BH_DISK: u32 = 7;
    pub const BH_MOTES: u32 = 8;
    pub const EMBERS: u32 = 9;
    pub const ELEV_MOTES: u32 = 10;
    pub const STARS: u32 = 11;
    pub const SPRITE: u32 = 12;
    pub const HINT: u32 = 13;
    pub const HOLO: u32 = 14;
    pub const PORTAL_VIEW: u32 = 20;
    pub const PORTAL_RIM: u32 = 21;
    pub const PORTAL_GLOW: u32 = 22;
    pub const PORTAL_SPARKS: u32 = 23;
    pub const LASER_GLOW: u32 = 30;
    pub const FUNNEL: u32 = 31;
    pub const BRIDGE: u32 = 32;
    pub const BRIDGE_CORNER: u32 = 33;
    pub const GUN_PLASMA: u32 = 34;
    pub const GUN_CONDUIT: u32 = 35;
    pub const GUN_MOTES: u32 = 36;
    pub const VEIN: u32 = 37;
    pub const DISSOLVE: u32 = 38;
    pub const DUST: u32 = 39;
    pub const CORE_SPHERE: u32 = 40;
}

#[derive(ShaderType, Clone, Copy, Debug, Default)]
pub struct FxU {
    pub color: Vec4,
    pub p0: Vec4,
    pub p1: Vec4,
    pub p2: Vec4,
    pub p3: Vec4,
    pub time: f32,
    pub kind: u32,
    pub flags: u32,
    pub size: f32,
}

#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
#[bind_group_data(FxKey)]
pub struct Fx {
    #[uniform(0)]
    pub u: FxU,
    #[texture(1)]
    #[sampler(2)]
    pub tex: Option<Handle<Image>>,
    /// a vista pelo portal (lida na posição da tela)
    #[texture(3)]
    #[sampler(4)]
    pub view: Option<Handle<Image>>,
    pub alpha: AlphaMode,
    pub double: bool,
    pub depth_write: bool,
    /// desenha por cima de tudo (sem teste de profundidade)
    pub on_top: bool,
    /// só as faces de trás (a "caixa" atrás do portal)
    pub back: bool,
}

#[repr(C)]
#[derive(Eq, PartialEq, Hash, Copy, Clone)]
pub struct FxKey {
    double: bool,
    depth_write: bool,
    on_top: bool,
    back: bool,
    add: bool,
}

impl From<&Fx> for FxKey {
    fn from(m: &Fx) -> Self {
        FxKey { double: m.double, depth_write: m.depth_write, on_top: m.on_top, back: m.back, add: matches!(m.alpha, AlphaMode::Add) }
    }
}

impl Material for Fx {
    fn vertex_shader() -> ShaderRef {
        "shaders/fx.wesl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "shaders/fx.wesl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        self.alpha
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(_: &MaterialPipeline, d: &mut RenderPipelineDescriptor, _: &MeshVertexBufferLayoutRef, key: MaterialPipelineKey<Self>) -> Result<(), SpecializedMeshPipelineError> {
        let k = key.bind_group_data;
        if k.double {
            d.primitive.cull_mode = None;
        }
        // soma de luz: no Bevy é a mistura pré-multiplicada com alfa 0 (o shader multiplica a cor pelo alfa)
        if k.add {
            if let Some(f) = d.fragment.as_mut() {
                f.shader_defs.push("FX_ADD".into());
            }
        }
        if k.back {
            d.primitive.cull_mode = Some(bevy::render::render_resource::Face::Front);
        }
        if let Some(ds) = d.depth_stencil.as_mut() {
            ds.depth_write_enabled = Some(k.depth_write);
            if k.on_top {
                ds.depth_compare = Some(CompareFunction::Always);
            }
        }
        Ok(())
    }
}

impl Fx {
    pub fn new(kind: u32) -> Self {
        Fx { u: FxU { kind, color: Vec4::ONE, ..default() }, tex: None, view: None, alpha: AlphaMode::Add, double: true, depth_write: false, on_top: false, back: false }
    }
    pub fn color(mut self, c: LinearRgba) -> Self {
        self.u.color = Vec4::new(c.red, c.green, c.blue, c.alpha);
        self
    }
    pub fn p0(mut self, v: Vec4) -> Self {
        self.u.p0 = v;
        self
    }
    pub fn p1(mut self, v: Vec4) -> Self {
        self.u.p1 = v;
        self
    }
    pub fn p2(mut self, v: Vec4) -> Self {
        self.u.p2 = v;
        self
    }
    pub fn p3(mut self, v: Vec4) -> Self {
        self.u.p3 = v;
        self
    }
    pub fn size(mut self, s: f32) -> Self {
        self.u.size = s;
        self
    }
    pub fn blend(mut self) -> Self {
        self.alpha = AlphaMode::Blend;
        self
    }
    pub fn opaque(mut self) -> Self {
        self.alpha = AlphaMode::Opaque;
        self.depth_write = true;
        self
    }
    pub fn single(mut self) -> Self {
        self.double = false;
        self
    }
}

/// malha de `n` partículas: 4 vértices por partícula na posição `base(i)`, semente em COLOR
pub fn particles(n: usize, mut base: impl FnMut(usize) -> Vec3, mut seed: impl FnMut(usize) -> [f32; 4]) -> Mesh {
    let mut pos = Vec::with_capacity(n * 4);
    let mut uv = Vec::with_capacity(n * 4);
    let mut col = Vec::with_capacity(n * 4);
    let mut idx = Vec::with_capacity(n * 6);
    for i in 0..n {
        let p = base(i).to_array();
        let s = seed(i);
        let b = (i * 4) as u32;
        for c in [[-1.0f32, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]] {
            pos.push(p);
            uv.push(c);
            col.push(s);
        }
        idx.extend([b, b + 1, b + 2, b, b + 2, b + 3]);
    }
    let mut m = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, col)
        .with_inserted_indices(Indices::U32(idx));
    // (as partículas andam no shader: a caixa de recorte não vale)
    m.insert_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0f32, 0.0, 1.0]; n * 4]);
    m
}

/// o tempo dos efeitos: cada material guarda o seu (`time`), atualizado a cada quadro
#[derive(Resource, Default)]
pub struct FxClock {
    pub t: f32,
}

pub fn tick_fx(clock: Res<FxClock>, mut mats: ResMut<Assets<Fx>>) {
    for (_, m) in mats.iter_mut() {
        if m.u.flags & 1 == 0 {
            m.u.time = clock.t;
        }
    }
}
