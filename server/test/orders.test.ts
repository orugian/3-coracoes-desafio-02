// Envio, simulação e consulta de pedidos pelo portal (docs/specs/04-api.md, "Testes do servidor", Pedidos; "Regras
// transversais"; "Máquina de estados"). Respostas do portal validadas pelo schema estrito.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '#engine';
import { CustomerInternal, EngineResult, PortalCatalog, PortalOrderView } from '#contracts';
import type { Db } from '#server/ports/db.ts';
import { buildEngineInput } from '#server/repo/catalog.ts';
import { orderContentHash } from '#server/domain/content-hash.ts';
import { saoPauloDate } from '#server/domain/time.ts';
import { Client, addDays, errorCode, newKey, seededDb, strictJson, testApp, type TestApp } from './helpers/api.ts';

const CARRETA = { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED' } as const;
const C40 = { vehicleId: 'container_40', loadMode: 'PALLETIZED' } as const;
const CASO_1 = [{ material: '12031189', boxes: 3528 }, { material: '12034103', boxes: 300 }, { material: '12037417', boxes: 250 }, { material: '12144012', boxes: 300 }];
const CASO_2 = [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1400 }];
const CASO_4 = [{ material: '20908885', boxes: 110 }, { material: '12142501', boxes: 560 }];
const UPSELL_1 = [{ material: '12031189', boxes: 3864 }, { material: '12142501', boxes: 1400 }]; // 28 de 28, 90,1% do peso

type Header = { vehicleId: string; loadMode: string; reference?: string; loadingDate?: string | null; [k: string]: unknown };
const body = (customerCode: string, header: Header, lines: unknown[], extra: Record<string, unknown> = {}) =>
  ({ customerCode, header: { reference: 'OC-TESTE', loadingDate: null, ...header }, lines, ...extra });

let db: Db;
let t: TestApp;
let martin: Client;
let sofia: Client;
let ana: Client;
before(async () => {
  db = await seededDb();
  t = testApp(db);
  [martin, sofia, ana] = await Promise.all(['martin.minoil', 'sofia.rioclaro', 'ana.exportacao'].map((u) => Client.login(t.app, u)));
});
after(async () => { await db.close(); });

const send = (c: Client, b: unknown, key: string | null = newKey()) =>
  c.post('/v1/portal/orders', b, key === null ? {} : { headers: { 'idempotency-key': key } });
const countOrders = async (where = 'true', params: unknown[] = []) =>
  Number((await db.query<{ n: number }>(`select count(*) as n from sales_order where ${where}`, params)).rows[0].n);
const errorBody = async (res: Response) => (await res.json()) as { error: { code: string; details?: { code: string; material?: string; params?: Record<string, unknown> }[] } };

