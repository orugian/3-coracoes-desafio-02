// Aplicação HTTP (docs/specs/04-api.md). Ordem do pipeline: request-id e log; secure-headers; em /v1/*, limite de corpo,
// 415 e checagem de origem nas alterações; sessão (exceto login e health); guarda por prefixo; rotas; estáticos.
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ENGINE_VERSION } from '#engine';
import { authRoutes } from './auth/routes.ts';
import { requireRole, sessionMiddleware, type SessionConfig } from './auth/session.ts';
import type { AppDeps, AppEnv } from './http/env.ts';
import { ApiError } from './http/errors.ts';
import { apiBodyLimit, mutationGuard, requestLog } from './http/pipeline.ts';
import { staticHandler } from './http/static.ts';

export type { AppDeps } from './http/env.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PUBLIC_ROUTES = new Set(['GET /v1/health', 'HEAD /v1/health', 'POST /v1/auth/login']);
const isPublic = (c: Context) => PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`);

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const session: SessionConfig = { db: deps.db, secret: deps.sessionSecret, cookieSecure: deps.cookieSecure ?? false, now: deps.now ?? (() => new Date()) };
  const app = new Hono<AppEnv>();

  app.use('*', requestId(), requestLog(log));
  app.use('*', secureHeaders()); // padrões, sem CSP no corte (a UI do piloto usa scripts inline e Google Fonts)
  app.use('/v1/*', apiBodyLimit(), mutationGuard());
  app.use('/v1/*', sessionMiddleware(session, isPublic));
  app.use('/v1/portal/*', requireRole('ext_distribuidor'));
  app.use('/v1/backoffice/*', requireRole('int_exportacao', 'int_admin'));

  // Sem sessão e sem dado: só confirma que o processo está de pé e qual motor ele usa.
  app.get('/v1/health', (c) => c.json({ ok: true, engineVersion: ENGINE_VERSION }));
  app.route('/v1/auth', authRoutes(session, log));

  app.get('*', staticHandler(deps.staticRoot ?? REPO_ROOT));

  app.notFound((c) => (c.req.path === '/v1' || c.req.path.startsWith('/v1/')
    ? c.json(new ApiError('NOT_FOUND').body(), 404)
    : c.text('Não encontrado', 404)));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.body(), err.status as ContentfulStatusCode);
    log(`${c.get('requestId')} erro interno: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return c.json(new ApiError('INTERNAL').body(), 500);
  });

  return app;
}
