-- 1) Cliente aprova o post inteiro (arte + legenda) numa etapa só.
-- 2) Admin pode tirar um post da aprovação e devolver para a produção.

-- ---------- Envio do post completo ----------
-- Modo novo 'post': manda arte e texto/legenda juntos. Se só a legenda mudou, a arte atual
-- é reenviada como nova versão (mesmas imagens) para o cliente decidir de novo.
create or replace function public.send_post(p_post uuid, p_parts text default 'post')
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

  select * into last_copy from public.versions where post_id = p_post and stage = 'copy' order by number desc limit 1;
  select * into last_arte from public.versions where post_id = p_post and stage = 'arte' order by number desc limit 1;
  select coalesce(max(number), 0) into sent_copy from public.versions where post_id = p_post and stage = 'copy' and sent;
  select coalesce(max(number), 0) into sent_arte from public.versions where post_id = p_post and stage = 'arte' and sent;

  if last_arte.id is null or coalesce(array_length(last_arte.asset_paths, 1), 0) = 0 then falta := falta || 'arte'; end if;
  if last_copy.id is null or btrim(coalesce(last_copy.copy_text, '')) = '' then falta := falta || 'texto da arte'; end if;
  if fmt is distinct from 'stories' and (last_copy.id is null or btrim(coalesce(last_copy.caption_text, '')) = '') then falta := falta || 'legenda'; end if;
  if array_length(falta, 1) > 0 then raise exception 'Para enviar ao cliente falta: %', array_to_string(falta, ', '); end if;
  if (not last_copy.sent and last_copy.review_note is not null) or (not last_arte.sent and last_arte.review_note is not null) then
    raise exception 'Tem ajuste interno pedido. Espere a nova versão antes de enviar.';
  end if;

  copy_new := last_copy.number > sent_copy;
  arte_new := last_arte.number > sent_arte;
  if not (copy_new or arte_new) then raise exception 'Nada novo para enviar ao cliente'; end if;

  update public.versions set sent = true, sent_at = now()
  where sent = false and id in (case when copy_new then last_copy.id end, case when arte_new then last_arte.id end);

  -- Só a legenda mudou: a arte vai de novo como nova versão, para valer uma nova decisão
  if not arte_new then
    insert into public.versions (post_id, stage, number, asset_paths, sent, sent_at, author_email, internal_ok)
    values (p_post, 'arte', last_arte.number + 1, last_arte.asset_paths, true, now(), last_arte.author_email, true);
  end if;
  return 'post';
end $$;
drop function if exists public.send_post(uuid);
revoke all on function public.send_post(uuid, text) from public, anon;
grant execute on function public.send_post(uuid, text) to authenticated;

-- ---------- A decisão do cliente no post vale também para o texto/legenda ----------
-- Nome começa com "a_" para rodar antes do auto-agendamento (triggers AFTER rodam em ordem alfabética).
create or replace function public.mirror_post_decision()
returns trigger language plpgsql security definer set search_path = public as $$
declare cv uuid;
begin
  if new.stage <> 'arte' then return new; end if;
  select id into cv from public.versions
  where post_id = new.post_id and stage = 'copy' and sent order by number desc limit 1;
  if cv is null then return new; end if;
  insert into public.decisions (post_id, stage, version_id, actor, status, note)
  values (new.post_id, 'copy', cv, new.actor, new.status, new.note);
  return new;
end $$;
revoke all on function public.mirror_post_decision() from public, anon, authenticated;
drop trigger if exists decisions_a_mirror_copy on public.decisions;
create trigger decisions_a_mirror_copy after insert on public.decisions
  for each row execute function public.mirror_post_decision();

-- ---------- Tirar da aprovação ----------
-- Volta para rascunho as versões enviadas que o cliente ainda não respondeu.
-- Com motivo: o card vai para Ajuste (o time vê o motivo). Sem motivo: volta para Revisão interna.
create or replace function public.recall_post(p_post uuid, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int; st text; note text := nullif(left(btrim(coalesce(p_note, '')), 1500), '');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select publish_status into st from public.posts where id = p_post for update;
  if not found then raise exception 'not found'; end if;
  if st in ('agendado', 'publicando', 'publicado') then
    raise exception 'Post agendado ou publicado. Desagende antes de tirar da aprovação.';
  end if;
  update public.versions v set sent = false, sent_at = null, internal_ok = true,
    review_note = case when v.stage = 'arte' or not exists (select 1 from public.versions a where a.post_id = p_post and a.stage = 'arte' and a.sent) then note end,
    review_at = case when note is not null then now() end
  where v.post_id = p_post and v.sent
    and v.number = (select max(number) from public.versions x where x.post_id = p_post and x.stage = v.stage and x.sent)
    and not exists (select 1 from public.decisions d where d.version_id = v.id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nada com o cliente aguardando resposta para tirar da aprovação'; end if;
  return n;
end $$;
revoke all on function public.recall_post(uuid, text) from public, anon;
grant execute on function public.recall_post(uuid, text) to authenticated;
