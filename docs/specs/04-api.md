# 04 · API

Servidor Hono 4.13.13 em `@hono/node-server` 2.1.5, um processo (`npm run dev`), mesma origem para a UI e a API (§5). Contratos em zod 4.6.7 em `packages/contracts` (importado como `#contracts`); `npm run contracts:schema` grava o JSON Schema de cada contrato com `z.toJSONSchema` em `docs/specs/schemas/` para quem integra o front: um arquivo por contrato (corpos de requisição no modo `input`, em que campo com padrão é opcional; respostas no modo `output`, com `additionalProperties: false`), lista em `packages/contracts/src/json-schema.ts`. O teste dos contratos falha se os arquivos versionados não baterem com o zod. Base: §6, §7.2 e §11 da arquitetura.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | 3000 | Porta HTTP |
| `SESSION_SECRET` | obrigatória fora dos testes (≥ 32 bytes) | Assinatura HS256 do token de sessão |
| `DATA_DIR` | `./storage/pglite` | Banco PGlite |
| `DATABASE_URL` | — | Se definida, usa PostgreSQL via `pg` |
| `COOKIE_SECURE` | `false` | `true` atrás de HTTPS |
| `SEED_PASSWORD` | — | Só o seed (03) |
| `SEED_RESET` | — | `yes` autoriza o `db:seed` a recriar o schema com `DATABASE_URL`, só em banco `_dev` ou `_test` (02) |

`.env.example` sem valores; `.env` e `storage/` no `.gitignore`.

## Pipeline de cada requisição

1. `hono/request-id` e log de uma linha por requisição (id, usuário, rota, status, ms). Nunca registrar corpo de `/v1/auth/login`.
2. `hono/secure-headers` com os padrões, sem CSP no corte (a UI do piloto usa scripts inline e Google Fonts).
3. Em `/v1/*`: `hono/body-limit` de 64 KB (413); em métodos que alteram estado (inclusive o logout, que manda `{}`), `Content-Type: application/json` obrigatório (senão 415) e checagem de origem própria (D13): passa se `Sec-Fetch-Site` for `same-origin` ou, na ausência dele, se `Origin` for igual à origem do servidor; senão 403 `FORBIDDEN`. Ordem das recusas: 413, 415, 403. Não usar `hono/csrf`, que em 4.13.13 só age em `Content-Type` de formulário e `text/plain`. Sem CORS (nenhum cabeçalho `Access-Control-*`), então um JSON vindo de outra origem morre no preflight. Com `curl`, mandar `-H "Origin: http://localhost:3000"`.
4. Sessão (abaixo) em todo `/v1/*` exceto `POST /v1/auth/login` e `GET /v1/health` (responde `{ ok: true, engineVersion: 1 }`, sem dado). Por vir antes do roteamento, uma rota inexistente em `/v1/*` sem sessão dá 401, e com sessão, 404.
5. Guarda por prefixo: `/v1/portal/*` só `ext_distribuidor`; `/v1/backoffice/*` só `int_exportacao` e `int_admin`. Papel errado: 403, também para rota inexistente sob o prefixo. O papel vem do banco (D12).
6. Guarda por ação (matriz abaixo) e escopo de cliente, sempre lido do banco.
7. Fora de `/v1/*`, arquivos estáticos de uma **lista fechada** (05), com raiz fixa e caminho normalizado antes da comparação (`..`, `%2e%2e`, barra invertida e caminho absoluto dão 404): `/` e `/index.html` (o mesmo arquivo), `/vendor/*`, `/assets/*`, `/api-client.js`, e `/demo-data.js` respondido sempre com o conteúdo fixo `window.PSF_DEMO = null;` (nunca o arquivo). Qualquer outro caminho é 404, inclusive `/dados/*`, `/pre-solucao/*`, `/docs/*`, `/storage/*` e `/.git/*`. Implementação: a lista é montada na partida (arquivo novo em `vendor/` ou `assets/` só aparece depois de reiniciar), só com extensões conhecidas (`.js`, `.css`, imagens, `.woff2`, `.txt`), sem links simbólicos nem arquivos ocultos; só `GET`/`HEAD`. A comparação usa o caminho **cru** que chegou no socket (`incoming.url`), porque o `URL` do `Request` já resolve `%2e%2e` e a barra invertida (`/assets/%2e%2e/index.html` viraria `/index.html`); por isso o teste de travessia roda num servidor HTTP real, não em `app.request()`.

