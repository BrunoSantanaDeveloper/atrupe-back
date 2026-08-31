import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';
import { IcmsAliquotaInternaService } from '../fiscal/shared/icms-aliquota-interna.service';

/**
 * PrismaModule do `nestjs-prisma` e' obrigatorio aqui: os servicos fiscais
 * injetam o PrismaService DESSE pacote, que e' um token distinto do
 * PrismaService do projeto (`src/config/prisma`). SystemSettingsService usa o
 * do projeto, que e' global — por isso resolve sem import; o
 * IcmsAliquotaInternaService nao, e sem esta linha o app nao sobe.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService, IcmsAliquotaInternaService],
  exports: [SystemSettingsService, IcmsAliquotaInternaService],
})
export class SystemSettingsModule {}
