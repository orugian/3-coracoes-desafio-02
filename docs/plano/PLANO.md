# Plano de execução do corte

Corte aprovado pelo time em 13/10 (arquitetura §13): **segregação de acesso, pedidos persistentes e backoffice**. Exportação para o SAP e para o padrão OB, ingestão por IA, importador por upload e nuvem ficam depois. Specs em [`../specs/`](../specs/README.md). Uso interno de quem implementa; não vai para `main`.

## Branches

| Branch | Uso |
|---|---|
| `solucao-3c-conecta` | Front-end (Ruan e Bruno). Segue como está |
| `integracao-backend` | Criada a partir de `solucao-3c-conecta` em `f89cef4` (último commit do front em 13/10, 22:46 UTC). Recebe as specs (este PR) e as fatias S0 a S10, cada uma num PR curto |
| Tag `demo-standalone` | Em `f89cef4`: contingência que abre por `file://` |

Sincronização: `solucao-3c-conecta` é mesclada em `integracao-backend` no início da S7 (a única fatia de Guilherme que toca `index.html`); o teste de paridade do motor (S1) acusa se o `calc()` do front mudou. Depois da S7, a S8 do front é feita sobre `integracao-backend`. No fim, `integracao-backend` volta para `solucao-3c-conecta` por PR revisado pelo front.

## Fatias

Cada fatia termina com `npm test` verde (`tsc --noEmit` + `node --test`) e um PR. "Pronto" é verificável por comando ou por roteiro.

| # | Fatia | Responsável | Depende de | Pronto quando |
|---|---|---|---|---|
| S0 | Base: `package.json` (Node 24, `type: module`, `imports`), scripts (`dev`, `test`, `db:migrate`, `db:seed`, `extract`, `fixtures:piloto`, `contracts:schema`, `user:unlock`), `.gitignore` (`storage/`, `.env`, `node_modules/`), `.env.example`, `.gitattributes` (README das specs), **`dados/` v2 e `docs/arquitetura/verificacao/` commitados na branch**, tag `demo-standalone`, `GET /v1/health` | Guilherme | — | Num clone limpo: `npm ci`, `npm test` (zero testes) e `npm run dev` respondendo `GET /v1/health`; `git check-attr -a dados/catalogo.json` mostra `text: unset` |
| S1 | Motor `engine_version` 1 (spec 01): extração da fixture do piloto, `calculate`, casos 1 a 8 na variante piloto, teste de paridade | Guilherme; Bruno revisa a paridade | S0 | Casos 1 a 8 e 500 pedidos de paridade verdes |
| S2 | Banco (spec 02): porta `Db` com PGlite e `pg`, migrador com checksum, `001_inicial.sql`, view `material_effective`, `resolvePrice`, `buildEngineInput`, travas do reset | Guilherme | S0 | Migração aplica em PGlite em memória; `UPDATE`/`DELETE` em `order_version` e `order_event` falham; segunda execução do migrador não muda nada; `db:seed` recusa com o `dev` rodando |
| S3 | Seed (spec 03): extrator Python, `decisoes.ts`, seed Node, usuários, 3 pedidos de exemplo | Guilherme; Cecília confere os dados | S1, S2 | Num clone limpo, `npm run db:seed` sem Docker; testes do seed verdes (contagens, conferências, `DERIVED_MISMATCH`, overrides, autoverificação de senha) |
| S4 | Autenticação, sessão e guardas (spec 04): login, logout, `me`, bloqueio, guardas por prefixo, checagem de origem, 415, estáticos de lista fechada | Guilherme | S3 | `auth.test.ts` verde (itens 5 a 8 do 04; o item 8 com a varredura de textos fica `todo` até a S7) |
| S5 | API do portal: `catalog`, `quote`, `orders` (criar com idempotência, listar, detalhe), aprovação automática, schema estrito de saída | Guilherme | S4 | `orders.test.ts`, `golden-adotado.test.ts` e os itens 1, 2 e 4 de `isolation.test.ts` verdes, cada negação com o seu controle positivo |
| S6 | API do backoffice: pedidos (lista, detalhe, nova versão, aprovar), clientes e regras, produtos, `permissions` | Guilherme | S5 | `backoffice.test.ts` e o item 3 de `isolation.test.ts` verdes; `contracts:schema` gera os JSON Schema |
| S7 | Integração web (spec 05): `demo-data.js`, textos fixos neutralizados, `api-client.js` com testes dos tradutores, fachada `API` (`get` síncrono), `PSF.start` e `PSF.logout`, preferências por usuário | Guilherme; Ruan e Bruno revisam | S6; janela combinada com o front para editar `index.html` | Item 8 do 04 sai de `todo` e passa; `web-demo.test.ts` (fumaça do `file://`) verde |
| S8 | Telas do modo servidor (spec 05, "Telas") | Ruan e Bruno | S7 mesclada (mesmo arquivo); antes disso, desenho das telas contra os contratos do 04 | Roteiro manual do 05, passos 1 a 7 |
| S9 | Desejável: devolver e reenviar (`return`, `portal/.../versions`) na API e na tela | Guilherme (API); Ruan e Bruno (tela) | S6, S8 | Teste da transição `SUBMITTED → CHANGES_REQUESTED → SUBMITTED` e roteiro manual |
| S10 | Ensaio da demonstração com o roteiro do pitch (arquitetura §13) no modo servidor, com o `file://` como plano B | Guilherme conduz o ensaio; o time define quem apresenta | S8 | Roteiro de 5 minutos executado do zero (`db:seed` + `dev`) |

