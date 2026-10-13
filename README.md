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

O leitor de planilhas (SheetJS) está na pasta `vendor`, então a importação do SAP funciona mesmo sem internet. Só as fontes vêm do Google Fonts; sem internet, o navegador usa uma fonte parecida.

Os dados ficam na memória do navegador durante a demonstração. Recarregar a página volta tudo ao estado inicial.

---

## Roteiro sugerido de demonstração

1. **Tela de entrada:** escolha **Área do cliente** (Martín, distribuidor da MINOIL S.A.).
2. Digite quantidades no catálogo e veja a carreta encher. Use o aviso *"faltam 24 cx para fechar o 4º pallet"* e o botão **Aplicar** da sugestão.
3. No Café Estrada Real, escolha **UN** e digite **1010**: aparece *"Não fecha caixa"* com as opções de arredondamento.
4. **Revisar pedido → Confirmar** e depois **Ver no painel 3corações**.
5. No painel, abra o pedido **3CC-2026-0001** (o pedido teste da Order Basis): a planilha marcava "OK", mas são **30 pallets para 28 posições**. O pedido não cabe.
6. Ajuste uma quantidade (fica registrado na trilha de auditoria), aprove e gere o **arquivo para o SAP**.
7. Em **Produtos e regras**, arraste as planilhas Conferência de produtos, Materiais e Registros (estão em `pre-solucao/pedidos-sem-fronteiras/`) para mostrar a importação do SAP com os alertas de qualidade.

---

## Como a solução responde às cinco dores

| Etapa | Dor hoje | Resposta do 3C Conecta |
|---|---|---|
| 1. Monta | Pedido por e-mail, planilha diferente a cada envio | Portal com catálogo, preço da lista do cliente, busca, filtros, PT e ES |
| 2. Valida | Conferência manual de quantidades, múltiplos e restrições | Validação a cada digitação: múltiplo de caixa, lote mínimo, restrição por destino. A confirmação fica travada enquanto houver erro |
| 3. Calcula a carga | Cubagem e paletização à mão, erros de ocupação | Peso, cubagem, pallets e posições ao vivo, desenho do veículo, alerta de excesso e de carga incompleta, sugestões automáticas |
| 4. Confirma | Distribuidor não sabe como ficará o pedido | Tela de revisão com resumo completo, confirmação e acompanhamento em "Meus pedidos" |
| 5. Recebe pronto | Redigitação item a item, sem registro | Fila validada no painel, trilha de auditoria, arquivo de importação para o SAP |

O item extra pedido no desafio, *"importar o restante dos produtos e exportar o pedido no mesmo padrão"*, também está implementado: importação das extrações do SAP e exportação do pedido em CSV.

---

## Funcionalidades

### Área do cliente (distribuidor)
* Catálogo com fotos e preço da lista do cliente
* **Ficha técnica** de cada produto com todos os campos da Order Basis: código 3C, produto, família, preço, unidades por embalagem, EAN, DUN, peso bruto, peso líquido, cubagem, C × L × A, NCM, linha e caixas por pallet
* Pedido em **caixas, unidades ou quilos**, com conversão e aviso quando não fecha caixa
* Montagem do pallet de cada produto (medidas da caixa, caixas por camada × camadas)
* Painel de embarque: carreta, contêiner 40' e 20', carga paletizada ou estivada, pallet misto opcional
* Status da carga (completa, incompleta ou excesso), barras de posições, peso e cubagem
* Sugestões: fechar pallet, completar o veículo, reduzir excesso
* Revisão, confirmação e acompanhamento com jornada em 5 etapas
* Indicadores do cliente: pedidos em andamento, ocupação média, comprado no ano, aprovados sem ajuste
* Português, espanhol e inglês, modo claro e escuro

