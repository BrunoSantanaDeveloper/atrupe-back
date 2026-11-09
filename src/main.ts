import 'dotenv/config';
// import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { ConfigService } from '@nestjs/config';
import * as compression from 'compression';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as packageJson from '../package.json';

async function bootstrap() {
  // rawBody: o robô do atendimento assina o corpo exato da requisição
  // (src/core/atendimento); o JSON continua chegando em req.body como antes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // O contexto do robô do atendimento (instruções e conhecimento) passa de
  // 100 kB, o limite padrão do JSON.
  app.useBodyParser('json', { limit: '1mb' });

  app.use(compression());
  app.use(helmet());

  const config: ConfigService = app.get(ConfigService);
  const port: number = config.get<number>('PORT');
  const appEnv = config.get<string>('APP_ENV') || 'development';

  // CORS: read allowed origins from env, fallback to * in dev
  const corsOrigins = config.get<string>('CORS_ORIGINS');
  app.enableCors({
    origin: corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    // Sem isto o navegador esconde os headers customizados do front
    // (exportacao de XML avisa notas faltantes por header).
    exposedHeaders: ['Content-Disposition', 'X-Nfe-Total', 'X-Nfe-Missing-Xml'],
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger: only in non-production
  if (appEnv !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Atrupe - API Documentação')
      .setDescription('Documentação da API para o projeto Atrupe')
      .setVersion(packageJson.version)
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, doc);
    document.tags.sort((a, b) => a.name.localeCompare(b.name));

    SwaggerModule.setup('doc', app, document);
  }

  await app.listen(port || 5000);
}
bootstrap();
