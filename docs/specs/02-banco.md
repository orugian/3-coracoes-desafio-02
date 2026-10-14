# 02 · Banco

Modelo do §7.2 da arquitetura reduzido ao corte. O mesmo SQL roda no PGlite 0.5.9 (PostgreSQL 18, padrão local) e no PostgreSQL 16; no Aurora, depois.

## Porta `Db`

```ts
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;          // vários comandos, sem parâmetros (migrações)
}
export interface Db extends Queryable {
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}
```

| Adaptador | Quando | Implementação |
|---|---|---|
| `pglite` | padrão; `DATA_DIR` (padrão `./storage/pglite`); em testes, em memória | `new PGlite(dir)`; `tx` = `db.transaction(fn)` |
| `pg` | se `DATABASE_URL` existir | `pg.Pool`; `tx` pega um cliente, `BEGIN`, `fn`, `COMMIT` ou `ROLLBACK` |

Concorrência: o PGlite serializa tudo numa conexão, mas no `pg` (READ COMMITTED) duas ações no mesmo pedido podem correr juntas. Toda ação de escrita sobre um pedido começa, dentro do `tx`, com `select … from sales_order where id = $1 for update`; a segunda espera, relê `current_version` e recebe 409 `VERSION_CONFLICT`. Violações de unicidade conhecidas (`order_version` PK, `sales_order (customer_code, idempotency_key)`) são traduzidas para 409 ou replay, nunca 500. O teste de concorrência roda no adaptador `pg` quando houver PostgreSQL; no PGlite, cobre só a tradução do erro.

Regras (§5): nenhum módulo fora dos adaptadores escreve `BEGIN`/`COMMIT`; nenhuma transação fica aberta durante leitura de arquivo ou chamada externa; colunas geradas sempre `STORED`; nenhuma extensão no corte. Converter na camada de repositório os tipos que os drivers devolvem como texto: `numeric` (preço) chega como string no PGlite e no `pg` (conferido no PGlite 0.5.9) e vira `Number()`; `bigint` (`nextval`, `count(*)`) chega como número no PGlite e como string no `pg`, então converter sempre. Por isso as medidas físicas são `double precision` e os IDs são `integer`. `date` sai dos dois adaptadores como texto `YYYY-MM-DD` (o padrão dos dois drivers é um `Date` à meia-noite, que muda de dia conforme o fuso).

DDL conferido em 13/10 no PGlite 0.5.9 (PostgreSQL 18.6): aplica numa transação; `boxes_per_pallet` é `STORED`; a view aplica o override (14 × 7 no 12034109); são rejeitados override `ACTIVE` sem confirmação ou confirmado pelo proponente, segundo override ativo no mesmo campo, `UPDATE`/`DELETE` em `order_version` e `order_event`, `origin` fora da lista, preço com chave natural repetida e `Idempotency-Key` repetida no mesmo cliente. Não testado em PostgreSQL 16 (sem Docker); a S2 inclui esse teste quando houver daemon.

## Migrações

`db/migrations/NNN_nome.sql`, aplicadas em ordem, cada uma em `tx` com `exec`. Tabela de controle `schema_migration (version text primary key, checksum text not null, applied_at timestamptz not null default now())`; checksum diferente de uma já aplicada aborta. `npm run db:migrate` aplica; `npm run db:seed` recria o banco do zero, migra e semeia. Como `order_version` e `order_event` não aceitam `DELETE`, reset é sempre banco novo. Travas do reset: em PGlite, recusa se `DATA_DIR` estiver em uso (arquivo `storage/pglite.lock` criado pelo `dev`); com `DATABASE_URL`, só apaga o schema se a variável `SEED_RESET=yes` estiver definida e o nome do banco terminar em `_dev` ou `_test`. Implementação: a trava é `${DATA_DIR}.lock` com o PID de quem abriu o banco; `dev`, `db:migrate` e `db:seed` a seguram enquanto o banco está aberto (dois processos no mesmo diretório do PGlite corrompem o banco), e uma trava de PID que já terminou é substituída. O reset só apaga `DATA_DIR` inexistente, vazio ou com `PG_VERSION` (um `DATA_DIR` apontado por engano para outra pasta não é apagado). Com `DATABASE_URL`, o nome conferido é o de `current_database()` na própria conexão.

