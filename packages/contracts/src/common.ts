// Tipos comuns dos contratos da API (docs/specs/04-api.md, "Contratos" e "Erros").
// Saída: objetos estritos (z.strictObject), para um campo fora do contrato falhar no teste em vez de vazar.
// Entrada: objetos comuns (z.object), que descartam chaves desconhecidas (o servidor ignora o que não está no contrato).
import { z } from 'zod';

export const Role = z.enum(['ext_distribuidor', 'int_exportacao', 'int_admin']);
export type Role = z.infer<typeof Role>;

export const ErrorCode = z.enum([
  'UNAUTHENTICATED', 'LOGIN_FAILED', 'FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN', 'NOT_FOUND', 'INVALID_TRANSITION',
  'VERSION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 'ORDER_BLOCKED', 'LOADING_DATE_TOO_SOON', 'NO_CHANGES', 'VALIDATION_FAILED',
  'IDEMPOTENCY_KEY_REQUIRED', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE', 'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorDetail = z.strictObject({
  code: z.string(),
  material: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

export const ApiErrorBody = z.strictObject({
  error: z.strictObject({ code: ErrorCode, message: z.string(), details: z.array(ErrorDetail).optional() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const Language = z.enum(['pt', 'es', 'en']);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato YYYY-MM-DD');
export const Timestamp = z.string(); // ISO 8601 com fuso
