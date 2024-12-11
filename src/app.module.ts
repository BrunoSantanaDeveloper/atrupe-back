import { Module, ValidationPipe } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CoreModule } from './core/core.module';
import { ReportModule } from './svc/report/report.module';
import configuration from './config/configuration';
import { ConfigModule } from '@nestjs/config';
import { PlugModule } from './svc/plug/plug.module';
import { APP_PIPE } from '@nestjs/core';
import { CacheModule } from './svc/cache/cache.module';
import { UtilsModule } from './svc/utils/utils.module';
import { PdfService } from './svc/pdf/pdf.service';
import { PrismaModule } from './config/prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CoreModule,
    ReportModule,
    PlugModule,
    CacheModule,
    UtilsModule,
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
    PdfService,
  ],
})
export class AppModule {}
