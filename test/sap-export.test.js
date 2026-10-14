import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../public/assets/sap-export.js");
const { build, validate, alpha, observacaoComex, stringify } = globalThis.SapExport;

const fixture = JSON.parse(readFileSync(new URL("./fixtures/sirius-exemplo.json", import.meta.url), "utf8"));

/* Entrada que corresponde ao exemplo oficial do layout */
const exemplo = () => ({
  cliente: "1000058447",
  condicaoPagamento: "2005",
  incoTerm: "FCA",
  centro: "2007",
  pedidoCliente: "Pedido 1 ",
  itens: [{ material: "12142067", descricao: "CAFE SOL CRUZR LIOF VD ASTEC 24X50G", quantidade: 100, precoUnitario: 27.92, familia: "25", unidade: "FD", ean: "7896019209717", faixa: "0035098332" }],
  equipamento: { codigo: "CARRETA-CARRETA", quantidade: 1, cubagem: 85, modal: "Rodoviario" },
  usuario: { codigo: "12354", email: "marcelosena@3coracoes.com.br", nome: "MARCELO SENA" }
});

test("reproduz o exemplo oficial: mesmos campos, mesma ordem, mesmos tipos e valores", () => {
  const out = build(exemplo());
  assert.equal(JSON.stringify(out), JSON.stringify(fixture));
  assert.deepEqual(Object.keys(out), Object.keys(fixture));
  assert.deepEqual(Object.keys(out.listPedidoVendaItemPreEntity[0]), Object.keys(fixture.listPedidoVendaItemPreEntity[0]));
  assert.deepEqual(Object.keys(out.negociacao), Object.keys(fixture.negociacao));
});

test("o exemplo oficial passa na validação", () => {
  const v = validate(build(exemplo()));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.warnings, []);
});

test("observacaoComex vazio é idêntico ao texto do layout", () => {
  assert.equal(observacaoComex(), fixture.observacaoComex);
  assert.equal(observacaoComex({ dataEmbarque: "24/10/2026", paletes: 26 }),
    "Transportadora:        Data de embarque: 24/10/2026       Material POP:        Etiquetas:        Paletes: 26");
});

test("ALPHA: cliente com 10 dígitos e material com 18, sem mexer em código não numérico", () => {
  assert.equal(alpha("11131", 10), "0000011131");
  assert.equal(alpha(12031189, 18), "000000000012031189");
  assert.equal(alpha("1000058447", 10), "1000058447");
  assert.equal(alpha("ABC-1", 10), "ABC-1");
  assert.equal(alpha(" 42 ", 10), "0000000042");
});

test("valores de vários itens somam em centavos, sem erro de ponto flutuante", () => {
  const inp = exemplo();
  inp.itens = [
    { material: "12031189", descricao: "CAFE TM 3C TRAD EXP VAC 20X250G", quantidade: 2688, precoUnitario: 49.41, familia: "15", unidade: "CX", ean: "7896005800362" },
    { material: "12034103", descricao: "CAFE CAPP 3C CLAS AL SACHE 16X10X20G", quantidade: 405, precoUnitario: 24.75, familia: "16", unidade: "CX" },
    { material: "12142146", descricao: "CAFE SOL IGUA CLAS AL VID 12X160G", quantidade: 3, precoUnitario: 0.1, familia: "25", unidade: "CX" }
  ];
  const out = build(inp);
  const it = out.listPedidoVendaItemPreEntity;
  assert.equal(it[0].Produto, "000000000012031189");
  assert.equal(it[0].Quantidade, "2688");
  assert.equal(it[0].ValorUnitario, "49.41");
  assert.equal(it[0].ValorItem, "132814.08");
  assert.equal(it[1].ValorItem, "10023.75");
  assert.equal(it[2].ValorUnitario, "0.10");
  assert.equal(it[2].ValorItem, "0.30");
  assert.equal(it[1].ImagemPrincipal, "", "sem EAN, sem imagem");
  assert.equal(out.valor, 142838.13);
  assert.equal(validate(out).ok, true);
});

