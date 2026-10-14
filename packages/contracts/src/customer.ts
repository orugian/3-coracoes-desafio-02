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
