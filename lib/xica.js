/* Núcleo da Xica no servidor: valida o pedido do navegador, monta a chamada à OpenRouter
   com o system prompt do servidor e aplica as proteções na resposta.
   Sem dependências de HTTP: recebe o corpo já lido e um fetch (injetável nos testes). */
import { buildSystemPrompt, wrapUserTurn, neutralizeTags, CANARY, LEAK_FINGERPRINTS } from "./xica-prompt.js";
import { toolSchemas, toolNames, checkToolCall, MAX_TOOL_CALLS_PER_TURN } from "./xica-tools.js";
import { detectLang, fixStrayWords } from "./xica-lang.js";

export const LIMITS = {
  messages: 40,
  userChars: 1000,
  assistantChars: 4000,
  toolChars: 8000,
  contextBytes: 64 * 1024,
  toolRounds: 4, // rodadas de ferramenta depois da última pergunta; na seguinte, só texto
  outputChars: 2000,
};

export class XicaError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const bad = (msg) => new XicaError(400, "bad_request", msg);

export function loadConfig(env = process.env) {
  const fallbacks = String(env.OPENROUTER_FALLBACK_MODELS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return {
    apiKey: env.OPENROUTER_API_KEY || "",
    model: env.OPENROUTER_MODEL || "xiaomi/mimo-v2.6-flash",
    fallbacks,
    baseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    /* Cada chamada à OpenRouter tem um teto e o turno inteiro tem um orçamento: a função da Vercel roda até 60 s
       (vercel.json) e um turno pode ter até 3 chamadas (resposta, nova tentativa e tradução). */
    timeoutMs: Number(env.XICA_TIMEOUT_MS) || 25000,
    budgetMs: Number(env.XICA_BUDGET_MS) || 40000,
    /* Modelos com raciocínio gastam tokens pensando antes de responder: o teto precisa cobrir as duas coisas.
       O texto final é cortado em LIMITS.outputChars de qualquer forma. */
    maxTokens: Number(env.XICA_MAX_TOKENS) || 2000,
    /* Esforço de raciocínio (off | minimal | low | medium | high). O raciocínio nunca volta para o navegador. */
    reasoning: env.XICA_REASONING || "low",
    temperature: env.XICA_TEMPERATURE != null ? Number(env.XICA_TEMPERATURE) : 0.3,
    /* Identifica o app para a OpenRouter: XICA_REFERER, ou o domínio de produção que a Vercel informa. */
    referer: env.XICA_REFERER || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ""),
  };
}

