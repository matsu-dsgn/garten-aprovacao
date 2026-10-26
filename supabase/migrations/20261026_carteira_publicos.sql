-- MEI e pessoa física entram na carteira como públicos (não setores)
alter table public.carteira_perfil add column tipo text not null default 'setor' check (tipo in ('setor','publico'));
insert into public.carteira_perfil (setor, tipo, descricao, regimes, temas_sensiveis) values
  ('mei', 'publico', 'Microempreendedores individuais', '{mei}', 'Teto de faturamento e desenquadramento; DAS-MEI e DASN-Simei; empregados; nanoempreendedor e IBS/CBS'),
  ('pessoa_fisica', 'publico', 'Pessoas físicas: sócios e titulares dos clientes PJ', '{irpf}', 'IRPF e prazos da declaração; Carnê-Leão; ganho de capital; tributação de lucros e dividendos; IRPF mínimo');
