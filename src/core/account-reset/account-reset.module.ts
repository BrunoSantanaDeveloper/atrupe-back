import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { AccountResetController } from './account-reset.controller';
import { AccountResetService } from './account-reset.service';

@Module({
  imports: [CompanyModule],
  controllers: [AccountResetController],
  providers: [AccountResetService],
})
export class AccountResetModule {}
