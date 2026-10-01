const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorize,
  parseSecrets,
  signZendesk,
  MAX_SIGNATURE_AGE_MS
} = require('../lib/security');

const SECRET = 'segredo-zendesk';
const NOW = Date.parse('2026-10-01T12:00:00Z');
const TS = '2026-10-01T12:00:00Z';
// Corpo como o trigger manda: indentado, com quebras de linha.
const RAW = '{\n  "ticket_id": "123",\n  "tag_pesquisa": "p-indecx2"\n}';

function signedReq(secret = SECRET, ts = TS, raw = RAW) {
  return {
    headers: {
      'x-zendesk-webhook-signature': signZendesk(secret, ts, raw),
      'x-zendesk-webhook-signature-timestamp': ts
    }
  };
}

const signing = (extra = {}) => ({
  rawBody: RAW,
  signingSecrets: [SECRET],
  staticSecrets: [],
  now: NOW,
  ...extra
});

test('parseSecrets aceita lista separada por virgula e ignora vazios', () => {
  assert.deepEqual(parseSecrets(' novo , antigo ,, '), ['novo', 'antigo']);
  assert.deepEqual(parseSecrets(undefined), []);
});

test('assinatura Zendesk valida e aceita', () => {
  assert.deepEqual(authorize(signedReq(), signing()), { ok: true });
});

test('assinatura com segredo errado e rejeitada', () => {
  const r = authorize(signedReq('outro'), signing());
  assert.equal(r.ok, false);
  assert.match(r.motivo, /invalida/);
});

test('corpo adulterado depois de assinado e rejeitado', () => {
  const r = authorize(signedReq(), signing({ rawBody: RAW.replace('123', '999') }));
  assert.equal(r.ok, false);
});

test('assinatura antiga (replay) e rejeitada', () => {
  const r = authorize(signedReq(), signing({ now: NOW + MAX_SIGNATURE_AGE_MS + 1000 }));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /janela/);
});

test('timestamp ilegivel e rejeitado', () => {
  const r = authorize(signedReq(SECRET, 'ontem'), signing());
  assert.equal(r.ok, false);
});

test('sem headers de assinatura e rejeitado', () => {
  const r = authorize({ headers: {} }, signing());
  assert.equal(r.ok, false);
  assert.match(r.motivo, /ausente/);
});

test('troca de segredo: aceita qualquer um da lista', () => {
  const opts = signing({ signingSecrets: ['novo', SECRET] });
  assert.equal(authorize(signedReq(), opts).ok, true);
});

test('com assinatura configurada, o header fixo nao basta', () => {
  const req = { headers: { 'x-webhook-secret': 'fixo' } };
  const r = authorize(req, signing({ staticSecrets: ['fixo'] }));
  assert.equal(r.ok, false);
});

test('assinatura configurada sem corpo bruto e erro de config', () => {
  const r = authorize(signedReq(), signing({ rawBody: null }));
  assert.equal(r.ok, false);
  assert.equal(r.config, true);
  assert.match(r.motivo, /NODEJS_HELPERS=0/);
});

test('modo legado: header fixo valido e aceito, invalido rejeitado', () => {
  const opts = { rawBody: null, signingSecrets: [], staticSecrets: ['fixo', 'proximo'] };
  assert.equal(authorize({ headers: { 'x-webhook-secret': 'fixo' } }, opts).ok, true);
  assert.equal(authorize({ headers: { 'x-webhook-secret': 'proximo' } }, opts).ok, true);
  assert.equal(authorize({ headers: { 'x-webhook-secret': 'errado' } }, opts).ok, false);
  assert.equal(authorize({ headers: {} }, opts).ok, false);
});

test('sem nenhum segredo configurado: fail-closed com erro de config', () => {
  const r = authorize({ headers: { 'x-webhook-secret': 'x' } }, {
    rawBody: RAW,
    signingSecrets: [],
    staticSecrets: []
  });
  assert.equal(r.ok, false);
  assert.equal(r.config, true);
});
