import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { NatureService } from './nature.service';
import { NatureController } from './nature.controller';

@Module({
  imports: [PrismaModule],
  controllers: [NatureController],
  providers: [NatureService],
})
export class NatureModule {}
