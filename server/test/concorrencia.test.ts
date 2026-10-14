// Concorrência e unicidade (docs/specs/02-banco.md, "Porta Db"; 04, "Regras transversais" e "Detalhes do backoffice").
// 1. Tradução da PK de order_version (23505) em 409 VERSION_CONFLICT, nas três ações que gravam versão: roda em PGlite,
//    com um Db que injeta a violação (no PGlite as transações são serializadas e a corrida real não acontece).
// 2. PostgreSQL 16 pelo adaptador pg: migrações, DDL e corridas reais com select … for update. Só roda com
//    TEST_DATABASE_URL apontando para um banco descartável terminado em _test (o schema public é recriado).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BackofficeOrderView, PortalOrderView } from '#contracts';
import { createPgDb } from '#server/adapters/db/pg.ts';
import { migrate } from '#server/db/migrate.ts';
import { resetPgSchema } from '#server/db/reset.ts';
import type { Db, Queryable } from '#server/ports/db.ts';
import { seed } from '../../db/seed/seed.ts';
import { Client, PASSWORD, errorCode, newKey, seededDb, strictJson, testApp, type TestApp } from './helpers/api.ts';

const CARRETA = { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: 'OC-CONC', loadingDate: null };
const CASO_2 = [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1400 }];

// Db que, armado, falha o próximo insert em order_version como se outra transação tivesse gravado a mesma versão.
function withInjectedPk(db: Db) {
  let armed = false;
  const wrap = (q: Queryable): Queryable => ({
    query: ((sql: string, params?: unknown[]) => {
      if (armed && /^\s*insert into order_version/i.test(sql)) {
        armed = false;
        return Promise.reject(Object.assign(new Error('duplicate key value violates unique constraint "order_version_pkey"'),
          { code: '23505', constraint: 'order_version_pkey' }));
      }
      return q.query(sql, params);
    }) as Queryable['query'],
    exec: (sql) => q.exec(sql),
  });
  const wrapped: Db = { ...wrap(db), tx: (fn) => db.tx((q) => fn(wrap(q))), close: () => db.close() };
  return { db: wrapped, arm: () => { armed = true; }, isArmed: () => armed };
}

async function submit(c: Client, lines: unknown = CASO_2): Promise<string> {
  const res = await c.post('/v1/portal/orders', { customerCode: '11131', header: CARRETA, lines }, { headers: { 'idempotency-key': newKey('conc') } });
  assert.equal(res.status, 201);
  return (await strictJson(res, PortalOrderView)).id;
}

describe('violação da PK de order_version vira 409 VERSION_CONFLICT, nada gravado (PGlite com 23505 injetado)', () => {
  let base: Db;
  let inj: ReturnType<typeof withInjectedPk>;
  let t: TestApp;
  let lucas: Client;
  let martin: Client;
  before(async () => {
    base = await seededDb();
    inj = withInjectedPk(base);
    t = testApp(inj.db);
    [lucas, martin] = await Promise.all(['lucas.exportacao', 'martin.minoil'].map((u) => Client.login(t.app, u)));
  });
  after(async () => { await base.close(); });

  const versions = async (id: string) =>
    Number((await base.query<{ n: number }>('select count(*) as n from order_version where order_id = $1', [id])).rows[0].n);
  const expectConflict = async (res: Response, currentVersion: number) => {
    assert.equal(res.status, 409);
    const { error } = (await res.json()) as { error: { code: string; details?: { params?: { currentVersion?: number } }[] } };
    assert.equal(error.code, 'VERSION_CONFLICT');
    assert.equal(error.details?.[0].params?.currentVersion, currentVersion);
  };

  test('nova versão do backoffice', async () => {
    const id = await submit(martin);
    const body = { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] };
    inj.arm();
    await expectConflict(await lucas.post(`/v1/backoffice/orders/${id}/versions`, body), 1);
    assert.equal(inj.isArmed(), false, 'a injeção foi usada');
    assert.equal(await versions(id), 1, 'nada gravado');
    const ok = await lucas.post(`/v1/backoffice/orders/${id}/versions`, body);
    assert.equal(ok.status, 200, 'controle');
    assert.equal((await strictJson(ok, BackofficeOrderView)).currentVersion, 2);
  });

  test('reenvio do portal (S9)', async () => {
    const id = await submit(martin);
    assert.equal((await lucas.post(`/v1/backoffice/orders/${id}/return`, { expectedVersion: 1, reason: 'x' })).status, 200);
    const body = { expectedVersion: 1, header: CARRETA, lines: CASO_2 };
    inj.arm();
    await expectConflict(await martin.post(`/v1/portal/orders/${id}/versions`, body), 1);
    assert.equal(await versions(id), 1);
    const st = (await base.query<{ status: string }>('select status from sales_order where id = $1', [id])).rows[0].status;
    assert.equal(st, 'CHANGES_REQUESTED', 'o estado não mudou');
    assert.equal((await martin.post(`/v1/portal/orders/${id}/versions`, body)).status, 200, 'controle');
  });

  test('outro 23505 (que não é a PK de order_version) não vira 409: continua erro interno', async () => {
    const id = await submit(martin);
    const other = withInjectedPk(base);
    const app = testApp({
      ...other.db,
      tx: (fn) => base.tx((q) => fn({
        query: ((sql: string, params?: unknown[]) => (/^\s*insert into order_version/i.test(sql)
          ? Promise.reject(Object.assign(new Error('dup'), { code: '23505', constraint: 'outra_restricao' }))
          : q.query(sql, params))) as Queryable['query'],
        exec: (sql) => q.exec(sql),
      })),
    });
    const l = await Client.login(app.app, 'lucas.exportacao');
    const res = await l.post(`/v1/backoffice/orders/${id}/versions`, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] });
    assert.equal(res.status, 500);
    assert.equal(await errorCode(res), 'INTERNAL');
  });
});

