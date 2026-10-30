import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { CheckInDto } from './dto/check-in.dto';
import { CheckInGroupDto } from './dto/check-in-group.dto';
import { RekognitionFaceService } from './face-recognition.service';
import { assertGpsValid, validateGps } from './gps-validator';
import { computeDaily, localDateInZone, pairStamps, AttendanceStamp, DEFAULT_SHIFT } from './time-calculator';
import { hmacSha256 } from './crypto.util';
import { StorageService } from '../storage/storage.service';
import { AttendanceStatus, AttendanceType } from '../common/types/domain.types';

@Injectable()
export class AttendanceService {
  private readonly tz: string;
  private readonly matchThreshold: number;
  private readonly livenessThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ConfigService,
    private readonly face: RekognitionFaceService,
    private readonly storage: StorageService,
  ) {
    this.tz = cfg.get('APP_TIMEZONE') ?? 'America/Guayaquil';
    this.matchThreshold = Number(cfg.get('FACE_MATCH_THRESHOLD') ?? 0.95);
    this.livenessThreshold = Number(cfg.get('LIVENESS_THRESHOLD') ?? 0.9);
  }

  /** Modo local/mock: sin AWS Rekognition (dev). */
  private get isMock(): boolean {
    return (this.cfg.get('FACE_PROVIDER') ?? 'mock') === 'mock';
  }

  /** Registro individual (check-in / check-out). */
  async checkIn(user: JwtPayload, photo: Buffer, dto: CheckInDto, type: AttendanceType = 'CHECK_IN') {
    const gps = dto.gps ?? { latitude: 0, longitude: 0, accuracyM: 0, provider: 'none', isMock: false };

    if (!this.isMock) {
      await this.verifyIntegrity(photo, dto.nonce, dto.hmacSignature, dto.deviceId);
      this.assertGps(gps, user.sub);
    }

    // 1) Prueba de vida (anti-spoofing de pantalla/impresión).
    let liveness: { isLive: boolean; confidence: number };
    let matchScore: number;
    let matched: boolean;

    if (this.isMock) {
      liveness = { isLive: true, confidence: 0.99 };
      matchScore = 0.98;
      matched = true;
    } else {
      liveness = await this.face.verifyLiveness(dto.livenessToken);
      if (!liveness.isLive) {
        throw new BadRequestException('Prueba de vida fallida: rostro no válido');
      }
      // 2) Reconocimiento facial contra la foto de referencia.
      const ref = await this.prisma.faceEmbedding.findUnique({ where: { userId: user.sub } });
      if (!ref?.photoRef) {
        throw new BadRequestException('El empleado no tiene rostro registrado (enrollment pendiente)');
      }
      ({ matchScore, matched } = await this.face.compareFace(photo, ref.photoRef));
    }

    const status: AttendanceStatus =
      matched && liveness.confidence >= this.livenessThreshold ? 'VALID' : 'REJECTED';

    const { key: photoRef, hash: photoHash } = await this.storage.putPhoto(photo, user.sub);

    const log = await this.prisma.attendanceLog.create({
      data: {
        employeeId: user.sub,
        type,
        status,
        source: 'INDIVIDUAL',
        verification: this.isMock ? 'MANUAL' : 'AWS_REKOGNITION',
        photoRef,
        photoHash,
        gpsLat: gps.latitude,
        gpsLng: gps.longitude,
        gpsAccuracyM: gps.accuracyM,
        gpsProvider: gps.provider,
        gpsIsMock: gps.isMock,
        livenessScore: liveness.confidence,
        faceMatchScore: matchScore,
        faceCount: 1,
        serverTimestamp: new Date(),
        clientTimestamp: dto.clientTimestamp ? new Date(dto.clientTimestamp) : null,
        workDate: new Date(),
        nonceUsed: dto.nonce || null,
        deviceId: dto.deviceId,
      },
    });

    await this.audit(user.sub, type === 'CHECK_IN' ? 'CHECK_IN' : 'CHECK_OUT', log.id, user.sub, { matchScore });

    return {
      id: log.id,
      status,
      serverTimestamp: log.serverTimestamp,
      faceMatchScore: matchScore,
      livenessScore: liveness.confidence,
      photoHash,
      computed: await this.computeToday(user.sub),
    };
  }

  /** Registro grupal: una foto, múltiples rostros. */
  async checkInGroup(user: JwtPayload, photo: Buffer, dto: CheckInGroupDto) {
    const gps = dto.gps ?? { latitude: 0, longitude: 0, accuracyM: 0, provider: 'none', isMock: false };

    if (!this.isMock) {
      await this.verifyIntegrity(photo, dto.nonce, dto.hmacSignature, dto.deviceId);
      this.assertGps(gps, user.sub);
    }

    const { key: photoRef, hash: photoHash } = await this.storage.putPhoto(photo, user.sub);

    const session = await this.prisma.groupAttendanceSession.create({
      data: {
        initiatorId: user.sub,
        photoRef,
        photoHash,
        gpsLat: gps.latitude,
        gpsLng: gps.longitude,
        gpsAccuracyM: gps.accuracyM,
        gpsIsMock: gps.isMock,
        status: 'PROCESSING',
        totalFacesDetected: 0,
      },
    });

    // Modo mock (dev): simular varios rostros e identificar a los empleados semilla.
    if (this.isMock) {
      const employees = await this.prisma.user.findMany({
        where: { role: 'EMPLOYEE', status: 'ACTIVE' },
        include: { profile: true },
        take: 3,
      });
      const faces = employees.map((e, i) => ({
        index: i,
        boundingBox: { left: 0.05 + i * 0.3, top: 0.1, width: 0.2, height: 0.25 },
        employee: e,
      }));

      await this.prisma.groupAttendanceSession.update({
        where: { id: session.id },
        data: { totalFacesDetected: faces.length, totalMatched: faces.length, status: 'COMPLETED' },
      });

      const identified: Array<{ employeeId: string; name: string; matchScore: number; boundingBox: any }> = [];
      for (const f of faces) {
        const score = 0.97 - f.index * 0.005;
        identified.push({
          employeeId: f.employee.id,
          name: `${f.employee.profile?.firstName ?? ''} ${f.employee.profile?.lastName ?? ''}`.trim(),
          matchScore: score,
          boundingBox: f.boundingBox,
        });
        await this.prisma.attendanceLog.create({
          data: {
            employeeId: f.employee.id,
            type: 'CHECK_IN',
            status: 'VALID',
            source: 'GROUP',
            verification: 'MANUAL',
            photoRef,
            photoHash,
            faceMatchScore: score,
            faceCount: faces.length,
            groupSessionId: session.id,
            gpsLat: gps.latitude,
            gpsLng: gps.longitude,
            gpsAccuracyM: gps.accuracyM,
            gpsProvider: gps.provider,
            gpsIsMock: gps.isMock,
            serverTimestamp: new Date(),
            workDate: new Date(),
            deviceId: dto.deviceId,
          },
        });
      }
      await this.audit(user.sub, 'CHECK_IN_GROUP', session.id, user.sub, { totalMatched: faces.length, total: faces.length, mock: true });
      return {
        sessionId: session.id,
        status: 'COMPLETED',
        totalFacesDetected: faces.length,
        identified,
        unidentifiedCount: 0,
      };
    }

    // 3) Detectar todas las caras + bounding boxes.
    const faces = await this.face.detectFaces(photo);
    await this.prisma.groupAttendanceSession.update({
      where: { id: session.id },
      data: { totalFacesDetected: faces.length },
    });
    if (faces.length === 0) {
      await this.prisma.groupAttendanceSession.update({ where: { id: session.id }, data: { status: 'FAILED' } });
      throw new BadRequestException('No se detectaron rostros en la imagen');
    }

    // 4) Comparar cada cara contra la plantilla de empleados.
    //    (A escala: reemplazar el bucle por búsqueda HNSW en pgvector o
    //     SearchFacesByImage de Rekognition sobre una colección.)
    const employees = await this.prisma.faceEmbedding.findMany({
      where: { photoRef: { not: null }, user: { status: 'ACTIVE' } },
      include: { user: { include: { profile: true } } },
    });

    const identified: Array<{ employeeId: string; name: string; matchScore: number; boundingBox: any }> = [];
    let totalMatched = 0;

    for (const face of faces) {
      let best: { score: number; employee: (typeof employees)[number] } | null = null;
      for (const emp of employees) {
        const { matchScore, matched } = await this.face.compareFace(photo, emp.photoRef!);
        if (matched && (!best || matchScore > best.score)) {
          best = { score: matchScore, employee: emp };
        }
      }

      if (best) {
        totalMatched++;
        identified.push({
          employeeId: best.employee.userId,
          name: `${best.employee.user.profile?.firstName ?? ''} ${best.employee.user.profile?.lastName ?? ''}`.trim(),
          matchScore: best.score,
          boundingBox: face.boundingBox,
        });

        const log = await this.prisma.attendanceLog.create({
          data: {
            employeeId: best.employee.userId,
            type: 'CHECK_IN',
            status: 'VALID',
            source: 'GROUP',
            verification: 'AWS_REKOGNITION',
            photoRef,
            photoHash,
            faceMatchScore: best.score,
            faceCount: faces.length,
            groupSessionId: session.id,
            gpsLat: gps.latitude,
            gpsLng: gps.longitude,
            gpsAccuracyM: gps.accuracyM,
            gpsProvider: gps.provider,
            gpsIsMock: gps.isMock,
            serverTimestamp: new Date(),
            workDate: new Date(),
            deviceId: dto.deviceId,
          },
        });

        await this.prisma.groupAttendanceMatch.create({
          data: {
            sessionId: session.id,
            employeeId: best.employee.userId,
            attendanceLogId: log.id,
            faceIndex: face.index,
            boundingBox: face.boundingBox as any,
            matchScore: best.score,
            matched: true,
          },
        });
      } else {
        await this.prisma.groupAttendanceMatch.create({
          data: { sessionId: session.id, faceIndex: face.index, boundingBox: face.boundingBox as any, matched: false },
        });
      }
    }

    await this.prisma.groupAttendanceSession.update({
      where: { id: session.id },
      data: { totalMatched, status: totalMatched === faces.length ? 'COMPLETED' : 'PARTIAL' },
    });
    await this.audit(user.sub, 'CHECK_IN_GROUP', session.id, user.sub, { totalMatched, total: faces.length });

    return {
      sessionId: session.id,
      status: totalMatched === faces.length ? 'COMPLETED' : 'PARTIAL',
      totalFacesDetected: faces.length,
      identified,
      unidentifiedCount: faces.length - totalMatched,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Verifica HMAC(foto + nonce + deviceId) y que el nonce no fue usado. */
  private async verifyIntegrity(photo: Buffer, nonce: string, signature: string, deviceId: string) {
    const secret = `${this.cfg.get('JWT_SECRET')}:${deviceId}`;
    const expected = hmacSha256(Buffer.concat([photo, Buffer.from(nonce), Buffer.from(deviceId)]), secret);
    if (!this.safeEqual(expected, signature)) {
      throw new BadRequestException('Firma HMAC inválida: la foto pudo ser manipulada o reutilizada');
    }
    const used = await this.prisma.attendanceLog.findUnique({ where: { nonceUsed: nonce } });
    if (used) throw new BadRequestException('Nonce ya utilizado (posible reenvío de foto)');
  }

  private assertGps(gps: CheckInDto['gps'], userId: string) {
    const center = this.cfg.get('GEOFENCE_LAT')
      ? {
          lat: Number(this.cfg.get('GEOFENCE_LAT')),
          lng: Number(this.cfg.get('GEOFENCE_LNG')),
        }
      : undefined;
    const result = validateGps(gps, {
      maxAccuracyM: Number(this.cfg.get('GPS_MAX_ACCURACY_M') ?? 20),
      geofenceCenter: center,
      geofenceRadiusM: Number(this.cfg.get('GEOFENCE_RADIUS_M') ?? 150),
    });
    assertGpsValid(result);
  }

  /** Calcula el desglose del día actual (entrada + salida emparejadas). */
  private async computeToday(employeeId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const logs = await this.prisma.attendanceLog.findMany({
      where: { employeeId, serverTimestamp: { gte: start }, status: { in: ['VALID', 'MANUAL'] } },
    });
    const stamps: AttendanceStamp[] = logs.map((l) => ({
      type: l.type as 'CHECK_IN' | 'CHECK_OUT',
      at: l.serverTimestamp,
    }));
    const { entry, exit } = pairStamps(stamps, this.tz);
    return computeDaily(entry?.at ?? null, exit?.at ?? null, DEFAULT_SHIFT, this.tz);
  }

  private safeEqual(a: string, b: string) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return require('crypto').timingSafeEqual(ab, bb);
  }

  private async audit(actorId: string, action: any, entityId: string, userId: string, meta: any) {
    await this.prisma.auditLog.create({
      data: { actorId, action, entity: 'attendance_logs', entityId, metadata: meta },
    });
  }
}
