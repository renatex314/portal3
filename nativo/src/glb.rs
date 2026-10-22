//! Modelos exportados da versão web (assets/models/*.glb), carregados na hora (sem esperar o
//! carregador assíncrono do Bevy): a hierarquia vira entidades com `Name`, para a lógica achar
//! as peças animadas (garras da arma, placa do botão...). Materiais que o glTF não representa
//! (básicos com cor acima de 1, transparência aditiva) vêm nos "extras" do nó (`mat`).

use crate::geo::Geo;
use crate::mats::asset_dir;
use bevy::asset::RenderAssetUsages;
use bevy::ecs::world::World as Ecs;
use bevy::image::{CompressedImageFormats, ImageAddressMode, ImageSampler, ImageSamplerDescriptor, ImageType};
use bevy::prelude::*;
use std::collections::HashMap;

/// um nó do modelo (já com malhas e materiais prontos para instanciar)
#[derive(Clone)]
pub struct NodeDef {
    pub name: String,
    pub transform: Transform,
    /// malha, material e o nome do material no glTF (vazio se não tem)
    pub prims: Vec<(Handle<Mesh>, Handle<StandardMaterial>, String)>,
    pub children: Vec<usize>,
    /// extras (userData) do nó
    pub extras: serde_json::Value,
}

#[derive(Clone)]
pub struct Model {
    pub nodes: Vec<NodeDef>,
    pub roots: Vec<usize>,
    /// extras (userData) do primeiro nó raiz
    pub extras: serde_json::Value,
}

#[derive(Resource, Default)]
pub struct Models {
    pub cache: HashMap<String, Model>,
}

/// extras.mat: { basic, color: [r,g,b], toneMapped, transparent, opacity, additive, doubleSide, shader }
fn extra_mat(extras: &Option<Box<serde_json::value::RawValue>>) -> Option<serde_json::Value> {
    let raw = extras.as_ref()?;
    let v: serde_json::Value = serde_json::from_str(raw.get()).ok()?;
    v.get("mat").cloned()
}