## Sessão

- Senha: `crypto.scrypt` (N 16384, r 8, p 1, chave de 64 bytes, sal de 16 bytes), formato `scrypt$N$r$p$sal$hash` em base64url; comparação com `timingSafeEqual`. Usuário inexistente também calcula um scrypt (contra um hash fixo), para o tempo de resposta não revelar quem existe.
- Login correto: zera `failed_logins`, cria `app_session` (id aleatório de 32 bytes, expira em 8 h) e devolve o cookie `psf_session` = token HS256 (`hono/jwt`) com `sub` (id do usuário), `role`, `sid`, `iat`, `exp`. Atributos: `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` e `Secure` se `COOKIE_SECURE`.
- Login errado: incrementa `failed_logins`; no 5º erro seguido, `locked_until = agora + 15 min`. Com `locked_until` no passado, o contador recomeça do zero na próxima tentativa. Tentativa durante o bloqueio não conta nem prolonga o bloqueio. Para não revelar quem existe, o bloqueio responde **igual a uma senha errada** (401 `LOGIN_FAILED`, mesma mensagem e o mesmo scrypt) para usuário existente bloqueado, usuário inexistente, usuário inativo e senha errada; o bloqueio fica só no log do servidor (pelo id do usuário, nunca o nome digitado). Efeito colateral aceito na demo: quem souber o nome de um usuário pode bloqueá-lo por 15 min (`npm run user:unlock`, 03).
- A cada requisição: token válido **e** sessão existente, não revogada, não expirada, e usuário ativo; papel e escopo relidos do banco (D12). Qualquer falha: 401 e cookie apagado.
- Logout: `revoked_at = agora`, cookie apagado, 204.
- As claims (`sub`, `role`) são as que o Cognito vai emitir na fase 2 (§5): só o verificador muda.

## Matriz de permissões do corte

Recorte da matriz do §6 (deny-by-default). "Escopo" = clientes de `user_customer_scope`; fora dele, a resposta é **404** (não revela que o recurso existe).

| Ação | `ext_distribuidor` | `int_exportacao` | `int_admin` |
|---|---|---|---|
| Catálogo com preço da própria lista | Escopo | — (usa `products`) | — (usa `products`) |
| Simular (`quote`) e enviar pedido | Escopo | Não no corte | Não |
| Ver pedidos | Escopo | Todos | Todos |
| Nova versão de pedido `SUBMITTED` | Não | Sim | Não |
| Reenviar pedido devolvido | Escopo | Não | Não |
| Aprovar | Não | Sim, se não criou o pedido nem é autor de nenhuma versão | Não |
| Devolver ao distribuidor | Não | Sim | Não |
| Regras do cliente (pallet misto, aprovação automática) | Não | Sim | Sim |
| Produtos com origem do preço, overrides e valores da OB | Não | Leitura | Leitura |

O backoffice calcula, para o usuário da sessão, `permissions` de cada pedido (`canEdit`, `canApprove`, `canReturn`) com as mesmas funções que as rotas usam para autorizar; a UI só esconde ou desabilita, quem decide é a rota.

## Contratos

Definidos em zod; abaixo, a forma em TypeScript. `EngineResult` e `Alert` são os do motor (01).

