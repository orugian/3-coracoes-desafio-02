// Isolamento entre distribuidores (docs/specs/04-api.md, "Testes do servidor", itens 1, 2 e 4; §6 da arquitetura).
// Toda negação tem o controle positivo na mesma rota: o mesmo usuário acessando o que é dele.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EngineResult, PortalCatalog, PortalOrderView } from '#contracts';
import type { Db } from '#server/ports/db.ts';
import { Client, createUser, errorCode, keyPaths, newKey, seededDb, strictJson, testApp, type TestApp } from './helpers/api.ts';

const CASO_2 = [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1400 }];
const header = { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: 'ISO-1', loadingDate: null };
const orderBody = (customerCode: string) => ({ customerCode, header, lines: CASO_2 });

let db: Db;
let t: TestApp;
let martin: Client;
let sofia: Client;
before(async () => {
  db = await seededDb();
  t = testApp(db);
  martin = await Client.login(t.app, 'martin.minoil');
  sofia = await Client.login(t.app, 'sofia.rioclaro');
});
after(async () => { await db.close(); });

describe('item 1: pedido de outro distribuidor → 404', () => {
  test('Martín abre o 0001 (dele) → 200 e o 0003 (Río Claro) → 404', async () => {
    const own = await martin.get('/v1/portal/orders/3CC-2026-0001');
    assert.equal(own.status, 200);
    assert.equal((await strictJson(own, PortalOrderView)).customerCode, '11131');
    const other = await martin.get('/v1/portal/orders/3CC-2026-0003');
    assert.equal(other.status, 404);
    assert.equal(await errorCode(other), 'NOT_FOUND');
  });

  test('Sofía abre o 0003 (dela) → 200 e o 0001 (MINOIL) → 404', async () => {
    const own = await sofia.get('/v1/portal/orders/3CC-2026-0003');
    assert.equal(own.status, 200);
    assert.equal((await strictJson(own, PortalOrderView)).customerCode, '11999');
    assert.equal((await sofia.get('/v1/portal/orders/3CC-2026-0001')).status, 404);
  });

  test('pedido inexistente → o mesmo 404 de pedido de outro cliente', async () => {
    const missing = await martin.get('/v1/portal/orders/3CC-2026-9999');
    const other = await martin.get('/v1/portal/orders/3CC-2026-0003');
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), await other.text());
  });

  test('a lista de cada um só tem os pedidos do próprio escopo', async () => {
    const mine = await strictJson(await martin.get('/v1/portal/orders'), PortalOrderView.array());
    assert.deepEqual(mine.map((o) => o.id).sort(), ['3CC-2026-0001', '3CC-2026-0002']);
    const hers = await strictJson(await sofia.get('/v1/portal/orders'), PortalOrderView.array());
    assert.deepEqual(hers.map((o) => o.id), ['3CC-2026-0003']);
  });
});

describe('item 2: cliente fora do escopo → 404', () => {
  test('catálogo: sem customer usa o único do escopo (11131); ?customer=11999 → 404', async () => {
    const own = await martin.get('/v1/portal/catalog');
    assert.equal(own.status, 200);
    assert.equal((await strictJson(own, PortalCatalog)).customer.code, '11131');
    const explicit = await martin.get('/v1/portal/catalog?customer=11131');
    assert.equal(explicit.status, 200, 'controle com o parâmetro');
    for (const code of ['11999', '00000']) {
      const res = await martin.get(`/v1/portal/catalog?customer=${code}`);
      assert.equal(res.status, 404, code);
      assert.equal(await errorCode(res), 'NOT_FOUND');
    }
  });

  test('simulação: customerCode 11131 → 200; 11999 → 404', async () => {
    const own = await martin.post('/v1/portal/quote', orderBody('11131'));
    assert.equal(own.status, 200);
    EngineResult.parse(await own.json());
    assert.equal((await martin.post('/v1/portal/quote', orderBody('11999'))).status, 404);
  });

  test('envio: customerCode 11131 → 201; 11999 → 404, sem criar pedido', async () => {
    const own = await martin.post('/v1/portal/orders', orderBody('11131'), { headers: { 'idempotency-key': newKey('iso-own') } });
    assert.equal(own.status, 201);
    assert.equal((await strictJson(own, PortalOrderView)).customerCode, '11131');
    const before = Number((await db.query<{ n: number }>(`select count(*) as n from sales_order where customer_code = '11999'`)).rows[0].n);
    const other = await martin.post('/v1/portal/orders', orderBody('11999'), { headers: { 'idempotency-key': newKey('iso-other') } });
    assert.equal(other.status, 404);
    const after = Number((await db.query<{ n: number }>(`select count(*) as n from sales_order where customer_code = '11999'`)).rows[0].n);
    assert.equal(after, before);
  });

  test('usuário com dois clientes: catálogo sem customer → 422; com cada um → 200', async () => {
    await createUser(db, 'teste.dois', 'ext_distribuidor', ['11131', '11999']);
    const two = await Client.login(t.app, 'teste.dois');
    const none = await two.get('/v1/portal/catalog');
    assert.equal(none.status, 422);
    assert.equal(await errorCode(none), 'VALIDATION_FAILED');
    for (const code of ['11131', '11999']) {
      const res = await two.get(`/v1/portal/catalog?customer=${code}`);
      assert.equal(res.status, 200);
      assert.equal((await strictJson(res, PortalCatalog)).customer.code, code);
    }
  });
});

