import { PrismaClient } from '@prisma/client';
import { gunzipSync } from 'zlib';
import * as argon2 from 'argon2';
import { CompanyService } from '../company/company.service';
import { RESET_STEPS, delegateOf } from './account-reset.plan';
import { AccountResetService } from './account-reset.service';

/**
 * O "zerar" contra um Postgres de verdade, com as migrations aplicadas e o seed
 * global: as chaves estrangeiras, as tabelas de junção e o padrão de conta
 * nova só se comprovam no banco.
 *
 * Só roda com a variável apontando para um banco DESCARTÁVEL:
 *   docker run -d --name atrupe-reset-test -e POSTGRES_USER=test \
 *     -e POSTGRES_PASSWORD=test -e POSTGRES_DB=atrupe -p 55432:5432 postgres:14
 *   DATABASE_URL=postgresql://test:test@127.0.0.1:55432/atrupe npx prisma migrate deploy
 *   DATABASE_URL=postgresql://test:test@127.0.0.1:55432/atrupe npm run seed
 *   ACCOUNT_RESET_IT_DATABASE_URL=postgresql://test:test@127.0.0.1:55432/atrupe \
 *     npx jest src/core/account-reset/account-reset.integration.spec.ts
 */
const url = process.env.ACCOUNT_RESET_IT_DATABASE_URL;
const describeWithDb = url ? describe : describe.skip;

