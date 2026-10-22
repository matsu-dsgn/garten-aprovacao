// Utilidades compartilhadas (cliente e admin). Tudo que vem do banco é renderizado com textContent.
window.G = (() => {
  const STAGES = [
    { key: "pauta", label: "Pauta" },
    { key: "copy", label: "Copy" },
    { key: "arte", label: "Arte" },
  ];
  const FORMATS = { estatico: "Estático", carrossel: "Carrossel", reels: "Reels", stories: "Stories" };
  const STATUS_LABEL = { aprovado: "Aprovado", reprovado: "Ajuste", contestado: "Em discussão", pendente: "Pendente", aguardando: "Aguardando" };

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  function latestVersion(versions, postId, stage) {
    return versions.filter((v) => v.post_id === postId && v.stage === stage)
      .sort((a, b) => b.number - a.number)[0] || null;
  }

  // Status efetivo de uma etapa = última decisão na versão atual
  function stageState(data, post, stage) {
    const v = stage === "pauta" ? null : latestVersion(data.versions, post.id, stage);
    if (stage !== "pauta" && !v) return { status: "aguardando", version: null, decisions: [], last: null };
    const decisions = data.decisions.filter((d) => d.post_id === post.id && d.stage === stage &&
      (stage === "pauta" ? d.version_id == null : d.version_id === v.id));
    const last = decisions[decisions.length - 1] || null;
    return { status: last ? last.status : "pendente", version: v, decisions, last };
  }

  function pauteLocked(data, post) {
    return data.versions.some((v) => v.post_id === post.id && v.stage === "arte");
  }

  function postSummary(data, post) {
    // status geral do card = etapa mais avançada que já existe
    const order = ["arte", "copy", "pauta"];
    for (const s of order) {
      const st = stageState(data, post, s);
      if (st.status !== "aguardando") return st.status;
    }
    return "pendente";
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const MONTHS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const DOW = ["dom","seg","ter","qua","qui","sex","sáb"];
  function when(ts) {
    return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function actorName(data, slug) {
    if (slug === "agencia") return "Agência";
    return (data.approvers.find((a) => a.slug === slug) || {}).name || slug;
  }

  function historyList(data, decisions) {
    if (!decisions.length) return null;
    return el("details", {},
      el("summary", {}, `Histórico (${decisions.length})`),
      el("ul", { class: "history" }, decisions.slice().reverse().map((d) =>
        el("li", { class: d.status },
          el("span", { class: "whoname" }, actorName(data, d.actor)), " — ", STATUS_LABEL[d.status] || d.status,
          el("time", {}, when(d.created_at)),
          d.note ? el("div", {}, d.note) : null,
          ...Object.entries(d.slide_notes || {}).map(([k, v]) => el("div", {}, `Lâmina ${Number(k) + 1}: ${v}`)),
        ))));
  }

  function logoMark() {
    // Placeholder geométrico — trocar pelo SVG oficial do símbolo em assets/simbolo.svg
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "brand-mark"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M3 4h5l4 4 4-4h5v5l-4 4h-5l-4-4H3zM3 13h5l4 4 4-4h5v5l-4 4H8l-5-5z");
    p.setAttribute("fill", "#6fff22");
    s.append(p);
    return s;
  }

  // Ícones do menu (traço, estilo Tabler), desenhados inline por causa do CSP
  const ICONS = {
    painel: ["M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1", "M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1", "M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1", "M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1"],
    kanban: ["M4 4h6", "M14 4h6", "M4 10a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z", "M14 10a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"],
    radar: ["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M15.51 15.56a5 5 0 1 0 -3.51 1.44", "M18.832 17.86a9 9 0 1 0 -6.832 3.14", "M12 12v9"],
    pauta: ["M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z", "M16 3v4", "M8 3v4", "M4 11h16"],
  };
  function icon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", class: "nav-ico", "aria-hidden": "true" })) s.setAttribute(k, v);
    for (const d of ICONS[name] || []) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.append(p); }
    return s;
  }
  // Link do menu com ícone
  const navLink = (href, label, iconName, on) => el("a", { href, class: on ? "on" : "", "aria-current": on ? "page" : false }, icon(iconName), el("span", {}, label));

  return { icon, navLink, STAGES, FORMATS, STATUS_LABEL, el, latestVersion, stageState, pauteLocked, postSummary, fmtDate, MONTHS, DOW, when, actorName, historyList, logoMark };
})();
