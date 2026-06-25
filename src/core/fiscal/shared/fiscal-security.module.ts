import { Module, Global, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../config/prisma/prisma.module';
import { EncryptionService } from '../../../shared/services/encryption.service';
import { FiscalCredentialResolverService } from './fiscal-credential-resolver.service';
import { FiscalAuditService } from './fiscal-audit.service';
import { FiscalRolloutPolicyService } from './fiscal-rollout-policy.service';

@Global()
@Module({
  imports: [PrismaModule, ConfigModule],
  providers: [
    EncryptionService,
    FiscalCredentialResolverService,
    FiscalAuditService,
    FiscalRolloutPolicyService,
  ],
  exports: [
    EncryptionService,
    FiscalCredentialResolverService,
    FiscalAuditService,
    FiscalRolloutPolicyService,
  ],
})
export class FiscalSecurityModule implements OnApplicationBootstrap {
  constructor(private readonly rolloutPolicy: FiscalRolloutPolicyService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.rolloutPolicy.validateBootstrapConfig();
  }
}
