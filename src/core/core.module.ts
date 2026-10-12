import { Module } from '@nestjs/common';
import { CompanyModule } from './company/company.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PrismaModule } from 'nestjs-prisma';
import { SectorModule } from './sector/sector.module';
import { RoleModule } from './role/role.module';
import { AddressModule } from './address/address.module';
import { ClientModule } from './client/client.module';
import { SupplierModule } from './supplier/supplier.module';
import { ProductModule } from './product/product.module';
import { ContactModule } from './contact/contact.module';
import { BankModule } from './bank/bank.module';
import { AssetModule } from './asset/asset.module';
import { MaterialModule } from './material/material.module';
import { SaleModule } from './sale/sale.module';
import { EmployeeModule } from './employee/employee.module';
import { FinancialModule } from './financial/financial.module';
import { PaymentModule } from './payment/payment.module';
import { CategoryModule } from './category/category.module';
import { UnitOfMeasureModule } from './unit-of-measure/unit-of-measure.module';
import { LanguageModule } from './language/language.module';
import { ProfileModule } from './profile/profile.module';
import { SellersModule } from './sellers/sellers.module';
import { FilesModule } from './files/files.module';
import { MailModule } from './mail/mail.module';
import { PlanModule } from './plan/plan.module';
import { ContractModule } from './contract/contract.module';
import { AcademyModule } from './academy/academy.module';
import { CustomersModule } from './customers/customers.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ActivityMonitorModule } from './activity-monitor/activity-monitor.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PaymentsModule } from './payments/payments.module';
import { ImportModule } from './import/import.module';
import { MigrationModule } from './migration/migration.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { CouponsModule } from './coupons/coupons.module';
import { AiModule } from './ai/ai.module';
import { OwnershipModule } from './ownership/ownership.module';

@Module({
  imports: [
    PrismaModule,
    CompanyModule,
    AuthModule,
    UserModule,
    SectorModule,
    RoleModule,
    AddressModule,
    ClientModule,
    SupplierModule,
    ProductModule,
    ContactModule,
    BankModule,
    AssetModule,
    MaterialModule,
    SaleModule,
    EmployeeModule,
    FinancialModule,
    PaymentModule,
    CategoryModule,
    UnitOfMeasureModule,
    LanguageModule,
    ProfileModule,
    SellersModule,
    FilesModule,
    MailModule,
    PlanModule,
    ContractModule,
    AcademyModule,
    CustomersModule,
    SubscriptionsModule,
    CouponsModule,
    ActivityMonitorModule,
    WebhooksModule,
    PaymentsModule,
    ImportModule,
    MigrationModule,
    FiscalModule,
    SystemSettingsModule,
    AiModule,
    OwnershipModule,
  ],
})
export class CoreModule {}