/** Valida e normaliza o corpo de POST /api/v1/xica/chat. */
export function validateRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("corpo deve ser um objeto JSON");
  const area = body.area === "admin" ? "admin" : body.area === "client" ? "client" : null;
  if (!area) throw bad("area deve ser client ou admin");
  const lang = area === "admin" ? "pt" : ["pt", "es", "en"].includes(body.lang) ? body.lang : "pt";
  const tools = body.tools === true;

  const context = body.context ?? {};
  if (typeof context !== "object" || Array.isArray(context)) throw bad("context deve ser um objeto");
  if (Buffer.byteLength(JSON.stringify(context)) > LIMITS.contextBytes) throw new XicaError(413, "context_too_large", "context acima de 64 KB");

  const msgs = body.messages;
  if (!Array.isArray(msgs) || !msgs.length) throw bad("messages deve ser uma lista não vazia");
  if (msgs.length > LIMITS.messages) throw bad(`no máximo ${LIMITS.messages} mensagens`);

  const allowed = toolNames(area);
  const out = [];
  let pending = new Set(); // ids de chamadas de ferramenta ainda sem resultado
  for (const [i, m] of msgs.entries()) {
    if (!m || typeof m !== "object") throw bad(`mensagem ${i} inválida`);
    if (pending.size && m.role !== "tool") throw bad(`mensagem ${i}: faltam resultados de ferramenta`);
    if (m.role === "user") {
      const c = typeof m.content === "string" ? m.content.trim() : "";
      if (!c) throw bad(`mensagem ${i}: texto vazio`);
      if (c.length > LIMITS.userChars) throw bad(`mensagem ${i}: texto acima de ${LIMITS.userChars} caracteres`);
      out.push({ role: "user", content: c });
    } else if (m.role === "assistant") {
      const c = typeof m.content === "string" ? m.content.slice(0, LIMITS.assistantChars) : "";
      const calls = m.tool_calls == null ? [] : m.tool_calls;
      if (!Array.isArray(calls) || calls.length > MAX_TOOL_CALLS_PER_TURN) throw bad(`mensagem ${i}: tool_calls inválido`);
      if (calls.length && !tools) throw bad(`mensagem ${i}: ferramentas não habilitadas`);
      const norm = calls.map((tc, j) => {
        if (!tc || typeof tc.id !== "string" || !/^[\w-]{1,80}$/.test(tc.id)) throw bad(`mensagem ${i}: id da ferramenta ${j} inválido`);
        if (!allowed.has(tc.name)) throw bad(`mensagem ${i}: ferramenta não permitida`);
        const args = tc.arguments && typeof tc.arguments === "object" && !Array.isArray(tc.arguments) ? tc.arguments : {};
        return { id: tc.id, name: tc.name, arguments: args };
      });
      if (!c && !norm.length) continue; // resposta vazia antiga: ignora
      out.push({ role: "assistant", content: c, tool_calls: norm });
      pending = new Set(norm.map((x) => x.id));
    } else if (m.role === "tool") {
      if (!pending.has(m.tool_call_id)) throw bad(`mensagem ${i}: resultado sem chamada correspondente`);
      pending.delete(m.tool_call_id);
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? null);
      out.push({ role: "tool", tool_call_id: m.tool_call_id, content: c.slice(0, LIMITS.toolChars) });
    } else {
      throw bad(`mensagem ${i}: papel ${String(m.role).slice(0, 20)} não aceito`); // inclui "system"
    }
  }
  if (pending.size) throw bad("faltam resultados de ferramenta");
  const last = out[out.length - 1];
  if (!last || last.role === "assistant") throw bad("a última mensagem deve ser do usuário ou resultado de ferramenta");
  const lastUser = out.map((m) => m.role).lastIndexOf("user");
  if (lastUser < 0) throw bad("nenhuma pergunta do usuário");

  const rounds = out.slice(lastUser).filter((m) => m.role === "assistant" && m.tool_calls.length).length;
  return { area, lang, tools, context, messages: out, lastUser, rounds };
}

/** Monta o corpo da chamada à OpenRouter (formato OpenAI chat completions). */
export function buildPayload(req, cfg) {
  const messages = [{ role: "system", content: buildSystemPrompt(req) }];
  req.messages.forEach((m, i) => {
    if (m.role === "user") {
      messages.push({
        role: "user",
        content: i === req.lastUser ? wrapUserTurn({ area: req.area, lang: req.lang, context: req.context, question: m.content }) : neutralizeTags(m.content),
      });
    } else if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.content || "" };
      if (m.tool_calls.length) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      messages.push(msg);
    } else {
      messages.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content });
    }
  });
  const body = {
    model: cfg.model,
    messages,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    provider: { data_collection: "deny" }, // provedores que não guardam nem treinam com os dados
  };
  /* O raciocínio do modelo fica no provedor: exclude evita que ele volte na resposta (e chegue ao navegador). */
  if (cfg.reasoning === "off") body.reasoning = { enabled: false };
  else if (cfg.reasoning) body.reasoning = { effort: cfg.reasoning, exclude: true };
  if (cfg.fallbacks.length) body.models = [cfg.model, ...cfg.fallbacks];
  if (req.tools) {
    body.tools = toolSchemas(req.area);
    body.tool_choice = req.rounds >= LIMITS.toolRounds ? "none" : "auto";
  }
  return body;
}

const SAFE_REPLY = {
  pt: "Sou a Xica, a assistente com IA do 3C Conecta. Posso ajudar com produtos, pallets, carga, prazos e seus pedidos.",
  es: "Soy Xica, la asistente con IA de 3C Conecta. Puedo ayudarte con productos, pallets, carga, plazos y tus pedidos.",
  en: "I'm Xica, the 3C Conecta AI assistant. I can help with products, pallets, loads, lead times and your orders.",
};

/* Frases que afirmam uma ação no rascunho (feita ou que falhou). Recusas legítimas ("não posso adicionar,
   o produto não está liberado") e perguntas ("qual cappuccino?") não entram. */
