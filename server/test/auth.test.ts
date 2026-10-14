// Autenticação, sessão, pipeline e estáticos (docs/specs/04-api.md, "Pipeline", "Sessão" e "Testes do servidor", itens 5 a 8).
// Cada negação tem o seu controle positivo na mesma rota.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { decode, sign } from 'hono/jwt';
import { ApiErrorBody, Me } from '#contracts';
import type { Db } from '#server/ports/db.ts';
import { unlockUser } from '#server/repo/users.ts';
import { Client, ORIGIN, PASSWORD, SECRET, call, createUser, errorCode, seededDb, setCookie, testApp, type TestApp } from './helpers/api.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EIGHT_HOURS = 8 * 60 * 60;

let db: Db;
let t: TestApp;
before(async () => {
  db = await seededDb();
  t = testApp(db);
});
after(async () => { await db.close(); });

const userId = async (username: string) =>
  (await db.query<{ id: number }>('select id from app_user where username = $1', [username])).rows[0].id;
const login = (username: string, password: string, opts = {}) => call(t.app, 'POST', '/v1/auth/login', null, { body: { username, password }, ...opts });

describe('sessão (item 5)', () => {
  test('login correto: 200 com Me e cookie psf_session HttpOnly, SameSite=Strict, Path=/, Max-Age de 8 h, sem Secure', async () => {
    const res = await login('martin.minoil', PASSWORD);
    assert.equal(res.status, 200);
    const me = Me.parse(await res.json());
    assert.equal(me.user.username, 'martin.minoil');
    assert.equal(me.user.displayName, 'Martín (MINOIL S.A.)');
    assert.equal(me.user.role, 'ext_distribuidor');
    assert.equal(me.area, 'portal');
    assert.deepEqual(me.customers.map((c) => [c.code, c.slug, c.priceList, c.plant, c.plantName, c.contactName]),
      [['11131', 'minoil', 'US', '2612', 'CD Londrina', 'Martín']]);

    const cookie = setCookie(res);
    assert.ok(cookie);
    assert.equal(cookie.name, 'psf_session');
    assert.ok(cookie.attrs.has('httponly'));
    assert.equal(cookie.attrs.get('samesite'), 'Strict');
    assert.equal(cookie.attrs.get('path'), '/');
    assert.equal(cookie.attrs.get('max-age'), String(EIGHT_HOURS));
    assert.ok(!cookie.attrs.has('secure'), 'sem COOKIE_SECURE');

    // Token HS256 com as claims que o Cognito vai emitir (sub, role) e o id da sessão.
    const { header, payload } = decode(cookie.value);
    assert.equal(header.alg, 'HS256');
    assert.equal(payload.sub, String(me.user.id));
    assert.equal(payload.role, 'ext_distribuidor');
    assert.equal(Number(payload.exp) - Number(payload.iat), EIGHT_HOURS);
    const { rows: [session] } = await db.query<{ user_id: number; expires_at: Date; created_at: Date; revoked_at: Date | null }>(
      'select user_id, expires_at, created_at, revoked_at from app_session where id = $1', [payload.sid]);
    assert.equal(session.user_id, me.user.id);
    assert.equal(session.revoked_at, null);
    assert.ok(Math.abs((session.expires_at.getTime() - session.created_at.getTime()) / 1000 - EIGHT_HOURS) < 5);
    assert.equal(Buffer.from(String(payload.sid), 'base64url').length, 32, 'id aleatório de 32 bytes');
  });

  test('COOKIE_SECURE acrescenta Secure ao cookie', async () => {
    const secure = testApp(db, { cookieSecure: true });
    const res = await call(secure.app, 'POST', '/v1/auth/login', null, { body: { username: 'lucas.exportacao', password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.ok(setCookie(res)?.attrs.has('secure'));
  });

  test('GET /v1/auth/me: com sessão devolve Me (backoffice sem clientes); sem cookie, 401 UNAUTHENTICATED', async () => {
    const lucas = await Client.login(t.app, 'lucas.exportacao');
    const res = await lucas.get('/v1/auth/me');
    assert.equal(res.status, 200);
    const me = Me.parse(await res.json());
    assert.deepEqual([me.user.role, me.area, me.customers], ['int_exportacao', 'backoffice', []]);

    const anon = await call(t.app, 'GET', '/v1/auth/me', null);
    assert.equal(anon.status, 401);
    assert.equal(ApiErrorBody.parse(await anon.json()).error.code, 'UNAUTHENTICATED');
  });

  test('logout: 204, cookie apagado, sessão revogada; o mesmo cookie depois → 401', async () => {
    const ana = await Client.login(t.app, 'ana.exportacao');
    const cookie = ana.cookie;
    assert.equal((await ana.get('/v1/auth/me')).status, 200, 'controle');
    const out = await ana.post('/v1/auth/logout');
    assert.equal(out.status, 204);
    assert.equal(setCookie(out)?.attrs.get('max-age'), '0', 'cookie apagado');
    const sid = decode(String(cookie).slice('psf_session='.length)).payload.sid;
    const { rows: [s] } = await db.query<{ revoked_at: Date | null }>('select revoked_at from app_session where id = $1', [sid]);
    assert.ok(s.revoked_at instanceof Date);

    const again = await call(t.app, 'GET', '/v1/auth/me', cookie);
    assert.equal(again.status, 401);
    assert.equal(await errorCode(again), 'UNAUTHENTICATED');
    assert.equal(setCookie(again)?.attrs.get('max-age'), '0', 'cookie apagado na falha');
  });

  test('sessão expirada no banco → 401 e cookie apagado', async () => {
    const sofia = await Client.login(t.app, 'sofia.rioclaro');
    assert.equal((await sofia.get('/v1/auth/me')).status, 200, 'controle');
    const sid = decode(String(sofia.cookie).slice('psf_session='.length)).payload.sid;
    await db.query(`update app_session set expires_at = now() - interval '1 second' where id = $1`, [sid]);
    const cookie = sofia.cookie;
    const res = await call(t.app, 'GET', '/v1/auth/me', cookie);
    assert.equal(res.status, 401);
    assert.equal(setCookie(res)?.attrs.get('max-age'), '0');
  });

  test('token de outro segredo, sem assinatura (alg none), expirado, de sessão inexistente ou com sub trocado → 401', async () => {
    const martin = await Client.login(t.app, 'martin.minoil');
    assert.equal((await martin.get('/v1/auth/me')).status, 200, 'controle');
    const { payload } = decode(String(martin.cookie).slice('psf_session='.length));
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const tokens = {
      outroSegredo: await sign(payload, 'outro-segredo-qualquer-com-mais-de-32-bytes', 'HS256'),
      algNone: `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`,
      expirado: await sign({ ...payload, iat: now - 2 * EIGHT_HOURS, exp: now - EIGHT_HOURS }, SECRET, 'HS256'),
      sessaoInexistente: await sign({ ...payload, sid: 'nao-existe' }, SECRET, 'HS256'),
      subTrocado: await sign({ ...payload, sub: String(await userId('lucas.exportacao')), role: 'int_exportacao' }, SECRET, 'HS256'),
      lixo: 'abc.def.ghi',
    };
    for (const [name, token] of Object.entries(tokens)) {
      const res = await call(t.app, 'GET', '/v1/auth/me', `psf_session=${token}`);
      assert.equal(res.status, 401, name);
    }
    assert.equal((await martin.get('/v1/auth/me')).status, 200, 'a sessão verdadeira continua valendo');
  });

  test('usuário desativado no banco com sessão aberta → 401 na próxima requisição e login recusado', async () => {
    await createUser(db, 'teste.desativado', 'ext_distribuidor', ['11131']);
    const u = await Client.login(t.app, 'teste.desativado');
    assert.equal((await u.get('/v1/auth/me')).status, 200, 'controle');
    await db.query(`update app_user set active = false where username = 'teste.desativado'`);
    assert.equal((await u.get('/v1/auth/me')).status, 401);
    const again = await login('teste.desativado', PASSWORD);
    assert.equal(again.status, 401);
    assert.equal(await errorCode(again), 'LOGIN_FAILED');
  });

  test('papel e escopo relidos do banco a cada requisição (D12)', async () => {
    const id = await createUser(db, 'teste.papel', 'ext_distribuidor', ['11131']);
    const u = await Client.login(t.app, 'teste.papel');
    let me = Me.parse(await (await u.get('/v1/auth/me')).json());
    assert.deepEqual([me.area, me.customers.map((c) => c.code)], ['portal', ['11131']]);
    assert.notEqual((await u.get('/v1/portal/catalog')).status, 403, 'controle: distribuidor passa a guarda do portal');
    assert.equal((await u.get('/v1/backoffice/orders')).status, 403);

    await db.query(`update app_user set role = 'int_exportacao' where id = $1`, [id]);
    me = Me.parse(await (await u.get('/v1/auth/me')).json());
    assert.deepEqual([me.user.role, me.area, me.customers], ['int_exportacao', 'backoffice', []]);
    assert.equal((await u.get('/v1/portal/catalog')).status, 403, 'o token ainda diz ext_distribuidor, o banco não');
    assert.notEqual((await u.get('/v1/backoffice/orders')).status, 403);

    await db.query(`update app_user set role = 'ext_distribuidor' where id = $1`, [id]);
    await db.query(`insert into user_customer_scope (user_id, customer_code) values ($1, '11999')`, [id]);
    me = Me.parse(await (await u.get('/v1/auth/me')).json());
    assert.deepEqual(me.customers.map((c) => c.code), ['11131', '11999']);
  });

  test('guardas por prefixo: distribuidor fora do backoffice, interno fora do portal; sem sessão, 401 antes da guarda', async () => {
    const martin = await Client.login(t.app, 'martin.minoil');
    const lucas = await Client.login(t.app, 'lucas.exportacao');
    const admin = await Client.login(t.app, 'admin.dados');
    const forbidden = async (c: Client, p: string) => {
      const res = await c.get(p);
      assert.equal(res.status, 403, `${p}`);
      assert.equal(await errorCode(res), 'FORBIDDEN');
    };
    await forbidden(martin, '/v1/backoffice/orders');
    await forbidden(martin, '/v1/backoffice/qualquer-coisa');
    await forbidden(lucas, '/v1/portal/catalog');
    await forbidden(admin, '/v1/portal/catalog');
    assert.notEqual((await martin.get('/v1/portal/catalog')).status, 403, 'controle');
    assert.notEqual((await lucas.get('/v1/backoffice/orders')).status, 403, 'controle');
    assert.notEqual((await admin.get('/v1/backoffice/products')).status, 403, 'controle');
    for (const p of ['/v1/portal/catalog', '/v1/backoffice/orders', '/v1/nao-existe']) {
      assert.equal((await call(t.app, 'GET', p, null)).status, 401, `${p} sem sessão`);
    }
    const unknown = await lucas.get('/v1/nao-existe');
    assert.equal(unknown.status, 404);
    assert.equal(ApiErrorBody.parse(await unknown.json()).error.code, 'NOT_FOUND');
  });
});

describe('bloqueio de login (item 6)', () => {
  const state = async (username: string) => (await db.query<{ failed_logins: number; locked_until: Date | null }>(
    'select failed_logins, locked_until from app_user where username = $1', [username])).rows[0];

  test('cinco senhas erradas bloqueiam por 15 min; a correta depois → 401 com o corpo de usuário inexistente e de senha errada', async () => {
    await createUser(db, 'teste.bloqueio', 'ext_distribuidor', ['11131']);
    const bodies: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await login('teste.bloqueio', 'senha-errada');
      assert.equal(res.status, 401);
      assert.equal(setCookie(res), null);
      bodies.push(await res.text());
    }
    const s = await state('teste.bloqueio');
    assert.equal(s.failed_logins, 5);
    assert.ok(s.locked_until instanceof Date);
    const minutes = (s.locked_until.getTime() - Date.now()) / 60000;
    assert.ok(minutes > 14.5 && minutes <= 15, `bloqueado por ${minutes} min`);

    const locked = await login('teste.bloqueio', PASSWORD);
    assert.equal(locked.status, 401);
    assert.equal(setCookie(locked), null);
    const lockedBody = await locked.text();
    const unknown = await login('nao.existe', 'qualquer');
    assert.equal(unknown.status, 401);
    const unknownBody = await unknown.text();
    assert.equal(lockedBody, bodies[0]);
    assert.equal(unknownBody, bodies[0]);
    assert.equal(ApiErrorBody.parse(JSON.parse(lockedBody)).error.code, 'LOGIN_FAILED');
    assert.ok(t.logs.some((l) => /bloquead/i.test(l)), 'o bloqueio fica no log');
    assert.equal((await state('teste.bloqueio')).failed_logins, 5, 'tentativa durante o bloqueio não prolonga nem conta');
  });

  test('com locked_until vencido, a senha correta entra e zera o contador', async () => {
    await db.query(`update app_user set locked_until = now() - interval '1 minute' where username = 'teste.bloqueio'`);
    const res = await login('teste.bloqueio', PASSWORD);
    assert.equal(res.status, 200);
    assert.deepEqual(await state('teste.bloqueio'), { failed_logins: 0, locked_until: null });
  });

  test('controle: quatro erros e a correta entram (o bloqueio é no quinto) e zeram o contador', async () => {
    for (let i = 0; i < 4; i++) assert.equal((await login('teste.bloqueio', 'senha-errada')).status, 401);
    assert.equal((await state('teste.bloqueio')).failed_logins, 4);
    assert.equal((await login('teste.bloqueio', PASSWORD)).status, 200);
    assert.deepEqual(await state('teste.bloqueio'), { failed_logins: 0, locked_until: null });
  });

  test('depois de um bloqueio vencido, o contador recomeça do zero na próxima tentativa', async () => {
    await db.query(`update app_user set failed_logins = 5, locked_until = now() - interval '1 minute' where username = 'teste.bloqueio'`);
    assert.equal((await login('teste.bloqueio', 'senha-errada')).status, 401);
    assert.deepEqual(await state('teste.bloqueio'), { failed_logins: 1, locked_until: null });
  });

  test('rajada simultânea: o bloqueio para no 5º erro, não prolonga, e a senha certa no fim da rajada não o apaga', async () => {
    await createUser(db, 'teste.rajada', 'ext_distribuidor', ['11131']);
    // A certa vai por último: o scrypt dela termina depois dos erros, como na tentativa de força bruta em paralelo.
    const attempts = [...Array.from({ length: 30 }, () => login('teste.rajada', 'senha-errada')), login('teste.rajada', PASSWORD)];
    const statuses = (await Promise.all(attempts)).map((r) => r.status);
    assert.deepEqual([...new Set(statuses)], [401]);
    const s = await state('teste.rajada');
    assert.equal(s.failed_logins, 5, 'erros durante o bloqueio não contam');
    assert.ok(s.locked_until instanceof Date && s.locked_until.getTime() > Date.now());
    // Nova rajada durante o bloqueio: o locked_until não muda.
    await Promise.all(Array.from({ length: 5 }, () => login('teste.rajada', 'senha-errada')));
    assert.deepEqual(await state('teste.rajada'), s, 'não prolonga');
    // Bloqueio vencido + rajada: recomeça do zero e bloqueia de novo no 5º.
    await db.query(`update app_user set locked_until = now() - interval '1 minute' where username = 'teste.rajada'`);
    await Promise.all(Array.from({ length: 10 }, () => login('teste.rajada', 'senha-errada')));
    const again = await state('teste.rajada');
    assert.equal(again.failed_logins, 5);
    assert.ok(again.locked_until instanceof Date && again.locked_until.getTime() > Date.now());
  });

  test('unlockUser (npm run user:unlock) zera o contador e o bloqueio', async () => {
    for (let i = 0; i < 5; i++) await login('teste.bloqueio', 'senha-errada');
    assert.equal((await login('teste.bloqueio', PASSWORD)).status, 401, 'bloqueado');
    assert.equal(await unlockUser(db, 'teste.bloqueio'), true);
    assert.deepEqual(await state('teste.bloqueio'), { failed_logins: 0, locked_until: null });
    assert.equal((await login('teste.bloqueio', PASSWORD)).status, 200);
    assert.equal(await unlockUser(db, 'nao.existe'), false);
  });

  test('corpo fora do contrato → 422 VALIDATION_FAILED', async () => {
    for (const body of [{ username: 'martin.minoil' }, { username: '', password: 'x' }, { username: 1, password: 2 }]) {
      const res = await call(t.app, 'POST', '/v1/auth/login', null, { body });
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(await errorCode(res), 'VALIDATION_FAILED');
    }
    const notJson = await call(t.app, 'POST', '/v1/auth/login', null, { rawBody: '{"username":' });
    assert.equal(notJson.status, 422);
  });
});

describe('pipeline (item 7)', () => {
  const body = { username: 'martin.minoil', password: PASSWORD };

  test('POST com corpo JSON e Content-Type text/plain → 415, mesmo vindo da mesma origem', async () => {
    const res = await call(t.app, 'POST', '/v1/auth/login', null, { body, headers: { 'content-type': 'text/plain' } });
    assert.equal(res.status, 415);
    assert.equal(await errorCode(res), 'UNSUPPORTED_MEDIA_TYPE');
    const form = await call(t.app, 'POST', '/v1/auth/login', null, { rawBody: 'username=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    const ok = await call(t.app, 'POST', '/v1/auth/login', null, { body, headers: { 'content-type': 'application/json; charset=utf-8' } });
    assert.equal(ok.status, 200, 'controle: application/json com charset');
  });

  test('origem: Sec-Fetch-Site cross-site ou same-site → 403; Origin de outro site sem Sec-Fetch-Site → 403; sem os dois → 403', async () => {
    const json = { 'content-type': 'application/json' };
    const cases: [string, Record<string, string>][] = [
      ['cross-site', { ...json, 'sec-fetch-site': 'cross-site' }],
      ['same-site', { ...json, 'sec-fetch-site': 'same-site' }],
      ['cross-site com Origin igual', { ...json, 'sec-fetch-site': 'cross-site', origin: ORIGIN }],
      ['Origin de outro site', { ...json, origin: 'http://evil.example' }],
      ['Origin null', { ...json, origin: 'null' }],
      ['sem os dois', json],
    ];
    for (const [name, headers] of cases) {
      const res = await call(t.app, 'POST', '/v1/auth/login', null, { body, headers, sameOrigin: false });
      assert.equal(res.status, 403, name);
      assert.equal(await errorCode(res), 'FORBIDDEN', name);
    }
    const bySite = await call(t.app, 'POST', '/v1/auth/login', null, { body, headers: { ...json, 'sec-fetch-site': 'same-origin' }, sameOrigin: false });
    assert.equal(bySite.status, 200, 'controle: Sec-Fetch-Site same-origin');
    const byOrigin = await call(t.app, 'POST', '/v1/auth/login', null, { body, headers: { ...json, origin: ORIGIN }, sameOrigin: false });
    assert.equal(byOrigin.status, 200, 'controle: sem Sec-Fetch-Site, Origin igual à do servidor');
  });

  test('logout vindo de outra origem → 403 e a sessão continua; sem application/json → 415', async () => {
    const martin = await Client.login(t.app, 'martin.minoil');
    const cross = await martin.request('POST', '/v1/auth/logout', { sameOrigin: false, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);
    const plain = await martin.request('POST', '/v1/auth/logout', { headers: { 'content-type': 'text/plain' } });
    assert.equal(plain.status, 415);
    assert.equal((await martin.get('/v1/auth/me')).status, 200, 'a sessão não foi revogada');
  });

  test('corpo acima de 64 KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const big = JSON.stringify({ username: 'x', password: 'y'.repeat(70 * 1024) });
    const res = await call(t.app, 'POST', '/v1/auth/login', null, { rawBody: big });
    assert.equal(res.status, 413);
    assert.equal(await errorCode(res), 'PAYLOAD_TOO_LARGE');
  });

  test('sem CORS: nenhum cabeçalho Access-Control-*, nem no preflight', async () => {
    const preflight = await t.app.request('/v1/auth/login', {
      method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    const login = await call(t.app, 'POST', '/v1/auth/login', null, { body, headers: { origin: 'http://evil.example' } });
    for (const res of [preflight, login]) {
      assert.deepEqual([...res.headers.keys()].filter((k) => k.startsWith('access-control-')), []);
    }
  });

  test('cabeçalhos de segurança e X-Request-Id em toda resposta, sem CSP', async () => {
    for (const p of ['/v1/health', '/v1/auth/me', '/', '/nao-existe']) {
      const res = await t.app.request(p);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', p);
      assert.ok(res.headers.get('x-request-id'), p);
      assert.equal(res.headers.get('content-security-policy'), null, p);
    }
  });

  test('log: uma linha por requisição com id, usuário, rota, status e ms; nunca o corpo do login', async () => {
    const secret = 'senha-que-nao-pode-ir-para-o-log';
    const before = t.logs.length;
    await login('martin.minoil', secret);
    const martin = await Client.login(t.app, 'martin.minoil');
    const res = await martin.get('/v1/auth/me');
    const lines = t.logs.slice(before);
    assert.equal(lines.filter((l) => l.includes('/v1/auth/me')).length, 1);
    const meLine = lines.find((l) => l.includes('/v1/auth/me'))!;
    assert.ok(meLine.includes(String(res.headers.get('x-request-id'))));
    assert.match(meLine, /martin\.minoil GET \/v1\/auth\/me 200 \d+ms/);
    assert.ok(lines.every((l) => !l.includes(secret) && !l.includes(PASSWORD)));
  });
});

describe('estáticos de lista fechada (item 8)', () => {
  const INDEX = readFileSync(path.join(ROOT, 'index.html'));

  test('/ e /index.html → o index.html; /demo-data.js → sempre o conteúdo fixo; vendor e assets da lista → 200', async () => {
    for (const p of ['/', '/index.html']) {
      const res = await t.app.request(p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(INDEX), p);
    }
    const demo = await t.app.request('/demo-data.js');
    assert.equal(demo.status, 200);
    assert.match(demo.headers.get('content-type') ?? '', /^text\/javascript/);
    assert.equal(await demo.text(), 'window.PSF_DEMO = null;');
    const three = await t.app.request('/vendor/three.min.js');
    assert.equal(three.status, 200);
    assert.match(three.headers.get('content-type') ?? '', /^text\/javascript/);
    const photo = await t.app.request('/assets/produtos/12031189.jpg');
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  });

  test('qualquer caminho fora da lista → 404', async () => {
    for (const p of [
      '/dados/catalogo.json', '/pre-solucao/', '/docs/specs/README.md', '/storage/', '/.git/config', '/package.json',
      '/server/src/app.ts', '/db/seed/fontes/ob.json', '/vendor/', '/vendor', '/assets/produtos/README.md', '/.env',
      '/vendor/..%2fdados/catalogo.json', '/INDEX.HTML', '/index.html/',
    ]) {
      const res = await t.app.request(p);
      assert.equal(res.status, 404, p);
    }
    const post = await call(t.app, 'POST', '/index.html', null);
    assert.equal(post.status, 404, 'só GET');
  });

  test('travessia pelo servidor HTTP real (caminho cru): ..%2f, %2e%2e, barra invertida e caminho absoluto → 404', async () => {
    const server = serve({ fetch: t.app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    const get = (rawPath: string) => new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject);
    });
    try {
      assert.equal(await get('/vendor/three.min.js'), 200, 'controle');
      assert.equal(await get('/index.html'), 200, 'controle');
      for (const p of [
        '/vendor/..%2fdados/catalogo.json', '/assets/%2e%2e/index.html', '/assets/%2E%2E/%2E%2E/package.json',
        '/vendor/%2e%2e/dados/catalogo.json', '/vendor\\..\\dados\\catalogo.json', '/vendor/%5c..%5cdados%5ccatalogo.json',
        '//etc/passwd', '/C:/Windows/win.ini', '/vendor/%252e%252e/index.html', '/assets/./produtos/12031189.jpg',
        '/vendor/three.min.js%00.jpg',
      ]) {
        assert.equal(await get(p), 404, p);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test.todo('o HTML servido não contém ob:{, rioclaro, 11999, MINOIL, Río Claro, Martín, Sofía, EXP-MINOIL nem lista AR (depende da S7)');
});
