const { authorize, parseSecrets } = require('./security');
const { getRequestBody, parseJsonObject } = require('./request');
const { safeLogBody, safeDetail } = require('./log');

// Payload do trigger tem poucos KB. Limite folgado, so para nao bufferizar
// lixo arbitrario antes da autenticacao.
const MAX_BODY_BYTES = 100 * 1024;

class BodyTooLargeError extends Error {}

// Com os helpers da Vercel ligados (padrao), a plataforma ja leu e parseou o
// corpo em req.body e adicionou res.status/res.json; o corpo bruto se perde.
// Com NODEJS_HELPERS=0, nada disso existe e o corpo fica no stream.
function vercelHelpersAtivos(res) {
  return typeof res.status === 'function' && typeof res.json === 'function';
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Acima do limite, continua lendo e descartando em vez de derrubar o
    // socket: assim o chamador recebe o 413 em vez de conexao resetada. A
    // Vercel ja corta corpos muito grandes antes de chegar aqui.
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) reject(new BodyTooLargeError());
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// Os endpoints usam res.status().json(); sem helpers, cria o equivalente.
function ensureResHelpers(res) {
  if (typeof res.status !== 'function') {
    res.status = function status(code) {
      this.statusCode = code;
      return this;
    };
  }
  if (typeof res.json !== 'function') {
    res.json = function json(obj) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(obj));
      return this;
    };
  }
}

// Envolve a logica de negocio de cada endpoint com o comportamento comum:
// health-check GET, 405, autenticacao, parse+redacao do body e 500 generico.
//
//   businessFn(body, req, res) -> deve responder (res.json) ou lancar erro.
//   options.signingSecretEnv -> env com a chave secreta do webhook no Zendesk.
//     Cada endpoint tem a sua: vazar a de um nao abre o outro.
function createWebhookHandler(businessFn, options = {}) {
  const logLabel = options.logLabel || 'DADOS RECEBIDOS';
  const healthMessage = options.healthMessage || 'Middleware Zendesk-IndeCX funcionando!';
  const signingSecretEnv = options.signingSecretEnv;

  return async (req, res) => {
    const helpers = vercelHelpersAtivos(res);
    ensureResHelpers(res);

    if (req.method === 'GET') {
      return res.status(200).json({ status: 'ok', message: healthMessage });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Método não permitido' });
    }

    let rawBody = null;
    let body;
    try {
      if (helpers) {
        body = getRequestBody(req);
      } else {
        rawBody = await readRawBody(req);
        body = parseJsonObject(rawBody);
      }
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return res.status(413).json({ success: false, error: 'Corpo da requisição muito grande' });
      }
      body = null;
    }

    // Envs lidas por requisicao: barato, e testavel sem recarregar o modulo.
    const auth = authorize(req, {
      rawBody,
      signingSecrets: parseSecrets(signingSecretEnv && process.env[signingSecretEnv]),
      staticSecrets: parseSecrets(process.env.WEBHOOK_SECRET)
    });

    if (!auth.ok) {
      if (auth.config) {
        console.error(
          'ERRO DE CONFIG: ' + auth.motivo + ' — todas as requisicoes POST serao rejeitadas com 401.'
        );
      } else {
        console.warn('WEBHOOK NAO AUTORIZADO: ' + auth.motivo);
      }
      return res.status(401).json({ success: false, error: 'Não autorizado' });
    }

    try {
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
        safeDetail(error.response?.data || error.message)
      );
      return res.status(500).json({ success: false, error: 'Erro interno ao processar a requisição' });
    }
  };
}

module.exports = { createWebhookHandler, MAX_BODY_BYTES };
