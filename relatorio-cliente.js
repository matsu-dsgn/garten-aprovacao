// Relatório mensal — visão do cliente (link do mês + token, sem login).
// A Edge Function "cliente" valida o token e só devolve relatórios publicados.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const params = new URLSearchParams(location.search);
  const slug = params.get("m");
  const token = new URLSearchParams(location.hash.slice(1)).get("k");
  if (slug && token) document.getElementById("top-actions").prepend(el("nav", { class: "topnav" },
    G.navLink(`index.html?m=${encodeURIComponent(slug)}#k=${encodeURIComponent(token)}`, "Pauta do mês", "pauta", false),
    G.navLink(`radar-cliente.html?m=${encodeURIComponent(slug)}#k=${encodeURIComponent(token)}`, "Radar", "radar", false),
    G.navLink(location.pathname.split("/").pop() + location.search + location.hash, "Relatório", "publicacoes", true)));

  const gate = (title, text) => app.replaceChildren(el("div", { class: "gate wrap" }, el("h1", {}, title), el("p", {}, text)));
  const label = (s) => { const { mes, ano } = GDeck.monthName(s); return `${mes[0].toUpperCase()}${mes.slice(1)} ${ano}`; };

  async function load(r) {
    const q = `${cfg.functionUrl}?m=${encodeURIComponent(slug)}&v=relatorio${r ? `&r=${encodeURIComponent(r)}` : ""}`;
    const res = await fetch(q, { headers: { "x-month-token": token } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Erro de conexão");
    return json;
  }

  async function show(r) {
    let d;
    try { d = await load(r); } catch (e) { return gate("Não deu para abrir", e.message); }
    if (!d.report) return gate("Relatório", "O primeiro relatório mensal aparece aqui assim que for publicado.");
    const slides = GDeck.build(d.report, d.urls || {});
    const select = d.list.length > 1 ? el("select", { "aria-label": "Mês", onchange: (e) => show(e.target.value) },
      d.list.map((s) => el("option", { value: s, selected: s === d.report.slug }, label(s)))) : null;
    app.replaceChildren(el("main", { class: "wrap rel-client" },
      el("section", { class: "rel-head" },
        el("h1", {}, el("span", {}, "Relatório de "), el("span", { class: "hl" }, label(d.report.slug).toLowerCase())),
        el("div", { class: "row" }, select,
          el("button", { class: "btn primary", type: "button", onclick: () => GDeck.present(slides) }, "Ver em tela cheia"),
          el("button", { class: "btn", type: "button", onclick: () => GDeck.print(slides) }, "Baixar PDF"))),
      el("div", { class: "rel-list" }, slides.map((s, i) => {
        const f = GDeck.thumb(s.cloneNode(true));
        f.tabIndex = 0; f.setAttribute("role", "button"); f.setAttribute("aria-label", `Abrir slide ${i + 1} em tela cheia`);
        f.addEventListener("click", () => GDeck.present(slides, i));
        f.addEventListener("keydown", (e) => { if (e.key === "Enter") GDeck.present(slides, i); });
        return f;
      }))));
  }

  addEventListener("resize", () => document.querySelectorAll(".rel-list .dk-frame").forEach((w) => GDeck.fit(w, w.firstChild)));
  if (!slug || !token) gate("Link incompleto", "Use o link do mês que a Garten enviou.");
  else show(null);
})();
