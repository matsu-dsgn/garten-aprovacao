# Garten — Sistema de Pauta, Aprovação e Publicação

> Documento técnico e funcional do sistema `garten-aprovacao`.
> Base: código do repositório `matsu-dsgn/garten-aprovacao` em 29/10/2026.

---

## 1. Visão geral

Sistema web que substitui a aprovação por WhatsApp do conteúdo da Garten. Cobre o ciclo completo do post:

**Planejamento → Pauta → Produção (Kanban) → Revisão interna → Aprovação do cliente → Agendamento → Publicação automática no Instagram/Facebook → Métricas → Relatório mensal.**

Inclui ainda um **Radar legislativo** (Receita Federal / SP) que vira post de oportunidade.

### Quem usa

| Perfil | Pessoas | Acesso | Como entra |
|---|---|---|---|
| Admin | Rapha | Tudo: Painel, Kanban, Radar, Publicações, Relatório, "ver como cliente" | Login Google |
| Equipe — arte | Stéphano (DA) | Kanban; só sobe arte | Login Google |
| Equipe — copy | Alexandra (Analista Social) | Kanban; só sobe copy/legenda | Login Google |
| Cliente | Wilker, Letícia | Página do mês + Radar do cliente | Link com token, sem login (escolhe o nome) |

E-mail fora da lista "Equipe" não vê nada (bloqueio no banco via RLS; a página 404 "perdido" é só a fachada).

---

## 2. Arquitetura e tecnologia

| Camada | Tecnologia |
|---|---|
| Front | HTML + CSS + JavaScript puro (sem framework, sem build) |
| Hospedagem do front | GitHub Pages (repo público) |
| Banco | Supabase Postgres, com RLS em todas as tabelas |
| Regras de negócio | Funções SQL `security definer` (RPC) + triggers |
| Autenticação | Supabase Auth com provedor Google (OAuth) |
| Acesso do cliente | Token por mês (48 hex), guardado só como hash SHA-256 |
| Arquivos | Supabase Storage, bucket `artes` |
| Backend serverless | Supabase Edge Functions (Deno / TypeScript) |
| Agendador | `pg_cron` + `pg_net` (cron a cada 5 min) |
| Segredos | Supabase Vault + Secrets das Edge Functions |
| Publicação e métricas | Meta Graph API v23 (Instagram profissional + Página do Facebook), System User token |
| E-mail | Resend |
| Notificação no navegador | Notification API (Mac) + infraestrutura de Web Push (VAPID) preparada |
| Tipografia | PP Fragment (Sans Regular, Sans ExtraBold, Glare Regular), servida localmente |
| Lib cliente | `supabase-js` 2.45.4 hospedada em `vendor/` (sem CDN) |

### Diagrama simplificado

```
GitHub Pages (HTML/JS)
   │  chave publishable (pública por design)
   ├─────────────► Supabase Auth (Google) ──► RLS + RPC (equipe/admin)
   └─────────────► Edge Function "cliente" (token do mês) ──► banco (service role)

pg_cron (5 min) ──► Edge Function "publicar" ──► Meta Graph API
pg_cron (1 h)   ──► Edge Function "metricas" ──► Meta Graph API ──► ig_media / snapshots
trigger notifications ──► Edge Function "notificar" ──► Resend (e-mail)
Admin ──► Edge Function "relatorio" ──► congela números do mês
```

---

## 3. Páginas (front)

| Arquivo | Para quem | O que faz |
|---|---|---|
| `index.html` + `app.js` | Cliente | Página do mês: aprova/reprova pauta, copy+legenda e arte |
| `admin.html` + `admin.js` | Admin | Painel: meses, importação de pauta, links, equipe, oportunidades, avisos |
| `kanban.html` + `kanban.js` + `work.js` | Admin + equipe | Kanban de produção e card estilo Wrike |
| `radar.html` + `radar.js` | Admin | Dashboard do Radar legislativo |
| `radar-cliente.html` + `radar-cliente.js` | Cliente | Radar visto e avaliado pelo Wilker/Letícia |
| `publicacoes.html` + `publicacoes.js` | Admin | Agendados, publicados e métricas |
| `relatorio.html` + `relatorio.js` | Admin | Edição e fechamento do relatório mensal |
| `relatorio-cliente.html` + `relatorio-cliente.js` + `deck.js/css` | Cliente | Relatório em formato deck tela cheia |
| `entrar.html` | Equipe | Login Google |
| `privacidade.html` | Público | Política de privacidade (exigência da Meta) |
| `404.html` + `perdido.js` | — | Página "perdido" (404 e sem acesso) |
| `common.js`, `auth.js`, `theme.js`, `iso.js` | — | Regras de status, login/navegação, tema claro/escuro, ilustração isométrica |

---

## 4. Features

### 4.1 Mês e pauta
- **Novo mês** com slug `AAAA-MM`, título, introdução e pilares.
- **Importar pauta via JSON** (data, formato, editoria, tema, título, objetivo, direção, checklist).
- Formatos: `estatico`, `carrossel`, `reels`, `stories`.
- **Editorias fixas:** Prazo certo, Imposto em mapa, Próximo passo, Do zero ao CNPJ, Com o Gabriel.
- **Editoria sazonal** `13-e-fim-de-ano`: só aparece no mês com % no mix ou algum post.
- **Mix ideal × planejado** em % por editoria, com o motivo, em "Dados do mês".
- **Exportar JSON** do mês para backup.

