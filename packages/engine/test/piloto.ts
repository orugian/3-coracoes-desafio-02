// Ponte entre o piloto (index.html do front) e o motor, usada pelos testes do motor e por scripts/extrair_piloto.ts.
// Método do docs/arquitetura/verificacao/motor_piloto_harness.js: blocos de texto do HTML avaliados com new Function.
// docs/specs/01-motor.md, "Teste de paridade com o piloto".
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineInput, EngineItem, LoadMode, AlertCode } from '../src/index.ts';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
export const ROOT_INDEX_HTML = path.join(REPO_ROOT, 'index.html');
export const FIXTURE_PATH = path.join(import.meta.dirname, 'fixtures', 'piloto.json');

export interface PilotProduct {
  code: string;
  fam: string;
  un: number;
  net: number;
  gross: number;
  dm3: number;
  m3: number;
  lastro: number;
  alt: number;
  cxPal: number;
  loteMin: number;
  price: number | null;
  prices?: Record<string, number | null>;
  [field: string]: unknown;
}
export interface PilotVehicle { pos: number; m3: number; kg: number; [field: string]: unknown }
export interface PilotClient { code: string; name: string; list: string; factor: number; blocked: string[]; [field: string]: unknown }
export interface PilotData {
  EPS: number;
  P: PilotProduct[];
  VEH: Record<string, PilotVehicle>;
  CLIENTS: Record<string, PilotClient>;
  RULES: { fullAt: number; [field: string]: unknown };
}
export interface PilotFixture extends PilotData { commit: string; file: string }

export interface PilotOrder { qty: Record<string, number>; veh: string; client: string; mode: 'pal' | 'est'; mixed: boolean }
export interface PilotIssue { lv: 'err' | 'warn'; k: string; [field: string]: unknown }
export interface PilotLine {
  p: PilotProduct; cx: number; pallets: number; full: number; missing: number;
  net: number; gross: number; m3: number; price: number; value: number; issues: PilotIssue[];
}
export interface PilotResult {
  lines: PilotLine[];
  tot: { cx: number; pallets: number; net: number; gross: number; m3: number; value: number; positions: number };
  u: { kg: number; m3: number; pos: number };
  bind: 'kg' | 'm3' | 'pos';
  status: 'empty' | 'partial' | 'full' | 'excess';
  over: { pos: number; kg: number; m3: number };
  blocking: boolean;
}
export interface PilotFunctions {
  calc(qty: Record<string, number>, o: Omit<PilotOrder, 'qty'>): PilotResult;
  priceFor(p: PilotProduct, clientId: string): number;
}

// Correspondência do 01 (piloto → motor).
export const ALERT_FROM_PILOT: Record<string, AlertCode> = {
  boxMult: 'QTY_NOT_MULTIPLE',
  blocked: 'COUNTRY_RESTRICTED',
  noPrice: 'NO_PRICE',
  belowMin: 'BELOW_MIN_LOT',
  missing: 'PALLET_INCOMPLETE',
};
export const ORDER_ALERT_FROM_STATUS: Partial<Record<PilotResult['status'], AlertCode>> = {
  excess: 'VEHICLE_EXCEEDED',
  partial: 'VEHICLE_UNDERFILLED',
};
export const STATUS_FROM_PILOT = { empty: 'EMPTY', partial: 'PARTIAL', full: 'FULL', excess: 'EXCEEDED' } as const;
export const BINDING_FROM_PILOT = { kg: 'kg', m3: 'm3', pos: 'positions' } as const;
export const MODE_FROM_PILOT: Record<PilotOrder['mode'], LoadMode> = { pal: 'PALLETIZED', est: 'FLOOR' };
// D10: IDs do servidor seguem o container.json.
export const VEHICLE_FROM_PILOT: Record<string, string> = { carreta: 'carreta_padrao', c40: 'container_40', c20: 'container_20' };

// Desde 18e3e1a, o calc() do front lê RULES.minLotBlock e RULES.fullPalBlock (aba "Parâmetros do negócio").
// O engine_version 1 é o calc() com estes valores, que são os padrões do HTML (01, "Teste de paridade").
export const ENGINE_V1_PILOT_RULES = { minLotBlock: true, fullPalBlock: false } as const;
// Chaves conhecidas da linha `const RULES` do HTML: uma chave nova pode mudar o calc() sem passar pelo perfil acima.
export const PILOT_RULES_KEYS = ['fullAt', 'fullPalBlock', 'lateH', 'leadDays', 'minLotBlock'] as const;

// Padrões de RULES no index.html (linha `const RULES = {...};`), para o teste conferir que continuam os do engine_version 1.
export function pilotRulesDefaults(htmlPath: string = ROOT_INDEX_HTML): Record<string, unknown> {
  const L = htmlLines(readFileSync(htmlPath, 'utf8'));
  const line = extractBlock(L, /^const RULES\s*=/, /^const RULES\s*=/);
  return new Function(`${line}\nreturn RULES;`)() as Record<string, unknown>;
}

function htmlLines(html: string): string[] {
  return html.replace(/\r\n/g, '\n').split('\n');
}

