const { isAuthorized, authEnabled } = require('./security');
const { getRequestBody } = require('./request');
const { safeLogBody, truncate } = require('./log');

// Envolve a logica de negocio de cada endpoint com o comportamento comum:
// health-check GET, 405, autenticacao, parse+redacao do body e 500 generico.
//
//   businessFn(body, req, res) -> deve responder (res.json) ou lancar erro.
function createWebhookHandler(businessFn, options = {}) {
  const logLabel = options.logLabel || 'DADOS RECEBIDOS';
  const healthMessage = options.healthMessage || 'Middleware Zendesk-IndeCX funcionando!';

  return async (req, res) => {
    if (req.method === 'GET') {
      return res.status(200).json({ status: 'ok', message: healthMessage });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Método não permitido' });
    }

    if (!isAuthorized(req)) {
      // Distingue erro de configuracao (env faltando -> ninguem consegue chamar)
      // de chamada nao autorizada (secret errado ou ausente no chamador).
      if (!authEnabled()) {
        console.error(
          'ERRO DE CONFIG: WEBHOOK_SECRET nao definida neste ambiente — ' +
            'todas as requisicoes POST serao rejeitadas com 401.'
        );
      } else {
        console.warn('WEBHOOK NAO AUTORIZADO: header X-Webhook-Secret ausente ou invalido');
      }
      return res.status(401).json({ success: false, error: 'Não autorizado' });
    }

    try {
      const body = getRequestBody(req);
      if (!body) {
        return res.status(200).json({ success: false, error: 'Corpo da requisição inválido' });
      }

      console.log(logLabel + ':', JSON.stringify(safeLogBody(body)));

      return await businessFn(body, req, res);
    } catch (error) {
      // Loga o detalhe (truncado, sem PII) mas nao devolve internals ao chamador.
      console.error(
        'ERRO GERAL status:',
        error.response?.status,
        'detalhe:',
        truncate(error.response?.data || error.message)
      );
      return res.status(500).json({ success: false, error: 'Erro interno ao processar a requisição' });
    }
  };
}

module.exports = { createWebhookHandler };
