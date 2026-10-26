// Relatório mensal em slides (1920×1080), compartilhado entre o editor (admin) e a visão do cliente.
// Inspirado no relatório Sou Seara: capa → números do mês → cada rede (divisória, visão geral, leitura, top 3)
// → aprendizados → próximos passos → encerramento. Slides sem dado se escondem sozinhos.
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

  // Variação contra o mês anterior, em número absoluto (números pequenos viram percentuais enganosos)
  function vary(cur, prev, prevLabel) {
    if (prev == null || cur == null) return null;
    const d = Math.round(cur - prev);
    if (d === 0) return el("span", { class: "dk-var eq" }, `igual a ${prevLabel}`);
    return el("span", { class: `dk-var ${d > 0 ? "up" : "down"}` }, `${d > 0 ? "+" : "−"}${nf.format(Math.abs(d))} vs ${prevLabel}`);
  }

  // ---------- montagem da sequência ----------
  function plan(report) {
    const d = report.data || {}, t = report.texts || {}, hidden = new Set(report.hidden || []);
    const nets = Object.entries(d.networks || {});
    const has = (n) => (n?.current?.posts || 0) + (n?.current?.stories || 0) > 0;
    const out = [{ id: "capa", label: "Capa" }, { id: "overview", label: "O mês em números" }];
    for (const [k, n] of nets) {
      const auto = !has(n);
      out.push({ id: `${k}-div`, label: `${NET[k]} · abertura`, net: k, auto });
      out.push({ id: `${k}`, label: `${NET[k]} · visão geral`, net: k, auto });
      out.push({ id: `${k}-leitura`, label: `${NET[k]} · formato e editoria`, net: k, auto: auto || (n.byFormat || []).length + (n.byEditoria || []).length < 2 });
      out.push({ id: `${k}-top`, label: `${NET[k]} · melhores posts`, net: k, auto: !(n.top || []).length });
    }
    out.push({ id: "aprendizados", label: "Aprendizados", auto: !(t.learnings || []).filter(Boolean).length });
    out.push({ id: "proximos", label: "Próximos passos", auto: !(t.next_steps || []).filter(Boolean).length });
    out.push({ id: "fim", label: "Encerramento" });
    for (const s of out) { s.manual = hidden.has(s.id); s.hidden = s.manual || !!s.auto; }
    return out;
  }

  // ---------- slides ----------
  function slide(s, report, urls, page) {
    const d = report.data, t = report.texts || {};
    const { mes, ano } = monthName(d.slug);
    const prevLabel = monthName(d.prev_slug).mes;
    const foot = () => el("div", { class: "dk-foot" }, el("span", {}, `Relatório de ${mes} ${ano}`), el("span", {}, String(page).padStart(2, "0")));
    const S = (cls, ...kids) => el("section", { class: `dk-slide ${cls}`, "data-id": s.id }, ...kids);
    const n = s.net ? d.networks[s.net] : null;

    if (s.id === "capa") return S("bg-deep",
      symbol("dk-outline dk-outline--capa", true), logo(true),
      el("div", { class: "dk-capa" },
        el("p", { class: "dk-kicker" }, "Relatório mensal de redes sociais"),
        el("h1", { class: "dk-h1" }, "Relatório de"),
        el("h1", { class: "dk-h1 dk-hlt dk-indent" }, `${mes} ${ano}`)),
      el("div", { class: "dk-foot" }, el("span", {}, Object.keys(d.networks || {}).filter((k) => (d.networks[k].current?.posts || 0) > 0).map((k) => NET[k]).join(" e ") || "Instagram"), el("span", {})));

    if (s.id === "overview") {
      const nets = Object.entries(d.networks).filter(([, x]) => (x.current?.posts || 0) + (x.current?.stories || 0) > 0);
      const rows = [
        ["Posts no feed", (x) => x.current.posts, (x) => x.previous?.posts],
        ["Stories", (x) => x.current.stories, (x) => x.previous?.stories],
        ["Alcance somado dos posts", (x) => x.current.reach, (x) => x.previous?.reach],
        ["Compartilhamentos", (x) => x.current.shares, (x) => x.previous?.shares],
        ["Salvamentos", (x) => x.current.saved, (x) => x.previous?.saved],
        ["Seguidores", (x) => x.followers?.end, () => null],
      ];
      return S("bg-light",
        el("p", { class: "dk-kicker" }, `Visão geral · ${mes}`),
        el("h2", { class: "dk-h2" }, "O mês em números"),
        el("table", { class: "dk-table dk-table--big" },
          el("thead", {}, el("tr", {}, el("th", {}, ""), nets.map(([k]) => el("th", {}, NET[k])))),
          el("tbody", {}, rows.map(([label, cur, prev]) => el("tr", {}, el("th", { scope: "row" }, label),
            nets.map(([, x]) => el("td", {}, el("b", {}, num(cur(x))), vary(cur(x), prev(x), prevLabel))))))),
        foot());
    }

    if (s.id.endsWith("-div")) return S("bg-neon",
      symbol("dk-outline dk-outline--div", true),
      el("div", { class: "dk-div" }, el("p", { class: "dk-kicker" }, "Detalhe por rede"), el("h1", { class: "dk-giant" }, NET[s.net])),
      foot());

    if (n && s.id === s.net) {
      const c = n.current, a = n.account || {};
      const tile = (label, v, sub, strong) => el("div", { class: `dk-tile${strong ? " strong" : ""}` },
        el("span", { class: "dk-tile-l" }, label), el("b", { class: "dk-tile-n" }, typeof v === "string" ? v : num(v)), sub || null);
      const accTiles = s.net === "instagram"
        ? [["Visitas ao perfil", a.profile_views], ["Contas engajadas", a.accounts_engaged], ["Cliques no site", a.website_clicks]]
        : [["Visualizações da Página", a.page_media_view], ["Engajamento na Página", a.page_post_engagements]];
      const analysis = (t[`analysis_${s.net}`] || "").trim();
      return S("bg-deep",
        el("p", { class: "dk-kicker" }, NET[s.net]),
        el("h2", { class: "dk-h2" }, "Visão geral"),
        el("div", { class: "dk-grid" },
          tile("Compartilhamentos", c.shares, vary(c.shares, n.previous?.shares, prevLabel), true),
          tile("Salvamentos", c.saved, vary(c.saved, n.previous?.saved, prevLabel), true),
          tile("Alcance somado", c.reach, c.posts ? el("span", { class: "dk-sub" }, `média de ${num((c.reach || 0) / c.posts)} por post`) : null),
          tile("Interações", c.interactions, el("span", { class: "dk-sub" }, "curtidas, comentários, salvamentos e compartilhamentos")),
          tile("Posts", c.posts, el("span", { class: "dk-sub" }, c.stories ? `+ ${c.stories} Stories` : "no feed")),
          tile("Seguidores", n.followers?.end, n.followers?.start != null && n.followers.end !== n.followers.start
            ? el("span", { class: "dk-sub" }, `${n.followers.end - n.followers.start > 0 ? "+" : ""}${n.followers.end - n.followers.start} no mês`) : null)),
        accTiles.some(([, v]) => v != null) ? el("div", { class: "dk-acc" }, accTiles.filter(([, v]) => v != null).map(([l, v]) =>
          el("span", {}, el("b", {}, num(v)), ` ${l.toLowerCase()}`))) : null,
        analysis ? el("div", { class: "dk-note" }, el("span", { class: "dk-fio" }), el("p", {}, analysis)) : null,
        foot());
    }

    if (n && s.id.endsWith("-leitura")) {
      const table = (title, rows) => {
        const max = Math.max(0.01, ...rows.map((r) => r.shares + r.saved));
        return el("div", { class: "dk-read" }, el("h3", { class: "dk-h3" }, title),
          el("table", { class: "dk-table" },
            el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Posts"), el("th", {}, "Compart. + salvos (média)"), el("th", {}, "Alcance (média)"))),
            el("tbody", {}, rows.slice(0, 6).map((r) => el("tr", {}, el("th", { scope: "row" }, r.name), el("td", {}, String(r.posts)),
              el("td", {}, el("div", { class: "dk-bar" }, width(el("i"), (r.shares + r.saved) / max), el("span", {}, dec(r.shares + r.saved)))),
              el("td", {}, num(r.reach)))))));
      };
      return S("bg-light",
        el("p", { class: "dk-kicker" }, NET[s.net]),
        el("h2", { class: "dk-h2" }, "O que funcionou melhor"),
        el("div", { class: "dk-cols" }, table("Por formato", n.byFormat || []), table("Por editoria", n.byEditoria || [])),
        el("p", { class: "dk-small" }, "Média por post. Com poucos posts no mês, as diferenças pequenas ainda não são tendência."),
        foot());
    }

    if (n && s.id.endsWith("-top")) return S("bg-charcoal",
      el("p", { class: "dk-kicker" }, NET[s.net]),
      el("h2", { class: "dk-h2" }, (n.top || []).length === 1 ? "O post de destaque" : `Os ${(n.top || []).length} posts de destaque`),
      el("div", { class: "dk-top" }, (n.top || []).map((p, i) => {
        const href = safeUrl(p.permalink);
        const img = p.image && urls[p.image] ? el("img", { src: urls[p.image], alt: "", loading: "lazy" }) : el("span", { class: "dk-ph" });
        return el("article", { class: "dk-card" },
          el(href ? "a" : "div", { class: "dk-card-img", href: href || false, target: href ? "_blank" : false, rel: href ? "noopener" : false }, img,
            el("span", { class: "dk-rank" }, String(i + 1))),
          el("p", { class: "dk-card-t" }, p.title),
          el("p", { class: "dk-card-d" }, `${new Date(p.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · ${G.FORMATS[p.format] || p.format}`),
          el("div", { class: "dk-card-m" },
            el("span", {}, el("b", {}, num(p.shares)), " compart."), el("span", {}, el("b", {}, num(p.saved)), " salvos"),
            el("span", {}, el("b", {}, num(p.reach)), " alcance")));
      })),
      foot());

    if (s.id === "aprendizados") return S("bg-light",
      el("p", { class: "dk-kicker" }, `O que ${mes} ensinou`),
      el("h2", { class: "dk-h2" }, "Aprendizados"),
      el("ol", { class: "dk-list" }, (t.learnings || []).filter(Boolean).slice(0, 6).map((x) => el("li", {}, x))),
      foot());

    if (s.id === "proximos") return S("bg-deep",
      symbol("dk-outline dk-outline--side", true),
      el("p", { class: "dk-kicker" }, "Para o próximo mês"),
      el("h2", { class: "dk-h2" }, "Próximos passos"),
      el("ol", { class: "dk-list" }, (t.next_steps || []).filter(Boolean).slice(0, 6).map((x) => el("li", {}, x))),
      foot());

    return S("bg-neon dk-end",
      symbol("dk-end-sym", false),
      el("h1", { class: "dk-h1" }, "A base sólida"),
      el("h1", { class: "dk-h1 dk-hlt dk-indent" }, "para o seu próximo passo."),
      el("div", { class: "dk-foot" }, logo(false), el("span", {})));
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

  return { plan, build, thumb, fit, present, print, monthName };
})();
