// Catálogo, veículos e produtos (docs/specs/04-api.md, "Contratos").
import { z } from 'zod';
import { CustomerProfile } from './customer.ts';

export const VehicleId = z.enum(['carreta_padrao', 'container_40', 'container_20']);
export type VehicleId = z.infer<typeof VehicleId>;

export const Vehicle = z.strictObject({
  id: VehicleId,
  displayName: z.string(),
  modal: z.enum(['rodoviario', 'maritimo']),
  volumeM3: z.number(),
  payloadKg: z.number(),
  palletPositions: z.int(),
  assumptions: z.array(z.string()),
});
export type Vehicle = z.infer<typeof Vehicle>;

export const Rules = z.strictObject({ fullAt: z.number(), leadDays: z.int() });

export const CatalogItem = z.strictObject({
  material: z.string(),
  family: z.string(),
  brand: z.string(),
  sapDescription: z.string(),
  names: z.strictObject({ pt: z.string(), es: z.string(), en: z.string() }),
  unitsLabel: z.string(),
  unitsPerBox: z.number(),
  netKgPerBox: z.number(),
  grossKgPerBox: z.number(),
  volumeDm3: z.number(),
  dimsMm: z.strictObject({ length: z.number(), width: z.number(), height: z.number() }),
  layerBoxes: z.int(),
  layers: z.int(),
  boxesPerPallet: z.int(),
  minLotPallets: z.number(),
  price: z.number().nullable(), // lista do cliente; null = sem preço
  ean: z.string().nullable(),
  dun: z.string().nullable(),
  ncm: z.string().nullable(),
  productLine: z.string().nullable(),
  shelfLifeDays: z.int().nullable(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const PortalCatalog = z.strictObject({
  engineVersion: z.literal(1),
  customer: CustomerProfile.extend({ restrictedMaterials: z.array(z.string()) }),
  rules: Rules,
  vehicles: z.array(Vehicle),
  items: z.array(CatalogItem),
});
export type PortalCatalog = z.infer<typeof PortalCatalog>;
