import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');

  const corsOrigin = configService.get<string>(
    'CORS_ORIGIN',
    'http://localhost:3000',
  );
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

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

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Borroll API')
    .setDescription('Borroll Camera Rental Backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port);
  console.log(`Application is running on port ${port}`);
}
void bootstrap();
