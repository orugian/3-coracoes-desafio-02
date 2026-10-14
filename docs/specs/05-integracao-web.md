# 05 · Integração da UI com a API

A UI do piloto (`index.html` de `f89cef4`, com Ruan e Bruno) passa a funcionar em dois modos, com o mesmo arquivo: **demo**, como hoje (aberta por `file://` ou pelo GitHub Pages, dados no navegador), e **servidor** (`http://localhost:3000`, login e dados vindos da API). A troca acontece num ponto só, o objeto `API`, que o próprio piloto já separou "espelhando a API REST" (Anexo D, P11). Base: §6 (controle 3) e §11 (passo 4) da arquitetura.

## Arquivos

| Arquivo | Conteúdo | Servido pelo servidor? |
|---|---|---|
| `demo-data.js` (novo) | O que hoje é dado embutido e sensível: `P` (com `ob`) já mesclado com `EXTRA` (EAN, DUN, linha, nome em inglês), `CLIENTS` e os 3 pedidos de exemplo. Define `window.PSF_DEMO = { P, CLIENTS, ORDERS }`. A linha `P.forEach(p=>Object.assign(p,EXTRA[p.code]\|\|{}))` sai do HTML junto com `EXTRA` | Não. O servidor responde `/demo-data.js` com o conteúdo fixo `window.PSF_DEMO = null;` |
| `api-client.js` (novo) | Detecção do modo, `fetch` com tratamento de erro, tradução entre os formatos da API e os do piloto, fachada `API` assíncrona, login e logout | Sim |
| `index.html` | Passa a ler os dados de `PSF_DEMO` ou da API; chamadas ao `API` com `await`; ajustes de tela do modo servidor | Sim |

As fotos (`IMG`, em base64) e os textos de interface (`T`, `FAM`, `ICON`) ficam no HTML: não são sigilosos.

Ordem dos scripts no HTML: `vendor/…`, `demo-data.js`, `api-client.js`, script da aplicação. O modo é decidido sem esperar rede: `PSF.mode = window.PSF_DEMO ? 'demo' : 'server'`. No GitHub Pages, `demo-data.js` é servido como arquivo comum, então continua demo.

## Mudanças no `index.html`

Os números de linha são de `dca67be` e servem de orientação; em `f89cef4` eles avançam de 4 a 45 linhas (por exemplo, `calc` em 827, `API` em 1997, `STORE_KEY` em 2046, seed em 2066). O que vale é o nome da função ou do bloco.

