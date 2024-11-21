import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { ConfigService } from '@nestjs/config';
import * as compression from 'compression';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(compression());

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  const config: ConfigService = app.get(ConfigService);
  const port: number = config.get<number>('PORT');

  const doc = new DocumentBuilder()
    .setTitle('Atrupe - API Documentação')
    .setDescription('Documentação da API para o projeto Atrupe')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, doc);
  // Sort tags by name
  document.tags.sort((a, b) => a.name.localeCompare(b.name));

  SwaggerModule.setup('doc', app, document);

  await app.listen(port || 3000);
}
bootstrap();
