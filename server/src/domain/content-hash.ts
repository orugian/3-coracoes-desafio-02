// content_hash de order_version (docs/specs/02-banco.md): sha256 do JSON canônico de cabeçalho, linhas, engine_version,
// data_batches e overrides. JSON canônico = chaves em ordem alfabética em todos os níveis, sem espaços, arrays na ordem dada.
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError(`valor sem JSON: ${String(value)}`);
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export interface VersionContent {
  header: { vehicleId: string; loadMode: string; mixedPallet: boolean; reference: string; loadingDate: string | null };
  lines: { material: string; boxes: number }[];
  engineVersion: number;
  dataBatches: number[];
  overrides: number[];
}

export function orderContentHash(content: VersionContent): string {
  const canonical = canonicalJson({
    header: content.header,
    lines: content.lines.map((l) => ({ material: l.material, boxes: l.boxes })),
    engineVersion: content.engineVersion,
    dataBatches: content.dataBatches,
    overrides: content.overrides,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
