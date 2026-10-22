//! A interface do editor (egui): barra de cima (nome, abas, desfazer, testar, vistas, andar,
//! ferramentas, exportar), paleta à esquerda, propriedades à direita e a linha de status embaixo.

use super::doc::*;
use super::input::UiFlags;
use super::state::*;
use crate::game::Game;
use crate::i18n::{tl, tlv};
use bevy::ecs::world::World as Ecs;
use bevy::prelude::*;
use bevy_egui::{egui, EguiContext, PrimaryEguiContext};
use serde_json::{json, Value};

const MOODS: [(&str, &str); 3] = [("lab", "Laboratório"), ("labTense", "Tensa"), ("labEpic", "Épica")];
const TRACKS: [(&str, &str, &str); 10] = [
    ("lab", "sector", "Sector"),
    ("lab", "pulse", "Pulse"),
    ("lab", "airy", "Airy"),
    ("labTense", "urgent", "Urgent"),
    ("labTense", "depths", "Depths"),
    ("labTense", "infestation", "Infestation"),
    ("labTense", "searching", "Searching"),
    ("labEpic", "menacing", "Menacing Otherworld"),
    ("labEpic", "surreal", "Surreal"),
    ("labEpic", "transmission", "Transmission"),
];

fn music_options() -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = MOODS.iter().map(|(m, n)| (m.to_string(), tlv("{m} (sorteia as faixas)", &[("m", tl(n))]))).collect();
    for (m, id, n) in TRACKS {
        let mood = MOODS.iter().find(|x| x.0 == m).map(|x| tl(x.1).to_lowercase()).unwrap_or_default();
        v.push((format!("faixa:{id}"), tlv("Só \"{n}\" ({m})", &[("n", n.into()), ("m", mood)])));
    }
    v
}

fn c32(hex: u32) -> egui::Color32 {
    egui::Color32::from_rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

/// o contexto do egui fica na câmera de cima (a da arma) enquanto o editor está aberto
pub fn attach_context(ecs: &mut Ecs) {
    let want = {
        let g = ecs.resource::<Game>();
        g.editing || g.menu || g.mp()
    };
    let Some(cam) = ecs.get_resource::<crate::gun::Gun>().map(|g| g.cam) else { return };
    let has = ecs.get::<PrimaryEguiContext>(cam).is_some();
    if want && !has {
        ecs.entity_mut(cam).insert(PrimaryEguiContext);
    }
}

/// as fontes do jogo na interface do editor (IBM Plex; Inter tem os números em círculo); as do
/// egui ficam por último para os símbolos
fn set_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    let dir = crate::mats::asset_dir().join("fonts");
    let mut names = vec![];
    for (k, f) in [("plex", "IBMPlexSans.ttf"), ("inter", "Inter.ttf")] {
        if let Ok(b) = std::fs::read(dir.join(f)) {
            fonts.font_data.insert(k.into(), std::sync::Arc::new(egui::FontData::from_owned(b)));
            names.push(k.to_string());
        }
    }
    if let Some(list) = fonts.families.get_mut(&egui::FontFamily::Proportional) {
        for (i, n) in names.into_iter().enumerate() {
            list.insert(i, n);
        }
    }
    ctx.set_fonts(fonts);
    ctx.set_visuals(egui::Visuals::dark());
}

/// a interface do editor (no passo do egui)
pub fn editor_ui(ecs: &mut Ecs, mut fonts_set: Local<bool>) {
    let ctx = {
        let mut q = ecs.query::<&mut EguiContext>();
        let Some(mut c) = q.iter_mut(ecs).next() else { return };
        c.get_mut().clone()
    };
    if !*fonts_set {
        *fonts_set = true;
        set_fonts(&ctx);
    }
    let editing = ecs.resource::<Game>().editing && ecs.resource::<Game>().editor.is_some();
    if !editing {
        if let Some(mut f) = ecs.get_resource_mut::<UiFlags>() {
            f.pointer = false;
            f.keyboard = false;
        }
        multiplayer_ui(ecs, &ctx);
        return;
    }
    ecs.resource_scope(|_ecs, mut g: Mut<Game>| {
        let g = &mut *g;
        let Some(ed) = g.editor.as_mut() else { return };
        let mut root = egui::Ui::new(ctx.clone(), "editor".into(), egui::UiBuilder::new().layer_id(egui::LayerId::background()).max_rect(ctx.viewport_rect()));
        egui::Panel::top("ed-top").show(&mut root, |ui| top_bar(ui, ed));
        egui::Panel::bottom("ed-bottom").show(&mut root, |ui| {
            ui.horizontal(|ui| {
                ui.label(&ed.status);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| ui.weak(hint(ed)));
            });
        });
        egui::Panel::left("ed-left").resizable(false).default_size(210.0).show(&mut root, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| palette(ui, ed));
        });
        egui::Panel::right("ed-right").resizable(false).default_size(280.0).show(&mut root, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| {
                super::tools::panel(ui, ed);
                props(ui, ed);
            });
        });
    });
    let (p, k) = (ctx.is_pointer_over_egui() || ctx.egui_wants_pointer_input(), ctx.egui_wants_keyboard_input());
    if let Some(mut f) = ecs.get_resource_mut::<UiFlags>() {
        f.pointer = p;
        f.keyboard = k;
    }
}

