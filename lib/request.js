// Parsing e validacao de entrada compartilhados pelos endpoints.

// Aceita body ja parseado (objeto) ou string JSON (alguns setups entregam raw).
// Retorna null para qualquer coisa que nao seja um objeto plano.
function getRequestBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_e) {
      return null;
    }
  }
  return null;
}

// Resolve um valor apenas por chave propria do mapa — evita que prototype
// pollution (`__proto__`, `constructor`) drible o guard de "nao mapeado" e
// devolva algo herdado de Object.prototype.
function resolveMapped(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function isValidTicketId(value) {
  return /^\d+$/.test(String(value));
}

function isValidConversationId(value) {
  return /^[A-Za-z0-9_-]+$/.test(String(value));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  getRequestBody,
  resolveMapped,
  isValidTicketId,
  isValidConversationId,
  escapeHtml
};