describe('envio', () => {
  test('caso 2 → 201 SUBMITTED com o resultado do motor, versão 1 imutável e evento SUBMITTED', async () => {
    const res = await send(martin, body('11131', CARRETA, CASO_2));
    assert.equal(res.status, 201);
    const order = await strictJson(res, PortalOrderView);
    assert.match(order.id, new RegExp(`^3CC-${saoPauloDate().slice(0, 4)}-\\d{4}$`));
    assert.deepEqual([order.status, order.origin, order.currentVersion, order.customerCode, order.customerName],
      ['SUBMITTED', 'PORTAL', 1, '11131', 'MINOIL S.A.']);
    assert.equal(order.createdByLabel, 'Martín (MINOIL S.A.)');
    assert.equal(order.approvedAt, null);
    assert.deepEqual(order.permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });
    const r = order.current.result;
    assert.equal(r.totals.positions, 19);
    assert.equal(r.status, 'PARTIAL');
    assert.ok(Math.abs(r.totals.grossKg - 14468.16) <= 0.005);
    assert.equal(r.totals.valueCents, 14_639_632);
    assert.deepEqual(order.current.header, { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: 'OC-TESTE', loadingDate: null, mixedPallet: false });
    assert.deepEqual(order.current.lines, [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1400 }]);
    assert.equal(order.versions?.length, 1);
    assert.deepEqual(order.events?.map((e) => [e.type, e.actorLabel, e.fromStatus, e.toStatus, e.versionNo]),
      [['SUBMITTED', 'Martín (MINOIL S.A.)', null, 'SUBMITTED', 1]]);

    // O servidor recalcula: o resultado é o do motor sobre o banco, e o content_hash é reproduzível.
    const priceDate = saoPauloDate();
    const built = await buildEngineInput(db, '11131', CARRETA, CASO_2, priceDate);
    assert.deepEqual(r, calculate(built.input));
    const { rows: [v] } = await db.query<{ content_hash: string; data_batches: number[]; overrides: number[]; engine_result: { inputs: unknown }; blocking: boolean; author_label: string }>(
      `select content_hash, data_batches, overrides, engine_result, blocking, author_label from order_version where order_id = $1 and version_no = 1`, [order.id]);
    assert.deepEqual(v.engine_result.inputs, { priceDate, vehicleId: 'carreta_padrao', customerCode: '11131' });
    assert.equal(v.blocking, false);
    assert.deepEqual(v.data_batches, built.dataBatches);
    assert.equal(v.content_hash, orderContentHash({
      header: { ...CARRETA, mixedPallet: false, reference: 'OC-TESTE', loadingDate: null }, lines: CASO_2, engineVersion: 1,
      dataBatches: built.dataBatches, overrides: built.overrides,
    }));
    await assert.rejects(db.query(`update order_version set blocking = true where order_id = $1`, [order.id]), /aceita só inserção/);
  });

  test('linhas fora de ordem são gravadas na ordem do catálogo', async () => {
    const order = await strictJson(await send(martin, body('11131', CARRETA, [...CASO_2].reverse())), PortalOrderView);
    assert.deepEqual(order.current.lines.map((l) => l.material), ['12031189', '12142501']);
  });

  test('caso 4 (Sofía) → 422 ORDER_BLOCKED com COUNTRY_RESTRICTED e BELOW_MIN_LOT, sem gravar', async () => {
    const before = await countOrders();
    const res = await send(sofia, body('11999', C40, CASO_4));
    assert.equal(res.status, 422);
    const { error } = await errorBody(res);
    assert.equal(error.code, 'ORDER_BLOCKED');
    assert.deepEqual(error.details, [ // na ordem do catálogo, como as linhas do resultado
      { code: 'BELOW_MIN_LOT', material: '12142501', params: { minLot: 5 } },
      { code: 'COUNTRY_RESTRICTED', material: '20908885' },
    ]);
    assert.equal(await countOrders(), before);
  });

  test('caso 1 (Martín) → 422 ORDER_BLOCKED com VEHICLE_EXCEEDED', async () => {
    const res = await send(martin, body('11131', CARRETA, CASO_1));
    assert.equal(res.status, 422);
    const { error } = await errorBody(res);
    assert.equal(error.code, 'ORDER_BLOCKED');
    assert.deepEqual(error.details?.map((d) => [d.code, d.params?.positions]), [['VEHICLE_EXCEEDED', 2]]);
  });

  test('data de carregamento: a 3 dias → 422 LOADING_DATE_TOO_SOON; ontem → 422; a 7 dias e vazia → 201', async () => {
    const today = saoPauloDate();
    for (const date of [addDays(today, 3), addDays(today, 6), addDays(today, -1)]) {
      const res = await send(martin, body('11131', { ...CARRETA, loadingDate: date }, CASO_2));
      assert.equal(res.status, 422, date);
      assert.equal(await errorCode(res), 'LOADING_DATE_TOO_SOON');
    }
    const ok = await send(martin, body('11131', { ...CARRETA, loadingDate: addDays(today, 7) }, CASO_2));
    assert.equal(ok.status, 201, 'controle: exatamente hoje + 7');
    assert.equal((await strictJson(ok, PortalOrderView)).current.header.loadingDate, addDays(today, 7));
  });

  test('o dia vale no fuso de São Paulo (relógio às 23h30 de São Paulo, já dia seguinte em UTC)', async () => {
    const now = new Date('2026-10-20T02:30:00Z'); // 19/10 23:30 em São Paulo
    const clock = testApp(db, { now: () => now });
    const c = await Client.login(clock.app, 'martin.minoil');
    const tooSoon = await send(c, body('11131', { ...CARRETA, loadingDate: '2026-10-25' }, CASO_2));
    assert.equal(tooSoon.status, 422);
    const ok = await send(c, body('11131', { ...CARRETA, loadingDate: '2026-10-26' }, CASO_2));
    assert.equal(ok.status, 201);
    const order = await strictJson(ok, PortalOrderView);
    assert.equal(order.createdAt, now.toISOString());
    assert.match(order.id, /^3CC-2026-/);
  });

  test('mixedPallet no corpo é ignorado: vale o do cliente', async () => {
    const res = await send(martin, body('11131', { ...CARRETA, mixedPallet: true }, CASO_2, { mixedPallet: true }));
    assert.equal(res.status, 201);
    assert.equal((await strictJson(res, PortalOrderView)).current.header.mixedPallet, false);
    const quote = await strictJson(await martin.post('/v1/portal/quote', body('11131', { ...CARRETA, mixedPallet: true }, CASO_1, { mixedPallet: true })), EngineResult);
    assert.equal(quote.totals.positions, 30, 'sem misto (com misto seriam 29)');
  });

  test('pallet misto ligado no cliente pela Exportação vale no portal (29 posições no pedido-teste) e na versão', async () => {
    const on = await ana.put('/v1/backoffice/customers/11131/rules', { mixedPallet: true });
    assert.equal(on.status, 200);
    try {
      const catalog = await strictJson(await martin.get('/v1/portal/catalog'), PortalCatalog);
      assert.equal(catalog.customer.mixedPallet, true);
      const quote = await strictJson(await martin.post('/v1/portal/quote', body('11131', CARRETA, CASO_1)), EngineResult);
      assert.equal(quote.totals.positions, 29);
      const order = await strictJson(await send(martin, body('11131', CARRETA, CASO_2)), PortalOrderView);
      assert.equal(order.current.header.mixedPallet, true);
    } finally {
      assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { mixedPallet: false })).status, 200);
    }
  });
});

