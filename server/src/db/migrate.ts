// Migrador (docs/specs/02-banco.md, "Migrações"): db/migrations/NNN_nome.sql em ordem, cada uma numa transação.
// Checksum diferente de uma já aplicada aborta. O checksum troca \r\n por \n (core.autocrlf=true no Windows).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../ports/db.ts';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'db', 'migrations');
const FILE_RE = /^(\d{3}_[a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

interface MigrationFile { version: string; sql: string; checksum: string }

function readMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const m = FILE_RE.exec(file);
      if (!m) throw new MigrationError(`nome de migração inválido: ${file} (esperado NNN_nome.sql)`);
      const sql = readFileSync(path.join(dir, file), 'utf8');
      return { version: m[1], sql, checksum: migrationChecksum(sql) };
    });
}

// Devolve as versões aplicadas nesta execução (vazio se o banco já estava em dia).
export async function migrate(db: Db, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = readMigrations(dir);
  await db.exec(`create table if not exists schema_migration (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const { rows: applied } = await db.query<{ version: string; checksum: string }>(
    'select version, checksum from schema_migration order by version');
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const a of applied) {
    const f = byVersion.get(a.version);
    if (!f) throw new MigrationError(`migração ${a.version} aplicada no banco e sem arquivo em ${dir}`);
    if (f.checksum !== a.checksum) throw new MigrationError(`checksum da migração ${a.version} diferente do aplicado no banco`);
  }
  const last = applied.at(-1)?.version;
  const pending = files.filter((f) => !applied.some((a) => a.version === f.version));
  const late = pending.find((f) => last !== undefined && f.version < last);
  if (late) throw new MigrationError(`migração ${late.version} fora de ordem: o banco já tem ${last}`);

  const done: string[] = [];
  for (const f of pending) {
    const appliedNow = await db.tx(async (q) => {
      // Dois migradores no mesmo PostgreSQL: o segundo espera e vê a versão já gravada.
      await q.exec('lock table schema_migration in exclusive mode');
      const { rows } = await q.query<{ checksum: string }>('select checksum from schema_migration where version = $1', [f.version]);
      if (rows.length > 0) {
        if (rows[0].checksum !== f.checksum) throw new MigrationError(`checksum da migração ${f.version} diferente do aplicado no banco`);
        return false;
      }
      await q.exec(f.sql);
      await q.query('insert into schema_migration (version, checksum) values ($1, $2)', [f.version, f.checksum]);
      return true;
    });
    if (appliedNow) done.push(f.version);
  }
  return done;
}
