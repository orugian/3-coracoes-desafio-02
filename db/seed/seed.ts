// Seed do corte (docs/specs/03-seed.md): carrega db/seed/fontes/*.json, dados/*.json e db/seed/decisoes.ts num banco
// recém-migrado, numa transação só. Não lê planilha (D6) e nunca copia resultado: roda o motor para os pedidos de exemplo.
// Tudo o que é leitura de arquivo e scrypt acontece antes da transação (02, "nenhuma transação aberta durante I/O").
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { calculate, type EngineResult } from '#engine';
import type { Db, Queryable } from '#server/ports/db.ts';
import { buildEngineInput } from '#server/repo/catalog.ts';
import { hashPassword } from '#server/auth/password.ts';
import { canonicalJson, orderContentHash } from '#server/domain/content-hash.ts';
import { sha256Normalized } from '#server/domain/hash.ts';
import { saoPauloDate } from '#server/domain/time.ts';
import * as D from './decisoes.ts';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const FONTES_DIR = path.join(import.meta.dirname, 'fontes');
export const DECISOES_FILE = path.join(import.meta.dirname, 'decisoes.ts');
export const DEFAULT_CREDENTIALS_FILE = path.join(REPO_ROOT, 'storage', 'credenciais-seed.txt');

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

export interface SeedOptions {
  password?: string; // SEED_PASSWORD: a mesma para todos; sem ela, 16 caracteres aleatórios por usuário
  credentialsFile?: string; // onde gravar as senhas aleatórias (padrão storage/credenciais-seed.txt)
  fontesDir?: string;
  log?: (message: string) => void;
}
export interface SeedReport { batches: number; orders: string[]; credentialsFile: string | null }

// ------------------------------------------------------------------ fontes
interface Envelope<R> { source: string; file: string; sha256: string; extractedAt: string; rows: R }
interface ConfRow {
  centro: string; material: string; texto: string; denominador: number; um: string; contador: number; ean: string | null;
  comprimentoMm: number | null; larguraMm: number | null; alturaMm: number | null; volumeDm3: number | null;
  liquido: number; bruto: number; unidadePeso: 'KG' | 'G'; validadeDias: number | null; hierarquia: string | null;
}
interface MatRow { material: string; descricao: string; centro: string; lastro: number; altura: number }
interface RegRow {
  canal: string; centro: string; descCentro: string; lista: string; material: string; um: string;
  validoDesde: string; validoAte: string; precoSugerido: number; moeda: string; exclusao: number;
}
interface ObRows {
  clientes: { codigo: string; lista: string; nome: string; condPagamentoCodigo: string; incoterm: string; idioma: string; moeda: string; filial: string }[];
  tab: { material: string; preco: number | null; paletizacaoCx: number | null }[];
  paletizacao: { org: string; material: string; descricao: string; unidadesPallet: number | null; loteMinimo: number | null }[];
  ordem: {
    totais: { X2_pesoBruto: number; W2_pesoLiquido: number; Y2_valor: number; Y4_pallets: number; W4_embarque: string };
    itens: { material: string; unidadesCaixa: number | null; brutoUnidade: number | null }[];
  };
}
interface PilotProduct {
  code: string; fam: string; brand: string; unLbl: string; pt: string; es: string; en: string;
  ncm: string | null; linha: string | null; ean: string | null; dun: string | null;
}
interface PilotClient { code: string; name: string; dest: string; pay: string; payCode: string; list: string; contact: string; lang?: string; mixed: boolean; autoApprove: boolean }
interface PilotSource extends Envelope<PilotProduct[]> { commit: string; clients: Record<string, PilotClient> }
interface Container { modais_logisticos: { id_veiculo: string; nome_exibicao: string; modal: string; capacidade_maxima: { cubagem_m3: number; peso_bruto_kg: number } }[] }
interface Pedido { cabecalho: { referencia_cliente: string }; totais: { valor_total: number; peso_liquido_total: number; peso_bruto_total: number }; itens: { material: number | string; caixas: number }[] }
interface CatJson { itens: { material: number | string; peso_liquido: number; peso_bruto: number; paletizacao_caixas: number }[] }
interface IntJson { itens: { material: number | string; volume_max: number }[] }
interface DataFile<T> { rel: string; sha256: string; data: T }

function insideRepo(rel: string): string {
  const abs = path.resolve(REPO_ROOT, rel);
  if (!abs.startsWith(REPO_ROOT + path.sep)) throw new SeedError(`caminho de fonte fora do repositório: ${rel}`);
  return abs;
}

