// Cliente do multiplayer em rede local: conecta no WebSocket do mesmo
// servidor que entrega a página (server.js) e troca mensagens JSON.

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.slot = 0;
    this.room = null;
    this.peers = new Map(); // id → { name, slot }
    this.handlers = {};
  }

  get connected() {
    return this.ws?.readyState === 1 && this.id !== null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(type, m) {
    this.handlers[type]?.(m);
  }

  connect(room, name) {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      // fecha uma conexão anterior (evita "fantasmas" do mesmo jogador na sala)
      if (this.ws) {
        this.ws.onclose = this.ws.onmessage = this.ws.onerror = null;
        try {
          this.ws.close();
        } catch {}
        this.id = null;
        this.peers.clear();
      }
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      // tempo generoso: no 1º acesso o navegador pode ficar ocupado preparando os gráficos
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.onclose = ws.onmessage = ws.onerror = null;
        ws.close();
        reject(new Error('timeout'));
      }, 20000);
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('sem servidor'));
      };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
      ws.onclose = () => {
        if (this.id !== null) this.emit('disconnect');
        this.id = null;
        this.peers.clear();
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          clearTimeout(timer);
          settled = true;
          this.id = m.id;
          this.slot = m.slot;
          this.room = m.room;
          for (const p of m.players) if (p.id !== m.id) this.peers.set(p.id, p);
          resolve(m);
        } else if (m.t === 'full') {
          clearTimeout(timer);
          settled = true;
          reject(new Error(`sala cheia (máximo ${m.max})`));
          ws.close();
        } else if (m.t === 'joined') {
          this.peers.set(m.id, { id: m.id, name: m.name, slot: m.slot });
        } else if (m.t === 'left') {
          this.peers.delete(m.id);
        }
        this.emit(m.t, m);
      };
    });
  }

  send(m) {
    if (this.connected) this.ws.send(JSON.stringify(m));
  }

  leave() {
    this.id = null;
    this.ws?.close();
    this.peers.clear();
  }
}
