// Tradutores e fachada do api-client.js (docs/specs/05-integracao-web.md, "Fachada API", "Tradução de formatos" e "Aceite").
// Os exemplos de entrada passam pelos schemas de #contracts: se o contrato mudar, o exemplo (e o tradutor) precisam acompanhar.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BackofficeOrderView, CatalogItem, CustomerInternal, CustomerProfile, PortalOrderView, ProductInternal } from '#contracts';
import { PilotApiError, fakeFetch, fakeStorage, loadClient, plain, type FakeCall } from './helpers.ts';

const profile = CustomerProfile.parse({
  code: '11131', slug: 'minoil', name: 'MINOIL S.A.', destinationLabel: 'Mercosul', currency: 'USD', incoterm: 'FCA',
  paymentCode: '2304', paymentTerms: 'Standby irrevogável 60 dias', priceList: 'US', plant: '2612', plantName: 'CD Londrina',
  branch: 'LONT', contactName: 'Martín', language: 'pt', mixedPallet: false,
});
const internalAR = CustomerInternal.parse({
  ...profile, code: '11999', slug: 'rioclaro', name: 'Distribuidora Río Claro S.R.L.', priceList: 'AR', contactName: 'Sofía',
  language: 'es', mixedPallet: true, country: 'AR', autoApprove: true, isDemo: true, restrictedMaterials: ['20908885'],
});
const catalogItem = CatalogItem.parse({
  material: '12034109', family: 'CAPPUCCINO', brand: '3corações', sapDescription: 'CAFE CAPP 3C BAUN ABRA COR AL PT 24X200G',
  names: { pt: 'Cappuccino Baunilha pote 200 g', es: 'Cappuccino Vainilla pote 200 g', en: 'Vanilla Cappuccino jar 200 g' },
  unitsLabel: '24 × 200 g', unitsPerBox: 24, netKgPerBox: 4.8, grossKgPerBox: 6.177, volumeDm3: 21.279,
  dimsMm: { length: 346, width: 246, height: 250 }, layerBoxes: 14, layers: 7, boxesPerPallet: 98, minLotPallets: 1,
  price: 36.96, ean: '7896005804629', dun: '37896005804620', ncm: '2101.12.00', productLine: '01.CAPP - POTE', shelfLifeDays: 365,
});
const { price: _price, ...itemWithoutPrice } = catalogItem;
const product = ProductInternal.parse({
  ...itemWithoutPrice,
  prices: [
    { priceList: 'AR', price: 39.18, priceRaw: 39.1776, origin: 'DEMO_DERIVED', validFrom: '2026-01-01', validTo: '9999-12-31' },
    { priceList: 'US', price: 30, priceRaw: null, origin: 'SAP_LIST', validFrom: '2025-01-01', validTo: '2025-12-31' },
    { priceList: 'US', price: 36.96, priceRaw: null, origin: 'SITE_3C', validFrom: '2026-01-01', validTo: '9999-12-31' },
  ],
  sap: { layerBoxes: 4, layers: 7, grossKgPerBox: 6.177 },
  overrides: [{ field: 'layerBoxes', sapValue: 4, adoptedValue: 14, justification: 'Q12', decisionRef: 'Q12', proposedBy: 'Administração de dados', confirmedBy: 'Ana (Exportação)', confirmedAt: '2026-10-13T15:00:00.000Z' }],
  ob: { boxesPerPallet: 98.00000000000001, palletizationBoxes: 98, price: 36.96, minLot: 1, grossKgPerBox: 6.168 },
  minLotSource: 'OB_PALETIZACAO',
});

