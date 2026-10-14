// Pedidos (docs/specs/04-api.md, "Contratos", "Regras transversais" e "Máquina de estados").
// Entrada: z.object (chaves desconhecidas, como mixedPallet no corpo, são descartadas: vale o cliente).
// Saída: estrita. O portal nunca recebe internal (de versão ou de evento).
import { z } from 'zod';
import { IsoDate, Timestamp } from './common.ts';
import { EngineResult } from './engine.ts';
import { VehicleId } from './catalog.ts';

export const MAX_BOXES = 100_000;
export const MAX_LINES = 50;

export const OrderStatus = z.enum(['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'EXPORTED']);
export type OrderStatus = z.infer<typeof OrderStatus>;
export const LoadMode = z.enum(['PALLETIZED', 'FLOOR']);
export const Material = z.string().regex(/^\d{8}$/, 'material com 8 dígitos');

// Data real (2026-02-30 não passa).
const CalendarDate = IsoDate.refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'data inexistente');

// Caixas: número de 1 a 100.000. Fração passa aqui e vira 422 com QTY_NOT_MULTIPLE (a UI arredonda antes).
export const LineInput = z.object({ material: Material, boxes: z.number().min(1).max(MAX_BOXES) });
export type LineInput = z.infer<typeof LineInput>;

export const OrderHeaderInput = z.object({
  vehicleId: VehicleId,
  loadMode: LoadMode,
  reference: z.string().trim().max(30).regex(/^[^\p{Cc}]*$/u, 'sem caracteres de controle').default(''),
  loadingDate: CalendarDate.nullable().default(null),
});
export type OrderHeaderInput = z.infer<typeof OrderHeaderInput>;

export const OrderBody = z.object({
  customerCode: z.string().min(1).max(20),
  header: OrderHeaderInput,
  lines: z.array(LineInput).min(1).max(MAX_LINES),
});
export type OrderBody = z.infer<typeof OrderBody>;

export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ExpectedVersion = z.int().min(1);

// Reenvio do pedido devolvido (S9): cabeçalho e linhas completos, como no envio, mais a versão esperada.
export const ResubmitBody = z.object({
  expectedVersion: ExpectedVersion,
  header: OrderHeaderInput,
  lines: z.array(LineInput).min(1).max(MAX_LINES),
});
export type ResubmitBody = z.infer<typeof ResubmitBody>;

export const ListOrdersQuery = z.object({ status: OrderStatus.optional() });

// ---- saída
export const Line = z.strictObject({ material: z.string(), boxes: z.int() });

export const VersionHeader = z.strictObject({
  vehicleId: VehicleId, loadMode: LoadMode, reference: z.string(), loadingDate: IsoDate.nullable(), mixedPallet: z.boolean(),
});

const versionBase = {
  versionNo: z.int(),
  header: VersionHeader,
  lines: z.array(Line),
  result: EngineResult,
  authorLabel: z.string(),
  reason: z.string().nullable(),
  createdAt: Timestamp,
};
export const VersionInternal = z.strictObject({ dataBatches: z.array(z.int()), overrides: z.array(z.int()), contentHash: z.string() });

export const PortalOrderVersionView = z.strictObject(versionBase);
export const BackofficeOrderVersionView = z.strictObject({ ...versionBase, internal: VersionInternal });

export const EventChange = z.strictObject({ material: z.string(), old: z.int(), new: z.int() });
export const EventPayloadPortal = z.strictObject({ changes: z.array(EventChange).optional(), reason: z.string().optional() });
export const EventPayloadBackoffice = EventPayloadPortal.extend({ internal: z.record(z.string(), z.unknown()).optional() });

export const EventType = z.enum(['SUBMITTED', 'VERSION_CREATED', 'APPROVED', 'AUTO_APPROVED', 'CHANGES_REQUESTED', 'RESUBMITTED']);
const eventBase = {
  at: Timestamp,
  actorLabel: z.string(),
  type: EventType,
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  versionNo: z.int().nullable(),
};
export const PortalOrderEventView = z.strictObject({ ...eventBase, payload: EventPayloadPortal });
export const BackofficeOrderEventView = z.strictObject({ ...eventBase, payload: EventPayloadBackoffice });

export const Permissions = z.strictObject({ canEdit: z.boolean(), canApprove: z.boolean(), canReturn: z.boolean(), canResubmit: z.boolean() });
export type Permissions = z.infer<typeof Permissions>;

const orderBase = {
  id: z.string(),
  customerCode: z.string(),
  customerName: z.string(),
  status: OrderStatus,
  origin: z.enum(['PORTAL', 'ORDER_BASIS', 'BACKOFFICE']), // origem do pedido (não é a origem do preço)
  currentVersion: z.int(),
  createdAt: Timestamp,
  createdByLabel: z.string(),
  submittedAt: Timestamp,
  approvedAt: Timestamp.nullable(),
  approvedByLabel: z.string().nullable(),
  permissions: Permissions,
};

export const PortalOrderView = z.strictObject({
  ...orderBase,
  current: PortalOrderVersionView,
  versions: z.array(PortalOrderVersionView).optional(), // só no detalhe
  events: z.array(PortalOrderEventView).optional(),
});
export type PortalOrderView = z.infer<typeof PortalOrderView>;

export const BackofficeOrderView = z.strictObject({
  ...orderBase,
  current: BackofficeOrderVersionView,
  versions: z.array(BackofficeOrderVersionView).optional(),
  events: z.array(BackofficeOrderEventView).optional(),
});
export type BackofficeOrderView = z.infer<typeof BackofficeOrderView>;
