# middleware-zendesk-indecx

Integracao Zendesk com IndeCX.

## Pesquisa interna por ticket de email

Somente a tag `p-indecx11-m` envia a pesquisa como observacao interna no ticket.
Ela usa a action `VLJ5LZKU` da IndeCX.

Configure tambem:

- `ZENDESK_SUBDOMAIN`: subdominio da conta Zendesk, com ou sem `.zendesk.com`.
- `ZENDESK_EMAIL`: email do usuario de API do Zendesk.
- `ZENDESK_API_TOKEN`: token de API do Zendesk.

Nesse fluxo, `conversation_id` nao e obrigatorio, porque o link e publicado no ticket
como nota interna. O email do solicitante nao e usado nesse fluxo; se enviado,
`agente_email` e o unico email repassado para a IndeCX. `analista_email` ainda e
aceito como compatibilidade. Todas as outras tags continuam enviando pelo
WhatsApp/Smooch.
