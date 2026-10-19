// Chave de uma fala gravada: quem fala + o texto (FNV-1a de 32 bits, em hexa).
// O mesmo cálculo no jogo e no script que gera os áudios (scripts/vozes.mjs).
export function voiceKey(who, text) {
  const s = `${who}|${text}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
