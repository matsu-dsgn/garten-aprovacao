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

  function historyList(data, decisions, label) {
    if (!decisions.length) return null;
    return el("details", {},
      el("summary", {}, `Histórico${label ? ` da ${label}` : ""} (${decisions.length})`),
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
    publicacoes: ["M3 13a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1z", "M10 9a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1z", "M17 5a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1z"],
    relogio: ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 7v5l3 3"],
    historico: ["M12 8v4l2 2", "M3.05 11a9 9 0 1 1 .5 4", "M3 20v-5h5"],
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

  // Horário estimado das novidades = início da varredura + duração média das últimas
  // (a varredura começa 8h40, em dia útil). Sem histórico, assume 20 min.
  function radarTiming(runs = [], now = new Date()) {
    const done = runs.filter((r) => r.finished_at).slice(0, 10)
      .map((r) => (new Date(r.finished_at) - new Date(r.run_at)) / 6e4).filter((m) => m > 0 && m < 180);
    const avg = done.length ? done.reduce((a, b) => a + b, 0) / done.length : 20;
    const mins = Math.min(90, Math.max(15, Math.ceil(avg / 5) * 5)); // piso de 15 min: busca + conferência de fontes
    const fmt = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
    const last = runs[0];
    if (last && !last.finished_at && now - new Date(last.run_at) < 2 * 3600e3) {
      const eta = new Date(new Date(last.run_at).getTime() + mins * 6e4);
      return { running: true, day: null, hour: eta > now ? `Por volta de ${fmt(eta)}` : "Terminando agora",
        text: eta > now ? `Varredura em andamento · novidades por volta de ${fmt(eta)}` : "Varredura em andamento · terminando" };
    }
    const d = new Date(now);
    if (now.getHours() * 60 + now.getMinutes() >= 8 * 60 + 40) d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    d.setHours(8, 40 + mins, 0, 0);
    const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    const t1 = new Date(d); t1.setHours(0, 0, 0, 0);
    const diff = Math.round((t1 - t0) / 864e5);
    const day = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : d.toLocaleDateString("pt-BR", { weekday: "long" });
    return { running: false, day: day[0].toUpperCase() + day.slice(1), hour: `Por volta de ${fmt(d)}`,
      text: `Próximas novidades: ${day}, por volta de ${fmt(d)}` };
  }

  // Estado vazio do radar: varredura animada (só decorativa) + texto honesto
  // Radar animado (decorativo): ponteiro girando, rastro e pontos
  function radarScope() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 120"); svg.setAttribute("class", "radar-scope"); svg.setAttribute("aria-hidden", "true");
    const add = (tag, attrs, parent = svg) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.append(n); return n; };
    for (const r of [56, 40, 24]) add("circle", { cx: 60, cy: 60, r, class: "ring" });
    add("path", { d: "M60 4v112M4 60h112", class: "cross" });
    const g = add("g", { class: "sweep" });
    add("path", { d: "M60 60L60 4A56 56 0 0 0 11.5 32Z", class: "wedge" }, g);
    add("path", { d: "M60 60L60 4", class: "arm" }, g);
    for (const [cx, cy, d] of [[84, 38, "0s"], [36, 78, "1.4s"], [80, 86, "2.6s"]]) add("circle", { cx, cy, r: 2.6, class: "blip", style: `animation-delay:${d}` });
    add("circle", { cx: 60, cy: 60, r: 3, class: "core" });
    return svg;
  }

  // Bloco de status no topo do radar. alert = texto de problema (varredura falhou ou parada)
  function radarStatus(timing, lastText, alert) {
    const title = alert ? "Atenção" : timing.running ? "Varrendo agora" : "Radar ligado";
    const line = (ico, text, cls = "") => el("li", { class: cls }, icon(ico), el("span", {}, text));
    const body = alert
      ? el("p", { class: "radar-alert" }, alert)
      : el("div", { class: "radar-status-body" },
          el("span", { class: "radar-status-label" }, timing.running ? "Novidades" : "Próximas novidades"),
          el("ul", { class: "radar-status-lines" },
            timing.day ? line("pauta", timing.day, "hl") : null,
            line("relogio", timing.hour, "hl"),
            lastText ? line("historico", lastText) : null));
    return el("aside", { class: `radar-status${alert ? " is-alert" : ""}${timing.running ? " is-running" : ""}`, role: "status" },
      el("div", { class: "radar-status-top" }, radarScope(), el("b", {}, title)),
      body);
  }

  // Lista vazia: o status já está no topo, aqui só o texto
  const radarEmpty = (text) => el("div", { class: "empty-state radar-empty-txt" }, text);

  // ---------- Estado do post no Kanban (fonte única: Kanban e painel usam a mesma regra) ----------
  const KANBAN_SUB = {
    espera: { col: "fazer", label: "Aguardando pauta" },
    copy: { col: "fazer", label: "Copy a fazer" },
    fazer: { col: "fazer", label: "Arte a fazer" },
    producao: { col: "producao", label: "Em produção" },
    revisao: { col: "revisao", label: "Em revisão" },
    cliente: { col: "cliente", label: "Com o cliente" },
    ajuste: { col: "ajuste", label: "Ajuste pedido" },
    aprovado: { col: "pronto", label: "Aprovado" },
    agendado: { col: "pronto", label: "Agendado" },
  };
  // d = { sent: versões enviadas, drafts: rascunhos, decisions }
  function kanbanState(d, p) {
    const lastDecision = (postId, stage, versionId) => {
      const list = d.decisions.filter((x) => x.post_id === postId && x.stage === stage && x.version_id === versionId);
      return list[list.length - 1] || null;
    };
    if (p.scheduled) return { col: "agendado" };
    const opp = p.kind === "oportunidade";
    const sentArte = G.latestVersion(d.sent, p.id, "arte");
    const draftArte = G.latestVersion(d.drafts, p.id, "arte");
    const sentCopy0 = G.latestVersion(d.sent, p.id, "copy");
    const draftCopy0 = G.latestVersion(d.drafts, p.id, "copy");
    const newArte = draftArte && draftArte.number > (sentArte?.number || 0) ? draftArte : null;
    const newCopy = draftCopy0 && draftCopy0.number > (sentCopy0?.number || 0) ? draftCopy0 : null;
    // Ajuste interno pedido pelo Rapha num rascunho volta o card para Ajuste
    const internal = [newCopy, newArte].find((v) => v?.review_note);
    if (internal) return { col: "ajuste", stage: internal.stage, internal: internal };
    if (newArte || newCopy) return { col: "revisao", stage: newArte && newCopy ? "ambos" : newArte ? "arte" : "copy" };
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

  // O post está completo para ir ao cliente? Arte sempre; texto e legenda também, menos no Stories.
  // Mesma regra do send_post no banco (lá é a que vale).
  function readiness(all, p) {
    const last = (stage) => all.filter((v) => v.post_id === p.id && v.stage === stage).sort((a, b) => b.number - a.number)[0] || null;
    const sentMax = (stage) => Math.max(0, ...all.filter((v) => v.post_id === p.id && v.stage === stage && v.sent).map((v) => v.number));
    const copy = last("copy"), arte = last("arte");
    const falta = [];
    if (!arte || !(arte.asset_paths || []).length) falta.push("arte");
    if (p.format !== "stories") {
      if (!copy || !(copy.copy_text || "").trim()) falta.push("texto da arte");
      if (!copy || !(copy.caption_text || "").trim()) falta.push("legenda");
    }
    const ajuste = [copy, arte].some((v) => v && !v.sent && v.review_note);
    const novo = (copy?.number || 0) > sentMax("copy") || (arte?.number || 0) > sentMax("arte");
    return { ok: !falta.length && !ajuste && novo, falta, ajuste, novo };
  }

  // Agrupa itens por quando entraram no radar: Hoje, Ontem, Esta semana, depois por mês
  const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  function groupByPeriod(items, field = "created_at", now = new Date()) {
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const label = (iso) => {
      const d = new Date(iso); const dd = new Date(d); dd.setHours(0, 0, 0, 0);
      const diff = Math.round((day0 - dd) / 864e5);
      if (diff <= 0) return "Hoje";
      if (diff === 1) return "Ontem";
      if (diff < 7) return "Esta semana";
      return d.getFullYear() === now.getFullYear() ? MESES[d.getMonth()] : `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    };
    const groups = [];
    for (const it of items) {
      const l = label(it[field]);
      const last = groups[groups.length - 1];
      if (last && last[0] === l) last[1].push(it); else groups.push([l, [it]]);
    }
    return groups;
  }
  // Lista agrupada com título por período
  const groupedList = (items, card) => el("div", { class: "radar-list" },
    groupByPeriod(items).map(([l, list]) => el("section", { class: "radar-group" },
      el("h3", { class: "radar-group-h" }, el("span", {}, l), el("small", {}, `${list.length} ${list.length === 1 ? "item" : "itens"}`)),
      list.map(card))));

  // Impacto na carteira: frase do radar ou, sem ela, montada pelos setores e públicos
  const SETORES = { tecnologia: "tecnologia", gestao: "gestão", marketing: "marketing", engenharia: "engenharia", educacao: "educação", saude: "saúde" };
  const PUBLICOS = { mei: "MEI", pessoa_fisica: "pessoa física" };
  const lista = (n) => (n.length > 1 ? `${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}` : n[0]);
  function radarImpacto(a) {
    if (a.impacto_carteira) return a.impacto_carteira;
    const s = (a.setores_afetados || []).filter(Boolean);
    if (!s.length) return null;
    if (s.includes("todos")) return "Afeta todos os seus clientes";
    const pub = s.filter((x) => PUBLICOS[x]).map((x) => PUBLICOS[x]);
    const areas = s.filter((x) => !PUBLICOS[x]).map((x) => SETORES[x] || x);
    const quem = pub.length ? `Afeta seus clientes ${lista(pub)}` : "Afeta seus clientes";
    return areas.length ? `${quem} da área de ${lista(areas)}` : quem;
  }

  // ---------- Movimento e diálogos compartilhados ----------
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Remove um nó com animação de saída (classe .leaving no CSS) e só depois chama done
  function leave(node, done) {
    if (!node || node.classList.contains("leaving")) return;
    if (reduceMotion()) { node.remove(); done?.(); return; }
    node.classList.add("leaving");
    let gone = false;
    const end = () => { if (gone) return; gone = true; node.remove(); done?.(); };
    node.addEventListener("animationend", (e) => { if (e.target === node) end(); });
    setTimeout(end, 280);
  }

  // Mantém o Tab dentro de um diálogo. O retorno devolve o foco para quem abriu.
  function trapFocus(box) {
    const prev = document.activeElement;
    const sel = 'button:not([disabled]), a[href], textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const f = [...box.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener("keydown", onKey);
    return () => { box.removeEventListener("keydown", onKey); if (prev && document.contains(prev)) prev.focus(); };
  }

  function toast(text, bad = false) {
    const t = el("div", { class: `ktoast${bad ? " bad" : ""}`, role: "status" }, text);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add("on"));
    setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, bad ? 4200 : 2600);
  }

  // Confirmação no visual do sistema, no lugar do confirm()/prompt() do navegador.
  // input: { label, expect?, placeholder? } → resolve com o texto digitado; sem input → true/false.
  function ask({ title, text = "", okLabel = "Confirmar", danger = false, input = null }) {
    return new Promise((resolve) => {
      const field = input ? el("input", { type: "text", placeholder: input.placeholder || "", "aria-label": input.label, autocomplete: "off", spellcheck: "false" }) : null;
      const ok = el("button", { class: `btn ${danger ? "bad" : "dark"}`, type: "button", disabled: !!input?.expect }, okLabel);
      const cancel = el("button", { class: "btn ghost", type: "button" }, "Cancelar");
      const box = el("div", { class: "gdialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "gd-t" },
        el("h3", { id: "gd-t" }, title),
        text ? el("p", {}, text) : null,
        input ? el("label", { class: "gd-field" }, el("span", {}, input.label), field) : null,
        el("div", { class: "gd-row" }, cancel, ok));
      const shade = el("div", { class: "gshade" }, box);
      const release = trapFocus(shade);
      let closed = false;
      const done = (v) => { if (closed) return; closed = true; document.removeEventListener("keydown", key); release(); leave(shade); resolve(v); };
      const value = () => (input ? field.value.trim() : true);
      const key = (e) => {
        if (e.key === "Escape") done(input ? null : false);
        if (e.key === "Enter" && !ok.disabled && (input || document.activeElement !== cancel)) { e.preventDefault(); done(value()); }
      };
      if (input?.expect) field.addEventListener("input", () => { ok.disabled = field.value.trim() !== input.expect; });
      ok.addEventListener("click", () => done(value()));
      cancel.addEventListener("click", () => done(input ? null : false));
      shade.addEventListener("click", (e) => { if (e.target === shade) done(input ? null : false); });
      document.addEventListener("keydown", key);
      document.body.append(shade);
      (field || (danger ? cancel : ok)).focus();
    });
  }

  // Botão de admin para marcar/desmarcar "publicado" à mão. A regra fica no banco (set_published_manual).
  function publishToggle(sb, post, onDone) {
    const on = post.publish_status === "publicado";
    const b = el("button", { class: `btn ${on ? "ghost" : "pub"}`, type: "button" }, on ? "Desmarcar publicado" : "Marcar como publicado");
    b.addEventListener("click", async () => {
      if (on && !(await ask({ title: "Desmarcar publicado?", text: "O post volta para o status anterior no calendário.", okLabel: "Desmarcar" }))) return;
      b.disabled = true;
      const { error } = await sb.rpc("set_published_manual", { p_post: post.id, p_published: !on });
      b.disabled = false;
      if (error) return toast(error.message, true);
      toast(on ? "Publicado desmarcado" : "Marcado como publicado");
      onDone?.(!on);
    });
    return b;
  }

  // Dropdown de status do post (só admin). A regra fica no banco (set_post_status).
  const STATUS_OPTS = [["pendente", "Sua vez"], ["aprovado", "Aprovado"], ["reprovado", "Ajuste pedido"], ["contestado", "Em discussão"], ["publicado", "Publicado"]];
  function statusSelect(sb, data, post, onDone) {
    const cur = post.publish_status === "publicado" ? "publicado" : postSummary(data, post);
    const sel = el("select", { class: `status-select s-${cur}`, "aria-label": `Status de ${post.title}` },
      STATUS_OPTS.map(([v, l]) => el("option", { value: v, selected: v === cur }, l)));
    sel.addEventListener("change", async () => {
      const v = sel.value; sel.disabled = true;
      const { error } = await sb.rpc("set_post_status", { p_post: post.id, p_status: v });
      sel.disabled = false;
      if (error) { sel.value = cur; return toast(error.message, true); }
      sel.className = `status-select s-${v}`;
      toast(`Status: ${STATUS_OPTS.find((o) => o[0] === v)[1]}`);
      onDone?.(v);
    });
    return sel;
  }

  // Esqueleto de carregamento com o formato do conteúdo
  const skeleton = (lines = 3) => el("div", { class: "skel", role: "status", "aria-label": "Carregando" },
    Array.from({ length: lines }, () => el("i")));

  return { statusSelect, publishToggle, leave, trapFocus, toast, ask, skeleton, reduceMotion, readiness, radarImpacto, radarScope, radarStatus, groupByPeriod, groupedList, KANBAN_SUB, kanbanState, radarTiming, radarEmpty, icon, navLink, STAGES, FORMATS, STATUS_LABEL, el, latestVersion, stageState, pauteLocked, postSummary, fmtDate, MONTHS, DOW, when, actorName, historyList, logoMark };
})();
