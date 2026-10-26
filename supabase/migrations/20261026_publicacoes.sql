-- Publicações: tudo que saiu no Instagram da Garten (pelo sistema ou direto pelo app) e as métricas.
-- Só o admin lê. Quem escreve é o servidor (funções publicar e metricas, com service_role).

create table if not exists public.ig_media (
  id text primary key,                         -- ID da mídia no Instagram
  post_id uuid references public.posts(id) on delete set null,  -- null = publicado fora do sistema
  product_type text,                           -- FEED, REELS, STORY
  media_type text,                             -- IMAGE, VIDEO, CAROUSEL_ALBUM
  caption text,
  permalink text,
  thumb_url text,                              -- URL do CDN da Meta (expira; renovada a cada sincronização)
  published_at timestamptz,
  editoria text,                               -- classificação manual de posts de fora do sistema
  like_count int, comments_count int,
  reach int, views int, saved int, shares int, replies int,
  insights_at timestamptz, insights_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ig_media_published on public.ig_media (published_at desc);
create index if not exists ig_media_post on public.ig_media (post_id);

alter table public.ig_media enable row level security;
drop policy if exists ig_media_admin_read on public.ig_media;
create policy ig_media_admin_read on public.ig_media for select to authenticated using (public.is_admin());
-- Nenhuma policy de escrita: o navegador não altera métricas. Editoria muda pela função abaixo.

create or replace function public.set_media_editoria(p_media text, p_editoria text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_editoria is not null and not exists (select 1 from public.editorias where slug = p_editoria) then
    raise exception 'Editoria inválida';
  end if;
  update public.ig_media set editoria = p_editoria where id = p_media;
  if not found then raise exception 'not found'; end if;
end $$;
revoke all on function public.set_media_editoria(text, text) from public, anon;
grant execute on function public.set_media_editoria(text, text) to authenticated;

-- Execuções da sincronização (para mostrar "atualizado há X" e erros de permissão)
create table if not exists public.ig_sync_runs (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  ok boolean, media_count int, insights_count int, error text
);
alter table public.ig_sync_runs enable row level security;
drop policy if exists ig_sync_admin_read on public.ig_sync_runs;
create policy ig_sync_admin_read on public.ig_sync_runs for select to authenticated using (public.is_admin());

-- Defesa extra: anônimo sem acesso nenhum; logado só lê (pelo RLS, só admin)
revoke all on public.ig_media, public.ig_sync_runs from anon;
revoke insert, update, delete on public.ig_media, public.ig_sync_runs from authenticated;

-- Cron de hora em hora (Stories só têm métricas nas primeiras 24h)
-- select cron.schedule('metricas-instagram', '17 * * * *', $cron$ select net.http_post(
--   url := 'https://npqrgkhuwusyuqrqyvqs.supabase.co/functions/v1/metricas',
--   headers := jsonb_build_object('content-type','application/json','x-cron-secret',
--     (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_cron_secret')),
--   body := '{}'::jsonb, timeout_milliseconds := 120000) $cron$);
