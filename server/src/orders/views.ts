// OrderView do portal e do backoffice (docs/specs/04-api.md, "Contratos"). O portal nunca recebe internal (de versão
// nem de evento) e só as chaves changes e reason do payload; a saída passa pelo schema estrito na rota.
import type { OrderStatus } from '#contracts';
import { permissionsFor, type Actor, type OrderAccess } from '../domain/permissions.ts';
import type { EventRow, OrderData, VersionRow } from '../repo/orders.ts';

export type Area = 'portal' | 'backoffice';
export const AUTO_APPROVAL_LABEL = 'Regra de aprovação automática';

const iso = (v: Date | string) => new Date(v).toISOString();

export function orderAccess(d: OrderData): OrderAccess {
  return {
    status: d.order.status as OrderStatus,
    customerCode: d.order.customer_code,
    createdBy: d.order.created_by,
    authorIds: [...new Set(d.versions.map((v) => v.author_id))],
  };
}

function versionView(v: VersionRow, area: Area) {
  const { inputs: _inputs, ...result } = v.engine_result; // inputs (data do preço etc.) fica só no banco
  return {
    versionNo: v.version_no,
    header: { vehicleId: v.vehicle_id, loadMode: v.load_mode, reference: v.customer_reference, loadingDate: v.loading_date, mixedPallet: v.mixed_pallet },
    lines: v.lines.map((l) => ({ material: l.material, boxes: l.boxes })),
    result,
    authorLabel: v.author_label,
    reason: v.reason,
    createdAt: iso(v.created_at),
    ...(area === 'backoffice'
      ? { internal: { dataBatches: v.data_batches.map(Number), overrides: v.overrides.map(Number), contentHash: v.content_hash } }
      : {}),
  };
}

function eventPayload(p: Record<string, unknown>, area: Area) {
  const out: Record<string, unknown> = {};
  if (Array.isArray(p.changes)) {
    out.changes = p.changes.map((c: { material: string; old: number; new: number }) => ({ material: c.material, old: c.old, new: c.new }));
  }
  if (typeof p.reason === 'string') out.reason = p.reason;
  if (area === 'backoffice' && p.internal !== undefined) out.internal = p.internal;
  return out;
}

function eventView(e: EventRow, area: Area) {
  return {
    at: iso(e.at),
    actorLabel: e.actor_label,
    type: e.type,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    versionNo: e.version_no === null ? null : Number(e.version_no),
    payload: eventPayload(e.payload ?? {}, area),
  };
}

export function orderView(d: OrderData, actor: Actor, area: Area, detail: boolean) {
  const { order } = d;
  const current = d.versions.find((v) => v.version_no === order.current_version);
  if (!current) throw new Error(`pedido ${order.id} sem a versão atual ${order.current_version}`);
  const submitted = d.events.filter((e) => e.type === 'SUBMITTED' || e.type === 'RESUBMITTED').at(-1);
  const approved = order.status === 'APPROVED' || order.status === 'EXPORTED'
    ? d.events.filter((e) => e.type === 'APPROVED' || e.type === 'AUTO_APPROVED').at(-1)
    : undefined;
  return {
    id: order.id,
    customerCode: order.customer_code,
    customerName: order.customer_name,
    status: order.status,
    origin: order.origin,
    currentVersion: order.current_version,
    createdAt: iso(order.created_at),
    createdByLabel: order.created_by_label,
    submittedAt: iso(submitted?.at ?? order.created_at),
    approvedAt: approved ? iso(approved.at) : null,
    approvedByLabel: approved ? approved.actor_label : null,
    current: versionView(current, area),
    permissions: permissionsFor(actor, orderAccess(d)),
    ...(detail ? { versions: d.versions.map((v) => versionView(v, area)), events: d.events.map((e) => eventView(e, area)) } : {}),
  };
}
