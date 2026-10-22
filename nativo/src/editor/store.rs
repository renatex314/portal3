//! Níveis do editor guardados no disco (na pasta de dados do jogo, como o progresso) e exportar/
//! importar um nível como arquivo .json (store.js).

use super::doc::Doc;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn file() -> PathBuf {
    // (testes: um arquivo próprio, nunca os níveis de quem joga)
    if std::env::var("PORTAL3_MUTE").is_ok() {
        return std::env::temp_dir().join("portal3-teste-niveis.json");
    }
    crate::menu::data_dir().join("niveis.json")
}

fn read() -> (Vec<String>, Map<String, Value>) {
    let v: Value = std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({}));
    let order = v.get("order").and_then(|o| o.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let docs = v.get("docs").and_then(|d| d.as_object()).cloned().unwrap_or_default();
    (order, docs)
}

fn write(order: &[String], docs: &Map<String, Value>) -> bool {
    let f = file();
    if let Some(d) = f.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    serde_json::to_string(&json!({ "order": order, "docs": docs })).ok().is_some_and(|s| std::fs::write(f, s).is_ok())
}

/// documentos na ordem em que foram criados (os estragados ficam de fora)
pub fn list() -> Vec<Doc> {
    let (order, docs) = read();
    order.iter().filter_map(|id| docs.get(id)).filter_map(|d| Doc::normalize(d).ok()).collect()
}

pub fn get(id: &str) -> Option<Doc> {
    read().1.get(id).and_then(|d| Doc::normalize(d).ok())
}

pub fn save(doc: &Doc) -> bool {
    let (mut order, mut docs) = read();
    if !docs.contains_key(&doc.id) {
        order.push(doc.id.clone());
    }
    docs.insert(doc.id.clone(), serde_json::to_value(doc).unwrap_or(Value::Null));
    write(&order, &docs)
}

pub fn remove(id: &str) -> bool {
    let (mut order, mut docs) = read();
    docs.remove(id);
    order.retain(|x| x != id);
    write(&order, &docs)
}

/// apaga todos (testes)
pub fn clear() {
    let _ = std::fs::remove_file(file());
}

/// nome de arquivo do nível: letras, números, _ e -
pub fn file_name(doc: &Doc) -> String {
    let s: String = doc.name.chars().map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    format!("{}.nivel.json", if s.trim_matches('_').is_empty() { "nivel".into() } else { s })
}

/// grava o nível num arquivo
pub fn export_to(doc: &Doc, path: &std::path::Path) -> std::io::Result<()> {
    std::fs::write(path, serde_json::to_string_pretty(doc).unwrap_or_default())
}

/// lê um arquivo; devolve o documento (com id novo se já existir um igual)
pub fn import_from(path: &std::path::Path) -> Result<Doc, String> {
    let txt = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
    let mut doc = Doc::normalize(&v)?;
    if read().1.contains_key(&doc.id) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        doc.id = format!("{}-i{t:x}", doc.id);
    }
    Ok(doc)
}
