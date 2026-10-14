// Porta Db (PGlite), migrador com checksum e DDL do corte (docs/specs/02-banco.md).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPgliteDb } from '#server/adapters/db/pglite.ts';
import { createPgDb } from '#server/adapters/db/pg.ts';
import { uniqueViolation, type Db } from '#server/ports/db.ts';
import { MIGRATIONS_DIR, MigrationError, migrate, migrationChecksum } from '#server/db/migrate.ts';
import { insertMinimalData, insertOrder, type MinimalIds } from './helpers/minimal-data.ts';

function tempMigrations(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'psf-migr-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
}

describe('porta Db no PGlite', () => {
  let db: Db;
  before(async () => { db = await createPgliteDb(); });
  after(async () => { await db.close(); });

  test('query com parâmetros, exec com vários comandos e tipos devolvidos pelo driver', async () => {
    await db.exec('create table probe (id integer primary key, v text); create sequence probe_seq;');
    await db.query('insert into probe values ($1, $2)', [1, 'a']);
    const { rows } = await db.query<{ d: unknown; n: unknown; v: string }>(
      `select '2026-10-13'::date as d, 17.61::numeric(12,2) as n, v from probe where id = $1`, [1]);
    assert.deepEqual(rows, [{ d: '2026-10-13', n: '17.61', v: 'a' }], 'date como YYYY-MM-DD e numeric como texto');
  });

  test('tx confirma no sucesso e desfaz na falha', async () => {
    assert.equal(await db.tx(async (q) => { await q.query(`insert into probe values (2, 'b')`); return 'ok'; }), 'ok');
    await assert.rejects(db.tx(async (q) => {
      await q.query(`insert into probe values (3, 'c')`);
      throw new Error('falha no meio');
    }), /falha no meio/);
    const { rows } = await db.query<{ id: number }>('select id from probe order by id');
    assert.deepEqual(rows.map((r) => r.id), [1, 2]);
  });

  test('uniqueViolation devolve a restrição violada (para traduzir em 409 ou replay)', async () => {
    const err = await db.query(`insert into probe values (1, 'x')`).catch((e: unknown) => e);
    assert.equal(uniqueViolation(err), 'probe_pkey');
    assert.equal(uniqueViolation(new Error('outra coisa')), null);
  });
});