const result = {
  engineVersion: 1, lines: [], totals: { boxes: 0, pallets: 0, positions: 0, netKg: 0, grossKg: 0, m3: 0, valueCents: 0 },
  utilization: { kg: 0, m3: 0, positions: 0 }, binding: 'kg', status: 'PARTIAL', over: { positions: 0, kg: 0, m3: 0 }, alerts: [], blocking: false,
} as const;
function version(versionNo: number, lines: { material: string; boxes: number }[], extra: Record<string, unknown> = {}) {
  return {
    versionNo, header: { vehicleId: 'container_40', loadMode: 'FLOOR', reference: 'OC-4471', loadingDate: '2026-11-03', mixedPallet: true },
    lines, result, authorLabel: 'Lucas (Exportação)', reason: null, createdAt: '2026-10-11T14:31:00.000Z', ...extra,
  };
}
const internal = { dataBatches: [1], overrides: [], contentHash: 'abc' };
const boOrder = BackofficeOrderView.parse({
  id: '3CC-2026-0002', customerCode: '11999', customerName: 'Distribuidora Río Claro S.R.L.', status: 'CHANGES_REQUESTED', origin: 'PORTAL',
  currentVersion: 2, createdAt: '2026-10-11T12:12:00.000Z', createdByLabel: 'Sofía (Distribuidora Río Claro S.R.L.)',
  submittedAt: '2026-10-11T12:12:00.000Z', approvedAt: null, approvedByLabel: null,
  permissions: { canEdit: true, canApprove: false, canReturn: true, canResubmit: false },
  current: version(2, [{ material: '12031189', boxes: 2688 }, { material: '12034103', boxes: 405 }], { internal }),
  versions: [version(1, [{ material: '12031189', boxes: 2688 }, { material: '12034103', boxes: 324 }], { internal, authorLabel: 'Sofía (Distribuidora Río Claro S.R.L.)', createdAt: '2026-10-11T12:12:00.000Z' }),
    version(2, [{ material: '12031189', boxes: 2688 }, { material: '12034103', boxes: 405 }], { internal })],
  events: [
    { at: '2026-10-11T12:12:00.000Z', actorLabel: 'Sofía (Distribuidora Río Claro S.R.L.)', type: 'SUBMITTED', fromStatus: null, toStatus: 'SUBMITTED', versionNo: 1, payload: {} },
    { at: '2026-10-11T14:31:00.000Z', actorLabel: 'Lucas (Exportação)', type: 'VERSION_CREATED', fromStatus: 'SUBMITTED', toStatus: 'SUBMITTED', versionNo: 2,
      payload: { changes: [{ material: '12034103', old: 324, new: 405 }, { material: '12031189', old: 3528, new: 2688 }], reason: 'completar a carreta', internal: { x: 1 } } },
    { at: '2026-10-11T15:00:00.000Z', actorLabel: 'Lucas (Exportação)', type: 'CHANGES_REQUESTED', fromStatus: 'SUBMITTED', toStatus: 'CHANGES_REQUESTED', versionNo: 2, payload: { reason: 'trocar o veículo' } },
  ],
});
const portalOrder = PortalOrderView.parse({
  id: '3CC-2026-0004', customerCode: '11131', customerName: 'MINOIL S.A.', status: 'APPROVED', origin: 'ORDER_BASIS',
  currentVersion: 1, createdAt: '2026-10-09T20:53:00.000Z', createdByLabel: 'Lucas (Exportação)', submittedAt: '2026-10-09T20:53:00.000Z',
  approvedAt: '2026-10-14T13:05:00.000Z', approvedByLabel: 'Regra de aprovação automática',
  permissions: { canEdit: false, canApprove: false, canReturn: false, canResubmit: false },
  current: { ...version(1, [{ material: '12031189', boxes: 3528 }]), header: { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: '', loadingDate: null, mixedPallet: false } },
  events: [
    { at: '2026-10-09T20:53:00.000Z', actorLabel: 'Lucas (Exportação)', type: 'SUBMITTED', fromStatus: null, toStatus: 'SUBMITTED', versionNo: 1, payload: {} },
    { at: '2026-10-14T13:05:00.000Z', actorLabel: 'Regra de aprovação automática', type: 'AUTO_APPROVED', fromStatus: 'SUBMITTED', toStatus: 'APPROVED', versionNo: 1, payload: {} },
  ],
});

const names: Record<string, string> = { '12031189': 'Café Tradicional a vácuo 250 g', '12034103': 'Cappuccino Clássico sachê 20 g' };
const ctx = { clientKey: (code: string) => ({ '11131': 'minoil', '11999': 'rioclaro' })[code], productName: (code: string) => names[code] };

describe('modo', () => {
  test('sem PSF_DEMO o modo é server; com o demo-data.js antes, demo (decidido sem rede)', () => {
    const { calls, fetch } = fakeFetch([]);
    assert.equal(loadClient({ fetch }).PSF.mode, 'server');
    assert.equal(loadClient({ fetch, PSF_DEMO: null }).PSF.mode, 'server');
    const demo = loadClient({ fetch }, { demo: true });
    assert.equal(demo.PSF.mode, 'demo');
    assert.equal(calls.length, 0, 'nenhuma chamada de rede ao carregar');
  });

  test('o demo-data.js traz P (com EXTRA já mesclado e ob), CLIENTS e os 3 pedidos de exemplo', () => {
    const { PSF_DEMO } = loadClient({}, { demo: true });
    assert.equal(PSF_DEMO.P.length, 10);
    const p = PSF_DEMO.P.find((x: { code: string }) => x.code === '12031189');
    assert.equal(p.ean, '7896005800362');
    assert.equal(p.en, 'Traditional Coffee, vacuum pack 250 g');
    assert.equal(p.ob.cxPal, 168);
    assert.deepEqual(plain(Object.keys(PSF_DEMO.CLIENTS)), ['minoil', 'rioclaro']);
    assert.deepEqual(plain(PSF_DEMO.ORDERS.map((o: { id: string }) => o.id)), ['3CC-2026-0001', '3CC-2026-0002', '3CC-2026-0003']);
  });
});

