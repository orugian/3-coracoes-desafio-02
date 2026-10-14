// Leitura e validação do corpo das requisições (docs/specs/04-api.md, "Erros": 422 VALIDATION_FAILED).
import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from './errors.ts';

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError('VALIDATION_FAILED', { message: 'Corpo da requisição não é um JSON válido.' });
  }
}

// Detalhes com o caminho do campo e o tipo do problema, sem ecoar o valor recebido.
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError('VALIDATION_FAILED', {
    details: result.error.issues.slice(0, 20).map((i) => ({ code: 'INVALID_FIELD', params: { path: i.path.join('.'), issue: i.code } })),
  });
}

export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  return parseInput(schema, await readJson(c));
}
