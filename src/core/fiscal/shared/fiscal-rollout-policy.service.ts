import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../config/prisma/prisma.service';
import { FiscalSecretMigrationStatus } from '@prisma/client';

@Injectable()
export class FiscalRolloutPolicyService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async validateBootstrapConfig(): Promise<void> {
    const dbEncrypted = this.configService.get<string>(
      'USE_ENCRYPTED_FISCAL_DB',
    );
    const writeMode = this.configService.get<string>('FISCAL_DB_WRITE_MODE');

    if (dbEncrypted !== 'true' && dbEncrypted !== 'false') {
      throw new Error(
        'CONFIG_ERROR: A variável USE_ENCRYPTED_FISCAL_DB deve ser explicitamente "true" ou "false"',
      );
    }
    if (writeMode !== 'DUAL' && writeMode !== 'ENCRYPTED_ONLY') {
      throw new Error(
        'CONFIG_ERROR: A variável FISCAL_DB_WRITE_MODE deve ser explicitamente "DUAL" ou "ENCRYPTED_ONLY"',
      );
    }

    // Matriz válida do rollout:
    // Fases 1-3: false + DUAL; Fase 4: true + DUAL; Fases 5-6: true + ENCRYPTED_ONLY.
    if (dbEncrypted === 'false' && writeMode === 'ENCRYPTED_ONLY') {
      throw new Error(
        'CONFIG_ERROR: ENCRYPTED_ONLY exige USE_ENCRYPTED_FISCAL_DB=true',
      );
    }

    if (dbEncrypted === 'true') {
      const state = await this.prisma.fiscalSecretMigrationState.findUnique({
        where: { version: 1 },
        select: { status: true },
      });
      if (!state || state.status !== FiscalSecretMigrationStatus.COMPLETED) {
        throw new Error(
          'CONFIG_ERROR: leitura criptografada exige backfill COMPLETED',
        );
      }
    }
  }

  shouldReadFromEncrypted(): boolean {
    return this.configService.get('USE_ENCRYPTED_FISCAL_DB') === 'true';
  }

  shouldWriteToLegacy(): boolean {
    return this.configService.get('FISCAL_DB_WRITE_MODE') === 'DUAL';
  }

  async isRolloutActivationEnabled(): Promise<boolean> {
    if (this.configService.get('USE_ENCRYPTED_FISCAL_DB') !== 'true')
      return false;
    if (this.configService.get('FISCAL_DB_WRITE_MODE') !== 'ENCRYPTED_ONLY')
      return false;
    const state = await this.prisma.fiscalSecretMigrationState.findUnique({
      where: { version: 1 },
      select: { status: true },
    });
    return !!state && state.status === FiscalSecretMigrationStatus.COMPLETED;
  }

  isProductionActivationEnabled(): boolean {
    return (
      this.configService.get('NFCE_PRODUCTION_ACTIVATION_ENABLED') === 'true'
    );
  }

  async isEnvironmentSwitchLocked(invoicyConfigId: string): Promise<boolean> {
    if (!this.shouldReadFromEncrypted()) return true;
    if (this.configService.get('FISCAL_DB_WRITE_MODE') !== 'ENCRYPTED_ONLY')
      return true;

    const state = await this.prisma.fiscalSecretMigrationState.findUnique({
      where: { version: 1 },
    });
    if (!state || state.status !== FiscalSecretMigrationStatus.COMPLETED)
      return true;

    const config = await this.prisma.invoicyConfig.findUnique({
      where: { id: invoicyConfigId },
    });
    return !config || config.activeEnvironment === null;
  }
}
