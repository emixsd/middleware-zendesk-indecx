// Bloqueio de envio repetido: mesma pesquisa para o mesmo ticket dentro da
// janela e ignorada.
//
// Cobre o caso real de duplicidade: o envio deu certo mas a resposta nao chegou
// ao Zendesk a tempo (timeout de ~12s), e o Zendesk reenvia o webhook.
//
// MELHOR ESFORCO: o estado fica na memoria da instancia serverless. Reenvio que
// cair em outra instancia (ou depois de um cold start) passa. Para garantia
// total seria preciso um store compartilhado (ex.: Upstash/Vercel KV).

const JANELA_MS = 10 * 60 * 1000;
// Reserva de um envio em andamento. Se a funcao morrer no meio, a chave libera
// sozinha depois disso, em vez de travar o ticket pela janela inteira.
const RESERVA_MS = 60 * 1000;
const MAX_CHAVES = 5000;

const chaves = new Map(); // chave -> expiraEm (ms)

function limparExpiradas(now) {
  for (const [chave, expiraEm] of chaves) {
    if (expiraEm <= now) chaves.delete(chave);
  }
  // Teto de memoria: Map itera em ordem de insercao, descarta as mais antigas.
  while (chaves.size > MAX_CHAVES) {
    chaves.delete(chaves.keys().next().value);
  }
}

// Tenta reservar a chave. false = ja enviado (ou em andamento) na janela.
function reservar(chave, now = Date.now()) {
  limparExpiradas(now);
  if (chaves.has(chave)) return false;
  chaves.set(chave, now + RESERVA_MS);
  return true;
}

// Envio concluido: segura a chave pela janela inteira.
function confirmar(chave, now = Date.now()) {
  chaves.delete(chave);
  chaves.set(chave, now + JANELA_MS);
}

// Envio falhou: libera para o reenvio do Zendesk tentar de novo.
function liberar(chave) {
  chaves.delete(chave);
}

// Executa `fn` uma unica vez por chave dentro da janela.
// Retorna { duplicado: true } sem executar se a chave ja estiver tomada.
async function umaVezPorJanela(chave, fn) {
  if (!reservar(chave)) return { duplicado: true };
  try {
    const resultado = await fn();
    confirmar(chave);
    return { duplicado: false, resultado };
  } catch (err) {
    liberar(chave);
    throw err;
  }
}

function _resetParaTeste() {
  chaves.clear();
}

module.exports = { JANELA_MS, reservar, confirmar, liberar, umaVezPorJanela, _resetParaTeste };
