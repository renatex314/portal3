// Níveis do editor guardados no navegador (localStorage) + exportar/importar .json.

import { normalize } from './doc.js';

const KEY = 'tunel-editor-v1';

function read() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { order: Array.isArray(r.order) ? r.order : [], docs: r.docs && typeof r.docs === 'object' ? r.docs : {} };
  } catch {
    return { order: [], docs: {} };
  }
}
function write(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false; // sem espaço ou bloqueado: o editor avisa
  }
}

/** documento antigo ou incompleto → completo (nunca derruba o editor) */
function fix(d) {
  if (!d) return null;
  try {
    return normalize(d);
  } catch {
    return null;
  }
}

export const store = {
  /** documentos na ordem em que foram criados */
  list() {
    const s = read();
    return s.order.map((id) => fix(s.docs[id])).filter(Boolean);
  },
  get(id) {
    return fix(read().docs[id]);
  },
  save(doc) {
    const s = read();
    if (!s.docs[doc.id]) s.order.push(doc.id);
    s.docs[doc.id] = doc;
    return write(s);
  },
  remove(id) {
    const s = read();
    delete s.docs[id];
    s.order = s.order.filter((x) => x !== id);
    return write(s);
  },
  /** baixa o nível como arquivo */
  exportFile(doc) {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'nivel'}.nivel.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  /** lê um arquivo escolhido pelo jogador; devolve o documento (com id novo se já existir um igual) */
  async importFile(file) {
    const doc = normalize(JSON.parse(await file.text()));
    if (read().docs[doc.id]) doc.id = `${doc.id}-i${Date.now().toString(36)}`;
    return doc;
  },
};
