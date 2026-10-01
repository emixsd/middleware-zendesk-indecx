// Parsing e validacao de entrada compartilhados pelos endpoints.

// Parse de string JSON. Retorna null para JSON invalido ou qualquer coisa que
// nao seja um objeto plano.
function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

// Aceita body ja parseado (objeto) ou string JSON (alguns setups entregam raw).
// Retorna null para qualquer coisa que nao seja um objeto plano.
function getRequestBody(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return parseJsonObject(req.body);
  }
  return null;
}

const NOME_MAX = 60;
const URL_RE = /\b(?:https?:\/\/|www\.)\S*/gi;
// "dominio.tld" solto tambem vira link clicavel no email do Zendesk.
const DOMINIO_RE = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|br|io|app|me|co|ly|xyz|info|site|online|link|top|click|ru|cn)\b\S*/gi;

// O nome vem do requester do Zendesk, que o proprio cliente controla (nome do
// perfil do WhatsApp, "From" do email) e entra no texto do email publico e da
// pesquisa. Sem limpeza, um nome como "Maria, seu reembolso esta pendente,
// acesse site.com" sai num email oficial. Remove URL/dominio, quebra de linha
// e caractere de controle, e limita o tamanho.
function sanitizeNome(value, fallback = 'Cliente') {
  const limpo = String(value == null ? '' : value)
    .replace(URL_RE, ' ')
    .replace(DOMINIO_RE, ' ')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOME_MAX)
    .trim();
  return limpo || fallback;
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
  parseJsonObject,
  getRequestBody,
  sanitizeNome,
  resolveMapped,
  isValidTicketId,
  isValidConversationId,
  escapeHtml
};
