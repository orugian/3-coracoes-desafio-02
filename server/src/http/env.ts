// Tipos compartilhados pela aplicação HTTP (docs/specs/04-api.md).
import type { Role } from '#contracts';
import type { Db } from '../ports/db.ts';

export interface AppDeps {
  db: Db;
  sessionSecret: string; // HS256, ≥ 32 bytes
  cookieSecure?: boolean; // COOKIE_SECURE
  now?: () => Date; // relógio (testes)
  log?: (line: string) => void; // uma linha por requisição e avisos de segurança
  staticRoot?: string; // raiz dos estáticos (padrão: raiz do repositório)
}

// Usuário da requisição, relido do banco a cada chamada (D12): o papel do token não decide nada.
export interface AuthUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  sessionId: string;
  customers: string[]; // user_customer_scope, em ordem
}

export interface AppEnv {
  Variables: {
    requestId: string;
    auth: AuthUser;
    logUser: string; // quem aparece no log (o login define antes de existir sessão)
  };
}