fn hint(ed: &Editor) -> String {
    if ed.tab == Tab::Chamber {
        let what = match ed.build {
            Build::Paint => "pinta (Shift = toda a parede)",
            Build::Add => "abre células",
            Build::Remove => "fecha células",
        };
        format!("{}{}{}", tl("clique/arraste: "), tl(what), tl(" · A adiciona · X remove · P pinta · PgUp/PgDn muda de andar"))
    } else {
        tl("arraste para mover · arraste as alças coloridas para mexer só uma borda (Shift: as duas) · R gira 90° · Del apaga · Ctrl+D duplica · botão direito + WASD voa · F foca")
    }
}

fn top_bar(ui: &mut egui::Ui, ed: &mut Editor) {
    ui.horizontal_wrapped(|ui| {
        if ui.button(tl("← Menu")).on_hover_text(tl("Salvar e voltar ao menu")).clicked() {
            ed.req.exit = true;
        }
        let mut name = ed.doc.name.clone();
        let r = ui.add(egui::TextEdit::singleline(&mut name).desired_width(170.0).char_limit(60));
        if r.changed() {
            ed.doc.name = name;
        }
        if r.lost_focus() {
            ed.push_undo();
            if ed.doc.name.trim().is_empty() {
                ed.doc.name = tl("Sem nome");
            }
            ed.changed();
        }
        ui.separator();
        if ui.selectable_label(ed.tab == Tab::Chamber, tl("① Câmara")).on_hover_text(tl("Abrir células, fechar e pintar (1)")).clicked() {
            ed.set_tab(Tab::Chamber);
        }
        if ui.selectable_label(ed.tab == Tab::Items, tl("② Itens")).on_hover_text(tl("Colocar botões, portas, lasers… (2)")).clicked() {
            ed.set_tab(Tab::Items);
        }
        ui.separator();
        if ui.add_enabled(!ed.undo.is_empty(), egui::Button::new("↶")).on_hover_text(tl("Desfazer (Ctrl+Z)")).clicked() {
            ed.do_undo();
        }
        if ui.add_enabled(!ed.redo.is_empty(), egui::Button::new("↷")).on_hover_text(tl("Refazer (Ctrl+Y)")).clicked() {
            ed.do_redo();
        }
        if ui.button(egui::RichText::new(tl("▶ Testar")).color(egui::Color32::from_rgb(102, 255, 153))).on_hover_text(tl("Jogar este nível (F5)")).clicked() {
            ed.req.test = true;
        }
        ui.separator();
        if ui.button(tl("Persp.")).on_hover_text(tl("Vista livre")).clicked() {
            ed.req.view = Some("persp");
        }
        if ui.button(tl("Cima")).on_hover_text(tl("Vista de cima")).clicked() {
            ed.req.view = Some("top");
        }
        ui.label(tl("Andar"));
        if ui.button("−").on_hover_text(tl("Camada de baixo (PageDown)")).clicked() {
            let l = ed.layer - 1;
            ed.set_layer(l);
        }
        ui.label((ed.layer + 1).to_string());
        if ui.button("+").on_hover_text(tl("Camada de cima (PageUp)")).clicked() {
            let l = ed.layer + 1;
            ed.set_layer(l);
        }
        if ui.selectable_label(ed.hide_ceil, tl("Teto")).on_hover_text(tl("Esconde o que está acima da camada")).clicked() {
            ed.hide_ceil = !ed.hide_ceil;
            ed.req.rebuild = true;
        }
        ui.separator();
        for (t, label, title) in [(Tool::Measure, "Régua", "Medir distâncias"), (Tool::Traj, "Trajetória", "Ver o arco de um lançamento"), (Tool::Reach, "Alcance", "O que o jogador alcança"), (Tool::Validate, "Validar", "Procurar problemas"), (Tool::Bot, "Robô", "Prova gravada")] {
            if ui.selectable_label(ed.tool == Some(t), tl(label)).on_hover_text(tl(title)).clicked() {
                super::tools::set_tool(ed, t);
            }
        }
        ui.separator();
        ui.label(tl("Grade"));
        egui::ComboBox::from_id_salt("snap").selected_text(format!("{} m", crate::i18n::num(ed.snap, 2))).width(70.0).show_ui(ui, |ui| {
            for s in SNAPS {
                ui.selectable_value(&mut ed.snap, s, format!("{} m", crate::i18n::num(s, 2)));
            }
        });
        ui.weak(&ed.saved);
        if ui.button(tl("Exportar")).on_hover_text(tl("Gravar como arquivo .json")).clicked() {
            ed.req.export = true;
        }
    });
}