```ts
type VehicleId = 'carreta_padrao' | 'container_40' | 'container_20';
type OrderStatus = 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'EXPORTED';

type Line = { material: string; boxes: number };            // material: 8 dígitos; boxes: inteiro de 1 a 100.000
type OrderHeader = {
  vehicleId: VehicleId;
  loadMode: 'PALLETIZED' | 'FLOOR';
  reference: string;                                         // aparado, até 30 caracteres, sem caracteres de controle
  loadingDate: string | null;                                // YYYY-MM-DD
};

type CustomerProfile = {
  code: string; slug: string; name: string; destinationLabel: string;
  currency: string; incoterm: string; paymentCode: string; paymentTerms: string;
  priceList: string; plant: string; plantName: string; branch: string; contactName: string | null;
  language: 'pt' | 'es' | 'en'; mixedPallet: boolean;
};
type CustomerInternal = CustomerProfile & { country: string | null; autoApprove: boolean; isDemo: boolean; restrictedMaterials: string[] };

type Me = {
  user: { id: number; username: string; displayName: string; role: 'ext_distribuidor' | 'int_exportacao' | 'int_admin' };
  area: 'portal' | 'backoffice';
  customers: CustomerProfile[];                              // portal: os do escopo; backoffice: []
};

type Vehicle = { id: VehicleId; displayName: string; modal: 'rodoviario' | 'maritimo'; volumeM3: number; payloadKg: number; palletPositions: number; assumptions: string[] };

type CatalogItem = {
  material: string; family: string; brand: string; sapDescription: string;
  names: { pt: string; es: string; en: string }; unitsLabel: string;
  unitsPerBox: number; netKgPerBox: number; grossKgPerBox: number; volumeDm3: number;
  dimsMm: { length: number; width: number; height: number };
  layerBoxes: number; layers: number; boxesPerPallet: number; minLotPallets: number;
  price: number | null;                                      // lista do cliente; null = sem preço
  ean: string | null; dun: string | null; ncm: string | null; productLine: string | null; shelfLifeDays: number | null;
};

type PortalCatalog = {
  engineVersion: 1;
  customer: CustomerProfile & { restrictedMaterials: string[] };
  rules: { fullAt: number; leadDays: number };               // 0,9 e 7
  vehicles: Vehicle[];
  items: CatalogItem[];
};

type ProductInternal = Omit<CatalogItem, 'price'> & {
  prices: { priceList: string; price: number; priceRaw: number | null; origin: 'SAP_LIST' | 'SITE_3C' | 'DEMO_DERIVED'; validFrom: string; validTo: string }[];
  sap: { layerBoxes: number; layers: number; grossKgPerBox: number };
  overrides: { field: string; sapValue: number; adoptedValue: number; justification: string; decisionRef: string; proposedBy: string; confirmedBy: string; confirmedAt: string }[];
  ob: { boxesPerPallet: number | null; palletizationBoxes: number | null; price: number | null; minLot: number | null; grossKgPerBox: number | null };
  minLotSource: 'OB_PALETIZACAO' | 'DEFAULT';
};

type OrderVersionView = {
  versionNo: number; header: OrderHeader & { mixedPallet: boolean }; lines: Line[];
  result: EngineResult; authorLabel: string; reason: string | null; createdAt: string;
  internal?: { dataBatches: number[]; overrides: number[]; contentHash: string };   // só no backoffice
};
type OrderEventView = { at: string; actorLabel: string; type: string; fromStatus: string | null; toStatus: string | null; versionNo: number | null; payload: EventPayloadPortal | (EventPayloadPortal & { internal: Record<string, unknown> }) };
type EventPayloadPortal = { changes?: { material: string; old: number; new: number }[]; reason?: string };   // única forma que o portal recebe
type OrderView = {
  id: string; customerCode: string; customerName: string; status: OrderStatus; origin: 'PORTAL' | 'ORDER_BASIS' | 'BACKOFFICE';
  currentVersion: number; createdAt: string; createdByLabel: string;
  submittedAt: string; approvedAt: string | null; approvedByLabel: string | null;
  current: OrderVersionView;
  permissions: { canEdit: boolean; canApprove: boolean; canReturn: boolean; canResubmit: boolean };   // para o usuário da sessão
  versions?: OrderVersionView[];                             // só no detalhe
  events?: OrderEventView[];                                 // só no detalhe
};

type ApiErrorBody = { error: { code: string; message: string; details?: { code: string; material?: string; params?: Record<string, unknown> }[] } };
```

O que **nunca** aparece em resposta do portal: `origin` do preço, preço de outra lista, `ob`, `sap`, `overrides`, `autoApprove`, `country`, `isDemo`, `internal` (de versão ou de evento), e qualquer dado de cliente fora do escopo. As respostas do portal passam por um schema zod **estrito** (`.strict()` nos objetos), aplicado na saída: um campo novo que não esteja no contrato do portal gera erro no teste, em vez de vazar. O `actorLabel` de usuários internos aparece para o distribuidor (é o que o piloto já mostra: "Lucas (Exportação)").