describe('tradução da API para o piloto', () => {
  const { PSF } = loadClient();
  const tr = PSF.translate;

  test('veículo, modo de carga e status', () => {
    assert.deepEqual(plain(tr.VEHICLE_FROM_API), { carreta_padrao: 'carreta', container_40: 'c40', container_20: 'c20' });
    assert.deepEqual(plain(tr.MODE_FROM_API), { PALLETIZED: 'pal', FLOOR: 'est' });
    assert.deepEqual(plain(tr.STATUS_FROM_API), { SUBMITTED: 'analise', CHANGES_REQUESTED: 'devolvido', APPROVED: 'aprovado', EXPORTED: 'sap' });
    assert.equal(tr.VEHICLE_TO_API.c40, 'container_40');
    assert.equal(tr.MODE_TO_API.est, 'FLOOR');
  });

  test('CatalogItem → item de P (sem nada interno)', () => {
    const p = plain(tr.catalogItem(catalogItem));
    assert.deepEqual(p, {
      code: '12034109', fam: 'CAPPUCCINO', brand: '3corações', sap: 'CAFE CAPP 3C BAUN ABRA COR AL PT 24X200G',
      pt: 'Cappuccino Baunilha pote 200 g', es: 'Cappuccino Vainilla pote 200 g', en: 'Vanilla Cappuccino jar 200 g',
      un: 24, unLbl: '24 × 200 g', net: 4.8, gross: 6.177, dm3: 21.279, lastro: 14, alt: 7, cxPal: 98, m3: 21.279 / 1000,
      price: 36.96, loteMin: 1, shelf: 365, ncm: '2101.12.00', dims: '346×246×250', ean: '7896005804629', dun: '37896005804620',
      linha: '01.CAPP - POTE',
    });
    const nullPrice = plain(tr.catalogItem({ ...catalogItem, price: null, ean: null, productLine: null }));
    assert.equal(nullPrice.price, null);
    assert.equal(nullPrice.ean, '');
    assert.equal(nullPrice.linha, '');
  });

  test('ProductInternal → item de P do backoffice: preço da lista US vigente, prices por lista, priceSrc e ob', () => {
    const p = plain(tr.productInternal(product, { today: '2026-10-14' }));
    assert.equal(p.code, '12034109');
    assert.equal(p.cxPal, 98);
    assert.equal(p.price, 36.96, 'lista US vigente hoje (a de 2025 venceu)');
    assert.deepEqual(p.prices, { AR: 39.18, US: 36.96 });
    assert.equal(p.priceSrc, 'site', 'SITE_3C');
    assert.deepEqual(p.ob, { cxPal: 98.00000000000001, palz: 98, price: 36.96, lote: 1, grossCx: 6.168 });
    assert.equal(p.overrides.length, 1);

    const old = plain(tr.productInternal(product, { today: '2025-06-01' }));
    assert.equal(old.price, 30);
    assert.equal(old.priceSrc, 'sap', 'SAP_LIST');

    const noUs = plain(tr.productInternal({ ...product, prices: product.prices.filter((x) => x.priceList === 'AR') }, { today: '2026-10-14' }));
    assert.equal(noUs.price, null);
    assert.equal(noUs.priceSrc, 'missing');
    assert.deepEqual(noUs.prices, { AR: 39.18 });

    const noOb = plain(tr.productInternal({ ...product, ob: { boxesPerPallet: null, palletizationBoxes: null, price: null, minLot: null, grossKgPerBox: null } }, { today: '2026-10-14' }));
    assert.equal(noOb.ob, null, 'sem referência da OB, como os itens importados do SAP no piloto');
  });

  test('CustomerProfile e CustomerInternal → CLIENTS[slug]', () => {
    assert.deepEqual(plain(tr.customer(profile)), {
      name: 'MINOIL S.A.', code: '11131', dest: 'Mercosul', cur: 'USD', inc: 'FCA', pay: 'Standby irrevogável 60 dias', payCode: '2304',
      list: 'US', factor: 1, blocked: [], filial: 'CD Londrina (2612)', contact: 'Martín', lang: 'pt', mixed: false, autoApprove: false,
    });
    const ar = plain(tr.customer(internalAR));
    assert.deepEqual([ar.list, ar.factor, ar.blocked, ar.lang, ar.mixed, ar.autoApprove], ['AR', 1, ['20908885'], 'es', true, true]);
    assert.equal(plain(tr.customer({ ...profile, contactName: null })).contact, 'MINOIL S.A.', 'sem contato, o nome (o cabeçalho lê contact[0])');
  });

  test('OrderView → pedido do piloto, com VERSION_CREATED virando uma entrada "Alterou" por item', () => {
    const o = plain(tr.orderView(boOrder, ctx));
    assert.equal(o.id, '3CC-2026-0002');
    assert.equal(o.v, 2);
    assert.equal(o.client, 'rioclaro');
    assert.deepEqual([o.veh, o.mode, o.mixed], ['c40', 'est', true]);
    assert.deepEqual(o.qty, { '12031189': 2688, '12034103': 405 });
    assert.deepEqual([o.ref, o.date, o.status, o.origin, o.auto], ['OC-4471', '2026-11-03', 'devolvido', 'Portal', false]);
    assert.equal(o.created, '11/10 09:12', 'dd/mm HH:MM no fuso de São Paulo');
    assert.equal(o.createdMs, Date.parse('2026-10-11T12:12:00.000Z'));
    assert.deepEqual([o.approved, o.approvedMs], [undefined, undefined]);
    assert.deepEqual(o.perm, { canEdit: true, canApprove: false, canReturn: true, canResubmit: false });

    assert.equal(o.audit.length, 4, 'SUBMITTED, duas mudanças do VERSION_CREATED e a devolução');
    assert.deepEqual(o.audit[0], { at: '11/10 09:12', ts: '2026-10-11T12:12:00.000Z', who: 'Sofía (Distribuidora Río Claro S.R.L.)', what: 'Pedido enviado pelo portal' });
    assert.deepEqual(o.audit[1], {
      at: '11/10 11:31', ts: '2026-10-11T14:31:00.000Z', who: 'Lucas (Exportação)', kind: 'edit', code: '12034103', old: 324, nv: 405,
      what: 'Alterou 12034103 (Cappuccino Clássico sachê 20 g) de 324 para 405 cx · completar a carreta',
    });
    assert.equal(o.audit[2].what, 'Alterou 12031189 (Café Tradicional a vácuo 250 g) de 3.528 para 2.688 cx · completar a carreta');
    assert.equal(o.audit.filter((a: { what: string }) => a.what.startsWith('Alterou')).length, 2, 'adjCount() do piloto conta por esse prefixo');
    assert.equal(o.audit[3].what, 'Pedido devolvido ao distribuidor: trocar o veículo');
    assert.ok(!JSON.stringify(o).includes('internal'));
  });

  test('OrderView do portal: Order Basis, aprovação automática e sem data de carregamento', () => {
    const o = plain(tr.orderView(portalOrder, ctx));
    assert.deepEqual([o.client, o.veh, o.mode, o.mixed, o.ref, o.date, o.status, o.origin, o.auto], ['minoil', 'carreta', 'pal', false, '', '', 'aprovado', 'Order Basis', true]);
    assert.equal(o.approved, '14/10 10:05');
    assert.equal(o.approvedMs, Date.parse('2026-10-14T13:05:00.000Z'));
    assert.deepEqual(o.audit.map((a: { what: string }) => a.what), ['Pedido importado da planilha Order Basis', 'Aprovado automaticamente: sem bloqueios e carga completa']);
    const list = plain(tr.orderView({ ...portalOrder, events: undefined }, ctx));
    assert.deepEqual(list.audit, [], 'a lista não traz eventos');
    assert.equal(list.auto, true, 'na lista, a aprovação automática vem do rótulo de quem aprovou');
  });

  test('alertas do motor → códigos do piloto em details', () => {
    assert.deepEqual(plain(tr.details([
      { code: 'VEHICLE_EXCEEDED', params: { positions: 2, kg: 0, m3: 0 } },
      { code: 'BELOW_MIN_LOT', material: '12142501', params: { minLot: 5 } },
      { code: 'COUNTRY_RESTRICTED', material: '20908885' },
      { code: 'NO_PRICE', material: '12142501' },
      { code: 'QTY_NOT_MULTIPLE', material: '12031291', params: { lo: 50, hi: 51 } },
      { code: 'UNKNOWN_MATERIAL', material: '99999999' },
    ])), [
      { code: 'CAPACITY', over: { pos: 2, kg: 0, m3: 0 } },
      { code: 'BELOWMIN', material: '12142501', params: { minLot: 5 } },
      { code: 'BLOCKED', material: '20908885' },
      { code: 'NOPRICE', material: '12142501' },
      { code: 'BOXMULT', material: '12031291', params: { lo: 50, hi: 51 } },
      { code: 'UNKNOWN_MATERIAL', material: '99999999' },
    ]);
    assert.deepEqual(plain(tr.details(undefined)), []);
  });

  test('rascunho do piloto → corpo do envio (sem mixedPallet: vale o cliente)', () => {
    const CLIENTS = { minoil: { code: '11131' } };
    const body = plain(tr.orderBody({ client: 'minoil', veh: 'c20', mode: 'est', mixed: true, qty: { '12031189': 168, '12034103': 81.5, '12144012': 0 } },
      { draftId: 'rabc12345', ref: '  OC;1\t"x"\n ', date: '' }, CLIENTS));
    assert.deepEqual(body, {
      customerCode: '11131',
      header: { vehicleId: 'container_20', loadMode: 'FLOOR', reference: 'OC 1  x', loadingDate: null },
      lines: [{ material: '12031189', boxes: 168 }, { material: '12034103', boxes: 81.5 }],
    });
    assert.equal(plain(tr.orderBody({ client: 'minoil', veh: 'carreta', mode: 'pal', qty: { '12031189': 1 } }, { ref: 'x'.repeat(40), date: '2026-12-01' }, CLIENTS)).header.reference.length, 30);
  });
});

