# Avaliação do juiz adversarial — histórico

O juiz questiona a arquitetura com nota de 0 a 10. Entre 6 e 8 é "interessante, mas insuficiente"; a meta é 9–10. O limite é de 3 rodadas por proposta, e as três foram usadas.

| Rodada | Versão avaliada | Nota | Situação |
|---|---|---|---|
| 1 | v1, AWS-first | 6,9 | Levou ao pivô para local-first |
| 2 | v3, local-first, evolui o piloto 3C Conecta | 7,3 | Correções incorporadas na v3.1 |
| 3 | v4, reescrita para apresentação | **7,8** | Última rodada permitida. Correções posteriores abaixo |

**A nota final registrada é 7,8, abaixo da meta de 9.** As correções feitas depois da rodada 3 (ver abaixo) não foram re-julgadas, porque o limite de rodadas foi atingido; não existe nota para a versão corrigida. Em 13/10/2026 o time aprovou a arquitetura com essas correções (checklist no fim deste arquivo).

A v2 (local-first, antes de conhecer o piloto) não chegou a ser avaliada: a rodada foi cancelada para incorporar o piloto e os JSON.

## Rodada 1 (v1, 6,9/10)

| Bloqueador | Destino |
|---|---|
| Golden test sem veredito de veículo | Resolvido (§8) |
| Upsell de posições livres e estivada fora do P0 | Upsell: P0. Estivada: voltou ao P0 depois da R3 |
| Restrições de país sem demo | Coberta pelo caso 4 e por `country_rule` com `is_demo`; só existe o tipo `BLOCK` |
| Chave e fonte de paletização inconsistentes | Resolvido: chave (material, centro), duplicata 12037417 resolvida pela descrição, `MIN_LOT_DEFAULTED` |
| "Vendedores" indefinido | Resolvido pela resposta do time à Q2: dois públicos, externo e equipe |
| Risco de execução da infra AWS | Resolvido: local-first, AWS só na fase 2 |

## Rodada 2 (v3, 7,3/10)

Notas: aderência 7,6 · infraestrutura 6,7 · base e esquema 7,5 · confiança dos dados 7,9 · segurança 7,4 · IA 6,0 · integrabilidade e execução 6,3 · viabilidade/POC 7,7.

| Bloqueador | Destino |
|---|---|
| Porta `Db` sem transação (reproduzido no PGlite) | Resolvido: `Db { query; tx }` (confirmado pela R3) |
| Severidade das regras de qualidade indefinida | Resolvido: BLOCK, WARN e INFO; a quarentena não remove SKU ativo (confirmado pela R3) |
| Fluxo da demo travado | Segregação de funções resolvida com 2 contas; a confirmação de preço foi substituída por reconhecimento explícito na aprovação (removido em 13/10, depois da resposta da Q6) |
| Estivada por medidas fora do P0 | **Não resolvido na v4**; ver R3 |

## Rodada 3 (v4, 7,8/10)

Notas do juiz: aderência 7,6 · infraestrutura 8,4 · base e esquema 8,2 · confiança dos dados 8,3 · segurança e segregação 7,7 · IA 7,3 · integrabilidade 7,6 · viabilidade/POC 8,0 · clareza como apresentação 7,0.

O juiz refez 16 verificações por conta própria e a maioria conferiu: os 4 casos de teste (executando o `calc()` do piloto), a causa-raiz do peso errado nos JSON (inclusive o bruto, que o script não testava), a igualdade do JSON com a aba TAB, as 20 divergências, as CVEs do SheetJS, o ciclo de vida dos modelos do Bedrock, o limite do Data API, BHO e NAT sem centro, e o confronto do piloto sem login.

### Bloqueadores apontados e o que foi feito

