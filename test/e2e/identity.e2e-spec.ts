import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Roles } from '../../src/common/decorators/roles.decorator';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import {
  assertSafeE2eDatabase,
  cleanupE2eData,
} from '../../src/common/utils/e2e-cleanup.util';
import { PrismaService } from '../../src/infra/database/prisma.service';
import {
  generateVietnameseImeCandidates,
  normalizeEmailWithTelex,
} from '../../src/modules/identity/utils/telex.util';

jest.setTimeout(30000);

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

interface AuthBody {
  accessToken: string;
  user: {
    id: string;
    fullName: string;
    email: string;
    roles: string[];
  };
}

interface MeBody {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  roles: string[];
}

@Controller('test-role')
class TestRoleController {
  @Roles(Role.STAFF)
  @Get('staff-only')
  staffOnly() {
    return { ok: true };
  }

  @Roles(Role.ADMIN)
  @Get('admin-only')
  adminOnly() {
    return { ok: true };
  }
}

describe('Identity Module (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const ts = Date.now();
  const prefix = `e2e_identity_${ts}`;
  const testUser1Email = `${prefix}_1@example.test`;
  const testUser2Email = `${prefix}_2@example.test`;
  const testSuspendedEmail = `${prefix}_suspended@example.test`;
  const password = 'Password123!';

  const extractSetCookies = (res: request.Response): string[] => {
    const raw = res.headers['set-cookie'];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') return [raw];
    return [];
  };

  beforeAll(async () => {
    assertSafeE2eDatabase();
    jest.setTimeout(30000);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestRoleController],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors: ValidationError[]) => {
          const fields: Record<string, string> = {};
          const extractErrors = (errs: ValidationError[]) => {
            for (const err of errs) {
              if (err.constraints) {
                fields[err.property] = Object.values(err.constraints)[0];
              }
              if (err.children && err.children.length > 0) {
                extractErrors(err.children);
              }
            }
          };
          extractErrors(errors);
          return new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Dữ liệu gửi lên không hợp lệ.',
            details: { fields },
          });
        },
      }),
    );

    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await cleanupE2eData(prisma, { prefix });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('Registration & Duplicate Email', () => {
    it('should register successfully with role RENTER and httpOnly refresh cookie', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/register')
        .send({
          fullName: `${prefix} Test User One`,
          email: testUser1Email,
          phone: '0912345678',
          password,
        })
        .expect(201);

      const body = res.body as AuthBody;
      expect(body).toHaveProperty('accessToken');
      expect(body.user).toMatchObject({
        email: testUser1Email,
        fullName: `${prefix} Test User One`,
        roles: ['RENTER'],
      });

      const cookies = extractSetCookies(res);
      expect(cookies.length).toBeGreaterThan(0);
      expect(cookies[0]).toContain('refreshToken=');
      expect(cookies[0]).toContain('HttpOnly');
      expect(cookies[0]).toContain('Path=/api/v1/auth');
      expect(cookies[0]).toContain('SameSite=Lax');
    });

    it('should return 409 EMAIL_ALREADY_USED when registering with existing email', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/register')
        .send({
          fullName: `${prefix} Duplicate User`,
          email: testUser1Email,
          phone: '0987654321',
          password,
        })
        .expect(409);

      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('EMAIL_ALREADY_USED');
    });
  });

  describe('Login, Wrong Password & Suspended Account', () => {
    it('should return 401 INVALID_CREDENTIALS when password is incorrect', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password: 'WrongPassword!',
        })
        .expect(401);

      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 INVALID_CREDENTIALS when email does not exist', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.test',
          password,
        })
        .expect(401);

      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should check suspension only after password matches', async () => {
      await request(httpServer)
        .post('/api/v1/auth/register')
        .send({
          fullName: `${prefix} Suspended User`,
          email: testSuspendedEmail,
          phone: '0911112222',
          password,
        })
        .expect(201);

      await prisma.user.update({
        where: { email: testSuspendedEmail },
        data: { status: UserStatus.SUSPENDED },
      });

      // Wrong password on suspended account -> 401 INVALID_CREDENTIALS
      const wrongPassRes = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: testSuspendedEmail,
          password: 'WrongPassword!',
        })
        .expect(401);
      expect((wrongPassRes.body as ErrorBody).error.code).toBe(
        'INVALID_CREDENTIALS',
      );

      // Correct password on suspended account -> 403 ACCOUNT_SUSPENDED
      const rightPassRes = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: testSuspendedEmail,
          password,
        })
        .expect(403);
      expect((rightPassRes.body as ErrorBody).error.code).toBe(
        'ACCOUNT_SUSPENDED',
      );
    });

    it('should login successfully with valid credentials and normalize invisible/trailing/Vietnamese-IME input characters', async () => {
      const res = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: ` \u200B${testUser1Email.toUpperCase()}\uFEFF `,
          password: '\u200BPăsỏd123! ',
        })
        .expect(200);

      const body = res.body as AuthBody;
      expect(body).toHaveProperty('accessToken');
      expect(body.user.email).toBe(testUser1Email);

      // Verify Vietnamese IME (Telex / Windows IME) mangled variants for Password123! and admin@borroll.vn
      for (const telexPassword of [
        'Păsỏd123!',
        'Păsởd123!',
        'Pasưởd123!',
        'Pasưỏd123!',
        'Pasởd123!',
        'Pasword123!',
      ]) {
        expect(generateVietnameseImeCandidates(telexPassword)).toContain(
          password,
        );
      }
      for (const telexEmail of [
        'admin@boroll.vn',
        'admin@bởroll.vn',
        'admin@bỏroll.vn',
      ]) {
        expect(normalizeEmailWithTelex(telexEmail)).toBe('admin@borroll.vn');
      }
    });
  });

  describe('Token Expiration & Store RBAC (RENTER, STAFF, ADMIN)', () => {
    it('should return 401 TOKEN_EXPIRED when access token is expired', async () => {
      const secret = configService.get<string>('JWT_ACCESS_SECRET');
      const expiredToken = await jwtService.signAsync(
        { sub: 'random-user-id', roles: ['RENTER'], email: 'a@example.test' },
        { secret, expiresIn: '-1s' },
      );

      const res = await request(httpServer)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('should enforce STAFF and ADMIN role rules properly', async () => {
      const secret = configService.get<string>('JWT_ACCESS_SECRET');

      const renterToken = await jwtService.signAsync(
        { sub: 'u-renter', roles: [Role.RENTER], email: 'r@example.test' },
        { secret, expiresIn: '5m' },
      );
      const staffToken = await jwtService.signAsync(
        { sub: 'u-staff', roles: [Role.STAFF], email: 's@example.test' },
        { secret, expiresIn: '5m' },
      );
      const adminToken = await jwtService.signAsync(
        { sub: 'u-admin', roles: [Role.ADMIN], email: 'a@example.test' },
        { secret, expiresIn: '5m' },
      );

      // RENTER cannot access STAFF endpoint -> 403 FORBIDDEN
      const renterRes = await request(httpServer)
        .get('/api/v1/test-role/staff-only')
        .set('Authorization', `Bearer ${renterToken}`)
        .expect(403);
      expect((renterRes.body as ErrorBody).error.code).toBe('FORBIDDEN');

      // STAFF can access STAFF endpoint -> 200
      await request(httpServer)
        .get('/api/v1/test-role/staff-only')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      // ADMIN includes STAFF permission -> 200 on STAFF endpoint
      await request(httpServer)
        .get('/api/v1/test-role/staff-only')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // STAFF cannot access ADMIN-only endpoint -> 403 FORBIDDEN
      const staffAdminRes = await request(httpServer)
        .get('/api/v1/test-role/admin-only')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
      expect((staffAdminRes.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });
  });

  describe('Refresh Token Rotation, Replay Detection & Concurrency', () => {
    it('should rotate refresh token and revoke entire family on reuse', async () => {
      const loginRes = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password,
        })
        .expect(200);

      const cookies1 = extractSetCookies(loginRes);
      const cookieVal1 = cookies1[0].split(';')[0];

      const refreshRes1 = await request(httpServer)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieVal1)
        .expect(200);

      expect(refreshRes1.body as { accessToken: string }).toHaveProperty(
        'accessToken',
      );
      const cookies2 = extractSetCookies(refreshRes1);
      const cookieVal2 = cookies2[0].split(';')[0];
      expect(cookieVal2).not.toEqual(cookieVal1);

      // Replay attack using revoked cookieVal1
      const replayRes = await request(httpServer)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieVal1)
        .expect(401);
      expect((replayRes.body as ErrorBody).error.code).toBe('UNAUTHENTICATED');

      // Verify newest token cookieVal2 in the same family is also revoked
      const subsequentRes = await request(httpServer)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieVal2)
        .expect(401);
      expect((subsequentRes.body as ErrorBody).error.code).toBe(
        'UNAUTHENTICATED',
      );
    });

    it('should allow only one of two concurrent refresh requests with the same token', async () => {
      const loginRes = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password,
        })
        .expect(200);

      const cookieVal = extractSetCookies(loginRes)[0].split(';')[0];

      const [resA, resB] = await Promise.all([
        request(httpServer)
          .post('/api/v1/auth/refresh')
          .set('Cookie', cookieVal),
        request(httpServer)
          .post('/api/v1/auth/refresh')
          .set('Cookie', cookieVal),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
    });
  });

  describe('GET /me, PATCH /me & Profile Isolation', () => {
    it('should return profile without kycStatus and isolate PATCH /me updates', async () => {
      const reg2 = await request(httpServer)
        .post('/api/v1/auth/register')
        .send({
          fullName: `${prefix} Test User Two`,
          email: testUser2Email,
          phone: '0988776655',
          password,
        })
        .expect(201);

      const token2 = (reg2.body as AuthBody).accessToken;

      const patchRes = await request(httpServer)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          fullName: `${prefix} User Two Updated`,
          phone: '0911223344',
        })
        .expect(200);

      const me2 = patchRes.body as MeBody & Record<string, unknown>;
      expect(me2).toMatchObject({
        fullName: `${prefix} User Two Updated`,
        phone: '0911223344',
        email: testUser2Email,
      });
      expect(me2.kycStatus).toBeUndefined();

      // Foreign avatarPath should be rejected with 400 VALIDATION_ERROR
      const badAvatarRes = await request(httpServer)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          avatarPath: 'avatars/someone-else/avatar.jpg',
        })
        .expect(400);
      expect((badAvatarRes.body as ErrorBody).error.code).toBe(
        'VALIDATION_ERROR',
      );

      const user2Cookie = extractSetCookies(reg2)[0].split(';')[0];

      // Verify User 1 was not modified and logging in as User 1 revokes User 2's cookie on same browser
      const login1 = await request(httpServer)
        .post('/api/v1/auth/login')
        .set('Cookie', user2Cookie)
        .send({
          email: testUser1Email,
          password,
        })
        .expect(200);

      const user1Cookie = extractSetCookies(login1)[0].split(';')[0];

      // Even if a browser sends both a stale cookie (User 2) and the new cookie (User 1), refresh resolves to User 1
      const refreshAfterSwitch = await request(httpServer)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${user2Cookie}; ${user1Cookie}`)
        .expect(200);

      const refreshedToken1 = (
        refreshAfterSwitch.body as { accessToken: string }
      ).accessToken;
      const getMe1 = await request(httpServer)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${refreshedToken1}`)
        .expect(200);

      expect((getMe1.body as MeBody).fullName).toBe(`${prefix} Test User One`);
      expect((getMe1.body as MeBody).email).toBe(testUser1Email);
    });
  });
});
