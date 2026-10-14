/* Arquivo para o SAP: pré-pedido no layout do Sirius (POST com listPedidoVendaItemPreEntity).
   Módulo puro, sem DOM: recebe o pedido já calculado pelo motor do portal e devolve o objeto no layout
   oficial, com os campos na mesma ordem e com os mesmos tipos do exemplo da 3corações
   (texto onde o layout usa texto, número em "valor", null e booleanos onde o layout usa).
   Carregado como script no navegador (window.SapExport) e importado pelos testes (globalThis.SapExport). */
(function (g) {
  "use strict";

  /* Valores fixos do canal de exportação, tirados do exemplo do layout. Trocar aqui se o ambiente do Sirius pedir outros. */
  const DEFAULTS = Object.freeze({
    organizacao: "2000",
    vendedor: "300000035",
    tipoPedido: "Z002",
    meioPagamento: "N",
    canalDistribuicao: "13",
    prioridadeVenda: "04",
    origemPedidoSirius: "SIRW",
    imagemBase: "https://sirius5.3coracoes.com.br/imagens/produtos/",
    imagemSufixo: "_1_1_1200_300_RGB.webp"
  });

  /* Limites de campo do SAP SD: BSTKD (pedido do cliente) 35, MAKTX (descrição) 40 */
  const MAX = { pedidoCliente: 35, descricao: 40 };

  /* Conversão ALPHA do SAP: código numérico com zeros à esquerda (cliente 10, material 18) */
  function alpha(v, len) {
    const s = String(v == null ? "" : v).trim();
    return /^\d+$/.test(s) && s.length < len ? s.padStart(len, "0") : s;
  }

  /* Dinheiro em centavos inteiros: preço com 2 casas × quantidade inteira não acumula erro de ponto flutuante */
  const cents = n => Math.round(Number(n) * 100);
  const money = c => (c / 100).toFixed(2);

  /* Número como texto, sem zeros à direita e com ponto decimal: 72 → "72", 60.84 → "60.84" */
  const num = n => (n == null || n === "" || !isFinite(Number(n)) ? "" : String(Math.round(Number(n) * 100) / 100));

  /* "Transportadora:        Data de embarque:        Material POP:        Etiquetas:        Paletes: " */
  const COMEX = [["transportadora", "Transportadora"], ["dataEmbarque", "Data de embarque"], ["materialPop", "Material POP"], ["etiquetas", "Etiquetas"], ["paletes", "Paletes"]];
  function observacaoComex(c) {
    c = c || {};
    return COMEX.map(([k, label]) => `${label}: ${String(c[k] == null ? "" : c[k]).trim()}`).join("       ");
  }

  function item(it, cfg) {
    const qtd = Number(it.quantidade), pc = cents(it.precoUnitario);
    return {
      Produto: alpha(it.material, 18),
      Sequencia: "",
      DesProduto: String(it.descricao || ""),
      Quantidade: String(qtd),
      ValorUnitario: money(pc),
      ValorItem: money(pc * qtd),
      ValorDesconto: "0",
      ValorDescontoPercentual: null,
      ProdutoFamilia: String(it.familia || ""),
      MotivoTrocaBonificacao: "",
      Observacao: null,
      ValorMin: null,
      ValorMax: null,
      ValorCustoTotalVenda: null,
      DescontoPorItemDizimsJaInformado: false,
      DescontoPorItemDizimsJaInformadoValor: null,
      MotivoDevolucao: "",
      Faixa: String(it.faixa || ""),
      ValorSug: null,
      UnidadeMedida: String(it.unidade || "CX"),
      ProdutoTipo: null,
      QuantidadeMinima: null,
      QuantidadeMaxima: null,
      CodigoJustificativaInvestimento: "",
      CodigoTipoAcao: "",
      TipoDesconto: "",
      PrecoOfertado: "0",
      QuantidadeOfertada: "0",
      ImagemPrincipal: it.ean ? cfg.imagemBase + String(it.ean).trim() + cfg.imagemSufixo : "",
      DetalhesAvaria: null,
      DesMotivoDevolucao: null
    };
  }

  /* input: {cliente, condicaoPagamento, incoTerm, centro, pedidoCliente, itens:[{material, descricao, quantidade,
     precoUnitario, familia, unidade, ean, faixa}], equipamento:{codigo, quantidade, cubagem, modal}, comex:{...},
     usuario:{codigo, email, nome}, vendedor?} */
  function build(input, overrides) {
    const cfg = Object.assign({}, DEFAULTS, overrides || {});
    const eq = input.equipamento || {}, us = input.usuario || {};
    const itens = (input.itens || []).map(it => item(it, cfg));
    const total = itens.reduce((a, x) => a + cents(x.ValorItem), 0);
    return {
      codigo: "",
      organizacao: cfg.organizacao,
      vendedor: String(input.vendedor || cfg.vendedor),
      cliente: alpha(input.cliente, 10),
      tipoPedido: cfg.tipoPedido,
      condicaoPagamento: String(input.condicaoPagamento || ""),
      meioPagamento: cfg.meioPagamento,
      pedidoAux: null,
      valor: total / 100,
      listPedidoVendaItemPreEntity: itens,
      codigoUsuario: String(us.codigo || ""),
      pedidoCliente: String(input.pedidoCliente == null ? "" : input.pedidoCliente),
      semPedidoAuxiliar: false,
      codigoSessao: 0,
      canalDistribuicao: cfg.canalDistribuicao,
      clienteUnop: null,
      dataEntrega: null,
      prioridadeVenda: cfg.prioridadeVenda,
      validadeInicial: "",
      validadeFinal: "",
      quantidadeVolume: "",
      valorDesconto: "0",
      emailDestinatarioPdf: "",
      negociacao: { UnidadeMedida: "", listaBrindenegociacaoEntity: [], listaFamiliaEntity: [] },
      condicaoPagamentoCliente: "",
      incoTerm: String(input.incoTerm || ""),
      observacaoComex: observacaoComex(input.comex),
      equipamentoComex: eq.codigo ? `${eq.codigo};` : "",
      qtdEquipamentoComex: num(eq.quantidade),
      cubagemTotalComex: num(eq.cubagem),
      pendenteAprovacaoPrecoCustoZex: false,
      idioma: "",
      modalTransporteExportacao: String(eq.modal || ""),
      matriculaElegivel: "",
      centro: String(input.centro || ""),
      origemPedidoSirius: cfg.origemPedidoSirius,
      tipoCompraColaborador: "",
      matricula: null,
      emailUsuario: String(us.email || ""),
      nomeUsuario: String(us.nome || ""),
      clienteRazaoSocial: null,
      clienteNomeFantasia: null,
      clientePrimeiroNome: null,
      clienteSobrenome: null
    };
  }

  /* Confere o objeto pronto antes de liberar o arquivo. errors impedem a geração; warnings só avisam. */
  function validate(p) {
    const errors = [], warnings = [];
    const err = (field, msg) => errors.push({ field, msg }), warn = (field, msg) => warnings.push({ field, msg });
    if (!/^\d{10}$/.test(p.cliente)) err("cliente", `Código do cliente inválido para o SAP: "${p.cliente}" (esperado número de até 10 dígitos)`);
    if (!p.condicaoPagamento) err("condicaoPagamento", "Cliente sem condição de pagamento cadastrada");
    if (!p.incoTerm) err("incoTerm", "Pedido sem Incoterm (FCA na carreta, FOB no contêiner)");
    else if (!/^[A-Z]{3}$/.test(p.incoTerm)) err("incoTerm", `Incoterm inválido: "${p.incoTerm}"`);
    if (!/^\d{4}$/.test(p.centro)) err("centro", `Centro inválido: "${p.centro}" (esperado código de 4 dígitos)`);
    if (!p.codigoUsuario || !p.emailUsuario) err("codigoUsuario", "Usuário do Sirius não identificado");
    if (!String(p.pedidoCliente).trim()) err("pedidoCliente", "Pedido sem referência do cliente");
    else if (p.pedidoCliente.length > MAX.pedidoCliente) err("pedidoCliente", `Referência do cliente com ${p.pedidoCliente.length} caracteres; o SAP aceita até ${MAX.pedidoCliente}`);
    const it = p.listPedidoVendaItemPreEntity || [];
    if (!it.length) err("listPedidoVendaItemPreEntity", "Pedido sem itens");
    const seen = new Set();
    let sum = 0;
    it.forEach((x, i) => {
      const at = `${x.Produto || "item " + (i + 1)}`;
      if (!/^\d{18}$/.test(x.Produto)) err(`itens[${i}].Produto`, `${at}: código de material inválido (esperado número de até 18 dígitos)`);
      if (seen.has(x.Produto)) err(`itens[${i}].Produto`, `${at}: material repetido no pedido`);
      seen.add(x.Produto);
      if (!/^[1-9]\d*$/.test(x.Quantidade)) err(`itens[${i}].Quantidade`, `${at}: quantidade precisa ser inteira e maior que zero`);
      if (!(Number(x.ValorUnitario) > 0)) err(`itens[${i}].ValorUnitario`, `${at}: sem preço`);
      if (cents(x.ValorUnitario) * Number(x.Quantidade) !== cents(x.ValorItem)) err(`itens[${i}].ValorItem`, `${at}: valor do item não bate com quantidade × preço`);
      if (!x.DesProduto) err(`itens[${i}].DesProduto`, `${at}: sem descrição`);
      else if (x.DesProduto.length > MAX.descricao) err(`itens[${i}].DesProduto`, `${at}: descrição com ${x.DesProduto.length} caracteres; o SAP aceita até ${MAX.descricao}`);
      if (!x.UnidadeMedida) err(`itens[${i}].UnidadeMedida`, `${at}: sem unidade de medida`);
      if (!x.ProdutoFamilia) warn(`itens[${i}].ProdutoFamilia`, `${at} (${x.DesProduto}): família sem código no SAP; o campo ProdutoFamilia vai vazio`);
      sum += cents(x.ValorItem);
    });
    if (cents(p.valor) !== sum) err("valor", "Valor do pedido não bate com a soma dos itens");
    if (!p.equipamentoComex) err("equipamentoComex", "Pedido sem equipamento de transporte");
    if (!p.modalTransporteExportacao) err("modalTransporteExportacao", "Pedido sem modal de transporte");
    return { ok: !errors.length, errors, warnings };
  }

  const stringify = p => JSON.stringify(p, null, 2);

  g.SapExport = Object.freeze({ DEFAULTS, MAX, alpha, observacaoComex, build, validate, stringify });
})(typeof globalThis !== "undefined" ? globalThis : window);
