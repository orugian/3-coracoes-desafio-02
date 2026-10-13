# Anexo de evidências — Pedido sem Fronteiras

Complementa [`ARQUITETURA.md`](ARQUITETURA.md). Cada achado indica o método. Os números se reproduzem com:

```
python docs/arquitetura/verificacao/verificar_numeros.py
```

O script só lê arquivos e roda 152 verificações (166 se receber o `index.html` do piloto, caso em que executa o motor dele e compara; ver G). Todas conferem. Ele prova que os números saem das fontes com as regras descritas; não prova que as regras estão certas para a 3corações.

Índice: A planilhas · B JSON de `dados/` · C `container.json` · D piloto · E peso do stick · F ambiente técnico · G limites.

---

## A. Planilhas do desafio

Método: leitura com `openpyxl` (valores e fórmulas) e extração do VBA com `oletools`. Fontes: Conferência de produtos, Materiais e Registros (exports "Exportação SAPUI5") e `ORDEN BASIS TESTE.xlsm` (OB).

| # | Evidência | Método e valor |
|---|---|---|
| E1 | As três planilhas SAP são a origem declarada da OB, que as copia à mão | A OB indica "Gerar base do SAP transação ZWMSCONFPROD" (aba PROD), "ZSDO041" (aba TAB) e "ZSDR059A" (aba DADOS CLIENTES). A aba PALETIZAÇÃO traz o aviso "Informação fornecida pelo M&A confirmar com a logistica": a paletização da própria OB não está confirmada |
| E2 | Cadastro da caixa diferente entre a aba PROD da OB e o SAP em 6 de 10 SKUs | 4 SKUs por medidas ou volume (12142501, 12144012, 12147801, 20908885) e 4 por peso (12034103, 12037417, 12147801, 20908885); a união é 6. Exemplo: 12147801 tem 340×198×127 mm no SAP e 257×195×173 na OB |
| E3 | A OB calcula o peso como peso da unidade × unidades por caixa, sem a embalagem | O `SUMIFS` da aba PROD que obtém as unidades por caixa soma as duas linhas UN repetidas do 12037417: 1,84 ÷ 0,092 = 20, em vez de 40. Peso bruto por caixa na OB: 1,36 kg contra 2,34 kg no SAP (−41,9%) |
| E4 | Pedido-teste (4 linhas, cliente 11131 MINOIL) | OB: 20.151,04 kg, 19.070 kg líquido, 28,886 pallets (soma de frações), 58,88 m³, "OK", US$ 192.005,84. Com o registro CX do SAP: 21.024,24 kg (+873,20 kg, +4,3%), 19.230 kg líquido, 30 posições, 58,88 m³ |
| E5 | A validação "EMBARQUE" só testa cubagem e peso | Fórmula de `ORDEM!W4`: `OR(X2>25000, X4>VLOOKUP(H11, AUX!BN:BO, 2, 0))`. Limite de 25.000 kg igual para todos os veículos; não há teste de posições. `AA2 = X2/26` não é documentada (sugere 26 posições). O 73,8 de `I11` é constante exibida e nunca entra na validação |
| E6 | O SAP também tem registros implausíveis | 12034109: lastro 4 cobre 28,4% da base PBR 1,2×1,0 m (lastro 14 cobriria 99,3%). 20908885: 10 camadas dão 2,65 m com a base de 0,15 m (o pallet padrão do café, 12 camadas de 159 mm, tem 2,058 m). Esses dois foram corrigidos por heurística (E11). 12147801: peso em G, com bruto 0,89 menor que o líquido 408. 12144012: volume declarado 7,373 dm³ contra 7,887 pelas medidas (7,0%); o declarado é exatamente o das medidas antigas da OB (515×103×139). 12147801: volume 8,670 contra 8,550 pelas medidas (1,4%), igual às medidas antigas da OB |
| E7 | Preços | `Registros` não tem registro para 12034109, 12037417 e 20908885. A OB usa 36,96, 29,48 e 17,611, que o time informou serem os preços do site da 3corações (Q6; não conferi no site). 12142146: 50,27 no SAP (vigente desde 30/04/2026) e 50,01 na OB. 12031189: 49,41 no SAP e 49,4067 na OB (origem dos US$ 11,64 de diferença no valor do pedido-teste) |
| E8 | O resumo por família perde uma família | `ORDEM!W11` é "FILTRO" e `H22` é "FILTRO DE PAPEL": US$ 7.370 e 230 kg do filtro não entram no resumo |
| E9 | Credenciais em texto | A senha do cliente está em texto puro na aba DADOS CLIENTES, e a senha de proteção das abas está no código VBA. Os valores não são reproduzidos aqui |
| E10 | Paletização por filial | `PALETIZAÇÃO` é chaveada por material e filial (BHO, LONT, NAT). 12037417 tem duas linhas por filial: "DES AL" (lote 1) e "RED DES" (lote 2). A Conferência do SAP usa "RED DES". `Z` na aba ORDEM busca o lote só por material: 12144012 herda 3,12 de BHO em vez de 1 de LONT, e a OB marca "NÃO". 12034103 só tem linha BHO. O VBA não tem rotina de exportação no layout do SAP, apenas PDF e Excel |
| E11 | Caixas por pallet de 12034109 e 20908885 (Q12, heurística do time; seção 3b do script) | **12034109 → 98 (14 × 7).** Abas TAB e PALETIZAÇÃO da OB: 98 (2.352 un ÷ 24, nas duas filiais em que aparece, BHO e LONT); o SAP tem 4 × 7 = 28. Com lastro 4 a base fica 28,4% coberta; com 14, 99,3%, no limite por área (14). Altura com 7 camadas: 1.900 mm. **20908885 → 77 (11 × 7).** PALETIZAÇÃO: 924 un ÷ 12 = 77 nas três filiais, que decompõe exatamente em 11 × 7 com o lastro do SAP (preenchimento de 93,0%; limite por área: 11). O SAP tem 11 × 10 = 110, mas 10 camadas levam a 2.650 mm, acima de 2.393 mm; com 7, 1.900 mm. O 60 da aba TAB dá 5,45 camadas com lastro 11. Os outros 9 SKUs cobrem de 79,6% a 97,4% da base com o lastro do SAP. Guilhotina descartada como critério: no máximo 13 caixas por camada no 12034109, mas também 12 no 12031189, cujo lastro real é 14. Com os valores adotados, nenhum SKU dispara `LAYER_FILL_OUT_OF_RANGE` nem `PALLET_TOO_TALL`. Não confirmado pela logística |

