import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string; // userId
  cedula: string;
  role: Role;
  deviceId?: string;
}
