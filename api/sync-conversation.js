const axios = require('axios');

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN; // heroassist
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

// Seu Field ID do "[WhatsApp] Conversation ID"
const ZENDESK_CONVERSATION_FIELD_ID =
  process.env.ZENDESK_CONVERSATION_FIELD_ID || '43469223340307';

function zendeskAuthHeader() {
  const basic = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');
  return `Basic ${basic}`;
}

function pickTicketId(body) {
  return (
    body?.detail?.id ||
    body?.detail?.ticket_id ||
    body?.ticket_id ||
    body?.ticketId ||
    null
  );
}

function pickConversationId(body) {
  return (
    body?.event?.conversation_id ||
    body?.event?.conversationId ||
    body?.event?.conversation?.id ||
    body?.conversation_id ||
    body?.conversationId ||
    null
  );
}

async function updateTicket(ticketId, conversationId) {
  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}.json`;

  const payload = {
    ticket: {
      custom_fields: [
        { id: Number(ZENDESK_CONVERSATION_FIELD_ID), value: String(conversationId) }
      ],
      // opcional: tag pra você ver fácil que já foi setado
      tags: ['wa_conversation_id_set']
    }
  };

  const resp = await axios.put(url, payload, {
    headers: {
      Authorization: zendeskAuthHeader(),
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return resp.data;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'sync-conversation funcionando' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const body = req.body || {};

    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(200).json({
        success: false,
        error: 'Faltam variáveis do Zendesk na Vercel (SUBDOMAIN/EMAIL/TOKEN)'
      });
    }

    const ticketId = pickTicketId(body);
    const conversationId = pickConversationId(body);

    if (!ticketId || !conversationId) {
      return res.status(200).json({
        success: false,
        error: 'Payload sem ticket_id ou conversation_id',
        received: {
          ticket_id: ticketId,
          conversation_id: conversationId
        }
      });
    }

    await updateTicket(ticketId, conversationId);

    return res.status(200).json({
      success: true,
      ticket_id: ticketId,
      conversation_id: conversationId,
      message: 'Conversation ID salvo no campo do ticket'
    });
  } catch (error) {
    console.error('SYNC ERRO:', error.response?.data || error.message);
    return res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
};
