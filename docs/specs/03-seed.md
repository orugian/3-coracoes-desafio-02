# 03 · Seed

O seed monta o banco do corte a partir das fontes do desafio, das decisões do time e dos JSON da Cecília. Ele é a única forma de carga de dados mestres no corte (o importador por upload é F3). Base: §7.1, §7.3 e §7.4 da arquitetura.

## Fluxo

```
pre-solucao/*.xlsx|xlsm ──► db/seed/extrair_planilhas.py ──► db/seed/fontes/sap_conferencia.json, sap_materiais.json, sap_registros.json, ob.json
git show f89cef4:index.html ──► scripts/extrair_piloto.ts ──► db/seed/fontes/piloto.json
                                                          └──► packages/engine/test/fixtures/piloto.json
dados/*.json (Cecília) ─────────────────────────────────────┐
db/seed/decisoes.ts (decisões do time) ─────────────────────┤
db/seed/fontes/*.json ──────────────────────────────────────┴──► npm run db:seed ──► banco
```

- Os arquivos de `db/seed/fontes/` são gerados e versionados, **um por arquivo de origem** (é o que vira um `import_batch`); cada um traz `{ source, file, sha256, extractedAt, rows }` (o do piloto traz também `commit`, `vehicles`, `clients` e `rules`). Não editar à mão. `npm run extract` regenera todos; `extractedAt` só muda quando o conteúdo muda, então regenerar sem mudança na origem não gera diferença no git. O `sha256` é dos bytes com `\r\n` trocado por `\n` (README, "Ciclo de vida das fontes"), para valer igual em Windows, Linux e Mac.
- O extrator Python reaproveita a leitura de `verificar_numeros.py` (mesmas colunas, mesma normalização). Ele **nunca grava** a coluna de senha da aba DADOS CLIENTES (ver a autoverificação no fim).
- O seed (Node) não lê planilhas: carrega os JSON, cria um `import_batch` `ACTIVE` por arquivo de origem (com o `sha256` do arquivo original) e roda o motor para gravar o resultado dos pedidos de exemplo. Por isso depende do motor (fatia S1 do plano). São 10 lotes: 3 do SAP, 1 da OB, 4 `DADOS_JSON` (um por JSON da Cecília), 1 `PILOTO` (`file_name` = `index.html@<commit>`) e 1 `DECISOES` (o `sha256` do próprio `db/seed/decisoes.ts`). O `quality_report` do lote da OB guarda a divergência de idioma da MINOIL e as escolhas de lote mínimo (linha repetida, `DEFAULT`); os de `catalogo.json` e `produtos_internos.json` guardam o `DERIVED_MISMATCH` com os campos que divergem.
- `npm run db:seed` falha se o `sha256` de uma fonte em `fontes/*.json` não bater com o arquivo atual em `pre-solucao/` (fonte desatualizada: rodar `npm run extract`). Os JSON de `dados/` são lidos direto, e o piloto vem de um commit fixo, então não há o que ficar desatualizado nesses dois.
- O seed também recusa dados que quebrariam as regras da API: envio de distribuidor com BLOCK, nova versão por quem não é `int_exportacao`, aprovação por quem criou o pedido ou uma versão, aprovação com BLOCK na versão ou no recálculo, override cujo valor do SAP mudou e preço do site (Q6) para SKU que passou a ter preço no SAP.

## De onde vem cada campo

