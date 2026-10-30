import { Role } from '../types/domain.types';

export interface JwtPayload {
  sub: string; // userId
  cedula: string;
  role: Role;
  deviceId?: string;
}
