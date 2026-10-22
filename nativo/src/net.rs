//! Cliente do multiplayer (net.js): conecta no WebSocket do servidor da versão web (server.js) e
//! troca as mesmas mensagens JSON — jogadores da versão web e da nativa jogam na mesma sala.
//! A conexão roda numa thread; o jogo manda e recebe por canais.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

pub struct Peer {
    pub name: String,
    pub slot: usize,
}

pub struct Net {
    out: Sender<String>,
    inc: std::sync::Mutex<Receiver<Value>>,
    alive: Arc<AtomicBool>,
    pub id: Option<u64>,
    pub slot: usize,
    pub room: String,
    pub name: String,
    pub peers: HashMap<u64, Peer>,
    /// a conexão caiu (ou não abriu): o motivo
    pub error: Option<String>,
}

impl Net {
    /// abre a conexão (em segundo plano) e pede para entrar na sala
    pub fn connect(url: &str, room: &str, name: &str) -> Net {
        let (out_tx, out_rx) = channel::<String>();
        let (in_tx, in_rx) = channel::<Value>();
        let alive = Arc::new(AtomicBool::new(true));
        let a = alive.clone();
        let url = url.to_string();
        let join = json!({ "t": "join", "room": room, "name": name }).to_string();
        std::thread::spawn(move || {
            let fail = |m: String| {
                let _ = in_tx.send(json!({ "t": "neterror", "msg": m }));
            };
            let (mut ws, _) = match tungstenite::connect(url.as_str()) {
                Ok(x) => x,
                Err(e) => return fail(e.to_string()),
            };
            if let tungstenite::stream::MaybeTlsStream::Plain(s) = ws.get_mut() {
                let _ = s.set_nonblocking(true);
                let _ = s.set_nodelay(true);
            }
            let _ = ws.send(tungstenite::Message::Text(join));
            while a.load(Ordering::Relaxed) {
                let mut idle = true;
                while let Ok(m) = out_rx.try_recv() {
                    idle = false;
                    let _ = ws.write(tungstenite::Message::Text(m));
                }
                let _ = ws.flush();
                match ws.read() {
                    Ok(tungstenite::Message::Text(t)) => {
                        idle = false;
                        if let Ok(v) = serde_json::from_str::<Value>(&t) {
                            let _ = in_tx.send(v);
                        }
                    }
                    Ok(tungstenite::Message::Close(_)) => break,
                    Ok(_) => idle = false,
                    Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => {
                        fail(e.to_string());
                        break;
                    }
                }
                if idle {
                    std::thread::sleep(std::time::Duration::from_millis(4));
                }
            }
            let _ = ws.close(None);
            let _ = ws.flush();
            let _ = in_tx.send(json!({ "t": "disconnect" }));
        });
        Net { out: out_tx, inc: std::sync::Mutex::new(in_rx), alive, id: None, slot: 0, room: room.to_string(), name: name.to_string(), peers: HashMap::new(), error: None }
    }

    pub fn connected(&self) -> bool {
        self.id.is_some()
    }

    pub fn send(&self, m: Value) {
        if self.connected() {
            let _ = self.out.send(m.to_string());
        }
    }

    /// as mensagens que chegaram (a lista de jogadores já atualizada)
    pub fn poll(&mut self) -> Vec<Value> {
        let mut out = vec![];
        let got: Vec<Value> = self.inc.lock().map(|r| r.try_iter().collect()).unwrap_or_default();
        for m in got {
            match m.get("t").and_then(|t| t.as_str()).unwrap_or("") {
                "welcome" => {
                    self.id = m.get("id").and_then(|v| v.as_u64());
                    self.slot = m.get("slot").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    if let Some(r) = m.get("room").and_then(|v| v.as_str()) {
                        self.room = r.to_string();
                    }
                    for p in m.get("players").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                        let id = p.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if Some(id) != self.id {
                            self.peers.insert(id, Peer { name: p.get("name").and_then(|v| v.as_str()).unwrap_or("").into(), slot: p.get("slot").and_then(|v| v.as_u64()).unwrap_or(0) as usize });
                        }
                    }
                }
                "joined" => {
                    let id = m.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                    self.peers.insert(id, Peer { name: m.get("name").and_then(|v| v.as_str()).unwrap_or("").into(), slot: m.get("slot").and_then(|v| v.as_u64()).unwrap_or(0) as usize });
                }
                "left" => {
                    if let Some(id) = m.get("id").and_then(|v| v.as_u64()) {
                        self.peers.remove(&id);
                    }
                }
                "full" => self.error = Some(crate::i18n::tlv("sala cheia (máximo {n})", &[("n", m.get("max").map(|v| v.to_string()).unwrap_or_default())])),
                "neterror" => self.error = Some(m.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string()),
                "disconnect" => {
                    self.id = None;
                    self.peers.clear();
                }
                _ => {}
            }
            out.push(m);
        }
        out
    }

    pub fn leave(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
        self.id = None;
        self.peers.clear();
    }
}

impl Drop for Net {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}
