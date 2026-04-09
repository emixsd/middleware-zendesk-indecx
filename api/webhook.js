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
  'p-indecx5': '8OVWL4UE',
  'p-indecx6': 'ZWM2SC7X',
  'p-indecx7': 'OEOK5BH9',
  'p-indecx8': 'BLA4FABO',
  'p-indecx9': 'UFAGAEZI',
  'p-indecx8-es': 'BLA4FABO',
  'p-indecx9-es': 'UFAGAEZI',
  'p-indecx10-es': 'IDI64Z1Z'
};

const SPANISH_TAGS = new Set(['p-indecx8-es', 'p-indecx9-es', 'p-indecx10-es']);

let indecxToken = null;
let tokenExpiry = null;

async function getIndecxToken() {
  if (indecxToken && tokenExpiry && Date.now() < tokenExpiry) {
    return indecxToken;
  }

  const response = await axios.get(INDECX_BASE_URL + '/authorization/token', {
    headers: { 'Company-Key': INDECX_COMPANY_KEY }
  });

  indecxToken = response.data.authToken;
  tokenExpiry = Date.now() + 25 * 60 * 1000;
  return indecxToken;
}

async function gerarLinkPesquisa(actionId, dados) {
  const token = await getIndecxToken();

  const response = await axios.post(
    INDECX_BASE_URL + '/actions/' + actionId + '/invites',
    { customers: [dados] },
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.customers[0].shortUrl;
}

async function enviarMensagemWhatsApp(conversationId, linkPesquisa, isSpanish = false) {
  const auth = Buffer.from(SMOOCH_KEY_ID + ':' + SMOOCH_SECRET).toString('base64');

  const textoMensagem = isSpanish
    ? '¿Pudimos ayudarte hoy? 💬\nTu opinión tarda menos de 30 segundos y es muy importante para nosotros. Tu respuesta llega directamente al equipo responsable de tu atención.'
    : 'Me conta, conseguimos te ajudar hoje? 💬\nSua avaliação leva menos de 30 segundos e é muito importante para nós. Sua resposta vai direto para o time responsável pelo atendimento.';

  const textoBotao = isSpanish ? 'Evaluar experiencia' : 'Avaliar experiência';

  const mensagem = {
    author: { type: 'business' },
    content: {
      type: 'text',
      text: textoMensagem,
      actions: [
        {
          type: 'link',
          text: textoBotao,
          uri: linkPesquisa
        }
      ]
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
    return res
      .status(200)
      .json({ status: 'ok', message: 'Middleware Zendesk-IndeCX funcionando!' });
  }

  if (req.method === 'POST') {
    try {
      console.log('DADOS RECEBIDOS:', JSON.stringify(req.body));

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
        analista
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
        destino_viagem: destino_viagem || '',
        analista: analista || ''
      };

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

      await enviarMensagemWhatsApp(conversation_id, linkPesquisa, isSpanish);

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
