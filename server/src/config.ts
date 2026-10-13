// Configuração por variáveis de ambiente (docs/specs/04-api.md, "Configuração").
// Variável vazia vale como ausente, para um .env copiado do .env.example funcionar sem edição.

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface Config {
  port: number;
}

export function loadConfig(): Config {
  const rawPort = env('PORT') ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT inválida: ${rawPort}`);
  }
  return { port };
}
