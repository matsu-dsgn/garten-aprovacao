-- Limites de tamanho nos campos que o admin edita (aplicada)
alter table public.reports drop constraint if exists reports_texts_size;
alter table public.reports add constraint reports_texts_size check (jsonb_typeof(texts) = 'object' and octet_length(texts::text) <= 20000);
alter table public.reports drop constraint if exists reports_hidden_size;
alter table public.reports add constraint reports_hidden_size check (cardinality(hidden) <= 40);
