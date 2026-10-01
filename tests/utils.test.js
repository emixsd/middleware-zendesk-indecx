const test = require('node:test');
const assert = require('node:assert/strict');
const { redactDeep, safeDetail, safeLogBody } = require('../lib/log');
const { sanitizeNome } = require('../lib/request');
const { valorLimpo } = require('../lib/payload');
const dedupe = require('../lib/dedupe');
const { escolherLink } = require('../lib/indecx');
const { escolherCorpo } = require('../api/email');

// --- log

test('redactDeep mascara PII por chave e por conteudo, em qualquer profundidade', () => {
  const out = redactDeep({
    customers: [{ nome: 'Maria Silva', email: 'maria@exemplo.com', telefone: '5511999998888' }],
    error: { name: 'ValidationError', message: 'contato maria@exemplo.com / 31998807069 invalido' }
  });
  const s = JSON.stringify(out);
  assert.ok(!s.includes('Maria Silva'));
  assert.ok(!s.includes('maria@exemplo.com'));
  assert.ok(!s.includes('5511999998888'));
  assert.ok(!s.includes('31998807069'));
  assert.equal(out.customers[0].email, 'm***@exemplo.com');
  assert.equal(out.customers[0].telefone, '***8888');
  // Tipo do erro continua legivel.
  assert.equal(out.error.name, 'ValidationError');
});

test('redactDeep preserva ids uteis para depurar', () => {
  const s = safeDetail({ ticket: '1234567', field: 'ticket_field_32121203189139 invalido' });
  assert.ok(s.includes('1234567'));
  assert.ok(s.includes('32121203189139'));
});

test('redactDeep aguenta referencia circular', () => {
  const a = { x: 1 };
  a.self = a;
  assert.doesNotThrow(() => safeDetail(a));
});

test('safeLogBody mascara os campos do cliente', () => {
  const out = safeLogBody({ cliente_nome: 'Ana', cliente_email: 'ana@x.com', cliente_telefone: '31 99999-1234', ticket_id: '9' });
  assert.deepEqual(out, { cliente_nome: '***', cliente_email: 'a***@x.com', cliente_telefone: '***1234', ticket_id: '9' });
});

// --- sanitizeNome

test('sanitizeNome mantem nome normal (com acento)', () => {
  assert.equal(sanitizeNome('  José da Conceição '), 'José da Conceição');
});

test('sanitizeNome remove URL, dominio solto e quebra de linha', () => {
  const n = sanitizeNome('Maria\n\nSeu reembolso esta pendente acesse https://golpe.io/x ou golpe.com.br/pagar');
  assert.ok(!/https?:|golpe\.|\n/.test(n), n);
});

test('sanitizeNome limita o tamanho e cai no fallback quando sobra nada', () => {
  assert.equal(sanitizeNome('a'.repeat(500)).length, 60);
  assert.equal(sanitizeNome('https://x.com'), 'Cliente');
  assert.equal(sanitizeNome('', 'Agente'), 'Agente');
  assert.equal(sanitizeNome(undefined), 'Cliente');
});

test('valorLimpo limita o tamanho dos campos repassados', () => {
  assert.equal(valorLimpo('x'.repeat(1000)).length, 200);
  assert.equal(valorLimpo('  abc '), 'abc');
});

// --- dedupe

test('umaVezPorJanela: segundo envio igual e ignorado', async () => {
  dedupe._resetParaTeste();
  let n = 0;
  const fn = async () => ++n;
  assert.deepEqual(await dedupe.umaVezPorJanela('k', fn), { duplicado: false, resultado: 1 });
  assert.deepEqual(await dedupe.umaVezPorJanela('k', fn), { duplicado: true });
  assert.equal(n, 1);
  // Outra chave (outro ticket) passa normalmente.
  assert.equal((await dedupe.umaVezPorJanela('k2', fn)).duplicado, false);
});

test('umaVezPorJanela: falha libera para nova tentativa', async () => {
  dedupe._resetParaTeste();
  await assert.rejects(dedupe.umaVezPorJanela('k', async () => { throw new Error('x'); }));
  assert.equal((await dedupe.umaVezPorJanela('k', async () => 1)).duplicado, false);
});

test('umaVezPorJanela: envios simultaneos, so um executa', async () => {
  dedupe._resetParaTeste();
  let n = 0;
  const lento = () => new Promise((r) => setTimeout(() => r(++n), 20));
  const [a, b] = await Promise.all([dedupe.umaVezPorJanela('k', lento), dedupe.umaVezPorJanela('k', lento)]);
  assert.equal(n, 1);
  assert.equal([a, b].filter((x) => x.duplicado).length, 1);
});

test('dedupe: chave libera depois da janela', () => {
  dedupe._resetParaTeste();
  const t0 = 1_000_000;
  assert.equal(dedupe.reservar('k', t0), true);
  dedupe.confirmar('k', t0);
  assert.equal(dedupe.reservar('k', t0 + dedupe.JANELA_MS - 1), false);
  assert.equal(dedupe.reservar('k', t0 + dedupe.JANELA_MS + 1), true);
});

// --- link IndeCX

test('escolherLink prefere https e respeita a ordem dos campos', () => {
  assert.equal(escolherLink({ shortUrl: 'https://s.indecx/a', url: 'https://x/b' }), 'https://s.indecx/a');
  assert.equal(escolherLink({ shortUrl: 'http://s/a', url: 'https://x/b' }), 'https://x/b');
});

test('escolherLink aceita http como ultimo recurso e rejeita lixo', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(escolherLink({ shortUrl: 'http://s/a' }), 'http://s/a');
  } finally {
    console.warn = warn;
  }
  assert.equal(escolherLink({ shortUrl: 'javascript:alert(1)' }), null);
  assert.equal(escolherLink({}), null);
});

// --- email

test('escolherCorpo: tipos conhecidos e fallback neutro', () => {
  assert.equal(escolherCorpo('p-reem-ap').usouNeutro, false);
  assert.equal(escolherCorpo('p-reem-neg').usouNeutro, false);
  assert.equal(escolherCorpo('').tipoUsado, 'neutro');
  assert.equal(escolherCorpo('constructor').tipoUsado, 'neutro');
});
