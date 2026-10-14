import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/open.ts';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`dev: ${(err as Error).message}`);
  process.exit(1);
}
// Abre o banco já no início: no PGlite, segura a trava do DATA_DIR (o db:seed recusa enquanto o dev roda).
const db = await openDatabase(config);
const { rows } = await db.query<{ t: string | null }>(`select to_regclass('public.schema_migration')::text as t`);
if (!rows[0].t) console.warn('banco sem migrações: rode npm run db:seed (ou npm run db:migrate)');

const app = createApp({ db, sessionSecret: config.sessionSecret, cookieSecure: config.cookieSecure });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Pedido sem Fronteiras ouvindo em http://localhost:${info.port}`);
});

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