| # | Bloqueador do juiz | O que foi feito depois da R3 | Re-julgado |
|---|---|---|---|
| 1 | Estivada sem alocação; a justificativa "faltam dimensões" era incoerente com as outras premissas | Estivada voltou ao P0 com modelo de piso (pilhas de `altura` camadas × área C×L), usando piso = posições × 1,2 m² como premissa rotulada. Caso 5 incluído. Reproduzi o cálculo do juiz: 32,43 m², 96,5% do piso da carreta | Não |
| 2 | Segregação de funções com brecha (quem cria a v1 em nome do cliente pode aprová-la) | Aprovador ≠ autor de **qualquer** versão. Aplicar o lote de importação passou a exigir `int_admin`. Override exige a confirmação de um `int_exportacao` | Não |
| 3 | O contrato `GET /portal/catalog` não trazia os campos que o motor usa no navegador | O contrato passou a trazer medidas, volume, unidades por caixa, lastro, camadas, lote mínimo, EAN, DUN e NCM | Não |

### Erros do documento apontados e corrigidos

- `VOL_MISMATCH` contradizia o caso 1: a regra agora depende da versão do motor (`engine_version` 1 usa o volume declarado; a 2 usa as medidas) e o caso 1 mostra os dois (58,88 m³ e 59,04 m³).
- O caso 3 dependia de um valor marcado como implausível: a sensibilidade foi incluída (20 posições com 28 cx/pallet; 17 com 98) e a conclusão ficou ligada à Q12.
- O override do stick contradizia "prevalece o SAP": agora é um `master_override` criado pelo seed, com os dois valores visíveis.
- Q6 aparecia como resolvida, mas os arquivos trazem os valores da OB e não estimativas de mercado: Q6 voltou a "parcialmente resolvida", e a origem do preço passou de `MARKET_REF` para `OB_MANUAL`, que descreve só o que se prova (em 13/10, com a resposta do time, Q6 foi fechada e a origem virou `SITE_3C`).
- "1 preço diferente" corrigido para 2; "20 divergências" e "6 de 10 SKUs" separados e explicados.
- Descrição do `SUMIFS` corrigida (verifiquei a fórmula nas células).
- Preço com 2 casas decimais e regra de arredondamento do total da linha.
- Upsell com 3 opções (antes só 2); lote mínimo declarado como válido também na estivada.
- Modelo de reforço: o juiz apontou que o Sonnet 4.5 está Legacy; confirmei na documentação do Bedrock que clientes novos não podem adotar modelo Legacy. O reforço deve ser um modelo Active.
- "Todos os números se reproduzem" reduzido para "os números das seções 1 a 8", com o Anexo G dizendo o que o script não prova.

### Ajustes do script de verificação

O juiz criticou a independência do `verificar_numeros.py`. Mudanças: os totais da OB agora vêm das células `ORDEM!X2/W2/Y2/W4` (e não do `pedido.json`); as 20 divergências são recalculadas das abas; o peso bruto entra na causa-raiz; e o `calc()` do piloto é executado por um harness versionado (`motor_piloto_harness.js`) e comparado. **Esse trabalho encontrou um erro meu:** minha primeira reimplementação das divergências deu 21 em vez de 20, e a causa era lógica da minha parte (não do piloto); reescrevi a checagem a partir das abas e o total passou a coincidir.

### Ajustes não aceitos ou parcialmente aceitos

- **Seção de impacto com baseline:** o juiz pediu horas e custo economizados. Os arquivos do desafio não trazem tempo de ciclo, volume de pedidos nem custo de frete, então o documento lista os indicadores que a plataforma passa a medir e declara que o ponto de partida ainda não existe; não afirma economia.
- **"28 PBR por carreta é padrão de mercado":** não incluí, porque não verifiquei a afirmação e o time já confirmou as posições.
- **Mandar as seções 5 e 14 para o anexo:** mantidas no documento principal porque a diretriz do time é local-first com AWS depois, e o leitor precisa ver os dois caminhos.

### O que separa a versão atual de 9, segundo o juiz

Os três bloqueadores e os ajustes 1 a 6, todos corrigíveis no texto e no motor, e a seção de impacto. O que é fixo e depende da 3corações (Q3, Q5, Q6a, Q9, Q10, Q12, Q13) não impede o 9, desde que cada premissa esteja declarada e visível na tela. As correções acima atacam os três bloqueadores e os ajustes 1 a 6, mas **nenhuma nota nova foi dada**.


---

