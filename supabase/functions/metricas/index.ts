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
    ...feed.map((m) => ({ id: m.id, product_type: m.media_product_type === "REELS" ? "REELS" : "FEED", media_type: m.media_type ?? null,
      caption: m.caption?.slice(0, 2200) ?? null, permalink: m.permalink ?? null, thumb_url: thumbOf(m),
      published_at: m.timestamp ?? null, like_count: m.like_count ?? null, comments_count: m.comments_count ?? null, synced_at: now })),
    ...stories.map((m) => ({ id: m.id, product_type: "STORY", media_type: m.media_type ?? null, permalink: m.permalink ?? null,
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
  const { data: due } = await db.from("ig_media").select("id, product_type, published_at")
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
  return { media: rows.length, insights: got, error: permError };
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
