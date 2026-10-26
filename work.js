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
        const msgOk = `Enviado ✓ ${done.join(" + ")}${sent ? " · já está com o cliente" : " · foi para a revisão interna"}`;
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
      return el("div", { class: "content-box sched" }, el("span", { class: "eyebrow" }, schedLabel(p)), link);
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
    return el("div", { class: "content-box sched" },
      el("span", { class: "eyebrow" }, p.scheduled ? schedLabel(p) : "Agendar publicação"),
      at, el("div", { class: "row" }, save, undo), out);
  }

  return { signed, preview, comments, uploadArte, uploadCopy, composer, nameOf, when, schedulePanel, schedLabel };
})();
