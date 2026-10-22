// Radar legislativo — visão do cliente (link do mês + token, sem login).
// Tudo passa pela Edge Function "cliente", que valida o token no servidor.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());
  {
    const q = new URLSearchParams(location.search).get("m"), k = new URLSearchParams(location.hash.slice(1)).get("k");
    if (q && k) document.getElementById("top-actions").prepend(el("nav", { class: "topnav" },
      G.navLink(`index.html?m=${encodeURIComponent(q)}#k=${encodeURIComponent(k)}`, "Pauta do mês", "pauta", false),
      G.navLink(location.pathname.split("/").pop() + location.search + location.hash, "Radar", "radar", true)));
  }

  const params = new URLSearchParams(location.search);
  const slug = params.get("m");
  const token = new URLSearchParams(location.hash.slice(1)).get("k");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
  };

  const ESFERA = { federal: "Federal", sp: "Estado de SP" };
  const REL = { alta: "Relevância alta", media: "Relevância média", baixa: "Relevância baixa" };
  const STATUS = { novo: "Em análise", lido: "Em análise", virou_pauta: "Virou pauta", descartado: "Não vai virar post" };
  let data = null;
  let actor = store.get("garten-approver") || "";
  let filter = "todos"; // todos | sem_avaliacao | alta

  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };
  const gate = (title, text) => app.replaceChildren(el("div", { class: "gate wrap" }, el("h1", {}, title), el("p", {}, text)));

  async function api(method, body) {
    const res = await fetch(`${cfg.functionUrl}?m=${encodeURIComponent(slug)}&v=radar`, {
      method,
      headers: { "x-month-token": token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Erro de conexão");
    return json;
  }

  const nameOf = (s) => (data.approvers.find((a) => a.slug === s) || {}).name || s;

  async function rate(a, value, out) {
    if (!actor) { out.className = "msg err"; out.textContent = "Escolha quem está avaliando, no topo da página."; return; }
    const next = a.cliente_avaliacao === value ? null : value; // clicar de novo desfaz
    try { data = await api("POST", { alert_id: a.id, actor, value: next }); render(); }
    catch (e) { out.className = "msg err"; out.textContent = e.message; }
  }

  function card(a) {
    const url = safeUrl(a.url);
    const out = el("p", { class: "msg", role: "status" });
    const meta = [a.orgao, a.ato, a.data_publicacao ? `publicado em ${G.fmtDate(a.data_publicacao).toLocaleDateString("pt-BR")}` : null].filter(Boolean).join(" · ");
    const dl = (k, v) => v ? el("div", { class: "radar-field" }, el("b", {}, k), el("span", {}, v)) : null;
    const btn = (value, label, cls) => el("button", {
      type: "button", class: `btn ${a.cliente_avaliacao === value ? cls : "ghost"}`, "aria-pressed": String(a.cliente_avaliacao === value),
      onclick: () => rate(a, value, out),
    }, label);
    return el("article", { class: "panel radar-card" },
      el("div", { class: "row" },
        el("span", { class: "chip ed" }, ESFERA[a.esfera] || a.esfera),
        el("span", { class: "chip deadline", "data-level": a.relevancia === "alta" ? "soon" : "" }, REL[a.relevancia] || a.relevancia),
        el("span", { class: "chip" }, STATUS[a.status] || a.status),
        a.tipo === "atualizacao" ? el("span", { class: "chip lock" }, "Atualiza post publicado") : null),
      el("h2", {}, a.titulo),
      meta ? el("p", { class: "msg" }, meta) : null,
      el("p", {}, a.resumo),
      dl("Vigência", a.vigencia),
      dl("Para quem vale", a.publico),
      dl("Ideia de post", a.angulo_pauta),
      url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Ver fonte oficial ↗") : null,
      el("p", { class: "radar-disclaimer" }, "Resumo automático. Confira sempre na fonte oficial."),
      el("div", { class: "row" },
        el("span", { class: "msg" }, "Para os nossos clientes, isso:"),
        btn("faz_sentido", "Faz sentido", "ok"),
        btn("nao_faz", "Não faz", "bad")),
      a.cliente_avaliacao ? el("p", { class: "msg" }, `Avaliado por ${nameOf(a.cliente_actor)}`) : null,
      out);
  }

  function render() {
    const who = el("div", { class: "row" }, el("span", { class: "msg" }, "Quem está vendo:"),
      data.approvers.map((a) => el("button", {
        type: "button", class: `btn ${actor === a.slug ? "dark" : "ghost"}`, "aria-pressed": String(actor === a.slug),
        onclick: () => { actor = a.slug; store.set("garten-approver", a.slug); render(); },
      }, a.name)));
    const pend = data.alerts.filter((a) => !a.cliente_avaliacao).length;
    const tabs = el("div", { class: "row" }, [["todos", "Todos"], ["sem_avaliacao", `Sem avaliação${pend ? ` (${pend})` : ""}`], ["alta", "Relevância alta"]]
      .map(([k, label]) => el("button", { type: "button", class: `btn ${filter === k ? "dark" : "ghost"}`, onclick: () => { filter = k; render(); } }, label)));
    const list = data.alerts.filter((a) => filter === "todos" ? true : filter === "alta" ? a.relevancia === "alta" : !a.cliente_avaliacao);
    const runs = data.runs || [];
    const timing = G.radarTiming(runs);
    const done = runs.find((x) => x.finished_at || !x.ok);
    const last = done ? `Última varredura: ${G.when(done.finished_at || done.run_at)}` : null;
    app.replaceChildren(el("main", { class: "wrap" },
      el("section", { class: "radar-head" },
        el("div", { class: "radar-intro" },
          el("h1", {}, "Radar legislativo"),
          el("p", { class: "msg" }, "Novidades da Receita Federal, Simples Nacional, PGFN, eSocial e SEFAZ-SP, levantadas todo dia útil de manhã. Diga o que faz sentido para os clientes de vocês: isso ajuda o radar a trazer o que importa.")),
        G.radarStatus(timing, last, null)),
      el("div", { class: "radar-filters" }, who, tabs),
      list.length ? G.groupedList(list, card)
        : filter === "todos" ? G.radarEmpty("Ainda sem novidades por aqui. Quando sair algo relevante da Receita, do Simples ou da SEFAZ-SP, aparece nesta página.")
        : el("div", { class: "empty-state" }, "Nada nesta lista.")));
  }

  async function init() {
    if (!slug || !token) return gate("Link incompleto", "Use o link do mês que enviamos para vocês.");
    try { data = await api("GET"); render(); }
    catch (e) { gate("Não foi possível abrir", e.message); }
  }
  init();
})();
