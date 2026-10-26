-- Perfil agregado da carteira da Garten, usado pelo radar para medir impacto.
-- Só dados agregados: nada de nome ou CNPJ de cliente.
create table public.carteira_perfil (
  id uuid primary key default gen_random_uuid(),
  setor text not null unique,
  descricao text,
  regimes text[] not null default '{simples,presumido}',
  peso smallint not null default 3 check (peso between 1 and 5),
  qtd_clientes integer check (qtd_clientes >= 0),
  temas_sensiveis text,
  atualizado_em timestamptz not null default now()
);
alter table public.carteira_perfil enable row level security;
create policy carteira_perfil_admin on public.carteira_perfil for select to authenticated using (public.is_admin());
revoke all on public.carteira_perfil from anon;
revoke insert, update, delete on public.carteira_perfil from authenticated;

insert into public.carteira_perfil (setor, descricao, temas_sensiveis) values
  ('tecnologia', 'Desenvolvimento de software, TI e consultoria em tecnologia', 'Fator R e enquadramento entre anexos do Simples; IBS/CBS sobre serviços; NFS-e'),
  ('gestao', 'Consultoria e gerenciamento empresarial', 'Fator R; Lucro Presumido em serviços; IBS/CBS sobre serviços'),
  ('marketing', 'Agências e consultoria de marketing e publicidade', 'Enquadramento entre anexos do Simples; IBS/CBS sobre serviços; NFS-e'),
  ('engenharia', 'Engenharia, projetos e serviços técnicos', 'Fator R; retenções na fonte; IBS/CBS sobre serviços'),
  ('educacao', 'Cursos, treinamentos e serviços educacionais', 'Regras específicas de IBS/CBS para educação; enquadramento no Simples'),
  ('saude', 'Clínicas e profissionais de saúde PJ', 'Fator R; regras específicas de IBS/CBS para saúde; equiparação hospitalar no Presumido');

-- Impacto estimado na carteira, preenchido pelo radar
alter table public.radar_alerts
  add column setores_afetados text[],
  add column impacto_carteira text;
