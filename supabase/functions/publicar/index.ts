// Edge Function "publicar": publica no Instagram os posts agendados que venceram.
// Chamada só pelo pg_cron (header x-cron-secret). Nunca pelo navegador.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   CRON_SECRET        obrigatório — mesmo valor guardado no Vault para o cron
//   IG_USER_ID         ID da conta Instagram profissional da Garten
//   IG_ACCESS_TOKEN    token de longa duração da Meta
//   IG_GRAPH_VERSION   opcional (padrão v23.0)
//   PUBLISH_DRY_RUN    "1" = simula sem chamar a Meta (ligado automaticamente se faltar token)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const IG_USER = env("IG_USER_ID");
const IG_TOKEN = env("IG_ACCESS_TOKEN");
const GRAPH = `https://graph.facebook.com/${env("IG_GRAPH_VERSION") || "v23.0"}`;
const DRY = env("PUBLISH_DRY_RUN") === "1" || !IG_USER || !IG_TOKEN;

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(path: string, params: Record<string, string>, method = "POST") {
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const res = method === "GET"
    ? await fetch(`${GRAPH}/${path}?${body}`)
    : await fetch(`${GRAPH}/${path}`, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta respondeu ${res.status}`);
  return json;
}

// Vídeo (e às vezes imagem) leva um tempo para a Meta processar
async function waitReady(containerId: string) {
  for (let i = 0; i < 20; i++) {
    const { status_code } = await graph(containerId, { fields: "status_code" }, "GET");
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Meta não processou a mídia (${status_code})`);
    await sleep(5000);
  }
  throw new Error("Meta demorou demais para processar a mídia");
}

// A API só aceita imagem JPEG. PNG é convertido; WEBP é recusado com mensagem clara.
async function publicUrl(path: string, postId: string, idx: number): Promise<{ url: string; video: boolean }> {
  const video = /\.mp4$/i.test(path);
  let finalPath = path;
  if (/\.png$/i.test(path)) {
    const { data, error } = await db.storage.from("artes").download(path);
    if (error) throw error;
    const img = await Image.decode(new Uint8Array(await data.arrayBuffer()));
    const jpg = await img.encodeJPEG(92);
    finalPath = `_publicar/${postId}/${String(idx).padStart(2, "0")}.jpg`;
    const up = await db.storage.from("artes").upload(finalPath, jpg, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw up.error;
  } else if (/\.webp$/i.test(path)) {
    throw new Error("Instagram não aceita WEBP. Reenvie a arte em JPG ou PNG.");
  }
  // URL assinada de 1h: o bucket continua privado
  const { data, error } = await db.storage.from("artes").createSignedUrl(finalPath, 3600);
  if (error || !data) throw error ?? new Error("Não consegui gerar URL da arte");
  return { url: data.signedUrl, video };
}

async function latestApprovedArte(postId: string): Promise<string[]> {
  return (await latestApprovedVersion(postId)).paths;
}

async function latestApprovedVersion(postId: string): Promise<{ id: string; paths: string[] }> {
  const { data: vers } = await db.from("versions").select("id, number, asset_paths")
    .eq("post_id", postId).eq("stage", "arte").eq("sent", true).order("number", { ascending: false }).limit(1);
  const v = vers?.[0];
  if (!v) throw new Error("Post sem arte enviada");
  const { data: dec } = await db.from("decisions").select("status").eq("post_id", postId)
    .eq("stage", "arte").eq("version_id", v.id).order("created_at", { ascending: false }).limit(1);
  if (dec?.[0]?.status !== "aprovado") throw new Error("Arte mais recente não está aprovada");
  const paths = (v.asset_paths ?? []) as string[];
  if (!paths.length || paths.length > 10) throw new Error("Instagram aceita de 1 a 10 mídias por post");
  return { id: v.id as string, paths };
}

// Stories em sequência: publica tela por tela, na ordem, salvando o progresso a cada uma.
// Se cair no meio, o reagendamento continua da próxima tela (sem duplicar as que já saíram).
// Se subirem uma arte nova depois de um erro, a sequência recomeça do início.
async function publishStories(postId: string) {
  const v = await latestApprovedVersion(postId);
  const { data: st } = await db.from("posts").select("stories_done, stories_version").eq("id", postId).single();
  const start = st?.stories_version === v.id ? (st?.stories_done ?? 0) : 0;
  const total = v.paths.length;
  if (DRY) return { media: "simulado", link: null };
  if (start >= total) return { media: "ja-publicado", link: null };

  let done = start;
  let last = "";
  try {
    for (let i = start; i < total; i++) {
      const m = await publicUrl(v.paths[i], postId, i + 1);
      const c = await graph(`${IG_USER}/media`, m.video
        ? { media_type: "STORIES", video_url: m.url }
        : { media_type: "STORIES", image_url: m.url });
      await waitReady(c.id);
      const pub = await graph(`${IG_USER}/media_publish`, { creation_id: c.id });
      last = pub.id;
      done = i + 1;
      await db.from("posts").update({ stories_done: done, stories_version: v.id }).eq("id", postId);
      if (done < total) await sleep(3000);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(done > 0
      ? `Publicou ${done} de ${total} telas. ${msg} Ao reagendar, continua da tela ${done + 1}.`
      : msg);
  }
  return { media: last, link: null };
}

async function publishOne(postId: string) {
  const { data: post } = await db.from("posts").select("format").eq("id", postId).single();
  // Stories não tem legenda: cada arte do card vira uma tela, na ordem
  if (post?.format === "stories") return publishStories(postId);

  const paths = await latestApprovedArte(postId);

  // Legenda aprovada (copy = texto da arte, não vai na legenda)
  const { data: caption } = await db.rpc("approved_caption", { p_post: postId });
  const text = String(caption ?? "").slice(0, 2200);
  if (!text.trim()) throw new Error("Post sem legenda aprovada");

  if (DRY) return { media: "simulado", link: null };

  const media = await Promise.all(paths.map((p, i) => publicUrl(p, postId, i + 1)));
  let creation: string;
  if (media.length === 1) {
    const m = media[0];
    const c = await graph(`${IG_USER}/media`, m.video
      ? { media_type: "REELS", video_url: m.url, caption: text }
      : { image_url: m.url, caption: text });
    creation = c.id;
  } else {
    const children: string[] = [];
    for (const m of media) {
      const c = await graph(`${IG_USER}/media`, m.video
        ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" }
        : { image_url: m.url, is_carousel_item: "true" });
      await waitReady(c.id);
      children.push(c.id);
    }
    const c = await graph(`${IG_USER}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: text });
    creation = c.id;
  }
  await waitReady(creation);
  const pub = await graph(`${IG_USER}/media_publish`, { creation_id: creation });
  const info = await graph(pub.id, { fields: "permalink" }, "GET").catch(() => ({}));
  return { media: pub.id as string, link: (info as { permalink?: string }).permalink ?? null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) {
    return new Response("forbidden", { status: 403 });
  }
  const { data: ids, error } = await db.rpc("claim_due_posts", { p_limit: 5 });
  if (error) return new Response(error.message, { status: 500 });

  const results = [];
  for (const id of (ids ?? []) as string[]) {
    try {
      const r = await publishOne(id);
      await db.rpc("finish_publish", { p_post: id, p_ok: true, p_media: r.media, p_link: r.link, p_error: null });
      results.push({ id, ok: true, dry: DRY });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.rpc("finish_publish", { p_post: id, p_ok: false, p_media: null, p_link: null, p_error: msg });
      results.push({ id, ok: false });
    }
  }
  return Response.json({ dry: DRY, results });
});
