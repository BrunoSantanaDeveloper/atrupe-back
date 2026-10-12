import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { ReportModule } from './svc/report/report.module';
import configuration from './config/configuration';
import { ConfigModule } from '@nestjs/config';
import { PlugModule } from './svc/plug/plug.module';
import { APP_PIPE, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
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
import { PageLimitMiddleware } from './common/pagination/page-limit.middleware';
import { AccountThrottlerGuard } from './common/throttler/account-throttler.guard';
import { AuthModule } from './core/auth/auth.module';
import { ValuesVisibilityInterceptor } from './core/auth/abac/values-visibility.interceptor';

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
    AuthModule,
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
    // Dinheiro só para quem tem values:values:view, nas rotas marcadas com
    // @MoneyFields ou @ValuesOnly: observa por padrão
    // (VALUES_VISIBILITY_ENFORCE=true omite os campos e recusa as rotas)
    {
      provide: APP_INTERCEPTOR,
      useClass: ValuesVisibilityInterceptor,
    },
    // Requisições por conta e por minuto: observa por padrão
    // (ACCOUNT_RATE_LIMIT_ENFORCE=true recusa com 429)
    {
      provide: APP_GUARD,
      useClass: AccountThrottlerGuard,
    },
    ActivityMonitorService,
    PrismaService,
    PdfService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Teto de paginação: observa por padrão (PAGE_LIMIT_ENFORCE=true corta)
    consumer.apply(PageLimitMiddleware).forRoutes('*');
  }
}
