// Abre o banco da configuração (docs/specs/02-banco.md, "Porta Db"): pg se houver DATABASE_URL, senão PGlite em DATA_DIR.
// No PGlite, o processo segura a trava do DATA_DIR enquanto o banco estiver aberto (dev, db:migrate, db:seed).
import { createPgDb } from '../adapters/db/pg.ts';
import { createPgliteDb } from '../adapters/db/pglite.ts';
import type { Db } from '../ports/db.ts';
import { acquireDataDirLock } from './lock.ts';
import { recreatePgliteDir, resetPgSchema } from './reset.ts';

export interface DatabaseConfig { dataDir: string; databaseUrl: string | undefined; seedReset: boolean }

// recreate: banco novo (reset do db:seed), com as travas do 02.
export async function openDatabase(config: DatabaseConfig, options: { recreate?: boolean } = {}): Promise<Db> {
  if (config.databaseUrl) {
    const db = createPgDb(config.databaseUrl);
    try {
      if (options.recreate) await resetPgSchema(db, config.seedReset);
      return db;
    } catch (err) {
      await db.close();
      throw err;
    }
  }

  const release = acquireDataDirLock(config.dataDir);
  try {
    if (options.recreate) recreatePgliteDir(config.dataDir);
    const db = await createPgliteDb(config.dataDir);
    process.once('exit', release); // queda sem close: a trava some junto (e a de PID morto é substituída)
    return {
      ...db,
      async close() {
        try {
          await db.close();
        } finally {
          release();
          process.removeListener('exit', release);
        }
      },
    };
  } catch (err) {
    release();
    throw err;
  }
}
