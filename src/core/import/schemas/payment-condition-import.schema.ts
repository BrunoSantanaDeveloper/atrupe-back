/**
 * Condições de pagamento vindas do legado.
 *
 * Existe porque as vendas referenciam a condição pelo código do legado, e as
 * condições que a empresa ganha no cadastro inicial não têm esse vínculo. Sem
 * esta etapa, toda venda importada falha ao procurar a condição.
 *
 * O legado permite nomes repetidos com custos diferentes — "À prazo" aparece
 * duas vezes na base piloto, com 5,00% e 3,90% —, então o código é a única
 * identidade confiável.
 */
export const PAYMENT_CONDITION_IMPORT_SCHEMA = {
  fields: [
    {
      name: 'codigoLegado',
      required: true,
      type: 'string',
      maxLength: 60,
      description:
        'Identificador da condição no sistema legado. É por ele que as vendas encontram a condição.',
      example: '3',
    },
    {
      name: 'nome',
      required: true,
      type: 'string',
      maxLength: 255,
      description: 'Descrição da condição',
      example: 'À prazo',
    },
    {
      name: 'formaPagamento',
      required: false,
      type: 'string',
      maxLength: 255,
      description:
        'Nome da forma de pagamento. Se não casar com nenhuma da empresa, usa a primeira ativa.',
      example: 'Boleto Bancário',
    },
    {
      name: 'custoTipo',
      required: false,
      type: 'string',
      description: 'PERCENT ou VALUE',
      example: 'PERCENT',
      validate: async (value: string) => {
        if (!value) return null;
        if (!['PERCENT', 'VALUE'].includes(value.trim().toUpperCase())) {
          return 'Tipo de custo deve ser PERCENT ou VALUE';
        }
        return null;
      },
    },
    {
      name: 'custo',
      required: false,
      type: 'string',
      description:
        'Custo por parcela, em percentual ou valor conforme custoTipo',
      example: '3,90',
    },
    {
      name: 'minParcelas',
      required: false,
      type: 'string',
      description: 'Quantidade mínima de parcelas',
      example: '1',
    },
    {
      name: 'maxParcelas',
      required: false,
      type: 'string',
      description: 'Quantidade máxima de parcelas',
      example: '6',
    },
    {
      name: 'intervaloDias',
      required: false,
      type: 'string',
      description: 'Intervalo em dias entre parcelas',
      example: '28',
    },
    {
      name: 'ativo',
      required: false,
      type: 'string',
      description: 'SIM ou NAO',
      example: 'SIM',
    },
  ],
};
