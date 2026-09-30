/**
 * Tabela "Compare todos os planos" da trilha de contratação, no padrão de
 * fábrica. Cada linha entra no plano que a introduz (`since`) e segue nos
 * seguintes. O superadmin edita no painel de planos; o que ele salva fica em
 * `system_settings` (chave `plan_comparison`) e vale no lugar deste padrão.
 */
export interface PlanComparisonGroup {
  group: string;
  rows: { label: string; since: 'START' | 'LITE' | 'PRO' | 'ELITE' | 'FULL' }[];
}

export const DEFAULT_PLAN_COMPARISON: PlanComparisonGroup[] = [
  {
    group: 'Cadastros e organização',
    rows: [
      {
        label: 'Clientes, fornecedores, colaboradores e produtos',
        since: 'START',
      },
      { label: 'Produtos com composições básicas', since: 'LITE' },
      {
        label: 'Custos detalhados: mão de obra, materiais e equipamentos',
        since: 'PRO',
      },
    ],
  },
  {
    group: 'Financeiro',
    rows: [
      {
        label: 'Plano de contas, despesas, folha de pagamento e receitas',
        since: 'START',
      },
      {
        label: 'Separação por contas bancárias e limites de crédito',
        since: 'LITE',
      },
      { label: 'Repasse automático das taxas financeiras', since: 'LITE' },
      { label: 'Custos estimados versus realizados', since: 'FULL' },
    ],
  },
  {
    group: 'Comercial',
    rows: [
      { label: 'Orçamentos enviados e vendas realizadas', since: 'START' },
      {
        label: 'CRM: negociações em andamento e motivos de cancelamento',
        since: 'LITE',
      },
      { label: 'Histórico completo dos clientes', since: 'LITE' },
      { label: 'Identificação dos trabalhos mais lucrativos', since: 'PRO' },
    ],
  },
  {
    group: 'Produção e entrega',
    rows: [
      { label: 'Gerenciador de produção e entrega', since: 'LITE' },
      {
        label: 'Padronização de processos e delegação de funções',
        since: 'PRO',
      },
      {
        label: 'Produção integrada por setor, com medição de produtividade',
        since: 'ELITE',
      },
      {
        label:
          'Avaliação de tempos estimados versus realizados por colaborador',
        since: 'ELITE',
      },
    ],
  },
  {
    group: 'Estoque',
    rows: [
      {
        label: 'Entrada de materiais e composição detalhada dos trabalhos',
        since: 'FULL',
      },
      { label: 'Rastreio do uso real de materiais na produção', since: 'FULL' },
    ],
  },
];
