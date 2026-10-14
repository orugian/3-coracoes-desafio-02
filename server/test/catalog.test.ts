// Catálogo efetivo (view), preço vigente e montagem da entrada do motor (docs/specs/02-banco.md, "Catálogo efetivo").
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '#engine';
import { createPgliteDb } from '#server/adapters/db/pglite.ts';
import type { Db } from '#server/ports/db.ts';
import { migrate } from '#server/db/migrate.ts';
import { buildEngineInput, resolvePrice } from '#server/repo/catalog.ts';
import { saoPauloDate } from '#server/domain/time.ts';
import { insertMinimalData, type MinimalIds } from './helpers/minimal-data.ts';

const carreta = { vehicleId: 'carreta_padrao', loadMode: 'PALLETIZED' as const };

describe('catálogo efetivo e entrada do motor', () => {
  let db: Db;
  let ids: MinimalIds;
  before(async () => {
    db = await createPgliteDb();
    await migrate(db);
    ids = await db.tx((q) => insertMinimalData(q));
  });
  after(async () => { await db.close(); });

  test('a view aplica o override ACTIVE (14 × 7 no 12034109) e mantém o SAP intacto', async () => {
    const eff = await db.query<{ layer_boxes: number; layers: number; boxes_per_pallet: number }>(
      `select layer_boxes, layers, boxes_per_pallet from material_effective where code = '12034109' and plant = '2612'`);
    assert.deepEqual(eff.rows, [{ layer_boxes: 14, layers: 7, boxes_per_pallet: 98 }]);
    const sap = await db.query(`select layer_boxes, layers, boxes_per_pallet from palletization where material_code = '12034109' and plant = '2612'`);
    assert.deepEqual(sap.rows, [{ layer_boxes: 4, layers: 7, boxes_per_pallet: 28 }]);
    // Override de outro centro não vale para o 2612.
    const other = await db.query(`select layer_boxes from material_effective where code = '12031189' order by plant`);
    assert.deepEqual(other.rows, [{ layer_boxes: 14 }, { layer_boxes: 1 }]);
  });

  test('override REVOKED deixa de valer', async () => {
    await db.tx(async (q) => {
      await q.query(`update master_override set status = 'REVOKED' where id = $1`, [ids.overrideLayerBoxes]);
      const { rows } = await q.query(`select layer_boxes from material_effective where code = '12034109' and plant = '2612'`);
      assert.deepEqual(rows, [{ layer_boxes: 4 }]);
      throw new Error('desfaz');
    }).catch(() => undefined);
    const { rows } = await db.query(`select layer_boxes from material_effective where code = '12034109' and plant = '2612'`);
    assert.deepEqual(rows, [{ layer_boxes: 14 }]);
  });

  test('resolvePrice: lista do cliente, centro da filial, vigência e numeric convertido em centavos', async () => {
    assert.deepEqual(await resolvePrice(db, '11131', '12031189', '2026-10-13'), { priceCents: 4941, priceId: 1, batchId: ids.batch });
    assert.equal((await resolvePrice(db, '11999', '12031189', '2026-10-13')).priceCents, 5237, 'lista AR');
    assert.equal((await resolvePrice(db, '11131', '20908885', '2026-10-13')).priceCents, null, 'sem linha na lista US');
    assert.equal((await resolvePrice(db, '11131', '12031189', '2025-12-31')).priceCents, null, 'antes da vigência');
  });

  test('resolvePrice prefere o preço do cliente ao da lista e, entre janelas sobrepostas, a de valid_from mais recente', async () => {
    await db.tx(async (q) => {
      const add = (customer: string | null, from: string, to: string, value: number) => q.query(
        `insert into price (channel, plant, price_list, customer_code, material_code, valid_from, valid_to, price, currency, origin, batch_id)
         values ('13', '2612', 'US', $1, '12034109', $2, $3, $4, 'USD', 'SAP_LIST', $5)`, [customer, from, to, value, ids.batch]);
      await add(null, '2026-10-01', '2026-10-31', 37.5);
      assert.equal((await resolvePrice(q, '11131', '12034109', '2026-10-13')).priceCents, 3750, 'janela mais recente');
      assert.equal((await resolvePrice(q, '11131', '12034109', '2026-11-01')).priceCents, 3696, 'volta à janela longa');
      await add('11131', '2026-01-01', '9999-12-31', 35);
      assert.equal((await resolvePrice(q, '11131', '12034109', '2026-10-13')).priceCents, 3500, 'preço do cliente');
      // Canal diferente de 13 não vale.
      await q.query(
        `insert into price (channel, plant, price_list, material_code, valid_from, valid_to, price, currency, origin, batch_id)
         values ('10', '2612', 'US', '20908885', '2026-01-01', '9999-12-31', 1, 'USD', 'SAP_LIST', $1)`, [ids.batch]);
      assert.equal((await resolvePrice(q, '11131', '20908885', '2026-10-13')).priceCents, null);
      throw new Error('desfaz');
    }).catch((e: unknown) => { if (!(e instanceof Error) || e.message !== 'desfaz') throw e; });
  });

  test('buildEngineInput monta a entrada na ordem do catálogo, com o centro, o preço, as restrições e o pallet misto do cliente', async () => {
    const lines = [{ material: '20908885', boxes: 110 }, { material: '12034109', boxes: 140 }];
    const built = await buildEngineInput(db, '11999', { vehicleId: 'container_40', loadMode: 'PALLETIZED' }, lines, '2026-10-13');
    const { input } = built;
    assert.equal(input.engineVersion, 1);
    assert.deepEqual(input.items.map((i) => i.material), ['12031189', '12034109', '20908885']);
    assert.deepEqual(input.items[0], {
      material: '12031189', family: 'CAFES', unitsPerBox: 20, netKgPerBox: 5, grossKgPerBox: 5.33, volumeDm3: 13.276,
      layerBoxes: 14, layers: 12, minLotPallets: 1, priceCents: 5237,
    });
    assert.equal(input.items[1].layerBoxes, 14, 'override aplicado');
    assert.deepEqual(input.vehicle, { id: 'container_40', palletPositions: 20, volumeM3: 60.84, payloadKg: 25000 });
    assert.equal(input.mode, 'PALLETIZED');
    assert.equal(input.mixedPallet, true, 'vem de customer.mixed_pallet');
    assert.deepEqual(input.restrictedMaterials, ['20908885'], 'só a regra do país e do cliente');
    assert.deepEqual(input.lines, lines);
    assert.deepEqual(input.rules, { fullAt: 0.9 });
    assert.deepEqual(built.dataBatches, [ids.batch]);
    assert.deepEqual(built.overrides, [ids.overrideLayerBoxes], 'o override do 12034109 foi usado');
    assert.equal(built.priceDate, '2026-10-13');

    const result = calculate(input);
    assert.ok(result.lines.find((l) => l.material === '20908885')?.alerts.some((a) => a.code === 'COUNTRY_RESTRICTED'));
    assert.equal(result.lines.find((l) => l.material === '12034109')?.boxesToNextPallet, 56, '140 cx com 98 por pallet');
  });

  test('buildEngineInput sem país (MINOIL): sem restrições; override fora das linhas não entra em overrides; sem preço vira null', async () => {
    const built = await buildEngineInput(db, '11131', carreta, [{ material: '12031189', boxes: 168 }, { material: '20908885', boxes: 110 }], '2026-10-13');
    assert.deepEqual(built.input.restrictedMaterials, []);
    assert.equal(built.input.mixedPallet, false);
    assert.deepEqual(built.overrides, []);
    assert.equal(built.input.items.find((i) => i.material === '20908885')?.priceCents, null);
    const result = calculate(built.input);
    assert.ok(result.lines.find((l) => l.material === '20908885')?.alerts.some((a) => a.code === 'NO_PRICE'));
  });

  test('buildEngineInput recusa cliente ou veículo inexistente', async () => {
    await assert.rejects(buildEngineInput(db, '00000', carreta, [], '2026-10-13'), /cliente/i);
    await assert.rejects(buildEngineInput(db, '11131', { vehicleId: 'navio', loadMode: 'FLOOR' }, [], '2026-10-13'), /veículo/i);
  });
});

test('saoPauloDate usa o fuso de São Paulo', () => {
  assert.equal(saoPauloDate(new Date('2026-10-14T02:59:00Z')), '2026-10-13');
  assert.equal(saoPauloDate(new Date('2026-10-14T03:00:00Z')), '2026-10-14');
});
