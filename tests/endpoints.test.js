// Fluxo completo dos dois endpoints com IndeCX, Smooch e Zendesk simulados.
// As envs precisam existir antes do require: os modulos de lib/ leem na carga.
process.env.INDECX_COMPANY_KEY = 'ck';
process.env.SMOOCH_APP_ID = 'app';
process.env.SMOOCH_KEY_ID = 'kid';
process.env.SMOOCH_SECRET = 'ss';
process.env.ZENDESK_SUBDOMAIN = 'hero';
process.env.ZENDESK_EMAIL = 'bot@hero.com';
process.env.ZENDESK_API_TOKEN = 'zt';
process.env.WEBHOOK_SECRET = 'fixo';

const test = require('node:test');
const assert = require('node:assert/strict');
const { http } = require('../lib/http');
const dedupe = require('../lib/dedupe');
const webhook = require('../api/webhook');
const email = require('../api/email');

let chamadas;

function stubApis({ link = 'https://indecx.com/s/abc' } = {}) {
  chamadas = [];
  http.get = async (url) => {
    chamadas.push({ metodo: 'GET', url });
    return { status: 200, data: { authToken: 'tok' } };
  };
  http.post = async (url, body) => {
    chamadas.push({ metodo: 'POST', url, body });
    if (url.includes('/invites')) return { status: 200, data: { customers: [{ shortUrl: link }] } };
    return { status: 201, data: {} };
  };
  http.put = async (url, body) => {
    chamadas.push({ metodo: 'PUT', url, body });
    return { status: 200, data: {} };
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    payload: undefined,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.payload = obj;
      return this;
    }
  };
}

async function chamar(handler, body) {
  const res = fakeRes();
  const req = { method: 'POST', headers: { 'x-webhook-secret': 'fixo' }, body };
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const linhas = [];
  console.log = console.warn = console.error = (...a) => linhas.push(a.join(' '));
  try {
    await handler(req, res);
  } finally {
    Object.assign(console, saved);
  }
  return { res, linhas };
}

const bodyWhats = {
  ticket_id: '555',
  cliente_nome: 'Maria\nacesse golpe.com',
  cliente_email: 'maria@exemplo.com',
  cliente_telefone: '+55 (11) 99999-8888',
  tag_pesquisa: 'p-indecx2',
  brand: 'Hero',
  codigo_notro: '',
  conversation_id: 'abc123'
};

test('webhook: gera link, envia no WhatsApp e registra o link no log', async () => {
  dedupe._resetParaTeste();
  stubApis();
  const { res, linhas } = await chamar(webhook, bodyWhats);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.link, 'https://indecx.com/s/abc');

  const invite = chamadas.find((c) => c.url.includes('/actions/BSV2R4NX/invites'));
  assert.deepEqual(invite.body, {
    customers: [
      {
        nome: 'Maria acesse',
        TicketID: '555',
        brand: 'Hero',
        email: 'maria@exemplo.com',
        telefone: '5511999998888'
      }
    ]
  });

  const smooch = chamadas.find((c) => c.url.includes('api.smooch.io'));
  assert.equal(smooch.body.content.actions[0].uri, 'https://indecx.com/s/abc');

  const log = linhas.join('\n');
  assert.ok(log.includes('INDECX LINK GERADO action: BSV2R4NX link: https://indecx.com/s/abc'));
  assert.ok(!log.includes('maria@exemplo.com'));
});

test('webhook: reenvio do mesmo ticket e ignorado sem chamar as APIs', async () => {
  dedupe._resetParaTeste();
  stubApis();
  await chamar(webhook, bodyWhats);
  const antes = chamadas.length;

  const { res } = await chamar(webhook, bodyWhats);
  assert.equal(res.payload.duplicado, true);
  assert.equal(chamadas.length, antes);
});

test('webhook: nota interna (p-indecx11-m) escapa o link no HTML', async () => {
  dedupe._resetParaTeste();
  stubApis({ link: 'https://indecx.com/s/a"b' });
  const { res } = await chamar(webhook, {
    ticket_id: '777',
    tag_pesquisa: 'p-indecx11-m',
    cliente_email: 'x@y.com',
    analista: 'Joana'
  });
  assert.equal(res.statusCode, 200);
  const put = chamadas.find((c) => c.metodo === 'PUT');
  assert.equal(put.body.ticket.comment.public, false);
  assert.ok(put.body.ticket.comment.html_body.includes('https://indecx.com/s/a&quot;b'));
});

test('email: comentario publico com nome limpo e sem campos vazios no IndeCX', async () => {
  dedupe._resetParaTeste();
  stubApis();
  const { res } = await chamar(email, {
    ticket_id: '888',
    cliente_nome: 'Ana, seu reembolso esta pendente, acesse https://golpe.io',
    cliente_email: 'cliente@pesqeuisa.com',
    tag_pesquisa: 'pesquisa-reembolso',
    tipo_mensagem: 'p-reem-neg',
    brand: 'Hero',
    codigo_notro: '',
    destino_viagem: '',
    analista: ''
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.tipoMensagemUsado, 'p-reem-neg');

  const invite = chamadas.find((c) => c.url.includes('/actions/L85YSV7C/invites'));
  assert.deepEqual(Object.keys(invite.body.customers[0]).sort(), ['TicketID', 'brand', 'email', 'nome']);

  const comentario = chamadas.find((c) => c.metodo === 'PUT').body.ticket.comment;
  assert.equal(comentario.public, true);
  assert.ok(!comentario.body.includes('golpe.io'));
  assert.ok(comentario.body.includes('👉 Avaliar experiência: https://indecx.com/s/abc'));
});

test('falha no envio libera o ticket para o reenvio do Zendesk', async () => {
  dedupe._resetParaTeste();
  stubApis();
  const postOk = http.post;
  http.post = async (url, body) => {
    if (url.includes('api.smooch.io')) {
      const err = new Error('smooch fora');
      err.response = { status: 503, data: {} };
      throw err;
    }
    return postOk(url, body);
  };
  const { res } = await chamar(webhook, bodyWhats);
  assert.equal(res.statusCode, 500);

  stubApis();
  const retry = await chamar(webhook, bodyWhats);
  assert.equal(retry.res.statusCode, 200);
  assert.equal(retry.res.payload.duplicado, undefined);
});
