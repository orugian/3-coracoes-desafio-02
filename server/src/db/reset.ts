// Reset do banco para o db:seed (docs/specs/02-banco.md, "Migrações"). order_version e order_event não aceitam DELETE,
// então reset é sempre banco novo: no PGlite, diretório novo; no pg, schema public recriado, só em banco de dev ou teste.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../ports/db.ts';

export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetRefusedError';
  }
}

// Apaga o DATA_DIR só se ele não existir, estiver vazio ou for um diretório do PGlite (tem PG_VERSION):
// um DATA_DIR apontado por engano para outra pasta não é apagado. A trava (lock.ts) é responsabilidade de quem chama.
export function recreatePgliteDir(dataDir: string): void {
  const dir = path.resolve(dataDir);
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  if (entries.length > 0 && !entries.includes('PG_VERSION')) {
    throw new ResetRefusedError(`DATA_DIR ${dir} não é um banco do PGlite (sem PG_VERSION); nada foi apagado`);
  }
  rmSync(dir, { recursive: true, force: true });
}

export function assertPgResetAllowed(databaseName: string, seedReset: boolean): void {
  if (!seedReset) throw new ResetRefusedError('com DATABASE_URL, o reset exige SEED_RESET=yes');
  if (!/_(dev|test)$/.test(databaseName)) {
    throw new ResetRefusedError(`o reset só apaga bancos terminados em _dev ou _test (banco atual: ${databaseName})`);
  }
}

// Confere a trava antes de conectar (SEED_RESET) e de novo com o nome real do banco na conexão.
export async function resetPgSchema(db: Db, seedReset: boolean): Promise<void> {
  if (!seedReset) assertPgResetAllowed('', false);
  const { rows } = await db.query<{ name: string }>('select current_database() as name');
  assertPgResetAllowed(rows[0].name, seedReset);
  await db.exec('drop schema public cascade; create schema public;');
}
