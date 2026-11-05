-- Quando o post vira agendado ou publicado, os avisos "data passou" e "sem horário" dele saem do painel.
create or replace function public.clear_stale_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.publish_status in ('agendado', 'publicado')
     and new.publish_status is distinct from old.publish_status then
    update public.notifications set read_at = now()
    where post_id = new.id and read_at is null
      and kind in ('data_passou', 'sem_horario');
  end if;
  return new;
end $$;
revoke all on function public.clear_stale_notifications() from public, anon, authenticated;
drop trigger if exists posts_clear_notifications on public.posts;
create trigger posts_clear_notifications after update of publish_status on public.posts
  for each row execute function public.clear_stale_notifications();

-- Limpa os avisos que já tinham ficado velhos
update public.notifications n set read_at = now()
from public.posts p
where n.post_id = p.id and n.read_at is null
  and n.kind in ('data_passou', 'sem_horario')
  and p.publish_status in ('agendado', 'publicado');
