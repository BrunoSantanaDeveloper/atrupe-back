import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

type Ids = string | null | undefined | (string | null | undefined)[];

export interface FinancialRefs {
  supplierId?: string | null;
  employeeId?: string | null;
  clientId?: string | null;
  natureId?: Ids;
  subCategoryId?: Ids;
  bankAccountId?: Ids;
  paymentConditionId?: Ids;
}

type CountDelegate = { count(args: { where: any }): Promise<number> };

type RefsPrisma = Record<
  | 'supplier'
  | 'employee'
  | 'client'
  | 'nature'
  | 'subCategory'
  | 'bankAccount'
  | 'paymentCondition',
  CountDelegate
>;

/**
 * Os cadastros que um título cita (no corpo da requisição) precisam ser da
 * empresa do título. Sem a conferência, um id de outra empresa ligava o
 * fornecedor, o cliente ou a natureza dela ao título, e a conta bancária
 * dela fazia o pagamento cair no caixa dela.
 */
export async function assertFinancialRefsOfCompany(
  prisma: RefsPrisma,
  companyId: string,
  refs: FinancialRefs,
): Promise<void> {
  const own = { companyId };
  await assertBelongsToCompany(
    prisma.supplier,
    refs.supplierId,
    own,
    'Fornecedor não encontrado.',
  );
  await assertBelongsToCompany(
    prisma.employee,
    refs.employeeId,
    own,
    'Colaborador não encontrado.',
  );
  await assertBelongsToCompany(
    prisma.client,
    refs.clientId,
    own,
    'Cliente não encontrado.',
  );
  await assertBelongsToCompany(
    prisma.nature,
    refs.natureId,
    own,
    'Natureza não encontrada.',
  );
  await assertBelongsToCompany(
    prisma.subCategory,
    refs.subCategoryId,
    { nature: { companyId } },
    'Subcategoria não encontrada.',
  );
  await assertBelongsToCompany(
    prisma.bankAccount,
    refs.bankAccountId,
    own,
    'Conta bancária não encontrada.',
  );
  await assertBelongsToCompany(
    prisma.paymentCondition,
    refs.paymentConditionId,
    own,
    'Condição de pagamento não encontrada.',
  );
}
