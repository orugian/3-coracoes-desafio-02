// Paridade motor × calc() do index.html (docs/specs/01-motor.md, "Teste de paridade com o piloto").
// Se o front mudar o calc(), este teste falha: a mudança precisa ir também para o motor (ou virar engine_version 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculate, type EngineResult } from '#engine';
import {
  ALERT_FROM_PILOT, BINDING_FROM_PILOT, ENGINE_V1_PILOT_RULES, ORDER_ALERT_FROM_STATUS, PILOT_RULES_KEYS, ROOT_INDEX_HTML, STATUS_FROM_PILOT,
  loadFixture, loadPilotFunctions, pilotRulesDefaults, toEngineInput, type PilotData, type PilotOrder, type PilotResult,
} from './piloto.ts';

const SEED = 20261013;
const ORDERS = 500;
const TOL = 0.005;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case { order: PilotOrder; data: PilotData; noPriceSku: string | null }

function generate(fx: PilotData): Case[] {
  const rnd = mulberry32(SEED);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const codes = fx.P.map((p) => p.code);
  const cases: Case[] = [];
  for (let i = 0; i < ORDERS; i++) {
    const pool = [...codes];
    const n = int(1, 6);
    const qty: Record<string, number> = {};
    for (let k = 0; k < n; k++) {
      const [code] = pool.splice(Math.floor(rnd() * pool.length), 1);
      const boxes = int(1, 3000);
      qty[code] = rnd() < 0.1 ? boxes - 1 + int(1, 99) / 100 : boxes;
    }
    const order: PilotOrder = {
      qty,
      veh: pick(Object.keys(fx.VEH)),
      mode: pick(['pal', 'est'] as const),
      mixed: rnd() < 0.5,
      client: pick(Object.keys(fx.CLIENTS)),
    };
    const P = structuredClone(fx.P);
    let noPriceSku: string | null = null;
    if (rnd() < 0.1) {
      noPriceSku = pick(Object.keys(qty));
      const p = P.find((x) => x.code === noPriceSku)!;
      p.price = null;
      delete p.prices;
    }
    cases.push({ order, data: { ...fx, P }, noPriceSku });
  }
  return cases;
}

function diff(pilot: PilotResult, engine: EngineResult): string[] {
  const out: string[] = [];
  const eq = (label: string, a: unknown, b: unknown) => { if (a !== b) out.push(`${label}: piloto ${String(a)} × motor ${String(b)}`); };
  const near = (label: string, a: number, b: number, tol = TOL) => { if (!(Math.abs(a - b) <= tol)) out.push(`${label}: piloto ${a} × motor ${b}`); };
  eq('posições', pilot.tot.positions, engine.totals.positions);
  eq('status', STATUS_FROM_PILOT[pilot.status], engine.status);
  eq('limitante', BINDING_FROM_PILOT[pilot.bind], engine.binding);
  eq('blocking', pilot.blocking, engine.blocking);
  eq('over.positions', pilot.over.pos, engine.over.positions);
  near('over.kg', pilot.over.kg, engine.over.kg);
  near('over.m3', pilot.over.m3, engine.over.m3);
  eq('caixas', pilot.tot.cx, engine.totals.boxes);
  near('bruto', pilot.tot.gross, engine.totals.grossKg);
  near('líquido', pilot.tot.net, engine.totals.netKg);
  near('m³', pilot.tot.m3, engine.totals.m3);
  eq('valor (centavos)', Math.round(pilot.tot.value * 100), engine.totals.valueCents);
  const orderAlert = ORDER_ALERT_FROM_STATUS[pilot.status];
  eq('alertas do pedido', orderAlert ?? '', engine.alerts.map((a) => a.code).join(','));
  eq('materiais', pilot.lines.map((l) => l.p.code).join(','), engine.lines.map((l) => l.material).join(','));
  pilot.lines.forEach((pl, i) => {
    const el = engine.lines[i];
    if (!el) return;
    const tag = `linha ${pl.p.code}`;
    near(`${tag} pallets`, pl.pallets, el.pallets, 1e-9);
    eq(`${tag} caixas`, pl.cx, el.boxes);
    eq(`${tag} boxesToNextPallet`, pl.missing, el.boxesToNextPallet);
    eq(`${tag} alertas`, pl.issues.map((x) => ALERT_FROM_PILOT[x.k] ?? `?${x.k}`).sort().join(','), el.alerts.map((a) => a.code).sort().join(','));
  });
  return out;
}

