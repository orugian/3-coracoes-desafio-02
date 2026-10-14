// Fumaça do modo demo (docs/specs/05-integracao-web.md, "Aceite"): o index.html com demo-data.js e api-client.js, como
// abre por file:// ou pelo GitHub Pages. É o que garante o plano B sem teste manual: criar um pedido, ajustar um item do
// 3CC-2026-0001, aprovar um pedido sem bloqueio e gerar o CSV, conferindo S.orders depois de cada passo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, type Page } from './page.ts';
import { plain } from './helpers.ts';

let page: Page;
before(() => { page = openPage({ demo: true }); });
after(async () => { await page.close(); });

const orders = () => plain(page.run<{ id: string; status: string; v?: number; qty: Record<string, number>; audit: { what: string }[] }[]>('S.orders'));
const order = (id: string) => orders().find((o) => o.id === id)!;

describe('modo demo (file://)', () => {
  test('modo demo, com os dados do demo-data.js: catálogo com EXTRA, dois clientes e os três pedidos de exemplo', () => {
    assert.equal(page.run('PSF.mode'), 'demo');
    assert.equal(page.run('P.length'), 10);
    assert.equal(page.run('BY["12031189"].ean'), '7896005800362');
    assert.equal(page.run('BY["12031189"].cxPal'), 168, 'campos derivados recalculados no HTML');
    assert.equal(page.run('BY["12034109"].ob.cxPal'), 98);
    assert.deepEqual(page.run('Object.keys(CLIENTS).join()'), 'minoil,rioclaro');
    assert.deepEqual(orders().map((o) => o.id), ['3CC-2026-0001', '3CC-2026-0002', '3CC-2026-0003']);
    assert.equal(page.run('S.client'), 'minoil');
    assert.equal(page.run('S.view'), 'entry');
    assert.ok(page.window.document.querySelector('[data-enter="client"]'), 'tela de acesso por perfil, como o piloto');
    assert.deepEqual(page.errors, []);
  });

  test('entra como cliente e cria um pedido pela revisão (confirmOrder com await)', async () => {
    await page.click('[data-enter="client"]');
    assert.deepEqual([page.run('S.area'), page.run('S.view')], ['client', 'home']);
    page.run('S.view="dist"; S.client="minoil"; S.veh="carreta"; S.mode="pal"; S.qty={"12031189":2352,"12142501":1400}; render(); openReview()');
    (page.window.document.getElementById('rvRef') as unknown as { value: string }).value = 'TESTE-DEMO';
    await page.click('#confirmBtn');
    const o = orders()[0];
    assert.equal(o.id, '3CC-2026-0004');
    assert.equal(o.status, 'analise');
    assert.deepEqual(o.qty, { '12031189': 2352, '12142501': 1400 });
    assert.equal(page.run('S.orders[0].ref'), 'TESTE-DEMO');
    assert.match(page.window.document.getElementById('okT')!.textContent ?? '', /3CC-2026-0004/, 'tela de sucesso');
    assert.equal(orders().length, 4);
    assert.deepEqual(page.errors, []);
  });

  test('createOrder pela fachada: Promise; pedido com bloqueio é recusado (controle: o válido acima entrou)', async () => {
    const r = page.run<Promise<unknown>>('API.createOrder({client:"rioclaro",veh:"c40",mode:"pal",mixed:false,qty:{"20908885":110,"12142501":560}},{draftId:"d-bloq-0001",ref:"",date:""})');
    await assert.rejects(r, (e: { status: number }) => e.status === 422);
    assert.equal(orders().length, 4, 'nada gravado');
  });

  test('o 3CC-2026-0001 com 30 posições para 28 não pode ser aprovado (controle negativo da aprovação)', async () => {
    await assert.rejects(page.run<Promise<unknown>>('API.approve("3CC-2026-0001")'), (e: { status: number }) => e.status === 409);
    assert.equal(order('3CC-2026-0001').status, 'analise');
  });

  test('no painel, ajusta o 12031189 do 3CC-2026-0001 para 3192 cx (tratador de change com await)', async () => {
    page.run('S.area="admin"; S.view="exp"; S.sel="3CC-2026-0001"; render()');
    await page.change('[data-edit="12031189"]', '3192');
    const o = order('3CC-2026-0001');
    assert.equal(o.qty['12031189'], 3192);
    assert.equal(o.v, 2);
    assert.match(o.audit.at(-1)!.what, /^Alterou 12031189 .* de 3\.528 para 3\.192 cx$/);
    assert.equal(page.run('calc(S.orders.find(o=>o.id==="3CC-2026-0001").qty, S.orders.find(o=>o.id==="3CC-2026-0001")).tot.positions'), 28);
    assert.deepEqual(page.errors, []);
  });

  test('aprova o 3CC-2026-0001 pelo botão (sem bloqueio) e gera o CSV para o SAP', async () => {
    page.run('render()');
    await page.click('[data-approve]');
    assert.equal(order('3CC-2026-0001').status, 'aprovado');
    await page.click('[data-csv]');
    assert.equal(order('3CC-2026-0001').status, 'sap');
    assert.equal(page.run('S.csvFor'), '3CC-2026-0001');
    const csv = page.window.document.getElementById('csvBox')?.textContent ?? '';
    assert.match(csv, /12031189/);
    assert.match(csv, /3192/);
    assert.deepEqual(page.errors, []);
  });

  test('regras do cliente pelo painel (setClientRule com await) e saída sem servidor', async () => {
    page.run('S.view="clients"; S.csel="minoil"; render()');
    const box = page.window.document.querySelector('[data-mixclient="minoil"]');
    assert.ok(box, 'interruptor de pallet misto');
    await page.change('[data-mixclient="minoil"]', true);
    assert.equal(page.run('CLIENTS.minoil.mixed'), true);
    assert.match(page.run<string>('RLOG[0].what'), /MINOIL S\.A\.: pallet misto liberado/);
    await page.click('[data-logout]');
    assert.deepEqual([page.run('S.area'), page.run('S.view')], [null, 'entry']);
    assert.deepEqual(page.errors, []);
  });
});
