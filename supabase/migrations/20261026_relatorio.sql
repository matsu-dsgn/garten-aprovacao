-- Relatório mensal: números congelados no fechamento + textos do admin.
-- O cliente só vê depois de publicado, pela função "cliente" (link do mês). Admin edita pelo painel.

create table if not exists public.reports (
  slug text primary key check (slug ~ '^\d{4}-\d{2}$'),   -- mês do relatório (AAAA-MM)
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado')),
  data jsonb not null default '{}',        -- números congelados (servidor)
  texts jsonb not null default '{}',       -- análise, aprendizados, próximos passos (admin)
  hidden text[] not null default '{}',     -- slides escondidos à mão
  closed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists reports_admin on public.reports;
create policy reports_admin on public.reports for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.reports from anon;

-- Números só o servidor grava; o admin mexe em textos, slides escondidos e status
create or replace function public.guard_report_data()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then new.data := '{}'; new.closed_at := null; return new; end if;
  if new.data is distinct from old.data or new.closed_at is distinct from old.closed_at then
    raise exception 'Os números do relatório só mudam pelo fechamento';
  end if;
  if new.status = 'publicado' and old.status <> 'publicado' then
    if old.closed_at is null then raise exception 'Feche o mês antes de publicar'; end if;
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_report_data() from public, anon, authenticated;
drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before insert or update on public.reports
  for each row execute function public.guard_report_data();