---

## B. Arquivos JSON de `dados/`

Dois momentos: a versão 1 (gerada em 13/10 às 13:33, preservada em `git show e64eedc:dados/catalogo.json`) e a versão 2 (gerada às 16:19; `catalogo.json`, `produtos_internos.json` e o novo `pedido.json`).

| # | Evidência | Método e valor |
|---|---|---|
| J1 | A v2 foi gerada a partir da OB, não do SAP | Preço igual à aba TAB da OB em 10 de 10 SKUs; caixas por pallet iguais à aba TAB em 10 de 10. Contra o SAP: preço igual em 6 de 7 SKUs com registro (a exceção é 12142146) e caixas por pallet iguais em 8 de 10 |
| J2 | Peso líquido errado em 4 SKUs, bruto em 1 | 12142501 (1,0 contra 0,96), 12144012 (1,0 contra 0,8), 20908885 (1,0 contra 0,552), 12147801 (1000 contra 0,408, em G); bruto do 12147801 (2,3 contra 0,89). **Causa:** `peso_*_max` é o máximo cru entre todas as linhas de unidade de medida, inclusive a linha sintética "KG" (peso 1,0) e sem converter G para kg. A hipótese explica 10 de 10 SKUs nos dois campos |
| J3 | Caixas por pallet herdadas da OB | 12034109: 98 contra 28 no SAP. 20908885: 60 contra 110. Com a Q12 (E11), o 98 do 12034109 é o valor adotado; o 60 do 20908885 não coincide nem com o SAP nem com o adotado (77) |
| J4 | Volume herdado da OB | 20908885: 20,563 contra 25,35. 12142501: 8,122 contra 7,056 |
| J5 | Paletização inconsistente dentro do próprio JSON | `paletizacao_umb` ÷ unidades por caixa difere de `paletizacao_cx` em 5 SKUs: 12034103, 12037417, 12142501, 12144012 e 20908885. Refletem as abas PALETIZAÇÃO e TAB da OB, que usam fontes diferentes por coluna |
| J6 | Nomes e famílias | O nome do JSON difere do Texto breve do SAP em 5 de 10 SKUs (por exemplo, 12037417 aparece como "DES AL" no JSON e "RED DES" no SAP). As famílias do JSON estão em inglês e coincidem com os rótulos da aba AUX da OB ("GROUND COFFEE", "PAPER FILTER"), enquanto o SAP usa a hierarquia de produtos em português |
| J7 | Descrições es/en | Ausentes para 12142146 e 12147801 (a aba AUX da OB também não as tem; o piloto tem textos próprios). O 12034103 tem "200G" na descrição em inglês e "20G" na em espanhol; o produto é 16×10×20G |
| J8 | O catálogo mistura catálogo e pedido | 4 itens trazem `caixas_pedidas` e `valor_pedido`. O `pedido.json` reproduz exatamente a OB: 4.378 caixas, 20.151,04 kg, 19.070 kg líquido, US$ 192.005,84, e marca o 12144012 como `validado: false` (o erro do lote de BHO) |
| J9 | Os 3 preços sem registro mudaram entre as versões | v1: 100,38, 30,41 e 21,70 (estimativas de varejo e atacado). v2: 36,96, 29,48 e 17,611 (os valores da OB). Em US$ por kg líquido, o 12034109 vale 7,70 com o valor da v2 e 20,91 com a estimativa da v1; os cappuccinos com preço SAP vão de 7,73 (12034103) a 12,10 (12144012). O time esclareceu (Q6 e Q6a) que os valores da v2 são os preços do site da 3corações, e são esses que valem |

