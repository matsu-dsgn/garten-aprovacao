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
    if (v.stage === "copy") return el("div", { class: "content-box" }, v.copy_text || "");
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
    if (!list.length || list.length > 20) throw new Error("Envie de 1 a 20 arquivos.");
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

  async function uploadCopy(sb, { post, allVersions, text, sent }) {
    if (!text.trim()) throw new Error("Copy vazia.");
    const n = (G.latestVersion(allVersions, post.id, "copy")?.number || 0) + 1;
    const { data: email } = await sb.rpc("auth_email");
    const { error } = await sb.from("versions").insert({ post_id: post.id, stage: "copy", number: n, copy_text: text.trim().slice(0, 5000), sent, author_email: email });
    if (error) throw error;
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
    const save = el("button", { class: "btn ok", type: "button" }, p.scheduled ? "Reagendar" : "Agendar");
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

  return { signed, preview, comments, uploadArte, uploadCopy, nameOf, when, schedulePanel, schedLabel };
})();
