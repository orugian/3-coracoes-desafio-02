// Itens do catálogo efetivo e veículos (docs/specs/02-banco.md, "Catálogo efetivo"; 04, CatalogItem e Vehicle).
// Base comum do portal (com o preço da lista do cliente) e do backoffice (com preços, SAP, overrides e OB).
import type { CatalogItem, ProductInternal, Vehicle } from '#contracts';
import type { Queryable } from '../ports/db.ts';

export type CatalogItemBase = Omit<CatalogItem, 'price'>;

interface ItemRow {
  code: string; family: string; brand: string; sap_description: string; units_label: string;
  units_per_box: number; net_kg: number | null; gross_kg: number | null; volume_dm3: number | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null;
  layer_boxes: number; layers: number; boxes_per_pallet: number; min_lot_pallets: number;
  ean: string | null; dun: string | null; ncm: string | null; product_line: string | null; shelf_life_days: number | null;
  name_pt: string | null; name_es: string | null; name_en: string | null;
}

// Campo obrigatório do contrato ausente no cadastro: falha alto (500 com log), em vez de mandar 0 para a UI.
function req<T>(value: T | null, field: string, code: string): T {
  if (value === null) throw new Error(`cadastro incompleto: ${field} do ${code}`);
  return value;
}

export async function catalogItems(q: Queryable, plant: string): Promise<CatalogItemBase[]> {
  const { rows } = await q.query<ItemRow>(
    `select e.code, e.family, m.brand, m.sap_description, m.units_label, e.units_per_box, e.net_kg, e.gross_kg, e.volume_dm3,
            e.length_mm, e.width_mm, e.height_mm, e.layer_boxes, e.layers, e.boxes_per_pallet, e.min_lot_pallets,
            m.ean, m.dun, m.ncm, m.product_line, m.shelf_life_days,
            pt.name as name_pt, es.name as name_es, en.name as name_en
       from material_effective e
       join material m on m.code = e.code
       left join material_i18n pt on pt.material_code = e.code and pt.lang = 'pt'
       left join material_i18n es on es.material_code = e.code and es.lang = 'es'
       left join material_i18n en on en.material_code = e.code and en.lang = 'en'
      where e.plant = $1
      order by e.code`,
    [plant]);
  return rows.map((r) => ({
    material: r.code,
    family: r.family,
    brand: r.brand,
    sapDescription: r.sap_description,
    names: { pt: req(r.name_pt, 'nome pt', r.code), es: req(r.name_es, 'nome es', r.code), en: req(r.name_en, 'nome en', r.code) },
    unitsLabel: r.units_label,
    unitsPerBox: Number(r.units_per_box),
    netKgPerBox: Number(req(r.net_kg, 'peso líquido', r.code)),
    grossKgPerBox: Number(req(r.gross_kg, 'peso bruto', r.code)),
    volumeDm3: Number(req(r.volume_dm3, 'volume', r.code)),
    dimsMm: {
      length: Number(req(r.length_mm, 'comprimento', r.code)),
      width: Number(req(r.width_mm, 'largura', r.code)),
      height: Number(req(r.height_mm, 'altura', r.code)),
    },
    layerBoxes: Number(r.layer_boxes),
    layers: Number(r.layers),
    boxesPerPallet: Number(r.boxes_per_pallet),
    minLotPallets: Number(r.min_lot_pallets),
    ean: r.ean,
    dun: r.dun,
    ncm: r.ncm,
    productLine: r.product_line,
    shelfLifeDays: r.shelf_life_days === null ? null : Number(r.shelf_life_days),
  }));
}

const FIELD_LABEL: Record<string, string> = {
  display_name: 'Nome', modal: 'Modal', volume_m3: 'Cubagem', payload_kg: 'Carga útil', pallet_positions: 'Posições de pallet',
};
const PRIMARY_SOURCE = 'container.json';

export async function vehicles(q: Queryable): Promise<Vehicle[]> {
  const { rows } = await q.query<{
    id: Vehicle['id']; display_name: string; modal: Vehicle['modal']; volume_m3: number; payload_kg: number; pallet_positions: number;
    source_by_field: Record<string, string>;
  }>('select id, display_name, modal, volume_m3, payload_kg, pallet_positions, source_by_field from vehicle_type order by sort_order, id');
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    modal: r.modal,
    volumeM3: Number(r.volume_m3),
    payloadKg: Number(r.payload_kg),
    palletPositions: Number(r.pallet_positions),
    // Premissas: os campos que não vêm da fonte principal (container.json), com a origem.
    assumptions: Object.entries(r.source_by_field ?? {})
      .filter(([, source]) => source !== PRIMARY_SOURCE)
      .map(([field, source]) => `${FIELD_LABEL[field] ?? field}: ${source}`),
  }));
}

