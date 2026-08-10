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

Se `tipo_mensagem` vier ausente ou com um valor desconhecido, o email sai com um
corpo **neutro**, que nao afirma se o reembolso foi aprovado ou negado — evita
mandar a mensagem errada para o cliente sem deixar de enviar a pesquisa. Nesse
caso a resposta traz `tipoMensagemUsado: "neutro"` e o log registra
`TIPO_MENSAGEM NAO RECONHECIDO`; se isso aparecer com frequencia, o campo no
gatilho do Zendesk provavelmente esta quebrado.

## Seguranca

- `WEBHOOK_SECRET` (**obrigatoria**): toda requisicao POST, nos dois endpoints,
  precisa enviar o header `X-Webhook-Secret` com esse mesmo valor; caso contrario
  recebe `401`. A comparacao e timing-safe sobre hashes SHA-256, entao nao vaza
  tamanho nem conteudo do segredo.

  O comportamento e **fail-closed**: se a variavel nao existir no ambiente, todo
  POST e rejeitado com `401` e o log registra `ERRO DE CONFIG`. Ou seja, esquecer
  a env quebra a integracao de forma visivel — nunca deixa o endpoint aberto.

  Ao girar o segredo, atualize a env na Vercel **e** o header no webhook do
  Zendesk. Enquanto os dois estiverem diferentes, o Zendesk recebe `401`.

  `GET` nao exige o header: serve como health-check e nao expoe nada.

### Verificando a protecao

Tag invalida nao chega a chamar IndeCX nem Zendesk, entao serve como teste
seguro (nao dispara email nem WhatsApp):

```bash
# esperado: 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/api/email" \
  -H "Content-Type: application/json" -d '{"tag_pesquisa":"x"}'

# esperado: 200 {"success":false,"error":"Tag não mapeada"}
curl -s -X POST "$URL/api/email" -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" -d '{"tag_pesquisa":"x"}'
```

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
