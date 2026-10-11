import { rolesForPlan } from './roles';
import { PartyFixture, PlanFixture, QuotationFixture } from './types';

/**
 * START — o que o Maicol aprova: cadastro básico, orçamentos, O.S. e a parede
 * de upgrade em tudo do LITE. Usuários: Administrador, Vendedor e Produção
 * (3 de 3: dar acesso a um 4º usuário deve dar 403 PLAN_LIMIT_REACHED).
 *
 * Dados v1 (base de todos os planos): 8 clientes, 3 fornecedores e 3
 * orçamentos em aberto na série V1 (não na T1, de treinamento). Tudo
 * fictício: e-mails no domínio reservado `.example`, telefones com DDD 00 e
 * nenhum CPF/CNPJ, para não haver documento de alguém de verdade.
 *
 * TODO (próximas fatias, pela API que já existe):
 * - 3 produtos próprios além dos 25 padrão (lona e adesivo em m², cartão em
 *   unidade) e itens nos orçamentos;
 * - orçamentos nas outras situações (3 aprovados, 2 rejeitados sem motivo,
 *   1 cancelado) e as O.S. que a aprovação cria, em fases diferentes.
 */

const FICTICIO = 'Cadastro fictício das contas de teste.';

export const CLIENTES_V1: PartyFixture[] = [
  {
    ref: '01',
    type: 'PERSON',
    name: 'Mariana Teixeira',
    email: 'mariana.teixeira@clientes.example',
    mobile: '(00) 90000-0001',
    notes: FICTICIO,
  },
  {
    ref: '02',
    type: 'PERSON',
    name: 'Rafael Moura',
    email: 'rafael.moura@clientes.example',
    mobile: '(00) 90000-0002',
    notes: FICTICIO,
  },
  {
    ref: '03',
    type: 'PERSON',
    name: 'Juliana Prado',
    email: 'juliana.prado@clientes.example',
    mobile: '(00) 90000-0003',
    notes: FICTICIO,
  },
  {
    ref: '04',
    type: 'PERSON',
    name: 'Carlos Henrique Lima',
    email: 'carlos.lima@clientes.example',
    mobile: '(00) 90000-0004',
    notes: FICTICIO,
  },
  {
    ref: '05',
    type: 'COMPANY',
    name: 'Padaria Pão Quente',
    corporateName: 'Padaria Pão Quente Ltda.',
    email: 'contato@paoquente.example',
    mobile: '(00) 90000-0005',
    activity: 'Padaria e confeitaria',
    notes: FICTICIO,
  },
  {
    ref: '06',
    type: 'COMPANY',
    name: 'Clínica Sorriso',
    corporateName: 'Clínica Sorriso Odontologia Ltda.',
    email: 'contato@clinicasorriso.example',
    mobile: '(00) 90000-0006',
    activity: 'Clínica odontológica',
    notes: FICTICIO,
  },
  {
    ref: '07',
    type: 'COMPANY',
    name: 'Auto Peças Estrada',
    corporateName: 'Auto Peças Estrada Comércio Ltda.',
    email: 'vendas@autopecasestrada.example',
    mobile: '(00) 90000-0007',
    activity: 'Comércio de autopeças',
    notes: FICTICIO,
  },
  {
    ref: '08',
    type: 'COMPANY',
    name: 'Academia Corpo em Forma',
    corporateName: 'Corpo em Forma Academia Ltda.',
    email: 'recepcao@corpoemforma.example',
    mobile: '(00) 90000-0008',
    activity: 'Academia de ginástica',
    notes: FICTICIO,
  },
];

export const FORNECEDORES_V1: PartyFixture[] = [
  {
    ref: '01',
    type: 'COMPANY',
    name: 'Lonas & Cia',
    corporateName: 'Lonas & Cia Distribuidora Ltda.',
    email: 'pedidos@lonasecia.example',
    mobile: '(00) 90000-0101',
    activity: 'Lonas, banners e estruturas',
    notes: FICTICIO,
  },
  {
    ref: '02',
    type: 'COMPANY',
    name: 'Tintas Cor Viva',
    corporateName: 'Tintas Cor Viva Comércio Ltda.',
    email: 'vendas@corviva.example',
    mobile: '(00) 90000-0102',
    activity: 'Tintas e solventes',
    notes: FICTICIO,
  },
  {
    ref: '03',
    type: 'COMPANY',
    name: 'Papel Central',
    corporateName: 'Papel Central Atacado Ltda.',
    email: 'atendimento@papelcentral.example',
    mobile: '(00) 90000-0103',
    activity: 'Papéis e mídias de impressão',
    notes: FICTICIO,
  },
];

export const ORCAMENTOS_V1: QuotationFixture[] = [
  {
    ref: '01',
    clientRef: '05',
    description: 'Fachada em lona com estrutura metálica',
  },
  {
    ref: '02',
    clientRef: '06',
    description: 'Adesivos para vitrine e porta de vidro',
  },
  {
    ref: '03',
    clientRef: '01',
    description: 'Cartões de visita (1.000 unidades)',
  },
];

export const START: PlanFixture = {
  planType: 'START',
  additionalUsers: 0,
  roles: rolesForPlan('START'),
  clients: CLIENTES_V1,
  suppliers: FORNECEDORES_V1,
  quotations: ORCAMENTOS_V1,
};
