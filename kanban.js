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
        el("span", {}, el("b", {}, `${dt.getDate()} ${G.MONTHS[dt.getMonth()]}`), " · ", G.FORMATS[p.format] || p.format),
        who ? avatar(p.assignee, who) : null),
      el("div", { class: "ktitle" }, p.title),
      el("div", { class: "kfoot" },
        el("span", { class: `kpill p-${sk}` }, (sk === "agendado" ? GWork.schedLabel(p) : SUB[sk].label) + (st.stage && ["revisao", "cliente", "ajuste", "producao"].includes(sk) ? ` · ${st.stage === "ambos" ? "copy + arte" : st.stage === "copy" ? "copy" : "arte"}` : "")),
        p.editoria ? el("span", { class: "ktag" }, edName(p.editoria)) : null,
        p.kind === "oportunidade" ? el("span", { class: "ktag opp" }, p.origin === "radar" ? "Radar · validado" : "Oportunidade") : null,
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

  const toast = G.toast;

  // Fecha o card com animação de saída e devolve o foco ao card no quadro
  function closeDetail() {
    const shade = app.querySelector(".kshade"); const id = openPost;
    const after = () => { openPost = null; render(); app.querySelector(`.kcard[data-id="${id}"]`)?.focus({ preventScroll: true }); };
    shade ? G.leave(shade, after) : after();
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
    const adjDec = st.col === "ajuste" && !st.internal ? (st.stage === "copy" ? lastCopyDec : lastArteDec) : null;
    const copyVersions = d.all.filter((v) => v.post_id === p.id && v.stage === "copy").sort((a, b) => b.number - a.number);

    // Copy e arte andam em paralelo até o post ir ao cliente
    const editable = !["espera", "cliente", "aprovado", "agendado"].includes(col);
    const canCopy = editable, canArte = editable;
    const arteVersions = d.all.filter((v) => v.post_id === p.id && v.stage === "arte").sort((a, b) => b.number - a.number);
    const curArte = arteVersions[0] || null;
    const curCopy = copyVersions[0] || null;

    // Etiqueta de uma versão: rascunho interno, com o cliente ou a decisão dele
    const vTag = (v, stage) => {
      if (!v.sent) return { text: "Em revisão interna", cls: "rev" };
      const dec = lastDecision(p.id, stage, v.id);
      if (!dec) return { text: "Com o cliente", cls: "cli" };
      return { text: G.STATUS_LABEL[dec.status] || dec.status, cls: dec.status === "aprovado" ? "ok" : dec.status === "reprovado" ? "bad" : "cli" };
    };
    const tagEl = (v, stage) => { const t = vTag(v, stage); return el("span", { class: `kd-tag ${t.cls}` }, `v${v.number} · ${t.text}`); };
    // Envio ao cliente agora é por post (bloco de revisão), não por versão avulsa
    const sendBtnFor = () => null;

    // ---------- Header: status e próxima ação primeiro ----------
    const NEXT = {
      espera: "Aguardando aprovação da pauta",
      copy: "Escrever texto da arte e legenda",
      fazer: "Produzir a arte",
      producao: "Subir a arte quando terminar",
      revisao: me.role === "admin" ? "Revisar e enviar ao cliente" : "Aguardando aprovação do Rapha",
      cliente: "Aguardando Wilker ou Letícia",
      ajuste: `Ajustar ${st.stage === "copy" ? "texto/legenda" : "a arte"} conforme o pedido${st.internal ? " do Rapha" : ""}`,
      aprovado: me.role === "admin" ? "Agendar a publicação" : "Aprovado · aguardando agendamento",
      agendado: GWork.schedLabel(p),
    };
    const dateTxt = G.fmtDate(p.post_date).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const nSlides = curArte?.asset_paths?.length || 0;
    const fact = (k, v) => v ? el("div", { class: "kd-fact" }, el("dt", {}, k), el("dd", {}, v)) : null;
    const head = el("header", { class: "kd-head" },
      el("div", { class: "kd-top" },
        el("span", { class: `kd-status s-${col}` }, SUB[col].label),
        el("span", { class: "kd-next" }, NEXT[col] || ""),
        el("button", { class: "lb-close inline", type: "button", "aria-label": "Fechar", onclick: closeDetail }, "✕")),
      el("h3", { id: "kd-title" }, p.title),
      el("dl", { class: "kd-facts" },
        fact("Publicação", dateTxt),
        fact("Formato", `${G.FORMATS[p.format] || p.format}${p.format === "carrossel" && nSlides ? ` · ${nSlides} lâminas` : ""}`),
        fact("Editoria", p.editoria ? edName(p.editoria) : "—"),
        el("div", { class: "kd-fact" }, el("dt", {}, "Responsável"),
          el("dd", { class: "kd-owner" }, p.assignee ? GWork.nameOf(d.team, p.assignee) : "Ninguém", take))),
      adjDec ? el("div", { class: "content-box alert" },
        el("span", { class: "eyebrow" }, `Ajuste pedido pelo cliente · ${st.stage === "copy" ? "texto e legenda" : "arte"}`),
        adjDec.note || "", st.stage === "arte" && Object.keys(adjDec.slide_notes || {}).length ? el("div", { class: "msg" }, "Os ajustes de cada lâmina aparecem junto dela, na arte.") : null) : null,
      st.internal ? el("div", { class: "content-box alert" },
        el("span", { class: "eyebrow" }, `Ajuste pedido pelo Rapha · ${st.stage === "copy" ? "texto e legenda" : "arte"}`), st.internal.review_note) : null,
      me.role === "admin" && ["aprovado", "agendado"].includes(col)
        ? GWork.schedulePanel(sb, p, async (on) => { await load(); render(); toast(on ? "Post agendado" : "Agendamento removido"); }) : null);

    // ---------- Briefing (recolhível, aberto enquanto ninguém produziu nada) ----------
    const hasBrief = p.objective || p.direction || (p.checklist || []).length;
    const brief = hasBrief ? el("details", { class: "kd-block kd-brief", open: !curArte && !curCopy ? "" : null },
      el("summary", {}, el("span", { class: "eyebrow" }, "Briefing")),
      p.objective ? el("p", { class: "objective" }, `Objetivo: ${p.objective}`) : null,
      p.direction ? el("p", { class: "direction" }, p.direction) : null,
      (p.checklist || []).length ? el("div", { class: "must" }, el("div", { class: "eyebrow" }, "O que precisa constar na peça"),
        el("ul", {}, p.checklist.map((c) => el("li", {}, c)))) : null) : null;

    // ---------- Envio: um botão só, cada pessoa vê a parte da sua função ----------
    // A função também é checada no banco (políticas de versions e storage).
    const fn = me.role === "admin" ? null : (d.team.find((t) => t.email === me.email)?.funcao || null);
    const mayCopy = canCopy && fn !== "arte";
    const mayArte = canArte && fn !== "copy";
    const month = months.find((m) => m.id === monthId);
    const isAdmin = me.role === "admin";
    // Tudo nasce como versão para aprovação; o admin já tenta mandar o post completo ao cliente
    const cmp = mayCopy || mayArte ? GWork.composer({
      sb, post: p, slug: month.slug, getVersions: () => d.all, prefill: curCopy,
      showCopy: mayCopy, showArte: mayArte, sent: false,
      sendLabel: isAdmin ? "Enviar ao cliente" : "Enviar para aprovação",
      draftNote: isAdmin ? "" : undefined,
      onDone: async (t) => {
        if (!isAdmin) { await reload(); return toast(t); }
        const { error } = await sb.rpc("send_post", { p_post: p.id });
        await reload();
        toast(error ? `Salvo. Ainda não foi ao cliente: ${error.message}` : "Enviado ao cliente ✓", !!error);
      },
    }) : null;
    const review = isAdmin ? GWork.reviewPanel({ sb, post: p, all: d.all, urls: d.urls, team: d.team,
      onChange: async (t) => { await reload(); toast(t); } }) : null;

    // ---------- Esquerda: texto da arte e legenda ----------
    const stories = p.format === "stories";
    const readText = (title, body) => el("section", { class: "kd-block" },
      el("div", { class: "kd-bh" }, el("span", { class: "eyebrow" }, title), curCopy ? tagEl(curCopy, "copy") : null),
      body ? el("div", { class: "kd-text" }, body) : el("p", { class: "msg" }, "Ainda não escrito."));
    const left = el("div", { class: "kd-col" },
      mayCopy ? el("section", { class: "kd-block" },
        el("div", { class: "kd-bh" }, el("span", { class: "eyebrow" }, "Texto e legenda"), curCopy ? tagEl(curCopy, "copy") : null),
        cmp.copyEl)
        : [readText(stories ? "Texto das telas" : "Texto da arte", curCopy?.copy_text), stories ? null : readText("Legenda", curCopy?.caption_text)],
      curCopy && !curCopy.sent ? sendBtnFor(curCopy) : null,
      copyVersions.length > 1 ? el("details", { class: "kd-hist" },
        el("summary", {}, `Versões anteriores do texto (${copyVersions.length - 1})`),
        copyVersions.slice(1).map((v) => el("div", { class: "draft" }, tagEl(v, "copy"),
          el("span", { class: "msg" }, ` ${GWork.nameOf(d.team, v.author_email)} · ${GWork.when(v.created_at)}`), GWork.preview(v, d.urls), sendBtnFor(v)))) : null);

    // ---------- Direita: carrossel da arte atual + novas artes ----------
    const curDec = curArte?.sent ? lastDecision(p.id, "arte", curArte.id) : null;
    const notes = curDec?.status === "reprovado" ? (curDec.slide_notes || {}) : {};
    const right = el("div", { class: "kd-col" },
      el("section", { class: "kd-block" },
        el("div", { class: "kd-bh" }, el("span", { class: "eyebrow" }, "Arte"), curArte ? tagEl(curArte, "arte") : null),
        curArte ? carousel(curArte.asset_paths || [], notes) : el("p", { class: "msg" }, "Nenhuma arte enviada ainda."),
        curArte ? sendBtnFor(curArte) : null,
        mayArte ? el("div", { class: "kd-upload" }, el("span", { class: "eyebrow" }, curArte ? "Nova versão da arte" : "Subir arte"), cmp.arteEl) : null),
      arteVersions.length > 1 ? el("details", { class: "kd-hist" },
        el("summary", {}, `Versões anteriores da arte (${arteVersions.length - 1})`),
        arteVersions.slice(1).map((v) => el("div", { class: "draft" }, tagEl(v, "arte"),
          el("span", { class: "msg" }, ` ${GWork.nameOf(d.team, v.author_email)} · ${GWork.when(v.created_at)}`), GWork.preview(v, d.urls), sendBtnFor(v)))) : null);
    const sendBar = cmp ? el("section", { class: "kd-block kd-send" }, cmp.actions) : null;

    return el("aside", { class: "kdetail kd", role: "dialog", "aria-modal": "true", "aria-labelledby": "kd-title" },
      head, brief,
      review ? el("section", { class: "kd-block" }, review) : null,
      el("div", { class: "kd-body" }, left, right),
      sendBar,
      el("section", { class: "kd-block kd-comments" }, el("span", { class: "eyebrow" }, "Comentários internos"),
        GWork.comments(sb, d.comments, d.team, p.id, reload)),
      out);
  }

  // Carrossel: setas, contador, pontos e o ajuste do cliente em cima de cada lâmina
  function carousel(paths, notes) {
    if (!paths.length) return null;
    const track = el("div", { class: "kc-track", tabindex: "0", "aria-label": "Lâminas da arte" },
      paths.map((path, i) => {
        const url = d.urls[path];
        const note = notes[String(i)];
        const media = /\.mp4$/i.test(path)
          ? el("video", { src: url, controls: true, preload: "metadata" })
          : el("a", { href: url, target: "_blank", rel: "noopener", "aria-label": `Abrir lâmina ${i + 1} em tamanho real` }, el("img", { src: url, alt: `Lâmina ${i + 1}`, loading: "lazy" }));
        return el("figure", { class: "kc-slide" }, media,
          note ? el("figcaption", { class: "kc-note" }, el("b", {}, `Ajuste na lâmina ${i + 1}`), note) : null);
      }));
    if (paths.length === 1) return el("div", { class: "kc" }, track);
    const count = el("span", { class: "kc-count" }, `1/${paths.length}`);
    const dots = el("div", { class: "kc-dots" }, paths.map((_, i) => el("button", {
      type: "button", class: `kc-dot${notes[String(i)] ? " has-note" : ""}`, "aria-label": `Ir para lâmina ${i + 1}`,
      onclick: () => go(i),
    })));
    const idx = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    const go = (i) => track.scrollTo({ left: Math.max(0, Math.min(paths.length - 1, i)) * track.clientWidth, behavior: "smooth" });
    const paint = () => {
      const i = idx();
      count.textContent = `${i + 1}/${paths.length}`;
      [...dots.children].forEach((b, k) => b.classList.toggle("on", k === i));
      prev.disabled = i === 0; next.disabled = i === paths.length - 1;
    };
    const prev = el("button", { type: "button", class: "kc-nav prev", "aria-label": "Lâmina anterior", onclick: () => go(idx() - 1) }, "‹");
    const next = el("button", { type: "button", class: "kc-nav next", "aria-label": "Próxima lâmina", onclick: () => go(idx() + 1) }, "›");
    let raf = 0;
    track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); });
    track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(idx() + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(idx() - 1); }
    });
    requestAnimationFrame(paint);
    return el("div", { class: "kc" }, el("div", { class: "kc-stage" }, track, prev, next), el("div", { class: "kc-bar" }, dots, count));
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
      p ? el("div", { class: `kshade${wasOpen ? " still" : ""}`, onclick: (e) => { if (e.target.classList.contains("kshade")) closeDetail(); } }, detail(p)) : "");
    // Foco no card só quando abre (não a cada recarga de dados)
    // Recarga com o card já aberto: sem animar de novo e sem voltar ao topo
    if (p && wasOpen) app.querySelector(".kshade").scrollTop = keepScroll;
    if (p) G.trapFocus(app.querySelector(".kshade"));
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
    if (e.key === "Escape" && openPost) closeDetail();
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
    GAuth.logout(sb);
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
