// Permissões por pedido (docs/specs/04-api.md, "Matriz de permissões do corte"). As rotas autorizam com estas mesmas
// funções e o backoffice devolve o resultado em OrderView.permissions; a UI só esconde ou desabilita.
import type { OrderStatus, Permissions, Role } from '#contracts';

export interface Actor { userId: number; role: Role; customers: string[] }
export interface OrderAccess { status: OrderStatus; customerCode: string; createdBy: number; authorIds: number[] }

// Ver: distribuidor só o próprio escopo (fora dele, 404); Exportação e administrador, todos.
export const canSee = (a: Actor, o: Pick<OrderAccess, 'customerCode'>): boolean =>
  a.role === 'ext_distribuidor' ? a.customers.includes(o.customerCode) : a.role === 'int_exportacao' || a.role === 'int_admin';

// Segregação de funções: quem criou o pedido ou é autor de alguma versão não aprova.
export const isCreatorOrAuthor = (a: Actor, o: OrderAccess): boolean => o.createdBy === a.userId || o.authorIds.includes(a.userId);

// Nova versão: só int_exportacao, sobre pedido SUBMITTED.
export const canEdit = (a: Actor, o: OrderAccess): boolean => a.role === 'int_exportacao' && o.status === 'SUBMITTED';

// Aprovar: int_exportacao, pedido SUBMITTED, sem ter criado nem editado. O bloqueio (BLOCK) é checado na rota (409).
export const canApprove = (a: Actor, o: OrderAccess): boolean =>
  a.role === 'int_exportacao' && o.status === 'SUBMITTED' && !isCreatorOrAuthor(a, o);

// Devolver (S9): int_exportacao, pedido SUBMITTED; sem segregação (quem criou ou editou também devolve).
export const canReturn = (a: Actor, o: OrderAccess): boolean => a.role === 'int_exportacao' && o.status === 'SUBMITTED';
// Reenviar (S9): distribuidor do escopo, pedido devolvido (CHANGES_REQUESTED).
export const canResubmit = (a: Actor, o: OrderAccess): boolean =>
  a.role === 'ext_distribuidor' && o.status === 'CHANGES_REQUESTED' && a.customers.includes(o.customerCode);

export const permissionsFor = (a: Actor, o: OrderAccess): Permissions => ({
  canEdit: canEdit(a, o), canApprove: canApprove(a, o), canReturn: canReturn(a, o), canResubmit: canResubmit(a, o),
});
