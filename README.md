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

### Autenticacao

Dois modos, escolhidos por endpoint pelas envs presentes:

1. **Assinatura do Zendesk (recomendado).** Cada webhook do Zendesk tem uma
   "Chave secreta" (tela do webhook > Detalhes). O Zendesk assina todo envio com
   `X-Zendesk-Webhook-Signature` = base64(HMAC-SHA256(chave, timestamp + corpo)).
   O middleware confere a assinatura sobre o corpo bruto e recusa requisicao com
   mais de 5 minutos. Assim, quem vir um envio (print, log) nao consegue forjar
   outro nem reaproveitar o antigo.
   - `/api/webhook` le `ZENDESK_WEBHOOK_SIGNING_SECRET` (chave do webhook
     "IndeCX - enviar pesquisa").
   - `/api/email` le `ZENDESK_EMAIL_SIGNING_SECRET` (chave do webhook
     "IndeCX - REEMBOLSO").
   - Cada endpoint aceita so a propria chave: vazar uma nao abre o outro.
   - Exige `NODEJS_HELPERS=0` na Vercel. Com os helpers ligados (padrao), a
     plataforma consome o corpo antes do codigo e a assinatura nao tem como ser
     conferida; nesse caso todo POST recebe `401` e o log mostra
     `ERRO DE CONFIG ... NODEJS_HELPERS=0`. O codigo funciona com e sem helpers.

2. **Header fixo (legado).** Usado so quando a chave de assinatura do endpoint
   nao esta definida. Toda requisicao POST precisa do header `X-Webhook-Secret`
   igual a `WEBHOOK_SECRET`.

Com a chave de assinatura definida, o header fixo e **ignorado** naquele
endpoint.

O comportamento e **fail-closed**: sem nenhum segredo configurado, todo POST e
rejeitado com `401` e o log registra `ERRO DE CONFIG`. Esquecer a env quebra a
integracao de forma visivel, nunca deixa o endpoint aberto. As comparacoes sao
timing-safe.

`GET` nao exige autenticacao: serve como health-check e nao expoe nada.

### Ativando a assinatura (uma vez)

Faca um endpoint por vez, testando entre os passos.

1. Na Vercel, adicione `NODEJS_HELPERS=0` e faca redeploy. O header fixo
   continua valendo; confira que os envios seguem com `SMOOCH OK` /
   `ZENDESK OK` nos logs.
2. No Zendesk, abra o webhook, clique em "Revelar segredo" e copie a chave.
3. Na Vercel, cadastre a chave em `ZENDESK_WEBHOOK_SIGNING_SECRET` (ou
   `ZENDESK_EMAIL_SIGNING_SECRET`) e faca redeploy.
4. Confira nos logs da Vercel um envio **real** depois do redeploy: esperado
   `SMOOCH OK` / `ZENDESK OK`. `WEBHOOK NAO AUTORIZADO: assinatura ...` = chave
   errada; `ERRO DE CONFIG ... NODEJS_HELPERS=0` = env faltando ou sem redeploy.
   Nao use o "Testar webhook" para isso: o Zendesk assina o teste com uma chave
   fixa de teste, nao com a do webhook, entao ele recebe `401` mesmo com tudo
   certo. Nao cadastre essa chave de teste na Vercel: ela e publica.
5. Depois que os dois endpoints estiverem assinados, mude a autenticacao dos
   webhooks no Zendesk para "Nenhuma" (a assinatura continua sendo enviada) e
   remova `WEBHOOK_SECRET` da Vercel. Um envio real com `SMOOCH OK` /
   `ZENDESK OK` depois disso confirma que so a assinatura esta valendo.

Para voltar atras, basta remover a env de assinatura e fazer redeploy: o
endpoint volta ao header fixo.

### Trocando segredos sem derrubar

Todas as envs de segredo aceitam varios valores separados por virgula. Para
trocar: cadastre `novo,antigo` na Vercel, redeploy, troque no Zendesk
("Redefinir segredo" ou o header) e depois deixe so `novo`.

### Outras protecoes

- **Logs sem dado pessoal.** Nome, email e telefone do body sao mascarados, e
  todo corpo de resposta/erro da IndeCX, do Smooch e do Zendesk passa por
  `safeDetail` (lib/log.js), que mascara PII por nome de campo e por conteudo
  (email, telefone de 10 a 13 digitos) antes de logar.
- **Nome do cliente limpo.** O nome vem do requester, que o cliente controla
  (perfil do WhatsApp, "From" do email), e entra no email publico e na
  pesquisa. `sanitizeNome` remove URL, dominio solto e quebra de linha e limita a
  60 caracteres. Os demais campos repassados a IndeCX sao limitados a 200.
- **Envio repetido.** A mesma pesquisa para o mesmo ticket e ignorada por 10
  minutos (resposta `duplicado: true`, log `ENVIO REPETIDO IGNORADO`). Cobre o
  reenvio do Zendesk quando a resposta demora. E melhor esforco: o estado fica
  na memoria da instancia, entao um reenvio em outra instancia passa.
- **Link da pesquisa.** Usa o primeiro link `https` devolvido pela IndeCX. Se so
  vier `http`, envia assim mesmo e loga `INDECX LINK SEM HTTPS`. Todo link gerado
  fica no log (`INDECX LINK GERADO`), para conferir qual convite o cliente
  recebeu.
- **Corpo limitado** a 100 KB (`413` acima disso).

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

Autenticacao (ver secao Seguranca; pelo menos uma por endpoint):

- `ZENDESK_WEBHOOK_SIGNING_SECRET`: chave de assinatura do webhook de `/api/webhook`.
- `ZENDESK_EMAIL_SIGNING_SECRET`: chave de assinatura do webhook de `/api/email`.
- `NODEJS_HELPERS=0`: obrigatoria quando alguma chave de assinatura estiver definida.
- `WEBHOOK_SECRET`: header fixo (legado), usado so onde nao ha chave de assinatura.

Opcionais:

- `HTTP_TIMEOUT_MS`: timeout das chamadas externas em ms (padrao `10000`).

## Testes

```bash
npm test
```

Usa o `node:test` nativo, sem dependencias. Cobre autenticacao (assinatura,
replay, header legado, com e sem helpers da Vercel), redacao de logs, limpeza do
nome, bloqueio de reenvio e o fluxo completo dos dois endpoints com as APIs
simuladas.

## Migracao dos webhooks (repos antigos -> unificado)

Como agora e um unico deploy, os dois endpoints ficam no mesmo dominio. Ao migrar,
aponte cada webhook do Zendesk para o novo caminho:

- Fluxo WhatsApp/nota -> `https://<deploy>/api/webhook`
- Fluxo email (antigo repo RECX) -> `https://<deploy>/api/email`

Depois do cutover, o repo `RECX` pode ser arquivado.
