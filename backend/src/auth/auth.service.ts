import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';
import { verifySecret } from './password.util';
import { PrismaService } from '../prisma/prisma.service';
import { LoginCedulaDto } from './dto/login-cedula.dto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async loginByCedula(dto: LoginCedulaDto) {
    const user = await this.prisma.user.findUnique({
      where: { cedula: dto.cedula },
      include: { profile: true },
    });
    if (!user) throw new UnauthorizedException('Cédula o PIN incorrectos');

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Usuario inactivo o suspendido');
    }

    // Validar contra pinHash o passwordHash (scrypt, memory-hard).
    const hash = user.pinHash ?? user.passwordHash;
    if (!hash || !verifySecret(hash, dto.secret)) {
      throw new UnauthorizedException('Cédula o PIN incorrectos');
    }

    if (dto.deviceId) {
      await this.prisma.device.upsert({
        where: { deviceId: dto.deviceId },
        create: { deviceId: dto.deviceId, userId: user.id, platform: dto.platform ?? 'unknown', lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit('LOGIN', 'user', user.id, user.id, null);

    return this.issueTokens(user.id, user.cedula, user.role, dto.deviceId, undefined, user.profile);
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException();
    const tokenHash = this.sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Posible reuso de token: revocar toda la familia.
      if (stored) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token inválido o reutilizado');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { profile: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();

    // Rotación: revocar el actual y emitir uno nuevo.
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(user.id, user.cedula, user.role, undefined, stored.id, user.profile);
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    cedula: string,
    role: JwtPayload['role'],
    deviceId?: string,
    replacedBy?: string,
    profile?: { firstName: string; lastName: string } | null,
  ) {
    const payload: JwtPayload = { sub: userId, cedula, role, deviceId };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const ttl = Number(process.env.JWT_REFRESH_TTL ?? 2592000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttl * 1000),
        replacedBy,
      },
    });

    return {
      accessToken,
      refreshToken,
      nonce: randomBytes(16).toString('hex'), // nonce anti-replay para firmar la foto
      user: {
        id: userId,
        cedula,
        role,
        name: profile ? `${profile.firstName} ${profile.lastName}`.trim() : cedula,
      },
    };
  }

  private sha256(s: string) {
    return createHash('sha256').update(s).digest('hex');
  }

  private async audit(action: any, entity: string, entityId: string, actorId: string, meta: any) {
    await this.prisma.auditLog.create({
      data: { action, entity, entityId, actorId, metadata: meta },
    });
  }
}
