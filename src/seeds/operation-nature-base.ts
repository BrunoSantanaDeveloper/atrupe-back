/**
 * Base Operation Natures para cadastro automático em novas empresas
 * 
 * Naturezas de Operação para emissão de NF-e
 * Configuradas para empresa de produtos personalizados (impressos publicitários)
 */
export const BASE_OPERATION_NATURES = [
    // ====================== SAÍDA - VENDA NORMAL ======================
    {
        description: 'Vendas de produção do estabelecimento',
        type: 'SAIDA',
        finality: '1', // 1 = NF-e Normal
        consumerPresence: '0', // 0 = Não se aplica (vendas B2B)
        cfopInternalCode: '5102', // CFOP dentro do estado
        cfopExternalCode: '6102', // CFOP fora do estado (Obs: Usuário indicou 6101, mas 6102 é mais comum para revenda)
        info: 'Utilizar para vendas normais de produtos personalizados e impressos publicitários.',
    },

    // ====================== SAÍDA - DEVOLUÇÃO/RETORNO ======================
    {
        description: 'Devolução de compra para comercialização',
        type: 'SAIDA',
        finality: '4', // 4 = Devolução/Retorno
        consumerPresence: '0', // 0 = Não se aplica
        cfopInternalCode: '5202', // CFOP dentro do estado
        cfopExternalCode: '6202', // CFOP fora do estado
        info: 'Utilizar para devoluções de mercadorias adquiridas de fornecedores.',
    },

    // ====================== SAÍDA - VENDA DE PRODUÇÃO PRÓPRIA ======================
    {
        description: 'Venda de produção própria',
        type: 'SAIDA',
        finality: '1', // 1 = NF-e Normal
        consumerPresence: '0', // 0 = Não se aplica
        cfopInternalCode: '5101', // CFOP dentro do estado
        cfopExternalCode: '6101', // CFOP fora do estado
        info: 'Utilizar para vendas de produtos fabricados/industrializados pelo próprio estabelecimento.',
    },
];