fn palette(ui: &mut egui::Ui, ed: &mut Editor) {
    if ed.tab == Tab::Chamber {
        ui.strong(tl("Câmara"));
        for (b, label, title) in [(Build::Add, "＋ Abrir células", "Abre a célula apontada (A)"), (Build::Remove, "− Fechar células", "Enche a célula apontada (X)"), (Build::Paint, "🎨 Pintar faces", "Pinta a parede, o chão ou o teto apontado (P)")] {
            if ui.selectable_label(ed.build == b, tl(label)).on_hover_text(tl(title)).clicked() {
                ed.build = b;
            }
        }
        if ed.build == Build::Paint {
            ui.add_space(6.0);
            ui.strong(tl("Tinta"));
            for (k, label) in PAINTS {
                if ui.selectable_label(ed.paint == k, tl(label)).clicked() {
                    ed.paint = k.into();
                }
            }
        }
        ui.add_space(6.0);
        ui.strong(tl("Dicas"));
        ui.label(egui::RichText::new(tl("Cada célula tem 4 m. Em cima você enxerga de fora porque o teto some; “Andar” escolhe em que altura você desenha. Branco aceita portal, preto/metal não.")).small());
        return;
    }
    for g in GROUPS {
        ui.add_space(4.0);
        ui.strong(tl(g));
        for e in elements().iter().filter(|e| e.group == g) {
            let on = ed.armed == Some(e.key);
            let r = ui.horizontal(|ui| {
                let (rect, _) = ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
                ui.painter().rect_filled(rect, 2.0, c32(e.color));
                ui.selectable_label(on, tl(e.label))
            });
            if r.inner.clicked() {
                ed.armed = if on { None } else { Some(e.key) };
                ed.arm_rot = 0;
                ed.select(vec![], false);
                ed.status = if ed.armed.is_some() { tlv("{label}: clique no cenário para colocar", &[("label", tl(e.label))]) } else { String::new() };
            }
        }
    }
}

/// campo de número que grava no fim da edição
fn num_field(ui: &mut egui::Ui, v: &mut f32, step: f32) -> bool {
    let r = ui.add(egui::DragValue::new(v).speed(step.max(0.01)).max_decimals(2));
    r.drag_stopped() || (r.changed() && !r.dragged())
}

