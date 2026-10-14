// Cálculo de uma versão de pedido (docs/specs/04-api.md, "Regras transversais"): o servidor ignora qualquer resultado
// vindo do navegador; a versão é sempre buildEngineInput + calculate, com o pallet misto do cliente.
import { createHash } from 'node:crypto';
import { calculate, type EngineResult } from '#engine';
import type { ErrorDetail, LineInput } from '#contracts';
import { MAX_LINES } from '#contracts';
import { canonicalJson, orderContentHash } from '../domain/content-hash.ts';
import { saoPauloDate } from '../domain/time.ts';
import { ApiError } from '../http/errors.ts';
import { buildEngineInput, FULL_AT } from '../repo/catalog.ts';
import type { Queryable } from '../ports/db.ts';

export const LEAD_DAYS = 7;

export interface Line { material: string; boxes: number }
export interface HeaderInput { vehicleId: string; loadMode: 'PALLETIZED' | 'FLOOR'; reference: string; loadingDate: string | null }
export interface ComputedVersion {
  header: HeaderInput & { mixedPallet: boolean };
  lines: Line[]; // ordem do catálogo (código do material)
  result: EngineResult;
  dataBatches: number[];
  overrides: number[];
  contentHash: string;
  priceDate: string;
}

const byMaterial = (a: Line, b: Line) => (a.material < b.material ? -1 : a.material > b.material ? 1 : 0);

// Regras que não dependem do banco: materiais únicos e caixas inteiras (fração → QTY_NOT_MULTIPLE, a UI arredonda antes).
export function checkLines(lines: LineInput[]): Line[] {
  const details: ErrorDetail[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.material)) details.push({ code: 'DUPLICATE_MATERIAL', material: l.material });
    seen.add(l.material);
    if (!Number.isInteger(l.boxes)) details.push({ code: 'QTY_NOT_MULTIPLE', material: l.material, params: { lo: Math.floor(l.boxes), hi: Math.ceil(l.boxes) } });
  }
  if (details.length) throw new ApiError('VALIDATION_FAILED', { details });
  return lines.map((l) => ({ material: l.material, boxes: l.boxes })).sort(byMaterial);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Data de carregamento vazia ou ≥ hoje + 7 dias no fuso de São Paulo (envio e reenvio).
export function checkLoadingDate(loadingDate: string | null, now: Date): void {
  if (loadingDate === null) return;
  const min = addDays(saoPauloDate(now), LEAD_DAYS);
  if (loadingDate < min) throw new ApiError('LOADING_DATE_TOO_SOON', { details: [{ code: 'LOADING_DATE_TOO_SOON', params: { minDate: min } }] });
}

// Material existente e ativo no centro do cliente (o catálogo efetivo que o motor recebe). Roda antes da regra da data,
// para a ordem das recusas ser a da spec (422 do corpo antes de 422 da data).
export async function checkKnownMaterials(q: Queryable, customerCode: string, lines: Line[]): Promise<void> {
  const { rows } = await q.query<{ code: string }>(
    `select e.code from material_effective e join branch_plant b on b.plant = e.plant join customer c on c.branch = b.branch
      where c.code = $1 and e.code = any($2::text[])`,
    [customerCode, lines.map((l) => l.material)]);
  const known = new Set(rows.map((r) => r.code));
  const unknown = lines.filter((l) => !known.has(l.material));
  if (unknown.length) throw new ApiError('VALIDATION_FAILED', { details: unknown.map((l) => ({ code: 'UNKNOWN_MATERIAL', material: l.material })) });
}

