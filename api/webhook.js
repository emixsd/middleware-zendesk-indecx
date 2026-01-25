const axios = require('axios');

const INDECX_COMPANY_KEY = process.env.INDECX_COMPANY_KEY;
const SMOOCH_APP_ID = process.env.SMOOCH_APP_ID;
const SMOOCH_KEY_ID = process.env.SMOOCH_KEY_ID;
const SMOOCH_SECRET = process.env.SMOOCH_SECRET;

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
  if (indecxToken && tokenExpiry && Date.now() < tokenExpiry) {
    return indecxToken;
  }
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

  return response.data.customers[0].shortUrl;
}

async function enviarMensagemWhatsApp(conversationId, linkPesquisa) {
  const auth = Buffer.from(SMOOCH_KEY_ID + ':' + SMOOCH_SECRET).toString('base64');

  const mensagem = {
    author: { type: 'business' },
    content: {
      type: 'text',
      text:
        'Olá!\n\nVimos que você recebeu um atendimento recentemente. Pode avaliar sua experiência?\n\n' +
        'Avaliar experiência: ' + linkPesquisa
    }
  };

  const url =
    'https://api.smooch.io/v2/apps/' +
    SMOOCH_APP_ID +
    '/conversations/' +
    conversationId +
    '/messages';

  try {
    const response = await axios.post(url, mensagem, {
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json'
      }
    });

    console.log('SMOOCH OK status:', response.status);
    return response.data;
  } catch (err) {
    console.error('SMOOCH ERRO status:', err.response?.status);
    console.error('SMOOCH ERRO body:', JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Middleware Zendesk-IndeCX funcionando!' });
  }

  if (req.method === 'POST') {
    try {
      const {
        ticket_id,
        cliente_nome,
        cliente_email,
        cliente_telefone,
        tag_pesquisa,
        brand,
        codigo_notro,
        destino_viagem,
        conversation_id
      } = req.body;

      const actionId = TAG_TO_ACTION[tag_pesquisa];

      if (!actionId) {
        return res.status(200).json({ success: false, error: 'Tag não mapeada' });
      }

      if (!conversation_id) {
        return res.status(200).json({ success: false, error: 'Conversation ID não informado' });
      }

      const dadosIndecx = {
        nome: cliente_nome || 'Cliente',
        TicketID: ticket_id,
        brand: brand || '',
        codigo_notro: codigo_notro || '',
        destino_viagem: destino_viagem || ''
      };

      // só manda email se existir (não manda vazio)
      if ((cliente_email || '').trim()) {
        dadosIndecx.email = cliente_email.trim();
      }

      // só manda telefone se existir (não manda vazio)
      if (cliente_telefone) {
        dadosIndecx.telefone = String(cliente_telefone).replace(/\D/g, '');
      }

      const linkPesquisa = await gerarLinkPesquisa(actionId, dadosIndecx);

      await enviarMensagemWhatsApp(conversation_id, linkPesquisa);

      return res.status(200).json({
        success: true,
        actionId: actionId,
        link: linkPesquisa,
        message: 'Mensagem enviada no WhatsApp!'
      });
    } catch (error) {
      console.error('ERRO GERAL:', error.response?.data || error.message);
      return res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
