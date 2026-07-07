import 'reflect-metadata';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { AppException } from './common/exceptions/app.exception';

function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      out.push(...Object.values(error.constraints).map((c) => `${path}: ${c}`));
    }
    if (error.children?.length) {
      out.push(...flattenValidationErrors(error.children, path));
    }
  }
  return out;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 15 * 1024 * 1024, trustProxy: true }),
  );
  const config = app.get(ConfigService);

  await app.register(multipart as any, {
    limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 20 },
  });

  // Dev'da har qanday origin'ga ruxsat (LAN qurilmalar — planshet kiosk, telefon).
  // Production'da faqat aniq frontend URL'lar.
  const isProd = config.get<string>('NODE_ENV') === 'production';
  app.enableCors({
    origin: isProd
      ? [config.getOrThrow<string>('LANDING_URL'), config.getOrThrow<string>('CLIENT_URL')]
      : true,
    credentials: true,
  });

  app.setGlobalPrefix(config.get<string>('API_PREFIX') ?? 'api/v1', {
    exclude: ['health'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        AppException.validation(
          'So‘rov ma’lumotlari validatsiyadan o‘tmadi',
          flattenValidationErrors(errors),
        ),
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FaceID SaaS API')
    .setDescription('FaceID davomat platformasi — REST API (kontrakt: docs/API_CONTRACT.md)')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Device-Token', in: 'header' }, 'device-token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.enableShutdownHooks();

  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`FaceID backend ishga tushdi: http://localhost:${port} (docs: /api/docs)`);
}

void bootstrap();
