// Edge Function "metricas": sincroniza o que saiu no Instagram da Garten e as métricas.
// Chamada pelo pg_cron (header x-cron-secret) ou pelo botão "Atualizar agora" (só admin logado).
// Lê posts do feed/Reels (inclusive os publicados fora do sistema) e Stories ativos.
// Métricas de Stories só existem nas primeiras 24h, por isso o cron roda de hora em hora.
//
// Secrets: CRON_SECRET, IG_USER_ID, IG_ACCESS_TOKEN, IG_GRAPH_VERSION (opcional).
// Para alcance/salvamentos/compartilhamentos o token precisa de instagram_manage_insights.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const IG_USER = env("IG_USER_ID");
const IG_TOKEN = env("IG_ACCESS_TOKEN");
const GRAPH = `https://graph.facebook.com/${env("IG_GRAPH_VERSION") || "v23.0"}`;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

class MetaError extends Error { constructor(msg: string, public code?: number) { super(msg); } }
async function get(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new MetaError(json.error?.message || `Meta respondeu ${res.status}`, json.error?.code);
  return json;
}

// Quem pode chamar: o cron (segredo) ou um admin logado
async function allowed(req: Request) {
  if (safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) return "cron";
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await user.rpc("my_role");
  return data === "admin" ? "admin" : null;
}

type Media = { id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string;
  thumbnail_url?: string; media_url?: string; timestamp?: string; like_count?: number; comments_count?: number;
  children?: { data?: { media_url?: string; thumbnail_url?: string }[] } };

const thumbOf = (m: Media) => {
  const c = m.children?.data?.[0];
  return m.thumbnail_url || (m.media_type === "CAROUSEL_ALBUM" ? (c?.thumbnail_url || c?.media_url) : m.media_url) || null;
};

// Métricas por tipo (views substituiu impressions na API)
const METRICS: Record<string, string> = { FEED: "reach,saved,shares,views", REELS: "reach,saved,shares,views", STORY: "reach,replies,shares,views" };

