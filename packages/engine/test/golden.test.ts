// Casos de referência do motor, variante "piloto" (docs/specs/01-motor.md, "Casos de referência").
// kg, m³ e utilização com tolerância de 0,005 (em %, 0,05); dinheiro exato em centavos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, ENGINE_VERSION, EngineInputError, type Alert, type EngineInput, type EngineResult, type LineResult } from '#engine';
import { clientKey, loadFixture, loadPilotFunctions, toEngineInput, type PilotOrder } from './piloto.ts';

const fx = loadFixture();
const pilot = loadPilotFunctions()(fx);
const MINOIL = clientKey(fx, '11131');
const RIOCLARO = clientKey(fx, '11999');

const PEDIDO_TESTE = { '12031189': 3528, '12034103': 300, '12037417': 250, '12144012': 300 };
const CASO_2 = { '12031189': 2352, '12142501': 1400 };

function input(qty: PilotOrder['qty'], o: Partial<Omit<PilotOrder, 'qty'>> = {}): EngineInput {
  return toEngineInput(fx, pilot, { qty, veh: 'carreta', client: MINOIL, mode: 'pal', mixed: false, ...o });
}
const run = (qty: PilotOrder['qty'], o: Partial<Omit<PilotOrder, 'qty'>> = {}): EngineResult => calculate(input(qty, o));

