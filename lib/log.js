// Utilitarios de log com redacao de dados sensiveis (LGPD).

function maskEmail(value) {
  const s = String(value || '');
  if (!s) return '';
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  return s[0] + '***' + s.slice(at);
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return '***' + digits.slice(-4);
}

// Retorna uma copia do body com os campos de PII mascarados, segura para log.
function safeLogBody(body) {
  if (!body || typeof body !== 'object') return body;
  const clone = { ...body };
  if ('cliente_email' in clone) clone.cliente_email = maskEmail(clone.cliente_email);
  if ('cliente_telefone' in clone) clone.cliente_telefone = maskPhone(clone.cliente_telefone);
  if ('cliente_nome' in clone) clone.cliente_nome = clone.cliente_nome ? '***' : '';
  return clone;
}

// Serializa e trunca valores para log de erro, sem despejar payloads gigantes
// nem detalhes internos ilimitados.
function truncate(value, max = 500) {
  let s;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_e) {
    s = String(value);
  }
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + '…(truncated)' : s;
}

module.exports = { maskEmail, maskPhone, safeLogBody, truncate };
