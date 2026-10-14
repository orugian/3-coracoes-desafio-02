// API do portal do distribuidor (docs/specs/04-api.md, "Rotas"): catálogo, simulação e pedidos. A guarda por prefixo
// (só ext_distribuidor) fica no app; aqui, o escopo de cliente, sempre o do banco (fora dele, 404).
import { Hono, type Context } from 'hono';
import { EngineResult, IdempotencyKey, ListOrdersQuery, OrderBody, PortalCatalog, PortalOrderView } from '#contracts';
import { uniqueViolation, type Db } from '../ports/db.ts';
import { saoPauloDate } from '../domain/time.ts';
import { ApiError } from '../http/errors.ts';
import type { AppEnv, AuthUser } from '../http/env.ts';
import { parseInput, readBody } from '../http/validate.ts';
import { customerPrices, FULL_AT, restrictedMaterials } from '../repo/catalog.ts';
import { lastAutoApproveChange } from '../repo/customers.ts';
import { findByIdempotencyKey, insertEvent, insertVersion, loadOrder, loadOrders, nextOrderId } from '../repo/orders.ts';
import { catalogItems, vehicles } from '../repo/products.ts';
import { customerProfiles } from '../repo/users.ts';
import { blockDetails, checkLines, checkLoadingDate, computeVersion, isFullLoad, LEAD_DAYS, requestHash } from '../orders/compute.ts';
import { AUTO_APPROVAL_LABEL, orderView } from '../orders/views.ts';

const IDEMPOTENCY_CONSTRAINT = 'sales_order_customer_code_idempotency_key_key';

interface PortalDeps { db: Db; now: () => Date }

// Cliente do escopo; fora dele (ou inexistente), 404 sem revelar se existe.
function scopedCustomer(auth: AuthUser, code: string): string {
  if (!auth.customers.includes(code)) throw new ApiError('NOT_FOUND');
  return code;
}