fn load(name: &str, ecs: &mut Ecs) -> Option<Model> {
    let path = asset_dir().join("models").join(format!("{name}.glb"));
    let bytes = std::fs::read(&path).ok()?;
    let (doc, buffers, images) = gltf::import_slice(&bytes).ok()?;
    // modelos novos (o chefe): as cores fora da curva de tom da versão web são compensadas
    let untone = ["boss", "rocket", "core_"].iter().any(|p| name.starts_with(p));
    // texturas
    let mut tex: Vec<Option<Handle<Image>>> = vec![];
    {
        let mut assets = ecs.resource_mut::<Assets<Image>>();
        for (i, img) in images.iter().enumerate() {
            let srgb = doc.materials().any(|m| {
                m.pbr_metallic_roughness().base_color_texture().map(|t| t.texture().source().index() == i).unwrap_or(false)
                    || m.emissive_texture().map(|t| t.texture().source().index() == i).unwrap_or(false)
            });
            let w = img.width;
            let h = img.height;
            let rgba: Vec<u8> = match img.format {
                gltf::image::Format::R8G8B8A8 => img.pixels.clone(),
                gltf::image::Format::R8G8B8 => img.pixels.chunks(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
                gltf::image::Format::R8 => img.pixels.iter().flat_map(|&p| [p, p, p, 255]).collect(),
                gltf::image::Format::R8G8 => img.pixels.chunks(2).flat_map(|p| [p[0], p[1], 0, 255]).collect(),
                _ => {
                    tex.push(None);
                    continue;
                }
            };
            let mut image = Image::new(
                bevy::render::render_resource::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                bevy::render::render_resource::TextureDimension::D2,
                rgba,
                if srgb { bevy::render::render_resource::TextureFormat::Rgba8UnormSrgb } else { bevy::render::render_resource::TextureFormat::Rgba8Unorm },
                RenderAssetUsages::RENDER_WORLD,
            );
            image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor { address_mode_u: ImageAddressMode::Repeat, address_mode_v: ImageAddressMode::Repeat, anisotropy_clamp: 4, ..ImageSamplerDescriptor::linear() });
            let _ = (CompressedImageFormats::NONE, ImageType::Extension("png"));
            tex.push(Some(assets.add(image)));
        }
    }
    let tex_of = |t: Option<gltf::texture::Info>| t.and_then(|t| tex.get(t.texture().source().index()).cloned().flatten());
    // materiais (um por material do glTF; os "básicos" dos extras são feitos por nó)
    let mut mats: Vec<StandardMaterial> = vec![];
    for m in doc.materials() {
        let pbr = m.pbr_metallic_roughness();
        let c = pbr.base_color_factor();
        let e = m.emissive_factor();
        let unlit = m.unlit();
        let mut sm = StandardMaterial {
            base_color: Color::LinearRgba(LinearRgba::new(c[0], c[1], c[2], c[3])),
            base_color_texture: tex_of(pbr.base_color_texture()),
            metallic: pbr.metallic_factor(),
            perceptual_roughness: pbr.roughness_factor(),
            metallic_roughness_texture: tex_of(pbr.metallic_roughness_texture()),
            normal_map_texture: m.normal_texture().and_then(|t| tex.get(t.texture().source().index()).cloned().flatten()),
            emissive: LinearRgba::rgb(e[0], e[1], e[2]),
            emissive_texture: tex_of(m.emissive_texture()),
            unlit,
            double_sided: m.double_sided(),
            cull_mode: if m.double_sided() { None } else { Some(bevy::render::render_resource::Face::Back) },
            ..default()
        };
        sm.alpha_mode = match m.alpha_mode() {
            gltf::material::AlphaMode::Blend => AlphaMode::Blend,
            gltf::material::AlphaMode::Mask => AlphaMode::Mask(m.alpha_cutoff().unwrap_or(0.5)),
            _ => AlphaMode::Opaque,
        };
        mats.push(sm);
    }
    let default_mat = StandardMaterial::default();
    // nós
    let mut nodes = vec![];
    for n in doc.nodes() {
        let (t, r, s) = n.transform().decomposed();
        let transform = Transform { translation: Vec3::from(t), rotation: Quat::from_array(r), scale: Vec3::from(s) };
        let extra = extra_mat(n.extras());
        let mut prims = vec![];
        if let Some(mesh) = n.mesh() {
            for p in mesh.primitives() {
                let r = p.reader(|b| Some(&buffers[b.index()]));
                let Some(pos) = r.read_positions() else { continue };
                let pos: Vec<Vec3> = pos.map(Vec3::from).collect();
                let nor: Vec<Vec3> = r.read_normals().map(|i| i.map(Vec3::from).collect()).unwrap_or_else(|| vec![Vec3::Y; pos.len()]);
                let uv: Vec<Vec2> = r.read_tex_coords(0).map(|i| i.into_f32().map(Vec2::from).collect()).unwrap_or_else(|| vec![Vec2::ZERO; pos.len()]);
                let idx: Vec<u32> = r.read_indices().map(|i| i.into_u32().collect()).unwrap_or_else(|| (0..pos.len() as u32).collect());
                use gltf::mesh::Mode;
                let mut mesh = match p.mode() {
                    Mode::Triangles => {
                        let mut geo = Geo { pos, nor, uv, idx };
                        if r.read_normals().is_none() {
                            geo = geo.compute_normals();
                        }
                        geo.mesh()
                    }
                    // linhas (LineSegments do three.js): viram uma lista de segmentos
                    Mode::Lines | Mode::LineStrip | Mode::LineLoop => {
                        let mut li: Vec<u32> = match p.mode() {
                            Mode::Lines => idx.clone(),
                            _ => idx.windows(2).flat_map(|w| [w[0], w[1]]).collect(),
                        };
                        if p.mode() == Mode::LineLoop && idx.len() > 2 {
                            li.extend([idx[idx.len() - 1], idx[0]]);
                        }
                        Mesh::new(bevy::mesh::PrimitiveTopology::LineList, RenderAssetUsages::default())
                            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
                            .with_inserted_indices(bevy::mesh::Indices::U32(li))
                    }
                    // pontos (Points): ainda não desenhados
                    _ => continue,
                };
                if let Some(colors) = r.read_colors(0) {
                    let c: Vec<[f32; 4]> = colors.into_rgba_f32().collect();
                    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, c);
                }
                let mut sm = p.material().index().and_then(|i| mats.get(i).cloned()).unwrap_or_else(|| default_mat.clone());
                if let Some(x) = &extra {
                    apply_extra(&mut sm, x, untone);
                }
                let mh = ecs.resource_mut::<Assets<Mesh>>().add(mesh);
                let math = ecs.resource_mut::<Assets<StandardMaterial>>().add(sm);
                let mname = p.material().name().unwrap_or("").to_string();
                prims.push((mh, math, mname));
            }
        }
        let extras = n.extras().as_ref().and_then(|x| serde_json::from_str(x.get()).ok()).unwrap_or(serde_json::Value::Null);
        nodes.push(NodeDef { name: n.name().unwrap_or("").to_string(), transform, prims, children: n.children().map(|c| c.index()).collect(), extras });
    }
    let roots: Vec<usize> = doc.scenes().next().map(|s| s.nodes().map(|n| n.index()).collect()).unwrap_or_default();
    let extras = roots
        .first()
        .and_then(|&r| doc.nodes().nth(r))
        .and_then(|n| n.extras().as_ref().and_then(|x| serde_json::from_str(x.get()).ok()))
        .unwrap_or(serde_json::Value::Null);
    Some(Model { nodes, roots, extras })
}

