# 3C Conecta

**Plataforma de pedidos de exportação da 3corações**
Protótipo do Hackathon Cafeína Week 2026 (FIAP) · Desafio 02 · Pedido sem Fronteiras

O distribuidor monta o pedido vendo produtos, pallets e a ocupação do veículo em tempo real. A equipe de Exportação recebe o pedido já validado, pronto para importar no SAP, sem digitar nada e com registro de cada alteração.

> Pergunta-guia do desafio: *Como criar uma jornada de pedido de exportação em que o distribuidor monte seu pedido vendo produtos, pallets e ocupação do contêiner, e a equipe de Exportação o receba pronto, sem retrabalho?*

---

## Como rodar

Não precisa instalar nada.

1. Baixe ou clone este repositório.
2. Abra o arquivo `index.html` no navegador (Chrome, Edge ou Firefox).

Para publicar com um link, ative o GitHub Pages em **Settings → Pages → Branch: main / root**.

O leitor de planilhas (SheetJS) e o motor 3D (Three.js) estão na pasta `vendor`, então a importação do SAP e a visão 3D funcionam mesmo sem internet. Só as fontes vêm do Google Fonts; sem internet, o navegador usa uma fonte parecida. Se o navegador não tiver WebGL, a plataforma mostra o desenho 2D do veículo.

Pedidos, carrinho e regras ficam salvos no navegador, então o estado sobrevive a um recarregamento. Para voltar aos dados iniciais antes de uma apresentação, use **Restaurar dados** no menu do painel 3corações ou abra a página com `#reset` no fim do endereço.

---

## Roteiro sugerido de demonstração

1. **Tela de acesso:** escolha **Sou cliente**. A plataforma entra como Martín, da MINOIL S.A.; o nome só aparece depois do acesso. A tela **Início** mostra o pedido sugerido pelo histórico, os alertas do rascunho (lote mínimo, carga incompleta) e insights de ocupação. Clique em **Completar carga** no alerta ou em **Usar pedido sugerido**.
   * Opcional: clique em **Importar planilha**, depois em **Usar exemplo** e em **Substituir pedido**. O pedido do Excel vira carrinho, com código 3C, EAN e quantidade em unidades convertida para caixas.
   * Clique em **Fale com a Xica** (canto inferior direito) e pergunte, por exemplo, *"Como completo a carga?"* ou *"Adicione 2 pallets de Cappuccino Baunilha"*. O assistente responde com os dados da conta e ajusta o rascunho.
2. Digite quantidades no catálogo e veja os pallets caírem na carreta em 3D. Gire com o mouse, troque para contêiner 40' ou 20' e use **Ampliar** para ver o plano de carga em tela cheia. Use o aviso *"faltam 24 cx para fechar o 4º pallet"* e o botão **Aplicar** da sugestão.
3. No Café Estrada Real, escolha **UN** e digite **1010**: aparece *"Não fecha caixa"* com as opções de arredondamento.
4. **Revisar pedido → Confirmar**. Saia (ícone ao lado do nome) e entre como **Sou colaborador 3corações**.
5. No painel, abra o pedido **3CC-2026-0001** (o pedido teste da Order Basis): a planilha marcava "OK", mas são **30 pallets para 28 posições**. No plano de carga 3D, os 2 pallets que sobram aparecem fora da carreta, em vermelho.
6. Ajuste uma quantidade (fica registrado na trilha de auditoria), aprove e gere o **arquivo para o SAP**.
7. Em **Clientes e preços**, ligue **pallet misto** para a MINOIL e volte ao portal: as sobras passam a dividir pallets e o pedido teste cai de 30 para 29 posições.
8. Em **Parâmetros → Veículos**, mude a carreta de 28 para 30 posições: antes de salvar, a barra de impacto mostra que o pedido teste passa de excesso para carga completa. Salve e veja o histórico. Em **Regras do negócio**, troque o lote mínimo para "Só alerta"; em **Produtos**, ajuste lastro e camadas; em **Restrições por destino**, bloqueie um produto para um cliente.
9. Em **Catálogo e dados**, arraste as planilhas Conferência de produtos, Materiais e Registros (estão em `pre-solucao/pedidos-sem-fronteiras/`) para mostrar a importação do SAP com os alertas de qualidade.

---

## Como a solução responde às cinco dores

