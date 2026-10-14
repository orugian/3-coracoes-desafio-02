// JSON Schema dos contratos para quem integra o front (docs/specs/04-api.md, início): npm run contracts:schema grava um
// arquivo por contrato em docs/specs/schemas/. Corpos de requisição no modo input (campo com padrão fica opcional);
// respostas no modo output. O teste dos contratos confere que os arquivos versionados estão em dia.
import { z } from 'zod';
import * as C from './index.ts';

type Mode = 'input' | 'output';

export const JSON_SCHEMA_CONTRACTS: [name: string, schema: z.ZodType, io: Mode][] = [
  ['LoginBody', C.LoginBody, 'input'],
  ['OrderBody', C.OrderBody, 'input'],
  ['RulesBody', C.RulesBody, 'input'],
  ['BackofficeVersionBody', C.BackofficeVersionBody, 'input'],
  ['ApproveBody', C.ApproveBody, 'input'],
  ['ReturnBody', C.ReturnBody, 'input'],
  ['ResubmitBody', C.ResubmitBody, 'input'],
  ['ApiErrorBody', C.ApiErrorBody, 'output'],
  ['Me', C.Me, 'output'],
  ['PortalCatalog', C.PortalCatalog, 'output'],
  ['EngineResult', C.EngineResult, 'output'],
  ['PortalOrderView', C.PortalOrderView, 'output'],
  ['BackofficeOrderView', C.BackofficeOrderView, 'output'],
  ['CustomerInternal', C.CustomerInternal, 'output'],
  ['BackofficeCustomers', C.BackofficeCustomers, 'output'],
  ['BackofficeProducts', C.BackofficeProducts, 'output'],
];

// Nome do arquivo → conteúdo (JSON com 2 espaços e \n no fim; .gitattributes marca -text).
export function renderJsonSchemas(): Map<string, string> {
  return new Map(JSON_SCHEMA_CONTRACTS.map(([name, schema, io]) => [
    `${name}.json`,
    `${JSON.stringify({ title: name, ...z.toJSONSchema(schema, { io }) }, null, 2)}\n`,
  ]));
}
