import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/types/domain.types';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('employees')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  employees() {
    return this.reports.employees();
  }

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
