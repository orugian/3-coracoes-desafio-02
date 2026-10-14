-- 001_inicial: DDL do corte e catálogo efetivo (docs/specs/02-banco.md, "DDL do corte" e "Catálogo efetivo").
-- Aplicada numa transação pelo migrador (server/src/db/migrate.ts). Não editar depois de aplicada: criar 002_*.sql.
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

-- Catálogo efetivo: valores do SAP com os overrides ACTIVE aplicados.
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