| Tabela.campo | Fonte primária | Conferência no teste do seed |
|---|---|---|
| `material_uom` (CX e demais UM): medidas, volume, pesos, `units_per_uom`, EAN da UM | SAP Conferência: [5] UM, [4] Denominador, [6] Contador, [7] EAN, [9..11] C/L/A em mm, [13] volume em dm³ (`CD3`), [15] líquido, [16] bruto, [17] unidade de peso | Piloto `P`: `un`, `net`, `gross` (exceto o stick), `dm3`, `dims` |
| `material`: descrição SAP, hierarquia, validade | Conferência [3], [21], [20] | — |
| `palletization.layer_boxes`, `layers` | SAP Materiais: [4] centro, [5] lastro, [6] altura | Conferência [26], [27]; piloto `lastro`, `alt` |
| `palletization.min_lot_pallets` | OB PALETIZAÇÃO ([1] filial, [2] material, [3] descrição, [7] lote), filial do centro (`LONT` → 2612). Linha repetida: vale a de descrição igual ao texto do SAP (12037417 → "RED DES", lote 2). Sem linha da filial: 1, com `min_lot_source = 'DEFAULT'` (12034103) | Piloto `loteMin` (10 de 10) |
| `price` lista US, `SAP_LIST` | SAP Registros: [0] canal, [2] centro, [6] lista, [8] material, [12] UM, [13] e [14] vigência, [16] preço sugerido, [18] moeda, [19] exclusão = 0 | Piloto `price` dos 7 SKUs |
| `price` lista US, `SITE_3C` | `decisoes.ts` (Q6): 12034109 36,96; 12037417 29,48; 20908885 17,61 (`price_raw` 17,611). Canal 13, centro 2612, vigência de 2026-01-01 a 9999-12-31 | `catalogo.json` `preco_venda` dos 3 SKUs |
| `price` lista AR, `DEMO_DERIVED` | Para os 10 SKUs: `floor(US × 1,06 × 100 + 0,5) ÷ 100` (o `Math.round` do piloto), mesma vigência da linha US | Piloto `priceFor(p, "rioclaro")` |
| `material`: família (código da UI), marca, `units_label`, NCM, linha, EAN, DUN; `material_i18n` pt/es/en | Piloto (`P` e `EXTRA` de `f89cef4`): textos já revisados pelo time (decisão D11) | EAN = EAN da UM de consumo (UN, SCH ou DIS) e DUN = EAN da CX na Conferência, 10 de 10; NCM contra `produtos_internos.json`; nomes es/en contra a aba AUX da OB, com as 2 ausências conhecidas (12142146 e 12147801) |
| `material_ob_reference` | OB: TAB [5] material, [8] preço, [12] cx/pallet; PALETIZAÇÃO un/pallet [6] da filial LONT (sem linha LONT, BHO) ÷ un/cx do SAP; lote da primeira linha do material (é o que a `ORDEM!Z` faz); bruto da linha = `ORDEM!M × ORDEM!J` | Piloto `P[].ob` (`cxPal`, `palz`, `price`, `lote`, `grossCx`) |
| `customer` 11131 MINOIL | OB DADOS CLIENTES: [1] código, [5] nome, [4] lista, [6] código de pagamento, [8] Incoterm, [11] moeda, [13] filial. Do piloto (`CLIENTS.minoil`), para a demo não mudar: `slug` `minoil`, `destination_label` "Mercosul", contato "Martín", texto de pagamento "Standby irrevogável 60 dias" e idioma `pt` (o piloto não define `lang` para a MINOIL; a OB diz "Espanhol", que fica registrado no `quality_report` do lote como divergência). `country` nulo (Q5) | `catalogo.json` `cliente`; piloto `CLIENTS.minoil` |
| `customer` 11999 Río Claro (demo) | `decisoes.ts`, copiado do piloto `CLIENTS.rioclaro`: Argentina (`AR`), USD, FCA, pagamento 0030 "Antecipado 30 dias", lista AR, filial LONT, contato "Sofía", `es`, `is_demo` | — |
| `branch_plant` | `decisoes.ts`: só `LONT → 2612`, `is_assumption`; `plant_name` de Registros [3] ("CD Londrina") | — |
| `vehicle_type` | `dados/container.json`: id, nome, modal, cubagem, carga útil. Posições de `decisoes.ts` (28, 20, 10; Q4) | Piloto `VEH` |
| `country_rule` | `decisoes.ts`: `AR`, cliente 11999, 20908885, `BLOCK`, "Regra de demonstração do piloto (Q5)", `is_demo` | Piloto `CLIENTS.rioclaro.blocked` |
| `master_override` | `decisoes.ts`, os três do §7.3 (abaixo) | — |
| Pedido 0001 | `dados/pedido.json` (itens e caixas; referência "PEDIDO TESTE"); os totais da OB vão no `payload` do evento | Células `ORDEM!X2`, `W2`, `Y2` (já conferidas pelo script de verificação) |

