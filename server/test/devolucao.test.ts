// S9 (desejável): devolver e reenviar (docs/specs/04-api.md, "Máquina de estados", "Rotas" e "Detalhes da devolução e do
// reenvio"). SUBMITTED → CHANGES_REQUESTED (Exportação, com motivo) → SUBMITTED com versão + 1 (distribuidor do escopo).
// Banco único por arquivo; cada bloco cria os próprios pedidos. Toda negação tem o seu controle positivo na mesma rota.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BackofficeOrderView, PortalOrderView } from '#contracts';
import type { Db } from '#server/ports/db.ts';
import { saoPauloDate } from '#server/domain/time.ts';
import { addDays, Client, errorCode, keyPaths, newKey, seededDb, strictJson, testApp, type TestApp } from './helpers/api.ts';

const CARRETA = { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: 'OC-S9', loadingDate: null };
const CASO_2 = [{ material: '12031189', boxes: 2352 }, { material: '12142501', boxes: 1400 }];
const UPSELL_1 = [{ material: '12031189', boxes: 3864 }, { material: '12142501', boxes: 1400 }]; // 28 de 28, 90,1% do peso
const PEDIDO_TESTE = [ // 30 posições para 28: VEHICLE_EXCEEDED
  { material: '12031189', boxes: 3528 }, { material: '12034103', boxes: 300 }, { material: '12037417', boxes: 250 }, { material: '12144012', boxes: 300 },
];

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
  (await res.json()) as { error: { code: string; message: string; details?: { code: string; material?: string; params?: Record<string, unknown> }[] } };
const ret = (c: Client, id: string, body: unknown) => c.post(`/v1/backoffice/orders/${id}/return`, body);
const resubmit = (c: Client, id: string, body: unknown) => c.post(`/v1/portal/orders/${id}/versions`, body);
const counts = async (id: string) => {
  const one = async (table: string) => Number((await db.query<{ n: number }>(`select count(*) as n from ${table} where order_id = $1`, [id])).rows[0].n);
  return { versions: await one('order_version'), events: await one('order_event') };
};
const status = async (id: string) => (await db.query<{ status: string; current_version: number }>(
  'select status, current_version from sales_order where id = $1', [id])).rows.map((r) => [r.status, Number(r.current_version)])[0];
async function submit(c: Client, customerCode: string, lines: unknown, header: unknown = CARRETA): Promise<string> {
  const res = await c.post('/v1/portal/orders', { customerCode, header, lines }, { headers: { 'idempotency-key': newKey('s9') } });
  assert.equal(res.status, 201);
  return (await strictJson(res, PortalOrderView)).id;
}
async function returned(customerCode = '11131', by: Client = martin, lines: unknown = CASO_2): Promise<string> {
  const id = await submit(by, customerCode, lines);
  const res = await ret(lucas, id, { expectedVersion: 1, reason: 'Trocar o veículo' });
  assert.equal(res.status, 200, 'devolução de controle');
  return id;
}