const PG_URL = process.env.TEST_DATABASE_URL;
describe('PostgreSQL 16 pelo adaptador pg: migrações, DDL e corridas reais', { skip: PG_URL ? false : 'TEST_DATABASE_URL não definida (sem PostgreSQL no corte)' }, () => {
  let db: Db;
  let t: TestApp;
  let lucas: Client;
  let ana: Client;
  let martin: Client;
  before(async () => {
    db = createPgDb(PG_URL!);
    await resetPgSchema(db, true); // só em banco terminado em _test (ou _dev)
    assert.deepEqual(await migrate(db), ['001_inicial']);
    await seed(db, { password: PASSWORD, log: () => undefined });
    t = testApp(db);
    [lucas, ana, martin] = await Promise.all(['lucas.exportacao', 'ana.exportacao', 'martin.minoil'].map((u) => Client.login(t.app, u)));
  });
  after(async () => { await db?.close(); });

  test('as mesmas migrações rodam: versão do servidor, segunda execução vazia, STORED, triggers e unicidades', async () => {
    const { rows: [v] } = await db.query<{ v: string }>(`select current_setting('server_version_num') as v`);
    assert.ok(Number(v.v) >= 160000, `PostgreSQL 16 ou mais novo (server_version_num ${v.v})`);
    assert.deepEqual(await migrate(db), [], 'segunda execução não muda nada');
    const { rows: [g] } = await db.query<{ g: string }>(
      `select attgenerated as g from pg_attribute where attrelid = 'palletization'::regclass and attname = 'boxes_per_pallet'`);
    assert.equal(g.g, 's', 'STORED');
    await assert.rejects(db.query(`update order_version set author_label = 'x' where order_id = '3CC-2026-0001'`), /aceita só inserção/);
    await assert.rejects(db.query(`delete from order_event where order_id = '3CC-2026-0001'`), /aceita só inserção/);
    const n = Number((await db.query<{ n: string }>('select count(*) as n from sales_order')).rows[0].n);
    assert.equal(n, 3, 'seed com os 3 pedidos');
  });

  test('mesma Idempotency-Key em paralelo → um 201 e um 200 replay (23505 traduzido), um só pedido', async () => {
    const key = newKey('pg-idem');
    const send = () => martin.post('/v1/portal/orders', { customerCode: '11131', header: CARRETA, lines: CASO_2 }, { headers: { 'idempotency-key': key } });
    const results = await Promise.all([send(), send(), send()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 201]);
    const n = Number((await db.query<{ n: string }>('select count(*) as n from sales_order where idempotency_key = $1', [key])).rows[0].n);
    assert.equal(n, 1);
  });

  test('duas versões em paralelo com o mesmo expectedVersion → 200 e 409 VERSION_CONFLICT; uma só v2', async () => {
    const id = await submit(martin);
    const results = await Promise.all([2520, 2688].map((boxes) =>
      lucas.post(`/v1/backoffice/orders/${id}/versions`, { expectedVersion: 1, changes: [{ material: '12031189', boxes }] })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await errorCode(results.find((r) => r.status === 409)!), 'VERSION_CONFLICT');
    const n = Number((await db.query<{ n: string }>('select count(*) as n from order_version where order_id = $1', [id])).rows[0].n);
    assert.equal(n, 2);
  });

  test('duas aprovações em paralelo → 200 e 409 INVALID_TRANSITION; um só evento APPROVED', async () => {
    const id = await submit(martin);
    const results = await Promise.all([ana.post(`/v1/backoffice/orders/${id}/approve`, { expectedVersion: 1 }),
      ana.post(`/v1/backoffice/orders/${id}/approve`, { expectedVersion: 1 })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const n = Number((await db.query<{ n: string }>(`select count(*) as n from order_event where order_id = $1 and type = 'APPROVED'`, [id])).rows[0].n);
    assert.equal(n, 1);
  });

  test('devolução e aprovação em paralelo → uma vence, a outra 409; dois reenvios em paralelo → 200 e 409', async () => {
    const id = await submit(martin);
    const race = await Promise.all([lucas.post(`/v1/backoffice/orders/${id}/return`, { expectedVersion: 1, reason: 'x' }),
      ana.post(`/v1/backoffice/orders/${id}/approve`, { expectedVersion: 1 })]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const id2 = await submit(martin);
    assert.equal((await lucas.post(`/v1/backoffice/orders/${id2}/return`, { expectedVersion: 1, reason: 'x' })).status, 200);
    const body = { expectedVersion: 1, header: CARRETA, lines: CASO_2 };
    const results = await Promise.all([martin.post(`/v1/portal/orders/${id2}/versions`, body), martin.post(`/v1/portal/orders/${id2}/versions`, body)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const n = Number((await db.query<{ n: string }>('select count(*) as n from order_version where order_id = $1', [id2])).rows[0].n);
    assert.equal(n, 2);
  });
});