describe('validação do corpo', () => {
  // [nome, corpo, código do detalhe esperado (INVALID_FIELD traz o caminho do campo)]
  const invalid: [string, unknown, string, string?][] = [
    ['sem linhas', body('11131', CARRETA, []), 'INVALID_FIELD', 'lines'],
    ['material repetido', body('11131', CARRETA, [{ material: '12031189', boxes: 168 }, { material: '12031189', boxes: 168 }]), 'DUPLICATE_MATERIAL'],
    ['material inexistente', body('11131', CARRETA, [{ material: '99999999', boxes: 10 }]), 'UNKNOWN_MATERIAL'],
    ['material sem 8 dígitos', body('11131', CARRETA, [{ material: '1203118', boxes: 10 }]), 'INVALID_FIELD', 'lines.0.material'],
    ['zero caixas', body('11131', CARRETA, [{ material: '12031189', boxes: 0 }]), 'INVALID_FIELD', 'lines.0.boxes'],
    ['acima de 100.000', body('11131', CARRETA, [{ material: '12031189', boxes: 100_001 }]), 'INVALID_FIELD', 'lines.0.boxes'],
    ['caixas como texto', body('11131', CARRETA, [{ material: '12031189', boxes: '168' }]), 'INVALID_FIELD', 'lines.0.boxes'],
    ['mais de 50 linhas', body('11131', CARRETA, Array.from({ length: 51 }, (_, i) => ({ material: String(12000000 + i), boxes: 1 }))), 'INVALID_FIELD', 'lines'],
    ['referência com 31 caracteres', body('11131', { ...CARRETA, reference: 'x'.repeat(31) }, CASO_2), 'INVALID_FIELD', 'header.reference'],
    ['referência com quebra de linha', body('11131', { ...CARRETA, reference: 'OC\n1' }, CASO_2), 'INVALID_FIELD', 'header.reference'],
    ['veículo desconhecido', body('11131', { vehicleId: 'navio-secreto', loadMode: 'PALLETIZED' }, CASO_2), 'INVALID_FIELD', 'header.vehicleId'],
    ['modo desconhecido', body('11131', { vehicleId: 'carreta_padrao', loadMode: 'pal' }, CASO_2), 'INVALID_FIELD', 'header.loadMode'],
    ['data inexistente', body('11131', { ...CARRETA, loadingDate: '2026-02-30' }, CASO_2), 'INVALID_FIELD', 'header.loadingDate'],
    ['sem cabeçalho', { customerCode: '11131', lines: CASO_2 }, 'INVALID_FIELD', 'header'],
  ];
  for (const [name, b, detail, path] of invalid) {
    test(`${name} → 422 VALIDATION_FAILED com ${detail}${path ? ` em ${path}` : ''}, sem gravar`, async () => {
      const before = await countOrders();
      const res = await send(martin, b);
      assert.equal(res.status, 422);
      const text = await res.text();
      const { error } = JSON.parse(text) as Awaited<ReturnType<typeof errorBody>>;
      assert.equal(error.code, 'VALIDATION_FAILED');
      assert.ok(error.details?.some((d) => d.code === detail && (path === undefined || d.params?.path === path)), JSON.stringify(error.details));
      assert.ok(!text.includes('navio-secreto') && !text.includes('xxxxxxxxxxxxxxx'), 'não ecoa o valor recebido');
      assert.equal(await countOrders(), before);
    });
  }

  test('ordem das recusas: corpo inválido com cliente de fora → 422 (não 404); material inexistente com data a 1 dia → 422 de material', async () => {
    const dup = await send(martin, body('11999', C40, [{ material: '12031189', boxes: 168 }, { material: '12031189', boxes: 168 }]));
    assert.equal(dup.status, 422);
    assert.equal(await errorCode(dup), 'VALIDATION_FAILED');
    const unknown = await send(martin, body('11131', { ...CARRETA, loadingDate: addDays(saoPauloDate(), 1) }, [{ material: '99999999', boxes: 10 }]));
    assert.equal(unknown.status, 422);
    const { error } = await errorBody(unknown);
    assert.deepEqual([error.code, error.details?.[0].code], ['VALIDATION_FAILED', 'UNKNOWN_MATERIAL']);
  });

  test('caixa fracionária → 422 VALIDATION_FAILED com QTY_NOT_MULTIPLE (envio e simulação)', async () => {
    const b = body('11131', CARRETA, [{ material: '12031291', boxes: 50.5 }]);
    for (const res of [await send(martin, b), await martin.post('/v1/portal/quote', b)]) {
      assert.equal(res.status, 422);
      const { error } = await errorBody(res);
      assert.equal(error.code, 'VALIDATION_FAILED');
      assert.deepEqual(error.details, [{ code: 'QTY_NOT_MULTIPLE', material: '12031291', params: { lo: 50, hi: 51 } }]);
    }
  });

  test('referência é aparada', async () => {
    const order = await strictJson(await send(martin, body('11131', { ...CARRETA, reference: '  OC-77  ' }, CASO_2)), PortalOrderView);
    assert.equal(order.current.header.reference, 'OC-77');
  });
});