## DDL do corte (`001_inicial.sql`)

```sql
create table import_batch (
  id integer generated always as identity primary key,
  source text not null check (source in ('SAP_CONFERENCIA','SAP_MATERIAIS','SAP_REGISTROS','ORDER_BASIS','DADOS_JSON','PILOTO','DECISOES')),
  file_name text not null,
  file_sha256 text not null,
  status text not null check (status in ('STAGED','ACTIVE','SUPERSEDED','REJECTED')),
  quality_report jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (source, file_sha256)
);

create table branch_plant (
  branch text primary key,                 -- 'LONT'
  plant text not null,                     -- '2612'
  plant_name text not null,                -- 'CD Londrina' (Registros, Desc. Centro)
  is_assumption boolean not null default true
);

create table customer (
  code text primary key,                   -- '11131'
  slug text not null unique,               -- 'minoil' (chave da UI)
  name text not null,
  country text,                            -- null = não informado (Q5)
  destination_label text not null,
  currency text not null,
  incoterm text not null,
  payment_code text not null,
  payment_terms text not null,
  price_list text not null,                -- 'US', 'AR'
  branch text not null references branch_plant(branch),
  contact_name text,
  language text not null check (language in ('pt','es','en')),
  mixed_pallet boolean not null default false,
  auto_approve boolean not null default false,
  is_demo boolean not null default false,
  batch_id integer not null references import_batch(id)
);

create table material (
  code text primary key,
  sap_description text not null,
  family text not null,                    -- código da UI: CAFES, CAPPUCCINO, SOLUVEIS, FILTROS, PORTA
  sap_hierarchy text,
  brand text not null,
  units_label text not null,               -- '20 × 250 g'
  ncm text, product_line text, ean text, dun text,
  shelf_life_days integer,
  active boolean not null default true,
  batch_id integer not null references import_batch(id)
);

create table material_i18n (
  material_code text not null references material(code),
  lang text not null check (lang in ('pt','es','en')),
  name text not null,
  primary key (material_code, lang)
);

create table material_uom (
  material_code text not null references material(code),
  uom text not null,                       -- 'CX', 'UN', 'SCH', 'KG'...
  units_per_uom double precision not null, -- Contador ÷ Denominador, em UMB
  ean text,
  length_mm double precision, width_mm double precision, height_mm double precision,
  volume_dm3 double precision,
  net_kg double precision, gross_kg double precision,   -- já normalizados para kg
  weight_unit_raw text not null,           -- 'KG' | 'G', como veio do SAP
  batch_id integer not null references import_batch(id),
  primary key (material_code, uom)
);

create table palletization (
  material_code text not null references material(code),
  plant text not null,
  layer_boxes integer not null check (layer_boxes > 0),     -- lastro do SAP
  layers integer not null check (layers > 0),               -- altura do SAP
  boxes_per_pallet integer generated always as (layer_boxes * layers) stored,
  min_lot_pallets double precision not null default 1,
  min_lot_source text not null check (min_lot_source in ('OB_PALETIZACAO','DEFAULT')),
  batch_id integer not null references import_batch(id),
  primary key (material_code, plant)
);

create table price (
  id integer generated always as identity primary key,
  channel text not null, plant text not null, price_list text not null,
  customer_code text references customer(code),             -- null = vale para a lista
  material_code text not null references material(code),
  uom text not null default 'CX' check (uom = 'CX'),
  valid_from date not null, valid_to date not null check (valid_from <= valid_to),
  price numeric(12,2) not null check (price >= 0),
  price_raw numeric,                                        -- antes do arredondamento (17,611)
  currency text not null,
  origin text not null check (origin in ('SAP_LIST','SITE_3C','DEMO_DERIVED')),
  batch_id integer not null references import_batch(id)
);
create unique index price_natural_key on price (channel, plant, price_list, coalesce(customer_code, ''), material_code, uom, valid_from);

create table vehicle_type (
  id text primary key,                     -- 'carreta_padrao', 'container_40', 'container_20'
  display_name text not null,
  modal text not null check (modal in ('rodoviario','maritimo')),
  volume_m3 double precision not null,
  payload_kg double precision not null,
  pallet_positions integer not null,
  source_by_field jsonb not null,          -- {"volume_m3":"container.json","pallet_positions":"artefato 3C Conecta (Q4)"}
  sort_order integer not null
);

create table country_rule (
  id integer generated always as identity primary key,
  country text not null,
  customer_code text references customer(code),             -- null = todos os clientes do país
  material_code text not null references material(code),
  kind text not null check (kind = 'BLOCK'),
  reason text not null,
  is_demo boolean not null default false
);

create table material_ob_reference (                        -- valores da OB para o backoffice (substitui P[].ob)
  material_code text primary key references material(code),
  boxes_per_pallet_tab double precision,
  boxes_per_pallet_paletizacao double precision,
  price_tab double precision,
  min_lot_lookup double precision,
  gross_kg_per_box_line double precision,
  batch_id integer not null references import_batch(id)
);

create table app_user (
  id integer generated always as identity primary key,
  username text not null unique,
  display_name text not null,
  role text not null check (role in ('ext_distribuidor','int_exportacao','int_admin')),
  password_hash text not null,             -- scrypt$N$r$p$sal$hash (base64url)
  active boolean not null default true,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table user_customer_scope (
  user_id integer not null references app_user(id),
  customer_code text not null references customer(code),
  primary key (user_id, customer_code)
);

create table app_session (
  id text primary key,                     -- 32 bytes aleatórios, base64url
  user_id integer not null references app_user(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text, user_agent text
);

create table master_override (
  id integer generated always as identity primary key,
  entity text not null check (entity in ('material_uom','palletization')),
  material_code text not null references material(code),
  key_part text not null,                  -- 'CX' (material_uom) ou o centro (palletization)
  field text not null check (field in ('gross_kg','layer_boxes','layers')),
  sap_value double precision not null,
  adopted_value double precision not null,
  justification text not null,
  decision_ref text not null,              -- 'Q9', 'Q12'
  status text not null check (status in ('PROPOSED','ACTIVE','REVOKED')),
  proposed_by integer not null references app_user(id),
  proposed_at timestamptz not null default now(),
  confirmed_by integer references app_user(id),
  confirmed_at timestamptz,
  check (confirmed_by is null or confirmed_by <> proposed_by),
  check (status <> 'ACTIVE' or confirmed_by is not null)
);
create unique index master_override_active on master_override (entity, material_code, key_part, field) where status = 'ACTIVE';

create sequence sales_order_seq;

create table sales_order (
  id text primary key,                     -- '3CC-2026-0001'
  customer_code text not null references customer(code),
  status text not null check (status in ('DRAFT','SUBMITTED','CHANGES_REQUESTED','APPROVED','EXPORTED')),
  current_version integer not null,
  origin text not null check (origin in ('PORTAL','ORDER_BASIS','BACKOFFICE')),
  created_by integer not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text,
  idempotency_hash text,
  unique (customer_code, idempotency_key)
);
create index sales_order_status on sales_order (status, created_at desc);

create table order_version (
  order_id text not null references sales_order(id),
  version_no integer not null check (version_no >= 1),
  vehicle_id text not null references vehicle_type(id),
  load_mode text not null check (load_mode in ('PALLETIZED','FLOOR')),
  mixed_pallet boolean not null,
  customer_reference text not null default '',
  loading_date date,
  lines jsonb not null,                    -- [{"material":"12031189","boxes":3528}], ordem do catálogo
  engine_version integer not null,
  engine_result jsonb not null,            -- EngineResult completo (01)
  blocking boolean not null,
  data_batches jsonb not null,             -- ids de import_batch ACTIVE usados
  overrides jsonb not null default '[]'::jsonb,   -- ids de master_override ACTIVE usados
  content_hash text not null,              -- sha256 do JSON canônico (cabeçalho, linhas, engine_version, data_batches, overrides)
  author_id integer not null references app_user(id),
  author_label text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (order_id, version_no)
);

create table order_event (
  id integer generated always as identity primary key,
  order_id text not null references sales_order(id),
  at timestamptz not null default now(),
  actor_id integer references app_user(id),    -- null = regra automática
  actor_label text not null,
  type text not null check (type in ('SUBMITTED','VERSION_CREATED','APPROVED','AUTO_APPROVED','CHANGES_REQUESTED','RESUBMITTED')),
  from_status text, to_status text,
  version_no integer,
  payload jsonb not null default '{}'::jsonb
);
create index order_event_order on order_event (order_id, id);

create table customer_rule_change (
  id integer generated always as identity primary key,
  customer_code text not null references customer(code),
  field text not null check (field in ('mixed_pallet','auto_approve')),
  old_value boolean not null, new_value boolean not null,
  actor_id integer not null references app_user(id),
  at timestamptz not null default now()
);

create function forbid_update_delete() returns trigger language plpgsql as $$
begin
  raise exception '% aceita só inserção', tg_table_name;
end $$;
create trigger order_version_immutable before update or delete on order_version
  for each row execute function forbid_update_delete();
create trigger order_event_append_only before update or delete on order_event
  for each row execute function forbid_update_delete();
create trigger customer_rule_change_append_only before update or delete on customer_rule_change
  for each row execute function forbid_update_delete();
```