// ---- fachada no modo servidor (fetch falso)

function serverEnv(routes: Parameters<typeof fakeFetch>[0], extra: Record<string, unknown> = {}) {
  const net = fakeFetch(routes);
  const storage = fakeStorage();
  const g = loadClient({ fetch: net.fetch, localStorage: storage, ...extra });
  const env = {
    S: { orders: [] as any[], sel: null, client: 'minoil', qty: { '12031189': 168 }, unit: {}, veh: 'carreta', mode: 'pal', lang: 'pt', view3d: '3d', drafts: [{ id: 'rabc12345', client: 'minoil', qty: {} }], draftId: 'rabc12345' },
    P: [] as any[], BY: {} as Record<string, unknown>, VEH: { carreta: { pos: 1, m3: 1, kg: 1, cols: 14 }, c40: { pos: 1, m3: 1, kg: 1 }, c20: { pos: 1, m3: 1, kg: 1 } },
    RULES: { fullAt: 0.5, leadDays: 1, lateH: 4, minLotBlock: false, fullPalBlock: true }, CLIENTS: { minoil: { code: '11131', name: 'MINOIL S.A.', mixed: false }, rioclaro: { code: '11999', name: 'Distribuidora Río Claro S.R.L.', mixed: false } } as Record<string, any>,
    RLOG: [] as any[], ApiError: PilotApiError, render: () => { env.renders++; }, loadFolderPhotos: () => undefined, renders: 0,
  };
  const demo = {
    get(id: string) { const o = env.S.orders.find((x) => x.id === id); if (!o) throw new PilotApiError(404, 'Pedido não encontrado'); return o; },
    quote: () => 'quote-local', getSettings: () => ({ rules: 'local' }),
    createOrder: () => { throw new Error('não deve chamar o API_DEMO no modo servidor'); },
    updateItem: () => { throw new Error('idem'); }, approve: () => { throw new Error('idem'); }, exportSap: () => { throw new Error('idem'); },
    setClientRule: () => { throw new Error('idem'); }, saveSettings: () => { throw new Error('idem'); }, addVehicle: () => { throw new Error('idem'); },
    removeVehicle: () => { throw new Error('idem'); }, resetSettings: () => { throw new Error('idem'); },
  };
  const API = g.PSF.createApi(demo, env);
  return { ...net, storage, env, API, PSF: g.PSF };
}
const json = (c: FakeCall, method: string, url: string | RegExp) => c.method === method && (typeof url === 'string' ? c.url === url : url.test(c.url));
const errorBody = (code: string, message: string, details?: unknown[]) => ({ error: { code, message, ...(details ? { details } : {}) } });
const submittedOrder = (v: number, boxes = 2688) => ({ ...boOrder, status: 'SUBMITTED' as const, currentVersion: v, current: { ...boOrder.current, versionNo: v, lines: [{ material: '12031189', boxes }] } });