function loadEnvelope<T extends Envelope<unknown>>(dir: string, name: string, source: string): T {
  const file = path.join(dir, name);
  if (!existsSync(file)) throw new SeedError(`fonte ausente: ${name} (rode npm run extract)`);
  const doc = JSON.parse(readFileSync(file, 'utf8')) as T;
  if (doc.source !== source) throw new SeedError(`${name}: source ${doc.source}, esperado ${source}`);
  return doc;
}

// 03: o seed falha se a fonte gerada não corresponder ao arquivo atual em pre-solucao/.
function assertFresh(name: string, env: Envelope<unknown>): void {
  const origin = insideRepo(env.file);
  if (!existsSync(origin)) throw new SeedError(`fonte desatualizada: ${name} aponta para ${env.file}, que não existe; rode npm run extract`);
  if (sha256Normalized(readFileSync(origin)) !== env.sha256) {
    throw new SeedError(`fonte desatualizada: ${name} foi extraída de outra versão de ${env.file}; rode npm run extract`);
  }
}

function loadData<T>(rel: string): DataFile<T> {
  const bytes = readFileSync(insideRepo(rel));
  return { rel, sha256: sha256Normalized(bytes), data: JSON.parse(bytes.toString('utf8')) as T };
}

function loadSources(fontesDir: string) {
  const conf = loadEnvelope<Envelope<ConfRow[]>>(fontesDir, 'sap_conferencia.json', 'SAP_CONFERENCIA');
  const mats = loadEnvelope<Envelope<MatRow[]>>(fontesDir, 'sap_materiais.json', 'SAP_MATERIAIS');
  const regs = loadEnvelope<Envelope<RegRow[]>>(fontesDir, 'sap_registros.json', 'SAP_REGISTROS');
  const ob = loadEnvelope<Envelope<ObRows>>(fontesDir, 'ob.json', 'ORDER_BASIS');
  for (const [name, env] of [['sap_conferencia.json', conf], ['sap_materiais.json', mats], ['sap_registros.json', regs], ['ob.json', ob]] as const) {
    assertFresh(name, env);
  }
  // O piloto vem de um commit fixo (imutável); o sha256 gravado é o do index.html desse commit.
  const piloto = loadEnvelope<PilotSource>(fontesDir, 'piloto.json', 'PILOTO');
  return {
    conf, mats, regs, ob, piloto,
    catalogo: loadData<CatJson>('dados/catalogo.json'),
    internos: loadData<IntJson>('dados/produtos_internos.json'),
    pedido: loadData<Pedido>('dados/pedido.json'),
    container: loadData<Container>('dados/container.json'),
    decisoes: { rel: path.relative(REPO_ROOT, DECISOES_FILE).split(path.sep).join('/'), sha256: sha256Normalized(readFileSync(DECISOES_FILE)) },
  };
}
type Sources = ReturnType<typeof loadSources>;

// ------------------------------------------------------------------ utilitários
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const randomPassword = () => Array.from({ length: 16 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await q.query<T>(sql, params);
  if (rows.length !== 1) throw new SeedError(`esperava 1 linha, veio ${rows.length}`);
  return rows[0];
}

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new SeedError(message);
  return value;
}

type Line = { material: string; boxes: number };
function sortedLines(lines: Line[], skus: Set<string>, where: string): Line[] {
  const seen = new Set<string>();
  for (const l of lines) {
    if (!skus.has(l.material)) throw new SeedError(`${where}: material fora do catálogo ${l.material}`);
    if (seen.has(l.material)) throw new SeedError(`${where}: material repetido ${l.material}`);
    if (!Number.isInteger(l.boxes) || l.boxes < 1) throw new SeedError(`${where}: quantidade inválida ${l.material} = ${l.boxes}`);
    seen.add(l.material);
  }
  return [...lines].sort((a, b) => (a.material < b.material ? -1 : 1)).map((l) => ({ material: l.material, boxes: l.boxes }));
}

