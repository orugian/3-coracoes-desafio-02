// Porta de banco (docs/specs/02-banco.md, "Porta Db"). Só os adaptadores escrevem BEGIN/COMMIT.
// Os dois adaptadores devolvem date como 'YYYY-MM-DD'; numeric e bigint continuam como o driver entrega
// (numeric como texto; bigint como número no PGlite e texto no pg) e a camada de repositório converte.

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>; // vários comandos, sem parâmetros (migrações)
}

export interface Db extends Queryable {
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

// Nome da restrição de unicidade violada (SQLSTATE 23505), ou null se o erro for outro.
// Permite traduzir as violações conhecidas para 409 ou replay, nunca 500.
export function uniqueViolation(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || (err as { code?: unknown }).code !== '23505') return null;
  const constraint = (err as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : '';
}
