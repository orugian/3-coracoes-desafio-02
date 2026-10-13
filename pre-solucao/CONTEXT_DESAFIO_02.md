# KNOWLEDGE BASE & SYSTEM CONTEXT: HACKATHON 3 CORAÇÕES (CAFEÍNA)
## DESAFIO 02: PEDIDO SEM FRONTEIRAS (TIME DE INTERNACIONALIZAÇÃO)

---

### 1. METADADOS E ESCOPO DO PROJETO
- Empresa-Alvo: Grupo 3 Corações (Programa Cafeína).
- Área de Negócio: Time de Internacionalização / Exportação.
- Desafio: Desafio 02 – "Pedido sem Fronteiras".
- Duração do Hackathon: 27 horas (Dois dias: Dia 1 até 18:00 | Dia 2 até 16:30).
- Objetivo deste Documento: Servir de fonte primária de verdade (Single Source of Truth) para agentes de IA analisarem dores, causalidades e proporem arquiteturas e soluções de software viáveis para o hackathon e que atendam requisitos tecnicos e necessadades de negócio.

---

### 2. DECLARAÇÃO DO PROBLEMA E PERGUNTA-DESAFIO
- Cenário Geral: O café brasileiro está em franca expansão internacional, com foco principal nos países do Mercosul. Contudo, a operação interna de suporte a essas exportações ainda é suportada por fluxos manuais com trocas de e-mails, planilhas pesadas e cálculos manuais.
- Pergunta Norteadora Oficial:
  > "Como tornar a jornada de pedidos internacionais simples, confiável e sem retrabalho, da intenção de compra ao pedido validado logisticamente?"

---

### 3. MAPA DO FLUXO ATUAL (AS-IS)

O ciclo de vida de um pedido de exportação (B2B) segue 4 macroetapas lineares e manuais:

1. Etapa 01: Entrada do Pedido (Distribuidor)
   - Operação: O cliente/distribuidor internacional envia a intenção de compra por e-mail.
   - Mecânica: Os arquivos chegam em planilhas SEM padrão, variando o layout a cada envio e por distribuidor.
   - Dor Crítica: Falta absoluta de padronização na entrada de dados.

2. Etapa 02: Consolidação Interna (Time de Exportação)
   - Operação: O time interno recebe as intenções e consolida os dados.
   - Mecânica: Utilização de planilhas Excel manuais, pesadas, repletas de macros e regras de cálculo complexas.
   - Dor Crítica: Fórmulas complexas de manutenção frágil e propensas a quebra.

3. Etapa 03: Cubagem e Paletização Logística (Time de Exportação)
   - Operação: Cálculo de volume, conversão em pallets e ocupação física de veículos/contêineres.
   - Mecânica:
     - As caixas dos produtos possuem dimensões e volumes que precisam ser agrupados em pallets.
     - O distribuidor precisa validar a capacidade do frete (ex.: um caminhão suporta 40 pallets; se o pedido atual totaliza 32 pallets, o cliente precisa saber com antecedência se aproveita a capacidade ociosa para incluir mais itens antes do despacho).
     - Esse cálculo é feito à mão / por planilhas e devolvido ao cliente por e-mail para aprovação, gerando um vai-e-volta contínuo de revisões.
   - Dor Crítica: Erros de cubagem/ocupação, subaproveitamento de frete e alto retrabalho logístico.

4. Etapa 04: Registro no ERP / Sistema Corporativo (Time de Exportação)
   - Operação: Após a validação logística e aprovação comercial, os dados são inseridos no sistema corporativo.
   - Mecânica: Digitação manual, item a item, de todos os SKUs e quantidades.
   - Dor Crítica: Trabalho repetitivo, moroso e alta suscetibilidade a erros humanos de digitação.

---

### 4. VULNERABILIDADES TRANSVERSAIS (EM TODA A CADEIA)
- Dependência Humana (SPOF): O processo depende de pouquíssimas pessoas-chave com conhecimento tácito das macros e fórmulas.
- Ausência de Trilha de Auditoria (Compliance/Governance): Ninguém tem rastreabilidade sobre quem alterou valores, quando foram alterados ou por quê.
- Fricção de Comunicação: Ciclos longos de e-mail de "envia planilha -> ajusta -> devolve -> altera pedido -> recalcula cubagem".

---

### 5. MATRIZ DE CAUSA -> EFEITO (BASE PARA O MODELO DE RACIOCÍNIO)

| Etapa | Causa-Raiz | Efeito Direto no Negócio |
| :--- | :--- | :--- |
| Entrada (Distribuidor) | Layouts de planilhas heterogêneos por e-mail | Tempo gasto parseando e interpretando colunas antes de iniciar o trabalho. |
| Consolidação | Macros legadas e planilhas pesadas locais | Risco de perda de dados, lentidão operacional e dependência de especialistas no Excel. |
| Logística (Cubagem) | Falta de motor automatizado de cubagem e empilhamento | Desperdício de espaço em contêineres/caminhões, custos extras de frete e atrasos na validação. |
| Registro no Sistema | Falta de integração/ingestão automatizada para o ERP| Digitação braçal ("item por item"), tempo improdutivo e divergências de estoque/pedido. |
| Governança Geral | Dados descentralizados em caixas de entrada e pastas locais| Falta de auditoria, incapacidade de medir SLA e falta de visibilidade em tempo real. |

---

### 6. REQUISITOS DO DESAFIO & DIRETRIZES PARA A ARQUITETURA (TO-BE)
Quando for raciocinar sobre a solução, o agente de IA deve priorizar:
1. Ingestão e Padronização Inteligente:
   - Capacidade de receber dados brutos (diversos formatos de tabelas, e-mails ou planilhas) e extrair entidades estruturadas (SKUs, quantidades, distribuidor) sem intervenção manual.
2. Motor de Cubagem e Validação Logística em Tempo Real:
   - Algoritmo que calcula o volume, a quantidade de pallets necessária e a taxa de ocupação do veículo (contêiner/caminhão).
   - Funcionalidade de sugestão de complementação de pedido ("upsell logístico") para preencher espaços vazios do contêiner.
3. Automação de Carga / Exportação para o Sistema:
   - Eliminação da redigitação manual item a item através de exportação estruturada ou integração com o sistema corporativo.
4. Rastreabilidade e Auditoria:
   - Registro de histórico de alterações, versões do pedido e responsáveis pelas aprovações.
5. Feat Viável para 27 Horas:
   - Arquitetura enxuta, focando no núcleo do problema (Ingestão/Padronização + Cálculo Logístico de Cubagem + Saída Integrada/Exportável).

---

### 7. PROMPT-GUIA PARA O PRÓXIMO AGENTE DE IA
Ao receber este arquivo, o agente de raciocínio de produto/engenharia deve responder:
1. Mapeamento aprofundado dos requisitos funcionais e não-funcionais.
2. Análise comparativa de 2 a 3 opções de abordagem técnica (ex.: Pipeline com Agentes de Extração + Algoritmo de Bin Packing vs. Plataforma Web Unificada com Ingestão Documental).
3. Desenho de Arquitetura MVP recomendada com stack técnica compatível com o tempo de 27 horas.
4. Pitch de Valor: Como a solução resolve a pergunta-desafio ("simples, confiável e sem retrabalho") para a banca da 3 Corações.