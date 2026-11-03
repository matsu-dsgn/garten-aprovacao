-- Envio ao cliente por parte: só a copy, só a arte, os dois, ou "pronto" (o que estiver completo e novo).
-- Mantém as regras: só admin, cada parte precisa estar completa, sem ajuste interno pendente, e ter versão nova.
drop function if exists public.send_post(uuid);
create or replace function public.send_post(p_post uuid, p_parts text default 'ambos')
returns text language plpgsql security definer set search_path = public as $$
declare
  fmt text;
  last_copy public.versions; last_arte public.versions;
  sent_copy int; sent_arte int;
  copy_ok bool; arte_ok bool; copy_new bool; arte_new bool; copy_adj bool; arte_adj bool;
  want_copy bool; want_arte bool;
  falta text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_parts not in ('copy', 'arte', 'ambos', 'pronto') then raise exception 'Parte inválida'; end if;
  select format into fmt from public.posts where id = p_post for update;
  if not found then raise exception 'not found'; end if;

  select * into last_copy from public.versions where post_id = p_post and stage = 'copy' order by number desc limit 1;
  select * into last_arte from public.versions where post_id = p_post and stage = 'arte' order by number desc limit 1;
  select coalesce(max(number), 0) into sent_copy from public.versions where post_id = p_post and stage = 'copy' and sent;
  select coalesce(max(number), 0) into sent_arte from public.versions where post_id = p_post and stage = 'arte' and sent;

  arte_ok := last_arte.id is not null and coalesce(array_length(last_arte.asset_paths, 1), 0) > 0;
  copy_ok := last_copy.id is not null and btrim(coalesce(last_copy.copy_text, '')) <> ''
             and (fmt = 'stories' or btrim(coalesce(last_copy.caption_text, '')) <> '');
  copy_new := coalesce(last_copy.number, 0) > sent_copy;
  arte_new := coalesce(last_arte.number, 0) > sent_arte;
  copy_adj := last_copy.id is not null and not last_copy.sent and last_copy.review_note is not null;
  arte_adj := last_arte.id is not null and not last_arte.sent and last_arte.review_note is not null;

  if p_parts = 'pronto' then
    want_copy := copy_ok and copy_new and not copy_adj;
    want_arte := arte_ok and arte_new and not arte_adj;
    if not (want_copy or want_arte) then raise exception 'Nada pronto e novo para enviar ao cliente'; end if;
  else
    want_copy := p_parts in ('copy', 'ambos');
    want_arte := p_parts in ('arte', 'ambos');
    if want_arte and not arte_ok then falta := falta || 'arte'; end if;
    if want_copy and (last_copy.id is null or btrim(coalesce(last_copy.copy_text, '')) = '') then falta := falta || 'texto da arte'; end if;
    if want_copy and fmt is distinct from 'stories' and (last_copy.id is null or btrim(coalesce(last_copy.caption_text, '')) = '') then falta := falta || 'legenda'; end if;
    if array_length(falta, 1) > 0 then raise exception 'Para enviar ao cliente falta: %', array_to_string(falta, ', '); end if;
    if (want_copy and copy_adj) or (want_arte and arte_adj) then
      raise exception 'Tem ajuste interno pedido. Espere a nova versão antes de enviar.';
    end if;
    if (want_copy and not copy_new) or (want_arte and not arte_new) then
      raise exception 'Nada novo para enviar em %', case when want_copy and not copy_new then 'copy' else 'arte' end;
    end if;
  end if;

  update public.versions set sent = true, sent_at = now()
  where sent = false and id in (case when want_copy then last_copy.id end, case when want_arte then last_arte.id end);
  return case when want_copy and want_arte then 'ambos' when want_copy then 'copy' else 'arte' end;
end $$;
revoke all on function public.send_post(uuid, text) from public, anon;
grant execute on function public.send_post(uuid, text) to authenticated;
