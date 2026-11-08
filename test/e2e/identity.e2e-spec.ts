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
import { Role } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Roles } from '../../src/common/decorators/roles.decorator';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { PrismaService } from '../../src/infra/database/prisma.service';

jest.setTimeout(30000);

@Controller('test-role')
class TestRoleController {
  @Roles(Role.HOST)
  @Get('host-only')
  hostOnly() {
    return { ok: true };
  }
}

describe('Identity Module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const testUser1Email = `test+${Date.now()}_1@example.test`;
  const testUser2Email = `test+${Date.now()}_2@example.test`;
  const password = 'Password123!';

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    // Clean up all test users created by this test suite
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test+',
          endsWith: '@example.test',
        },
      },
    });

    await app.close();
  });

  describe('Registration & Duplicate Email', () => {
    it('should register successfully with role RENTER', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Test User One',
          email: testUser1Email,
          phone: '0912345678',
          password,
        })
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user).toMatchObject({
        email: testUser1Email,
        fullName: 'Test User One',
        roles: ['RENTER'],
      });

      // Verify Set-Cookie header contains refreshToken
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('refreshToken=');
    });

    it('should return 409 EMAIL_ALREADY_USED when registering with existing email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Duplicate User',
          email: testUser1Email,
          phone: '0987654321',
          password,
        })
        .expect(409);

      expect(res.body.error).toMatchObject({
        code: 'EMAIL_ALREADY_USED',
      });
    });
  });

  describe('Login & Wrong Password', () => {
    it('should return 401 INVALID_CREDENTIALS when password is incorrect', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password: 'WrongPassword!',
        })
        .expect(401);

      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should return 401 INVALID_CREDENTIALS when email does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.test',
          password,
        })
        .expect(401);

      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should login successfully with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password,
        })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user.email).toBe(testUser1Email);
    });
  });

  describe('Token Expiration & Access Control', () => {
    it('should return 401 TOKEN_EXPIRED when access token is expired', async () => {
      const secret = configService.get<string>('JWT_ACCESS_SECRET');
      const expiredToken = await jwtService.signAsync(
        { sub: 'random-user-id', roles: ['RENTER'] },
        { secret, expiresIn: '-1s' },
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body.error).toMatchObject({
        code: 'TOKEN_EXPIRED',
      });
    });

    it('should return 403 HOST_NOT_ENABLED when RENTER accesses HOST-only endpoint', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password,
        });

      const accessToken = loginRes.body.accessToken;

      const res = await request(app.getHttpServer())
        .get('/api/v1/test-role/host-only')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);

      expect(res.body.error).toMatchObject({
        code: 'HOST_NOT_ENABLED',
      });
    });
  });

  describe('Refresh Token Rotation & Replay Detection', () => {
    it('should rotate refresh token correctly and reject reuse of old token', async () => {
      // 1. Login to obtain initial refreshToken
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password,
        });

      const rawCookie1 = loginRes.headers['set-cookie'][0];
      const cookieVal1 = rawCookie1.split(';')[0]; // "refreshToken=..."

      // 2. Perform refresh
      const refreshRes1 = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieVal1)
        .expect(200);

      expect(refreshRes1.body).toHaveProperty('accessToken');
      const rawCookie2 = refreshRes1.headers['set-cookie'][0];
      const cookieVal2 = rawCookie2.split(';')[0];
      expect(cookieVal2).not.toEqual(cookieVal1);

      // 3. Replay attack: try using the revoked cookieVal1 again
      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieVal1)
        .expect(401);

      expect(replayRes.body.error.code).toBe('UNAUTHENTICATED');

      // 4. Verify that cookieVal2 (part of the same family) is now also revoked!
      const subsequentRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieVal2)
        .expect(401);

      expect(subsequentRes.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('PATCH /me and Profile Isolation', () => {
    it('should register second user and ensure PATCH /me only updates caller profile', async () => {
      // Register user 2
      const reg2 = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Test User Two',
          email: testUser2Email,
          phone: '0988776655',
          password,
        })
        .expect(201);

      const token2 = reg2.body.accessToken;

      // Update user 2
      const patchRes = await request(app.getHttpServer())
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${token2}`)
        .send({
          fullName: 'User Two Updated',
          phone: '0911223344',
        })
        .expect(200);

      expect(patchRes.body).toMatchObject({
        fullName: 'User Two Updated',
        phone: '0911223344',
        email: testUser2Email,
      });

      // Verify User 1 was not modified
      const login1 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testUser1Email,
          password,
        });

      const token1 = login1.body.accessToken;
      const getMe1 = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(getMe1.body.fullName).toBe('Test User One');
    });
  });
});