fn props(ui: &mut egui::Ui, ed: &mut Editor) {
    if ed.selected.is_empty() {
        level_panel(ui, ed);
        return;
    }
    if ed.selected.len() > 1 {
        ui.heading(tlv("{n} itens", &[("n", ed.selected.len().to_string())]));
        if ui.button(tl("Duplicar (Ctrl+D)")).clicked() {
            ed.duplicate();
        }
        if ui.button(tl("Apagar (Del)")).clicked() {
            let s = ed.selected.clone();
            ed.remove_items(s);
        }
        return;
    }
    let id = ed.selected[0].clone();
    let Some(it) = ed.item(&id).cloned() else { return };
    let e = elem(&st(&it, "type")).unwrap();
    ui.heading(tl(e.label));
    let snap = ed.snap;
    // posição, tamanho, giro
    let vec_row = |ui: &mut egui::Ui, ed: &mut Editor, label: &str, k: &str, step: f32, min: Option<f32>| {
        let mut v = v3(&it, k);
        ui.label(tl(label));
        let mut done = false;
        ui.horizontal(|ui| {
            for i in 0..3 {
                done |= num_field(ui, &mut v[i], step);
            }
        });
        if done {
            if let Some(m) = min {
                v = v.max(Vec3::splat(m));
            }
            ed.push_undo();
            set_v3(ed.item_mut(&id).unwrap(), k, v);
            ed.changed();
        }
    };
    vec_row(ui, ed, "Posição", "p", snap, None);
    if it.contains_key("s") {
        vec_row(ui, ed, "Tamanho", "s", snap, Some(0.05));
    }
    if it.contains_key("r") {
        vec_row(ui, ed, "Rotação (°)", "r", 5.0, None);
    }
    if e.rot == Rot::Yaw {
        let mut y = f(&it, "yaw");
        ui.horizontal(|ui| {
            ui.label(tl("Giro (°)"));
            if num_field(ui, &mut y, 5.0) {
                ed.push_undo();
                ed.item_mut(&id).unwrap().insert("yaw".into(), json!(y));
                ed.changed();
            }
        });
    }
    connections(ui, ed, &id);
    for p in &e.params {
        field(ui, ed, &id, p);
    }
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        if ui.button(tl("Girar 90° (R)")).clicked() {
            ed.rotate_sel();
        }
        if ui.button(tl("Duplicar")).clicked() {
            ed.duplicate();
        }
        if ui.button(egui::RichText::new(tl("Apagar")).color(egui::Color32::from_rgb(255, 110, 110))).clicked() {
            ed.remove_items(vec![id.clone()]);
        }
    });
}

fn set(ed: &mut Editor, id: &str, k: &str, v: Value) {
    ed.push_undo();
    if let Some(it) = ed.item_mut(id) {
        it.insert(k.into(), v);
    }
    ed.changed();
}

fn field(ui: &mut egui::Ui, ed: &mut Editor, id: &str, p: &Param) {
    let Some(it) = ed.item(id).cloned() else { return };
    match p.t {
        PT::Sig => {} // (na seção "Ligações")
        PT::Bool => {
            let mut b = bo(&it, p.k);
            if ui.checkbox(&mut b, tl(p.label)).changed() {
                set(ed, id, p.k, json!(b));
            }
        }
        PT::Select => {
            let cur = st(&it, p.k);
            let shown = p.o.iter().find(|o| o.0 == cur).map(|o| tl(o.1)).unwrap_or(cur.clone());
            ui.label(tl(p.label));
            let mut pick = None;
            egui::ComboBox::from_id_salt((id, p.k)).selected_text(shown).width(230.0).show_ui(ui, |ui| {
                for (v, l) in p.o {
                    if ui.selectable_label(*v == cur, tl(l)).clicked() {
                        pick = Some(*v);
                    }
                }
            });
            if let Some(v) = pick {
                set(ed, id, p.k, json!(v));
            }
        }
        PT::Color => {
            let s = st(&it, p.k);
            let n = u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(0xffffff);
            let mut rgb = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
            ui.horizontal(|ui| {
                ui.label(tl(p.label));
                if ui.color_edit_button_srgb(&mut rgb).changed() {
                    set(ed, id, p.k, json!(format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])));
                }
            });
        }
        PT::V3 => {
            let mut v = v3(&it, p.k);
            ui.label(tl(p.label));
            let mut done = false;
            ui.horizontal(|ui| {
                for i in 0..3 {
                    done |= num_field(ui, &mut v[i], 0.5);
                }
            });
            if done {
                ed.push_undo();
                set_v3(ed.item_mut(id).unwrap(), p.k, v);
                ed.changed();
            }
            if let Some(mode) = p.pick {
                let on = ed.picking.as_ref().is_some_and(|x| x.id == id && x.k == p.k);
                let label = if on { tl("Clique no cenário… (Esc cancela)") } else { tl("◎ Escolher no cenário") };
                if ui.selectable_label(on, label).clicked() {
                    ed.picking = if on { None } else { Some(Picking { id: id.to_string(), k: p.k, mode: Some(mode) }) };
                    ed.status = if on { String::new() } else { tl("Clique no lugar onde quer que caia") };
                }
            }
        }
        PT::Text => {
            let mut s = st(&it, p.k);
            ui.label(tl(p.label));
            let r = ui.add(egui::TextEdit::singleline(&mut s).char_limit(120));
            if r.changed() {
                ed.item_mut(id).unwrap().insert(p.k.into(), json!(s));
            }
            if r.lost_focus() {
                ed.push_undo();
                ed.changed();
            }
        }
        PT::Num => {
            let mut v = fo(&it, p.k).unwrap_or(0.0);
            let empty = it.get(p.k).is_none_or(|v| v.is_null());
            ui.horizontal(|ui| {
                ui.label(tl(p.label));
                if empty {
                    if ui.small_button("＋").clicked() {
                        set(ed, id, p.k, json!(0));
                    }
                } else {
                    let mut r = ui.add(egui::DragValue::new(&mut v).speed(p.step.unwrap_or(0.1)).max_decimals(2));
                    if let Some(m) = p.min {
                        if v < m {
                            v = m;
                            r.mark_changed();
                        }
                    }
                    if let Some(m) = p.max {
                        v = v.min(m);
                    }
                    if r.drag_stopped() || (r.changed() && !r.dragged()) {
                        set(ed, id, p.k, json!(v));
                    }
                    if p.d.is_null() && ui.small_button("✕").clicked() {
                        set(ed, id, p.k, Value::Null);
                    }
                }
            });
        }
    }
}

