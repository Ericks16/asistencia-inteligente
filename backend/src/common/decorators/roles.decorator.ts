import { SetMetadata } from '@nestjs/common';
import { Role } from '../types/domain.types';

export const ROLES_KEY = 'roles';
/** Requiere al menos uno de los roles indicados. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
