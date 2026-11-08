import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: (Role | 'RENTER' | 'HOST' | 'ADMIN')[]) =>
  SetMetadata(ROLES_KEY, roles);

