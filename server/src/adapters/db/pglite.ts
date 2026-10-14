// Adaptador PGlite (padrão local; em memória nos testes). docs/specs/02-banco.md, "Porta Db".
import { PGlite, types, type Transaction } from '@electric-sql/pglite';
import type { Db, Queryable } from '../../ports/db.ts';

function wrap(target: PGlite | Transaction): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const { rows } = await target.query<T>(sql, params);
      return { rows };
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  };
}

// dataDir ausente = banco em memória.
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  // Opções num objeto só: new PGlite(undefined, opções) ignora as opções no 0.5.9.
  const pg = new PGlite({ dataDir, parsers: { [types.DATE]: (value: string) => value } });
  await pg.waitReady;
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    close: () => pg.close(),
  };
}
