// Página do index.html num navegador simulado (happy-dom 21.0.1), para os testes de fumaça do 05 ("Aceite").
// O happy-dom embrulha cada <script> numa função, o que quebra o compartilhamento de const/class entre scripts que o
// navegador faz; por isso a avaliação de JavaScript dele fica desligada e os três scripts (demo-data.js, api-client.js e o
// script da aplicação) rodam com vm.runInContext no contexto da própria janela, como scripts clássicos de verdade.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { API_CLIENT, DEMO_DATA, ROOT } from './helpers.ts';

export const INDEX_HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
export const DEMO_STUB = 'window.PSF_DEMO = null;'; // o que o servidor responde em /demo-data.js

// O script da aplicação: o <script> inline que define o calc().
export function appScript(html = INDEX_HTML): string {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const app = blocks.find((b) => /\nfunction calc\(/.test(b));
  if (!app) throw new Error('script da aplicação não encontrado no index.html');
  return app;
}

export interface PageOptions {
  demo: boolean;
  url?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  // Conteúdo dos arquivos como o servidor entrega (padrão: os do repositório; no demo, o demo-data.js de verdade).
  sources?: { html: string; demoData: string; apiClient: string };
  storage?: Record<string, string>; // localStorage inicial (simula a mesma aba depois de recarregar)
}

export interface Page {
  window: Window;
  errors: unknown[];
  run<T = any>(code: string): T;
  settle(): Promise<void>;
  until(expr: string, ms?: number): Promise<void>;
  click(selector: string): Promise<void>;
  change(selector: string, value: string | boolean): Promise<void>;
  close(): Promise<void>;
  storage(): Record<string, string>;
}

export function openPage(opts: PageOptions): Page {
  const window = new Window({
    url: opts.url ?? (opts.demo ? 'file:///C:/3c-conecta/index.html' : 'http://localhost:3000/'),
    width: 1280,
    height: 900,
    settings: {
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: { disableMainFrameNavigation: true },
    },
  });
  const errors: unknown[] = [];
  window.addEventListener('error', (e) => { errors.push((e as unknown as { error?: unknown; message?: string }).error ?? (e as unknown as { message?: string }).message); });
  if (opts.fetch) (window as unknown as { fetch: unknown }).fetch = opts.fetch;
  for (const [k, v] of Object.entries(opts.storage ?? {})) window.localStorage.setItem(k, v);
  const src = opts.sources ?? { html: INDEX_HTML, demoData: opts.demo ? DEMO_DATA : DEMO_STUB, apiClient: API_CLIENT };
  window.document.write(src.html);
  if (!vm.isContext(window)) vm.createContext(window);
  const run = <T = any>(code: string, filename = 'eval.js'): T => vm.runInContext(code, window as unknown as vm.Context, { filename }) as T;
  run(src.demoData, 'demo-data.js');
  run(src.apiClient, 'api-client.js');
  run(appScript(src.html), 'index.html');

  // Microtarefas e timers de zero: o suficiente para os tratadores assíncronos (await API.*) terminarem.
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  const el = (selector: string) => {
    const found = window.document.querySelector(selector);
    if (!found) throw new Error(`elemento não encontrado: ${selector}`);
    return found as unknown as { click(): void; value: string; checked: boolean; dispatchEvent(e: unknown): boolean };
  };
  return {
    window,
    errors,
    run,
    settle,
    async until(expr, ms = 10_000) {
      const end = Date.now() + ms;
      while (!run<boolean>(expr)) {
        if (Date.now() > end) throw new Error(`tempo esgotado esperando: ${expr}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    async click(selector) { el(selector).click(); await settle(); },
    async change(selector, value) {
      const input = el(selector);
      if (typeof value === 'boolean') input.checked = value; else input.value = value;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await settle();
    },
    async close() { await window.happyDOM.close(); },
    storage() {
      const out: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)!;
        out[k] = window.localStorage.getItem(k)!;
      }
      return out;
    },
  };
}
