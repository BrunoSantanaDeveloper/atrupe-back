/**
 * Base CFOPs para cadastro automático em novas empresas
 * 
 * Estrutura CFOP:
 * - 1º dígito 5: Saída Estadual (dentro do estado)
 * - 1º dígito 6: Saída Interestadual (fora do estado)
 * - 1º dígito 7: Saída para Exterior
 * - 1º dígito 1: Entrada Estadual
 * - 1º dígito 2: Entrada Interestadual
 * - 1º dígito 3: Entrada Exterior
 */
export const BASE_CFOPS = [
    // ====================== SAÍDA ESTADUAL (5XXX) ======================
    {
        code: '5101',
        description: 'Venda de produção do estabelecimento',
        type: 'SAIDA',
        nature: 'Venda de produto industrializado ou produzido pelo próprio estabelecimento',
        info: 'Classificam-se neste código as vendas de produtos industrializados ou produzidos pelo próprio estabelecimento.',
    },
    {
        code: '5102',
        description: 'Venda de mercadoria adquirida ou recebida de terceiros',
        type: 'SAIDA',
        nature: 'Venda de mercadoria adquirida ou recebida de terceiros para industrialização ou comercialização',
        info: 'Classificam-se neste código as vendas de mercadorias adquiridas ou recebidas de terceiros para industrialização ou comercialização, que não tenham sido objeto de qualquer processo industrial no estabelecimento.',
    },
    {
        code: '5202',
        description: 'Devolução de compra para comercialização',
        type: 'SAIDA',
        nature: 'Devolução de mercadoria adquirida para comercialização',
        info: 'Classificam-se neste código as devoluções de mercadorias adquiridas para serem comercializadas, cujas entradas tenham sido classificadas como "Compra para comercialização".',
    },

    // ====================== SAÍDA INTERESTADUAL (6XXX) ======================
    {
        code: '6101',
        description: 'Venda de produção do estabelecimento',
        type: 'SAIDA',
        nature: 'Venda de produto industrializado ou produzido pelo próprio estabelecimento para outro estado',
        info: 'Classificam-se neste código as vendas de produtos industrializados ou produzidos pelo próprio estabelecimento, quando destinadas a contribuintes localizados em outro estado.',
    },
    {
        code: '6102',
        description: 'Venda de mercadoria adquirida ou recebida de terceiros',
        type: 'SAIDA',
        nature: 'Venda de mercadoria adquirida ou recebida de terceiros para outro estado',
        info: 'Classificam-se neste código as vendas de mercadorias adquiridas ou recebidas de terceiros para industrialização ou comercialização, quando destinadas a contribuintes localizados em outro estado.',
    },
    {
        code: '6202',
        description: 'Devolução de compra para comercialização',
        type: 'SAIDA',
        nature: 'Devolução de mercadoria adquirida para comercialização de outro estado',
        info: 'Classificam-se neste código as devoluções de mercadorias adquiridas para serem comercializadas de fornecedores de outro estado.',
    },
];
