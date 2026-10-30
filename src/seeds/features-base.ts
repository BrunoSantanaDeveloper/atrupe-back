export const BASE_FEATURES = [
  // Features específicas do plano LITE (START/TRIAL não têm acesso)
  {
    key: 'pdf_show_item_details',
    name: 'Mostrar Detalhes de Itens no PDF',
    description:
      'Exibe detalhes completos dos itens nos PDFs de orçamentos e pedidos',
    category: 'pdf',
    price: 0,
    isActive: true,
  },
  {
    key: 'sectors_configuration',
    name: 'Configurar Setores',
    description: 'Configuração e gestão de setores da empresa',
    category: 'configuration',
    price: 0,
    isActive: true,
  },
  {
    key: 'service_order_current_phase',
    name: 'Fase Atual em Ordens de Serviço',
    description: 'Exibir coluna "Fase atual" na listagem de ordens de serviço',
    category: 'service_orders',
    price: 0,
    isActive: true,
  },
  // Terceirizado avulso dentro do item do orçamento, já no START (T-5,
  // 24/10/2026): terceirizar produção é comum na empresa pequena
  {
    key: 'outsourced_item',
    name: 'Terceirizado avulso',
    description:
      'Lançar um terceirizado (fornecedor, custo e preço) dentro do item do orçamento',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  // Acompanhamento comercial (CRM, área 13), do LITE em diante (CRM-7,
  // 29/10/2026): registrar contato, próximo contato, a aba Aguardando como
  // visão do dia, modelos de mensagem, e-mail diário e clientes sem compra
  {
    key: 'sales_follow_up',
    name: 'Acompanhamento comercial',
    description:
      'Registrar contatos, marcar o próximo contato, a visão do dia na aba Aguardando, modelos de mensagem, e-mail diário e clientes sem compra',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  // Assistente de IA, do START em diante (agente do START e do LITE,
  // 28/10/2026); a cota do mês é o limite ai_messages_month
  {
    key: 'ai_assistant',
    name: 'Assistente de IA',
    description:
      'Assistente que consulta os dados da empresa e propõe orçamentos, descritivos e lançamentos para a pessoa confirmar',
    category: 'configuration',
    price: 0,
    isActive: true,
  },
  {
    key: 'quotation_quick_sale',
    name: 'Venda Rápida',
    description: 'Criar venda rápida nos orçamentos',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  {
    key: 'quotation_rejection_reasons',
    name: 'Motivos de Rejeição e Cancelamento',
    description: 'Configurar motivos de rejeição e cancelamento de orçamentos',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  // Aposentado em 30/09/2026: o PO decidiu que o motivo ao rejeitar não é
  // obrigatório. Fica inativo (o seed não apaga recurso do catálogo) e fora da
  // matriz dos planos.
  {
    key: 'quotation_require_rejection_reason',
    name: 'Solicitar Motivo de Rejeição',
    description: 'Solicitar motivo ao rejeitar orçamento',
    category: 'quotations',
    price: 0,
    isActive: false,
  },
  {
    key: 'service_order_cancellation_reason',
    name: 'Motivo de Cancelamento de Ordem',
    description: 'Solicitar motivo ao cancelar ordem de serviço',
    category: 'service_orders',
    price: 0,
    isActive: true,
  },
  {
    key: 'quotation_status_configuration',
    name: 'Configurar Status de Orçamento',
    description: 'Configuração personalizada de status de orçamentos',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  {
    key: 'quotation_status_column',
    name: 'Coluna de Status em Orçamentos',
    description: 'Exibir coluna "Status" na listagem de orçamentos',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  {
    key: 'delivery_production_tabs',
    name: 'Abas de Produção na Agenda',
    description:
      'Exibir abas "Produção" e "Todos os ativos" na agenda de entrega',
    category: 'delivery',
    price: 0,
    isActive: true,
  },
  {
    key: 'delivery_production_stages',
    name: 'Etapas de Produção na Agenda',
    description: 'Exibir etapas de produção na listagem da agenda de entrega',
    category: 'delivery',
    price: 0,
    isActive: true,
  },
  {
    key: 'delivery_stage_status_change',
    name: 'Alterar Status de Etapas',
    description: 'Alterar status das etapas de produção na agenda de entrega',
    category: 'delivery',
    price: 0,
    isActive: true,
  },
  {
    key: 'accounts_receivable',
    name: 'Contas a Receber',
    description: 'Tela de gestão de contas a receber',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'accounts_payable',
    name: 'Contas a Pagar',
    description: 'Tela de gestão de contas a pagar',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'cash_control',
    name: 'Controle de Caixa',
    description: 'Tela de controle de caixa',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'bank_account_cash_control_switch',
    name: 'Switch Controle de Caixa',
    description:
      'Exibir switch "Controle de caixa" na configuração de conta bancária',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'pdv_screen',
    name: 'Tela PDV',
    description: 'Tela do ponto de venda (PDV)',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'bank_account_creation',
    name: 'Criação de Conta Bancária',
    description: 'Criar e gerenciar contas bancárias',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'payment_condition_operator_fee',
    name: 'Taxa Operadora em Condições de Pagamento',
    description: 'Exibir campos "Taxa operadora" e "Repasse da taxa"',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'credit_limit_configuration',
    name: 'Configurar Limite de Crédito',
    description: 'Configuração de limites de crédito para clientes',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'product_composition',
    name: 'Produto Composto',
    description: 'Criação e gestão de produtos compostos',
    category: 'products',
    price: 0,
    isActive: true,
  },
  {
    key: 'product_production_stages',
    name: 'Etapas de Produção em Produtos',
    description: 'Configurar etapas de produção nos produtos',
    category: 'products',
    price: 0,
    isActive: true,
  },
  {
    key: 'client_additional_tabs',
    name: 'Abas Adicionais em Clientes',
    description:
      'Exibir abas "orçamento", "ordens de serviço" e "financeiro" em clientes',
    category: 'clients',
    price: 0,
    isActive: true,
  },
  {
    key: 'supplier_additional_tabs',
    name: 'Abas Adicionais em Fornecedores',
    description:
      'Exibir abas "orçamento", "ordens de serviço" e "financeiro" em fornecedores',
    category: 'suppliers',
    price: 0,
    isActive: true,
  },
  {
    key: 'client_responsible_management',
    name: 'Gestão de Responsável do Cliente',
    description:
      'Atribuir um colaborador responsável ao cliente e filtrar a carteira por responsável',
    category: 'clients',
    price: 0,
    isActive: true,
  },
  {
    key: 'bank_account_delete',
    name: 'Excluir Conta Bancária',
    description: 'Excluir contas bancárias do sistema',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'bank_account_provision',
    name: 'Provisão de Conta Bancária',
    description: 'Provisionar e configurar contas bancárias',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'payment_difference',
    name: 'Diferença de Pagamento',
    description: 'Controle e gestão de diferenças em pagamentos',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  // Chaves de 10/10/2026 (contrato da camada de planos). As do LITE já têm
  // gate na API; as de PRO, ELITE e FULL protegem telas até a API de cada
  // módulo nascer. "Faturar na entrega" fica fora de todo plano até o PO
  // decidir (acompanha a Agenda de entrega).
  {
    key: 'multiple_companies',
    name: 'Mais de uma empresa',
    description:
      'Cadastrar outras empresas (filiais, outro CNPJ) na mesma conta.',
    category: 'configuration',
    price: 0,
    isActive: true,
  },
  {
    key: 'transaction_cancel_reasons',
    name: 'Motivo ao cancelar lançamento',
    description:
      'Informar motivo e observação ao cancelar contas a pagar e a receber.',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    key: 'credit_limit_enforcement',
    name: 'Bloqueio pelo limite de crédito',
    description:
      'Aprovação do orçamento conferida pelo limite de crédito, pelo cliente bloqueado e pelas condições permitidas.',
    category: 'financial',
    price: 0,
    isActive: true,
  },
  // Papéis no LITE (decisão do PO de 13/10/2026). A migration
  // 20261020140000_chave_paper_register grava o mesmo texto.
  {
    key: 'paper_register',
    name: 'Papéis',
    description:
      'Cadastro de papéis (gramatura, formato da folha e área útil, sem custo nem preço) e contagem de folhas no item e na ficha.',
    category: 'products',
    price: 0,
    isActive: true,
  },
  {
    key: 'can_bill_on_delivery_and_checkout',
    name: 'Faturar na entrega e na frente de caixa',
    description:
      'Opções de faturamento "na entrega" e "na frente de caixa" nas séries e condições.',
    category: 'quotations',
    price: 0,
    isActive: true,
  },
  {
    key: 'cost_base',
    name: 'Base de custos',
    description:
      'Base de custos, patrimônios, materiais, processos e composição com custo.',
    category: 'costs',
    price: 0,
    isActive: true,
  },
  {
    key: 'pricing_center',
    name: 'Precificação',
    description:
      'Central de precificação: preço sugerido, margem e parâmetros.',
    category: 'costs',
    price: 0,
    isActive: true,
  },
  {
    key: 'production_manager',
    name: 'Gerenciador de produção',
    description: 'Gerenciador, projetos, configurações de produção e frota.',
    category: 'production',
    price: 0,
    isActive: true,
  },
  {
    key: 'productivity_tracking',
    name: 'Produtividade',
    description: 'Produtividade por setor e por pessoa.',
    category: 'production',
    price: 0,
    isActive: true,
  },
  {
    key: 'stock_control',
    name: 'Estoque',
    description: 'Saldo e movimentação de estoque.',
    category: 'stock',
    price: 0,
    isActive: true,
  },
  {
    key: 'invoice_entry',
    name: 'Entrada de nota',
    description: 'Entrada de nota fiscal de compra com conciliação.',
    category: 'stock',
    price: 0,
    isActive: true,
  },
  // A tela por setor da produção sem controle de tempo (PRO; GP-46/GP-47,
  // 29/10/2026): cada setor vê a sua fila e conclui o que é seu
  {
    key: 'sector_board',
    name: 'Tela por setor da produção',
    description:
      'Cada setor vê a sua fila de tarefas e conclui o que é seu, sem controle de tempo',
    category: 'production',
    price: 0,
    isActive: true,
  },
  // Módulos adicionais pagos (aparecem na página de assinatura)
  {
    key: 'nota_fiscal',
    name: 'Nota Fiscal',
    description:
      'NF-e (Nota Fiscal Eletrônica)\nNFS-e (Nota Fiscal de Serviço Eletrônica)\nNFC-e (Nota Fiscal de Consumidor Eletrônica)',
    category: 'fiscal',
    price: 7000, // R$ 70,00 em centavos
    isActive: true,
  },
];
