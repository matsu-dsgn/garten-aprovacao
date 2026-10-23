-- Ativa o agendador da publicação (modo simulado enquanto não houver token da Meta).
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo sem duplicar nada.

create extension if not exists pg_cron;

-- 1) Gera o segredo e guarda no Vault (só na primeira vez)
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
       'publicar_cron_secret', 'Segredo do cron da função publicar')
where not exists (select 1 from vault.secrets where name = 'publicar_cron_secret');

-- 2) Agenda a chamada a cada 5 minutos
select cron.unschedule('publicar-instagram')
where exists (select 1 from cron.job where jobname = 'publicar-instagram');

select cron.schedule('publicar-instagram', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://npqrgkhuwusyuqrqyvqs.supabase.co/functions/v1/publicar',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publicar_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$cron$);

-- 3) Mostra o segredo para você copiar em Edge Functions → Secrets como CRON_SECRET.
--    Não cole em chat, e-mail ou repositório.
select decrypted_secret as copiar_para_CRON_SECRET
from vault.decrypted_secrets where name = 'publicar_cron_secret';
