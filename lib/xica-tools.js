/* Ferramentas que a Xica pode pedir. A lista e os esquemas ficam no servidor (whitelist).
   O navegador executa a ferramenta com as mesmas validações do portal e devolve o resultado.
   Cada ferramenta tem um validador de argumentos: chamada com argumento inválido não chega a executar. */

const CODE_RE = /^\d{8}$/;
const ORDER_RE = /^3CC-\d{4}-\d{4}$/i;
const PARAM_RE = /^(veh\.[a-z0-9_-]{1,24}\.(pos|kg|m3)|rules\.(fullAt|cutDay|leadMonths|lateH|minLotBlock|fullPalBlock)|prod\.\d{8}\.(lastro|alt|loteMin|gross))$/;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const CLIENT_TOOLS = [
  {
    name: "ajustar_item",
    description:
      "Altera a quantidade de um produto no rascunho do pedido. Só chame quando o cliente disser qual produto (um só do catálogo) e a quantidade; se faltar algo, pergunte antes. modo 'somar' adiciona à quantidade atual; 'definir' fixa o total (0 remove). Informe pallets OU caixas. Retorna alteracao (antes e depois do item, em caixas e pallets) e o rascunho atualizado (totais do pedido).",
    parameters: {
      type: "object",
      properties: {
        codigo: { type: "string", description: "Código 3C de 8 dígitos do catálogo" },
        pallets: { type: "number", description: "Quantidade em pallets (pode ser fracionada)" },
        caixas: { type: "number", description: "Quantidade em caixas" },
        modo: { type: "string", enum: ["somar", "definir"], description: "somar: adiciona à quantidade atual; definir: fixa o total (0 remove)" },
      },
      required: ["codigo", "modo"],
    },
    validate(a) {
      const codigo = String(a.codigo ?? "").trim();
      if (!CODE_RE.test(codigo)) return { error: "codigo deve ter 8 dígitos do catálogo" };
      if (a.modo !== "somar" && a.modo !== "definir") return { error: "informe modo: somar ou definir" };
      const out = { codigo, modo: a.modo };
      const hasPal = a.pallets != null, hasCx = a.caixas != null;
      if (hasPal === hasCx) return { error: "informe pallets ou caixas (só um dos dois)" };
      if (hasPal) {
        if (!isNum(a.pallets) || a.pallets < 0 || a.pallets > 500) return { error: "pallets fora da faixa (0 a 500)" };
        out.pallets = a.pallets;
      } else {
        if (!isNum(a.caixas) || a.caixas < 0 || a.caixas > 200000) return { error: "caixas fora da faixa (0 a 200000)" };
        out.caixas = Math.round(a.caixas);
      }
      if (out.modo === "somar" && (out.pallets === 0 || out.caixas === 0)) return { error: "somar 0 não muda nada" };
      return { args: out };
    },
  },
  {
    name: "completar_carga",
    description:
      "Fecha os pallets incompletos e acrescenta pallets cheios dos produtos que já estão no rascunho até o veículo encher, dentro de peso e cubagem. Retorna quantos pallets entraram e o rascunho.",
    parameters: { type: "object", properties: {} },
    validate: () => ({ args: {} }),
  },
  {
    name: "trocar_veiculo",
    description: "Troca o veículo do rascunho. Use um id da lista de veículos dos dados. Retorna o rascunho atualizado.",
    parameters: {
      type: "object",
      properties: { veiculo_id: { type: "string", description: "id do veículo, ex.: carreta, c40, c20" } },
      required: ["veiculo_id"],
    },
    validate(a) {
      const id = String(a.veiculo_id ?? "").trim();
      if (!/^[a-z0-9_-]{1,24}$/i.test(id)) return { error: "veiculo_id inválido" };
      return { args: { veiculo_id: id } };
    },
  },
];

const ADMIN_TOOLS = [
  {
    name: "simular_parametros",
    description:
      "Simula alterações de parâmetros sem gravar e devolve os pedidos em análise que mudariam de status. Caminhos aceitos: veh.<id>.pos|kg|m3, rules.fullAt (fração, padrão 1 = 100%), rules.cutDay (dia de corte, 1 a 28), rules.leadMonths (meses de antecedência, 1 a 6), rules.lateH, rules.minLotBlock, rules.fullPalBlock, prod.<codigo>.lastro|alt|loteMin|gross.",
    parameters: {
      type: "object",
      properties: { alteracoes: { type: "object", description: "Mapa caminho → valor, ex.: {\"veh.carreta.pos\": 30}" } },
      required: ["alteracoes"],
    },
    validate(a) {
      const m = a.alteracoes;
      if (!m || typeof m !== "object" || Array.isArray(m)) return { error: "alteracoes deve ser um objeto caminho → valor" };
      const entries = Object.entries(m);
      if (!entries.length || entries.length > 12) return { error: "informe de 1 a 12 alterações" };
      for (const [k, v] of entries) {
        if (!PARAM_RE.test(k)) return { error: `caminho não aceito: ${k.slice(0, 40)}` };
        if (!(isNum(v) || typeof v === "boolean")) return { error: `valor inválido para ${k}` };
      }
      return { args: { alteracoes: Object.fromEntries(entries) } };
    },
  },
  {
    name: "abrir_pedido",
    description: "Abre o detalhe de um pedido na tela Pedidos do painel. Retorna ok. Depois de abrir, confirme em uma frase: os detalhes já aparecem na tela.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Número do pedido, ex.: 3CC-2026-0001" } },
      required: ["id"],
    },
    validate(a) {
      const id = String(a.id ?? "").trim().toUpperCase();
      if (!ORDER_RE.test(id)) return { error: "número de pedido no formato 3CC-AAAA-NNNN" };
      return { args: { id } };
    },
  },
];

export const TOOLS = { client: CLIENT_TOOLS, admin: ADMIN_TOOLS };
export const MAX_TOOL_CALLS_PER_TURN = 4;

/** Esquema no formato OpenAI/OpenRouter. */
export function toolSchemas(area) {
  return (TOOLS[area] || []).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function toolNames(area) {
  return new Set((TOOLS[area] || []).map((t) => t.name));
}

/** Valida uma chamada vinda do modelo. Retorna {id,name,arguments} ou {id,name,invalid}. */
export function checkToolCall(area, call) {
  const def = (TOOLS[area] || []).find((t) => t.name === call.name);
  if (!def) return null; // fora da whitelist: descartada
  let raw = call.arguments;
  if (typeof raw === "string") {
    try { raw = raw.trim() ? JSON.parse(raw) : {}; } catch { return { id: call.id, name: call.name, invalid: "argumentos não são JSON válido" }; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const r = def.validate(raw);
  return r.error ? { id: call.id, name: call.name, invalid: r.error } : { id: call.id, name: call.name, arguments: r.args };
}
