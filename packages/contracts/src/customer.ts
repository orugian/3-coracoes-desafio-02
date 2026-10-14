// Cliente como o portal vê (CustomerProfile). docs/specs/04-api.md, "Contratos".
import { z } from 'zod';
import { Language } from './common.ts';

export const CustomerProfile = z.strictObject({
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  destinationLabel: z.string(),
  currency: z.string(),
  incoterm: z.string(),
  paymentCode: z.string(),
  paymentTerms: z.string(),
  priceList: z.string(),
  plant: z.string(),
  plantName: z.string(),
  branch: z.string(),
  contactName: z.string().nullable(),
  language: Language,
  mixedPallet: z.boolean(),
});
export type CustomerProfile = z.infer<typeof CustomerProfile>;

// Visão interna (backoffice): o portal nunca recebe country, autoApprove nem isDemo.
export const CustomerInternal = CustomerProfile.extend({
  country: z.string().nullable(),
  autoApprove: z.boolean(),
  isDemo: z.boolean(),
  restrictedMaterials: z.array(z.string()),
});
export type CustomerInternal = z.infer<typeof CustomerInternal>;

// PUT /v1/backoffice/customers/:code/rules: pelo menos um dos dois.
export const RulesBody = z.object({ mixedPallet: z.boolean().optional(), autoApprove: z.boolean().optional() })
  .refine((b) => b.mixedPallet !== undefined || b.autoApprove !== undefined, 'informe mixedPallet ou autoApprove');
export type RulesBody = z.infer<typeof RulesBody>;
