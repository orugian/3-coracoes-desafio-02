// npm run contracts:schema: grava o JSON Schema de cada contrato em docs/specs/schemas/ (docs/specs/04-api.md).
// Apaga os .json que não correspondem mais a nenhum contrato, para a pasta não guardar schema velho.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderJsonSchemas } from '../packages/contracts/src/json-schema.ts';

export const SCHEMAS_DIR = path.resolve(import.meta.dirname, '..', 'docs', 'specs', 'schemas');

const files = renderJsonSchemas();
mkdirSync(SCHEMAS_DIR, { recursive: true });
for (const old of readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json') && !files.has(f))) {
  rmSync(path.join(SCHEMAS_DIR, old));
  console.log(`removido: ${old}`);
}
for (const [name, content] of files) writeFileSync(path.join(SCHEMAS_DIR, name), content);
console.log(`${files.size} schemas em ${path.relative(process.cwd(), SCHEMAS_DIR) || SCHEMAS_DIR}`);
