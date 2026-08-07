# middleware-zendesk-indecx

Integracao Zendesk com IndeCX. Recebe webhooks do Zendesk, cria o link da
pesquisa na IndeCX e entrega pelo canal correto.

Este repo unifica os dois middlewares que antes eram separados (WhatsApp/nota e
email). A logica comum (autenticacao, token IndeCX, chamadas Zendesk, logs) fica
em [`lib/`](lib/); cada canal e um endpoint fino em [`api/`](api/).

## Endpoints

| Endpoint | Canal | Arquivo |
|----------|-------|---------|
| `POST /api/webhook` | WhatsApp (Smooch) ou nota interna no ticket | [api/webhook.js](api/webhook.js) |
| `POST /api/email`   | Comentario publico no ticket (Zendesk dispara o email) | [api/email.js](api/email.js) |

`GET` em qualquer um responde um health-check.

### `/api/webhook` — WhatsApp / nota interna

Tags que geram link e enviam por **WhatsApp/Smooch** (`conversation_id`
obrigatorio): `p-indecx1` .. `p-indecx7`, `p-indecx8-es`, `p-indecx9-es`,
`p-indecx10-es`.

A tag `p-indecx11-m` publica o link como **observacao interna** no ticket
(`conversation_id` nao e obrigatorio; envie `cliente_email` ou `cliente_telefone`).
Texto da observacao interna:

```txt
Avalie a atuacao do prestador nesse caso
```

### `/api/email` — comentario publico

Tag `pesquisa-reembolso` gera o link e adiciona um comentario **publico** no
ticket. O corpo do email varia por `tipo_mensagem` (`p-reem-ap` ou `p-reem-neg`).
`ticket_id` obrigatorio.

## Seguranca

- `WEBHOOK_SECRET`: se definida, toda requisicao POST (nos dois endpoints)
  precisa enviar o header `X-Webhook-Secret` com esse mesmo valor; caso
  contrario recebe `401`. Enquanto nao estiver definida, a autenticacao fica
  desativada (modo legado) e os endpoints aceitam qualquer POST, apenas
  registrando um aviso no log. Configure a env e o header no webhook do Zendesk
  para ativar a protecao sem downtime.

## Variaveis de ambiente

Compartilhadas (IndeCX + Zendesk):

- `INDECX_COMPANY_KEY`
- `ZENDESK_SUBDOMAIN`: subdominio da conta Zendesk, com ou sem `.zendesk.com`.

Autenticacao Zendesk — use **uma** das duas opcoes:

- **OAuth (recomendado)** — client credentials. Tem prioridade se definido:
  - `ZENDESK_OAUTH_CLIENT_ID`
  - `ZENDESK_OAUTH_CLIENT_SECRET`
  - `ZENDESK_OAUTH_SCOPE` (opcional, padrao `tickets:read tickets:write`)
- **API token (legado, sera desativado pela Zendesk)** — usado se OAuth nao estiver definido:
  - `ZENDESK_EMAIL`
  - `ZENDESK_API_TOKEN`

Somente `/api/webhook` (WhatsApp/Smooch):

- `SMOOCH_APP_ID`
- `SMOOCH_KEY_ID`
- `SMOOCH_SECRET`

Opcionais:

- `WEBHOOK_SECRET` (ver secao Seguranca).
- `HTTP_TIMEOUT_MS`: timeout das chamadas externas em ms (padrao `10000`).

## Migracao dos webhooks (repos antigos -> unificado)

Como agora e um unico deploy, os dois endpoints ficam no mesmo dominio. Ao migrar,
aponte cada webhook do Zendesk para o novo caminho:

- Fluxo WhatsApp/nota -> `https://<deploy>/api/webhook`
- Fluxo email (antigo repo RECX) -> `https://<deploy>/api/email`

Depois do cutover, o repo `RECX` pode ser arquivado.
