-- OK interno na copy: o card vai direto para quem faz arte (funcao = 'arte'), se ainda não tiver dono.
create or replace function public.approve_internal(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_post uuid; v_stage text; v_da text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.versions set internal_ok = true, review_note = null, review_at = null
  where id = p_version and sent = false
  returning post_id, stage into v_post, v_stage;
  if not found then raise exception 'Só dá para aprovar internamente versão que ainda não foi ao cliente'; end if;
  if v_stage = 'copy' then
    select email into v_da from public.team_members where funcao = 'arte' and role = 'equipe' order by created_at limit 1;
    if v_da is not null then
      update public.posts set assignee = v_da where id = v_post and assignee is null;
    end if;
  end if;
end $$;
revoke all on function public.approve_internal(uuid) from public, anon;
grant execute on function public.approve_internal(uuid) to authenticated;

-- Posts que já tinham copy com OK interno e estavam sem dono
update public.posts p set assignee = (select email from public.team_members where funcao = 'arte' and role = 'equipe' order by created_at limit 1)
where p.assignee is null
  and exists (select 1 from public.versions v where v.post_id = p.id and v.stage = 'copy' and v.internal_ok and not v.sent)
  and not exists (select 1 from public.versions v where v.post_id = p.id and v.stage = 'arte');
