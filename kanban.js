(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  // Colunas visuais: agrupam os estados reais do post (sub = estado fino)
  const COLS = [
    { key: "fazer", label: "A fazer", hint: "Arraste para Em produção para pegar" },
    { key: "producao", label: "Em produção" },
    { key: "revisao", label: "Revisão interna", hint: "Esperando o Rapha" },
    { key: "cliente", label: "Com o cliente", hint: "Wilker ou Letícia decidem" },
    { key: "ajuste", label: "Ajuste pedido" },
    { key: "pronto", label: "Pronto" },
  ];
  const SUB = G.KANBAN_SUB;
  let onlyMine = false;
  try { onlyMine = localStorage.getItem("garten-kanban-mine") === "1"; } catch { /* ok */ }

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

  // Coluna do card = estado real do post (regra compartilhada com o painel, em common.js)
  const state = (p) => G.kanbanState(d, p);
  const sub = (p) => state(p).col;
  const column = (p) => SUB[sub(p)].col;

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
  function dueTag(p) {
    if (["aprovado", "agendado"].includes(sub(p))) return null;
    const dt = G.fmtDate(p.post_date); const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((dt - today) / 864e5);
    if (days < 0) return el("span", { class: "ktag late" }, "Atrasado");
    if (days <= 3) return el("span", { class: "ktag due" }, days === 0 ? "Publica hoje" : days === 1 ? "Publica amanhã" : `Publica em ${days} dias`);
    return null;
  }

  function avatar(email, who) {
    const t = d.team.find((x) => x.email === email);
    const ini = who.trim().charAt(0).toUpperCase();
    const box = el("span", { class: "kav", title: who, "aria-label": `Com ${who}` }, ini);
    if (t?.avatar_url) {
      const img = el("img", { src: t.avatar_url, alt: "", referrerpolicy: "no-referrer", loading: "lazy", decoding: "async" });
      img.addEventListener("load", () => box.classList.add("has-img"));
      img.addEventListener("error", () => img.remove());
      box.append(img);
    }
    return box;
  }

  function cardEl(p) {
    const mine = p.assignee === me.email;
    const ncom = d.comments.filter((c) => c.post_id === p.id).length;
    const dt = G.fmtDate(p.post_date);
    const st = state(p); const sk = sub(p);
    const who = p.assignee ? GWork.nameOf(d.team, p.assignee) : null;
    const card = el("button", { class: `kcard s-${sk}${mine ? " mine" : ""}`, type: "button", "data-id": p.id,
      onclick: (e) => { if (card.dataset.dragged) { delete card.dataset.dragged; e.preventDefault(); return; } openPost = p.id; render(); } },
      el("div", { class: "kmeta" },
        el("span", {}, el("b", {}, dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")), " · ", G.FORMATS[p.format] || p.format),
        who ? avatar(p.assignee, who) : null),
      el("div", { class: "ktitle" }, p.title),
      el("div", { class: "kfoot" },
        el("span", { class: `kpill p-${sk}` }, (sk === "agendado" ? GWork.schedLabel(p) : SUB[sk].label) + (st.stage && ["revisao", "cliente", "ajuste", "producao"].includes(sk) ? ` · ${st.stage === "copy" ? "copy" : "arte"}` : "")),
        p.editoria ? el("span", { class: "ktag" }, edName(p.editoria)) : null,
        p.kind === "oportunidade" ? el("span", { class: "ktag opp" }, "Oportunidade") : null,
        dueTag(p),
        ncom ? el("span", { class: "kcom", "aria-label": `${ncom} comentários` }, `${ncom} coment.`) : null));
    card.addEventListener("pointerdown", (e) => startDrag(e, card, p));
    card.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || drag) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`); card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
    return card;
  }

  function board() {
    const list = onlyMine ? d.posts.filter((p) => p.assignee === me.email) : d.posts;
    const groups = Object.fromEntries(COLS.map((c) => [c.key, []]));
    for (const p of list) groups[column(p)].push(p);
    const total = list.length || 1;
    let i = 0;
    return el("div", { class: "kboard" }, COLS.map((c) => {
      const n = groups[c.key].length;
      return el("section", { class: `kcol k-${c.key}`, "data-col": c.key },
        el("header", { class: "khead" },
          el("div", { class: "khead-row" }, el("b", {}, c.label), el("span", { class: "kcount" }, `${n}/${list.length}`)),
          (() => { const i = el("i"); i.style.setProperty("--w", `${list.length ? Math.round((n / total) * 100) : 0}%`); return el("div", { class: "kbar-track" }, i); })()),
        el("p", { class: "khint", "aria-hidden": c.hint ? null : "true" }, c.hint || ""),
        el("div", { class: "kcards" }, n ? groups[c.key].map((p) => { const k = cardEl(p); k.style.setProperty("--i", i++); return k; })
          : el("div", { class: "kempty" }, "Nada aqui")));
    }));
  }

  // ---------- Arrastar ----------
  // A coluna é consequência do estado real. Soltar só dispara ações que existem:
  // A fazer → Em produção = pegar · Em produção → A fazer = soltar ·
  // Aprovado → Pronto (agendar) só admin · demais destinos abrem o card na ação.
  function dropAction(p, to) {
    const from = column(p); const sk = sub(p);
    if (from === to) return null;
    if (from === "fazer" && to === "producao" && sk !== "espera") return { kind: "claim", take: true };
    if (from === "producao" && to === "fazer" && p.assignee === me.email) return { kind: "claim", take: false };
    if (to === "revisao" && ["producao", "ajuste", "fazer"].includes(from) && sk !== "espera") return { kind: "open" };
    if (to === "cliente" && from === "revisao" && me.role === "admin") return { kind: "open" };
    return null;
  }

  let drag = null;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function startDrag(e, card, p) {
    if (e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    const x0 = e.clientX, y0 = e.clientY;
    let timer = null, started = false;
    const begin = (ev) => {
      started = true;
      const r = card.getBoundingClientRect();
      const ghost = card.cloneNode(true); ghost.classList.add("kghost");
      ghost.style.setProperty("--c", getComputedStyle(card).getPropertyValue("--c"));
      Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
      document.body.append(ghost);
      card.classList.add("kplaceholder"); card.dataset.dragged = "1";
      document.body.classList.add("kdragging");
      document.querySelectorAll(".kcol").forEach((c) => {
        const a = dropAction(p, c.dataset.col);
        c.classList.toggle("kcan", !!a); c.classList.toggle("kcant", !a && c.dataset.col !== column(p));
      });
      drag = { p, card, ghost, dx: ev.clientX - r.left, dy: ev.clientY - r.top, over: null };
      requestAnimationFrame(() => ghost.classList.add("lifted"));
      if (touch && navigator.vibrate) navigator.vibrate(8);
    };
    const move = (ev) => {
      if (!started) {
        if (touch) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cleanup(); return; }
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        begin(ev);
      }
      ev.preventDefault();
      drag.ghost.style.transform = `translate(${ev.clientX - drag.dx - parseFloat(drag.ghost.style.left)}px, ${ev.clientY - drag.dy - parseFloat(drag.ghost.style.top)}px) rotate(1.5deg) scale(1.02)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".kcol");
      document.querySelectorAll(".kcol.kover").forEach((c) => c !== under && c.classList.remove("kover"));
      if (under && under.classList.contains("kcan")) under.classList.add("kover");
      drag.over = under?.dataset.col || null;
    };
    const up = async () => {
      if (!started) return cleanup();
      const { p: post, over } = drag;
      const act = over ? dropAction(post, over) : null;
      await finish(act, over);
      if (act?.kind === "claim") {
        const { error } = await sb.rpc("claim_post", { p_post: post.id, p_take: act.take });
        if (error) return toast(error.message, true), render();
        await load(); render(); toast(act.take ? "Card é seu agora" : "Card voltou para A fazer");
      } else if (act?.kind === "open") { openPost = post.id; render(); }
      else if (over && over !== column(post)) toast("Essa etapa depende de outra ação");
      cleanup(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    };
    if (touch) timer = setTimeout(() => begin({ clientX: x0, clientY: y0 }), 350);
    addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }

  function finish(act, over) {
    const { ghost, card } = drag;
    return new Promise((res) => {
      const target = act && over ? document.querySelector(`.kcol[data-col="${over}"] .kcards`) : card;
      const r = (target || card).getBoundingClientRect();
      ghost.classList.remove("lifted");
      const done = () => {
        ghost.remove(); card.classList.remove("kplaceholder");
        document.body.classList.remove("kdragging");
        document.querySelectorAll(".kcol").forEach((c) => c.classList.remove("kcan", "kcant", "kover"));
        drag = null; res();
      };
      if (reduce()) return done();
      ghost.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s";
      ghost.style.transform = `translate(${r.left - parseFloat(ghost.style.left)}px, ${r.top - parseFloat(ghost.style.top)}px)`;
      if (act) ghost.style.opacity = "0";
      setTimeout(done, 230);
    });
  }

  function toast(text, bad = false) {
    const t = el("div", { class: `ktoast${bad ? " bad" : ""}`, role: "status" }, text);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add("on"));
    setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, 2600);
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
        el("span", { class: "eyebrow" }, SUB[col].label),
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

      me.role === "admin" && ["aprovado", "agendado"].includes(col)
        ? GWork.schedulePanel(sb, p, async (on) => { await load(); render(); toast(on ? "Post agendado" : "Agendamento removido"); }) : null,

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
    sel.addEventListener("change", async () => {
      monthId = sel.value; openPost = null;
      const m = months.find((x) => x.id === monthId);
      await load(); render();
    });
    const p = openPost && d.posts.find((x) => x.id === openPost);
    if (openPost && !p) openPost = null;
    syncUrl();
    const wasOpen = document.body.classList.contains("kmodal-open");
    const keepScroll = wasOpen ? app.querySelector(".kshade")?.scrollTop || 0 : 0;
    document.body.classList.toggle("kmodal-open", !!p);
    app.replaceChildren(
      el("div", { class: "kbar" },
        el("div", { class: "kbar-l" }, el("h2", {}, "Kanban"), sel),
        el("div", { class: "kbar-r" },
          el("span", { class: "msg" }, `${d.posts.length} posts · ${d.posts.filter((x) => x.assignee === me.email).length} com você`),
          el("button", { class: `kfilter${onlyMine ? " on" : ""}`, type: "button", "aria-pressed": String(onlyMine), onclick: () => {
            onlyMine = !onlyMine; try { localStorage.setItem("garten-kanban-mine", onlyMine ? "1" : "0"); } catch { /* ok */ }
            render();
          } }, "Só os meus"))),
      board(),
      p ? el("div", { class: `kshade${wasOpen ? " still" : ""}`, onclick: (e) => { if (e.target.classList.contains("kshade")) { openPost = null; render(); } } }, detail(p)) : "");
    // Foco no card só quando abre (não a cada recarga de dados)
    // Recarga com o card já aberto: sem animar de novo e sem voltar ao topo
    if (p && wasOpen) app.querySelector(".kshade").scrollTop = keepScroll;
    if (p && !wasOpen) app.querySelector(".kdetail .lb-close")?.focus();
  }

  // ?mes=slug&post=id: link direto para um card aberto
  function syncUrl() {
    const m = months.find((x) => x.id === monthId);
    const q = new URLSearchParams();
    if (m) q.set("mes", m.slug);
    if (openPost) q.set("post", openPost);
    history.replaceState(null, "", `?${q}`);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openPost) { openPost = null; render(); }
  });

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    me.role = await GAuth.role(sb);
    if (!me.role) return GAuth.noAccess(app, sb, user, boot);
    const { data: email } = await sb.rpc("auth_email");
    me.email = email || user.email;
    try { await sb.rpc("sync_my_avatar"); } catch { /* foto é opcional */ }
    const nav = GAuth.nav("kanban.html", me.role === "admin");
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    if (me.role !== "admin" && !document.querySelector(".logout")) {
      document.getElementById("top-actions").prepend(el("button", { class: "theme-btn logout", type: "button", onclick: async () => { await sb.auth.signOut(); location.reload(); } }, "Sair"));
    }
    const { data: ms } = await sb.from("months").select("id, slug, title, created_at").order("created_at", { ascending: false });
    months = ms || [];
    if (!months.length) { app.replaceChildren(el("div", { class: "wrap" }, msg("Nenhum mês criado ainda."))); return; }
    const want = new URLSearchParams(location.search).get("mes");
    monthId = (months.find((m) => m.slug === want) || months[0]).id;
    const wantPost = new URLSearchParams(location.search).get("post");
    if (wantPost && /^[0-9a-f-]{36}$/.test(wantPost)) openPost = wantPost;
    await load();
    render();
  }
  boot();
})();
