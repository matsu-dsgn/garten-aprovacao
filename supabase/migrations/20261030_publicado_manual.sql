-- Marcar/desmarcar "publicado" à mão (post feito direto no app do Instagram, por exemplo).
-- Só admin. As colunas de publicação continuam travadas para update direto (guard_publish_cols);
-- esta função é a única porta manual.
create or replace function public.set_published_manual(p_post uuid, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cur record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select publish_status, ig_media_id into cur from public.posts where id = p_post for update;
  if not found then raise exception 'Post não encontrado'; end if;
  if cur.publish_status = 'publicando' then raise exception 'O post está sendo publicado agora. Tente em instantes.'; end if;

  perform set_config('garten.sys', 'on', true);
  if p_published then
    update public.posts
      set publish_status = 'publicado', published_at = coalesce(published_at, now()), publish_error = null
      where id = p_post;
  else
    -- Publicado pelo sistema (tem id do Instagram) não volta: o post existe de verdade lá.
    if cur.ig_media_id is not null then raise exception 'Este post foi publicado pelo sistema no Instagram e não pode ser desmarcado.'; end if;
    update public.posts
      set publish_status = case when scheduled then 'agendado' else null end, published_at = null
      where id = p_post;
  end if;
end $$;
revoke all on function public.set_published_manual(uuid, boolean) from public, anon;
grant execute on function public.set_published_manual(uuid, boolean) to authenticated;
