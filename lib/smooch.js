const { http } = require('./http');
const { truncate } = require('./log');

const SMOOCH_APP_ID = process.env.SMOOCH_APP_ID;
const SMOOCH_KEY_ID = process.env.SMOOCH_KEY_ID;
const SMOOCH_SECRET = process.env.SMOOCH_SECRET;

async function enviarMensagemWhatsApp(conversationId, linkPesquisa, isSpanish = false) {
  if (!SMOOCH_APP_ID || !SMOOCH_KEY_ID || !SMOOCH_SECRET) {
    throw new Error('Credenciais Smooch nao configuradas');
  }

  const auth = Buffer.from(SMOOCH_KEY_ID + ':' + SMOOCH_SECRET).toString('base64');

  const textoMensagem = isSpanish
    ? '¿Pudimos ayudarte hoy? 💬\nTe va a llevar menos de 30 segundos responder y tu opinión es muy importante para nosotros. \nTu respuesta llega directamente al equipo responsable de tu atención.😉'
    : 'Me conta, conseguimos te ajudar hoje? 💬\nSua avaliação leva menos de 30 segundos e é muito importante para nós. \nSua resposta vai direto para o time responsável pelo atendimento.😉';

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
    encodeURIComponent(SMOOCH_APP_ID) +
    '/conversations/' +
    encodeURIComponent(conversationId) +
    '/messages';

  try {
    const response = await http.post(url, mensagem, {
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json'
      }
    });

    console.log('SMOOCH OK status:', response.status);
    return response.data;
  } catch (err) {
    console.error('SMOOCH ERRO status:', err.response?.status);
    console.error('SMOOCH ERRO body:', truncate(err.response?.data || err.message));
    throw err;
  }
}

module.exports = { enviarMensagemWhatsApp };
