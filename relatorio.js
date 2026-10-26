// Relatório mensal — editor do admin. Trava real: RLS de reports (is_admin) + trigger que só deixa
// o servidor gravar os números (data/closed_at). Aqui o admin escreve textos, esconde slides e publica.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const SLUG = /^\d{4}-\d{2}$/;
  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const slugOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = (slug) => { const { mes, ano } = GDeck.monthName(slug); return `${mes[0].toUpperCase()}${mes.slice(1)} ${ano}`; };

  let reports = [], cur = null, urls = {}, sel = "capa", dirty = false;

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    const role = await GAuth.role(sb);
    if (role === "equipe") { location.href = "kanban.html"; return; }
    if (role !== "admin") return GAuth.noAccess();
    const nav = GAuth.nav("relatorio.html", true);
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    GAuth.logout(sb);
    addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
    const want = new URLSearchParams(location.search).get("r");
    await loadList();
    const first = SLUG.test(want || "") ? want : reports[0]?.slug || slugOf(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    await open(first);
  }

  async function loadList() {
    const { data } = await sb.from("reports").select("slug, status, closed_at").order("slug", { ascending: false });
    reports = data || [];
  }

  async function open(slug) {
    app.replaceChildren(msg("Carregando…"));
    const { data, error } = await sb.from("reports").select("*").eq("slug", slug).maybeSingle();
    if (error) return app.replaceChildren(msg(error.message, "err"));
    cur = data || { slug, status: "rascunho", data: {}, texts: {}, hidden: [], closed_at: null, _new: true };
    cur.texts = cur.texts || {};
    dirty = false;
    history.replaceState(null, "", `?r=${slug}`);
    const paths = [];
    for (const n of Object.values(cur.data?.networks || {})) for (const t of n.top || []) if (t.image) paths.push(t.image);
    urls = await GWork.signed(sb, paths);
    render();
  }

  // Fecha (ou recalcula) o mês: os números vêm só do servidor
  async function closeMonth(btn, out) {
    btn.disabled = true; out.className = "msg"; out.textContent = "Buscando os números na Meta… pode levar meio minuto.";
    const { error } = await sb.functions.invoke("relatorio", { body: { slug: cur.slug } });
    btn.disabled = false;
    if (error) { out.className = "msg err"; out.textContent = "Não deu para fechar o mês. Tente de novo em instantes."; return; }
    if (dirty) await save(null);
    await loadList(); await open(cur.slug);
  }

  async function save(out) {
    const row = { slug: cur.slug, texts: cur.texts, hidden: cur.hidden || [] };
    const { error } = await sb.from("reports").upsert(row, { onConflict: "slug" });
    if (out) { out.className = `msg ${error ? "err" : "ok"}`; out.textContent = error ? error.message : "Salvo."; }
    if (!error) { dirty = false; cur._new = false; }
    return !error;
  }

  async function setStatus(status, out) {
    if (dirty && !(await save(null))) return;
    const { error } = await sb.from("reports").update({ status }).eq("slug", cur.slug);
    if (error) { out.className = "msg err"; out.textContent = error.message; return; }
    await loadList(); await open(cur.slug);
  }

  function render() {
    const closed = !!cur.closed_at;
    const out = el("p", { class: "msg", role: "status" });

    // Seletor de mês: relatórios existentes + últimos 6 meses
    const opts = new Set(reports.map((r) => r.slug));
    for (let i = 1; i <= 6; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); opts.add(slugOf(d)); }
    opts.add(cur.slug);
    const select = el("select", { "aria-label": "Mês do relatório", onchange: async (e) => {
      if (dirty && !confirm("Há textos não salvos. Trocar de mês mesmo assim?")) { e.target.value = cur.slug; return; }
      await open(e.target.value);
    } }, [...opts].sort().reverse().map((s) => {
      const r = reports.find((x) => x.slug === s);
      const tag = r ? (r.status === "publicado" ? " · publicado" : r.closed_at ? " · rascunho" : "") : "";
      return el("option", { value: s, selected: s === cur.slug }, label(s) + tag);
    }));

    const head = el("section", { class: "rel-head" },
      el("div", {}, el("h1", {}, el("span", {}, "Relatório"), el("span", { class: "hl" }, " do mês")),
        el("p", { class: "msg" }, closed
          ? `Números fechados em ${new Date(cur.closed_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}. ${cur.status === "publicado" ? "O cliente já vê este relatório." : "Só você vê, até publicar."}`
          : "Feche o mês para puxar os números da Meta.")),
      el("div", { class: "row" }, select));

    if (!closed) {
      const b = el("button", { class: "btn primary", type: "button", onclick: () => closeMonth(b, out) }, "Fechar o mês");
      return app.replaceChildren(head, el("div", { class: "panel stack-0" },
        el("p", {}, "Fechar o mês busca alcance, compartilhamentos, salvamentos e seguidores do Instagram e do Facebook, e escolhe os 3 posts de destaque. Dá para recalcular depois."), b, out));
    }

    // Slides
    const plan = GDeck.plan(cur);
    if (!plan.some((s) => s.id === sel && !s.hidden)) sel = (plan.find((s) => !s.hidden) || plan[0]).id;
    const stage = el("div", { class: "rel-stage" });
    const drawPreview = () => {
      const visible = GDeck.plan(cur).filter((s) => !s.hidden);
      const slides = GDeck.build(cur, urls);
      const i = Math.max(0, visible.findIndex((s) => s.id === sel));
      stage.replaceChildren(slides[i] ? GDeck.thumb(slides[i]) : msg("Todos os slides estão escondidos."));
      drawList();
    };
    const list = el("ol", { class: "rel-slides" });
    const drawList = () => list.replaceChildren(...GDeck.plan(cur).map((s) => {
      const box = el("input", { type: "checkbox", checked: !s.hidden, disabled: !!s.auto, "aria-label": `Mostrar ${s.label}`, onchange: (e) => {
        const h = new Set(cur.hidden || []); e.target.checked ? h.delete(s.id) : h.add(s.id);
        cur.hidden = [...h]; dirty = true; render();
      } });
      return el("li", { class: s.id === sel ? "on" : "" }, box,
        el("button", { type: "button", disabled: s.hidden, onclick: () => { sel = s.id; render(); } }, s.label),
        s.auto ? el("small", {}, "sem dados") : null);
    }));

    // Textos
    const field = (key, title, hint, isList) => {
      const v = cur.texts[key];
      const ta = el("textarea", { rows: isList ? 5 : 3, placeholder: hint, oninput: (e) => {
        const val = e.target.value.slice(0, 2000);
        cur.texts[key] = isList ? val.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6) : val;
        dirty = true; drawPreview();
      } });
      ta.value = isList ? (v || []).join("\n") : v || "";
      return el("label", { class: "rel-field" }, el("span", { class: "eyebrow" }, title), ta);
    };
    const nets = Object.keys(cur.data?.networks || {});
    const texts = el("div", { class: "panel stack-0" },
      el("h2", {}, "Textos"),
      nets.includes("instagram") ? field("analysis_instagram", "Leitura do Instagram", "Uma ou duas frases sobre o mês no Instagram.") : null,
      nets.includes("facebook") ? field("analysis_facebook", "Leitura do Facebook", "Uma ou duas frases sobre o mês no Facebook.") : null,
      field("learnings", "Aprendizados (um por linha, até 6)", "", true),
      field("next_steps", "Próximos passos (um por linha, até 6)", "", true),
      el("p", { class: "msg" }, "Os aprendizados vêm sugeridos pelos números. Revise antes de publicar."));

    const recalc = el("button", { class: "btn", type: "button", onclick: () => {
      if (cur.status === "publicado" && !confirm("O relatório já está publicado. Recalcular muda os números que o cliente vê. Continuar?")) return;
      closeMonth(recalc, out);
    } }, "Recalcular números");
    const actions = el("div", { class: "row rel-actions" },
      el("button", { class: "btn primary", type: "button", onclick: () => save(out) }, "Salvar"),
      el("button", { class: "btn", type: "button", onclick: () => { const s = GDeck.build(cur, urls); if (s.length) GDeck.present(s); } }, "Apresentar"),
      el("button", { class: "btn", type: "button", onclick: () => GDeck.print(GDeck.build(cur, urls)) }, "PDF"),
      recalc,
      cur.status === "publicado"
        ? el("button", { class: "btn", type: "button", onclick: () => setStatus("rascunho", out) }, "Despublicar")
        : el("button", { class: "btn primary", type: "button", onclick: () => {
            if (confirm(`Publicar o relatório de ${label(cur.slug).toLowerCase()} para o cliente?`)) setStatus("publicado", out);
          } }, "Publicar para o cliente"));

    app.replaceChildren(head, actions, out,
      el("div", { class: "rel-grid" },
        el("aside", { class: "panel" }, el("h2", {}, "Slides"), list),
        el("div", { class: "stack-0" }, stage, texts)));
    drawPreview();
  }

  addEventListener("resize", () => { const w = document.querySelector(".rel-stage .dk-frame"); if (w) GDeck.fit(w, w.firstChild); });
  boot();
})();
