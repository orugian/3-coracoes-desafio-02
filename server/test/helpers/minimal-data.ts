// Dados mínimos para os testes do banco (S2). Valores do piloto; o seed completo é da S3.
import type { Queryable } from '#server/ports/db.ts';

export interface MinimalIds {
  batch: number;
  users: { admin: number; ana: number; lucas: number; martin: number };
  overrideLayerBoxes: number;
}

async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await q.query<T>(sql, params);
  if (rows.length !== 1) throw new Error(`esperava 1 linha, veio ${rows.length}: ${sql}`);
  return rows[0];
}

export async function insertMinimalData(q: Queryable): Promise<MinimalIds> {
  const { id: batch } = await one<{ id: number }>(q,
    `insert into import_batch (source, file_name, file_sha256, status, created_by)
     values ('DECISOES', 'teste', 'sha-teste', 'ACTIVE', 'teste') returning id`);

  const user = async (username: string, role: string) =>
    (await one<{ id: number }>(q,
      `insert into app_user (username, display_name, role, password_hash) values ($1, $1, $2, 'x') returning id`,
      [username, role])).id;
  const users = {
    admin: await user('admin.dados', 'int_admin'),
    ana: await user('ana.exportacao', 'int_exportacao'),
    lucas: await user('lucas.exportacao', 'int_exportacao'),
    martin: await user('martin.minoil', 'ext_distribuidor'),
  };

  await q.query(`insert into branch_plant (branch, plant, plant_name) values ('LONT', '2612', 'CD Londrina'), ('OUTR', '9999', 'Outro centro')`);
  await q.query(
    `insert into customer (code, slug, name, country, destination_label, currency, incoterm, payment_code, payment_terms,
                           price_list, branch, contact_name, language, mixed_pallet, auto_approve, is_demo, batch_id)
     values ('11131', 'minoil', 'MINOIL S.A.', null, 'Mercosul', 'USD', 'FCA', '2304', 'Standby irrevogável 60 dias', 'US', 'LONT', 'Martín', 'pt', false, false, false, $1),
            ('11999', 'rioclaro', 'Distribuidora Río Claro S.R.L.', 'AR', 'Argentina', 'USD', 'FCA', '0030', 'Antecipado 30 dias', 'AR', 'LONT', 'Sofía', 'es', true, false, true, $1)`,
    [batch]);

  // code, família, un/cx, líquido, bruto, dm³, lastro, altura, lote mínimo
  const materials: [string, string, number, number, number, number, number, number, number][] = [
    ['12031189', 'CAFES', 20, 5.0, 5.33, 13.276, 14, 12, 1],
    ['12034109', 'CAPPUCCINO', 24, 4.8, 6.177, 21.279, 4, 7, 1],
    ['20908885', 'PORTA', 12, 0.552, 1.24, 25.35, 11, 10, 1],
  ];
  for (const [code, family, un, net, gross, dm3, lastro, alt, lote] of materials) {
    await q.query(
      `insert into material (code, sap_description, family, brand, units_label, batch_id) values ($1, $1, $2, '3corações', $1, $3)`,
      [code, family, batch]);
    await q.query(
      `insert into material_uom (material_code, uom, units_per_uom, volume_dm3, net_kg, gross_kg, weight_unit_raw, batch_id)
       values ($1, 'CX', $2, $3, $4, $5, 'KG', $6)`,
      [code, un, dm3, net, gross, batch]);
    await q.query(
      `insert into palletization (material_code, plant, layer_boxes, layers, min_lot_pallets, min_lot_source, batch_id)
       values ($1, '2612', $2, $3, $4, 'OB_PALETIZACAO', $5)`,
      [code, lastro, alt, lote, batch]);
  }
  // Outro centro, para conferir que a entrada do motor usa o centro do cliente.
  await q.query(
    `insert into palletization (material_code, plant, layer_boxes, layers, min_lot_pallets, min_lot_source, batch_id)
     values ('12031189', '9999', 1, 1, 1, 'DEFAULT', $1)`, [batch]);

  const price = (list: string, material: string, value: number, origin: string) =>
    q.query(
      `insert into price (channel, plant, price_list, material_code, valid_from, valid_to, price, currency, origin, batch_id)
       values ('13', '2612', $1, $2, '2026-01-01', '9999-12-31', $3, 'USD', $4, $5)`,
      [list, material, value, origin, batch]);
  await price('US', '12031189', 49.41, 'SAP_LIST');
  await price('US', '12034109', 36.96, 'SITE_3C');
  await price('AR', '12031189', 52.37, 'DEMO_DERIVED');
  await price('AR', '12034109', 39.18, 'DEMO_DERIVED');
  await price('AR', '20908885', 18.67, 'DEMO_DERIVED');
  // 20908885 sem preço na lista US: NO_PRICE para a MINOIL.

  await q.query(
    `insert into vehicle_type (id, display_name, modal, volume_m3, payload_kg, pallet_positions, source_by_field, sort_order)
     values ('carreta_padrao', 'Carreta', 'rodoviario', 72, 25000, 28, '{}'::jsonb, 1),
            ('container_40', 'Contêiner 40''', 'maritimo', 60.84, 25000, 20, '{}'::jsonb, 2)`);
  await q.query(
    `insert into country_rule (country, customer_code, material_code, kind, reason, is_demo)
     values ('AR', '11999', '20908885', 'BLOCK', 'Regra de demonstração do piloto (Q5)', true),
            ('UY', null, '12031189', 'BLOCK', 'Outro país', true)`);

  const { id: overrideLayerBoxes } = await one<{ id: number }>(q,
    `insert into master_override (entity, material_code, key_part, field, sap_value, adopted_value, justification, decision_ref,
                                  status, proposed_by, confirmed_by, confirmed_at)
     values ('palletization', '12034109', '2612', 'layer_boxes', 4, 14, 'Q12', 'Q12', 'ACTIVE', $1, $2, now()) returning id`,
    [users.admin, users.ana]);

  return { batch, users, overrideLayerBoxes };
}

// Pedido com uma versão e um evento, para os testes de imutabilidade.
export async function insertOrder(q: Queryable, ids: MinimalIds, id = '3CC-2026-0001', idempotencyKey: string | null = null): Promise<void> {
  await q.query(
    `insert into sales_order (id, customer_code, status, current_version, origin, created_by, idempotency_key)
     values ($1, '11131', 'SUBMITTED', 1, 'PORTAL', $2, $3)`,
    [id, ids.users.martin, idempotencyKey]);
  await q.query(
    `insert into order_version (order_id, version_no, vehicle_id, load_mode, mixed_pallet, lines, engine_version, engine_result,
                                blocking, data_batches, content_hash, author_id, author_label)
     values ($1, 1, 'carreta_padrao', 'PALLETIZED', false, '[]'::jsonb, 1, '{}'::jsonb, true, '[]'::jsonb, 'h', $2, 'Martín')`,
    [id, ids.users.martin]);
  await q.query(
    `insert into order_event (order_id, actor_id, actor_label, type, to_status, version_no) values ($1, $2, 'Martín', 'SUBMITTED', 'SUBMITTED', 1)`,
    [id, ids.users.martin]);
}
