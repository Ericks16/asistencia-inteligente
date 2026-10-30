import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeMonthly, localDateInZone, AttendanceStamp, DEFAULT_SHIFT } from '../attendance/time-calculator';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async monthly(employeeId: string, year: number, month: number) {
    const employee = await this.prisma.user.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Empleado no encontrado');

    // Rango del mes en UTC (el cálculo interno agrupa por fecha local).
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));

    const logs = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        serverTimestamp: { gte: from, lt: to },
        status: { in: ['VALID', 'MANUAL'] },
      },
      orderBy: { serverTimestamp: 'asc' },
    });

    // Agrupar marcas por día local.
    const stampsByDate: Record<string, AttendanceStamp[]> = {};
    for (const l of logs) {
      const date = localDateInZone(l.serverTimestamp, 'America/Guayaquil');
      (stampsByDate[date] ??= []).push({ type: l.type as 'CHECK_IN' | 'CHECK_OUT', at: l.serverTimestamp });
    }

    const computed = computeMonthly(stampsByDate, DEFAULT_SHIFT, 'America/Guayaquil');

    // Detalle diario con foto (URL firmada) y mapa GPS.
    const detail = await Promise.all(computed.days.map(async (day) => {
      const dayLogs = logs.filter((l) => localDateInZone(l.serverTimestamp, 'America/Guayaquil') === day.date);
      const withPhoto = dayLogs.find((l) => l.photoRef);
      return {
        date: day.date,
        entryTime: day.entryTime,
        exitTime: day.exitTime,
        overtimeMinutes: day.overtimeMinutes,
        ordinaryMinutes: day.ordinaryMinutes,
        status: day.status,
        photoUrl: withPhoto?.photoRef ? await this.storage.signedUrl(withPhoto.photoRef) : null,
        gps: withPhoto ? { latitude: withPhoto.gpsLat, longitude: withPhoto.gpsLng } : null,
      };
    }));

    // Persistir (upsert) el reporte mensual.
    const report = await this.prisma.monthlyReport.upsert({
      where: { employeeId_year_month: { employeeId, year, month } },
      create: {
        employeeId,
        year,
        month,
        daysWorked: computed.daysWorked,
        absences: computed.absences,
        lateArrivalsCount: computed.lateArrivalsCount,
        totalOrdinaryMinutes: computed.totalOrdinaryMinutes,
        totalOvertimeMinutes: computed.totalOvertimeMinutes,
        detail,
      },
      update: {
        daysWorked: computed.daysWorked,
        absences: computed.absences,
        lateArrivalsCount: computed.lateArrivalsCount,
        totalOrdinaryMinutes: computed.totalOrdinaryMinutes,
        totalOvertimeMinutes: computed.totalOvertimeMinutes,
        detail,
      },
    });

    return report;
  }

}
