// Apoio aos testes de rota (docs/specs/04-api.md, "Testes do servidor"): PGlite em memória com o seed completo e
// requisições por app.request() com cookie real. Um banco por arquivo de teste (cada PGlite novo leva ~2 s).
import assert from 'node:assert/strict';
import { createApp, type AppDeps } from '#server/app.ts';
import { createPgliteDb } from '#server/adapters/db/pglite.ts';
import type { Db } from '#server/ports/db.ts';
import { migrate } from '#server/db/migrate.ts';
import { hashPassword } from '#server/auth/password.ts';
import { seed } from '../../../db/seed/seed.ts';

export const PASSWORD = 'senha-de-teste-da-api';
export const SECRET = 'segredo-de-teste-da-api-com-mais-de-32-bytes';
export const ORIGIN = 'http://localhost'; // origem de app.request('/caminho')

export async function seededDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  await seed(db, { password: PASSWORD, log: () => undefined });
  return db;
}

export interface TestApp { app: ReturnType<typeof createApp>; logs: string[] }

export function testApp(db: Db, overrides: Partial<AppDeps> = {}): TestApp {
  const logs: string[] = [];
  const app = createApp({ db, sessionSecret: SECRET, cookieSecure: false, log: (line) => logs.push(line), ...overrides });
  return { app, logs };
}

// Usuário extra para testes que alteram o próprio usuário (bloqueio, desativação, troca de papel), sem tocar nos do seed.
export async function createUser(db: Db, username: string, role: string, customers: string[] = []): Promise<number> {
  const hash = await hashPassword(PASSWORD);
  const { rows: [{ id }] } = await db.query<{ id: number }>(
    `insert into app_user (username, display_name, role, password_hash) values ($1, $1, $2, $3) returning id`, [username, role, hash]);
  for (const code of customers) await db.query('insert into user_customer_scope (user_id, customer_code) values ($1, $2)', [id, code]);
  return id;
}

export interface RequestOptions { body?: unknown; rawBody?: string; headers?: Record<string, string>; sameOrigin?: boolean }

type Fetcher = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

// Cabeçalhos de uma chamada do próprio front (mesma origem) com JSON.
export function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
}

export function call(app: Fetcher, method: string, path: string, cookie: string | null, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const mutating = method !== 'GET' && method !== 'HEAD';
  if (mutating && opts.sameOrigin !== false) Object.assign(headers, jsonHeaders());
  if (cookie) headers.cookie = cookie;
  Object.assign(headers, opts.headers);
  const body = opts.rawBody ?? (opts.body === undefined ? (mutating ? '{}' : undefined) : JSON.stringify(opts.body));
  return Promise.resolve(app.request(path, { method, headers, body }));
}

export interface SetCookie { name: string; value: string; attrs: Map<string, string> }

export function setCookie(res: Response): SetCookie | null {
  const [raw] = res.headers.getSetCookie();
  if (!raw) return null;
  const [pair, ...rest] = raw.split(';').map((s) => s.trim());
  const eq = pair.indexOf('=');
  const attrs = new Map(rest.map((a) => {
    const i = a.indexOf('=');
    return i === -1 ? [a.toLowerCase(), ''] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)];
  }));
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
}

// Sessão de um usuário: guarda o cookie psf_session devolvido pelo login.
export class Client {
  cookie: string | null = null;
  me: unknown = null;
  readonly app: Fetcher;
  constructor(app: Fetcher) {
    this.app = app;
  }

  static async login(app: Fetcher, username: string, password = PASSWORD): Promise<Client> {
    const client = new Client(app);
    const res = await client.post('/v1/auth/login', { username, password });
    assert.equal(res.status, 200, `login de ${username}`);
    client.me = await res.json();
    return client;
  }

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const res = await call(this.app, method, path, this.cookie, opts);
    const c = setCookie(res);
    if (c?.name === 'psf_session') this.cookie = c.value && c.attrs.get('max-age') !== '0' ? `psf_session=${c.value}` : null;
    return res;
  }

  get(path: string, opts?: RequestOptions) { return this.request('GET', path, opts); }
  post(path: string, body?: unknown, opts: RequestOptions = {}) { return this.request('POST', path, { ...opts, body }); }
  put(path: string, body?: unknown, opts: RequestOptions = {}) { return this.request('PUT', path, { ...opts, body }); }
}

export async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code?: string } };
  return body.error?.code;
}

// Resposta do portal validada pelo schema estrito (04, teste de isolamento 4): um campo fora do contrato falha aqui.
export async function strictJson<S extends { parse: (v: unknown) => unknown }>(res: Response, schema: S): Promise<ReturnType<S['parse']>> {
  return schema.parse(await res.json()) as ReturnType<S['parse']>;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Todos os caminhos de chave de um JSON (a.b.0.c vira a.b.c), para procurar campo interno em qualquer nível.
export function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyPaths(v, prefix));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return [p, ...keyPaths(v, p)];
  });
}

let keySeq = 0;
export const newKey = (label = 'k') => `${label}-${process.pid}-${Date.now()}-${++keySeq}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
