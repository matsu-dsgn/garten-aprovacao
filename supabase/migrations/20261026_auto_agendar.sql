-- Agendamento automático no OK final do cliente + avisos para o admin.
-- Quando o post fica 100% aprovado (arte; e copy com legenda, menos no Stories), ele é agendado
-- na data do card, no horário sugerido. Regras:
--   - data já passou ou faltam menos de 2h: não agenda, avisa para escolher nova data
--   - feed: no mínimo 3h de distância de outro post do feed no mesmo dia (até 20h); senão avisa
-- O admin sempre recebe o aviso e pode mudar ou cancelar até a publicação.

-- Horário sugerido (uma linha só). A função metricas atualiza com os seguidores online quando houver.
create table if not exists public.pub_settings (
  id boolean primary key default true check (id),
  feed_time time not null default '12:10',
  story_time time not null default '09:10',
  source text not null default 'padrão',
  updated_at timestamptz not null default now()
);
insert into public.pub_settings (id) values (true) on conflict do nothing;
alter table public.pub_settings enable row level security;
drop policy if exists pub_settings_admin on public.pub_settings;
create policy pub_settings_admin on public.pub_settings for select to authenticated using (public.is_admin());
revoke all on public.pub_settings from anon;
revoke insert, update, delete on public.pub_settings from authenticated;

-- Avisos para o admin (painel + notificação do navegador)
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  kind text not null,                 -- agendado | data_passou | sem_horario | erro_publicacao
  post_id uuid references public.posts(id) on delete cascade,
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_unread on public.notifications (created_at desc) where read_at is null;
alter table public.notifications enable row level security;
drop policy if exists notifications_admin_read on public.notifications;
create policy notifications_admin_read on public.notifications for select to authenticated using (public.is_admin());
revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;

create or replace function public.mark_notifications_read(p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.notifications set read_at = now() where id = any(p_ids) and read_at is null;
end $$;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

-- Link do card no Kanban
create or replace function public.post_url(p_post uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'kanban.html?mes=' || m.slug || '&post=' || p.id
  from public.posts p join public.months m on m.id = p.month_id where p.id = p_post
$$;
revoke all on function public.post_url(uuid) from public, anon, authenticated;

-- O gatilho
create or replace function public.auto_schedule_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.posts; s public.pub_settings; at timestamptz; tries int := 0;
  quando text; tz constant text := 'America/Sao_Paulo';
begin
  if new.status <> 'aprovado' or new.stage not in ('copy', 'arte') then return new; end if;
  select * into p from public.posts where id = new.post_id for update;
  if not found or p.scheduled or p.publish_status in ('publicando', 'publicado') then return new; end if;
  -- Post completo e aprovado?
  if not public.arte_approved(p.id) then return new; end if;
  if p.format is distinct from 'stories' and public.approved_caption(p.id) is null then return new; end if;

  select * into s from public.pub_settings limit 1;
  at := ((p.post_date + case when p.format = 'stories' then s.story_time else s.feed_time end)::timestamp) at time zone tz;

  if at < now() + interval '2 hours' then
    insert into public.notifications (kind, post_id, title, body, url)
    values ('data_passou', p.id, 'Aprovado, mas a data passou',
      format('"%s" foi aprovado, mas era para %s. Escolha uma nova data para agendar.', p.title, to_char(p.post_date, 'DD/MM')),
      public.post_url(p.id));
    return new;
  end if;

  -- Feed: espaça 3h de outro post do feed no mesmo dia, até 20h
  if p.format is distinct from 'stories' then
    while exists (select 1 from public.posts o where o.id <> p.id and o.scheduled
                  and o.format is distinct from 'stories'
                  and abs(extract(epoch from (o.scheduled_at - at))) < 3 * 3600) loop
      at := at + interval '3 hours'; tries := tries + 1;
      if (at at time zone tz)::time > '20:00' or tries > 4 then
        insert into public.notifications (kind, post_id, title, body, url)
        values ('sem_horario', p.id, 'Aprovado, sem horário livre',
          format('"%s" foi aprovado, mas já há posts demais em %s. Escolha o horário.', p.title, to_char(p.post_date, 'DD/MM')),
          public.post_url(p.id));
        return new;
      end if;
    end loop;
  end if;

  perform set_config('garten.sys', 'on', true);
  update public.posts set scheduled = true, scheduled_at = at, publish_status = 'agendado', publish_error = null
  where id = p.id;
  quando := to_char(at at time zone tz, 'DD/MM "às" HH24"h"MI');
  insert into public.notifications (kind, post_id, title, body, url)
  values ('agendado', p.id, 'Post agendado sozinho',
    format('"%s" foi aprovado e sai em %s. Dá para mudar ou cancelar no card.', p.title, quando),
    public.post_url(p.id));
  return new;
end $$;
revoke all on function public.auto_schedule_on_approval() from public, anon, authenticated;
drop trigger if exists decisions_auto_schedule on public.decisions;
create trigger decisions_auto_schedule after insert on public.decisions
  for each row execute function public.auto_schedule_on_approval();

-- Erro de publicação também vira aviso
create or replace function public.notify_publish_error()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.publish_status = 'erro' and old.publish_status is distinct from 'erro' then
    insert into public.notifications (kind, post_id, title, body, url)
    values ('erro_publicacao', new.id, 'Erro ao publicar',
      format('"%s": %s', new.title, left(coalesce(new.publish_error, 'erro desconhecido'), 200)), public.post_url(new.id));
  end if;
  return new;
end $$;
revoke all on function public.notify_publish_error() from public, anon, authenticated;
drop trigger if exists posts_notify_error on public.posts;
create trigger posts_notify_error after update of publish_status on public.posts
  for each row execute function public.notify_publish_error();