| Etapa | Dor hoje | Resposta do 3C Conecta |
|---|---|---|
| 1. Monta | Pedido por e-mail, planilha diferente a cada envio | Portal com catálogo, preço da lista do cliente, busca, filtros, PT e ES |
| 2. Valida | Conferência manual de quantidades, múltiplos e restrições | Validação a cada digitação: múltiplo de caixa, lote mínimo, restrição por destino. A confirmação fica travada enquanto houver erro |
| 3. Calcula a carga | Cubagem e paletização à mão, erros de ocupação | Peso, cubagem, pallets e posições ao vivo, veículo em 3D com os pallets do pedido (os que não cabem ficam do lado de fora), alerta de excesso e de carga incompleta, sugestões automáticas |
| 4. Confirma | Distribuidor não sabe como ficará o pedido | Tela de revisão com resumo completo, confirmação e acompanhamento em "Meus pedidos" |
| 5. Recebe pronto | Redigitação item a item, sem registro | Fila validada no painel, trilha de auditoria, arquivo de importação para o SAP |

O item extra pedido no desafio, *"importar o restante dos produtos e exportar o pedido no mesmo padrão"*, também está implementado: importação das extrações do SAP e exportação do pedido em CSV.

---

## Funcionalidades

### Área do cliente (distribuidor)
* **Início** em três blocos: **A Xica sugere** (pedido sugerido pelo histórico, em pallets fechados e dentro de peso, cubagem e lote mínimo, junto com as dicas da Xica), **Pedidos em andamento** (rascunhos e pedidos aguardando a 3corações, cada um com seus alertas; ao clicar, abre com detalhes e ações) e **Pedidos recentes** (últimos 3 aprovados, com Repetir pedido e detalhes ao clicar)
* **Assistente de carga** no painel de embarque: completar carga mantendo o mix, fechar pallets, usar o veículo recomendado, reduzir excesso, com explicação do recurso que limita a carga e do ganho de frete por pallet
* Catálogo com fotos e preço da lista do cliente
* **Ficha técnica** de cada produto com todos os campos da Order Basis: código 3C, produto, família, preço, unidades por embalagem, EAN, DUN, peso bruto, peso líquido, cubagem, C × L × A, NCM, linha e caixas por pallet
* Pedido em **caixas, unidades ou quilos**, com conversão e aviso quando não fecha caixa
* Montagem do pallet de cada produto (medidas da caixa, caixas por camada × camadas)
* Painel de embarque: carreta, contêiner 40' e 20', carga paletizada ou estivada
* **Visão 3D da carga**: cada caixa e cada pallet do pedido dentro do veículo, com animação ao adicionar, vistas em perspectiva, lateral e de cima, e pallets excedentes do lado de fora em vermelho
* Regra de pallet misto vem do cadastro do cliente (definida pela 3corações)
* Status da carga (completa, incompleta ou excesso), barras de posições, peso e cubagem
* Sugestões: fechar pallet, completar o veículo, reduzir excesso
* **Recomendação de veículo**: compara carreta, contêiner 40' e 20' com a ocupação de cada um e marca o mais bem aproveitado
* **Divisão em embarques**: quando o pedido não cabe em um veículo, o sistema propõe a divisão (ex.: carreta 100% + contêiner 20' 20%)
* **Importar pedido do Excel**: colar linhas ou enviar a planilha que o distribuidor já usa; reconhece código 3C, EAN ou DUN e quantidade em caixas, unidades ou quilos, com prévia antes de aplicar. Lê o cabeçalho da planilha (código, caixas ou quantidade, unidade) e escolhe a aba certa: enviando a própria `ORDEN BASIS TESTE.xlsm`, o pedido teste entra sozinho (aba ORDEM, coluna CAIXAS)
* **Xica, a assistente (chat)**, mascote do 3C Conecta, em todas as telas do cliente, em PT, ES e EN: caixas por pallet, lote mínimo, preço, veículo mais adequado, como completar a carga, prazo mínimo, status dos pedidos, importação do Excel e condições da conta, sempre com os dados reais da conta. Também ajusta o rascunho por texto (*"adicione 2 pallets de Café Tradicional"*, *"remova o filtro"*) e oferece botões de ação (completar carga, trocar veículo, abrir o plano 3D, revisar pedido). Publicado no claude.ai, as perguntas digitadas são respondidas pelo Claude com o contexto da conta e ferramentas para consultar e ajustar o rascunho (o visitante autoriza no primeiro uso); no GitHub Pages ou sem autorização, um motor de respostas embutido responde na hora
* **Vários rascunhos por cliente**: criar, nomear, continuar, completar a carga e excluir (com confirmação); o rascunho enviado vira pedido e sai da lista; seletor de rascunho na tela Novo pedido; tudo salvo automaticamente
* **Meus pedidos** em lista: rascunhos e pedidos enviados; ao clicar, abre como está (alertas do rascunho) ou como foi (itens, etapas, veículo, datas e ajustes da Exportação), com **Repetir pedido**
* Revisão com a lista exata do que impede a confirmação, prazo mínimo de carregamento e proteção contra envio duplicado
* Acompanhamento com jornada em 5 etapas e aviso quando a Exportação ajusta algum item
* Indicadores do cliente: pedidos em andamento, ocupação média, comprado no ano, aprovados sem ajuste
* Português, espanhol e inglês, modo claro e escuro

### Painel 3corações (Exportação)
* **Xica no painel**: resumo da fila, pedidos bloqueados e parados, pedido por número, simulação de parâmetros (*"o que muda se a carreta tiver 30 posições?"*, com botão que leva a mudança para Parâmetros), insights, clientes, produtos e qualidade de dados
* Faixa **Atenção agora**: pedidos bloqueados, aguardando além do limite configurado (padrão 4 horas), cargas incompletas e qualidade de dados, cada um como atalho de filtro
* **Aprovação automática** por cliente: pedido sem bloqueio e com carga completa entra aprovado, sem fila, com registro da regra na auditoria
* Fila de pedidos validados com busca e filtro por status, jornada completa em 8 etapas e responsável por etapa
* **Plano de carga 3D** de cada pedido, ao lado de posições, peso, cubagem e alertas
* Ajuste de quantidades com **trilha de auditoria** (quem, o quê, quando)
* Aprovação e geração do **arquivo de importação para o SAP** e do **pedido completo no padrão Order Basis** (copiar ou baixar CSV)
* Indicadores de operação na fila (aguardando, tempo de aprovação, certos na primeira, ocupação)
* Aba **Indicadores** com **insights automáticos** (divisão de embarques, veículo mais adequado, cargas incompletas, concentração por família, potencial de aprovação automática) e os indicadores de operação e gestão: receita, volume, países e clientes ativos, ocupação por pedido, volume por família e pedidos por etapa
* Clientes e tabela de preços por lista, com a regra de **pallet misto** por cliente e histórico de alterações
* **Importação do SAP**: lê Conferência de produtos, Materiais e Registros, mostra prévia (novos, alterados, alertas) e atualiza o catálogo após confirmação
* **Ficha técnica completa dos produtos** (padrão Order Basis) com troca de foto
* **Catálogo e dados**: divergências entre as planilhas e resumo dos veículos e regras em vigor
* **Parâmetros do negócio**, em cinco abas:
  * **Regras do negócio**: carga completa a partir de X%, prazo mínimo de carregamento, alerta de pedido parado na fila, lote mínimo e pallet incompleto (bloqueia o envio ou só alerta), pallet misto e aprovação automática por cliente
  * **Veículos**: posições de pallet, peso máximo, cubagem, nome em PT, ES e EN, disponível ou fora de uso, cadastro de veículos novos (truck, bitrem, contêiner high cube), que entram no seletor do cliente, na recomendação, na divisão em embarques e no plano 3D
  * **Produtos**: lastro, camadas (caixas por pallet recalculadas na hora), lote mínimo, peso bruto por caixa e produto ativo ou fora de linha
  * **Restrições por destino**: matriz produto × cliente para liberar ou bloquear
  * **Histórico**: quem mudou o quê e quando
  * Edição em rascunho com validação campo a campo, **barra de impacto** antes de salvar (quais pedidos em análise mudam de status) e **Restaurar padrão** por aba. Pedidos já aprovados guardam a capacidade do veículo da data de aprovação

---

## Dados utilizados

Todos os dados vêm das planilhas fornecidas no desafio.

| Dado | Fonte |
|---|---|
| Caixas por pallet | Materiais (lastro × altura) |
| Unidades por caixa, peso líquido e bruto da caixa, volume, medidas, validade, linha | Conferência de produtos (linha da unidade CX) |
| EAN, DUN e NCM | Order Basis (aba ORDEM) |
| Fotos de 5 produtos | Material oficial do desafio (as demais podem ser enviadas no painel) |
| Nomes em inglês e espanhol | Order Basis (aba AUX) |
| Preço por caixa | Registros (lista US, EXP-MINOIL, vigente) |
| Preço dos 3 produtos sem preço no SAP | Order Basis (valor digitado) |
| Lote mínimo em pallets | Order Basis, aba PALETIZAÇÃO, filial LONT |
| Cliente (código, moeda, Incoterm, pagamento, lista) | Order Basis, aba DADOS CLIENTES |
| Capacidade dos veículos e limite de peso | Order Basis, aba AUX |

Produtos do recorte: 10 materiais das marcas 3corações e Iguaçu (cafés, cappuccinos, solúveis, filtro e porta filtro), centro 2612 (CD Londrina).

---

## Regras de cálculo

* **Caixas por pallet** = lastro × altura
* **Pallets** = caixas ÷ caixas por pallet
* **Peso líquido e bruto** = caixas × peso da caixa
* **Cubagem** = caixas × volume da caixa
* **Valor** = caixas × preço da lista do cliente
* **Posições de pallet**: sem pallet misto, cada pallet incompleto ocupa uma posição inteira; com pallet misto, as sobras de produtos diferentes dividem posições
* **Recurso limitante** = o maior entre peso ÷ limite, cubagem ÷ capacidade e posições ÷ capacidade
* **Status da carga**: acima de 100% é excesso; a partir de 90% é carga completa; abaixo de 90% é carga incompleta (o limite de 90% é ajustável em Parâmetros)
* **Pedido em UN ou KG**: convertido para caixas (UN pelas unidades por caixa; KG pelo peso líquido da caixa). Se não fecha caixa inteira, o pedido fica bloqueado até o cliente escolher o arredondamento
* **Bloqueios**: abaixo do lote mínimo, caixa quebrada, produto não liberado para o destino, produto sem preço, produto fora de linha ou excesso de carga impedem a confirmação. Lote mínimo e pallet incompleto podem ser configurados para bloquear ou só alertar
* **Carga estivada**: sem pallets, a ocupação considera peso e cubagem

| Veículo | Cubagem | Peso | Posições de pallet |
|---|---|---|---|
| Carreta | 72 m³ | 25.000 kg | 28 |
| Contêiner 40' | 60,84 m³ | 25.000 kg | 20 |
| Contêiner 20' | 29,7 m³ | 25.000 kg | 10 |

Valores de fábrica. A Exportação ajusta capacidades e cadastra veículos novos em **Parâmetros**.

---

## Premissas assumidas (a validar com a 3corações)

* **Posições de pallet** por veículo (28, 20 e 10), considerando pallet PBR de 1,20 × 1,00 m. Cubagem e peso vêm da Order Basis.
* **Carga completa a partir de 90%** do recurso limitante.
* **UN** é a menor unidade de venda (sachê, stick, pote, pacote). **KG** usa o peso líquido.
* **Layout do arquivo para o SAP** é sugerido pela equipe, até recebermos o layout oficial de importação.
* **Peso máximo por pallet** não foi aplicado; o pallet mais pesado do recorte tem cerca de 895 kg.
* **Stick de solúvel (12147801)**: o SAP traz o peso bruto da caixa em gramas trocadas (menor que o peso líquido). Mantivemos 1,2 kg por caixa, valor da Order Basis.
* **Filtro de papel (12037417)**: lote mínimo de 2 pallets, linha da filial LONT com a descrição "RED DES".
* **Distribuidora Río Claro** (Argentina): cliente fictício, com lista de preço AR simulada (lista US × 1,06) e o porta filtro bloqueado como exemplo de restrição por destino.
* **Carga estivada**: cálculo simplificado por cubagem total.

---

## Divergências encontradas nas planilhas

Cruzando as quatro planilhas, encontramos **20 divergências** entre a Order Basis e as extrações do SAP:

| Tipo | Quantidade | Exemplos |
|---|---|---|
| Caixas por pallet (Order Basis × SAP) | 2 | Cappuccino Baunilha pote: 98 × 28. Porta filtro: 60 × 110 |
| Caixas por pallet (aba PALETIZAÇÃO × SAP) | 6 | Refil 40 g: 240 × 280. Cappuccino Iguaçu: 20,9 × 209 |
| Preço | 4 | Solúvel vidro: 50,01 × 50,27. Três produtos sem preço no SAP |
| Lote mínimo | 2 | Cappuccino Iguaçu: a planilha usa 3,12 (filial BHO) para pedido de Londrina, que é 1 |
| Peso bruto por caixa | 6 | Stick de solúvel: 11,52 kg na Order Basis × 1,2 kg real |

Outros pontos observados:
* A Order Basis calcula o peso bruto multiplicando o peso da unidade pela quantidade por caixa, sem considerar a caixa de papelão. No stick, a unidade cadastrada é o display de 10, o que multiplica o peso quase por 10.
* A busca do lote mínimo pega o primeiro valor encontrado (filial BHO), mesmo quando o pedido sai de Londrina.
* A validação do embarque confere só peso e cubagem. O pedido teste da própria Order Basis aparece como "OK", mas forma 30 pallets para 28 posições na carreta.

Proposta: o SAP passa a ser a **fonte única** dos dados, e a Exportação só confirma as exceções.

---

## Arquivo de importação para o SAP

Layout sugerido (CSV separado por ponto e vírgula, UTF-8):

```
PEDIDO_PORTAL;COD_CLIENTE;REF_CLIENTE;CANAL;CENTRO;LISTA_PRECO;MATERIAL;DESCRICAO_SAP;QTD;UM;PRECO_UNIT;MOEDA;VALOR_TOTAL;INCOTERM;COND_PAGTO;DATA_CARREGAMENTO
```

O layout é uma configuração: na POC ele é substituído pelo layout oficial de importação da 3corações, sem mudar a lógica do sistema.

---

## Arquitetura e contrato de API (visão de backend)

O protótipo roda inteiro no navegador, mas o código já está separado como uma aplicação real: **motor de cálculo**, **camada de dados** no formato da API e **telas**. Na POC, a camada de dados vira um serviço; as telas não mudam.

### Princípios

* **O servidor é a fonte da verdade.** O navegador calcula para dar resposta imediata, mas o servidor recalcula preço, pallets, ocupação e bloqueios com o mesmo motor antes de gravar. Um pedido adulterado no navegador é recusado.
* **Mesmo motor nos dois lados.** O cálculo (`calc`) é uma função pura, sem acesso à tela. Na POC, ela vira um pacote compartilhado entre o portal e a API.
* **Regras em configuração, não no código.** Capacidade dos veículos, carga completa a partir de 90%, prazo mínimo de carregamento, lote mínimo por filial, restrição por destino e pallet misto por cliente são dados.
* **Tudo auditável.** Cada mudança registra quem, o quê, quando e a versão do pedido.

### Máquina de status do pedido

```
em análise ──aprovar──▶ aprovado ──gerar arquivo──▶ arquivo SAP gerado
     │                                                  │
     └─ ajustes da Exportação (versão +1, auditoria)    └─ pode gerar o arquivo de novo
```

Transições fora dessa ordem são recusadas (HTTP 409). Só pedidos em análise aceitam ajuste de quantidade. Aprovar exige zero bloqueios.

### Endpoints da POC

| Método | Rota | O que faz | Erros |
|---|---|---|---|
| GET | `/api/v1/catalog?client=:id` | Catálogo com preço da lista do cliente e restrições do destino | 403 cliente de outro usuário |
| POST | `/api/v1/orders/quote` | Calcula pallets, posições, peso, cubagem e bloqueios sem gravar | 422 dados inválidos |
| POST | `/api/v1/orders` | Cria o pedido. Cabeçalho `Idempotency-Key` evita pedido duplicado por duplo clique ou rede instável | 422 bloqueios, data antes do prazo mínimo |
| GET | `/api/v1/orders?status=&q=` | Fila da Exportação com filtro e busca | |
| GET | `/api/v1/orders/:id` | Pedido com itens, versão e auditoria | 404 |
| PATCH | `/api/v1/orders/:id/items/:material` | Ajuste de quantidade pela Exportação (versão +1) | 409 pedido fora de análise |
| POST | `/api/v1/orders/:id/approve` | Aprova o pedido | 409 bloqueios ou status errado |
| POST | `/api/v1/orders/:id/sap-export?layout=sap\|ob` | Gera o arquivo de importação do SAP ou o pedido no padrão Order Basis | 409 pedido não aprovado |
| PUT | `/api/v1/clients/:id/rules` | Regras do cliente (pallet misto, aprovação automática) | 400 regra desconhecida |
| GET | `/api/v1/settings` | Regras, veículos, paletização dos produtos e restrições em vigor | |
| PATCH | `/api/v1/settings` | Lote de alterações `{caminho: valor}`, validado por inteiro antes de aplicar (tudo ou nada), com registro no histórico | 422 valor fora da faixa, nenhum veículo disponível |
| POST | `/api/v1/settings/vehicles` | Cadastra veículo | 422 nome repetido ou capacidade inválida |
| DELETE | `/api/v1/settings/vehicles/:id` | Exclui veículo cadastrado pela Exportação | 409 veículo padrão ou usado em pedidos |
| POST | `/api/v1/settings/reset` | Volta uma aba (ou tudo) aos valores de fábrica | |
| POST | `/api/v1/imports/sap` | Recebe as extrações Conferência, Materiais e Registros e devolve a prévia com alertas | 422 arquivo não reconhecido |
| POST | `/api/v1/imports/sap/:id/apply` | Aplica a prévia ao catálogo | |

Exemplo de criação de pedido:

```json
POST /api/v1/orders
Idempotency-Key: d8k2f1x9

{
  "client": "11131",
  "vehicle": "carreta",
  "mode": "pal",
  "loadingDate": "2026-11-03",
  "reference": "OC-2026-118",
  "items": [
    { "material": "12031189", "boxes": 1680 },
    { "material": "12034109", "boxes": 84 }
  ]
}
```

Exemplo de alteração de parâmetros (a tela mostra o impacto antes de enviar):

```json
PATCH /api/v1/settings
{
  "veh.carreta.pos": 30,
  "rules.fullAt": 0.92,
  "prod.12031189.lastro": 15,
  "block.rioclaro.20908885": true
}
```

Resposta de pedido com bloqueio (o portal mostra a mesma lista antes do envio):

```json
422 Unprocessable Entity
{
  "error": "Pedido com bloqueios",
  "details": [
    { "code": "BELOWMIN", "material": "12142501" },
    { "code": "CAPACITY", "over": { "pos": 2, "kg": 0, "m3": 0 } }
  ]
}
```

No protótipo, cada endpoint está no objeto `API` do `index.html`, com o mesmo nome, as mesmas validações e os mesmos erros.

### Modelo de dados

| Tabela | Campos principais |
|---|---|
| `clientes` | código SAP, nome, destino, moeda, Incoterm, condição de pagamento, lista de preço, filial, aceita pallet misto |
| `materiais` | código, descrição SAP, família, marca, unidades por caixa, pesos e medidas da caixa, lastro, altura, EAN, DUN, NCM, linha, validade |
| `precos` | material, lista, preço, vigência (de, até) |
| `lote_minimo` | material, filial, pallets |
| `restricoes_destino` | material, país ou cliente, motivo |
| `veiculos` | tipo, nomes por idioma, cubagem, peso máximo, posições de pallet, disponível |
| `parametros` | regra, valor, vigência, usuário que alterou (carga completa, prazo mínimo, alerta de fila, lote mínimo e pallet incompleto bloqueiam ou alertam) |
| `pedidos` | número, cliente, veículo, capacidade do veículo na aprovação, modo, regra de pallet misto na data do envio, referência, data de carregamento, status, versão, chave de idempotência |
| `itens_pedido` | pedido, material, caixas, preço aplicado |
| `auditoria` | pedido, data e hora, usuário, ação, valor anterior, valor novo |
| `importacoes` | arquivos, usuário, data, itens novos, alterados e alertas |

### Xica, a assistente com IA

<img src="assets/mascote/xica_feliz.svg" alt="Xica, a mascote do 3C Conecta" width="140" align="right">

A Xica é a mascote do 3C Conecta: uma xícara 3C cujo vapor muda com a mensagem (coração para ajudar, pontinhos enquanto pensa, exclamação nos alertas e festa quando o pedido é aprovado). Ela aparece no chat, nos alertas e insights, na faixa Atenção agora, no pedido enviado e nas telas vazias, para o cliente e para a Exportação.

O chat tem dois motores. No claude.ai, a página declara a capacidade de IA do artefato e envia ao Claude a pergunta, o histórico curto da conversa e um retrato da conta (cliente, regras, veículos, catálogo com preços da lista, rascunho e pedidos). Para o cliente, o Claude pode chamar três ferramentas da página (`ajustar_item`, `completar_carga` e `trocar_veiculo`), que passam pelas mesmas validações do portal. No painel 3corações, recebe a fila com status, bloqueios e tempo de espera, e usa `simular_parametros` (só simula, não grava) e `abrir_pedido`. Ele não envia pedidos: a confirmação continua com o cliente, no botão Revisar pedido. Se a IA não estiver disponível (GitHub Pages, visitante não autorizou, limite de uso), o motor de intenções embutido responde com os mesmos dados. Na POC, o mesmo desenho roda no servidor, com a chave da API guardada no backend.

### Segurança e operação

* Login com perfis: **distribuidor** (só vê o próprio cadastro, preços e pedidos), **Exportação** (fila, ajustes, aprovação, arquivo SAP) e **administração** (parâmetros e importação).
* Integração com o SAP em duas etapas: arquivo no layout oficial de importação na POC; BAPI ou IDoc de ordem de venda no piloto.
* Arquitetura serverless na AWS: front no Amplify, API Gateway com Lambda, banco gerenciado, Cognito para login e S3 para arquivos e fotos.
* Logs e métricas por endpoint (tempo de resposta, erros de validação mais comuns), que também alimentam os indicadores da área.

### Persistência sem servidor

Sem servidor, o protótipo grava o estado no `localStorage` do navegador (pedidos, carrinho, regras, parâmetros, veículos cadastrados, catálogo importado e histórico), com versão de esquema. Se os dados-base do catálogo mudarem, o estado salvo é descartado automaticamente.

---

## Tecnologia

* HTML, CSS e JavaScript, sem framework e sem servidor, em um único arquivo (`index.html`)
* [SheetJS Community Edition 0.18.5](https://sheetjs.com) para leitura das planilhas (licença Apache 2.0, em `vendor/`)
* [Three.js r128](https://threejs.org) para a visão 3D dos veículos e da carga (licença MIT, em `vendor/`)
* Fonte Jost (Google Fonts)
* Identidade visual inspirada no Mercafé, loja oficial da 3corações

## Fotos dos produtos

As fotos ficam em `assets/produtos/`, com o **código SAP** como nome do arquivo (por exemplo `12031189.jpg`). A plataforma procura a foto nessa pasta ao abrir: para incluir ou trocar uma foto, basta enviar o arquivo com o nome certo, sem mexer no código. A lista do que já temos e do que falta está em [`assets/produtos/README.md`](assets/produtos/README.md).

## Estrutura do repositório

```
index.html                 Plataforma completa (dados, regras e interface)
vendor/xlsx.full.min.js    Leitor de planilhas (SheetJS)
vendor/LICENSE-sheetjs.txt Licença do SheetJS
vendor/three.min.js       Motor 3D (Three.js r128)
vendor/LICENSE-three.txt  Licença do Three.js
assets/produtos/           Fotos dos produtos (nome do arquivo = código SAP)
assets/mascote/            Xica, a mascote: SVGs das expressões, ícones e prévias
README.md                  Este documento
pre-solucao/               Material do desafio (apresentação e planilhas fornecidas pela 3corações)
```

---

## Próximos passos

| Fase | Escopo |
|---|---|
| **Hackathon** | 1 cliente, 10 produtos, carreta e contêineres, motor de cálculo e arquivo para o SAP |
| **POC** | 1 país, 2 ou 3 distribuidores reais, login com perfis de acesso, dados sincronizados do SAP, layout oficial de importação |
| **Piloto** | Todo o Mercosul, regras por país em configuração, integração direta com o SAP por API, indicadores da área |
| **Escala** | Novos mercados, frete marítimo, proforma e packing list automáticos, sugestão de pedido por IA e leitura de pedidos enviados por e-mail |

Arquitetura proposta para a POC: serverless na AWS (front no Amplify, API Gateway com Lambda, banco gerenciado, autenticação com Cognito e arquivos no S3).

---

## Equipe

* Bruno Rosa
* Cecília Fabre
* Guilherme Orugian
* Ruan Ruales

---

Protótipo acadêmico desenvolvido para o Hackathon Cafeína Week 2026 (FIAP), com os dados fornecidos no desafio Pedido sem Fronteiras. Não é um sistema oficial da 3corações.
