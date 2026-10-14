// Pipeline de cada requisição (docs/specs/04-api.md, "Pipeline"): log de uma linha e, em /v1/*, as checagens das alterações.
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ApiError } from './errors.ts';
import type { AppEnv, AuthUser } from './env.ts';

export const BODY_LIMIT_BYTES = 64 * 1024;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_TYPE = /^application\/json\s*(?:;|$)/i;

// id, usuário, método e rota, status, ms. Nunca o corpo (o de /v1/auth/login tem a senha) nem a query.
export function requestLog(log: (line: string) => void): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const auth = c.get('auth') as AuthUser | undefined;
    const user = auth?.username ?? (c.get('logUser') as string | undefined) ?? '-';
    const route = c.req.path.replace(/[^\x21-\x7e\u00a0-\uffff]/g, '?'); // sem quebra de linha forjada no log
    log(`${c.get('requestId')} ${user} ${c.req.method} ${route} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
  };
}

export const apiBodyLimit = (): MiddlewareHandler<AppEnv> =>
  bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: (c) => c.json(new ApiError('PAYLOAD_TOO_LARGE').body(), 413) });

// D13: alteração só com application/json (415) e da própria origem (403). Sem hono/csrf, que em 4.13.13 só age em
// Content-Type de formulário e text/plain. Sem CORS: um JSON de outra origem morre no preflight.
export function mutationGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      if (!JSON_TYPE.test(c.req.header('content-type') ?? '')) throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
      if (!sameOrigin(c)) throw new ApiError('FORBIDDEN', { message: 'Alteração recusada: a requisição não veio desta origem.' });
    }
    return next();
  };
}

// Passa se Sec-Fetch-Site for same-origin ou, na ausência dele (navegador antigo, curl), se Origin for a do servidor.
function sameOrigin(c: Context): boolean {
  const site = c.req.header('sec-fetch-site');
  if (site !== undefined) return site === 'same-origin';
  const origin = c.req.header('origin');
  return origin !== undefined && origin === new URL(c.req.url).origin;
}
