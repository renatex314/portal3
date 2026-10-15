// Leitor do formato texto KeyValues (scripts de som e legendas da Valve).
// Devolve nós { key, value } ou { key, children: [...] }.

export function parseKV(text) {
  let i = 0;
  const n = text.length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
  };
  const token = () => {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') {
      i++;
      return { t: c };
    }
    let s = '';
    if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) i++;
        s += text[i++];
      }
      i++;
      return { t: 's', s, q: true };
    }
    while (i < n && !/\s/.test(text[i]) && text[i] !== '{' && text[i] !== '}' && text[i] !== '"') s += text[i++];
    return { t: 's', s, q: false };
  };
  const block = (top) => {
    const out = [];
    for (;;) {
      const k = token();
      if (!k) return out;
      if (k.t === '}') return out;
      if (k.t !== 's') continue;
      let v = token();
      if (v && v.t === 's' && !v.q && v.s.startsWith('[')) v = token(); // condição de plataforma
      if (!v) return out;
      if (v.t === '{') out.push({ key: k.s, children: block(false) });
      else if (v.t === 's') {
        out.push({ key: k.s, value: v.s });
        const save = i;
        const c = token();
        if (!(c && c.t === 's' && !c.q && c.s.startsWith('['))) i = save;
      }
      if (top && i >= n) return out;
    }
  };
  return block(true);
}

export const kvGet = (node, key) => node.children?.find((c) => c.key.toLowerCase() === key.toLowerCase());
