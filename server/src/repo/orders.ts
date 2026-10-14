// Leitura e gravação de pedidos (docs/specs/02-banco.md, sales_order, order_version, order_event).
// Versões e eventos são só inserção (triggers); o pedido guarda o estado e a versão atual.
import type { EngineResult } from '#engine';
import type { OrderStatus } from '#contracts';
import type { Queryable } from '../ports/db.ts';

export interface OrderRow {
  id: string; customer_code: string; customer_name: string; status: OrderStatus; origin: 'PORTAL' | 'ORDER_BASIS' | 'BACKOFFICE';
  current_version: number; created_at: Date; created_by: number; created_by_label: string;
  idempotency_key: string | null; idempotency_hash: string | null;
}
export interface VersionRow {
  order_id: string; version_no: number; vehicle_id: string; load_mode: 'PALLETIZED' | 'FLOOR'; mixed_pallet: boolean;
  customer_reference: string; loading_date: string | null; lines: { material: string; boxes: number }[];
  engine_result: EngineResult & { inputs?: unknown }; blocking: boolean; data_batches: number[]; overrides: number[];
  content_hash: string; author_id: number; author_label: string; reason: string | null; created_at: Date;
}
export interface EventRow {
  id: number; order_id: string; at: Date; actor_id: number | null; actor_label: string; type: string;
  from_status: string | null; to_status: string | null; version_no: number | null; payload: Record<string, unknown>;
}
export interface OrderData { order: OrderRow; versions: VersionRow[]; events: EventRow[] }

export interface OrderFilter {
  id?: string;
  customers?: string[]; // escopo do distribuidor; ausente = todos
  customer?: string;
  status?: OrderStatus;
  search?: string; // id, referência da versão atual ou nome do cliente
}

const ORDER_COLUMNS = `o.id, o.customer_code, c.name as customer_name, o.status, o.origin, o.current_version, o.created_at, o.created_by,
  u.display_name as created_by_label, o.idempotency_key, o.idempotency_hash`;

export async function loadOrders(q: Queryable, f: OrderFilter): Promise<OrderData[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.id !== undefined) add('o.id = ?', f.id);
  if (f.customers !== undefined) add('o.customer_code = any(?::text[])', f.customers);
  if (f.customer !== undefined) add('o.customer_code = ?', f.customer);
  if (f.status !== undefined) add('o.status = ?', f.status);
  if (f.search !== undefined) {
    params.push(`%${f.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); // curinga do usuário vale como texto
    const p = `$${params.length}`;
    where.push(`(o.id ilike ${p} or c.name ilike ${p} or exists (select 1 from order_version cv where cv.order_id = o.id
          and cv.version_no = o.current_version and cv.customer_reference ilike ${p}))`);
  }
  const { rows: orders } = await q.query<OrderRow>(
    `select ${ORDER_COLUMNS}
       from sales_order o join customer c on c.code = o.customer_code join app_user u on u.id = o.created_by
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by o.created_at desc, o.id desc`,
    params);
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const { rows: versions } = await q.query<VersionRow>(
    'select * from order_version where order_id = any($1::text[]) order by order_id, version_no', [ids]);
  const { rows: events } = await q.query<EventRow>(
    'select * from order_event where order_id = any($1::text[]) order by order_id, id', [ids]);
  return orders.map((order) => ({
    order: { ...order, current_version: Number(order.current_version), created_by: Number(order.created_by) },
    versions: versions.filter((v) => v.order_id === order.id).map((v) => ({ ...v, version_no: Number(v.version_no), author_id: Number(v.author_id) })),
    events: events.filter((e) => e.order_id === order.id),
  }));
}

export async function loadOrder(q: Queryable, id: string): Promise<OrderData | null> {
  return (await loadOrders(q, { id }))[0] ?? null;
}

export async function findByIdempotencyKey(q: Queryable, customerCode: string, key: string): Promise<{ id: string; hash: string | null } | null> {
  const { rows: [r] } = await q.query<{ id: string; idempotency_hash: string | null }>(
    'select id, idempotency_hash from sales_order where customer_code = $1 and idempotency_key = $2', [customerCode, key]);
  return r ? { id: r.id, hash: r.idempotency_hash } : null;
}

export async function nextOrderId(q: Queryable, year: string): Promise<string> {
  const { rows: [r] } = await q.query<{ n: number | string }>(`select nextval('sales_order_seq') as n`);
  return `3CC-${year}-${String(Number(r.n)).padStart(4, '0')}`;
}

export interface NewVersion {
  orderId: string; versionNo: number; vehicleId: string; loadMode: string; mixedPallet: boolean; reference: string; loadingDate: string | null;
  lines: { material: string; boxes: number }[]; result: EngineResult; inputs: { priceDate: string; vehicleId: string; customerCode: string };
  dataBatches: number[]; overrides: number[]; contentHash: string; authorId: number; authorLabel: string; reason: string | null; at: Date;
}

export async function insertVersion(q: Queryable, v: NewVersion): Promise<void> {
  await q.query(
    `insert into order_version (order_id, version_no, vehicle_id, load_mode, mixed_pallet, customer_reference, loading_date, lines, engine_version,
                                engine_result, blocking, data_batches, overrides, content_hash, author_id, author_label, reason, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 1, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17)`,
    [v.orderId, v.versionNo, v.vehicleId, v.loadMode, v.mixedPallet, v.reference, v.loadingDate, JSON.stringify(v.lines),
      JSON.stringify({ ...v.result, inputs: v.inputs }), v.result.blocking, JSON.stringify(v.dataBatches), JSON.stringify(v.overrides),
      v.contentHash, v.authorId, v.authorLabel, v.reason, v.at]);
}

export interface NewEvent {
  orderId: string; at: Date; actorId: number | null; actorLabel: string; type: string; from: string | null; to: string | null;
  versionNo: number | null; payload: Record<string, unknown>;
}

export async function insertEvent(q: Queryable, e: NewEvent): Promise<void> {
  await q.query(
    `insert into order_event (order_id, at, actor_id, actor_label, type, from_status, to_status, version_no, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [e.orderId, e.at, e.actorId, e.actorLabel, e.type, e.from, e.to, e.versionNo, JSON.stringify(e.payload)]);
}