| Onde | Hoje | Passa a |
|---|---|---|
| Dados (694–733) | `const P = [...]`, `EXTRA`, `CLIENTS = {...}` | Movidos para `demo-data.js`. No HTML: `const P = (window.PSF_DEMO && PSF_DEMO.P) \|\| [];` e `const CLIENTS = (window.PSF_DEMO && PSF_DEMO.CLIENTS) \|\| {};`. `BY` e os campos derivados (`cxPal`, `m3`) são recalculados por `PSF.applyCatalog()` |
| Seed (2024–2032) | `S.orders.push(...)` três vezes | `(window.PSF_DEMO ? PSF_DEMO.ORDERS : []).forEach(o => S.orders.push(o))` |
| Camada de dados (1943–1999) | `const API = {...}` síncrono | Renomear para `const API_DEMO = {...}` e trocar, dentro do corpo, as duas chamadas `API.get(id)` (em `updateItem` e `approve`) por `API_DEMO.get(id)`; logo depois, `const API = PSF.createApi(API_DEMO)`. `get` é **síncrono nos dois modos** (lê `S.orders`). Em demo, a fachada embrulha em `Promise` os métodos que escrevem (`createOrder`, `updateItem`, `approve`, `exportSap`, `setClientRule`); em servidor, esses chamam a API |
| `confirmOrder` (1260) | `o = API.createOrder(...)` | `async function`; `o = await API.createOrder(...)`. Em erro, mostrar `e.message` (hoje todo 422 vira "Corrija os bloqueios", o que esconde `LOADING_DATE_TOO_SOON`) |
| Tratador de clique, aprovar (2087) | `API.approve(S.sel)` | `await` dentro de uma função assíncrona; botão desabilitado durante a chamada; erro → toast com `e.message` |
| Tratador de clique, CSV (2088) | `API.exportSap(S.sel)` | Igual em demo; em servidor o botão não aparece |
| Tratador de `change`, regras do cliente (2109–2110) | `API.setClientRule(...)` | `await` |
| Tratador de `change`, ajuste de item (2112) | `API.get` e `API.updateItem` | `API.get` continua síncrono; `await API.updateItem(...)`; campo desabilitado durante a chamada |
| Status (`FLOW` 1946, `ST` 1275, `QF` 1276, `step` em `renderMyOrders` 961) | `analise`, `aprovado`, `sap` | Acrescentar `devolvido` nos quatro: `FLOW.devolvido = []` (só o reenvio, pela API, sai dele), rótulo "Devolvido" com tom `warn`, filtro na fila e `step.devolvido = 1` |
| Textos fixos com nomes de clientes e internos (678, 949, 950, 1018, 1392, 1499, 915) | "lista US / EXP-MINOIL", "Martín · MINOIL S.A.", "Lucas · Analista de Exportação", a explicação da lista AR, "porta filtro para a Distribuidora Río Claro", "Lucas (Exportação)" fixo no histórico de importações e na lateral | Comentário 678 sai; 949/950 viram texto genérico ("Distribuidor", "Exportação 3corações") ou vêm de `PSF_DEMO`; 1018 e 1392 só aparecem em demo; a lateral (915) mostra o usuário da sessão |
| Fotos (2117, `loadFolderPhotos`) | Roda no boot, com `P` preenchido | Chamar de novo depois de `applyCatalog` / `applyProducts` |
| `save()` e `load()` (2007–2021) | Pedidos, regras e catálogo no `localStorage` (`3cc-v4` em `f89cef4`) | Em servidor, só preferências e carrinho, na chave `3cc-srv-v1:{id do usuário}`: `qty`, `unit`, `veh`, `mode`, `lang`, `view3d`. Nada de pedidos, regras ou catálogo |
| Início | `load(); ... render()` | Em servidor, `PSF.start()`: chama `GET /v1/auth/me`; com sessão, carrega a área, define `S.area`, `S.view`, `S.client = me.customers[0].slug` e `S.lang` do cliente (portal) e renderiza; sem sessão, mostra o login. `S.client` nunca fica no valor inicial `"minoil"`: `headerHTML` lê `CLIENTS[S.client].contact` e quebraria para a Sofía |
| Saída | `data-logout` só troca `S.area` | Em servidor, `PSF.logout()` chama `POST /v1/auth/logout` e faz `location.reload()`: nada da sessão anterior (`P` com `prices` e `ob`, `CLIENTS` de todos os clientes, `S.orders`) fica na memória para o próximo usuário da mesma aba |
| 3D da tela de acesso (`v3Spec("hero")`, 1892) | `calc(HERO_QTY, { client: "minoil", … })` | Em servidor, a especificação do hero é o veículo vazio, sem `calc` (não há catálogo nem `CLIENTS` antes do login) |

### Como ficou na S7 (sobre `d84b4cf`)

