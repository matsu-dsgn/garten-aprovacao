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

  return { signed, preview, comments, uploadArte, uploadCopy, nameOf, when };
})();