const ACTION_CLAIM_RE = /(?<![\p{L}])(adicionei|acrescentei|inclu[ií]|removi|retirei|tirei|troquei|alterei|ajustei|completei|fechei|n[aã]o consegui (adicionar|incluir|remover|tirar|alterar|ajustar|trocar|completar)|agregu[eé]|a[nñ]ad[ií]|quit[eé]|cambi[eé]|complet[eé] la carga|no pude (agregar|a[nñ]adir|quitar|cambiar|completar)|I added|I removed|I changed|I switched|I completed|I couldn'?t (add|remove|change|switch|complete))(?![\p{L}])|devolveu (um )?erro|devolvi[oó] (un )?error|returned an error/iu;
export function actionClaim(text) {
  return ACTION_CLAIM_RE.test(String(text || ""));
}

export function leaked(text) {
  const t = String(text || "");
  return t.includes(CANARY) || LEAK_FINGERPRINTS.some((f) => t.toLowerCase().includes(f.toLowerCase()));
}

/* A Xica nunca concede nem anuncia desconto: o preço é o da lista do cliente. Uma resposta que cita
   "N% de desconto" (por injeção nos dados ou erro do modelo) é trocada por uma resposta segura. */
const PROMO_RE = /(\d{1,3}(?:[.,]\d+)?)\s?%\s*(?:de\s+)?(?:desconto|descuento|discount|off)\b|(?:desconto|descuento|discount)\s+(?:de\s+|del\s+|of\s+)?(\d{1,3}(?:[.,]\d+)?)\s?%/gi;
/** true se a resposta cita um desconto percentual que o próprio usuário não mencionou
    (recusar "10% de desconto" quando o cliente pediu 10% é normal; anunciar 50% vindo dos dados não é). */
export function promoClaim(text, question = "") {
  const asked = new Set(String(question).match(/\d{1,3}(?:[.,]\d+)?(?=\s?%)/g) || []);
  for (const m of String(text || "").matchAll(PROMO_RE)) if (!asked.has(m[1] || m[2])) return true;
  return false;
}
const PROMO_REPLY = {
  pt: "Os preços do 3C Conecta são os da sua lista de preço e eu não concedo descontos nem promoções. Para condições comerciais, fale com a equipe de Exportação 3corações.",
  es: "Los precios de 3C Conecta son los de tu lista de precios y no concedo descuentos ni promociones. Para condiciones comerciales, habla con el equipo de Exportación de 3corações.",
  en: "3C Conecta prices are the ones in your price list, and I can't grant discounts or promotions. For commercial terms, please contact the 3corações Export team.",
};

/** Ajusta o texto ao formato que o chat mostra e às regras de estilo da Xica. */
export function postProcess(text, lang = "pt") {
  let t = String(text || "").replace(/\r\n?/g, "\n");
  t = t.replace(/[\u2010\u2011\u2012]/g, "-");                 // hífens Unicode viram hífen comum (3CC‑2026 → 3CC-2026)
  t = t.replace(/[\u00a0\u202f\u2009]/g, " ");                 // espaços especiais
  t = t.replace(/(^|[^\w$])R\$\s?(?=\d)/g, "$1US$ ");            // todos os valores do portal são em US$; R$ é erro do modelo
  t = t.replace(/(^|[\s(])\$\s?(?=\d)/g, "$1US$ ");               // "$86,113" vira "US$ 86,113"
  const sep = lang === "en" ? "," : ".";                        // "US$ 16 601,76" vira "US$ 16.601,76"
  t = t.replace(/US\$ (\d{1,3}(?: \d{3})+)(?!\d)/g, (_, n) => "US$ " + n.replace(/ /g, sep));
  t = t.replace(/^```.*$/gm, "");                         // sem blocos de código
  t = t.replace(/^\s*#{1,6}\s+(.+)$/gm, "**$1**");          // título vira negrito
  t = t.replace(/^\s*[—–]\s+/gm, "- ");                     // travessão como marcador de lista
  t = t.replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2");            // faixa numérica: 10–20 vira 10-20
  t = t.replace(/\s*[—–]\s*/g, ", ");                       // travessão no meio da frase
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  /* Resposta já no idioma pedido (es/en) com uma palavra do domínio em português: troca a palavra. */
  if (lang !== "pt") { const d = detectLang(t); if (d.confident && d.lang === lang) t = fixStrayWords(t, lang); }
  if (t.length > LIMITS.outputChars) t = t.slice(0, LIMITS.outputChars).replace(/\s+\S*$/, "") + "…";
  return t;
}

function mapUpstreamError(status, j) {
  const msg = (j && j.error && (j.error.message || j.error.code)) || `HTTP ${status}`;
  if (status === 401 || status === 403) return new XicaError(503, "not_configured", "chave da OpenRouter recusada");
  if (status === 402) return new XicaError(503, "credits_exhausted", "créditos da OpenRouter esgotados");
  if (status === 429) return new XicaError(429, "rate_limited", "limite de uso da IA atingido");
  if (status === 408) return new XicaError(504, "timeout", "a IA demorou demais");
  return new XicaError(502, "upstream", String(msg).slice(0, 200));
}

/* Tradução quando a resposta sai no idioma errado: mesmo conteúdo, mesmos números, só o idioma muda. */
const TRANSLATE = {
  pt: "Traduza o texto do usuário para o português do Brasil. Mantenha números, códigos, datas, nomes de produtos e a formatação (**negrito** e listas com \"- \"). Não acrescente nem remova nada, não comente. Escreva somente a tradução, entre <t> e </t>.",
  es: "Traduce el texto del usuario al español. Mantén números, códigos, fechas, nombres de productos y el formato (**negrita** y listas con \"- \"). No agregues ni quites nada, no comentes. Escribe solo la traducción, entre <t> y </t>.",
  en: "Translate the user's text into English. Keep numbers, codes, dates, product names and formatting (**bold** and \"- \" lists). Do not add or remove anything and do not comment. Write only the translation, between <t> and </t>.",
};
/* Aceita a tradução (entre <t></t> se o modelo usar as marcas) só com tamanho parecido com o original,
   o que descarta respostas com comentários, e claramente no idioma pedido. */
export function pickTranslation(raw, original, want) {
  const s = String(raw || "");
  const m = s.match(/<t>([\s\S]*?)<\/t>/i);
  const t = (m ? m[1] : s).trim();
  if (!t) return null;
  const len = String(original || "").length;
  if (t.length > len * 1.6 + 40 || t.length < len * 0.5) return null;
  const d = detectLang(t);
  return d.confident && d.lang === want ? t : null;
}

async function callUpstream(payload, cfg, fetchImpl) {
  let res, j;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        ...(cfg.referer ? { "HTTP-Referer": cfg.referer } : {}),
        "X-Title": "3C Conecta - Xica",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    j = await res.json().catch(() => null);
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) throw new XicaError(504, "timeout", "a IA demorou demais");
    throw new XicaError(502, "upstream", "falha de rede ao chamar a OpenRouter");
  }
  if (!res.ok) throw mapUpstreamError(res.status, j);
  if (!j || j.error) throw mapUpstreamError(j && j.error && j.error.code ? Number(j.error.code) || 502 : 502, j);
  const choice = j.choices && j.choices[0];
  if (!choice || !choice.message) throw new XicaError(502, "upstream", "resposta sem conteúdo");
  return { j, choice, msg: choice.message };
}

/** Executa um turno: valida, chama a OpenRouter e devolve {text, tool_calls, finish, model, usage, guard}. */
export async function handleChat(body, { cfg, fetchImpl = fetch, log = () => {} }) {
  if (!cfg.apiKey) throw new XicaError(503, "not_configured", "OPENROUTER_API_KEY não configurada");
  const req = validateRequest(body);
  const payload = buildPayload(req, cfg);
  const t0 = Date.now();
  const timeLeft = () => cfg.budgetMs - (Date.now() - t0) > cfg.timeoutMs / 2;
  /* Erro passageiro da OpenRouter/provedor (5xx de rede ou do upstream): tenta mais uma vez, se houver tempo. */
  const call = async (p) => {
    try { return await callUpstream(p, cfg, fetchImpl); }
    catch (e) {
      if (e instanceof XicaError && e.code === "upstream" && timeLeft()) return callUpstream(p, cfg, fetchImpl);
      throw e;
    }
  };
  let { j, choice, msg } = await call(payload);
  let retried = false;
  /* Modelo que não respondeu (em geral, gastou o limite pensando): tenta de novo uma vez, sem raciocínio. */
  const empty = (m) => !(typeof m.content === "string" && m.content.trim()) && !(Array.isArray(m.tool_calls) && m.tool_calls.length);
  if (empty(msg) && !(payload.reasoning && payload.reasoning.enabled === false) && timeLeft()) {
    ({ j, choice, msg } = await callUpstream({ ...payload, reasoning: { enabled: false } }, cfg, fetchImpl));
    retried = true;
  }
  /* Resposta que diz ter mexido no rascunho (ou que "deu erro") sem ter chamado nenhuma ferramenta nesta pergunta:
     é invenção do modelo. Tenta mais uma vez; a nova resposta segue pelas mesmas proteções. */
  let claimRetry = false;
  if (req.area === "client" && req.tools && req.rounds === 0 && !retried && timeLeft()
      && !(Array.isArray(msg.tool_calls) && msg.tool_calls.length) && actionClaim(msg.content)) {
    const again = await callUpstream({ ...payload, temperature: 0 }, cfg, fetchImpl).catch(() => null);
    if (again && !empty(again.msg)) { ({ j, choice, msg } = again); claimRetry = true; }
  }
  /* Idioma: se a resposta final saiu claramente em outro idioma, traduz numa chamada à parte, curta,
     sem os dados da conta nem ferramentas (com o contexto inteiro, modelos pequenos tendem a repetir o erro).
     O resultado ainda passa pelas proteções abaixo. */
  const want = req.area === "admin" ? "pt" : req.lang;
  const hasCalls = req.tools && Array.isArray(msg.tool_calls) && msg.tool_calls.length;
  let rewrote = false;
  if (!hasCalls && typeof msg.content === "string" && msg.content.trim()) {
    const d = detectLang(msg.content);
    if (d.confident && d.lang !== want && timeLeft()) {
      const again = await callUpstream({
        model: payload.model, ...(payload.models ? { models: payload.models } : {}),
        max_tokens: 800, temperature: 0, provider: payload.provider, reasoning: { enabled: false },
        messages: [{ role: "system", content: TRANSLATE[want] }, { role: "user", content: msg.content }],
      }, cfg, fetchImpl).catch(() => null);
      const t = again && pickTranslation(again.msg.content, msg.content, want);
      if (t) { msg = { ...msg, content: t }; rewrote = true; }
    }
  }
  let text = postProcess(typeof msg.content === "string" ? msg.content : "", req.lang);
  let calls = [];
  if (req.tools && Array.isArray(msg.tool_calls)) {
    calls = msg.tool_calls
      .map((tc) => tc && tc.function && checkToolCall(req.area, { id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: tc.function.name, arguments: tc.function.arguments }))
      .filter(Boolean)
      .slice(0, MAX_TOOL_CALLS_PER_TURN);
  }
  let guard = null;
  if (leaked(msg.content)) {
    text = SAFE_REPLY[req.lang] || SAFE_REPLY.pt;
    calls = [];
    guard = "leak";
  } else if (req.area === "client" && promoClaim(text, req.messages[req.lastUser].content)) {
    text = PROMO_REPLY[req.lang] || PROMO_REPLY.pt;
    calls = [];
    guard = "discount";
  }
  if (!text && !calls.length) throw new XicaError(502, "empty", choice.finish_reason === "length" ? "a IA esgotou o limite de tokens sem responder" : "a IA não respondeu");

  const usage = j.usage ? { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens, cost: j.usage.cost } : null;
  guard = guard || (rewrote ? "lang_rewrite" : claimRetry ? "retry_action_claim" : retried ? "retry_no_reasoning" : null);
  log({ area: req.area, lang: req.lang, model: j.model, ms: Date.now() - t0, finish: choice.finish_reason, tools: calls.map((c) => c.name), guard, usage });
  return {
    text,
    tool_calls: calls,
    finish: calls.length ? "tool_calls" : choice.finish_reason === "length" ? "length" : "stop",
    model: j.model || cfg.model,
    usage,
    guard,
  };
}
