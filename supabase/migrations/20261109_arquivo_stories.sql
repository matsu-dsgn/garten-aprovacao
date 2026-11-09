-- Arquivo próprio da imagem de cada publicação (principalmente Stories, que somem da Meta em 24h).
-- O caminho aponta para o bucket privado "artes" (_arquivo/<id>.jpg). Só o servidor escreve.
alter table public.ig_media add column if not exists archive_path text;
alter table public.ig_media add column if not exists metrics_final boolean not null default false; -- Stories: última leitura antes de expirar