## Checklist da devolutiva da rodada 3 (fechamento da aprovação)

Decisão do time em 13/10 às 18:06: a arquitetura está **aprovada com uma ressalva**. O agente principal corrige o documento a partir da devolutiva do juiz (esta lista); concluídas as correções, a arquitetura está aprovada, **sem nova rodada do juiz**, a menos que o time a autorize (o limite era de 3).

**Fechamento em 13/10/2026:** nenhum item ficou Pendente ou Parcial. As correções e as respostas do time (Q6, Q12, Q13) foram aplicadas, `validar_documentos.py` dá OK (152 verificações sem o piloto, 166 com ele), e o cabeçalho do `ARQUITETURA.md` registra a aprovação. Nada disso foi re-julgado: a nota registrada continua 7,8.

Legenda: **Feito** = aplicado no texto, sem re-julgamento; **Superado** = substituído por uma decisão do time; **Não aceito** = recusado, com o motivo.

### Bloqueadores

| # | Devolutiva do juiz | Status | Onde |
|---|---|---|---|
| B1 | Estivada sem alocação; a justificativa "faltam dimensões" era incoerente com as outras premissas | Feito: modelo de piso (pilhas de `altura` camadas × área C×L), piso = posições × 1,2 m² como premissa rotulada; caso 5. A resposta padrão da Q10 foi alinhada a isso | §8 regra 4, caso 5, F1, §15 |
| B2 | Segregação de funções com brecha (quem cria a v1 em nome do cliente pode aprová-la) | Feito: aprovador ≠ autor de qualquer versão; aplicar import exige `int_admin`; override confirmado por `int_exportacao` | §6 |
| B3 | `GET /portal/catalog` sem os campos que o motor usa no navegador | Feito: contrato traz medidas, volume, un/cx, lastro, camadas, lote mínimo, EAN, DUN, NCM | §7.4, §11 |

### Erros e inconsistências do documento

| # | Devolutiva | Status |
|---|---|---|
| 1 | `VOL_MISMATCH` contradiz o caso 1 (58,88 contra 59,04 m³) | Feito: `engine_version` 1 usa o declarado, a 2 usa as medidas; caso 1 mostra os dois |
| 2 | Catálogo do portal incompatível com o motor | Feito (= B3) |
| 3 | "Prevalece o SAP" contradiz o stick a 1,2 kg | Feito: `master_override` criado pelo seed; agora são três exceções declaradas no §7.3 (stick e os 2 SKUs da Q12) |
| 4 | Caso 3 depende do lastro 4 do 12034109, que o texto chama de implausível | Feito com a Q12: duas variantes. Piloto (28 cx/pallet): 20 de 20, completa. Adotada (98): 17 de 20, 85%, incompleta, com 3 posições livres para upsell. O caso 4 ganhou as mesmas duas variantes (20908885: 1,00 e 1,43 pallet) |
| 5 | Q6 "resolvida" mas os JSON trazem valores da OB | Superado pela Q6: os valores vêm do site da 3corações. Q6 e Q6a fechadas; origem `SITE_3C` |
| 6 | Matriz de permissões (leitura × escrita, mesma pessoa aplica e aprova) | Feito |
| 7 | "1 preço diferente" são 2 | Feito |
| 8 | "20 divergências" e "6 de 10 SKUs" misturados | Feito |
| 9 | Preço 17,611 em 3 casas gera `VALOR_TOTAL ≠ QTD × PRECO_UNIT` | Feito: 2 casas, total = caixas × preço arredondado |
| 10 | Upsell promete 3 opções e mostra 2 | Feito: 3 opções |
| 11 | Lote mínimo na estivada | Feito: vale nos dois modos |
| 12 | Usar o JSON v2 como modelo de contrato propaga os erros | Feito; `DERIVED_MISMATCH` agora compara com o dado mestre adotado (4 SKUs) |
| 13 | Detalhes (data do `container.json`; "28 PBR é padrão de mercado") | Data: feito. "Padrão de mercado": não aceito, porque não foi verificado e o time já confirmou as posições |

### Ajustes recomendados

