(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const SLUG_RE = /^[a-z0-9-]{3,40}$/;
  const FORMATS = Object.keys(G.FORMATS);
  const MAX_FILE = 15 * 1024 * 1024;
  const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

  let months = [];
  let editorias = [];
  let current = null; // mês aberto
  let data = null;    // posts/versions/decisions/approvers do mês

  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const field = (label, input) => el("label", { class: "f" }, label, input);

  // ---------- Login e papel ----------
  const loginView = (error) => GAuth.loginView(app, sb, boot, error);

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return loginView();
    const role = await GAuth.role(sb);
    if (role === "equipe") { location.href = "kanban.html"; return; }
    if (role !== "admin") return GAuth.noAccess(app, sb, user, () => loginView());
    const nav = GAuth.nav("admin.html", true);
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    const { data: eds } = await sb.from("editorias").select("*").eq("active", true).order("sort");
    editorias = eds || [];
    await loadMonths();
  }

  // ---------- Meses ----------
  async function loadMonths() {
    const { data: rows, error } = await sb.from("months").select("id, slug, title, overview, created_at").order("created_at", { ascending: false });
    if (error) return app.replaceChildren(msg(error.message, "err"));
    months = rows;
    if (current) current = months.find((m) => m.id === current.id) || null;
    current ? openMonth(current) : monthsView();
  }

  function monthForm(m) {
    const slug = el("input", { type: "text", value: m?.slug || "", placeholder: "2026-11", disabled: !!m });
    const title = el("input", { type: "text", value: m?.title || "", maxlength: "40", placeholder: "Novembro" });
    const intro = el("textarea", { maxlength: "400", placeholder: "Frase de abertura do mês" });
    intro.value = m?.overview?.intro || "";
    // Mix ideal do mês, em % por editoria (soma deve dar 100)
    const mixIn = {};
    const sum = el("span", { class: "msg" });
    const updSum = () => {
      const t = Object.values(mixIn).reduce((a, i) => a + (parseInt(i.value, 10) || 0), 0);
      const left = 100 - t;
      sum.textContent = t === 0 ? "Sem mix ideal (todos em 0%)" : t === 100 ? "Soma: 100% ✓" : left > 0 ? `Soma: ${t}% · faltam ${left}%` : `Soma: ${t}% · passou ${-left}%`;
      sum.className = t === 100 || t === 0 ? "msg okk" : "msg err";
      return t;
    };
    const mixFields = editorias.map((e) => {
      // Slider de 0 a 100, de 5 em 5, com o valor ao lado
      const i = el("input", { type: "range", min: "0", max: "100", step: "5", "aria-label": `${e.name} (%)` });
      const v = m?.overview?.mix?.[e.slug];
      i.value = String(v != null ? v : 0);
      const val = el("b", { class: "mix-num" });
      const paint = () => { val.textContent = `${i.value}%`; i.style.setProperty("--p", `${i.value}%`); };
      i.addEventListener("input", () => { paint(); updSum(); });
      paint();
      mixIn[e.slug] = i;
      return el("div", { class: "mix-slider" }, el("span", { class: "mix-label" }, e.name), i, val);
    });
    const why = el("textarea", { maxlength: "400", placeholder: "Por que esse mix neste mês? (aparece para o cliente)" });
    why.value = m?.overview?.mix_motivo || "";
    updSum();
    const out = msg("");
    const save = el("button", { class: "btn dark" }, m ? "Salvar mês" : "Criar mês");
    save.addEventListener("click", async () => {
      const mix = {};
      for (const [k, i] of Object.entries(mixIn)) {
        const n = parseInt(i.value, 10);
        if (Number.isFinite(n)) mix[k] = Math.max(0, Math.min(100, n));
      }
      const t = updSum();
      if (t === 0) for (const k of Object.keys(mix)) delete mix[k];
      if (t !== 0 && t !== 100) { out.className = "msg err"; out.textContent = "O mix ideal precisa somar 100% (ou ficar vazio)."; return; }
      const row = { title: title.value.trim(), overview: { intro: intro.value.trim().slice(0, 400), mix, mix_motivo: why.value.trim().slice(0, 400) } };
      if (!row.title) { out.className = "msg err"; out.textContent = "Dê um título ao mês."; return; }
      let res;
      if (m) res = await sb.from("months").update(row).eq("id", m.id).select().single();
      else {
        const s = slug.value.trim().toLowerCase();
        if (!SLUG_RE.test(s)) { out.className = "msg err"; out.textContent = "Slug: 3–40 letras minúsculas, números ou hífen."; return; }
        res = await sb.from("months").insert({ ...row, slug: s }).select().single();
      }
      if (res.error) { out.className = "msg err"; out.textContent = res.error.message; return; }
      current = res.data; await loadMonths();
    });
    return el("section", { class: "panel" },
      el("h2", {}, m ? "Dados do mês" : "Novo mês"),
      el("div", { class: "grid2" }, field("Slug do link", slug), field("Título", title)),
      field("Intro", intro),
      el("div", { class: "eyebrow" }, "Mix ideal por editoria"),
      el("div", { class: "mix-sliders" }, mixFields), sum, field("Motivo do mix", why),
      el("div", { class: "row" }, save), out);
  }

  // Exclui o mês com tudo dentro (posts, versões, decisões) e as artes do storage
  async function deleteMonth(m) {
    const typed = prompt(`Excluir "${m.title}" apaga todos os posts, aprovações e artes desse mês, sem volta.\n\nPara confirmar, digite o slug: ${m.slug}`);
    if (typed == null) return;
    if (typed.trim() !== m.slug) { alert("O slug não confere. Nada foi excluído."); return; }
    // artes no storage: {slug}/{post}/{versao}/arquivo
    const paths = [];
    const { data: posts } = await sb.storage.from("artes").list(m.slug, { limit: 1000 });
    for (const p of posts || []) {
      const { data: vers } = await sb.storage.from("artes").list(`${m.slug}/${p.name}`, { limit: 1000 });
      for (const v of vers || []) {
        const { data: files } = await sb.storage.from("artes").list(`${m.slug}/${p.name}/${v.name}`, { limit: 1000 });
        for (const f of files || []) paths.push(`${m.slug}/${p.name}/${v.name}/${f.name}`);
      }
    }
    if (paths.length) {
      const { error } = await sb.storage.from("artes").remove(paths);
      if (error) { alert(`Não consegui apagar as artes: ${error.message}. Nada foi excluído.`); return; }
    }
    const { error } = await sb.from("months").delete().eq("id", m.id);
    if (error) { alert(`Erro ao excluir: ${error.message}`); return; }
    try { localStorage.removeItem(`garten-link-${m.slug}`); } catch { /* ok */ }
    if (current?.id === m.id) current = null;
    await loadMonths();
  }

  function teamPanel() {
    const box = el("div", { class: "stack" }, msg("Carregando…"));
    const load = async () => {
      const { data: team, error } = await sb.from("team_members").select("*").order("role").order("name");
      if (error) return box.replaceChildren(msg(error.message, "err"));
      const name = el("input", { type: "text", maxlength: "60", placeholder: "Nome" });
      const email = el("input", { type: "email", placeholder: "email@exemplo.com" });
      const role = el("select", {}, el("option", { value: "equipe" }, "Equipe (Kanban)"), el("option", { value: "admin" }, "Admin (tudo)"));
      const out = msg("");
      const add = el("button", { class: "btn dark", type: "button" }, "Adicionar");
      add.addEventListener("click", async () => {
        const e = email.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { out.className = "msg err"; out.textContent = "E-mail inválido."; return; }
        if (name.value.trim().length < 2) { out.className = "msg err"; out.textContent = "Coloque o nome."; return; }
        const { error } = await sb.from("team_members").insert({ email: e, name: name.value.trim(), role: role.value });
        if (error) { out.className = "msg err"; out.textContent = error.message; return; }
        load();
      });
      box.replaceChildren(
        el("ul", { class: "history" }, (team || []).map((t) => {
          const rm = el("button", { class: "btn-del", type: "button", "aria-label": `Remover ${t.name}` }, "Remover");
          rm.addEventListener("click", async () => {
            if (!confirm(`Remover ${t.name} da equipe? A pessoa perde o acesso na hora.`)) return;
            const { error } = await sb.from("team_members").delete().eq("email", t.email);
            error ? alert(error.message) : load();
          });
          return el("li", { class: "team-row" }, el("span", {}, el("b", {}, t.name), ` · ${t.email} · ${t.role === "admin" ? "Admin" : "Equipe"}`), rm);
        })),
        el("div", { class: "grid2" }, field("Nome", name), field("E-mail (o mesmo do Google)", email)),
        field("Acesso", role), el("div", { class: "row" }, add), out);
    };
    const sumLabel = el("span", {}, "Equipe");
    sb.from("team_members").select("email", { count: "exact", head: true })
      .then(({ count }) => { if (count != null) sumLabel.textContent = `Equipe · ${count} ${count === 1 ? "pessoa" : "pessoas"} · vale para todos os meses`; });
    load();
    return el("section", { class: "panel" }, el("details", {}, el("summary", {}, sumLabel),
      el("p", {}, "Cadastro único: quem está aqui acessa todos os meses. Não precisa mexer ao criar um mês novo."), box));
  }

  // ---------- Overview (dashboard) ----------
  // Mesma regra de coluna do Kanban (G.kanbanState), para os números baterem
  let overviewMonth = null;
  function overviewPanel() {
    const box = el("section", { class: "ov", "aria-live": "polite" }, el("p", { class: "msg" }, "Carregando overview…"));
    if (!months.length) return null;
    const m = months.find((x) => x.id === overviewMonth) || months[0];
    overviewMonth = m.id;
    fillOverview(box, m);
    return box;
  }

  async function fillOverview(box, m) {
    try {
      const { data: posts, error } = await sb.from("posts").select("id, title, post_date, kind, assignee, scheduled").eq("month_id", m.id).order("post_date");
      if (error) throw error;
      const ids = posts.map((p) => p.id);
      const q = (t, order) => ids.length ? sb.from(t).select("*").in("post_id", ids).order(order) : Promise.resolve({ data: [] });
      const [v, dc, tm, rd] = await Promise.all([
        q("versions", "number"), q("decisions", "created_at"),
        sb.from("team_members").select("email, name"),
        sb.from("radar_alerts").select("id", { count: "exact", head: true }).eq("status", "novo"),
      ]);
      const all = v.data || [];
      const d = { sent: all.filter((x) => x.sent), drafts: all.filter((x) => !x.sent), decisions: dc.data || [] };
      const team = tm.data || [];
      const name = (e) => GWork.nameOf(team, e);

      // Pautas (só as planejadas: oportunidade não passa por aprovação de pauta)
      const planned = posts.filter((p) => p.kind !== "oportunidade");
      const pauta = { aprovado: 0, ajuste: 0, pendente: 0 };
      for (const p of planned) {
        const st = G.stageState({ versions: d.sent, decisions: d.decisions }, p, "pauta").status;
        if (st === "aprovado") pauta.aprovado++;
        else if (st === "reprovado" || st === "contestado") pauta.ajuste++;
        else pauta.pendente++;
      }

      // Kanban
      const cols = { fazer: [], producao: [], revisao: [], cliente: [], ajuste: [], pronto: [] };
      for (const p of posts) {
        const st = G.kanbanState(d, p);
        cols[G.KANBAN_SUB[st.col].col].push({ ...p, stage: st.stage });
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const late = posts.filter((p) => !cols.pronto.some((x) => x.id === p.id) && G.fmtDate(p.post_date) < today);

      const kanbanHref = `kanban.html?mes=${encodeURIComponent(m.slug)}`;
      const tile = (label, value, opts = {}) => el(opts.href ? "a" : "div", { class: `ov-tile${opts.tone ? ` ${opts.tone}` : ""}`, href: opts.href || false },
        el("span", { class: "ov-label" }, label), el("b", { class: "ov-num" }, String(value)), opts.sub ? el("span", { class: "ov-sub" }, opts.sub) : null);
      const pct = planned.length ? Math.round((pauta.aprovado / planned.length) * 100) : 0;

      // Quem acionar
      const acts = [];
      if (cols.revisao.length) acts.push(["Você revisa", cols.revisao.map((p) => `${p.title} (${p.stage === "arte" ? "arte" : "copy"})`)]);
      const byPerson = {};
      for (const p of cols.producao) (byPerson[p.assignee || ""] ||= []).push(p.title);
      for (const [e, list] of Object.entries(byPerson)) acts.push([e ? `${name(e)} produzindo` : "Em produção sem responsável", list]);
      if (cols.ajuste.length) acts.push(["Ajuste pedido pelo cliente", cols.ajuste.map((p) => `${p.title} (${p.stage === "arte" ? "arte" : "copy"}${p.assignee ? ` · ${name(p.assignee)}` : ""})`)]);
      if (cols.cliente.length) acts.push(["Esperando Wilker ou Letícia", cols.cliente.map((p) => `${p.title} (${p.stage === "arte" ? "arte" : "copy"})`)]);
      if (late.length) acts.push(["Atrasados (data de publicação passou)", late.map((p) => p.title)]);

      const picker = months.length > 1 ? el("select", { "aria-label": "Mês do overview", class: "ov-pick" },
        months.map((x) => el("option", { value: x.id, selected: x.id === m.id }, x.title))) : null;
      picker?.addEventListener("change", () => { overviewMonth = picker.value; const nb = overviewPanel(); box.replaceWith(nb); });

      box.replaceChildren(
        el("div", { class: "row between" }, el("h2", {}, `Overview · ${m.title}`), picker || el("span", {})),
        el("h3", { class: "ov-h" }, "Pautas"),
        el("div", { class: "ov-grid" },
          tile("Aprovadas", `${pauta.aprovado}/${planned.length}`, { tone: "ok", sub: `${pct}% do mês` }),
          tile("Com ajuste", pauta.ajuste, { tone: pauta.ajuste ? "bad" : "" }),
          tile("Aguardando o cliente", pauta.pendente),
          tile("Oportunidades", posts.length - planned.length, { sub: "fora do calendário" })),
        el("h3", { class: "ov-h" }, "Kanban"),
        el("div", { class: "ov-grid six" },
          tile("A fazer", cols.fazer.length, { href: kanbanHref }),
          tile("Em produção", cols.producao.length, { href: kanbanHref }),
          tile("Revisão interna", cols.revisao.length, { href: kanbanHref, tone: cols.revisao.length ? "you" : "", sub: cols.revisao.length ? "esperando você" : null }),
          tile("Com o cliente", cols.cliente.length, { href: kanbanHref }),
          tile("Ajuste pedido", cols.ajuste.length, { href: kanbanHref, tone: cols.ajuste.length ? "bad" : "" }),
          tile("Pronto", cols.pronto.length, { href: kanbanHref, tone: "ok" })),
        acts.length ? el("div", { class: "ov-acts" }, el("h3", { class: "ov-h" }, "Quem acionar"),
          acts.map(([who, list]) => el("details", { open: true }, el("summary", {}, `${who} · ${list.length}`), el("ul", {}, list.map((t) => el("li", {}, t))))))
          : el("p", { class: "msg okk" }, "Nada travado agora."),
        (rd.count || 0) ? el("a", { class: "ov-radar", href: "radar.html" }, G.icon("radar"), `${rd.count} ${rd.count === 1 ? "novidade" : "novidades"} no radar legislativo`) : null);
    } catch (e) {
      box.replaceChildren(msg(`Não foi possível montar o overview: ${e.message}`, "err"));
    }
  }

  function monthsView() {
    app.replaceChildren(
      overviewPanel(),
      el("section", { class: "panel" },
        el("div", { class: "row between" },
          el("h2", {}, "Meses"),
          el("button", { class: "btn ghost", onclick: async () => { await sb.auth.signOut(); loginView(); } }, "Sair")),
        months.length ? el("ul", { class: "history" }, months.map((m, i) =>
          el("li", { class: "team-row" },
            el("span", {}, el("b", {}, m.title), i === 0 ? " · atual" : " · histórico"),
            el("div", { class: "row" },
              el("button", { class: "btn ghost", onclick: () => { current = m; openMonth(m); } }, "Abrir"),
              el("a", { class: "btn ghost", href: `kanban.html?mes=${encodeURIComponent(m.slug)}` }, "Kanban"),
              el("button", { class: "btn-del", type: "button", "aria-label": `Excluir ${m.title}`, onclick: () => deleteMonth(m) }, "Excluir"))))) : msg("Nenhum mês ainda.")),
      monthForm(null),
      teamPanel());
  }

  // ---------- Mês aberto ----------
  async function loadData(m) {
    const { data: posts, error } = await sb.from("posts").select("*").eq("month_id", m.id).order("post_date").order("sort");
    if (error) throw error;
    const ids = posts.map((p) => p.id);
    const [v, d, a, c, t] = await Promise.all([
      ids.length ? sb.from("versions").select("*").in("post_id", ids).order("number") : { data: [] },
      ids.length ? sb.from("decisions").select("*").in("post_id", ids).order("created_at") : { data: [] },
      sb.from("approvers").select("*").order("is_final", { ascending: false }),
      ids.length ? sb.from("post_comments").select("*").in("post_id", ids).order("created_at") : { data: [] },
      sb.from("team_members").select("*").order("name"),
    ]);
    const all = v.data || [];
    // versions = o que o cliente vê (enviadas); drafts = aguardando revisão interna
    const drafts = all.filter((x) => !x.sent);
    const draftUrls = await GWork.signed(sb, drafts.flatMap((x) => x.asset_paths || []));
    return { posts, allVersions: all, versions: all.filter((x) => x.sent), drafts, draftUrls, decisions: d.data || [], approvers: a.data || [], comments: c.data || [], team: t.data || [] };
  }

  async function openMonth(m) {
    app.replaceChildren(msg("Carregando…"));
    try { data = await loadData(m); } catch (e) { return app.replaceChildren(msg(e.message, "err")); }
    app.replaceChildren(
      el("div", { class: "row" },
        el("button", { class: "btn ghost", onclick: () => { current = null; monthsView(); } }, "← Meses"),
        el("button", { class: "btn ghost", onclick: () => exportJson(m) }, "Exportar JSON"),
        el("a", { class: "btn ghost", href: `kanban.html?mes=${encodeURIComponent(m.slug)}` }, "Kanban deste mês")),
      linkPanel(m),
      oppPanel(m),
      monthForm(m),
      importPanel(m),
      el("section", { class: "panel" }, el("h2", {}, `Posts (${data.posts.length})`),
        data.posts.length ? data.posts.map((p) => postRow(m, p)) : msg("Nenhum post. Importe o JSON da pauta acima.")));
  }

  function linkPanel(m) {
    const base = location.href.replace(/admin\.html.*$/, "");
    const urlFor = (token) => `${base}index.html?m=${encodeURIComponent(m.slug)}#k=${token}`;
    const box = el("div", { class: "stack" });
    const out = msg("");

    function showLink(url) {
      try { localStorage.setItem(`garten-link-${m.slug}`, url); } catch { /* ok */ }
      const copy = el("button", { class: "btn ok", type: "button" }, "Copiar link");
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(url); copy.textContent = "Copiado ✓"; setTimeout(() => { copy.textContent = "Copiar link"; }, 1800); }
        catch { prompt("Copie o link:", url); }
      });
      const view = el("a", { class: "btn ghost", href: url, target: "_blank", rel: "noopener" }, "Ver como cliente");
      box.replaceChildren(el("div", { class: "link-row" }, el("code", { class: "link" }, url), copy, view));
    }
    const noLink = () => box.replaceChildren(msg("Nenhum link ativo. Gere um para mandar ao cliente."));

    // Carrega o link salvo deste mês
    (async () => {
      const { data } = await sb.from("month_links").select("token").eq("month_id", m.id).maybeSingle();
      if (data?.token) return showLink(urlFor(data.token));
      let local = null; try { local = localStorage.getItem(`garten-link-${m.slug}`); } catch { /* ok */ }
      local ? showLink(local) : noLink();
    })();

    const gen = el("button", { class: "btn dark" }, "Gerar novo link");
    gen.addEventListener("click", async () => {
      if (!confirm("Gerar um novo link invalida o anterior. Continuar?")) return;
      const { data: token, error } = await sb.rpc("rotate_month_token", { p_month: m.id });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      const { error: e2 } = await sb.from("month_links").upsert({ month_id: m.id, token, created_at: new Date().toISOString() });
      out.className = e2 ? "msg err" : "msg okk";
      out.textContent = e2 ? `Link gerado, mas não consegui salvar para copiar depois: ${e2.message}` : "Link novo gerado. O anterior parou de funcionar.";
      showLink(urlFor(token));
    });
    const revoke = el("button", { class: "btn bad" }, "Encerrar link");
    revoke.addEventListener("click", async () => {
      if (!confirm("Encerrar o link? O cliente perde o acesso até você gerar um novo.")) return;
      const { error } = await sb.rpc("revoke_month_token", { p_month: m.id });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      await sb.from("month_links").delete().eq("month_id", m.id);
      try { localStorage.removeItem(`garten-link-${m.slug}`); } catch { /* ok */ }
      out.className = "msg okk"; out.textContent = "Link encerrado. O histórico continua salvo.";
      noLink();
    });
    return el("section", { class: "panel" }, el("h2", {}, "Link do cliente"),
      el("p", {}, "O link dá acesso só a este mês. Mande pelo WhatsApp para o Wilker e a Letícia."),
      box, el("div", { class: "row" }, gen, revoke), out);
  }

  // Prazos rápidos para oportunidade
  function deadlineFrom(preset) {
    const d = new Date();
    if (preset === "2h") d.setHours(d.getHours() + 2);
    else if (preset === "hoje18") d.setHours(18, 0, 0, 0);
    else if (preset === "amanha10") { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    else return null;
    return d.toISOString();
  }
  const deadlineSelect = () => el("select", { "aria-label": "Prazo de resposta" },
    el("option", { value: "" }, "Sem prazo"),
    el("option", { value: "2h" }, "Em 2 horas"),
    el("option", { value: "hoje18" }, "Hoje às 18h"),
    el("option", { value: "amanha10" }, "Amanhã às 10h"));

  function postLink(m, p) {
    let base = null;
    try { base = localStorage.getItem(`garten-link-${m.slug}`); } catch { /* ok */ }
    if (!base) {
      base = prompt("Cole o link do cliente deste mês (o que você mandou no WhatsApp):") || "";
      if (!/index\.html\?m=.+#k=[0-9a-f]{48}$/.test(base)) { alert("Link inválido. Gere um novo link do mês se não tiver mais o anterior."); return null; }
      try { localStorage.setItem(`garten-link-${m.slug}`, base); } catch { /* ok */ }
    }
    return base.replace("#k=", `&p=${p.id}#k=`);
  }

  function oppPanel(m) {
    const title = el("input", { type: "text", maxlength: "160", placeholder: "Título do post" });
    const date = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
    const format = el("select", {}, FORMATS.map((f) => el("option", { value: f }, G.FORMATS[f])));
    const ed = el("select", {}, el("option", { value: "" }, "Editoria"), editorias.map((e) => el("option", { value: e.slug }, e.name)));
    const origin = el("select", {}, el("option", { value: "agencia" }, "Partiu da agência"), el("option", { value: "cliente" }, "Pedido do cliente"));
    const dl = deadlineSelect(); dl.value = "hoje18";
    const obj = el("textarea", { maxlength: "400", placeholder: "Por que agora? (contexto da oportunidade)" });
    const out = msg("");
    const go = el("button", { class: "btn dark" }, "Criar oportunidade");
    go.addEventListener("click", async () => {
      if (!title.value.trim()) { out.className = "msg err"; out.textContent = "Dê um título."; return; }
      if (!ed.value) { out.className = "msg err"; out.textContent = "Escolha a editoria."; return; }
      const { error } = await sb.from("posts").insert({
        month_id: m.id, post_date: date.value, format: format.value, editoria: ed.value,
        title: title.value.trim(), objective: obj.value.trim().slice(0, 400) || null,
        kind: "oportunidade", origin: origin.value, respond_by: deadlineFrom(dl.value), sort: 99,
      });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      openMonth(m);
    });
    return el("section", { class: "panel" },
      el("details", {}, el("summary", {}, "⚡ Nova oportunidade"),
        el("div", { class: "stack" },
          msg("Post fora do calendário. Pula a pauta: suba copy e arte e o cliente aprova o post pronto."),
          field("Título", title),
          el("div", { class: "grid2" }, field("Data", date), field("Formato", format), field("Editoria", ed), field("Origem", origin)),
          field("Prazo de resposta", dl), field("Contexto", obj),
          el("div", { class: "row" }, go), out)));
  }

  function validPost(p, i) {
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) errs.push("date (AAAA-MM-DD)");
    if (!FORMATS.includes(p.format)) errs.push(`format (${FORMATS.join("/")})`);
    if (!p.title || String(p.title).length > 160) errs.push("title (até 160)");
    if (p.editoria && !editorias.some((e) => e.slug === p.editoria)) errs.push(`editoria (${editorias.map((e) => e.slug).join("/")})`);
    if (errs.length) throw new Error(`Post ${i + 1}: ${errs.join(", ")}`);
    return {
      post_date: p.date, format: p.format, title: String(p.title).trim(),
      theme: p.theme ? String(p.theme).slice(0, 60) : null,
      editoria: p.editoria || null,
      kind: p.kind === "oportunidade" ? "oportunidade" : "planejado",
      origin: ["agencia", "cliente"].includes(p.origin) ? p.origin : null,
      objective: p.objective ? String(p.objective).slice(0, 400) : null,
      direction: p.direction ? String(p.direction).slice(0, 4000) : null,
      checklist: Array.isArray(p.checklist) ? p.checklist.slice(0, 15).map((c) => String(c).trim().slice(0, 300)).filter(Boolean) : [],
      sort: i,
    };
  }

  function importPanel(m) {
    const ta = el("textarea", { placeholder: '{"posts":[{"date":"2026-11-04","format":"carrossel","theme":"Base sólida","title":"…","objective":"…","direction":"…"}]}', class: "mono" });
    const out = msg("");
    const go = el("button", { class: "btn dark" }, "Importar posts");
    go.addEventListener("click", async () => {
      try {
        const parsed = JSON.parse(ta.value);
        const list = Array.isArray(parsed) ? parsed : parsed.posts;
        if (!Array.isArray(list) || !list.length || list.length > 60) throw new Error("Esperava uma lista de 1 a 60 posts.");
        const rows = list.map(validPost).map((r) => ({ ...r, month_id: m.id }));
        const { error } = await sb.from("posts").insert(rows);
        if (error) throw error;
        openMonth(m);
      } catch (e) { out.className = "msg err"; out.textContent = e.message; }
    });
    return el("section", { class: "panel" }, el("h2", {}, "Importar pauta (JSON)"),
      el("p", {}, "Cole o JSON que montamos no planejamento. Os posts são adicionados ao mês."), ta, el("div", { class: "row" }, go), out);
  }

  // Confere a assinatura real do arquivo, não só a extensão/MIME declarados
  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith("89504e47")) return "image/png";
    if (hex.startsWith("ffd8ff")) return "image/jpeg";
    if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return "image/webp";
    if (hex.slice(8, 16) === "66747970") return "video/mp4";
    return null;
  }

  async function uploadArte(m, p, files, out) {
    const list = [...files];
    if (!list.length || list.length > 20) throw new Error("Envie de 1 a 20 arquivos.");
    for (const f of list) {
      if (f.size > MAX_FILE) throw new Error(`${f.name}: máximo 15 MB.`);
      const real = await sniff(f);
      if (!real || !TYPES[real] || real !== f.type) throw new Error(`${f.name}: tipo não permitido (PNG, JPG, WEBP ou MP4).`);
    }
    const n = (G.latestVersion(data.allVersions, p.id, "arte")?.number || 0) + 1;
    const paths = [];
    for (const [i, f] of list.entries()) {
      out.textContent = `Enviando ${i + 1}/${list.length}…`;
      const path = `${m.slug}/${p.id}/arte-v${n}/${String(i + 1).padStart(2, "0")}.${TYPES[f.type]}`;
      const { error } = await sb.storage.from("artes").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      paths.push(path);
    }
    const { error } = await sb.from("versions").insert({ post_id: p.id, stage: "arte", number: n, asset_paths: paths });
    if (error) throw error;
  }

  function postRow(m, p) {
    const out = msg("");
    const fail = (e) => { out.className = "msg err"; out.textContent = e.message || String(e); };
    const states = Object.fromEntries(G.STAGES.map((s) => [s.key, G.stageState(data, p, s.key)]));

    const copyTa = el("textarea", { maxlength: "5000", placeholder: "Nova versão da copy" });
    const copyBtn = el("button", { class: "btn dark" }, "Subir copy");
    copyBtn.addEventListener("click", async () => {
      const text = copyTa.value.trim();
      if (!text) return fail(new Error("Copy vazia."));
      const n = (G.latestVersion(data.allVersions, p.id, "copy")?.number || 0) + 1;
      const { error } = await sb.from("versions").insert({ post_id: p.id, stage: "copy", number: n, copy_text: text });
      error ? fail(error) : openMonth(m);
    });

    const fileIn = el("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp,video/mp4" });
    const arteBtn = el("button", { class: "btn dark" }, "Subir arte");
    arteBtn.addEventListener("click", async () => {
      arteBtn.disabled = true;
      try { await uploadArte(m, p, fileIn.files, out); openMonth(m); } catch (e) { fail(e); arteBtn.disabled = false; }
    });

    const edSel = el("select", { "aria-label": "Editoria" },
      el("option", { value: "" }, "Sem editoria"),
      editorias.map((e) => el("option", { value: e.slug }, e.name)));
    edSel.value = p.editoria || "";
    edSel.addEventListener("change", async () => {
      const { error } = await sb.from("posts").update({ editoria: edSel.value || null }).eq("id", p.id);
      error ? fail(error) : (out.className = "msg okk", out.textContent = "Editoria salva.");
    });
    const linkBtn = el("button", { class: "btn ghost" }, "Copiar link do post");
    linkBtn.addEventListener("click", async () => {
      const url = postLink(m, p); if (!url) return;
      try { await navigator.clipboard.writeText(url); out.className = "msg okk"; out.textContent = "Link do post copiado."; }
      catch { prompt("Copie o link:", url); }
    });
    let dlSel = null;
    if (p.kind === "oportunidade") {
      dlSel = deadlineSelect();
      dlSel.addEventListener("change", async () => {
        const { error } = await sb.from("posts").update({ respond_by: deadlineFrom(dlSel.value) }).eq("id", p.id);
        error ? fail(error) : (out.className = "msg okk", out.textContent = "Prazo atualizado.");
      });
    }
    const sched = el("button", { class: "btn ghost" }, p.scheduled ? GWork.schedLabel(p) : "Agendar…");
    sched.addEventListener("click", () => {
      sched.replaceWith(GWork.schedulePanel(sb, p, () => openMonth(m)));
    });
    const del = el("button", { class: "btn bad" }, "Excluir post");
    del.addEventListener("click", async () => {
      if (!confirm(`Excluir "${p.title}" e todo o histórico dele?`)) return;
      const { error } = await sb.from("posts").delete().eq("id", p.id);
      error ? fail(error) : openMonth(m);
    });

    // Contestação: só faz sentido sobre uma reprovação
    const contests = G.STAGES.filter((s) => states[s.key].status === "reprovado").map((s) => {
      const note = el("textarea", { maxlength: "1500", placeholder: `Argumento da agência sobre o ajuste da ${s.label.toLowerCase()}` });
      const b = el("button", { class: "btn ghost" }, `Contestar ${s.label.toLowerCase()}`);
      b.addEventListener("click", async () => {
        if (note.value.trim().length < 10) return fail(new Error("Escreva o argumento (mín. 10 caracteres)."));
        const { error } = await sb.from("decisions").insert({
          post_id: p.id, stage: s.key, version_id: states[s.key].version?.id || null,
          actor: "agencia", status: "contestado", note: note.value.trim(),
        });
        error ? fail(error) : openMonth(m);
      });
      return el("div", { class: "decide" }, note, el("div", { class: "row" }, b));
    });

    // Revisão interna: rascunhos da equipe esperando o seu ok
    const drafts = data.drafts.filter((v) => v.post_id === p.id);
    const review = drafts.length ? el("div", { class: "review" },
      el("div", { class: "eyebrow" }, `Revisão interna (${drafts.length})`),
      drafts.map((v) => {
        const sendBtn = el("button", { class: "btn ok", type: "button" }, "Enviar ao cliente");
        sendBtn.addEventListener("click", async () => {
          const { error } = await sb.rpc("send_version", { p_version: v.id });
          error ? fail(error) : openMonth(m);
        });
        return el("div", { class: "draft" },
          el("div", { class: "msg" }, `${v.stage === "arte" ? "Arte" : "Copy"} v${v.number} · por ${GWork.nameOf(data.team, v.author_email)} · ${GWork.when(v.created_at)}`),
          GWork.preview(v, data.draftUrls), el("div", { class: "row" }, sendBtn),
          el("p", { class: "msg" }, "Para pedir ajuste interno, comente abaixo."));
      })) : null;

    return el("div", { class: "post-row" },
      el("div", { class: "row between" },
        el("h4", {}, `${p.post_date.split("-").reverse().join("/")} · ${p.title}`),
        el("div", { class: "row" }, G.STAGES.map((s) =>
          el("span", { class: `pill ${states[s.key].status}` }, `${s.label}: ${G.STATUS_LABEL[states[s.key].status]}`)))),
      el("details", {}, el("summary", {}, "Copy e arte"),
        el("div", { class: "stack" },
          copyTa, el("div", { class: "row" }, copyBtn),
          fileIn, el("div", { class: "row" }, arteBtn))),
      review,
      contests,
      G.STAGES.map((s) => G.historyList(data, states[s.key].decisions)),
      el("details", {}, el("summary", {}, `Comentários internos (${data.comments.filter((c) => c.post_id === p.id).length})${p.assignee ? ` · com ${GWork.nameOf(data.team, p.assignee)}` : ""}`),
        GWork.comments(sb, data.comments, data.team, p.id, () => openMonth(m))),
      p.kind === "oportunidade" ? el("div", { class: "row" },
        el("span", { class: "chip opp" }, p.origin === "cliente" ? "Oportunidade · pedido do cliente" : "Oportunidade"),
        p.respond_by ? el("span", { class: "msg" }, `Prazo: ${new Date(p.respond_by).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`) : null,
        dlSel) : null,
      el("div", { class: "row" }, edSel, linkBtn, sched, del), out);
  }

  async function exportJson(m) {
    const payload = { exported_at: new Date().toISOString(), month: m, ...(await loadData(m)) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `garten-${m.slug}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  boot();
})();
