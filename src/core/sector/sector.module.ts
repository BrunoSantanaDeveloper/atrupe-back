import { Module } from '@nestjs/common';
import { SectorService } from './sector.service';
import { SectorController } from './sector.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SectorController],
  providers: [SectorService],
})
export class SectorModule {}
