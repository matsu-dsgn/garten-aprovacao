-- Opções de arte: Stéphano às vezes sobe variações de uma arte estática para o Rapha escolher.
-- Isso não é um carrossel (lâminas em sequência) e não pode ser tratado como um pelo sistema.
-- Marca a versão como "opções" e dá ao admin uma função para reduzir a 1 escolhida antes de aprovar/enviar.

alter table public.versions add column if not exists is_options boolean not null default false;

-- Opções só fazem sentido em arte (copy não tem "opções" hoje) e nunca depois de enviado ao cliente
alter table public.versions drop constraint if exists versions_is_options_regras;
alter table public.versions add constraint versions_is_options_regras
  check (not is_options or (stage = 'arte' and not sent));

comment on column public.versions.is_options is
  'true = asset_paths são opções alternativas de uma arte estática (o Rapha escolhe uma), não lâminas de carrossel. Resolvida (reduzida a 1 path) antes de aprovar internamente ou enviar ao cliente.';

-- Admin escolhe uma opção: a versão fica só com aquele path e deixa de ser "opções".
-- As demais imagens continuam no Storage (ficam órfãs); a limpeza é feita pelo front, que tem a lista completa.
create or replace function public.reduce_arte_options(p_version uuid, p_keep_path text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_paths text[];
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select asset_paths into v_paths from public.versions
    where id = p_version and stage = 'arte' and is_options = true and sent = false;
  if v_paths is null then
    raise exception 'Versão não encontrada, já enviada, ou não é um rascunho de opções de arte.';
  end if;
  if not (p_keep_path = any(v_paths)) then
    raise exception 'Essa opção não pertence a esta versão.';
  end if;
  update public.versions set asset_paths = array[p_keep_path], is_options = false where id = p_version;
end $$;
revoke all on function public.reduce_arte_options(uuid, text) from public, anon;
grant execute on function public.reduce_arte_options(uuid, text) to authenticated;
