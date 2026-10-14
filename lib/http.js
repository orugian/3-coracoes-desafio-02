/* Camada HTTP da Xica no formato Web (Request → Response), usada pelas funções da Vercel em api/.
   A chave da OpenRouter vem de variável de ambiente e nunca vai para o navegador. */
import { handleChat, XicaError } from "./xica.js";

const MAX_BODY = 256 * 1024;
const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const json = (status, obj, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...BASE_HEADERS, ...extra } });

/* Limite por IP (janela de 1 min) e teto diário. Na Vercel cada instância tem a sua memória, então o limite
   vale por instância: é uma proteção de primeira linha. O teto real de gasto é o limite de crédito da chave. */
export function createLimiter({ perMin = 20, perDay = 1000, now = () => Date.now() } = {}) {
  const ips = new Map();
  let day = "", dayCount = 0;
  return function hit(ip) {
    const t = now(), d = new Date(t).toISOString().slice(0, 10);
    if (d !== day) { day = d; dayCount = 0; }
    if (dayCount >= perDay) return { ok: false, retry: 3600 };
    let e = ips.get(ip);
    if (!e || t - e.start >= 60000) { e = { start: t, n: 0 }; ips.set(ip, e); }
    if (e.n >= perMin) return { ok: false, retry: Math.ceil((e.start + 60000 - t) / 1000) };
    e.n++; dayCount++;
    if (ips.size > 5000) for (const [k, v] of ips) if (t - v.start >= 60000) ips.delete(k);
    return { ok: true };
  };
}

export function clientIp(request) {
  const h = request.headers;
  return (h.get("x-real-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || "").trim() || "?";
}

/* Só a própria página pode chamar a rota (o navegador sempre manda Origin num POST com fetch).
   Não é autenticação: impede que outros sites usem o crédito da chave a partir do navegador dos visitantes. */
export function sameOrigin(request) {
  const o = request.headers.get("origin");
  if (!o) return false;
  let host;
  try { host = new URL(o).host; } catch { return false; }
  const own = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
  try { own.push(new URL(request.url).host); } catch {}
  return own.filter(Boolean).includes(host);
}

/** GET /api/v1/xica/status: diz à página se a IA está ligada. Nunca devolve a chave. */
export function statusResponse(request, cfg) {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
  return json(200, { enabled: !!cfg.apiKey, provider: "openrouter", model: cfg.apiKey ? cfg.model : null, tools: true });
}

/** POST /api/v1/xica/chat: um turno da conversa (ver lib/xica.js). */
export async function chatResponse(request, { cfg, fetchImpl = fetch, limiter, log = () => {} }) {
  try {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    if (!sameOrigin(request)) return json(403, { error: "forbidden_origin" });
    if (!String(request.headers.get("content-type") || "").includes("application/json")) return json(415, { error: "unsupported_media_type" });
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json(413, { error: "too_large" });
    if (limiter) {
      const rl = limiter(clientIp(request));
      if (!rl.ok) return json(429, { error: "rate_limited" }, { "Retry-After": String(rl.retry) });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(413, { error: "too_large" });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: "bad_json", message: "JSON inválido" }); }
    const out = await handleChat(body, {
      cfg, fetchImpl,
      log: (x) => log(`[xica] ${x.area}/${x.lang} ${x.model} ${x.ms}ms finish=${x.finish}${x.tools.length ? " tools=" + x.tools.join(",") : ""}${x.guard ? " guard=" + x.guard : ""}${x.usage ? ` tok=${x.usage.prompt}+${x.usage.completion} $${x.usage.cost ?? "?"}` : ""}`),
    });
    return json(200, out);
  } catch (e) {
    if (e instanceof XicaError) {
      if (e.status >= 500) log(`[xica] erro ${e.code}: ${e.message}`);
      return json(e.status, { error: e.code, message: e.status < 500 ? e.message : undefined });
    }
    log(`[xica] erro inesperado: ${(e && e.stack) || e}`);
    return json(500, { error: "internal" });
  }
}