describe('migrador', () => {
  test('aplica 001 numa transação, grava o checksum e a segunda execução não muda nada', async () => {
    const db = await createPgliteDb();
    try {
      assert.deepEqual(await migrate(db), ['001_inicial']);
      const first = await db.query<{ version: string; checksum: string; applied_at: Date }>('select * from schema_migration');
      const sql = readFileSync(path.join(MIGRATIONS_DIR, '001_inicial.sql'), 'utf8');
      assert.equal(first.rows.length, 1);
      assert.equal(first.rows[0].checksum, migrationChecksum(sql));

      const tables = async () => (await db.query<{ n: string }>(
        `select table_name as n from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => r.n);
      const before = await tables();
      assert.deepEqual(await migrate(db), []);
      assert.deepEqual(await tables(), before);
      const second = await db.query<{ applied_at: Date }>('select applied_at from schema_migration');
      assert.deepEqual(second.rows, first.rows.map((r) => ({ applied_at: r.applied_at })));
      for (const t of ['import_batch', 'material', 'price', 'sales_order', 'order_version', 'order_event', 'master_override', 'app_session']) {
        assert.ok(before.includes(t), `tabela ${t} ausente`);
      }
      assert.ok(before.includes('material_effective'), 'view material_effective ausente');
    } finally {
      await db.close();
    }
  });

  test('checksum ignora a troca de \\r\\n por \\n (core.autocrlf)', () => {
    assert.equal(migrationChecksum('a;\r\nb;\r\n'), migrationChecksum('a;\nb;\n'));
    assert.notEqual(migrationChecksum('a;\nb;\n'), migrationChecksum('a;\nc;\n'));
  });

  test('checksum diferente de uma migração aplicada aborta; migração com erro não deixa rastro', async () => {
    const dir = tempMigrations();
    const db = await createPgliteDb();
    try {
      writeFileSync(path.join(dir, '001_inicial.sql'), 'create table so_a_primeira (id integer);\n');
      assert.deepEqual(await migrate(db, dir), ['001_inicial']);

      writeFileSync(path.join(dir, '001_inicial.sql'), 'create table so_a_primeira (id integer, outra text);\n');
      await assert.rejects(migrate(db, dir), (e: unknown) => e instanceof MigrationError && /checksum/i.test(e.message));

      writeFileSync(path.join(dir, '001_inicial.sql'), 'create table so_a_primeira (id integer);\r\n');
      writeFileSync(path.join(dir, '002_quebrada.sql'), 'create table parcial (id integer);\nselect * from tabela_que_nao_existe;\n');
      await assert.rejects(migrate(db, dir));
      const { rows } = await db.query<{ v: string | null }>(`select to_regclass('public.parcial')::text as v`);
      assert.equal(rows[0].v, null, 'a migração com erro foi desfeita');
      const versions = await db.query<{ version: string }>('select version from schema_migration order by version');
      assert.deepEqual(versions.rows.map((r) => r.version), ['001_inicial']);
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migração aplicada sem arquivo, fora de ordem ou com nome inválido aborta', async () => {
    const dir = tempMigrations();
    const db = await createPgliteDb();
    try {
      writeFileSync(path.join(dir, '001_inicial.sql'), 'select 1;\n');
      writeFileSync(path.join(dir, '003_terceira.sql'), 'select 3;\n');
      await migrate(db, dir);
      writeFileSync(path.join(dir, '002_atrasada.sql'), 'select 2;\n');
      await assert.rejects(migrate(db, dir), (e: unknown) => e instanceof MigrationError && /ordem/i.test(e.message));
      rmSync(path.join(dir, '002_atrasada.sql'));
      rmSync(path.join(dir, '003_terceira.sql'));
      await assert.rejects(migrate(db, dir), (e: unknown) => e instanceof MigrationError && /sem arquivo/i.test(e.message));
      writeFileSync(path.join(dir, '003_terceira.sql'), 'select 3;\n');
      writeFileSync(path.join(dir, '4-sem-padrao.sql'), 'select 4;\n');
      await assert.rejects(migrate(db, dir), (e: unknown) => e instanceof MigrationError && /nome/i.test(e.message));
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DDL do corte (001_inicial.sql)', () => {
  let db: Db;
  let ids: MinimalIds;
  before(async () => {
    db = await createPgliteDb();
    await migrate(db);
    ids = await db.tx((q) => insertMinimalData(q));
    await insertOrder(db, ids);
  });
  after(async () => { await db.close(); });

  const rejects = (sql: string, params: unknown[] = [], re?: RegExp) =>
    assert.rejects(db.query(sql, params), re ?? (() => true));

  test('UPDATE e DELETE em order_version, order_event e customer_rule_change falham', async () => {
    await db.query(`insert into customer_rule_change (customer_code, field, old_value, new_value, actor_id) values ('11131', 'mixed_pallet', false, true, $1)`, [ids.users.ana]);
    for (const t of ['order_version', 'order_event', 'customer_rule_change']) {
      await rejects(`update ${t} set ${t === 'customer_rule_change' ? 'new_value = false' : t === 'order_event' ? "actor_label = 'x'" : "author_label = 'x'"}`, [], /aceita só inserção/);
      await rejects(`delete from ${t}`, [], /aceita só inserção/);
    }
    const { rows } = await db.query<{ n: number }>('select count(*)::integer as n from order_version');
    assert.equal(rows[0].n, 1);
    // Controle positivo: inserir continua permitido.
    await db.query(`insert into order_event (order_id, actor_label, type) values ('3CC-2026-0001', 'Regra', 'AUTO_APPROVED')`);
  });

  test('boxes_per_pallet é coluna gerada STORED e não aceita valor explícito', async () => {
    // attgenerated: 's' = STORED, 'v' = virtual (PG 18 sem a palavra-chave; erro de sintaxe no PG 16). information_schema
    // diz ALWAYS nos dois casos, então não distingue.
    const { rows } = await db.query<{ generation: string; bpp: number }>(
      `select a.attgenerated as generation, p.boxes_per_pallet as bpp
         from pg_attribute a, palletization p
        where a.attrelid = 'palletization'::regclass and a.attname = 'boxes_per_pallet' and p.material_code = '12031189' and p.plant = '2612'`);
    assert.deepEqual(rows, [{ generation: 's', bpp: 168 }]);
    await rejects(`update palletization set boxes_per_pallet = 1 where material_code = '12031189'`);
  });

  test('override ACTIVE sem confirmação, confirmado pelo proponente ou segundo ativo no mesmo campo é rejeitado', async () => {
    const insert = (status: string, confirmedBy: number | null, field = 'layers', material = '12034109') => db.query(
      `insert into master_override (entity, material_code, key_part, field, sap_value, adopted_value, justification, decision_ref, status, proposed_by, confirmed_by)
       values ('palletization', $1, '2612', $2, 7, 8, 'teste', 'Q12', $3, $4, $5)`,
      [material, field, status, ids.users.admin, confirmedBy]);
    await assert.rejects(insert('ACTIVE', null));
    await assert.rejects(insert('ACTIVE', ids.users.admin));
    await assert.rejects(insert('ACTIVE', ids.users.ana, 'layer_boxes'), (e: unknown) => uniqueViolation(e) === 'master_override_active');
    // Controles positivos: proposto sem confirmação e ativo em outro campo.
    await insert('PROPOSED', null, 'layer_boxes');
    await insert('ACTIVE', ids.users.ana, 'layers', '20908885');
    await db.query(`update master_override set status = 'REVOKED' where material_code = '20908885' and field = 'layers'`);
  });

  test('origin fora da lista, preço com chave natural repetida e Idempotency-Key repetida no mesmo cliente são rejeitados', async () => {
    await rejects(`insert into sales_order (id, customer_code, status, current_version, origin, created_by) values ('X-1', '11131', 'SUBMITTED', 1, 'EMAIL', $1)`, [ids.users.martin]);
    await rejects(
      `insert into price (channel, plant, price_list, material_code, valid_from, valid_to, price, currency, origin, batch_id)
       values ('13', '2612', 'US', '12031189', '2026-01-01', '2026-12-31', 1, 'USD', 'SAP_LIST', $1)`, [ids.batch],
      /price_natural_key/);
    await rejects(
      `insert into price (channel, plant, price_list, material_code, valid_from, valid_to, price, currency, origin, batch_id)
       values ('13', '2612', 'US', '20908885', '2026-01-01', '2026-12-31', 1, 'USD', 'PLANILHA', $1)`, [ids.batch]);
    await insertOrder(db, ids, '3CC-2026-0002', 'chave-1');
    const dup = await insertOrder(db, ids, '3CC-2026-0003', 'chave-1').catch((e: unknown) => e);
    assert.equal(uniqueViolation(dup), 'sales_order_customer_code_idempotency_key_key');
    // Controle positivo: a mesma chave em outro cliente é aceita.
    await db.query(
      `insert into sales_order (id, customer_code, status, current_version, origin, created_by, idempotency_key)
       values ('3CC-2026-0004', '11999', 'SUBMITTED', 1, 'PORTAL', $1, 'chave-1')`, [ids.users.martin]);
  });
});

// O adaptador pg só roda com um PostgreSQL disponível (sem Docker no corte): TEST_DATABASE_URL aponta para um banco descartável.
// Schema próprio: concorrencia.test.ts, que roda em paralelo, recria o schema public do mesmo banco.
describe('porta Db no pg', { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL não definida' }, () => {
  test('tx confirma e desfaz; date como YYYY-MM-DD', async () => {
    const db = createPgDb(process.env.TEST_DATABASE_URL!);
    try {
      await db.exec('drop schema if exists psf_probe_s cascade; create schema psf_probe_s; create table psf_probe_s.probe (id integer primary key);');
      await db.tx(async (q) => { await q.query('insert into psf_probe_s.probe values (1)'); });
      await assert.rejects(db.tx(async (q) => { await q.query('insert into psf_probe_s.probe values (2)'); throw new Error('x'); }));
      assert.deepEqual((await db.query('select id from psf_probe_s.probe')).rows, [{ id: 1 }]);
      assert.deepEqual((await db.query(`select '2026-10-13'::date as d`)).rows, [{ d: '2026-10-13' }]);
      await db.exec('drop schema psf_probe_s cascade');
    } finally {
      await db.close();
    }
  });
});