// ------------------------------------------------------------------ seed
export async function seed(db: Db, options: SeedOptions = {}): Promise<SeedReport> {
  const log = options.log ?? ((m: string) => console.log(m));
  const src = loadSources(options.fontesDir ?? FONTES_DIR);
  const random = options.password === undefined;
  const passwords = new Map<string, string>(D.USERS.map((u) => [u.username, random ? randomPassword() : options.password!]));
  const hashes = new Map<string, string>();
  for (const [username, password] of passwords) hashes.set(username, await hashPassword(password));

  // Grava as senhas aleatórias antes do commit: se a escrita falhar, o banco não fica com hashes que ninguém conhece.
  // Se a transação falhar depois, o arquivo fica com senhas sem uso e o próximo db:seed o sobrescreve.
  let credentialsFile: string | null = null;
  const body = [...passwords].map(([u, p]) => `${u}: ${p}`).join('\n');
  if (random) {
    credentialsFile = options.credentialsFile ?? DEFAULT_CREDENTIALS_FILE;
    mkdirSync(path.dirname(credentialsFile), { recursive: true });
    writeFileSync(credentialsFile, `# Senhas do npm run db:seed (${new Date().toISOString()}). Não versionar.\n${body}\n`, { mode: 0o600 });
  }

  const report = await db.tx((q) => load(q, src, hashes));

  if (random) log(`senhas geradas (mostradas só agora; cópia em ${credentialsFile}):\n${body}`);
  else log('senha de todos os usuários: a de SEED_PASSWORD');
  log(`seed concluído: ${report.batches} lotes de importação, pedidos ${report.orders.join(', ')}`);
  return { ...report, credentialsFile };
}