Normalização: peso em `G` × 0,001 (o `weight_unit_raw` guarda a unidade original); volume `CD3` = dm³; `units_per_uom = Contador ÷ Denominador`; preço com 2 casas (o original em `price_raw`).

Uso dos JSON da Cecília: `container.json` e `pedido.json` são fonte direta; `catalogo.json` e `produtos_internos.json` entram como lote `DADOS_JSON` e servem de conferência. Eles não alimentam peso, volume e cx/pallet porque 4 SKUs divergem do dado mestre adotado (§7.3, `DERIVED_MISMATCH`); o teste do seed afirma exatamente esse conjunto (12142501, 12144012, 12147801, 20908885), então uma nova versão dos JSON que corrija os valores aparece como mudança de teste, não passa despercebida.

## Overrides

| Material | Campo | SAP | Adotado | Decisão | Justificativa |
|---|---|---|---|---|---|
| 12147801 | `material_uom` CX `gross_kg` | 0,00089 (0,89 G) | 1,2 | Q9 | SAP com unidade trocada; valor do piloto e escolha conservadora para o limite de peso |
| 12034109 | `palletization` 2612 `layer_boxes` | 4 | 14 | Q12 | Heurística do time (Q12): TAB e PALETIZAÇÃO dão 98 = 14 × 7; lastro 4 cobre 28,4% da base |
| 20908885 | `palletization` 2612 `layers` | 10 | 7 | Q12 | Heurística do time (Q12): PALETIZAÇÃO dá 77 = 11 × 7; 10 camadas passam de 2.393 mm |

Os três são criados `ACTIVE`, propostos por `admin.dados` e confirmados por `ana.exportacao`.

## Usuários

| Usuário | Papel | Nome exibido | Escopo |
|---|---|---|---|
| `martin.minoil` | `ext_distribuidor` | Martín (MINOIL S.A.) | 11131 |
| `sofia.rioclaro` | `ext_distribuidor` | Sofía (Distribuidora Río Claro S.R.L.) | 11999 |
| `lucas.exportacao` | `int_exportacao` | Lucas (Exportação) | — |
| `ana.exportacao` | `int_exportacao` | Ana (Exportação) | — |
| `admin.dados` | `int_admin` | Administração de dados | — |

Senhas: se `SEED_PASSWORD` estiver definida (uso local de demonstração), todos recebem esse valor; senão, 16 caracteres aleatórios por usuário, impressos uma vez e gravados em `storage/credenciais-seed.txt`. `storage/` fica no `.gitignore`; nenhuma senha vai para o git. Os nomes de usuário são previsíveis, então o bloqueio de login (04) é por usuário e expira; se alguém bloquear uma conta durante a demo, `npm run user:unlock -- <usuario>` zera o contador. No PGlite, o `dev` segura a trava do `DATA_DIR` (02): parar o `dev`, rodar o comando e subir de novo.

## Pedidos de exemplo

Adaptados do seed do piloto para respeitar a segregação de funções (quem cria ou edita não aprova) e o corte (sem `EXPORTED`). Datas em −03:00; o preço é resolvido na data de criação de cada versão. O resultado do motor é calculado pelo seed, nunca copiado.

