import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { StatusService } from './status.service';
import { StatusController } from './status.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}