// ---- backoffice: produto com origem do preço, SAP × adotado, overrides e valores da OB (04, ProductInternal)

// No corte há um centro (LONT → 2612). Com mais de um, o contrato precisa ganhar o centro: falha alto em vez de misturar.
export async function singlePlant(q: Queryable): Promise<string> {
  const { rows } = await q.query<{ plant: string }>('select distinct plant from branch_plant order by plant');
  if (rows.length !== 1) throw new Error(`backoffice/products supõe um centro só; há ${rows.length}`);
  return rows[0].plant;
}

const OVERRIDE_FIELD = { gross_kg: 'grossKgPerBox', layer_boxes: 'layerBoxes', layers: 'layers' } as const;
const num = (v: number | string | null) => (v === null ? null : Number(v));

export async function productsInternal(q: Queryable, exportChannel: string): Promise<ProductInternal[]> {
  const plant = await singlePlant(q);
  const base = await catalogItems(q, plant);
  const { rows: prices } = await q.query<{
    material_code: string; price_list: string; price: string; price_raw: string | null; origin: ProductInternal['prices'][number]['origin']; valid_from: string; valid_to: string;
  }>(
    `select material_code, price_list, price::text, price_raw::text, origin, valid_from, valid_to
       from price
      where channel = $1 and plant = $2 and uom = 'CX' and customer_code is null
      order by material_code, price_list, valid_from, id`,
    [exportChannel, plant]);
  const { rows: sap } = await q.query<{ material_code: string; layer_boxes: number; layers: number; min_lot_source: ProductInternal['minLotSource']; gross_kg: number | null }>(
    `select p.material_code, p.layer_boxes, p.layers, p.min_lot_source, cx.gross_kg
       from palletization p join material_uom cx on cx.material_code = p.material_code and cx.uom = 'CX'
      where p.plant = $1`,
    [plant]);
  const { rows: overrides } = await q.query<{
    material_code: string; field: keyof typeof OVERRIDE_FIELD; sap_value: number; adopted_value: number; justification: string; decision_ref: string;
    proposed_by: string; confirmed_by: string; confirmed_at: Date;
  }>(
    `select o.material_code, o.field, o.sap_value, o.adopted_value, o.justification, o.decision_ref,
            pu.display_name as proposed_by, cu.display_name as confirmed_by, o.confirmed_at
       from master_override o
       join app_user pu on pu.id = o.proposed_by
       join app_user cu on cu.id = o.confirmed_by
      where o.status = 'ACTIVE' and ((o.entity = 'material_uom' and o.key_part = 'CX') or (o.entity = 'palletization' and o.key_part = $1))
      order by o.id`,
    [plant]);
  const { rows: ob } = await q.query<{
    material_code: string; boxes_per_pallet_tab: number | null; boxes_per_pallet_paletizacao: number | null; price_tab: number | null;
    min_lot_lookup: number | null; gross_kg_per_box_line: number | null;
  }>('select * from material_ob_reference');

  return base.map((item) => {
    const s = sap.find((r) => r.material_code === item.material);
    if (!s) throw new Error(`paletização ausente: ${item.material} no centro ${plant}`);
    const o = ob.find((r) => r.material_code === item.material);
    return {
      ...item,
      prices: prices.filter((p) => p.material_code === item.material).map((p) => ({
        priceList: p.price_list, price: Number(p.price), priceRaw: num(p.price_raw), origin: p.origin, validFrom: p.valid_from, validTo: p.valid_to,
      })),
      sap: { layerBoxes: Number(s.layer_boxes), layers: Number(s.layers), grossKgPerBox: num(s.gross_kg) },
      overrides: overrides.filter((r) => r.material_code === item.material).map((r) => ({
        field: OVERRIDE_FIELD[r.field], sapValue: Number(r.sap_value), adoptedValue: Number(r.adopted_value), justification: r.justification,
        decisionRef: r.decision_ref, proposedBy: r.proposed_by, confirmedBy: r.confirmed_by, confirmedAt: new Date(r.confirmed_at).toISOString(),
      })),
      ob: {
        boxesPerPallet: num(o?.boxes_per_pallet_tab ?? null), palletizationBoxes: num(o?.boxes_per_pallet_paletizacao ?? null),
        price: num(o?.price_tab ?? null), minLot: num(o?.min_lot_lookup ?? null), grossKgPerBox: num(o?.gross_kg_per_box_line ?? null),
      },
      minLotSource: s.min_lot_source,
    };
  });
}
