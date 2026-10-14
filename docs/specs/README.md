# Specs do corte de implementação — Pedido sem Fronteiras

Detalham, para implementação, o corte aprovado da arquitetura ([`../arquitetura/ARQUITETURA.md`](../arquitetura/ARQUITETURA.md), §13). Uso interno de quem implementa o back-end e a integração (Guilherme, com agente). Não vão para `main`.

| Arquivo | Conteúdo |
|---|---|
| [`01-motor.md`](01-motor.md) | `packages/engine`: tipos, regras, alertas, casos de referência e teste de paridade com o `calc()` do piloto |
| [`02-banco.md`](02-banco.md) | Porta `Db`, migrações e DDL completo do corte |
| [`03-seed.md`](03-seed.md) | Extração das fontes, decisões do time, usuários e pedidos de exemplo |
| [`04-api.md`](04-api.md) | Autenticação, segregação, rotas, contratos, máquina de estados, erros e testes de isolamento |
| [`05-integracao-web.md`](05-integracao-web.md) | Como a UI do piloto passa a falar com a API sem perder o modo `file://` |
| [`../plano/PLANO.md`](../plano/PLANO.md) | Fatias, responsáveis, ordem e critério de pronto |

## Escopo do corte

| Entra | Fica para depois |
|---|---|
| Login com 3 papéis e segregação de acesso no servidor | Exportação para o SAP e para o padrão Order Basis (fase futura, decisão do time) |
| Pedidos persistentes com versões imutáveis e trilha de eventos | Importador do SAP por upload, portão de qualidade com quarentena |
| Backoffice: fila, ajuste com nova versão, aprovação por outra pessoa, regras do cliente, produtos | Ingestão de planilha por IA (F3) |
| Motor `engine_version` 1 (paridade com o piloto), no servidor | `engine_version` 2: tara, medidas nos SKUs com `VOL_MISMATCH`, estivada por piso, upsell com três opções |
| Seed a partir dos exports do SAP, da OB, dos JSON e do piloto, com os overrides da Q12 e do stick | Gestão de usuários e de overrides pela tela (no corte, só pelo seed) |
| Devolução ao distribuidor e reenvio (desejável) | Nuvem (F4), depois da validação local |

## Decisões tomadas nas specs

Refinam a arquitetura sem contrariá-la; as que mudam texto do documento principal já foram aplicadas nele.