describe('idempotência', () => {
  test('sem Idempotency-Key → 428; chave fora do formato → 422', async () => {
    const missing = await send(martin, body('11131', CARRETA, CASO_2), null);
    assert.equal(missing.status, 428);
    assert.equal(await errorCode(missing), 'IDEMPOTENCY_KEY_REQUIRED');
    for (const key of ['curta', 'com espaço no meio', 'x'.repeat(65), 'acentuação-ç']) {
      const res = await send(martin, body('11131', CARRETA, CASO_2), key);
      assert.equal(res.status, 422, key);
    }
  });

  test('mesma chave e mesmo corpo → 200 com Idempotent-Replayed e um só pedido', async () => {
    const key = newKey('replay');
    const b = body('11131', CARRETA, CASO_2);
    const first = await send(martin, b, key);
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('idempotent-replayed'), null);
    const created = await strictJson(first, PortalOrderView);
    // Mesmo conteúdo com as linhas em outra ordem e chaves em outra ordem: mesmo corpo canônico.
    const again = await send(martin, { lines: [...CASO_2].reverse(), header: b.header, customerCode: '11131' }, key);
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    const replayed = await strictJson(again, PortalOrderView);
    assert.equal(replayed.id, created.id);
    assert.equal(await countOrders('idempotency_key = $1', [key]), 1);
  });

  test('mesma chave e outro corpo → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = newKey('reuse');
    assert.equal((await send(martin, body('11131', CARRETA, CASO_2), key)).status, 201);
    const res = await send(martin, body('11131', CARRETA, [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1401 }]), key);
    assert.equal(res.status, 409);
    assert.equal(await errorCode(res), 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await countOrders('idempotency_key = $1', [key]), 1);
  });

  test('a chave é por cliente: a mesma chave em outro cliente cria outro pedido', async () => {
    const key = newKey('cliente');
    assert.equal((await send(martin, body('11131', CARRETA, CASO_2), key)).status, 201);
    const other = await send(sofia, body('11999', C40, [{ material: '12031291', boxes: 1176 }]), key);
    assert.equal(other.status, 201);
    assert.equal(await countOrders('idempotency_key = $1', [key]), 2);
  });

  test('duas requisições simultâneas com a mesma chave → um 201 e um 200, nunca 500', async () => {
    const key = newKey('concorrente');
    const b = body('11131', CARRETA, CASO_2);
    const [a, c] = await Promise.all([send(martin, b, key), send(martin, b, key)]);
    assert.deepEqual([a.status, c.status].sort(), [200, 201]);
    const [oa, oc] = [await strictJson(a, PortalOrderView), await strictJson(c, PortalOrderView)];
    assert.equal(oa.id, oc.id);
    assert.equal(await countOrders('idempotency_key = $1', [key]), 1);
  });

  // O PGlite serializa tudo, então a corrida acima quase sempre vira replay na busca anterior à transação. Aqui a busca
  // inicial é escondida, como no pg quando as duas leem antes de qualquer commit: a chave repetida estoura na unicidade
  // (sales_order, customer_code + idempotency_key) e precisa virar replay ou 409, nunca 500 (02, "Porta Db").
  test('chave repetida que só aparece na unicidade, dentro da transação → replay 200 ou 409, nunca 500', async () => {
    let hideNext = false;
    let hidden = 0;
    const racing: Db = {
      ...db,
      query: (sql, params) => {
        if (hideNext && sql.includes('idempotency_key = $2')) {
          hideNext = false;
          hidden++;
          return Promise.resolve({ rows: [] });
        }
        return db.query(sql, params);
      },
    };
    const race = testApp(racing);
    const c = await Client.login(race.app, 'martin.minoil');
    const key = newKey('unicidade');
    const b = body('11131', CARRETA, CASO_2);
    const first = await strictJson(await send(martin, b, key), PortalOrderView);

    hideNext = true;
    const same = await send(c, b, key);
    assert.equal(hidden, 1, 'a busca anterior à transação foi escondida');
    assert.equal(same.status, 200);
    assert.equal(same.headers.get('idempotent-replayed'), 'true');
    assert.equal((await strictJson(same, PortalOrderView)).id, first.id);

    hideNext = true;
    const other = await send(c, body('11131', CARRETA, CASO_1.slice(0, 1)), key);
    assert.equal(hidden, 2);
    assert.equal(other.status, 409);
    assert.equal(await errorCode(other), 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await countOrders('idempotency_key = $1', [key]), 1);
    assert.ok(!race.logs.some((l) => l.includes('erro interno')));
  });

  test('replay devolve o pedido mesmo que a data de carregamento já não passe na regra dos 7 dias', async () => {
    const key = newKey('replay-data');
    const date = addDays(saoPauloDate(), 7);
    const b = body('11131', { ...CARRETA, loadingDate: date }, CASO_2);
    assert.equal((await send(martin, b, key)).status, 201);
    const later = testApp(db, { now: () => new Date(Date.now() + 3 * 86_400_000) });
    const c = await Client.login(later.app, 'martin.minoil');
    const res = await send(c, b, key);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('idempotent-replayed'), 'true');
  });
});

