import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

type ExpiredLog = { id: string; photoRef: string | null; groupSessionId: string | null };
type ExpiredSession = { id: string; photoRef: string | null };

@Injectable()
export class RetentionService {
  private readonly days: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.days = Number(config.get('PHOTO_RETENTION_DAYS') ?? 45);
    if (!Number.isInteger(this.days) || this.days < 1) {
      throw new Error('PHOTO_RETENTION_DAYS debe ser un entero positivo');
    }
  }

  async purgeExpired(referenceDate = new Date()) {
    const cutoff = new Date(referenceDate.getTime() - this.days * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.attendanceLog.findMany({
      where: { serverTimestamp: { lt: cutoff } },
      select: { id: true, photoRef: true, groupSessionId: true },
    });
    const sessions = await this.prisma.groupAttendanceSession.findMany({
      where: {
        serverTimestamp: { lt: cutoff },
        logs: { none: { serverTimestamp: { gte: cutoff } } },
      },
      select: { id: true, photoRef: true },
    });

    const expiredLogs = logs as ExpiredLog[];
    const expiredSessions = sessions as ExpiredSession[];
    const keys = new Set(
      [...expiredLogs, ...expiredSessions]
        .map((item: ExpiredLog | ExpiredSession) => item.photoRef)
        .filter((key): key is string => Boolean(key)),
    );
    for (const key of keys) await this.storage.deletePhoto(key);

    const logIds = expiredLogs.map((log: ExpiredLog) => log.id);
    const sessionIds = expiredSessions.map((session: ExpiredSession) => session.id);
    if (logIds.length) {
      await this.prisma.overtimeRecord.deleteMany({ where: { sourceLogId: { in: logIds } } });
      await this.prisma.attendanceAdjustment.deleteMany({ where: { attendanceLogId: { in: logIds } } });
      await this.prisma.groupAttendanceMatch.deleteMany({ where: { attendanceLogId: { in: logIds } } });
      await this.prisma.attendanceLog.deleteMany({ where: { id: { in: logIds } } });
    }
    if (sessionIds.length) {
      await this.prisma.groupAttendanceMatch.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await this.prisma.groupAttendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
    }

    return { cutoff, deletedLogs: logIds.length, deletedSessions: sessionIds.length, deletedPhotos: keys.size };
  }
}
