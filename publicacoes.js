// Publicações — só admin. A trava real está no RLS (ig_media, ig_sync_runs: is_admin()).
// Fila (agendados e erros), leitura do período (por editoria e formato) e lista do que saiu,
// inclusive o que foi publicado direto pelo app. Tudo do banco entra via textContent (G.el).
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);
  const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; } };
  const nf = new Intl.NumberFormat("pt-BR");
  const num = (v) => (v == null ? "—" : nf.format(v));
  const pctf = (v) => (v == null || !isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
  const dt = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 6e4);
    if (m < 1) return "agora"; if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60); return h < 24 ? `há ${h}h` : `há ${Math.round(h / 24)} dias`;
  };
  const until = (iso) => {
    const m = Math.round((new Date(iso) - Date.now()) / 6e4);
    if (m <= 0) return "saindo agora"; if (m < 60) return `sai em ${m} min`;
    const h = Math.round(m / 60); return h < 48 ? `sai em ${h}h` : `sai em ${Math.round(h / 24)} dias`;
  };

  const PERIODS = { "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias" };
  let period = "90";
  let d = null;

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    const role = await GAuth.role(sb);
    if (role === "equipe") { location.href = "kanban.html"; return; }
    if (role !== "admin") return GAuth.noAccess();
    const nav = GAuth.nav("publicacoes.html", true);
    if (nav && !document.querySelector(".topnav")) document.getElementById("top-actions").prepend(nav);
    GAuth.logout(sb);
    await load();
  }

  async function load() {
    app.replaceChildren(msg("Carregando…"));
    const since = new Date(Date.now() - Number(period) * 864e5).toISOString();
    const [media, queue, eds, runs] = await Promise.all([
      sb.from("ig_media").select("*").gte("published_at", since).order("published_at", { ascending: false }),
      sb.from("posts").select("id, title, format, editoria, scheduled_at, publish_status, publish_error, stories_done, months(slug)")
        .in("publish_status", ["agendado", "publicando", "erro"]).order("scheduled_at"),
      sb.from("editorias").select("slug, name").order("sort"),
      sb.from("ig_sync_runs").select("*").order("run_at", { ascending: false }).limit(1),
    ]);
    const err = media.error || queue.error;
    if (err) return app.replaceChildren(msg(err.message, "err"));
    // Posts do sistema ligados às mídias (título, formato, editoria)
    const pids = [...new Set((media.data || []).map((m) => m.post_id).filter(Boolean))];
    const posts = pids.length ? (await sb.from("posts").select("id, title, format, editoria, months(slug)").in("id", pids)).data || [] : [];
    // Miniatura da fila: arte atual enviada de cada post
    const qids = (queue.data || []).map((p) => p.id);
    const vers = qids.length ? (await sb.from("versions").select("post_id, number, asset_paths").in("post_id", qids).eq("stage", "arte").eq("sent", true)).data || [] : [];
    const cover = {};
    for (const v of vers) if (!cover[v.post_id] || v.number > cover[v.post_id].number) cover[v.post_id] = v;
    const urls = await GWork.signed(sb, Object.values(cover).map((v) => v.asset_paths?.[0]).filter(Boolean));
    d = { media: media.data || [], queue: queue.data || [], posts: new Map(posts.map((p) => [p.id, p])),
      eds: eds.data || [], run: runs.data?.[0] || null, cover, urls };
    render();
  }

  // Formato e editoria de cada mídia: do post do sistema quando houver, senão do Instagram
  const fmtOf = (m) => {
    const p = m.post_id && d.posts.get(m.post_id);
    if (m.product_type === "STORY") return "stories";
    if (m.product_type === "REELS") return "reels";
    if (p?.format && p.format !== "stories") return p.format;
    return m.media_type === "CAROUSEL_ALBUM" ? "carrossel" : m.media_type === "VIDEO" ? "reels" : "estatico";
  };
  const edOf = (m) => (m.post_id && d.posts.get(m.post_id)?.editoria) || m.editoria || null;
  const edName = (slug) => d.eds.find((e) => e.slug === slug)?.name || "Sem editoria";
  const interactions = (m) => [m.like_count, m.comments_count, m.shares, m.saved].reduce((a, b) => a + (b || 0), 0);

  function render() {
    const hasInsights = d.media.some((m) => m.reach != null);
    app.replaceChildren(header(hasInsights), queueSection(), reading(hasInsights), listSection(hasInsights));
  }

  // ---------- Cabeçalho: período, última atualização, atualizar agora ----------
  function header(hasInsights) {
    const sel = el("select", { class: "ov-pick", "aria-label": "Período" },
      Object.entries(PERIODS).map(([k, v]) => el("option", { value: k, selected: k === period }, v)));
    sel.addEventListener("change", () => { period = sel.value; load(); });
    const out = msg("");
    const btn = el("button", { class: "btn ghost", type: "button" }, "Atualizar agora");
    btn.addEventListener("click", async () => {
      btn.disabled = true; out.className = "msg"; out.textContent = "Buscando no Instagram…";
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(`${cfg.supabaseUrl}/functions/v1/metricas`, { method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: cfg.publishableKey } });
        const j = await res.json().catch(() => ({}));
        if (j.skipped) { out.textContent = "Já atualizado há menos de 2 minutos."; btn.disabled = false; return; }
        if (!res.ok) throw new Error(j.error || `Erro ${res.status}`);
        await load();
      } catch (e) { out.className = "msg err"; out.textContent = e.message; btn.disabled = false; }
    });
    const run = d.run;
    const status = run ? `Atualizado ${ago(run.run_at)} · sincroniza de hora em hora` : "Ainda não sincronizado";
    const perm = run?.error && /instagram_manage_insights/.test(run.error);
    return el("section", { class: "pub-head" },
      el("div", { class: "row between" }, el("h2", {}, "Publicações"), el("div", { class: "row" }, sel, btn)),
      el("p", { class: "msg" }, status), out,
      perm || !hasInsights ? el("div", { class: "content-box alert" },
        el("span", { class: "eyebrow" }, "Alcance e salvamentos indisponíveis"),
        perm ? "O token da Meta ainda não tem a permissão de métricas (instagram_manage_insights). Curtidas e comentários aparecem; alcance, salvamentos e compartilhamentos entram depois de gerar o token novo."
          : "As métricas de alcance ainda não chegaram. Elas aparecem na próxima sincronização.") : null,
      run && !run.ok && !perm ? msg(`Última sincronização falhou: ${run.error}`, "err") : null);
  }

  // ---------- Fila: erros primeiro, depois agendados ----------
  function queueSection() {
    const items = [...d.queue].sort((a, b) => (a.publish_status === "erro" ? -1 : 0) - (b.publish_status === "erro" ? -1 : 0)
      || new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const card = (p) => {
      const path = d.cover[p.id]?.asset_paths?.[0];
      const src = path && d.urls[path];
      const href = `kanban.html?mes=${encodeURIComponent(p.months?.slug || "")}&post=${encodeURIComponent(p.id)}`;
      const bad = p.publish_status === "erro";
      return el("li", { class: `pub-q${bad ? " bad" : ""}` },
        src && !/\.mp4$/i.test(path) ? el("img", { src, alt: "", loading: "lazy" }) : el("span", { class: "pub-q-ph" }),
        el("div", { class: "pub-q-body" },
          el("a", { href, class: "pub-q-title" }, p.title),
          el("span", { class: "msg" }, `${G.FORMATS[p.format] || p.format} · ${p.scheduled_at ? dt(p.scheduled_at) : "sem horário"}`),
          bad ? el("span", { class: "msg err" }, p.publish_error || "Erro ao publicar")
            : el("span", { class: "pub-when" }, p.publish_status === "publicando" ? "Publicando agora" : until(p.scheduled_at))),
        bad ? el("a", { class: "btn ghost", href }, "Abrir e reagendar") : null);
    };
    return el("section", { class: "panel" },
      el("h3", { class: "ov-h" }, `Fila · ${items.length}`),
      items.length ? el("ul", { class: "pub-queue" }, items.map(card)) : msg("Nada agendado agora."));
  }

  // ---------- Leitura do período ----------
  function reading(hasInsights) {
    const feed = d.media.filter((m) => m.product_type !== "STORY");
    const stories = d.media.filter((m) => m.product_type === "STORY");
    if (!d.media.length) return el("section", { class: "panel" }, el("h3", { class: "ov-h" }, "Leitura do período"), msg("Nada publicado neste período."));
    const sum = (list, k) => list.reduce((a, m) => a + (m[k] || 0), 0);
    const tile = (label, value, sub, tone) => el("div", { class: `ov-tile${tone ? ` ${tone}` : ""}` },
      el("span", { class: "ov-label" }, label), el("b", { class: "ov-num" }, value), sub ? el("span", { class: "ov-sub" }, sub) : null);
    const reachFeed = sum(feed, "reach"), savedFeed = sum(feed, "saved");

    // Agrupa por editoria ou formato. Métrica principal: salvamentos (utilidade)
    const group = (keyFn, nameFn) => {
      const g = new Map();
      for (const m of feed) { const k = keyFn(m) || ""; (g.get(k) || g.set(k, []).get(k)).push(m); }
      return [...g.entries()].map(([k, list]) => ({
        name: nameFn(k), n: list.length,
        reach: hasInsights ? sum(list, "reach") / list.length : null,
        saved: hasInsights ? sum(list, "saved") / list.length : null,
        rate: hasInsights && sum(list, "reach") ? sum(list, "saved") / sum(list, "reach") : null,
        inter: list.reduce((a, m) => a + interactions(m), 0) / list.length,
      })).sort((a, b) => (b.saved ?? b.inter) - (a.saved ?? a.inter));
    };
    // A CSP não permite style inline: largura via CSSOM
    const bar = (f) => { const i = el("i"); i.style.width = `${Math.round(f * 100)}%`; return i; };
    const table = (title, rows) => {
      const max = Math.max(1, ...rows.map((r) => r.saved ?? r.inter));
      return el("div", { class: "pub-table" },
        el("h3", { class: "ov-h" }, title),
        el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "Posts"),
            el("th", {}, hasInsights ? "Salvamentos (média)" : "Interações (média)"),
            el("th", {}, "Alcance (média)"), el("th", {}, "Taxa de salvamento"))),
          el("tbody", {}, rows.map((r) => {
            const v = r.saved ?? r.inter;
            return el("tr", {}, el("th", { scope: "row" }, r.name), el("td", {}, String(r.n)),
              el("td", {}, el("div", { class: "pub-bar" }, bar(v / max),
                el("span", {}, v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })))),
              el("td", {}, r.reach == null ? "—" : nf.format(Math.round(r.reach))),
              el("td", {}, pctf(r.rate)));
          }))));
    };
    const best = (k) => feed.filter((m) => m[k] != null).sort((a, b) => b[k] - a[k])[0];
    const topSaved = hasInsights ? best("saved") : null, topReach = hasInsights ? best("reach") : null;
    const titleOf = (m) => (m.post_id && d.posts.get(m.post_id)?.title) || (m.caption || "").split("\n")[0].slice(0, 70) || "Post sem legenda";
    return el("section", { class: "panel" },
      el("h3", { class: "ov-h" }, "Leitura do período"),
      el("div", { class: "ov-grid" },
        tile("Posts no feed", String(feed.length), `${stories.length} Stories no período`),
        tile("Salvamentos", hasInsights ? num(savedFeed) : "—", hasInsights && reachFeed ? `${pctf(savedFeed / reachFeed)} de quem viu salvou` : "métrica principal", "ok"),
        tile("Alcance somado", hasInsights ? num(reachFeed) : "—", hasInsights ? `média de ${num(Math.round(reachFeed / Math.max(1, feed.length)))} por post` : null),
        tile("Interações", num(feed.reduce((a, m) => a + interactions(m), 0)), "curtidas, comentários, salvamentos e compartilhamentos")),
      topSaved || topReach ? el("div", { class: "pub-best" },
        topSaved ? el("p", {}, el("span", { class: "eyebrow" }, "Mais salvo"), ` ${titleOf(topSaved)} · ${num(topSaved.saved)} salvamentos`) : null,
        topReach ? el("p", {}, el("span", { class: "eyebrow" }, "Maior alcance"), ` ${titleOf(topReach)} · ${num(topReach.reach)} pessoas`) : null) : null,
      feed.length ? table("Por editoria", group(edOf, (k) => (k ? edName(k) : "Sem editoria"))) : null,
      feed.length ? table("Por formato", group(fmtOf, (k) => G.FORMATS[k] || k)) : null);
  }

  // ---------- O que saiu ----------
  function listSection(hasInsights) {
    const card = (m) => {
      const p = m.post_id && d.posts.get(m.post_id);
      const link = safeUrl(m.permalink);
      const thumb = safeUrl(m.thumb_url);
      const fmt = fmtOf(m);
      const title = p?.title || (m.caption || "").split("\n")[0].slice(0, 90) || (fmt === "stories" ? "Stories" : "Post sem legenda");
      let ed = null;
      if (!p) { // publicado pelo app: classificar à mão para entrar na leitura por editoria
        ed = el("select", { class: "ov-pick", "aria-label": `Editoria de ${title}` },
          el("option", { value: "" }, "Sem editoria"), d.eds.map((e) => el("option", { value: e.slug }, e.name)));
        ed.value = m.editoria || "";
        ed.addEventListener("change", async () => {
          const { error } = await sb.rpc("set_media_editoria", { p_media: m.id, p_editoria: ed.value || null });
          if (error) { alert(error.message); ed.value = m.editoria || ""; return; }
          m.editoria = ed.value || null; render();
        });
      }
      const stat = (label, v, strong) => el("div", { class: `pub-stat${strong ? " strong" : ""}` }, el("b", {}, num(v)), el("span", {}, label));
      const stats = fmt === "stories"
        ? [stat("alcance", m.reach, true), stat("respostas", m.replies), stat("compart.", m.shares)]
        : [stat("salvos", m.saved, true), stat("alcance", m.reach), stat("curtidas", m.like_count), stat("coment.", m.comments_count), stat("compart.", m.shares)];
      return el("li", { class: "pub-card" },
        el(link ? "a" : "div", { class: "pub-thumb", href: link || false, target: link ? "_blank" : false, rel: link ? "noopener" : false, "aria-label": link ? `Abrir ${title} no Instagram` : false },
          thumb ? el("img", { src: thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "pub-q-ph" })),
        el("div", { class: "pub-card-body" },
          el("div", { class: "row" }, el("span", { class: "chip" }, G.FORMATS[fmt] || fmt),
            el("span", { class: "msg" }, `${dt(m.published_at)} · ${p ? "pelo sistema" : "pelo app"}`)),
          el("b", { class: "pub-title" }, title),
          p ? el("span", { class: "msg" }, edName(p.editoria)) : ed,
          el("div", { class: "pub-stats" }, stats),
          m.insights_error && hasInsights ? el("span", { class: "msg err" }, m.insights_error) : null));
    };
    return el("section", { class: "panel" },
      el("h3", { class: "ov-h" }, `Publicados · ${d.media.length}`),
      d.media.length ? el("ul", { class: "pub-list" }, d.media.map(card)) : msg("Nada publicado neste período."),
      d.media.some((m) => m.product_type === "STORY") ? el("p", { class: "msg" }, "Stories têm métricas só nas primeiras 24h; depois disso os números ficam congelados.") : null);
  }

  boot();
})();