Detalhes de implementação dos contratos:
- A única chave `origin` que o portal recebe é a do topo do `OrderView` (origem do **pedido**: `PORTAL`, `ORDER_BASIS`, `BACKOFFICE`); o teste de isolamento 4 permite só esse caminho.
- `OrderVersionView.result` é o `EngineResult` sem `inputs` (`priceDate`, veículo e cliente ficam só em `engine_result` no banco).
- `payload` de evento no portal: só `changes` e `reason`; no backoffice, também `internal`.
- `submittedAt` é o do último `SUBMITTED` ou `RESUBMITTED`; `approvedAt` e `approvedByLabel`, os do último `APPROVED` ou `AUTO_APPROVED`.
- `permissions.canReturn` e `canResubmit` ficam falsos enquanto as rotas da S9 não existirem.
- `Vehicle.assumptions`: os campos que não vêm do `container.json`, com a fonte (no corte, "Posições de pallet: artefato 3C Conecta (Q4)").
- Catálogo de distribuidor sem nenhum cliente no escopo: 404.

## Rotas

| Método e rota | Quem | Corpo → resposta | Erros |
|---|---|---|---|
| `POST /v1/auth/login` | público | `{ username, password }` → 200 `Me` e cookie | 401 `LOGIN_FAILED` (também para conta bloqueada); 422 |
| `POST /v1/auth/logout` | autenticado | → 204 | — |
| `GET /v1/auth/me` | autenticado | → `Me` | 401 |
| `GET /v1/health` | público | → `{ ok: true, engineVersion: 1 }` | — |
| `GET /v1/portal/catalog?customer=` | ext | → `PortalCatalog`. Sem `customer` e com um cliente no escopo, usa esse | 404 fora do escopo; 422 sem `customer` e com mais de um |
| `POST /v1/portal/quote` | ext | `{ customerCode, header, lines }` → `EngineResult`, sem gravar | 404; 422 |
| `POST /v1/portal/orders` | ext | Cabeçalho `Idempotency-Key`; `{ customerCode, header, lines }` → 201 `OrderView` (detalhe) | 404; 422 `ORDER_BLOCKED`, `LOADING_DATE_TOO_SOON`, `VALIDATION_FAILED`; 428 `IDEMPOTENCY_KEY_REQUIRED`; 409 `IDEMPOTENCY_KEY_REUSED` |
| `GET /v1/portal/orders?status=` | ext | → `OrderView[]` do escopo, mais recentes primeiro | — |
| `GET /v1/portal/orders/:id` | ext | → `OrderView` com versões e eventos | 404 |
| `POST /v1/portal/orders/:id/versions` (desejável) | ext | `{ expectedVersion, header, lines }` → `OrderView` | 404; 409 `INVALID_TRANSITION`, `VERSION_CONFLICT`; 422 `ORDER_BLOCKED` |
| `GET /v1/backoffice/customers` | int | → `{ customers: CustomerInternal[], ruleChanges: { at, customerCode, field, oldValue, newValue, actorLabel }[] }` (últimas 50) | — |
| `PUT /v1/backoffice/customers/:code/rules` | int | `{ mixedPallet?, autoApprove? }` (pelo menos um) → `CustomerInternal`. Só grava e registra em `customer_rule_change` o campo que muda de valor. Entra na S5 (o teste da aprovação automática liga a regra por esta rota) | 404; 422 |
| `GET /v1/backoffice/products` | int | → `{ items: ProductInternal[], vehicles: Vehicle[], rules }` | — |
| `GET /v1/backoffice/orders?status=&customer=&q=` | int | → `OrderView[]` (`q` busca em id, referência e nome do cliente) | — |
| `GET /v1/backoffice/orders/:id` | int | → `OrderView` com versões (com `internal`) e eventos | 404 |
| `POST /v1/backoffice/orders/:id/versions` | `int_exportacao` | `{ expectedVersion, changes: { material, boxes }[], reason? }` → `OrderView`. `boxes` de 0 a 100.000; 0 remove a linha. Depois de aplicar: pelo menos 1 linha, senão 422; nenhuma mudança efetiva (todas iguais ao atual), 422 `NO_CHANGES` sem criar versão | 404; 409 `INVALID_TRANSITION`, `VERSION_CONFLICT`; 422 |
| `POST /v1/backoffice/orders/:id/approve` | `int_exportacao` | `{ expectedVersion }` → `OrderView` | 403 `SELF_APPROVAL_FORBIDDEN`; 409 `ORDER_BLOCKED`, `INVALID_TRANSITION`, `VERSION_CONFLICT` |
| `POST /v1/backoffice/orders/:id/return` (desejável) | `int_exportacao` | `{ expectedVersion, reason }` → `OrderView` | 409 |

