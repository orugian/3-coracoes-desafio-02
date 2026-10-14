// Contexto de execução do api-client.js fora do navegador (docs/specs/05-integracao-web.md, "Aceite"): o arquivo é um
// script clássico que só define window.PSF; aqui ele roda num contexto vm próprio, com fetch e localStorage falsos.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const API_CLIENT = readFileSync(path.join(ROOT, 'api-client.js'), 'utf8');
export const DEMO_DATA = readFileSync(path.join(ROOT, 'demo-data.js'), 'utf8');

// Objetos de outro contexto vm têm outro Object.prototype: o deepStrictEqual compara protótipos, então o teste
// compara a cópia em JSON.
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export interface FakeCall { method: string; url: string; headers: Record<string, string>; body: unknown }
export type FakeRoute = (call: FakeCall) => { status: number; body?: unknown } | undefined;

// fetch falso: registra as chamadas e responde pela primeira rota que devolver algo (senão 404).
export function fakeFetch(routes: FakeRoute[]) {
  const calls: FakeCall[] = [];
  const fetch = async (input: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call: FakeCall = { method: init.method ?? 'GET', url: String(input), headers, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call);
    const hit = routes.map((r) => r(call)).find((x) => x !== undefined) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Não encontrado.' } } };
    return new Response(hit.body === undefined ? null : JSON.stringify(hit.body), {
      status: hit.status,
      headers: hit.body === undefined ? {} : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

export function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

// Carrega api-client.js (e, se pedido, o demo-data.js antes, como na ordem dos scripts do index.html).
export function loadClient(globals: Record<string, unknown> = {}, opts: { demo?: boolean } = {}) {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, ...globals }) as Record<string, any>;
  ctx.window = ctx;
  if (opts.demo) vm.runInContext(DEMO_DATA, ctx, { filename: 'demo-data.js' });
  vm.runInContext(API_CLIENT, ctx, { filename: 'api-client.js' });
  return ctx;
}

// A classe de erro do piloto (index.html): ApiError(status, msg, details).
export class PilotApiError extends Error {
  status: number;
  details: unknown[];
  code?: string;
  constructor(status: number, msg: string, details?: unknown[]) {
    super(msg);
    this.status = status;
    this.details = details ?? [];
  }
}
