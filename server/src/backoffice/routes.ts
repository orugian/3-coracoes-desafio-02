// API do backoffice (docs/specs/04-api.md, "Rotas", "Máquina de estados" e "Regras transversais"). A guarda por prefixo
// (int_exportacao e int_admin) fica no app; a guarda por ação usa as mesmas funções de domain/permissions.ts que calculam
// OrderView.permissions. Ordem das recusas nas ações: 403 do papel, 422 do corpo, 404, 409 de transição, 403 de
// segregação (aprovação), 409 de versão, 422 das mudanças (nova versão) ou 409 de bloqueio (aprovação).
import { Hono, type Context } from 'hono';
import {
  ApproveBody, BackofficeCustomers, BackofficeOrdersQuery, BackofficeOrderView, BackofficeProducts, BackofficeVersionBody, CustomerInternal, RulesBody,
} from '#contracts';
import { uniqueViolation, type Db, type Queryable } from '../ports/db.ts';
import { requireRole } from '../auth/session.ts';
import { canApprove, canEdit, isCreatorOrAuthor } from '../domain/permissions.ts';
import { ApiError } from '../http/errors.ts';
import type { AppEnv } from '../http/env.ts';
import { parseInput, readBody } from '../http/validate.ts';
import { EXPORT_CHANNEL, FULL_AT } from '../repo/catalog.ts';
import { allCustomerCodes, customerInternal, ruleChanges, setCustomerRules } from '../repo/customers.ts';
import { currentVersionOf, insertEvent, insertVersion, loadOrder, loadOrders, lockOrder, type OrderData } from '../repo/orders.ts';
import { productsInternal, vehicles } from '../repo/products.ts';
import { applyChanges, blockDetails, checkKnownMaterials, computeVersion, LEAD_DAYS, sameResult, storedResult } from '../orders/compute.ts';
import { orderAccess, orderView } from '../orders/views.ts';

interface BackofficeDeps { db: Db; now: () => Date }

const VERSION_PK = 'order_version_pkey';

const versionConflict = (currentVersion: number | null) =>
  new ApiError('VERSION_CONFLICT', { details: [{ code: 'VERSION_CONFLICT', params: { currentVersion } }] });

