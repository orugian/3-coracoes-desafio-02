import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '#server/app.ts';

test('GET /v1/health responde ok e a versão do motor, sem dado', async () => {
  const app = createApp();
  const res = await app.request('/v1/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  assert.deepEqual(await res.json(), { ok: true, engineVersion: 1 });
});

test('rota desconhecida em /v1 responde 404', async () => {
  const app = createApp();
  const res = await app.request('/v1/nao-existe');
  assert.equal(res.status, 404);
});
