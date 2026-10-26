-- Função de cada pessoa da equipe no Kanban: 'arte' (sobe só arte), 'copy' (sobe só texto/legenda)
-- ou null (as duas). Admin continua podendo tudo. A regra vale no banco, não só na tela.

alter table public.team_members
  add column if not exists funcao text check (funcao in ('arte', 'copy'));

create or replace function public.my_funcao()
returns text language sql stable security definer set search_path = public as $$
  select funcao from public.team_members where email = public.auth_email()
$$;
revoke all on function public.my_funcao() from public, anon;
grant execute on function public.my_funcao() to authenticated;

-- Equipe só cria versão da etapa da própria função
drop policy if exists versions_team_insert on public.versions;
create policy versions_team_insert on public.versions for insert to authenticated
  with check (
    public.is_team() and sent = false and author_email = public.auth_email()
    and (public.my_funcao() is null or public.my_funcao() = stage)
  );

-- Quem é só de copy não sobe arquivo
drop policy if exists artes_team_insert on storage.objects;
create policy artes_team_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'artes' and public.is_team() and public.my_funcao() is distinct from 'copy');
