// Preço vigente e montagem da entrada do motor (docs/specs/02-banco.md, "Catálogo efetivo").
// Usado pelo portal, pelo backoffice, pelo seed e pelos testes. Converte aqui os tipos que o driver devolve como texto.
import type { EngineInput, EngineItem, LoadMode } from '#engine';
import type { Queryable } from '../ports/db.ts';

const EXPORT_CHANNEL = '13'; // Exportação, o único canal dos exports do SAP
export const FULL_AT = 0.9;

export interface ResolvedPrice { priceCents: number | null; priceId: number | null; batchId: number | null }
export interface EngineHeader { vehicleId: string; loadMode: LoadMode }
export interface OrderLineInput { material: string; boxes: number }
export interface BuiltEngineInput {
  input: EngineInput;
  dataBatches: number[]; // import_batch dos dados que as linhas do pedido usaram (cliente, cadastro, paletização, preço)
  overrides: number[]; // master_override ACTIVE que valem para as linhas do pedido
  priceDate: string; // YYYY-MM-DD, vai para engine_result.inputs
}

interface PriceRow { material_code: string; id: number | string; price: string; batch_id: number | string }

// Linha de price com canal 13, lista do cliente, centro da filial, CX e vigência em d; o preço do cliente vence o da lista
// e, entre janelas sobrepostas, vence a de valid_from mais recente.
async function priceRows(q: Queryable, customerCode: string, priceDate: string, materialCode: string | null): Promise<PriceRow[]> {
  const { rows } = await q.query<PriceRow>(
    `select distinct on (p.material_code) p.material_code, p.id, p.price::text as price, p.batch_id
       from customer c
       join branch_plant b on b.branch = c.branch
       join price p on p.price_list = c.price_list and p.plant = b.plant
      where c.code = $1
        and p.channel = $2 and p.uom = 'CX'
        and p.valid_from <= $3::date and $3::date <= p.valid_to
        and (p.customer_code = c.code or p.customer_code is null)
        and ($4::text is null or p.material_code = $4::text)
      order by p.material_code, (p.customer_code is null), p.valid_from desc, p.id desc`,
    [customerCode, EXPORT_CHANNEL, priceDate, materialCode]);
  return rows;
}

const toResolved = (row: PriceRow | undefined): ResolvedPrice => row
  ? { priceCents: Math.round(Number(row.price) * 100), priceId: Number(row.id), batchId: Number(row.batch_id) }
  : { priceCents: null, priceId: null, batchId: null };

export async function resolvePrice(q: Queryable, customerCode: string, materialCode: string, priceDate: string): Promise<ResolvedPrice> {
  return toResolved((await priceRows(q, customerCode, priceDate, materialCode))[0]);
}

// Preço vigente de todos os materiais da lista do cliente (catálogo do portal e entrada do motor).
export async function customerPrices(q: Queryable, customerCode: string, priceDate: string): Promise<Map<string, ResolvedPrice>> {
  return new Map((await priceRows(q, customerCode, priceDate, null)).map((r) => [r.material_code, toResolved(r)]));
}

// Materiais bloqueados para o cliente (country_rule do país dele, geral ou só para ele).
export async function restrictedMaterials(q: Queryable, customerCode: string): Promise<string[]> {
  const { rows } = await q.query<{ material_code: string }>(
    `select distinct r.material_code
       from customer c
       join country_rule r on r.country = c.country and (r.customer_code is null or r.customer_code = c.code)
      where c.code = $1 and r.kind = 'BLOCK'
      order by r.material_code`,
    [customerCode]);
  return rows.map((r) => r.material_code);
}

interface CustomerRow { code: string; mixed_pallet: boolean; plant: string; batch_id: number | string }
interface ItemRow {
  code: string; family: string; units_per_box: number; net_kg: number | null; gross_kg: number | null; volume_dm3: number | null;
  layer_boxes: number; layers: number; min_lot_pallets: number;
  material_batch: number | string; uom_batch: number | string; pallet_batch: number | string;
}

