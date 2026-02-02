const axios = require('axios');

const INDECX_COMPANY_KEY = process.env.INDECX_COMPANY_KEY;

const SMOOCH_APP_ID = process.env.SMOOCH_APP_ID;
const SMOOCH_KEY_ID = process.env.SMOOCH_KEY_ID;
const SMOOCH_SECRET = process.env.SMOOCH_SECRET;

// Zendesk Support API – pra buscar o conversation_id no ticket
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN; // ex: "heroassist"
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;         // ex: "email@empresa.com"
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN; // token do Zendesk

const INDECX_BASE_URL = 'https://indecx.com/v3/integrations';

const TAG_TO_ACTION = {
  'p-indecx1': 'MQWL91U1',
  'p-indecx2': 'BSV2R4NX',
  'p-indecx3': 'CKEPEXUP',
  'p-indecx4': 'NKISR8O1',
  'p-indecx5': '8OVWL4UE'
};

let indecxToken = null;
let tokenExpiry = null;

async function getIndecxToken() {
  if (indecxToken && tokenExpiry && Date.now() < tokenExpiry) return indecxToken;

  const response = await axios.get(
    INDECX_BASE_URL + '/authorization/token',
    { headers: { 'Company-Key': INDECX_COMPANY_KEY } }
  );

  indecxToken = response.data.authToken;
  tokenExpiry = Date.now() + 25 * 60 * 1000;
  return indecxToken;
}

async function gerarLinkPesquisa(actionId, dados) {
  const token = await getIndecxToken();

  const response = await axios.post(
    INDECX_BASE_URL + '/actions/' + actionId + '/invites',
    { customers: [dados] },
    { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
  );

  return response.data?.customers?.[0]?.shortUrl || null;
}

async function enviarMensagemWhatsApp(conversationId, linkPesquisa) {
  const auth = Buffer.from(SMOOCH_KEY_ID + ':' + SMOOCH_SECRET).toString('base64');

  // 
  const mensagem = {
    author: { type: 'business' },
    content: {
      type: 'text',
      text: 'Olá!\n\nVimos que você recebeu um atendimento recentemente. Pode avaliar sua experiência?',
      actions: [{ type: 'link', text: 'Avaliar experiência', uri: linkPesquisa }]
    }
  };

  const url =
    'https://api.smooch.io/v2/apps/' +
    SMOOCH_APP_ID +
    '/conversations/' +
    conversationId +
    '/messages';

  const response = await axios.post(url, mensagem, {
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' }
  });

  return response.data;
}

// Busca o conversation_id direto do ticket via audits
async function buscarConversationIdNoTicket(ticketId) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.log('Zendesk creds ausentes: não dá pra buscar conversation_id via API.');
    return null;
  }

  const basic = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');
  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/audits.json`;

  const resp = await axios.get(url, {
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }
  });

  const audits = resp.data?.audits || [];

  // varre do mais novo pro mais antigo
  for (let i = audits.length - 1; i >= 0; i--) {
    const evs = audits[i]?.events || [];
    for (const ev of evs) {
      if (ev.type === 'Comment' && ev.body) {
        // pega "ID da conversa: XXXXX" (pt) ou variações
        // aceita letras, números, "_" e "-"
        const m = String(ev.body).match(/ID da conversa:\s*([A-Za-z0-9_-]+)/i);
        if (m?.[1]) return m[1].trim();

        const m2 = String(ev.body).match(/Conversation ID:\s*([A-Za-z0-9_-]+)/i);
        if (m2?.[1]) return m2[1].trim();
      }
    }
  }

  return null;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Middleware Zendesk-IndeCX funcionando!' });
  }

  if (req.method === 'POST') {
    try {
      console.log('Webhook recebido:', JSON.stringify(req.body || {}, null, 2));

      const {
        ticket_id,
        cliente_nome,
        cliente_email,
        cliente_telefone,
        tag_pesquisa,
        brand,
        codigo_notro,
        destino_viagem,
        conversation_id,
        analista // <<< NOVO
      } = req.body || {};

      const actionId = TAG_TO_ACTION[tag_pesquisa];
      if (!actionId) {
        console.log('Retorno cedo: Tag não mapeada:', tag_pesquisa);
        return res.status(200).json({ success: false, error: 'Tag não mapeada' });
      }

      // conversa pode vir vazia do Zendesk → tenta buscar no ticket
      let convId = String(conversation_id || '').trim();
      if (!convId && ticket_id) {
        console.log('conversation_id vazio no payload. Buscando no ticket:', ticket_id);
        convId = await buscarConversationIdNoTicket(ticket_id);
      }

      if (!convId) {
        console.log('Retorno cedo: Conversation ID não encontrado (payload + ticket).');
        return res.status(200).json({ success: false, error: 'Conversation ID não encontrado' });
      }

      const dadosIndecx = {
        nome: cliente_nome || 'Cliente',
        TicketID: ticket_id,
        brand: brand || '',
        codigo_notro: codigo_notro || '',
        destino_viagem: destino_viagem || ''
      };

      // NOVO indicador: analista
      if ((analista || '').trim()) {
        dadosIndecx.analista = analista.trim();
      }

      // só manda email se existir (não manda vazio)
      if ((cliente_email || '').trim()) {
        dadosIndecx.email = cliente_email.trim();
      }

      // só manda telefone se existir (não manda vazio)
      if (cliente_telefone) {
        dadosIndecx.telefone = String(cliente_telefone).replace(/\D/g, '');
      }

      const linkPesquisa = await gerarLinkPesquisa(actionId, dadosIndecx);
      if (!linkPesquisa) {
        console.log('IndeCX não retornou shortUrl.');
        return res.status(200).json({ success: false, error: 'Não consegui gerar shortUrl na IndeCX' });
      }

      await enviarMensagemWhatsApp(convId, linkPesquisa);

      return res.status(200).json({
        success: true,
        actionId,
        link: linkPesquisa,
        conversation_id: convId,
        message: 'Mensagem enviada no WhatsApp!'
      });
    } catch (error) {
      console.error('ERRO GERAL:', error.response?.data || error.message);
      return res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
