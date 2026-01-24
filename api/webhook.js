const axios = require('axios');

const INDECX_COMPANY_KEY = process.env.INDECX_COMPANY_KEY;
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

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

async function dispararPesquisa(actionId, dados) {
  const token = await getIndecxToken();
  
  const response = await axios.post(
    INDECX_BASE_URL + '/send/' + actionId,
    dados,
    { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
  );
  
  return response.data;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Middleware Zendesk-IndeCX funcionando!' });
  }

  if (req.method === 'POST') {
    try {
      const { ticket_id, cliente_nome, cliente_email, cliente_telefone, tag_pesquisa, brand, codigo_notro, destino_viagem } = req.body;

      const actionId = TAG_TO_ACTION[tag_pesquisa];
      
      if (!actionId) {
        return res.status(200).json({ success: false, error: 'Tag não mapeada' });
      }

      if (!cliente_email && !cliente_telefone) {
        return res.status(200).json({ success: false, error: 'Cliente sem contato válido' });
      }

      const dadosIndecx = {
        nome: cliente_nome || 'Cliente',
        email: cliente_email || '',
        telefone: cliente_telefone ? cliente_telefone.replace(/\D/g, '') : '',
        TicketID: ticket_id,
        brand: brand || '',
        codigo_notro: codigo_notro || '',
        destino_viagem: destino_viagem || ''
      };

      const resultado = await dispararPesquisa(actionId, dadosIndecx);

      return res.status(200).json({ success: true, actionId: actionId, message: 'Pesquisa disparada com sucesso!' });

    } catch (error) {
      return res.status(200).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
