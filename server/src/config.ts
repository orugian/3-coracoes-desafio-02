// Configuração por variáveis de ambiente (docs/specs/04-api.md, "Configuração").
// Variável vazia vale como ausente, para um .env copiado do .env.example funcionar sem edição.
import path from 'node:path';
import type { DatabaseConfig } from './db/open.ts';

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const MIN_SECRET_BYTES = 32;

export interface Config extends DatabaseConfig {
  port: number;
  sessionSecret: string;
  cookieSecure: boolean;
}

export function loadDatabaseConfig(): DatabaseConfig {
  return {
    dataDir: path.resolve(env('DATA_DIR') ?? './storage/pglite'),
    databaseUrl: env('DATABASE_URL'),
    seedReset: env('SEED_RESET') === 'yes',
  };
}

export function loadConfig(): Config {
  const rawPort = env('PORT') ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT inválida: ${rawPort}`);
  }
  const sessionSecret = env('SESSION_SECRET');
  if (!sessionSecret || Buffer.byteLength(sessionSecret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(`SESSION_SECRET ausente ou com menos de ${MIN_SECRET_BYTES} bytes. Gere uma no .env com: `
      + `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`);
  }
  const rawSecure = env('COOKIE_SECURE') ?? 'false';
  if (rawSecure !== 'true' && rawSecure !== 'false') throw new Error(`COOKIE_SECURE inválida: ${rawSecure} (true ou false)`);
  return { port, sessionSecret, cookieSecure: rawSecure === 'true', ...loadDatabaseConfig() };
}
