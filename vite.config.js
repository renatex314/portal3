import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base relativa: o build (dist/) funciona em qualquer subpasta ou hospedagem estática.
// Duas páginas: a visita (index.html) e o jogo de portais (jogo.html).
export default defineConfig({
  base: './',
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
