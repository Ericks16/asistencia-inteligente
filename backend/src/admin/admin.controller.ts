import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '../common/types/domain.types';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Patch('attendance/:id')
  async patchAttendance(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { type?: 'CHECK_IN' | 'CHECK_OUT'; serverTimestamp?: string; status?: 'VALID' | 'MANUAL' | 'REJECTED'; reason: string },
  ) {
    if (!body.reason) throw new BadRequestException('El motivo es obligatorio');

    const existing = await this.prisma.attendanceLog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Registro no encontrado');

    const oldValue = {
      type: existing.type,
      serverTimestamp: existing.serverTimestamp,
      status: existing.status,
    };

    const updated = await this.prisma.attendanceLog.update({
      where: { id },
      data: {
        type: body.type ?? existing.type,
        serverTimestamp: body.serverTimestamp ? new Date(body.serverTimestamp) : existing.serverTimestamp,
        status: body.status ?? 'MANUAL',
      },
    });

    // Corrección inmutable en auditoría + tabla de ajustes.
    await this.prisma.attendanceAdjustment.create({
      data: {
        attendanceLogId: id,
        adminId: req.user.sub,
        reason: body.reason,
        oldValue: oldValue as any,
        newValue: { type: updated.type, serverTimestamp: updated.serverTimestamp, status: updated.status } as any,
      },
    });
    await this.audit.record(req.user.sub, 'ATTENDANCE_EDIT', 'attendance_logs', id, oldValue, {
      reason: body.reason,
      newValue: { type: updated.type, status: updated.status },
    });

    return updated;
  }

  @Get('reports/monthly')
  async monthlyReports(@Query('year') year: string, @Query('month') month: string) {
    return this.prisma.monthlyReport.findMany({
      where: { year: Number(year), month: Number(month) },
      include: { employee: { include: { profile: true } } },
    });
  }

  @Get('audit-logs')
  async auditLogs(
    @Query('entity') entity?: string,
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        entity,
        actorId,
        createdAt: from ? { gte: new Date(from) } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
