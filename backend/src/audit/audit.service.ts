import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Registro de auditoría append-only con hash encadenado: cada entrada incluye
 * el hash de la anterior, de modo que alterar un registro rompe la cadena.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(actorId: string | null, action: any, entity: string, entityId: string | null, oldValue?: any, newValue?: any) {
    const last = await this.prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' } });
    const prevHash = last?.chainHash ?? 'genesis';
    const payload = JSON.stringify({ prevHash, actorId, action, entity, entityId, oldValue, newValue });
    const chainHash = createHash('sha256').update(payload).digest('hex');

    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entity,
        entityId,
        oldValue,
        newValue,
        prevHash,
        chainHash,
      },
    });
  }
}
