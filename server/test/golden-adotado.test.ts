// Casos de referência na variante adotada (docs/specs/01-motor.md, "Casos de referência"; 04, "Testes do servidor"):
// dados do seed com os overrides da Q12, entrada montada por buildEngineInput sobre o banco semeado.
// kg, m³ e utilização com tolerância de 0,005 (em %, 0,05); dinheiro exato em centavos.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, type EngineInput, type EngineResult, type LineResult } from '#engine';
import { PortalCatalog } from '#contracts';
import type { Db } from '#server/ports/db.ts';
import { buildEngineInput } from '#server/repo/catalog.ts';
import { Client, seededDb, strictJson, testApp } from './helpers/api.ts';

const PRICE_DATE = '2026-10-13';
const MINOIL = '11131';
const RIOCLARO = '11999';
const PEDIDO_TESTE = [['12031189', 3528], ['12034103', 300], ['12037417', 250], ['12144012', 300]] as const;

const near = (actual: number, expected: number, tol: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} ≠ ${expected} (±${tol})`);
const kg = (a: number, e: number, label: string) => near(a, e, 0.005, label);
const pct = (fraction: number | null, expected: number, label: string) => {
  assert.notEqual(fraction, null, `${label}: utilização nula`);
  near((fraction as number) * 100, expected, 0.05, `${label} (%)`);
};
const line = (r: EngineResult, material: string): LineResult => {
  const l = r.lines.find((x) => x.material === material);
  assert.ok(l, `linha ${material} ausente`);
  return l;
};
const codes = (r: EngineResult, material: string) => line(r, material).alerts.map((a) => a.code).sort();

let db: Db;
before(async () => { db = await seededDb(); });
after(async () => { await db.close(); });

async function input(customer: string, vehicleId: string, loadMode: 'PALLETIZED' | 'FLOOR', lines: readonly (readonly [string, number])[]): Promise<EngineInput> {
  const built = await buildEngineInput(db, customer, { vehicleId, loadMode }, lines.map(([material, boxes]) => ({ material, boxes })), PRICE_DATE);
  return built.input;
}
const run = async (...args: Parameters<typeof input>) => calculate(await input(...args));

describe('casos de referência, variante adotada', () => {
  test('caso 1a: pedido-teste, carreta, paletizada, sem misto', async () => {
    const r = await run(MINOIL, 'carreta_padrao', 'PALLETIZED', PEDIDO_TESTE);
    assert.equal(r.totals.positions, 30);
    assert.equal(r.status, 'EXCEEDED');
    assert.equal(r.binding, 'positions');
    pct(r.utilization.positions, 107.1, 'posições');
    pct(r.utilization.kg, 84.1, 'peso');
    pct(r.utilization.m3, 81.8, 'cubagem');
    kg(r.totals.grossKg, 21024.24, 'bruto');
    kg(r.totals.netKg, 19230, 'líquido');
    kg(r.totals.m3, 58.88, 'm³');
    assert.equal(r.totals.valueCents, 19_201_748);
    assert.equal(r.over.positions, 2);
    assert.equal(line(r, '12034103').boxesToNextPallet, 24);
    assert.equal(line(r, '12037417').boxesToNextPallet, 23);
    assert.equal(line(r, '12144012').boxesToNextPallet, 118);
    assert.equal(line(r, '12031189').boxesToNextPallet, 0);
    assert.ok(r.lines.every((l) => l.alerts.every((a) => a.code !== 'BELOW_MIN_LOT')));
    assert.deepEqual(r.alerts.map((a) => a.code), ['VEHICLE_EXCEEDED']);
    assert.equal(r.blocking, true);
  });

  test('caso 1b: pallet misto (o do cliente, aqui trocado na entrada do motor)', async () => {
    const r = calculate({ ...(await input(MINOIL, 'carreta_padrao', 'PALLETIZED', PEDIDO_TESTE)), mixedPallet: true });
    assert.equal(r.totals.positions, 29);
    pct(r.utilization.positions, 103.6, 'posições');
    assert.equal(r.status, 'EXCEEDED');
  });

  test("caso 1c: contêiner 40'", async () => {
    const r = await run(MINOIL, 'container_40', 'PALLETIZED', PEDIDO_TESTE);
    pct(r.utilization.positions, 150, 'posições');
    pct(r.utilization.m3, 96.8, 'cubagem');
  });

  test('caso 1d: estivada na carreta', async () => {
    const r = await run(MINOIL, 'carreta_padrao', 'FLOOR', PEDIDO_TESTE);
    assert.equal(r.status, 'PARTIAL');
    assert.equal(r.binding, 'kg');
    pct(r.utilization.kg, 84.1, 'peso');
    assert.equal(r.utilization.positions, null);
  });

  test("caso 1e: estivada no contêiner 40'", async () => {
    const r = await run(MINOIL, 'container_40', 'FLOOR', PEDIDO_TESTE);
    assert.equal(r.status, 'FULL');
    assert.equal(r.binding, 'm3');
    pct(r.utilization.m3, 96.8, 'cubagem');
  });

  test('caso 2: carreta parcial', async () => {
    const r = await run(MINOIL, 'carreta_padrao', 'PALLETIZED', [['12031189', 2352], ['12142501', 1400]]);
    assert.equal(r.totals.positions, 19);
    pct(r.utilization.positions, 67.9, 'posições');
    assert.equal(r.status, 'PARTIAL');
    kg(r.totals.grossKg, 14468.16, 'bruto');
    assert.equal(r.totals.valueCents, 14_639_632);
    assert.equal(r.blocking, false);
  });

  test("caso 3 (adotada): Río Claro, lista AR, contêiner 40' com 17 posições e 56 cx para fechar o 12034109", async () => {
    const r = await run(RIOCLARO, 'container_40', 'PALLETIZED', [['12031291', 1176], ['12034109', 140], ['12142501', 1400], ['12147801', 540]]);
    kg(r.totals.grossKg, 9712.86, 'bruto');
    pct(r.utilization.kg, 38.9, 'peso');
    kg(r.totals.m3, 33.15, 'm³');
    pct(r.utilization.m3, 54.5, 'cubagem');
    assert.equal(r.totals.valueCents, 12_376_108);
    assert.equal(r.totals.positions, 17);
    pct(r.utilization.positions, 85, 'posições');
    assert.equal(r.status, 'PARTIAL');
    near(line(r, '12034109').pallets, 1.43, 0.005, 'pallets do 12034109');
    assert.equal(line(r, '12034109').boxesToNextPallet, 56);
  });

  test('caso 4 (adotada): restrição de país e lote mínimo; 20908885 com 1,43 pallet, 44 cx para fechar e 4 posições', async () => {
    const r = await run(RIOCLARO, 'container_40', 'PALLETIZED', [['20908885', 110], ['12142501', 560]]);
    assert.deepEqual(codes(r, '20908885'), ['COUNTRY_RESTRICTED', 'PALLET_INCOMPLETE']);
    near(line(r, '20908885').pallets, 1.43, 0.005, 'pallets do 20908885');
    assert.equal(line(r, '20908885').boxesToNextPallet, 44);
    const refil = line(r, '12142501');
    near(refil.pallets, 2, 1e-9, 'pallets do 12142501');
    assert.deepEqual(refil.alerts, [{ code: 'BELOW_MIN_LOT', severity: 'BLOCK', material: '12142501', params: { minLot: 5 } }]);
    assert.equal(r.totals.positions, 4);
    assert.equal(r.blocking, true);
  });
});

test('GET /portal/catalog de Martín: 98 cx/pallet no 12034109 e 77 no 20908885 (overrides da Q12)', async () => {
  const { app } = testApp(db);
  const martin = await Client.login(app, 'martin.minoil');
  const res = await martin.get('/v1/portal/catalog');
  assert.equal(res.status, 200);
  const catalog = await strictJson(res, PortalCatalog);
  const item = (m: string) => catalog.items.find((i) => i.material === m);
  assert.deepEqual([item('12034109')?.layerBoxes, item('12034109')?.layers, item('12034109')?.boxesPerPallet], [14, 7, 98]);
  assert.deepEqual([item('20908885')?.layerBoxes, item('20908885')?.layers, item('20908885')?.boxesPerPallet], [11, 7, 77]);
  assert.equal(item('12147801')?.grossKgPerBox, 1.2, 'override Q9 do bruto do stick');
});
