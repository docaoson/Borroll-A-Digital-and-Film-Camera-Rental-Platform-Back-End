import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';

export const BACKEND_ENV_FILE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '.env',
);

/**
 * Đọc trực tiếp file Backend/.env và ghi đè lên process.env để đảm bảo
 * không bị biến môi trường hệ điều hành (Windows/terminal cũ) trỏ nhầm sang DB khác.
 */
export function enforceBackendDotEnv(
  targetConfig?: Record<string, unknown>,
): void {
  const candidates = [
    BACKEND_ENV_FILE_PATH,
    path.resolve(process.cwd(), '.env'),
  ];
  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) return;

  const rawContent = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of rawContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }

    if (key === 'NODE_ENV' && process.env.NODE_ENV === 'test') {
      continue;
    }

    process.env[key] = value;
    if (targetConfig) {
      targetConfig[key] = value;
    }
  }
}

export function extractSupabaseProjectRef(
  supabaseUrl?: string,
  databaseUrl?: string,
): {
  supabaseUrlRef: string | null;
  databaseUrlRef: string | null;
} {
  let supabaseUrlRef: string | null = null;
  let databaseUrlRef: string | null = null;

  if (supabaseUrl) {
    const match = supabaseUrl
      .trim()
      .match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
    if (match) {
      supabaseUrlRef = match[1].toLowerCase();
    }
  }

  if (databaseUrl) {
    const poolerMatch = databaseUrl.trim().match(/postgres\.([a-z0-9-]+)[:@]/i);
    const directMatch = databaseUrl
      .trim()
      .match(/@db\.([a-z0-9-]+)\.supabase\.co/i);
    if (poolerMatch) {
      databaseUrlRef = poolerMatch[1].toLowerCase();
    } else if (directMatch) {
      databaseUrlRef = directMatch[1].toLowerCase();
    }
  }

  return { supabaseUrlRef, databaseUrlRef };
}

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
  STORAGE_BUCKET_AVATARS: string = 'avatars';

  @IsString()
  @IsOptional()
  STORAGE_BUCKET_RENTAL_IMAGES: string = 'rental-images';

  @IsString()
  @IsOptional()
  STORAGE_BUCKET_HANDOVER: string = 'handover-photos';

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
  BOOKING_PENDING_TTL_HOURS: number = 24;

  @IsString()
  @IsOptional()
  AI_PROVIDER?: string;

  @IsString()
  @IsOptional()
  AI_API_KEY?: string;

  @IsString()
  @IsOptional()
  AI_MODEL?: string;

  @IsNumber()
  @IsOptional()
  AI_DAILY_LIMIT_PER_USER: number = 20;
}

export function validate(config: Record<string, unknown>) {
  enforceBackendDotEnv(config);

  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Environment validation error: ${errors.toString()}`);
  }

  const { supabaseUrlRef, databaseUrlRef } = extractSupabaseProjectRef(
    validatedConfig.SUPABASE_URL,
    validatedConfig.DATABASE_URL,
  );
  if (supabaseUrlRef && databaseUrlRef && supabaseUrlRef !== databaseUrlRef) {
    throw new Error(
      `Supabase configuration mismatch in .env: DATABASE_URL points to project "${databaseUrlRef}" while SUPABASE_URL points to "${supabaseUrlRef}".`,
    );
  }

  return validatedConfig;
}
