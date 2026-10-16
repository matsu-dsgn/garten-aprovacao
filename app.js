(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const params = new URLSearchParams(location.search);
  const slug = params.get("m");
  const token = new URLSearchParams(location.hash.slice(1)).get("k");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const openTab = {};
  let data = null;
  let pillarFocus = null; // pilar escolhido pelo usuário (filtra o calendário)
  let cycleTimer = null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
  };

  async function api(method, body) {
    const res = await fetch(`${cfg.functionUrl}?m=${encodeURIComponent(slug)}`, {
      method,
      headers: { "x-month-token": token, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Erro de conexão");
    return json;
  }

  const gate = (title, text) => app.replaceChildren(el("div", { class: "gate wrap" }, el("h1", {}, title), el("p", {}, text)));
  const norm = (s) => (s || "").trim().toLowerCase();

  // ---------- Editorias ----------
  // Linhas editoriais fixas (banco). Cada mês define o mix ideal em overview.mix.
  function pillars() {
    const mix = (data.month.overview || {}).mix || {};
    return (data.editorias || []).slice(0, 9).map((e) => ({
      slug: e.slug, nome: e.name, desc: e.description || "", shape: e.shape,
      count: data.posts.filter((p) => p.editoria === e.slug).length,
      ideal: Number.isFinite(+mix[e.slug]) ? +mix[e.slug] : null,
    }));
  }
  const edName = (slug) => ((data.editorias || []).find((e) => e.slug === slug) || {}).name || "";

  function counts() {
    const c = { aprovado: 0, ajuste: 0, pendente: 0 };
    for (const p of data.posts) {
      const s = G.postSummary(data, p);
      if (s === "aprovado") c.aprovado++;
      else if (s === "reprovado" || s === "contestado") c.ajuste++;
      else c.pendente++;
    }
    return c;
  }

  // ---------- Hero ----------
  function hero() {
    const ov = data.month.overview || {};
    const pils = pillars();
    const total = data.posts.length;
    const dates = data.posts.map((p) => G.fmtDate(p.post_date));
    const range = dates.length ? `de ${dates[0].getDate()} a ${dates[dates.length - 1].getDate()}` : "";

    const left = el("div", {},
      el("div", { class: "eyebrow neon" }, "Garten · Instagram"),
      el("h1", {}, el("span", { class: "ln off" }, "Pauta de"), el("span", { class: "ln hl" }, data.month.title)),
      el("p", { class: "sub" }, `${total} ${total === 1 ? "conteúdo" : "conteúdos"}${range ? ", " + range : ""}`),
      ov.intro ? el("p", { class: "intro" }, ov.intro) : null);

    if (!pils.length) return el("section", { class: "hero" }, GartenIso.outline("hero-mark"), el("div", { class: "wrap" }, left));

    const { svg, groups } = GartenIso.build(pils, pils.map((p) => p.count));
    const headName = el("b", {});
    const headCount = el("span", {});
    const chips = pils.map((p, i) => el("button", {
      class: "pil", type: "button", "aria-pressed": "false",
      onclick: () => { stopCycle(); pillarFocus = pillarFocus === i ? null : i; select(i, true); },
      onmouseenter: () => { if (pillarFocus == null) { stopCycle(); select(i); } },
    }, el("b", {}, p.nome), el("span", {}, `${p.count} ${p.count === 1 ? "post" : "posts"}`)));

    function select(i, user) {
      const p = pils[i];
      const pct = total ? Math.round((p.count / total) * 100) : 0;
      headName.textContent = `${p.nome} · ${pct}% do mês`;
      headCount.textContent = p.desc;
      groups.forEach((g, j) => g?.classList.toggle("on", j === i));
      chips.forEach((c, j) => c.setAttribute("aria-pressed", String(user ? pillarFocus === j : j === i)));
      if (user) applyCalendarFilter();
    }
    groups.forEach((g, i) => g?.addEventListener("click", () => chips[i].click()));

    let cur = pils.reduce((best, p, i) => (p.count > pils[best].count ? i : best), 0);
    select(cur);
    stopCycle();
    if (!reduce && pils.length > 1) cycleTimer = setInterval(() => { cur = (cur + 1) % pils.length; select(cur); }, 3200);

    return el("section", { class: "hero" }, GartenIso.outline("hero-mark"), el("div", { class: "wrap hero-grid" },
      left,
      el("div", { class: "iso-wrap" },
        el("div", { class: "eyebrow" }, "O mês por editoria · toque para filtrar o calendário"),
        svg, el("div", { class: "pil-head" }, headName, headCount), el("div", { class: "pils" }, chips))));
  }
  function stopCycle() { if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; } }

  function applyCalendarFilter() {
    const p = pillarFocus == null ? null : pillars()[pillarFocus];
    document.querySelectorAll("[data-ed]").forEach((n) => {
      n.style.opacity = !p || n.dataset.ed === p.slug ? "" : ".3";
    });
  }

  // ---------- Mix do mês: ideal x planejado ----------
  function mixChart() {
    const pils = pillars();
    const total = data.posts.length;
    if (!pils.length || !total) return null;
    const ov = data.month.overview || {};
    const hasIdeal = pils.some((p) => p.ideal != null);
    const rows = pils.map((p) => {
      const pct = Math.round((p.count / total) * 100);
      const gap = p.ideal == null ? 0 : pct - p.ideal;
      const flag = p.ideal == null || Math.abs(gap) < 10 ? null : gap > 0 ? "acima do ideal" : "abaixo do ideal";
      const fill = el("div", { class: "mix-fill" });
      requestAnimationFrame(() => setTimeout(() => { fill.style.width = `${pct}%`; }, 120));
      const marker = p.ideal != null ? el("div", { class: "mix-ideal", title: `Ideal ${p.ideal}%` }) : null;
      if (marker) marker.style.left = `${Math.min(100, p.ideal)}%`;
      return el("div", { class: "mix-row", "data-ed": p.slug },
        el("div", { class: "mix-name" }, el("b", {}, p.nome), el("span", {}, `${p.count} ${p.count === 1 ? "post" : "posts"}`)),
        el("div", { class: "mix-track", role: "img", "aria-label": `${p.nome}: ${pct}% planejado${p.ideal != null ? `, ideal ${p.ideal}%` : ""}` }, fill, marker),
        el("div", { class: "mix-val" }, el("b", {}, `${pct}%`),
          p.ideal != null ? el("span", {}, `ideal ${p.ideal}%`) : null,
          flag ? el("em", { class: gap > 0 ? "up" : "down" }, flag) : null));
    });
    return el("section", { class: "block wrap reveal", id: "mix" },
      el("div", { class: "sec-head" },
        el("div", {}, el("div", { class: "eyebrow" }, "O mix do mês"),
          el("h2", {}, hasIdeal ? "Ideal × planejado" : "Posts por editoria")),
        hasIdeal ? el("div", { class: "legend" },
          el("span", {}, el("i", { class: "mix-key-fill" }), "Planejado"),
          el("span", {}, el("i", { class: "mix-key-ideal" }), "Ideal do mês")) : null),
      el("div", { class: "mix" },
        ov.mix_motivo ? el("p", { class: "mix-why" }, ov.mix_motivo) : null,
        rows));
  }

  // ---------- Calendário ----------
  function calPost(p) {
    const s = G.postSummary(data, p);
    return el("button", {
      class: "cal-post", type: "button", "data-ed": p.editoria || "",
      onclick: () => goTo(p.id),
    }, el("b", {}, el("i", { class: `dot ${s}` }), p.title),
      el("span", {}, [G.FORMATS[p.format], edName(p.editoria)].filter(Boolean).join(" · ")));
  }

  function calendar() {
    if (!data.posts.length) return null;
    const first = G.fmtDate(data.posts[0].post_date);
    const last = G.fmtDate(data.posts[data.posts.length - 1].post_date);
    const byDay = {};
    for (const p of data.posts) (byDay[p.post_date] ||= []).push(p);
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // só as semanas que têm posts
    const start = new Date(first); start.setDate(start.getDate() - start.getDay());
    const end = new Date(last); end.setDate(end.getDate() + (6 - end.getDay()));
    const cells = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const posts = byDay[key(d)];
      const inRange = d >= first && d <= last;
      cells.push(el("div", { class: `cal-day ${posts ? "has" : ""} ${inRange ? "" : "out"} ${!posts && inRange ? "empty-day" : ""}` },
        el("div", { class: "cal-num" }, el("b", {}, d.getDate()), el("span", {}, G.DOW[d.getDay()])),
        posts ? posts.map(calPost) : null));
    }
    const list = Object.entries(byDay).map(([k, posts]) => {
      const d = G.fmtDate(k);
      return el("div", { class: "row-day" },
        el("div", {}, el("b", {}, d.getDate()), G.DOW[d.getDay()]),
        el("div", { class: "posts" }, posts.map(calPost)));
    });

    return el("section", { class: "block wrap reveal", id: "calendario" },
      el("div", { class: "sec-head" },
        el("div", {}, el("div", { class: "eyebrow" }, "O mês num relance · toque num post para ir até ele"),
          el("h2", {}, `${G.MONTHS[first.getMonth()][0].toUpperCase()}${G.MONTHS[first.getMonth()].slice(1)} ${first.getFullYear()}`)),
        el("div", { class: "legend" },
          el("span", {}, el("i", { class: "aprovado" }), "Aprovado"),
          el("span", {}, el("i", { class: "reprovado" }), "Ajuste"),
          el("span", {}, el("i", { class: "contestado" }), "Em discussão"),
          el("span", {}, el("i", {}), "Pendente"))),
      el("div", { class: "cal" },
        el("div", { class: "cal-grid" }, G.DOW.map((d) => el("div", { class: "cal-dow" }, d)), cells),
        el("div", { class: "cal-list" }, list)));
  }

  // ---------- Cards ----------
  function stageContent(post, stage, st) {
    if (stage === "pauta") return el("div", { class: "content-box" }, el("span", { class: "eyebrow" }, "Pauta"), "Aprove o tema e o direcional ao lado. Copy e arte vêm nas próximas etapas.");
    if (!st.version) return null;
    if (stage === "copy") return el("div", { class: "content-box" }, el("span", { class: "eyebrow" }, `Copy · versão ${st.version.number}`), st.version.copy_text || "");
    const paths = st.version.asset_paths || [];
    return el("div", {},
      el("div", { class: "eyebrow" }, `Arte · versão ${st.version.number}`),
      el("div", { class: "slides" }, paths.map((p, i) => {
        const url = data.urls[p];
        const media = /\.mp4$/i.test(p)
          ? el("video", { src: url, controls: true, preload: "metadata" })
          : el("img", { src: url, alt: `Lâmina ${i + 1}`, loading: "lazy" });
        return el("div", { class: "slide" }, media,
          post.format === "carrossel" && paths.length > 1
            ? el("textarea", { "data-slide": String(i), placeholder: `Obs. da lâmina ${i + 1}`, maxlength: "500" }) : null);
      })));
  }

  function decideForm(post, stage, st) {
    if (stage !== "pauta" && !st.version) return null;
    if (post.scheduled) return el("p", { class: "msg" }, "Post agendado. Mudanças agora viram pedido de alteração com a agência.");
    if (stage === "pauta" && G.pauteLocked(data, post)) return el("p", { class: "msg" }, "A arte já subiu, então a pauta está travada.");

    let actor = store.get("garten-approver") || "";
    const whoBtns = data.approvers.map((a) => el("button", {
      type: "button", "aria-pressed": String(actor === a.slug),
      onclick: (e) => {
        actor = a.slug; store.set("garten-approver", a.slug);
        whoBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      },
    }, a.name));
    const note = el("textarea", { placeholder: "Observação ou motivo do ajuste", maxlength: "1500" });
    const msg = el("p", { class: "msg", role: "status" });
    const ok = el("button", { class: "btn ok", type: "button" }, "Aprovar");
    const bad = el("button", { class: "btn bad", type: "button" }, "Pedir ajuste");

    async function send(status) {
      msg.className = "msg";
      if (!actor) { msg.className = "msg err"; msg.textContent = "Quem está respondendo?"; return; }
      if (status === "reprovado" && note.value.trim().length < 3) { msg.className = "msg err"; msg.textContent = "Conte o que precisa ajustar."; note.focus(); return; }
      const slide_notes = {};
      form.closest(".card-side")?.querySelectorAll("textarea[data-slide]").forEach((t) => {
        if (t.value.trim()) slide_notes[t.dataset.slide] = t.value.trim();
      });
      ok.disabled = bad.disabled = true; msg.textContent = "Salvando…";
      try {
        data = { ...data, ...(await api("POST", { post_id: post.id, stage, status, actor, note: note.value, slide_notes })) };
        refresh(post.id);
      } catch (e) { msg.className = "msg err"; msg.textContent = e.message; ok.disabled = bad.disabled = false; }
    }
    ok.addEventListener("click", () => send("aprovado"));
    bad.addEventListener("click", () => send("reprovado"));
    const form = el("div", { class: "decide" },
      el("div", { class: "eyebrow" }, "Resposta da Garten"),
      el("div", { class: "who" }, whoBtns), note, el("div", { class: "decide-row" }, ok, bad), msg);
    return form;
  }

  function card(post) {
    const d = G.fmtDate(post.post_date);
    const states = Object.fromEntries(G.STAGES.map((s) => [s.key, G.stageState(data, post, s.key)]));
    const current = openTab[post.id] || ["arte", "copy"].find((k) => states[k].version) || "pauta";
    const st = states[current];
    const longDate = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

    const tabs = G.STAGES.map((s) => el("button", {
      class: "stage-tab", type: "button", role: "tab", "aria-selected": String(s.key === current),
      disabled: s.key !== "pauta" && !states[s.key].version,
      onclick: () => { openTab[post.id] = s.key; refresh(post.id); },
    }, s.label, el("span", { class: `pill ${states[s.key].status}` }, G.STATUS_LABEL[states[s.key].status])));

    const side = el("div", { class: "card-side" },
      el("div", { class: "stages", role: "tablist" }, tabs),
      el("div", { class: "stage-body" },
        stageContent(post, current, st),
        st.last?.status === "contestado" ? el("p", { class: "msg" }, "A agência contestou o ajuste. Veja o argumento no histórico e decida de novo.") : null,
        decideForm(post, current, st),
        G.historyList(data, st.decisions)));

    const checklist = post.checklist || [];
    return el("article", { class: "card reveal", id: `post-${post.id}`, "data-status": G.postSummary(data, post) },
      el("div", { class: "date-col" }, el("b", {}, d.getDate()), el("span", {}, `${G.DOW[d.getDay()]} · ${G.MONTHS[d.getMonth()]}`)),
      el("div", { class: "card-body" },
        el("div", { class: "card-main" },
          el("h3", {}, post.title),
          el("div", { class: "meta" },
            el("span", { class: "mono" }, longDate[0].toUpperCase() + longDate.slice(1)),
            el("span", { class: "chip" }, G.FORMATS[post.format] || post.format),
            post.editoria ? el("span", { class: "chip ed" }, edName(post.editoria)) : null,
            post.theme ? el("span", {}, post.theme) : null,
            post.scheduled ? el("span", { class: "chip lock" }, "Agendado") : null),
          post.objective ? el("p", { class: "objective" }, `Objetivo: ${post.objective}`) : null,
          post.direction ? el("p", { class: "direction" }, post.direction) : null,
          checklist.length ? el("div", { class: "must" }, el("div", { class: "eyebrow" }, "O que precisa constar na peça"),
            el("ul", {}, checklist.map((c) => el("li", {}, c)))) : null),
        side));
  }

  // ---------- Barra fixa ----------
  function goTo(id) {
    document.getElementById(`post-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  function dock() {
    const c = counts();
    const next = el("button", { class: "btn dark", type: "button", disabled: c.pendente === 0 }, c.pendente ? "Próximo sem resposta" : "Tudo respondido ✓");
    next.addEventListener("click", () => {
      const pend = [...document.querySelectorAll('.card[data-status="pendente"]')];
      const after = pend.find((n) => n.getBoundingClientRect().top > 80) || pend[0];
      after?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
    const up = el("button", { class: "btn ghost", type: "button", onclick: () => document.getElementById("calendario")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" }) }, "↑ Calendário");
    const hidden = window.scrollY < (document.querySelector(".hero")?.offsetHeight || 0) - 80;
    return el("div", { class: `dock${hidden ? " hide" : ""}`, id: "dock", role: "region", "aria-label": "Progresso do mês" },
      el("div", { class: "counts" },
        el("span", { class: "count" }, el("b", {}, c.aprovado), " aprovados"),
        el("span", { class: "count" }, el("b", {}, c.ajuste), " com ajuste"),
        el("span", { class: "count" }, el("b", {}, c.pendente), " sem resposta")),
      up, next);
  }

  function observe() {
    const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.06 }) : null;
    document.querySelectorAll(".reveal:not(.in)").forEach((n) => io ? io.observe(n) : n.classList.add("in"));
  }

  // Re-render parcial: card alterado, calendário e barra, sem pular a página
  function refresh(postId) {
    const post = data.posts.find((p) => p.id === postId);
    const old = document.getElementById(`post-${postId}`);
    if (post && old) { const n = card(post); n.classList.add("in"); old.replaceWith(n); }
    const cal = document.getElementById("calendario"); const nc = calendar();
    if (cal && nc) { nc.classList.add("in"); cal.replaceWith(nc); applyCalendarFilter(); }
    document.getElementById("dock")?.replaceWith(dock());
  }

  function render() {
    app.replaceChildren(
      hero(),
      mixChart() || "",
      calendar() || "",
      el("section", { class: "block wrap" },
        el("div", { class: "eyebrow reveal" }, "Post a post"),
        data.posts.length ? el("div", { class: "cards" }, data.posts.map(card)) : el("p", { class: "empty-state" }, "Nenhum post cadastrado ainda.")),
      data.posts.length ? dock() : "");
    observe();
    const heroEl = document.querySelector(".hero");
    if (heroEl && "IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => document.getElementById("dock")?.classList.toggle("hide", e.isIntersecting), { threshold: 0.15 }).observe(heroEl);
    }
  }

  async function init() {
    if (!slug || !token) return gate("Link incompleto", "Peça para a agência reenviar o link do mês.");
    try {
      data = await api("GET");
      document.title = `Garten — ${data.month.title}`;
      render();
    } catch (e) { gate("Não foi possível abrir", e.message); }
  }
  init();
})();