Não há rota de exportação no corte.

Detalhes do backoffice (S6):
- `GET /backoffice/customers`: `ruleChanges` mais recentes primeiro, com `field` no nome da API (`mixedPallet`, `autoApprove`, como no `PUT`) e `actorLabel` do usuário.
- `GET /backoffice/products`: um item por material do catálogo efetivo do centro (no corte há um só, 2612; com mais de um, o contrato ganha o centro). `prices` = linhas de lista (`customer_code` nulo) do canal 13 no centro, de todas as listas, em ordem de lista e vigência; `sap` = valores do SAP sem override (`grossKgPerBox` da UM CX); `overrides` = os `ACTIVE`, com `field` no nome de `CatalogItem` (`grossKgPerBox`, `layerBoxes`, `layers`) e os nomes de quem propôs e confirmou; `ob` de `material_ob_reference` (`boxesPerPallet` = TAB, `palletizationBoxes` = PALETIZAÇÃO ÷ un/cx, `price` = TAB, `minLot`, `grossKgPerBox` = linha da ORDEM), com os números como estão no banco.
- `GET /backoffice/orders`: `q` aparado, de 1 a 64 caracteres, sem diferenciar maiúsculas, com `%` e `_` como texto; `status` fora da lista ou `q` longo: 422. `int_admin` lê tudo, com `permissions` todas falsas.
- `POST .../versions`: `changes` de 1 a 50 materiais únicos (`DUPLICATE_MATERIAL`), caixas inteiras; material novo entra com `old` 0 e precisa existir no catálogo do cliente (`UNKNOWN_MATERIAL`); sem linha depois de aplicar, 422 com detalhe `NO_LINES`; `reason` aparado, até 200 caracteres, sem caracteres de controle (vazio = nulo). Cabeçalho copiado da versão atual; pallet misto do cliente agora; sem a regra da data (vale só no envio e no reenvio). Resposta 200 com o detalhe.
- `POST .../approve`: resposta 200 com o detalhe. O 409 `ORDER_BLOCKED` traz em `details` os BLOCK da versão gravada ou, se ela estiver limpa, os do recálculo (com mensagem própria). Material da versão que saiu do catálogo depois dela (inativo ou sem paletização): a mesma entrada já não roda, e a resposta é 409 `ORDER_BLOCKED` com detalhe `UNKNOWN_MATERIAL`.
- Ordem das recusas nas duas ações: 403 do papel (`int_admin`), 422 do corpo (inclusive material repetido), 404, 409 `INVALID_TRANSITION`, 403 `SELF_APPROVAL_FORBIDDEN` (só na aprovação), 409 `VERSION_CONFLICT`, depois 422 das mudanças (nova versão) ou 409 `ORDER_BLOCKED` (aprovação). Violação da PK de `order_version` dentro da transação (gravação concorrente que passou pela trava): 409 `VERSION_CONFLICT` com a versão atual, nada gravado.

## Máquina de estados do corte

