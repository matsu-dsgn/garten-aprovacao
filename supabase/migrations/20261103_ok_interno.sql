-- OK interno: copy aprovada pelo Rapha libera a arte para o DA, sem ir ao cliente ainda.
alter table public.versions add column if not exists internal_ok boolean not null default false;

-- Versão criada pelo admin já nasce com OK interno; da equipe nasce sem (o servidor decide, não o front)
create or replace function public.guard_review_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if public.is_admin() then new.internal_ok := true; return new; end if;
  if tg_op = 'INSERT' then new.review_note := null; new.review_at := null; new.internal_ok := false; end if;
  return new;
end $$;
revoke all on function public.guard_review_cols() from public, anon, authenticated;

create or replace function public.approve_internal(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.versions set internal_ok = true, review_note = null, review_at = null
  where id = p_version and sent = false;
  if not found then raise exception 'Só dá para aprovar internamente versão que ainda não foi ao cliente'; end if;
end $$;
revoke all on function public.approve_internal(uuid) from public, anon;
grant execute on function public.approve_internal(uuid) to authenticated;

-- Rascunhos do admin que já existem ganham o OK interno
update public.versions set internal_ok = true
where sent = false and author_email = 'raphael.takamatsu@gmail.com';