async function load(q: Queryable, src: Sources, hashes: Map<string, string>): Promise<Omit<SeedReport, 'credentialsFile'>> {
  // ---- lotes de importação: um por arquivo de origem
  const batch = async (source: string, fileName: string, sha: string) =>
    (await one<{ id: number }>(q,
      `insert into import_batch (source, file_name, file_sha256, status, created_by) values ($1, $2, $3, 'ACTIVE', 'seed') returning id`,
      [source, fileName, sha])).id;
  const B = {
    conf: await batch('SAP_CONFERENCIA', src.conf.file, src.conf.sha256),
    mats: await batch('SAP_MATERIAIS', src.mats.file, src.mats.sha256),
    regs: await batch('SAP_REGISTROS', src.regs.file, src.regs.sha256),
    ob: await batch('ORDER_BASIS', src.ob.file, src.ob.sha256),
    catalogo: await batch('DADOS_JSON', src.catalogo.rel, src.catalogo.sha256),
    internos: await batch('DADOS_JSON', src.internos.rel, src.internos.sha256),
    pedido: await batch('DADOS_JSON', src.pedido.rel, src.pedido.sha256),
    container: await batch('DADOS_JSON', src.container.rel, src.container.sha256),
    piloto: await batch('PILOTO', `${src.piloto.file}@${src.piloto.commit}`, src.piloto.sha256),
    decisoes: await batch('DECISOES', src.decisoes.rel, src.decisoes.sha256),
  };
  const setReport = (id: number, report: unknown) =>
    q.query('update import_batch set quality_report = $2::jsonb where id = $1', [id, JSON.stringify(report)]);
  const obReport = { divergences: [] as unknown[], minLot: [] as unknown[] };

  // ---- usuários
  const userIds = new Map<string, number>();
  const userById = new Map<number, (typeof D.USERS)[number]>();
  for (const u of D.USERS) {
    const { id } = await one<{ id: number }>(q,
      `insert into app_user (username, display_name, role, password_hash) values ($1, $2, $3, $4) returning id`,
      [u.username, u.displayName, u.role, hashes.get(u.username)]);
    userIds.set(u.username, id);
    userById.set(id, u);
  }
  const user = (username: string) => {
    const u = must(D.USERS.find((x) => x.username === username), `usuário desconhecido nas decisões: ${username}`);
    return { ...u, id: userIds.get(username)! };
  };

  // ---- filial → centro
  const plantOfBranch = new Map<string, string>();
  for (const b of D.BRANCHES) {
    const name = must(src.regs.rows.find((r) => r.centro === b.plant)?.descCentro, `centro ${b.plant} sem descrição nos Registros`);
    await q.query('insert into branch_plant (branch, plant, plant_name, is_assumption) values ($1, $2, $3, $4)', [b.branch, b.plant, name, b.isAssumption]);
    plantOfBranch.set(b.branch, b.plant);
  }

  // ---- clientes
  const obClient = must(src.ob.rows.clientes.find((c) => c.codigo === D.MINOIL.code), `cliente ${D.MINOIL.code} ausente na DADOS CLIENTES da OB`);
  const pilotMinoil = must(src.piloto.clients[D.MINOIL.pilotKey], `cliente ${D.MINOIL.pilotKey} ausente no piloto`);
  if (pilotMinoil.code !== obClient.codigo) throw new SeedError(`piloto e OB divergem no código da MINOIL`);
  const minoilLanguage = pilotMinoil.lang ?? D.MINOIL.defaultLanguage;
  if (fold(obClient.idioma) !== fold({ pt: 'Português', es: 'Espanhol', en: 'Inglês' }[minoilLanguage] ?? minoilLanguage)) {
    obReport.divergences.push({ customer: obClient.codigo, field: 'language', source: obClient.idioma, adopted: minoilLanguage, reason: 'idioma do piloto, para a demo não mudar' });
  }
  must(plantOfBranch.get(obClient.filial), `filial ${obClient.filial} da MINOIL sem centro nas decisões`);
  const insertCustomer = (c: (string | boolean | null)[]) => q.query(
    `insert into customer (code, slug, name, country, destination_label, currency, incoterm, payment_code, payment_terms, price_list,
                           branch, contact_name, language, mixed_pallet, auto_approve, is_demo, batch_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`, c);
  await insertCustomer([
    obClient.codigo, D.MINOIL.pilotKey, obClient.nome, D.MINOIL.country, pilotMinoil.dest, obClient.moeda, obClient.incoterm,
    obClient.condPagamentoCodigo, pilotMinoil.pay, obClient.lista, obClient.filial, pilotMinoil.contact, minoilLanguage,
    pilotMinoil.mixed, pilotMinoil.autoApprove, false, String(B.ob),
  ]);
  const R = D.RIO_CLARO;
  await insertCustomer([
    R.code, R.slug, R.name, R.country, R.destinationLabel, R.currency, R.incoterm, R.paymentCode, R.paymentTerms, R.priceList,
    R.branch, R.contactName, R.language, R.mixedPallet, R.autoApprove, R.isDemo, String(B.decisoes),
  ]);
  for (const u of D.USERS) {
    for (const code of u.customers) await q.query('insert into user_customer_scope (user_id, customer_code) values ($1, $2)', [userIds.get(u.username), code]);
  }

  // ---- materiais, UMs, nomes e paletização
  const skus = [...new Set(src.mats.rows.map((m) => m.material))].sort();
  const skuSet = new Set(skus);
  const confSkus = [...new Set(src.conf.rows.map((r) => r.material))].sort();
  if (canonicalJson(confSkus) !== canonicalJson(skus)) throw new SeedError('Conferência e Materiais do SAP têm SKUs diferentes');
  const unitsPerBox = new Map<string, number>();
  for (const code of skus) {
    const rows = src.conf.rows.filter((r) => r.material === code);
    const cx = must(rows.find((r) => r.um === 'CX'), `${code} sem UM CX na Conferência`);
    const p = must(src.piloto.rows.find((x) => x.code === code), `${code} ausente no piloto (textos, família, EAN e DUN vêm dele, D11)`);
    await q.query(
      `insert into material (code, sap_description, family, sap_hierarchy, brand, units_label, ncm, product_line, ean, dun, shelf_life_days, batch_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [code, cx.texto, p.fam, cx.hierarquia, p.brand, p.unLbl, p.ncm, p.linha, p.ean, p.dun, cx.validadeDias, B.conf]);
    for (const [lang, name] of [['pt', p.pt], ['es', p.es], ['en', p.en]] as const) {
      await q.query('insert into material_i18n (material_code, lang, name) values ($1, $2, $3)', [code, lang, must(name, `${code} sem nome ${lang} no piloto`)]);
    }
    for (const r of rows) {
      const k = r.unidadePeso === 'G' ? 0.001 : 1;
      await q.query(
        `insert into material_uom (material_code, uom, units_per_uom, ean, length_mm, width_mm, height_mm, volume_dm3, net_kg, gross_kg, weight_unit_raw, batch_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [code, r.um, r.contador / r.denominador, r.ean, r.comprimentoMm, r.larguraMm, r.alturaMm, r.volumeDm3,
          round(r.liquido * k, 9), round(r.bruto * k, 9), r.unidadePeso, B.conf]);
    }
    unitsPerBox.set(code, cx.contador / cx.denominador);
  }
  for (const m of src.mats.rows) {
    const branch = must(D.BRANCHES.find((b) => b.plant === m.centro)?.branch, `centro ${m.centro} sem filial nas decisões`);
    const candidates = src.ob.rows.paletizacao.filter((r) => r.org === branch && r.material === m.material);
    let minLot = 1;
    let minLotSource: 'OB_PALETIZACAO' | 'DEFAULT' = 'DEFAULT';
    if (candidates.length === 1) {
      minLot = must(candidates[0].loteMinimo, `${m.material}: lote mínimo vazio na PALETIZAÇÃO`);
      minLotSource = 'OB_PALETIZACAO';
    } else if (candidates.length > 1) {
      // Linha repetida na filial: vale a de descrição igual ao texto do SAP (12037417 → "RED DES").
      const same = candidates.filter((r) => fold(r.descricao) === fold(m.descricao));
      if (same.length !== 1) throw new SeedError(`${m.material}: ${candidates.length} linhas na PALETIZAÇÃO ${branch} e ${same.length} com o texto do SAP`);
      minLot = must(same[0].loteMinimo, `${m.material}: lote mínimo vazio`);
      minLotSource = 'OB_PALETIZACAO';
      obReport.minLot.push({ material: m.material, branch, rule: 'linha repetida: vale a descrição igual ao texto do SAP', description: same[0].descricao, minLot });
    } else {
      obReport.minLot.push({ material: m.material, branch, rule: 'sem linha da filial: lote 1 (DEFAULT)', minLot });
    }
    await q.query(
      `insert into palletization (material_code, plant, layer_boxes, layers, min_lot_pallets, min_lot_source, batch_id) values ($1, $2, $3, $4, $5, $6, $7)`,
      [m.material, m.centro, m.lastro, m.altura, minLot, minLotSource, B.mats]);
  }

  // ---- preços: lista US do SAP, 3 SKUs do site (Q6) e lista AR derivada para a demo
  const insertPrice = (p: { plant: string; list: string; material: string; from: string; to: string; price: number; raw: number | null; currency: string; origin: string; batch: number }) =>
    q.query(
      `insert into price (channel, plant, price_list, material_code, uom, valid_from, valid_to, price, price_raw, currency, origin, batch_id)
       values ($1, $2, $3, $4, 'CX', $5, $6, $7, $8, $9, $10, $11)`,
      [D.EXPORT_CHANNEL, p.plant, p.list, p.material, p.from, p.to, p.price, p.raw, p.currency, p.origin, p.batch]);
  const usPrices: { plant: string; material: string; from: string; to: string; price: number; currency: string }[] = [];
  for (const r of src.regs.rows) {
    if (r.canal !== D.EXPORT_CHANNEL || r.exclusao !== 0 || r.um !== 'CX' || r.lista !== D.DEMO_PRICE_LIST.fromList) continue;
    if (!skuSet.has(r.material)) throw new SeedError(`Registros: material fora do catálogo ${r.material}`);
    const price = round(r.precoSugerido, 2);
    await insertPrice({ plant: r.centro, list: r.lista, material: r.material, from: r.validoDesde, to: r.validoAte, price,
      raw: price === r.precoSugerido ? null : r.precoSugerido, currency: r.moeda, origin: 'SAP_LIST', batch: B.regs });
    usPrices.push({ plant: r.centro, material: r.material, from: r.validoDesde, to: r.validoAte, price, currency: r.moeda });
  }
  const site = D.SITE_3C_PRICES;
  for (const item of site.items) {
    if (usPrices.some((p) => p.material === item.material)) throw new SeedError(`Q6: ${item.material} passou a ter preço no SAP; rever a decisão`);
    await insertPrice({ plant: site.plant, list: site.priceList, material: item.material, from: site.validFrom, to: site.validTo,
      price: item.price, raw: item.priceRaw, currency: site.currency, origin: 'SITE_3C', batch: B.decisoes });
    usPrices.push({ plant: site.plant, material: item.material, from: site.validFrom, to: site.validTo, price: item.price, currency: site.currency });
  }
  for (const us of usPrices) {
    const raw = us.price * D.DEMO_PRICE_LIST.factor;
    const price = Math.round(us.price * D.DEMO_PRICE_LIST.factor * 100) / 100; // o Math.round do priceFor do piloto
    await insertPrice({ plant: us.plant, list: D.DEMO_PRICE_LIST.priceList, material: us.material, from: us.from, to: us.to, price,
      raw: near(raw, price) ? null : round(raw, 6), currency: us.currency, origin: 'DEMO_DERIVED', batch: B.decisoes });
  }

  // ---- veículos: container.json + posições (Q4)
  const vehicles = src.container.data.modais_logisticos;
  if (vehicles.length !== D.VEHICLE_POSITIONS.length) throw new SeedError('container.json e as posições das decisões têm veículos diferentes');
  for (const pos of D.VEHICLE_POSITIONS) {
    const v = must(vehicles.find((x) => x.id_veiculo === pos.id), `veículo ${pos.id} ausente no container.json`);
    const sourceByField = { display_name: 'container.json', modal: 'container.json', volume_m3: 'container.json', payload_kg: 'container.json', pallet_positions: D.VEHICLE_POSITIONS_SOURCE };
    await q.query(
      `insert into vehicle_type (id, display_name, modal, volume_m3, payload_kg, pallet_positions, source_by_field, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [v.id_veiculo, v.nome_exibicao, v.modal, v.capacidade_maxima.cubagem_m3, v.capacidade_maxima.peso_bruto_kg, pos.palletPositions, JSON.stringify(sourceByField), pos.sortOrder]);
  }

  // ---- restrições por país (Q5)
  for (const r of D.COUNTRY_RULES) {
    await q.query(`insert into country_rule (country, customer_code, material_code, kind, reason, is_demo) values ($1, $2, $3, $4, $5, $6)`,
      [r.country, r.customerCode, r.material, r.kind, r.reason, r.isDemo]);
  }

  // ---- valores da OB para o backoffice (substitui P[].ob)
  for (const code of skus) {
    const tab = src.ob.rows.tab.find((r) => r.material === code);
    const palRows = src.ob.rows.paletizacao.filter((r) => r.material === code);
    const palUnits = (palRows.find((r) => r.org === 'LONT') ?? palRows.find((r) => r.org === 'BHO'))?.unidadesPallet ?? null;
    const item = src.ob.rows.ordem.itens.find((r) => r.material === code);
    const grossLine = item?.brutoUnidade != null && item.unidadesCaixa != null ? item.brutoUnidade * item.unidadesCaixa : null;
    await q.query(
      `insert into material_ob_reference (material_code, boxes_per_pallet_tab, boxes_per_pallet_paletizacao, price_tab, min_lot_lookup, gross_kg_per_box_line, batch_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [code, tab?.paletizacaoCx ?? null, palUnits === null ? null : palUnits / unitsPerBox.get(code)!, tab?.preco ?? null,
        palRows[0]?.loteMinimo ?? null, grossLine, B.ob]);
  }

  // ---- overrides do §7.3 (propostos por uma pessoa, confirmados por outra)
  for (const o of D.OVERRIDES) {
    const sap = o.entity === 'material_uom'
      ? await one<{ v: number }>(q, `select gross_kg as v from material_uom where material_code = $1 and uom = $2`, [o.material, o.keyPart])
      : await one<{ v: number }>(q, `select ${o.field === 'layer_boxes' ? 'layer_boxes' : 'layers'} as v from palletization where material_code = $1 and plant = $2`, [o.material, o.keyPart]);
    if (!near(Number(sap.v), o.sapValue, 1e-12)) {
      throw new SeedError(`override ${o.material}.${o.field}: o SAP traz ${sap.v}, a decisão ${o.decisionRef} foi tomada sobre ${o.sapValue}; rever`);
    }
    await q.query(
      `insert into master_override (entity, material_code, key_part, field, sap_value, adopted_value, justification, decision_ref, status,
                                    proposed_by, proposed_at, confirmed_by, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10, $11, $10)`,
      [o.entity, o.material, o.keyPart, o.field, o.sapValue, o.adoptedValue, o.justification, o.decisionRef,
        user(D.OVERRIDE_PROPOSED_BY).id, D.DECISION_AT, user(D.OVERRIDE_CONFIRMED_BY).id]);
  }

  // ---- DERIVED_MISMATCH: JSON da Cecília × dado mestre adotado (SAP + overrides). Os JSON não alimentam o mestre.
  const eff = new Map((await q.query<{ code: string; net_kg: number; gross_kg: number; volume_dm3: number; boxes_per_pallet: number }>(
    `select code, net_kg, gross_kg, volume_dm3, boxes_per_pallet from material_effective`)).rows.map((r) => [r.code, r]));
  const mismatch = <T extends { material: number | string }>(items: T[], checks: [string, (i: T) => number, (e: NonNullable<ReturnType<typeof eff.get>>) => number, number][]) =>
    items.flatMap((i) => {
      const e = eff.get(String(i.material));
      if (!e) return [{ material: String(i.material), fields: ['material'] }];
      const fields = checks.filter(([, a, b, tol]) => !near(a(i), b(e), tol)).map(([f]) => f);
      return fields.length ? [{ material: String(i.material), fields }] : [];
    });
  await setReport(B.catalogo, { DERIVED_MISMATCH: mismatch(src.catalogo.data.itens, [
    ['peso_liquido', (i) => i.peso_liquido, (e) => e.net_kg, 1e-6],
    ['peso_bruto', (i) => i.peso_bruto, (e) => e.gross_kg, 1e-6],
    ['paletizacao_caixas', (i) => i.paletizacao_caixas, (e) => e.boxes_per_pallet, 0.5],
  ]) });
  await setReport(B.internos, { DERIVED_MISMATCH: mismatch(src.internos.data.itens, [['volume_max', (i) => i.volume_max, (e) => e.volume_dm3, 1e-3]]) });

  // ---- pedidos de exemplo
  const pedido = src.pedido.data;
  const totals = src.ob.rows.ordem.totais;
  if (!near(pedido.totais.peso_bruto_total, totals.X2_pesoBruto, 0.01) || !near(pedido.totais.peso_liquido_total, totals.W2_pesoLiquido, 0.01)
    || !near(pedido.totais.valor_total, totals.Y2_valor, 0.01)) {
    throw new SeedError('pedido.json não repete mais os totais das células ORDEM!X2, W2 e Y2 da OB');
  }
  for (const o of D.ORDERS) await insertOrder(q, o, { skuSet, user, userById, pedido, totals });
  await q.query(`select setval('sales_order_seq', $1)`, [D.ORDERS.length]);

  await setReport(B.ob, obReport);
  return { batches: Object.keys(B).length, orders: D.ORDERS.map((o) => o.id) };
}

interface OrderContext {
  skuSet: Set<string>;
  user: (username: string) => (typeof D.USERS)[number] & { id: number };
  userById: Map<number, (typeof D.USERS)[number]>;
  pedido: Pedido;
  totals: ObRows['ordem']['totais'];
}

async function insertOrder(q: Queryable, o: D.SeedOrder, ctx: OrderContext): Promise<void> {
  const reference = o.reference === 'pedido.json' ? ctx.pedido.cabecalho.referencia_cliente : o.reference;
  const header = { vehicleId: o.vehicleId, loadMode: o.loadMode };
  const creator = ctx.user(o.versions[0].author);
  const lastAt = o.approval?.at ?? o.versions[o.versions.length - 1].at;
  await q.query(
    `insert into sales_order (id, customer_code, status, current_version, origin, created_by, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [o.id, o.customer, o.approval ? 'APPROVED' : 'SUBMITTED', o.versions.length, o.origin, creator.id, o.versions[0].at, lastAt]);

  const event = (at: string, actorId: number | null, actorLabel: string, type: string, from: string | null, to: string, versionNo: number, payload: unknown) =>
    q.query(
      `insert into order_event (order_id, at, actor_id, actor_label, type, from_status, to_status, version_no, payload) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [o.id, at, actorId, actorLabel, type, from, to, versionNo, JSON.stringify(payload)]);

  let lines: Line[] = [];
  let current: { result: EngineResult; hash: string; versionNo: number; mixedPallet: boolean } | null = null;
  const authors = new Set<number>();
  for (const [index, v] of o.versions.entries()) {
    const versionNo = index + 1;
    const author = ctx.user(v.author);
    const where = `${o.id} v${versionNo}`;
    let changes: { material: string; old: number; new: number }[] = [];
    if (index === 0) {
      const raw = v.lines === 'pedido.json'
        ? ctx.pedido.itens.map((i) => ({ material: String(i.material), boxes: i.caixas }))
        : must(v.lines, `${where}: sem linhas`);
      lines = sortedLines(raw, ctx.skuSet, where);
    } else {
      if (author.role !== 'int_exportacao') throw new SeedError(`${where}: só int_exportacao cria nova versão (04)`);
      const next = new Map(lines.map((l) => [l.material, l.boxes]));
      for (const c of must(v.changes, `${where}: sem mudanças`)) {
        const old = next.get(c.material) ?? 0;
        if (old === c.boxes) continue;
        changes.push({ material: c.material, old, new: c.boxes });
        if (c.boxes === 0) next.delete(c.material);
        else next.set(c.material, c.boxes);
      }
      if (changes.length === 0) throw new SeedError(`${where}: nenhuma mudança efetiva`);
      lines = sortedLines([...next].map(([material, boxes]) => ({ material, boxes })), ctx.skuSet, where);
    }

    const priceDate = saoPauloDate(new Date(v.at));
    const built = await buildEngineInput(q, o.customer, header, lines, priceDate);
    const result = calculate(built.input);
    // Envio pelo portal não pode ter BLOCK; a exceção declarada é a v1 que entra pela OB (03).
    if (author.role === 'ext_distribuidor' && result.blocking) throw new SeedError(`${where}: envio do distribuidor com bloqueio`);
    const contentHeader = { ...header, mixedPallet: built.input.mixedPallet, reference, loadingDate: o.loadingDate };
    const hash = orderContentHash({ header: contentHeader, lines, engineVersion: 1, dataBatches: built.dataBatches, overrides: built.overrides });
    await q.query(
      `insert into order_version (order_id, version_no, vehicle_id, load_mode, mixed_pallet, customer_reference, loading_date, lines, engine_version,
                                  engine_result, blocking, data_batches, overrides, content_hash, author_id, author_label, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 1, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17)`,
      [o.id, versionNo, o.vehicleId, o.loadMode, built.input.mixedPallet, reference, o.loadingDate, JSON.stringify(lines),
        JSON.stringify({ ...result, inputs: { priceDate, vehicleId: o.vehicleId, customerCode: o.customer } }), result.blocking,
        JSON.stringify(built.dataBatches), JSON.stringify(built.overrides), hash, author.id, author.displayName, v.reason ?? null, v.at]);
    authors.add(author.id);

    if (index === 0) {
      const payload = o.origin === 'ORDER_BASIS'
        ? { internal: { origin: 'ORDER_BASIS', orderBasis: {
          grossKg: round(ctx.totals.X2_pesoBruto, 2), netKg: round(ctx.totals.W2_pesoLiquido, 2), pallets: round(ctx.totals.Y4_pallets, 3),
          valueUsd: round(ctx.totals.Y2_valor, 2), shipment: ctx.totals.W4_embarque } } }
        : {};
      await event(v.at, author.id, author.displayName, 'SUBMITTED', null, 'SUBMITTED', versionNo, payload);
    } else {
      await event(v.at, author.id, author.displayName, 'VERSION_CREATED', 'SUBMITTED', 'SUBMITTED', versionNo, v.reason ? { changes, reason: v.reason } : { changes });
    }
    current = { result, hash, versionNo, mixedPallet: built.input.mixedPallet };
  }

  if (o.approval && current) {
    const approver = ctx.user(o.approval.by);
    const where = `${o.id} aprovação`;
    // Segregação de funções (04): aprova só int_exportacao que não criou o pedido nem é autor de nenhuma versão.
    if (approver.role !== 'int_exportacao') throw new SeedError(`${where}: só int_exportacao aprova`);
    if (approver.id === creator.id || authors.has(approver.id)) throw new SeedError(`${where}: ${approver.username} criou o pedido ou uma versão`);
    if (current.result.blocking) throw new SeedError(`${where}: versão atual com bloqueio`);
    const built = await buildEngineInput(q, o.customer, header, lines, saoPauloDate(new Date(o.approval.at)));
    const recalculated = calculate(built.input);
    if (recalculated.blocking) throw new SeedError(`${where}: o recálculo com os dados de agora tem bloqueio`);
    const recalculatedHash = orderContentHash({
      header: { ...header, mixedPallet: built.input.mixedPallet, reference, loadingDate: o.loadingDate },
      lines, engineVersion: 1, dataBatches: built.dataBatches, overrides: built.overrides,
    });
    const resultChanged = canonicalJson(recalculated) !== canonicalJson(current.result);
    await event(o.approval.at, approver.id, approver.displayName, 'APPROVED', 'SUBMITTED', 'APPROVED', current.versionNo, {
      internal: {
        contentHash: current.hash, recalculatedContentHash: recalculatedHash, recalculatedBlocking: recalculated.blocking, resultChanged,
        ...(resultChanged ? { recalculatedResult: recalculated } : {}),
      },
    });
  }
}