| De | Para | Ação | Quem e condições | Evento |
|---|---|---|---|---|
| — | `SUBMITTED` | `POST /portal/orders` | ext no escopo; motor sem BLOCK; data de carregamento vazia ou ≥ hoje + 7 dias (fuso de São Paulo) | `SUBMITTED` |
| `SUBMITTED` | `APPROVED` | mesma requisição | `customer.auto_approve`, sem BLOCK, utilização máxima ≥ 0,9 | `AUTO_APPROVED`, ator nulo, rótulo "Regra de aprovação automática", `payload.internal.ruleChangeId` da última mudança que ligou a regra (o portal não recebe `internal`) |
| `SUBMITTED` | `SUBMITTED`, versão + 1 | `POST /backoffice/.../versions` | `int_exportacao`; a nova versão pode ter BLOCK (é ajuste em andamento) | `VERSION_CREATED`, `payload.changes = [{ material, old, new }]` |
| `SUBMITTED` | `APPROVED` | `POST /backoffice/.../approve` | `int_exportacao` que não é `created_by` nem `author_id` de nenhuma versão; `expectedVersion` igual à atual; a versão atual sem BLOCK **e** um recálculo da mesma entrada (linhas e cabeçalho da versão, com os dados e o preço vigentes agora) sem BLOCK | `APPROVED`, `payload.internal` com o `content_hash` gravado, o hash e o resultado recalculados, e `resultChanged` |
| `SUBMITTED` | `CHANGES_REQUESTED` | `POST /backoffice/.../return` | `int_exportacao`; motivo obrigatório | `CHANGES_REQUESTED` |
| `CHANGES_REQUESTED` | `SUBMITTED`, versão + 1 | `POST /portal/.../versions` | ext no escopo; sem BLOCK; mesma regra de data de carregamento do envio. Não dispara aprovação automática (o pedido já passou por uma pessoa) | `RESUBMITTED` |
| `APPROVED` | `EXPORTED` | — | Fase futura | — |

Semântica da aprovação: o que se aprova é a **versão atual, como gravada** (linhas, preços e resultado que o distribuidor e a Exportação viram). O recálculo (linhas e cabeçalho da versão, inclusive o pallet misto congelado nela, com os dados e o preço vigentes na data da aprovação) serve só de guarda: se, com os dados ativos de agora, a mesma entrada passar a ter BLOCK (por exemplo, um override revogado ou uma regra de país nova), a aprovação é recusada com 409 `ORDER_BLOCKED` e a Exportação cria uma nova versão. Se o recálculo mudar sem BLOCK (outro preço vigente, por exemplo), a aprovação segue, `resultChanged` fica verdadeiro no evento e a tela de detalhe mostra o aviso "os dados mudaram desde esta versão". No corte, sem importador, os dados só mudam pelo seed e pelas regras do cliente, então o caso é raro, mas a regra já vale para a F3.

A aprovação automática é a exceção à aprovação por segunda pessoa: é uma regra por cliente, desligada por padrão, ligada por uma pessoa identificada (`customer_rule_change`) e registrada no evento.

## Regras transversais

- **Recálculo:** o servidor ignora qualquer resultado vindo do navegador. Toda versão é calculada por `buildEngineInput` (02) e `calculate` (01); o pallet misto vem de `customer.mixed_pallet`, nunca do corpo, e fica congelado na versão.
- **Validação de linhas:** de 1 a 50 linhas, materiais únicos, existentes e ativos, caixas inteiras de 1 a 100.000. Caixa fracionária: 422 `VALIDATION_FAILED` com detalhe `QTY_NOT_MULTIPLE` (a UI resolve o arredondamento antes). Códigos de detalhe do 422: `QTY_NOT_MULTIPLE` (`params.lo`, `params.hi`), `DUPLICATE_MATERIAL`, `UNKNOWN_MATERIAL` (inexistente, inativo ou sem paletização no centro do cliente) e `INVALID_FIELD` (`params.path`, `params.issue`, sem ecoar o valor). Vale para `quote` e para o envio; a simulação não aplica a regra da data.
- **Bloqueio no envio:** 422 `ORDER_BLOCKED` com `details` = alertas BLOCK do motor (`{ code, material, params }`), na ordem das linhas (catálogo) e depois os do pedido.
- **Idempotência:** `Idempotency-Key` (8 a 64 caracteres `[A-Za-z0-9_-]`) por cliente; ausente, 428; fora do formato, 422. Mesma chave e mesmo corpo (sha256 do JSON canônico de `customerCode`, cabeçalho e linhas, depois da validação: campos fora do contrato, como `mixedPallet`, não contam): 200 com o pedido já criado e cabeçalho `Idempotent-Replayed: true`. Mesma chave e corpo diferente: 409. A busca pela chave vem antes da regra da data e do motor, então o replay devolve o pedido mesmo depois que a data deixou de passar. Ordem das recusas no envio: 428; 422 do corpo (contrato, materiais repetidos, caixa fracionária); 404 do escopo; replay ou 409; 422 de material inexistente no catálogo do cliente; 422 da data; 422 do bloqueio.
- **Concorrência otimista:** toda ação sobre pedido existente leva `expectedVersion`; diferente de `current_version`: 409 `VERSION_CONFLICT` com `details[0].params.currentVersion`.
- **Transação:** cada ação de escrita é um único `db.tx`: trava o pedido (`select … for update`, 02), valida transição e versão, calcula, insere versão e evento, atualiza `sales_order`.
- **ID do pedido:** `3CC-{ano}-{nextval('sales_order_seq') com 4 dígitos}`.
- **Hash canônico:** JSON com chaves ordenadas e linhas ordenadas por material; sha256 em hexadecimal.

