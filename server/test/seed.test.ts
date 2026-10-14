// Seed completo em PGlite em memória (docs/specs/03-seed.md, "Testes do seed").
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { calculate, type EngineResult } from '#engine';
import { createPgliteDb } from '#server/adapters/db/pglite.ts';
import type { Db } from '#server/ports/db.ts';
import { migrate } from '#server/db/migrate.ts';
import { buildEngineInput } from '#server/repo/catalog.ts';
import { verifyPassword } from '#server/auth/password.ts';
import { orderContentHash } from '#server/domain/content-hash.ts';
import { sha256Normalized } from '#server/domain/hash.ts';
import { seed, SeedError, FONTES_DIR } from '../../db/seed/seed.ts';
import { loadPilotFunctions, type PilotData, type PilotProduct } from '../../packages/engine/test/piloto.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PASSWORD = 'senha-de-teste-do-seed';
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')) as T;

interface Envelope<R> { source: string; file: string; sha256: string; extractedAt: string; rows: R; commit?: string }
interface PilotSource extends Envelope<PilotProduct[]> { vehicles: PilotData['VEH']; clients: PilotData['CLIENTS']; rules: PilotData['RULES'] }
interface ConfRow { material: string; um: string; ean: string | null }
interface AuxRow { idioma: string; material: string }
interface CatItem { material: number; peso_liquido: number; peso_bruto: number; paletizacao_caixas: number; preco_venda: number }
interface IntItem { material: number; ncm: string; volume_max: number }

const piloto = readJson<PilotSource>('db/seed/fontes/piloto.json');
const pilotData: PilotData = { EPS: 1e-9, P: piloto.rows, VEH: piloto.vehicles, CLIENTS: piloto.clients, RULES: piloto.rules };
const P = new Map(piloto.rows.map((p) => [p.code, p]));
const conferencia = readJson<Envelope<ConfRow[]>>('db/seed/fontes/sap_conferencia.json');
const ob = readJson<Envelope<{ aux: AuxRow[] }>>('db/seed/fontes/ob.json');
const catalogo = readJson<{ cliente: { codigo: string; moeda: string; incoterm: string; cond_pagamento: string }; itens: CatItem[] }>('dados/catalogo.json');
const internos = readJson<{ itens: IntItem[] }>('dados/produtos_internos.json');
const CAT = new Map(catalogo.itens.map((i) => [String(i.material), i]));
const INT = new Map(internos.itens.map((i) => [String(i.material), i]));
const SKUS = [...P.keys()].sort();

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

