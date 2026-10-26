-- Facebook: publicar também na Página e acompanhar métricas.
-- fb_publish: null = automático (feed vai para os dois; Stories e Reels só Instagram), true/false = escolha do admin.

alter table public.posts
  add column if not exists fb_publish boolean,
  add column if not exists fb_post_id text,
  add column if not exists fb_error text;

alter table public.ig_media
  add column if not exists network text not null default 'instagram' check (network in ('instagram', 'facebook'));

-- Seguidores por dia (a Meta não entrega histórico para contas com menos de 100 seguidores)
create table if not exists public.follower_snapshots (
  network text not null check (network in ('instagram', 'facebook')),
  day date not null,
  followers int not null,
  primary key (network, day)
);
alter table public.follower_snapshots enable row level security;
drop policy if exists follower_snapshots_admin on public.follower_snapshots;
create policy follower_snapshots_admin on public.follower_snapshots for select to authenticated using (public.is_admin());
revoke all on public.follower_snapshots from anon;
revoke insert, update, delete on public.follower_snapshots from authenticated;

-- Métricas diárias da conta (alcance, visitas ao perfil...) para o relatório do mês
create table if not exists public.account_daily (
  network text not null check (network in ('instagram', 'facebook')),
  day date not null,
  metrics jsonb not null default '{}',
  primary key (network, day)
);
alter table public.account_daily enable row level security;
drop policy if exists account_daily_admin on public.account_daily;
create policy account_daily_admin on public.account_daily for select to authenticated using (public.is_admin());
revoke all on public.account_daily from anon;
revoke insert, update, delete on public.account_daily from authenticated;

-- fb_post_id e fb_error só o servidor altera (mesma trava das colunas de publicação)
create or replace function public.guard_publish_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('garten.sys', true), '') = 'on' or auth.role() = 'service_role' then
    return new;
  end if;
  if (new.publish_status, new.publish_error, new.published_at, new.ig_media_id, new.ig_permalink,
      new.publish_attempts, new.stories_done, new.stories_version, new.fb_post_id, new.fb_error)
     is distinct from
     (old.publish_status, old.publish_error, old.published_at, old.ig_media_id, old.ig_permalink,
      old.publish_attempts, old.stories_done, old.stories_version, old.fb_post_id, old.fb_error) then
    raise exception 'Status de publicação só muda pelo sistema';
  end if;
  if old.publish_status in ('publicando', 'publicado')
     and (new.scheduled, new.scheduled_at, new.fb_publish) is distinct from (old.scheduled, old.scheduled_at, old.fb_publish) then
    raise exception 'Post já publicado ou em publicação';
  end if;
  return new;
end $$;
revoke all on function public.guard_publish_cols() from public, anon, authenticated;