## Erros

Formato `ApiErrorBody`. A mensagem é em português e pode ir direto para o toast da UI.

| Código | HTTP | Quando |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Sem sessão válida |
| `LOGIN_FAILED` | 401 | Usuário ou senha incorretos, ou conta bloqueada (mesma resposta, para não revelar quem existe) |
| `FORBIDDEN` | 403 | Papel sem permissão para a rota ou ação; alteração vinda de outra origem |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Aprovador criou o pedido ou é autor de alguma versão |
| `NOT_FOUND` | 404 | Inexistente ou fora do escopo |
| `INVALID_TRANSITION` | 409 | Ação não permitida no estado atual |
| `VERSION_CONFLICT` | 409 | `expectedVersion` desatualizado |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Mesma chave com outro corpo |
| `ORDER_BLOCKED` | 422 no envio; 409 na aprovação | Alertas BLOCK |
| `LOADING_DATE_TOO_SOON` | 422 | Data antes de hoje + 7 dias |
| `NO_CHANGES` | 422 | Nova versão do backoffice sem nenhuma mudança efetiva |
| `VALIDATION_FAILED` | 422 | Corpo fora do contrato |
| `IDEMPOTENCY_KEY_REQUIRED` | 428 | Envio sem a chave |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Alteração sem `application/json` |
| `PAYLOAD_TOO_LARGE` | 413 | Corpo acima de 64 KB |
| `INTERNAL` | 500 | Falha inesperada; o detalhe fica no log, com o id da requisição |

## Testes do servidor

Em PGlite em memória com o seed completo; requisições por `app.request()` do Hono, com cookies reais. Todo teste de negação tem um **controle positivo** na mesma rota (o mesmo usuário acessando o que é dele), para o 404 não passar só porque a rota ainda não existe.

