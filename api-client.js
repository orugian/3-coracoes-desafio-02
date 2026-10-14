/* Cliente da API do 3C Conecta (docs/specs/05-integracao-web.md). Script clássico, sem build, carregado depois do
   demo-data.js e antes do script da aplicação. Decide o modo sem esperar rede: com window.PSF_DEMO, "demo" (file:// ou
   GitHub Pages, tudo no navegador); sem ele (o servidor responde /demo-data.js com "window.PSF_DEMO = null;"), "server".
   Concentra num arquivo só a tradução entre os formatos da API (docs/specs/04-api.md, "Contratos") e os do piloto, a
   fachada API com os mesmos métodos do piloto, o início da sessão (PSF.start, PSF.login), a saída (PSF.logout) e as
   preferências por usuário. A UI só esconde ou desabilita; quem decide é a API. */
(function (global) {
  "use strict";

  const MODE = global.PSF_DEMO ? "demo" : "server";
  const TZ = "America/Sao_Paulo";

  const VEHICLE_FROM_API = { carreta_padrao: "carreta", container_40: "c40", container_20: "c20" };
  const MODE_FROM_API = { PALLETIZED: "pal", FLOOR: "est" };
  const STATUS_FROM_API = { SUBMITTED: "analise", CHANGES_REQUESTED: "devolvido", APPROVED: "aprovado", EXPORTED: "sap" };
  const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
  const VEHICLE_TO_API = invert(VEHICLE_FROM_API);
  const MODE_TO_API = invert(MODE_FROM_API);
  // Alertas do motor (01) → códigos que o piloto usa em details (orderIssues).
  const ALERT_TO_PILOT = { VEHICLE_EXCEEDED: "CAPACITY", BELOW_MIN_LOT: "BELOWMIN", COUNTRY_RESTRICTED: "BLOCKED", NO_PRICE: "NOPRICE", QTY_NOT_MULTIPLE: "BOXMULT" };
  // Perfil do engine_version 1 no calc() do front (01, "Teste de paridade"): lote mínimo bloqueia, pallet incompleto só avisa.
  const ENGINE_V1_RULES = { minLotBlock: true, fullPalBlock: false };
  const AUTO_LABEL = "Regra de aprovação automática";
  const ROLE_LABEL = { int_exportacao: "Exportação 3corações", int_admin: "Dados e usuários", ext_distribuidor: "Distribuidor" };
  const PREF_FIELDS = ["qty", "unit", "veh", "mode", "lang", "view3d", "drafts", "draftId"];
  const MSG = {
    offline: "Sem conexão com o servidor. Confira a rede e tente de novo.",
    sap: "Exportação para o SAP: próxima fase",
    params: "Parâmetros do negócio: próxima fase",
    demoOnly: "Disponível só no modo servidor",
    noCustomer: "Cliente não encontrado",
    noRule: "Regra desconhecida",
  };

  // ---------- formatos

  const STAMP = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

  // "dd/mm HH:MM" no fuso de São Paulo, como o nowStamp() do piloto.
  function stamp(iso) {
    if (!iso) return undefined;
    const p = {};
    STAMP.formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
    return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
  }
  const today = () => DAY.format(new Date());
  const enc = encodeURIComponent;

  // ---------- tradução da API para o piloto

  function catalogItem(ci) {
    const d = ci.dimsMm || {};
    return {
      code: ci.material, fam: ci.family, brand: ci.brand, sap: ci.sapDescription,
      pt: ci.names.pt, es: ci.names.es, en: ci.names.en,
      un: ci.unitsPerBox, unLbl: ci.unitsLabel, net: ci.netKgPerBox, gross: ci.grossKgPerBox, dm3: ci.volumeDm3,
      lastro: ci.layerBoxes, alt: ci.layers, cxPal: ci.boxesPerPallet, m3: ci.volumeDm3 / 1000,
      price: ci.price == null ? null : ci.price, loteMin: ci.minLotPallets, shelf: ci.shelfLifeDays, ncm: ci.ncm || "",
      dims: `${d.length}×${d.width}×${d.height}`, ean: ci.ean || "", dun: ci.dun || "", linha: ci.productLine || "",
    };
  }

  // Linha de preço vigente no dia (a de início mais recente entre as vigentes).
  function currentPrice(rows, day) {
    return rows.filter((r) => r.validFrom <= day && day <= r.validTo).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
  }

  // Backoffice: price = lista US (a tela compara p.price com p.ob.price), prices por lista (o priceFor do piloto usa
  // p.prices[lista]), priceSrc (sap, site ou missing) e ob no formato do piloto.
  function productInternal(pi, opts) {
    const day = (opts && opts.today) || today();
    const item = catalogItem(Object.assign({}, pi, { price: null }));
    const byList = {};
    (pi.prices || []).forEach((r) => { (byList[r.priceList] = byList[r.priceList] || []).push(r); });
    const prices = {};
    let usOrigin = null;
    Object.keys(byList).forEach((list) => {
      const row = currentPrice(byList[list], day);
      if (!row) return;
      prices[list] = row.price;
      if (list === "US") usOrigin = row.origin;
    });
    item.prices = prices;
    item.price = prices.US == null ? null : prices.US;
    item.priceSrc = usOrigin === "SAP_LIST" ? "sap" : usOrigin === "SITE_3C" ? "site" : usOrigin ? "manual" : "missing";
    const ob = pi.ob || {};
    const hasOb = ["boxesPerPallet", "palletizationBoxes", "price", "minLot", "grossKgPerBox"].some((k) => ob[k] != null);
    item.ob = hasOb ? { cxPal: ob.boxesPerPallet, palz: ob.palletizationBoxes, price: ob.price, lote: ob.minLot, grossCx: ob.grossKgPerBox } : null;
    item.overrides = (pi.overrides || []).map((o) => Object.assign({}, o));
    item.minLotSource = pi.minLotSource;
    return item;
  }

  function customer(c) {
    return {
      name: c.name, code: c.code, dest: c.destinationLabel, cur: c.currency, inc: c.incoterm, pay: c.paymentTerms,
      payCode: c.paymentCode, list: c.priceList, factor: 1, blocked: (c.restrictedMaterials || []).slice(),
      filial: `${c.plantName} (${c.plant})`, contact: c.contactName || c.name, lang: c.language,
      mixed: !!c.mixedPallet, autoApprove: !!c.autoApprove,
    };
  }

  function submittedText(origin) {
    return origin === "ORDER_BASIS" ? "Pedido importado da planilha Order Basis" : origin === "BACKOFFICE" ? "Pedido criado pela Exportação" : "Pedido enviado pelo portal";
  }

  // Eventos → audit do piloto. VERSION_CREATED vira uma entrada por item, com kind "edit" e texto "Alterou…"
  // (adjCount() do piloto conta por esse prefixo).
  function auditEntries(ov, ctx) {
    const name = (code) => (ctx && ctx.productName && ctx.productName(code)) || code;
    const out = [];
    (ov.events || []).forEach((e) => {
      const base = { at: stamp(e.at), ts: e.at, who: e.actorLabel };
      const p = e.payload || {};
      const reason = p.reason ? ` · ${p.reason}` : "";
      if (e.type === "VERSION_CREATED" && p.changes && p.changes.length) {
        p.changes.forEach((c) => out.push(Object.assign({}, base, {
          kind: "edit", code: c.material, old: c.old, nv: c.new,
          what: `Alterou ${c.material} (${name(c.material)}) de ${INT.format(c.old)} para ${INT.format(c.new)} cx${reason}`,
        })));
        return;
      }
      let what;
      if (e.type === "SUBMITTED") what = submittedText(ov.origin);
      else if (e.type === "VERSION_CREATED") what = `Nova versão${reason}`;
      else if (e.type === "APPROVED") {
        const adj = out.filter((a) => String(a.what).startsWith("Alterou")).length;
        what = adj ? `Pedido aprovado após ${adj} ajuste${adj > 1 ? "s" : ""}` : "Pedido aprovado sem alterações";
      } else if (e.type === "AUTO_APPROVED") what = "Aprovado automaticamente: sem bloqueios e carga completa";
      else if (e.type === "CHANGES_REQUESTED") what = `Pedido devolvido ao distribuidor${p.reason ? `: ${p.reason}` : ""}`;
      else if (e.type === "RESUBMITTED") what = `Pedido reenviado pelo distribuidor${reason}`;
      else what = e.type;
      out.push(Object.assign({}, base, { what }));
    });
    return out;
  }

  // OrderView → pedido do piloto. ctx.clientKey(código) devolve a chave de CLIENTS; ctx.productName(código), o nome.
  function orderView(ov, ctx) {
    const cur = ov.current;
    const h = cur.header;
    const qty = {};
    cur.lines.forEach((l) => { qty[l.material] = l.boxes; });
    const events = ov.events;
    const o = {
      id: ov.id, v: ov.currentVersion, client: (ctx && ctx.clientKey && ctx.clientKey(ov.customerCode)) || ov.customerCode,
      veh: VEHICLE_FROM_API[h.vehicleId] || h.vehicleId, mode: MODE_FROM_API[h.loadMode] || h.loadMode, mixed: !!h.mixedPallet,
      qty, ref: h.reference || "", date: h.loadingDate || "", status: STATUS_FROM_API[ov.status] || ov.status,
      created: stamp(ov.createdAt), createdMs: Date.parse(ov.createdAt),
      origin: ov.origin === "ORDER_BASIS" ? "Order Basis" : "Portal",
      auto: events ? events.some((e) => e.type === "AUTO_APPROVED") : ov.approvedByLabel === AUTO_LABEL,
      perm: Object.assign({}, ov.permissions),
      audit: auditEntries(ov, ctx),
    };
    if (ov.approvedAt) { o.approved = stamp(ov.approvedAt); o.approvedMs = Date.parse(ov.approvedAt); }
    return o;
  }

  function details(list) {
    return (list || []).map((d) => {
      const code = ALERT_TO_PILOT[d.code] || d.code;
      if (d.code === "VEHICLE_EXCEEDED") {
        const p = d.params || {};
        return { code, over: { pos: p.positions || 0, kg: p.kg || 0, m3: p.m3 || 0 } };
      }
      const out = { code };
      if (d.material) out.material = d.material;
      if (d.params) out.params = d.params;
      return out;
    });
  }

  function ruleEntry(rc, clients) {
    const k = Object.keys(clients || {}).find((x) => clients[x].code === rc.customerCode);
    const name = k ? clients[k].name : rc.customerCode;
    const what = rc.field === "mixedPallet"
      ? `${name}: pallet misto ${rc.newValue ? "liberado" : "não aceito"}`
      : `${name}: aprovação automática ${rc.newValue ? "ativada" : "desligada"}`;
    return { at: stamp(rc.at), ts: rc.at, who: rc.actorLabel, what };
  }

  // ---------- tradução do piloto para a API

  // Mesma limpeza do piloto (sem ; aspas, tab e quebras) e sem caracteres de controle (04).
  const cleanRef = (ref) => String(ref || "").replace(/[;\r\n"\t]/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 30);
  const linesOf = (qty) => Object.keys(qty || {}).filter((k) => qty[k] > 0).map((k) => ({ material: k, boxes: qty[k] }));
  const headerOf = (d, meta) => ({
    vehicleId: VEHICLE_TO_API[d.veh] || d.veh, loadMode: MODE_TO_API[d.mode] || d.mode,
    reference: cleanRef(meta && meta.ref), loadingDate: (meta && meta.date) || null,
  });
  // O pallet misto não vai: vale a regra do cliente, lida no servidor (04, "Regras transversais").
  function orderBody(d, meta, clients) {
    const c = (clients || {})[d.client] || {};
    return { customerCode: c.code, header: headerOf(d, meta || {}), lines: linesOf(d.qty) };
  }

  // ---------- HTTP

  class PsfApiError extends Error {
    constructor(status, msg, det) { super(msg); this.status = status; this.details = det || []; }
  }
  let ENV = {};
  const apiError = (status, msg, det) => new (ENV.ApiError || PsfApiError)(status, msg, det);

  async function request(method, url, body, headers) {
    const init = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    Object.assign(init.headers, headers || {});
    let res;
    try {
      res = await global.fetch(url, init);
    } catch (_) {
      throw apiError(0, MSG.offline);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const err = (data && data.error) || {};
      const e = apiError(res.status, err.message || `Erro ${res.status}`, details(err.details));
      e.code = err.code;
      throw e;
    }
    return data;
  }

  // ---------- estado do piloto (mutado no lugar: P, BY, VEH, RULES, CLIENTS e RLOG são const no HTML)

  function clientKeyFor(code, ov) {
    const C = ENV.CLIENTS;
    const k = Object.keys(C).find((x) => C[x].code === code);
    if (k) return k;
    const key = `c${code}`;
    C[key] = customer({ code, name: (ov && ov.customerName) || code, destinationLabel: "", currency: "", incoterm: "", paymentTerms: "", paymentCode: "", priceList: "", plantName: "", plant: "", contactName: null, language: "pt" });
    return key;
  }
  const toPilot = (ov) => orderView(ov, {
    clientKey: (code) => clientKeyFor(code, ov),
    productName: (code) => ENV.BY && ENV.BY[code] && ENV.BY[code].pt,
  });

  function replaceOrder(o, first) {
    const list = ENV.S.orders;
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = o; else if (first) list.unshift(o); else list.push(o);
    return o;
  }

  function replaceItems(items) {
    const { P, BY } = ENV;
    P.length = 0;
    items.forEach((p) => P.push(p));
    Object.keys(BY).forEach((k) => { delete BY[k]; });
    P.forEach((p) => { BY[p.code] = p; });
  }
  // De Vehicle só entram pos, m3 e kg; rótulos, cols e cab continuam no HTML.
  function applyVehicles(list) {
    (list || []).forEach((v) => {
      const k = VEHICLE_FROM_API[v.id];
      if (k && ENV.VEH[k]) Object.assign(ENV.VEH[k], { pos: v.palletPositions, m3: v.volumeM3, kg: v.payloadKg });
    });
  }
  function applyRules(r) {
    if (r) Object.assign(ENV.RULES, { fullAt: r.fullAt, leadDays: r.leadDays });
    Object.assign(ENV.RULES, ENGINE_V1_RULES);
  }
  function setClients(list) {
    const C = ENV.CLIENTS;
    Object.keys(C).forEach((k) => { delete C[k]; });
    list.forEach((c) => { C[c.slug] = customer(c); });
  }
  function applyRuleLog(list) {
    ENV.RLOG.length = 0;
    (list || []).forEach((rc) => ENV.RLOG.push(ruleEntry(rc, ENV.CLIENTS)));
  }

  // Portal: P, BY, VEH, RULES e CLIENTS só com os clientes do escopo.
  function applyCatalog(cat, customers) {
    replaceItems(cat.items.map(catalogItem));
    applyVehicles(cat.vehicles);
    applyRules(cat.rules);
    setClients((customers || []).filter((c) => c.code !== cat.customer.code).concat([cat.customer]));
  }
  // Backoffice: P com prices e ob; CLIENTS de todos; RLOG pelo servidor.
  function applyProducts(prod, opts) {
    replaceItems(prod.items.map((p) => productInternal(p, opts)));
    applyVehicles(prod.vehicles);
    applyRules(prod.rules);
  }
  function applyCustomers(cust) {
    setClients(cust.customers);
    applyRuleLog(cust.ruleChanges);
  }
  function setOrders(list) {
    ENV.S.orders = list.map(toPilot);
  }

  // ---------- fachada API

  const promised = (fn) => (...args) => new Promise((resolve, reject) => {
    try { resolve(fn(...args)); } catch (e) { reject(e); }
  });

  async function mutate(id, url, body, area) {
    try {
      return replaceOrder(toPilot(await request("POST", url, body)), true);
    } catch (e) {
      // 409 VERSION_CONFLICT: recarrega o pedido e repassa o erro para o toast.
      if (e && e.code === "VERSION_CONFLICT") {
        try { replaceOrder(toPilot(await request("GET", `/v1/${area}/orders/${enc(id)}`)), true); } catch (_) { /* fica o erro original */ }
      }
      throw e;
    }
  }

  const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
  const randomKey = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  function serverApi(demo) {
    const nextPhase = (msg) => () => { throw apiError(501, msg); };
    return {
      get: (id) => demo.get(id),
      quote: (d) => demo.quote(d), // prévia: calc() local
      getSettings: () => demo.getSettings(),
      saveSettings: nextPhase(MSG.params),
      addVehicle: nextPhase(MSG.params),
      removeVehicle: nextPhase(MSG.params),
      resetSettings: nextPhase(MSG.params),
      async createOrder(d, meta) {
        meta = meta || {};
        const key = KEY_RE.test(meta.draftId || "") ? meta.draftId : randomKey();
        const ov = await request("POST", "/v1/portal/orders", orderBody(d, meta, ENV.CLIENTS), { "Idempotency-Key": key });
        return replaceOrder(toPilot(ov), true);
      },
      async updateItem(id, code, nv) {
        const o = demo.get(id);
        nv = Math.max(0, Math.floor(nv || 0));
        if (nv === (o.qty[code] || 0)) return o;
        return mutate(id, `/v1/backoffice/orders/${enc(id)}/versions`, { expectedVersion: o.v, changes: [{ material: code, boxes: nv }] }, "backoffice");
      },
      async approve(id) {
        const o = demo.get(id);
        return mutate(id, `/v1/backoffice/orders/${enc(id)}/approve`, { expectedVersion: o.v }, "backoffice");
      },
      async exportSap() { throw apiError(501, MSG.sap); },
      async setClientRule(k, field, val) {
        const c = ENV.CLIENTS[k];
        if (!c) throw apiError(404, MSG.noCustomer);
        const name = field === "mixed" ? "mixedPallet" : field === "autoApprove" ? "autoApprove" : null;
        if (!name) throw apiError(400, MSG.noRule);
        const resp = await request("PUT", `/v1/backoffice/customers/${enc(c.code)}/rules`, { [name]: !!val });
        Object.assign(c, customer(resp));
        try { applyRuleLog((await request("GET", "/v1/backoffice/customers")).ruleChanges); } catch (_) { /* o histórico atualiza no próximo carregamento */ }
        return c;
      },
      // Desejáveis (S9): devolver ao distribuidor e reenviar uma nova versão.
      async returnOrder(id, reason) {
        const o = demo.get(id);
        return mutate(id, `/v1/backoffice/orders/${enc(id)}/return`, { expectedVersion: o.v, reason: String(reason || "").trim() }, "backoffice");
      },
      async resubmit(id, d, meta) {
        const o = demo.get(id);
        meta = Object.assign({ ref: o.ref, date: o.date }, meta || {});
        return mutate(id, `/v1/portal/orders/${enc(id)}/versions`, { expectedVersion: o.v, header: headerOf(d, meta), lines: linesOf(d.qty) }, "portal");
      },
    };
  }

  function createApi(demo, env) {
    ENV = env || {};
    PSF.env = ENV;
    if (MODE === "server") return serverApi(demo);
    // Demo: o API_DEMO do piloto; as escritas viram Promise, para o HTML usar await nos dois modos.
    const api = Object.assign({}, demo);
    ["createOrder", "updateItem", "approve", "exportSap", "setClientRule"].forEach((m) => {
      if (typeof demo[m] === "function") api[m] = promised(demo[m].bind(demo));
    });
    api.returnOrder = promised(() => { throw apiError(501, MSG.demoOnly); });
    api.resubmit = promised(() => { throw apiError(501, MSG.demoOnly); });
    return api;
  }

  // ---------- sessão e preferências

  const prefsKey = (id) => `3cc-srv-v1:${id}`;
  // Só preferências e rascunhos (o carrinho); nada de pedidos, regras ou catálogo.
  function savePrefs() {
    if (!PSF.me || !ENV.S) return;
    const S = ENV.S;
    const out = {};
    PREF_FIELDS.forEach((k) => { out[k] = S[k]; });
    try { global.localStorage.setItem(prefsKey(PSF.me.user.id), JSON.stringify(out)); } catch (_) { /* navegador sem armazenamento */ }
  }
  function loadPrefs(id) {
    const S = ENV.S;
    let d = null;
    try { d = JSON.parse(global.localStorage.getItem(prefsKey(id)) || "null"); } catch (_) { d = null; }
    if (!d || typeof d !== "object") return {};
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    if (isObj(d.qty)) S.qty = d.qty;
    if (isObj(d.unit)) S.unit = d.unit;
    if (typeof d.veh === "string" && ENV.VEH && ENV.VEH[d.veh]) S.veh = d.veh;
    if (d.mode === "pal" || d.mode === "est") S.mode = d.mode;
    if (["pt", "es", "en"].includes(d.lang)) S.lang = d.lang;
    if (d.view3d === "2d" || d.view3d === "3d") S.view3d = d.view3d;
    if (Array.isArray(d.drafts) && d.drafts.every((x) => x && x.id && x.client && isObj(x.qty))) {
      S.drafts = d.drafts;
      S.draftId = d.drafts.some((x) => x.id === d.draftId) ? d.draftId : null;
    }
    return d;
  }

  async function fetchDetails(list, area) {
    return Promise.all(list.map((o) => request("GET", `/v1/${area}/orders/${enc(o.id)}`)));
  }

  async function enter(me) {
    const S = ENV.S;
    PSF.me = me;
    const prefs = loadPrefs(me.user.id);
    if (me.area === "portal") {
      const c = me.customers[0];
      if (!c) throw apiError(404, MSG.noCustomer);
      const [cat, list] = await Promise.all([
        request("GET", `/v1/portal/catalog?customer=${enc(c.code)}`),
        request("GET", "/v1/portal/orders"),
      ]);
      applyCatalog(cat, me.customers);
      setOrders(await fetchDetails(list, "portal"));
      S.area = "client";
      S.view = "home";
      S.client = c.slug; // nunca o valor inicial: headerHTML lê CLIENTS[S.client].contact
      if (!["pt", "es", "en"].includes(prefs.lang)) S.lang = c.language || "pt";
    } else {
      const [prod, cust, list] = await Promise.all([
        request("GET", "/v1/backoffice/products"),
        request("GET", "/v1/backoffice/customers"),
        request("GET", "/v1/backoffice/orders"),
      ]);
      applyProducts(prod);
      applyCustomers(cust);
      setOrders(await fetchDetails(list, "backoffice"));
      S.area = "admin";
      S.view = "exp";
      S.client = Object.keys(ENV.CLIENTS)[0] || "";
      S.sel = S.orders[0] ? S.orders[0].id : null;
    }
    if (typeof ENV.loadFolderPhotos === "function") ENV.loadFolderPhotos();
    ENV.render();
    return me;
  }

  // Com sessão, carrega a área e renderiza; sem sessão (401), mostra o acesso.
  async function start() {
    if (MODE !== "server") return null;
    let me = null;
    try {
      me = await request("GET", "/v1/auth/me");
    } catch (e) {
      if (e.status !== 401 && typeof ENV.toast === "function") ENV.toast(e.message, "err");
    }
    if (!me) {
      PSF.me = null;
      ENV.S.area = null;
      ENV.S.view = "entry";
      ENV.render();
      return null;
    }
    try {
      return await enter(me);
    } catch (e) {
      if (typeof ENV.toast === "function") ENV.toast(e.message, "err");
      throw e;
    }
  }

  // Para o formulário de acesso (S8): 401 LOGIN_FAILED vira ApiError com "Usuário ou senha incorretos."
  async function login(username, password) {
    const me = await request("POST", "/v1/auth/login", { username, password });
    return enter(me);
  }

  // Encerra a sessão e recarrega a página: nada da sessão anterior (P com prices e ob, CLIENTS, S.orders) fica na memória.
  async function logout() {
    try { await request("POST", "/v1/auth/logout", {}); } catch (_) { /* recarrega mesmo assim */ }
    PSF.me = null;
    PSF.reload();
  }

  // Nome e papel para a lateral: o usuário da sessão no servidor; no demo, os rótulos fixos do piloto.
  function who(name, role) {
    const u = PSF.me && PSF.me.user;
    if (!u) return { name, role };
    return { name: String(u.displayName).replace(/\s*\(.*\)\s*$/, "") || u.username, role: ROLE_LABEL[u.role] || u.role };
  }

  const PSF = {
    mode: MODE,
    me: null,
    env: ENV,
    createApi,
    start,
    login,
    logout,
    reload: () => global.location.reload(),
    savePrefs,
    who,
    request,
    applyCatalog,
    applyProducts,
    applyCustomers,
    translate: {
      VEHICLE_FROM_API, VEHICLE_TO_API, MODE_FROM_API, MODE_TO_API, STATUS_FROM_API, ALERT_TO_PILOT, ENGINE_V1_RULES,
      stamp, catalogItem, productInternal, customer, orderView, auditEntries, details, ruleEntry, orderBody,
    },
  };
  global.PSF = PSF;
})(window);
