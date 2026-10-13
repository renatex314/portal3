// Servidor da rede local: entrega o site (pasta dist/) e mantém as salas do
// modo multiplayer do jogo (WebSocket em /ws), na mesma porta.
//
//   npm run build && npm run serve      →  http://<ip-da-máquina>:5181/
//
// O servidor só repassa mensagens entre quem está na mesma sala e guarda o
// estado mínimo da sala (câmara atual e portais de cada jogador), para quem
// entra depois já ver tudo igual.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 5181;
const MAX_PER_ROOM = 4;
const MAX_LEVEL = 40; // câmaras + bateria clássica + mapa livre (o cliente confere o índice)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

// ------------------------------------------------------------------ salas
const rooms = new Map(); // nome → { players: Map(id → {ws, name, slot}), level, portals: Map(id → {...}) }
let nextId = 1;

function room(name) {
  if (!rooms.has(name)) rooms.set(name, { players: new Map(), level: 0, portals: new Map(), flags: { turrets: new Map(), gems: new Map() } });
  return rooms.get(name);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(r, msg, exceptId = null) {
  const s = JSON.stringify(msg);
  for (const [id, p] of r.players) if (id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}

const list = (r) => [...r.players].map(([id, p]) => ({ id, name: p.name, slot: p.slot }));
const clean = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
// derruba conexões mortas (aba fechada sem avisar, Wi-Fi caiu) para não sobrar "fantasma" na sala
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 10000);

wss.on('connection', (ws, req) => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  const id = nextId++;
  let r = null;
  let roomName = null;
  const ip = req.socket.remoteAddress;

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'join' && !r) {
      roomName = clean(m.room, 24).toLowerCase() || 'mina';
      r = room(roomName);
      if (r.players.size >= MAX_PER_ROOM) {
        send(ws, { t: 'full', max: MAX_PER_ROOM });
        r = null;
        return;
      }
      const used = new Set([...r.players.values()].map((p) => p.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const name = clean(m.name, 20) || `Mineiro ${id}`;
      r.players.set(id, { ws, name, slot });
      send(ws, { t: 'welcome', id, slot, room: roomName, level: r.level, players: list(r), portals: [...r.portals.values()], flags: { turrets: [...r.flags.turrets], gems: [...r.flags.gems] } });
      broadcast(r, { t: 'joined', id, name, slot }, id);
      console.log(`[${roomName}] entrou ${name} (${ip}) — ${r.players.size} na sala`);
      return;
    }
    if (!r) return;
    switch (m.t) {
      case 'state':
      case 'cube':
        broadcast(r, { ...m, id }, id);
        break;
      case 'turret':
        if (m.lvl === r.level) r.flags.turrets.set(m.idx, m.p);
        broadcast(r, { ...m, id }, id);
        break;
      case 'gem':
        if (m.lvl === r.level && !r.flags.gems.has(m.idx)) r.flags.gems.set(m.idx, clean(m.name, 20));
        broadcast(r, { ...m, id }, id);
        break;
      case 'portal':
        r.portals.set(`${id}:${m.which}`, { ...m, id });
        broadcast(r, { ...m, id }, id);
        break;
      case 'setLevel':
      case 'exit': {
        const next = m.t === 'exit' ? m.level + 1 : m.level;
        if (m.t === 'exit' && m.level !== r.level) break; // alguém já avançou
        r.level = Math.max(0, Math.min(next, MAX_LEVEL));
        r.portals.clear();
        r.flags.turrets.clear();
        r.flags.gems.clear();
        broadcast(r, { t: 'level', level: r.level, by: r.players.get(id)?.name, final: m.t === 'exit' && m.final });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!r) return;
    const p = r.players.get(id);
    r.players.delete(id);
    for (const k of [...r.portals.keys()]) if (k.startsWith(`${id}:`)) r.portals.delete(k);
    broadcast(r, { t: 'left', id, name: p?.name });
    console.log(`[${roomName}] saiu ${p?.name} — ${r.players.size} na sala`);
    if (!r.players.size) rooms.delete(roomName);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Túnel Gravitacional no ar na porta ${PORT}`);
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets ?? []) if (n.family === 'IPv4' && !n.internal) console.log(`  http://${n.address}:${PORT}/   ·   jogo: http://${n.address}:${PORT}/jogo.html`);
});