function requireNumber(value: number | null, field: string, material: string): number {
  if (value === null || !Number.isFinite(Number(value))) throw new Error(`cadastro incompleto: ${field} do ${material} na UM CX`);
  return Number(value);
}

export async function buildEngineInput(
  q: Queryable, customerCode: string, header: EngineHeader, lines: OrderLineInput[], priceDate: string,
): Promise<BuiltEngineInput> {
  const { rows: [customer] } = await q.query<CustomerRow>(
    `select c.code, c.mixed_pallet, b.plant, c.batch_id from customer c join branch_plant b on b.branch = c.branch where c.code = $1`,
    [customerCode]);
  if (!customer) throw new Error(`cliente inexistente: ${customerCode}`);

  const { rows: [vehicle] } = await q.query<{ id: string; pallet_positions: number; volume_m3: number; payload_kg: number }>(
    'select id, pallet_positions, volume_m3, payload_kg from vehicle_type where id = $1', [header.vehicleId]);
  if (!vehicle) throw new Error(`veículo inexistente: ${header.vehicleId}`);

  const { rows: itemRows } = await q.query<ItemRow>(
    `select e.code, e.family, e.units_per_box, e.net_kg, e.gross_kg, e.volume_dm3, e.layer_boxes, e.layers, e.min_lot_pallets,
            m.batch_id as material_batch, cx.batch_id as uom_batch, p.batch_id as pallet_batch
       from material_effective e
       join material m on m.code = e.code
       join material_uom cx on cx.material_code = e.code and cx.uom = 'CX'
       join palletization p on p.material_code = e.code and p.plant = e.plant
      where e.plant = $1
      order by e.code`,
    [customer.plant]);

  const prices = await customerPrices(q, customerCode, priceDate);
  const restricted = await restrictedMaterials(q, customerCode);

  const items: EngineItem[] = itemRows.map((r) => ({
    material: r.code,
    family: r.family,
    unitsPerBox: Number(r.units_per_box),
    netKgPerBox: requireNumber(r.net_kg, 'peso líquido', r.code),
    grossKgPerBox: requireNumber(r.gross_kg, 'peso bruto', r.code),
    volumeDm3: requireNumber(r.volume_dm3, 'volume', r.code),
    layerBoxes: Number(r.layer_boxes),
    layers: Number(r.layers),
    minLotPallets: Number(r.min_lot_pallets),
    priceCents: prices.get(r.code)?.priceCents ?? null,
  }));

  // Proveniência só do que as linhas do pedido usaram: um override ou lote de outro SKU não muda o content_hash.
  const used = new Set(lines.map((l) => l.material));
  const batches = new Set<number>([Number(customer.batch_id)]);
  for (const r of itemRows) {
    if (!used.has(r.code)) continue;
    for (const b of [r.material_batch, r.uom_batch, r.pallet_batch]) batches.add(Number(b));
    const price = prices.get(r.code);
    if (price?.batchId != null) batches.add(price.batchId);
  }
  const { rows: overrideRows } = await q.query<{ id: number | string; material_code: string }>(
    `select id, material_code from master_override
      where status = 'ACTIVE'
        and ((entity = 'material_uom' and key_part = 'CX') or (entity = 'palletization' and key_part = $1))
      order by id`,
    [customer.plant]);

  return {
    input: {
      engineVersion: 1,
      items,
      vehicle: { id: vehicle.id, palletPositions: Number(vehicle.pallet_positions), volumeM3: Number(vehicle.volume_m3), payloadKg: Number(vehicle.payload_kg) },
      mode: header.loadMode,
      mixedPallet: customer.mixed_pallet, // do cliente, nunca do corpo da requisição (04)
      restrictedMaterials: restricted,
      lines: lines.map((l) => ({ material: l.material, boxes: l.boxes })),
      rules: { fullAt: FULL_AT },
    },
    dataBatches: [...batches].sort((a, b) => a - b),
    overrides: overrideRows.filter((o) => used.has(o.material_code)).map((o) => Number(o.id)),
    priceDate,
  };
}
