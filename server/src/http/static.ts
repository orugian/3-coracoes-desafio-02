// Estáticos de lista fechada (docs/specs/04-api.md, "Pipeline", passo 7; 05, "Arquivos"). A lista é montada na partida
// a partir de uma raiz fixa: index.html, api-client.js, e os arquivos de vendor/ e assets/ com extensão conhecida
// (sem links simbólicos nem arquivos ocultos). Arquivo novo nessas pastas só é servido depois de reiniciar o servidor.
// O caminho pedido é comparado com a lista depois de normalizado; .., %2e%2e, barra invertida, NUL e caminho absoluto dão 404.
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Context, Handler } from 'hono';
import type { AppEnv } from './env.ts';

export const DEMO_DATA_STUB = 'window.PSF_DEMO = null;'; // o servidor nunca serve o demo-data.js (D8)

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const HTML = 'text/html; charset=utf-8';
const DIRS = ['vendor', 'assets'];

interface StaticFile { file: string; type: string }

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function staticFileList(root: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  const index = path.join(root, 'index.html');
  if (isFile(index)) {
    files.set('/', { file: index, type: HTML });
    files.set('/index.html', { file: index, type: HTML });
  }
  const client = path.join(root, 'api-client.js');
  if (isFile(client)) files.set('/api-client.js', { file: client, type: TYPES['.js'] });

  const walk = (dir: string, urlPrefix: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      const url = `${urlPrefix}/${e.name}`;
      if (e.isDirectory()) walk(abs, url);
      else if (e.isFile()) {
        const type = TYPES[path.extname(e.name).toLowerCase()];
        if (type) files.set(url, { file: abs, type });
      }
    }
  };
  for (const d of DIRS) walk(path.join(root, d), `/${d}`);
  return files;
}

// Caminho da requisição como chegou no socket (no Node, incoming.url): o URL do Request já resolveu %2e%2e e a barra
// invertida, e um pedido de travessia não deve virar outro arquivo da lista. Em app.request (testes), usa o do Request.
function normalizedPath(c: Context): string | null {
  const incoming = (c.env as { incoming?: { url?: string } } | undefined)?.incoming;
  const raw = (incoming?.url ?? new URL(c.req.url).pathname).split(/[?#]/, 1)[0];
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/[\\\0:]/.test(decoded) || decoded.includes('//')) return null;
  if (decoded.split('/').some((s) => s === '.' || s === '..')) return null;
  return decoded;
}

export function staticHandler(root: string): Handler<AppEnv> {
  const files = staticFileList(root);
  return async (c) => {
    if (c.req.path === '/v1' || c.req.path.startsWith('/v1/')) return c.notFound();
    const p = normalizedPath(c);
    if (p === '/demo-data.js') return c.body(DEMO_DATA_STUB, 200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' });
    const f = p === null ? undefined : files.get(p);
    if (!f) return c.notFound();
    let data: Buffer;
    try {
      data = await readFile(f.file);
    } catch {
      return c.notFound(); // apagado depois da partida
    }
    return c.body(new Uint8Array(data), 200, { 'content-type': f.type, 'cache-control': 'no-cache' });
  };
}
