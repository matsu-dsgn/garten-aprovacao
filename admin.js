(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const SLUG_RE = /^[a-z0-9-]{3,40}$/;
  const FORMATS = Object.keys(G.FORMATS);

  let months = [];
  let editorias = [];
  let current = null; // mês aberto
  let data = null;    // posts/versions/decisions/approvers do mês

  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const field = (label, input) => el("label", { class: "f" }, label, input);

  // ---------- Login e papel ----------
  const loginView = (error) => GAuth.loginView(app, sb, boot, error);

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return loginView();
    const role = await GAuth.role(sb);
    if (role === "equipe") { location.href = "kanban.html"; return; }
    if (role !== "admin") return GAuth.noAccess(app, sb, user, () => loginView());
    const nav = GAuth.nav("admin.html", true);
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    GAuth.logout(sb);
    const { data: eds } = await sb.from("editorias").select("*").eq("active", true).order("sort");
    editorias = eds || [];
    await loadMonths();
  }

  // ---------- Meses ----------
  async function loadMonths() {
    const { data: rows, error } = await sb.from("months").select("id, slug, title, overview, created_at").order("created_at", { ascending: false });
    if (error) return app.replaceChildren(msg(error.message, "err"));
    months = rows;
    if (current) current = months.find((m) => m.id === current.id) || null;
    current ? openMonth(current) : monthsView();
  }

  function monthForm(m) {
    const slug = el("input", { type: "text", value: m?.slug || "", placeholder: "2026-11", disabled: !!m });
    const title = el("input", { type: "text", value: m?.title || "", maxlength: "40", placeholder: "Novembro" });
    const intro = el("textarea", { maxlength: "400", placeholder: "Frase de abertura do mês" });
    intro.value = m?.overview?.intro || "";
    // Mix ideal do mês, em % por editoria (soma deve dar 100)
    const mixIn = {};
    const sum = el("span", { class: "msg" });
    const updSum = () => {
      const t = Object.values(mixIn).reduce((a, i) => a + (parseInt(i.value, 10) || 0), 0);
      const left = 100 - t;
      sum.textContent = t === 0 ? "Sem mix ideal (todos em 0%)" : t === 100 ? "Soma: 100% ✓" : left > 0 ? `Soma: ${t}% · faltam ${left}%` : `Soma: ${t}% · passou ${-left}%`;
      sum.className = t === 100 || t === 0 ? "msg okk" : "msg err";
      return t;
    };
    const mixFields = editorias.map((e) => {
      // Slider de 0 a 100, de 5 em 5, com o valor ao lado
      const i = el("input", { type: "range", min: "0", max: "100", step: "5", "aria-label": `${e.name} (%)` });
      const v = m?.overview?.mix?.[e.slug];
      i.value = String(v != null ? v : 0);
      const val = el("b", { class: "mix-num" });
      const paint = () => { val.textContent = `${i.value}%`; i.style.setProperty("--p", `${i.value}%`); };
      i.addEventListener("input", () => { paint(); updSum(); });
      paint();
      mixIn[e.slug] = i;
      return el("div", { class: "mix-slider" }, el("span", { class: "mix-label" }, e.name), i, val);
    });
    const why = el("textarea", { maxlength: "400", placeholder: "Por que esse mix neste mês? (aparece para o cliente)" });
    why.value = m?.overview?.mix_motivo || "";
    updSum();
    const out = msg("");
    const save = el("button", { class: "btn dark" }, m ? "Salvar mês" : "Criar mês");
    save.addEventListener("click", async () => {
      const mix = {};
      for (const [k, i] of Object.entries(mixIn)) {
        const n = parseInt(i.value, 10);
        if (Number.isFinite(n)) mix[k] = Math.max(0, Math.min(100, n));
      }
      const t = updSum();
      if (t === 0) for (const k of Object.keys(mix)) delete mix[k];
      if (t !== 0 && t !== 100) { out.className = "msg err"; out.textContent = "O mix ideal precisa somar 100% (ou ficar vazio)."; return; }
      const row = { title: title.value.trim(), overview: { intro: intro.value.trim().slice(0, 400), mix, mix_motivo: why.value.trim().slice(0, 400) } };
      if (!row.title) { out.className = "msg err"; out.textContent = "Dê um título ao mês."; return; }
      let res;
      if (m) res = await sb.from("months").update(row).eq("id", m.id).select().single();
      else {
        const s = slug.value.trim().toLowerCase();
        if (!SLUG_RE.test(s)) { out.className = "msg err"; out.textContent = "Slug: 3–40 letras minúsculas, números ou hífen."; return; }
        res = await sb.from("months").insert({ ...row, slug: s }).select().single();
      }
      if (res.error) { out.className = "msg err"; out.textContent = res.error.message; return; }
      current = res.data; await loadMonths();
    });
    return el("section", { class: "panel" },
      el("h2", {}, m ? "Dados do mês" : "Novo mês"),
      el("div", { class: "grid2" }, field("Slug do link", slug), field("Título", title)),
      field("Intro", intro),
      el("div", { class: "eyebrow" }, "Mix ideal por editoria"),
      el("div", { class: "mix-sliders" }, mixFields), sum, field("Motivo do mix", why),
      el("div", { class: "row" }, save), out);
  }

  // Exclui o mês com tudo dentro (posts, versões, decisões) e as artes do storage
  async function deleteMonth(m) {
    const typed = await G.ask({ title: `Excluir ${m.title}?`, danger: true, okLabel: "Excluir mês",
      text: "Isso apaga todos os posts, aprovações e artes desse mês, sem volta.",
      input: { label: `Para confirmar, digite o slug: ${m.slug}`, expect: m.slug, placeholder: m.slug } });
    if (typed !== m.slug) return;
    // artes no storage: {slug}/{post}/{versao}/arquivo
    const paths = [];
    const { data: posts } = await sb.storage.from("artes").list(m.slug, { limit: 1000 });
    for (const p of posts || []) {
      const { data: vers } = await sb.storage.from("artes").list(`${m.slug}/${p.name}`, { limit: 1000 });
      for (const v of vers || []) {
        const { data: files } = await sb.storage.from("artes").list(`${m.slug}/${p.name}/${v.name}`, { limit: 1000 });
        for (const f of files || []) paths.push(`${m.slug}/${p.name}/${v.name}/${f.name}`);
      }
    }
    if (paths.length) {
      const { error } = await sb.storage.from("artes").remove(paths);
      if (error) { G.toast(`Não consegui apagar as artes: ${error.message}. Nada foi excluído.`, true); return; }
    }
    const { error } = await sb.from("months").delete().eq("id", m.id);
    if (error) { G.toast(`Erro ao excluir: ${error.message}`, true); return; }
    try { localStorage.removeItem(`garten-link-${m.slug}`); } catch { /* ok */ }
    if (current?.id === m.id) current = null;
    await loadMonths();
  }

  function teamPanel() {
    const box = el("div", { class: "stack" }, G.skeleton(3));
    const load = async () => {
      const { data: team, error } = await sb.from("team_members").select("*").order("role").order("name");
      if (error) return box.replaceChildren(msg(error.message, "err"));
      const name = el("input", { type: "text", maxlength: "60", placeholder: "Nome" });
      const email = el("input", { type: "email", placeholder: "email@exemplo.com" });
      const role = el("select", {}, el("option", { value: "equipe" }, "Equipe (Kanban)"), el("option", { value: "admin" }, "Admin (tudo)"));
      const funcaoSelect = (v) => { const sel = el("select", { "aria-label": "Função no Kanban" },
        el("option", { value: "" }, "Arte e copy"), el("option", { value: "arte" }, "Só arte"), el("option", { value: "copy" }, "Só copy"));
        sel.value = v; return sel; };
      const funcao = funcaoSelect("");
      const out = msg("");
      const add = el("button", { class: "btn dark", type: "button" }, "Adicionar");
      add.addEventListener("click", async () => {
        const e = email.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { out.className = "msg err"; out.textContent = "E-mail inválido."; return; }
        if (name.value.trim().length < 2) { out.className = "msg err"; out.textContent = "Coloque o nome."; return; }
        const { error } = await sb.from("team_members").insert({ email: e, name: name.value.trim(), role: role.value, funcao: role.value === "admin" ? null : funcao.value || null });
        if (error) { out.className = "msg err"; out.textContent = error.message; return; }
        load();
      });
      box.replaceChildren(
        el("ul", { class: "history" }, (team || []).map((t) => {
          const rm = el("button", { class: "btn-del", type: "button", "aria-label": `Remover ${t.name}` }, "Remover");
          rm.addEventListener("click", async () => {
            if (!(await G.ask({ title: `Remover ${t.name} da equipe?`, text: "A pessoa perde o acesso na hora.", okLabel: "Remover", danger: true }))) return;
            const { error } = await sb.from("team_members").delete().eq("email", t.email);
            error ? G.toast(error.message, true) : (G.toast(`${t.name} saiu da equipe`), load());
          });
          // Função no Kanban: quem é de arte só sobe arte, quem é de copy só sobe texto (vale no banco)
          const fn = t.role === "admin" ? null : funcaoSelect(t.funcao || "");
          fn?.addEventListener("change", async () => {
            const { error } = await sb.from("team_members").update({ funcao: fn.value || null }).eq("email", t.email);
            out.className = error ? "msg err" : "msg okk";
            out.textContent = error ? error.message : `Função de ${t.name} salva.`;
          });
          return el("li", { class: "team-row" }, el("span", {}, el("b", {}, t.name), ` · ${t.email} · ${t.role === "admin" ? "Admin" : "Equipe"}`),
            el("div", { class: "row" }, fn, rm));
        })),
        el("div", { class: "grid2" }, field("Nome", name), field("E-mail (o mesmo do Google)", email)),
        el("div", { class: "grid2" }, field("Acesso", role), field("Função no Kanban", funcao)), el("div", { class: "row" }, add), out);
    };
    const sumLabel = el("span", {}, "Equipe");
    sb.from("team_members").select("email", { count: "exact", head: true })
      .then(({ count }) => { if (count != null) sumLabel.textContent = `Equipe · ${count} ${count === 1 ? "pessoa" : "pessoas"} · vale para todos os meses`; });
    load();
    return el("section", { class: "panel" }, el("details", {}, el("summary", {}, sumLabel),
      el("p", {}, "Cadastro único: quem está aqui acessa todos os meses. Não precisa mexer ao criar um mês novo."), box));
  }

  // ---------- Overview (dashboard) ----------
  // Mesma regra de coluna do Kanban (G.kanbanState), para os números baterem
  let overviewMonth = null;
  function overviewPanel() {
    const box = el("section", { class: "ov", "aria-live": "polite" }, G.skeleton(3));
    if (!months.length) return null;
    const m = months.find((x) => x.id === overviewMonth) || months[0];
    overviewMonth = m.id;
    fillOverview(box, m);
    return box;
  }

  async function fillOverview(box, m) {
    try {
      const { data: posts, error } = await sb.from("posts").select("id, title, post_date, kind, origin, assignee, scheduled, validated_by, validated_at, validation_withdrawn").eq("month_id", m.id).order("post_date");
      if (error) throw error;
      const ids = posts.map((p) => p.id);
      const q = (t, order) => ids.length ? sb.from(t).select("*").in("post_id", ids).order(order) : Promise.resolve({ data: [] });
      const semana = new Date(Date.now() - 7 * 864e5).toISOString();
      const [v, dc, tm, rd, rv] = await Promise.all([
        q("versions", "number"), q("decisions", "created_at"),
        sb.from("team_members").select("email, name"),
        sb.from("radar_alerts").select("id", { count: "exact", head: true }).eq("status", "novo"),
        sb.from("posts").select("id, title, validated_by, months(slug)").eq("origin", "radar").gte("validated_at", semana).order("validated_at", { ascending: false }),
      ]);
      const all = v.data || [];
      const d = { sent: all.filter((x) => x.sent), drafts: all.filter((x) => !x.sent), decisions: dc.data || [] };
      const team = tm.data || [];
      const name = (e) => GWork.nameOf(team, e);

      // Pautas (só as planejadas: oportunidade não passa por aprovação de pauta)
      const planned = posts.filter((p) => p.kind !== "oportunidade");
      const pauta = { aprovado: 0, ajuste: 0, pendente: 0 };
      for (const p of planned) {
        const st = G.stageState({ versions: d.sent, decisions: d.decisions }, p, "pauta").status;
        if (st === "aprovado") pauta.aprovado++;
        else if (st === "reprovado" || st === "contestado") pauta.ajuste++;
        else pauta.pendente++;
      }

      // Kanban
      const cols = { fazer: [], producao: [], revisao: [], cliente: [], ajuste: [], pronto: [] };
      for (const p of posts) {
        const st = G.kanbanState(d, p);
        cols[G.KANBAN_SUB[st.col].col].push({ ...p, stage: st.stage });
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const late = posts.filter((p) => !cols.pronto.some((x) => x.id === p.id) && G.fmtDate(p.post_date) < today);

      const kanbanHref = `kanban.html?mes=${encodeURIComponent(m.slug)}`;
      const tile = (label, value, opts = {}) => el(opts.href ? "a" : "div", { class: `ov-tile${opts.tone ? ` ${opts.tone}` : ""}`, href: opts.href || false },
        el("span", { class: "ov-label" }, label), el("b", { class: "ov-num" }, String(value)), opts.sub ? el("span", { class: "ov-sub" }, opts.sub) : null);
      const pct = planned.length ? Math.round((pauta.aprovado / planned.length) * 100) : 0;

      // Quem acionar
      const acts = [];
      const radarCards = posts.filter((p) => p.origin === "radar");
      if (radarCards.length) acts.push(["Validadas pelo cliente no radar", radarCards.map((p) => item(p, p.validation_withdrawn
        ? `${p.title} (validação retirada pelo cliente)` : `${p.title} (${p.validated_by || "cliente"} · ${p.post_date.split("-").reverse().join("/")})`))]);
      const stg = (p) => (p.stage === "arte" ? "arte" : "texto");
      const item = (p, text) => ({ id: p.id, text });
      if (cols.revisao.length) acts.push(["Você revisa", cols.revisao.map((p) => item(p, `${p.title} (${stg(p)})`))]);
      const byPerson = {};
      for (const p of cols.producao) (byPerson[p.assignee || ""] ||= []).push(item(p, p.title));
      for (const [e, list] of Object.entries(byPerson)) acts.push([e ? `${name(e)} produzindo` : "Em produção sem responsável", list]);
      if (cols.ajuste.length) acts.push(["Ajuste pedido pelo cliente", cols.ajuste.map((p) => item(p, `${p.title} (${stg(p)}${p.assignee ? ` · ${name(p.assignee)}` : ""})`))]);
      if (cols.cliente.length) acts.push(["Esperando Wilker ou Letícia", cols.cliente.map((p) => item(p, `${p.title} (${stg(p)})`))]);
      if (late.length) acts.push(["Atrasados (data de publicação passou)", late.map((p) => item(p, p.title))]);
      const cardHref = (pid) => `${kanbanHref}&post=${encodeURIComponent(pid)}`;

      const picker = months.length > 1 ? el("select", { "aria-label": "Mês do overview", class: "ov-pick" },
        months.map((x) => el("option", { value: x.id, selected: x.id === m.id }, x.title))) : null;
      picker?.addEventListener("change", () => { overviewMonth = picker.value; const nb = overviewPanel(); box.replaceWith(nb); });

      box.replaceChildren(...[
        el("div", { class: "row between" }, el("h2", {}, `Overview · ${m.title}`), picker || el("span", {})),
        el("h3", { class: "ov-h" }, "Pautas"),
        el("div", { class: "ov-grid" },
          tile("Aprovadas", `${pauta.aprovado}/${planned.length}`, { tone: "ok", sub: `${pct}% do mês` }),
          tile("Com ajuste", pauta.ajuste, { tone: pauta.ajuste ? "bad" : "" }),
          tile("Aguardando o cliente", pauta.pendente),
          tile("Oportunidades", posts.length - planned.length, { sub: "fora do calendário" })),
        el("h3", { class: "ov-h" }, "Kanban"),
        el("div", { class: "ov-grid six" },
          tile("A fazer", cols.fazer.length, { href: kanbanHref }),
          tile("Em produção", cols.producao.length, { href: kanbanHref }),
          tile("Revisão interna", cols.revisao.length, { href: kanbanHref, tone: cols.revisao.length ? "you" : "", sub: cols.revisao.length ? "esperando você" : null }),
          tile("Com o cliente", cols.cliente.length, { href: kanbanHref }),
          tile("Ajuste pedido", cols.ajuste.length, { href: kanbanHref, tone: cols.ajuste.length ? "bad" : "" }),
          tile("Pronto", cols.pronto.length, { href: kanbanHref, tone: "ok" })),
        acts.length ? el("div", { class: "ov-acts" }, el("h3", { class: "ov-h" }, "Quem acionar"),
          acts.map(([who, list]) => el("details", { open: true }, el("summary", {}, `${who} · ${list.length}`), el("ul", {}, list.map((t) => el("li", {}, el("a", { href: cardHref(t.id) }, t.text)))))))
          : el("p", { class: "msg okk" }, "Nada travado agora."),
        pubOverview(),
        radarValidacoes(rv.data || []),
        (rd.count || 0) ? el("a", { class: "ov-radar", href: "radar.html" }, G.icon("radar"), `${rd.count} ${rd.count === 1 ? "novidade" : "novidades"} no radar legislativo`) : null].filter(Boolean));
    } catch (e) {
      box.replaceChildren(msg(`Não foi possível montar o overview: ${e.message}`, "err"));
    }
  }

  // Publicações: resumo rápido (o relatório completo fica em publicacoes.html)
  function pubOverview() {
    const box = el("div", { class: "stack-0" });
    (async () => {
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const [q, md] = await Promise.all([
        sb.from("posts").select("id, scheduled_at, publish_status").in("publish_status", ["agendado", "erro"]).order("scheduled_at"),
        sb.from("ig_media").select("product_type, reach, saved, shares").eq("network", "instagram").gte("published_at", since),
      ]);
      if (q.error || md.error) return;
      const fila = q.data || [], pub = md.data || [];
      const erros = fila.filter((p) => p.publish_status === "erro").length;
      const prox = fila.find((p) => p.publish_status === "agendado");
      const feed = pub.filter((m) => m.product_type !== "STORY");
      const hasIns = feed.some((m) => m.reach != null);
      const saved = feed.reduce((a, m) => a + (m.saved || 0), 0);
      const shares = feed.reduce((a, m) => a + (m.shares || 0), 0);
      const tile = (label, value, sub, tone) => el("a", { class: `ov-tile${tone ? ` ${tone}` : ""}`, href: "publicacoes.html" },
        el("span", { class: "ov-label" }, label), el("b", { class: "ov-num" }, String(value)), sub ? el("span", { class: "ov-sub" }, sub) : null);
      box.replaceChildren(el("h3", { class: "ov-h" }, "Publicações"),
        el("div", { class: "ov-grid" },
          tile("Agendados", fila.length - erros, prox ? `próximo ${new Date(prox.scheduled_at).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "nada na fila"),
          tile("Com erro", erros, erros ? "precisa reagendar" : null, erros ? "bad" : ""),
          tile("Publicados · 7 dias", feed.length, `${pub.length - feed.length} Stories`),
          tile("Compartilhamentos · 7 dias", hasIns ? shares : "—", hasIns ? null : "aguardando métricas", "ok"),
          tile("Salvamentos · 7 dias", hasIns ? saved : "—", hasIns ? null : "aguardando métricas", "ok")));
    })();
    return box;
  }

  // Validações do cliente no radar nos últimos 7 dias, de qualquer mês
  function radarValidacoes(list) {
    if (!list.length) return null;
    const quem = [...new Set(list.map((p) => p.validated_by).filter(Boolean))];
    const txt = `${quem.length ? quem.join(" e ") : "O cliente"} ${quem.length > 1 ? "validaram" : "validou"} ${list.length} ${list.length === 1 ? "pauta" : "pautas"} do radar nesta semana`;
    return el("div", { class: "ov-radar-ok" }, el("span", {}, G.icon("radar"), txt),
      el("ul", {}, list.map((p) => el("li", {}, el("a", { href: `kanban.html?mes=${encodeURIComponent(p.months?.slug || "")}&post=${encodeURIComponent(p.id)}` }, p.title)))));
  }

  function newMonthBtn() {
    return el("button", { class: "btn dark", type: "button", onclick: (e) => {
      const slot = document.getElementById("new-month");
      if (!slot) return;
      const f = monthForm(null); slot.replaceWith(f); e.currentTarget.remove();
      f.scrollIntoView({ behavior: "smooth", block: "start" }); f.querySelector("input:not([disabled])")?.focus();
    } }, "+ Novo mês");
  }

  // ---------- Avisos (agendamento automático, data que passou, erro de publicação) ----------
  // Com o painel aberto, confere a cada minuto e mostra a notificação do navegador se você permitiu.
  let lastSeenNotif = 0;
  let notifTimer = null;
  function avisosPanel() {
    const box = el("section", { class: "avisos", "aria-live": "polite" });
    const icon = { agendado: "Agendado", data_passou: "Data passou", sem_horario: "Sem horário", erro_publicacao: "Erro" };
    const load = async (notify) => {
      const { data, error } = await sb.from("notifications").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(20);
      if (error || !data) return;
      const fresh = data.filter((n) => n.id > lastSeenNotif);
      if (notify && lastSeenNotif && fresh.length && "Notification" in window && Notification.permission === "granted") {
        for (const n of fresh.slice(0, 3)) {
          const nt = new Notification(`Garten · ${n.title}`, { body: n.body || "", tag: `garten-${n.id}` });
          nt.onclick = () => { window.focus(); if (n.url && /^kanban\.html\?/.test(n.url)) location.href = n.url; };
        }
      }
      lastSeenNotif = Math.max(lastSeenNotif, ...data.map((n) => n.id), 0);
      if (!data.length) return box.replaceChildren();
      const all = el("button", { class: "btn ghost", type: "button" }, "Marcar todos como lidos");
      all.addEventListener("click", async () => { await sb.rpc("mark_notifications_read", { p_ids: data.map((n) => n.id) }); load(false); });
      const perm = "Notification" in window && Notification.permission === "default"
        ? el("button", { class: "btn ghost", type: "button", onclick: async (e) => { await Notification.requestPermission(); e.target.remove(); } }, "Avisar no navegador") : null;
      box.replaceChildren(
        el("div", { class: "row between" }, el("h2", {}, `Avisos · ${data.length}`), el("div", { class: "row" }, perm, all)),
        el("ul", { class: "aviso-list" }, data.map((n) => {
          const ok = el("button", { class: "btn-del", type: "button", "aria-label": `Marcar "${n.title}" como lido` }, "Lido");
          ok.addEventListener("click", async () => { await sb.rpc("mark_notifications_read", { p_ids: [n.id] }); load(false); });
          return el("li", { class: `aviso k-${n.kind}` },
            el("span", { class: "aviso-tag" }, icon[n.kind] || "Aviso"),
            el("div", { class: "aviso-body" },
              n.url && /^kanban\.html\?/.test(n.url) ? el("a", { href: n.url }, el("b", {}, n.title)) : el("b", {}, n.title),
              el("span", { class: "msg" }, `${n.body || ""} · ${GWork.when(n.created_at)}`)),
            ok);
        })));
    };
    load(false);
    clearInterval(notifTimer);
    notifTimer = setInterval(() => { if (!document.hidden || window.Notification?.permission === "granted") load(true); }, 60000);
    return box;
  }

  function monthsView() {
    const stats = months.length ? sb.from("posts").select("month_id, scheduled").in("month_id", months.map((m) => m.id)).then(({ data }) => {
      const o = {}; for (const p of data || []) { const x = (o[p.month_id] ||= { total: 0, sched: 0 }); x.total++; if (p.scheduled) x.sched++; } return o;
    }) : Promise.resolve({});
    const cards = months.map((m, i) => {
      const stat = el("span", { class: "mcard-stat" }, "…");
      stats.then((st) => { const x = st[m.id] || { total: 0, sched: 0 };
        stat.textContent = x.total ? `${x.total} ${x.total === 1 ? "post" : "posts"} · ${x.sched} ${x.sched === 1 ? "agendado" : "agendados"}` : "Sem posts ainda"; });
      return el("article", { class: `mcard${i === 0 ? " now" : ""}` },
        el("div", { class: "mcard-top" }, el("span", { class: "mcard-tag" }, i === 0 ? "Atual" : "Histórico"),
          el("details", { class: "more" },
            el("summary", { "aria-label": `Mais ações de ${m.title}` }, "⋯"),
            el("button", { class: "btn-del", type: "button", onclick: () => deleteMonth(m) }, "Excluir mês"))),
        el("h3", { class: "mcard-t" }, m.title), stat,
        el("div", { class: "row mcard-acts" },
          el("button", { class: "btn ghost", type: "button", onclick: () => { current = m; openMonth(m); } }, "Abrir"),
          el("a", { class: "btn ghost", href: `kanban.html?mes=${encodeURIComponent(m.slug)}` }, "Kanban")));
    });
    app.replaceChildren(...[
      avisosPanel(),
      overviewPanel(),
      el("section", { class: "panel" },
        el("div", { class: "row between" }, el("h2", {}, "Meses"), newMonthBtn()),
        months.length ? el("div", { class: "mcards" }, cards) : msg("Nenhum mês ainda.")),
      el("div", { id: "new-month" }),
      teamPanel()].filter(Boolean));
    if (!months.length) document.getElementById("new-month").replaceWith(monthForm(null));
  }

  // ---------- Mês aberto ----------
  async function loadData(m) {
    const { data: posts, error } = await sb.from("posts").select("*").eq("month_id", m.id).order("post_date").order("sort");
    if (error) throw error;
    const ids = posts.map((p) => p.id);
    const [v, d, a, c, t] = await Promise.all([
      ids.length ? sb.from("versions").select("*").in("post_id", ids).order("number") : { data: [] },
      ids.length ? sb.from("decisions").select("*").in("post_id", ids).order("created_at") : { data: [] },
      sb.from("approvers").select("*").order("is_final", { ascending: false }),
      ids.length ? sb.from("post_comments").select("*").in("post_id", ids).order("created_at") : { data: [] },
      sb.from("team_members").select("*").order("name"),
    ]);
    const all = v.data || [];
    // versions = o que o cliente vê (enviadas); drafts = aguardando revisão interna
    const drafts = all.filter((x) => !x.sent);
    // Miniaturas: rascunhos + arte atual de cada post (o que está com o cliente)
    const sentAll = all.filter((x) => x.sent);
    const curArtes = posts.map((p) => G.latestVersion(sentAll, p.id, "arte")).filter(Boolean);
    const draftUrls = await GWork.signed(sb, [...drafts, ...curArtes].flatMap((x) => x.asset_paths || []));
    return { posts, allVersions: all, versions: sentAll, drafts, draftUrls, decisions: d.data || [], approvers: a.data || [], comments: c.data || [], team: t.data || [] };
  }

  const openPosts = new Set(); // posts abertos no mês (sobrevive ao re-render)
  const openComposers = new Set(); // bloco "Copy e arte" aberto (sobrevive ao re-render)
  let flash = null; // { id, text } mensagem de sucesso que sobrevive ao re-render

  // soft = atualizar no lugar (depois de um envio): sem tela de "Carregando" e sem pular a rolagem
  async function openMonth(m, soft = false) {
    const y = window.scrollY;
    if (!soft) app.replaceChildren(G.skeleton(5));
    try { data = await loadData(m); } catch (e) { return app.replaceChildren(msg(e.message, "err")); }
    if (soft) requestAnimationFrame(() => window.scrollTo(0, y));
    app.replaceChildren(
      el("div", { class: "row" },
        el("button", { class: "btn ghost", onclick: () => { current = null; monthsView(); } }, "← Meses"),
        el("button", { class: "btn ghost", onclick: () => exportJson(m) }, "Exportar JSON"),
        el("a", { class: "btn ghost", href: `kanban.html?mes=${encodeURIComponent(m.slug)}` }, "Kanban deste mês")),
      data.posts.length ? "" : importPanel(m),
      el("section", { class: "panel" },
        el("div", { class: "row between" }, el("h2", {}, `Posts (${data.posts.length})`),
          data.posts.length ? el("button", { class: "btn ghost", type: "button", onclick: (e) => {
            const rows = [...document.querySelectorAll("details.post-row")];
            const open = !rows.every((r) => r.open);
            rows.forEach((r) => { r.open = open; });
            e.currentTarget.textContent = open ? "Recolher todos" : "Abrir todos";
          } }, "Abrir todos") : ""),
        data.posts.length ? data.posts.map((p) => postRow(m, p)) : msg("Nenhum post ainda. Importe o JSON da pauta acima.")),
      linkPanel(m),
      oppPanel(m),
      el("details", { class: "panel settings" }, el("summary", {}, el("h2", {}, "Configurações do mês")),
        monthForm(m), data.posts.length ? importPanel(m) : ""));
  }

  function linkPanel(m) {
    const base = location.href.replace(/admin\.html.*$/, "");
    const urlFor = (token) => `${base}index.html?m=${encodeURIComponent(m.slug)}#k=${token}`;
    const box = el("div", { class: "stack" });
    const out = msg("");

    function showLink(url) {
      try { localStorage.setItem(`garten-link-${m.slug}`, url); } catch { /* ok */ }
      const copy = el("button", { class: "btn ok", type: "button" }, "Copiar link");
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(url); copy.textContent = "Copiado ✓"; setTimeout(() => { copy.textContent = "Copiar link"; }, 1800); }
        catch { prompt("Copie o link:", url); }
      });
      const view = el("a", { class: "btn ghost", href: url, target: "_blank", rel: "noopener" }, "Ver como cliente");
      box.replaceChildren(el("div", { class: "link-row" }, el("code", { class: "link" }, url), copy, view));
      revoke.hidden = false;
    }
    const noLink = () => { box.replaceChildren(msg("Nenhum link ativo. Gere um para mandar ao cliente.")); revoke.hidden = true; };

    // Carrega o link salvo deste mês
    (async () => {
      const { data } = await sb.from("month_links").select("token").eq("month_id", m.id).maybeSingle();
      if (data?.token) return showLink(urlFor(data.token));
      let local = null; try { local = localStorage.getItem(`garten-link-${m.slug}`); } catch { /* ok */ }
      local ? showLink(local) : noLink();
    })();

    const gen = el("button", { class: "btn dark" }, "Gerar novo link");
    gen.addEventListener("click", async () => {
      if (!(await G.ask({ title: "Gerar um novo link?", text: "O link anterior para de funcionar na hora.", okLabel: "Gerar link" }))) return;
      const { data: token, error } = await sb.rpc("rotate_month_token", { p_month: m.id });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      const { error: e2 } = await sb.from("month_links").upsert({ month_id: m.id, token, created_at: new Date().toISOString() });
      out.className = e2 ? "msg err" : "msg okk";
      out.textContent = e2 ? `Link gerado, mas não consegui salvar para copiar depois: ${e2.message}` : "Link novo gerado. O anterior parou de funcionar.";
      showLink(urlFor(token));
    });
    const revoke = el("button", { class: "btn bad", hidden: true }, "Encerrar link");
    revoke.addEventListener("click", async () => {
      if (!(await G.ask({ title: "Encerrar o link?", text: "O cliente perde o acesso até você gerar um novo.", okLabel: "Encerrar", danger: true }))) return;
      const { error } = await sb.rpc("revoke_month_token", { p_month: m.id });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      await sb.from("month_links").delete().eq("month_id", m.id);
      try { localStorage.removeItem(`garten-link-${m.slug}`); } catch { /* ok */ }
      out.className = "msg okk"; out.textContent = "Link encerrado. O histórico continua salvo.";
      noLink();
    });
    return el("section", { class: "panel" }, el("h2", {}, "Link do cliente"),
      el("p", {}, "O link dá acesso só a este mês. Mande pelo WhatsApp para o Wilker e a Letícia."),
      box, el("div", { class: "row" }, gen, revoke), out);
  }

  // Prazos rápidos para oportunidade
  function deadlineFrom(preset) {
    const d = new Date();
    if (preset === "2h") d.setHours(d.getHours() + 2);
    else if (preset === "hoje18") d.setHours(18, 0, 0, 0);
    else if (preset === "amanha10") { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    else return null;
    return d.toISOString();
  }
  const deadlineSelect = () => el("select", { "aria-label": "Prazo de resposta" },
    el("option", { value: "" }, "Sem prazo"),
    el("option", { value: "2h" }, "Em 2 horas"),
    el("option", { value: "hoje18" }, "Hoje às 18h"),
    el("option", { value: "amanha10" }, "Amanhã às 10h"));

  async function postLink(m, p) {
    let base = null;
    try { base = localStorage.getItem(`garten-link-${m.slug}`); } catch { /* ok */ }
    if (!base) {
      base = (await G.ask({ title: "Cole o link do cliente", text: "É o link do mês que você mandou no WhatsApp. Fica salvo neste navegador.",
        okLabel: "Usar este link", input: { label: "Link do mês", placeholder: "https://…/index.html?m=…#k=…" } })) || "";
      if (!base) return null;
      if (!/index\.html\?m=.+#k=[0-9a-f]{48}$/.test(base)) { G.toast("Link inválido. Gere um novo link do mês se não tiver mais o anterior.", true); return null; }
      try { localStorage.setItem(`garten-link-${m.slug}`, base); } catch { /* ok */ }
    }
    return base.replace("#k=", `&p=${p.id}#k=`);
  }

  function oppPanel(m) {
    const title = el("input", { type: "text", maxlength: "160", placeholder: "Título do post" });
    const date = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
    const format = el("select", {}, FORMATS.map((f) => el("option", { value: f }, G.FORMATS[f])));
    const ed = el("select", {}, el("option", { value: "" }, "Editoria"), editorias.map((e) => el("option", { value: e.slug }, e.name)));
    const origin = el("select", {}, el("option", { value: "agencia" }, "Partiu da agência"), el("option", { value: "cliente" }, "Pedido do cliente"));
    const dl = deadlineSelect(); dl.value = "hoje18";
    const obj = el("textarea", { maxlength: "400", placeholder: "Por que agora? (contexto da oportunidade)" });
    const out = msg("");
    const go = el("button", { class: "btn dark" }, "Criar oportunidade");
    go.addEventListener("click", async () => {
      if (!title.value.trim()) { out.className = "msg err"; out.textContent = "Dê um título."; return; }
      if (!ed.value) { out.className = "msg err"; out.textContent = "Escolha a editoria."; return; }
      const { error } = await sb.from("posts").insert({
        month_id: m.id, post_date: date.value, format: format.value, editoria: ed.value,
        title: title.value.trim(), objective: obj.value.trim().slice(0, 400) || null,
        kind: "oportunidade", origin: origin.value, respond_by: deadlineFrom(dl.value), sort: 99,
      });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      openMonth(m);
    });
    return el("section", { class: "panel" },
      el("details", {}, el("summary", {}, "⚡ Nova oportunidade"),
        el("div", { class: "stack" },
          msg("Post fora do calendário. Pula a pauta: suba copy e arte e o cliente aprova o post pronto."),
          field("Título", title),
          el("div", { class: "grid2" }, field("Data", date), field("Formato", format), field("Editoria", ed), field("Origem", origin)),
          field("Prazo de resposta", dl), field("Contexto", obj),
          el("div", { class: "row" }, go), out)));
  }

  function validPost(p, i) {
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) errs.push("date (AAAA-MM-DD)");
    if (!FORMATS.includes(p.format)) errs.push(`format (${FORMATS.join("/")})`);
    if (!p.title || String(p.title).length > 160) errs.push("title (até 160)");
    if (p.editoria && !editorias.some((e) => e.slug === p.editoria)) errs.push(`editoria (${editorias.map((e) => e.slug).join("/")})`);
    if (errs.length) throw new Error(`Post ${i + 1}: ${errs.join(", ")}`);
    return {
      post_date: p.date, format: p.format, title: String(p.title).trim(),
      theme: p.theme ? String(p.theme).slice(0, 60) : null,
      editoria: p.editoria || null,
      kind: p.kind === "oportunidade" ? "oportunidade" : "planejado",
      origin: ["agencia", "cliente"].includes(p.origin) ? p.origin : null,
      objective: p.objective ? String(p.objective).slice(0, 400) : null,
      direction: p.direction ? String(p.direction).slice(0, 4000) : null,
      checklist: Array.isArray(p.checklist) ? p.checklist.slice(0, 15).map((c) => String(c).trim().slice(0, 300)).filter(Boolean) : [],
      sort: i,
    };
  }

  function importPanel(m) {
    const ta = el("textarea", { placeholder: '{"posts":[{"date":"2026-11-04","format":"carrossel","theme":"Base sólida","title":"…","objective":"…","direction":"…"}]}', class: "mono" });
    const out = msg("");
    const go = el("button", { class: "btn dark" }, "Importar posts");
    go.addEventListener("click", async () => {
      try {
        const parsed = JSON.parse(ta.value);
        const list = Array.isArray(parsed) ? parsed : parsed.posts;
        if (!Array.isArray(list) || !list.length || list.length > 60) throw new Error("Esperava uma lista de 1 a 60 posts.");
        const rows = list.map(validPost).map((r) => ({ ...r, month_id: m.id }));
        const { error } = await sb.from("posts").insert(rows);
        if (error) throw error;
        openMonth(m);
      } catch (e) { out.className = "msg err"; out.textContent = e.message; }
    });
    return el("section", { class: "panel" }, el("h2", {}, "Importar pauta (JSON)"),
      el("p", {}, "Cole o JSON que montamos no planejamento. Os posts são adicionados ao mês."), ta, el("div", { class: "row" }, go), out);
  }

  function postRow(m, p) {
    const out = msg("");
    const fail = (e) => { out.className = "msg err"; out.textContent = e.message || String(e); };
    const states = Object.fromEntries(G.STAGES.map((s) => [s.key, G.stageState(data, p, s.key)]));

    // Bloco de envio: texto, legenda e artes num botão só; o painel atualiza no lugar
    const cmp = GWork.composer({
      sb, post: p, slug: m.slug, getVersions: () => data.allVersions,
      // Salva como versão nova e já tenta mandar ao cliente; se o post não estiver completo, fica salvo
      showCopy: true, showArte: true, sent: false, sendLabel: "Enviar ao cliente", draftNote: "",
      onDone: async () => {
        const { error } = await sb.rpc("send_post", { p_post: p.id });
        flash = error ? { id: p.id, kind: "err", text: `Salvo ✓, mas ainda não foi ao cliente. ${error.message}` }
          : { id: p.id, kind: "okk", text: "Enviado ao cliente ✓" };
        openPosts.add(p.id); openComposers.add(p.id); await openMonth(m, true);
      },
    });
    if (flash?.id === p.id && openComposers.has(p.id)) { cmp.say(flash.text, flash.kind || "okk"); flash = null; }
    // O que está com o cliente agora, para conferir sem abrir a visão dele
    const curCopy = G.latestVersion(data.versions, p.id, "copy");
    const curArte = G.latestVersion(data.versions, p.id, "arte");
    const tag = (v, stage) => `v${v.number} · ${G.STATUS_LABEL[states[stage === "copy" ? "copy" : "arte"]?.status] || "com o cliente"}`;
    const current = curCopy || curArte ? el("div", { class: "cmp-current content-box" },
      el("span", { class: "eyebrow" }, "Com o cliente agora"),
      curCopy ? el("div", {}, el("span", { class: "msg" }, `Texto ${tag(curCopy, "copy")}`), GWork.preview(curCopy, data.draftUrls)) : null,
      curArte ? el("div", {}, el("span", { class: "msg" }, `Arte ${tag(curArte, "arte")} · ${(curArte.asset_paths || []).length} ${(curArte.asset_paths || []).length === 1 ? "arquivo" : "arquivos"}`),
        GWork.preview(curArte, data.draftUrls)) : null) : null;
    const composerBox = el("details", { open: openComposers.has(p.id) || (!curCopy && !curArte) },
      el("summary", {}, curCopy || curArte ? "Copy e arte · nova versão" : "Copy e arte"),
      el("div", { class: "stack" }, current, cmp.el));
    composerBox.addEventListener("toggle", () => { composerBox.open ? openComposers.add(p.id) : openComposers.delete(p.id); });

    const edSel = el("select", { "aria-label": "Editoria" },
      el("option", { value: "" }, "Sem editoria"),
      editorias.map((e) => el("option", { value: e.slug }, e.name)));
    edSel.value = p.editoria || "";
    edSel.addEventListener("change", async () => {
      const { error } = await sb.from("posts").update({ editoria: edSel.value || null }).eq("id", p.id);
      error ? fail(error) : (out.className = "msg okk", out.textContent = "Editoria salva.");
    });
    const linkBtn = el("button", { class: "btn ghost" }, "Copiar link do post");
    linkBtn.addEventListener("click", async () => {
      const url = await postLink(m, p); if (!url) return;
      try { await navigator.clipboard.writeText(url); out.className = "msg okk"; out.textContent = "Link do post copiado."; }
      catch { prompt("Copie o link:", url); }
    });
    let dlSel = null;
    if (p.kind === "oportunidade") {
      dlSel = deadlineSelect();
      dlSel.addEventListener("change", async () => {
        const { error } = await sb.from("posts").update({ respond_by: deadlineFrom(dlSel.value) }).eq("id", p.id);
        error ? fail(error) : (out.className = "msg okk", out.textContent = "Prazo atualizado.");
      });
    }
    const sched = el("button", { class: "btn ghost" }, p.scheduled ? GWork.schedLabel(p) : "Agendar…");
    sched.addEventListener("click", () => {
      sched.replaceWith(GWork.schedulePanel(sb, p, () => openMonth(m)));
    });
    const del = el("button", { class: "btn bad" }, "Excluir post");
    del.addEventListener("click", async () => {
      if (!(await G.ask({ title: `Excluir "${p.title}"?`, text: "O post sai do mês junto com todo o histórico.", okLabel: "Excluir post", danger: true }))) return;
      const { error } = await sb.from("posts").delete().eq("id", p.id);
      error ? fail(error) : openMonth(m);
    });

    // Contestação: só faz sentido sobre uma reprovação
    const contests = G.STAGES.filter((s) => states[s.key].status === "reprovado").map((s) => {
      const note = el("textarea", { maxlength: "1500", placeholder: `Argumento da agência sobre o ajuste da ${s.label.toLowerCase()}` });
      const b = el("button", { class: "btn ghost" }, `Contestar ${s.label.toLowerCase()}`);
      b.addEventListener("click", async () => {
        if (note.value.trim().length < 10) return fail(new Error("Escreva o argumento (mín. 10 caracteres)."));
        const { error } = await sb.from("decisions").insert({
          post_id: p.id, stage: s.key, version_id: states[s.key].version?.id || null,
          actor: "agencia", status: "contestado", note: note.value.trim(),
        });
        error ? fail(error) : openMonth(m);
      });
      return el("div", { class: "decide" }, note, el("div", { class: "row" }, b));
    });

    // Revisão interna: pedir ajuste em cada parte e enviar o post completo ao cliente
    const review = GWork.reviewPanel({ sb, post: p, all: data.allVersions, urls: data.draftUrls, team: data.team,
      onChange: async (text) => { flash = { id: p.id, kind: "okk", text }; openPosts.add(p.id); await openMonth(m, true); } });
    if (flash?.id === p.id) { out.className = `msg ${flash.kind || "okk"}`; out.textContent = flash.text; flash = null; }

    // Recolhido por padrão: a linha mostra data, título e status; o resto abre no clique.
    // O que estava aberto continua aberto depois de salvar (a página re-renderiza).
    const row = el("details", { class: "post-row", id: `row-${p.id}`, open: openPosts.has(p.id) },
      el("summary", { class: "row between" },
        el("h4", {}, `${p.post_date.split("-").reverse().join("/")} · ${p.title}`),
        el("div", { class: "row" }, G.STAGES.map((s) =>
          el("span", { class: `pill ${states[s.key].status}` }, `${s.label}: ${G.STATUS_LABEL[states[s.key].status]}`)))),
      el("div", { class: "post-body" },
      composerBox,
      review,
      contests,
      G.STAGES.map((s) => G.historyList(data, states[s.key].decisions, s.key === "copy" ? "copy" : s.label.toLowerCase())),
      el("details", {}, el("summary", {}, `Comentários internos (${data.comments.filter((c) => c.post_id === p.id).length})${p.assignee ? ` · com ${GWork.nameOf(data.team, p.assignee)}` : ""}`),
        GWork.comments(sb, data.comments, data.team, p.id, () => openMonth(m))),
      p.kind === "oportunidade" ? el("div", { class: "row" },
        el("span", { class: "chip opp" }, p.origin === "cliente" ? "Oportunidade · pedido do cliente" : p.origin === "radar" ? "Validado pelo cliente · Radar" : "Oportunidade"),
        p.origin === "radar" ? el("span", { class: `msg${p.validation_withdrawn ? " err" : ""}` }, p.validation_withdrawn
          ? "O cliente retirou a validação depois que o post já tinha copy ou arte. Decida se segue."
          : `por ${p.validated_by || "cliente"}${p.validated_at ? ` em ${new Date(p.validated_at).toLocaleDateString("pt-BR")}` : ""}`) : null,
        p.respond_by ? el("span", { class: "msg" }, `Prazo: ${new Date(p.respond_by).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`) : null,
        dlSel) : null,
      el("div", { class: "row" }, edSel, linkBtn, sched, del), out));
    row.addEventListener("toggle", () => { row.open ? openPosts.add(p.id) : openPosts.delete(p.id); });
    return row;
  }

  async function exportJson(m) {
    const payload = { exported_at: new Date().toISOString(), month: m, ...(await loadData(m)) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `garten-${m.slug}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  boot();
})();