describe('transição SUBMITTED → CHANGES_REQUESTED → SUBMITTED', () => {
  let id: string;

  test('permissions antes: Lucas e Ana podem devolver o pedido SUBMITTED; admin.dados não; Martín ainda não reenvia', async () => {
    id = await submit(martin, '11131', CASO_2);
    const perms = async (c: Client) => (await strictJson(await c.get(`/v1/backoffice/orders/${id}`), BackofficeOrderView)).permissions;
    assert.deepEqual(await perms(lucas), { canEdit: true, canApprove: true, canReturn: true, canResubmit: false });
    assert.deepEqual(await perms(ana), { canEdit: true, canApprove: true, canReturn: true, canResubmit: false });
    assert.deepEqual(await perms(admin), { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });
    const portal = await strictJson(await martin.get(`/v1/portal/orders/${id}`), PortalOrderView);
    assert.deepEqual(portal.permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });
  });

  test('Lucas devolve com motivo → 200 CHANGES_REQUESTED; evento com o motivo; nenhuma versão nova', async () => {
    const before = await counts(id);
    const res = await ret(lucas, id, { expectedVersion: 1, reason: '  Trocar para o contêiner 40\'  ' });
    assert.equal(res.status, 200);
    const o = await strictJson(res, BackofficeOrderView);
    assert.deepEqual([o.status, o.currentVersion, o.approvedAt, o.approvedByLabel], ['CHANGES_REQUESTED', 1, null, null]);
    const ev = o.events?.at(-1);
    assert.deepEqual([ev?.type, ev?.actorLabel, ev?.fromStatus, ev?.toStatus, ev?.versionNo], ['CHANGES_REQUESTED', 'Lucas (Exportação)', 'SUBMITTED', 'CHANGES_REQUESTED', 1]);
    assert.deepEqual(ev?.payload, { reason: "Trocar para o contêiner 40'" }, 'motivo aparado');
    assert.deepEqual(o.permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });
    assert.deepEqual(await counts(id), { versions: before.versions, events: before.events + 1 });
    assert.deepEqual(await status(id), ['CHANGES_REQUESTED', 1]);
  });

  test('Martín vê o pedido devolvido com o motivo, pode reenviar, e nada interno chega ao portal', async () => {
    const res = await martin.get(`/v1/portal/orders/${id}`);
    assert.equal(res.status, 200);
    const raw = await res.clone().json();
    const o = PortalOrderView.parse(raw);
    assert.equal(o.status, 'CHANGES_REQUESTED');
    assert.deepEqual(o.permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: true });
    assert.deepEqual(o.events?.at(-1)?.payload, { reason: "Trocar para o contêiner 40'" });
    assert.ok(!keyPaths(raw).some((k) => k.split('.').includes('internal')));
    const list = await strictJson(await martin.get('/v1/portal/orders?status=CHANGES_REQUESTED'), PortalOrderView.array());
    assert.deepEqual(list.map((x) => x.id), [id]);
    const bo = await strictJson(await lucas.get('/v1/backoffice/orders?status=CHANGES_REQUESTED'), BackofficeOrderView.array());
    assert.ok(bo.some((x) => x.id === id));
  });

  test('enquanto devolvido, a Exportação não cria versão nem aprova (409 INVALID_TRANSITION)', async () => {
    const edit = await lucas.post(`/v1/backoffice/orders/${id}/versions`, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] });
    assert.equal(edit.status, 409);
    assert.equal(await errorCode(edit), 'INVALID_TRANSITION');
    const appr = await ana.post(`/v1/backoffice/orders/${id}/approve`, { expectedVersion: 1 });
    assert.equal(appr.status, 409);
    assert.equal(await errorCode(appr), 'INVALID_TRANSITION');
  });

  test('Martín reenvia uma nova versão → 200 SUBMITTED, versão 2 dele, evento RESUBMITTED com as mudanças; v1 intacta', async () => {
    const v1 = (await strictJson(await martin.get(`/v1/portal/orders/${id}`), PortalOrderView)).versions?.[0];
    const header = { vehicleId: 'container_40', loadMode: 'PALLETIZED', reference: 'OC-S9-B', loadingDate: null, mixedPallet: true };
    const res = await resubmit(martin, id, { expectedVersion: 1, header, lines: [{ material: '12142501', boxes: 1400 }, { material: '12031189', boxes: 1680 }] });
    assert.equal(res.status, 200);
    const o = await strictJson(res, PortalOrderView);
    assert.deepEqual([o.status, o.currentVersion], ['SUBMITTED', 2]);
    assert.deepEqual(o.current.header, { vehicleId: 'container_40', loadMode: 'PALLETIZED', reference: 'OC-S9-B', loadingDate: null, mixedPallet: false },
      'pallet misto do cliente, não do corpo');
    assert.deepEqual(o.current.lines, [{ material: '12031189', boxes: 1680 }, { material: '12142501', boxes: 1400 }]);
    assert.equal(o.current.authorLabel, 'Martín (MINOIL S.A.)');
    assert.equal(o.current.result.totals.positions, 15, '10 + 5 pallets no contêiner 40');
    assert.deepEqual(o.versions?.[0], v1, 'v1 intacta');
    const ev = o.events?.at(-1);
    assert.deepEqual([ev?.type, ev?.actorLabel, ev?.fromStatus, ev?.toStatus, ev?.versionNo], ['RESUBMITTED', 'Martín (MINOIL S.A.)', 'CHANGES_REQUESTED', 'SUBMITTED', 2]);
    assert.deepEqual(ev?.payload, { changes: [{ material: '12031189', old: 2352, new: 1680 }] });
    assert.equal(o.submittedAt, ev?.at, 'submittedAt é o do reenvio');
    assert.deepEqual(o.permissions, { canEdit: false, canApprove: false, canReturn: false, canResubmit: false });
    assert.deepEqual(await status(id), ['SUBMITTED', 2]);
  });

  test('o pedido reenviado segue o fluxo: Lucas pode devolver de novo e Ana aprova a v2', async () => {
    const perms = (await strictJson(await lucas.get(`/v1/backoffice/orders/${id}`), BackofficeOrderView)).permissions;
    assert.deepEqual(perms, { canEdit: true, canApprove: true, canReturn: true, canResubmit: false });
    const ok = await ana.post(`/v1/backoffice/orders/${id}/approve`, { expectedVersion: 2 });
    assert.equal(ok.status, 200);
    const o = await strictJson(ok, BackofficeOrderView);
    assert.equal(o.status, 'APPROVED');
    assert.deepEqual(o.events?.map((e) => e.type), ['SUBMITTED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED']);
    const again = await ret(lucas, id, { expectedVersion: 2, reason: 'tarde demais' });
    assert.equal(again.status, 409, 'aprovado não volta');
    assert.equal(await errorCode(again), 'INVALID_TRANSITION');
  });
});

