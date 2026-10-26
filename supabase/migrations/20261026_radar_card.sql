-- "Faz sentido" do cliente no radar vira card (oportunidade com origem radar)
alter table public.posts drop constraint posts_origin_check;
alter table public.posts add constraint posts_origin_check check (origin = any (array['agencia','cliente','radar']));
alter table public.posts
  add column radar_alert_id uuid unique references public.radar_alerts(id) on delete set null,
  add column validated_by text,
  add column validated_at timestamptz,
  add column validation_withdrawn boolean not null default false;