// options.mixedPallet: recálculo de uma versão existente (aprovação), com o pallet misto congelado nela; sem ele, vale o
// do cliente agora (envio e nova versão).
export async function computeVersion(
  q: Queryable, customerCode: string, header: HeaderInput, lines: Line[], now: Date, options: { mixedPallet?: boolean } = {},
): Promise<ComputedVersion> {
  const priceDate = saoPauloDate(now);
  const built = await buildEngineInput(q, customerCode, { vehicleId: header.vehicleId, loadMode: header.loadMode }, lines, priceDate);
  if (options.mixedPallet !== undefined) built.input.mixedPallet = options.mixedPallet;
  // Material existente e ativo no centro do cliente (o catálogo efetivo que o motor recebe).
  const known = new Set(built.input.items.map((i) => i.material));
  const unknown = lines.filter((l) => !known.has(l.material));
  if (unknown.length) throw new ApiError('VALIDATION_FAILED', { details: unknown.map((l) => ({ code: 'UNKNOWN_MATERIAL', material: l.material })) });
  const result = calculate(built.input);
  const fullHeader = { ...header, mixedPallet: built.input.mixedPallet };
  const contentHash = orderContentHash({ header: fullHeader, lines, engineVersion: 1, dataBatches: built.dataBatches, overrides: built.overrides });
  return { header: fullHeader, lines, result, dataBatches: built.dataBatches, overrides: built.overrides, contentHash, priceDate };
}

// Alertas BLOCK do motor, na ordem das linhas e depois os do pedido (details do 422/409 ORDER_BLOCKED).
export function blockDetails(r: EngineResult): ErrorDetail[] {
  return [...r.lines.flatMap((l) => l.alerts), ...r.alerts]
    .filter((a) => a.severity === 'BLOCK')
    .map((a) => ({ code: a.code, ...(a.material ? { material: a.material } : {}), ...(a.params ? { params: a.params } : {}) }));
}

export const maxUtilization = (r: EngineResult): number => Math.max(r.utilization.kg, r.utilization.m3, r.utilization.positions ?? 0);
export const isFullLoad = (r: EngineResult): boolean => maxUtilization(r) >= FULL_AT;

// Corpo canônico do envio para a idempotência: chaves ordenadas e linhas por material (04, "Hash canônico").
export function requestHash(customerCode: string, header: HeaderInput, lines: Line[]): string {
  const canonical = canonicalJson({ customerCode, header, lines: [...lines].sort(byMaterial) });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface LineChange { material: string; old: number; new: number }

// Materiais únicos no corpo (422 DUPLICATE_MATERIAL), antes de qualquer consulta: é erro do corpo (ordem das recusas).
export function assertUniqueMaterials(lines: { material: string }[]): void {
  const seen = new Set<string>();
  const duplicated = lines.filter((l) => (seen.has(l.material) ? true : (seen.add(l.material), false)));
  if (duplicated.length) {
    throw new ApiError('VALIDATION_FAILED', { details: duplicated.map((l) => ({ code: 'DUPLICATE_MATERIAL', material: l.material })) });
  }
}

// Nova versão do backoffice: aplica { material, boxes } sobre as linhas atuais (0 remove; material novo entra com old 0).
// Só as mudanças efetivas entram em changes; nenhuma → 422 NO_CHANGES; nenhuma linha depois → 422.
export function applyChanges(current: Line[], requested: { material: string; boxes: number }[]): { lines: Line[]; changes: LineChange[] } {
  assertUniqueMaterials(requested);
  const next = new Map(current.map((l) => [l.material, l.boxes]));
  const changes: LineChange[] = [];
  for (const c of [...requested].sort(byMaterial)) {
    const old = next.get(c.material) ?? 0;
    if (old === c.boxes) continue;
    changes.push({ material: c.material, old, new: c.boxes });
    if (c.boxes === 0) next.delete(c.material);
    else next.set(c.material, c.boxes);
  }
  if (changes.length === 0) throw new ApiError('NO_CHANGES');
  const lines = [...next].map(([material, boxes]) => ({ material, boxes })).sort(byMaterial);
  if (lines.length === 0) throw new ApiError('VALIDATION_FAILED', { message: 'O pedido precisa de pelo menos uma linha.', details: [{ code: 'NO_LINES' }] });
  if (lines.length > MAX_LINES) throw new ApiError('VALIDATION_FAILED', { details: [{ code: 'TOO_MANY_LINES', params: { max: MAX_LINES } }] });
  return { lines, changes };
}

// Resultado gravado sem os inputs (data do preço etc.), para comparar com um recálculo.
export const storedResult = (r: EngineResult & { inputs?: unknown }): EngineResult => {
  const { inputs: _inputs, ...result } = r;
  return result;
};
export const sameResult = (a: EngineResult, b: EngineResult): boolean => canonicalJson(a) === canonicalJson(b);
