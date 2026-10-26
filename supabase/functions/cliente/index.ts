// Edge Function "cliente": única porta de entrada do cliente (link + token, sem login).
// Toda regra de aprovação é decidida aqui, no servidor.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://matsu-dsgn.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type, x-month-token, apikey, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[0-9a-f]{48}$/;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

async function authMonth(slug: string | null, token: string | null) {
  if (!slug || !token || !SLUG_RE.test(slug) || !TOKEN_RE.test(token)) return null;
  const { data } = await db.from("months").select("*").eq("slug", slug).maybeSingle();
  if (!data?.token_hash) return null;
  return safeEqual(await sha256(token), data.token_hash) ? data : null;
}

async function loadState(month: { id: string }) {
  const { data: posts } = await db.from("posts")
    .select("id, post_date, format, theme, editoria, kind, origin, respond_by, title, objective, direction, checklist, scheduled, sort")
    .eq("month_id", month.id).order("post_date").order("sort");
  const ids = (posts ?? []).map((p) => p.id);
  const [{ data: versions }, { data: decisions }, { data: approvers }, { data: editorias }] = await Promise.all([
    ids.length
      ? db.from("versions").select("id, post_id, stage, number, copy_text, caption_text, asset_paths, created_at")
        .in("post_id", ids).eq("sent", true).order("number")
      : Promise.resolve({ data: [] }),
    ids.length
      ? db.from("decisions").select("id, post_id, stage, version_id, actor, status, note, slide_notes, created_at")
        .in("post_id", ids).order("created_at")
      : Promise.resolve({ data: [] }),
    db.from("approvers").select("slug, name, is_final").eq("active", true).order("is_final", { ascending: false }),
    db.from("editorias").select("slug, name, description, shape, sort, seasonal").eq("active", true).order("sort"),
  ]);

  // URLs assinadas (1h) só para arquivos deste mês
  const paths = (versions ?? []).flatMap((v) => v.asset_paths ?? []);
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await db.storage.from("artes").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return { posts, versions, decisions, approvers, editorias, urls };
}

async function decide(req: Request, month: { id: string }) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "JSON inválido" }, 400); }

  const postId = String(body.post_id ?? "");
  const stage = String(body.stage ?? "");
  const status = String(body.status ?? "");
  const actor = String(body.actor ?? "");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const slideNotesIn = body.slide_notes && typeof body.slide_notes === "object" ? body.slide_notes as Record<string, unknown> : {};

  if (!UUID_RE.test(postId)) return json(req, { error: "Post inválido" }, 400);
  if (!["pauta", "copy", "arte"].includes(stage)) return json(req, { error: "Etapa inválida" }, 400);
  if (!["aprovado", "reprovado"].includes(status)) return json(req, { error: "Status inválido" }, 400);
  if (note.length > 1500) return json(req, { error: "Observação muito longa (máx. 1500)" }, 400);
  if (status === "reprovado" && note.length < 3) return json(req, { error: "Explique o motivo da reprovação" }, 400);

  const slide_notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(slideNotesIn).slice(0, 20)) {
    if (!/^\d{1,2}$/.test(k) || typeof v !== "string") continue;
    const t = v.trim().slice(0, 500);
    if (t) slide_notes[k] = t;
  }

  // Aprovador existe e está ativo
  const { data: approver } = await db.from("approvers").select("slug, is_final")
    .eq("slug", actor).eq("active", true).maybeSingle();
  if (!approver) return json(req, { error: "Selecione quem está aprovando" }, 400);

  // IDOR: o post precisa pertencer ao mês do token
  const { data: post } = await db.from("posts").select("id, scheduled")
    .eq("id", postId).eq("month_id", month.id).maybeSingle();
  if (!post) return json(req, { error: "Post não encontrado" }, 404);
  if (post.scheduled) return json(req, { error: "Post já agendado — mudanças viram pedido de alteração" }, 409);

  // Versão atual da etapa (o servidor escolhe, não o cliente)
  let versionId: string | null = null;
  if (stage === "pauta") {
    const { count } = await db.from("versions").select("id", { count: "exact", head: true })
      .eq("post_id", postId).eq("stage", "arte").eq("sent", true);
    if ((count ?? 0) > 0) return json(req, { error: "A arte já subiu — a pauta está travada" }, 409);
  } else {
    const { data: v } = await db.from("versions").select("id").eq("post_id", postId).eq("stage", stage)
      .eq("sent", true).order("number", { ascending: false }).limit(1).maybeSingle();
    if (!v) return json(req, { error: "Ainda não há versão para aprovar" }, 409);
    versionId = v.id;
  }

  // Wilker e Letícia têm o mesmo peso: vale a última resposta
  const { error } = await db.from("decisions").insert({
    post_id: postId, stage, version_id: versionId, actor, status,
    note: note || null, slide_notes,
  });
  if (error) return json(req, { error: "Não foi possível salvar" }, 500);
  return json(req, await loadState(month));
}

// ---------- Radar legislativo (visão do cliente) ----------
// Qualquer link de mês válido dá acesso ao radar inteiro (não é dado por mês).
const RADAR_FIELDS = "id, created_at, data_publicacao, esfera, orgao, ato, titulo, resumo, vigencia, publico, relevancia, tipo, angulo_pauta, url, setores_afetados, impacto_carteira, status, cliente_avaliacao, cliente_actor";

async function radarState() {
  const [{ data: alerts }, { data: runs }, { data: approvers }] = await Promise.all([
    db.from("radar_alerts").select(RADAR_FIELDS).order("created_at", { ascending: false }).limit(150),
    db.from("radar_runs").select("run_at, finished_at, itens, ok").order("run_at", { ascending: false }).limit(10),
    db.from("approvers").select("slug, name").eq("active", true),
  ]);
  return { alerts: alerts ?? [], runs: runs ?? [], approvers: approvers ?? [] };
}

async function radarRate(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "JSON inválido" }, 400); }
  const id = String(body.alert_id ?? "");
  const actor = String(body.actor ?? "");
  const rawValue = body.value;
  if (!UUID_RE.test(id)) return json(req, { error: "Item inválido" }, 400);
  if (rawValue !== null && !["faz_sentido", "nao_faz"].includes(String(rawValue))) return json(req, { error: "Avaliação inválida" }, 400);
  const { data: approver } = await db.from("approvers").select("slug").eq("slug", actor).eq("active", true).maybeSingle();
  if (!approver) return json(req, { error: "Selecione quem está avaliando" }, 400);
  const value = rawValue === null ? null : String(rawValue);
  const { data, error } = await db.from("radar_alerts")
    .update({ cliente_avaliacao: value, cliente_actor: value ? actor : null, cliente_avaliado_em: value ? new Date().toISOString() : null })
    .eq("id", id).select("id").maybeSingle();
  if (error) return json(req, { error: "Não foi possível salvar" }, 500);
  if (!data) return json(req, { error: "Item não encontrado" }, 404);
  return json(req, await radarState());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const url = new URL(req.url);
  const month = await authMonth(url.searchParams.get("m"), req.headers.get("x-month-token"));
  if (!month) return json(req, { error: "Link inválido ou expirado" }, 401);

  const isRadar = url.searchParams.get("v") === "radar";
  if (isRadar && req.method === "GET") return json(req, await radarState());
  if (isRadar && req.method === "POST") return radarRate(req);

  if (req.method === "GET") {
    return json(req, {
      month: { slug: month.slug, title: month.title, overview: month.overview },
      ...(await loadState(month)),
    });
  }
  if (req.method === "POST") return decide(req, month);
  return json(req, { error: "Método não permitido" }, 405);
});
