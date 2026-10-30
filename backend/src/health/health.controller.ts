import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let database = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'disconnected';
    }

    return {
      status: 'ok',
      service: 'asistencia-inteligente-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database,
      shift: {
        officialEntry: '08:00',
        officialExit: '17:00',
        lunch: '1 hora',
        ordinaryHoursPerDay: '8 horas',
      },
    };
  }
}
