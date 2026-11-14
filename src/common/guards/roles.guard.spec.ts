import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard admin-only access', () => {
  const makeContext = (roles: Role[]) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    }) as any;

  it('does not grant admin routes to legacy staff accounts', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]),
    } as any;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(makeContext([Role.STAFF]))).toThrow(
      ForbiddenException,
    );
  });

  it('allows admins on admin routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]),
    } as any;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(makeContext([Role.ADMIN]))).toBe(true);
  });
});
