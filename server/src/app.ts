import { Hono } from 'hono';
import { ENGINE_VERSION } from '#engine';

// Aplicação HTTP (docs/specs/04-api.md). A S4 acrescenta o pipeline (cabeçalhos, sessão, guardas e estáticos).
export function createApp(): Hono {
  const app = new Hono();

  // Sem sessão e sem dado: só confirma que o processo está de pé e qual motor ele usa.
  app.get('/v1/health', (c) => c.json({ ok: true, engineVersion: ENGINE_VERSION }));

  return app;
}
