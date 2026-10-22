// Radar legislativo — só admin. A trava real está no RLS (radar_alerts / radar_runs: is_admin()).
// Tudo que vem do banco é renderizado com textContent (via G.el). Links só https.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const STATUS = { novo: "Novo", lido: "Lido", virou_pauta: "Virou pauta", descartado: "Descartado" };
  const REL = { alta: "Relevância alta", media: "Relevância média", baixa: "Relevância baixa" };
  const ESFERA = { federal: "Federal", sp: "Estado de SP" };
  const TIPO = { novidade: "Novidade", atualizacao: "Atualiza post publicado" };

  const MOTIVOS = { irrelevante: "Irrelevante", repetido: "Repetido", muito_tecnico: "Técnico demais para post", fora_do_publico: "Fora do público da Garten", resumo_errado: "Resumo errado" };

  let alerts = [];
  let lastRun = null;
  let runs = [];
  let filter = "ativos"; // ativos | todos | virou_pauta | descartado

  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    const role = await GAuth.role(sb);
    if (role === "equipe") { location.href = "kanban.html"; return; }
    if (role !== "admin") return GAuth.noAccess();
    const nav = GAuth.nav("radar.html", true);
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    await load();
  }

  async function load() {
    const [a, r] = await Promise.all([
      sb.from("radar_alerts").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("radar_runs").select("run_at, finished_at, itens, ok, notas").order("run_at", { ascending: false }).limit(10),
    ]);
    if (a.error) return app.replaceChildren(msg(a.error.message, "err"));
    alerts = a.data || [];
    runs = r.data || [];
    lastRun = runs.find((x) => x.finished_at || !x.ok) || null; // última varredura concluída
    render();
  }

  async function setStatus(id, status, motivo = null) {
    if (!STATUS[status]) return;
    if (motivo && !MOTIVOS[motivo]) return;
    const patch = { status, descarte_motivo: status === "descartado" ? motivo : null };
    const { error } = await sb.from("radar_alerts").update(patch).eq("id", id);
    if (error) return alert(error.message);
    const it = alerts.find((x) => x.id === id);
    if (it) Object.assign(it, patch);
    render();
  }

  // Descartar pede um motivo: a tarefa diária lê esses motivos para calibrar o filtro
  function discardControl(a) {
    const sel = el("select", { "aria-label": "Motivo do descarte" },
      el("option", { value: "" }, "Descartar por…"),
      Object.entries(MOTIVOS).map(([k, v]) => el("option", { value: k }, v)));
    sel.addEventListener("change", () => { if (sel.value) setStatus(a.id, "descartado", sel.value); });
    return el("label", { class: "radar-discard" }, sel);
  }

  // Atrasado = mais de um dia útil sem varredura, contando que ela roda às 8h40
  function stale(iso) {
    const now = new Date();
    let d = new Date(now);
    if (now.getHours() * 60 + now.getMinutes() < 9 * 60 + 30) d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    d.setHours(8, 0, 0, 0); // último dia útil em que já deveria ter rodado
    return new Date(iso) < d;
  }

  // Status: { last: texto da última varredura, alert: problema a destacar }
  function runInfo() {
    if (!lastRun) return { last: null, alert: null };
    const t = G.when(lastRun.finished_at || lastRun.run_at);
    if (stale(lastRun.run_at)) return { last: null, alert: `O radar não roda desde ${t}. A tarefa agendada pode ter parado.` };
    if (!lastRun.ok) return { last: null, alert: `A varredura de ${t} falhou: ${lastRun.notas || "sem detalhe"}` };
    return { last: `Última varredura: ${t} · ${lastRun.itens} ${lastRun.itens === 1 ? "item novo" : "itens novos"}`, alert: null };
  }


  function promptFor(a, url) {
    const linhas = [
      "Vamos pensar num post para a Garten a partir deste alerta do radar legislativo.",
      "",
      `Título: ${a.titulo}`,
      `Órgão: ${a.orgao}${a.ato ? ` · ${a.ato}` : ""}`,
      a.data_publicacao ? `Publicado em: ${G.fmtDate(a.data_publicacao).toLocaleDateString("pt-BR")}` : null,
      `Esfera: ${ESFERA[a.esfera] || a.esfera} · ${REL[a.relevancia] || a.relevancia}`,
      a.tipo === "atualizacao" ? "Tipo: atualiza um post já publicado (vamos deixar claro que é uma atualização)" : "Tipo: novidade",
      `Resumo do radar: ${a.resumo}`,
      a.vigencia ? `Vigência: ${a.vigencia}` : null,
      a.publico ? `Para quem vale: ${a.publico}` : null,
      a.angulo_pauta ? `Ângulo sugerido: ${a.angulo_pauta}` : null,
      url ? `Fonte oficial: ${url}` : null,
      "",
      "Antes de propor qualquer coisa, confira a fonte oficial e me diga se o resumo do radar está correto ou se falta algo. Depois vamos fazer um brainstorm de formato, gancho e copy no tom da Garten.",
    ];
    return linhas.filter((l) => l !== null).join("\n");
  }

  async function copyPrompt(btn, a, url) {
    const text = promptFor(a, url);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = el("textarea", { readonly: true, style: "position:absolute;left:-9999px" });
      t.value = text; document.body.append(t); t.select();
      try { document.execCommand("copy"); } finally { t.remove(); }
    }
    const old = btn.textContent;
    btn.textContent = "Copiado ✓";
    setTimeout(() => { btn.textContent = old; }, 1800);
  }

  function card(a) {
    const url = safeUrl(a.url);
    const chips = el("div", { class: "row" },
      el("span", { class: `chip${a.status === "novo" ? " opp" : ""}` }, STATUS[a.status] || a.status),
      el("span", { class: "chip ed" }, ESFERA[a.esfera] || a.esfera),
      el("span", { class: "chip deadline", "data-level": a.relevancia === "alta" ? "soon" : "" }, REL[a.relevancia] || a.relevancia),
      a.tipo === "atualizacao" ? el("span", { class: "chip lock" }, TIPO.atualizacao) : null,
      a.cliente_avaliacao ? el("span", { class: `chip ${a.cliente_avaliacao === "faz_sentido" ? "opp" : "deadline"}`, "data-level": a.cliente_avaliacao === "nao_faz" ? "soon" : "" },
        `${a.cliente_actor || "Cliente"}: ${a.cliente_avaliacao === "faz_sentido" ? "faz sentido" : "não faz"}`) : null,
    );
    const meta = [a.orgao, a.ato, a.data_publicacao ? `publicado em ${G.fmtDate(a.data_publicacao).toLocaleDateString("pt-BR")}` : null].filter(Boolean).join(" · ");
    const dl = (k, v) => v ? el("div", { class: "radar-field" }, el("b", {}, k), el("span", {}, v)) : null;
    const copyBtn = el("button", { class: "btn dark", type: "button" }, "Copiar como prompt");
    copyBtn.addEventListener("click", () => copyPrompt(copyBtn, a, url));
    const actions = el("div", { class: "row" },
      copyBtn,
      a.status === "novo" ? el("button", { class: "btn ghost", onclick: () => setStatus(a.id, "lido") }, "Marcar como lido") : null,
      a.status !== "virou_pauta" ? el("button", { class: "btn ok", onclick: () => setStatus(a.id, "virou_pauta") }, "Virou pauta") : null,
      a.status !== "descartado" ? discardControl(a) : el("span", { class: "chip" }, `Descartado: ${MOTIVOS[a.descarte_motivo] || "sem motivo"}`),
      a.status !== "novo" ? el("button", { class: "btn ghost", onclick: () => setStatus(a.id, "novo") }, "Reabrir") : null,
    );
    return el("article", { class: "panel radar-card" },
      chips,
      el("h2", {}, a.titulo),
      meta ? el("p", { class: "msg" }, meta) : null,
      el("p", {}, a.resumo),
      dl("Vigência", a.vigencia),
      dl("Para quem vale", a.publico),
      dl("Ângulo de pauta", a.angulo_pauta),
      url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Ver fonte oficial ↗") : null,
      actions,
    );
  }

  function render() {
    const sel = alerts.filter((a) =>
      filter === "todos" ? true :
      filter === "ativos" ? a.status === "novo" || a.status === "lido" :
      a.status === filter);
    const novos = alerts.filter((a) => a.status === "novo").length;
    const tabs = el("div", { class: "row" }, [["ativos", `Em aberto${novos ? ` (${novos} ${novos === 1 ? "novo" : "novos"})` : ""}`], ["virou_pauta", "Viraram pauta"], ["descartado", "Descartados"], ["todos", "Todos"]]
      .map(([k, label]) => el("button", { class: `btn ${filter === k ? "dark" : "ghost"}`, onclick: () => { filter = k; render(); } }, label)));
    app.replaceChildren(
      el("section", { class: "radar-head" },
        el("div", { class: "radar-intro" },
          el("h1", {}, "Radar legislativo"),
          el("p", { class: "msg" }, "Receita Federal, Simples Nacional, PGFN, eSocial e SEFAZ-SP. Varredura de segunda a sexta, 8h40. Confira sempre a fonte oficial antes de virar post.")),
        (() => { const i = runInfo(); return G.radarStatus(G.radarTiming(runs), i.last, i.alert); })()),
      el("div", { class: "radar-filters" }, tabs),
      sel.length ? G.groupedList(sel, card)
        : filter === "ativos" ? G.radarEmpty("Nada em aberto por enquanto. Quando sair algo relevante da Receita, do Simples ou da SEFAZ-SP, aparece aqui.")
        : el("div", { class: "empty-state" }, "Nada nesta lista."),
    );
  }

  boot();
})();
