// API do backoffice (docs/specs/04-api.md, "Rotas"). A guarda por prefixo (int_exportacao e int_admin) fica no app;
// a guarda por ação (matriz) fica em cada rota.
import { Hono } from 'hono';
import { CustomerInternal, RulesBody } from '#contracts';
import type { Db } from '../ports/db.ts';
import { ApiError } from '../http/errors.ts';
import type { AppEnv } from '../http/env.ts';
import { readBody } from '../http/validate.ts';
import { customerInternal, setCustomerRules } from '../repo/customers.ts';

interface BackofficeDeps { db: Db; now: () => Date }

export function backofficeRoutes(deps: BackofficeDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = deps;

  // Regras do cliente (D5): int_exportacao e int_admin, com registro em customer_rule_change.
  r.put('/customers/:code/rules', async (c) => {
    const auth = c.get('auth');
    const rules = await readBody(c, RulesBody);
    const code = c.req.param('code');
    const found = await db.tx((q) => setCustomerRules(q, code, rules, auth.userId, deps.now()));
    if (!found) throw new ApiError('NOT_FOUND');
    return c.json(CustomerInternal.parse(await customerInternal(db, code)));
  });

  return r;
}
