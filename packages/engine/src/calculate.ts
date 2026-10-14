// calc() do piloto (f89cef4) como função pura: mesmas regras, arredondamentos e desempate (docs/specs/01-motor.md, "Regras").
// As operações de ponto flutuante seguem a ordem do piloto (por exemplo, m³ = caixas × (dm³ ÷ 1000)), para a paridade ser exata.
import type { Alert, Binding, EngineInput, EngineResult, LineResult, LoadStatus } from './types.ts';

export const ENGINE_VERSION = 1;

const EPS = 1e-9;

export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

function requestedBoxes(input: EngineInput): Map<string, number> {
  const known = new Set(input.items.map((i) => i.material));
  const qty = new Map<string, number>();
  for (const { material, boxes } of input.lines) {
    if (!known.has(material)) throw new EngineInputError(`material fora do catálogo: ${material}`);
    if (qty.has(material)) throw new EngineInputError(`material repetido nas linhas: ${material}`);
    if (!Number.isFinite(boxes)) throw new EngineInputError(`quantidade inválida para ${material}`);
    qty.set(material, boxes);
  }
  return qty;
}

export function calculate(input: EngineInput): EngineResult {
  const qty = requestedBoxes(input);
  const restricted = new Set(input.restrictedMaterials);
  const lines: LineResult[] = [];
  const totals = { boxes: 0, pallets: 0, positions: 0, netKg: 0, grossKg: 0, m3: 0, valueCents: 0 };

  for (const item of input.items) {
    const requested = qty.get(item.material);
    if (requested === undefined) continue;
    const raw = Math.max(0, requested);
    if (raw < EPS) continue;

    // 1. Caixas inteiras; fração vira QTY_NOT_MULTIPLE e a linha conta o próximo inteiro.
    const isInt = Math.abs(raw - Math.round(raw)) < 1e-6;
    const boxes = isInt ? Math.round(raw) : Math.ceil(raw);
    // 2. Pallets.
    const boxesPerPallet = item.layerBoxes * item.layers;
    const pallets = boxes / boxesPerPallet;
    const fullPallets = Math.floor(pallets + EPS);
    const hasFraction = pallets - fullPallets > EPS;
    const boxesToNextPallet = hasFraction ? Math.ceil(boxesPerPallet * (fullPallets + 1) - boxes - EPS) : 0;
    // 3 e 4. Pesos, volume e valor (centavos inteiros, D9).
    const netKg = boxes * item.netKgPerBox;
    const grossKg = boxes * item.grossKgPerBox;
    const m3 = boxes * (item.volumeDm3 / 1000);
    const valueCents = item.priceCents === null ? 0 : boxes * item.priceCents;

    const alerts: Alert[] = [];
    const material = item.material;
    if (!isInt) alerts.push({ code: 'QTY_NOT_MULTIPLE', severity: 'BLOCK', material, params: { lo: Math.floor(raw), hi: Math.ceil(raw) } });
    if (item.priceCents === null) alerts.push({ code: 'NO_PRICE', severity: 'BLOCK', material });
    if (restricted.has(material)) alerts.push({ code: 'COUNTRY_RESTRICTED', severity: 'BLOCK', material });
    if (pallets + EPS < item.minLotPallets) {
      alerts.push({ code: 'BELOW_MIN_LOT', severity: 'BLOCK', material, params: { minLot: item.minLotPallets } });
    }
    if (hasFraction && input.mode === 'PALLETIZED') {
      alerts.push({ code: 'PALLET_INCOMPLETE', severity: 'WARN', material, params: { boxesToNextPallet, nextPallet: fullPallets + 1 } });
    }

    lines.push({
      material, requestedBoxes: requested, boxes, pallets, fullPallets, boxesToNextPallet,
      netKg, grossKg, m3, priceCents: item.priceCents, valueCents, alerts,
    });
    totals.boxes += boxes;
    totals.pallets += pallets;
    totals.netKg += netKg;
    totals.grossKg += grossKg;
    totals.m3 += m3;
    totals.valueCents += valueCents;
    // 8. Posições por linha; com pallet misto, sobre a soma dos pallets.
    totals.positions += Math.ceil(pallets - EPS);
  }
  if (input.mixedPallet && lines.length > 0) totals.positions = Math.ceil(totals.pallets - EPS);

  // 9 e 10. Utilização e recurso limitante (empate fica com o primeiro da lista, como o reduce do piloto).
  const { vehicle } = input;
  const palletized = input.mode === 'PALLETIZED';
  const utilization = {
    kg: totals.grossKg / vehicle.payloadKg,
    m3: totals.m3 / vehicle.volumeM3,
    positions: palletized ? totals.positions / vehicle.palletPositions : null,
  };
  const candidates: [Binding, number][] = [['kg', utilization.kg], ['m3', utilization.m3]];
  if (utilization.positions !== null) candidates.push(['positions', utilization.positions]);
  let [binding, maxUtilization] = candidates[0];
  for (const [key, value] of candidates) {
    if (value > maxUtilization) [binding, maxUtilization] = [key, value];
  }

  // 11 e 12. Status, excesso e alertas do pedido.
  const over = {
    positions: palletized ? Math.max(0, totals.positions - vehicle.palletPositions) : 0,
    kg: Math.max(0, totals.grossKg - vehicle.payloadKg),
    m3: Math.max(0, totals.m3 - vehicle.volumeM3),
  };
  const status: LoadStatus = lines.length === 0 ? 'EMPTY'
    : maxUtilization > 1 + EPS ? 'EXCEEDED'
    : maxUtilization >= input.rules.fullAt ? 'FULL'
    : 'PARTIAL';
  const alerts: Alert[] = [];
  if (status === 'EXCEEDED') alerts.push({ code: 'VEHICLE_EXCEEDED', severity: 'BLOCK', params: { ...over } });
  if (status === 'PARTIAL') alerts.push({ code: 'VEHICLE_UNDERFILLED', severity: 'WARN' });

  // 13. Bloqueio: sem linhas ou algum BLOCK.
  const blocking = lines.length === 0
    || alerts.some((a) => a.severity === 'BLOCK')
    || lines.some((l) => l.alerts.some((a) => a.severity === 'BLOCK'));

  return { engineVersion: ENGINE_VERSION, lines, totals, utilization, binding, status, over, alerts, blocking };
}
