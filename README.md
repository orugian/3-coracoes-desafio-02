# 3C Conecta

**Plataforma de pedidos de exportação da 3corações**, com a **Xica**, assistente com IA.
Protótipo do Hackathon Cafeína Week 2026 (FIAP) · Desafio 02 · Pedido sem Fronteiras.

O distribuidor monta o pedido vendo produtos, pallets e a ocupação do veículo em tempo real (plano de carga em 3D). A equipe de Exportação recebe o pedido já validado, ajusta com trilha de auditoria, aprova e gera o arquivo para o SAP, sem redigitar.

## Publicar na Vercel

1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel: **Add New → Project**, importe o repositório. O `vercel.json` já define tudo (sem framework, sem build, saída em `public/`, funções em `api/`); não mude o *Framework Preset* nem o *Output Directory*.
3. Em **Settings → Environment Variables**, crie `OPENROUTER_API_KEY` com a chave da [OpenRouter](https://openrouter.ai/keys) e faça o deploy (ou *Redeploy* se a variável foi criada depois).

Sem a variável, o site funciona igual e a Xica usa o motor de respostas embutido (respostas na hora, sem IA).

| Variável | Obrigatória | Padrão | Para quê |
|---|---|---|---|
| `OPENROUTER_API_KEY` | sim, para a IA | | Chave da OpenRouter. Fica só no servidor |
| `OPENROUTER_MODEL` | não | `xiaomi/mimo-v2.6-flash` | Modelo principal (precisa de tool calling) |
| `OPENROUTER_FALLBACK_MODELS` | não | vazio | Modelos de reserva, separados por vírgula (ex.: `anthropic/claude-haiku-5.5`) |
| `XICA_RATE_PER_MIN` / `XICA_DAILY_CAP` | não | `20` / `1000` | Perguntas por minuto por IP e teto diário, por instância |

**Proteja o crédito da chave:** defina um limite de gasto na própria chave da OpenRouter. O limite por IP do código vale por instância da função (a Vercel pode abrir várias), então ele é uma primeira barreira, não o teto. Se o site for divulgado, vale também ativar uma regra de *rate limit* no Firewall da Vercel para `/api/v1/xica/chat`.

Para rodar local com as funções: `npx vercel dev` (com um `.env` copiado do `.env.example`). Abrir `public/index.html` direto do disco também funciona, sem IA.

## Como usar

O endereço abre no acesso do distribuidor. As credenciais de demonstração aparecem na própria tela (botão **Preencher**):

| Área | Endereço | Usuário | Senha |
|---|---|---|---|
| Distribuidor | `#/login/distribuidor` | `martin@minoil.com.ar` (MINOIL) · `sofia@rioclaro.com.ar` (Río Claro, em espanhol) | `minoil2026` · `rioclaro2026` |
| Exportação 3corações | `#/login/3coracoes` | `lucas@3coracoes.com.br` | `export2026` |

São **credenciais fictícias de protótipo**: não há servidor de login, e os dados ficam no navegador (`localStorage`). Abra o endereço com `#reset` no fim para voltar aos dados iniciais.

Roteiro curto: entre como distribuidor, clique em **Fale com a Xica** e peça "Adicione 2 pallets de Cappuccino Baunilha" ou "Completa a carga pra mim"; veja os pallets entrarem no veículo em 3D; revise e confirme. Depois entre como Exportação, abra o pedido **3CC-2026-0001** (30 pallets para 28 posições), pergunte à Xica "O que muda se a carreta tiver 30 posições?" e gere o arquivo para o SAP.

## A Xica

A Xica responde com os dados reais da conta (catálogo com preços da lista do cliente, regras, veículos, rascunho e pedidos) em português, espanhol e inglês, e ajusta o rascunho por texto. No painel da Exportação, resume a fila, explica bloqueios e simula parâmetros sem gravar. Ela não envia pedidos, não aprova, não dá desconto e não inventa preço, frete, estoque ou prazo.

```
navegador ── pergunta + retrato da conta ──▶ api/v1/xica/chat ── system prompt + dados ──▶ OpenRouter
    ▲                                              │ valida, limita e protege a resposta
    └── texto ou pedido de ferramenta ◀────────────┘
    (a página executa a ferramenta com as validações do portal e devolve o resultado)
```

* **System prompt** em `lib/xica-prompt.js`, um por área (cliente ou painel) e idioma. Fica só no servidor; nada digitado pelo usuário entra nele.
* **Ferramentas** numa lista fechada por área (`lib/xica-tools.js`), com validação de argumentos: `ajustar_item`, `completar_carga`, `trocar_veiculo` (cliente) e `simular_parametros`, `abrir_pedido` (painel).
* **Proteções** (`lib/xica.js`, `lib/http.js`): o navegador não manda instruções (papel `system` é recusado); dados e pergunta vão separados; resposta que vaza o prompt ou anuncia desconto é trocada por uma resposta segura; resposta no idioma errado é traduzida; só aceita chamadas da própria página; limites de tamanho e de frequência; erros da OpenRouter não chegam ao navegador com detalhes; as chamadas pedem provedores que não guardam dados (`data_collection: deny`).

## Arquivo para o SAP

Pedido aprovado vira, com um clique, o pré-pedido de venda no **layout do Sirius** (JSON com `listPedidoVendaItemPreEntity`), pronto para copiar ou baixar como `.json`. O gerador fica em `public/assets/sap-export.js` e reproduz byte a byte o exemplo oficial (`test/fixtures/sirius-exemplo.json`).

* **De onde vem cada campo:** cliente e condição de pagamento do cadastro do cliente (ZSDR059A); Incoterm do pedido (FCA na carreta, FOB no contêiner; pedido aprovado mantém o da aprovação); centro 2612 (CD Londrina); material, descrição, quantidade em caixas (`CX`), preço da lista do cliente (o congelado na aprovação) e família (código da extração Registros: `CAFES (15)` → `15`) de cada item; equipamento, cubagem e modal do veículo (`Rodoviario` na carreta, `Maritimo` nos contêineres); data de embarque e paletes em `observacaoComex`; usuário do Sirius de quem gerou.
* **Formato SAP:** cliente com 10 dígitos e material com 18 (zeros à esquerda), valores com 2 casas somados em centavos, o mesmo tipo de cada campo do exemplo (texto, número, `null`, booleano).
* **Validação antes de gerar:** cliente, condição de pagamento, Incoterm, centro, usuário, referência (até 35 caracteres), descrição (até 40), quantidade inteira, preço, soma dos itens, equipamento e modal. Com pendência, o arquivo não sai e o pedido não muda de status. Item sem código de família (filtros e porta filtros não têm na extração) gera arquivo com aviso.
* **Arquivo congelado:** o JSON gerado fica guardado no pedido e entra na trilha de auditoria; mudar preço ou cadastro depois não reescreve o que foi enviado.
* **A confirmar com a 3corações:** `organizacao`, `vendedor`, `tipoPedido`, `prioridadeVenda` e `origemPedidoSirius` usam os valores do exemplo (`DEFAULTS` em `sap-export.js`); os códigos de equipamento dos contêineres (`CONTAINER-40`, `CONTAINER-20`), o valor exato do modal marítimo no Sirius (`Maritimo`), o código de usuário do Sirius e a `Faixa` (vai vazia) precisam vir do cadastro real.

Testes do gerador: `npm test` (Node 22+, sem dependências).

## Estrutura

```
public/                     Site estático (único conteúdo publicado como arquivo)
  index.html                Plataforma completa: dados, regras, motor de cálculo e telas
  assets/taste.css          Estilos
  assets/pallet3d.js        Visão 3D do pallet
  assets/sap-export.js      Arquivo para o SAP no layout do Sirius (gera e valida)
  assets/img-data.js        Fotos dos produtos (embutidas)
  assets/brand/             Logos do Grupo 3corações
  assets/produtos/          Fotos dos produtos (nome do arquivo = código SAP)
  vendor/                   Three.js r128 e SheetJS 0.18.5, com as licenças
api/v1/xica/status.js       GET: diz à página se a IA está ligada
api/v1/xica/chat.js         POST: um turno da conversa
lib/                        Código das funções (não é publicado como arquivo)
test/                       Testes do gerador (node:test) e o exemplo oficial do layout do Sirius
vercel.json                 Configuração da Vercel
.env.example                Variáveis de ambiente
```

## Tecnologia

HTML, CSS e JavaScript sem framework; funções da Vercel em Node.js 22, sem dependências; [OpenRouter](https://openrouter.ai) para a IA; [Three.js](https://threejs.org) (MIT) e [SheetJS Community Edition](https://sheetjs.com) (Apache 2.0) em `public/vendor/`; fonte Jost (Google Fonts). Logos do Grupo 3corações das fontes oficiais; fotos dos produtos do material do desafio.

## Equipe

Bruno Rosa · Cecília Fabre · Guilherme Orugian · Ruan Ruales

---

Protótipo acadêmico desenvolvido para o Hackathon Cafeína Week 2026 (FIAP), com os dados fornecidos no desafio Pedido sem Fronteiras. Não é um sistema oficial da 3corações.
