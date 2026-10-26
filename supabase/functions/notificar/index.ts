// Edge Function "notificar": manda cada aviso novo (tabela notifications) por e-mail via Resend.
// Chamada só pelo gatilho do banco (header x-cron-secret), com o id do aviso.
//
// Secrets: CRON_SECRET, RESEND_API_KEY, NOTIFY_EMAIL (e-mail da conta Resend, sem domínio verificado
// o Resend só entrega para ele), NOTIFY_FROM (opcional, quando houver domínio verificado),
// SITE_URL (opcional, base do link do card).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const SITE = env("SITE_URL") || "https://matsu-dsgn.github.io/garten-aprovacao/";

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const SUBJECT: Record<string, string> = {
  agendado: "Post agendado", data_passou: "Aprovado, mas a data passou",
  sem_horario: "Aprovado, sem horário livre", erro_publicacao: "Erro ao publicar",
};

Deno.serve(async (req) => {
  if (req.method !== "POST" || !safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) {
    return new Response("forbidden", { status: 403 });
  }
  const key = env("RESEND_API_KEY"), to = env("NOTIFY_EMAIL");
  if (!key || !to) return Response.json({ skipped: "sem RESEND_API_KEY ou NOTIFY_EMAIL" });

  const { id } = await req.json().catch(() => ({}));
  if (!Number.isInteger(id)) return new Response("id inválido", { status: 400 });
  const { data: n } = await db.from("notifications").select("*").eq("id", id).maybeSingle();
  if (!n) return new Response("not found", { status: 404 });

  // Só links do próprio site (o card no Kanban)
  const link = n.url && /^kanban\.html\?[\w=&.%-]+$/.test(n.url) ? new URL(n.url, SITE).href : SITE + "admin.html";
  const urgent = n.kind !== "agendado";
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;color:#002a50">
    <p style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${urgent ? "#9a4507" : "#00703d"};margin:0 0 6px">${esc(n.title)}</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 18px">${esc(n.body || "")}</p>
    <a href="${esc(link)}" style="display:inline-block;background:#002a50;color:#e8edf3;text-decoration:none;padding:10px 18px;border-radius:99px;font-weight:600">Abrir o card</a>
    <p style="font-size:12px;color:#46566b;margin-top:22px">Aviso automático do painel de aprovação da Garten.</p></div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `garten-aviso-${id}` },
    body: JSON.stringify({
      from: env("NOTIFY_FROM") || "Garten Avisos <onboarding@resend.dev>",
      to: [to],
      subject: `Garten · ${urgent ? "Atenção: " : ""}${SUBJECT[n.kind] || n.title}`,
      html, text: `${n.title}\n\n${n.body || ""}\n\n${link}`,
    }),
  });
  const out = await res.json().catch(() => ({}));
  return Response.json({ ok: res.ok, resend: out }, { status: res.ok ? 200 : 502 });
});
