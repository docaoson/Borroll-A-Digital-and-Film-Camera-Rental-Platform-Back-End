import {
  BadRequestException,
  Logger,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // 1. Security Headers
  app.use(helmet());

  // 2. Cookie Parser
  app.use(cookieParser());

  // 3. Trust Proxy (hỗ trợ reverse proxy Render, Vercel, Cloudflare lấy IP chuẩn cho Throttler)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // 4. Global API Prefix
  app.setGlobalPrefix('api/v1');

  // 5. CORS
  const corsOrigin = configService.get<string>(
    'CORS_ORIGIN',
    'http://localhost:3000',
  );
  const allowedOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
  });

  // 6. Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const fields: Record<string, string> = {};
        const extractErrors = (errs: ValidationError[]) => {
          for (const err of errs) {
            if (err.constraints) {
              fields[err.property] = Object.values(err.constraints)[0];
            }
            if (err.children && err.children.length > 0) {
              extractErrors(err.children);
            }
          }
        };
        extractErrors(errors);
        return new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Dữ liệu gửi lên không hợp lệ.',
          details: { fields },
        });
      },
    }),
  );

  // 7. Global Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // 8. Swagger Docs: Gating - Tắt khi NODE_ENV = 'production'
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const sentryDsn = configService.get<string>('SENTRY_DSN');
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: nodeEnv,
    });
    logger.log('Sentry error tracking initialized');
  }

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Borroll API')
      .setDescription('Borroll Camera Rental Backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger documentation enabled at /api/docs');
  } else {
    logger.log('Swagger documentation disabled in production mode');
  }

  // 9. Server Listen
  const port = configService.get<number>('PORT', 4000);
  await app.listen(port);
  logger.log(`Application is running on port ${port} [ENV: ${nodeEnv}]`);
}
void bootstrap();