## Catálogo efetivo

Os valores do SAP ficam intactos nas tabelas (inclusive `palletization.boxes_per_pallet`, gerado do lastro e da altura do SAP); o valor usado pelo motor vem de uma view que aplica os overrides `ACTIVE`. É o que permite mostrar "SAP × adotado" no backoffice e trocar um override sem reimportar.

```sql
create view material_effective as
select m.code, m.family,
       cx.units_per_uom as units_per_box, cx.net_kg, cx.volume_dm3,
       cx.length_mm, cx.width_mm, cx.height_mm,
       coalesce(og.adopted_value, cx.gross_kg) as gross_kg,
       p.plant,
       coalesce(ol.adopted_value, p.layer_boxes)::integer as layer_boxes,
       coalesce(oh.adopted_value, p.layers)::integer as layers,
       (coalesce(ol.adopted_value, p.layer_boxes) * coalesce(oh.adopted_value, p.layers))::integer as boxes_per_pallet,
       p.min_lot_pallets
from material m
join material_uom cx on cx.material_code = m.code and cx.uom = 'CX'
join palletization p on p.material_code = m.code
left join master_override og on og.status = 'ACTIVE' and og.entity = 'material_uom'  and og.material_code = m.code and og.key_part = 'CX'    and og.field = 'gross_kg'
left join master_override ol on ol.status = 'ACTIVE' and ol.entity = 'palletization' and ol.material_code = m.code and ol.key_part = p.plant and ol.field = 'layer_boxes'
left join master_override oh on oh.status = 'ACTIVE' and oh.entity = 'palletization' and oh.material_code = m.code and oh.key_part = p.plant and oh.field = 'layers'
where m.active;
```

