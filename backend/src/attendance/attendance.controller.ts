import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttendanceService } from './attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckInGroupDto } from './dto/check-in-group.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('check-in')
  @UseInterceptors(FileInterceptor('photo'))
  checkIn(
    @Req() req: { user: JwtPayload },
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: any,
  ) {
    const dto = this.parseMultipart(body);
    return this.attendance.checkIn(req.user, photo.buffer, dto, 'CHECK_IN');
  }

  @Post('check-out')
  @UseInterceptors(FileInterceptor('photo'))
  checkOut(
    @Req() req: { user: JwtPayload },
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: any,
  ) {
    const dto = this.parseMultipart(body);
    return this.attendance.checkIn(req.user, photo.buffer, dto, 'CHECK_OUT');
  }

  @Post('check-in-group')
  @UseInterceptors(FileInterceptor('photo'))
  checkInGroup(
    @Req() req: { user: JwtPayload },
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: any,
  ) {
    const dto = this.parseMultipartGroup(body);
    return this.attendance.checkInGroup(req.user, photo.buffer, dto);
  }

  @Post('face-enroll')
  @UseInterceptors(FileInterceptor('photo'))
  enrollFace(
    @Req() req: { user: JwtPayload },
    @UploadedFile() photo: Express.Multer.File,
    @Body() body: { descriptor?: string },
  ) {
    return this.attendance.enrollOwnFace(req.user, photo?.buffer, body.descriptor ?? '');
  }

  @Get('history/:employeeId')
  async history(
    @Req() req: { user: JwtPayload },
    @Param('employeeId') employeeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Empleado solo puede ver su propio historial; admin puede ver todos.
    if (req.user.role === 'EMPLOYEE' && req.user.sub !== employeeId) {
      throw new ForbiddenException('Solo puede ver su propio historial');
    }

    const items = await this.prisma.attendanceLog.findMany({
      where: {
        employeeId,
        serverTimestamp: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      orderBy: { serverTimestamp: 'asc' },
    });
    return { items };
  }

  @Get('face-reference')
  async faceReference(@Req() req: { user: JwtPayload }) {
    const embedding = await this.prisma.faceEmbedding.findUnique({
      where: { userId: req.user.sub },
      select: { photoRef: true, photoData: true, descriptor: true },
    });
    if (!embedding?.photoRef) {
      return { enrolled: false };
    }

    if (embedding.descriptor) {
      return { enrolled: true, descriptor: JSON.parse(embedding.descriptor) };
    }
    const photo = await this.attendance.getReferencePhoto(embedding.photoRef, embedding.photoData);
    return {
      enrolled: true,
      contentType: 'image/jpeg',
      imageBase64: photo.toString('base64'),
    };
  }

  /** En multipart/form-data, los campos no-archivo llegan como strings. */
  private parseMultipart(body: any): CheckInDto {
    return {
      nonce: body.nonce,
      hmacSignature: body.hmacSignature,
      livenessToken: body.livenessToken,
      deviceId: body.deviceId,
      clientTimestamp: body.clientTimestamp,
      gps: typeof body.gps === 'string' ? JSON.parse(body.gps) : body.gps,
    };
  }

  private parseMultipartGroup(body: any): CheckInGroupDto {
    return {
      nonce: body.nonce,
      hmacSignature: body.hmacSignature,
      deviceId: body.deviceId,
      gps: typeof body.gps === 'string' ? JSON.parse(body.gps) : body.gps,
    };
  }
}
