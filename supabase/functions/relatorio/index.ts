// Edge Function "relatorio": fecha o mês (congela os números do relatório). Só admin logado.
// POST { slug: "AAAA-MM" } → calcula Instagram e Facebook do mês e do mês anterior, top 3 de cada rede,
// leitura por formato e editoria e um rascunho de aprendizados. Os textos que o admin já editou não são tocados.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const IG_USER = env("IG_USER_ID"), IG_TOKEN = env("IG_ACCESS_TOKEN");
const GRAPH = `https://graph.facebook.com/${env("IG_GRAPH_VERSION") || "v23.0"}`;
const ORIGINS = ["https://matsu-dsgn.github.io", "http://localhost:8000", "http://localhost:8765"];
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.includes(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Vary": "Origin" });
const FORMATS: Record<string, string> = { estatico: "Estático", carrossel: "Carrossel", reels: "Reels", stories: "Stories" };

async function graph(path: string, params: Record<string, string>, token = IG_TOKEN) {
  const r = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: token })}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Meta ${r.status}`);
  return j;
}

// Período do mês no fuso de São Paulo (UTC-3)
function range(slug: string) {
  const [y, m] = slug.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1, 3)), end: new Date(Date.UTC(y, m, 1, 3)) };
}
const prevSlug = (slug: string) => { const [y, m] = slug.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

type Row = { id: string; post_id: string | null; network: string; product_type: string; media_type: string | null; caption: string | null;
  permalink: string | null; thumb_url: string | null; published_at: string; reach: number | null; views: number | null; saved: number | null;
  shares: number | null; like_count: number | null; comments_count: number | null; editoria: string | null };
const n = (v: number | null | undefined) => v || 0;
const score = (r: Row) => n(r.shares) + n(r.saved);

function stats(rows: Row[]) {
  const feed = rows.filter((r) => r.product_type !== "STORY");
  const sum = (k: keyof Row) => feed.reduce((a, r) => a + n(r[k] as number), 0);
  const hasReach = feed.some((r) => r.reach != null);
  return { posts: feed.length, stories: rows.length - feed.length, reach: hasReach ? sum("reach") : null, views: sum("views"),
    shares: sum("shares"), saved: sum("saved"), likes: sum("like_count"), comments: sum("comments_count"),
    interactions: sum("like_count") + sum("comments_count") + sum("shares") + sum("saved") };
}

async function followers(net: string, start: Date, end: Date) {
  const day = (d: Date) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
  const { data: first } = await db.from("follower_snapshots").select("followers, day").eq("network", net)
    .gte("day", day(start)).lt("day", day(end)).order("day").limit(1);
  const { data: last } = await db.from("follower_snapshots").select("followers, day").eq("network", net)
    .gte("day", day(start)).lt("day", day(end)).order("day", { ascending: false }).limit(1);
  return { start: first?.[0]?.followers ?? null, end: last?.[0]?.followers ?? null, since: first?.[0]?.day ?? null };
}

async function main(slug: string) {
  const cur = range(slug), prev = range(prevSlug(slug));
  const { data: all } = await db.from("ig_media").select("*").gte("published_at", prev.start.toISOString())
    .lt("published_at", cur.end.toISOString());
  const rows = (all ?? []) as Row[];
  const inCur = (r: Row) => new Date(r.published_at) >= cur.start;
  const pids = [...new Set(rows.map((r) => r.post_id).filter(Boolean))] as string[];
  const { data: posts } = pids.length ? await db.from("posts").select("id, title, format, editoria").in("id", pids) : { data: [] };
  const P = new Map((posts ?? []).map((p) => [p.id, p]));
  const { data: eds } = await db.from("editorias").select("slug, name");
  const edName = (s: string | null) => (eds ?? []).find((e) => e.slug === s)?.name || "Sem editoria";
  const fmtOf = (r: Row) => r.product_type === "REELS" ? "reels" : P.get(r.post_id!)?.format && P.get(r.post_id!)!.format !== "stories"
    ? P.get(r.post_id!)!.format : r.media_type === "CAROUSEL_ALBUM" ? "carrossel" : r.media_type === "VIDEO" ? "reels" : "estatico";
  // Título: o do card; se o post veio do app, a primeira frase da legenda (sem cortar palavra)
  const titleOf = (r: Row) => {
    if (r.post_id && P.get(r.post_id)?.title) return P.get(r.post_id)!.title;
    const line = (r.caption || "").split("\n")[0].trim();
    if (!line) return "Post sem legenda";
    const sent = line.match(/^.{20,110}?[.!?](\s|$)/)?.[0].trim();
    if (sent) return sent;
    if (line.length <= 90) return line;
    return line.slice(0, 90).replace(/\s+\S*$/, "") + "…";
  };
  const pl = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

  const out: Record<string, unknown> = { slug, prev_slug: prevSlug(slug), generated_at: new Date().toISOString(), networks: {} };
  const insights: string[] = [];

  for (const net of ["instagram", "facebook"]) {
    const c = rows.filter((r) => r.network === net && inCur(r)), p = rows.filter((r) => r.network === net && !inCur(r));
    const feed = c.filter((r) => r.product_type !== "STORY");
    const s = stats(c), sp = stats(p);
    const fol = await followers(net, cur.start, cur.end);

    // Top 3: compartilhamentos + salvamentos (desempate: alcance). Imagem guardada no storage.
    const top = [];
    for (const r of [...feed].sort((a, b) => score(b) - score(a) || n(b.reach) - n(a.reach)).slice(0, 3)) {
      let image: string | null = null;
      if (r.post_id) {
        const { data: v } = await db.from("versions").select("asset_paths").eq("post_id", r.post_id).eq("stage", "arte")
          .eq("sent", true).order("number", { ascending: false }).limit(1);
        const first = (v?.[0]?.asset_paths ?? []).find((x: string) => !/\.mp4$/i.test(x));
        if (first) image = first;
      }
      // Só baixa miniatura do CDN da Meta (nunca um endereço qualquer)
      const cdnOk = (() => { try { const u = new URL(r.thumb_url ?? ""); return u.protocol === "https:" && /(\.cdninstagram\.com|\.fbcdn\.net)$/.test(u.hostname); } catch { return false; } })();
      if (!image && cdnOk) {
        try {
          const res = await fetch(r.thumb_url!, { redirect: "error" });
          if (res.ok && /^image\//.test(res.headers.get("content-type") ?? "")) {
            const path = `_relatorio/${slug}/${r.id.replace(/[^\w]/g, "")}.jpg`;
            const up = await db.storage.from("artes").upload(path, new Uint8Array(await res.arrayBuffer()), { contentType: "image/jpeg", upsert: true });
            if (!up.error) image = path;
          }
        } catch (_) { /* sem imagem */ }
      }
      top.push({ title: titleOf(r), date: r.published_at, format: fmtOf(r), permalink: r.permalink, image,
        reach: r.reach, shares: n(r.shares), saved: n(r.saved), likes: n(r.like_count), comments: n(r.comments_count) });
    }

    // Leitura por formato e editoria (só feed)
    const groupBy = (key: (r: Row) => string, name: (k: string) => string) => {
      const g = new Map<string, Row[]>();
      for (const r of feed) { const k = key(r); g.set(k, [...(g.get(k) ?? []), r]); }
      return [...g.entries()].map(([k, l]) => ({ name: name(k), posts: l.length,
        shares: l.reduce((a, r) => a + n(r.shares), 0) / l.length, saved: l.reduce((a, r) => a + n(r.saved), 0) / l.length,
        reach: l.some((r) => r.reach != null) ? l.reduce((a, r) => a + n(r.reach), 0) / l.length : null }))
        .sort((a, b) => (b.shares + b.saved) - (a.shares + a.saved));
    };
    const byFormat = groupBy(fmtOf, (k) => FORMATS[k] || k);
    const byEditoria = groupBy((r) => (r.post_id && P.get(r.post_id)?.editoria) || r.editoria || "", edName);

    // Métricas da conta no mês (quando a Meta libera)
    const account: Record<string, number | null> = {};
    try {
      const since = Math.floor(cur.start.getTime() / 1000), until = Math.min(Math.floor(cur.end.getTime() / 1000), since + 30 * 86400, Math.floor(Date.now() / 1000));
      if (net === "instagram") {
        for (const m of ["profile_views", "website_clicks", "accounts_engaged"]) {
          try {
            const j = await graph(`${IG_USER}/insights`, { metric: m, period: "day", metric_type: "total_value", since: String(since), until: String(until) });
            account[m] = j.data?.[0]?.total_value?.value ?? null;
          } catch (_) { account[m] = null; }
        }
      } else {
        const acc = await graph("me/accounts", { fields: "id,access_token,instagram_business_account" });
        const pg = (acc.data ?? []).find((x: { instagram_business_account?: { id: string } }) => x.instagram_business_account?.id === IG_USER);
        if (pg) for (const m of ["page_media_view", "page_post_engagements"]) {
          try {
            const j = await graph(`${pg.id}/insights`, { metric: m, period: "day", since: String(since), until: String(until) }, pg.access_token);
            account[m] = (j.data?.[0]?.values ?? []).reduce((a: number, v: { value?: number }) => a + (typeof v.value === "number" ? v.value : 0), 0);
          } catch (_) { account[m] = null; }
        }
      }
    } catch (_) { /* segue sem */ }

    (out.networks as Record<string, unknown>)[net] = { current: s, previous: sp.posts || sp.stories ? sp : null, followers: fol,
      account, top, byFormat, byEditoria };

    // Rascunho de aprendizados: só afirma o que os números sustentam
    if (net === "instagram" && feed.length) {
      const nm = "No Instagram";
      if (feed.length < 4) insights.push(`${nm}, foram ${feed.length} posts no feed. É pouco para comparar formatos e editorias com segurança; vale olhar a tendência dos próximos meses.`);
      const f2 = byFormat.filter((x) => x.posts >= 2);
      if (f2.length >= 2) insights.push(`${f2[0].name} teve em média ${(f2[0].shares + f2[0].saved).toFixed(1).replace(".", ",")} compartilhamentos e salvamentos por post, contra ${(f2[f2.length - 1].shares + f2[f2.length - 1].saved).toFixed(1).replace(".", ",")} em ${f2[f2.length - 1].name.toLowerCase()}.`);
      const e2 = byEditoria.filter((x) => x.posts >= 2 && x.name !== "Sem editoria");
      if (e2.length >= 2) insights.push(`Entre as editorias com 2 posts ou mais, "${e2[0].name}" foi a que mais gerou compartilhamento e salvamento.`);
      if (top[0] && top[0].shares + top[0].saved > 0)
        insights.push(`O post de melhor resultado foi "${top[0].title}": ${pl(top[0].shares, "compartilhamento", "compartilhamentos")} e ${pl(top[0].saved, "salvamento", "salvamentos")}.`);
      if (sp.posts) {
        const d = s.shares - sp.shares;
        insights.push(`Comparado ao mês anterior: ${pl(s.posts, "post", "posts")} (antes ${sp.posts}) e ${pl(s.shares, "compartilhamento", "compartilhamentos")} (${d >= 0 ? `${d} a mais` : `${-d} a menos`}).`);
      }
      if (s.saved <= 2 && feed.length >= 3) insights.push(`Salvamentos seguem baixos (${s.saved} no mês). Posts de consulta, como checklists e calendários de prazos, são os que mais costumam ser salvos.`);
    }
    if (net === "instagram" && fol.end != null && fol.start != null && fol.since)
      insights.push(`Seguidores no Instagram: ${fol.end}${fol.end !== fol.start ? ` (${fol.end - fol.start >= 0 ? "+" : ""}${fol.end - fol.start} desde ${fol.since.split("-").reverse().join("/")})` : ""}.`);
  }
  out.auto_insights = insights;

  const { data: existing } = await db.from("reports").select("texts").eq("slug", slug).maybeSingle();
  const texts = existing?.texts && Object.keys(existing.texts).length ? existing.texts
    : { learnings: insights, next_steps: [], analysis_instagram: "", analysis_facebook: "" };
  const { error } = await db.from("reports").upsert({ slug, data: out, texts, closed_at: new Date().toISOString() });
  if (error) throw error;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  // Admin logado ou o próprio servidor (segredo do cron)
  const secret = req.headers.get("x-cron-secret") ?? "", cs = env("CRON_SECRET");
  let ok = !!cs && secret.length === cs.length && [...secret].reduce((a, ch, i) => a | (ch.charCodeAt(0) ^ cs.charCodeAt(i)), 0) === 0;
  if (!ok) {
    const auth = req.headers.get("authorization") ?? "";
    const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: role } = await user.rpc("my_role");
    ok = role === "admin";
  }
  if (!ok) return new Response("forbidden", { status: 403, headers: cors(req) });
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(slug)) return Response.json({ error: "Mês inválido" }, { status: 400, headers: cors(req) });
  try {
    return Response.json(await main(slug), { headers: cors(req) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors(req) });
  }
});
