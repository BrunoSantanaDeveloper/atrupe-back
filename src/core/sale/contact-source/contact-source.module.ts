import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { ContactSourceController } from './contact-source.controller';
import { ContactSourceService } from './contact-source.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContactSourceController],
  providers: [ContactSourceService],
})
export class ContactSourceModule {}
