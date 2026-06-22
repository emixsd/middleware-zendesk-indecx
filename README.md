# middleware-zendesk-indecx

Integracao Zendesk com IndeCX.

Este middleware recebe webhooks do Zendesk, cria o link da pesquisa na IndeCX e
envia a pesquisa pelo canal correto.

## Fluxo padrao: WhatsApp

As tags abaixo geram um link da IndeCX e enviam a pesquisa pelo WhatsApp/Smooch.
Nesse fluxo, `conversation_id` e obrigatorio.

- `p-indecx1`
- `p-indecx2`
- `p-indecx3`
- `p-indecx4`
- `p-indecx5`
- `p-indecx6`
- `p-indecx7`
- `p-indecx8`
- `p-indecx9`
- `p-indecx8-es`
- `p-indecx9-es`
- `p-indecx10-es`

## Excecao: email com observacao interna

Somente a tag `p-indecx11-m` publica o link como observacao interna no ticket
Zendesk. O solicitante nao recebe essa mensagem.

Nesse fluxo, `conversation_id` nao e obrigatorio. O campo padrao `email` da
IndeCX nao e preenchido; o middleware usa os dados do ticket e o nome do
analista.

Texto da observacao interna:

```txt
Avalie o prestador?
```

## Variaveis de ambiente

IndeCX:

- `INDECX_COMPANY_KEY`

WhatsApp/Smooch:

- `SMOOCH_APP_ID`
- `SMOOCH_KEY_ID`
- `SMOOCH_SECRET`

Zendesk, necessario para `p-indecx11-m`:

- `ZENDESK_SUBDOMAIN`: subdominio da conta Zendesk, com ou sem `.zendesk.com`.
- `ZENDESK_EMAIL`: email do usuario de API do Zendesk.
- `ZENDESK_API_TOKEN`: token de API do Zendesk.
