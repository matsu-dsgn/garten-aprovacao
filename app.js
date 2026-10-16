(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const app = document.getElementById("app");
  const brand = document.getElementById("brand");
  brand.prepend(G.logoMark());

  const params = new URLSearchParams(location.search);
  const slug = params.get("m");
  const token = new URLSearchParams(location.hash.slice(1)).get("k");
  const openTab = {}; // post_id -> stage
  let data = null;

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

  function gate(title, text) {
    app.replaceChildren(el("div", { class: "gate wrap" }, el("h1", {}, title), el("p", {}, text)));
  }

  function countUp(node, to) {
    const start = performance.now(); const dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function hero() {
    const ov = data.month.overview || {};
    const counts = { total: data.posts.length, aprovado: 0, reprovado: 0, pendente: 0 };
    for (const p of data.posts) {
      const s = G.postSummary(data, p);
      if (s === "aprovado") counts.aprovado++;
      else if (s === "reprovado" || s === "contestado") counts.reprovado++;
      else counts.pendente++;
    }
    const ns = "http://www.w3.org/2000/svg";
    const line = document.createElementNS(ns, "svg");
    line.setAttribute("viewBox", "0 0 420 360"); line.setAttribute("class", "hero-line"); line.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M20 40 H150 L210 100 L270 40 H400 V150 L330 220 H230 L170 160 L110 220 V340");
    line.append(path);

    const stat = (cls, n, label) => {
      const b = el("b", {}, "0"); setTimeout(() => countUp(b, n), 200);
      return el("div", { class: `stat ${cls}` }, b, el("span", {}, label));
    };
    const title = data.month.title || "";
    return el("section", { class: "hero" }, line,
      el("div", { class: "wrap" },
        el("div", { class: "eyebrow neon" }, "Planejamento do mês"),
        el("h1", {}, title),
        ov.intro ? el("p", { class: "intro" }, ov.intro) : null,
        el("div", { class: "stats" },
          stat("", counts.total, "posts no mês"),
          stat("ok", counts.aprovado, "aprovados"),
          stat("", counts.reprovado, "com ajuste"),
          stat("", counts.pendente, "pendentes"))));
  }

  function pilares() {
    const list = (data.month.overview || {}).pilares || [];
    if (!list.length) return null;
    return el("section", { class: "block wrap reveal" },
      el("div", { class: "eyebrow" }, "Overview"),
      el("h2", {}, "Os assuntos do mês"),
      el("div", { class: "pilares" }, list.map((p) =>
        el("div", { class: "pilar" }, el("h3", {}, p.nome || ""), el("p", {}, p.desc || "")))));
  }

  function calendar() {
    if (!data.posts.length) return null;
    const first = G.fmtDate(data.posts[0].post_date);
    const y = first.getFullYear(), m = first.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const offset = new Date(y, m, 1).getDay();
    const byDay = {};
    for (const p of data.posts) {
      const d = G.fmtDate(p.post_date);
      if (d.getMonth() !== m) continue;
      (byDay[d.getDate()] ||= []).push(p);
    }
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(el("div", { class: "cal-day empty" }));
    for (let d = 1; d <= days; d++) {
      const posts = byDay[d];
      if (!posts) { cells.push(el("div", { class: "cal-day" }, d)); continue; }
      cells.push(el("button", {
        class: "cal-day has", type: "button", "aria-label": `${d}: ${posts.map((p) => p.title).join(", ")}`,
        onclick: () => document.getElementById(`post-${posts[0].id}`)?.scrollIntoView({ behavior: "smooth" }),
      }, d, el("span", { class: "dots" }, posts.map((p) => el("span", { class: `dot ${G.postSummary(data, p)}` })))));
    }
    return el("section", { class: "block wrap reveal" },
      el("div", { class: "eyebrow" }, "Calendário"),
      el("h2", {}, `${G.MONTHS[m][0].toUpperCase()}${G.MONTHS[m].slice(1)} ${y}`),
      el("div", { class: "cal" }, el("div", { class: "cal-grid" },
        G.DOW.map((d) => el("div", { class: "cal-dow" }, d)), cells)));
  }

  function stageContent(post, stage, st) {
    if (stage === "pauta") {
      return el("div", { class: "content-box" },
        el("span", { class: "label" }, "Direcional"), post.direction || "—");
    }
    if (!st.version) return el("div", { class: "content-box" }, stage === "copy" ? "A copy ainda não subiu." : "A arte ainda não subiu.");
    if (stage === "copy") {
      return el("div", { class: "content-box" },
        el("span", { class: "label" }, `Copy · versão ${st.version.number}`), st.version.copy_text || "");
    }
    const paths = st.version.asset_paths || [];
    return el("div", {},
      el("div", { class: "eyebrow" }, `Arte · versão ${st.version.number}`),
      el("div", { class: "slides" }, paths.map((p, i) => {
        const url = data.urls[p];
        const media = /\.mp4$/i.test(p)
          ? el("video", { src: url, controls: true, preload: "metadata" })
          : el("img", { src: url, alt: `Lâmina ${i + 1}`, loading: "lazy" });
        const children = [media];
        if (post.format === "carrossel" && paths.length > 1) {
          children.push(el("textarea", { "data-slide": String(i), placeholder: `Observação da lâmina ${i + 1} (opcional)`, maxlength: "500" }));
        }
        return el("div", { class: "slide" }, children);
      })));
  }

  function decideForm(post, stage, st) {
    if (stage !== "pauta" && !st.version) return null;
    let reason = null;
    if (post.scheduled) reason = "Post agendado. Mudanças agora viram pedido de alteração com a agência.";
    else if (stage === "pauta" && G.pauteLocked(data, post)) reason = "A arte já subiu, então a pauta está travada.";
    if (reason) return el("p", { class: "msg" }, reason);

    const select = el("select", { "aria-label": "Quem está aprovando" },
      el("option", { value: "" }, "Quem está aprovando?"),
      data.approvers.map((a) => el("option", { value: a.slug }, a.name)));
    select.value = store.get("garten-approver") || "";
    select.addEventListener("change", () => store.set("garten-approver", select.value));
    const note = el("textarea", { placeholder: "Observação ou motivo do ajuste", maxlength: "1500" });
    const msg = el("p", { class: "msg", role: "status" });

    async function send(status, btns, form) {
      msg.className = "msg";
      if (!select.value) { msg.className = "msg err"; msg.textContent = "Selecione quem está aprovando."; return; }
      if (status === "reprovado" && note.value.trim().length < 3) { msg.className = "msg err"; msg.textContent = "Conte o motivo do ajuste."; note.focus(); return; }
      const slide_notes = {};
      form.closest(".stage-body")?.querySelectorAll("textarea[data-slide]").forEach((t) => {
        if (t.value.trim()) slide_notes[t.dataset.slide] = t.value.trim();
      });
      btns.forEach((b) => (b.disabled = true));
      msg.textContent = "Salvando…";
      try {
        const next = await api("POST", { post_id: post.id, stage, status, actor: select.value, note: note.value, slide_notes });
        data = { ...data, ...next };
        render(post.id);
      } catch (e) {
        msg.className = "msg err"; msg.textContent = e.message;
        btns.forEach((b) => (b.disabled = false));
      }
    }
    const ok = el("button", { class: "btn ok", type: "button" }, "Aprovar");
    const bad = el("button", { class: "btn bad", type: "button" }, "Pedir ajuste");
    const form = el("div", { class: "decide" },
      el("div", { class: "decide-row" }, select), note, el("div", { class: "decide-row" }, ok, bad), msg);
    ok.addEventListener("click", () => send("aprovado", [ok, bad], form));
    bad.addEventListener("click", () => send("reprovado", [ok, bad], form));
    return form;
  }

  function card(post) {
    const d = G.fmtDate(post.post_date);
    const states = Object.fromEntries(G.STAGES.map((s) => [s.key, G.stageState(data, post, s.key)]));
    const defaultTab = ["arte", "copy"].find((k) => states[k].version) || "pauta";
    const current = openTab[post.id] || defaultTab;
    const body = el("div", { class: "stage-body" });

    const tabs = G.STAGES.map((s) => {
      const st = states[s.key];
      return el("button", {
        class: "stage-tab", type: "button", role: "tab", "aria-selected": String(s.key === current),
        disabled: s.key !== "pauta" && !st.version,
        onclick: () => { openTab[post.id] = s.key; render(post.id); },
      }, s.label, el("span", { class: `pill ${st.status}` }, G.STATUS_LABEL[st.status]));
    });

    const st = states[current];
    body.append(stageContent(post, current, st));
    if (st.last?.status === "contestado") {
      body.append(el("p", { class: "msg" }, "A agência contestou o ajuste. Vejam o argumento no histórico e decidam de novo."));
    }
    const form = decideForm(post, current, st);
    if (form) body.append(form);
    const hist = G.historyList(data, st.decisions);
    if (hist) body.append(hist);

    return el("article", { class: "card reveal", id: `post-${post.id}` },
      el("div", { class: "card-head" },
        el("div", { class: "date-badge" }, el("b", {}, d.getDate()), el("span", {}, G.DOW[d.getDay()])),
        el("div", {},
          el("div", { class: "chips" },
            el("span", { class: "chip fmt" }, G.FORMATS[post.format] || post.format),
            post.theme ? el("span", { class: "chip" }, post.theme) : null,
            post.scheduled ? el("span", { class: "chip lock" }, "Agendado") : null),
          el("h3", {}, post.title),
          post.objective ? el("p", { class: "obj" }, post.objective) : null)),
      el("div", { class: "stages", role: "tablist" }, tabs),
      body);
  }

  function observe() {
    const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.08 }) : null;
    document.querySelectorAll(".reveal").forEach((n) => io ? io.observe(n) : n.classList.add("in"));
  }

  function render(keepPostId) {
    if (keepPostId) {
      // re-render só o card alterado e o topo, sem pular a página
      const old = document.getElementById(`post-${keepPostId}`);
      const post = data.posts.find((p) => p.id === keepPostId);
      if (old && post) { const n = card(post); n.classList.add("in"); old.replaceWith(n); }
      const h = app.querySelector(".hero"); if (h) h.replaceWith(hero());
      const cal = app.querySelector(".cal")?.closest("section"); const nc = calendar(); if (cal && nc) { nc.classList.add("in"); cal.replaceWith(nc); }
      return;
    }
    app.replaceChildren(
      hero(),
      pilares(),
      calendar() || "",
      el("section", { class: "block wrap" },
        el("div", { class: "eyebrow reveal" }, "Posts"),
        el("h2", { class: "reveal" }, "Card a card"),
        data.posts.length
          ? el("div", { class: "cards" }, data.posts.map(card))
          : el("p", { class: "empty-state" }, "Nenhum post cadastrado ainda.")));
    observe();
  }

  async function init() {
    if (!slug || !token) return gate("Link incompleto", "Peça para a agência reenviar o link do mês.");
    try {
      data = await api("GET");
      document.title = `Garten — ${data.month.title}`;
      render();
    } catch (e) {
      gate("Não foi possível abrir", e.message);
    }
  }
  init();
})();
