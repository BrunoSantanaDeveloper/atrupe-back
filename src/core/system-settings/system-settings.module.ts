import { Global, Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';
import { IcmsAliquotaInternaService } from '../fiscal/shared/icms-aliquota-interna.service';

@Global()
@Module({
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService, IcmsAliquotaInternaService],
  exports: [SystemSettingsService, IcmsAliquotaInternaService],
})
export class SystemSettingsModule {}
