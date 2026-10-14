// Rotas de autenticação (docs/specs/04-api.md, "Rotas" e "Sessão"): login, logout e me.
import { Hono } from 'hono';
import { LoginBody, Me } from '#contracts';
import { ApiError } from '../http/errors.ts';
import type { AppEnv } from '../http/env.ts';
import { readBody } from '../http/validate.ts';
import {
  customerProfiles, findLoginUser, MAX_FAILED_LOGINS, recordLoginFailure, recordLoginSuccess, revokeSession, userScope, type SessionUser,
} from '../repo/users.ts';
import type { Queryable } from '../ports/db.ts';
import { verifyPassword } from './password.ts';
import { areaOf, clearSessionCookie, startSession, type SessionConfig } from './session.ts';

// Hash fixo (mesmos N, r, p do padrão) para o usuário inexistente pagar o mesmo scrypt: o tempo não revela quem existe.
const DUMMY_HASH = 'scrypt$16384$8$1$ZzxGBYRMeERfdacbuu_g0w$qDdtz82MfvZPdQt8BsdOFRFFc0-cTUaiZiGjeyIAbQqSKzTXpXcVQ9i9Ck2uLwA4HJQKYCEdPgTkMd62GymxQw';

export async function buildMe(q: Queryable, user: SessionUser): Promise<Me> {
  const area = areaOf(user.role);
  return Me.parse({
    user: { id: user.userId, username: user.username, displayName: user.displayName, role: user.role },
    area,
    customers: area === 'portal' ? await customerProfiles(q, user.customers) : [],
  });
}

export function authRoutes(cfg: SessionConfig, log: (line: string) => void): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = cfg;

  // Senha errada, usuário inexistente, inativo ou bloqueado: a mesma resposta (401 LOGIN_FAILED) e o mesmo scrypt.
  // O bloqueio só aparece no log do servidor, pelo id do usuário (nunca o nome digitado nem a senha).
  r.post('/login', async (c) => {
    const body = await readBody(c, LoginBody);
    const now = cfg.now();
    const user = await findLoginUser(db, body.username);
    const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.active) throw new ApiError('LOGIN_FAILED');
    if (user.lockedUntil && user.lockedUntil > now) {
      log(`${c.get('requestId')} login recusado: usuário ${user.id} bloqueado até ${user.lockedUntil.toISOString()}`);
      throw new ApiError('LOGIN_FAILED');
    }
    if (!passwordOk) {
      const after = await recordLoginFailure(db, user.id, now);
      if (after.lockedUntil && after.lockedUntil > now) {
        log(`${c.get('requestId')} login: usuário ${user.id} bloqueado até ${after.lockedUntil.toISOString()} após ${MAX_FAILED_LOGINS} erros seguidos`);
      }
      throw new ApiError('LOGIN_FAILED');
    }
    await recordLoginSuccess(db, user.id);
    await startSession(c, cfg, user);
    c.set('logUser', user.username);
    return c.json(await buildMe(db, { userId: user.id, username: user.username, displayName: user.displayName, role: user.role, customers: await userScope(db, user.id) }));
  });

  r.post('/logout', async (c) => {
    await revokeSession(db, c.get('auth').sessionId, cfg.now());
    clearSessionCookie(c, cfg.cookieSecure);
    return c.body(null, 204);
  });

  r.get('/me', async (c) => c.json(await buildMe(db, c.get('auth'))));

  return r;
}