function near(actual: number, expected: number, tol: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} ≠ ${expected} (±${tol})`);
}
const kg = (actual: number, expected: number, label: string) => near(actual, expected, 0.005, label);
const pct = (fraction: number | null, expected: number, label: string) => {
  assert.notEqual(fraction, null, `${label}: utilização nula`);
  near((fraction as number) * 100, expected, 0.05, `${label} (%)`);
};
function line(r: EngineResult, material: string): LineResult {
  const l = r.lines.find((x) => x.material === material);
  assert.ok(l, `linha ${material} ausente`);
  return l;
}
const codes = (alerts: Alert[]) => alerts.map((a) => a.code).sort();
const allLineCodes = (r: EngineResult) => r.lines.flatMap((l) => l.alerts.map((a) => a.code));

test('ENGINE_VERSION é 1 e o resultado traz a versão', () => {
  assert.equal(ENGINE_VERSION, 1);
  assert.equal(run(PEDIDO_TESTE).engineVersion, 1);
});

test('caso 1a: pedido-teste, carreta, paletizada, sem misto', () => {
  const r = run(PEDIDO_TESTE);
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
  const fecha = line(r, '12031189');
  assert.equal(fecha.boxesToNextPallet, 0);
  assert.equal(fecha.fullPallets, 21);
  assert.deepEqual(fecha.alerts, []);
  assert.deepEqual(line(r, '12034103').alerts, [
    { code: 'PALLET_INCOMPLETE', severity: 'WARN', material: '12034103', params: { boxesToNextPallet: 24, nextPallet: 4 } },
  ]);
  assert.ok(!allLineCodes(r).includes('BELOW_MIN_LOT'));
  assert.deepEqual(codes(r.alerts), ['VEHICLE_EXCEEDED']);
  const excedido = r.alerts[0];
  assert.equal(excedido.severity, 'BLOCK');
  assert.equal(excedido.params?.positions, 2);
  assert.equal(r.blocking, true);
  assert.deepEqual(r.lines.map((l) => l.material), ['12031189', '12034103', '12037417', '12144012']);
});

test('caso 1b: pallet misto', () => {
  const r = run(PEDIDO_TESTE, { mixed: true });
  assert.equal(r.totals.positions, 29);
  pct(r.utilization.positions, 103.6, 'posições');
  assert.equal(r.status, 'EXCEEDED');
});

test("caso 1c: contêiner 40'", () => {
  const r = run(PEDIDO_TESTE, { veh: 'c40' });
  pct(r.utilization.positions, 150, 'posições');
  pct(r.utilization.m3, 96.8, 'cubagem');
});

test('caso 1d: estivada (FLOOR) na carreta', () => {
  const r = run(PEDIDO_TESTE, { mode: 'est' });
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.binding, 'kg');
  pct(r.utilization.kg, 84.1, 'peso');
  assert.equal(r.utilization.positions, null);
  assert.equal(r.over.positions, 0);
  assert.ok(!allLineCodes(r).includes('PALLET_INCOMPLETE'), 'FLOOR não gera PALLET_INCOMPLETE');
  assert.deepEqual(r.alerts, [{ code: 'VEHICLE_UNDERFILLED', severity: 'WARN' }]);
  assert.equal(r.blocking, false);
});

test("caso 1e: estivada (FLOOR) no contêiner 40'", () => {
  const r = run(PEDIDO_TESTE, { mode: 'est', veh: 'c40' });
  assert.equal(r.status, 'FULL');
  assert.equal(r.binding, 'm3');
  pct(r.utilization.m3, 96.8, 'cubagem');
  assert.deepEqual(r.alerts, []);
});

test('caso 2: carreta parcial', () => {
  const r = run(CASO_2);
  assert.equal(r.totals.positions, 19);
  pct(r.utilization.positions, 67.9, 'posições');
  assert.equal(r.status, 'PARTIAL');
  kg(r.totals.grossKg, 14468.16, 'bruto');
  assert.equal(r.totals.valueCents, 14_639_632);
  assert.deepEqual(allLineCodes(r), []);
  assert.equal(r.blocking, false);
});

test("caso 3 (piloto): Río Claro, lista AR, contêiner 40'", () => {
  const r = run({ '12031291': 1176, '12034109': 140, '12142501': 1400, '12147801': 540 }, { client: RIOCLARO, veh: 'c40' });
  kg(r.totals.grossKg, 9712.86, 'bruto');
  pct(r.utilization.kg, 38.9, 'peso');
  kg(r.totals.m3, 33.15, 'm³');
  pct(r.utilization.m3, 54.5, 'cubagem');
  assert.equal(r.totals.valueCents, 12_376_108);
  assert.equal(r.totals.positions, 20);
  pct(r.utilization.positions, 100, 'posições');
  assert.equal(r.status, 'FULL');
});

test('caso 4 (piloto): restrição de país e lote mínimo', () => {
  const r = run({ '20908885': 110, '12142501': 560 }, { client: RIOCLARO, veh: 'c40' });
  const porta = line(r, '20908885');
  assert.deepEqual(codes(porta.alerts), ['COUNTRY_RESTRICTED']);
  assert.equal(porta.alerts[0].severity, 'BLOCK');
  near(porta.pallets, 1, 1e-9, 'pallets do 20908885');
  const refil = line(r, '12142501');
  near(refil.pallets, 2, 1e-9, 'pallets do 12142501');
  assert.deepEqual(refil.alerts, [{ code: 'BELOW_MIN_LOT', severity: 'BLOCK', material: '12142501', params: { minLot: 5 } }]);
  assert.equal(r.totals.positions, 3);
  assert.equal(r.blocking, true);
});

test('caso 5: quantidade fracionária (1010 UN ÷ 20)', () => {
  const r = run({ '12031291': 50.5 });
  const l = line(r, '12031291');
  assert.equal(l.requestedBoxes, 50.5);
  assert.equal(l.boxes, 51);
  assert.deepEqual(l.alerts.find((a) => a.code === 'QTY_NOT_MULTIPLE'), {
    code: 'QTY_NOT_MULTIPLE', severity: 'BLOCK', material: '12031291', params: { lo: 50, hi: 51 },
  });
  assert.equal(r.totals.boxes, 51);
  assert.equal(r.blocking, true);
});

test('caso 6: linhas vazias', () => {
  for (const mixed of [false, true]) {
    const r = run({}, { mixed });
    assert.equal(r.status, 'EMPTY');
    assert.deepEqual(r.lines, []);
    assert.deepEqual(r.alerts, []);
    assert.equal(r.blocking, true);
    assert.equal(r.totals.positions, 0);
    assert.equal(r.totals.valueCents, 0);
  }
  // Quantidade zero ou negativa não vira linha, como no piloto (Math.max(0, …)).
  assert.equal(run({ '12031189': 0, '12034103': -5 }).status, 'EMPTY');
});

test('caso 7: caso 2 com o 12142501 sem preço', () => {
  const base = input(CASO_2);
  const semPreco: EngineInput = {
    ...base,
    items: base.items.map((i) => (i.material === '12142501' ? { ...i, priceCents: null } : i)),
  };
  const r = calculate(semPreco);
  const l = line(r, '12142501');
  assert.deepEqual(l.alerts, [{ code: 'NO_PRICE', severity: 'BLOCK', material: '12142501' }]);
  assert.equal(l.priceCents, null);
  assert.equal(l.valueCents, 0);
  assert.equal(r.totals.positions, 19);
  kg(r.totals.grossKg, 14468.16, 'bruto');
  assert.equal(r.totals.valueCents, 2352 * 4941);
  assert.equal(r.blocking, true);
});

// Item sintético do caso 8: 25 kg bruto e 72 dm³ por caixa, 10 × 10 por pallet, lote 1, com preço.
function synthetic(boxes: number, volumeDm3 = 72): EngineInput {
  return {
    engineVersion: 1,
    items: [{
      material: 'T0000001', family: 'CAFES', unitsPerBox: 1, netKgPerBox: 20, grossKgPerBox: 25, volumeDm3,
      layerBoxes: 10, layers: 10, minLotPallets: 1, priceCents: 1000,
    }],
    vehicle: { id: 'carreta_padrao', palletPositions: 28, volumeM3: 72, payloadKg: 25000 },
    mode: 'FLOOR',
    mixedPallet: false,
    restrictedMaterials: [],
    lines: [{ material: 'T0000001', boxes }],
    rules: { fullAt: 0.9 },
  };
}

test('caso 8: empate de utilização fica com o primeiro da lista (kg)', () => {
  const r = calculate(synthetic(500));
  assert.equal(r.utilization.kg, 0.5);
  assert.equal(r.utilization.m3, 0.5);
  assert.equal(r.binding, 'kg');
  assert.equal(r.status, 'PARTIAL');
});

test('fronteira: utilização exatamente igual a fullAt é FULL (regra 11, ≥)', () => {
  const r = calculate(synthetic(900, 10));
  assert.equal(r.utilization.kg, 0.9);
  assert.equal(r.binding, 'kg');
  assert.equal(r.status, 'FULL');
  assert.deepEqual(r.alerts, []);
});

test('entrada inválida lança EngineInputError', () => {
  const base = input(CASO_2);
  assert.throws(() => calculate({ ...base, lines: [{ material: '99999999', boxes: 1 }] }), EngineInputError);
  assert.throws(
    () => calculate({ ...base, lines: [{ material: '12031189', boxes: 1 }, { material: '12031189', boxes: 2 }] }),
    EngineInputError,
  );
  assert.throws(() => calculate({ ...base, lines: [{ material: '12031189', boxes: Number.NaN }] }), EngineInputError);
});