| # | Devolutiva | Status |
|---|---|---|
| 1 | Caso 1 com 59,04 m³ / 82,0% / 97,0% | Feito |
| 2 | Caso 3 com 98 cx/pallet (sensibilidade) | Feito: com a Q12, a variante de 98 é o resultado esperado do motor novo |
| 3 | Declarar o `master_override` do stick no seed | Feito |
| 4 | Separar papéis: aplicar import e override com segunda pessoa | Feito |
| 5 | Renomear `MARKET_REF`, "preço a confirmar" ao distribuidor, aceite de `int_exportacao` antes de APPROVED, Q6 em aberto | Superado pela Q6: origem renomeada para `SITE_3C`; o reconhecimento na aprovação (`PRICE_NOT_IN_SAP` e `PRICE_REF_ACKNOWLEDGED`) foi removido, porque só existia enquanto a origem não estava esclarecida; fica o rótulo no backoffice. O distribuidor vê o preço como qualquer outro (decisão do time) |
| 6 | Corrigir "1 preço" e separar divergências × SKUs | Feito |
| 7 | Script: ler `ORDEM!X2/W4`, tirar literais, reproduzir as 20 divergências, versionar o harness, trocar "todos os números" | Feito. A ocupação da base passou a sair das medidas; os literais que restam (30 ÷ 26, 12 × 159 + 150, 60 ÷ 11, US$/kg) estão listados no Anexo G |
| 8 | IA: avisar que Legacy não aceita clientes novos; reforço Active | Feito no texto. O modelo concreto de reforço depende da conta (Q7) e é configuração, não documento |
| 9 | Preço com 2 casas e arredondamento | Feito |
| 10 | Upsell com 3 opções; lote mínimo na estivada | Feito |
| 11 | Redação do `SUMIFS` | Feito (fórmula conferida nas células) |
| 12 | Apresentação: página de pitch, impacto com baseline, mover §5 e §14 ao anexo | Pitch: feito (roteiro de 5 minutos no §13, com a ressalva das posições dita em voz alta e a fatia de que cada bloco depende). Baseline: não aceito, porque os arquivos não trazem tempo, volume nem custo; o §1 lista o que passa a ser medido. §5 e §14: não aceito, mantidas no principal porque a diretriz é local-first com AWS depois |

### Apontado pelo juiz fora das listas

| Tema | Status |
|---|---|
| Timeout de transação do Data API | Feito: transação desfeita após 3 min sem chamadas e no máximo 1 h; chamada de 45 s salvo `continueAfterTimeout`; timeout do SDK ≥ 1 min. Compatível com a regra de transações curtas do §5 (§14, Anexo F) |
| Extensões `pg_trgm` e `btree_gist` no Aurora | Feito: 1.6 nas versões 16, 17 e 18 da lista de extensões do Aurora. Verificado na documentação; não testado num cluster (§14, Anexo F) |
| Clareza como apresentação (7,0) | Feito em parte: o roteiro do pitch (§13) e o §1 servem de porta de entrada. O documento não foi enxugado, para não perder rastreabilidade antes das specs |

### Respostas do time depois da rodada 3 (aplicadas em 13/10)

| Pergunta | Decisão | Onde |
|---|---|---|
| Q6 e Q6a | Os preços dos 3 SKUs sem registro (36,96, 29,48 e 17,611) vêm do site da 3corações (informação do time; não conferida no site). Origem `SITE_3C`; sem reconhecimento obrigatório na aprovação | §7.1, §7.2, §7.3, §8, §15; Anexo E7 e J9 |
| Q12 | Heurística: 12034109 → 98 (14 × 7) e 20908885 → 77 (11 × 7), como `master_override` confirmado por `int_exportacao`. Não confirmada pela logística | §3, §7.1, §7.3, §8 (casos 2 a 4), §15; Anexo E6, E11 e J3; script, seção 3b |
| Q13 | Pode enviar planilhas de clientes a um modelo de IA em nuvem, com inferência global em São Paulo | §9, §15 |
| Equipe | 4 devs: Cecília (dados), Bruno (piloto), Ruan, chamado pelo time de "Juan" (front-end; a confirmar), Guilherme (back-end e integração). Sem dono: IA, nuvem e pitch | §11, §13 |
| Corte e responsáveis (13/10, 18:59) | Entram segregação, pedidos persistentes e backoffice; exportação para o SAP e para o padrão OB adiada. Ruan = "Juan", confirmado. Front com Ruan e Bruno; back-end, integração, IA e nuvem (depois da validação local) com Guilherme; dados da Cecília concluídos | §11, §13; specs em `docs/specs/` |