/// as ligações do item (de quem liga para quem é ligado), o modo do botão de apertar e "Ligar a…"
fn connections(ui: &mut egui::Ui, ed: &mut Editor, id: &str) {
    let Some(it) = ed.item(id).cloned() else { return };
    let src = Editor::is_source(&it);
    let sk = Editor::sink_key(&it);
    if !src && sk.is_none() {
        return;
    }
    ui.add_space(4.0);
    ui.strong(tl(if src { "Liga" } else { "É ligada por" }));
    let opens = st(&it, "opens");
    let sinks: Vec<_> = if src && !opens.is_empty() { ed.doc.items.iter().filter(|o| st(o, "id") != id && Editor::sink_key(o).is_some_and(|k| st(o, k) == opens)).cloned().collect() } else { vec![] };
    let sources: Vec<_> = match sk.map(|k| st(&it, k)) {
        Some(s) if !s.is_empty() => ed.doc.items.iter().filter(|o| st(o, "id") != id && Editor::is_source(o) && st(o, "opens") == s).cloned().collect(),
        _ => vec![],
    };
    for o in sinks.iter() {
        let oid = st(o, "id");
        ui.horizontal(|ui| {
            if ui.link(format!("→ {}", tl(elem(&st(o, "type")).unwrap().label))).clicked() {
                ed.select(vec![oid.clone()], false);
            }
            if ui.small_button("✕").on_hover_text(tl("Desligar")).clicked() {
                ed.unlink(&oid);
            }
        });
        if is_push(&st(&it, "type")) {
            push_mode(ui, ed, &oid, &it);
        }
    }
    for o in sources.iter() {
        let oid = st(o, "id");
        ui.horizontal(|ui| {
            if ui.link(format!("← {}", tl(elem(&st(o, "type")).unwrap().label))).clicked() {
                ed.select(vec![oid.clone()], false);
            }
            if ui.small_button("✕").on_hover_text(tl("Desligar")).clicked() {
                ed.unlink(id);
            }
        });
        if is_push(&st(o, "type")) {
            push_mode(ui, ed, id, o);
        }
    }
    let on = ed.linking.as_deref() == Some(id);
    if ui.selectable_label(on, if on { tl("Clique no outro item… (Esc cancela)") } else { tl("＋ Ligar a…") }).on_hover_text(tl("Conectar com um botão/receptor ou com uma porta")).clicked() {
        ed.linking = if on { None } else { Some(id.to_string()) };
        ed.status = if on { String::new() } else { tl("Clique no item que será ligado") };
    }
    egui::CollapsingHeader::new(tl("Sinal (avançado)")).id_salt((id, "sig")).show(ui, |ui| {
        for p in elem(&st(&it, "type")).unwrap().params.iter().filter(|p| p.t == PT::Sig) {
            let mut s = st(&it, p.k);
            ui.label(tl(p.label));
            let r = ui.add(egui::TextEdit::singleline(&mut s).char_limit(12));
            if r.changed() {
                ed.item_mut(id).unwrap().insert(p.k.into(), json!(s.trim()));
            }
            if r.lost_focus() {
                ed.push_undo();
                ed.changed();
            }
        }
    });
}