| # | Decisão | Motivo |
|---|---|---|
| D1 | Node 24 com TypeScript executado direto (remoção de tipos nativa), `node:test`, um único `package.json` com `imports` (`#engine`, `#contracts`, `#server`). Sem build no servidor | Testado no Node 24.15: `.ts` e `node --test "**/*.test.ts"` rodam sem flag; subpath imports para `.ts` funcionam. Menos ferramentas no caminho crítico |
| D2 | Prefixo `/v1` (arquitetura §6), não o `/api/v1` do README do front | O front ainda não chama o servidor; vale o documento aprovado |
| D3 | A API recebe quantidades sempre em caixas inteiras. UN e KG são convertidos na UI, como no piloto | O piloto já guarda caixas em `S.qty`; evita duas conversões |
| D4 | O rascunho fica no navegador (como no piloto). O servidor guarda a partir do envio (`SUBMITTED`); na devolução, o distribuidor reenvia uma nova versão | Mesmo comportamento do piloto, sem mais um estado persistido |
| D5 | Regras do cliente (pallet misto, aprovação automática) são alteráveis por `int_exportacao` e `int_admin`, com registro. A aprovação automática gera evento com ator "regra" | O piloto já tem as duas chaves no painel; a matriz do §6 ganhou a linha |
| D6 | O seed não lê planilha em Node: um extrator Python (mesmo parser do `verificar_numeros.py`) gera `db/seed/fontes/*.json` com o hash de cada arquivo de origem, e o seed em Node só carrega | Reaproveita o parser já conferido por 152 verificações; nenhuma biblioteca de planilha no servidor enquanto o upload (F3) estiver fora |
| D7 | A UI continua na raiz do repositório (`index.html`, `vendor/`, `assets/`). O servidor serve uma lista fechada de arquivos | O time de front trabalha nesses caminhos e no GitHub Pages; mover para `web/` fica para quando o front estabilizar |
| D8 | Dados de demonstração saem do HTML para `demo-data.js`, que o servidor não serve | É a única forma de o HTML servido não carregar `CLIENTS`, `P[].ob` e pedidos de outros clientes |
| D9 | Valores monetários em centavos inteiros dentro do motor | `VALOR_TOTAL = QTD × PRECO_UNIT` exato e sem deriva de ponto flutuante |
| D10 | IDs de veículo do servidor seguem o `container.json` (`carreta_padrao`, `container_40`, `container_20`); a UI mantém `carreta`, `c40`, `c20` e o cliente da API traduz | Fonte autoritativa (§7.1) sem tocar nas dezenas de usos na UI |
| D11 | Família (código da UI), marca, nomes pt/es/en, NCM, linha, EAN (da UM de consumo) e DUN (da CX) vêm do piloto, conferidos contra as fontes do §7.1 no teste do seed (o EAN e o DUN do piloto são os da Conferência do SAP em 10 de 10 SKUs) | Os textos do piloto já foram revisados pelo time, e a OB não tem es/en para 2 SKUs; a fonte do §7.1 vira conferência, não carga |
| D12 | A sessão guarda o papel, mas a autorização relê papel, `active` e escopo do banco a cada requisição | Revogar um papel ou desativar um usuário vale na hora, sem esperar o token expirar |
| D13 | Proteção contra CSRF: `SameSite=Strict`, sem CORS, `Content-Type: application/json` obrigatório nas alterações (415 sem ele) e checagem de `Origin`/`Sec-Fetch-Site` própria em toda alteração. O `hono/csrf` 4.13.13 não basta: ele só age em `Content-Type` de formulário e `text/plain` (conferido no código-fonte) | Um JSON entre origens exige preflight, que o servidor não autoriza; a checagem própria cobre navegadores sem `Sec-Fetch-Site` |

## Ciclo de vida das fontes de dados

As fontes do seed precisam estar na branch e ter os mesmos bytes em qualquer máquina:
- `dados/` v2 (os 4 JSON da Cecília) e `docs/arquitetura/verificacao/` entram em `integracao-backend` na S0. Hoje os v2 só existem no disco de Guilherme: `main` tem a v1 de 2 arquivos e `solucao-3c-conecta` não tem `dados/`.
- `.gitattributes` com `dados/*.json -text`, `db/seed/fontes/*.json -text`, `packages/engine/test/fixtures/*.json -text` (fixture gerada: sem isso, `npm run fixtures:piloto` num clone com `autocrlf` deixa o arquivo como modificado), `docs/specs/schemas/*.json -text` (mesmo motivo, `npm run contracts:schema`) e `*.xlsx *.xlsm *.png *.jpg *.webp binary` (o repositório roda com `core.autocrlf=true` no Windows).
- O `sha256` das fontes é calculado sobre os bytes com `\r\n` trocado por `\n`, para continuar igual se algum arquivo já tiver sido convertido.

## Convenções

- Idioma: domínio e mensagens em português; identificadores de código em inglês, como no esquema do §7.2.
- Datas em ISO 8601 com fuso (`timestamptz`); datas de carregamento como `YYYY-MM-DD`.
- Dependências com versão exata (sem `^`). Versões conferidas no npm em 13/10/2026: `hono` 4.13.13, `@hono/node-server` 2.1.5, `@electric-sql/pglite` 0.5.9, `zod` 4.6.7, `pg` 8.23.1; desenvolvimento: `typescript` 5.9.3, `@types/node` 24.19.2, `@types/pg` 8.23.1, `happy-dom` 21.0.1 (para o teste de fumaça do modo demo, 05). Python 3.10+ com `openpyxl` para o extrator, já usado na verificação.
- `npm test` = `tsc --noEmit` (a remoção de tipos do Node não checa tipos) seguido de `node --test`.
