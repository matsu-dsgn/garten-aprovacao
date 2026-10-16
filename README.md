# Garten — Fluxo de pauta e aprovação

Página mensal para o cliente aprovar **pauta → copy → arte**, com histórico.
Front estático (GitHub Pages) + Supabase (banco, storage e Edge Function).

## Arquivos
- `index.html` + `app.js` — página do cliente (link com token, sem login)
- `admin.html` + `admin.js` — painel da agência (login)
- `common.js` — regras de status compartilhadas
- `styles.css` — tokens visuais (trocar pelos valores finais do DS da Garten)
- `config.js` — URL e chave **publishable** do Supabase (feita para ficar pública)
- `vendor/` — supabase-js 2.45.4 hospedado junto (sem CDN)
- `supabase/functions/cliente/` — Edge Function, única porta de entrada do cliente
- `supabase/migrations/` — esquema do banco

## Regras de aprovação (garantidas no servidor)
- Wilker ou Letícia aprovam sozinhos.
- Depois que o Wilker decide uma etapa, só ele muda — a menos que a agência conteste.
- Reprovação exige motivo.
- Pauta trava quando a arte sobe. Tudo trava quando o post é marcado como agendado.
- Cada nova copy/arte é uma nova versão; o histórico nunca é apagado.

## Fluxo do mês
1. No painel: **Novo mês** (slug tipo `2026-12`, título, intro, pilares).
2. **Importar pauta (JSON)** com os posts que fechamos no planejamento.
3. **Gerar novo link** e mandar no WhatsApp. O link só aparece uma vez.
4. Subir copy e arte por post. Acompanhar decisões e contestar quando preciso.
5. Marcar como agendado. **Exportar JSON** no fim do mês para backup.

Formato do JSON de pauta:
```json
{"posts":[{"date":"2026-12-03","format":"carrossel","editoria":"prazo-certo","theme":"IRPJ trimestral","title":"…","objective":"…","direction":"…","checklist":["item 1","item 2"]}]}
```
`format`: estatico, carrossel, reels ou stories.

`editoria`: prazo-certo, imposto-em-mapa, proximo-passo, do-zero-ao-cnpj ou com-o-gabriel.
O mix ideal do mês (em %) e o motivo são definidos em "Dados do mês" no painel.

## Oportunidades
Posts fora do calendário. Criados em "⚡ Nova oportunidade" no painel: pulam a pauta, o cliente aprova o post pronto (copy + arte).
Origem "Pedido do cliente" + prazo de resposta mostra contagem regressiva no card. Não entram no ideal × planejado.
No JSON: `"kind":"oportunidade","origin":"cliente"`.
"Copiar link do post" gera um link que abre a página direto no card (usa o link do mês salvo neste navegador).

## Editorias sazonais
`13-e-fim-de-ano` (prédio em portal) só aparece no mês em que tiver % no mix ideal ou algum post.