/// como o item ligado reage a um botão de apertar (vazio = o modo do botão)
fn push_mode(ui: &mut egui::Ui, ed: &mut Editor, sink: &str, button: &serde_json::Map<String, Value>) {
    let Some(it) = ed.item(sink).cloned() else { return };
    let cur = st(&it, "pmode");
    let bm = st(button, "mode");
    let def = PUSH_MODES.iter().find(|m| m.0 == if bm.is_empty() { "timer" } else { bm.as_str() }).map(|m| m.1).unwrap_or("");
    let def_label = tlv("Como o botão ({m})", &[("m", tl(def.split(" (").next().unwrap_or(def)).to_lowercase())]);
    ui.label(tl("Ao apertar o botão"));
    let shown = if cur.is_empty() { def_label.clone() } else { PUSH_MODES.iter().find(|m| m.0 == cur).map(|m| tl(m.1)).unwrap_or(cur.clone()) };
    let mut pick: Option<String> = None;
    egui::ComboBox::from_id_salt((sink, "pmode", st(button, "id"))).selected_text(shown).width(230.0).show_ui(ui, |ui| {
        if ui.selectable_label(cur.is_empty(), def_label).clicked() {
            pick = Some(String::new());
        }
        for (v, l) in PUSH_MODES {
            if ui.selectable_label(cur == *v, tl(l)).clicked() {
                pick = Some(v.to_string());
            }
        }
    });
    if let Some(v) = pick {
        ed.push_undo();
        let it = ed.item_mut(sink).unwrap();
        if v.is_empty() {
            it.remove("pmode");
        } else {
            it.insert("pmode".into(), json!(v));
        }
        ed.changed();
    }
    if cur == "timer" {
        let mut t = fo(&it, "ptime").unwrap_or(4.0);
        ui.horizontal(|ui| {
            ui.label(tl("Tempo ligado (s)"));
            if num_field(ui, &mut t, 0.5) {
                set(ed, sink, "ptime", json!(t.max(0.5)));
            }
        });
    }
}

fn level_panel(ui: &mut egui::Ui, ed: &mut Editor) {
    ui.heading(tl("Este nível"));
    let cfg = ed.doc.cfg.clone();
    let s = |k: &str| cfg.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let set_cfg = |ed: &mut Editor, k: &str, v: Value| {
        ed.push_undo();
        ed.doc.cfg.insert(k.into(), v);
        ed.changed();
    };
    ui.label(tl("Objetivo (mostrado na tela)"));
    let mut lesson = s("lesson");
    let r = ui.add(egui::TextEdit::singleline(&mut lesson).char_limit(120));
    if r.changed() {
        ed.doc.cfg.insert("lesson".into(), json!(lesson));
    }
    if r.lost_focus() {
        ed.push_undo();
        ed.changed();
    }
    ui.label(tl("Arma de portais"));
    let gun = s("gun");
    let guns = [("both", "Os dois portais"), ("blue", "Só o ciano"), ("none", "Nenhuma (use o pedestal)")];
    let mut pick = None;
    egui::ComboBox::from_id_salt("gun").selected_text(guns.iter().find(|g| g.0 == gun).map(|g| tl(g.1)).unwrap_or(gun.clone())).width(230.0).show_ui(ui, |ui| {
        for (v, l) in guns {
            if ui.selectable_label(gun == v, tl(l)).clicked() {
                pick = Some(v);
            }
        }
    });
    if let Some(v) = pick {
        set_cfg(ed, "gun", json!(v));
    }
    let mut gr = cfg.get("gravity").and_then(|v| v.as_f64()).unwrap_or(9.8) as f32;
    ui.horizontal(|ui| {
        ui.label(tl("Gravidade (m/s²)"));
        if num_field(ui, &mut gr, 0.1) {
            set_cfg(ed, "gravity", json!(gr.max(0.0)));
        }
    });
    ui.label(tl("Música"));
    let music = if s("music").is_empty() { "lab".to_string() } else { s("music") };
    let opts = music_options();
    let mut pick = None;
    egui::ComboBox::from_id_salt("music").selected_text(opts.iter().find(|o| o.0 == music).map(|o| o.1.clone()).unwrap_or(music.clone())).width(230.0).show_ui(ui, |ui| {
        for (v, l) in &opts {
            if ui.selectable_label(*v == music, l).clicked() {
                pick = Some(v.clone());
            }
        }
    });
    if let Some(v) = pick {
        set_cfg(ed, "music", json!(v));
    }
    let mut al = cfg.get("autoLight").and_then(|v| v.as_bool()) != Some(false);
    if ui.checkbox(&mut al, tl("Luzes de teto automáticas")).changed() {
        set_cfg(ed, "autoLight", json!(al));
    }
    let mut rl = cfg.get("relogio").and_then(|v| v.as_bool()).unwrap_or(false);
    if ui.checkbox(&mut rl, tl("Relógio do tempo (tecla 2, portal temporal)")).changed() {
        set_cfg(ed, "relogio", json!(rl));
    }
    let proof = super::tools::proof_state(&ed.doc);
    ui.label(egui::RichText::new(tlv("{c} células · {n} itens · prova: {p}", &[("c", ed.doc.chamber.open.len().to_string()), ("n", ed.doc.items.len().to_string()), ("p", tl(proof))])).small());
    ui.horizontal(|ui| {
        if ui.button(tl("Importar .json")).clicked() {
            ed.req.import = true;
        }
        if ui.button(egui::RichText::new(tl("Apagar nível")).color(egui::Color32::from_rgb(255, 110, 110))).on_hover_text(tl("Remove do jogo (sem volta)")).double_clicked() {
            ed.req.delete = true;
        }
    });
    ui.label(egui::RichText::new(tl("(dois cliques em “Apagar nível” para apagar de vez)")).small().weak());
}

