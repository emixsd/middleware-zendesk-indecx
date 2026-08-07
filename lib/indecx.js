const { http } = require('./http');
const { truncate } = require('./log');

const INDECX_COMPANY_KEY = process.env.INDECX_COMPANY_KEY;
const INDECX_BASE_URL = 'https://indecx.com/v3/integrations';
const TOKEN_TTL_MS = 25 * 60 * 1000;

let indecxToken = null;
let tokenExpiry = null;
let tokenPromise = null; // single-flight: evita varias buscas simultaneas

async function fetchIndecxToken() {
  if (!INDECX_COMPANY_KEY) {
    throw new Error('INDECX_COMPANY_KEY nao configurada');
  }

  const response = await http.get(INDECX_BASE_URL + '/authorization/token', {
    headers: { 'Company-Key': INDECX_COMPANY_KEY }
  });

  const token = response.data?.authToken;
  if (!token) {
    throw new Error('IndeCX nao retornou authToken');
  }

  indecxToken = token;
  tokenExpiry = Date.now() + TOKEN_TTL_MS;
  return token;
}

async function getIndecxToken(forceRefresh = false) {
  if (!forceRefresh && indecxToken && tokenExpiry && Date.now() < tokenExpiry) {
    return indecxToken;
  }

  if (!tokenPromise) {
    indecxToken = null;
    tokenExpiry = null;
    tokenPromise = fetchIndecxToken().finally(() => {
      tokenPromise = null;
    });
  }

  return tokenPromise;
}

function postInvite(actionId, dados, token) {
  return http.post(
    INDECX_BASE_URL + '/actions/' + encodeURIComponent(actionId) + '/invites',
    { customers: [dados] },
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }
  );
}

async function gerarLinkPesquisa(actionId, dados) {
  let token = await getIndecxToken();

  let response;
  try {
    response = await postInvite(actionId, dados, token);
  } catch (err) {
    // Token pode expirar antes do TTL local: invalida e tenta 1 vez mais.
    if (err.response?.status === 401) {
      token = await getIndecxToken(true);
      response = await postInvite(actionId, dados, token);
    } else {
      throw err;
    }
  }

  const customer = response.data?.customers?.[0] || {};
  const link = customer.shortUrl || customer.url || customer.inviteUrl || customer.link;

  if (!/^https?:\/\//.test(String(link || ''))) {
    console.error('INDECX RESPOSTA SEM LINK. status:', response.status, 'body:', truncate(response.data));
    throw new Error('IndeCX nao retornou um link de pesquisa valido');
  }

  return link;
}

module.exports = { gerarLinkPesquisa };
