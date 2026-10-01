// Endpoint de email: gera link IndeCX e publica como comentario PUBLICO no
// ticket (o Zendesk dispara o email). Portado do middleware RECX, usando a
// mesma lib compartilhada de ../lib.
const { createWebhookHandler } = require('../lib/handler');
const { gerarLinkPesquisa } = require('../lib/indecx');
const { addTicketComment } = require('../lib/zendesk');
const { resolveMapped, isValidTicketId, sanitizeNome } = require('../lib/request');
const { atribuirSePreenchido } = require('../lib/payload');
const { umaVezPorJanela } = require('../lib/dedupe');
const { truncate } = require('../lib/log');

// TODO: substituir pelos valores reais quando tiver.
const TAG_TO_ACTION = {
  'pesquisa-reembolso': 'L85YSV7C'
};

const CORPOS_EMAIL = {
  'p-reem-ap': (nome, link) =>
    `Olá, ${nome}!\n\n` +
    `Sua solicitação de reembolso foi concluída.\n` +
    `Queremos muito saber como foi sua experiência com o nosso atendimento.\n\n` +
    `Sua opinião é essencial para melhorarmos cada vez mais!\n\n` +
    `👉 Avaliar experiência: ${link}`,

  'p-reem-neg': (nome, link) =>
    `Olá, ${nome}!\n\n` +
    `Sua solicitação de reembolso foi finalizada.\n` +
    `Sabemos que esse pode não ter sido o resultado esperado, e por isso sua opinião é muito importante para nós. ` +
    `Conte como foi sua experiência com o nosso atendimento.\n\n` +
    `👉 Avaliar experiência: ${link}`
};

// Fallback para `tipo_mensagem` ausente ou desconhecido. Nao afirma nenhum
// resultado (nem aprovado nem negado), so pede a avaliacao do atendimento —
// assim serve para os dois casos sem risco de mandar a mensagem errada.
const CORPO_NEUTRO = (nome, link) =>
  `Olá, ${nome}!\n\n` +
  `A análise da sua solicitação de reembolso foi finalizada.\n` +
  `Queremos muito saber como foi sua experiência com o nosso atendimento.\n\n` +
  `Sua opinião é essencial para melhorarmos cada vez mais!\n\n` +
  `👉 Avaliar experiência: ${link}`;

// Escolhe o corpo do email a partir de `tipo_mensagem`. Funcao pura e exportada
// para teste — a decisao de qual texto vai para o cliente e o ponto de maior
// consequencia deste endpoint.
//
// Retorna { templateFn, usouNeutro, tipoUsado }.
function escolherCorpo(tipoMensagem) {
  const templateFn = resolveMapped(CORPOS_EMAIL, tipoMensagem);
  if (templateFn) {
    return { templateFn, usouNeutro: false, tipoUsado: tipoMensagem };
  }
  return { templateFn: CORPO_NEUTRO, usouNeutro: true, tipoUsado: 'neutro' };
}

async function handle(body, req, res) {
  const {
    ticket_id,
    cliente_nome,
    cliente_email,
    cliente_telefone,
    tag_pesquisa,
    tipo_mensagem,
    brand,
    codigo_notro,
    destino_viagem,
    analista
  } = body;

  const actionId = resolveMapped(TAG_TO_ACTION, tag_pesquisa);

  if (!actionId) {
    return res.status(200).json({ success: false, error: 'Tag não mapeada' });
  }

  if (!ticket_id) {
    return res.status(200).json({ success: false, error: 'Ticket ID não informado' });
  }
  if (!isValidTicketId(ticket_id)) {
    return res.status(200).json({ success: false, error: 'Ticket ID inválido' });
  }

  // Mesmo nome limpo no IndeCX e no texto do email publico.
  const nome = sanitizeNome(cliente_nome, 'Cliente');

  // Vazio nao entra no payload (igual ao fluxo WhatsApp): no IndeCX o
  // indicador fica sem valor, em vez de com "".
  const dadosIndecx = { nome };
  atribuirSePreenchido(dadosIndecx, {
    TicketID: ticket_id,
    brand,
    codigo_notro,
    destino_viagem,
    analista,
    email: cliente_email,
    telefone: String(cliente_telefone || '').replace(/\D/g, '')
  });

  const { templateFn, usouNeutro, tipoUsado } = escolherCorpo(tipo_mensagem);

  if (usouNeutro) {
    // Nao deve acontecer em operacao normal: indica campo vazio no gatilho do
    // Zendesk ou tipo novo sem template. O email sai (neutro), mas fica o aviso
    // para nao passar meses mandando neutro sem ninguem notar.
    console.warn(
      'TIPO_MENSAGEM NAO RECONHECIDO — usando corpo neutro. recebido:',
      truncate(tipo_mensagem, 60)
    );
  }

  const chave = 'email:' + tag_pesquisa + ':' + ticket_id;
  const envio = await umaVezPorJanela(chave, async () => {
    const link = await gerarLinkPesquisa(actionId, dadosIndecx);
    await addTicketComment(ticket_id, { body: templateFn(nome, link), public: true });
    return link;
  });

  if (envio.duplicado) {
    console.warn('ENVIO REPETIDO IGNORADO:', chave);
    return res.status(200).json({
      success: true,
      duplicado: true,
      message: 'Pesquisa ja enviada para este ticket nos ultimos minutos; reenvio ignorado.'
    });
  }

  return res.status(200).json({
    success: true,
    actionId,
    link: envio.resultado,
    tipoMensagemUsado: tipoUsado,
    message: 'Comentário adicionado no ticket — email enviado pelo Zendesk!'
  });
}

module.exports = createWebhookHandler(handle, {
  logLabel: 'REQUISIÇÃO RECEBIDA (email)',
  healthMessage: 'Middleware Zendesk-IndeCX (email) funcionando!',
  signingSecretEnv: 'ZENDESK_EMAIL_SIGNING_SECRET'
});

// Exportado apenas para teste. A Vercel usa o module.exports (a funcao handler)
// e ignora propriedades extras penduradas nela.
module.exports.escolherCorpo = escolherCorpo;
