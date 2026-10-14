// Erros da API (docs/specs/04-api.md, "Erros"): formato ApiErrorBody, mensagem em português que vai direto para o toast.
import type { ApiErrorBody, ErrorCode, ErrorDetail } from '#contracts';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  LOGIN_FAILED: 401,
  FORBIDDEN: 403,
  SELF_APPROVAL_FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  ORDER_BLOCKED: 422, // 409 na aprovação (status explícito)
  LOADING_DATE_TOO_SOON: 422,
  NO_CHANGES: 422,
  VALIDATION_FAILED: 422,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

const MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Sessão inválida ou expirada. Entre novamente.',
  LOGIN_FAILED: 'Usuário ou senha incorretos.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  SELF_APPROVAL_FORBIDDEN: 'Quem criou ou ajustou o pedido não pode aprová-lo.',
  NOT_FOUND: 'Não encontrado.',
  INVALID_TRANSITION: 'Ação não permitida no estado atual do pedido.',
  VERSION_CONFLICT: 'O pedido mudou desde que você o abriu. Recarregue e tente de novo.',
  IDEMPOTENCY_KEY_REUSED: 'Esta chave de envio já foi usada com outro conteúdo.',
  ORDER_BLOCKED: 'O pedido tem bloqueios. Corrija-os antes de continuar.',
  LOADING_DATE_TOO_SOON: 'A data de carregamento precisa ser de pelo menos 7 dias a partir de hoje.',
  NO_CHANGES: 'Nenhuma mudança em relação à versão atual.',
  VALIDATION_FAILED: 'Dados inválidos.',
  IDEMPOTENCY_KEY_REQUIRED: 'Envio sem a chave de idempotência (cabeçalho Idempotency-Key).',
  UNSUPPORTED_MEDIA_TYPE: 'Envie o corpo como application/json.',
  PAYLOAD_TOO_LARGE: 'Corpo da requisição acima de 64 KB.',
  INTERNAL: 'Erro interno. Tente de novo.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  constructor(code: ErrorCode, options: { message?: string; details?: ErrorDetail[]; status?: number } = {}) {
    super(options.message ?? MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? STATUS[code];
    this.details = options.details;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}
