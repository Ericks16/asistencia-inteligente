import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

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

    const keys = new Set(
      [...logs, ...sessions]
        .map((item) => item.photoRef)
        .filter((key): key is string => Boolean(key)),
    );
    for (const key of keys) await this.storage.deletePhoto(key);

    const logIds = logs.map((log) => log.id);
    const sessionIds = sessions.map((session) => session.id);
    await this.prisma.$transaction(async (tx) => {
      if (logIds.length) {
        await tx.overtimeRecord.deleteMany({ where: { sourceLogId: { in: logIds } } });
        await tx.attendanceAdjustment.deleteMany({ where: { attendanceLogId: { in: logIds } } });
        await tx.groupAttendanceMatch.deleteMany({ where: { attendanceLogId: { in: logIds } } });
        await tx.attendanceLog.deleteMany({ where: { id: { in: logIds } } });
      }
      if (sessionIds.length) {
        await tx.groupAttendanceMatch.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.groupAttendanceSession.deleteMany({ where: { id: { in: sessionIds } } });
      }
    });

    return { cutoff, deletedLogs: logIds.length, deletedSessions: sessionIds.length, deletedPhotos: keys.size };
  }
}
