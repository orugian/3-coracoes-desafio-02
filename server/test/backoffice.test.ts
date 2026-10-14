// API do backoffice (docs/specs/04-api.md, "Testes do servidor", Backoffice; "Máquina de estados"; "Regras transversais").
// Banco único por arquivo: os blocos rodam em ordem e cada um usa os próprios pedidos (o roteiro do 0001 vem antes).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  BackofficeCustomers, BackofficeOrderView, BackofficeProducts, CustomerInternal, PortalOrderView, type BackofficeOrderView as OrderViewT,
} from '#contracts';
import type { Db, Queryable } from '#server/ports/db.ts';
import { saoPauloDate } from '#server/domain/time.ts';
import { Client, createUser, errorCode, newKey, seededDb, strictJson, testApp, type TestApp } from './helpers/api.ts';

const CARRETA = { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: 'OC-BO', loadingDate: null };
const C40 = { vehicleId: 'container_40', loadMode: 'PALLETIZED', reference: 'OC-BO-AR', loadingDate: null };
const CASO_2 = [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1400 }];
const CASO_3 = [{ material: '12031291', boxes: 1176 }, { material: '12034109', boxes: 140 }, { material: '12142501', boxes: 1400 }, { material: '12147801', boxes: 540 }];

let db: Db;
let t: TestApp;
let lucas: Client;
let ana: Client;
let admin: Client;
let martin: Client;
let sofia: Client;
before(async () => {
  db = await seededDb();
  t = testApp(db);
  [lucas, ana, admin, martin, sofia] = await Promise.all(
    ['lucas.exportacao', 'ana.exportacao', 'admin.dados', 'martin.minoil', 'sofia.rioclaro'].map((u) => Client.login(t.app, u)));
});
after(async () => { await db.close(); });

const errorBody = async (res: Response) =>
  (await res.json()) as { error: { code: string; details?: { code: string; material?: string; params?: Record<string, unknown> }[] } };
const view = (res: Response) => strictJson(res, BackofficeOrderView);
const detail = async (c: Client, id: string) => {
  const res = await c.get(`/v1/backoffice/orders/${id}`);
  assert.equal(res.status, 200, `detalhe ${id}`);
  return view(res);
};
const newVersion = (c: Client, id: string, body: unknown) => c.post(`/v1/backoffice/orders/${id}/versions`, body);
const approve = (c: Client, id: string, expectedVersion: unknown) => c.post(`/v1/backoffice/orders/${id}/approve`, { expectedVersion });
const versionCount = async (id: string) =>
  Number((await db.query<{ n: number }>('select count(*) as n from order_version where order_id = $1', [id])).rows[0].n);
async function portalOrder(c: Client, customerCode: string, header: unknown, lines: unknown): Promise<string> {
  const res = await c.post('/v1/portal/orders', { customerCode, header, lines }, { headers: { 'idempotency-key': newKey('bo') } });
  assert.equal(res.status, 201);
  const o = await strictJson(res, PortalOrderView);
  assert.equal(o.status, 'SUBMITTED');
  return o.id;
}

