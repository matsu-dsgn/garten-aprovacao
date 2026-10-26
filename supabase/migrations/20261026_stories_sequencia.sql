-- Stories em sequência: um card com até 10 telas, publicadas em ordem.
-- stories_done guarda quantas telas já saíram, para retomar sem duplicar depois de um erro.
-- stories_version guarda de qual versão da arte elas saíram.

alter table public.posts
  add column if not exists stories_done int not null default 0,
  add column if not exists stories_version uuid;

-- Mesma trava das outras colunas de publicação: só o sistema altera
create or replace function public.guard_publish_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('garten.sys', true), '') = 'on' or auth.role() = 'service_role' then
    return new;
  end if;
  if (new.publish_status, new.publish_error, new.published_at, new.ig_media_id, new.ig_permalink,
      new.publish_attempts, new.stories_done, new.stories_version)
     is distinct from
     (old.publish_status, old.publish_error, old.published_at, old.ig_media_id, old.ig_permalink,
      old.publish_attempts, old.stories_done, old.stories_version) then
    raise exception 'Status de publicação só muda pelo sistema';
  end if;
  if old.publish_status in ('publicando', 'publicado')
     and (new.scheduled, new.scheduled_at) is distinct from (old.scheduled, old.scheduled_at) then
    raise exception 'Post já publicado ou em publicação';
  end if;
  return new;
end $$;
revoke all on function public.guard_publish_cols() from public, anon, authenticated;
