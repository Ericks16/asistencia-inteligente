import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: PrismaService.databaseUrl(),
        },
      },
    });
  }

  private static databaseUrl() {
    const url = process.env.DATABASE_URL;
    if (!url || !process.env.VERCEL) return url;

    try {
      const parsed = new URL(url);
      if (parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '5432') {
        parsed.port = '6543';
        parsed.searchParams.set('pgbouncer', 'true');
      }
      parsed.searchParams.set('connection_limit', '1');
      parsed.searchParams.set('pool_timeout', '20');
      return parsed.toString();
    } catch (error) {
      throw new Error(
        `DATABASE_URL no es válida: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error('No se pudo conectar a PostgreSQL', error instanceof Error ? error.stack : String(error));
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
