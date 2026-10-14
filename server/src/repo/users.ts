// Usuários, sessões e escopo (docs/specs/04-api.md, "Sessão"). Tudo o que decide acesso é lido aqui, do banco (D12).
import type { CustomerProfile, Role } from '#contracts';
import type { Queryable } from '../ports/db.ts';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export interface LoginUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  lockedUntil: Date | null;
}

export async function findLoginUser(q: Queryable, username: string): Promise<LoginUser | null> {
  const { rows: [u] } = await q.query<{
    id: number; username: string; display_name: string; role: Role; password_hash: string; active: boolean; locked_until: Date | null;
  }>('select id, username, display_name, role, password_hash, active, locked_until from app_user where username = $1', [username]);
  return u ? {
    id: Number(u.id), username: u.username, displayName: u.display_name, role: u.role, passwordHash: u.password_hash,
    active: u.active, lockedUntil: u.locked_until,
  } : null;
}

export async function userScope(q: Queryable, userId: number): Promise<string[]> {
  const { rows } = await q.query<{ customer_code: string }>(
    'select customer_code from user_customer_scope where user_id = $1 order by customer_code', [userId]);
  return rows.map((r) => r.customer_code);
}

// Senha errada: soma 1 (ou recomeça de 1 se o bloqueio anterior já venceu) e bloqueia no 5º erro seguido.
// Aritmética no SQL: duas tentativas simultâneas não perdem incremento.
export async function recordLoginFailure(q: Queryable, userId: number, now: Date): Promise<{ failedLogins: number; lockedUntil: Date | null }> {
  const { rows: [r] } = await q.query<{ failed_logins: number; locked_until: Date | null }>(
    `update app_user set
       failed_logins = case when locked_until is not null and locked_until <= $2 then 1 else failed_logins + 1 end,
       locked_until = case
         when locked_until is not null and locked_until <= $2 then null
         when failed_logins + 1 >= $3 then $2::timestamptz + make_interval(mins => $4)
         else locked_until end
     where id = $1
     returning failed_logins, locked_until`,
    [userId, now, MAX_FAILED_LOGINS, LOCK_MINUTES]);
  return { failedLogins: Number(r.failed_logins), lockedUntil: r.locked_until };
}

export async function recordLoginSuccess(q: Queryable, userId: number): Promise<void> {
  await q.query('update app_user set failed_logins = 0, locked_until = null where id = $1', [userId]);
}

// npm run user:unlock -- <usuario>. Devolve false se o usuário não existir.
export async function unlockUser(q: Queryable, username: string): Promise<boolean> {
  const { rows } = await q.query('update app_user set failed_logins = 0, locked_until = null where username = $1 returning id', [username]);
  return rows.length > 0;
}

export async function createSession(
  q: Queryable, s: { id: string; userId: number; createdAt: Date; expiresAt: Date; ip: string | null; userAgent: string | null },
): Promise<void> {
  await q.query(
    'insert into app_session (id, user_id, created_at, expires_at, ip, user_agent) values ($1, $2, $3, $4, $5, $6)',
    [s.id, s.userId, s.createdAt, s.expiresAt, s.ip, s.userAgent]);
}

export async function revokeSession(q: Queryable, sessionId: string, now: Date): Promise<void> {
  await q.query('update app_session set revoked_at = $2 where id = $1 and revoked_at is null', [sessionId, now]);
}

export interface SessionUser { userId: number; username: string; displayName: string; role: Role; customers: string[] }

// Sessão existente, não revogada, não expirada e de usuário ativo; papel e escopo do banco.
export async function loadSessionUser(q: Queryable, sessionId: string, now: Date): Promise<SessionUser | null> {
  const { rows: [r] } = await q.query<{ user_id: number; username: string; display_name: string; role: Role }>(
    `select s.user_id, u.username, u.display_name, u.role
       from app_session s join app_user u on u.id = s.user_id
      where s.id = $1 and s.revoked_at is null and s.expires_at > $2 and u.active`,
    [sessionId, now]);
  if (!r) return null;
  const userId = Number(r.user_id);
  return { userId, username: r.username, displayName: r.display_name, role: r.role, customers: await userScope(q, userId) };
}

interface CustomerRow {
  code: string; slug: string; name: string; destination_label: string; currency: string; incoterm: string; payment_code: string;
  payment_terms: string; price_list: string; plant: string; plant_name: string; branch: string; contact_name: string | null;
  language: 'pt' | 'es' | 'en'; mixed_pallet: boolean;
}

export const toCustomerProfile = (r: CustomerRow): CustomerProfile => ({
  code: r.code, slug: r.slug, name: r.name, destinationLabel: r.destination_label, currency: r.currency, incoterm: r.incoterm,
  paymentCode: r.payment_code, paymentTerms: r.payment_terms, priceList: r.price_list, plant: r.plant, plantName: r.plant_name,
  branch: r.branch, contactName: r.contact_name, language: r.language, mixedPallet: r.mixed_pallet,
});

export const CUSTOMER_PROFILE_COLUMNS = `c.code, c.slug, c.name, c.destination_label, c.currency, c.incoterm, c.payment_code, c.payment_terms,
  c.price_list, b.plant, b.plant_name, c.branch, c.contact_name, c.language, c.mixed_pallet`;

export async function customerProfiles(q: Queryable, codes: string[]): Promise<CustomerProfile[]> {
  if (codes.length === 0) return [];
  const { rows } = await q.query<CustomerRow>(
    `select ${CUSTOMER_PROFILE_COLUMNS} from customer c join branch_plant b on b.branch = c.branch where c.code = any($1::text[]) order by c.code`,
    [codes]);
  return rows.map(toCustomerProfile);
}
