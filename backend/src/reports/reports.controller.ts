import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ForbiddenException } from '@nestjs/common';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('monthly/:employeeId')
  monthly(
    @Req() req: { user: JwtPayload },
    @Param('employeeId') employeeId: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    // RBAC: empleado solo su propio reporte.
    if (req.user.role === 'EMPLOYEE' && req.user.sub !== employeeId) {
      throw new ForbiddenException('Solo puede consultar su propio reporte');
    }
    return this.reports.monthly(employeeId, year, month);
  }
}
