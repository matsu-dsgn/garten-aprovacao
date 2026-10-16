(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").prepend(G.logoMark());
  document.getElementById("top-actions").append(GartenTheme.button());

  const SLUG_RE = /^[a-z0-9-]{3,40}$/;
  const FORMATS = Object.keys(G.FORMATS);
  const MAX_FILE = 15 * 1024 * 1024;
  const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

  let months = [];
  let current = null; // mês aberto
  let data = null;    // posts/versions/decisions/approvers do mês

  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const field = (label, input) => el("label", { class: "f" }, label, input);

  // ---------- Login ----------
  function loginView(error) {
    const email = el("input", { type: "email", autocomplete: "email", required: true });
    const pass = el("input", { type: "password", autocomplete: "current-password", minlength: "10", required: true });
    const out = msg(error || "", error ? "err" : "");
    const go = async (fn) => {
      out.className = "msg"; out.textContent = "…";
      const { error } = await fn({ email: email.value.trim(), password: pass.value });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      boot();
    };
    app.replaceChildren(el("section", { class: "panel narrow" },
      el("h2", {}, "Entrar"),
      field("E-mail", email), field("Senha (mín. 10 caracteres)", pass),
      el("div", { class: "row" },
        el("button", { class: "btn dark", onclick: () => go((c) => sb.auth.signInWithPassword(c)) }, "Entrar"),
        el("button", { class: "btn ghost", onclick: () => go((c) => sb.auth.signUp(c)) }, "Criar acesso")),
      out));
  }

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return loginView();
    const { data: me } = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!me) {
      app.replaceChildren(el("section", { class: "panel" },
        el("h2", {}, "Acesso ainda não liberado"),
        el("p", {}, "Esta conta existe, mas não é admin. Passe este ID para liberar:"),
        el("code", { class: "link" }, user.id),
        el("button", { class: "btn ghost", onclick: async () => { await sb.auth.signOut(); loginView(); } }, "Sair")));
      return;
    }
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

  function parsePilares(text) {
    return text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8).map((l) => {
      const [nome, ...rest] = l.split(/\s+[—-]\s+/);
      return { nome: nome.slice(0, 60), desc: rest.join(" — ").slice(0, 200) };
    });
  }

  function monthForm(m) {
    const slug = el("input", { type: "text", value: m?.slug || "", placeholder: "2026-11", disabled: !!m });
    const title = el("input", { type: "text", value: m?.title || "", maxlength: "120", placeholder: "Novembro 2026" });
    const intro = el("textarea", { maxlength: "400", placeholder: "Frase de abertura do mês" });
    intro.value = m?.overview?.intro || "";
    const pil = el("textarea", { placeholder: "Um pilar por linha: Nome — descrição" });
    pil.value = (m?.overview?.pilares || []).map((p) => `${p.nome} — ${p.desc}`).join("\n");
    const out = msg("");
    const save = el("button", { class: "btn dark" }, m ? "Salvar mês" : "Criar mês");
    save.addEventListener("click", async () => {
      const row = { title: title.value.trim(), overview: { intro: intro.value.trim().slice(0, 400), pilares: parsePilares(pil.value) } };
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
      field("Intro", intro), field("Pilares", pil), el("div", { class: "row" }, save), out);
  }

  function monthsView() {
    app.replaceChildren(
      el("section", { class: "panel" },
        el("div", { class: "row between" },
          el("h2", {}, "Meses"),
          el("button", { class: "btn ghost", onclick: async () => { await sb.auth.signOut(); loginView(); } }, "Sair")),
        months.length ? el("div", { class: "row" }, months.map((m) =>
          el("button", { class: "btn ghost", onclick: () => { current = m; openMonth(m); } }, m.title))) : msg("Nenhum mês ainda.")),
      monthForm(null));
  }

  // ---------- Mês aberto ----------
  async function loadData(m) {
    const { data: posts, error } = await sb.from("posts").select("*").eq("month_id", m.id).order("post_date").order("sort");
    if (error) throw error;
    const ids = posts.map((p) => p.id);
    const [v, d, a] = await Promise.all([
      ids.length ? sb.from("versions").select("*").in("post_id", ids).order("number") : { data: [] },
      ids.length ? sb.from("decisions").select("*").in("post_id", ids).order("created_at") : { data: [] },
      sb.from("approvers").select("*").order("is_final", { ascending: false }),
    ]);
    return { posts, versions: v.data || [], decisions: d.data || [], approvers: a.data || [] };
  }

  async function openMonth(m) {
    app.replaceChildren(msg("Carregando…"));
    try { data = await loadData(m); } catch (e) { return app.replaceChildren(msg(e.message, "err")); }
    app.replaceChildren(
      el("div", { class: "row" },
        el("button", { class: "btn ghost", onclick: () => { current = null; monthsView(); } }, "← Meses"),
        el("button", { class: "btn ghost", onclick: () => exportJson(m) }, "Exportar JSON")),
      linkPanel(m),
      monthForm(m),
      importPanel(m),
      el("section", { class: "panel" }, el("h2", {}, `Posts (${data.posts.length})`),
        data.posts.length ? data.posts.map((p) => postRow(m, p)) : msg("Nenhum post. Importe o JSON da pauta acima.")));
  }

  function linkPanel(m) {
    const out = el("div", {});
    const gen = el("button", { class: "btn dark" }, "Gerar novo link");
    gen.addEventListener("click", async () => {
      if (!confirm("Gerar um novo link invalida o anterior. Continuar?")) return;
      const { data: token, error } = await sb.rpc("rotate_month_token", { p_month: m.id });
      if (error) { out.replaceChildren(msg(error.message, "err")); return; }
      const base = location.href.replace(/admin\.html.*$/, "");
      const url = `${base}index.html?m=${encodeURIComponent(m.slug)}#k=${token}`;
      const copy = el("button", { class: "btn ok", onclick: () => navigator.clipboard?.writeText(url) }, "Copiar link");
      out.replaceChildren(el("code", { class: "link" }, url), el("div", { class: "row" }, copy),
        msg("Guarde agora: por segurança, o link não fica salvo em texto e não pode ser recuperado depois."));
    });
    const revoke = el("button", { class: "btn bad" }, "Encerrar link");
    revoke.addEventListener("click", async () => {
      if (!confirm("Encerrar o link? O cliente perde o acesso até você gerar um novo.")) return;
      const { error } = await sb.rpc("revoke_month_token", { p_month: m.id });
      out.replaceChildren(error ? msg(error.message, "err") : msg("Link encerrado. O histórico continua salvo.", "okk"));
    });
    return el("section", { class: "panel" }, el("h2", {}, "Link do cliente"),
      el("p", {}, "O link dá acesso só a este mês. Mande pelo WhatsApp para o Wilker e a Letícia."),
      el("div", { class: "row" }, gen, revoke), out);
  }

  function validPost(p, i) {
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) errs.push("date (AAAA-MM-DD)");
    if (!FORMATS.includes(p.format)) errs.push(`format (${FORMATS.join("/")})`);
    if (!p.title || String(p.title).length > 160) errs.push("title (até 160)");
    if (errs.length) throw new Error(`Post ${i + 1}: ${errs.join(", ")}`);
    return {
      post_date: p.date, format: p.format, title: String(p.title).trim(),
      theme: p.theme ? String(p.theme).slice(0, 60) : null,
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

  // Confere a assinatura real do arquivo, não só a extensão/MIME declarados
  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith("89504e47")) return "image/png";
    if (hex.startsWith("ffd8ff")) return "image/jpeg";
    if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return "image/webp";
    if (hex.slice(8, 16) === "66747970") return "video/mp4";
    return null;
  }

  async function uploadArte(m, p, files, out) {
    const list = [...files];
    if (!list.length || list.length > 20) throw new Error("Envie de 1 a 20 arquivos.");
    for (const f of list) {
      if (f.size > MAX_FILE) throw new Error(`${f.name}: máximo 15 MB.`);
      const real = await sniff(f);
      if (!real || !TYPES[real] || real !== f.type) throw new Error(`${f.name}: tipo não permitido (PNG, JPG, WEBP ou MP4).`);
    }
    const n = (G.latestVersion(data.versions, p.id, "arte")?.number || 0) + 1;
    const paths = [];
    for (const [i, f] of list.entries()) {
      out.textContent = `Enviando ${i + 1}/${list.length}…`;
      const path = `${m.slug}/${p.id}/arte-v${n}/${String(i + 1).padStart(2, "0")}.${TYPES[f.type]}`;
      const { error } = await sb.storage.from("artes").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      paths.push(path);
    }
    const { error } = await sb.from("versions").insert({ post_id: p.id, stage: "arte", number: n, asset_paths: paths });
    if (error) throw error;
  }

  function postRow(m, p) {
    const out = msg("");
    const fail = (e) => { out.className = "msg err"; out.textContent = e.message || String(e); };
    const states = Object.fromEntries(G.STAGES.map((s) => [s.key, G.stageState(data, p, s.key)]));

    const copyTa = el("textarea", { maxlength: "5000", placeholder: "Nova versão da copy" });
    const copyBtn = el("button", { class: "btn dark" }, "Subir copy");
    copyBtn.addEventListener("click", async () => {
      const text = copyTa.value.trim();
      if (!text) return fail(new Error("Copy vazia."));
      const n = (G.latestVersion(data.versions, p.id, "copy")?.number || 0) + 1;
      const { error } = await sb.from("versions").insert({ post_id: p.id, stage: "copy", number: n, copy_text: text });
      error ? fail(error) : openMonth(m);
    });

    const fileIn = el("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/webp,video/mp4" });
    const arteBtn = el("button", { class: "btn dark" }, "Subir arte");
    arteBtn.addEventListener("click", async () => {
      arteBtn.disabled = true;
      try { await uploadArte(m, p, fileIn.files, out); openMonth(m); } catch (e) { fail(e); arteBtn.disabled = false; }
    });

    const sched = el("button", { class: "btn ghost" }, p.scheduled ? "Desmarcar agendado" : "Marcar como agendado");
    sched.addEventListener("click", async () => {
      const { error } = await sb.from("posts").update({ scheduled: !p.scheduled }).eq("id", p.id);
      error ? fail(error) : openMonth(m);
    });
    const del = el("button", { class: "btn bad" }, "Excluir post");
    del.addEventListener("click", async () => {
      if (!confirm(`Excluir "${p.title}" e todo o histórico dele?`)) return;
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

    return el("div", { class: "post-row" },
      el("div", { class: "row between" },
        el("h4", {}, `${p.post_date.split("-").reverse().join("/")} · ${p.title}`),
        el("div", { class: "row" }, G.STAGES.map((s) =>
          el("span", { class: `pill ${states[s.key].status}` }, `${s.label}: ${G.STATUS_LABEL[states[s.key].status]}`)))),
      el("details", {}, el("summary", {}, "Copy e arte"),
        el("div", { class: "stack" },
          copyTa, el("div", { class: "row" }, copyBtn),
          fileIn, el("div", { class: "row" }, arteBtn))),
      contests,
      G.STAGES.map((s) => G.historyList(data, states[s.key].decisions)),
      el("div", { class: "row" }, sched, del), out);
  }

  async function exportJson(m) {
    const payload = { exported_at: new Date().toISOString(), month: m, ...(await loadData(m)) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `garten-${m.slug}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  boot();
})();
