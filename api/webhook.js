// Endpoint WhatsApp (Smooch) + nota interna no Zendesk.
// Logica comum (auth, token IndeCX, Zendesk, logs) fica em ../lib.
const { createWebhookHandler } = require('../lib/handler');
const { gerarLinkPesquisa } = require('../lib/indecx');
const { addTicketComment } = require('../lib/zendesk');
const { enviarMensagemWhatsApp } = require('../lib/smooch');
const {
  resolveActionId,
  isValidTicketId,
  isValidConversationId,
  escapeHtml
} = require('../lib/request');

const INDECX_INTERNAL_EMAIL_TAG = 'p-indecx11-m';

const TAG_TO_ACTION = {
  'p-indecx1': 'MQWL91U1',
  'p-indecx2': 'BSV2R4NX',
  'p-indecx3': 'CKEPEXUP',
  'p-indecx4': 'NKISR8O1',
  'p-indecx5': '8OVWL4UE',
  'p-indecx6': 'ZWM2SC7X',
  'p-indecx7': 'OEOK5BH9',
  'p-indecx8-es': 'BLA4FABO',
  'p-indecx9-es': 'UFAGAEZI',
  'p-indecx10-es': 'IDI64Z1Z',
  'p-indecx11-m': 'VLJ5LZKU'
};

const SPANISH_TAGS = new Set(['p-indecx8-es', 'p-indecx9-es', 'p-indecx10-es']);

function montarObservacaoInterna(linkPesquisa) {
  return [
    '<p style="font-size: 18px;"><strong>Avalie a atuacao do prestador nesse caso</strong></p>',
    '<p><a href="' + escapeHtml(linkPesquisa) + '">' + 'Responder pesquisa' + '</a></p>'
  ].join('');
}

async function handle(body, req, res) {
  const {
    ticket_id,
    cliente_nome,
    cliente_email,
    cliente_telefone,
    tag_pesquisa,
    brand,
    codigo_notro,
    destino,
    destino_viagem,
    conversation_id,
    analista,
    prestador
  } = body;

  const enviarComoObservacaoInterna = tag_pesquisa === INDECX_INTERNAL_EMAIL_TAG;
  const actionId = resolveActionId(TAG_TO_ACTION, tag_pesquisa);

  if (!actionId) {
    return res.status(200).json({ success: false, error: 'Tag não mapeada' });
  }

  if (!enviarComoObservacaoInterna) {
    if (!conversation_id) {
      return res.status(200).json({ success: false, error: 'Conversation ID não informado' });
    }
    if (!isValidConversationId(conversation_id)) {
      return res.status(200).json({ success: false, error: 'Conversation ID inválido' });
    }
  } else {
    if (!ticket_id) {
      return res.status(200).json({ success: false, error: 'Ticket ID nao informado' });
    }
    if (!isValidTicketId(ticket_id)) {
      return res.status(200).json({ success: false, error: 'Ticket ID inválido' });
    }
    if (
      !(cliente_email || '').trim() &&
      !String(cliente_telefone || '').replace(/\D/g, '')
    ) {
      return res.status(200).json({
        success: false,
        error: 'Cliente email ou telefone nao informado'
      });
    }
  }

  const dadosIndecx = {
    nome: enviarComoObservacaoInterna
      ? analista || prestador || cliente_nome || 'Agente'
      : cliente_nome || 'Cliente',
    TicketID: ticket_id,
    brand: brand || '',
    codigo_notro: codigo_notro || '',
    destino_viagem: destino_viagem || '',
    analista: analista || ''
  };

  if (enviarComoObservacaoInterna) {
    dadosIndecx.ticket_id = ticket_id || '';
    dadosIndecx.prestador = prestador || cliente_nome || '';
    dadosIndecx.destino = destino || destino_viagem || '';
  }

  if (tag_pesquisa === 'p-indecx6' || tag_pesquisa === 'p-indecx7') {
    dadosIndecx.conversation_id = conversation_id || '';
  }

  if ((cliente_email || '').trim()) {
    dadosIndecx.email = cliente_email.trim();
  }

  if (cliente_telefone) {
    dadosIndecx.telefone = String(cliente_telefone).replace(/\D/g, '');
  }

  const isSpanish = SPANISH_TAGS.has(tag_pesquisa);
  const linkPesquisa = await gerarLinkPesquisa(actionId, dadosIndecx);

  if (enviarComoObservacaoInterna) {
    await addTicketComment(ticket_id, {
      htmlBody: montarObservacaoInterna(linkPesquisa),
      public: false
    });

    return res.status(200).json({
      success: true,
      actionId,
      link: linkPesquisa,
      message: 'Pesquisa enviada como observacao interna no ticket!'
    });
  }

  await enviarMensagemWhatsApp(conversation_id, linkPesquisa, isSpanish);

  return res.status(200).json({
    success: true,
    actionId,
    link: linkPesquisa,
    message: 'Mensagem enviada no WhatsApp!'
  });
}

module.exports = createWebhookHandler(handle, {
  logLabel: 'DADOS RECEBIDOS',
  healthMessage: 'Middleware Zendesk-IndeCX (whatsapp/nota) funcionando!'
});
