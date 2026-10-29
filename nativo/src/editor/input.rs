//! O editor a cada quadro: pedidos (refazer o mundo, testar, sair, exportar/importar), a câmera
//! voadora, o mouse e o teclado no cenário, e os desenhos (contornos, ligações, alças, grade) com
//! os gizmos do Bevy.

use super::doc::*;
use super::state::*;
use crate::game::Game;
use crate::MainCam;
use bevy::ecs::world::World as Ecs;
use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll, MouseScrollUnit};
use bevy::prelude::*;
use bevy::window::PrimaryWindow;

/// a interface (egui) está usando o mouse/teclado? (escrito pelo painel)
#[derive(Resource, Default)]
pub struct UiFlags {
    pub pointer: bool,
    pub keyboard: bool,
}

/// gizmos do editor: por cima de tudo, só na vista principal
#[derive(Default, Reflect, GizmoConfigGroup)]
pub struct EdGizmos;

pub fn setup_gizmos(mut store: ResMut<GizmoConfigStore>) {
    let (c, _) = store.config_mut::<EdGizmos>();
    c.depth_bias = -1.0;
    c.line.width = 2.0;
    c.render_layers = bevy::camera::visibility::RenderLayers::layer(1);
}

fn color(hex: u32) -> Color {
    Color::srgb_u8((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

impl Game {
    /// abre o editor (o documento `id`, ou um novo)
    pub fn editor_open(&mut self, id: Option<String>) {
        let doc = id.as_deref().and_then(super::store::get).unwrap_or_else(|| {
            let d = Doc::new(&crate::i18n::tl("Novo nível"));
            super::store::save(&d);
            d
        });
        self.editor = Some(Box::new(Editor::new(doc)));
        self.editing = true;
        self.menu = false;
        self.paused = false;
        self.completed = false;
        self.running = false;
    }

    /// os níveis do editor entram na lista de fases (série "mine")
    pub fn refresh_mine(&mut self) {
        self.levels.retain(|l| l.series.as_deref() != Some("mine"));
        for (i, d) in super::store::list().iter().enumerate() {
            self.levels.push(d.compile(i));
        }
    }

    /// o nível do editor como fase: (índice na lista de fases)
    fn editor_level(&mut self) -> Option<usize> {
        let doc = self.editor.as_ref()?.doc.clone();
        let idx = super::store::list().iter().position(|d| d.id == doc.id).unwrap_or(0);
        let def = doc.compile(idx);
        match self.levels.iter().position(|l| l.mine.as_deref() == Some(&doc.id)) {
            Some(i) => {
                self.levels[i] = def;
                Some(i)
            }
            None => {
                self.levels.push(def);
                Some(self.levels.len() - 1)
            }
        }
    }

    /// refaz o mundo a partir do documento (como o host.rebuild da versão web)
    pub fn editor_rebuild(&mut self, ecs: &mut Ecs) {
        let Some(i) = self.editor_level() else { return };
        self.load(ecs, i);
        self.running = false;
        // (o jogo não anda no editor: os modelos dos objetos vão já para o lugar deles)
        self.props.sync(ecs, &self.world.phys, &self.portals);
        self.editor_apply_ceil(ecs);
    }

    /// esconde o que está acima da camada que você edita (o teto)
    pub fn editor_apply_ceil(&mut self, ecs: &mut Ecs) {
        let Some(ed) = self.editor.as_ref() else { return };
        for s in &self.world.solids {
            let (Some(e), Some(_)) = (s.entity, s.cell) else { continue };
            let hide = ed.hidden_cell(s.cell);
            if let Ok(mut x) = ecs.get_entity_mut(e) {
                x.insert(if hide { Visibility::Hidden } else { Visibility::Inherited });
            }
        }
    }

    /// do teste de volta ao editor, com o documento como estava
    pub fn editor_resume(&mut self) {
        if let Some(ed) = self.editor.as_mut() {
            ed.testing = false;
            ed.req.rebuild = true;
            self.editing = true;
            self.menu = false;
            self.paused = false;
            self.completed = false;
            self.running = false;
        }
    }
}

fn mouse_ray(ecs: &mut Ecs) -> Option<(Vec3, Vec3)> {
    let cursor = {
        let mut q = ecs.query_filtered::<&Window, With<PrimaryWindow>>();
        q.single(ecs).ok()?.cursor_position()?
    };
    let mut q = ecs.query_filtered::<(&Camera, &GlobalTransform), With<MainCam>>();
    let (cam, gt) = q.single(ecs).ok()?;
    let r = cam.viewport_to_world(gt, cursor).ok()?;
    Some((r.origin, *r.direction))
}

/// o editor a cada quadro (depois do jogo)
pub fn editor_tick(ecs: &mut Ecs) {
    let dt = ecs.resource::<Time>().delta_secs().min(0.05);
    if !ecs.contains_resource::<UiFlags>() {
        ecs.insert_resource(UiFlags::default());
    }
    // pedidos que vêm do menu
    let open = ecs.resource_mut::<Game>().editor_req.take();
    if let Some(id) = open {
        let mut g = ecs.resource_mut::<Game>();
        g.editor_open(id);
    }
    let (active, testing) = {
        let g = ecs.resource::<Game>();
        (g.editor.is_some() && g.editing, g.editor.as_ref().is_some_and(|e| e.testing))
    };
    if testing {
        // F5 no teste: volta ao editor
        if ecs.resource::<ButtonInput<KeyCode>>().just_pressed(KeyCode::F5) {
            ecs.resource_mut::<Game>().editor_resume();
        }
        return;
    }
    if !active {
        return;
    }
    let flags = ecs.get_resource::<UiFlags>().map(|f| (f.pointer, f.keyboard)).unwrap_or((false, false));
    let keys = ecs.resource::<ButtonInput<KeyCode>>().clone();
    let mouse = ecs.resource::<ButtonInput<MouseButton>>().clone();
    let motion = ecs.resource::<AccumulatedMouseMotion>().delta;
    let scroll = {
        let s = ecs.resource::<AccumulatedMouseScroll>();
        match s.unit {
            MouseScrollUnit::Line => s.delta.y,
            MouseScrollUnit::Pixel => s.delta.y / 40.0,
        }
    };
    let ray = mouse_ray(ecs);
    ecs.resource_scope(|ecs, mut g: Mut<Game>| {
        let g = &mut *g;
        let Some(mut ed) = g.editor.take() else { return };
        // ---- teclado
        let ctrl = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight) || keys.pressed(KeyCode::SuperLeft) || keys.pressed(KeyCode::SuperRight);
        let shift = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
        let rmb = mouse.pressed(MouseButton::Right);
        if keys.just_pressed(KeyCode::F5) {
            ed.req.test = true;
        }
        if !flags.1 {
            let jp = |k| keys.just_pressed(k);
            if ctrl && jp(KeyCode::KeyZ) {
                if shift { ed.do_redo() } else { ed.do_undo() }
            } else if ctrl && jp(KeyCode::KeyY) {
                ed.do_redo();
            } else if ctrl && jp(KeyCode::KeyD) {
                ed.duplicate();
            } else if ctrl && jp(KeyCode::KeyC) {
                ed.copy();
            } else if ctrl && jp(KeyCode::KeyV) {
                ed.paste();
            } else if ctrl && jp(KeyCode::KeyA) {
                if ed.tab == Tab::Items {
                    let ids = ed.doc.items.iter().map(|i| st(i, "id")).collect();
                    ed.select(ids, false);
                }
            } else if ctrl && jp(KeyCode::KeyS) {
                ed.save_now();
            } else if !rmb && !ctrl {
                if jp(KeyCode::Digit1) {
                    ed.set_tab(Tab::Chamber);
                } else if jp(KeyCode::Digit2) {
                    ed.set_tab(Tab::Items);
                } else if jp(KeyCode::PageUp) {
                    let l = ed.layer + 1;
                    ed.set_layer(l);
                } else if jp(KeyCode::PageDown) {
                    let l = ed.layer - 1;
                    ed.set_layer(l);
                } else if jp(KeyCode::KeyF) {
                    ed.focus();
                } else if ed.tab == Tab::Chamber {
                    if jp(KeyCode::KeyA) {
                        ed.build = Build::Add;
                    } else if jp(KeyCode::KeyX) {
                        ed.build = Build::Remove;
                    } else if jp(KeyCode::KeyP) {
                        ed.build = Build::Paint;
                    }
                } else if jp(KeyCode::Delete) || jp(KeyCode::Backspace) {
                    let s = ed.selected.clone();
                    ed.remove_items(s);
                } else if jp(KeyCode::KeyR) {
                    ed.rotate_sel();
                } else if jp(KeyCode::Escape) {
                    if ed.picking.is_some() {
                        ed.picking = None;
                    } else {
                        ed.armed = None;
                        ed.linking = None;
                        ed.select(vec![], false);
                    }
                }
            }
        }
        // ---- câmera: botão direito olha (e WASD voa), o do meio arrasta, a rodinha aproxima
        if rmb {
            ed.cam.yaw -= motion.x * 0.0035;
            ed.cam.pitch = (ed.cam.pitch - motion.y * 0.0035).clamp(-1.55, 1.55);
            if scroll != 0.0 {
                ed.cam.speed = (ed.cam.speed * if scroll > 0.0 { 1.2 } else { 1.0 / 1.2 }).clamp(1.0, 80.0);
                ed.status = crate::i18n::tlv("velocidade de voo {v} m/s", &[("v", format!("{:.0}", ed.cam.speed))]);
            }
            let spd = ed.cam.speed * if shift { 3.0 } else { 1.0 } * dt;
            let f = ed.cam.fwd();
            let r = Quat::from_rotation_y(ed.cam.yaw) * Vec3::X;
            let k = |c| keys.pressed(c);
            if k(KeyCode::KeyW) {
                ed.cam.pos += f * spd;
            }
            if k(KeyCode::KeyS) {
                ed.cam.pos -= f * spd;
            }
            if k(KeyCode::KeyD) {
                ed.cam.pos += r * spd;
            }
            if k(KeyCode::KeyA) {
                ed.cam.pos -= r * spd;
            }
            if k(KeyCode::KeyE) || k(KeyCode::Space) {
                ed.cam.pos.y += spd;
            }
            if k(KeyCode::KeyQ) {
                ed.cam.pos.y -= spd;
            }
        } else if mouse.pressed(MouseButton::Middle) {
            let r = Quat::from_rotation_y(ed.cam.yaw) * Vec3::X;
            ed.cam.pos -= r * motion.x * 0.02 * (ed.cam.speed / 8.0);
            ed.cam.pos.y += motion.y * 0.02 * (ed.cam.speed / 8.0);
        } else if scroll != 0.0 && !flags.0 {
            let f = ed.cam.fwd();
            ed.cam.pos += f * scroll.signum() * (ed.cam.speed * 0.5).max(1.5);
        }
        // ---- mouse no cenário
        if let (Some((o, d)), false) = (ray, flags.0 || rmb) {
            let w = &g.world;
            if mouse.just_pressed(MouseButton::Left) {
                click(&mut ed, w, o, d, shift);
            } else if mouse.pressed(MouseButton::Left) {
                if ed.stroke.is_some() {
                    let t = ed.chamber_target(o, d);
                    ed.apply_chamber(t, shift);
                    if ed.dirty {
                        ed.req.rebuild = true;
                    }
                } else if ed.edge.is_some() {
                    ed.drag_edge(o, d, shift);
                } else if ed.moving.is_some() {
                    ed.move_item(w, o, d);
                }
            }
            if mouse.just_released(MouseButton::Left) {
                ed.end_stroke();
                ed.end_move();
            }
            hover(&mut ed, w, o, d);
        }
        // ---- pedidos que precisam do mundo
        if let Some(t) = ed.save_in.as_mut() {
            *t -= dt;
            if *t <= 0.0 {
                ed.save_now();
            }
        }
        if let Some(v) = ed.req.view.take() {
            ed.view(v);
        }
        if std::mem::take(&mut ed.req.focus) {
            ed.focus();
        }
        if std::mem::take(&mut ed.req.export) {
            ed.save_now();
            let name = super::store::file_name(&ed.doc);
            if let Some(path) = rfd::FileDialog::new().set_file_name(&name).add_filter("nível", &["json"]).save_file() {
                ed.status = match super::store::export_to(&ed.doc, &path) {
                    Ok(_) => crate::i18n::tlv("exportado: {p}", &[("p", path.display().to_string())]),
                    Err(e) => e.to_string(),
                };
            }
        }
        if std::mem::take(&mut ed.req.import) {
            if let Some(path) = rfd::FileDialog::new().add_filter("nível", &["json"]).pick_file() {
                match super::store::import_from(&path) {
                    Ok(d) => {
                        super::store::save(&d);
                        g.toast(&crate::i18n::tlv("“{name}” importado: aparece em Meus níveis.", &[("name", d.name.clone())]));
                        ed = Box::new(Editor::new(d));
                    }
                    Err(e) => g.toast(&crate::i18n::tlv("Não deu para importar: {msg}", &[("msg", e)])),
                }
            }
        }
        if std::mem::take(&mut ed.req.delete) {
            super::store::remove(&ed.doc.id);
            g.editor = None;
            g.editing = false;
            g.refresh_mine();
            g.to_menu();
            return;
        }
        if std::mem::take(&mut ed.req.exit) {
            ed.save_now();
            g.editor = None;
            g.editing = false;
            g.refresh_mine();
            g.to_menu();
            return;
        }
        if std::mem::take(&mut ed.req.test) {
            ed.save_now();
            ed.testing = true;
            ed.req.rebuild = false;
            g.editor = Some(ed);
            if let Some(i) = g.editor_level() {
                g.editing = false;
                g.menu = false;
                g.start_level(i);
            }
            return;
        }
        let rebuild = std::mem::take(&mut ed.req.rebuild);
        g.editor = Some(ed);
        if rebuild {
            g.editor_rebuild(ecs);
        }
        let ed = g.editor.as_ref().unwrap();
        // a câmera do jogo é a do editor
        let tr = Transform::from_translation(ed.cam.pos).with_rotation(ed.cam.rot());
        g.cam = tr;
        let mut q = ecs.query_filtered::<(&mut Transform, &mut Projection), With<MainCam>>();
        if let Ok((mut t, mut p)) = q.single_mut(ecs) {
            *t = tr;
            if let Projection::Perspective(pp) = &mut *p {
                pp.fov = 70f32.to_radians();
                pp.near = 0.05;
            }
        }
    });
    super::tools::update(ecs, dt);
    draw(ecs);
}

/// clique no cenário
pub fn click(ed: &mut Editor, w: &crate::world::GameWorld, o: Vec3, d: Vec3, shift: bool) {
    // escolhendo um ponto para um campo do item (o pouso da placa de lançamento)
    if let Some(pk) = ed.picking.take() {
        if let Some((sp, _)) = ed.surface_at(w, o, d) {
            let p = Vec3::new(ed.snap_to(sp.x, None), r2(sp.y), ed.snap_to(sp.z, None));
            ed.push_undo();
            if let Some(it) = ed.item_mut(&pk.id) {
                set_v3(it, pk.k, p);
                if let Some(m) = pk.mode {
                    it.insert("mode".into(), serde_json::json!(m));
                }
            }
            ed.changed();
            ed.status = crate::i18n::tl("Pouso escolhido.");
        } else {
            ed.picking = Some(pk);
        }
        return;
    }
    if super::tools::click(ed, w, o, d) {
        return;
    }
    if ed.tab == Tab::Chamber {
        ed.stroke = None;
        let t = ed.chamber_target(o, d);
        ed.apply_chamber(t, shift);
        if ed.dirty {
            ed.req.rebuild = true;
        }
        return;
    }
    if ed.armed.is_some() {
        if let Some((sp, sn)) = ed.surface_at(w, o, d) {
            ed.place_armed(sp, sn, shift);
        }
        return;
    }
    // alça de borda?
    if ed.linking.is_none() {
        let best = ed
            .handles()
            .into_iter()
            .filter_map(|(a, _, p, n)| {
                let t = (p - o).dot(d);
                let dist = ((p - o) - d * t).length();
                let size = (p.distance(ed.cam.pos) * 0.022).max(0.12);
                (t > 0.0 && dist < size * 1.8).then_some((t, a, p, n))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        if let Some((_, a, p, n)) = best {
            if ed.start_edge(a, n, p, o, d) {
                return;
            }
        }
    }
    let hit = ed.pick_item(o, d);
    if let Some(from) = ed.linking.take() {
        if let Some(it) = hit.filter(|h| *h != from) {
            ed.status = crate::i18n::tl(if ed.link(&from, &it) { "Ligado." } else { "Esses dois não se ligam (um precisa ser botão/receptor, o outro uma porta, plataforma, funil, laser ou grade)." });
        }
        ed.version += 1;
        return;
    }
    match hit {
        Some(id) => {
            let was = ed.selected.contains(&id);
            ed.select(vec![id.clone()], shift);
            if was && !shift && ed.selected.len() == 1 {
                ed.moving = Some(Moving { id, undone: false, moved: false });
            }
        }
        None if !shift => ed.select(vec![], false),
        None => {}
    }
}

/// o que fica embaixo do mouse: a célula/face da construção, o fantasma do item armado
fn hover(ed: &mut Editor, w: &crate::world::GameWorld, o: Vec3, d: Vec3) {
    ed.hover = None;
    ed.ghost = None;
    ed.pick_preview = None;
    if ed.picking.is_some() {
        if let Some((sp, _)) = ed.surface_at(w, o, d) {
            let p = Vec3::new(ed.snap_to(sp.x, None), r2(sp.y), ed.snap_to(sp.z, None));
            ed.pick_preview = Some(p);
            ed.status = crate::i18n::tlv("Pouso em {p}", &[("p", format!("{}; {}; {}", crate::i18n::num(p.x, 2), crate::i18n::num(p.y, 2), crate::i18n::num(p.z, 2)))]);
        }
        return;
    }
    if ed.tab == Tab::Chamber {
        ed.hover = ed.chamber_target(o, d);
        if let Some(t) = ed.hover {
            let c = format!("{}, {}, {}", t.cell[0], t.cell[1], t.cell[2]);
            ed.status = match (ed.build, t.face) {
                (Build::Paint, Some(f)) => crate::i18n::tlv("Face {f} da célula {c}", &[("f", crate::i18n::tl(["leste", "oeste", "teto", "chão", "sul", "norte"][f])), ("c", c)]),
                _ => crate::i18n::tlv("Célula {c} (andar {n})", &[("c", c), ("n", (t.cell[1] + 1).to_string())]),
            };
        }
        return;
    }
    if let Some(t) = ed.armed {
        if let Some((sp, sn)) = ed.surface_at(w, o, d) {
            let (p, extra) = ed.placement_for(t, sp, sn, ed.arm_rot);
            let e = elem(t).unwrap();
            let mut tmp = serde_json::Map::new();
            tmp.insert("type".into(), serde_json::json!(t));
            tmp.insert("p".into(), serde_json::json!([p.x, p.y, p.z]));
            let s = extra.get("s").cloned().or_else(|| e.size.map(|s| serde_json::json!(s)));
            if let Some(s) = s {
                tmp.insert("s".into(), s);
            }
            tmp.insert("r".into(), serde_json::json!([0, 0, 0]));
            tmp.insert("yaw".into(), extra.get("yaw").cloned().unwrap_or(serde_json::json!(0)));
            let (c, h, q) = obb_of(&tmp);
            ed.ghost = Some((c, h, q, e.color));
            ed.status = crate::i18n::tlv("{label} em {p} — clique para pôr · R gira · Esc cancela", &[("label", crate::i18n::tl(e.label)), ("p", format!("{}, {}, {}", p.x, p.y, p.z))]);
        }
    }
    // alça sob o mouse (fica maior)
    ed.hot_handle = ed
        .handles()
        .into_iter()
        .enumerate()
        .filter_map(|(i, (_, _, p, _))| {
            let t = (p - o).dot(d);
            let dist = ((p - o) - d * t).length();
            let size = (p.distance(ed.cam.pos) * 0.022).max(0.12);
            (t > 0.0 && dist < size * 1.8).then_some((i, t))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1));
}

fn hue(s: &str) -> f32 {
    let mut h: u32 = 0;
    for c in s.chars() {
        h = (h * 31 + c as u32) % 360;
    }
    h as f32
}

/// contornos, ligações, alças, fantasma, grade
fn draw(ecs: &mut Ecs) {
    let shapes: Vec<(Vec3, Vec3, Quat, Color)> = {
        let g = ecs.resource::<Game>();
        let Some(ed) = g.editor.as_ref() else { return };
        let mut out = vec![];
        let sel: std::collections::HashSet<&String> = ed.selected.iter().collect();
        for it in &ed.doc.items {
            let t = st(it, "type");
            let e = elem(&t).unwrap();
            let (c, h, q) = obb_of(it);
            let id = st(it, "id");
            if sel.contains(&id) {
                out.push((c, h, q, color(if ed.linking.as_deref() == Some(id.as_str()) { 0x66ff99 } else { 0xffd84a })));
            } else if ["spawn", "trigger", "gravzone", "light", "portal"].contains(&t.as_str()) {
                out.push((c, h, q, color(e.color)));
            }
        }
        if let Some((c, h, q, col)) = ed.ghost {
            out.push((c, h, q, color(col)));
        }
        out
    };
    let (layer, cam, hover, build, paint, handles, hot, picks, links, spawn_arrows, targets) = {
        let g = ecs.resource::<Game>();
        let ed = g.editor.as_ref().unwrap();
        // ligações de sinal: de quem liga (opens) para quem é ligado (sig, power, id)
        let mut src: std::collections::HashMap<String, Vec<Vec3>> = Default::default();
        let mut dst: std::collections::HashMap<String, Vec<Vec3>> = Default::default();
        for it in &ed.doc.items {
            let e = elem(&st(it, "type")).unwrap();
            for k in SIG_KEYS {
                let v = st(it, k);
                if v.is_empty() || !e.params.iter().any(|p| p.k == k && p.t == PT::Sig) {
                    continue;
                }
                let m = if k == "opens" { &mut src } else { &mut dst };
                m.entry(v).or_default().push(obb_of(it).0);
            }
        }
        let mut links = vec![];
        for (name, from) in &src {
            for a in from {
                for b in dst.get(name).cloned().unwrap_or_default() {
                    links.push((*a, b, Color::hsl(hue(name), 0.9, 0.62)));
                }
            }
        }
        let arrows: Vec<(Vec3, Vec3)> = ed
            .doc
            .items
            .iter()
            .filter(|i| st(i, "type") == "spawn")
            .map(|i| {
                let yaw = f(i, "yaw").to_radians();
                let fw = Vec3::new(-yaw.sin(), 0.0, -yaw.cos());
                let p = v3(i, "p") + Vec3::Y * 1.1;
                (p, p + fw * 1.2)
            })
            .collect();
        let targets: Vec<Vec3> = ed.doc.items.iter().filter(|i| st(i, "type") == "plate" && st(i, "mode") == "alvo").map(|i| v3(i, "target")).collect();
        (ed.layer, ed.cam.clone(), ed.hover, ed.build, ed.paint.clone(), ed.handles(), ed.hot_handle.map(|h| h.0), ed.pick_preview, links, arrows, targets)
    };
    let tool_lines = super::tools::lines(ecs);
    // (os gizmos são desenhados pelo sistema `draw_gizmos`, que lê esta lista)
    if !ecs.contains_resource::<EdDraw>() {
        ecs.insert_resource(EdDraw::default());
    }
    let mut list = ecs.resource_mut::<EdDraw>();
    list.boxes = shapes;
    list.links = links;
    list.layer = layer;
    list.cam = cam.pos;
    list.hover = hover.map(|t| (t, build, paint));
    list.handles = handles.iter().enumerate().map(|(i, (a, _, p, _))| (*p, *a, Some(i) == hot)).collect();
    list.pick = picks;
    list.arrows = spawn_arrows;
    list.targets = targets;
    list.tools = tool_lines;
}

/// o que desenhar neste quadro (preenchido por `editor_tick`)
#[derive(Resource, Default)]
pub struct EdDraw {
    pub boxes: Vec<(Vec3, Vec3, Quat, Color)>,
    pub links: Vec<(Vec3, Vec3, Color)>,
    pub layer: i32,
    pub cam: Vec3,
    pub hover: Option<(Target, Build, String)>,
    pub handles: Vec<(Vec3, usize, bool)>,
    pub pick: Option<Vec3>,
    pub arrows: Vec<(Vec3, Vec3)>,
    pub targets: Vec<Vec3>,
    pub tools: Vec<(Vec3, Vec3, Color)>,
}

pub fn draw_gizmos(mut gz: Gizmos<EdGizmos>, list: Res<EdDraw>, game: Res<Game>) {
    if !game.editing || game.editor.is_none() {
        return;
    }
    // grade: uma linha por célula, no chão do andar
    let gx = (list.cam.x / CELL).round() * CELL - CELL / 2.0;
    let gzz = (list.cam.z / CELL).round() * CELL - CELL / 2.0;
    let y = list.layer as f32 * CELL + 0.01;
    gz.grid(Isometry3d::new(Vec3::new(gx, y, gzz), Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)), UVec2::splat(30), Vec2::splat(CELL), Color::srgba(0.29, 0.42, 0.54, 0.35));
    for (c, h, q, col) in &list.boxes {
        gz.cube(Transform::from_translation(*c).with_rotation(*q).with_scale(*h * 2.0), *col);
    }
    for (a, b, col) in &list.links {
        // tracejado
        let d = *b - *a;
        let n = (d.length() / 0.65).ceil().max(1.0) as usize;
        for i in 0..n {
            let t0 = i as f32 / n as f32;
            let t1 = (i as f32 + 0.6) / n as f32;
            gz.line(*a + d * t0, *a + d * t1.min(1.0), *col);
        }
    }
    for (a, b) in &list.arrows {
        gz.arrow(*a, *b, color(0x66ff99));
    }
    for p in &list.targets {
        gz.circle(Isometry3d::new(*p + Vec3::Y * 0.03, Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)), 0.7, color(0x66d9ff));
    }
    if let Some(p) = list.pick {
        gz.circle(Isometry3d::new(p + Vec3::Y * 0.03, Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)), 0.7, color(0x66ff99));
    }
    for (p, a, hot) in &list.handles {
        let s = (p.distance(list.cam) * 0.022).max(0.12) * if *hot { 1.5 } else { 1.0 };
        let col = [0xff5a5a, 0x6aff6a, 0x5aa8ff][*a];
        gz.cube(Transform::from_translation(*p).with_scale(Vec3::splat(s)), color(col));
    }
    if let Some((t, build, paint)) = &list.hover {
        let col = match build {
            Build::Add => 0x4cff8a,
            Build::Remove => 0xff5050,
            Build::Paint => match paint.as_str() {
                "white" => 0xffffff,
                "glass" => 0x9fd8ff,
                _ => 0xffb347,
            },
        };
        let m = cell_min(t.cell);
        let c = m + Vec3::splat(CELL / 2.0);
        match (build, t.face) {
            (Build::Paint, Some(f)) => {
                let d = FACE_DIRS[f];
                let n = Vec3::new(d[0] as f32, d[1] as f32, d[2] as f32);
                let q = Quat::from_rotation_arc(Vec3::Z, n);
                gz.rect(Isometry3d::new(c + n * (CELL / 2.0), q), Vec2::splat(CELL), color(col));
                gz.rect(Isometry3d::new(c + n * (CELL / 2.0 - 0.02), q), Vec2::splat(CELL * 0.9), color(col));
            }
            _ => gz.cube(Transform::from_translation(c).with_scale(Vec3::splat(CELL)), color(col)),
        }
    }
    for (a, b, col) in &list.tools {
        gz.line(*a, *b, *col);
    }
}
