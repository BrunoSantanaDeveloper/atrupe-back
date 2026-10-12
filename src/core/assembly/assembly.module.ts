import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { AssemblyResourceController } from './assembly-resource.controller';
import { AssemblyResourceService } from './assembly-resource.service';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';
import { ProductAssemblyController } from './product-assembly.controller';
import { ProductAssemblyService } from './product-assembly.service';

/**
 * Processos e composição do produto (módulo 1, parte A): o mesmo formato de
 * etapa, linhas, opções, campos e fórmulas (MS-11), e o motor de cálculo no
 * servidor (SEG-1).
 */
@Module({
  imports: [AuthModule, PrismaModule, PricingModule],
  controllers: [
    AssemblyResourceController,
    ProcessController,
    ProductAssemblyController,
  ],
  providers: [AssemblyResourceService, ProcessService, ProductAssemblyService],
  exports: [AssemblyResourceService, ProcessService, ProductAssemblyService],
})
export class AssemblyModule {}
