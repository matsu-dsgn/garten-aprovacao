// Relatório mensal em slides (1920×1080), compartilhado entre o editor (admin) e a visão do cliente.
// Mesma estrutura do relatório Sou Seara: capa → overview → comparativos → cada rede (divisória, overview,
// formato/editoria, o que bombou) → comentários → aprendizados → próximos passos → encerramento. Slides sem dado se escondem sozinhos.
// Todo texto entra via textContent (G.el); a CSP não permite style inline, larguras vão por CSSOM.
window.GDeck = (() => {
  const { el } = G;
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const NET = { instagram: "Instagram", facebook: "Facebook" };
  const nf = new Intl.NumberFormat("pt-BR");
  const num = (v) => (v == null ? "—" : nf.format(Math.round(v)));
  const dec = (v) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
  const monthName = (slug) => { const [y, m] = slug.split("-").map(Number); return { mes: MESES[m - 1], ano: y }; };
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };
  const SYM = "M478.4,108.9V25.9c0-14.3-11.6-25.9-25.9-25.9h-83c-6.9,0-13.4,2.7-18.3,7.6l-104.4,104.4c-4.9,4.9-7.6,11.4-7.6,18.3v27.9c0,7.8-9.4,11.7-15,6.2l-97.1-97.1c-4.9-4.9-11.4-7.6-18.3-7.6H25.9c-14.3,0-25.9,11.6-25.9,25.9v83c0,6.9,2.7,13.4,7.6,18.3l89.2,89.2,6.7,6.7c5.5,5.5,1.9,16-5.9,16H25.9c-14.3,0-25.9,11.6-25.9,25.9v83c0,6.9,2.7,13.4,7.6,18.3l104.4,104.4c4.9,4.9,11.4,7.6,18.3,7.6h83c14.3,0,25.9-11.6,25.9-25.9v-33.9h108.9c6.9,0,13.4-2.7,18.3-7.6l104.4-104.4c4.9-4.9,7.6-11.4,7.6-18.3v-83c0-14.3-11.6-25.9-25.9-25.9h-71c-7.8,0-12.7-10-7.2-15.5l96.5-96.5c4.9-4.9,7.6-11.4,7.6-18.3ZM342.8,255.2l-96,96c-4.9,4.9-7.6,11.4-7.6,18.3v26.4c0,7.8-10,12.7-15.5,7.2l-81.3-81.3-7.3-7.3c-5.7-5.7-1.7-15.5,6.4-15.5h71.8c14.3,0,25.9-11.6,25.9-25.9v-12.6c0-11.8,9.5-21.3,21.3-21.3h75.6c8.4,0,12.6,10.1,6.6,16Z";

  // SVG do símbolo (preenchido ou em contorno)
  function symbol(cls, outline) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 478.4 538"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path"); p.setAttribute("d", SYM);
    if (outline) { p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); }
    else p.setAttribute("fill", "currentColor");
    s.append(p); return s;
  }
  const logo = (dark) => el("img", { class: "dk-logo", src: dark ? "assets/logo.svg" : "assets/logo-deep-space-blue.svg", alt: "garten" });
  const width = (node, f) => { node.style.width = `${Math.max(1.5, Math.round(f * 100))}%`; return node; };

  // Variação contra o mês anterior. Base pequena (< 20) vira número absoluto: % sobre 3 posts engana.
  function pct(cur, prev) {
    if (prev == null || cur == null) return null;
    if (prev === 0) return cur === 0 ? { flat: true, text: "— igual" } : { up: true, text: "▲ novo" };
    const d = cur - prev;
    if (Math.abs(prev) < 20) {
      const r = Math.round(d * 10) / 10;
      if (!r) return { flat: true, text: "— igual" };
      return { up: r > 0, text: `${r > 0 ? "▲ +" : "▼ −"}${dec(Math.abs(r))}` };
    }
    const v = (d / Math.abs(prev)) * 100;
    if (Math.abs(v) < 0.05) return { flat: true, text: "— 0,0%" };
    return { up: v > 0, text: `${v > 0 ? "▲ +" : "▼ −"}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` };
  }
  // Taxa: diferença em pontos percentuais
  function pp(cur, prev) {
    if (prev == null || cur == null) return null;
    const r = Math.round((cur - prev) * 100) / 100;
    if (!r) return { flat: true, text: "— igual" };
    return { up: r > 0, text: `${r > 0 ? "▲ +" : "▼ −"}${Math.abs(r).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.` };
  }
  const pill = (v, suffix = "") => v ? el("span", { class: `dk-pill ${v.flat ? "flat" : v.up ? "up" : "down"}` }, v.text + (v.flat ? "" : suffix)) : null;
  const rate = (x) => (x && x.reach ? (x.interactions / x.reach) * 100 : null);
  const pctf = (v) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
  const RATE_HELP = "Taxa de engajamento = interações ÷ alcance × 100";

  // Aprendizados: 3 cartões {title, text}. Aceita o formato antigo (lista de frases).
  function learningsOf(t) {
    const raw = Array.isArray(t?.learnings) ? t.learnings : [];
    const out = raw.slice(0, 3).map((l) => typeof l === "string" ? { title: "", text: l } : { title: String(l?.title || ""), text: String(l?.text || "") });
    while (out.length < 3) out.push({ title: "", text: "" });
    return out;
  }
  const NETS_ORDER = ["instagram", "facebook"];
  const netsOf = (d) => Object.entries(d.networks || {}).sort(([a], [b]) => NETS_ORDER.indexOf(a) - NETS_ORDER.indexOf(b));
  const active = (n) => (n?.current?.posts || 0) + (n?.current?.stories || 0) > 0;

  // ---------- montagem da sequência ----------
  function plan(report) {
    const d = report.data || {}, t = report.texts || {}, hidden = new Set(report.hidden || []);
    const nets = netsOf(d);
    const out = [{ id: "capa", label: "Capa", type: "capa" }, { id: "overview", label: "Overview do mês", type: "overview" }];
    for (const [k, n] of nets) out.push({ id: `${k}-cmp`, label: `Comparativo — ${NET[k]}`, type: "cmp", net: k, auto: !active(n) || !n.previous });
    for (const [k, n] of nets) {
      const off = !active(n);
      out.push({ id: `${k}-div`, label: `Divisória — ${NET[k]}`, type: "div", net: k, auto: off });
      out.push({ id: `${k}`, label: `Overview ${NET[k]}`, type: "rede", net: k, auto: off });
      out.push({ id: `${k}-leitura`, label: `Formato e editoria — ${NET[k]}`, type: "leitura", net: k, auto: off || (n.byFormat || []).length + (n.byEditoria || []).length < 2 });
      out.push({ id: `${k}-top`, label: `O que bombou — ${NET[k]}`, type: "top", net: k, auto: !(n.top || []).length });
    }
    out.push({ id: "comentarios", label: "Análise de comentários", type: "comentarios", auto: !(t.comments || "").trim() });
    out.push({ id: "aprendizados", label: "Aprendizados do mês", type: "aprendizados", auto: !learningsOf(t).some((l) => l.title || l.text) });
    out.push({ id: "proximos", label: "Próximos passos", type: "proximos", auto: !(t.next_steps || []).filter(Boolean).length });
    out.push({ id: "fim", label: "Encerramento", type: "fim" });
    for (const s of out) { s.manual = hidden.has(s.id); s.hidden = s.manual || !!s.auto; }
    return out;
  }

  // ---------- slides ----------
  function slide(s, report, urls, page) {
    const d = report.data, t = report.texts || {};
    const { mes, ano } = monthName(d.slug);
    const Mes = `${mes[0].toUpperCase()}${mes.slice(1)} ${ano}`;
    const prevName = monthName(d.prev_slug || d.slug).mes;
    const foot = () => el("div", { class: "dk-foot" }, el("span", {}, `Garten · Relatório de redes · ${Mes}`), el("span", {}, page ? String(page).padStart(2, "0") : ""));
    const S = (cls, ...kids) => el("section", { class: `dk-slide ${cls}`, "data-id": s.id }, ...kids);
    const head = (kicker, title) => el("div", { class: "dk-head" }, el("p", { class: "dk-kicker" }, kicker), el("h2", { class: "dk-h2" }, title));
    const n = s.net ? d.networks[s.net] : null;

    if (s.type === "capa") return S("bg-deep",
      symbol("dk-outline dk-outline--capa", true), logo(true),
      el("div", { class: "dk-capa" },
        el("p", { class: "dk-kicker" }, "Relatório mensal de redes sociais"),
        el("h1", { class: "dk-h1" }, "Relatório de"),
        el("h1", { class: "dk-h1 dk-hlt dk-indent" }, `${mes} ${ano}`)),
      el("div", { class: "dk-foot" }, el("span", {}, netsOf(d).filter(([, x]) => active(x)).map(([k]) => NET[k]).join(" e ") || "Instagram"), el("span", {})));

    if (s.type === "overview") {
      const nets = netsOf(d).filter(([, x]) => active(x));
      const tot = (f) => nets.reduce((a, [, x]) => a + (f(x) || 0), 0);
      const totPrev = (f) => nets.some(([, x]) => x.previous) ? nets.reduce((a, [, x]) => a + (x.previous ? f(x.previous) || 0 : 0), 0) : null;
      const rows = nets.map(([k, x]) => {
        const f = x.followers || {}, gain = f.end != null && f.start != null && f.start !== f.end ? f.end - f.start : null;
        return el("div", { class: "dk-ov-row" },
          el("span", { class: "dk-ov-net" }, NET[k]),
          el("span", { class: "dk-ov-cell" }, el("b", { class: "dk-ov-box" }, num(f.end)), el("span", { class: "dk-cap" }, "Total")),
          el("span", { class: "dk-ov-cell" }, gain != null
            ? el("span", { class: `dk-pill ${gain > 0 ? "up" : "down"}` }, `${gain > 0 ? "▲ +" : "▼ −"}${num(Math.abs(gain))}`)
            : el("span", { class: "dk-pill flat" }, f.end == null ? "sem histórico" : "começou agora"),
            el("span", { class: "dk-cap" }, "Ganhos no mês")));
      });
      const totalF = nets.every(([, x]) => x.followers?.end != null) ? tot((x) => x.followers.end) : null;
      const metric = (label, f) => el("div", { class: "dk-ov-metric" }, el("span", { class: "dk-cap dk-cap--l" }, label),
        el("b", { class: "dk-ov-mbox" }, num(tot((x) => f(x.current)))), pill(pct(tot((x) => f(x.current)), totPrev(f)), " vs mês ant."));
      return S("bg-light",
        head(Mes, "Overview do mês"),
        el("div", { class: "dk-ov" },
          el("section", { class: "dk-ov-left" }, el("p", { class: "dk-sec" }, "Evolução da comunidade"), rows,
            el("div", { class: "dk-ov-total" }, el("span", {}, "Total de seguidores"), el("b", {}, num(totalF)))),
          el("section", { class: "dk-ov-right" }, el("p", { class: "dk-sec" }, "Números totais das redes"),
            el("div", { class: "dk-ov-grid" },
              metric("Publicações", (c) => c.posts), metric("Alcance", (c) => c.reach),
              metric("Compartilhamentos", (c) => c.shares), metric("Salvamentos", (c) => c.saved)))),
        foot());
    }

    if (s.type === "cmp") {
      const c = n.current, p = n.previous || {};
      const tiles = [["rate", "Taxa de engajamento"], ["shares", "Compartilhamentos"], ["saved", "Salvamentos"],
        ["posts", "Publicações"], ["reach", "Alcance"], ["interactions", "Interações"]].map(([k, label], i) => {
        const isRate = k === "rate", cur = isRate ? rate(c) : c[k], prv = isRate ? rate(p) : p[k];
        return el("div", { class: `dk-ctile${i === 0 ? " hero" : ""}` }, el("span", { class: "dk-cap dk-cap--l" }, label),
          isRate
            ? el("div", { class: "dk-flow dk-flow--stack" }, el("span", { class: "dk-flow-prev" }, el("span", { class: "dk-was" }, pctf(prv)), el("span", { class: "dk-arrow", "aria-hidden": "true" }, "↓")),
              el("b", { class: "dk-now" }, pctf(cur)))
            : el("div", { class: "dk-flow" }, el("span", { class: "dk-was" }, num(prv)), el("span", { class: "dk-arrow", "aria-hidden": "true" }, "→"),
              el("b", { class: "dk-now" }, num(cur))),
          pill(isRate ? pp(cur, prv) : pct(cur, prv)) || el("span", { class: "dk-pill flat" }, "sem base"));
      });
      return S("bg-pale", head(`${prevName} → ${Mes}`, `${NET[s.net]}: mês anterior × atual`), el("div", { class: "dk-cmp" }, tiles), foot());
    }

    if (s.type === "div") return S("bg-neon",
      symbol("dk-outline dk-outline--div", true),
      el("div", { class: "dk-div" }, el("p", { class: "dk-kicker" }, "Resultados do"), el("h1", { class: "dk-giant" }, NET[s.net]),
        el("p", { class: "dk-div-mes" }, Mes)),
      foot());

    if (s.type === "rede") {
      const c = n.current, p = n.previous, a = n.account || {}, f = n.followers || {};
      const k = (label, v, prevV, hero, sub) => el("div", { class: `dk-kpi${hero ? " hero" : ""}` }, el("span", { class: "dk-cap dk-cap--l" }, label),
        el("b", { class: "dk-kpi-n" }, typeof v === "string" ? v : num(v)), p && prevV !== undefined ? pill(pct(typeof v === "number" ? v : null, prevV), " vs mês ant.") : null,
        sub ? el("span", { class: "dk-kpi-sub" }, sub) : null);
      const extra = s.net === "instagram" ? ["Visitas ao perfil", a.profile_views] : ["Visualizações da Página", a.page_media_view];
      const analysis = (t[`analysis_${s.net}`] || "").trim();
      return S("bg-light",
        head(Mes, `Overview ${NET[s.net]}`),
        el("div", { class: "dk-rede" },
          el("div", { class: "dk-kpis" },
            k("Compartilhamentos", c.shares, p?.shares, true), k("Salvamentos", c.saved, p?.saved, true),
            el("div", { class: "dk-kpi hero dk-kpi--rate" }, el("span", { class: "dk-cap dk-cap--l" }, "Taxa de engajamento"),
              el("b", { class: "dk-kpi-n" }, pctf(rate(c))), p ? pill(pp(rate(c), rate(p)), " vs mês ant.") : null, el("span", { class: "dk-kpi-sub" }, RATE_HELP)),
            k("Alcance", c.reach, p?.reach), k("Visualizações", c.views, p?.views), k("Interações", c.interactions, p?.interactions),
            k("Seguidores", f.end), k("Publicações", c.posts, p?.posts, false, c.stories ? `+ ${c.stories} Stories` : null), k(extra[0], extra[1])),
          el("div", { class: "dk-analise" }, el("p", { class: "dk-h3" }, "Análise do mês"), el("p", { class: "dk-analise-t" }, analysis || "—"))),
        foot());
    }

    if (s.type === "leitura") {
      const table = (title, rows) => {
        const max = Math.max(0.01, ...rows.map((r) => r.shares + r.saved));
        return el("div", { class: "dk-read" }, el("p", { class: "dk-sec" }, title),
          el("table", { class: "dk-table" },
            el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Posts"), el("th", {}, "Compart. + salvos (média)"), el("th", {}, "Alcance (média)"))),
            el("tbody", {}, rows.slice(0, 6).map((r) => el("tr", {}, el("th", { scope: "row" }, r.name), el("td", {}, String(r.posts)),
              el("td", {}, el("div", { class: "dk-bar" }, width(el("i"), (r.shares + r.saved) / max), el("span", {}, dec(r.shares + r.saved)))),
              el("td", {}, num(r.reach)))))));
      };
      return S("bg-light",
        head(NET[s.net], "O que funcionou melhor"),
        el("div", { class: "dk-cols" }, table("Por formato", n.byFormat || []), table("Por editoria", n.byEditoria || [])),
        el("p", { class: "dk-small" }, "Média por post. Com poucos posts no mês, diferenças pequenas ainda não são tendência."),
        foot());
    }

    if (s.type === "top") return S("bg-pale",
      head(NET[s.net], "O que bombou"),
      el("div", { class: "dk-top" }, (n.top || []).map((p, i) => {
        const href = safeUrl(p.permalink);
        const img = p.image && urls[p.image] ? el("img", { src: urls[p.image], alt: "", loading: "lazy" }) : el("span", { class: "dk-ph" });
        return el("article", { class: "dk-card" },
          el("span", { class: "dk-rank" }, `#${i + 1}`),
          el("div", { class: "dk-card-body" },
            el(href ? "a" : "div", { class: `dk-card-img ${p.format === "reels" || p.format === "stories" ? "r916" : "r34"}`, href: href || false, target: href ? "_blank" : false, rel: href ? "noopener" : false }, img),
            el("p", { class: "dk-card-t" }, p.title),
            el("p", { class: "dk-card-d" }, `${new Date(p.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · ${G.FORMATS[p.format] || p.format}`),
            el("dl", { class: "dk-card-m" },
              el("div", {}, el("dt", {}, "Compartilhamentos"), el("dd", {}, num(p.shares))),
              el("div", {}, el("dt", {}, "Salvamentos"), el("dd", {}, num(p.saved))),
              el("div", {}, el("dt", {}, "Alcance"), el("dd", {}, num(p.reach))),
              el("div", {}, el("dt", {}, "Curtidas e coment."), el("dd", {}, num((p.likes || 0) + (p.comments || 0)))))));
      })),
      foot());

    if (s.type === "comentarios") return S("bg-deep",
      head(Mes, "Análise de comentários"),
      el("div", { class: "dk-box-note" }, el("p", {}, (t.comments || "").trim() || "—")),
      foot());

    if (s.type === "aprendizados") return S("bg-light",
      head(Mes, "Aprendizados do mês"),
      el("div", { class: "dk-learn" }, learningsOf(t).map((l, i) => el("article", {},
        el("span", { class: "dk-learn-n" }, String(i + 1)),
        el("h3", { class: "dk-learn-t" }, l.title || "—"),
        el("p", { class: "dk-learn-d" }, l.text)))),
      foot());

    if (s.type === "proximos") return S("bg-deep",
      symbol("dk-outline dk-outline--side", true),
      head("Para o próximo mês", "Próximos passos"),
      el("ol", { class: "dk-list" }, (t.next_steps || []).filter(Boolean).slice(0, 6).map((x) => el("li", {}, x))),
      foot());

    return S("bg-neon dk-end",
      symbol("dk-end-sym", false),
      el("h1", { class: "dk-h1" }, "A base sólida"),
      el("h1", { class: "dk-h1 dk-hlt dk-indent" }, "para o seu próximo passo."),
      el("div", { class: "dk-foot" }, logo(false), el("span", {})));
  }

  // Um slide específico (o editor mostra até os escondidos)
  function one(report, urls, id) {
    const p = plan(report), s = p.find((x) => x.id === id) || p[0];
    const visible = p.filter((x) => !x.hidden);
    const page = visible.indexOf(s) + 1;
    return slide(s, report, urls || {}, page || 0);
  }

  function build(report, urls) {
    let page = 0;
    return plan(report).filter((s) => !s.hidden).map((s) => slide(s, report, urls || {}, ++page));
  }

  // Escala um slide 1920×1080 para caber no contêiner
  function fit(wrapper, slideEl) {
    const k = Math.min(wrapper.clientWidth / 1920, (wrapper.clientHeight || wrapper.clientWidth * 9 / 16) / 1080);
    slideEl.style.transform = `scale(${k})`;
    wrapper.style.height = `${1080 * k}px`;
  }
  function thumb(slideEl) {
    const w = el("div", { class: "dk-frame" }, slideEl);
    requestAnimationFrame(() => fit(w, slideEl));
    return w;
  }

  // Apresentação em tela cheia: setas, espaço, Esc
  function present(slides, start = 0) {
    let i = start;
    const stage = el("div", { class: "dk-present", role: "dialog", "aria-label": "Apresentação do relatório", tabindex: "-1" });
    const count = el("span", { class: "dk-count" });
    const show = () => {
      i = Math.max(0, Math.min(slides.length - 1, i));
      const s = slides[i].cloneNode(true);
      stage.replaceChildren(s, count, prev, next, close);
      const k = Math.min(innerWidth / 1920, innerHeight / 1080);
      s.style.transform = `translate(-50%, -50%) scale(${k})`;
      count.textContent = `${i + 1} / ${slides.length}`;
    };
    const chev = (d) => { const ns = "http://www.w3.org/2000/svg"; const v = document.createElementNS(ns, "svg"); v.setAttribute("viewBox", "0 0 24 24"); v.setAttribute("aria-hidden", "true");
      const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round"); v.append(p); return v; };
    const prev = el("button", { class: "dk-nav dk-prev", type: "button", "aria-label": "Slide anterior", onclick: () => { i--; show(); } }, chev("M15 6l-6 6l6 6"));
    const next = el("button", { class: "dk-nav dk-next", type: "button", "aria-label": "Próximo slide", onclick: () => { i++; show(); } }, chev("M9 6l6 6l-6 6"));
    const close = el("button", { class: "dk-close", type: "button", "aria-label": "Sair da apresentação", onclick: () => stop() }, "Sair");
    const key = (e) => {
      if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key)) { e.preventDefault(); i++; show(); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); i--; show(); }
      else if (e.key === "Escape") stop();
    };
    function stop() {
      document.removeEventListener("keydown", key); removeEventListener("resize", show); stage.remove();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    document.addEventListener("keydown", key); addEventListener("resize", show);
    document.body.append(stage); show(); stage.focus();
    stage.requestFullscreen?.().catch(() => {});
    document.addEventListener("fullscreenchange", function fs() { if (!document.fullscreenElement && stage.isConnected) { document.removeEventListener("fullscreenchange", fs); stop(); } });
  }

  // PDF: abre a impressão com um slide por página (1920×1080)
  function print(slides) {
    const box = el("div", { class: "dk-print" }, slides.map((s) => s.cloneNode(true)));
    document.body.append(box); document.body.classList.add("dk-printing");
    const done = () => { box.remove(); document.body.classList.remove("dk-printing"); removeEventListener("afterprint", done); };
    addEventListener("afterprint", done);
    setTimeout(() => window.print(), 300);
  }

  return { plan, build, one, thumb, fit, present, print, monthName, learningsOf };
})();