describe('item 4: nada interno nem de outro cliente nas respostas do portal', () => {
  const FORBIDDEN_KEYS = ['origin', 'prices', 'ob', 'sap', 'overrides', 'autoApprove', 'country', 'isDemo', 'internal'];
  const FORBIDDEN_TEXT = ['11999', 'rioclaro', 'Río Claro', 'Sofía', 'DEMO_DERIVED', 'SITE_3C'];
  // A única chave origin permitida é a do topo do pedido (origem do pedido: PORTAL ou ORDER_BASIS, contrato OrderView).
  const ALLOWED_PATHS = new Set(['origin']);

  const check = (label: string, json: unknown) => {
    const leaked = keyPaths(json).filter((p) => !ALLOWED_PATHS.has(p) && FORBIDDEN_KEYS.includes(p.split('.').at(-1)!));
    assert.deepEqual(leaked, [], `${label}: chaves internas`);
    const text = JSON.stringify(json);
    for (const s of FORBIDDEN_TEXT) assert.ok(!text.includes(s), `${label}: contém ${s}`);
  };

  test('catálogo de Martín: schema estrito e sem chave nem texto interno', async () => {
    const res = await martin.get('/v1/portal/catalog');
    const json = await res.json();
    PortalCatalog.parse(json);
    check('catálogo', json);
    const catalog = PortalCatalog.parse(json);
    assert.equal(catalog.items.length, 10);
    assert.equal(catalog.items.find((i) => i.material === '12034109')?.price, 36.96, 'preço da lista US (origem SITE_3C não aparece)');
    assert.deepEqual(catalog.customer.restrictedMaterials, []);
    assert.deepEqual(catalog.rules, { fullAt: 0.9, leadDays: 7 });
    assert.deepEqual(catalog.vehicles.map((v) => [v.id, v.palletPositions]), [['carreta_padrao', 28], ['container_40', 20], ['container_20', 10]]);
    assert.deepEqual(catalog.vehicles[0].assumptions, ['Posições de pallet: artefato 3C Conecta (Q4)']);
  });

  test('controle: o catálogo de Sofía traz a lista AR e a restrição do país dela', async () => {
    const catalog = await strictJson(await sofia.get('/v1/portal/catalog'), PortalCatalog);
    assert.equal(catalog.customer.code, '11999');
    assert.equal(catalog.customer.priceList, 'AR');
    assert.deepEqual(catalog.customer.restrictedMaterials, ['20908885']);
    assert.equal(catalog.items.find((i) => i.material === '12031189')?.price, 52.37);
  });

  test('pedido 3CC-2026-0001 de Martín: schema estrito, sem chave nem texto interno; o SUBMITTED chega sem os totais da OB', async () => {
    const res = await martin.get('/v1/portal/orders/3CC-2026-0001');
    const json = await res.json();
    const order = PortalOrderView.parse(json);
    check('pedido 0001', json);
    assert.equal(order.origin, 'ORDER_BASIS');
    const submitted = order.events?.find((e) => e.type === 'SUBMITTED');
    assert.ok(submitted);
    assert.deepEqual(submitted.payload, {});
    const text = JSON.stringify(json);
    // Totais da OB (ORDEM!X2, W2, Y2) diferem dos do motor; os pallets (Y4, 28,886) coincidem com o total do motor e não entram.
    for (const s of ['20151.04', '19070', '192005.84', 'orderBasis', 'ORDEM']) assert.ok(!text.includes(s), `totais da OB: ${s}`);
    // Controle: o banco tem os totais no payload.internal (é o portal que não os recebe).
    const { rows: [e] } = await db.query<{ payload: { internal?: { orderBasis?: { grossKg: number } } } }>(
      `select payload from order_event where order_id = '3CC-2026-0001' and type = 'SUBMITTED'`);
    assert.equal(e.payload.internal?.orderBasis?.grossKg, 20151.04);
  });

  test('pedido 0002 de Martín (com ajuste da Exportação): a mudança chega, sem internal', async () => {
    const order = await strictJson(await martin.get('/v1/portal/orders/3CC-2026-0002'), PortalOrderView);
    check('pedido 0002', order);
    const created = order.events?.find((e) => e.type === 'VERSION_CREATED');
    assert.deepEqual(created?.payload, { changes: [{ material: '12034103', old: 324, new: 405 }], reason: 'completar a carreta' });
    assert.equal(order.versions?.length, 2);
    assert.equal(order.approvedByLabel, 'Ana (Exportação)');
  });

  test('lista de pedidos e simulação de Martín passam no schema estrito e não têm chave interna', async () => {
    const list = await (await martin.get('/v1/portal/orders')).json();
    PortalOrderView.array().parse(list);
    check('lista', list);
    const quote = await (await martin.post('/v1/portal/quote', orderBody('11131'))).json();
    EngineResult.parse(quote);
    check('simulação', quote);
  });
});
