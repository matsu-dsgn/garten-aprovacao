-- Revisão interna e envio ao cliente por post.
-- 1) Admin pode pedir ajuste interno num rascunho (review_note); a equipe vê e reenvia.
-- 2) O cliente só recebe o post completo: arte sempre; texto e legenda também, menos no Stories.
--    Envio pelo send_post (copy e arte juntas). O send_version por versão deixa de ser usado.

alter table public.versions
  add column if not exists review_note text check (review_note is null or char_length(review_note) <= 1500),
  add column if not exists review_at timestamptz;

-- Pedir ajuste interno num rascunho
create or replace function public.request_internal_adjust(p_version uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Escreva o que precisa ajustar'; end if;
  update public.versions set review_note = left(btrim(p_note), 1500), review_at = now()
  where id = p_version and sent = false;
  if not found then raise exception 'Só dá para pedir ajuste em versão que ainda não foi ao cliente'; end if;
end $$;
revoke all on function public.request_internal_adjust(uuid, text) from public, anon;
grant execute on function public.request_internal_adjust(uuid, text) to authenticated;

-- Equipe não pode apagar o pedido de ajuste ao criar versão
create or replace function public.guard_review_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then new.review_note := null; new.review_at := null; end if;
  return new;
end $$;
drop trigger if exists versions_guard_review on public.versions;
create trigger versions_guard_review before insert on public.versions
  for each row execute function public.guard_review_cols();
revoke all on function public.guard_review_cols() from public, anon, authenticated;

-- Envia ao cliente o que está pronto no post (copy e arte juntas), se estiver completo
create or replace function public.send_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  fmt text;
  last_copy public.versions; last_arte public.versions;
  sent_copy int; sent_arte int;
  falta text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select format into fmt from public.posts where id = p_post for update;
  if not found then raise exception 'not found'; end if;

  select * into last_copy from public.versions where post_id = p_post and stage = 'copy' order by number desc limit 1;
  select * into last_arte from public.versions where post_id = p_post and stage = 'arte' order by number desc limit 1;
  select coalesce(max(number), 0) into sent_copy from public.versions where post_id = p_post and stage = 'copy' and sent;
  select coalesce(max(number), 0) into sent_arte from public.versions where post_id = p_post and stage = 'arte' and sent;

  if last_arte.id is null or coalesce(array_length(last_arte.asset_paths, 1), 0) = 0 then falta := falta || 'arte'; end if;
  if fmt is distinct from 'stories' then
    if last_copy.id is null or btrim(coalesce(last_copy.copy_text, '')) = '' then falta := falta || 'texto da arte'; end if;
    if last_copy.id is null or btrim(coalesce(last_copy.caption_text, '')) = '' then falta := falta || 'legenda'; end if;
  end if;
  if array_length(falta, 1) > 0 then
    raise exception 'Para enviar ao cliente falta: %', array_to_string(falta, ', ');
  end if;

  if (last_copy.id is not null and not last_copy.sent and last_copy.review_note is not null)
     or (not last_arte.sent and last_arte.review_note is not null) then
    raise exception 'Tem ajuste interno pedido. Espere a nova versão antes de enviar.';
  end if;
  if coalesce(last_copy.number, 0) <= sent_copy and last_arte.number <= sent_arte then
    raise exception 'Nada novo para enviar ao cliente';
  end if;

  update public.versions set sent = true, sent_at = now()
  where id in (last_copy.id, last_arte.id) and sent = false;
end $$;
revoke all on function public.send_post(uuid) from public, anon;
grant execute on function public.send_post(uuid) to authenticated;

-- Envio por versão avulsa sai de uso (pulava a regra de post completo)
revoke execute on function public.send_version(uuid) from authenticated;
