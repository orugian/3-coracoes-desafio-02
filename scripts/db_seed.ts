// npm run db:seed: recria o banco do zero, migra e semeia (docs/specs/02-banco.md e 03-seed.md).
// Recusa com o DATA_DIR em uso (npm run dev) e, com DATABASE_URL, sem SEED_RESET=yes ou fora de banco _dev/_test.
import { loadDatabaseConfig } from '#server/config.ts';
import { migrate } from '#server/db/migrate.ts';
import { openDatabase } from '#server/db/open.ts';

const config = loadDatabaseConfig();
try {
  const db = await openDatabase(config, { recreate: true });
  try {
    const applied = await migrate(db);
    console.log(`banco recriado (${config.databaseUrl ? 'PostgreSQL' : config.dataDir}); migrações: ${applied.join(', ')}`);
    console.log('carga dos dados: fatia S3 (docs/plano/PLANO.md)');
  } finally {
    await db.close();
  }
} catch (err) {
  console.error(`db:seed: ${(err as Error).message}`);
  process.exitCode = 1;
}