export function portalRoutes(deps: PortalDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const { db } = deps;

  const detail = async (c: Context<AppEnv>, id: string) => {
    const data = await loadOrder(db, id);
    if (!data || !c.get('auth').customers.includes(data.order.customer_code)) throw new ApiError('NOT_FOUND');
    return PortalOrderView.parse(orderView(data, c.get('auth'), 'portal', true));
  };

  r.get('/catalog', async (c) => {
    const auth = c.get('auth');
    const param = c.req.query('customer');
    let code: string;
    if (param) code = scopedCustomer(auth, param);
    else if (auth.customers.length === 1) code = auth.customers[0];
    else if (auth.customers.length === 0) throw new ApiError('NOT_FOUND');
    else throw new ApiError('VALIDATION_FAILED', { message: 'Informe o cliente (parâmetro customer).' });

    const [profile] = await customerProfiles(db, [code]);
    if (!profile) throw new ApiError('NOT_FOUND');
    const prices = await customerPrices(db, code, saoPauloDate(deps.now()));
    const items = (await catalogItems(db, profile.plant)).map((i) => {
      const cents = prices.get(i.material)?.priceCents ?? null;
      return { ...i, price: cents === null ? null : cents / 100 };
    });
    return c.json(PortalCatalog.parse({
      engineVersion: 1,
      customer: { ...profile, restrictedMaterials: await restrictedMaterials(db, code) },
      rules: { fullAt: FULL_AT, leadDays: LEAD_DAYS },
      vehicles: await vehicles(db),
      items,
    }));
  });

  // Simulação: o mesmo cálculo do envio, sem gravar e sem a regra da data.
  r.post('/quote', async (c) => {
    const body = await readBody(c, OrderBody);
    const code = scopedCustomer(c.get('auth'), body.customerCode);
    const lines = checkLines(body.lines);
    const v = await computeVersion(db, code, body.header, lines, deps.now());
    return c.json(EngineResult.parse(v.result));
  });

  r.post('/orders', async (c) => {
    const auth = c.get('auth');
    const key = c.req.header('idempotency-key');
    if (key === undefined || key === '') throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
    if (!IdempotencyKey.safeParse(key).success) {
      throw new ApiError('VALIDATION_FAILED', { message: 'Idempotency-Key inválida: de 8 a 64 caracteres A-Z, a-z, 0-9, _ ou -.' });
    }
    const body = await readBody(c, OrderBody);
    const code = scopedCustomer(auth, body.customerCode);
    const lines = checkLines(body.lines);
    const hash = requestHash(code, body.header, lines);

    const replay = async (found: { id: string; hash: string | null }) => {
      if (found.hash !== hash) throw new ApiError('IDEMPOTENCY_KEY_REUSED');
      c.header('Idempotent-Replayed', 'true');
      return c.json(await detail(c, found.id), 200);
    };
    const existing = await findByIdempotencyKey(db, code, key);
    if (existing) return replay(existing);

    const now = deps.now();
    checkLoadingDate(body.header.loadingDate, now);

    let id: string;
    try {
      id = await db.tx(async (q) => {
        const v = await computeVersion(q, code, body.header, lines, now);
        if (v.result.blocking) throw new ApiError('ORDER_BLOCKED', { details: blockDetails(v.result) });
        const orderId = await nextOrderId(q, saoPauloDate(now).slice(0, 4));
        await q.query(
          `insert into sales_order (id, customer_code, status, current_version, origin, created_by, created_at, updated_at, idempotency_key, idempotency_hash)
           values ($1, $2, 'SUBMITTED', 1, 'PORTAL', $3, $4, $4, $5, $6)`,
          [orderId, code, auth.userId, now, key, hash]);
        await insertVersion(q, {
          orderId, versionNo: 1, vehicleId: v.header.vehicleId, loadMode: v.header.loadMode, mixedPallet: v.header.mixedPallet,
          reference: v.header.reference, loadingDate: v.header.loadingDate, lines: v.lines, result: v.result,
          inputs: { priceDate: v.priceDate, vehicleId: v.header.vehicleId, customerCode: code },
          dataBatches: v.dataBatches, overrides: v.overrides, contentHash: v.contentHash,
          authorId: auth.userId, authorLabel: auth.displayName, reason: null, at: now,
        });
        await insertEvent(q, { orderId, at: now, actorId: auth.userId, actorLabel: auth.displayName, type: 'SUBMITTED', from: null, to: 'SUBMITTED', versionNo: 1, payload: {} });

        // Aprovação automática (D5): regra do cliente, sem BLOCK e carga completa (utilização máxima ≥ 0,9).
        const { rows: [customer] } = await q.query<{ auto_approve: boolean }>('select auto_approve from customer where code = $1', [code]);
        if (customer.auto_approve && isFullLoad(v.result)) {
          await insertEvent(q, {
            orderId, at: now, actorId: null, actorLabel: AUTO_APPROVAL_LABEL, type: 'AUTO_APPROVED', from: 'SUBMITTED', to: 'APPROVED', versionNo: 1,
            payload: { internal: { ruleChangeId: await lastAutoApproveChange(q, code) } },
          });
          await q.query(`update sales_order set status = 'APPROVED', updated_at = $2 where id = $1`, [orderId, now]);
        }
        return orderId;
      });
    } catch (err) {
      // Outra requisição com a mesma chave gravou primeiro: vira replay (ou 409), nunca 500.
      if (uniqueViolation(err) === IDEMPOTENCY_CONSTRAINT) {
        const found = await findByIdempotencyKey(db, code, key);
        if (found) return replay(found);
      }
      throw err;
    }
    return c.json(await detail(c, id), 201);
  });

  r.get('/orders', async (c) => {
    const auth = c.get('auth');
    const query = parseInput(ListOrdersQuery, { status: c.req.query('status') || undefined });
    const list = await loadOrders(db, { customers: auth.customers, status: query.status });
    return c.json(PortalOrderView.array().parse(list.map((d) => orderView(d, auth, 'portal', false))));
  });

  r.get('/orders/:id', async (c) => c.json(await detail(c, c.req.param('id'))));

  return r;
}
