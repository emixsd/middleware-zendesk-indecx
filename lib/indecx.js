const { http } = require('./http');
const { safeDetail } = require('./log');

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
  const link = escolherLink(customer);

  if (!link) {
    // A resposta ecoa o cliente (nome, email, telefone): so com PII mascarada.
    console.error('INDECX RESPOSTA SEM LINK. status:', response.status, 'body:', safeDetail(response.data));
    throw new Error('IndeCX nao retornou um link de pesquisa valido');
  }

  // Registro do link entregue: sem isso nao da para conferir, pelos logs, qual
  // convite o cliente recebeu quando a IndeCX diz que o link nao vale.
  console.log('INDECX LINK GERADO action:', actionId, 'link:', link);

  return link;
}

// Primeiro link https entre os campos conhecidos. Se a IndeCX so devolver http,
// usa mesmo assim (bloquear derrubaria todo envio) e deixa o aviso no log.
function escolherLink(customer) {
  const candidatos = [customer.shortUrl, customer.url, customer.inviteUrl, customer.link]
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim());

  const https = candidatos.find((v) => /^https:\/\/\S+$/i.test(v));
  if (https) return https;

  const http = candidatos.find((v) => /^http:\/\/\S+$/i.test(v));
  if (http) {
    console.warn('INDECX LINK SEM HTTPS — enviado assim mesmo:', http);
    return http;
  }

  return null;
}

module.exports = { gerarLinkPesquisa, escolherLink };