O front avançou de `f89cef4` para `d84b4cf` antes da S7 (3.767 linhas; `calc` em 1335, `API` em 3498, `STORE_KEY` em 3591, seed em 3616). A mudança seguiu a tabela acima, com estes ajustes:
- **Dados:** `P`, `EXTRA` (com a mescla), `CLIENTS` e os 3 pedidos foram copiados como estavam para `demo-data.js`, dentro de uma função que só define `window.PSF_DEMO`. O comentário "lista US / EXP-MINOIL" saiu. O front já tinha tirado a explicação da lista AR, o "porta filtro para a Distribuidora Río Claro" e o "Martín · MINOIL S.A." fixo.
- **Valor inicial de `S.client`:** passou a ser `Object.keys(CLIENTS)[0]||""`. Os dois rascunhos de exemplo (`r-demo-1` e `r-demo-2`, novos no front) só existem em demo e usam `S.client`. Com isso, o HTML servido não tem nem o slug `minoil`.
- **`API_DEMO`:** além das chamadas `API.get` em `updateItem`, `approve` e `exportSap`, o `resetSettings` chama `API_DEMO.saveSettings` e `API_DEMO.removeVehicle`. O objeto de ligação vem explícito: `PSF.createApi(API_DEMO, { S, P, BY, VEH, RULES, CLIENTS, RLOG, ApiError, render, toast, loadFolderPhotos })`, porque o `api-client.js` carrega antes desses nomes existirem.
- **Parâmetros do negócio** (aba nova do front): `getSettings` lê o estado local nos dois modos. Em servidor, `saveSettings`, `addVehicle`, `removeVehicle` e `resetSettings` recusam na hora com "Parâmetros do negócio: próxima fase", sem rede. Em demo continuam síncronos. Esconder a aba no servidor é da S8.
- **`confirmOrder`:** bloqueio (`ORDER_BLOCKED`, ou o 422 do demo) continua com o texto traduzido `t("cannot")`. Os demais erros mostram `e.message`, inclusive `LOADING_DATE_TOO_SOON`. A fachada põe o `code` da API no erro.
- **Status `devolvido`:** entrou em `ST`, `QF`, na ordenação da fila (`SO`), em `FLOW` e nos três `step` (lista de "Meus pedidos", resposta da Xica e contexto da IA). A Xica ganhou a frase de "próximo passo" para o devolvido. Sem isso, um pedido devolvido pela S9 quebraria o `render`.
- **Hero:** `calc` com o pedido vazio no servidor (`calc({}, …)` não lê `CLIENTS`). O resultado é o veículo vazio.
- **Acesso no servidor:** os botões de perfil (`data-enter`) não fazem nada no servidor. O formulário é da S8, que chama `PSF.login(usuario, senha)`, e o 401 vira `ApiError` com "Usuário ou senha incorretos.". `data-logout` chama `PSF.logout()`.
- **Lateral do painel:** nome e papel vêm de `PSF.who("Lucas", "Analista de Exportação")`. É o usuário da sessão no servidor ("Ana", "Exportação 3corações"; "Administração de dados", "Dados e usuários") e o texto fixo em demo.
- **Preferências:** além de `qty`, `unit`, `veh`, `mode`, `lang` e `view3d`, guardam `drafts` e `draftId`, os rascunhos do front e o carrinho de hoje (§7.2: o rascunho fica no navegador). `S.lang` usa a preferência salva e, sem ela, o idioma do cliente.
- **Carga da sessão:** o portal lê `catalog?customer=` do primeiro cliente do escopo e a lista de pedidos. O backoffice lê `products`, `customers` e `orders`. Nos dois, o detalhe de cada pedido (versões e eventos) vem logo depois, para `audit` e "Meus pedidos". `RULES.minLotBlock` e `fullPalBlock` ficam no perfil do `engine_version` 1 (01).
- **Ainda fixos, para a S8:** o "Lucas (Exportação)" do histórico de importações (`IMP.log`), o "Oi, Lucas!" da Xica no painel e a persona da IA ("Pergunta do Lucas", "conversando com Lucas"; só valem com `window.claude`), e o `ACTOR_EXP`, que só vale em demo. O rótulo `priceSrc === "site"` ("fora da lista SAP · site 3corações") também fica para a S8: o `srcNote` de hoje mostra "SAP".
- **Também para a S8 (revisão da S7):** campos que agora vêm do servidor e entram no HTML sem `esc()` (`c.contact` e `c.contact[0]` no cabeçalho e na lateral do portal; `cl.code`, `cl.inc`, `cl.pay`, `cl.list` e `cl.filial` no detalhe do pedido). No corte eles vêm do seed. Num distribuidor com mais de um cliente, trocar o cliente no seletor precisa recarregar `catalog?customer=` (preço e restrições são por cliente); `PSF.start` carrega o primeiro.
- **Saída:** `PSF.logout()` só recarrega se o servidor confirmou (204) ou se a sessão já não valia (401). Com o servidor fora do ar, a tela fica e o toast avisa, porque o cookie continuaria válido para o próximo usuário da aba. Se `PSF.start()` não conseguir carregar a área, volta para o acesso com o motivo no toast.