/// multiplayer: no menu, o painel para entrar numa sala; jogando, quem está na sala
fn multiplayer_ui(ecs: &mut Ecs, ctx: &egui::Context) {
    let mut leave = false;
    {
        let mut g = ecs.resource_mut::<Game>();
        let g = &mut *g;
        if g.menu && !g.completed {
            egui::Window::new(tl("👥 Multiplayer na rede local"))
                .anchor(egui::Align2::RIGHT_BOTTOM, egui::vec2(-16.0, -16.0))
                .resizable(false)
                .collapsible(true)
                .default_open(false)
                .show(ctx, |ui| {
                    ui.label(egui::RichText::new(tl("até 4 pessoas por sala · cada uma com seu par de portais")).small());
                    let on = g.mp.net.is_some();
                    ui.add_enabled_ui(!on, |ui| {
                        ui.horizontal(|ui| {
                            ui.label(tl("Nome"));
                            ui.add(egui::TextEdit::singleline(&mut g.mp.ui.name).char_limit(20).hint_text(tl("Seu nome")));
                        });
                        ui.horizontal(|ui| {
                            ui.label(tl("Sala"));
                            ui.add(egui::TextEdit::singleline(&mut g.mp.ui.room).char_limit(24));
                        });
                        ui.horizontal(|ui| {
                            ui.label(tl("Servidor"));
                            ui.add(egui::TextEdit::singleline(&mut g.mp.ui.server));
                        });
                    });
                    ui.horizontal(|ui| {
                        if !on {
                            if ui.button(tl("Entrar na sala")).clicked() {
                                g.mp_join();
                            }
                        } else if ui.button(tl("Sair da sala")).clicked() {
                            leave = true;
                        }
                    });
                    ui.label(egui::RichText::new(&g.mp.ui.status).small());
                });
        }
    }
    if leave {
        ecs.resource_scope(|ecs, mut g: Mut<Game>| g.mp_leave(ecs));
    }
    // quem está na sala (jogando)
    let g = ecs.resource::<Game>();
    if let Some(n) = g.mp.net.as_ref().filter(|n| n.connected() && g.running) {
        egui::Area::new("mp-list".into()).anchor(egui::Align2::RIGHT_TOP, egui::vec2(-24.0, 120.0)).interactable(false).show(ctx, |ui| {
            let c = |slot: usize| {
                let v = crate::portals::SLOT_COLORS[slot % 4][0];
                egui::Color32::from_rgb((v[0] * 255.0) as u8, (v[1] * 255.0) as u8, (v[2] * 255.0) as u8)
            };
            ui.label(egui::RichText::new(tlv("Sala “{room}”", &[("room", n.room.clone())])).strong());
            ui.label(egui::RichText::new(format!("● {} {}", g.mp.ui.name, tl("(você)"))).color(c(n.slot)));
            for p in n.peers.values() {
                ui.label(egui::RichText::new(format!("● {}", p.name)).color(c(p.slot)));
            }
        });
    }
}
