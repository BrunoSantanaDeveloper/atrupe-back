import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { OwnershipAcceptanceService } from './ownership-acceptance.service';
import { OwnershipInviteController } from './ownership-invite.controller';
import { OwnershipController } from './ownership.controller';
import { OwnershipService } from './ownership.service';

/** Transferência de titularidade: o envio pelo titular e o aceite pelo convite. */
@Module({
  imports: [SubscriptionsModule, AuthModule],
  controllers: [OwnershipController, OwnershipInviteController],
  providers: [OwnershipService, OwnershipAcceptanceService],
  exports: [OwnershipService],
})
export class OwnershipModule {}