/// os extras de material do jogo web: básico (sem luz, cor linear até acima de 1), transparência...
fn apply_extra(sm: &mut StandardMaterial, x: &serde_json::Value, untone: bool) {
    if x.get("basic").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let Some(c) = x.get("color").and_then(|v| v.as_array()) {
            let f = |i: usize| c.get(i).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let a = sm.base_color.alpha();
            let mut c = LinearRgba::new(f(0), f(1), f(2), a);
            // (fora da curva de tom na versão web)
            if untone && x.get("toneMapped").and_then(|v| v.as_bool()) == Some(false) {
                c = crate::mats::untonemap(c);
            }
            sm.base_color = Color::LinearRgba(c);
        }
        sm.unlit = true;
    }
    if x.get("transparent").and_then(|v| v.as_bool()).unwrap_or(false) {
        let op = x.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
        sm.base_color.set_alpha(op);
        sm.alpha_mode = if x.get("additive").and_then(|v| v.as_bool()).unwrap_or(false) { AlphaMode::Add } else { AlphaMode::Blend };
    }
    if x.get("doubleSide").and_then(|v| v.as_bool()).unwrap_or(false) {
        sm.double_sided = true;
        sm.cull_mode = None;
    }
    if let Some(k) = x.get("emissiveIntensity").and_then(|v| v.as_f64()) {
        sm.emissive = sm.emissive * k as f32;
    }
}

/// cria uma instância do modelo; devolve a raiz e as peças com nome
pub fn spawn_model(ecs: &mut Ecs, name: &str) -> (Entity, HashMap<String, Entity>) {
    let (root, named, _) = spawn_model_full(ecs, name);
    (root, named)
}

/// como `spawn_model`, e também os materiais com nome (cópias só desta instância, para animar)
pub fn spawn_model_full(ecs: &mut Ecs, name: &str) -> (Entity, HashMap<String, Entity>, HashMap<String, Handle<StandardMaterial>>) {
    if !ecs.resource::<Models>().cache.contains_key(name) {
        let m = load(name, ecs).unwrap_or(Model { nodes: vec![], roots: vec![], extras: serde_json::Value::Null });
        ecs.resource_mut::<Models>().cache.insert(name.to_string(), m);
    }
    let model = ecs.resource::<Models>().cache[name].clone();
    let root = ecs.spawn((Transform::default(), Visibility::default(), Name::new(name.to_string()))).id();
    let mut named = HashMap::new();
    let mut mats: HashMap<String, Handle<StandardMaterial>> = HashMap::new();
    fn rec(ecs: &mut Ecs, m: &Model, i: usize, parent: Entity, named: &mut HashMap<String, Entity>, mats: &mut HashMap<String, Handle<StandardMaterial>>) {
        let n = &m.nodes[i];
        let e = ecs.spawn((n.transform, Visibility::default(), ChildOf(parent))).id();
        if !n.name.is_empty() {
            ecs.entity_mut(e).insert(Name::new(n.name.clone()));
            named.entry(n.name.clone()).or_insert(e);
        }
        for (mesh, mat, mname) in &n.prims {
            let mat = if mname.is_empty() {
                mat.clone()
            } else if let Some(h) = mats.get(mname) {
                h.clone()
            } else {
                let copy = ecs.resource::<Assets<StandardMaterial>>().get(mat).cloned().unwrap_or_default();
                let h = ecs.resource_mut::<Assets<StandardMaterial>>().add(copy);
                mats.insert(mname.clone(), h.clone());
                h
            };
            ecs.spawn((Mesh3d(mesh.clone()), MeshMaterial3d(mat), Transform::default(), ChildOf(e)));
        }
        for &c in &n.children {
            rec(ecs, m, c, e, named, mats);
        }
    }
    for &r in &model.roots {
        rec(ecs, &model, r, root, &mut named, &mut mats);
    }
    (root, named, mats)
}

