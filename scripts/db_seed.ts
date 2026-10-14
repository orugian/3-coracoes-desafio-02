// npm run db:seed: recria o banco do zero, migra e semeia (docs/specs/02-banco.md e 03-seed.md).
// Recusa com o DATA_DIR em uso (npm run dev) e, com DATABASE_URL, sem SEED_RESET=yes ou fora de banco _dev/_test.
// SEED_PASSWORD (opcional): mesma senha para os 5 usuários; sem ela, senhas aleatórias em storage/credenciais-seed.txt.
import { loadDatabaseConfig } from '#server/config.ts';
import { migrate } from '#server/db/migrate.ts';
import { openDatabase } from '#server/db/open.ts';
import { seed } from '../db/seed/seed.ts';

const config = loadDatabaseConfig();
const password = process.env.SEED_PASSWORD?.trim() || undefined;
try {
  const db = await openDatabase(config, { recreate: true });
  try {
    const applied = await migrate(db);
    console.log(`banco recriado (${config.databaseUrl ? 'PostgreSQL' : config.dataDir}); migrações: ${applied.join(', ')}`);
    await seed(db, { password });
  } finally {
    await db.close();
  }
} catch (err) {
  console.error(`db:seed: ${(err as Error).message}`);
  process.exitCode = 1;
}
