// Montagem do objeto de customer enviado ao IndeCX.

// O body do trigger do Zendesk chega sempre como string: placeholder nao
// preenchido renderiza como string vazia.
function valorLimpo(valor) {
  if (valor == null) return '';
  return String(valor).trim();
}

// Copia para `destino` apenas as chaves com valor preenchido. Campo vazio nao
// entra no payload: no IndeCX o indicador fica sem valor, em vez de com "".
function atribuirSePreenchido(destino, pares) {
  for (const chave of Object.keys(pares)) {
    const limpo = valorLimpo(pares[chave]);
    if (limpo) {
      destino[chave] = limpo;
    }
  }
  return destino;
}

// Le do body as chaves declaradas em `mapa` ({ indicadorNoIndecx: chave_no_body }).
// Le apenas chave propria, pelo mesmo motivo de resolveMapped em ./request:
// evitar que prototype pollution injete valor herdado de Object.prototype.
function extrairCamposExtras(body, mapa) {
  const extras = {};
  for (const indicador of Object.keys(mapa)) {
    const chaveBody = mapa[indicador];
    extras[indicador] = Object.prototype.hasOwnProperty.call(body, chaveBody)
      ? body[chaveBody]
      : '';
  }
  return extras;
}

module.exports = { valorLimpo, atribuirSePreenchido, extrairCamposExtras };