describe('fachada API no modo servidor', () => {
  test('createOrder: POST /v1/portal/orders com Idempotency-Key = draftId; o pedido traduzido entra no início de S.orders', async () => {
    const t = serverEnv([(c) => (json(c, 'POST', '/v1/portal/orders') ? { status: 201, body: portalOrder } : undefined)]);
    t.env.S.orders.push({ id: 'velho' });
    const o = await t.API.createOrder({ client: 'minoil', veh: 'carreta', mode: 'pal', mixed: false, qty: { '12031189': 3528 } }, { draftId: 'rabc12345', ref: 'R1', date: '' });
    assert.equal(t.calls.length, 1);
    const [c] = t.calls;
    assert.equal(c.headers['idempotency-key'], 'rabc12345');
    assert.equal(c.headers['content-type'], 'application/json');
    assert.deepEqual(c.body, { customerCode: '11131', header: { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED', reference: 'R1', loadingDate: null }, lines: [{ material: '12031189', boxes: 3528 }] });
    assert.equal(o.id, '3CC-2026-0004');
    assert.equal(t.env.S.orders[0], o);
    assert.equal(t.env.S.orders[1].id, 'velho');
    assert.ok(o.auto);
  });

  test('erro da API vira ApiError do piloto (status, mensagem, details traduzidos e code); falha de rede também', async () => {
    const t = serverEnv([(c) => (json(c, 'POST', '/v1/portal/orders')
      ? { status: 422, body: errorBody('ORDER_BLOCKED', 'O pedido tem bloqueios.', [{ code: 'COUNTRY_RESTRICTED', material: '20908885' }]) } : undefined)]);
    await assert.rejects(t.API.createOrder({ client: 'minoil', veh: 'carreta', mode: 'pal', qty: { '20908885': 77 } }, { draftId: 'rabc12345' }), (e: any) => {
      assert.ok(e instanceof PilotApiError);
      assert.deepEqual([e.status, e.message, e.code], [422, 'O pedido tem bloqueios.', 'ORDER_BLOCKED']);
      assert.deepEqual(plain(e.details), [{ code: 'BLOCKED', material: '20908885' }]);
      return true;
    });
    assert.equal(t.env.S.orders.length, 0);

    const off = serverEnv([]);
    const failing = loadClient({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    const api = failing.PSF.createApi({ get: () => ({}) }, off.env);
    await assert.rejects(api.approve('x'), (e: any) => e instanceof PilotApiError && e.status === 0 && /conexão/.test(e.message));
  });

  test('get é síncrono e não chama a rede; quote e getSettings são locais', () => {
    const t = serverEnv([]);
    t.env.S.orders.push({ id: 'A', v: 1 });
    assert.equal(t.API.get('A').id, 'A');
    assert.throws(() => t.API.get('B'), (e: any) => e.status === 404);
    assert.equal(t.API.quote({}), 'quote-local');
    assert.deepEqual(plain(t.API.getSettings()), { rules: 'local' });
    assert.equal(t.calls.length, 0);
  });

  test('updateItem: POST .../versions com expectedVersion = o.v e a troca do item; sem mudança, nenhuma chamada', async () => {
    const t = serverEnv([(c) => (json(c, 'POST', '/v1/backoffice/orders/3CC-2026-0002/versions') ? { status: 200, body: submittedOrder(3, 3192) } : undefined)]);
    t.env.S.orders.push({ id: 'X' }, { id: '3CC-2026-0002', v: 2, qty: { '12031189': 2688 } });
    const same = await t.API.updateItem('3CC-2026-0002', '12031189', 2688);
    assert.equal(same.v, 2);
    assert.equal(t.calls.length, 0, 'sem mudança efetiva não chama (o servidor daria NO_CHANGES)');
    const o = await t.API.updateItem('3CC-2026-0002', '12031189', 3192.7);
    assert.deepEqual(t.calls[0].body, { expectedVersion: 2, changes: [{ material: '12031189', boxes: 3192 }] });
    assert.equal(o.v, 3);
    assert.equal(t.env.S.orders[1], o, 'substitui no mesmo lugar');
    assert.deepEqual(plain(o.qty), { '12031189': 3192 });
  });

  test('approve: POST .../approve com expectedVersion; em 409 VERSION_CONFLICT recarrega o pedido e repassa o erro', async () => {
    const t = serverEnv([
      (c) => (json(c, 'POST', '/v1/backoffice/orders/3CC-2026-0002/approve')
        ? { status: 409, body: errorBody('VERSION_CONFLICT', 'O pedido mudou.', [{ code: 'VERSION_CONFLICT', params: { currentVersion: 3 } }]) } : undefined),
      (c) => (json(c, 'GET', '/v1/backoffice/orders/3CC-2026-0002') ? { status: 200, body: submittedOrder(3, 3192) } : undefined),
    ], {});
    (t.PSF as any).me = { area: 'backoffice', user: { id: 3 } };
    t.env.S.orders.push({ id: '3CC-2026-0002', v: 2, qty: {} });
    await assert.rejects(t.API.approve('3CC-2026-0002'), (e: any) => e.status === 409 && e.code === 'VERSION_CONFLICT');
    assert.deepEqual(t.calls.map((c) => [c.method, c.url]), [['POST', '/v1/backoffice/orders/3CC-2026-0002/approve'], ['GET', '/v1/backoffice/orders/3CC-2026-0002']]);
    assert.deepEqual(t.calls[0].body, { expectedVersion: 2 });
    assert.equal(t.env.S.orders[0].v, 3, 'S.orders atualizado com o pedido recarregado');
  });

  test('approve com sucesso substitui o pedido; exportSap recusa sem chamar a rede', async () => {
    const t = serverEnv([(c) => (json(c, 'POST', /\/approve$/) ? { status: 200, body: { ...boOrder, status: 'APPROVED', approvedAt: '2026-10-14T13:00:00.000Z', approvedByLabel: 'Ana (Exportação)' } } : undefined)]);
    t.env.S.orders.push({ id: '3CC-2026-0002', v: 2, qty: {} });
    const o = await t.API.approve('3CC-2026-0002');
    assert.equal(o.status, 'aprovado');
    assert.equal(t.env.S.orders[0], o);
    await assert.rejects(t.API.exportSap('3CC-2026-0002'), (e: any) => e instanceof PilotApiError && e.message === 'Exportação para o SAP: próxima fase');
    assert.equal(t.calls.length, 1);
  });

  test('setClientRule: PUT .../rules com mixedPallet ou autoApprove; atualiza CLIENTS e refaz o RLOG pelo servidor', async () => {
    const ruleChanges = [{ at: '2026-10-14T12:00:00.000Z', customerCode: '11999', field: 'mixedPallet', oldValue: false, newValue: true, actorLabel: 'Ana (Exportação)' }];
    const t = serverEnv([
      (c) => (json(c, 'PUT', '/v1/backoffice/customers/11999/rules') ? { status: 200, body: internalAR } : undefined),
      (c) => (json(c, 'GET', '/v1/backoffice/customers') ? { status: 200, body: { customers: [internalAR], ruleChanges } } : undefined),
    ]);
    t.env.RLOG.push({ what: 'velho' });
    const c = await t.API.setClientRule('rioclaro', 'mixed', true);
    assert.deepEqual(t.calls[0].body, { mixedPallet: true });
    assert.equal(t.env.CLIENTS.rioclaro.mixed, true);
    assert.equal(c, t.env.CLIENTS.rioclaro, 'devolve o próprio objeto de CLIENTS, como o piloto');
    assert.deepEqual(plain(t.env.RLOG), [{ at: '14/10 09:00', ts: '2026-10-14T12:00:00.000Z', who: 'Ana (Exportação)', what: 'Distribuidora Río Claro S.R.L.: pallet misto liberado' }]);
    await t.API.setClientRule('rioclaro', 'autoApprove', false);
    assert.deepEqual(t.calls[2].body, { autoApprove: false });
    await assert.rejects(t.API.setClientRule('nada', 'mixed', true), (e: any) => e.status === 404);
  });

  test('parâmetros do negócio: no servidor, as escritas recusam (próxima fase) sem chamar a rede', () => {
    const t = serverEnv([]);
    for (const m of ['saveSettings', 'addVehicle', 'removeVehicle', 'resetSettings']) {
      assert.throws(() => t.API[m]({}), (e: any) => e instanceof PilotApiError && e.message === 'Parâmetros do negócio: próxima fase', m);
    }
    assert.equal(t.calls.length, 0);
  });

  test('returnOrder e resubmit (S9): rotas de devolução e de reenvio com expectedVersion', async () => {
    const t = serverEnv([
      (c) => (json(c, 'POST', '/v1/backoffice/orders/3CC-2026-0002/return') ? { status: 200, body: boOrder } : undefined),
      (c) => (json(c, 'POST', '/v1/portal/orders/3CC-2026-0002/versions') ? { status: 200, body: submittedOrder(3) } : undefined),
    ]);
    t.env.S.orders.push({ id: '3CC-2026-0002', v: 2, qty: {}, ref: 'OC-4471', date: '2026-11-03' });
    const back = await t.API.returnOrder('3CC-2026-0002', '  trocar o veículo ');
    assert.deepEqual(t.calls[0].body, { expectedVersion: 2, reason: 'trocar o veículo' });
    assert.equal(back.status, 'devolvido');
    const again = await t.API.resubmit('3CC-2026-0002', { client: 'rioclaro', veh: 'c40', mode: 'pal', qty: { '12031189': 2688 } });
    assert.deepEqual(t.calls[1].body, {
      expectedVersion: 2,
      header: { vehicleId: 'container_40', loadMode: 'PALLETIZED', reference: 'OC-4471', loadingDate: '2026-11-03' },
      lines: [{ material: '12031189', boxes: 2688 }],
    });
    assert.equal(again.v, 3);
  });
});

describe('carga dos dados da sessão no estado do piloto (mutado no lugar)', () => {
  const vehicles = [
    { id: 'carreta_padrao', displayName: 'Carreta', modal: 'rodoviario', volumeM3: 72, payloadKg: 25000, palletPositions: 28, assumptions: [] },
    { id: 'container_40', displayName: "Container 40'", modal: 'maritimo', volumeM3: 60.84, payloadKg: 25000, palletPositions: 20, assumptions: [] },
  ];

  test('applyCatalog: P e BY trocados no mesmo array/objeto, VEH só com pos/m3/kg, RULES no perfil do engine_version 1 e CLIENTS só do escopo', () => {
    const t = serverEnv([]);
    const { P, BY, VEH, RULES, CLIENTS } = t.env;
    P.push({ code: 'velho' });
    BY.velho = {};
    t.PSF.applyCatalog({ engineVersion: 1, customer: { ...profile, restrictedMaterials: ['20908885'] }, rules: { fullAt: 0.9, leadDays: 7 }, vehicles, items: [catalogItem] }, [profile]);
    assert.equal(t.env.P, P, 'mesmo array (const no HTML)');
    assert.deepEqual(plain(P.map((p) => p.code)), ['12034109']);
    assert.deepEqual(plain(Object.keys(BY)), ['12034109']);
    assert.equal(BY['12034109'], P[0]);
    assert.deepEqual(plain(VEH.carreta), { pos: 28, m3: 72, kg: 25000, cols: 14 }, 'rótulos e cols continuam do HTML');
    assert.deepEqual(plain(VEH.c40), { pos: 20, m3: 60.84, kg: 25000 });
    assert.deepEqual(plain(RULES), { fullAt: 0.9, leadDays: 7, lateH: 4, minLotBlock: true, fullPalBlock: false }, 'perfil v1, mesmo que o HTML estivesse com outra regra');
    assert.deepEqual(plain(Object.keys(CLIENTS)), ['minoil'], 'rioclaro saiu');
    assert.deepEqual(plain(CLIENTS.minoil.blocked), ['20908885'], 'restrições do catálogo do cliente');
  });

  test('applyProducts e applyCustomers: P com prices e ob, CLIENTS de todos e RLOG pelo servidor', () => {
    const t = serverEnv([]);
    t.env.RLOG.push({ what: 'velho' });
    t.PSF.applyProducts({ items: [product], vehicles, rules: { fullAt: 0.9, leadDays: 7 } }, { today: '2026-10-14' });
    assert.deepEqual(plain(t.env.P[0].prices), { AR: 39.18, US: 36.96 });
    assert.equal(t.env.P[0].ob.cxPal, 98.00000000000001);
    assert.deepEqual(plain([t.env.RULES.minLotBlock, t.env.RULES.fullPalBlock]), [true, false]);
    t.PSF.applyCustomers({ customers: [{ ...profile, country: null, autoApprove: false, isDemo: false, restrictedMaterials: [] }, internalAR], ruleChanges: [
      { at: '2026-10-14T12:00:00.000Z', customerCode: '11131', field: 'autoApprove', oldValue: false, newValue: true, actorLabel: 'Ana (Exportação)' },
    ] });
    assert.deepEqual(plain(Object.keys(t.env.CLIENTS)), ['minoil', 'rioclaro']);
    assert.equal(t.env.CLIENTS.rioclaro.autoApprove, true);
    assert.deepEqual(plain(t.env.RLOG.map((r) => r.what)), ['MINOIL S.A.: aprovação automática ativada']);
  });
});

describe('fachada API no modo demo', () => {
  test('as escritas viram Promise com o resultado do API_DEMO; erros viram rejeição; get continua síncrono', async () => {
    const g = loadClient({}, { demo: true });
    const seen: string[] = [];
    const demo = {
      get: (id: string) => ({ id }),
      quote: () => 'q',
      createOrder: (d: unknown, meta: { draftId: string }) => { seen.push(`create:${meta.draftId}`); return { id: 'N' }; },
      updateItem: (id: string, code: string, nv: number) => { seen.push(`update:${id}:${code}:${nv}`); return { id }; },
      approve: () => { throw new PilotApiError(409, 'O pedido ainda tem bloqueios'); },
      exportSap: (id: string) => ({ id, status: 'sap' }),
      setClientRule: (k: string) => ({ k }),
      getSettings: () => 's', saveSettings: () => ['feito'], addVehicle: () => 'v-novo', removeVehicle: () => true, resetSettings: () => [],
    };
    const API = g.PSF.createApi(demo, { ApiError: PilotApiError });
    assert.deepEqual(plain(API.get('A')), { id: 'A' });
    const created = API.createOrder({}, { draftId: 'd1' });
    assert.ok(typeof created.then === 'function', 'Promise');
    assert.deepEqual(plain(await created), { id: 'N' });
    assert.deepEqual(plain(await API.updateItem('A', '12031189', 3)), { id: 'A' });
    await assert.rejects(API.approve('A'), (e: any) => e instanceof PilotApiError && e.status === 409);
    assert.equal((await API.exportSap('A')).status, 'sap', 'o CSV continua no modo demo');
    assert.deepEqual(plain(await API.setClientRule('minoil', 'mixed', true)), { k: 'minoil' });
    assert.deepEqual(plain(API.saveSettings({})), ['feito'], 'parâmetros continuam síncronos no demo');
    assert.equal(API.addVehicle({}), 'v-novo');
    assert.deepEqual(seen, ['create:d1', 'update:A:12031189:3']);
  });
});

describe('sessão e preferências', () => {
  test('savePrefs grava só preferências e rascunhos em 3cc-srv-v1:{id do usuário}; sem sessão, nada', () => {
    const t = serverEnv([]);
    t.PSF.savePrefs();
    assert.equal(t.storage.data.size, 0, 'sem sessão não grava');
    (t.PSF as any).me = { area: 'portal', user: { id: 7 } };
    t.env.S.orders.push({ id: 'X' });
    t.PSF.savePrefs();
    assert.deepEqual([...t.storage.data.keys()], ['3cc-srv-v1:7']);
    const saved = JSON.parse(t.storage.data.get('3cc-srv-v1:7')!);
    assert.deepEqual(Object.keys(saved).sort(), ['draftId', 'drafts', 'lang', 'mode', 'qty', 'unit', 'veh', 'view3d']);
    assert.deepEqual(saved.qty, { '12031189': 168 });
  });

  test('logout: POST /v1/auth/logout e recarrega a página (mesmo se a chamada falhar)', async () => {
    const t = serverEnv([(c) => (json(c, 'POST', '/v1/auth/logout') ? { status: 204 } : undefined)]);
    let reloads = 0;
    t.PSF.reload = () => { reloads++; };
    await t.PSF.logout();
    assert.deepEqual(t.calls.map((c) => [c.method, c.url, c.headers['content-type']]), [['POST', '/v1/auth/logout', 'application/json']]);
    assert.deepEqual(t.calls[0].body, {});
    assert.equal(reloads, 1);
    const off = serverEnv([(c) => (c.url === '/v1/auth/logout' ? { status: 500, body: errorBody('INTERNAL', 'x') } : undefined)]);
    off.PSF.reload = () => { reloads++; };
    await off.PSF.logout();
    assert.equal(reloads, 2);
  });

  test('who: no servidor, nome e papel do usuário da sessão; sem sessão, os padrões do demo', () => {
    const t = serverEnv([]);
    assert.deepEqual(plain(t.PSF.who('Lucas', 'Analista de Exportação')), { name: 'Lucas', role: 'Analista de Exportação' });
    (t.PSF as any).me = { area: 'backoffice', user: { id: 4, displayName: 'Ana (Exportação)', role: 'int_exportacao' } };
    assert.deepEqual(plain(t.PSF.who('Lucas', 'Analista de Exportação')), { name: 'Ana', role: 'Exportação 3corações' });
    (t.PSF as any).me = { area: 'backoffice', user: { id: 5, displayName: 'Administração de dados', role: 'int_admin' } };
    assert.deepEqual(plain(t.PSF.who('Lucas', 'x')), { name: 'Administração de dados', role: 'Dados e usuários' });
  });
});
