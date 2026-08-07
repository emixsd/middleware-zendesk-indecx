const { http } = require('./http');
const { truncate } = require('./log');

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

// OAuth (client credentials). Se definidos, tem prioridade sobre o API token.
const ZENDESK_OAUTH_CLIENT_ID = process.env.ZENDESK_OAUTH_CLIENT_ID;
const ZENDESK_OAUTH_CLIENT_SECRET = process.env.ZENDESK_OAUTH_CLIENT_SECRET;
const ZENDESK_OAUTH_SCOPE = process.env.ZENDESK_OAUTH_SCOPE || 'tickets:read tickets:write';

function getZendeskSubdomain() {
  if (!ZENDESK_SUBDOMAIN) {
    throw new Error('Subdominio Zendesk nao configurado');
  }
  return ZENDESK_SUBDOMAIN.replace(/^https?:\/\//, '').replace(/\.zendesk\.com\/?$/, '');
}

function getZendeskHost() {
  return 'https://' + getZendeskSubdomain() + '.zendesk.com';
}

function getZendeskBaseUrl() {
  return getZendeskHost() + '/api/v2';
}

// --- OAuth: token com cache + single-flight (igual ao fluxo IndeCX) ---
let zdToken = null;
let zdExpiry = null;
let zdPromise = null;

function oauthConfigured() {
  return Boolean(ZENDESK_OAUTH_CLIENT_ID && ZENDESK_OAUTH_CLIENT_SECRET);
}

async function fetchZendeskOAuthToken() {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ZENDESK_OAUTH_CLIENT_ID,
    client_secret: ZENDESK_OAUTH_CLIENT_SECRET,
    scope: ZENDESK_OAUTH_SCOPE
  });

  const response = await http.post(getZendeskHost() + '/oauth/tokens', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const token = response.data?.access_token;
  if (!token) {
    throw new Error('Zendesk nao retornou access_token');
  }

  const expiresIn = Number(response.data?.expires_in) || 3600;
  zdToken = token;
  // Renova 60s antes de expirar para nao usar token no limite.
  zdExpiry = Date.now() + Math.max(30, expiresIn - 60) * 1000;
  return token;
}

async function getZendeskOAuthToken(forceRefresh = false) {
  if (!forceRefresh && zdToken && zdExpiry && Date.now() < zdExpiry) {
    return zdToken;
  }
  if (!zdPromise) {
    zdToken = null;
    zdExpiry = null;
    zdPromise = fetchZendeskOAuthToken().finally(() => {
      zdPromise = null;
    });
  }
  return zdPromise;
}

async function getZendeskAuthHeader(forceRefresh = false) {
  if (oauthConfigured()) {
    return 'Bearer ' + (await getZendeskOAuthToken(forceRefresh));
  }
  if (!ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    throw new Error('Credenciais Zendesk nao configuradas (nem OAuth nem API token)');
  }
  const auth = Buffer.from(ZENDESK_EMAIL + '/token:' + ZENDESK_API_TOKEN).toString('base64');
  return 'Basic ' + auth;
}

// Adiciona um comentario a um ticket.
//   comment.htmlBody -> comentario HTML (nota interna rica)
//   comment.body     -> comentario texto puro (email)
//   comment.public   -> true = email/publico, false = nota interna
async function addTicketComment(ticketId, comment) {
  if (!ticketId) {
    throw new Error('Ticket ID nao informado');
  }

  const url = getZendeskBaseUrl() + '/tickets/' + encodeURIComponent(ticketId) + '.json';

  const commentPayload = { public: Boolean(comment.public) };
  if (comment.htmlBody != null) {
    commentPayload.html_body = comment.htmlBody;
  } else {
    commentPayload.body = comment.body;
  }

  const payload = { ticket: { comment: commentPayload } };

  const doPut = (authHeader) =>
    http.put(url, payload, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' }
    });

  try {
    let response;
    try {
      response = await doPut(await getZendeskAuthHeader());
    } catch (err) {
      // Token OAuth pode expirar antes do TTL local: renova e tenta 1 vez mais.
      if (err.response?.status === 401 && oauthConfigured()) {
        response = await doPut(await getZendeskAuthHeader(true));
      } else {
        throw err;
      }
    }

    console.log('ZENDESK OK status:', response.status);
    return response.data;
  } catch (err) {
    console.error('ZENDESK ERRO status:', err.response?.status);
    console.error('ZENDESK ERRO body:', truncate(err.response?.data || err.message));
    throw err;
  }
}

module.exports = { addTicketComment };