describe('leitura', () => {
  test('lista: todos os pedidos, mais recentes primeiro, com versão interna e permissões; filtros status, customer e q', async () => {
    const res = await lucas.get('/v1/backoffice/orders');
    assert.equal(res.status, 200);
    const all = await strictJson(res, BackofficeOrderView.array());
    assert.deepEqual(all.map((o) => o.id), ['3CC-2026-0003', '3CC-2026-0002', '3CC-2026-0001']);
    assert.ok(all.every((o) => o.versions === undefined && o.events === undefined && o.current.internal.contentHash.length === 64));
    const ids = async (query: string) => (await strictJson(await lucas.get(`/v1/backoffice/orders?${query}`), BackofficeOrderView.array())).map((o) => o.id);
    assert.deepEqual(await ids('status=APPROVED'), ['3CC-2026-0003', '3CC-2026-0002']);
    assert.deepEqual(await ids('status=SUBMITTED'), ['3CC-2026-0001']);
    assert.deepEqual(await ids('customer=11999'), ['3CC-2026-0003']);
    assert.deepEqual(await ids('q=R%C3%ADo%20Claro'), ['3CC-2026-0003'], 'nome do cliente');
    assert.deepEqual(await ids('q=oc-2026'), ['3CC-2026-0002'], 'referência, sem diferenciar maiúsculas');
    assert.deepEqual(await ids('q=0001'), ['3CC-2026-0001'], 'id');
    assert.deepEqual(await ids('q=%25'), [], 'curinga do usuário vale como texto');
    assert.deepEqual(await ids('status=SUBMITTED&customer=11999'), []);
    for (const bad of ['status=analise', `q=${'x'.repeat(65)}`]) {
      const r = await lucas.get(`/v1/backoffice/orders?${bad}`);
      assert.equal(r.status, 422, bad);
      assert.equal(await errorCode(r), 'VALIDATION_FAILED');
    }
  });

  test('permissions do 0001: Lucas (criador e autor) pode editar e não aprovar; Ana pode as duas; admin.dados só lê', async () => {
    const perms = async (c: Client) => (await detail(c, '3CC-2026-0001')).permissions;
    assert.deepEqual(await perms(lucas), { canEdit: true, canApprove: false, canReturn: false, canResubmit: false });
    assert.deepEqual(await perms(ana), { canEdit: true, canApprove: true, canReturn: false, canResubmit: false });
    assert.deepEqual(await perms(admin), { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });
    assert.deepEqual((await detail(ana, '3CC-2026-0002')).permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: false }, 'APPROVED');
  });

  test('detalhe: versões com internal e eventos com payload.internal (os totais da OB no SUBMITTED do 0001)', async () => {
    const o = await detail(lucas, '3CC-2026-0001');
    assert.deepEqual([o.status, o.origin, o.currentVersion, o.createdByLabel], ['SUBMITTED', 'ORDER_BASIS', 1, 'Lucas (Exportação)']);
    const { rows: [v1] } = await db.query<{ content_hash: string; data_batches: number[]; overrides: number[] }>(
      `select content_hash, data_batches, overrides from order_version where order_id = '3CC-2026-0001' and version_no = 1`);
    assert.deepEqual(o.current.internal, { dataBatches: v1.data_batches, overrides: v1.overrides, contentHash: v1.content_hash });
    assert.equal(o.current.result.blocking, true);
    const submitted = o.events?.find((e) => e.type === 'SUBMITTED');
    assert.deepEqual((submitted?.payload.internal as { orderBasis?: { grossKg: number } }).orderBasis?.grossKg, 20151.04);
    const approved = (await detail(lucas, '3CC-2026-0002')).events?.find((e) => e.type === 'APPROVED');
    assert.deepEqual(Object.keys(approved?.payload.internal ?? {}).sort(), ['contentHash', 'recalculatedBlocking', 'recalculatedContentHash', 'resultChanged']);
    const missing = await lucas.get('/v1/backoffice/orders/3CC-2026-9999');
    assert.equal(missing.status, 404);
    assert.equal(await errorCode(missing), 'NOT_FOUND');
  });

  test('produtos: catálogo efetivo com SAP, os 3 overrides, preços com origem e valores da OB; admin.dados também lê', async () => {
    for (const c of [lucas, admin]) assert.equal((await c.get('/v1/backoffice/products')).status, 200);
    const { items, vehicles, rules } = await strictJson(await lucas.get('/v1/backoffice/products'), BackofficeProducts);
    assert.equal(items.length, 10);
    assert.equal(vehicles.length, 3);
    assert.deepEqual(rules, { fullAt: 0.9, leadDays: 7 });
    const item = (m: string) => {
      const i = items.find((x) => x.material === m);
      assert.ok(i, m);
      return i;
    };
    const overridden = items.filter((i) => i.overrides.length > 0).map((i) => [i.material, i.overrides.map((o) => o.field)]);
    assert.deepEqual(overridden, [['12034109', ['layerBoxes']], ['12147801', ['grossKgPerBox']], ['20908885', ['layers']]]);
    const cap = item('12034109');
    assert.deepEqual([cap.layerBoxes, cap.layers, cap.boxesPerPallet], [14, 7, 98], 'efetivo');
    assert.deepEqual(cap.sap, { layerBoxes: 4, layers: 7, grossKgPerBox: cap.grossKgPerBox }, 'SAP intacto');
    assert.deepEqual(cap.overrides[0], {
      field: 'layerBoxes', sapValue: 4, adoptedValue: 14, decisionRef: 'Q12', proposedBy: 'Administração de dados', confirmedBy: 'Ana (Exportação)',
      confirmedAt: '2026-10-13T15:00:00.000Z', justification: cap.overrides[0].justification,
    });
    assert.match(cap.overrides[0].justification, /Q12/);
    assert.ok(Math.abs((cap.ob.boxesPerPallet ?? 0) - 98) < 1e-9);
    assert.equal(cap.ob.palletizationBoxes, 98);
    assert.equal(cap.ob.price, 36.96);
    const stick = item('12147801');
    assert.equal(stick.grossKgPerBox, 1.2);
    assert.equal(stick.sap.grossKgPerBox, 0.00089);
    assert.deepEqual([stick.ob.boxesPerPallet, stick.ob.grossKgPerBox], [180, 11.52]);
    const porta = item('20908885');
    assert.deepEqual([porta.layers, porta.sap.layers, porta.boxesPerPallet], [7, 10, 77]);
    assert.deepEqual(porta.prices.map((p) => [p.priceList, p.origin, p.price, p.priceRaw]), [['AR', 'DEMO_DERIVED', 18.67, 18.6666], ['US', 'SITE_3C', 17.61, 17.611]]);
    assert.deepEqual(item('12031189').prices.map((p) => [p.priceList, p.origin]), [['AR', 'DEMO_DERIVED'], ['US', 'SAP_LIST']]);
    assert.equal(item('12034103').minLotSource, 'DEFAULT');
    assert.equal(cap.minLotSource, 'OB_PALETIZACAO');
  });

  test('clientes: os dois com a visão interna; o histórico de regras traz a mudança, o ator e a ordem mais recente primeiro', async () => {
    const first = await strictJson(await lucas.get('/v1/backoffice/customers'), BackofficeCustomers);
    const byCode = new Map(first.customers.map((c) => [c.code, c]));
    assert.deepEqual([...byCode.keys()], ['11131', '11999']);
    assert.deepEqual(
      [byCode.get('11131')?.country, byCode.get('11131')?.isDemo, byCode.get('11131')?.autoApprove, byCode.get('11131')?.restrictedMaterials],
      [null, false, false, []]);
    assert.deepEqual(
      [byCode.get('11999')?.country, byCode.get('11999')?.isDemo, byCode.get('11999')?.priceList, byCode.get('11999')?.restrictedMaterials],
      ['AR', true, 'AR', ['20908885']]);
    assert.deepEqual(first.ruleChanges, []);

    const put = await admin.put('/v1/backoffice/customers/11999/rules', { mixedPallet: true });
    assert.equal(put.status, 200, 'int_admin altera regras');
    assert.equal(CustomerInternal.parse(await put.json()).mixedPallet, true);
    assert.equal((await ana.put('/v1/backoffice/customers/11999/rules', { mixedPallet: false })).status, 200);
    const { ruleChanges } = await strictJson(await admin.get('/v1/backoffice/customers'), BackofficeCustomers);
    assert.deepEqual(ruleChanges.map((r) => [r.customerCode, r.field, r.oldValue, r.newValue, r.actorLabel]), [
      ['11999', 'mixedPallet', true, false, 'Ana (Exportação)'],
      ['11999', 'mixedPallet', false, true, 'Administração de dados'],
    ]);
    assert.ok(Date.parse(ruleChanges[0].at) >= Date.parse(ruleChanges[1].at));
  });
});