### Painel 3corações (Exportação)
* Fila de pedidos validados, com jornada completa em 8 etapas e responsável por etapa
* Ajuste de quantidades com **trilha de auditoria** (quem, o quê, quando)
* Aprovação e geração do **arquivo de importação para o SAP** e do **pedido completo no padrão Order Basis** (copiar ou baixar CSV)
* Indicadores de operação (fila, tempo de aprovação, certos na primeira, ocupação) e de gestão (receita, volume, países e clientes ativos)
* Clientes e tabela de preços por lista
* **Importação do SAP**: lê Conferência de produtos, Materiais e Registros, mostra prévia (novos, alterados, alertas) e atualiza o catálogo após confirmação
* **Ficha técnica completa dos produtos** (padrão Order Basis) com troca de foto
* Base de dados com as divergências entre as planilhas, regras e premissas

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
* **Status da carga**: acima de 100% é excesso; a partir de 90% é carga completa; abaixo de 90% é carga incompleta
* **Pedido em UN ou KG**: convertido para caixas (UN pelas unidades por caixa; KG pelo peso líquido da caixa). Se não fecha caixa inteira, o pedido fica bloqueado até o cliente escolher o arredondamento
* **Bloqueios**: abaixo do lote mínimo, caixa quebrada, produto não liberado para o destino, produto sem preço ou excesso de carga impedem a confirmação
* **Carga estivada**: sem pallets, a ocupação considera peso e cubagem

| Veículo | Cubagem | Peso | Posições de pallet |
|---|---|---|---|
| Carreta | 72 m³ | 25.000 kg | 28 |
| Contêiner 40' | 60,84 m³ | 25.000 kg | 20 |
| Contêiner 20' | 29,7 m³ | 25.000 kg | 10 |

---

## Premissas assumidas (a validar com a 3corações)

* **Posições de pallet** por veículo (28, 20 e 10), considerando pallet PBR de 1,20 × 1,00 m. Cubagem e peso vêm da Order Basis.
* **Carga completa a partir de 90%** do recurso limitante.
* **UN** é a menor unidade de venda (sachê, stick, pote, pacote). **KG** usa o peso líquido.
* **Layout do arquivo para o SAP** é sugerido pela equipe, até recebermos o layout oficial de importação.
* **Peso máximo por pallet** não foi aplicado; o pallet mais pesado do recorte tem cerca de 895 kg.
* **Stick de solúvel (12147801)**: o SAP traz o peso bruto da caixa em gramas trocadas (menor que o peso líquido). Mantivemos 1,2 kg por caixa, valor da Order Basis.
* **Filtro de papel (12037417)**: lote mínimo de 2 pallets, linha da filial LONT com a descrição "RED DES".
* **Cliente demo** (Distribuidora Río Claro, Argentina): fictício, com lista de preço AR simulada (lista US × 1,06) e o porta filtro bloqueado como exemplo de restrição por destino.
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

## Tecnologia

* HTML, CSS e JavaScript, sem framework e sem servidor, em um único arquivo (`index.html`)
* [SheetJS Community Edition 0.18.5](https://sheetjs.com) para leitura das planilhas (licença Apache 2.0, em `vendor/`)
* Fonte Jost (Google Fonts)
* Identidade visual inspirada no Mercafé, loja oficial da 3corações

## Fotos dos produtos

As fotos ficam em `assets/produtos/`, com o **código SAP** como nome do arquivo (por exemplo `12031189.jpg`). A plataforma procura a foto nessa pasta ao abrir: para incluir ou trocar uma foto, basta enviar o arquivo com o nome certo, sem mexer no código. A lista do que já temos e do que falta está em [`assets/produtos/README.md`](assets/produtos/README.md).

## Estrutura do repositório

```
index.html                 Plataforma completa (dados, regras e interface)
vendor/xlsx.full.min.js    Leitor de planilhas (SheetJS)
vendor/LICENSE-sheetjs.txt Licença do SheetJS
assets/produtos/           Fotos dos produtos (nome do arquivo = código SAP)
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