export function backofficeRoutes(deps: BackofficeDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = deps;

  const detail = async (c: Context<AppEnv>, id: string) => {
    const data = await loadOrder(db, id);
    if (!data) throw new ApiError('NOT_FOUND');
    return BackofficeOrderView.parse(orderView(data, c.get('auth'), 'backoffice', true));
  };

  // Trava o pedido e relê tudo dentro da transação; o estado e a versão vêm da leitura travada.
  const lockAndLoad = async (q: Queryable, id: string): Promise<OrderData> => {
    const locked = await lockOrder(q, id);
    if (!locked) throw new ApiError('NOT_FOUND');
    const data = await loadOrder(q, id);
    if (!data) throw new ApiError('NOT_FOUND');
    return data;
  };

  // Outra ação gravou a mesma versão no meio (PK de order_version): 409 com a versão atual, nunca 500.
  const translateConflict = async (id: string, err: unknown): Promise<never> => {
    if (uniqueViolation(err) === VERSION_PK) throw versionConflict(await currentVersionOf(db, id));
    throw err;
  };

  r.get('/customers', async (c) => {
    const customers = [];
    for (const code of await allCustomerCodes(db)) customers.push(await customerInternal(db, code));
    return c.json(BackofficeCustomers.parse({ customers, ruleChanges: await ruleChanges(db, 50) }));
  });

  // Regras do cliente (D5): int_exportacao e int_admin, com registro em customer_rule_change.
  r.put('/customers/:code/rules', async (c) => {
    const auth = c.get('auth');
    const rules = await readBody(c, RulesBody);
    const code = c.req.param('code');
    const found = await db.tx((q) => setCustomerRules(q, code, rules, auth.userId, deps.now()));
    if (!found) throw new ApiError('NOT_FOUND');
    return c.json(CustomerInternal.parse(await customerInternal(db, code)));
  });

  r.get('/products', async (c) => c.json(BackofficeProducts.parse({
    items: await productsInternal(db, EXPORT_CHANNEL),
    vehicles: await vehicles(db),
    rules: { fullAt: FULL_AT, leadDays: LEAD_DAYS },
  })));

  r.get('/orders', async (c) => {
    const query = parseInput(BackofficeOrdersQuery, {
      status: c.req.query('status') || undefined, customer: c.req.query('customer') || undefined, q: c.req.query('q') || undefined,
    });
    const list = await loadOrders(db, { status: query.status, customer: query.customer, search: query.q });
    return c.json(BackofficeOrderView.array().parse(list.map((d) => orderView(d, c.get('auth'), 'backoffice', false))));
  });

  r.get('/orders/:id', async (c) => c.json(await detail(c, c.req.param('id'))));

  // Nova versão (SUBMITTED → SUBMITTED, versão + 1): só int_exportacao; a versão pode ter BLOCK (ajuste em andamento).
  r.post('/orders/:id/versions', requireRole('int_exportacao'), async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = await readBody(c, BackofficeVersionBody);
    const now = deps.now();
    await db.tx(async (q) => {
      const data = await lockAndLoad(q, id);
      const access = orderAccess(data);
      if (access.status !== 'SUBMITTED') throw new ApiError('INVALID_TRANSITION');
      if (!canEdit(auth, access)) throw new ApiError('FORBIDDEN');
      if (body.expectedVersion !== data.order.current_version) throw versionConflict(data.order.current_version);

      const current = data.versions.find((v) => v.version_no === data.order.current_version)!;
      const { lines, changes } = applyChanges(current.lines, body.changes);
      await checkKnownMaterials(q, data.order.customer_code, changes.filter((ch) => ch.new > 0).map((ch) => ({ material: ch.material, boxes: ch.new })));
      const header = { vehicleId: current.vehicle_id, loadMode: current.load_mode, reference: current.customer_reference, loadingDate: current.loading_date };
      const v = await computeVersion(q, data.order.customer_code, header, lines, now);
      const versionNo = data.order.current_version + 1;
      const reason = body.reason ? body.reason : null;
      await insertVersion(q, {
        orderId: id, versionNo, vehicleId: v.header.vehicleId, loadMode: v.header.loadMode, mixedPallet: v.header.mixedPallet,
        reference: v.header.reference, loadingDate: v.header.loadingDate, lines: v.lines, result: v.result,
        inputs: { priceDate: v.priceDate, vehicleId: v.header.vehicleId, customerCode: data.order.customer_code },
        dataBatches: v.dataBatches, overrides: v.overrides, contentHash: v.contentHash,
        authorId: auth.userId, authorLabel: auth.displayName, reason, at: now,
      });
      await insertEvent(q, {
        orderId: id, at: now, actorId: auth.userId, actorLabel: auth.displayName, type: 'VERSION_CREATED', from: 'SUBMITTED', to: 'SUBMITTED',
        versionNo, payload: reason ? { changes, reason } : { changes },
      });
      await q.query('update sales_order set current_version = $2, updated_at = $3 where id = $1', [id, versionNo, now]);
    }).catch((err: unknown) => translateConflict(id, err));
    return c.json(await detail(c, id));
  });

  // Aprovação (SUBMITTED → APPROVED): aprova a versão atual como gravada; o recálculo com os dados de agora é só guarda.
  r.post('/orders/:id/approve', requireRole('int_exportacao'), async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = await readBody(c, ApproveBody);
    const now = deps.now();
    await db.tx(async (q) => {
      const data = await lockAndLoad(q, id);
      const access = orderAccess(data);
      if (access.status !== 'SUBMITTED') throw new ApiError('INVALID_TRANSITION');
      if (isCreatorOrAuthor(auth, access)) throw new ApiError('SELF_APPROVAL_FORBIDDEN');
      if (!canApprove(auth, access)) throw new ApiError('FORBIDDEN');
      if (body.expectedVersion !== data.order.current_version) throw versionConflict(data.order.current_version);

      const current = data.versions.find((v) => v.version_no === data.order.current_version)!;
      const result = storedResult(current.engine_result);
      if (current.blocking || result.blocking) throw new ApiError('ORDER_BLOCKED', { status: 409, details: blockDetails(result) });
      const header = { vehicleId: current.vehicle_id, loadMode: current.load_mode, reference: current.customer_reference, loadingDate: current.loading_date };
      const recalculated = await computeVersion(q, data.order.customer_code, header, current.lines, now, { mixedPallet: current.mixed_pallet });
      if (recalculated.result.blocking) {
        throw new ApiError('ORDER_BLOCKED', {
          status: 409,
          message: 'Com os dados de hoje, esta versão tem bloqueios. Crie uma nova versão antes de aprovar.',
          details: blockDetails(recalculated.result),
        });
      }
      const resultChanged = !sameResult(recalculated.result, result);
      // Mesmo formato do seed (03, "Pedidos de exemplo").
      await insertEvent(q, {
        orderId: id, at: now, actorId: auth.userId, actorLabel: auth.displayName, type: 'APPROVED', from: 'SUBMITTED', to: 'APPROVED',
        versionNo: current.version_no,
        payload: {
          internal: {
            contentHash: current.content_hash, recalculatedContentHash: recalculated.contentHash, recalculatedBlocking: recalculated.result.blocking,
            resultChanged, ...(resultChanged ? { recalculatedResult: recalculated.result } : {}),
          },
        },
      });
      await q.query(`update sales_order set status = 'APPROVED', updated_at = $2 where id = $1`, [id, now]);
    });
    return c.json(await detail(c, id));
  });

  return r;
}
