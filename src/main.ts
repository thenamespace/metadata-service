import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const configService = app.get(ConfigService);

  await app.register(cors as unknown as any, {
    origin: '*',
    methods: ['POST', 'GET', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: '*',
  } as any);

  await app.register(multipart as unknown as any, {
    attachFieldsToBody: true,
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  } as any);

  // Static local serving removed; GCS is always used

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false },
    }),
  );

  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // Setup Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Metadata Service API')
    .setDescription('API for generating ENS subname metadata and images')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Expose OpenAPI JSON endpoint
  app.getHttpAdapter().get('/openapi.json', (req, res) => {
    res.header('Content-Type', 'application/json');
    res.send(document);
  });

  const port = Number(configService.get<number>('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
