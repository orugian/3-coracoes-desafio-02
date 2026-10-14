// Resultado do motor (EngineResult, docs/specs/01-motor.md, "Contrato"), como sai na API. Estrito: um campo novo no
// motor precisa entrar aqui de propósito.
import { z } from 'zod';

export const AlertCode = z.enum([
  'QTY_NOT_MULTIPLE', 'BELOW_MIN_LOT', 'NO_PRICE', 'COUNTRY_RESTRICTED', 'VEHICLE_EXCEEDED', 'PALLET_INCOMPLETE', 'VEHICLE_UNDERFILLED',
]);

export const Alert = z.strictObject({
  code: AlertCode,
  severity: z.enum(['BLOCK', 'WARN']),
  material: z.string().optional(),
  params: z.record(z.string(), z.number()).optional(),
});

export const LineResult = z.strictObject({
  material: z.string(),
  requestedBoxes: z.number(),
  boxes: z.number(),
  pallets: z.number(),
  fullPallets: z.number(),
  boxesToNextPallet: z.number(),
  netKg: z.number(),
  grossKg: z.number(),
  m3: z.number(),
  priceCents: z.number().nullable(),
  valueCents: z.number(),
  alerts: z.array(Alert),
});

export const EngineResult = z.strictObject({
  engineVersion: z.literal(1),
  lines: z.array(LineResult),
  totals: z.strictObject({
    boxes: z.number(), pallets: z.number(), positions: z.number(), netKg: z.number(), grossKg: z.number(), m3: z.number(), valueCents: z.number(),
  }),
  utilization: z.strictObject({ kg: z.number(), m3: z.number(), positions: z.number().nullable() }),
  binding: z.enum(['kg', 'm3', 'positions']),
  status: z.enum(['EMPTY', 'PARTIAL', 'FULL', 'EXCEEDED']),
  over: z.strictObject({ positions: z.number(), kg: z.number(), m3: z.number() }),
  alerts: z.array(Alert),
  blocking: z.boolean(),
});
export type EngineResultView = z.infer<typeof EngineResult>;
