-- Agendamento de posts com data e hora, validado no banco.
-- Rodar uma vez no SQL Editor do Supabase (projeto garten-aprovacao).

alter table public.posts add column if not exists scheduled_at timestamptz;

-- A arte mais recente enviada ao cliente está aprovada?
create or replace function public.arte_approved(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select d.status = 'aprovado'
    from public.versions v
    join lateral (select status from public.decisions d
                  where d.post_id = v.post_id and d.stage = 'arte' and d.version_id = v.id
                  order by d.created_at desc limit 1) d on true
    where v.post_id = p_post and v.stage = 'arte' and v.sent
    order by v.number desc limit 1), false)
$$;
revoke all on function public.arte_approved(uuid) from public, anon;

-- Regra no banco: vale para qualquer caminho de escrita, inclusive o painel
create or replace function public.guard_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.scheduled and not coalesce(old.scheduled, false) then
    if new.scheduled_at is null then raise exception 'Informe data e hora do agendamento'; end if;
    if not public.arte_approved(new.id) then raise exception 'Só dá para agendar post com arte aprovada'; end if;
  end if;
  if not new.scheduled then new.scheduled_at := null; end if;
  return new;
end $$;
drop trigger if exists posts_guard_schedule on public.posts;
create trigger posts_guard_schedule before update of scheduled, scheduled_at on public.posts
  for each row execute function public.guard_schedule();

-- Agendar (p_at preenchido) ou desagendar (p_at nulo). Só admin.
create or replace function public.schedule_post(p_post uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_at is null then
    update public.posts set scheduled = false, scheduled_at = null where id = p_post;
  else
    if p_at < now() - interval '1 day' or p_at > now() + interval '400 days' then raise exception 'Data fora do intervalo'; end if;
    update public.posts set scheduled = true, scheduled_at = p_at where id = p_post;
  end if;
  if not found then raise exception 'not found'; end if;
end $$;
revoke all on function public.schedule_post(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_post(uuid, timestamptz) to authenticated;
