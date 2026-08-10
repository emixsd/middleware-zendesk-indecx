const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Comparacao em tempo constante sobre hashes SHA-256: nao vaza tamanho nem
// tempo de comparacao do segredo.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Fail-closed: sem WEBHOOK_SECRET definida, TUDO e rejeitado. O modo legado
// (liberar quando a env faltava) existia so para nao derrubar a integracao
// durante a ativacao; com a env ja configurada em producao, ele viraria uma
// porta que reabre sozinha se alguem remover a variavel ou subir um ambiente
// novo sem ela. Erro de config agora aparece como 401 + log, nao como acesso
// liberado em silencio.
function isAuthorized(req) {
  if (!WEBHOOK_SECRET) return false;
  const provided = req.headers['x-webhook-secret'];
  if (!provided || typeof provided !== 'string') return false;
  return timingSafeEqualStr(provided, WEBHOOK_SECRET);
}

function authEnabled() {
  return Boolean(WEBHOOK_SECRET);
}

module.exports = { isAuthorized, authEnabled };