describe('lista e detalhe', () => {
  test('lista do escopo, mais recentes primeiro, com filtro de status; status desconhecido → 422', async () => {
    const all = await strictJson(await martin.get('/v1/portal/orders'), PortalOrderView.array());
    assert.ok(all.length >= 3);
    assert.ok(all.every((o) => o.customerCode === '11131'));
    const times = all.map((o) => Date.parse(o.createdAt));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.ok(all.every((o) => o.versions === undefined && o.events === undefined), 'versões e eventos só no detalhe');
    const approved = await strictJson(await martin.get('/v1/portal/orders?status=APPROVED'), PortalOrderView.array());
    assert.ok(approved.length >= 1 && approved.every((o) => o.status === 'APPROVED'));
    assert.ok(approved.some((o) => o.id === '3CC-2026-0002'));
    const bad = await martin.get('/v1/portal/orders?status=aprovado');
    assert.equal(bad.status, 422);
  });

  test('detalhe do 0002: duas versões, eventos em ordem e aprovação por Ana', async () => {
    const o = await strictJson(await martin.get('/v1/portal/orders/3CC-2026-0002'), PortalOrderView);
    assert.deepEqual(o.versions?.map((v) => [v.versionNo, v.authorLabel]), [[1, 'Martín (MINOIL S.A.)'], [2, 'Lucas (Exportação)']]);
    assert.equal(o.current.versionNo, 2);
    assert.deepEqual(o.events?.map((e) => e.type), ['SUBMITTED', 'VERSION_CREATED', 'APPROVED']);
    assert.equal(o.approvedAt, new Date('2026-10-11T11:40:00-03:00').toISOString());
    assert.equal(o.submittedAt, new Date('2026-10-11T09:12:00-03:00').toISOString());
  });
});

