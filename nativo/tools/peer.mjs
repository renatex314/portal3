// Jogador de mentira para o teste do multiplayer: entra na sala, anda, abre um portal e anota o que
// recebe da versão nativa.  node peer.mjs <ws://…/ws> <sala> <saída.json> <portal JSON>
import { WebSocket } from 'ws';
import { writeFileSync } from 'node:fs';
const [url, room, out, portal] = process.argv.slice(2);
const ws = new WebSocket(url);
const got = { states: 0, level: null, portals: 0, names: [] };
let lvl = 0;
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room, name: 'Robô Web' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    lvl = m.level;
    for (const p of m.players) got.names.push(p.name);
    // anda de lá para cá e abre um portal
    let k = 0;
    const tick = setInterval(() => {
      k++;
      ws.send(JSON.stringify({ t: 'state', p: [Math.sin(k / 10) * 2, 0.92, 2], yaw: 0, up: 1, mv: true, lvl }));
      if (k === 10 && portal) ws.send(JSON.stringify({ t: 'portal', which: 'blue', lvl, ...JSON.parse(portal) }));
      if (k > 200) clearInterval(tick);
    }, 50);
  }
  if (m.t === 'state') got.states++;
  if (m.t === 'portal') got.portals++;
  if (m.t === 'level') {
    got.level = m.level;
    lvl = m.level;
  }
  writeFileSync(out, JSON.stringify(got));
});
setTimeout(() => process.exit(0), 15000);
