// Peças compartilhadas entre painel (admin) e Kanban (equipe):
// prévia de versões, comentários internos e upload de arte/copy como rascunho.
window.GWork = (() => {
  const { el } = G;
  const MAX_FILE = 15 * 1024 * 1024;
  const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4" };

  async function signed(sb, paths) {
    if (!paths.length) return {};
    const { data } = await sb.storage.from("artes").createSignedUrls(paths, 3600);
    const out = {};
    for (const s of data || []) if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
    return out;
  }

  function preview(v, urls) {
    if (v.stage === "copy") return el("div", { class: "stack-0" },
      el("div", { class: "content-box" }, el("span", { class: "eyebrow" }, "Texto da arte"), v.copy_text || ""),
      v.caption_text ? el("div", { class: "content-box" }, el("span", { class: "eyebrow" }, "Legenda"), v.caption_text) : null);
    return el("div", { class: "thumbs" }, (v.asset_paths || []).map((p) => /\.mp4$/i.test(p)
      ? el("video", { src: urls[p], controls: true, preload: "metadata" })
      : el("a", { href: urls[p], target: "_blank", rel: "noopener" }, el("img", { src: urls[p], alt: "", loading: "lazy" }))));
  }

  const nameOf = (team, email) => (team.find((t) => t.email === email) || {}).name || (email || "").split("@")[0];
  const when = (ts) => new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  function comments(sb, list, team, postId, onChange) {
    const ta = el("textarea", { maxlength: "1500", placeholder: "Comentário interno (o cliente não vê)" });
    const send = el("button", { class: "btn ghost", type: "button" }, "Comentar");
    const out = el("p", { class: "msg" });
    send.addEventListener("click", async () => {
      const body = ta.value.trim();
      if (!body) return;
      send.disabled = true;
      const { data: email } = await sb.rpc("auth_email");
      const { error } = await sb.from("post_comments").insert({ post_id: postId, body, author_email: email });
      send.disabled = false;
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      onChange();
    });
    const mine = list.filter((c) => c.post_id === postId);
    return el("div", { class: "comments" },
      mine.length ? el("ul", { class: "history" }, mine.map((c) => el("li", {},
        el("span", { class: "whoname" }, nameOf(team, c.author_email)), el("time", {}, when(c.created_at)),
        el("div", {}, c.body)))) : null,
      ta, el("div", { class: "row" }, send), out);
  }

  // Confere a assinatura real do arquivo, não só a extensão
  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (hex.startsWith("89504e47")) return "image/png";
    if (hex.startsWith("ffd8ff")) return "image/jpeg";
    if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return "image/webp";
    if (hex.slice(8, 16) === "66747970") return "video/mp4";
    return null;
  }

  // Sobe arte. sent=false manda para revisão interna; admin pode mandar direto ao cliente
  async function uploadArte(sb, { slug, post, allVersions, files, sent, onProgress }) {
    const list = [...files];
    if (!list.length || list.length > 10) throw new Error("Envie de 1 a 10 arquivos (limite do Instagram).");
    for (const f of list) {
      if (f.size > MAX_FILE) throw new Error(`${f.name}: máximo 15 MB.`);
      const real = await sniff(f);
      if (!real || !TYPES[real] || real !== f.type) throw new Error(`${f.name}: tipo não permitido (PNG, JPG, WEBP ou MP4).`);
    }
    const n = (G.latestVersion(allVersions, post.id, "arte")?.number || 0) + 1;
    const paths = [];
    for (const [i, f] of list.entries()) {
      onProgress?.(`Enviando ${i + 1}/${list.length}…`);
      const path = `${slug}/${post.id}/arte-v${n}/${String(i + 1).padStart(2, "0")}.${TYPES[f.type]}`;
      const { error } = await sb.storage.from("artes").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      paths.push(path);
    }
    const { data: email } = await sb.rpc("auth_email");
    const { error } = await sb.from("versions").insert({ post_id: post.id, stage: "arte", number: n, asset_paths: paths, sent, author_email: email });
    if (error) throw error;
  }

  // Copy (texto da arte) e legenda sobem juntas numa versão e são aprovadas juntas
  async function uploadCopy(sb, { post, allVersions, text, caption, sent }) {
    if (!text.trim()) throw new Error("Texto da arte vazio.");
    const cap = (caption || "").trim();
    if (cap.length > 2200) throw new Error("Legenda passa de 2.200 caracteres (limite do Instagram).");
    const n = (G.latestVersion(allVersions, post.id, "copy")?.number || 0) + 1;
    const { data: email } = await sb.rpc("auth_email");
    const { error } = await sb.from("versions").insert({ post_id: post.id, stage: "copy", number: n, copy_text: text.trim().slice(0, 5000), caption_text: cap || null, sent, author_email: email });
    if (error) throw error;
  }

  // ---------- Bloco de envio: texto, legenda e artes num botão só, sem recarregar ----------
  // Devolve as partes separadas para o Kanban distribuir em colunas; o painel empilha.
  // opts: { sb, post, slug, getVersions, showCopy, showArte, prefill, sent: bool | () => bool, sendLabel, onDone }
  const MAX_ARTES = 10; // limite do Instagram por post
  function composer(opts) {
    const { sb, post } = opts;
    const stories = post.format === "stories";
    const out = el("p", { class: "msg", role: "status", "aria-live": "polite" });
    const say = (t, kind = "") => { out.className = `msg ${kind}`; out.textContent = t; };

    // Texto e legenda
    const copyTa = el("textarea", { maxlength: "5000", rows: "5", placeholder: stories ? "Texto das telas (opcional)" : "Texto que vai dentro da arte" });
    const capTa = el("textarea", { maxlength: "2200", rows: "5", placeholder: "Legenda do post no Instagram" });
    const base = { text: opts.prefill?.copy_text || "", cap: opts.prefill?.caption_text || "" };
    copyTa.value = base.text; capTa.value = base.cap;
    const capCount = el("span", { class: "kd-count" });
    const paint = () => { capCount.textContent = `${capTa.value.length}/2200`; };
    capTa.addEventListener("input", paint); paint();
    const copyEl = opts.showCopy ? el("div", { class: "cmp-text" },
      el("label", { class: "f" }, el("span", { class: "eyebrow" }, stories ? "Texto das telas" : "Texto da arte"), copyTa),
      stories ? el("p", { class: "msg" }, "Stories não tem legenda: todo texto vai dentro da arte.")
        : el("label", { class: "f" }, el("span", { class: "eyebrow row between" }, "Legenda", capCount), capTa)) : null;

    // Artes: acumulam, com miniatura, ordem e remoção
    let files = [];
    const list = el("ol", { class: "cmp-thumbs", "aria-label": "Artes que serão enviadas, na ordem" });
    const picker = el("input", { type: "file", multiple: true, accept: "image/png,image/jpeg,video/mp4", class: "sr-only", "aria-label": "Escolher artes" });
    const drop = el("label", { class: "cmp-drop" }, picker,
      el("b", {}, "Arraste as artes aqui"), el("span", {}, " ou clique para escolher · JPG, PNG ou MP4 · até 15 MB"));
    async function add(incoming) {
      for (const f of incoming) {
        if (files.length >= MAX_ARTES) { say(`Máximo de ${MAX_ARTES} artes por post (limite do Instagram).`, "err"); break; }
        if (f.size > MAX_FILE) { say(`${f.name}: passa de 15 MB.`, "err"); continue; }
        const real = await sniff(f);
        if (real === "image/webp") { say(`${f.name}: o Instagram não publica WEBP. Exporte em JPG ou PNG.`, "err"); continue; }
        if (!real || !TYPES[real]) { say(`${f.name}: tipo não aceito (JPG, PNG ou MP4).`, "err"); continue; }
        files.push({ file: f, type: real, url: URL.createObjectURL(f) });
      }
      paintThumbs();
    }
    function move(i, to) { if (to < 0 || to >= files.length) return; const [x] = files.splice(i, 1); files.splice(to, 0, x); paintThumbs(); }
    let dragFrom = null;
    function paintThumbs() {
      list.replaceChildren(...files.map((f, i) => {
        const media = f.type === "video/mp4" ? el("video", { src: f.url, muted: true, preload: "metadata" }) : el("img", { src: f.url, alt: "" });
        const li = el("li", { class: "cmp-thumb", draggable: "true" },
          media, el("span", { class: "cmp-n" }, String(i + 1)),
          el("div", { class: "cmp-ctl" },
            el("button", { type: "button", "aria-label": `Mover ${i + 1} para trás`, disabled: i === 0, onclick: () => move(i, i - 1) }, "←"),
            el("button", { type: "button", "aria-label": `Mover ${i + 1} para frente`, disabled: i === files.length - 1, onclick: () => move(i, i + 1) }, "→"),
            el("button", { type: "button", "aria-label": `Remover ${f.file.name}`, onclick: () => { URL.revokeObjectURL(f.url); files.splice(i, 1); paintThumbs(); } }, "×")));
        li.addEventListener("dragstart", (e) => { dragFrom = i; e.dataTransfer.effectAllowed = "move"; });
        li.addEventListener("dragover", (e) => { if (dragFrom !== null) e.preventDefault(); });
        li.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); if (dragFrom !== null) move(dragFrom, i); dragFrom = null; });
        return li;
      }));
      list.hidden = !files.length;
      drop.classList.toggle("has", files.length > 0);
    }
    picker.addEventListener("change", () => { add([...picker.files]); picker.value = ""; });
    drop.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); drop.classList.add("over"); } });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); drop.classList.remove("over"); add([...e.dataTransfer.files]); });
    paintThumbs();
    const arteEl = opts.showArte ? el("div", { class: "cmp-arte" }, drop, list) : null;

    // Envio único: manda só o que mudou
    const btn = el("button", { class: "btn ok", type: "button" }, opts.sendLabel || "Enviar");
    btn.addEventListener("click", async () => {
      const text = copyTa.value.trim(), cap = capTa.value.trim();
      const copyChanged = opts.showCopy && (text !== base.text.trim() || (!stories && cap !== base.cap.trim()));
      const sendCopy = copyChanged && (text || !stories);
      const sendArte = opts.showArte && files.length > 0;
      if (!sendCopy && !sendArte) return say("Nada novo para enviar: escreva o texto ou adicione as artes.", "err");
      const sent = typeof opts.sent === "function" ? opts.sent() : !!opts.sent;
      btn.disabled = true;
      const done = [];
      try {
        if (sendCopy) {
          say("Enviando texto…");
          await uploadCopy(sb, { post, allVersions: opts.getVersions(), text, caption: stories ? "" : cap, sent });
          done.push(stories ? "texto" : "texto e legenda");
        }
        if (sendArte) {
          await uploadArte(sb, { slug: opts.slug, post, allVersions: opts.getVersions(), files: files.map((f) => f.file), sent,
            onProgress: (t) => say(t.replace("Enviando", "Enviando arte")) });
          done.push(`${files.length} ${files.length === 1 ? "arte" : "artes"}`);
          files.forEach((f) => URL.revokeObjectURL(f.url)); files = []; paintThumbs();
        }
        const msgOk = `Enviado ✓ ${done.join(" + ")}${sent ? " · já está com o cliente" : opts.draftNote || " · foi para aprovação do Rapha"}`;
        say(msgOk, "okk");
        btn.disabled = false;
        await opts.onDone?.(msgOk);
      } catch (e) {
        // O que já subiu fica registrado; o resto pode ser reenviado
        say(`${done.length ? `Enviou ${done.join(" + ")}, mas ` : ""}${e.message || e}`, "err");
        btn.disabled = false;
      }
    });
    const actions = el("div", { class: "cmp-actions" }, btn, out);
    return { copyEl, arteEl, actions, say, el: el("div", { class: "cmp" }, copyEl, arteEl, actions) };
  }

  // ---------- Revisão interna (só admin): pedir ajuste em cada parte e enviar o post ao cliente ----------
  // opts: { sb, post, all, urls, team, onChange(msgOk) }
  function reviewPanel(opts) {
    const { sb, post, all } = opts;
    const out = el("p", { class: "msg", role: "status", "aria-live": "polite" });
    const say = (t, kind = "") => { out.className = `msg ${kind}`; out.textContent = t; };
    const sentMax = (stage) => Math.max(0, ...all.filter((v) => v.post_id === post.id && v.stage === stage && v.sent).map((v) => v.number));
    const newest = (stage) => all.filter((v) => v.post_id === post.id && v.stage === stage && !v.sent && v.number > sentMax(stage))
      .sort((a, b) => b.number - a.number)[0] || null;
    const drafts = [newest("copy"), newest("arte")].filter(Boolean);
    const r = G.readiness(all, post);
    if (!drafts.length) return null;

    const item = (v) => {
      const label = v.stage === "copy" ? (post.format === "stories" ? "Texto" : "Texto e legenda") : "Arte";
      const note = el("textarea", { maxlength: "1500", rows: "3", placeholder: `O que ajustar ${v.stage === "copy" ? "no texto/legenda" : "na arte"}?` });
      const ask = el("button", { class: "btn ghost", type: "button" }, `Pedir ajuste ${v.stage === "copy" ? "na copy" : "na arte"}`);
      const form = el("div", { class: "stack-0", hidden: true }, note, el("div", { class: "row" },
        el("button", { class: "btn bad", type: "button", onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.rpc("request_internal_adjust", { p_version: v.id, p_note: note.value });
          e.target.disabled = false;
          error ? say(error.message, "err") : opts.onChange?.(`Ajuste pedido ${v.stage === "copy" ? "na copy" : "na arte"} ✓`);
        } }, "Pedir ajuste"),
        el("button", { class: "btn ghost", type: "button", onclick: () => { form.hidden = true; ask.hidden = false; } }, "Cancelar")));
      ask.addEventListener("click", () => { form.hidden = false; ask.hidden = true; note.focus(); });
      return el("div", { class: "draft" },
        el("div", { class: "msg" }, `${label} v${v.number} · por ${nameOf(opts.team, v.author_email)} · ${when(v.created_at)}`),
        preview(v, opts.urls),
        v.review_note ? el("div", { class: "content-box alert" }, el("span", { class: "eyebrow" }, "Ajuste pedido"), v.review_note)
          : el("div", {}, ask, form));
    };

    const send = el("button", { class: "btn ok", type: "button", disabled: !r.ok }, "Enviar ao cliente");
    const why = r.falta.length ? `Para enviar ao cliente falta: ${r.falta.join(", ")}.`
      : r.ajuste ? "Tem ajuste interno pedido: espere a nova versão." : "";
    send.addEventListener("click", async () => {
      send.disabled = true;
      const { error } = await sb.rpc("send_post", { p_post: post.id });
      if (error) { send.disabled = false; return say(error.message, "err"); }
      opts.onChange?.("Enviado ao cliente ✓");
    });
    return el("div", { class: "review" },
      el("div", { class: "eyebrow" }, "Revisão interna"),
      drafts.map(item),
      el("div", { class: "cmp-actions" }, send, why ? el("span", { class: "msg" }, why) : null), out);
  }

  // ---------- Agendamento (regra validada no banco: só arte aprovada, só admin) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function schedLabel(p) {
    if (p.publish_status === "publicado") return p.ig_media_id === "simulado" ? "Publicado (simulado)" : "Publicado ✓";
    if (p.publish_status === "publicando") return "Publicando…";
    if (p.publish_status === "erro") return "Erro ao publicar";
    if (!p.scheduled_at) return "Agendado";
    const d = new Date(p.scheduled_at);
    return `Agendado · ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}h${d.getMinutes() ? pad(d.getMinutes()) : ""}`;
  }
  function schedulePanel(sb, p, onDone) {
    const out = el("p", { class: "msg", role: "status" });
    // Publicado ou em publicação: só mostra o resultado, não deixa mexer
    if (p.publish_status === "publicado" || p.publish_status === "publicando") {
      const link = p.ig_permalink && /^https:\/\/(www\.)?instagram\.com\//.test(p.ig_permalink)
        ? el("a", { href: p.ig_permalink, target: "_blank", rel: "noopener" }, "Ver no Instagram") : null;
      const fb = p.fb_post_id && /^[\d_]+$/.test(p.fb_post_id)
        ? el("a", { href: `https://www.facebook.com/${p.fb_post_id}`, target: "_blank", rel: "noopener" }, "Ver no Facebook") : null;
      return el("div", { class: "content-box sched" }, el("span", { class: "eyebrow" }, schedLabel(p)),
        el("div", { class: "row" }, link, fb), p.fb_error ? el("p", { class: "msg err" }, `Facebook: ${p.fb_error}`) : null);
    }
    if (p.publish_status === "erro" && p.publish_error) { out.className = "msg err"; out.textContent = p.publish_error; }
    const base = p.scheduled_at ? new Date(p.scheduled_at) : (() => { const [y, mo, da] = String(p.post_date).split("-").map(Number); return new Date(y, mo - 1, da, 11, 0); })();
    const at = el("input", { type: "datetime-local", value: localInput(base), step: "300", "aria-label": "Data e hora da publicação" });
    const fail = (e) => {
      const m = e?.message || String(e);
      out.className = "msg err";
      out.textContent = /schedule_post|function .* does not exist|PGRST202/.test(m) ? "O agendamento ainda não foi ativado no banco." : m;
    };
    const resume = p.format === "stories" && p.publish_status === "erro" && p.stories_done > 0;
    const save = el("button", { class: "btn ok", type: "button" },
      resume ? `Reagendar a partir da tela ${p.stories_done + 1}` : p.scheduled ? "Reagendar" : "Agendar");
    save.addEventListener("click", async () => {
      const d = new Date(at.value);
      if (!at.value || Number.isNaN(d.getTime())) { out.className = "msg err"; out.textContent = "Escolha data e hora."; return; }
      save.disabled = true;
      const { error } = await sb.rpc("schedule_post", { p_post: p.id, p_at: d.toISOString() });
      save.disabled = false;
      error ? fail(error) : onDone(true);
    });
    const undo = p.scheduled ? el("button", { class: "btn ghost", type: "button" }, "Desagendar") : null;
    undo?.addEventListener("click", async () => {
      const { error } = await sb.rpc("schedule_post", { p_post: p.id, p_at: null });
      error ? fail(error) : onDone(false);
    });
    // Facebook: só imagem (estático e carrossel). Padrão: ligado no feed.
    const fbOk = ["estatico", "carrossel"].includes(p.format);
    const fbBox = fbOk ? el("input", { type: "checkbox", checked: p.fb_publish ?? true }) : null;
    fbBox?.addEventListener("change", async () => {
      const { error } = await sb.from("posts").update({ fb_publish: fbBox.checked }).eq("id", p.id);
      if (error) { fbBox.checked = !fbBox.checked; fail(error); return; }
      p.fb_publish = fbBox.checked; out.className = "msg okk";
      out.textContent = fbBox.checked ? "Vai para o Instagram e o Facebook." : "Vai só para o Instagram.";
    });
    return el("div", { class: "content-box sched" },
      el("span", { class: "eyebrow" }, p.scheduled ? schedLabel(p) : "Agendar publicação"),
      at, fbBox ? el("label", { class: "row" }, fbBox, "Publicar também no Facebook")
        : el("p", { class: "msg" }, `${G.FORMATS[p.format] || "Este formato"} sai só no Instagram.`),
      el("div", { class: "row" }, save, undo), out);
  }

  // ---------- Referências do post (links e imagens) ----------
  const REF_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const { isHttp, refHost } = G;

  async function signRefs(sb, refs) {
    const paths = (refs || []).filter((r) => r.t === "img").map((r) => r.path);
    if (!paths.length) return {};
    const { data } = await sb.storage.from("artes").createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  }

  // Editor (painel): adiciona link, sobe imagem, remove. Salva direto no post.
  function refsEditor(sb, { slug, post, onSaved }) {
    let refs = Array.isArray(post.refs) ? post.refs.slice() : [];
    const box = G.el("div", { class: "stack refs-edit" });
    const out = G.el("p", { class: "msg", role: "status" });
    const save = async (next, okText) => {
      const { error } = await sb.from("posts").update({ refs: next }).eq("id", post.id);
      if (error) { out.className = "msg err"; out.textContent = error.message; return false; }
      refs = next; post.refs = next; out.className = "msg okk"; out.textContent = okText; draw(); onSaved?.(next); return true;
    };
    const url = G.el("input", { type: "url", placeholder: "https://…", "aria-label": "Link de referência", maxlength: "500" });
    const label = G.el("input", { type: "text", placeholder: "Nome (opcional)", "aria-label": "Nome do link", maxlength: "80" });
    const addLink = G.el("button", { class: "btn ghost", type: "button" }, "Adicionar link");
    addLink.addEventListener("click", () => {
      const u = url.value.trim();
      if (!isHttp(u)) { out.className = "msg err"; out.textContent = "Cole um link começando com https://"; return; }
      if (refs.length >= 12) { out.className = "msg err"; out.textContent = "Máximo de 12 referências por post."; return; }
      save([...refs, { t: "link", url: u, label: label.value.trim() || undefined }], "Link adicionado.").then((ok) => { if (ok) { url.value = ""; label.value = ""; } });
    });
    const file = G.el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, "aria-label": "Imagens de referência" });
    file.addEventListener("change", async () => {
      const list = [...file.files];
      file.value = "";
      if (refs.length + list.length > 12) { out.className = "msg err"; out.textContent = "Máximo de 12 referências por post."; return; }
      for (const f of list) {
        if (!REF_TYPES[f.type]) { out.className = "msg err"; out.textContent = `${f.name}: use PNG, JPG ou WEBP.`; return; }
        if (f.size > 8 * 1024 * 1024) { out.className = "msg err"; out.textContent = `${f.name}: máximo de 8 MB.`; return; }
      }
      const added = [];
      for (const [i, f] of list.entries()) {
        out.className = "msg"; out.textContent = `Enviando ${i + 1}/${list.length}…`;
        const path = `${slug}/${post.id}/refs/${Date.now()}-${i}.${REF_TYPES[f.type]}`;
        const { error } = await sb.storage.from("artes").upload(path, f, { contentType: f.type, upsert: false });
        if (error) { out.className = "msg err"; out.textContent = error.message; return; }
        added.push({ t: "img", path });
      }
      if (added.length) await save([...refs, ...added], added.length === 1 ? "Imagem adicionada." : `${added.length} imagens adicionadas.`);
    });
    const list = G.el("ul", { class: "refs-list" });
    async function draw() {
      const urls = await signRefs(sb, refs);
      list.replaceChildren(...refs.map((r, i) => G.el("li", {},
        r.t === "img" ? G.el("img", { src: urls[r.path] || "", alt: "" }) : G.el("a", { href: isHttp(r.url) ? r.url : "#", target: "_blank", rel: "noopener noreferrer" }, r.label || refHost(r.url)),
        G.el("button", { class: "btn-del", type: "button", "aria-label": "Remover referência",
          onclick: () => save(refs.filter((_, k) => k !== i), "Referência removida.") }, "Remover"))));
    }
    draw();
    box.append(list,
      G.el("div", { class: "row" }, url, label, addLink),
      G.el("label", { class: "f" }, "Imagens (PNG, JPG ou WEBP, até 8 MB)", file), out);
    return box;
  }

  return { refsView: G.refsView, refsEditor, signRefs, signed, preview, comments, uploadArte, uploadCopy, composer, reviewPanel, nameOf, when, schedulePanel, schedLabel };
})();