## Fachada `API` no modo servidor

Mesmos nomes e argumentos que o piloto já usa; todos devolvem `Promise`. Erros viram `ApiError(status, message, details)`, a mesma classe do piloto.

| Método | Chamada | Depois da resposta |
|---|---|---|
| `get(id)` | Nenhuma (lê `S.orders`) | — |
| `quote(d)` | Nenhuma: `calc()` local é a prévia | — |
| `createOrder(d, { draftId, ref, date })` | `POST /v1/portal/orders`, `Idempotency-Key: draftId`; corpo com `customerCode = CLIENTS[d.client].code`, cabeçalho traduzido e `lines` a partir de `d.qty` | Insere o pedido traduzido no início de `S.orders` |
| `updateItem(id, code, nv)` | `POST /v1/backoffice/orders/:id/versions` com `expectedVersion = o.v` e `changes: [{ material: code, boxes: nv }]` | Substitui o pedido em `S.orders` |
| `approve(id)` | `POST /v1/backoffice/orders/:id/approve` com `expectedVersion` | Idem |
| `exportSap(id)` | — | Rejeita com "Exportação para o SAP: próxima fase" |
| `setClientRule(k, field, val)` | `PUT /v1/backoffice/customers/:code/rules` com `mixedPallet` ou `autoApprove` | Atualiza `CLIENTS[k]` e o histórico `RLOG` |
| `returnOrder(id, reason)`, `resubmit(id, d)` (desejáveis) | `…/return` e `POST /v1/portal/orders/:id/versions` | Idem |
| `getSettings()`; `saveSettings`, `addVehicle`, `removeVehicle`, `resetSettings` | Nenhuma | `getSettings` lê o estado local; as escritas recusam com "Parâmetros do negócio: próxima fase" (síncronas, como no piloto) |

Além da fachada, o `api-client.js` expõe `PSF.mode`, `PSF.me` (o `Me` da sessão), `PSF.start()`, `PSF.login(usuario, senha)`, `PSF.logout()`, `PSF.who(nome, papel)`, `PSF.request(método, url, corpo)` (para a S8 ler o que a fachada não cobre, com o mesmo tratamento de erro) e `PSF.translate` (os tradutores, usados nos testes). Falha de rede vira `ApiError` com status 0 e "Sem conexão com o servidor…".

Em 409 `VERSION_CONFLICT`, a fachada recarrega o pedido (`GET …/orders/:id`), atualiza `S.orders` e repassa o erro para o toast.

## Tradução de formatos (`api-client.js`)

