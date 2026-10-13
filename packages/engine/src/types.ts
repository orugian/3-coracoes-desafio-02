// Contrato do motor, engine_version 1 (docs/specs/01-motor.md, "Contrato").

export type LoadMode = 'PALLETIZED' | 'FLOOR'; // piloto: "pal" | "est"
export type Severity = 'BLOCK' | 'WARN';
export type AlertCode =
  | 'QTY_NOT_MULTIPLE' | 'BELOW_MIN_LOT' | 'NO_PRICE' | 'COUNTRY_RESTRICTED' | 'VEHICLE_EXCEEDED' // BLOCK
  | 'PALLET_INCOMPLETE' | 'VEHICLE_UNDERFILLED'; // WARN

export interface EngineItem {
  material: string;
  family: string;
  unitsPerBox: number;
  netKgPerBox: number;
  grossKgPerBox: number;
  volumeDm3: number; // volume declarado (engine_version 1)
  layerBoxes: number; // lastro efetivo (SAP ou override)
  layers: number; // camadas efetivas
  minLotPallets: number;
  priceCents: number | null; // preço da lista do cliente, já arredondado a 2 casas; null = sem preço
}

export interface EngineVehicle { id: string; palletPositions: number; volumeM3: number; payloadKg: number }

export interface EngineInput {
  engineVersion: 1;
  items: EngineItem[]; // a ordem define a ordem das linhas no resultado
  vehicle: EngineVehicle;
  mode: LoadMode;
  mixedPallet: boolean;
  restrictedMaterials: string[]; // de country_rule para o cliente
  lines: { material: string; boxes: number }[]; // caixas; fração é aceita e vira QTY_NOT_MULTIPLE
  rules: { fullAt: number }; // 0,9
}

export interface Alert { code: AlertCode; severity: Severity; material?: string; params?: Record<string, number> }

export interface LineResult {
  material: string;
  requestedBoxes: number;
  boxes: number; // inteiro: arredondado para cima se fracionário
  pallets: number; // boxes ÷ (layerBoxes × layers), sem arredondar
  fullPallets: number;
  boxesToNextPallet: number; // 0 se fecha pallet
  netKg: number;
  grossKg: number;
  m3: number;
  priceCents: number | null;
  valueCents: number; // boxes × priceCents (0 sem preço)
  alerts: Alert[];
}

export type Binding = 'kg' | 'm3' | 'positions';
export type LoadStatus = 'EMPTY' | 'PARTIAL' | 'FULL' | 'EXCEEDED';

export interface EngineResult {
  engineVersion: 1;
  lines: LineResult[];
  totals: { boxes: number; pallets: number; positions: number; netKg: number; grossKg: number; m3: number; valueCents: number };
  utilization: { kg: number; m3: number; positions: number | null }; // frações (1 = 100%); positions null em FLOOR
  binding: Binding;
  status: LoadStatus;
  over: { positions: number; kg: number; m3: number };
  alerts: Alert[]; // do pedido (VEHICLE_EXCEEDED, VEHICLE_UNDERFILLED)
  blocking: boolean; // pedido sem linhas, ou algum BLOCK em linha ou no pedido (regra de f89cef4)
}