Caminho crítico: S0 → S1 → S3 → S4 → S5 → S6 → S7 → S8. S2 corre em paralelo com S1. Enquanto a S7 não chega, Ruan e Bruno desenham as telas do modo servidor contra os contratos do 04, sem editar `index.html` na parte que a S7 mexe.

## Marcos até a entrega (Dia 2, 16:30)

O time decidiu não estimar horas; os marcos servem para decidir o corte dentro do corte.

| Até | Marco | Se não chegar |
|---|---|---|
| Dia 2, 10:00 | S0 a S3 (motor, banco e seed verdes) | Seguir: são a base de tudo |
| Dia 2, 12:30 | S4 a S6 (API completa com testes) | Cortar S9; manter `return` fora |
| Dia 2, 14:30 | S7 e S8 (UI ligada ao servidor) | Demonstrar a segregação pela API (testes e `curl`) e a jornada pela UI em `file://` |
| Dia 2, 15:30 | S10 (ensaio) | Ensaiar com o que estiver pronto e o `file://` como plano B |

## Pontos de contato com o front

| Momento | O quê |
|---|---|
| Agora | Ruan e Bruno leem o 05 ("Telas") e o 04 ("Contratos" e "Erros") |
| Antes da S7 | Combinar a janela em que só a S7 mexe em `index.html` (mover dados, neutralizar textos, trocar chamadas para `await`). PR pequeno, revisado por eles |
| Qualquer mudança no `calc()` do HTML | Avisar: o teste de paridade vai falhar e o motor precisa acompanhar |
| Depois da S7 | O front faz a S8 sobre `integracao-backend` e testa no modo servidor com os 5 usuários do seed |

## Riscos

| Risco | Efeito | Resposta |
|---|---|---|
| Edição simultânea do `index.html` | Conflitos e regressão na UI | Janela para a S7; S8 só depois dela; teste de paridade e teste de fumaça do `file://` |
| O front muda o formato de `P`, `CLIENTS` ou dos pedidos | A tradução do `api-client.js` quebra | Tradução num arquivo só, com testes unitários (critério da S7) |
| Fontes de dados fora da branch ou com fim de linha trocado | Seed falha em outra máquina | `dados/` v2 na S0, `.gitattributes`, hash normalizado, clone limpo no critério da S0 e da S3 |
| PGlite com conexão única esconde corrida | Duas aprovações no `pg` | `select … for update` (02); teste de concorrência no adaptador `pg` quando houver PostgreSQL |
| Bloqueio de contas da demo por terceiros | Login travado por 15 min na apresentação | Rede local na demo; `npm run user:unlock` |
| Dados do JSON mudam de novo | Seed diverge do esperado | `sha256` das fontes e conferências explícitas no teste do seed |
| Prazo | Corte não fecha | Marcos acima; S9 e partes da S8 são as primeiras a sair; o `file://` garante a demonstração |

## Depois do corte

Em ordem: exportação para o SAP e para o padrão OB (estado `EXPORTED`, `sap_export`, CSV com escape, §10); nuvem na AWS (F4, depois da validação local; credencial pedida ao time quando começar); `engine_version` 2 (tara, medidas, estivada por piso, upsell com três opções); importador por upload com quarentena e ingestão por IA (F3, com Bedrock por inferência global, Q13).
