// Relatório mensal — editor do admin (mesmo desenho do editor Sou Seara: lista | slide | inspetor).
// Trava real: RLS de reports (is_admin) + trigger que só deixa o servidor gravar os números (data/closed_at).
// Aqui o admin escreve textos, esconde slides e publica. Tudo do banco entra via textContent (G.el).
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const SLUG = /^\d{4}-\d{2}$/;
  const LIM = { analysis: 600, comments: 800, ltitle: 50, ltext: 220, steps: 6 };
  const NET = { instagram: "Instagram", facebook: "Facebook" };
  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const slugOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = (slug) => { const { mes, ano } = GDeck.monthName(slug); return `${mes[0].toUpperCase()}${mes.slice(1)} ${ano}`; };

  let reports = [], cur = null, urls = {}, sel = "capa", dirty = false, suggestions = [];
  let ui = {};

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    const role = await GAuth.role(sb);
    if (role === "equipe") { location.href = "kanban.html"; return; }
    if (role !== "admin") return GAuth.noAccess();
    const nav = GAuth.nav("relatorio.html", true);
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    GAuth.logout(sb);
    document.body.classList.add("rel-editor");
    addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
    addEventListener("resize", fitStage);
    const want = new URLSearchParams(location.search).get("r");
    await loadList();
    const first = SLUG.test(want || "") ? want : reports[0]?.slug || slugOf(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    await open(first);
  }

  async function loadList() {
    const { data } = await sb.from("reports").select("slug, status, closed_at").order("slug", { ascending: false });
    reports = data || [];
  }

  async function open(slug) {
    app.replaceChildren(msg("Carregando…"));
    const { data, error } = await sb.from("reports").select("*").eq("slug", slug).maybeSingle();
    if (error) return app.replaceChildren(msg(error.message, "err"));
    cur = data || { slug, status: "rascunho", data: {}, texts: {}, hidden: [], closed_at: null };
    cur.texts = { ...(cur.texts || {}) };
    cur.texts.learnings = GDeck.learningsOf(cur.texts);
    dirty = false; suggestions = [];
    history.replaceState(null, "", `?r=${slug}`);
    const paths = [];
    for (const n of Object.values(cur.data?.networks || {})) for (const t of n.top || []) if (t.image) paths.push(t.image);
    urls = await GWork.signed(sb, paths);
    render();
  }

  const setDirty = (v = true) => { dirty = v; if (ui.state) { ui.state.textContent = v ? "Alterações não salvas" : "Tudo salvo"; ui.state.classList.toggle("on", v); } };

  // Fecha (ou recalcula) o mês: os números vêm só do servidor
  async function closeMonth(btn) {
    btn.disabled = true; say("Buscando os números na Meta… pode levar meio minuto.");
    if (dirty) await save();
    const { error } = await sb.functions.invoke("relatorio", { body: { slug: cur.slug } });
    btn.disabled = false;
    if (error) return say("Não deu para fechar o mês. Tente de novo em instantes.", "err");
    await loadList(); await open(cur.slug);
  }

  async function save() {
    const texts = { ...cur.texts, learnings: cur.texts.learnings.filter((l) => l.title || l.text).length ? cur.texts.learnings : [] };
    const { error } = await sb.from("reports").upsert({ slug: cur.slug, texts, hidden: cur.hidden || [] }, { onConflict: "slug" });
    if (error) { say(error.message, "err"); return false; }
    setDirty(false); say("Salvo.", "ok"); return true;
  }

  async function setStatus(status) {
    if (dirty && !(await save())) return;
    const { error } = await sb.from("reports").update({ status }).eq("slug", cur.slug);
    if (error) return say(error.message, "err");
    await loadList(); await open(cur.slug);
  }

  const say = (text, kind = "") => { if (ui.out) { ui.out.className = `msg rel-out ${kind}`; ui.out.textContent = text; } };

  // ---------- layout ----------
  function render() {
    const closed = !!cur.closed_at;
    const opts = new Set(reports.map((r) => r.slug));
    for (let i = 1; i <= 6; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); opts.add(slugOf(d)); }
    opts.add(cur.slug);
    const select = el("select", { "aria-label": "Mês do relatório", onchange: async (e) => {
      if (dirty && !confirm("Há alterações não salvas. Trocar de mês mesmo assim?")) { e.target.value = cur.slug; return; }
      await open(e.target.value);
    } }, [...opts].sort().reverse().map((s) => {
      const r = reports.find((x) => x.slug === s);
      return el("option", { value: s, selected: s === cur.slug }, label(s) + (r ? (r.status === "publicado" ? " · publicado" : r.closed_at ? " · rascunho" : "") : ""));
    }));
    ui.out = el("p", { class: "msg rel-out", role: "status" });
    ui.state = el("span", { class: "rel-state" });

    const closeBtn = el("button", { class: "btn", type: "button", onclick: () => {
      if (cur.status === "publicado" && !confirm("O relatório já está publicado. Recalcular muda os números que o cliente vê. Continuar?")) return;
      closeMonth(closeBtn);
    } }, closed ? "Recalcular números" : "Fechar o mês");

    const bar = el("div", { class: "rel-bar" },
      el("b", { class: "rel-title" }, "Relatório"), select, closeBtn,
      closed ? el("button", { class: "btn", type: "button", onclick: save }, "Salvar") : null,
      closed ? el("button", { class: "btn", type: "button", onclick: () => GDeck.print(GDeck.build(cur, urls)) }, "Exportar PDF") : null,
      closed ? el("button", { class: "btn", type: "button", onclick: () => { const s = GDeck.build(cur, urls); if (s.length) GDeck.present(s); } }, "Apresentar") : null,
      closed ? (cur.status === "publicado"
        ? el("button", { class: "btn", type: "button", onclick: () => setStatus("rascunho") }, "Despublicar")
        : el("button", { class: "btn primary", type: "button", onclick: () => { if (confirm(`Publicar o relatório de ${label(cur.slug).toLowerCase()} para o cliente?`)) setStatus("publicado"); } }, "Publicar para o cliente")) : null,
      el("span", { class: "rel-meta" }, closed
        ? `${cur.status === "publicado" ? "Publicado · o cliente já vê" : "Rascunho · só você vê"} · números de ${new Date(cur.closed_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : "Mês ainda não fechado"), ui.state);

    if (!closed) {
      return app.replaceChildren(bar, ui.out, el("div", { class: "panel stack-0 rel-empty" },
        el("p", {}, "Fechar o mês busca alcance, compartilhamentos, salvamentos e seguidores do Instagram e do Facebook, e escolhe os 3 posts de destaque. Dá para recalcular depois.")));
    }

    ui.list = el("ol", { class: "rel-slides" });
    ui.stage = el("div", { class: "rel-stage" });
    ui.side = el("aside", { class: "rel-side" });
    app.replaceChildren(bar, ui.out, el("div", { class: "rel-3" }, el("nav", { class: "rel-nav", "aria-label": "Slides" }, ui.list), ui.stage, ui.side));
    drawList(); drawStage(); drawSide();
    setDirty(dirty);
  }

  function drawList() {
    let page = 0;
    ui.list.replaceChildren(...GDeck.plan(cur).map((s) => {
      const no = s.hidden ? "–" : String(++page).padStart(2, "0");
      return el("li", {}, el("button", { type: "button", class: `${s.id === sel ? "on" : ""}${s.hidden ? " off" : ""}`, "aria-current": s.id === sel ? "true" : false,
        onclick: () => { sel = s.id; drawList(); drawStage(); drawSide(); } }, el("span", { class: "rel-no" }, no), el("span", {}, s.label)));
    }));
  }

  function drawStage() {
    const frame = el("div", { class: "rel-frame" }, GDeck.one(cur, urls, sel));
    ui.stage.replaceChildren(frame);
    requestAnimationFrame(fitStage);
  }
  function fitStage() {
    const f = ui.stage?.querySelector(".rel-frame"); if (!f) return;
    const s = f.firstChild, k = Math.min((ui.stage.clientWidth - 48) / 1920, (ui.stage.clientHeight - 48) / 1080);
    s.style.transform = `scale(${k})`; f.style.width = `${1920 * k}px`; f.style.height = `${1080 * k}px`;
  }
  const refresh = () => { setDirty(); drawList(); drawStage(); };

  // ---------- inspetor ----------
  function counter(max, get) { const c = el("span", { class: "rel-count" }); const upd = () => { c.textContent = `${get().length} / ${max}`; }; upd(); return [c, upd]; }
  function field(title, value, max, onInput, multi = true, rows = 4) {
    const ta = el(multi ? "textarea" : "input", multi ? { rows, maxlength: String(max) } : { type: "text", maxlength: String(max) });
    ta.value = value || "";
    const [c, upd] = counter(max, () => ta.value);
    ta.addEventListener("input", () => { onInput(ta.value.slice(0, max)); upd(); refresh(); });
    return el("label", { class: "rel-field" }, el("span", { class: "rel-lbl" }, title), ta, c);
  }
  const help = (t) => el("p", { class: "rel-help" }, t);

  function drawSide() {
    const s = GDeck.plan(cur).find((x) => x.id === sel);
    const hide = el("input", { type: "checkbox", checked: s.manual, disabled: !!s.auto && !s.manual, onchange: (e) => {
      const h = new Set(cur.hidden || []); e.target.checked ? h.add(s.id) : h.delete(s.id); cur.hidden = [...h]; refresh(); drawSide();
    } });
    const parts = [el("h2", { class: "rel-side-t" }, s.label),
      el("label", { class: "rel-check" }, hide, el("span", {}, "Ocultar este slide")),
      s.auto ? help(autoWhy(s)) : null];
    const t = cur.texts;
    if (s.type === "rede") parts.push(field("Análise do mês", t[`analysis_${s.net}`], LIM.analysis, (v) => { t[`analysis_${s.net}`] = v; }, true, 7),
      help("Os números vêm do fechamento do mês. Se algo estiver errado, use Recalcular números."));
    else if (s.type === "comentarios") parts.push(field("Análise", t.comments, LIM.comments, (v) => { t.comments = v; }, true, 8),
      help("O que apareceu nos comentários e mensagens: dúvidas, elogios, pedidos de contato."));
    else if (s.type === "aprendizados") {
      parts.push(claudePanel());
      t.learnings.forEach((l, i) => parts.push(el("div", { class: "rel-box" },
        field(`Aprendizado ${i + 1}: título`, l.title, LIM.ltitle, (v) => { l.title = v; }, false),
        field("Descrição", l.text, LIM.ltext, (v) => { l.text = v; }, true, 4))));
    } else if (s.type === "proximos") {
      parts.push(field("Próximos passos (um por linha, até 6)", (t.next_steps || []).join("\n"), 900,
        (v) => { t.next_steps = v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, LIM.steps); }, true, 7));
    } else if (s.type === "top") {
      const n = cur.data.networks[s.net];
      parts.push(help("Os 3 posts com mais compartilhamentos + salvamentos no mês (desempate: alcance). A imagem vem da arte aprovada no sistema ou do próprio post."),
        el("ol", { class: "rel-toplist" }, (n.top || []).map((p) => el("li", {}, p.title))));
    } else if (s.type === "capa") parts.push(help("A capa mostra o mês do relatório e as redes que tiveram posts."));
    else parts.push(help("Este slide é montado só com os números do fechamento do mês."));
    parts.push(el("p", { class: "rel-help rel-foot" }, "Os textos ficam salvos no sistema. O cliente só vê depois de publicar."));
    ui.side.replaceChildren(...parts.filter(Boolean));
  }

  function autoWhy(s) {
    if (s.type === "cmp") return "Escondido sozinho: não há posts do mês anterior para comparar.";
    if (["div", "rede", "leitura"].includes(s.type)) return `Escondido sozinho: ${NET[s.net]} não teve posts neste mês (ou poucos para comparar formatos).`;
    if (s.type === "top") return "Escondido sozinho: nenhum post com métricas neste mês.";
    return "Escondido sozinho até ter texto. Escreva abaixo e ele aparece.";
  }

  // ---------- Sugestões com o Claude ----------
  // Sem chamada de rede: copia instruções + dados do mês; você cola no Claude e cola a resposta de volta.
  function claudePayload() {
    const d = cur.data, r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    const redes = {};
    for (const [k, n] of Object.entries(d.networks || {})) {
      const c = n.current || {}, p = n.previous;
      if (!c.posts && !c.stories) continue;
      redes[NET[k]] = { publicacoes: c.posts, stories: c.stories, alcance: c.reach, visualizacoes: c.views, compartilhamentos: c.shares,
        salvamentos: c.saved, curtidas: c.likes, comentarios: c.comments, interacoes: c.interactions,
        taxa_engajamento_pct: c.reach ? r1((c.interactions / c.reach) * 100) : null,
        mes_anterior: p ? { publicacoes: p.posts, alcance: p.reach, compartilhamentos: p.shares, salvamentos: p.saved, interacoes: p.interactions } : null,
        seguidores: n.followers?.end ?? null, conta: n.account || {},
        por_formato: (n.byFormat || []).map((x) => ({ formato: x.name, posts: x.posts, media_compart_mais_salvos: r1(x.shares + x.saved), media_alcance: r1(x.reach) })),
        por_editoria: (n.byEditoria || []).map((x) => ({ editoria: x.name, posts: x.posts, media_compart_mais_salvos: r1(x.shares + x.saved), media_alcance: r1(x.reach) })),
        top_posts: (n.top || []).map((x, i) => ({ posicao: i + 1, titulo: x.title, formato: G.FORMATS[x.format] || x.format, compartilhamentos: x.shares, salvamentos: x.saved, alcance: x.reach })),
        analise_escrita: cur.texts[`analysis_${k}`] || "" };
    }
    const dados = { mes: label(cur.slug), redes, comentarios: cur.texts.comments || "", observacoes_automaticas: d.auto_insights || [],
      aprendizados_atuais: cur.texts.learnings.filter((l) => l.title || l.text).map((l) => ({ titulo: l.title, descricao: l.text })) };
    return [
      "Você vai sugerir os aprendizados do mês para o relatório de redes sociais da Garten, escritório de contabilidade (público: donos de pequenas e médias empresas).",
      "",
      "Regras:",
      "- Sugira de 4 a 6 aprendizados. Cada um vira um cartão no slide: título de até 50 caracteres e descrição de até 220.",
      "- Só afirme o que os números abaixo sustentam. Cite o número que comprova. Com poucos posts (menos de 4 num grupo), diga que ainda é sinal, não tendência.",
      "- Métricas principais da Garten: compartilhamentos e salvamentos. Alcance e curtidas vêm depois.",
      "- Tom da Garten: direto, sem jargão, sem exagero, sem emojis, sem travessão. Frases curtas.",
      "- Aprendizado é algo que muda a próxima pauta, não um resumo do número.",
      "",
      "Responda SÓ com um bloco ```json no formato:",
      '{"aprendizados":[{"titulo":"...","descricao":"...","base":"de onde veio (número/post)"}]}',
      "",
      "Dados do mês (RELATORIO_GARTEN v1):",
      JSON.stringify(dados, null, 1),
    ].join("\n");
  }
  function parseClaude(text) {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (!m) throw new Error("Não encontrei o bloco JSON na resposta. Copie a resposta inteira do Claude.");
    let d; try { d = JSON.parse(m[1]); } catch { throw new Error("O JSON da resposta veio incompleto. Peça para o Claude responder de novo."); }
    const list = Array.isArray(d?.aprendizados) ? d.aprendizados : [];
    const s = (v, n) => String(v ?? "").trim().slice(0, n);
    const out = list.map((a) => ({ title: s(a?.titulo, LIM.ltitle), text: s(a?.descricao, LIM.ltext), base: s(a?.base, 200) })).filter((a) => a.title || a.text).slice(0, 8);
    if (!out.length) throw new Error("A resposta não trouxe aprendizados no formato esperado.");
    return out;
  }
  function claudePanel() {
    const note = el("p", { class: "rel-help", role: "status" });
    const manual = el("textarea", { class: "rel-manual", readonly: true, hidden: true, rows: 4, "aria-label": "Texto para copiar manualmente" });
    const paste = el("textarea", { rows: 4, placeholder: "Cole aqui a resposta do Claude" });
    const list = el("div", { class: "rel-sugs" });
    const drawSugs = () => list.replaceChildren(...suggestions.map((a) => el("div", { class: "rel-sug" },
      el("b", {}, a.title), el("span", {}, a.text), a.base ? el("small", {}, `Base: ${a.base}`) : null,
      el("div", { class: "rel-use" }, el("span", {}, "Usar em:"), [0, 1, 2].map((i) => el("button", { class: "btn sm", type: "button", onclick: () => {
        cur.texts.learnings[i] = { title: a.title, text: a.text }; refresh(); drawSide();
      } }, `#${i + 1}`))))));
    drawSugs();
    const copy = async () => {
      const text = claudePayload();
      try { await navigator.clipboard.writeText(text); note.textContent = "Dados copiados. Cole numa conversa nova do Claude e traga a resposta para cá."; }
      catch { manual.hidden = false; manual.value = text; manual.focus(); manual.select(); note.textContent = "Não deu para copiar sozinho: o texto está selecionado abaixo, use Cmd+C."; }
    };
    return el("div", { class: "rel-box rel-ai" },
      el("b", {}, "Sugestões com o Claude"),
      help("1. Copie os dados do mês e cole numa conversa nova do Claude. 2. Cole a resposta abaixo. 3. Escolha quais sugestões usar e revise o texto antes de publicar."),
      el("div", { class: "rel-row" },
        el("button", { class: "btn primary", type: "button", onclick: copy }, "Copiar dados para o Claude"),
        el("a", { class: "btn", href: "https://claude.ai/new", target: "_blank", rel: "noopener noreferrer" }, "Abrir o Claude ↗")),
      manual, note,
      el("label", { class: "rel-field" }, el("span", { class: "rel-lbl" }, "Resposta do Claude"), paste),
      el("button", { class: "btn", type: "button", onclick: () => {
        try { suggestions = parseClaude(paste.value); note.textContent = `${suggestions.length} sugestões lidas.`; drawSugs(); }
        catch (e) { note.textContent = e.message; }
      } }, "Ler sugestões"),
      list);
  }

  boot();
})();
