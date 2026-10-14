// Configuração por variáveis de ambiente (docs/specs/04-api.md, "Configuração").
// Variável vazia vale como ausente, para um .env copiado do .env.example funcionar sem edição.
import path from 'node:path';
import type { DatabaseConfig } from './db/open.ts';

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface Config extends DatabaseConfig {
  port: number;
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
  return { port, ...loadDatabaseConfig() };
}
