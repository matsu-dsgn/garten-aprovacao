-- Publicação automática no Instagram.
-- O painel só agenda; quem publica é a Edge Function "publicar", chamada pelo pg_cron.
-- Rodar uma vez no SQL Editor do Supabase (projeto garten-aprovacao).

alter table public.posts
  add column if not exists publish_status text
    check (publish_status in ('agendado', 'publicando', 'publicado', 'erro')),
  add column if not exists publish_error text,
  add column if not exists published_at timestamptz,
  add column if not exists ig_media_id text,
  add column if not exists ig_permalink text,
  add column if not exists publish_attempts int not null default 0;

-- Legenda = copy mais recente enviada ao cliente e aprovada (null se não houver)
create or replace function public.approved_copy(p_post uuid)
returns text language sql stable security definer set search_path = public as $$
  select v.copy_text
  from public.versions v
  join lateral (select status from public.decisions d
                where d.post_id = v.post_id and d.stage = 'copy' and d.version_id = v.id
                order by d.created_at desc limit 1) d on true
  where v.post_id = p_post and v.stage = 'copy' and v.sent and d.status = 'aprovado'
  order by v.number desc limit 1
$$;
revoke all on function public.approved_copy(uuid) from public, anon, authenticated;

-- Colunas de publicação só mudam pelas funções abaixo ou pelo servidor (service_role).
-- Sem isso, qualquer admin logado poderia marcar "publicado" direto pela API.
create or replace function public.guard_publish_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('garten.sys', true), '') = 'on' or auth.role() = 'service_role' then
    return new;
  end if;
  if (new.publish_status, new.publish_error, new.published_at, new.ig_media_id, new.ig_permalink, new.publish_attempts)
     is distinct from
     (old.publish_status, old.publish_error, old.published_at, old.ig_media_id, old.ig_permalink, old.publish_attempts) then
    raise exception 'Status de publicação só muda pelo sistema';
  end if;
  -- Post publicado ou em publicação não pode ser reagendado/desagendado por fora
  if old.publish_status in ('publicando', 'publicado')
     and (new.scheduled, new.scheduled_at) is distinct from (old.scheduled, old.scheduled_at) then
    raise exception 'Post já publicado ou em publicação';
  end if;
  return new;
end $$;
drop trigger if exists posts_guard_publish on public.posts;
create trigger posts_guard_publish before update on public.posts
  for each row execute function public.guard_publish_cols();

-- Substitui a versão de 20261021: agora também controla o status de publicação.
create or replace function public.schedule_post(p_post uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select publish_status into cur from public.posts where id = p_post for update;
  if not found then raise exception 'not found'; end if;
  if cur in ('publicando', 'publicado') then raise exception 'Post já publicado ou em publicação'; end if;
  perform set_config('garten.sys', 'on', true);
  if p_at is null then
    update public.posts set scheduled = false, scheduled_at = null,
      publish_status = null, publish_error = null where id = p_post;
  else
    if p_at < now() + interval '5 minutes' or p_at > now() + interval '400 days' then
      raise exception 'Agende com pelo menos 5 minutos de antecedência';
    end if;
    update public.posts set scheduled = true, scheduled_at = p_at,
      publish_status = 'agendado', publish_error = null where id = p_post;
  end if;
end $$;
revoke all on function public.schedule_post(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_post(uuid, timestamptz) to authenticated;

-- Pega os posts vencidos e trava cada um em "publicando" (atômico, sem pegar duas vezes).
-- Só o servidor chama.
create or replace function public.claim_due_posts(p_limit int default 5)
returns setof uuid language plpgsql security definer set search_path = public as $$
begin
  perform set_config('garten.sys', 'on', true);
  -- Travado há mais de 15 min: vira erro. Nunca re-tenta sozinho (risco de post duplicado).
  update public.posts set publish_status = 'erro',
    publish_error = 'Publicação travou. Confira no Instagram antes de reagendar.'
  where publish_status = 'publicando' and scheduled_at < now() - interval '15 minutes';

  return query
  update public.posts p set publish_status = 'publicando', publish_attempts = p.publish_attempts + 1
  where p.id in (
    select id from public.posts
    where scheduled and publish_status = 'agendado' and scheduled_at <= now()
    order by scheduled_at limit p_limit
    for update skip locked)
  returning p.id;
end $$;
revoke all on function public.claim_due_posts(int) from public, anon, authenticated;

create or replace function public.finish_publish(p_post uuid, p_ok boolean, p_media text, p_link text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('garten.sys', 'on', true);
  update public.posts set
    publish_status = case when p_ok then 'publicado' else 'erro' end,
    published_at = case when p_ok then now() else null end,
    ig_media_id = p_media, ig_permalink = p_link,
    publish_error = case when p_ok then null else left(p_error, 500) end
  where id = p_post and publish_status = 'publicando';
end $$;
revoke all on function public.finish_publish(uuid, boolean, text, text, text) from public, anon, authenticated;

-- Posts já agendados antes desta migração entram na fila
update public.posts set publish_status = 'agendado' where scheduled and publish_status is null;

-- ---------- Cron (rodar DEPOIS de publicar a Edge Function e criar o secret CRON_SECRET) ----------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select vault.create_secret('<mesmo valor do CRON_SECRET>', 'publicar_cron_secret');
-- select cron.schedule('publicar-instagram', '*/5 * * * *', $cron$
--   select net.http_post(
--     url := 'https://npqrgkhuwusyuqrqyvqs.supabase.co/functions/v1/publicar',
--     headers := jsonb_build_object('content-type', 'application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_cron_secret')),
--     body := '{}'::jsonb, timeout_milliseconds := 120000)
-- $cron$);
