-- Referências do post (links e imagens), visíveis ao cliente na pauta e à equipe no Kanban.
-- Item: {"t":"link","url":"https://...","label":"..."} ou {"t":"img","path":"<mes>/<post>/refs/<arquivo>"}
create or replace function public.valid_refs(r jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(r) = 'array' and jsonb_array_length(r) <= 12 and coalesce(bool_and(
    case e->>'t'
      when 'link' then (e->>'url') ~ '^https?://[^\s<>"]+$' and char_length(e->>'url') <= 500
                       and char_length(coalesce(e->>'label', '')) <= 80
      when 'img' then (e->>'path') ~ '^[a-z0-9-]+/[0-9a-f-]{36}/refs/[A-Za-z0-9._-]+\.(png|jpg|webp)$'
      else false end), true)
  from jsonb_array_elements(case when jsonb_typeof(r) = 'array' then r else '[]'::jsonb end) e
$$;

alter table public.posts add column if not exists refs jsonb not null default '[]'::jsonb;
alter table public.posts drop constraint if exists posts_refs_check;
alter table public.posts add constraint posts_refs_check check (public.valid_refs(refs));
