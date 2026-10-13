// Executa o calc() do piloto 3C Conecta, sem alterá-lo, e imprime os casos de referência em JSON.
// Uso: node docs/arquitetura/verificacao/motor_piloto_harness.js caminho/para/index.html
// O index.html é o do repositório orugian/3-coracoes-desafio-02 (branch solucao-3c-conecta; conferido nos commits 636ac8d, dca67be e f89cef4).
// Não há dependências: o script extrai do HTML os blocos P, VEH, CLIENTS, priceFor e calc.
const fs = require("fs");
const file = process.argv[2];
if (!file) { console.error("informe o caminho do index.html do piloto"); process.exit(2); }
const L = fs.readFileSync(file, "utf8").split("\n");

function block(startRe, endRe) {
  const a = L.findIndex(l => startRe.test(l.trimStart()));
  if (a < 0) throw new Error("bloco não encontrado: " + startRe);
  let b = a + (endRe.test(L[a]) ? 0 : 1);
  while (!endRe.test(L[b]) && b < L.length - 1) b++;
  return L.slice(a, b + 1).join("\n");
}

const m = new Function([
  block(/^const P = \[/, /^const BY/),
  block(/^const VEH/, /^const RULES/),
  block(/^const CLIENTS/, /^\};/),
  "const EPS=1e-9; const S={lang:'pt'};",
  block(/^function priceFor/, /^function priceFor/),
  block(/^function calc/, /^\}/),
  "P.forEach(p=>{p.cxPal=p.lastro*p.alt;p.m3=p.dm3/1000}); return {P,VEH,CLIENTS,calc};",
].join("\n"))();

// Chaves dos clientes mudam entre commits (636ac8d: "minoil"/"demo"; dca67be e f89cef4: "minoil"/"rioclaro").
// O cliente real é o de código 11131; o demo é o que tem bloqueio por destino.
const keyOf = pred => { const k = Object.keys(m.CLIENTS).find(c => pred(m.CLIENTS[c])); if (!k) throw new Error("cliente não encontrado no piloto"); return k; };
const MINOIL = keyOf(c => String(c.code) === "11131" || /MINOIL/i.test(c.name || ""));
const DEMO = keyOf(c => (c.blocked || []).length > 0);

const run = (q, o) => {
  const r = m.calc(q, o);
  return {
    pos: r.tot.positions, gross: +r.tot.gross.toFixed(2), net: +r.tot.net.toFixed(2), m3: +r.tot.m3.toFixed(2),
    value: +r.tot.value.toFixed(2), status: r.status, bind: r.bind,
    pct: { kg: +(r.u.kg * 100).toFixed(1), m3: +(r.u.m3 * 100).toFixed(1), pos: +(r.u.pos * 100).toFixed(1) },
    issues: r.lines.flatMap(l => l.issues.map(i => `${l.p.code}:${i.k}`)),
    pal: Object.fromEntries(r.lines.map(l => [l.p.code, +l.pallets.toFixed(2)])),
  };
};
const teste = { "12031189": 3528, "12034103": 300, "12037417": 250, "12144012": 300 };
const out = {
  veiculos: Object.fromEntries(Object.entries(m.VEH).map(([k, v]) => [k, { pos: v.pos, m3: v.m3, kg: v.kg }])),
  caso1_carreta: run(teste, { veh: "carreta", client: MINOIL, mode: "pal", mixed: false }),
  caso1_carreta_misto: run(teste, { veh: "carreta", client: MINOIL, mode: "pal", mixed: true }),
  caso1_c40: run(teste, { veh: "c40", client: MINOIL, mode: "pal", mixed: false }),
  caso1_estivada_carreta: run(teste, { veh: "carreta", client: MINOIL, mode: "est", mixed: false }),
  caso1_estivada_c40: run(teste, { veh: "c40", client: MINOIL, mode: "est", mixed: false }),
  caso2_upsell: run({ "12031189": 2352, "12142501": 1400 }, { veh: "carreta", client: MINOIL, mode: "pal", mixed: false }),
  caso3_pedido0002: run({ "12031291": 1176, "12034109": 140, "12142501": 1400, "12147801": 540 }, { veh: "c40", client: DEMO, mode: "pal", mixed: false }),
  caso4_pais: run({ "20908885": 110, "12142501": 560 }, { veh: "c40", client: DEMO, mode: "pal", mixed: false }),
};
console.log(JSON.stringify(out));
