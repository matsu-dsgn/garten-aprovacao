-- Status do post ajustado à mão pela agência (dropdown no painel e no calendário).
-- Vira uma decisão com actor 'agencia' na etapa mais avançada, então fica no histórico.
alter table public.decisions drop constraint if exists decisions_status_check;
alter table public.decisions add constraint decisions_status_check
  check (status in ('aprovado', 'reprovado', 'contestado', 'pendente'));

create or replace function public.set_post_status(p_post uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare cur record; st text; ver uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pendente', 'aprovado', 'reprovado', 'contestado', 'publicado') then raise exception 'Status inválido'; end if;
  select publish_status, ig_media_id, scheduled into cur from public.posts where id = p_post for update;
  if not found then raise exception 'Post não encontrado'; end if;
  if cur.publish_status = 'publicando' then raise exception 'O post está sendo publicado agora. Tente em instantes.'; end if;

  perform set_config('garten.sys', 'on', true);
  if p_status = 'publicado' then
    update public.posts set publish_status = 'publicado', published_at = coalesce(published_at, now()), publish_error = null where id = p_post;
    return;
  end if;

  if cur.publish_status = 'publicado' then
    if cur.ig_media_id is not null then raise exception 'Este post foi publicado pelo sistema no Instagram e não pode sair de publicado.'; end if;
    update public.posts set publish_status = case when cur.scheduled then 'agendado' else null end, published_at = null where id = p_post;
  end if;

  -- Etapa mais avançada com versão enviada ao cliente; senão, a pauta
  select v.stage, v.id into st, ver from public.versions v
    where v.post_id = p_post and v.sent and v.stage in ('arte', 'copy')
    order by case v.stage when 'arte' then 0 else 1 end, v.number desc limit 1;
  if st is null then st := 'pauta'; ver := null; end if;

  insert into public.decisions (post_id, stage, version_id, actor, status, note, slide_notes)
    values (p_post, st, ver, 'agencia', p_status, 'Status ajustado pela agência', '{}'::jsonb);
end $$;
revoke all on function public.set_post_status(uuid, text) from public, anon;
grant execute on function public.set_post_status(uuid, text) to authenticated;
