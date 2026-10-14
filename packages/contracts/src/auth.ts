// Login e sessão (docs/specs/04-api.md, "Sessão" e "Rotas").
import { z } from 'zod';
import { Role } from './common.ts';
import { CustomerProfile } from './customer.ts';

export const LoginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const Me = z.strictObject({
  user: z.strictObject({ id: z.int(), username: z.string(), displayName: z.string(), role: Role }),
  area: z.enum(['portal', 'backoffice']),
  customers: z.array(CustomerProfile), // portal: os do escopo; backoffice: []
});
export type Me = z.infer<typeof Me>;
