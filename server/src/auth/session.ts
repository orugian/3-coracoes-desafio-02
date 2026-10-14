// Sessão (docs/specs/04-api.md, "Sessão"): cookie psf_session com token HS256 (hono/jwt) e linha em app_session.
// A cada requisição: token válido E sessão existente, não revogada, não expirada, de usuário ativo; papel e escopo do banco (D12).
import { randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import type { Role } from '#contracts';
import { ApiError } from '../http/errors.ts';
import type { AppEnv } from '../http/env.ts';
import { createSession, loadSessionUser } from '../repo/users.ts';
import type { Db } from '../ports/db.ts';

export const SESSION_COOKIE = 'psf_session';
export const SESSION_SECONDS = 8 * 60 * 60;

export const areaOf = (role: Role): 'portal' | 'backoffice' => (role === 'ext_distribuidor' ? 'portal' : 'backoffice');

export interface SessionConfig { db: Db; secret: string; cookieSecure: boolean; now: () => Date }

const cookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: 'Strict' as const, path: '/', secure });

export function clearSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(secure));
}

function clientIp(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

// Cria a sessão e grava o cookie. As claims sub e role são as que o Cognito vai emitir na fase 2 (§5).
export async function startSession(c: Context, cfg: SessionConfig, user: { id: number; role: Role }): Promise<string> {
  const now = cfg.now();
  const sid = randomBytes(32).toString('base64url');
  const iat = Math.floor(now.getTime() / 1000);
  await createSession(cfg.db, {
    id: sid, userId: user.id, createdAt: now, expiresAt: new Date((iat + SESSION_SECONDS) * 1000),
    ip: clientIp(c), userAgent: c.req.header('user-agent')?.slice(0, 256) ?? null,
  });
  const token = await sign({ sub: String(user.id), role: user.role, sid, iat, exp: iat + SESSION_SECONDS }, cfg.secret, 'HS256');
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(cfg.cookieSecure), maxAge: SESSION_SECONDS });
  return sid;
}

// Middleware de sessão para /v1/*, exceto as rotas públicas. Qualquer falha: 401 e cookie apagado.
export function sessionMiddleware(cfg: SessionConfig, isPublic: (c: Context) => boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isPublic(c)) return next();
    const token = getCookie(c, SESSION_COOKIE);
    let auth = null;
    if (token) {
      try {
        // Assinatura e algoritmo pelo hono/jwt; exp e iat pelo relógio da aplicação (o mesmo da sessão no banco).
        const payload = await verify(token, cfg.secret, { alg: 'HS256', exp: false, iat: false, nbf: false });
        const nowSec = Math.floor(cfg.now().getTime() / 1000);
        const timeOk = typeof payload.exp === 'number' && payload.exp > nowSec && typeof payload.iat === 'number' && payload.iat <= nowSec + 60;
        const user = timeOk && typeof payload.sid === 'string' && typeof payload.sub === 'string'
          ? await loadSessionUser(cfg.db, payload.sid, cfg.now())
          : null;
        if (user && String(user.userId) === payload.sub) auth = { ...user, sessionId: payload.sid as string };
      } catch {
        auth = null; // assinatura ou algoritmo inválidos
      }
    }
    if (!auth) {
      clearSessionCookie(c, cfg.cookieSecure);
      throw new ApiError('UNAUTHENTICATED');
    }
    c.set('auth', auth);
    return next();
  };
}

// Guarda por papel (prefixo ou ação). O papel é o do banco, relido pelo middleware de sessão.
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get('auth').role)) throw new ApiError('FORBIDDEN');
    return next();
  };
}