describeWithDb('zerar dados da conta — banco de verdade', () => {
  let prisma: PrismaClient;
  let companyService: CompanyService;
  let service: AccountResetService;
  let adminId: string;
  const run = Date.now();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    // O padrão de conta nova só usa o banco; o resto do CompanyService não
    // entra aqui.
    companyService = new CompanyService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    service = new AccountResetService(prisma as any, companyService);
    const admin = await prisma.user.create({
      data: {
        name: 'Superadmin',
        email: `admin-${run}@teste.local`,
        password: await argon2.hash('senha-admin'),
      },
    });
    adminId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Uma conta como o cadastro cria, com documentos e lançamentos em cima. */
  async function seedCompany(tag: string) {
    const email = `${tag}-${run}@teste.local`;
    const user = await prisma.user.create({
      data: { name: `Dono ${tag}`, email, password: 'x' },
    });
    const company = await prisma.company.create({
      data: {
        name: `Empresa ${tag} ${run}`,
        cnpj: tag === 'A' ? '11111111000111' : '22222222000122',
        deliveryType: ['PICKUP'],
        ownerUserId: user.id,
      },
    });
    const employee = await prisma.employee.create({
      data: { companyId: company.id, userId: user.id },
    });
    await companyService.createDefaultItems(email, company.id);

    const plan = await prisma.plan.findFirst({ where: { planType: 'START' } });
    const customer = await prisma.customer.create({
      data: {
        name: tag,
        email,
        document: tag,
        asaasCustomerId: `cus_${tag}_${run}`,
        companyId: company.id,
      },
    });
    await prisma.subscription.create({
      data: {
        asaasSubscriptionId: `sub_${tag}_${run}`,
        customerId: customer.id,
        nextDueDate: new Date(),
        planId: plan!.id,
        value: 147,
        companyId: company.id,
        status: 'ACTIVE',
      },
    });

    const product = await prisma.product.findFirstOrThrow({
      where: { companyId: company.id },
    });
    const condition = await prisma.paymentCondition.findFirstOrThrow({
      where: { companyId: company.id },
    });
    const client = await prisma.client.findFirstOrThrow({
      where: { companyId: company.id },
    });
    const bank = await prisma.bankAccount.findFirstOrThrow({
      where: { companyId: company.id },
    });
    const supplier = await prisma.supplier.create({
      data: { name: `Fornecedor ${tag}`, companyId: company.id },
    });

    const quotation = await prisma.quotation.create({
      data: {
        companyId: company.id,
        sellerId: employee.id,
        clientId: client.id,
      },
    });
    await prisma.quotationProduct.create({
      data: { quotationId: quotation.id, productId: product.id },
    });
    await prisma.quotationPayment.create({
      data: {
        quotationId: quotation.id,
        paymentConditionId: condition.id,
        totalValue: 100,
      },
    });
    await prisma.order.create({ data: { quotationId: quotation.id } });
    const receivable = await prisma.receivable.create({
      data: {
        companyId: company.id,
        referenceDate: new Date(),
        quotationId: quotation.id,
        clientId: client.id,
      },
    });
    await prisma.receivableInstallment.create({
      data: {
        receivableId: receivable.id,
        installmentNumber: 1,
        dueDate: new Date(),
        amount: 100,
        bankAccountId: bank.id,
      },
    });
    const payable = await prisma.payable.create({
      data: {
        companyId: company.id,
        referenceDate: new Date(),
        totalAmount: 50,
        supplierId: supplier.id,
      },
    });
    await prisma.payableInstallment.create({
      data: {
        payableId: payable.id,
        installmentNumber: 1,
        dueDate: new Date(),
        amount: 50,
      },
    });
    const cash = await prisma.cashRegister.create({
      data: {
        companyId: company.id,
        bankAccountId: bank.id,
        openingDate: new Date(),
        openingBalance: 0,
      },
    });
    await prisma.transaction.create({
      data: { type: 'INCOME', cashRegisterId: cash.id },
    });
    await prisma.payroll.create({
      data: {
        month: 9,
        year: 2026,
        companyId: company.id,
        employeeId: employee.id,
      },
    });

    // As tabelas das Fases 3 a 7: composição, produção, frente de caixa,
    // estoque, extrato e a baixa direto na conta (sem caixa).
    const sector = await prisma.companySector.create({
      data: { name: `Produção ${tag}`, companyId: company.id },
    });
    const material = await prisma.material.create({
      data: {
        companyId: company.id,
        number: 1,
        code: 'MAT-01',
        name: 'Lona',
        searchName: 'lona',
        sectorId: sector.id,
        unit: 'M2',
      },
    });
    await prisma.materialImportLink.create({
      data: {
        companyId: company.id,
        externalName: 'Lona 440 g',
        materialId: material.id,
      },
    });
    await prisma.supplierItemLink.create({
      data: {
        companyId: company.id,
        supplierKey: supplier.id,
        supplierCode: 'L440',
        materialId: material.id,
        conversionFactor: 1,
      },
    });
    await prisma.process.create({
      data: {
        companyId: company.id,
        name: 'Impressão',
        sectorId: sector.id,
        taskType: 'Impressão',
        rules: {},
      },
    });
    await prisma.productAssembly.create({
      data: { companyId: company.id, productId: product.id },
    });
    await prisma.quotationDraft.create({
      data: { companyId: company.id, quotationId: quotation.id },
    });
    const flow = await prisma.productionFlow.create({
      data: { companyId: company.id, name: 'Comunicação Visual' },
    });
    const manager = await prisma.productionManager.create({
      data: {
        companyId: company.id,
        name: 'Produção',
        sectorId: sector.id,
        flowId: flow.id,
      },
    });
    const taskType = await prisma.productionTaskType.create({
      data: { companyId: company.id, name: 'Produção', nameKey: 'produção' },
    });
    const taskStep = await prisma.productionTaskStep.create({
      data: {
        taskTypeId: taskType.id,
        name: 'Produção',
        managerId: manager.id,
      },
    });
    await prisma.productionCollaborator.create({
      data: { companyId: company.id, employeeId: employee.id },
    });
    await prisma.productionCalendar.create({
      data: { companyId: company.id, holidays: [] },
    });
    const vehicle = await prisma.productionVehicle.create({
      data: { companyId: company.id, name: 'Fiorino' },
    });
    const project = await prisma.productionProject.create({
      data: {
        companyId: company.id,
        quotationId: quotation.id,
        number: '1',
        approvedAt: new Date(),
        firstDue: new Date(),
        due: new Date(),
      },
    });
    const task = await prisma.productionTask.create({
      data: {
        companyId: company.id,
        projectId: project.id,
        code: 'A1B2C',
        itemName: 'Banner',
        stageName: 'Impressão',
        taskTypeId: taskType.id,
        currentStepId: taskStep.id,
        vehicleId: vehicle.id,
        dependsOn: [],
        fields: [],
      },
    });
    await prisma.productionTimeEntry.create({
      data: {
        companyId: company.id,
        taskId: task.id,
        employeeId: employee.id,
        start: new Date(),
      },
    });
    await prisma.pendingSale.create({
      data: {
        companyId: company.id,
        quotationId: quotation.id,
        total: 10000,
        approvedAt: new Date(),
      },
    });
    const front = await prisma.cashFront.create({
      data: {
        companyId: company.id,
        drawerAccountId: bank.id,
        pixAccountId: bank.id,
      },
    });
    const session = await prisma.cashSession.create({
      data: {
        companyId: company.id,
        cashFrontId: front.id,
        number: 1,
        operatorName: 'Operador',
      },
    });
    await prisma.cashSessionMovement.create({
      data: { sessionId: session.id, kind: 'SALE', description: 'Venda' },
    });
    const stockItem = await prisma.stockItem.create({
      data: {
        companyId: company.id,
        materialId: material.id,
        key: `${material.id}|`,
      },
    });
    await prisma.stockMovement.create({
      data: {
        companyId: company.id,
        stockItemId: stockItem.id,
        kind: 'ENTRY',
        quantity: 10,
        origin: 'NF 1',
        date: new Date(),
      },
    });
    await prisma.inboundInvoice.create({
      data: {
        companyId: company.id,
        number: '1',
        supplierName: supplier.name,
        issueDate: new Date(),
        total: 10000,
      },
    });
    await prisma.bankStatementLine.create({
      data: {
        companyId: company.id,
        bankAccountId: bank.id,
        fitId: `F${tag}`,
        date: new Date(),
        amount: 10000,
        importId: `I${tag}`,
      },
    });
    // A baixa em conta sem controle de caixa: o lançamento vai direto na
    // conta, sem caixa (e a conta não sai enquanto ele existir).
    await prisma.transaction.create({
      data: { type: 'INCOME', bankAccountId: bank.id },
    });
    await prisma.quickSaleSettings.create({
      data: { companyId: company.id, clientId: client.id },
    });
    await prisma.saleSettings.create({ data: { companyId: company.id } });
    await prisma.pricingParameters.create({ data: { companyId: company.id } });
    const subCategory = await prisma.subCategory.findFirstOrThrow({
      where: { companyId: company.id },
    });
    await prisma.costBaseExpense.create({
      data: { companyId: company.id, subCategoryId: subCategory.id },
    });
    await prisma.costBaseSettings.create({ data: { companyId: company.id } });
    await prisma.assetGroup.create({
      data: { companyId: company.id, name: 'Impressoras', unit: 'M2' },
    });
    await prisma.employeeWorkload.create({
      data: {
        companyId: company.id,
        employeeId: employee.id,
        sectorId: sector.id,
        hours: 220,
      },
    });
    await prisma.costAuditLog.create({
      data: {
        companyId: company.id,
        entity: 'asset',
        entityId: 'x',
        action: 'create',
      },
    });
    return { company, user, employee };
  }

  /** Quantas linhas cada passo do plano acharia nesta empresa. */
  async function snapshot(companyId: string) {
    const counts: Record<string, number> = {};
    for (const step of RESET_STEPS) {
      counts[`${step.group}:${step.model}`] = await (prisma as any)[
        delegateOf(step.model)
      ].count({ where: step.where(companyId) });
    }
    counts['kept:Employee'] = await prisma.employee.count({
      where: { companyId },
    });
    counts['kept:Subscription'] = await prisma.subscription.count({
      where: { companyId, status: 'ACTIVE' },
    });
    counts['kept:Role'] = await prisma.role.count({ where: { companyId } });
    counts['kept:CfopConfig'] = await prisma.cfopConfig.count({
      where: { companyId },
    });
    counts['kept:EmployeeWorkload'] = await prisma.employeeWorkload.count({
      where: { companyId },
    });
    counts['kept:CostAuditLog'] = await prisma.costAuditLog.count({
      where: { companyId },
    });
    return counts;
  }

  const sum = (counts: Record<string, number>, prefix: string) =>
    Object.entries(counts)
      .filter(([key]) => key.startsWith(prefix))
      .reduce((total, [, value]) => total + value, 0);

  it('zera os dados e mantém conta, acessos, assinatura, configurações e fiscal; a outra empresa fica intacta', async () => {
    const a = await seedCompany('A');
    const b = await seedCompany('B');
    const beforeA = await snapshot(a.company.id);
    const beforeB = await snapshot(b.company.id);

    // Há o que apagar em cada grupo de dados.
    for (const prefix of [
      'documents:',
      'financial:',
      'stock:',
      'registries:',
      'payroll:',
    ]) {
      expect(sum(beforeA, prefix)).toBeGreaterThan(0);
    }

    const result = await service.reset(
      a.company.id,
      { password: 'senha-admin', confirmation: ` empresa a ${run} ` },
      adminId,
    );

    const afterA = await snapshot(a.company.id);
    for (const prefix of [
      'documents:',
      'financial:',
      'stock:',
      'registries:',
      'payroll:',
      'fiscal:',
    ]) {
      expect(sum(afterA, prefix)).toBe(0);
    }
    // Configurações ficam como estavam; acessos, assinatura e fiscal também.
    for (const key of Object.keys(beforeA).filter((k) =>
      k.startsWith('settings:'),
    )) {
      expect(afterA[key]).toBe(beforeA[key]);
    }
    for (const key of [
      'kept:Employee',
      'kept:Subscription',
      'kept:Role',
      'kept:CfopConfig',
      'kept:EmployeeWorkload',
      'kept:CostAuditLog',
    ]) {
      expect(afterA[key]).toBe(beforeA[key]);
    }
    // A venda rápida não fica apontando para o cliente que saiu.
    expect(
      (
        await prisma.quickSaleSettings.findUniqueOrThrow({
          where: { companyId: a.company.id },
        })
      ).clientId,
    ).toBeNull();
    expect(await prisma.company.count({ where: { id: a.company.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(1);

    // A outra empresa não perde nada.
    expect(await snapshot(b.company.id)).toEqual(beforeB);

    // A cópia guarda exatamente o que saiu.
    const record = await prisma.companyDataReset.findUniqueOrThrow({
      where: { id: result.resetId },
    });
    const backup = JSON.parse(
      gunzipSync(Buffer.from(record.backup!)).toString(),
    );
    expect(backup.rows.Quotation).toHaveLength(beforeA['documents:Quotation']);
    expect(backup.rows.Client).toHaveLength(beforeA['registries:Client']);
    expect(backup.rows.Product).toHaveLength(beforeA['registries:Product']);
    expect(result.total).toBe(
      ['documents:', 'financial:', 'stock:', 'registries:', 'payroll:'].reduce(
        (total, prefix) => total + sum(beforeA, prefix),
        0,
      ),
    );
    expect(
      await prisma.companyHistory.count({
        where: { companyId: a.company.id, action: 'DATA_RESET' },
      }),
    ).toBe(1);
  }, 120_000);

  it('voltar ao padrão de conta nova: troca as configurações pelas do cadastro', async () => {
    const a = await seedCompany('C');
    const before = await prisma.paymentCondition.findMany({
      where: { companyId: a.company.id },
      select: { id: true },
    });

    const result = await service.reset(
      a.company.id,
      {
        password: 'senha-admin',
        confirmation: `Empresa C ${run}`,
        restoreDefaults: true,
      },
      adminId,
    );

    expect(result.defaultsRestored).toBe(true);
    const after = await prisma.paymentCondition.findMany({
      where: { companyId: a.company.id },
      select: { id: true },
    });
    expect(after.length).toBe(before.length);
    expect(after.some((c) => before.some((b) => b.id === c.id))).toBe(false);
    // Os exemplos do cadastro voltam, como numa conta nova.
    expect(
      await prisma.saleSeries.count({ where: { companyId: a.company.id } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.quotation.count({ where: { companyId: a.company.id } }),
    ).toBe(0);
    // A configuração da produção e a frente de caixa saem com as demais; o
    // padrão delas nasce no primeiro acesso.
    for (const model of [
      'productionTaskType',
      'productionManager',
      'productionFlow',
      'cashFront',
      'quickSaleSettings',
    ]) {
      expect(
        await (prisma as any)[model].count({
          where: { companyId: a.company.id },
        }),
      ).toBe(0);
    }
  }, 120_000);

  it('senha errada ou nome errado não apagam nada', async () => {
    const a = await seedCompany('D');
    const before = await snapshot(a.company.id);

    await expect(
      service.reset(
        a.company.id,
        { password: 'errada', confirmation: `Empresa D ${run}` },
        adminId,
      ),
    ).rejects.toThrow('Senha do administrador incorreta');
    await expect(
      service.reset(
        a.company.id,
        { password: 'senha-admin', confirmation: 'Outra empresa' },
        adminId,
      ),
    ).rejects.toThrow('digite o nome da empresa');

    expect(await snapshot(a.company.id)).toEqual(before);
  }, 120_000);
});
