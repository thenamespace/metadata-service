import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(multipart as unknown as any, {
    attachFieldsToBody: true,
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });

  if (process.env.STORAGE_MODE === 'local') {
    await app.register(fastifyStatic as unknown as any, {
      root: path.resolve(process.cwd(), 'public'),
      prefix: '/static/',
      decorateReply: false,
    });
  }

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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