Preço vigente de um cliente numa data `d` (`resolvePrice`): a linha de `price` com `channel = '13'` (Exportação, o único canal dos exports), `price_list = customer.price_list`, `plant = branch_plant.plant` do cliente, `uom = 'CX'` e `valid_from <= d <= valid_to`, preferindo `customer_code = cliente` a `customer_code is null` e, entre janelas sobrepostas, a de `valid_from` mais recente. Sem linha: `priceCents = null` (`NO_PRICE`). A data `d` é a da criação da versão (fuso de São Paulo) e fica gravada no resultado. O seed não cria janelas sobrepostas; o teste do seed afirma isso.

Montagem da entrada do motor (`buildEngineInput(q, customerCode, header, lines, priceDate)`), usada pelo portal, pelo backoffice e pelos testes: itens de `material_effective` para o centro do cliente, na ordem de `material.code`; preço como acima; `restrictedMaterials` de `country_rule` com `country = customer.country` e (`customer_code` nulo ou igual ao cliente); veículo de `vehicle_type`; `fullAt` 0,9. Ela devolve também os `data_batches`, `overrides` e `priceDate` usados, que vão para `order_version` (os dois primeiros em colunas, a data dentro de `engine_result.inputs`). "Usados" = pelas linhas do pedido: lotes do cliente e do cadastro, da paletização e do preço dos materiais das linhas, e os overrides `ACTIVE` desses materiais no centro do cliente; um override de outro SKU não muda o `content_hash`. Para o catálogo, a mesma consulta junta `material_effective` com `material` (marca, `units_label`, EAN, DUN, NCM, linha, validade) e `material_i18n`.
