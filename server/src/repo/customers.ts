// Clientes: visão interna e regras comerciais (docs/specs/04-api.md, CustomerInternal e PUT .../rules; D5).
import type { CustomerInternal, RulesBody } from '#contracts';
import type { Queryable } from '../ports/db.ts';
import { restrictedMaterials } from './catalog.ts';
import { CUSTOMER_PROFILE_COLUMNS, toCustomerProfile } from './users.ts';

type InternalRow = Parameters<typeof toCustomerProfile>[0] & { country: string | null; auto_approve: boolean; is_demo: boolean };

export async function customerInternal(q: Queryable, code: string): Promise<CustomerInternal | null> {
  const { rows: [r] } = await q.query<InternalRow>(
    `select ${CUSTOMER_PROFILE_COLUMNS}, c.country, c.auto_approve, c.is_demo
       from customer c join branch_plant b on b.branch = c.branch where c.code = $1`,
    [code]);
  if (!r) return null;
  return { ...toCustomerProfile(r), country: r.country, autoApprove: r.auto_approve, isDemo: r.is_demo, restrictedMaterials: await restrictedMaterials(q, code) };
}

export async function allCustomerCodes(q: Queryable): Promise<string[]> {
  return (await q.query<{ code: string }>('select code from customer order by code')).rows.map((r) => r.code);
}

// Aplica as regras numa transação já aberta: trava o cliente, grava só o que muda e registra cada mudança com o ator.
// false = cliente inexistente.
export async function setCustomerRules(q: Queryable, code: string, rules: RulesBody, actorId: number, now: Date): Promise<boolean> {
  const { rows: [current] } = await q.query<{ mixed_pallet: boolean; auto_approve: boolean }>(
    'select mixed_pallet, auto_approve from customer where code = $1 for update', [code]);
  if (!current) return false;
  const changes: ['mixed_pallet' | 'auto_approve', boolean, boolean | undefined][] = [
    ['mixed_pallet', current.mixed_pallet, rules.mixedPallet],
    ['auto_approve', current.auto_approve, rules.autoApprove],
  ];
  for (const [field, oldValue, newValue] of changes) {
    if (newValue === undefined || newValue === oldValue) continue;
    await q.query(`update customer set ${field} = $2 where code = $1`, [code, newValue]);
    await q.query(
      'insert into customer_rule_change (customer_code, field, old_value, new_value, actor_id, at) values ($1, $2, $3, $4, $5, $6)',
      [code, field, oldValue, newValue, actorId, now]);
  }
  return true;
}

// Última mudança que ligou a aprovação automática (vai no evento AUTO_APPROVED).
export async function lastAutoApproveChange(q: Queryable, code: string): Promise<number | null> {
  const { rows: [r] } = await q.query<{ id: number }>(
    `select id from customer_rule_change where customer_code = $1 and field = 'auto_approve' and new_value order by id desc limit 1`, [code]);
  return r ? Number(r.id) : null;
}
