import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { ProductionStageModule } from '../sale/production-stage/production-stage.module';
import { ProductionAccessService } from './production-access.service';
import { ProductionBoardService } from './production-board.service';
import { ProductionConfigController } from './production-config.controller';
import { ProductionConfigService } from './production-config.service';
import { ProductionMirrorService } from './production-mirror.service';
import { ProductionProjectService } from './production-project.service';
import { ProductionTaskController } from './production-task.controller';
import { ProductionTaskService } from './production-task.service';
import { ProductionViewService } from './production-view.service';
import { ProductionController } from './production.controller';
import { ProductionFilesService } from './storage/production-files.service';
import { ProductionCleanupService } from './storage/production-cleanup.service';
import { OrderFilesService } from './storage/order-files.service';
import { OrderFilesController } from './order-files.controller';
import { CompanyStorageController } from './company-storage.controller';
import { ProductionOccupancyService } from './production-occupancy.service';
import { ProductionTripController } from './production-trip.controller';
import { ProductionTripService } from './production-trip.service';
import { CompanyStorageService } from './storage/company-storage.service';
import { ProductionStorageService } from './storage/production-storage.service';

/**
 * O gerenciador de produção (módulo 3, ELITE, Fase 6). O orçamento importa
 * este módulo: a aprovação cria o projeto (ProductionProjectService).
 */
@Module({
  // AuthModule fornece o AbacService (guard e quem é gerente); o módulo da
  // agenda dá o recálculo da entrega quando as etapas espelhadas fecham
  imports: [PrismaModule, AuthModule, ProductionStageModule, StockModule],
  controllers: [
    ProductionConfigController,
    ProductionController,
    ProductionTaskController,
    OrderFilesController,
    CompanyStorageController,
    ProductionTripController,
  ],
  providers: [
    ProductionAccessService,
    ProductionConfigService,
    ProductionViewService,
    ProductionProjectService,
    ProductionTaskService,
    ProductionBoardService,
    ProductionMirrorService,
    ProductionStorageService,
    ProductionFilesService,
    ProductionCleanupService,
    OrderFilesService,
    CompanyStorageService,
    ProductionOccupancyService,
    ProductionTripService,
  ],
  exports: [ProductionProjectService],
})
export class ProductionModule {}
