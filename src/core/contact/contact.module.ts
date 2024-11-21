import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
