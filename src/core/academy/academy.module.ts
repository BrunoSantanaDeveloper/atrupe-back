import { Module } from '@nestjs/common';
import { AcademyController } from './academy.controller';
import { AcademyService } from './academy.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Module({
  controllers: [AcademyController],
  providers: [AcademyService, PrismaService],
  exports: [AcademyService],
})
export class AcademyModule {}