describe('seed completo', () => {
  let db: Db;
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const count = async (sql: string, params: unknown[] = []) => Number((await q<{ n: number | string }>(`select count(*) as n from ${sql}`, params))[0].n);

  before(async () => {
    db = await createPgliteDb();
    await migrate(db);
    await seed(db, { password: PASSWORD, log: () => undefined });
  });
  after(async () => { await db.close(); });

  test('um import_batch ACTIVE por fonte, com o sha256 do arquivo atual', async () => {
    const batches = await q<{ source: string; file_name: string; file_sha256: string; status: string }>(
      'select source, file_name, file_sha256, status from import_batch order by id');
    assert.deepEqual(batches.map((b) => b.source).sort(), [
      'DADOS_JSON', 'DADOS_JSON', 'DADOS_JSON', 'DADOS_JSON', 'DECISOES', 'ORDER_BASIS', 'PILOTO', 'SAP_CONFERENCIA', 'SAP_MATERIAIS', 'SAP_REGISTROS',
    ]);
    for (const b of batches) {
      assert.equal(b.status, 'ACTIVE');
      const expected = b.source === 'PILOTO'
        ? sha256Normalized(execFileSync('git', ['show', `${piloto.commit}:index.html`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }))
        : sha256Normalized(readFileSync(path.join(ROOT, b.file_name)));
      assert.equal(b.file_sha256, expected, `${b.source} ${b.file_name}`);
    }
    assert.deepEqual(batches.filter((b) => b.source === 'DADOS_JSON').map((b) => b.file_name).sort(),
      ['dados/catalogo.json', 'dados/container.json', 'dados/pedido.json', 'dados/produtos_internos.json']);
  });

  test('contagens', async () => {
    assert.equal(await count('material'), 10);
    assert.equal(await count('palletization'), 10);
    assert.equal(await count(`price where price_list = 'US' and origin = 'SAP_LIST'`), 7);
    assert.equal(await count(`price where price_list = 'US' and origin = 'SITE_3C'`), 3);
    assert.equal(await count(`price where price_list = 'AR' and origin = 'DEMO_DERIVED'`), 10);
    assert.equal(await count('price'), 20);
    assert.equal(await count('vehicle_type'), 3);
    assert.equal(await count('customer'), 2);
    assert.equal(await count('app_user'), 5);
    assert.equal(await count(`master_override where status = 'ACTIVE'`), 3);
    assert.equal(await count('sales_order'), 3);
    assert.equal(await count('material_uom'), conferencia.rows.length);
    assert.equal(await count('material_i18n'), 30);
    assert.equal(await count('material_ob_reference'), 10);
    assert.equal(await count('country_rule'), 1);
  });

  test('nenhuma janela de vigência sobreposta na mesma chave de preço', async () => {
    assert.equal(await count(
      `price a join price b on a.id < b.id
         and (a.channel, a.plant, a.price_list, coalesce(a.customer_code, ''), a.material_code, a.uom)
           = (b.channel, b.plant, b.price_list, coalesce(b.customer_code, ''), b.material_code, b.uom)
         and a.valid_from <= b.valid_to and b.valid_from <= a.valid_to`), 0);
  });

  test('catálogo efetivo × piloto: só as diferenças esperadas (Q12)', async () => {
    const rows = await q<{ code: string; family: string; units_per_box: number; net_kg: number; gross_kg: number; volume_dm3: number;
      length_mm: number; width_mm: number; height_mm: number; layer_boxes: number; layers: number; min_lot_pallets: number }>(
      `select * from material_effective where plant = '2612' order by code`);
    assert.deepEqual(rows.map((r) => r.code), SKUS);
    const diffs: string[] = [];
    for (const r of rows) {
      const p = P.get(r.code)!;
      const cmp = (field: string, db: number | string, pilot: number | string) => {
        const same = typeof db === 'number' && typeof pilot === 'number' ? near(db, pilot, 1e-9) : db === pilot;
        if (!same) diffs.push(`${r.code}.${field}: ${db} × ${pilot}`);
      };
      cmp('family', r.family, p.fam);
      cmp('units_per_box', r.units_per_box, p.un);
      cmp('net_kg', r.net_kg, p.net);
      cmp('gross_kg', r.gross_kg, p.gross);
      cmp('volume_dm3', r.volume_dm3, p.dm3);
      cmp('dims', `${r.length_mm}×${r.width_mm}×${r.height_mm}`, String(p.dims));
      cmp('layer_boxes', r.layer_boxes, p.lastro);
      cmp('layers', r.layers, p.alt);
      cmp('min_lot_pallets', r.min_lot_pallets, p.loteMin);
    }
    assert.deepEqual(diffs, ['12034109.layer_boxes: 14 × 4', '20908885.layers: 7 × 10']);
  });

  test('cadastro do SAP × piloto: só o peso bruto do stick difere (Q9); lastro e altura conferem com a Conferência', async () => {
    const cx = await q<{ material_code: string; gross_kg: number; weight_unit_raw: string }>(
      `select material_code, gross_kg, weight_unit_raw from material_uom where uom = 'CX' order by 1`);
    const diffs = cx.filter((r) => !near(r.gross_kg, P.get(r.material_code)!.gross)).map((r) => `${r.material_code}: ${r.gross_kg} ${r.weight_unit_raw}`);
    assert.deepEqual(diffs, ['12147801: 0.00089 G']);
    const conf = readJson<Envelope<{ material: string; um: string; lastro: number; camadas: number }[]>>('db/seed/fontes/sap_conferencia.json');
    const pal = await q<{ material_code: string; layer_boxes: number; layers: number }>('select material_code, layer_boxes, layers from palletization');
    for (const r of pal) {
      const c = conf.rows.find((x) => x.material === r.material_code && x.um === 'CX')!;
      assert.deepEqual([r.layer_boxes, r.layers], [c.lastro, c.camadas], r.material_code);
    }
  });

  test('preços: US = piloto, SITE_3C = catalogo.json (Q6), AR = priceFor(p, "rioclaro")', async () => {
    const prices = await q<{ material_code: string; price_list: string; price: string; price_raw: string | null; origin: string; plant: string; channel: string }>(
      'select material_code, price_list, price::text, price_raw::text, origin, plant, channel from price order by material_code, price_list');
    const fns = loadPilotFunctions()(pilotData);
    const rioclaro = Object.keys(piloto.clients).find((k) => piloto.clients[k].code === '11999')!;
    for (const code of SKUS) {
      const p = P.get(code)!;
      const us = prices.find((x) => x.material_code === code && x.price_list === 'US')!;
      const ar = prices.find((x) => x.material_code === code && x.price_list === 'AR')!;
      assert.equal(Number(us.price), p.price, `US ${code}`);
      assert.equal(us.origin, p.priceSrc === 'sap' ? 'SAP_LIST' : 'SITE_3C', `origem ${code}`);
      if (us.origin === 'SITE_3C') assert.equal(Number(us.price_raw ?? us.price), CAT.get(code)!.preco_venda, `site ${code}`);
      assert.equal(Number(ar.price), fns.priceFor(p, rioclaro), `AR ${code}`);
      assert.equal(ar.origin, 'DEMO_DERIVED');
      assert.deepEqual([us.channel, us.plant, ar.channel, ar.plant], ['13', '2612', '13', '2612']);
    }
    assert.deepEqual(prices.filter((x) => x.price_raw !== null && x.origin === 'SITE_3C').map((x) => [x.material_code, x.price_raw]), [['20908885', '17.611']]);
  });

  test('textos e códigos do piloto (D11) conferidos com as fontes: EAN, DUN, NCM e nomes es/en', async () => {
    const mats = await q<{ code: string; sap_description: string; brand: string; units_label: string; ncm: string; product_line: string; ean: string; dun: string }>(
      'select * from material order by code');
    for (const m of mats) {
      const p = P.get(m.code)!;
      assert.deepEqual([m.brand, m.units_label, m.ncm, m.product_line, m.ean, m.dun], [p.brand, p.unLbl, p.ncm, p.linha, p.ean, p.dun], m.code);
      const consumer = conferencia.rows.filter((r) => r.material === m.code && ['UN', 'SCH', 'DIS'].includes(r.um)).map((r) => r.ean);
      assert.ok(consumer.includes(m.ean), `EAN do ${m.code} não é de UM de consumo`);
      assert.equal(conferencia.rows.find((r) => r.material === m.code && r.um === 'CX')!.ean, m.dun, `DUN do ${m.code}`);
      assert.equal(INT.get(m.code)!.ncm, m.ncm, `NCM do ${m.code}`);
    }
    const names = await q<{ material_code: string; lang: string; name: string }>('select * from material_i18n order by 1, 2');
    for (const code of SKUS) {
      const p = P.get(code)!;
      assert.deepEqual(names.filter((n) => n.material_code === code).map((n) => [n.lang, n.name]), [['en', p.en], ['es', p.es], ['pt', p.pt]]);
    }
    const auxLangs = (code: string) => new Set(ob.rows.aux.filter((a) => a.material === code).map((a) => a.idioma));
    assert.deepEqual(SKUS.filter((c) => auxLangs(c).size !== 3), ['12142146', '12147801'], 'ausências conhecidas de es/en na AUX');
  });

  test('lote mínimo (OB PALETIZAÇÃO da filial LONT) e valores da OB conferem com o piloto', async () => {
    const pal = await q<{ material_code: string; min_lot_pallets: number; min_lot_source: string }>('select * from palletization order by 1');
    for (const r of pal) assert.equal(r.min_lot_pallets, P.get(r.material_code)!.loteMin, r.material_code);
    assert.deepEqual(pal.filter((r) => r.min_lot_source === 'DEFAULT').map((r) => r.material_code), ['12034103']);
    const refs = await q<{ material_code: string; boxes_per_pallet_tab: number; boxes_per_pallet_paletizacao: number; price_tab: number; min_lot_lookup: number; gross_kg_per_box_line: number }>(
      'select * from material_ob_reference order by 1');
    const r2 = (x: number) => Math.round(x * 100) / 100;
    for (const r of refs) {
      const o = P.get(r.material_code)!.ob as { cxPal: number; palz: number; price: number; lote: number; grossCx: number };
      assert.deepEqual(
        [Math.round(r.boxes_per_pallet_tab), r2(r.boxes_per_pallet_paletizacao), r2(r.price_tab), r.min_lot_lookup, r2(r.gross_kg_per_box_line)],
        [o.cxPal, o.palz, o.price, o.lote, o.grossCx], r.material_code);
    }
  });

  test('clientes, veículos e restrição de país conferem com o piloto, a OB e o catalogo.json', async () => {
    const cs = await q<Record<string, unknown>>('select * from customer order by code');
    const minoil = piloto.clients.minoil, rio = piloto.clients.rioclaro;
    const view = (c: Record<string, unknown>) => [c.code, c.slug, c.name, c.destination_label, c.currency, c.incoterm, c.payment_code, c.payment_terms, c.price_list, c.contact_name, c.language, c.mixed_pallet, c.auto_approve];
    assert.deepEqual(view(cs[0]), [minoil.code, 'minoil', minoil.name, minoil.dest, minoil.cur, minoil.inc, minoil.payCode, minoil.pay, minoil.list, minoil.contact, 'pt', minoil.mixed, minoil.autoApprove]);
    assert.deepEqual(view(cs[1]), [rio.code, 'rioclaro', rio.name, rio.dest, rio.cur, rio.inc, rio.payCode, rio.pay, rio.list, rio.contact, rio.lang, rio.mixed, rio.autoApprove]);
    assert.deepEqual([cs[0].country, cs[0].is_demo, cs[1].country, cs[1].is_demo, cs[0].branch, cs[1].branch], [null, false, 'AR', true, 'LONT', 'LONT']);
    assert.deepEqual([cs[0].code, cs[0].currency, cs[0].incoterm, fold(String(cs[0].payment_terms))],
      [catalogo.cliente.codigo, catalogo.cliente.moeda, catalogo.cliente.incoterm, fold(catalogo.cliente.cond_pagamento)]);
    const obBatch = await q<{ quality_report: { divergences: { customer: string; field: string; source: string; adopted: string }[] } }>(
      `select quality_report from import_batch where source = 'ORDER_BASIS'`);
    assert.deepEqual(obBatch[0].quality_report.divergences.find((d) => d.field === 'language'),
      { customer: '11131', field: 'language', source: 'Espanhol', adopted: 'pt', reason: 'idioma do piloto, para a demo não mudar' });

    const veh = await q<{ id: string; pallet_positions: number; volume_m3: number; payload_kg: number; modal: string }>('select * from vehicle_type order by sort_order');
    assert.deepEqual(veh.map((v) => v.id), ['carreta_padrao', 'container_40', 'container_20']);
    const ui = { carreta_padrao: 'carreta', container_40: 'c40', container_20: 'c20' } as const;
    for (const v of veh) {
      const pv = piloto.vehicles[ui[v.id as keyof typeof ui]];
      assert.deepEqual([v.pallet_positions, v.volume_m3, v.payload_kg], [pv.pos, pv.m3, pv.kg], v.id);
    }
    const rules = await q<{ country: string; customer_code: string; material_code: string }>('select * from country_rule');
    assert.deepEqual(rules.map((r) => [r.country, r.customer_code, r.material_code]), rio.blocked.map((m) => ['AR', '11999', m]));
    assert.deepEqual(await q('select branch, plant, plant_name, is_assumption from branch_plant'), [{ branch: 'LONT', plant: '2612', plant_name: 'CD Londrina', is_assumption: true }]);
  });

  test('DERIVED_MISMATCH contra catalogo.json e produtos_internos.json: exatamente os 4 SKUs do §7.3', async () => {
    const reports = await q<{ file_name: string; quality_report: { DERIVED_MISMATCH?: { material: string; fields: string[] }[] } }>(
      `select file_name, quality_report from import_batch where source = 'DADOS_JSON' order by file_name`);
    const all = reports.flatMap((r) => r.quality_report.DERIVED_MISMATCH ?? []);
    assert.deepEqual([...new Set(all.map((m) => m.material))].sort(), ['12142501', '12144012', '12147801', '20908885']);
    const fieldsOf = (m: string) => all.filter((x) => x.material === m).flatMap((x) => x.fields).sort();
    assert.deepEqual(fieldsOf('20908885'), ['paletizacao_caixas', 'peso_liquido', 'volume_max']);
    // Os JSON não alimentam o dado mestre: o catálogo efetivo segue o SAP com os overrides.
    const eff = (await q<{ volume_dm3: number }>(`select volume_dm3 from material_effective where code = '20908885'`))[0];
    assert.notEqual(eff.volume_dm3, INT.get('20908885')!.volume_max);
  });

  test('overrides do §7.3: ACTIVE, propostos por admin.dados, confirmados por ana.exportacao, valor do SAP gravado', async () => {
    const rows = await q<{ material_code: string; entity: string; key_part: string; field: string; sap_value: number; adopted_value: number; decision_ref: string; proposer: string; confirmer: string; confirmed_at: Date | null }>(
      `select o.material_code, o.entity, o.key_part, o.field, o.sap_value, o.adopted_value, o.decision_ref,
              p.username as proposer, c.username as confirmer, o.confirmed_at
         from master_override o join app_user p on p.id = o.proposed_by join app_user c on c.id = o.confirmed_by
        where o.status = 'ACTIVE' order by o.material_code`);
    assert.deepEqual(rows.map((r) => [r.material_code, r.entity, r.key_part, r.field, r.sap_value, r.adopted_value, r.decision_ref, r.proposer, r.confirmer]), [
      ['12034109', 'palletization', '2612', 'layer_boxes', 4, 14, 'Q12', 'admin.dados', 'ana.exportacao'],
      ['12147801', 'material_uom', 'CX', 'gross_kg', 0.00089, 1.2, 'Q9', 'admin.dados', 'ana.exportacao'],
      ['20908885', 'palletization', '2612', 'layers', 10, 7, 'Q12', 'admin.dados', 'ana.exportacao'],
    ]);
    assert.ok(rows.every((r) => r.confirmed_at instanceof Date));
  });

  test('usuários, papéis, escopos e senha só como hash scrypt', async () => {
    const users = await q<{ username: string; role: string; display_name: string; password_hash: string; scope: string | null }>(
      `select u.username, u.role, u.display_name, u.password_hash, string_agg(s.customer_code, ',') as scope
         from app_user u left join user_customer_scope s on s.user_id = u.id group by u.id order by u.id`);
    assert.deepEqual(users.map((u) => [u.username, u.role, u.display_name, u.scope]), [
      ['martin.minoil', 'ext_distribuidor', 'Martín (MINOIL S.A.)', '11131'],
      ['sofia.rioclaro', 'ext_distribuidor', 'Sofía (Distribuidora Río Claro S.R.L.)', '11999'],
      ['lucas.exportacao', 'int_exportacao', 'Lucas (Exportação)', null],
      ['ana.exportacao', 'int_exportacao', 'Ana (Exportação)', null],
      ['admin.dados', 'int_admin', 'Administração de dados', null],
    ]);
    for (const u of users) {
      assert.match(u.password_hash, /^scrypt\$16384\$8\$1\$/);
      assert.ok(!u.password_hash.includes(PASSWORD));
      assert.equal(await verifyPassword(PASSWORD, u.password_hash), true, u.username);
    }
  });

  describe('pedidos de exemplo', () => {
    interface VersionRow {
      order_id: string; version_no: number; vehicle_id: string; load_mode: 'PALLETIZED' | 'FLOOR'; mixed_pallet: boolean; customer_reference: string;
      loading_date: string | null; lines: { material: string; boxes: number }[]; engine_version: number;
      engine_result: EngineResult & { inputs: { priceDate: string; vehicleId: string; customerCode: string } };
      blocking: boolean; data_batches: number[]; overrides: number[]; content_hash: string; author: string; author_label: string; reason: string | null; created_at: Date;
    }
    const versions = (id: string) => q<VersionRow>(
      `select v.*, u.username as author from order_version v join app_user u on u.id = v.author_id where order_id = $1 order by version_no`, [id]);
    const events = (id: string) => q<{ type: string; actor: string | null; actor_label: string; from_status: string | null; to_status: string; version_no: number; payload: Record<string, unknown>; at: Date }>(
      `select e.type, u.username as actor, e.actor_label, e.from_status, e.to_status, e.version_no, e.payload, e.at
         from order_event e left join app_user u on u.id = e.actor_id where order_id = $1 order by e.id`, [id]);
    const order = async (id: string) => (await q<{ status: string; current_version: number; origin: string; customer_code: string; creator: string; created_at: Date }>(
      `select o.status, o.current_version, o.origin, o.customer_code, u.username as creator, o.created_at
         from sales_order o join app_user u on u.id = o.created_by where o.id = $1`, [id]))[0];

    test('resultado do motor recalculado (nunca copiado) e content_hash reproduzível em todas as versões', async () => {
      for (const id of ['3CC-2026-0001', '3CC-2026-0002', '3CC-2026-0003']) {
        const o = await order(id);
        for (const v of await versions(id)) {
          const { inputs, ...stored } = v.engine_result;
          const built = await buildEngineInput(db, o.customer_code, { vehicleId: v.vehicle_id, loadMode: v.load_mode }, v.lines, inputs.priceDate);
          assert.deepEqual(stored, calculate(built.input), `${id} v${v.version_no}`);
          assert.deepEqual(inputs, { priceDate: built.priceDate, vehicleId: v.vehicle_id, customerCode: o.customer_code });
          assert.deepEqual([v.data_batches, v.overrides, v.blocking, v.engine_version], [built.dataBatches, built.overrides, stored.blocking, 1]);
          assert.equal(v.content_hash, orderContentHash({
            header: { vehicleId: v.vehicle_id, loadMode: v.load_mode, mixedPallet: v.mixed_pallet, reference: v.customer_reference, loadingDate: v.loading_date },
            lines: v.lines, engineVersion: 1, dataBatches: v.data_batches, overrides: v.overrides,
          }));
          assert.deepEqual(v.lines.map((l) => l.material), [...v.lines.map((l) => l.material)].sort(), 'linhas na ordem do catálogo');
        }
      }
    });

    test('3CC-2026-0001: itens do pedido.json, SUBMITTED com bloqueio (30 posições para 28), totais da OB no evento', async () => {
      const o = await order('3CC-2026-0001');
      assert.deepEqual([o.status, o.current_version, o.origin, o.customer_code, o.creator], ['SUBMITTED', 1, 'ORDER_BASIS', '11131', 'lucas.exportacao']);
      const [v] = await versions('3CC-2026-0001');
      assert.deepEqual(v.lines, [{ material: '12031189', boxes: 3528 }, { material: '12034103', boxes: 300 }, { material: '12037417', boxes: 250 }, { material: '12144012', boxes: 300 }]);
      assert.deepEqual([v.vehicle_id, v.load_mode, v.customer_reference, v.author_label, v.reason],
        ['carreta_padrao', 'PALLETIZED', 'PEDIDO TESTE', 'Lucas (Exportação)', 'Importado da planilha Order Basis; a planilha indicava embarque OK']);
      assert.equal(v.created_at.toISOString(), '2026-10-09T20:53:00.000Z');
      assert.deepEqual([v.blocking, v.engine_result.totals.positions, v.engine_result.status, v.engine_result.totals.valueCents], [true, 30, 'EXCEEDED', 19_201_748]);
      const ev = await events('3CC-2026-0001');
      assert.equal(ev.length, 1);
      assert.deepEqual([ev[0].type, ev[0].actor, ev[0].from_status, ev[0].to_status, ev[0].version_no], ['SUBMITTED', 'lucas.exportacao', null, 'SUBMITTED', 1]);
      assert.deepEqual(ev[0].payload, { internal: { origin: 'ORDER_BASIS', orderBasis: { grossKg: 20151.04, netKg: 19070, pallets: 28.886, valueUsd: 192005.84, shipment: 'OK' } } });
    });

    test('3CC-2026-0002: v1 de Martín, v2 de Lucas (324 → 405), aprovado por Ana', async () => {
      const o = await order('3CC-2026-0002');
      assert.deepEqual([o.status, o.current_version, o.origin, o.creator], ['APPROVED', 2, 'PORTAL', 'martin.minoil']);
      const [v1, v2] = await versions('3CC-2026-0002');
      assert.deepEqual([v1.author, v2.author, v2.reason], ['martin.minoil', 'lucas.exportacao', 'completar a carreta']);
      assert.deepEqual(v1.lines, [{ material: '12031189', boxes: 2688 }, { material: '12034103', boxes: 324 }, { material: '12037417', boxes: 182 }, { material: '12142146', boxes: 600 }]);
      assert.deepEqual(v2.lines.find((l) => l.material === '12034103'), { material: '12034103', boxes: 405 });
      assert.deepEqual([v1.customer_reference, v1.loading_date, v2.loading_date], ['OC-2026-097', '2026-10-24', '2026-10-24']);
      assert.deepEqual([v1.blocking, v2.blocking, v2.engine_result.totals.positions, v2.engine_result.status], [false, false, 28, 'FULL']);
      const ev = await events('3CC-2026-0002');
      assert.deepEqual(ev.map((e) => [e.type, e.actor, e.from_status, e.to_status, e.version_no]), [
        ['SUBMITTED', 'martin.minoil', null, 'SUBMITTED', 1],
        ['VERSION_CREATED', 'lucas.exportacao', 'SUBMITTED', 'SUBMITTED', 2],
        ['APPROVED', 'ana.exportacao', 'SUBMITTED', 'APPROVED', 2],
      ]);
      assert.deepEqual(ev[1].payload, { changes: [{ material: '12034103', old: 324, new: 405 }], reason: 'completar a carreta' });
      assert.deepEqual(ev[2].payload, { internal: { contentHash: v2.content_hash, recalculatedContentHash: v2.content_hash, recalculatedBlocking: false, resultChanged: false } });
      assert.equal(ev[2].at.toISOString(), '2026-10-11T14:40:00.000Z');
    });

    test('3CC-2026-0003: Río Claro, caso 3 na variante adotada (17 de 20, 56 cx para fechar o 12034109), aprovado por Lucas', async () => {
      const o = await order('3CC-2026-0003');
      assert.deepEqual([o.status, o.current_version, o.customer_code, o.creator], ['APPROVED', 1, '11999', 'sofia.rioclaro']);
      const [v] = await versions('3CC-2026-0003');
      const r = v.engine_result;
      assert.deepEqual([v.vehicle_id, v.customer_reference, v.loading_date, r.totals.positions, r.status, v.blocking], ['container_40', 'OC-4471', '2026-11-03', 17, 'PARTIAL', false]);
      const vanilla = r.lines.find((l) => l.material === '12034109')!;
      assert.ok(near(vanilla.pallets, 140 / 98));
      assert.equal(vanilla.boxesToNextPallet, 56);
      assert.ok(near(r.totals.grossKg, 9712.86, 0.005));
      assert.equal(r.totals.valueCents, 12_376_108);
      assert.equal(v.overrides.length, 2, 'o override de 12034109 e o do stick entram nos usados');
      const ev = await events('3CC-2026-0003');
      assert.deepEqual(ev.map((e) => [e.type, e.actor]), [['SUBMITTED', 'sofia.rioclaro'], ['APPROVED', 'lucas.exportacao']]);
    });

    test('quem aprova não criou o pedido nem é autor de nenhuma versão; sales_order_seq fica em 3', async () => {
      const rows = await q<{ id: string; bad: number }>(
        `select o.id, count(*) filter (where e.actor_id = o.created_by or e.actor_id in (select author_id from order_version v where v.order_id = o.id)) as bad
           from sales_order o join order_event e on e.order_id = o.id and e.type = 'APPROVED' group by o.id`);
      assert.deepEqual(rows.map((r) => [r.id, Number(r.bad)]).sort(), [['3CC-2026-0002', 0], ['3CC-2026-0003', 0]]);
      const [{ last_value, is_called }] = await q<{ last_value: number | string; is_called: boolean }>('select last_value, is_called from sales_order_seq');
      assert.deepEqual([Number(last_value), is_called], [3, true]);
    });
  });
});

