// O index.html no modo servidor contra a API de verdade (Hono em processo, PGlite com o seed): os arquivos como o servidor
// os entrega (/, /demo-data.js e /api-client.js), fetch do navegador com cookie e Sec-Fetch-Site. Automatiza, no nível dos
// dados da tela, os passos 1 a 6 do roteiro manual do 05 ("Aceite"); o que é visual fica para a S8.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '#server/ports/db.ts';
import { PASSWORD, seededDb, setCookie, testApp, type TestApp } from '../../server/test/helpers/api.ts';
import { openPage, type Page } from './page.ts';
import { plain } from './helpers.ts';

let db: Db;
let t: TestApp;
let sources: { html: string; demoData: string; apiClient: string };
before(async () => {
  db = await seededDb();
  t = testApp(db);
  const text = async (p: string) => { const r = await t.app.request(p); assert.equal(r.status, 200, p); return r.text(); };
  sources = { html: await text('/'), demoData: await text('/demo-data.js'), apiClient: await text('/api-client.js') };
});
after(async () => { await db.close(); });

// Uma aba do navegador: cookie psf_session próprio (HttpOnly: o script não lê, só o fetch manda).
class Tab {
  cookie = '';
  page!: Page;
  requests: string[] = [];
  fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost:3000');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers as Record<string, string>);
    if (this.cookie) headers.set('cookie', this.cookie);
    if (method !== 'GET' && method !== 'HEAD') headers.set('sec-fetch-site', 'same-origin');
    this.requests.push(`${method} ${url.pathname}${url.search}`);
    const res = await t.app.request(url.pathname + url.search, { method, headers, body: init.body as string | undefined });
    const c = setCookie(res);
    if (c?.name === 'psf_session') this.cookie = c.attrs.get('max-age') === '0' ? '' : `psf_session=${c.value}`;
    return res;
  };
  // Abre (ou recarrega) a página: memória nova, mesmo cookie e mesmo localStorage.
  async open(storage?: Record<string, string>) {
    if (this.page) await this.page.close();
    this.page = openPage({ demo: false, fetch: this.fetch, sources, storage });
    this.page.run('PSF.reload=()=>{window.__reloads=(window.__reloads||0)+1}');
    await this.page.until('S.view==="entry" || S.area!==null');
    await this.page.settle();
    return this.page;
  }
  async login(username: string) {
    await this.page.run<Promise<unknown>>(`PSF.login(${JSON.stringify(username)}, ${JSON.stringify(PASSWORD)})`);
    await this.page.settle();
  }
  json<T = any>(expr: string): T { return plain(this.page.run<T>(expr)); }
  async close() { if (this.page) await this.page.close(); }
}

const ORDER_TEST = { '12031189': 3528, '12034103': 300, '12037417': 250, '12144012': 300 };
const tabs: Tab[] = [];
const newTab = () => { const tab = new Tab(); tabs.push(tab); return tab; };
after(async () => { for (const tab of tabs) await tab.close(); });

