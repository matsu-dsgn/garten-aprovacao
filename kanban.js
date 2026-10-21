(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const COLS = [
    { key: "espera", label: "Aguardando pauta", hint: "Pauta ainda com o cliente" },
    { key: "copy", label: "Copy a fazer", hint: "Pauta aprovada, falta a copy" },
    { key: "fazer", label: "Arte a fazer", hint: "Copy aprovada, livre para pegar" },
    { key: "producao", label: "Em produção" },
    { key: "revisao", label: "Revisão interna", hint: "Esperando o Rapha" },
    { key: "cliente", label: "Com o cliente" },
    { key: "ajuste", label: "Ajuste pedido" },
    { key: "aprovado", label: "Aprovado" },
    { key: "agendado", label: "Agendado" },
  ];

  let me = { email: null, role: null };
  let months = [];
  let monthId = null;
  let d = null; // dados do mês
  let openPost = null;

  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const edName = (slug) => (d.editorias.find((e) => e.slug === slug) || {}).name || "";

  function lastDecision(postId, stage, versionId) {
    const list = d.decisions.filter((x) => x.post_id === postId && x.stage === stage && x.version_id === versionId);
    return list[list.length - 1] || null;
  }

  // Coluna do card = estado real do post (ninguém precisa arrastar)
  function state(p) {
    if (p.scheduled) return { col: "agendado" };
    const opp = p.kind === "oportunidade";
    const sentArte = G.latestVersion(d.sent, p.id, "arte");
    const draftArte = G.latestVersion(d.drafts, p.id, "arte");
    if (draftArte && draftArte.number > (sentArte?.number || 0)) return { col: "revisao", stage: "arte" };
    if (sentArte) {
      const s = lastDecision(p.id, "arte", sentArte.id)?.status;
      if (s === "aprovado") return { col: "aprovado" };
      if (s === "reprovado" || s === "contestado") return { col: "ajuste", stage: "arte" };
      return { col: "cliente", stage: "arte" };
    }
    const sentCopy = G.latestVersion(d.sent, p.id, "copy");
    const draftCopy = G.latestVersion(d.drafts, p.id, "copy");
    if (draftCopy && draftCopy.number > (sentCopy?.number || 0)) return { col: "revisao", stage: "copy" };
    if (sentCopy) {
      // na oportunidade o cliente aprova copy e arte juntas, no post pronto
      const s = opp ? "aprovado" : lastDecision(p.id, "copy", sentCopy.id)?.status;
      if (s === "aprovado") return { col: p.assignee ? "producao" : "fazer", stage: "arte" };
      if (s === "reprovado" || s === "contestado") return { col: "ajuste", stage: "copy" };
      return { col: "cliente", stage: "copy" };
    }
    const pautaOk = opp || G.stageState({ versions: d.sent, decisions: d.decisions }, p, "pauta").status === "aprovado";
    if (pautaOk) return { col: p.assignee ? "producao" : "copy", stage: "copy" };
    return { col: "espera" };
  }
  const column = (p) => state(p).col;

  async function load() {
    const { data: posts } = await sb.from("posts").select("*").eq("month_id", monthId).order("post_date").order("sort");
    const ids = (posts || []).map((p) => p.id);
    const q = (t, order = "created_at") => ids.length ? sb.from(t).select("*").in("post_id", ids).order(order) : Promise.resolve({ data: [] });
    const [v, dec, com, team, eds] = await Promise.all([
      q("versions", "number"), q("decisions"), q("post_comments"),
      sb.from("team_members").select("*"), sb.from("editorias").select("*").order("sort"),
    ]);
    const all = v.data || [];
    d = {
      posts: posts || [], all, sent: all.filter((x) => x.sent), drafts: all.filter((x) => !x.sent),
      decisions: dec.data || [], comments: com.data || [], team: team.data || [], editorias: eds.data || [],
    };
    d.urls = await GWork.signed(sb, all.flatMap((x) => x.asset_paths || []));
  }

  // ---------- Board ----------
  function cardEl(p) {
    const mine = p.assignee === me.email;
    const ncom = d.comments.filter((c) => c.post_id === p.id).length;
    const dt = G.fmtDate(p.post_date);
    return el("button", { class: `kcard${mine ? " mine" : ""}`, type: "button", onclick: () => { openPost = p.id; render(); } },
      el("div", { class: "kmeta" }, el("b", {}, `${dt.getDate()}/${dt.getMonth() + 1}`), G.FORMATS[p.format] || p.format,
        p.kind === "oportunidade" ? el("span", { class: "chip opp" }, "⚡") : null),
      el("div", { class: "ktitle" }, p.title),
      ["revisao", "cliente", "ajuste", "producao"].includes(column(p)) && state(p).stage
        ? el("span", { class: "kstage" }, state(p).stage === "copy" ? "Copy" : "Arte") : null,
      el("div", { class: "kfoot" },
        p.editoria ? el("span", { class: "chip ed" }, edName(p.editoria)) : null,
        p.assignee ? el("span", { class: "kwho" }, GWork.nameOf(d.team, p.assignee)) : null,
        ncom ? el("span", { class: "kcom" }, `💬 ${ncom}`) : null));
  }

  function board() {
    const groups = Object.fromEntries(COLS.map((c) => [c.key, []]));
    for (const p of d.posts) groups[column(p)].push(p);
    return el("div", { class: "kboard" }, COLS.map((c) => el("section", { class: `kcol k-${c.key}` },
      el("header", {}, el("b", {}, c.label), el("span", {}, groups[c.key].length)),
      c.hint ? el("p", { class: "khint" }, c.hint) : null,
      el("div", { class: "kcards" }, groups[c.key].map(cardEl)))));
  }

  // ---------- Detalhe do card ----------
  function detail(p) {
    const st = state(p);
    const col = st.col;
    const out = msg("");
    const fail = (e) => { out.className = "msg err"; out.textContent = e.message || String(e); };
    const reload = async () => { await load(); render(); };

    const take = el("button", { class: "btn ghost", type: "button" }, p.assignee === me.email ? "Soltar card" : p.assignee ? "Assumir no lugar" : "Pegar card");
    take.addEventListener("click", async () => {
      const { error } = await sb.rpc("claim_post", { p_post: p.id, p_take: p.assignee !== me.email });
      error ? fail(error) : reload();
    });

    const copy = G.latestVersion(d.sent, p.id, "copy");
    const sentArte = G.latestVersion(d.sent, p.id, "arte");
    const lastArteDec = sentArte ? lastDecision(p.id, "arte", sentArte.id) : null;
    const lastCopyDec = copy ? lastDecision(p.id, "copy", copy.id) : null;
    const adjDec = st.col === "ajuste" ? (st.stage === "copy" ? lastCopyDec : lastArteDec) : null;
    const copyVersions = d.all.filter((v) => v.post_id === p.id && v.stage === "copy").sort((a, b) => b.number - a.number);

    // Copy: a equipe sobe como rascunho; admin pode mandar direto ao cliente
    const copyTa = el("textarea", { maxlength: "5000", placeholder: "Escreva a copy (legenda) do post" });
    const lastAny = copyVersions[0];
    if (lastAny) copyTa.value = lastAny.copy_text || "";
    const directCopy = me.role === "admin" ? el("label", { class: "row" }, el("input", { type: "checkbox" }), "Enviar direto ao cliente (pular revisão)") : null;
    const upCopy = el("button", { class: "btn dark", type: "button" }, copyVersions.length ? "Subir nova versão da copy" : "Subir copy");
    upCopy.addEventListener("click", async () => {
      upCopy.disabled = true;
      try {
        await GWork.uploadCopy(sb, { post: p, allVersions: d.all, text: copyTa.value, sent: !!directCopy?.querySelector("input").checked });
        await reload();
      } catch (e) { fail(e); upCopy.disabled = false; }
    });
    const canCopy = ["copy", "producao", "ajuste", "revisao"].includes(col) && (st.stage === "copy" || col === "copy");
    const arteVersions = d.all.filter((v) => v.post_id === p.id && v.stage === "arte").sort((a, b) => b.number - a.number);

    // Upload: equipe manda para revisão; admin escolhe
    const fileIn = el("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp,video/mp4" });
    const direct = me.role === "admin" ? el("label", { class: "row" }, el("input", { type: "checkbox" }), "Enviar direto ao cliente (pular revisão)") : null;
    const up = el("button", { class: "btn dark", type: "button" }, "Subir arte");
    up.addEventListener("click", async () => {
      up.disabled = true;
      try {
        const month = months.find((m) => m.id === monthId);
        const sent = !!direct?.querySelector("input").checked;
        await GWork.uploadArte(sb, { slug: month.slug, post: p, allVersions: d.all, files: fileIn.files, sent, onProgress: (t) => { out.textContent = t; } });
        await reload();
      } catch (e) { fail(e); up.disabled = false; }
    });

    const versionRow = (v) => {
      const dec = v.sent ? lastDecision(p.id, "arte", v.id) : null;
      const tag = !v.sent ? "Em revisão interna" : dec ? G.STATUS_LABEL[dec.status] : "Com o cliente";
      let sendBtn = null;
      if (!v.sent && me.role === "admin") {
        sendBtn = el("button", { class: "btn ok", type: "button" }, "Enviar ao cliente");
        sendBtn.addEventListener("click", async () => {
          const { error } = await sb.rpc("send_version", { p_version: v.id });
          error ? fail(error) : reload();
        });
      }
      return el("div", { class: "draft" },
        el("div", { class: "msg" }, `Arte v${v.number} · ${tag} · ${GWork.nameOf(d.team, v.author_email)} · ${GWork.when(v.created_at)}`),
        GWork.preview(v, d.urls), sendBtn);
    };

    const slideNotes = lastArteDec?.slide_notes ? Object.entries(lastArteDec.slide_notes) : [];
    return el("aside", { class: "kdetail", role: "dialog", "aria-label": p.title },
      el("div", { class: "row between" },
        el("span", { class: "eyebrow" }, COLS.find((c) => c.key === col).label),
        el("button", { class: "lb-close inline", type: "button", "aria-label": "Fechar", onclick: () => { openPost = null; render(); } }, "✕")),
      el("h3", {}, p.title),
      el("div", { class: "meta" },
        el("span", { class: "chip" }, G.FORMATS[p.format] || p.format),
        p.editoria ? el("span", { class: "chip ed" }, edName(p.editoria)) : null,
        el("span", {}, G.fmtDate(p.post_date).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }))),
      el("div", { class: "row" }, take, p.assignee ? el("span", { class: "msg" }, `Com ${GWork.nameOf(d.team, p.assignee)}`) : null),

      adjDec
        ? el("div", { class: "content-box alert" }, el("span", { class: "eyebrow" }, `Ajuste pedido pelo cliente · ${st.stage === "copy" ? "copy" : "arte"}`),
          adjDec.note || "", ...(st.stage === "arte" ? slideNotes : []).map(([k, v]) => el("div", {}, `Lâmina ${Number(k) + 1}: ${v}`))) : null,

      p.objective ? el("p", { class: "objective" }, `Objetivo: ${p.objective}`) : null,
      p.direction ? el("p", { class: "direction" }, p.direction) : null,
      (p.checklist || []).length ? el("div", { class: "must" }, el("div", { class: "eyebrow" }, "O que precisa constar na peça"),
        el("ul", {}, p.checklist.map((c) => el("li", {}, c)))) : null,
      copy && !canCopy ? el("div", { class: "content-box" }, el("span", { class: "eyebrow" }, `Copy aprovada · v${copy.number}`), copy.copy_text || "") : null,

      canCopy ? el("div", { class: "stack" },
        el("div", { class: "eyebrow" }, "Copy"), copyTa, directCopy, el("div", { class: "row" }, upCopy)) : null,
      copyVersions.length && canCopy ? el("div", { class: "stack" }, el("div", { class: "eyebrow" }, "Versões da copy"), copyVersions.map((v) => {
        const dec = v.sent ? lastDecision(p.id, "copy", v.id) : null;
        const tag = !v.sent ? "Em revisão interna" : dec ? G.STATUS_LABEL[dec.status] : "Com o cliente";
        let sb2 = null;
        if (!v.sent && me.role === "admin") {
          sb2 = el("button", { class: "btn ok", type: "button" }, "Enviar ao cliente");
          sb2.addEventListener("click", async () => { const { error } = await sb.rpc("send_version", { p_version: v.id }); error ? fail(error) : reload(); });
        }
        return el("div", { class: "draft" }, el("div", { class: "msg" }, `Copy v${v.number} · ${tag} · ${GWork.nameOf(d.team, v.author_email)} · ${GWork.when(v.created_at)}`), GWork.preview(v, d.urls), sb2);
      })) : null,

      col !== "espera" && col !== "agendado" && !(st.stage === "copy" && p.kind !== "oportunidade") ? el("div", { class: "stack" },
        el("div", { class: "eyebrow" }, "Subir arte"), fileIn, direct, el("div", { class: "row" }, up)) : null,
      arteVersions.length ? el("div", { class: "stack" }, el("div", { class: "eyebrow" }, "Versões da arte"), arteVersions.map(versionRow)) : null,

      el("div", { class: "stack" }, el("div", { class: "eyebrow" }, "Comentários internos"),
        GWork.comments(sb, d.comments, d.team, p.id, reload)),
      out);
  }

  function render() {
    const sel = el("select", { "aria-label": "Mês" }, months.map((m) => el("option", { value: m.id }, m.title)));
    sel.value = monthId;
    sel.addEventListener("change", async () => { monthId = sel.value; openPost = null; await load(); render(); });
    const p = openPost && d.posts.find((x) => x.id === openPost);
    app.replaceChildren(
      el("div", { class: "wrap kbar" }, el("h2", {}, "Kanban"), sel,
        el("span", { class: "msg" }, `${d.posts.length} posts · ${d.posts.filter((x) => x.assignee === me.email).length} com você`)),
      board(),
      p ? el("div", { class: "kshade", onclick: (e) => { if (e.target.classList.contains("kshade")) { openPost = null; render(); } } }, detail(p)) : "");
  }

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    me.role = await GAuth.role(sb);
    if (!me.role) return GAuth.noAccess(app, sb, user, boot);
    const { data: email } = await sb.rpc("auth_email");
    me.email = email || user.email;
    const nav = GAuth.nav("kanban.html", me.role === "admin");
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    if (me.role !== "admin" && !document.querySelector(".logout")) {
      document.getElementById("top-actions").prepend(el("button", { class: "theme-btn logout", type: "button", onclick: async () => { await sb.auth.signOut(); location.reload(); } }, "Sair"));
    }
    const { data: ms } = await sb.from("months").select("id, slug, title, created_at").order("created_at", { ascending: false });
    months = ms || [];
    if (!months.length) { app.replaceChildren(el("div", { class: "wrap" }, msg("Nenhum mês criado ainda."))); return; }
    monthId = months[0].id;
    await load();
    render();
  }
  boot();
})();
