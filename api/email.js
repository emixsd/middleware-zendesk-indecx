// Endpoint de email: gera link IndeCX e publica como comentario PUBLICO no
// ticket (o Zendesk dispara o email). Portado do middleware RECX, usando a
// mesma lib compartilhada de ../lib.
const { createWebhookHandler } = require('../lib/handler');
const { gerarLinkPesquisa } = require('../lib/indecx');
const { addTicketComment } = require('../lib/zendesk');
const { resolveMapped, isValidTicketId, sanitizeNome } = require('../lib/request');
const { atribuirSePreenchido } = require('../lib/payload');
const { umaVezPorJanela } = require('../lib/dedupe');

// TODO: substituir pelos valores reais quando tiver.
const TAG_TO_ACTION = {
  'pesquisa-reembolso': 'L85YSV7C'
};

// Mensagem unica para todos os pedidos, independentemente de tipo_mensagem.
const corpoEmail = (nome, link) =>
  `Olá, ${nome}!\n` +
  `Sua solicitação de reembolso teve a análise concluída.\n` +
  `Queremos saber como foi sua experiência com nosso atendimento durante esse processo. ` +
  `Sua opinião é muito importante para continuarmos evoluindo!\n\n` +
  `👉 Avaliar experiência: ${link}`;

async function handle(body, req, res) {
  const {
    ticket_id,
    cliente_nome,
    cliente_email,
    cliente_telefone,
    tag_pesquisa,
    brand,
    codigo_notro,
    destino_viagem,
    analista
  } = body;

  const actionId = resolveMapped(TAG_TO_ACTION, tag_pesquisa);

  if (!actionId) {
    return res.status(200).json({ success: false, error: 'Tag não mapeada' });
  }

  if (!ticket_id) {
    return res.status(200).json({ success: false, error: 'Ticket ID não informado' });
  }
  if (!isValidTicketId(ticket_id)) {
    return res.status(200).json({ success: false, error: 'Ticket ID inválido' });
  }

  // Mesmo nome limpo no IndeCX e no texto do email publico.
  const nome = sanitizeNome(cliente_nome, 'Cliente');

  // Vazio nao entra no payload (igual ao fluxo WhatsApp): no IndeCX o
  // indicador fica sem valor, em vez de com "".
  const dadosIndecx = { nome };
  atribuirSePreenchido(dadosIndecx, {
    TicketID: ticket_id,
    brand,
    codigo_notro,
    destino_viagem,
    analista,
    email: cliente_email,
    telefone: String(cliente_telefone || '').replace(/\D/g, '')
  });

  const chave = 'email:' + tag_pesquisa + ':' + ticket_id;
  const envio = await umaVezPorJanela(chave, async () => {
    const link = await gerarLinkPesquisa(actionId, dadosIndecx);
    await addTicketComment(ticket_id, { body: corpoEmail(nome, link), public: true });
    return link;
  });

  if (envio.duplicado) {
    console.warn('ENVIO REPETIDO IGNORADO:', chave);
    return res.status(200).json({
      success: true,
      duplicado: true,
      message: 'Pesquisa ja enviada para este ticket nos ultimos minutos; reenvio ignorado.'
    });
  }

  return res.status(200).json({
    success: true,
    actionId,
    link: envio.resultado,
    tipoMensagemUsado: 'unico',
    message: 'Comentário adicionado no ticket — email enviado pelo Zendesk!'
  });
}

module.exports = createWebhookHandler(handle, {
  logLabel: 'REQUISIÇÃO RECEBIDA (email)',
  healthMessage: 'Middleware Zendesk-IndeCX (email) funcionando!',
  signingSecretEnv: 'ZENDESK_EMAIL_SIGNING_SECRET'
});
