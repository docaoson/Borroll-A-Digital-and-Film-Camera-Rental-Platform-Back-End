import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import {
  enforceBackendDotEnv,
  extractSupabaseProjectRef,
} from '../../config/env.validation';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  public readonly supabaseProjectRef: string | null;

  constructor(private readonly configService: ConfigService) {
    enforceBackendDotEnv();
    const databaseUrl =
      configService.get<string>('DATABASE_URL')?.trim() ||
      process.env.DATABASE_URL?.trim();

    super({
      ...(databaseUrl
        ? {
            datasources: {
              db: {
                url: databaseUrl,
              },
            },
          }
        : {}),
      transactionOptions: {
        maxWait: 10000,
        timeout: 15000,
      },
    });

    const supabaseUrl =
      configService.get<string>('SUPABASE_URL')?.trim() ||
      process.env.SUPABASE_URL?.trim();
    const { supabaseUrlRef, databaseUrlRef } = extractSupabaseProjectRef(
      supabaseUrl,
      databaseUrl,
    );
    this.supabaseProjectRef = databaseUrlRef || supabaseUrlRef || null;
  }

  onModuleInit() {
    this.$connect()
      .then(() => {
        if (this.supabaseProjectRef) {
          this.logger.log(
            `Connected to Supabase PostgreSQL project: ${this.supabaseProjectRef}`,
          );
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Initial DB connect deferred: ${msg}`);
      });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