describe('aprovação automática', () => {
  test('Ana liga a regra pela rota; o upsell do caso 2 (28 de 28, 90,1%) nasce APPROVED com AUTO_APPROVED e ruleChangeId', async () => {
    const res = await ana.put('/v1/backoffice/customers/11131/rules', { autoApprove: true });
    assert.equal(res.status, 200);
    const customer = CustomerInternal.parse(await res.json());
    assert.equal(customer.autoApprove, true);
    const { rows: [change] } = await db.query<{ id: number; actor_id: number; old_value: boolean; new_value: boolean }>(
      `select id, actor_id, old_value, new_value from customer_rule_change where customer_code = '11131' and field = 'auto_approve' order by id desc limit 1`);
    const anaId = (await db.query<{ id: number }>(`select id from app_user where username = 'ana.exportacao'`)).rows[0].id;
    assert.deepEqual([change.actor_id, change.old_value, change.new_value], [anaId, false, true]);

    try {
      const sent = await send(martin, body('11131', CARRETA, UPSELL_1));
      assert.equal(sent.status, 201);
      const order = await strictJson(sent, PortalOrderView);
      assert.equal(order.status, 'APPROVED');
      assert.equal(order.current.result.totals.positions, 28);
      assert.ok(Math.abs(order.current.result.utilization.kg - 0.901) < 0.0005);
      assert.deepEqual(order.events?.map((e) => [e.type, e.actorLabel, e.fromStatus, e.toStatus]), [
        ['SUBMITTED', 'Martín (MINOIL S.A.)', null, 'SUBMITTED'],
        ['AUTO_APPROVED', 'Regra de aprovação automática', 'SUBMITTED', 'APPROVED'],
      ]);
      assert.deepEqual(order.events?.[1].payload, {}, 'o portal não recebe payload.internal');
      assert.equal(order.approvedByLabel, 'Regra de aprovação automática');
      assert.ok(order.approvedAt);
      const { rows: [ev] } = await db.query<{ actor_id: number | null; payload: { internal?: { ruleChangeId?: number } } }>(
        `select actor_id, payload from order_event where order_id = $1 and type = 'AUTO_APPROVED'`, [order.id]);
      assert.equal(ev.actor_id, null);
      assert.equal(ev.payload.internal?.ruleChangeId, change.id);

      // Controle: com a regra ligada, carga abaixo de 90% continua SUBMITTED.
      const partial = await strictJson(await send(martin, body('11131', CARRETA, CASO_2)), PortalOrderView);
      assert.equal(partial.status, 'SUBMITTED');
      assert.deepEqual(partial.events?.map((e) => e.type), ['SUBMITTED']);
    } finally {
      assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { autoApprove: false })).status, 200);
    }
    // Com a regra desligada, o mesmo pedido cheio fica SUBMITTED.
    const off = await strictJson(await send(martin, body('11131', CARRETA, UPSELL_1)), PortalOrderView);
    assert.equal(off.status, 'SUBMITTED');
  });

  test('regras do cliente: distribuidor → 403; corpo vazio → 422; cliente inexistente → 404; mudança registrada só quando muda', async () => {
    assert.equal((await martin.put('/v1/backoffice/customers/11131/rules', { autoApprove: true })).status, 403);
    const empty = await ana.put('/v1/backoffice/customers/11131/rules', {});
    assert.equal(empty.status, 422);
    assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { autoApprove: 'sim' })).status, 422);
    assert.equal((await ana.put('/v1/backoffice/customers/00000/rules', { autoApprove: true })).status, 404);
    const before = Number((await db.query<{ n: number }>('select count(*) as n from customer_rule_change')).rows[0].n);
    const same = await ana.put('/v1/backoffice/customers/11131/rules', { autoApprove: false, mixedPallet: false });
    assert.equal(same.status, 200);
    const after = Number((await db.query<{ n: number }>('select count(*) as n from customer_rule_change')).rows[0].n);
    assert.equal(after, before, 'sem mudança efetiva, sem registro');
    // int_admin também altera regras (matriz), com registro do ator.
    const admin = await Client.login(t.app, 'admin.dados');
    const byAdmin = await admin.put('/v1/backoffice/customers/11999/rules', { mixedPallet: true });
    assert.equal(byAdmin.status, 200);
    assert.equal(CustomerInternal.parse(await byAdmin.json()).mixedPallet, true);
    const { rows: [rc] } = await db.query<{ username: string; field: string }>(
      `select u.username, r.field from customer_rule_change r join app_user u on u.id = r.actor_id order by r.id desc limit 1`);
    assert.deepEqual(rc, { username: 'admin.dados', field: 'mixed_pallet' });
    assert.equal((await admin.put('/v1/backoffice/customers/11999/rules', { mixedPallet: false })).status, 200);
  });
});