describe('roteiro do 3CC-2026-0001: Lucas ajusta e não aprova; Ana aprova', () => {
  const ID = '3CC-2026-0001';
  let v1Before: OrderViewT['current'];

  test('aprovar a v1 (30 posições para 28) → 409 ORDER_BLOCKED com VEHICLE_EXCEEDED, sem mudar o pedido', async () => {
    v1Before = (await detail(ana, ID)).current;
    const res = await approve(ana, ID, 1);
    assert.equal(res.status, 409);
    const { error } = await errorBody(res);
    assert.equal(error.code, 'ORDER_BLOCKED');
    assert.deepEqual(error.details?.map((d) => d.code), ['VEHICLE_EXCEEDED']);
    const o = await detail(ana, ID);
    assert.deepEqual([o.status, o.currentVersion, o.events?.length], ['SUBMITTED', 1, 1]);
  });

  test('admin.dados criando versão ou aprovando → 403 FORBIDDEN', async () => {
    const v = await newVersion(admin, ID, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 3192 }] });
    assert.equal(v.status, 403);
    assert.equal(await errorCode(v), 'FORBIDDEN');
    const a = await approve(admin, ID, 1);
    assert.equal(a.status, 403);
    assert.equal(await errorCode(a), 'FORBIDDEN');
    assert.equal(await versionCount(ID), 1);
  });

  test('Lucas cria a v2 (12031189 de 3528 para 3192: 28 de 28, sem BLOCK); a v1 continua igual; UPDATE direto falha', async () => {
    const res = await newVersion(lucas, ID, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 3192 }], reason: 'Reduzir para caber na carreta' });
    assert.equal(res.status, 200);
    const o = await view(res);
    assert.deepEqual([o.status, o.currentVersion, o.current.versionNo, o.current.authorLabel, o.current.reason],
      ['SUBMITTED', 2, 2, 'Lucas (Exportação)', 'Reduzir para caber na carreta']);
    assert.equal(o.current.result.totals.positions, 28);
    assert.equal(o.current.result.status, 'FULL');
    assert.equal(o.current.result.blocking, false);
    assert.deepEqual(o.current.lines, [
      { material: '12031189', boxes: 3192 }, { material: '12034103', boxes: 300 }, { material: '12037417', boxes: 250 }, { material: '12144012', boxes: 300 },
    ]);
    assert.deepEqual(o.current.header, { ...v1Before.header }, 'mesmo cabeçalho');
    assert.deepEqual(o.versions?.[0], v1Before, 'v1 intacta');
    const created = o.events?.at(-1);
    assert.deepEqual([created?.type, created?.actorLabel, created?.fromStatus, created?.toStatus, created?.versionNo],
      ['VERSION_CREATED', 'Lucas (Exportação)', 'SUBMITTED', 'SUBMITTED', 2]);
    assert.deepEqual(created?.payload, { changes: [{ material: '12031189', old: 3528, new: 3192 }], reason: 'Reduzir para caber na carreta' });
    assert.deepEqual(o.permissions, { canEdit: true, canApprove: false, canReturn: false, canResubmit: false });
    await assert.rejects(db.query(`update order_version set lines = '[]'::jsonb where order_id = $1 and version_no = 1`, [ID]), /aceita só inserção/);
    await assert.rejects(db.query(`delete from order_version where order_id = $1`, [ID]), /aceita só inserção/);
  });

  test('Lucas aprova → 403 SELF_APPROVAL_FORBIDDEN (criador e autor)', async () => {
    const res = await approve(lucas, ID, 2);
    assert.equal(res.status, 403);
    assert.equal(await errorCode(res), 'SELF_APPROVAL_FORBIDDEN');
  });

  test('Ana aprova com expectedVersion 1 → 409 VERSION_CONFLICT com a versão atual; com 2 → 200 APPROVED; de novo → 409 INVALID_TRANSITION', async () => {
    const stale = await approve(ana, ID, 1);
    assert.equal(stale.status, 409);
    const { error } = await errorBody(stale);
    assert.equal(error.code, 'VERSION_CONFLICT');
    assert.equal(error.details?.[0].params?.currentVersion, 2);

    const ok = await approve(ana, ID, 2);
    assert.equal(ok.status, 200);
    const o = await view(ok);
    assert.deepEqual([o.status, o.currentVersion, o.approvedByLabel], ['APPROVED', 2, 'Ana (Exportação)']);
    const ev = o.events?.at(-1);
    assert.deepEqual([ev?.type, ev?.actorLabel, ev?.fromStatus, ev?.toStatus, ev?.versionNo], ['APPROVED', 'Ana (Exportação)', 'SUBMITTED', 'APPROVED', 2]);
    const internal = ev?.payload.internal as Record<string, unknown>;
    assert.equal(internal.contentHash, o.current.internal.contentHash, 'aprova a versão como gravada');
    assert.equal(internal.recalculatedBlocking, false);
    assert.equal(internal.resultChanged, false);
    assert.equal(typeof internal.recalculatedContentHash, 'string');
    assert.ok(!('recalculatedResult' in internal));
    assert.equal(o.approvedAt, ev?.at);
    assert.deepEqual(o.permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });

    const again = await approve(ana, ID, 2);
    assert.equal(again.status, 409);
    assert.equal(await errorCode(again), 'INVALID_TRANSITION');
    const edit = await newVersion(lucas, ID, { expectedVersion: 2, changes: [{ material: '12031189', boxes: 3024 }] });
    assert.equal(edit.status, 409);
    assert.equal(await errorCode(edit), 'INVALID_TRANSITION');
  });

  test('a trilha que o distribuidor vê: importação da OB, ajuste de Lucas e aprovação de Ana, sem internal', async () => {
    const o = await strictJson(await martin.get(`/v1/portal/orders/${ID}`), PortalOrderView);
    assert.equal(o.status, 'APPROVED');
    assert.deepEqual(o.events?.map((e) => [e.type, e.actorLabel]), [
      ['SUBMITTED', 'Lucas (Exportação)'], ['VERSION_CREATED', 'Lucas (Exportação)'], ['APPROVED', 'Ana (Exportação)'],
    ]);
    assert.deepEqual(o.events?.[2].payload, {});
  });
});

