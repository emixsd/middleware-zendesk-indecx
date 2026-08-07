const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Comparacao em tempo constante sobre hashes SHA-256: nao vaza tamanho nem
// tempo de comparacao do segredo.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Ativacao gradual: enquanto WEBHOOK_SECRET nao estiver definida, a autenticacao
// NAO e aplicada (modo legado, mesmo comportamento de antes). Assim o deploy nao
// derruba a integracao; a protecao liga quando a env for configurada e o Zendesk
// passar a enviar o header X-Webhook-Secret.
function isAuthorized(req) {
  if (!WEBHOOK_SECRET) return true;
  const provided = req.headers['x-webhook-secret'];
  if (!provided || typeof provided !== 'string') return false;
  return timingSafeEqualStr(provided, WEBHOOK_SECRET);
}

function authEnabled() {
  return Boolean(WEBHOOK_SECRET);
}

module.exports = { isAuthorized, authEnabled };
