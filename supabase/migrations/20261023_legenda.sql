-- Legenda do post separada da copy.
-- Copy = texto que vai dentro da arte. Legenda = texto do post no Instagram.
-- As duas vivem na mesma versão da etapa "copy" e são aprovadas juntas.
-- Rodar uma vez no SQL Editor do Supabase.

alter table public.versions
  add column if not exists caption_text text
    check (caption_text is null or char_length(caption_text) <= 2200);

-- A publicação usa a legenda aprovada (não mais o texto da arte)
create or replace function public.approved_caption(p_post uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(v.caption_text), '')
  from public.versions v
  join lateral (select status from public.decisions d
                where d.post_id = v.post_id and d.stage = 'copy' and d.version_id = v.id
                order by d.created_at desc limit 1) d on true
  where v.post_id = p_post and v.stage = 'copy' and v.sent and d.status = 'aprovado'
  order by v.number desc limit 1
$$;
revoke all on function public.approved_caption(uuid) from public, anon, authenticated;

-- Agendar agora exige legenda aprovada (post sem legenda não vai pro ar)
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
    if public.approved_caption(p_post) is null then
      raise exception 'Só dá para agendar post com legenda aprovada';
    end if;
    update public.posts set scheduled = true, scheduled_at = p_at,
      publish_status = 'agendado', publish_error = null where id = p_post;
  end if;
end $$;
revoke all on function public.schedule_post(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_post(uuid, timestamptz) to authenticated;
