-- Radar legislativo: alertas da varredura diária (Receita, CGSN, PGFN, eSocial, SEFAZ-SP).
-- Só admin lê; o admin só altera o status. A escrita vem da tarefa agendada (fora do front).
create table public.radar_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  itens int not null default 0 check (itens >= 0),
  ok boolean not null default true,
  notas text check (char_length(notas) <= 2000)
);
create table public.radar_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid references public.radar_runs(id) on delete set null,
  data_publicacao date,
  esfera text not null check (esfera in ('federal','sp')),
  orgao text not null check (char_length(orgao) <= 120),
  ato text check (char_length(ato) <= 200),
  titulo text not null check (char_length(titulo) <= 300),
  resumo text not null check (char_length(resumo) <= 2000),
  vigencia text check (char_length(vigencia) <= 300),
  publico text check (char_length(publico) <= 500),
  relevancia text not null default 'media' check (relevancia in ('alta','media','baixa')),
  tipo text not null default 'novidade' check (tipo in ('novidade','atualizacao')),
  post_relacionado uuid references public.posts(id) on delete set null,
  angulo_pauta text check (char_length(angulo_pauta) <= 1000),
  url text not null check (url ~ '^https://' and char_length(url) <= 1000),
  status text not null default 'novo' check (status in ('novo','lido','virou_pauta','descartado')),
  unique (url)
);
create index radar_alerts_created_idx on public.radar_alerts (created_at desc);
alter table public.radar_runs enable row level security;
alter table public.radar_alerts enable row level security;
create policy radar_runs_admin on public.radar_runs for select to authenticated using (public.is_admin());
create policy radar_alerts_admin_read on public.radar_alerts for select to authenticated using (public.is_admin());
create policy radar_alerts_admin_update on public.radar_alerts for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.radar_runs, public.radar_alerts from anon;
revoke insert, update, delete on public.radar_runs from authenticated;
revoke insert, update, delete on public.radar_alerts from authenticated;
grant update (status) on public.radar_alerts to authenticated;

-- Motivo do descarte (calibra o filtro da tarefa diária)
alter table public.radar_alerts add column descarte_motivo text check (descarte_motivo in ('irrelevante','repetido','muito_tecnico','fora_do_publico','resumo_errado'));
revoke update on public.radar_alerts from authenticated;
grant update (status, descarte_motivo) on public.radar_alerts to authenticated;
