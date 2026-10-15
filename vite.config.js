import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';

// Campanha original: em `npm run dev`, /__portal/* lê arquivos da SUA instalação
// do Portal (PORTAL_DIR). Só existe no servidor de desenvolvimento local — nada
// da Valve entra no repositório nem no build publicado.
const PORTAL_DIR = path.resolve(
  process.env.PORTAL_DIR || '/Volumes/SSD/crossover/bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Portal',
);

function portalData() {
  return {
    name: 'portal-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__portal', (req, res) => {
        const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (rel === '/maps') {
          const dir = path.join(PORTAL_DIR, 'portal', 'maps');
          const maps = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.bsp')).map((f) => f.slice(0, -4)) : [];
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(maps));
          return;
        }
        const file = path.resolve(PORTAL_DIR, '.' + rel);
        if (!file.startsWith(PORTAL_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        // pedaços (Range): os arquivos .vpk têm centenas de MB e só lemos o que precisa
        const size = fs.statSync(file).size;
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        if (m) {
          const start = Number(m[1]);
          const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          if (start > end) {
            res.statusCode = 416;
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          fs.createReadStream(file, { start, end }).pipe(res);
          return;
        }
        res.setHeader('Content-Length', size);
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

// base relativa: o build (dist/) funciona em qualquer subpasta ou hospedagem estática.
// Duas páginas: a visita (index.html) e o jogo de portais (jogo.html).
export default defineConfig({
  base: './',
  plugins: [portalData()],
  build: {
    chunkSizeWarningLimit: 5000, // o motor de física (Rapier) vem com o WebAssembly embutido
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        jogo: resolve(import.meta.dirname, 'jogo.html'),
      },
    },
  },
});