**Isolamento e sessão (`isolation.test.ts`, `auth.test.ts`)**, os do §6 e mais:
1. Martín abre `3CC-2026-0001` → 200 (controle) e `3CC-2026-0003` (Río Claro) → 404; Sofía abre `3CC-2026-0003` → 200 e `3CC-2026-0001` → 404.
2. Martín pede `GET /portal/catalog` → 200 com `customer.code` 11131 (controle) e `?customer=11999` → 404; envia pedido válido com `customerCode` 11131 → 201 (controle) e com 11999 → 404.
3. Sessão de Martín em `/v1/backoffice/orders` → 403; sessão de Lucas em `/v1/portal/catalog` → 403; Lucas em `/v1/backoffice/orders` → 200 (controle).
4. O schema estrito de saída do portal valida todas as respostas do portal nos testes. Além disso, o JSON de `/portal/catalog` e de `/portal/orders/3CC-2026-0001` de Martín não contém as chaves `origin` (salvo a do topo do pedido, ver "Contratos"), `prices`, `ob`, `sap`, `overrides`, `autoApprove`, `country`, `isDemo`, `internal`, nem os textos `11999`, `rioclaro`, `Río Claro`, `Sofía`, `DEMO_DERIVED` e `SITE_3C`; o evento `SUBMITTED` do 0001 chega a Martín sem os totais da OB (os pallets da OB, 28,886, coincidem com o total do próprio motor e não servem de marcador).
5. Cookie com `HttpOnly`, `SameSite=Strict`, `Path=/`; depois do logout, o mesmo cookie → 401; sessão expirada → 401; usuário desativado no banco com sessão aberta → 401 na próxima requisição; papel trocado no banco vale na próxima requisição (D12).
6. Cinco senhas erradas e depois a correta → 401 `LOGIN_FAILED`, com corpo idêntico ao de usuário inexistente e ao de senha errada; com `locked_until` vencido, a senha correta entra e o contador zera.
7. `POST` com corpo JSON mas `Content-Type: text/plain` → 415; `POST` com `application/json` e `Sec-Fetch-Site: cross-site` → 403; sem `Sec-Fetch-Site` e com `Origin` de outro site → 403; sem os dois → 403; mesma origem → passa (controle).
8. Estáticos: `/` e `/index.html` → 200; `/demo-data.js` → 200 com exatamente `window.PSF_DEMO = null;`; `/dados/catalogo.json`, `/pre-solucao/`, `/docs/specs/README.md`, `/storage/`, `/.git/config`, `/vendor/..%2fdados/catalogo.json` e `/assets/%2e%2e/index.html` → 404. O HTML servido não contém `ob:{`, `rioclaro`, `11999`, `MINOIL`, `Río Claro`, `Martín`, `Sofía`, `EXP-MINOIL` e `lista AR` (texto, sem buscar números soltos, que aparecem em cores CSS). Depende da S7; até lá, marcado como `todo`.

**Pedidos (`orders.test.ts`)**: caso 2 → 201 `SUBMITTED` com o resultado do 01; caso 4 → 422 com `COUNTRY_RESTRICTED` e `BELOW_MIN_LOT`; caso 1 → 422 com `VEHICLE_EXCEEDED`; mesma chave e mesmo corpo → 200 com `Idempotent-Replayed` e um só pedido; mesma chave e outro corpo → 409; duas requisições simultâneas com a mesma chave → um 201 e um 200, nunca 500; data a 3 dias → 422; corpo com `mixedPallet: true` é ignorado (vale o cliente). Aprovação automática: Ana liga a regra por `PUT /backoffice/customers/11131/rules` (não direto no banco); Martín envia a opção 1 do upsell do caso 2 (3864 cx de 12031189 e 1400 de 12142501: 28 de 28 posições, 90,1% do peso) → o pedido nasce `APPROVED`, com `AUTO_APPROVED` e `payload.internal.ruleChangeId` apontando para a mudança de Ana.

**Backoffice (`backoffice.test.ts`)**:
- No 0001, Lucas cria a v2 reduzindo 12031189 de 3528 para 3192 cx (28 de 28 posições, sem BLOCK) e a v1 continua igual; `UPDATE` direto em `order_version` falha (trigger).
- Lucas aprova o 0001 → 403 `SELF_APPROVAL_FORBIDDEN` (ele é criador e autor). **Autor sem ser criador:** Martín envia um pedido novo, Ana cria a v2 dele e tenta aprovar → 403; Lucas (que não criou nem editou) aprova → 200.
- Ana aprova o 0001 com `expectedVersion` 1 → 409 `VERSION_CONFLICT`; com 2 → 200 `APPROVED`; de novo → 409 `INVALID_TRANSITION`.
- Nova versão sem mudança efetiva → 422 `NO_CHANGES`, sem versão nova; mudança que zera todas as linhas → 422.
- `admin.dados` aprovando ou criando versão → 403; `PUT .../rules` por `admin.dados` → 200 e grava `customer_rule_change`.
- `products` traz os 3 overrides e os valores `ob`; `permissions` do 0001 para Lucas tem `canApprove` falso e para Ana verdadeiro.

**Casos de referência na variante adotada (`golden-adotado.test.ts`)**: casos 1 a 4 do 01 com `buildEngineInput` sobre o banco semeado; e `GET /portal/catalog` de Martín com `boxesPerPallet` 98 no 12034109 e 77 no 20908885.
