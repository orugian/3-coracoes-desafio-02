/* Detector simples de idioma (pt, es, en) para as respostas da Xica.
   Conta palavras exclusivas de cada idioma (as comuns a pt e es ficam de fora) e só decide com folga,
   para não "corrigir" respostas curtas ou ambíguas. */
const WORDS = {
  pt: "o os não nao você voce vocês são sao está estão estao também tambem até ate então entao já pode posso tem têm seu sua seus suas ao aos do da dos das em com isso esse essa mais pelo pela há é foi será ainda agora quando onde caixas rascunho ocupação ocupacao veículo veiculo posições posicoes adicionei removi informação informacao equipe fale obrigada olá ola oi preço preço também ficou fica nenhum nenhuma cabem carregamento data prazo dias contêiner conteiner carreta exportação exportacao condição condicao pagamento",
  es: "la tú usted ustedes son también hasta ya puede puedo tiene tienen tu tus su sus al del el los las en con eso ese esa más hay es fue todavía ahora cuando donde cajas borrador ocupación ocupacion vehículo vehiculo posiciones agregué agregue quité información informacion equipo habla gracias hola precio quedó queda ningún ninguno ninguna caben lo le muy pero carga fecha plazo días contenedor camión camion exportación condición pago",
  en: "the you your is are and of to can it with for has have this that will now when where cases draft occupancy vehicle positions load order added removed information team please thanks hello price there no not only all its at be by from",
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(/\s+/))]));

/** Devolve {lang, confident, scores}. confident quando o vencedor tem ≥ 3 acertos e o dobro do segundo,
    ou ≥ 2 acertos sem nenhum dos outros idiomas (respostas curtas). */
export function detectLang(text) {
  const words = String(text || "").toLowerCase().replace(/\*\*/g, " ").split(/[^\p{L}]+/u).filter(Boolean);
  const scores = { pt: 0, es: 0, en: 0 };
  for (const w of words) for (const k of Object.keys(SETS)) if (SETS[k].has(w)) scores[k]++;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const confident = (best[1] >= 3 && best[1] >= 2 * Math.max(1, second[1])) || (best[1] >= 2 && second[1] === 0);
  return { lang: best[1] ? best[0] : "?", confident, scores };
}


/* Palavras do domínio em português que escapam para respostas em espanhol ou inglês
   (os campos dos dados são em português, ex.: data_minima_carregamento). Troca só a palavra inteira. */
const STRAY = {
  es: { carregamento: "carga", caixas: "cajas", caixa: "caja", rascunho: "borrador", veículo: "vehículo", veículos: "vehículos", ocupação: "ocupación", posições: "posiciones", posição: "posición", "contêiner": "contenedor", "não": "no", "você": "usted", equipe: "equipo", "exportação": "exportación" },
  en: { carregamento: "loading", caixas: "cases", caixa: "case", rascunho: "draft", veículo: "vehicle", veículos: "vehicles", ocupação: "occupancy", posições: "positions", posição: "position", "contêiner": "container", carreta: "truck", "não": "not", equipe: "team", "exportação": "export" },
};
export function fixStrayWords(text, lang) {
  const map = STRAY[lang];
  if (!map) return String(text || "");
  return String(text || "").replace(/[\p{L}]+/gu, (w) => {
    const r = map[w.toLowerCase()];
    if (!r) return w;
    return w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
  });
}
