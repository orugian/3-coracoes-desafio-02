// Contratos só do backoffice (docs/specs/04-api.md, "Contratos" e "Rotas"): produtos com preços, SAP, overrides e OB;
// clientes com o histórico de regras; corpos de nova versão e aprovação.
import { z } from 'zod';
import { IsoDate, Timestamp } from './common.ts';
import { CatalogItem, Rules, Vehicle } from './catalog.ts';
import { CustomerInternal } from './customer.ts';
import { MAX_BOXES, MAX_LINES, Material, OrderStatus } from './order.ts';

export const PriceOrigin = z.enum(['SAP_LIST', 'SITE_3C', 'DEMO_DERIVED']);

export const ProductInternal = CatalogItem.omit({ price: true }).extend({
  prices: z.array(z.strictObject({
    priceList: z.string(), price: z.number(), priceRaw: z.number().nullable(), origin: PriceOrigin, validFrom: IsoDate, validTo: IsoDate,
  })),
  sap: z.strictObject({ layerBoxes: z.int(), layers: z.int(), grossKgPerBox: z.number().nullable() }),
  overrides: z.array(z.strictObject({
    field: z.enum(['grossKgPerBox', 'layerBoxes', 'layers']), // mesmo nome do campo em CatalogItem
    sapValue: z.number(), adoptedValue: z.number(), justification: z.string(), decisionRef: z.string(),
    proposedBy: z.string(), confirmedBy: z.string(), confirmedAt: Timestamp,
  })),
  ob: z.strictObject({
    boxesPerPallet: z.number().nullable(), palletizationBoxes: z.number().nullable(), price: z.number().nullable(),
    minLot: z.number().nullable(), grossKgPerBox: z.number().nullable(),
  }),
  minLotSource: z.enum(['OB_PALETIZACAO', 'DEFAULT']),
});
export type ProductInternal = z.infer<typeof ProductInternal>;

export const BackofficeProducts = z.strictObject({ items: z.array(ProductInternal), vehicles: z.array(Vehicle), rules: Rules });

export const RuleChange = z.strictObject({
  at: Timestamp, customerCode: z.string(), field: z.enum(['mixedPallet', 'autoApprove']), oldValue: z.boolean(), newValue: z.boolean(), actorLabel: z.string(),
});
export type RuleChange = z.infer<typeof RuleChange>;
export const BackofficeCustomers = z.strictObject({ customers: z.array(CustomerInternal), ruleChanges: z.array(RuleChange) });

export const BackofficeOrdersQuery = z.object({
  status: OrderStatus.optional(),
  customer: z.string().max(20).optional(),
  q: z.string().trim().min(1).max(64).optional(),
});

const ExpectedVersion = z.int().min(1);
const Reason = z.string().trim().max(200).regex(/^[^\p{Cc}]*$/u, 'sem caracteres de controle');

// Nova versão: caixas inteiras de 0 a 100.000 (0 remove a linha); materiais únicos.
export const BackofficeVersionBody = z.object({
  expectedVersion: ExpectedVersion,
  changes: z.array(z.object({ material: Material, boxes: z.int().min(0).max(MAX_BOXES) })).min(1).max(MAX_LINES),
  reason: Reason.optional(),
});
export type BackofficeVersionBody = z.infer<typeof BackofficeVersionBody>;

export const ApproveBody = z.object({ expectedVersion: ExpectedVersion });
