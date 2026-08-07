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

// Resolve o actionId apenas por chave propria do mapa — evita prototype
// pollution (`__proto__`, `constructor`) driblar o guard de "tag nao mapeada".
function resolveActionId(map, tag) {
  return Object.prototype.hasOwnProperty.call(map, tag) ? map[tag] : undefined;
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
  resolveActionId,
  isValidTicketId,
  isValidConversationId,
  escapeHtml
};