### 4.2 Link do cliente
- **Gerar novo link** (token mostrado uma única vez; no banco fica só o hash).
- **Revogar link** a qualquer momento.
- "Copiar link do post" abre a página direto no card.

### 4.3 Regras de aprovação (garantidas no servidor)
- Wilker e Letícia têm o **mesmo peso**: qualquer um aprova ou pede ajuste; vale a última resposta.
- **Reprovação exige motivo.**
- **Copy e legenda são aprovadas juntas** em uma etapa (Stories não tem legenda).
- Cada nova copy/arte é **nova versão**; histórico nunca é apagado.
- **Travas:** pauta trava quando a arte sobe; tudo trava quando o post é agendado.
- Post só vai ao cliente com **legenda e arte prontas** (conforme o formato).

### 4.4 Kanban de produção
- Colunas calculadas pelo status real: Aguardando pauta → Copy a fazer → Arte a fazer → Em produção → Revisão interna → Com o cliente → Ajuste → Aprovado → Agendado.
- **Card estilo Wrike:** cabeçalho com info priorizada para o DA, copy e legenda à esquerda, carrossel de lâminas à direita, comentários embaixo.
- **Função por pessoa:** Stéphano só sobe arte, Alexandra só sobe copy (`my_funcao()` + RLS).
- **Pegar/soltar card** (`claim_post`), com avatar do Google.
- Tudo que a equipe sobe nasce **rascunho**; o cliente só vê depois que o admin clica **"Enviar ao cliente"** (`send_post`).
- Admin pode **pedir ajuste interno** em uma versão (`request_internal_adjust`).
- **Comentários internos** por post (o cliente nunca vê).
- Upload: PNG, JPG e MP4. Tipo checado pelos **bytes do arquivo** (não só pela extensão); WEBP é recusado porque o Instagram não publica.

### 4.5 Posts de oportunidade
- Criados em "⚡ Nova oportunidade": pulam a pauta, o cliente aprova o post pronto.
- Origem: `agencia`, `cliente` ou `radar`.
- Pedido do cliente tem **prazo de resposta com contagem regressiva**.
- Não entram no cálculo ideal × planejado.

### 4.6 Agendamento e publicação automática
- **Auto-agendamento** quando o cliente dá o OK final, usando a data do card e um horário sugerido pelo sistema (`auto_schedule_on_approval`).
- Agendamento manual/cancelamento pelo admin (`schedule_post`).
- Trigger bloqueia agendar post sem **arte aprovada** ou sem data/hora.
- Cron a cada 5 min chama `publicar`, que pega os posts vencidos (`claim_due_posts`) e publica via Graph API (feed, carrossel, Reels, Stories e sequência de Stories).
- Resultado gravado em `finish_publish` (ID da mídia, permalink ou erro).
- **Modo simulação** (`PUBLISH_DRY_RUN`) ligado automaticamente se faltar token.
- Facebook já suportado; Instagram segue como rede principal.

### 4.7 Avisos ao admin
- Tabela `notifications`: agendado, data passou, sem horário livre, erro de publicação.
- **Sino no painel** + **notificação nativa do navegador** no Mac.
- **E-mail via Resend** para receber no celular (`notificar`).
- Web Push com VAPID: estrutura pronta no banco (inscrições + chave no Vault), uso adiado.

### 4.8 Publicações e métricas
- Dashboard só do admin: agendados, publicados e métricas, **inclusive posts feitos direto no app do Instagram**.
- Cron de hora em hora (`metricas`): sincroniza mídias, alcance, visualizações, salvamentos, compartilhamentos, curtidas, comentários; Stories capturados nas primeiras 24 h.
- Snapshots diários de seguidores e da conta (`follower_snapshots`, `account_daily`).
- "Carteira": perfil de públicos da conta.
- Admin pode atribuir editoria a uma mídia publicada fora do sistema (`set_media_editoria`).
- Resumo rápido na home do painel.

### 4.9 Relatório mensal para o cliente
- Deck tela cheia: capa, visão do mês nas redes, detalhe Instagram e Facebook, top 3 posts, aprendizados.
- `relatorio` **fecha o mês**: congela números do mês e do anterior, top 3 por rede (score = compartilhamentos + salvamentos), leitura por formato e editoria e um rascunho de aprendizados.
- Textos já editados pelo admin não são sobrescritos ao recalcular.

### 4.10 Radar legislativo
- Atualização diária (dias úteis, 8h40), escopo federal + estado de SP.
- Alertas em `radar_alerts`, execuções em `radar_runs`.
- Wilker e Letícia veem tudo que o radar traz, sem pré-filtro, e avaliam (feedback) junto com o Rapha.
- Alerta pode virar post de oportunidade (`origin = radar`, ligado por `radar_alert_id`).

---

## 5. Banco de dados (principais tabelas)

