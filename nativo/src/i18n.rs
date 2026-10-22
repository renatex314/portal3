//! Idioma dos textos (i18n.js): português (o original) ou inglês. Só os textos — as vozes gravadas
//! continuam em português. Os textos estão em português no código; a tradução é achada pelo
//! próprio texto no dicionário (`assets/i18n/en.json`, exportado de i18n.en.js). Todo `Text` da
//! interface que muda é traduzido sozinho (como o `watch()` da versão web); textos montados com
//! números usam `tlv("… {n} …", &[("n", ..)])`.

use bevy::prelude::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static EN_ON: AtomicBool = AtomicBool::new(false);

/// as chaves em minúsculas (os rótulos em maiúsculas da interface)
fn lower() -> &'static HashMap<String, String> {
    static L: OnceLock<HashMap<String, String>> = OnceLock::new();
    L.get_or_init(|| dict().iter().map(|(k, v)| (k.to_lowercase(), v.clone())).collect())
}

fn dict() -> &'static HashMap<String, String> {
    static D: OnceLock<HashMap<String, String>> = OnceLock::new();
    D.get_or_init(|| {
        let p = crate::mats::asset_dir().join("i18n").join("en.json");
        std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    })
}

pub fn is_en() -> bool {
    EN_ON.load(Ordering::Relaxed)
}

pub fn set_en(on: bool) {
    EN_ON.store(on, Ordering::Relaxed);
}

/// bloco de texto da página (data-i18n na versão web), em inglês, ou o próprio texto
pub fn html(id: &str, pt: &str) -> String {
    if !is_en() {
        return pt.to_string();
    }
    dict().get(&format!("#html:{id}")).cloned().unwrap_or_else(|| pt.to_string())
}

/// tradução de um texto exato (com os espaços de fora preservados)
pub fn lookup(s: &str) -> Option<String> {
    let d = dict();
    if let Some(r) = d.get(s) {
        return Some(r.clone());
    }
    // rótulos em maiúsculas (na versão web o CSS é que deixa maiúsculo): procura sem caixa
    let caps = s.chars().any(|c| c.is_alphabetic()) && !s.chars().any(|c| c.is_lowercase());
    if caps {
        if let Some(r) = lower().get(&s.to_lowercase()) {
            return Some(r.to_uppercase());
        }
    }
    // pedaços que na página são nós separados (a tecla e o que ela faz; os itens de uma lista)
    for sep in [" — ", " · ", " / "] {
        if s.contains(sep) {
            let parts: Vec<String> = s.split(sep).map(|p| lookup(p).unwrap_or_else(|| p.to_string())).collect();
            let r = parts.join(sep);
            if r != s {
                return Some(r);
            }
        }
    }
    let core = s.trim();
    if core != s {
        if let Some(r) = d.get(core) {
            return Some(s.replacen(core, r, 1));
        }
    }
    None
}

/// traduz um texto do jogo (sem tradução: fica em português)
pub fn tl(s: &str) -> String {
    if !is_en() {
        return s.to_string();
    }
    lookup(s).unwrap_or_else(|| s.to_string())
}

/// traduz o modelo e preenche os {campos}
pub fn tlv(s: &str, vars: &[(&str, String)]) -> String {
    let mut out = tl(s);
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

/// número com uma casa: vírgula em português, ponto em inglês
pub fn num(x: f32, d: usize) -> String {
    let s = format!("{x:.d$}");
    if is_en() { s } else { s.replace('.', ",") }
}

/// todo texto da interface que mudou é traduzido (o texto já em inglês não tem entrada: para)
pub fn translate_texts(mut q: Query<&mut Text, Changed<Text>>, mut spans: Query<&mut TextSpan, Changed<TextSpan>>) {
    if !is_en() {
        return;
    }
    for mut t in &mut q {
        match lookup(&t.0) {
            Some(r) => {
                if r != t.0 {
                    t.0 = r;
                }
            }
            None => missing(&t.0),
        }
    }
    for mut t in &mut spans {
        if let Some(r) = lookup(&t.0) {
            if r != t.0 {
                t.0 = r;
            }
        }
    }
}

/// parece português? (para listar o que falta traduzir, sem números, nomes e inglês)
fn looks_pt(s: &str) -> bool {
    const W: [&str; 31] = ["você", "não", "uma", "com", "para", "porta", "botão", "nível", "fase", "tempo", "sair", "jogar", "voltar", "que", "da", "dos", "das", "em", "na", "ao", "pelo", "pela", "sem", "mais", "seu", "sua", "isso", "esse", "aqui", "até", "então"];
    s.chars().any(|c| "ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔ".contains(c)) || s.to_lowercase().split(|c: char| !c.is_alphabetic()).any(|w| W.contains(&w))
}

/// com PORTAL3_I18N_FALTA: escreve cada texto da tela ainda em português (uma vez)
fn missing(s: &str) {
    static SEEN: std::sync::Mutex<Option<std::collections::HashSet<String>>> = std::sync::Mutex::new(None);
    if std::env::var("PORTAL3_I18N_FALTA").is_err() || !looks_pt(s) {
        return;
    }
    let mut g = SEEN.lock().unwrap();
    if g.get_or_insert_with(Default::default).insert(s.to_string()) {
        println!("sem tradução: {s:?}");
    }
}