/// os brilhos (sprites do three.js) do modelo: um quadrado virado para a câmera em cada nó marcado
pub fn attach_sprites(ecs: &mut Ecs, model: &str, parts: &HashMap<String, Entity>) {
    let quad = crate::world::mesh_h(ecs, &crate::geo::plane_geo(1.0, 1.0));
    for (name, &e) in parts {
        let x = node_extras(ecs, model, name);
        if x.get("sprite").is_none() {
            continue;
        }
        let f = |k: &str| x.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
        let m = crate::world::fx_mat(ecs, crate::fx::Fx::new(crate::fx::kind::SPRITE).color(LinearRgba::new(f("cr"), f("cg"), f("cb"), f("opacity").max(0.01))));
        crate::world::put_mesh(ecs, e, quad.clone(), m, Transform::from_scale(Vec3::new(f("sx"), f("sy"), 1.0)));
    }
}

/// extras (userData) de um nó com nome de um modelo já carregado
pub fn node_extras(ecs: &Ecs, model: &str, node: &str) -> serde_json::Value {
    ecs.resource::<Models>().cache.get(model).and_then(|m| m.nodes.iter().find(|n| n.name == node)).map(|n| n.extras.clone()).unwrap_or(serde_json::Value::Null)
}

/// os nomes dos nós de um modelo já carregado
pub fn node_names(ecs: &Ecs, model: &str) -> Vec<String> {
    ecs.resource::<Models>().cache.get(model).map(|m| m.nodes.iter().map(|n| n.name.clone()).filter(|n| !n.is_empty()).collect()).unwrap_or_default()
}

/// extras (userData) da raiz de um modelo já carregado
pub fn model_extras(ecs: &Ecs, name: &str) -> serde_json::Value {
    ecs.resource::<Models>().cache.get(name).map(|m| m.extras.clone()).unwrap_or(serde_json::Value::Null)
}

/// as malhas (diretas) de uma peça, para trocar o material
pub fn meshes_of(ecs: &mut Ecs, e: Entity) -> Vec<Entity> {
    let mut out = vec![];
    let mut stack = vec![e];
    while let Some(x) = stack.pop() {
        if ecs.get::<Mesh3d>(x).is_some() {
            out.push(x);
        }
        if let Some(ch) = ecs.get::<Children>(x) {
            stack.extend(ch.iter());
        }
    }
    out
}

/// dá à peça um material só dela (cópia), para mudar cor sem afetar as outras instâncias
pub fn unique_material(ecs: &mut Ecs, e: Entity) -> Option<Handle<StandardMaterial>> {
    let meshes = meshes_of(ecs, e);
    let first = meshes.first().and_then(|m| ecs.get::<MeshMaterial3d<StandardMaterial>>(*m)).map(|m| m.0.clone())?;
    let copy = ecs.resource::<Assets<StandardMaterial>>().get(&first).cloned()?;
    let h = ecs.resource_mut::<Assets<StandardMaterial>>().add(copy);
    for m in meshes {
        ecs.entity_mut(m).insert(MeshMaterial3d(h.clone()));
    }
    Some(h)
}
