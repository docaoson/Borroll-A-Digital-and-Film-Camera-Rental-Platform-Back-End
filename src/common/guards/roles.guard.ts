import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      (Role | 'RENTER' | 'STAFF' | 'ADMIN')[]
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const userRoles = request.user?.roles ?? [];

    // ADMIN includes STAFF permissions per AGENTS_BACKEND.md §5
    const effectiveRoles = userRoles.includes(Role.ADMIN)
      ? Array.from(new Set([...userRoles, Role.STAFF]))
      : userRoles;

    const hasRole = requiredRoles.some((role) => effectiveRoles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Bạn không có quyền thực hiện hành động này.',
        details: {},
      });
    }

    return true;
  }
}
