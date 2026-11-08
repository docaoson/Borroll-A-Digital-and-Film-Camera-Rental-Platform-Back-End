import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 4000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  DIRECT_URL!: string;

  @IsString()
  SUPABASE_URL!: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY!: string;

  @IsString()
  @IsOptional()
  STORAGE_BUCKET_CAMERA_IMAGES: string = 'camera-images';

  @IsString()
  @IsOptional()
  STORAGE_BUCKET_KYC: string = 'kyc-documents';

  @IsString()
  @IsOptional()
  STORAGE_BUCKET_AVATARS: string = 'avatars';

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL: string = '15m';

  @IsNumber()
  @IsOptional()
  REFRESH_TTL_DAYS: number = 30;

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsNumber()
  @IsOptional()
  PLATFORM_FEE_PERCENT: number = 10;

  @IsNumber()
  @IsOptional()
  BOOKING_PENDING_TTL_HOURS: number = 24;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Environment validation error: ${errors.toString()}`);
  }
  return validatedConfig;
}