// Do primeiro início que casa (sem indentação) até a primeira linha que casa com o fim, inclusive.
export function extractBlock(lines: string[], startRe: RegExp, endRe: RegExp): string {
  const a = lines.findIndex((l) => startRe.test(l.trimStart()));
  if (a < 0) throw new Error(`bloco não encontrado no index.html: ${startRe}`);
  let b = a + (endRe.test(lines[a]) ? 0 : 1);
  while (b < lines.length - 1 && !endRe.test(lines[b])) b++;
  if (!endRe.test(lines[b])) throw new Error(`fim do bloco não encontrado no index.html: ${endRe}`);
  return lines.slice(a, b + 1).join('\n');
}

// Dados embutidos no HTML (P com EXTRA, VEH, RULES, CLIENTS, EPS), para gerar a fixture.
export function extractPilotData(html: string): PilotData {
  const L = htmlLines(html);
  const src = [
    extractBlock(L, /^const P = \[/, /^const BY/),
    extractBlock(L, /^const VEH/, /^const RULES/),
    extractBlock(L, /^const CLIENTS/, /^\};/),
    extractBlock(L, /^const EPS\s*=/, /^const EPS\s*=/),
    // Idempotente: f89cef4 já faz isso no próprio bloco; commits anteriores não.
    'P.forEach(p=>{p.cxPal=p.lastro*p.alt;p.m3=p.dm3/1000});',
    'return {EPS, P, VEH, CLIENTS, RULES};',
  ].join('\n');
  const data = new Function(src)() as PilotData;
  return JSON.parse(JSON.stringify(data)) as PilotData;
}

// calc e priceFor do HTML, com os dados injetados (o teste continua válido depois que os dados saírem do HTML, D8).
export function loadPilotFunctions(htmlPath: string = ROOT_INDEX_HTML): (data: PilotData) => PilotFunctions {
  const L = htmlLines(readFileSync(htmlPath, 'utf8'));
  const body = [
    "const S = { lang: 'pt' };",
    extractBlock(L, /^function priceFor\b/, /^function priceFor\b/),
    extractBlock(L, /^function calc\b/, /^\}/),
    'return { calc, priceFor };',
  ].join('\n');
  const factory = new Function('P', 'VEH', 'CLIENTS', 'RULES', 'EPS', body) as (
    P: PilotProduct[], VEH: PilotData['VEH'], CLIENTS: PilotData['CLIENTS'], RULES: PilotData['RULES'], EPS: number,
  ) => PilotFunctions;
  return (data) => factory(data.P, data.VEH, data.CLIENTS, data.RULES, data.EPS);
}

export function loadFixture(): PilotFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as PilotFixture;
}

export function clientKey(data: PilotData, code: string): string {
  const key = Object.keys(data.CLIENTS).find((k) => String(data.CLIENTS[k].code) === code);
  if (!key) throw new Error(`cliente ${code} não está na fixture do piloto`);
  return key;
}

// Sem preço, como o piloto marca noPrice.
export function pilotHasNoPrice(p: PilotProduct, client: PilotClient): boolean {
  return p.price == null && !(p.prices && p.prices[client.list] != null);
}

// Preço pela regra do 01 (lista do cliente; senão price × factor com 2 casas), calculado aqui e não pelo priceFor do
// HTML: se o front mudar o priceFor, o valor do piloto diverge do motor e a paridade acusa.
export function pilotPrice(p: PilotProduct, client: PilotClient): number {
  const listed = p.prices?.[client.list];
  if (listed != null) return listed;
  if (p.price == null) return 0;
  return Math.round(p.price * client.factor * 100) / 100;
}

// Fixture + pedido do piloto → entrada do motor. Preço: pilotPrice × 100, arredondado; null quando o piloto marca noPrice.
// (fns fica na assinatura para os chamadores; o preço não sai mais dele.)
export function toEngineInput(data: PilotData, fns: PilotFunctions, order: PilotOrder): EngineInput {
  const client = data.CLIENTS[order.client];
  const veh = data.VEH[order.veh];
  const vehicleId = VEHICLE_FROM_PILOT[order.veh];
  if (!client || !veh || !vehicleId) throw new Error(`cliente ou veículo desconhecido: ${order.client}, ${order.veh}`);
  const items: EngineItem[] = data.P.map((p) => ({
    material: p.code,
    family: p.fam,
    unitsPerBox: p.un,
    netKgPerBox: p.net,
    grossKgPerBox: p.gross,
    volumeDm3: p.dm3,
    layerBoxes: p.lastro,
    layers: p.alt,
    minLotPallets: p.loteMin,
    priceCents: pilotHasNoPrice(p, client) ? null : Math.round(pilotPrice(p, client) * 100),
  }));
  return {
    engineVersion: 1,
    items,
    vehicle: { id: vehicleId, palletPositions: veh.pos, volumeM3: veh.m3, payloadKg: veh.kg },
    mode: MODE_FROM_PILOT[order.mode],
    mixedPallet: order.mixed,
    restrictedMaterials: [...client.blocked],
    lines: Object.entries(order.qty).map(([material, boxes]) => ({ material, boxes })),
    rules: { fullAt: data.RULES.fullAt },
  };
}
