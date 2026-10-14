// Adaptador PostgreSQL via pg (quando DATABASE_URL existir). docs/specs/02-banco.md, "Porta Db".
import pg from 'pg';
import type { Db, Queryable } from '../../ports/db.ts';

const DATE_OID = 1082;

function wrap(target: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const { rows } = await target.query(sql, params);
      return { rows: rows as T[] };
    },
    async exec(sql: string) {
      await target.query(sql);
    },
  };
}

export function createPgDb(connectionString: string): Db {
  // date como 'YYYY-MM-DD', igual ao PGlite (o padrão do pg cria um Date no fuso local).
  const pool = new pg.Pool({ connectionString, types: { getTypeParser: (oid, format) => (oid === DATE_OID ? (v: string) => v : pg.types.getTypeParser(oid, format)) } });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