| API | Piloto |
|---|---|
| `carreta_padrao`, `container_40`, `container_20` | `carreta`, `c40`, `c20`. De `Vehicle` só entram `pos`, `m3` e `kg` no `VEH` existente; rótulos, `cols` e `cab` continuam no HTML |
| `PALLETIZED`, `FLOOR` | `pal`, `est` |
| `SUBMITTED`, `CHANGES_REQUESTED`, `APPROVED`, `EXPORTED` | `analise`, `devolvido` (novo em `ST` e `QF`), `aprovado`, `sap` |
| `CatalogItem` | Item de `P`: `code`, `fam`, `brand`, `sap`, `pt`/`es`/`en`, `un`, `unLbl`, `net`, `gross`, `dm3`, `lastro`, `alt`, `cxPal`, `m3 = dm3 ÷ 1000`, `price`, `loteMin`, `shelf`, `ncm`, `dims = "C×L×A"`, `ean`, `dun`, `linha` |
| `ProductInternal` (backoffice) | O mesmo item, mais `price` = preço da lista US (a tela "Produtos e regras" e `dataIssues` comparam `p.price` com `p.ob.price`), `prices = { US: …, AR: … }` (o `priceFor` do piloto já usa `p.prices[lista]`), `priceSrc` (`sap` para `SAP_LIST`, `site` para `SITE_3C`) e `ob = { cxPal, palz, price, lote, grossCx }`. A tela trata `priceSrc === "site"` com o rótulo "fora da lista SAP · site 3corações" e o preço; hoje `"manual"` mostra "sem preço" (1365), o que contraria o §7.2 |
| `CustomerProfile` / `CustomerInternal` | `CLIENTS[slug]`: `name`, `code`, `dest`, `cur`, `inc`, `pay`, `payCode`, `list`, `factor = 1` (o preço já vem pela lista), `blocked = restrictedMaterials`, `filial = "{plantName} ({plant})"`, `contact`, `lang`, `mixed`, `autoApprove` |
| `OrderView` | Pedido do piloto: `id`, `v = currentVersion`, `client` (slug), `veh`, `mode`, `mixed`, `qty`, `ref`, `date`, `status`, `created`/`createdMs`, `approved`/`approvedMs`, `origin` ("Portal" ou "Order Basis"), `auto` (se houve `AUTO_APPROVED`), `audit`, e `perm = permissions`. No portal, a lista de pedidos é carregada logo depois do login (o "Meus pedidos" e o início leem `S.orders`) |
| `OrderEventView` | Entradas de `audit` (`at` em "dd/mm HH:MM", `who = actorLabel`, `what`). `VERSION_CREATED` vira uma entrada por item alterado, com `kind: "edit"`, `code`, `old`, `nv` e texto começando por "Alterou", porque `adjCount()` do piloto conta por esse prefixo |
| Alerta do motor | Código do piloto em `details`: `VEHICLE_EXCEEDED` → `CAPACITY`, `BELOW_MIN_LOT` → `BELOWMIN`, `COUNTRY_RESTRICTED` → `BLOCKED`, `NO_PRICE` → `NOPRICE`, `QTY_NOT_MULTIPLE` → `BOXMULT` |

Portal: `applyCatalog(PortalCatalog)` preenche `P`, `BY`, `VEH`, `RULES` e `CLIENTS` só com os clientes do escopo. Backoffice: `applyProducts`, `applyCustomers` e a lista de pedidos preenchem `P` (com `prices` e `ob`), `CLIENTS` (todos) e `S.orders`. Os arrays e objetos são `const` no HTML: a tradução muta o conteúdo (`P.length = 0; P.push(...)`), como o `load()` do piloto já faz.

## Telas no modo servidor (Ruan e Bruno)

- **Acesso:** formulário de usuário e senha no lugar dos botões de perfil; uma mensagem só para 401 ("Usuário ou senha incorretos", que também cobre a conta bloqueada, 04); sem "Restaurar dados de exemplo". O 3D decorativo mostra o veículo vazio (ver "Mudanças", hero).
- **Logout:** chama `PSF.logout()`, que recarrega a página.
- **Seletor de cliente:** só com mais de um cliente no escopo.
- **Portal:** depois de "Confirmar", sem o botão "Ver no painel 3corações" (`data-goexp`, 1270), que hoje leva o distribuidor para a UI do painel.
- **Backoffice:**
  - sem "Gerar arquivo para o SAP" e sem o CSV (rótulo "Exportação para o SAP: próxima fase");
  - importação do SAP e troca de foto escondidas (no servidor, dado mestre só muda pelo seed);
  - na lateral (914–915), sem "Ver portal do distribuidor" e sem "Restaurar dados", e com o nome e o papel do usuário da sessão no lugar de "Lucas · Analista" fixo;
  - campos de quantidade (`data-edit`) só habilitados com `perm.canEdit` (desabilitados para `admin.dados`);
  - "Aprovar" desabilitado quando `perm.canApprove` for falso, com a dica "Quem criou ou ajustou o pedido não pode aprová-lo";
  - status "Devolvido" e, se a S9 entrar, o botão "Devolver" com motivo.
