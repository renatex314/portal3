// Idioma dos textos do jogo: português (o original) ou inglês. Só os textos — as
// vozes gravadas e a narração continuam em português.
//
// Os textos continuam escritos em português no código; `tl(texto)` devolve a
// tradução do dicionário (i18n.en.js), achada pelo próprio texto em português.
// O HTML da página e o que o jogo põe na tela depois (legendas, avisos, menus)
// são traduzidos sozinhos por `watch()`; textos montados com números usam
// `tl('… {n} …', { n })`. Texto sem tradução continua em português e fica listado
// em `window.__i18nMissing` (para achar o que falta).

import { EN, EN_HTML } from './i18n.en.js';

const KEY = 'tunel-lang';
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const lang = read() === 'en' ? 'en' : 'pt';
export const isEN = lang === 'en';

/** troca o idioma (recarrega a página: tudo, inclusive as placas 3D, é refeito) */
export function setLang(l) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
  location.reload();
}

const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m)) : s);

// parece português? (para listar o que falta traduzir sem pegar números, nomes e inglês)
const PT = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔ]|\b(você|não|uma|com|para|porta|botão|nível|fase|tempo|sair|jogar|voltar|que|da|dos|das|em|na|ao|pelo|pela|sem|mais|seu|sua|isso|esse|essa|aqui|até|então|quando|também)\b/i;
const missing = new Set();
if (isEN && typeof window !== 'undefined') window.__i18nMissing = missing;

/** tradução de um texto exato (com os espaços de fora preservados) ou null */
function lookup(s) {
  const r = EN.get(s);
  if (r !== undefined) return r;
  const core = s.trim();
  if (core !== s) {
    const r2 = EN.get(core);
    if (r2 !== undefined) return s.replace(core, r2);
  }
  return null;
}

/** traduz um texto do jogo; `vars` preenche os {campos} (depois de traduzir o modelo) */
export function tl(s, vars) {
  if (typeof s !== 'string') return s;
  if (!isEN) return fill(s, vars);
  const r = lookup(s);
  if (r === null && PT.test(s)) missing.add(s);
  return fill(r ?? s, vars);
}

/** número com uma casa: vírgula em português, ponto em inglês */
export const num = (x, d = 1) => (isEN ? x.toFixed(d) : x.toFixed(d).replace('.', ','));

/** traduz quando houver tradução; senão devolve null (para não marcar como faltando) */
export const tMaybe = (s) => (isEN && typeof s === 'string' ? lookup(s) : null);

// ------------------------------------------------------------------ a página
const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'TEXTAREA']);
const ATTRS = ['title', 'placeholder', 'aria-label'];

function translateText(node) {
  const v = node.nodeValue;
  if (!v || !/[A-Za-zÀ-ú]/.test(v)) return;
  const r = lookup(v);
  if (r !== null) {
    if (r !== v) node.nodeValue = r;
  } else if (PT.test(v)) missing.add(v.trim());
}

function translateEl(el) {
  if (SKIP.has(el.tagName) || el.isContentEditable) return;
  // blocos com marcação dentro (negrito, links) traduzidos inteiros
  const id = el.dataset?.i18n;
  if (id && EN_HTML[id] !== undefined) {
    if (el.innerHTML !== EN_HTML[id]) el.innerHTML = EN_HTML[id];
    return;
  }
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v) {
      const r = lookup(v);
      if (r !== null && r !== v) el.setAttribute(a, r);
    }
  }
  for (const c of el.childNodes) {
    if (c.nodeType === 3) translateText(c);
    else if (c.nodeType === 1) translateEl(c);
  }
}

/** traduz a página e tudo o que for posto nela depois */
export function watch(root = document.body) {
  if (!isEN) return;
  document.documentElement.lang = 'en';
  if (document.title) document.title = lookup(document.title) ?? document.title;
  translateEl(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') translateText(m.target);
      else if (m.type === 'attributes') {
        const v = m.target.getAttribute(m.attributeName);
        const r = v && lookup(v);
        if (r && r !== v) m.target.setAttribute(m.attributeName, r);
      } else
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) translateText(n);
          else if (n.nodeType === 1) translateEl(n);
        }
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
