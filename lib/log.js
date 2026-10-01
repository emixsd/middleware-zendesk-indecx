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

// Chaves cujo valor e dado pessoal. `name` sozinho fica de fora de proposito:
// em corpo de erro costuma ser o tipo do erro ("ValidationError"), util no log.
const PII_KEY_RE =
  /e-?mail|telefone|phone|celular|whatsapp|nome|first_?name|last_?name|full_?name|display_?name|given_?name|surname|cpf|documento/i;
const EMAIL_RE = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi;
// 10 a 13 digitos seguidos = telefone com DDD/DDI. Nao pega ticket id (ate 9)
// nem id de ticket field (14), que sao uteis para depurar.
const PHONE_RE = /(?<!\d)\+?\d{10,13}(?!\d)/g;

function redactString(s) {
  return s.replace(EMAIL_RE, maskEmail).replace(PHONE_RE, maskPhone);
}

function maskByKey(value) {
  if (value == null || value === '') return value;
  const s = String(value);
  if (s.includes('@')) return maskEmail(s);
  if (/^\+?[\d\s().-]{8,}$/.test(s)) return maskPhone(s);
  return '***';
}

// Copia profunda de um valor qualquer (tipicamente o corpo de resposta de uma
// API externa) com dados pessoais mascarados. As APIs da IndeCX, do Smooch e
// do Zendesk ecoam o cliente nos corpos de resposta e de erro, entao nada que
// venha delas vai para o log sem passar por aqui.
function redactDeep(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (depth > 6) return '[profundidade]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, depth + 1, seen));
  }

  const out = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    out[key] =
      PII_KEY_RE.test(key) && (typeof v === 'string' || typeof v === 'number')
        ? maskByKey(v)
        : redactDeep(v, depth + 1, seen);
  }
  return out;
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

// Forma unica de logar o detalhe de um erro/resposta externa: mascara PII e
// depois trunca. Use esta em vez de truncate() direto em dados de terceiros.
function safeDetail(value, max = 500) {
  return truncate(redactDeep(value), max);
}

module.exports = { maskEmail, maskPhone, safeLogBody, redactDeep, truncate, safeDetail };
