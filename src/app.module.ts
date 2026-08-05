import { Module, ValidationPipe } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { ReportModule } from './svc/report/report.module';
import configuration from './config/configuration';
import { ConfigModule } from '@nestjs/config';
import { PlugModule } from './svc/plug/plug.module';
import { APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from './svc/cache/cache.module';
import { UtilsModule } from './svc/utils/utils.module';
import { PdfService } from './svc/pdf/pdf.service';
import { PrismaModule } from './config/prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ContractModule } from './core/contract/contract.module';
import { ActivityTrackingInterceptor } from './core/activity-monitor/interceptors/activity-tracking.interceptor';
import { ActivityMonitorService } from './core/activity-monitor/activity-monitor.service';
import { PrismaService } from './config/prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    // Registracao unica do ThrottlerModule: ele e @Global e mais de um forRoot()
    // faria a ultima registracao sobrescrever a configuracao de todos os
    // modulos. Aqui ele so provisiona o storage compartilhado — os limites de
    // cada modulo ficam nos guards criados por `provideScopedThrottler`.
    ThrottlerModule.forRoot([]),
    PrismaModule,
    CoreModule,
    ReportModule,
    PlugModule,
    CacheModule,
    UtilsModule,
    ContractModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityTrackingInterceptor,
    },
    ActivityMonitorService,
    PrismaService,
    PdfService,
  ],
})
export class AppModule {}