async function sync() {
  const FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,children{media_url,thumbnail_url}";
  const feed = (await get(`${IG_USER}/media`, { fields: FIELDS, limit: "50" })).data as Media[] ?? [];
  const stories = (await get(`${IG_USER}/stories`, { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp" })).data as Media[] ?? [];
  const now = new Date().toISOString();

  const rows = [
    ...feed.map((m) => ({ id: m.id, network: "instagram", product_type: m.media_product_type === "REELS" ? "REELS" : "FEED", media_type: m.media_type ?? null,
      caption: m.caption?.slice(0, 2200) ?? null, permalink: m.permalink ?? null, thumb_url: thumbOf(m),
      published_at: m.timestamp ?? null, like_count: m.like_count ?? null, comments_count: m.comments_count ?? null, synced_at: now })),
    ...stories.map((m) => ({ id: m.id, network: "instagram", product_type: "STORY", media_type: m.media_type ?? null, permalink: m.permalink ?? null,
      thumb_url: thumbOf(m), published_at: m.timestamp ?? null, synced_at: now })),
  ];
  if (rows.length) { const { error } = await db.from("ig_media").upsert(rows); if (error) throw error; }

  // Liga ao post do sistema quando o ID bate (feed/Reels publicados pelo agendamento)
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    const { data: posts } = await db.from("posts").select("id, ig_media_id").in("ig_media_id", ids);
    for (const p of posts ?? []) await db.from("ig_media").update({ post_id: p.id }).eq("id", p.ig_media_id).is("post_id", null);
  }

  // Insights: feed/Reels dos últimos 30 dias (e os que nunca tiveram), Stories das últimas 24h
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const d1 = new Date(Date.now() - 864e5).toISOString();
  const { data: due } = await db.from("ig_media").select("id, product_type, published_at").eq("network", "instagram")
    // posts antigos sem métrica entram uma vez (ex.: publicados antes do sistema existir)
    .or(`and(product_type.in.(FEED,REELS),or(published_at.gte.${d30},insights_at.is.null)),and(product_type.eq.STORY,published_at.gte.${d1})`)
    .order("published_at", { ascending: false }).limit(60);

  let got = 0; let permError: string | null = null;
  for (const m of due ?? []) {
    try {
      const json = await get(`${m.id}/insights`, { metric: METRICS[m.product_type] ?? METRICS.FEED });
      const val: Record<string, number> = {};
      for (const it of json.data ?? []) val[it.name] = it.values?.[0]?.value ?? it.total_value?.value ?? null;
      await db.from("ig_media").update({ reach: val.reach ?? null, views: val.views ?? null, saved: val.saved ?? null,
        shares: val.shares ?? null, replies: val.replies ?? null, insights_at: now, insights_error: null }).eq("id", m.id);
      got++;
    } catch (e) {
      const err = e as MetaError;
      // Poucas visualizações: a Meta ainda não libera métricas deste item (normal em Stories recentes)
      if (/not enough viewers/i.test(err.message)) {
        await db.from("ig_media").update({ insights_error: "Poucas visualizações: a Meta ainda não liberou as métricas." }).eq("id", m.id);
        continue;
      }
      // Sem permissão de métricas: para de tentar nesta rodada (o código 10 também é usado acima, por isso o texto)
      if (err.code === 200 || /permission/i.test(err.message)) {
        permError = `O token não tem a permissão instagram_manage_insights. Gere um token novo com ela para ver alcance e salvamentos. (Meta: ${err.message})`;
        break;
      }
      await db.from("ig_media").update({ insights_error: err.message.slice(0, 300) }).eq("id", m.id);
    }
  }
  if (!permError) await onlineFollowers(now);
  const fb = await syncFacebook(now);
  await snapshotFollowers();
  return { media: rows.length, insights: got, error: permError, facebook: fb };
}

// ---------- Facebook (Página ligada ao Instagram) ----------
async function fbPage() {
  const acc = await get("me/accounts", { fields: "id,access_token,instagram_business_account" });
  const p = (acc.data ?? []).find((x: { instagram_business_account?: { id: string } }) => x.instagram_business_account?.id === IG_USER);
  return p?.access_token ? { id: p.id as string, token: p.access_token as string } : null;
}
async function pget(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new MetaError(json.error?.message || `Meta respondeu ${res.status}`, json.error?.code);
  return json;
}
// Posts da Página. Precisa de pages_read_user_content; sem ela, devolve o aviso e segue.
async function syncFacebook(now: string) {
  try {
    const page = await fbPage();
    if (!page) return "Página não encontrada";
    const json = await pget(`${page.id}/published_posts`, {
      fields: "id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
      limit: "50" }, page.token);
    type P = { id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string;
      shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };
    const rows = ((json.data ?? []) as P[]).map((p) => ({ id: p.id, network: "facebook", product_type: "FEED",
      caption: p.message?.slice(0, 2200) ?? null, permalink: p.permalink_url ?? null, thumb_url: p.full_picture ?? null,
      published_at: p.created_time ?? null, like_count: p.reactions?.summary?.total_count ?? 0,
      comments_count: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0, synced_at: now }));
    if (rows.length) await db.from("ig_media").upsert(rows);
    // Alcance por post (quando a Meta libera)
    const d30 = Date.now() - 30 * 864e5;
    for (const r of rows.filter((x) => x.published_at && new Date(x.published_at).getTime() > d30)) {
      try {
        const ins = await pget(`${r.id}/insights`, { metric: "post_impressions_unique" }, page.token);
        const reach = ins.data?.[0]?.values?.[0]?.value;
        if (typeof reach === "number") await db.from("ig_media").update({ reach, insights_at: now, insights_error: null }).eq("id", r.id);
      } catch (e) { await db.from("ig_media").update({ insights_error: (e as Error).message.slice(0, 300) }).eq("id", r.id); }
    }
    return `${rows.length} posts`;
  } catch (e) { return (e as Error).message.slice(0, 300); }
}

// Seguidores do dia (Instagram e Facebook), no fuso de São Paulo
async function snapshotFollowers() {
  const day = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  try {
    const ig = await get(IG_USER, { fields: "followers_count" });
    if (typeof ig.followers_count === "number")
      await db.from("follower_snapshots").upsert({ network: "instagram", day, followers: ig.followers_count });
  } catch (_) { /* segue */ }
  try {
    const page = await fbPage();
    if (page) {
      const p = await pget(page.id, { fields: "followers_count" }, page.token);
      if (typeof p.followers_count === "number")
        await db.from("follower_snapshots").upsert({ network: "facebook", day, followers: p.followers_count });
    }
  } catch (_) { /* segue */ }
}

// Seguidores online por hora (média dos últimos dias). Guarda o dado bruto;
// o horário sugerido só muda depois de confirmado o fuso da Meta (ver pub_settings.online_raw).
async function onlineFollowers(now: string) {
  try {
    const json = await get(`${IG_USER}/insights`, { metric: "online_followers", period: "lifetime" });
    const values = (json.data?.[0]?.values ?? []) as { value?: Record<string, number>; end_time?: string }[];
    const sum = new Array(24).fill(0); let days = 0;
    for (const v of values) {
      if (!v.value || !Object.keys(v.value).length) continue;
      days++;
      for (const [h, n] of Object.entries(v.value)) sum[Number(h)] += n || 0;
    }
    if (!days) return;
    const avg = sum.map((s) => Math.round(s / days));
    await db.from("pub_settings").update({ online_raw: { avg, days, end_times: values.map((v) => v.end_time), at: now } }).eq("id", true);
  } catch (e) {
    await db.from("pub_settings").update({ online_raw: { error: (e as Error).message.slice(0, 300), at: now } }).eq("id", true);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const who = req.method === "POST" ? await allowed(req) : null;
  if (!who) return new Response("forbidden", { status: 403, headers: CORS });
  if (!IG_USER || !IG_TOKEN) return Response.json({ error: "Sem token da Meta configurado" }, { status: 500, headers: CORS });

  // Botão manual: no máximo uma rodada a cada 2 minutos
  if (who === "admin") {
    const { data: last } = await db.from("ig_sync_runs").select("run_at").order("run_at", { ascending: false }).limit(1);
    if (last?.[0] && Date.now() - new Date(last[0].run_at).getTime() < 120e3) {
      return Response.json({ skipped: true }, { headers: CORS });
    }
  }
  try {
    const r = await sync();
    await db.from("ig_sync_runs").insert({ ok: !r.error, media_count: r.media, insights_count: r.insights, error: r.error });
    return Response.json(r, { headers: CORS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("ig_sync_runs").insert({ ok: false, error: msg.slice(0, 500) });
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
