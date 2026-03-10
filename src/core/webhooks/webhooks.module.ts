import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, forwardRef(() => SubscriptionsModule)],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