SKUs da v2 com algum valor diferente do SAP (peso, volume ou cx/pallet): 12034109, 12142501, 12144012, 12147801 e 20908885. Contra o dado mestre adotado (SAP mais os overrides da Q12) são 4, porque o 12034109 deixa de divergir; é o conjunto que dispara `DERIVED_MISMATCH`.

---

## C. `dados/container.json`

| # | Evidência | Método e valor |
|---|---|---|
| V1 | Três veículos (`container_20`, `container_40`, `carreta_padrao`), cada um com `modal`, `cubagem_m3` e `peso_bruto_kg` | Confere com a aba AUX da OB: 29,7, 60,84 e 72 m³, 25.000 kg |
| V2 | Não há posições de pallet, dimensões internas nem altura | O arquivo é o conteúdo da OB em JSON. As posições (28, 20, 10) vêm do artefato |
| V3 | Só com cubagem e peso, o pedido-teste passa | Carreta: 81,8% de cubagem e 84,1% de peso (87,1% com tara de 25 kg por pallet). Contêiner 40': 96,8% de cubagem. Contêiner 20': 198,3% |
| V4 | `modal` é um campo novo | Distingue marítimo (contêineres) de rodoviário (carreta). Trocar a carreta por contêiner muda o modal do embarque, então a sugestão de veículo alternativo mostra essa mudança em vez de tratá-la como troca simples |

---

## D. O piloto 3C Conecta

Commit analisado: `636ac8d`. O commit `dbeaf42` foi analisado antes; entre os dois há 6 commits (inglês, fotos, ficha técnica, exportação no padrão OB, ajustes de tema e nova tela de acesso).

