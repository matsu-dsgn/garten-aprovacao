-- Stories não tem legenda: agendar Stories não exige legenda aprovada.
-- Os outros formatos continuam exigindo.
create or replace function public.schedule_post(p_post uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare cur text; fmt text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select publish_status, format into cur, fmt from public.posts where id = p_post for update;
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
    if fmt is distinct from 'stories' and public.approved_caption(p_post) is null then
      raise exception 'Só dá para agendar post com legenda aprovada';
    end if;
    update public.posts set scheduled = true, scheduled_at = p_at,
      publish_status = 'agendado', publish_error = null where id = p_post;
  end if;
end $$;
revoke all on function public.schedule_post(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_post(uuid, timestamptz) to authenticated;
