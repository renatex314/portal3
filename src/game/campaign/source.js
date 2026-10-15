// De onde vêm os arquivos da campanha original: SEMPRE da cópia do Portal do
// próprio jogador. No `npm run dev`, pelo servidor local (PORTAL_DIR); no site
// publicado, pelo pacote .zip que o jogador gerou com `npm run pacote` ou pela
// pasta do Portal — lidos só no navegador dele, nada é enviado para lugar
// nenhum e nada da Valve vem junto com o site.

import { openZip } from './zip.js';

let backend = null;

export const hasSource = () => !!backend;

/** com o pacote .zip, o conteúdo do VPK está solto na pasta "pak/" dele */
export function packedContent() {
  const z = backend?.zip;
  return z ? { has: (p) => z.has('pak/' + p), read: (p) => z.file('pak/' + p) } : null;
}

// ------------------------------------------------- servidor local (npm run dev)
const http = {
  async file(path) {
    const r = await fetch('./__portal/' + path);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  },
  async range(path, start, len) {
    const r = await fetch('./__portal/' + path, { headers: { Range: `bytes=${start}-${start + len - 1}` } });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return r.status === 200 ? b.subarray(start, start + len) : b;
  },
};

async function tryDevServer() {
  if (!import.meta.env.DEV) return false;
  try {
    const r = await fetch('./__portal/maps');
    if (r.ok && (await r.json()).length) {
      backend = http;
      return true;
    }
  } catch {}
  return false;
}

// ---------------------------------------- pasta escolhida (File System Access)
/** caminhos sem diferenciar maiúsculas (os arquivos do jogo vêm do Windows) */
function handleBackend(root) {
  const dirs = new Map(); // caminho da pasta → Map(nome minúsculo → handle)
  const list = async (dirPath, handle) => {
    if (!dirs.has(dirPath))
      dirs.set(
        dirPath,
        (async () => {
          const m = new Map();
          for await (const [name, h] of handle.entries()) m.set(name.toLowerCase(), h);
          return m;
        })(),
      );
    return dirs.get(dirPath);
  };
  const files = new Map();
  const get = (path) => {
    const key = path.toLowerCase();
    if (!files.has(key))
      files.set(
        key,
        (async () => {
          let h = root;
          let at = '';
          for (const seg of key.split('/').filter(Boolean)) {
            const next = (await list(at, h)).get(seg);
            if (!next) return null;
            h = next;
            at += '/' + seg;
          }
          return h.kind === 'file' ? h.getFile() : null;
        })().catch(() => null),
      );
    return files.get(key);
  };
  return {
    async file(path) {
      const f = await get(path);
      return f ? new Uint8Array(await f.arrayBuffer()) : null;
    },
    async range(path, start, len) {
      const f = await get(path);
      return f ? new Uint8Array(await f.slice(start, start + len).arrayBuffer()) : null;
    },
    async has(path) {
      return !!(await get(path));
    },
  };
}

// --------------------------------------- pasta escolhida (<input webkitdirectory>)
function fileListBackend(fileList) {
  const all = [...fileList];
  const rel = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, '/').toLowerCase();
  // a pasta escolhida pode ser a do Portal ou uma acima dela: acha onde fica portal/gameinfo.txt
  const anchor = all.map(rel).find((p) => /(^|\/)portal\/gameinfo\.txt$/.test(p));
  if (!anchor) return null;
  const prefix = anchor.slice(0, anchor.length - 'portal/gameinfo.txt'.length);
  const map = new Map();
  for (const f of all) {
    const p = rel(f);
    if (p.startsWith(prefix)) map.set(p.slice(prefix.length), f);
  }
  return {
    async file(path) {
      const f = map.get(path.toLowerCase());
      return f ? new Uint8Array(await f.arrayBuffer()) : null;
    },
    async range(path, start, len) {
      const f = map.get(path.toLowerCase());
      return f ? new Uint8Array(await f.slice(start, start + len).arrayBuffer()) : null;
    },
  };
}

// ------------------------------------------------ pacote .zip (npm run pacote)
export const PACK_MARK = 'portal-campanha.json';

async function zipBackend(file) {
  let zip;
  try {
    zip = await openZip(file);
  } catch {
    return null;
  }
  if (!zip.has(PACK_MARK)) return null;
  return {
    zip,
    file: (path) => zip.file(path),
    async range(path, start, len) {
      const f = await zip.file(path);
      return f ? f.subarray(start, start + len) : null;
    },
  };
}

// ------------------------------------------- lembrar a escolha (Chrome/Edge)
const DB = 'portal3-campanha';
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('kv', mode);
          const r = fn(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(r?.result ?? null);
          tx.onerror = () => resolve(null);
        } catch {
          resolve(null); // lembrar é só conveniência: se falhar, segue sem
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/** se a pasta escolhida for a de cima (ex.: "common"), desce até a do Portal */
async function findPortalDir(dir) {
  const b = handleBackend(dir);
  if (await b.has('portal/gameinfo.txt')) return dir;
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'directory' || name.toLowerCase() !== 'portal') continue;
    if (await handleBackend(h).has('portal/gameinfo.txt')) return h;
  }
  return null;
}

