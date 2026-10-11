import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../config/prisma/prisma.service';
import { ClientService } from '../../core/client/client.service';
import { CompanyService } from '../../core/company/company.service';
import { EmployeeService } from '../../core/employee/employee.service';
import { PlanControlService } from '../../core/plan/plan-control.service';
import { QuotationService } from '../../core/sale/quotation/quotation.service';
import { SupplierService } from '../../core/supplier/supplier.service';
import { SystemSettingsService } from '../../core/system-settings/system-settings.service';
import { UserRegistrationService } from '../../core/user/user-registration.service';
import type { AsaasEnvironmentState } from './guard';
import type { TestAccountDeps } from './test-accounts';

/**
 * O contexto da API (sem HTTP) com os serviços que o script usa. Fica num
 * módulo à parte porque o runner só o carrega depois das guardas de
 * ambiente: num ambiente recusado, nem o código da API é carregado.
 */
export interface TestAccountsContext {
  deps: TestAccountDeps;
  /** A configuração ativa do Asaas (system_settings, com recaída no ASAAS_TOKEN). */
  asaasConfig: () => Promise<AsaasEnvironmentState>;
  close: () => Promise<void>;
}

/**
 * O contexto registra as rotinas agendadas da API (cron de cobrança, etc.).
 * Elas já rodam no container da API: aqui ficam paradas.
 */
function stopScheduledJobs(registry: SchedulerRegistry) {
  registry.getCronJobs().forEach((job) => job.stop());
  registry.getIntervals().forEach((name) => registry.deleteInterval(name));
  registry.getTimeouts().forEach((name) => registry.deleteTimeout(name));
}

export async function openTestAccountsContext(): Promise<TestAccountsContext> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  stopScheduledJobs(app.get(SchedulerRegistry));
  const prisma = app.get(PrismaService);

  return {
    deps: {
      prisma,
      companyService: app.get(CompanyService),
      employeeService: app.get(EmployeeService),
      userRegistration: app.get(UserRegistrationService),
      planControl: app.get(PlanControlService),
      clientService: app.get(ClientService),
      supplierService: app.get(SupplierService),
      quotationService: app.get(QuotationService),
      hashPassword: (password) => argon2.hash(password),
      verifyPassword: (hash, password) =>
        argon2.verify(hash, password).catch(() => false),
    },
    asaasConfig: () => app.get(SystemSettingsService).getAsaasConfig(),
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}