describe('seed: fontes desatualizadas e senhas aleatórias', () => {
  let db: Db;
  let dir: string;
  before(async () => {
    db = await createPgliteDb();
    await migrate(db);
    dir = mkdtempSync(path.join(tmpdir(), 'psf-seed-'));
  });
  after(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('fonte com sha256 diferente do arquivo atual aborta, sem gravar nada', async () => {
    const fontes = path.join(dir, 'fontes');
    cpSync(FONTES_DIR, fontes, { recursive: true });
    const file = path.join(fontes, 'sap_materiais.json');
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { sha256: string };
    doc.sha256 = '0'.repeat(64);
    writeFileSync(file, JSON.stringify(doc));
    await assert.rejects(seed(db, { password: PASSWORD, fontesDir: fontes, log: () => undefined }),
      (e: unknown) => e instanceof SeedError && /desatualizada.*npm run extract/.test(e.message));
    assert.deepEqual((await db.query('select count(*)::integer as n from import_batch')).rows, [{ n: 0 }]);
  });

  test('sem SEED_PASSWORD: 16 caracteres aleatórios por usuário, gravados uma vez no arquivo de credenciais', async () => {
    const credentials = path.join(dir, 'storage', 'credenciais-seed.txt');
    const logs: string[] = [];
    await seed(db, { credentialsFile: credentials, log: (m) => logs.push(m) });
    const lines = readFileSync(credentials, 'utf8').trim().split('\n').filter((l) => !l.startsWith('#'));
    assert.equal(lines.length, 5);
    const users = (await db.query<{ username: string; password_hash: string }>('select username, password_hash from app_user')).rows;
    const passwords = new Set<string>();
    for (const line of lines) {
      const [username, password] = line.split(': ');
      assert.equal(password.length, 16);
      passwords.add(password);
      const u = users.find((x) => x.username === username);
      assert.ok(u, username);
      assert.equal(await verifyPassword(password, u.password_hash), true, username);
    }
    assert.equal(passwords.size, 5, 'senhas diferentes por usuário');
    assert.ok(logs.some((m) => m.includes(credentials)));
  });
});

// Autoverificação do extrator (03, fim): nenhuma senha da DADOS CLIENTES nas fontes gravadas, e o detector funciona.
const python = process.env.PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3');
const hasPython = !spawnSync(python, ['--version']).error;
test('extrator: autoverificação de senha nas fontes gravadas', { skip: hasPython ? false : `${python} não encontrado` }, () => {
  const r = spawnSync(python, [path.join(ROOT, 'db', 'seed', 'extrair_planilhas.py'), '--verificar'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /nenhum encontrado; detector ok/);
});
