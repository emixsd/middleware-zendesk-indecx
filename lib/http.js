const axios = require('axios');

// Timeout unico para todas as chamadas externas. Sem isso, uma dependencia
// lenta segura a funcao ate o timeout da plataforma.
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS) || 10000;

const http = axios.create({ timeout: HTTP_TIMEOUT_MS });

module.exports = { http, HTTP_TIMEOUT_MS };
