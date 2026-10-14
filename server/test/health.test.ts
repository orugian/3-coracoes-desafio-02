import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '#server/app.ts';
import type { Db } from '#server/ports/db.ts';

// GET /v1/health não toca no banco: um Db que falha em qualquer uso prova isso.
const noDb = new Proxy({}, { get: () => { throw new Error('health não deveria usar o banco'); } }) as Db;
const app = () => createApp({ db: noDb, sessionSecret: 'x'.repeat(32), log: () => undefined });

test('GET /v1/health responde ok e a versão do motor, sem dado e sem sessão', async () => {
  const res = await app().request('/v1/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  assert.deepEqual(await res.json(), { ok: true, engineVersion: 1 });
});

test('rota desconhecida em /v1 sem sessão responde 401 (não revela se a rota existe)', async () => {
  const res = await app().request('/v1/nao-existe');
  assert.equal(res.status, 401);
});