describe('devolução: recusas (cada uma com o controle da transição acima)', () => {
  test('admin.dados → 403 FORBIDDEN; distribuidor → 403 pela guarda do prefixo; nada gravado', async () => {
    const id = await submit(martin, '11131', CASO_2);
    const before = await counts(id);
    for (const c of [admin, martin]) {
      const res = await ret(c, id, { expectedVersion: 1, reason: 'x' });
      assert.equal(res.status, 403);
      assert.equal(await errorCode(res), 'FORBIDDEN');
    }
    assert.deepEqual(await counts(id), before);
    assert.equal((await ret(ana, id, { expectedVersion: 1, reason: 'controle' })).status, 200, 'controle');
  });

  test('motivo obrigatório: ausente, vazio, só espaços, acima de 200 caracteres ou com caractere de controle → 422; 200 caracteres passa', async () => {
    const id = await submit(martin, '11131', CASO_2);
    for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, reason: '' }, { expectedVersion: 1, reason: '   ' },
      { expectedVersion: 1, reason: 'x'.repeat(201) }, { expectedVersion: 1, reason: 'linha\nquebrada' }, { reason: 'sem versão' },
      { expectedVersion: 0, reason: 'x' }]) {
      const res = await ret(lucas, id, body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(await errorCode(res), 'VALIDATION_FAILED');
    }
    assert.deepEqual(await status(id), ['SUBMITTED', 1]);
    assert.equal((await ret(lucas, id, { expectedVersion: 1, reason: 'x'.repeat(200) })).status, 200, 'controle: 200 caracteres');
  });

  test('ordem das recusas: 403 do papel antes do 422 do corpo; 422 do corpo antes do 404; 404 antes da transição; transição antes da versão', async () => {
    const adminBadBody = await ret(admin, '3CC-2026-0002', { expectedVersion: 1 });
    assert.equal(adminBadBody.status, 403, 'papel antes do corpo');
    const missing = await ret(lucas, '3CC-2026-9999', { expectedVersion: 1 });
    assert.equal(missing.status, 422, 'corpo antes do 404');
    const notFound = await ret(lucas, '3CC-2026-9999', { expectedVersion: 1, reason: 'x' });
    assert.equal(notFound.status, 404);
    assert.equal(await errorCode(notFound), 'NOT_FOUND');
    const approvedStale = await ret(lucas, '3CC-2026-0002', { expectedVersion: 1, reason: 'x' });
    assert.equal(approvedStale.status, 409);
    assert.equal(await errorCode(approvedStale), 'INVALID_TRANSITION', 'APPROVED (v2) com versão errada: a transição vem antes');
  });

  test('expectedVersion desatualizado → 409 VERSION_CONFLICT com a versão atual; já devolvido → 409 INVALID_TRANSITION', async () => {
    const id = await submit(martin, '11131', CASO_2);
    assert.equal((await lucas.post(`/v1/backoffice/orders/${id}/versions`, { expectedVersion: 1, changes: [{ material: '12031189', boxes: 2520 }] })).status, 200);
    const stale = await ret(ana, id, { expectedVersion: 1, reason: 'x' });
    assert.equal(stale.status, 409);
    const { error } = await errorBody(stale);
    assert.equal(error.code, 'VERSION_CONFLICT');
    assert.equal(error.details?.[0].params?.currentVersion, 2);
    assert.deepEqual(await status(id), ['SUBMITTED', 2]);
    assert.equal((await ret(ana, id, { expectedVersion: 2, reason: 'x' })).status, 200, 'controle');
    const twice = await ret(ana, id, { expectedVersion: 2, reason: 'x' });
    assert.equal(twice.status, 409);
    assert.equal(await errorCode(twice), 'INVALID_TRANSITION');
  });

  test('Lucas pode devolver o pedido que ele mesmo criou (0001, da OB): devolver não tem segregação', async () => {
    const res = await ret(lucas, '3CC-2026-0001', { expectedVersion: 1, reason: 'Excede a carreta em 2 posições' });
    assert.equal(res.status, 200);
    const portal = await strictJson(await martin.get('/v1/portal/orders/3CC-2026-0001'), PortalOrderView);
    assert.deepEqual([portal.status, portal.permissions.canResubmit], ['CHANGES_REQUESTED', true]);
  });

  test('duas devoluções simultâneas → uma 200 e uma 409, nunca 500, com um só evento', async () => {
    const id = await submit(martin, '11131', CASO_2);
    const before = await counts(id);
    const results = await Promise.all([ret(lucas, id, { expectedVersion: 1, reason: 'a' }), ret(ana, id, { expectedVersion: 1, reason: 'b' })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(await counts(id), { versions: before.versions, events: before.events + 1 });
  });
});

