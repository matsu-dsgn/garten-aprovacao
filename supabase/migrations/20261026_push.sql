-- ⚠ AINDA NÃO APLICADA: web push ficou para depois. Falta também gravar a chave VAPID no Vault (gerar par novo).
-- Notificação do navegador (web push) para os avisos do admin.
-- A chave privada VAPID fica no Vault ('vapid_private'), lida só pelo servidor.
-- Rodado com: select vault.create_secret('<chave privada>', 'vapid_private', 'Web push: chave privada VAPID');

create table if not exists public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_admin_read on public.push_subscriptions;
create policy push_admin_read on public.push_subscriptions for select to authenticated
  using (public.is_admin() and email = public.auth_email());
revoke all on public.push_subscriptions from anon;
revoke insert, update, delete on public.push_subscriptions from authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 40 and 200
     or char_length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'Inscrição inválida';
  end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, email)
  values (p_endpoint, p_p256dh, p_auth, public.auth_email())
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, email = excluded.email;
end $$;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and email = public.auth_email();
end $$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Só o servidor (service_role) lê a chave privada
create or replace function public.vapid_private()
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private'
$$;
revoke all on function public.vapid_private() from public, anon, authenticated;
grant execute on function public.vapid_private() to service_role;

-- Cada aviso novo dispara a função "notificar"
create or replace function public.push_on_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://npqrgkhuwusyuqrqyvqs.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_cron_secret')),
    body := jsonb_build_object('id', new.id), timeout_milliseconds := 30000);
  return new;
end $$;
revoke all on function public.push_on_notification() from public, anon, authenticated;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.push_on_notification();
