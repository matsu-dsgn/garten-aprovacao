-- Cada aviso novo vira e-mail (função notificar, via Resend). Sem as chaves configuradas, a função só ignora.
create or replace function public.email_on_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://npqrgkhuwusyuqrqyvqs.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_cron_secret')),
    body := jsonb_build_object('id', new.id), timeout_milliseconds := 30000);
  return new;
end $$;
revoke all on function public.email_on_notification() from public, anon, authenticated;
drop trigger if exists notifications_email on public.notifications;
create trigger notifications_email after insert on public.notifications
  for each row execute function public.email_on_notification();
