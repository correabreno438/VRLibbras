// Variáveis que mais de um módulo precisa alterar ficam neste objeto compartilhado.
// (Um módulo não pode reatribuir variável importada de outro, então todos usam estado.nome.)
export const estado = {};
