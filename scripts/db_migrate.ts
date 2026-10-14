// npm run db:migrate: aplica as migrações pendentes no banco da configuração (docs/specs/02-banco.md, "Migrações").
import { loadDatabaseConfig } from '#server/config.ts';
import { migrate } from '#server/db/migrate.ts';
import { openDatabase } from '#server/db/open.ts';

const config = loadDatabaseConfig();
try {
  const db = await openDatabase(config);
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `migrações aplicadas: ${applied.join(', ')}` : 'banco em dia: nenhuma migração pendente');
  } finally {
    await db.close();
  }
} catch (err) {
  console.error(`db:migrate: ${(err as Error).message}`);
  process.exitCode = 1;
}