/** pasta (FileSystemDirectoryHandle) ou pacote (FileSystemFileHandle) */
async function useHandle(h) {
  if (h.kind === 'file') {
    const b = await zipBackend(await h.getFile());
    if (!b) return false;
    backend = b;
  } else {
    const root = await findPortalDir(h);
    if (!root) return false;
    backend = handleBackend(root);
  }
  idb('readwrite', (s) => s.put(h, 'pasta'));
  return true;
}

/** escolha lembrada de outra visita (pede permissão de novo, se o navegador exigir) */
async function tryRemembered() {
  if (!('showDirectoryPicker' in window)) return false;
  const h = await idb('readonly', (s) => s.get('pasta'));
  if (!h) return false;
  try {
    let p = await h.queryPermission({ mode: 'read' });
    if (p === 'prompt') p = await h.requestPermission({ mode: 'read' });
    return p === 'granted' && (await useHandle(h));
  } catch {
    return false;
  }
}

/** seletor de arquivo/pasta clássico (Firefox/Safari); resolve com a lista ou null */
function classicPicker(folder) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (folder) {
      input.webkitdirectory = true;
      input.multiple = true;
    } else input.accept = '.zip,application/zip';
    input.addEventListener('change', () => resolve(input.files?.length ? input.files : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** pede o pacote .zip ao jogador (precisa vir de um clique) */
export async function pickPack() {
  if ('showOpenFilePicker' in window) {
    let h;
    try {
      [h] = await window.showOpenFilePicker({ id: 'portal-pacote', types: [{ description: 'Pacote da campanha', accept: { 'application/zip': ['.zip'] } }] });
    } catch {
      return 'cancelado';
    }
    return (await useHandle(h)) ? 'ok' : 'errada';
  }
  const files = await classicPicker(false);
  if (!files) return 'cancelado';
  const b = await zipBackend(files[0]);
  if (b) backend = b;
  return b ? 'ok' : 'errada';
}

/** pede a pasta do Portal ao jogador (precisa vir de um clique) */
export async function pickFolder() {
  if ('showDirectoryPicker' in window) {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'portal', mode: 'read' });
    } catch {
      return 'cancelado';
    }
    return (await useHandle(dir)) ? 'ok' : 'errada';
  }
  const files = await classicPicker(true);
  if (!files) return 'cancelado';
  const b = fileListBackend(files);
  if (b) backend = b;
  return b ? 'ok' : 'errada';
}

/**
 * Janela "de onde vêm os arquivos": pacote .zip ou pasta do Portal. Cada botão
 * é um clique novo (os navegadores só abrem seletores logo depois de um clique).
 */
function chooseSource() {
  const box = document.getElementById('campaign-src');
  if (!box) return pickPack();
  const msg = box.querySelector('.src-msg');
  msg.textContent = '';
  box.hidden = false;
  return new Promise((resolve) => {
    const done = (r) => {
      box.hidden = true;
      box.onclick = null;
      resolve(r);
    };
    box.onclick = async (ev) => {
      const act = ev.target.closest('[data-src]')?.dataset.src;
      if (!act) return;
      if (act === 'cancelar') return done('cancelado');
      const r = act === 'pacote' ? await pickPack() : await pickFolder();
      if (r === 'ok') return done('ok');
      if (r === 'errada')
        msg.textContent =
          act === 'pacote'
            ? 'Esse arquivo não é o pacote da campanha. Gere-o com "npm run pacote" (veja o LEIA-ME do projeto).'
            : 'Essa pasta não parece ser a do Portal. Escolha a pasta "Portal" (a que tem as pastas "portal" e "hl2" dentro).';
    };
  });
}

/** garante uma origem de arquivos: servidor local, escolha lembrada ou nova escolha */
export async function ensureSource() {
  if (backend) return 'ok';
  if (await tryDevServer()) return 'ok';
  if (await tryRemembered()) return 'ok';
  return chooseSource();
}

/** para testes automáticos: usa um "handle" de pasta ou de arquivo qualquer */
export async function useDirectoryHandle(h) {
  return useHandle(h);
}

/** para testes automáticos: usa um Blob/File do pacote .zip */
export async function usePackBlob(blob) {
  const b = await zipBackend(blob);
  if (b) backend = b;
  return !!b;
}

/** esquece a escolha (para trocar de pacote/pasta) */
export async function forgetSource() {
  backend = null;
  await idb('readwrite', (s) => s.delete('pasta'));
}

export async function readFile(path) {
  return backend ? backend.file(path) : null;
}

export async function readRange(path, start, len) {
  if (!len) return new Uint8Array(0);
  const b = backend ? await backend.range(path, start, len) : null;
  if (!b) throw new Error(`não consegui ler ${path}`);
  return b;
}