describe('autor sem ser criador não aprova', () => {
  test('Martín envia; Ana cria a v2 e tenta aprovar → 403; Lucas, que não criou nem editou, aprova → 200', async () => {
    const id = await portalOrder(martin, '11131', CARRETA, CASO_2);
    const v2 = await newVersion(ana, id, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] });
    assert.equal(v2.status, 200);
    assert.equal((await view(v2)).permissions.canApprove, false, 'Ana é autora da v2');
    assert.equal((await detail(lucas, id)).permissions.canApprove, true, 'Lucas pode');
    const byAna = await approve(ana, id, 2);
    assert.equal(byAna.status, 403);
    assert.equal(await errorCode(byAna), 'SELF_APPROVAL_FORBIDDEN');
    const byLucas = await approve(lucas, id, 2);
    assert.equal(byLucas.status, 200);
    assert.equal((await view(byLucas)).approvedByLabel, 'Lucas (Exportação)');
  });

  test('autor de uma versão anterior (não da atual) também não aprova; quem não tocou no pedido aprova', async () => {
    await createUser(db, 'teste.exportacao', 'int_exportacao');
    const third = await Client.login(t.app, 'teste.exportacao');
    const id = await portalOrder(martin, '11131', CARRETA, CASO_2);
    assert.equal((await newVersion(ana, id, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] })).status, 200);
    assert.equal((await newVersion(lucas, id, { expectedVersion: 2, changes: [{ material: '12031189', boxes: 2688 }] })).status, 200);
    assert.equal((await detail(ana, id)).permissions.canApprove, false, 'Ana é autora da v2, não da v3');
    const byAna = await approve(ana, id, 3);
    assert.equal(byAna.status, 403);
    assert.equal(await errorCode(byAna), 'SELF_APPROVAL_FORBIDDEN');
    assert.equal(await errorCode(await approve(lucas, id, 3)), 'SELF_APPROVAL_FORBIDDEN');
    assert.equal((await detail(third, id)).permissions.canApprove, true);
    assert.equal((await approve(third, id, 3)).status, 200);
  });
});

