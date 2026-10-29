// Chrome sem janela controlado pelo protocolo de depuração (para os testes da versão web)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitHttp(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await sleep(100);
  }
  throw new Error(`sem resposta de ${url}`);
}

/** abre o Chrome sem janela em `url`; devolve { eval, close, logs } */
export async function openPage(url, { port = 9333, width = 640, height = 360 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'portal3-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  const list = await (await waitHttp(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEÇÃO ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  /** roda `code` (corpo de função async) na página e devolve o valor */
  const evaluate = async (code) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const close = async () => {
    try { ws.close(); } catch {}
    const gone = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
    rmSync(dir, { recursive: true, force: true });
  };
  return { evaluate, close, logs };
}
