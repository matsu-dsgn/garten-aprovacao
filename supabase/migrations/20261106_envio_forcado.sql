-- Envio forçado ao cliente (só admin, com confirmação no front): vale mesmo com ajuste pedido
-- (do cliente ou interno) e mesmo sem versão nova. Continua exigindo post completo.
drop function if exists public.send_post(uuid, text);
create or replace function public.send_post(p_post uuid, p_parts text default 'post', p_force boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  fmt text;
  last_copy public.versions; last_arte public.versions;
  sent_copy int; sent_arte int;
  copy_new bool; arte_new bool;
  falta text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_parts <> 'post' then raise exception 'O post vai ao cliente completo (arte e legenda juntas)'; end if;
  select format into fmt from public.posts where id = p_post for update;
  if not found then raise exception 'not found'; end if;
  if exists (select 1 from public.posts where id = p_post and publish_status in ('agendado', 'publicando', 'publicado')) then
    raise exception 'Post agendado ou publicado. Desagende antes de enviar de novo.';
  end if;

  select * into last_copy from public.versions where post_id = p_post and stage = 'copy' order by number desc limit 1;
  select * into last_arte from public.versions where post_id = p_post and stage = 'arte' order by number desc limit 1;
  select coalesce(max(number), 0) into sent_copy from public.versions where post_id = p_post and stage = 'copy' and sent;
  select coalesce(max(number), 0) into sent_arte from public.versions where post_id = p_post and stage = 'arte' and sent;

  if last_arte.id is null or coalesce(array_length(last_arte.asset_paths, 1), 0) = 0 then falta := falta || 'arte'; end if;
  if last_copy.id is null or btrim(coalesce(last_copy.copy_text, '')) = '' then falta := falta || 'texto da arte'; end if;
  if fmt is distinct from 'stories' and (last_copy.id is null or btrim(coalesce(last_copy.caption_text, '')) = '') then falta := falta || 'legenda'; end if;
  if array_length(falta, 1) > 0 then raise exception 'Para enviar ao cliente falta: %', array_to_string(falta, ', '); end if;
  if not p_force and ((not last_copy.sent and last_copy.review_note is not null) or (not last_arte.sent and last_arte.review_note is not null)) then
    raise exception 'Tem ajuste interno pedido. Espere a nova versão antes de enviar.';
  end if;

  copy_new := last_copy.number > sent_copy;
  arte_new := last_arte.number > sent_arte;
  if not (copy_new or arte_new) and not p_force then raise exception 'Nada novo para enviar ao cliente'; end if;

  update public.versions set sent = true, sent_at = now(), review_note = null, review_at = null, internal_ok = true
  where sent = false and id in (case when copy_new then last_copy.id end, case when arte_new then last_arte.id end);

  -- Arte sem versão nova (só a legenda mudou, ou reenvio forçado): vai de novo como nova versão,
  -- para valer uma nova decisão do cliente
  if not arte_new then
    insert into public.versions (post_id, stage, number, asset_paths, sent, sent_at, author_email, internal_ok)
    values (p_post, 'arte', last_arte.number + 1, last_arte.asset_paths, true, now(), last_arte.author_email, true);
  end if;
  return 'post';
end $$;
revoke all on function public.send_post(uuid, text, boolean) from public, anon;
grant execute on function public.send_post(uuid, text, boolean) to authenticated;