describe('pallet misto: congelado na versão, do cliente na versão nova', () => {
  test('ligado depois do envio: a aprovação recalcula com o da versão; uma versão nova usa o do cliente agora', async () => {
    const toApprove = await portalOrder(martin, '11131', CARRETA, CASO_2);
    const toEdit = await portalOrder(martin, '11131', CARRETA, CASO_2);
    assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { mixedPallet: true })).status, 200);
    try {
      const approved = await view(await approve(lucas, toApprove, 1));
      assert.equal(approved.current.header.mixedPallet, false);
      const internal = approved.events?.at(-1)?.payload.internal as { contentHash: string; recalculatedContentHash: string; resultChanged: boolean };
      assert.equal(internal.recalculatedContentHash, internal.contentHash, 'mesma entrada, inclusive o pallet misto');
      assert.equal(internal.resultChanged, false);

      const edited = await view(await newVersion(ana, toEdit, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] }));
      assert.deepEqual(edited.versions?.map((v) => v.header.mixedPallet), [false, true]);
    } finally {
      assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { mixedPallet: false })).status, 200);
    }
  });
});

describe('regras da nova versão', () => {
  let id: string;
  before(async () => { id = await portalOrder(martin, '11131', CARRETA, CASO_2); });

  test('nenhuma mudança efetiva → 422 NO_CHANGES, sem versão nova', async () => {
    const res = await newVersion(ana, id, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2352 }, { material: '12034103', boxes: 0 }] });
    assert.equal(res.status, 422);
    assert.equal(await errorCode(res), 'NO_CHANGES');
    assert.equal(await versionCount(id), 1);
  });

  test('mudança que zera todas as linhas → 422, sem versão nova', async () => {
    const res = await newVersion(ana, id, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 0 }, { material: '12142501', boxes: 0 }] });
    assert.equal(res.status, 422);
    const { error } = await errorBody(res);
    assert.deepEqual([error.code, error.details?.[0].code], ['VALIDATION_FAILED', 'NO_LINES']);
    assert.equal(await versionCount(id), 1);
  });

  test('corpo fora do contrato e material inexistente → 422, sem versão nova', async () => {
    const bad: [string, unknown, string][] = [
      ['caixas negativas', { expectedVersion: 1, changes: [{ material: '12031189', boxes: -1 }] }, 'INVALID_FIELD'],
      ['acima de 100.000', { expectedVersion: 1, changes: [{ material: '12031189', boxes: 100_001 }] }, 'INVALID_FIELD'],
      ['caixa fracionária', { expectedVersion: 1, changes: [{ material: '12031189', boxes: 1.5 }] }, 'INVALID_FIELD'],
      ['sem expectedVersion', { changes: [{ material: '12031189', boxes: 2520 }] }, 'INVALID_FIELD'],
      ['sem mudanças', { expectedVersion: 1, changes: [] }, 'INVALID_FIELD'],
      ['motivo com controle', { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }], reason: 'a\u0007b' }, 'INVALID_FIELD'],
      ['material repetido', { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }, { material: '12031189', boxes: 2688 }] }, 'DUPLICATE_MATERIAL'],
      ['material inexistente', { expectedVersion: 1, changes: [{ material: '99999999', boxes: 10 }] }, 'UNKNOWN_MATERIAL'],
    ];
    for (const [name, body, detailCode] of bad) {
      const res = await newVersion(ana, id, body);
      assert.equal(res.status, 422, name);
      const { error } = await errorBody(res);
      assert.deepEqual([error.code, error.details?.[0].code], ['VALIDATION_FAILED', detailCode], name);
    }
    assert.equal(await versionCount(id), 1);
    const approveBad = await approve(lucas, id, '1');
    assert.equal(approveBad.status, 422, 'expectedVersion como texto');
  });

  test('expectedVersion desatualizado → 409 VERSION_CONFLICT; pedido inexistente → 404', async () => {
    const res = await newVersion(ana, id, { expectedVersion: 2, changes: [{ material: '12031189', boxes: 2520 }] });
    assert.equal(res.status, 409);
    const { error } = await errorBody(res);
    assert.deepEqual([error.code, error.details?.[0].params?.currentVersion], ['VERSION_CONFLICT', 1]);
    for (const r of [await newVersion(ana, '3CC-2026-9999', { expectedVersion: 1, changes: [{ material: '12031189', boxes: 1 }] }), await approve(lucas, '3CC-2026-9999', 1)]) {
      assert.equal(r.status, 404);
      assert.equal(await errorCode(r), 'NOT_FOUND');
    }
    // Material repetido é erro do corpo: 422 antes do 404 e do 409.
    const dup = [{ material: '12031189', boxes: 1 }, { material: '12031189', boxes: 2 }];
    for (const target of ['3CC-2026-9999', '3CC-2026-0002']) {
      const r = await newVersion(ana, target, { expectedVersion: 1, changes: dup });
      assert.equal(r.status, 422, target);
      assert.equal((await errorBody(r)).error.details?.[0].code, 'DUPLICATE_MATERIAL');
    }
  });

  test('acrescentar um material e remover outro (0 remove a linha) gera as mudanças com old 0 e new 0', async () => {
    const res = await newVersion(ana, id, { expectedVersion: 1, changes: [{ material: '12142501', boxes: 0 }, { material: '12034103', boxes: 405 }] });
    assert.equal(res.status, 200);
    const o = await view(res);
    assert.deepEqual(o.current.lines, [{ material: '12031189', boxes: 2352 }, { material: '12034103', boxes: 405 }]);
    assert.deepEqual(o.events?.at(-1)?.payload, { changes: [{ material: '12034103', old: 0, new: 405 }, { material: '12142501', old: 1400, new: 0 }] });
    assert.deepEqual(o.versions?.[0].lines, CASO_2);
  });

  test('nova versão com BLOCK é aceita (ajuste em andamento) e a aprovação recusa com 409 ORDER_BLOCKED', async () => {
    const res = await newVersion(ana, id, { expectedVersion: 2, changes: [{ material: '12031189', boxes: 6000 }] });
    assert.equal(res.status, 200);
    const o = await view(res);
    assert.equal(o.current.result.blocking, true);
    assert.equal(o.currentVersion, 3);
    const blocked = await approve(lucas, id, 3);
    assert.equal(blocked.status, 409);
    const { error } = await errorBody(blocked);
    assert.equal(error.code, 'ORDER_BLOCKED');
    assert.ok(error.details?.some((d) => d.code === 'VEHICLE_EXCEEDED'));
  });

  test('duas versões simultâneas sobre a mesma versão → uma 200 e uma 409 VERSION_CONFLICT', async () => {
    const [a, b] = await Promise.all([
      newVersion(ana, id, { expectedVersion: 3, changes: [{ material: '12031189', boxes: 2520 }] }),
      newVersion(lucas, id, { expectedVersion: 3, changes: [{ material: '12031189', boxes: 2688 }] }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const loser = a.status === 409 ? a : b;
    assert.equal(await errorCode(loser), 'VERSION_CONFLICT');
    assert.equal(await versionCount(id), 4);
  });

  // No pg, o select … for update serializa as duas; se mesmo assim a PK de order_version estourar (outra versão gravada
  // no meio), a resposta é 409, nunca 500 (02, "Porta Db"). Aqui a gravação concorrente é simulada dentro da transação.
  test('PK de order_version repetida dentro da transação → 409 VERSION_CONFLICT, nada gravado', async () => {
    let collide = false;
    const wrap = (q: Queryable): Queryable => ({
      ...q,
      query: async (sql, params) => {
        if (collide && sql.trimStart().startsWith('insert into order_version')) {
          collide = false;
          await q.query(sql, params); // "outra requisição" grava a mesma versão primeiro
        }
        return q.query(sql, params);
      },
    });
    const racing: Db = { ...db, tx: (fn) => db.tx((q) => fn(wrap(q))) };
    const race = testApp(racing);
    const c = await Client.login(race.app, 'ana.exportacao');
    collide = true;
    const res = await newVersion(c, id, { expectedVersion: 4, changes: [{ material: '12031189', boxes: 2856 }] });
    assert.equal(collide, false, 'a colisão aconteceu');
    assert.equal(res.status, 409);
    const { error } = await errorBody(res);
    assert.deepEqual([error.code, error.details?.[0].params?.currentVersion], ['VERSION_CONFLICT', 4]);
    assert.equal(await versionCount(id), 4);
    assert.ok(!race.logs.some((l) => l.includes('erro interno')));
  });
});

describe('guarda do recálculo na aprovação', () => {
  let id: string;
  before(async () => { id = await portalOrder(sofia, '11999', C40, CASO_3); });

  test('regra de país nova depois do envio: a versão não tem BLOCK, o recálculo tem → 409 ORDER_BLOCKED; sem a regra, segue', async () => {
    const { rows: [rule] } = await db.query<{ id: number }>(
      `insert into country_rule (country, customer_code, material_code, kind, reason, is_demo) values ('AR', '11999', '12031291', 'BLOCK', 'teste', true) returning id`);
    try {
      const res = await approve(lucas, id, 1);
      assert.equal(res.status, 409);
      const { error } = await errorBody(res);
      assert.equal(error.code, 'ORDER_BLOCKED');
      assert.deepEqual(error.details?.map((d) => [d.code, d.material]), [['COUNTRY_RESTRICTED', '12031291']]);
      const o = await detail(lucas, id);
      assert.deepEqual([o.status, o.current.result.blocking], ['SUBMITTED', false]);
    } finally {
      await db.query('delete from country_rule where id = $1', [rule.id]);
    }
  });

  test('material que saiu do catálogo depois do envio → 409 ORDER_BLOCKED com UNKNOWN_MATERIAL; de volta, segue', async () => {
    const other = await portalOrder(sofia, '11999', C40, [{ material: '12031291', boxes: 1176 }, { material: '12142501', boxes: 1400 }]);
    await db.query(`update material set active = false where code = '12142501'`);
    try {
      const res = await approve(lucas, other, 1);
      assert.equal(res.status, 409);
      const { error } = await errorBody(res);
      assert.deepEqual([error.code, error.details?.map((d) => [d.code, d.material])], ['ORDER_BLOCKED', [['UNKNOWN_MATERIAL', '12142501']]]);
    } finally {
      await db.query(`update material set active = true where code = '12142501'`);
    }
    assert.equal((await approve(lucas, other, 1)).status, 200, 'controle');
  });

  test('preço vigente mudou sem BLOCK: aprova a versão como gravada, com resultChanged e o resultado recalculado no evento', async () => {
    await db.query(
      `insert into price (channel, plant, price_list, material_code, uom, valid_from, valid_to, price, currency, origin, batch_id)
       select channel, plant, price_list, material_code, uom, $1::date, valid_to, price + 1, currency, origin, batch_id
         from price where price_list = 'AR' and material_code = '12031291'`, [saoPauloDate()]);
    const res = await approve(lucas, id, 1);
    assert.equal(res.status, 200);
    const o = await view(res);
    assert.equal(o.status, 'APPROVED');
    const internal = o.events?.at(-1)?.payload.internal as { resultChanged: boolean; contentHash: string; recalculatedResult?: { totals: { valueCents: number } } };
    assert.equal(internal.resultChanged, true);
    assert.equal(internal.contentHash, o.current.internal.contentHash);
    assert.equal(internal.recalculatedResult?.totals.valueCents, o.current.result.totals.valueCents + 1176 * 100, '1176 cx com US$ 1 a mais');
    const portal = await strictJson(await sofia.get(`/v1/portal/orders/${id}`), PortalOrderView);
    assert.deepEqual(portal.events?.at(-1)?.payload, {}, 'o distribuidor não recebe o recálculo');
  });
});