- **Carregamento e erro:** indicador enquanto a área carrega; botão ou campo desabilitado durante cada chamada (evita duplo clique); falha de rede vira toast sem perder a tela.
- **Rótulos de autoria:** vêm do servidor (`actorLabel`); o `ACTOR_EXP` fixo ("Lucas (Exportação)") só vale em demo.
- **Regras do cliente:** depois de uma mudança, o portal só vê o novo valor ao recarregar (o catálogo é lido no início da sessão).

## Divisão do trabalho

| Parte | Quem |
|---|---|
| `api-client.js`, fachada `API`, tradução (com testes unitários dos tradutores), `PSF.start`, `PSF.logout` | Guilherme |
| Mover os dados para `demo-data.js`, neutralizar os textos fixos e trocar as chamadas para `await` (mudança mecânica) | Guilherme, num PR pequeno e isolado, na janela combinada com Ruan e Bruno; eles revisam |
| Formulário de login, status "Devolvido", elementos escondidos e desabilitados, carregamento e erro | Ruan e Bruno, depois de mesclar o PR acima (as duas mudanças mexem no mesmo arquivo) |

## Aceite

Automático:
- teste de estáticos e de textos do servidor (04, item 8) e paridade do motor (01);
- testes unitários dos tradutores (`api-client.test.ts`): `CatalogItem` → item de `P`, `OrderView` → pedido do piloto (inclusive `VERSION_CREATED` → entradas "Alterou" com `kind: "edit"`), alertas → códigos do piloto;
- **teste de fumaça do modo demo** (`web-demo.test.ts`, com `happy-dom`): carrega `demo-data.js`, `api-client.js` e o script do `index.html`; confere que o modo é `demo`; cria um pedido pelo `API`, ajusta um item do `3CC-2026-0001`, aprova um pedido sem bloqueio e gera o CSV; confere `S.orders` depois de cada passo. É o que garante o plano B (`file://`) sem teste manual.
- **modo servidor contra a API** (`web-server.test.ts`, `happy-dom` com o app Hono e o banco semeado): os arquivos como o servidor entrega, `fetch` com cookie e `Sec-Fetch-Site`; automatiza, nos dados da tela (`S`, `P`, `CLIENTS`, `RLOG`), os passos 1 a 6 do roteiro abaixo. O que é visual (formulário, botões escondidos, rótulos) continua no roteiro manual da S8.

Os testes do navegador ficam em `test/web/`. O `happy-dom` embrulha cada `<script>` numa função, e os `const` deixariam de ser compartilhados entre os scripts. Por isso a avaliação dele fica desligada, e os três scripts rodam com `vm.runInContext` no contexto da janela, como scripts clássicos.

Roteiro manual no modo servidor, depois de `npm run db:seed` e `npm run dev`:
1. Martín entra: o catálogo mostra preço da lista US e 98 cx/pallet no 12034109; monta um pedido, vê "faltam N cx", envia; recarrega a página e o pedido continua em "Meus pedidos".
2. No console do navegador de Martín, `fetch('/v1/portal/orders/3CC-2026-0003')` → 404; o código-fonte da página não tem `rioclaro`, `Río Claro`, `Sofía` nem `ob:{`.
3. Martín sai; Sofía entra na mesma aba: a tela abre com o cliente dela, sem erro, e "Meus pedidos" só tem o 0003.
4. Lucas entra: o 3CC-2026-0001 aparece com 30 posições para 28; ele reduz o 12031189 para 3192 cx (nova versão, 28 de 28); "Aprovar" fica indisponível para ele.
5. Ana entra e aprova o 0001; a trilha mostra a importação da OB, o ajuste de Lucas e a aprovação de Ana.
6. Ana liga pallet misto para a MINOIL; Martín recarrega a página e, com o pedido-teste no carrinho, vê 29 posições.
7. `index.html` aberto por `file://` funciona como o piloto, inclusive o CSV para o SAP.