describe('modo servidor (index.html + api-client.js + API)', () => {
  test('sem sessão: modo server, /demo-data.js é o stub, nada do demo na memória e a tela de acesso aparece sem erro', async () => {
    const tab = newTab();
    const page = await tab.open();
    assert.equal(sources.demoData, 'window.PSF_DEMO = null;');
    assert.equal(page.run('PSF.mode'), 'server');
    assert.deepEqual(tab.requests, ['GET /v1/auth/me']);
    assert.deepEqual([page.run('S.area'), page.run('S.view'), page.run('P.length'), page.run('Object.keys(CLIENTS).length'), page.run('S.orders.length')], [null, 'entry', 0, 0, 0]);
    await page.click('[data-enter="client"]');
    assert.equal(page.run('S.area'), null, 'os botões de perfil do demo não entram no modo servidor (o formulário é da S8)');
    assert.deepEqual(page.errors, []);
  });

  test('passo 1: Martín entra, catálogo da lista US com 98 cx/pallet no 12034109, envia um pedido e ele continua depois de recarregar', async () => {
    const tab = newTab();
    let page = await tab.open();
    await tab.login('martin.minoil');
    assert.deepEqual([page.run('S.area'), page.run('S.view'), page.run('S.client'), page.run('S.lang')], ['client', 'home', 'minoil', 'pt']);
    assert.equal(page.run('P.length'), 10);
    assert.equal(page.run('BY["12034109"].cxPal'), 98);
    assert.equal(page.run('BY["20908885"].cxPal'), 77);
    assert.equal(page.run('BY["12031189"].price'), 49.41);
    assert.deepEqual(tab.json('[RULES.fullAt, RULES.leadDays, RULES.minLotBlock, RULES.fullPalBlock]'), [0.9, 7, true, false]);
    assert.deepEqual(tab.json('Object.keys(CLIENTS)'), ['minoil']);
    assert.deepEqual(tab.json('S.orders.map(o=>o.id)'), ['3CC-2026-0002', '3CC-2026-0001']);
    const memory = page.run<string>('JSON.stringify({P, CLIENTS, orders: S.orders})');
    for (const s of ['rioclaro', 'Río Claro', 'Sofía', '11999', '"ob"', '"prices"', 'DEMO_DERIVED', 'SITE_3C']) assert.ok(!memory.includes(s), s);
    assert.match(page.window.document.getElementById('topbar')!.textContent ?? '', /Martín/);

    // "Faltam N cx" na prévia local (calc do HTML) e envio pela revisão.
    page.run('S.view="dist"; S.veh="carreta"; S.mode="pal"; S.qty={"12031189":2352,"12142501":1400}; render()');
    assert.equal(page.run('calc(S.qty, draft()).lines.find(l=>l.p.code==="12031189").missing'), 0);
    page.run('S.qty={"12031189":2300,"12142501":1400}; render()');
    assert.equal(page.run('calc(S.qty, draft()).lines.find(l=>l.p.code==="12031189").missing'), 52, 'faltam 52 cx para fechar o pallet');
    page.run('S.qty={"12031189":2352,"12142501":1400}; render(); openReview()');
    await page.click('#confirmBtn');
    await page.until('S.orders.length===3');
    const created = tab.json('S.orders[0]');
    assert.match(created.id, /^3CC-2026-\d{4}$/);
    assert.deepEqual([created.status, created.origin, created.client, created.qty], ['analise', 'Portal', 'minoil', { '12031189': 2352, '12142501': 1400 }]);
    assert.ok(tab.requests.includes('POST /v1/portal/orders'));
    assert.deepEqual(page.errors, []);

    page.run('S.lang="es"; render()');
    const storage = page.storage();
    const key = Object.keys(storage).find((k) => k.startsWith('3cc-srv-v1:'))!;
    assert.ok(key, 'preferências por usuário');
    assert.ok(!storage[key].includes('3CC-2026'), 'nada de pedidos no localStorage');
    page = await tab.open(storage);
    await page.until('S.area==="client"');
    assert.ok(tab.json<string[]>('S.orders.map(o=>o.id)').includes(created.id), 'recarregou e o pedido continua em Meus pedidos');
    assert.equal(page.run('S.lang'), 'es', 'preferência de idioma restaurada');
    page.run('S.view="myorders"; render()');
    assert.match(page.window.document.getElementById('v-myorders')!.textContent ?? '', new RegExp(created.id));
    assert.deepEqual(page.errors, []);
  });

  test('passo 2: Martín pede o pedido da Río Claro → 404 (controle: o próprio 0001 → 200)', async () => {
    const tab = newTab();
    const page = await tab.open();
    await tab.login('martin.minoil');
    const own = await page.run<Promise<{ id: string }>>('PSF.request("GET","/v1/portal/orders/3CC-2026-0001")');
    assert.equal(own.id, '3CC-2026-0001');
    await assert.rejects(page.run<Promise<unknown>>('PSF.request("GET","/v1/portal/orders/3CC-2026-0003")'), (e: { status: number }) => e.status === 404);
  });

  test('passo 3: Martín sai (logout recarrega) e Sofía entra na mesma aba com o cliente e o idioma dela', async () => {
    const tab = newTab();
    let page = await tab.open();
    await tab.login('martin.minoil');
    await page.click('[data-logout]');
    await page.until('window.__reloads===1');
    assert.equal(tab.cookie, '', 'cookie apagado');
    assert.ok(tab.requests.includes('POST /v1/auth/logout'));
    page = await tab.open(page.storage());
    assert.equal(page.run('S.view'), 'entry', 'depois de recarregar, sem sessão');
    await tab.login('sofia.rioclaro');
    assert.deepEqual([page.run('S.area'), page.run('S.client'), page.run('S.lang')], ['client', 'rioclaro', 'es']);
    assert.deepEqual(tab.json('Object.keys(CLIENTS)'), ['rioclaro']);
    assert.deepEqual(tab.json('S.orders.map(o=>o.id)'), ['3CC-2026-0003']);
    assert.match(page.window.document.getElementById('topbar')!.textContent ?? '', /Sofía/);
    page.run('S.view="myorders"; render(); S.view="dist"; render()');
    const memory = page.run<string>('JSON.stringify({P, CLIENTS, orders: S.orders})');
    for (const s of ['minoil', 'MINOIL', 'Martín', '11131']) assert.ok(!memory.includes(s), s);
    assert.equal(page.run('BY["12031189"].price'), 52.37, 'lista AR');
    assert.deepEqual(page.errors, []);
  });

  test('passo 4: Lucas vê o 0001 com 30 posições para 28, reduz o 12031189 para 3192 cx (v2, 28 de 28) e não pode aprovar', async () => {
    const tab = newTab();
    const page = await tab.open();
    await tab.login('lucas.exportacao');
    assert.deepEqual([page.run('S.area'), page.run('S.view')], ['admin', 'exp']);
    assert.deepEqual(tab.json('Object.keys(CLIENTS)'), ['minoil', 'rioclaro']);
    assert.equal(page.run('BY["12034109"].priceSrc'), 'site');
    assert.deepEqual(tab.json('BY["12031189"].prices'), { AR: 52.37, US: 49.41 });
    assert.equal(page.run('BY["12031189"].ob.cxPal'), 168);
    assert.match(page.window.document.getElementById('side')!.textContent ?? '', /Lucas/);
    const o1 = () => tab.json('API.get("3CC-2026-0001")');
    assert.deepEqual([o1().v, o1().origin, o1().perm.canEdit, o1().perm.canApprove], [1, 'Order Basis', true, false]);
    assert.equal(page.run('(o=>calc(o.qty,o).tot.positions)(API.get("3CC-2026-0001"))'), 30);

    page.run('S.sel="3CC-2026-0001"; render()');
    await page.change('[data-edit="12031189"]', '3192');
    await page.until('API.get("3CC-2026-0001").v===2');
    assert.equal(o1().qty['12031189'], 3192);
    assert.match(o1().audit.at(-1).what, /^Alterou 12031189 .* de 3\.528 para 3\.192 cx$/);
    assert.equal(o1().audit.at(-1).who, 'Lucas (Exportação)');
    assert.equal(page.run('(o=>calc(o.qty,o).tot.positions)(API.get("3CC-2026-0001"))'), 28);
    assert.equal(o1().perm.canApprove, false);

    page.run('render()');
    await page.click('[data-approve]');
    await page.until('document.getElementById("toasts").textContent.includes("não pode aprová-lo")');
    assert.equal(o1().status, 'analise');
    await assert.rejects(page.run<Promise<unknown>>('API.exportSap("3CC-2026-0001")'), (e: { message: string }) => e.message === 'Exportação para o SAP: próxima fase');
    assert.deepEqual(page.errors, []);
  });

  test('passo 5: Ana aprova o 0001; a trilha mostra a importação da OB, o ajuste de Lucas e a aprovação de Ana', async () => {
    const tab = newTab();
    const page = await tab.open();
    await tab.login('ana.exportacao');
    assert.equal(page.run('API.get("3CC-2026-0001").perm.canApprove'), true);
    page.run('S.sel="3CC-2026-0001"; render()');
    await page.click('[data-approve]');
    await page.until('API.get("3CC-2026-0001").status==="aprovado"');
    const audit = tab.json<{ who: string; what: string }[]>('API.get("3CC-2026-0001").audit');
    assert.deepEqual(audit.map((a) => a.who), ['Lucas (Exportação)', 'Lucas (Exportação)', 'Ana (Exportação)']);
    assert.equal(audit[0].what, 'Pedido importado da planilha Order Basis');
    assert.match(audit[1].what, /^Alterou 12031189/);
    assert.equal(audit[2].what, 'Pedido aprovado após 1 ajuste');
    assert.deepEqual(page.errors, []);
  });

  test('passo 6: Ana liga pallet misto para a MINOIL; Martín recarrega e, com o pedido-teste no carrinho, vê 29 posições', async () => {
    const ana = newTab();
    const page = await ana.open();
    await ana.login('ana.exportacao');
    page.run('S.view="clients"; S.csel="minoil"; render()');
    await page.change('[data-mixclient="minoil"]', true);
    await page.until('CLIENTS.minoil.mixed===true && RLOG.length===1');
    assert.equal(page.run('RLOG[0].who'), 'Ana (Exportação)');
    assert.match(page.run<string>('RLOG[0].what'), /MINOIL S\.A\.: pallet misto liberado/);
    assert.deepEqual(page.errors, []);

    const martin = newTab();
    const mp = await martin.open();
    await martin.login('martin.minoil');
    mp.run(`S.qty=${JSON.stringify(ORDER_TEST)}; S.veh="carreta"; S.mode="pal"; render()`);
    assert.equal(mp.run('CLIENTS.minoil.mixed'), true);
    assert.equal(mp.run('calc(S.qty, draft()).tot.positions'), 29);
    assert.deepEqual(mp.errors, []);
  });

  test('admin.dados: lê tudo, sem editar nem aprovar; a lateral mostra o papel da sessão', async () => {
    const tab = newTab();
    const page = await tab.open();
    await tab.login('admin.dados');
    assert.equal(page.run('S.area'), 'admin');
    assert.ok(page.run<number>('S.orders.length') >= 3);
    assert.deepEqual(tab.json('S.orders.map(o=>o.perm.canEdit||o.perm.canApprove)').filter(Boolean), []);
    assert.match(page.window.document.getElementById('side')!.textContent ?? '', /Dados e usuários/);
    await assert.rejects(page.run<Promise<unknown>>('API.updateItem(S.orders[0].id,"12031189",1)'), (e: { status: number }) => e.status === 403);
    assert.deepEqual(page.errors, []);
  });
});