---

## Juiz das specs e do plano (13/10, a pedido do time)

Rodada nova, separada das 3 da arquitetura: um juiz adversarial independente avaliou `docs/specs/` e `docs/plano/PLANO.md` contra a arquitetura aprovada, o front real (`dca67be`) e as fontes. **Nota: 6,8** (aderência 7,5 · segurança e segregação 6,0 · máquina de estados 6,5 · motor e paridade 8,5 · banco e seed 7,5 · integração com o front 5,5 · plano 6,0 · clareza 7,5). As correções abaixo não foram re-julgadas.

O que o juiz conferiu e confirmou: implementou o motor só pelo texto do 01 e comparou com o `calc()` de `dca67be` em 20.000 pedidos, sem divergência; o DDL no PGlite; os pedidos de exemplo (0001 com 3192 cx dá 28 de 28 sem bloqueio; 0003 dá 17 de 20); os índices de coluna das planilhas; o conjunto `DERIVED_MISMATCH`.

| # | Bloqueador | Correção aplicada |
|---|---|---|
| B1 | `dados/` v2 não está em nenhuma branch, e `core.autocrlf=true` sem `.gitattributes` muda o hash entre máquinas | S0 commita `dados/` v2 e a verificação; `.gitattributes`; sha256 com fim de linha normalizado; clone limpo no critério da S0 e da S3 (README, 03, PLANO) |
| B2 | A fachada do modo demo envolveria `get` em `Promise`, e `updateItem`/`approve` (que chamam `API.get`) quebrariam o `file://` | `get` síncrono nos dois modos; `API_DEMO.get` dentro do corpo; teste de fumaça do modo demo com `happy-dom` (05) |
| B3 | `S.client` ficaria em `"minoil"` para a Sofía (erro em `headerHTML`); logout sem recarregar deixaria dados internos para o próximo usuário; hero do 3D depende de `CLIENTS` | `PSF.start` define `S.client` e `S.lang`; `PSF.logout` recarrega a página; hero vazio no modo servidor (05) |
| B4 | `payload` dos eventos (totais da OB) chegaria ao portal; textos fixos no HTML com nomes de clientes; o teste de textos procurava só 3 termos | `payload.internal` nunca vai ao portal; schema estrito na saída do portal; textos neutralizados na S7; varredura com nomes (04, 05) |
| B5 | Testes que passam sem provar: isolamento na S4 sem rotas, autor de versão não testado, `hono/csrf` que não age em JSON (conferido no código-fonte da 4.13.13), `NO_PRICE` e empate nunca exercitados | Controle positivo em cada negação; teste de autor sem ser criador; checagem de origem própria em vez de `hono/csrf` (D13); casos 7 e 8 no motor e `NO_PRICE` na paridade (01, 04) |

Também corrigidos: §7.2 da arquitetura (devolução → reenvio; exceção do `SUBMITTED` com bloqueio vindo da OB), §7.1 (fontes do seed, D11), `/v1/health`, fatias trocadas, "`calc()` idêntico", `EXTRA` no `demo-data.js`, status "Devolvido" em `FLOW`/`ST`/`QF`/`step`, `price` e `priceSrc` no backoffice, elementos a esconder, bloqueio de login sem enumeração, semântica da aprovação com recálculo, `select … for update` no `pg`, `NO_CHANGES`, reenvio sem aprovação automática, senha embutida na coluna [0] da OB, idioma e texto de pagamento da MINOIL, aprovação automática ligada pela rota no teste, `tsc --noEmit` no `npm test`, marcos do Dia 2 e responsável do ensaio.
