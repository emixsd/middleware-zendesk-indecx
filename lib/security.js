const crypto = require('crypto');

// Janela aceita entre o timestamp assinado pelo Zendesk e o relogio daqui.
// Requisicao mais velha que isso e tratada como replay.
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

// Le uma env de segredo. Aceita varios valores separados por virgula, para
// trocar o segredo sem janela de 401: cadastra "novo,antigo", atualiza o
// Zendesk e depois remove o antigo.
function parseSecrets(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Comparacao em tempo constante sobre hashes SHA-256: nao vaza tamanho nem
// tempo de comparacao do segredo.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Confere contra todos os segredos, sem sair no primeiro acerto, para o tempo
// nao depender de qual segredo bateu.
function matchesAny(provided, secrets) {
  let ok = false;
  for (const secret of secrets) {
    if (timingSafeEqualStr(provided, secret)) ok = true;
  }
  return ok;
}

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : '';
}

// Modo legado: header X-Webhook-Secret com valor fixo.
function verifyStaticSecret(req, secrets) {
  const provided = header(req, 'x-webhook-secret');
  if (!provided) return { ok: false, motivo: 'header X-Webhook-Secret ausente' };
  if (!matchesAny(provided, secrets)) {
    return { ok: false, motivo: 'header X-Webhook-Secret invalido' };
  }
  return { ok: true };
}

// Assinatura nativa dos webhooks do Zendesk:
//   X-Zendesk-Webhook-Signature = base64(HMAC-SHA256(segredo, timestamp + corpo bruto))
// O corpo tem que ser o bruto, byte a byte: o JSON re-serializado nao bate.
function signZendesk(secret, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(String(timestamp) + rawBody)
    .digest('base64');
}

function verifyZendeskSignature(req, rawBody, secrets, now = Date.now()) {
  const signature = header(req, 'x-zendesk-webhook-signature');
  const timestamp = header(req, 'x-zendesk-webhook-signature-timestamp');

  if (!signature || !timestamp) return { ok: false, motivo: 'assinatura Zendesk ausente' };

  const signedAt = Date.parse(timestamp);
  if (Number.isNaN(signedAt)) return { ok: false, motivo: 'timestamp da assinatura invalido' };
  if (Math.abs(now - signedAt) > MAX_SIGNATURE_AGE_MS) {
    return { ok: false, motivo: 'assinatura fora da janela de 5 min (replay ou relogio)' };
  }

  let ok = false;
  for (const secret of secrets) {
    if (timingSafeEqualStr(signature, signZendesk(secret, timestamp, rawBody))) ok = true;
  }
  return ok ? { ok: true } : { ok: false, motivo: 'assinatura Zendesk invalida' };
}

// Decide se a requisicao e autentica.
//
//   signingSecrets: chave secreta do webhook no Zendesk (uma env por endpoint).
//     Se definida, a assinatura e OBRIGATORIA e o header fixo e ignorado.
//   staticSecrets: WEBHOOK_SECRET (modo legado), usado so sem signingSecrets.
//   rawBody: corpo bruto, ou null se a plataforma ja consumiu (helpers ligados).
//
// Fail-closed: sem nenhum segredo configurado, tudo e rejeitado. `config: true`
// separa erro de configuracao (ninguem consegue chamar) de chamada nao
// autorizada, para o log apontar o lado certo.
function authorize(req, { rawBody, signingSecrets, staticSecrets, now }) {
  if (signingSecrets.length) {
    if (rawBody == null) {
      return {
        ok: false,
        config: true,
        motivo: 'assinatura exige o corpo bruto; defina NODEJS_HELPERS=0 na Vercel'
      };
    }
    return verifyZendeskSignature(req, rawBody, signingSecrets, now);
  }

  if (staticSecrets.length) return verifyStaticSecret(req, staticSecrets);

  return { ok: false, config: true, motivo: 'nenhum segredo configurado' };
}

module.exports = {
  MAX_SIGNATURE_AGE_MS,
  parseSecrets,
  signZendesk,
  verifyZendeskSignature,
  authorize
};
