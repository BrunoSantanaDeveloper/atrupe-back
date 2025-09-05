interface ScheduledExpensesType {
  description: string;
  dueDay: number;
  recurringType: string;
  supplierName?: string;
  supplierEmail?: string;
  supplierCnpj?: string;
  supplierCorporateName?: string;
  supplierPhone?: string;
  supplierType?: string;
  natureLevel1: string;
  natureLevel2: string;
  natureCode: string;
  subCategoryCode: string;
  amount?: number;
}

export const BASE_SCHEDULED_EXPENSES: ScheduledExpensesType[] = [
  {
    description: 'Sistema de gestão',
    dueDay: 10,
    recurringType: 'MONTHLY',
    supplierName: 'Atrupe Sistemas Administrativos LTDA',
    supplierEmail: 'suporte@atrupe.com.br',
    supplierCnpj: '13.205.998/0001-02',
    supplierCorporateName: 'ATRUPE SISTEMAS ADMINISTRATIVOS LTDA',
    supplierPhone: '(47) 2122-9194',
    supplierType: 'COMPANY',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '11',
  },
  {
    description: 'Aluguel',
    dueDay: 8,
    recurringType: 'MONTHLY',
    supplierName: 'Aluguel',
    supplierCorporateName: 'Aluguel',
    supplierType: 'COMPANY',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '01',
  },
  {
    description: 'Energia Elétrica',
    dueDay: 15,
    recurringType: 'MONTHLY',
    supplierName: 'Energia Elétrica',
    supplierCorporateName: 'Energia Elétrica',
    supplierType: 'COMPANY',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '02',
  },
  {
    description: 'Água',
    dueDay: 15,
    recurringType: 'MONTHLY',
    supplierName: 'Água',
    supplierCorporateName: 'Água',
    supplierType: 'COMPANY',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '01',
  },
  {
    description: 'Telefone',
    dueDay: 10,
    recurringType: 'MONTHLY',
    supplierName: 'Telefone',
    supplierCorporateName: 'Telefone',
    supplierType: 'COMPANY',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '05',
  },
  {
    description: 'Internet',
    dueDay: 15,
    recurringType: 'MONTHLY',
    supplierName: 'Internet',
    supplierCorporateName: 'Internet',
    supplierType: 'COMPANY',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '05',
  },
  {
    description: 'Contador',
    dueDay: 10,
    recurringType: 'MONTHLY',
    supplierName: 'Contador',
    supplierType: 'PERSON',
    natureLevel1: '02',
    natureLevel2: '01',
    natureCode: '01',
    subCategoryCode: '06',
  },
  {
    description: 'Salários',
    dueDay: 5,
    recurringType: 'MONTHLY',
    natureLevel1: '02',
    natureLevel2: '02',
    natureCode: '01',
    subCategoryCode: '01',
  },
];