const fx = loadFixture();
const bind = loadPilotFunctions();
const cases = generate(fx);
// O piloto roda com os RULES inteiros do HTML (como no navegador) e o perfil do engine_version 1 por cima, sobre os da
// fixture (f89cef4 não tinha os dois campos). Uma chave nova do HTML entra no cálculo e não passa calada.
const HTML_RULES = pilotRulesDefaults();
const withRules = (data: PilotData, rules: Record<string, unknown>): PilotData => ({ ...data, RULES: { ...data.RULES, ...HTML_RULES, ...rules } });
const runAll = (rules: Record<string, unknown>, binder = bind) => cases.map(({ order, data }) => {
  const d = withRules(data, rules);
  const fns = binder(d);
  const { qty, ...o } = order;
  return { pilot: fns.calc(qty, o), engine: calculate(toEngineInput(d, fns, order)) };
});
// index.html alterado num arquivo temporário (controles negativos).
function variantHtml(edit: (html: string) => string): string {
  const original = readFileSync(ROOT_INDEX_HTML, 'utf8');
  const changed = edit(original);
  assert.notEqual(changed, original, 'a variante precisa mudar o HTML');
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'psf-paridade-')), 'index.html');
  writeFileSync(file, changed);
  return file;
}
const results = runAll(ENGINE_V1_PILOT_RULES);

test(`motor e calc() do piloto dão o mesmo resultado em ${ORDERS} pedidos (semente ${SEED})`, () => {
  const failures = results.flatMap(({ pilot, engine }, i) => diff(pilot, engine).map((d) => `pedido ${i}: ${d}`));
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} divergências`);
});

test('os padrões de RULES no index.html são o perfil do engine_version 1 (senão o front mudou a regra: motor acompanha ou vira v2)', () => {
  const rules = pilotRulesDefaults();
  assert.equal(rules.minLotBlock, ENGINE_V1_PILOT_RULES.minLotBlock, 'RULES.minLotBlock');
  assert.equal(rules.fullPalBlock, ENGINE_V1_PILOT_RULES.fullPalBlock, 'RULES.fullPalBlock');
  assert.equal(rules.fullAt, fx.RULES.fullAt, 'RULES.fullAt');
  assert.equal(rules.leadDays, fx.RULES.leadDays, 'RULES.leadDays');
  assert.deepEqual(Object.keys(rules).sort(), [...PILOT_RULES_KEYS], 'chave nova em RULES: conferir se muda o calc()');
});

test('controle: chave nova em RULES no HTML é acusada', () => {
  const file = variantHtml((h) => h.replace('minLotBlock:true, fullPalBlock:false};', 'minLotBlock:true, fullPalBlock:false, minLotTol:0.5};'));
  try {
    assert.notDeepEqual(Object.keys(pilotRulesDefaults(file)).sort(), [...PILOT_RULES_KEYS]);
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('controle: com o lote mínimo só alertando ou o pallet incompleto bloqueando, o piloto diverge do motor', () => {
  for (const rules of [{ minLotBlock: false, fullPalBlock: false }, { minLotBlock: true, fullPalBlock: true }]) {
    const n = runAll(rules).filter(({ pilot, engine }) => diff(pilot, engine).some((d) => d.startsWith('blocking'))).length;
    assert.ok(n > 0, `nenhuma divergência com ${JSON.stringify(rules)}: a paridade não enxerga a regra`);
  }
});

test('controle: priceFor do HTML mudado (preço × 0,97) diverge no valor (o preço do motor não sai do priceFor)', () => {
  const file = variantHtml((h) => h.replace('return Math.round(p.price*cl.factor*100)/100}', 'return Math.round(p.price*cl.factor*0.97*100)/100}'));
  try {
    const n = runAll(ENGINE_V1_PILOT_RULES, loadPilotFunctions(file))
      .filter(({ pilot, engine }) => diff(pilot, engine).some((d) => d.startsWith('valor'))).length;
    assert.ok(n > 0, 'mudança no priceFor passou calada');
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('os pedidos sorteados exercitam todos os status e alertas da paridade', () => {
  const statuses = new Set(results.map((r) => r.engine.status));
  const alertCodes = new Set(results.flatMap((r) => [...r.engine.alerts, ...r.engine.lines.flatMap((l) => l.alerts)].map((a) => a.code)));
  for (const s of ['PARTIAL', 'FULL', 'EXCEEDED']) assert.ok(statuses.has(s as EngineResult['status']), `nenhum pedido ${s}`);
  for (const c of ['QTY_NOT_MULTIPLE', 'BELOW_MIN_LOT', 'NO_PRICE', 'COUNTRY_RESTRICTED', 'VEHICLE_EXCEEDED', 'PALLET_INCOMPLETE', 'VEHICLE_UNDERFILLED']) {
    assert.ok(alertCodes.has(c as never), `nenhum alerta ${c}`);
  }
  assert.ok(cases.some((c) => c.noPriceSku !== null), 'nenhum pedido sem preço');
  assert.ok(new Set(results.map((r) => r.engine.binding)).size === 3, 'algum limitante nunca aparece');
});
