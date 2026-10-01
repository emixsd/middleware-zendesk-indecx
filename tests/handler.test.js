const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createWebhookHandler } = require('../lib/handler');
const { signZendesk } = require('../lib/security');

const SIGNING_ENV = 'TEST_SIGNING_SECRET';

// Captura console.* durante fn, sem poluir a saida do teste.
async function captureConsole(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  for (const k of Object.keys(saved)) {
    console[k] = (...args) => lines.push(args.join(' '));
  }
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

function makeHandler(business) {
  const calls = [];
  const handler = createWebhookHandler(
    business ||
      (async (body, req, res) => {
        calls.push(body);
        return res.status(200).json({ success: true, recebido: body });
      }),
    { signingSecretEnv: SIGNING_ENV, healthMessage: 'ok-teste' }
  );
  return { handler, calls };
}

// Servidor Node puro = mesmo cenario da Vercel com NODEJS_HELPERS=0
// (sem req.body, sem res.status/res.json).
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] == null) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] == null) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

const RAW = '{\n  "ticket_id": "123",\n  "tag_pesquisa": "p-indecx2"\n}';

test('sem helpers: GET responde health-check', async () => {
  const { handler } = makeHandler();
  await withServer(handler, async (base) => {
    const r = await fetch(base);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: 'ok', message: 'ok-teste' });
  });
});

test('sem helpers: metodo nao suportado recebe 405', async () => {
  const { handler } = makeHandler();
  await withServer(handler, async (base) => {
    const r = await fetch(base, { method: 'PUT', body: '{}' });
    assert.equal(r.status, 405);
  });
});

test('sem helpers: header fixo (legado) continua funcionando', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: null }, () =>
    withServer(handler, async (base) => {
      const { result: r } = await captureConsole(() =>
        fetch(base, { method: 'POST', headers: { 'X-Webhook-Secret': 'fixo' }, body: RAW })
      );
      assert.equal(r.status, 200);
      assert.deepEqual(calls[0], { ticket_id: '123', tag_pesquisa: 'p-indecx2' });
    })
  );
});

test('sem helpers: sem segredo recebe 401 e nao chama o negocio', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: null }, () =>
    withServer(handler, async (base) => {
      const { result: r, lines } = await captureConsole(() =>
        fetch(base, { method: 'POST', body: RAW })
      );
      assert.equal(r.status, 401);
      assert.equal(calls.length, 0);
      assert.ok(lines.some((l) => l.includes('WEBHOOK NAO AUTORIZADO')));
    })
  );
});

test('sem helpers: assinatura Zendesk valida sobre o corpo bruto e aceita', async () => {
  const { handler, calls } = makeHandler();
  const ts = new Date().toISOString();
  await withEnv({ WEBHOOK_SECRET: null, [SIGNING_ENV]: 'chave-zd' }, () =>
    withServer(handler, async (base) => {
      const { result: r } = await captureConsole(() =>
        fetch(base, {
          method: 'POST',
          headers: {
            'X-Zendesk-Webhook-Signature': signZendesk('chave-zd', ts, RAW),
            'X-Zendesk-Webhook-Signature-Timestamp': ts
          },
          body: RAW
        })
      );
      assert.equal(r.status, 200);
      assert.equal(calls.length, 1);
    })
  );
});

test('sem helpers: assinatura configurada ignora o header fixo', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: 'chave-zd' }, () =>
    withServer(handler, async (base) => {
      const { result: r } = await captureConsole(() =>
        fetch(base, { method: 'POST', headers: { 'X-Webhook-Secret': 'fixo' }, body: RAW })
      );
      assert.equal(r.status, 401);
      assert.equal(calls.length, 0);
    })
  );
});

test('sem helpers: corpo acima do limite recebe 413', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo' }, () =>
    withServer(handler, async (base) => {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'X-Webhook-Secret': 'fixo' },
        body: 'x'.repeat(200 * 1024)
      });
      assert.equal(r.status, 413);
      assert.equal(calls.length, 0);
    })
  );
});

test('sem helpers: JSON invalido autenticado responde erro de corpo', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: null }, () =>
    withServer(handler, async (base) => {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'X-Webhook-Secret': 'fixo' },
        body: '{quebrado'
      });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).success, false);
      assert.equal(calls.length, 0);
    })
  );
});

test('erro do negocio: 500 generico e log sem PII', async () => {
  const { handler } = makeHandler(async () => {
    const err = new Error('falhou');
    err.response = {
      status: 400,
      data: { customers: [{ nome: 'Maria Silva', email: 'maria@exemplo.com', telefone: '5511999998888' }] }
    };
    throw err;
  });
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: null }, () =>
    withServer(handler, async (base) => {
      const { result: r, lines } = await captureConsole(() =>
        fetch(base, { method: 'POST', headers: { 'X-Webhook-Secret': 'fixo' }, body: RAW })
      );
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), {
        success: false,
        error: 'Erro interno ao processar a requisição'
      });
      const log = lines.join('\n');
      assert.ok(log.includes('ERRO GERAL'));
      assert.ok(!log.includes('maria@exemplo.com'));
      assert.ok(!log.includes('Maria Silva'));
      assert.ok(!log.includes('5511999998888'));
    })
  );
});

// --- Com helpers da Vercel (padrao de hoje): req.body pronto, res.status/json.

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(k, v) {
      this.headers[k] = v;
    },
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

test('com helpers: header fixo funciona com req.body ja parseado', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: null }, async () => {
    const res = fakeRes();
    const req = {
      method: 'POST',
      headers: { 'x-webhook-secret': 'fixo' },
      body: { ticket_id: '1', tag_pesquisa: 'p-indecx1' }
    };
    await captureConsole(() => handler(req, res));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls[0], { ticket_id: '1', tag_pesquisa: 'p-indecx1' });
  });
});

test('com helpers: assinatura configurada vira erro de config (pede NODEJS_HELPERS=0)', async () => {
  const { handler, calls } = makeHandler();
  await withEnv({ WEBHOOK_SECRET: 'fixo', [SIGNING_ENV]: 'chave-zd' }, async () => {
    const res = fakeRes();
    const req = { method: 'POST', headers: {}, body: { ticket_id: '1' } };
    const { lines } = await captureConsole(() => handler(req, res));
    assert.equal(res.statusCode, 401);
    assert.equal(calls.length, 0);
    assert.ok(lines.some((l) => l.includes('ERRO DE CONFIG') && l.includes('NODEJS_HELPERS=0')));
  });
});