test("equipamento: código com ponto e vírgula e números sem zeros à direita", () => {
  const inp = exemplo();
  inp.equipamento = { codigo: "CONTAINER-40", quantidade: 1, cubagem: 60.84, modal: "Rodoviario" };
  const out = build(inp);
  assert.equal(out.equipamentoComex, "CONTAINER-40;");
  assert.equal(out.qtdEquipamentoComex, "1");
  assert.equal(out.cubagemTotalComex, "60.84");
});

test("contêiner marítimo: FOB e modal marítimo vão para o arquivo; incoterm inválido é barrado", () => {
  const inp = exemplo();
  inp.incoTerm = "FOB";
  inp.equipamento = { codigo: "CONTAINER-40", quantidade: 1, cubagem: 60.84, modal: "Maritimo" };
  const out = build(inp);
  assert.equal(out.incoTerm, "FOB");
  assert.equal(out.modalTransporteExportacao, "Maritimo");
  assert.equal(validate(out).ok, true);
  inp.incoTerm = "fob ";
  assert.ok(validate(build(inp)).errors.some(e => e.field === "incoTerm"));
  inp.incoTerm = "";
  assert.ok(validate(build(inp)).errors.some(e => e.field === "incoTerm"));
});

test("overrides trocam os valores fixos do canal sem mudar a estrutura", () => {
  const out = build(exemplo(), { organizacao: "2100", vendedor: "300000099" });
  assert.equal(out.organizacao, "2100");
  assert.equal(out.vendedor, "300000099");
  assert.deepEqual(Object.keys(out), Object.keys(fixture));
});

test("validação barra o que o SAP recusaria", () => {
  const inp = exemplo();
  inp.cliente = "";
  inp.condicaoPagamento = "";
  inp.centro = "LONT";
  inp.pedidoCliente = "X".repeat(36);
  inp.equipamento = {};
  inp.usuario = {};
  inp.itens = [
    { material: "12031189", descricao: "D".repeat(41), quantidade: 1.5, precoUnitario: 10, familia: "15" },
    { material: "12031189", descricao: "OK", quantidade: 2, precoUnitario: 0, familia: "" }
  ];
  const v = validate(build(inp));
  assert.equal(v.ok, false);
  const fields = v.errors.map(e => e.field);
  for (const f of ["cliente", "condicaoPagamento", "centro", "pedidoCliente", "codigoUsuario", "equipamentoComex", "modalTransporteExportacao",
    "itens[0].Quantidade", "itens[0].DesProduto", "itens[1].Produto", "itens[1].ValorUnitario"]) {
    assert.ok(fields.includes(f), `esperado erro em ${f}: ${JSON.stringify(v.errors)}`);
  }
  assert.deepEqual(v.warnings.map(w => w.field), ["itens[1].ProdutoFamilia"]);
});

test("pedido sem itens e referência vazia não passa", () => {
  const inp = exemplo();
  inp.itens = [];
  inp.pedidoCliente = "   ";
  const v = validate(build(inp));
  const fields = v.errors.map(e => e.field);
  assert.ok(fields.includes("listPedidoVendaItemPreEntity"));
  assert.ok(fields.includes("pedidoCliente"));
});

test("valor adulterado depois de gerado é detectado", () => {
  const out = build(exemplo());
  out.listPedidoVendaItemPreEntity[0].ValorItem = "2792.01";
  const v = validate(out);
  assert.ok(v.errors.some(e => e.field === "itens[0].ValorItem"));
  assert.ok(v.errors.some(e => e.field === "valor"));
});

test("stringify gera JSON válido com indentação de 2 espaços", () => {
  const txt = stringify(build(exemplo()));
  assert.deepEqual(JSON.parse(txt), fixture);
  assert.match(txt, /^\{\n  "codigo": "",/);
});