describe('reenvio: recusas', () => {
  const body = (lines: unknown = CASO_2, header: unknown = CARRETA, expectedVersion = 1) => ({ expectedVersion, header, lines });

  test('fora do escopo ou inexistente → 404 (controle: o dono reenvia); interno na rota do portal → 403', async () => {
    const id = await returned();
    const before = await counts(id);
    for (const [c, path] of [[sofia, id], [martin, '3CC-2026-9999']] as const) {
      const res = await resubmit(c, path, body());
      assert.equal(res.status, 404, `${path}`);
      assert.equal(await errorCode(res), 'NOT_FOUND');
    }
    const internal = await resubmit(lucas, id, body());
    assert.equal(internal.status, 403);
    assert.deepEqual(await counts(id), before, 'nada gravado');
    assert.equal((await resubmit(martin, id, body())).status, 200, 'controle');
  });

  test('pedido que não está devolvido → 409 INVALID_TRANSITION (controle: depois de devolvido, 200)', async () => {
    const id = await submit(martin, '11131', CASO_2);
    const res = await resubmit(martin, id, body());
    assert.equal(res.status, 409);
    assert.equal(await errorCode(res), 'INVALID_TRANSITION');
    assert.equal((await ret(lucas, id, { expectedVersion: 1, reason: 'x' })).status, 200);
    assert.equal((await resubmit(martin, id, body())).status, 200, 'controle');
  });

  test('expectedVersion desatualizado → 409 VERSION_CONFLICT; o mesmo corpo de novo depois do reenvio → 409 INVALID_TRANSITION', async () => {
    const id = await returned();
    const stale = await resubmit(martin, id, body(CASO_2, CARRETA, 2));
    assert.equal(stale.status, 409);
    const { error } = await errorBody(stale);
    assert.equal(error.code, 'VERSION_CONFLICT');
    assert.equal(error.details?.[0].params?.currentVersion, 1);
    assert.equal((await resubmit(martin, id, body())).status, 200, 'controle');
    const double = await resubmit(martin, id, body());
    assert.equal(double.status, 409, 'duplo clique');
    assert.equal(await errorCode(double), 'INVALID_TRANSITION');
  });

  test('BLOCK do motor → 422 ORDER_BLOCKED com os alertas; nada gravado e o pedido continua devolvido', async () => {
    const id = await returned();
    const before = await counts(id);
    const res = await resubmit(martin, id, body(PEDIDO_TESTE));
    assert.equal(res.status, 422);
    const { error } = await errorBody(res);
    assert.equal(error.code, 'ORDER_BLOCKED');
    assert.deepEqual(error.details?.map((d) => d.code), ['VEHICLE_EXCEEDED']);
    assert.deepEqual(await counts(id), before);
    assert.deepEqual(await status(id), ['CHANGES_REQUESTED', 1]);
  });

  test('regras do envio: data a 3 dias → 422 LOADING_DATE_TOO_SOON; material fora do catálogo do cliente → 422 UNKNOWN_MATERIAL; fração, repetido ou corpo inválido → 422', async () => {
    const id = await returned();
    const before = await counts(id);
    const today = saoPauloDate();
    const soon = await resubmit(martin, id, body(CASO_2, { ...CARRETA, loadingDate: addDays(today, 3) }));
    assert.equal(soon.status, 422);
    assert.equal(await errorCode(soon), 'LOADING_DATE_TOO_SOON');
    const unknown = await resubmit(martin, id, body([{ material: '99999999', boxes: 10 }]));
    assert.equal(unknown.status, 422);
    assert.deepEqual((await errorBody(unknown)).error.details?.map((d) => [d.code, d.material]), [['UNKNOWN_MATERIAL', '99999999']]);
    for (const bad of [body([{ material: '12031189', boxes: 50.5 }]), body([...CASO_2, { material: '12031189', boxes: 1 }]), body([]),
      { header: CARRETA, lines: CASO_2 }, body(CASO_2, { ...CARRETA, vehicleId: 'caminhao' })]) {
      const res = await resubmit(martin, id, bad);
      assert.equal(res.status, 422, JSON.stringify(bad));
      assert.equal(await errorCode(res), 'VALIDATION_FAILED');
    }
    assert.deepEqual(await counts(id), before, 'nada gravado');
    const ok = await resubmit(martin, id, body(CASO_2, { ...CARRETA, loadingDate: addDays(today, 7) }));
    assert.equal(ok.status, 200, 'controle: data no limite');
  });

  test('ordem das recusas: 422 do corpo antes do 404 do escopo; 404 antes da transição; versão antes de material, data e BLOCK; material antes da data', async () => {
    const id = await submit(martin, '11131', CASO_2); // SUBMITTED, de Martín
    const badOutOfScope = await resubmit(sofia, id, body([{ material: '12031189', boxes: 1.5 }]));
    assert.equal(badOutOfScope.status, 422);
    const outOfScope = await resubmit(sofia, id, body());
    assert.equal(outOfScope.status, 404, 'o pedido de outro cliente não revela o estado');

    const ret1 = await returned();
    const soon = addDays(saoPauloDate(), 3);
    const staleAndBad = await resubmit(martin, ret1, body([{ material: '99999999', boxes: 10 }], { ...CARRETA, loadingDate: soon }, 2));
    assert.equal(await errorCode(staleAndBad), 'VERSION_CONFLICT', 'versão antes de material e data');
    const staleBlocked = await resubmit(martin, ret1, body(PEDIDO_TESTE, CARRETA, 2));
    assert.equal(await errorCode(staleBlocked), 'VERSION_CONFLICT', 'versão antes do BLOCK');
    const unknownAndSoon = await resubmit(martin, ret1, body([{ material: '99999999', boxes: 10 }], { ...CARRETA, loadingDate: soon }));
    assert.equal(unknownAndSoon.status, 422);
    assert.deepEqual((await errorBody(unknownAndSoon)).error.details?.map((d) => d.code), ['UNKNOWN_MATERIAL'], 'material antes da data');
    const soonAndBlocked = await resubmit(martin, ret1, body(PEDIDO_TESTE, { ...CARRETA, loadingDate: soon }));
    assert.equal(await errorCode(soonAndBlocked), 'LOADING_DATE_TOO_SOON', 'data antes do BLOCK');
  });

  test('pallet misto: vale o do cliente agora, nunca o do corpo (com a regra ligada, o corpo false não desliga)', async () => {
    const id = await returned();
    assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { mixedPallet: true })).status, 200);
    try {
      const res = await resubmit(martin, id, body(PEDIDO_TESTE, { ...CARRETA, mixedPallet: false }));
      // Com misto o pedido-teste dá 29 posições para 28: ainda EXCEEDED, então 422; o misto aparece nos alertas.
      assert.equal(res.status, 422);
      assert.equal((await errorBody(res)).error.details?.find((d) => d.code === 'VEHICLE_EXCEEDED')?.params?.positions, 1, '29 − 28: misto do cliente');
      const ok = await resubmit(martin, id, body(CASO_2, { ...CARRETA, mixedPallet: false }));
      assert.equal(ok.status, 200);
      const o = await strictJson(ok, PortalOrderView);
      assert.equal(o.current.header.mixedPallet, true, 'congelado na versão o valor do cliente');
    } finally {
      assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { mixedPallet: false })).status, 200);
    }
  });

  test('reenvio sem mudança nenhuma é aceito (o distribuidor confirma o pedido); evento sem changes', async () => {
    const id = await returned();
    const res = await resubmit(martin, id, body());
    assert.equal(res.status, 200);
    const o = await strictJson(res, PortalOrderView);
    assert.equal(o.currentVersion, 2);
    assert.deepEqual(o.events?.at(-1)?.payload, {});
  });

  test('o reenvio não dispara a aprovação automática (controle: um envio novo com a mesma carga é aprovado na hora)', async () => {
    const id = await returned();
    assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { autoApprove: true })).status, 200);
    try {
      const res = await resubmit(martin, id, body(UPSELL_1));
      assert.equal(res.status, 200);
      const o = await strictJson(res, PortalOrderView);
      assert.equal(o.current.result.totals.positions, 28);
      assert.equal(o.status, 'SUBMITTED');
      assert.ok(!o.events?.some((e) => e.type === 'AUTO_APPROVED'));
      const fresh = await martin.post('/v1/portal/orders', { customerCode: '11131', header: CARRETA, lines: UPSELL_1 }, { headers: { 'idempotency-key': newKey('auto') } });
      assert.equal(fresh.status, 201);
      assert.equal((await strictJson(fresh, PortalOrderView)).status, 'APPROVED', 'controle');
    } finally {
      assert.equal((await ana.put('/v1/backoffice/customers/11131/rules', { autoApprove: false })).status, 200);
    }
  });

  test('dois reenvios simultâneos → um 200 e um 409, nunca 500, com uma só versão nova', async () => {
    const id = await returned();
    const before = await counts(id);
    const results = await Promise.all([resubmit(martin, id, body()), resubmit(martin, id, body(UPSELL_1))]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(await counts(id), { versions: before.versions + 1, events: before.events + 1 });
  });

  test('Sofía devolvida e reenviada no próprio escopo (lista AR, restrição de país vale no reenvio)', async () => {
    const C40 = { vehicleId: 'container_40', loadMode: 'PALLETIZED', reference: 'OC-S9-AR', loadingDate: null };
    const id = await submit(sofia, '11999', [{ material: '12031291', boxes: 1176 }, { material: '12142501', boxes: 1400 }], C40);
    assert.equal((await ret(ana, id, { expectedVersion: 1, reason: 'Revisar' })).status, 200);
    const blocked = await resubmit(sofia, id, body([{ material: '20908885', boxes: 77 }, { material: '12142501', boxes: 1400 }], C40));
    assert.equal(blocked.status, 422);
    assert.ok((await errorBody(blocked)).error.details?.some((d) => d.code === 'COUNTRY_RESTRICTED' && d.material === '20908885'));
    const ok = await resubmit(sofia, id, body([{ material: '12031291', boxes: 1344 }, { material: '12142501', boxes: 1400 }], C40));
    assert.equal(ok.status, 200);
    assert.equal((await strictJson(ok, PortalOrderView)).current.authorLabel, 'Sofía (Distribuidora Río Claro S.R.L.)');
  });
});
