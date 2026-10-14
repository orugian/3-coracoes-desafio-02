// Hash de senha (docs/specs/04-api.md, "Sessão"): scrypt N 16384, r 8, p 1, chave 64 bytes, sal 16 bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '#server/auth/password.ts';

test('hashPassword grava scrypt$N$r$p$sal$hash em base64url e verifyPassword confere', async () => {
  const stored = await hashPassword('correta-cavalo-bateria');
  const parts = stored.split('$');
  assert.equal(parts.length, 6);
  assert.deepEqual(parts.slice(0, 4), ['scrypt', '16384', '8', '1']);
  assert.equal(Buffer.from(parts[4], 'base64url').length, 16);
  assert.equal(Buffer.from(parts[5], 'base64url').length, 64);
  assert.match(parts[4] + parts[5], /^[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword('correta-cavalo-bateria', stored), true);
  assert.equal(await verifyPassword('correta-cavalo-bateriA', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('sal aleatório: a mesma senha gera hashes diferentes', async () => {
  assert.notEqual(await hashPassword('x'), await hashPassword('x'));
});

test('hash malformado ou com parâmetros fora do padrão não verifica (e não lança)', async () => {
  const stored = await hashPassword('abc');
  const [, , r, p, salt, hash] = stored.split('$');
  for (const bad of ['', 'x', `bcrypt$16384$${r}$${p}$${salt}$${hash}`, `scrypt$1024$${r}$${p}$${salt}$${hash}`,
    `scrypt$16384$${r}$${p}$${salt}`, `scrypt$16384$${r}$${p}$${salt}$${hash.slice(0, 10)}`]) {
    assert.equal(await verifyPassword('abc', bad), false, bad.slice(0, 20));
  }
});
