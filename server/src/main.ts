import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = createApp();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Pedido sem Fronteiras ouvindo em http://localhost:${info.port}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
