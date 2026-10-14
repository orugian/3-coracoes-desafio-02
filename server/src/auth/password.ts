// Senha (docs/specs/04-api.md, "Sessão"): scrypt N 16384, r 8, p 1, chave de 64 bytes, sal de 16 bytes,
// gravada como scrypt$N$r$p$sal$hash (base64url); comparação com timingSafeEqual. Usado pelo seed e pelo login (S4).
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFC'), salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// Só aceita os parâmetros do padrão: um hash com N menor (mais fraco) não verifica.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return timingSafeEqual(key, expected);
}