| Tabela | Função |
|---|---|
| `months` | Mês, textos, mix ideal, hash do token |
| `posts` | Pauta/post: data, formato, editoria, origem, status, agendamento, publicação |
| `versions` | Versões de copy, legenda e arte (`sent` = já foi ao cliente) |
| `decisions` | Aprovações/ajustes do cliente por etapa e versão |
| `team_members` | E-mail, papel (`admin`/`equipe`) e função (`arte`/`copy`) |
| `notifications` | Avisos ao admin |
| `pub_settings` | Configuração de horários de publicação |
| `ig_media`, `ig_sync_runs` | Mídias e métricas da Meta, log de sincronização |
| `follower_snapshots`, `account_daily`, `carteira_perfil` | Histórico de conta e públicos |
| `reports` | Relatório mensal congelado + textos editáveis |
| `radar_runs`, `radar_alerts` | Radar legislativo |
| `push_subscriptions` | Inscrições de Web Push |

Funções RPC principais: `my_role`, `auth_email`, `my_funcao`, `is_admin`, `is_team`, `rotate_month_token`, `revoke_month_token`, `claim_post`, `send_post`, `request_internal_adjust`, `schedule_post`, `mark_notifications_read`, `set_media_editoria`, `save_push_subscription`, `delete_push_subscription`.

---

## 6. Edge Functions

| Função | Quem chama | Autenticação | Faz |
|---|---|---|---|
| `cliente` | Página do cliente | Token do mês (`x-month-token`), CORS restrito | Lê o mês, registra decisões, radar do cliente |
| `publicar` | pg_cron | `x-cron-secret` | Publica posts vencidos na Meta |
| `metricas` | pg_cron ou admin | `x-cron-secret` ou JWT de admin | Sincroniza mídias e métricas |
| `notificar` | Trigger do banco | `x-cron-secret` | Envia aviso por e-mail (Resend) |
| `relatorio` | Admin | JWT de admin | Fecha o relatório do mês |

**Secrets:** `CRON_SECRET`, `IG_USER_ID`, `IG_ACCESS_TOKEN`, `IG_GRAPH_VERSION`, `PUBLISH_DRY_RUN`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `NOTIFY_FROM`, `SITE_URL`. No Vault: `publicar_cron_secret`, `vapid_private`.

---

## 7. Segurança (revisão das 5 falhas comuns em app gerado por IA)

| # | Ponto | Situação |
|---|---|---|
| 1 | RLS | OK nas tabelas das migrations (políticas `is_admin()`/`is_team()`). **Atenção:** o esquema base (`months`, `posts`, `versions`, `decisions`, `team_members`) **não está em `supabase/migrations/`**: a primeira migration é de 21/10. Não dá para auditar o RLS dessas tabelas pelo repo. |
| 2 | Autorização no front | OK. Regras de aprovação, envio e agendamento vivem em RPC `security definer` com checagem de papel; o front só esconde botões. |
| 3 | IDOR | OK no cliente: tudo passa pela Edge Function, que resolve o mês pelo token, não por ID vindo do navegador. |
| 4 | Segredos expostos | OK. Só a chave **publishable** está no front (feita para isso). Token Meta, Resend e cron secret ficam em Secrets/Vault; `vapid_private()` só executa como `service_role`. |
| 5 | Validação de input/upload | Parcial. Edge Function valida slug, UUID e token por regex; e-mail escapa HTML. **Mas** a checagem de tipo de arquivo (bytes) está só no front (`work.js:54`); a policy `artes_team_insert` no Storage não limita MIME nem tamanho. |

**Correções recomendadas**
1. Versionar o esquema base: `supabase db dump --schema public > supabase/migrations/20261001_base.sql` e revisar o RLS de `months/posts/versions/decisions/team_members`.
2. No bucket `artes`, definir `allowed_mime_types = ['image/png','image/jpeg','video/mp4']` e `file_size_limit` (Storage → bucket → Settings, ou `update storage.buckets set ... where id = 'artes'`).
3. `metricas` responde com CORS `*`. Não vaza dado (exige admin ou segredo), mas vale restringir à origem do GitHub Pages como nas outras.
4. O script do Radar (que grava `radar_alerts`) não está no repo; documentar onde ele roda e com qual credencial.

---

## 8. Operação

- **Deploy do front:** push na `main` → GitHub Pages.
- **Deploy de backend:** `supabase functions deploy <nome>` e `supabase db push` das migrations.
- **Ativar cron:** rodar `supabase/ativar-cron.sql` (publicação a cada 5 min).
- **Token Meta:** System User do portfólio "Garten Contabil" (app criado dentro do portfólio); para alcance/salvamentos precisa de `instagram_manage_insights`.
- **Resend sem domínio verificado** só entrega para o e-mail da própria conta (`NOTIFY_EMAIL`).

---

## 9. Pendências e próximos passos

- Web Push no celular (estrutura pronta, adiado).
- E-mail para a caixa do time de design no domínio da Garten (precisa verificar domínio no Resend).
- Definir melhor o papel da analista social no painel dela.
- Possível produto Matsu Design (licença), com o núcleo de aprovação cliente/pauta como valor principal.
