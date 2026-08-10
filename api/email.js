// Endpoint de email: gera link IndeCX e publica como comentario PUBLICO no
// ticket (o Zendesk dispara o email). Portado do middleware RECX, usando a
// mesma lib compartilhada de ../lib.
const { createWebhookHandler } = require('../lib/handler');
const { gerarLinkPesquisa } = require('../lib/indecx');
const { addTicketComment } = require('../lib/zendesk');
const { resolveMapped, isValidTicketId } = require('../lib/request');
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

  const dadosIndecx = {
    nome: cliente_nome || 'Cliente',
    TicketID: ticket_id,
    brand: brand || '',
    codigo_notro: codigo_notro || '',
    destino_viagem: destino_viagem || '',
    analista: analista || ''
  };

  if ((cliente_email || '').trim()) {
    dadosIndecx.email = cliente_email.trim();
  }

  if (cliente_telefone) {
    dadosIndecx.telefone = String(cliente_telefone).replace(/\D/g, '');
  }

  const linkPesquisa = await gerarLinkPesquisa(actionId, dadosIndecx);

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

  const corpo = templateFn(cliente_nome || 'Cliente', linkPesquisa);

  await addTicketComment(ticket_id, { body: corpo, public: true });

  return res.status(200).json({
    success: true,
    actionId,
    link: linkPesquisa,
    tipoMensagemUsado: tipoUsado,
    message: 'Comentário adicionado no ticket — email enviado pelo Zendesk!'
  });
}

module.exports = createWebhookHandler(handle, {
  logLabel: 'REQUISIÇÃO RECEBIDA (email)',
  healthMessage: 'Middleware Zendesk-IndeCX (email) funcionando!'
});

// Exportado apenas para teste. A Vercel usa o module.exports (a funcao handler)
// e ignora propriedades extras penduradas nela.
module.exports.escolherCorpo = escolherCorpo;