| # | Evidência | Método e valor |
|---|---|---|
| P1 | Arquivo único, sem servidor | `index.html` com 1.300 linhas e 497 KB (10 fotos embutidas em base64). Nenhuma chamada `fetch`; só o tema fica em `localStorage`. Pedidos, trilha e importações ficam em memória: recarregar apaga tudo |
| P2 | Não há login | Texto da tela de acesso: "Demonstração sem senha. Na versão final, cada área tem login próprio." O botão de entrada só troca `S.area`. A tabela "Próximos passos" do README coloca "login com perfis de acesso" na fase POC |
| P3 | Dados sensíveis no HTML | `CLIENTS` (lista, fator, bloqueios) e `P[].ob` (valores da OB) estão no código da página, legíveis por qualquer usuário |
| P4 | O motor reproduz os números do documento | Executei o `calc()` do piloto em Node sem alterá-lo: 21.024,24 kg, 19.230 kg líquido, 58,88 m³, 30 posições, excesso, valor US$ 192.017,48; carreta 107,1%; com pallet misto 29 posições (103,6%); contêiner 40' 150% das posições; contêiner 20' 198,3% da cubagem. Os números não mudaram entre `dbeaf42` e `636ac8d` |
| P5 | Dados embutidos batem com o SAP em 9 de 10 SKUs | A exceção é o stick 12147801, com bruto de 1,2 kg (override da OB; ver E) |
| P6 | As 20 divergências do README estão corretas | Refeitas com a lógica do próprio piloto: 6 de peso bruto, 6 de cx/pallet entre a aba PALETIZAÇÃO e o SAP, 2 de cx/pallet entre a OB e o SAP, 3 sem preço no SAP e 1 de preço, 2 de lote mínimo. Stick de 11,52 kg na OB (0,048 × 240) |
| P7 | Posições dos veículos | `VEH`: carreta 28 posições e 14 colunas, contêiner 40' 20 e 10, contêiner 20' 10 e 5. O README as lista como premissa "a validar com a 3corações"; o time confirmou que estão corretas |
| P8 | O CSV não tem escape | `buildCSV` e `buildOB` concatenam campos com `;` sem aspas. A referência do cliente é texto livre |
| P9 | Leitor de planilhas | SheetJS 0.18.5 em `vendor/`, com fallback para o cdnjs sem verificação de integridade |
| P10 | Cobertura | Estivada só por peso e cubagem; uma sugestão por vez; restrição por país é a lista fixa `blocked` do cliente demo; sem leitura de planilha de pedido |
| P11 | Commit `dca67be` (13/10, 21:14 UTC), posterior à análise | O harness dá os mesmos 14 resultados do `636ac8d` (o cliente demo mudou de chave, de `demo` para `rioclaro`, e o harness passou a encontrá-lo pelos dados). Novidades: pedidos, carrinho, regras e catálogo importado no `localStorage` (chave `3cc-v3`); objeto `API` com `createOrder` (idempotência por `draftId`), `updateItem`, `approve`, `exportSap` e `setClientRule` (pallet misto e aprovação automática por cliente); estados `analise`, `aprovado` e `sap`; 3 pedidos de exemplo no HTML; importação de pedido do Excel por código, EAN ou DUN; visão 3D. Continua sem login e sem `fetch`, e `CLIENTS`, `P[].ob` e os pedidos de exemplo seguem no HTML. O `f89cef4` (22:46 UTC, "Corrige bugs encontrados na varredura de qualidade") também dá os mesmos resultados no harness; mudanças: pedido sem itens passa a bloquear e não pode ser aprovado, a referência do cliente perde `;`, aspas, tabulação e quebras de linha (o que reduz, mas não resolve, o problema do P8: fórmulas iniciadas por `=`, `+`, `-` ou `@` continuam), datas no fuso local, chave `3cc-v4` e importação de pedido por cabeçalho em todas as abas |

---

## E. Peso bruto da caixa do stick (12147801)

O SAP traz para a linha CX: líquido 408 G e bruto 0,89 G. Bruto menor que líquido é impossível, então a unidade do bruto está errada. A OB usa 1,2 kg (`PROD!R24`), e o piloto adotou esse valor.

Teste indireto: papelão implícito = bruto da caixa − 240 sachês × 2,3 g, dividido pela área da caixa.

| Candidato | Papelão implícito | kg/m² de papelão |
|---|---|---|
| 0,89 kg (SAP, lido como kg) | 0,338 kg | 1,25 |
| 1,2 kg (OB) | 0,648 kg | 2,39 |
| Faixa de 4 SKUs de embalagem parecida (12034103, 12144012, 12142501, 20908885) | — | 1,08 a 1,46 |

O candidato de 0,89 kg cai dentro da faixa; o de 1,2 kg fica 64% acima do maior valor observado. O teste é indireto e a amostra é pequena, então **não é prova**: serve para orientar a pergunta Q9. Mantém-se 1,2 kg (decisão do time e escolha conservadora para o limite de peso), com os dois valores visíveis.

---

## F. Ambiente técnico

