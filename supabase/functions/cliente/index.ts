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
    .select("id, post_date, format, theme, title, objective, direction, checklist, scheduled, sort")
    .eq("month_id", month.id).order("post_date").order("sort");
  const ids = (posts ?? []).map((p) => p.id);
  const [{ data: versions }, { data: decisions }, { data: approvers }] = await Promise.all([
    ids.length
      ? db.from("versions").select("id, post_id, stage, number, copy_text, asset_paths, created_at")
        .in("post_id", ids).order("number")
      : Promise.resolve({ data: [] }),
    ids.length
      ? db.from("decisions").select("id, post_id, stage, version_id, actor, status, note, slide_notes, created_at")
        .in("post_id", ids).order("created_at")
      : Promise.resolve({ data: [] }),
    db.from("approvers").select("slug, name, is_final").eq("active", true).order("is_final", { ascending: false }),
  ]);

  // URLs assinadas (1h) só para arquivos deste mês
  const paths = (versions ?? []).flatMap((v) => v.asset_paths ?? []);
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await db.storage.from("artes").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return { posts, versions, decisions, approvers, urls };
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
      .eq("post_id", postId).eq("stage", "arte");
    if ((count ?? 0) > 0) return json(req, { error: "A arte já subiu — a pauta está travada" }, 409);
  } else {
    const { data: v } = await db.from("versions").select("id").eq("post_id", postId).eq("stage", stage)
      .order("number", { ascending: false }).limit(1).maybeSingle();
    if (!v) return json(req, { error: "Ainda não há versão para aprovar" }, 409);
    versionId = v.id;
  }

  // Hierarquia (Wilker > Letícia) é garantida de forma atômica pelo trigger decisions_hierarchy
  const { error } = await db.from("decisions").insert({
    post_id: postId, stage, version_id: versionId, actor, status,
    note: note || null, slide_notes,
  });
  if (error?.message?.includes("final_decided")) return json(req, { error: "O Wilker já decidiu esta etapa" }, 403);
  if (error) return json(req, { error: "Não foi possível salvar" }, 500);
  return json(req, await loadState(month));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const url = new URL(req.url);
  const month = await authMonth(url.searchParams.get("m"), req.headers.get("x-month-token"));
  if (!month) return json(req, { error: "Link inválido ou expirado" }, 401);

  if (req.method === "GET") {
    return json(req, {
      month: { slug: month.slug, title: month.title, overview: month.overview },
      ...(await loadState(month)),
    });
  }
  if (req.method === "POST") return decide(req, month);
  return json(req, { error: "Método não permitido" }, 405);
});
