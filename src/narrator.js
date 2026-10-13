// Narração com as vozes em português do Brasil do próprio sistema
// (Web Speech API). Cada personagem tem gênero, tom e ritmo próprios; se o
// sistema tiver só uma voz pt-BR, o tom/ritmo diferenciam os personagens.

const SPEAKERS = {
  Narrador: { g: 'm', pitch: 0.85, rate: 0.95 },
  Helena: { g: 'f', pitch: 1.0, rate: 1.0 },
  Luciana: { g: 'f', pitch: 1.08, rate: 1.02 },
  Kelly: { g: 'f', pitch: 1.15, rate: 1.06 },
  'Dona Cida': { g: 'f', pitch: 0.88, rate: 0.9 },
  Bigode: { g: 'm', pitch: 0.82, rate: 1.0 },
  'Seu Tião': { g: 'm', pitch: 0.72, rate: 0.86 },
  'Seu Tião (rádio)': { g: 'm', pitch: 0.75, rate: 0.95 },
  Rodrigo: { g: 'm', pitch: 1.0, rate: 1.02 },
  Marquinho: { g: 'm', pitch: 1.12, rate: 1.1 },
  Rádio: { g: 'm', pitch: 1.0, rate: 1.18 },
};

const FEMALE = /maria|francisca|thalita|luciana|vit[oó]ria|leila|brenda|elza|manuela|yara|giovanna|raquel|female|feminin|google português/i;
const MALE = /daniel|ant[oô]nio|donato|f[aá]bio|humberto|j[uú]lio|nicolau|val[eé]rio|felipe|male|masculin/i;

export class Narrator {
  constructor() {
    this.enabled = false;
    this.supported = 'speechSynthesis' in window;
    this.voices = [];
    this.onSpeaking = () => {};
    this.token = 0;
    if (this.supported) {
      const load = () => {
        const all = speechSynthesis.getVoices();
        this.voices = all.filter((v) => /pt[-_]BR/i.test(v.lang));
        if (!this.voices.length) this.voices = all.filter((v) => /^pt/i.test(v.lang));
        // vozes "naturais"/online soam melhor: vêm primeiro
        this.voices.sort((a, b) => (/natural|online|google/i.test(b.name) ? 1 : 0) - (/natural|online|google/i.test(a.name) ? 1 : 0));
      };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  get available() {
    return this.supported && this.voices.length > 0;
  }

  _voice(g) {
    const re = g === 'f' ? FEMALE : MALE;
    return this.voices.find((v) => re.test(v.name) && !(g === 'm' && FEMALE.test(v.name))) ?? this.voices[0];
  }

  cancel() {
    this.token++;
    if (this.supported) speechSynthesis.cancel();
    this.onSpeaking(false);
  }

  /** Fala um texto (dividido em frases). Resolve quando termina, é cancelado ou se a narração estiver desligada. */
  async speak(text, who = 'Narrador') {
    if (!this.enabled || !this.available) return false;
    const my = this.token;
    const sp = SPEAKERS[who] ?? SPEAKERS.Narrador;
    const voice = this._voice(sp.g);
    const sameVoice = voice === this._voice(sp.g === 'f' ? 'm' : 'f');
    const sentences = text
      .replace(/[⚠️💥🌊⛰️]/gu, '')
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    this.onSpeaking(true);
    for (const s of sentences) {
      if (my !== this.token) return false;
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(s);
        u.lang = 'pt-BR';
        u.voice = voice;
        u.rate = sp.rate;
        // se só existe uma voz, o tom diferencia homem/mulher
        u.pitch = sameVoice ? sp.pitch * (sp.g === 'f' ? 1.12 : 0.88) : sp.pitch;
        u.onend = u.onerror = () => resolve();
        speechSynthesis.speak(u);
        // segurança: nunca trava a visita se o evento não vier
        setTimeout(resolve, 600 + s.length * 120);
      });
    }
    if (my === this.token) this.onSpeaking(false);
    return true;
  }
}

/** Extrai o texto "falável" do cartão de um capítulo. */
export function narrationFromHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('.ficha, .rock-column, button').forEach((e) => e.remove());
  const parts = [];
  div.querySelectorAll('.myths > div').forEach((d) => {
    parts.push(`${d.querySelector('b')?.textContent.replace(/"/g, '')}? ${d.querySelector('span')?.textContent}`);
  });
  if (!parts.length) div.querySelectorAll('p, li').forEach((e) => parts.push(e.textContent.trim()));
  return spoken(parts.join(' '));
}

/** Troca símbolos e unidades por palavras, para a voz ler direito. */
export function spoken(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/~/g, 'cerca de ')
    .replace(/×/g, ' vezes ')
    .replace(/(\d)\s?km\/h/g, '$1 quilômetros por hora')
    .replace(/(\d)\s?km/g, '$1 quilômetros')
    .replace(/m\/s²/g, 'metros por segundo ao quadrado')
    .replace(/°C/g, ' graus');
}