| Item | Verificação |
|---|---|
| Docker | A CLI está instalada (v29.6.2), mas o daemon está desligado: `docker info` falha |
| PGlite 0.5.9 (Apache-2.0) | PostgreSQL 18.6 em WebAssembly. Passou em `pg_trgm`, `btree_gist` com `EXCLUDE`, trigger de imutabilidade, `jsonb` e persistência em disco (38,6 MB; 4,7 s na partida a frio) |
| PGlite: transação | Conexão única. Com `BEGIN`/`COMMIT` manual intercalado, a requisição A (INSERT, depois ROLLBACK) e a B (INSERT e COMMIT) deixaram **as duas linhas gravadas**; o COMMIT da B confirmou o INSERT da A. Com `db.transaction()` ficou só a linha da B |
| PGlite: coluna gerada | Sem `STORED`, o PG 18 cria coluna virtual (`attgenerated = 'v'`); com `STORED`, `'s'` |
| PGlite: `SKIP LOCKED` | Executa sem erro, mas com uma conexão não prova concorrência |
| `pg_trgm` | "café tradicional vacio 250g 20 un" contra a descrição SAP abreviada: 0,31 (0,37 sem acento); contra a descrição es da OB: 0,63 (0,72 sem acento) |
| SheetJS | CVE-2023-30533 (prototype pollution, versões até 0.19.2) e CVE-2024-22363 (ReDoS, antes de 0.20.2). O pacote `xlsx` do npm está em 0.18.5 (última versão publicada) |
| ExcelJS | 4.4.0, licença MIT; dependências não auditadas |
| Bedrock, São Paulo | Claude Haiku 4.5 e Sonnet 4.5: In-Region não, Geo não, Global sim. Haiku 4.5: Active, lançado em 16/10/2025, fim de vida "não antes de 16/10/2026" (data ainda N/A). Sonnet 4.5: Legacy, fim de vida em 08/04/2027. Pela documentação de ciclo de vida do Bedrock, num modelo Legacy clientes novos não podem adotá-lo e os existentes podem perder o acesso após 15 dias de inatividade |
| Aurora Data API, São Paulo | Suportado no PostgreSQL 13.11, 14.8, 15.3, 16.1 e 17.4 ou superiores. Limitações da documentação: resposta de no máximo 1 MiB (a chamada é encerrada se passar), execução só na instância de escrita, sem suporte a classes de instância T, e `scram-sha-256` obrigatório do PostgreSQL 14 em diante |
| Aurora Data API, tempos | Documentação de `BeginTransaction`: transação desfeita após 3 minutos sem chamadas com o seu ID e duração máxima de 1 hora. Documentação de timeouts: cada chamada é cancelada aos 45 s, salvo `continueAfterTimeout`; recomenda-se timeout do SDK de pelo menos 1 minuto |
| Aurora, extensões | Lista de extensões do Aurora PostgreSQL (consultada em 13/10/2026): `pg_trgm` 1.6 e `btree_gist` 1.6 em todas as versões 16.1 a 16.15, 17.4 a 17.11 e 18.3 a 18.6. Não testado num cluster |

---

## G. Limites do que foi verificado

**O que o script lê direto das fontes:** os totais da Order Basis nas células `ORDEM!X2`, `W2`, `Y2`, `X4`, `Y4` e `W4`; o cadastro da caixa, o lastro e os preços dos três exports SAP; as abas PROD, TAB, PALETIZAÇÃO e AUX da OB; e os quatro JSON. As 20 divergências foram recalculadas das abas por uma implementação separada da do piloto, e o total coincide. A seção 8 executa o `calc()` do piloto (`motor_piloto_harness.js`) e compara com o Python.

**O que o script não prova:**
- **Reprodutibilidade, não correção de negócio.** Os valores esperados foram fixados depois de ver execuções anteriores. Por isso a comparação com o motor do piloto, que é código de outra pessoa, é a checagem de maior independência.
- **Algumas checagens são aritmética literal**, sem leitura de fonte: 115,4% (30 ÷ 26), a altura do pallet padrão (12 × 159 mm + 150 mm), o 60 ÷ 11 da aba TAB e as razões US$/kg com pesos e preços já fixados. Servem para documentar a conta, não para testar os dados. (A ocupação da base com lastro 4 e 14 passou a ser calculada das medidas da Conferência.)
- **Não cobertos pelo script:** os testes de PGlite e de trigramas, a vulnerabilidade do SheetJS, o ciclo de vida dos modelos, os limites e tempos do Data API e as extensões do Aurora (verificados na documentação ou por execução avulsa, descritos em F).
- **Fora do alcance de qualquer script:** posições de pallet (vêm do artefato e o time confirmou que estão corretas, mas não constam nos arquivos do desafio nem foram validadas pela logística), piso dos veículos (premissa de posições × 1,2 m²), tara do pallet (25 kg), altura interna máxima (2,393 m, contêiner ISO), a ordem de prioridade do upsell, a procedência dos 3 preços (site da 3corações, informação do time) e as caixas por pallet adotadas na Q12 (o script confere que respeitam a regra da heurística, não que a logística as confirma).
- **Não verificado:** dependências do ExcelJS; desempenho e taxa de reconhecimento da ingestão por IA (a meta de 95% é meta, não medição); comportamento do piloto em navegadores diferentes; as extensões do Aurora num cluster real.
- **Demo original no claude.ai.** Não consegui abrir o link (exige login). O time informou que o repositório é idêntico ao artefato, e foi isso que usei.
- **O teste indireto do peso do stick** compara com 4 SKUs de embalagem parecida; o critério de "parecida" é discutível (inclui o porta-filtro plástico e exclui cinco SKUs com 0,02 a 0,41 kg/m²). A conclusão se mantém porque 2,39 kg/m² fica acima de todos os 9 outros SKUs, mas é um indício.