| Pedido | Cliente e veículo | Versões | Estado final | Para que serve na demo |
|---|---|---|---|---|
| 3CC-2026-0001 | MINOIL, carreta, `PALLETIZED`; itens do `pedido.json` | v1 de Lucas em 09/10 17:53, origem `ORDER_BASIS`, motivo "Importado da planilha Order Basis; a planilha indicava embarque OK" | `SUBMITTED`, `blocking` (30 posições para 28) | Lucas ajusta (nova versão) e não consegue aprovar; Ana aprova |
| 3CC-2026-0002 | MINOIL, carreta; 2688 cx de 12031189, 324 de 12034103, 600 de 12142146, 182 de 12037417; ref. "OC-2026-097"; carregamento 24/10 | v1 de Martín em 11/10 09:12; v2 de Lucas às 11:31 (12034103 de 324 para 405, "completar a carreta") | `APPROVED` por Ana às 11:40 | Histórico com ajuste e aprovação por outra pessoa |
| 3CC-2026-0003 | Río Claro, contêiner 40'; 1176 cx de 12031291, 140 de 12034109, 1400 de 12142501, 540 de 12147801; ref. "OC-4471"; carregamento 03/11 | v1 de Sofía em 12/10 10:21 | `APPROVED` por Lucas às 14:05 | Pedido de outro distribuidor para o teste de isolamento; caso 3 na variante adotada (17 de 20) |

Eventos gravados: `SUBMITTED` em toda v1 (no 0001, `payload.internal` com `origin` e os totais da OB: 20.151,04 kg, 19.070 kg, 28,886 pallets, US$ 192.005,84; o portal nunca recebe `payload.internal`, 04), `VERSION_CREATED` na v2 do 0002 (`payload.changes = [{ material, old, new }]`) e `APPROVED` nos dois aprovados. Depois do seed, `sales_order_seq` fica em 3.

O 0001 nasce `SUBMITTED` com `blocking` verdadeiro: é a exceção, declarada, à regra "`SUBMITTED` é bloqueado por alerta BLOCK" do §7.2, porque o pedido entra pela OB (origem `ORDER_BASIS`), não pelo portal. A regra vale para os envios do distribuidor; as versões criadas pela Exportação também podem ter bloqueio (ajuste em andamento), e a aprovação continua exigindo zero bloqueios.

As datas de carregamento dos exemplos (24/10 e 03/11) estão a mais de 7 dias das datas de criação. A regra dos 7 dias vale só na criação e no reenvio, então os pedidos continuam válidos quando a demonstração passa dessas datas.

## Testes do seed (`server/test/seed.test.ts`)

Em PGlite em memória, rodando o seed completo:
- um `import_batch` por fonte, com o `sha256` do arquivo atual;
- contagens: 10 materiais, 10 `palletization`, 10 preços US (7 `SAP_LIST`, 3 `SITE_3C`), 10 preços AR, 3 veículos, 2 clientes, 5 usuários, 3 overrides `ACTIVE`, 3 pedidos; nenhuma janela de vigência sobreposta na mesma chave de preço;
- conferências da tabela acima contra a fixture do piloto, com uma lista explícita de diferenças esperadas: só `layer_boxes` de 12034109 (14 contra 4) e `layers` de 20908885 (7 contra 10) no catálogo efetivo;
- `DERIVED_MISMATCH` contra `catalogo.json` e `produtos_internos.json`: exatamente 12142501, 12144012, 12147801 e 20908885.

O extrator Python faz uma autoverificação antes de gravar `ob.json`. A aba DADOS CLIENTES tem a senha na coluna [2] e também **embutida na coluna [0]** ("CHAVE" = código do cliente seguido da senha); por isso o extrator não grava as colunas [0] e [2] e, antes de gravar, procura cada valor de senha como **substring** no JSON serializado. Se achar, aborta sem imprimir o valor. `python db/seed/extrair_planilhas.py --verificar` repete a busca em todas as fontes já gravadas e confere o próprio detector com um valor plantado; o `seed.test.ts` roda esse modo (pulado só se não houver Python).

Formato do `payload.internal` do evento `APPROVED` (seed e, na S6, a rota): `{ contentHash, recalculatedContentHash, recalculatedBlocking, resultChanged }`, mais `recalculatedResult` (o `EngineResult` recalculado) quando `resultChanged` for verdadeiro.
