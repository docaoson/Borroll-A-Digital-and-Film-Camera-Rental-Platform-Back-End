import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../infra/storage/storage.service';
import { AvatarContentType, AvatarPresignDto } from './dto/avatar-presign.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  AvatarPresignResponse,
  MeResponse,
} from './entities/user-response.entity';

const CONTENT_TYPE_EXTENSIONS: Record<AvatarContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class IdentityService implements OnModuleInit {
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await argon2.hash(
      'borroll-dummy-constant-timing-protection',
    );
  }

  private async getDummyHash(): Promise<string> {
    if (!this.dummyPasswordHash) {
      this.dummyPasswordHash = await argon2.hash(
        'borroll-dummy-constant-timing-protection',
      );
    }
    return this.dummyPasswordHash;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateRandomToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }

  private getAvatarsBucket(): string {
    return this.configService.get<string>('STORAGE_BUCKET_AVATARS', 'avatars');
  }

  private constructAvatarUrl(avatarPath: string | null): string | null {
    if (!avatarPath) return null;
    return this.storageService.getPublicUrl(
      this.getAvatarsBucket(),
      avatarPath,
    );
  }

  private async generateAccessToken(
    userId: string,
    roles: string[],
    email: string,
  ): Promise<string> {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const expiresIn = this.configService.get<string>(
      'JWT_ACCESS_TTL',
      '15m',
    ) as JwtSignOptions['expiresIn'];
    return this.jwtService.signAsync(
      { sub: userId, roles, email },
      { secret, expiresIn },
    );
  }

  private async createRefreshTokenRecord(
    userId: string,
    familyId: string,
    userAgent?: string,
  ): Promise<string> {
    const rawToken = this.generateRandomToken();
    const tokenHash = this.hashToken(rawToken);
    const ttlDays = this.configService.get<number>('REFRESH_TTL_DAYS', 30);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId,
        expiresAt,
        userAgent,
      },
    });

    return rawToken;
  }

  async register(dto: RegisterDto, userAgent?: string) {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(dto.password);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          fullName: dto.fullName.trim(),
          email,
          phone: dto.phone.trim(),
          passwordHash,
          status: UserStatus.ACTIVE,
          roles: {
            create: {
              role: Role.RENTER,
            },
          },
        },
        include: {
          roles: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_USED',
          message: 'Email này đã được sử dụng.',
          details: { fields: { email: 'Email này đã được đăng ký tài khoản' } },
        });
      }
      throw error;
    }

    const roles = user.roles.map((r) => r.role);
    const accessToken = await this.generateAccessToken(
      user.id,
      roles,
      user.email,
    );
    const familyId = crypto.randomUUID();
    const refreshToken = await this.createRefreshTokenRecord(
      user.id,
      familyId,
      userAgent,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roles,
      },
    };
  }

  async login(dto: LoginDto, userAgent?: string) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });

    const hashToVerify = user ? user.passwordHash : await this.getDummyHash();
    const isMatch = await argon2.verify(hashToVerify, dto.password);

    if (!user || !isMatch) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
        details: {},
      });
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Tài khoản của bạn đã bị tạm khóa.',
        details: {},
      });
    }

    const roles = user.roles.map((r) => r.role);
    const accessToken = await this.generateAccessToken(
      user.id,
      roles,
      user.email,
    );
    const familyId = crypto.randomUUID();
    const refreshToken = await this.createRefreshTokenRecord(
      user.id,
      familyId,
      userAgent,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roles,
      },
    };
  }

  async refresh(rawToken?: string, userAgent?: string) {
    if (!rawToken) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Không tìm thấy refresh token.',
        details: {},
      });
    }

    const tokenHash = this.hashToken(rawToken);
    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Refresh token không hợp lệ.',
        details: {},
      });
    }

    // Reuse detection: if already revoked, revoke entire token family
    if (tokenRecord.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: tokenRecord.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Phát hiện hành vi bất thường. Vui lòng đăng nhập lại.',
        details: {},
      });
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Refresh token đã hết hạn.',
        details: {},
      });
    }

    // Atomic token rotation to handle concurrent refresh requests safely
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: tokenRecord.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (rotated.count === 0) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Refresh token đã được sử dụng.',
        details: {},
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: tokenRecord.userId },
      include: { roles: true },
    });

    if (!user || user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Người dùng không khả dụng.',
        details: {},
      });
    }

    const roles = user.roles.map((r) => r.role);
    const newAccessToken = await this.generateAccessToken(
      user.id,
      roles,
      user.email,
    );
    const newRefreshToken = await this.createRefreshTokenRecord(
      user.id,
      tokenRecord.familyId,
      userAgent,
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(rawToken?: string) {
    if (!rawToken) return;
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy thông tin người dùng.',
        details: {},
      });
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatarUrl: this.constructAvatarUrl(user.avatarPath),
      roles: user.roles.map((r) => r.role),
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy người dùng.',
        details: {},
      });
    }

    const data: {
      fullName?: string;
      phone?: string;
      avatarPath?: string | null;
    } = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();

    if (dto.avatarPath !== undefined) {
      const bucket = this.getAvatarsBucket();
      if (dto.avatarPath === null) {
        if (user.avatarPath) {
          await this.storageService.remove(bucket, user.avatarPath);
        }
        data.avatarPath = null;
      } else {
        await this.storageService.assertOwnedFile(
          bucket,
          dto.avatarPath,
          `avatars/${userId}/`,
        );
        data.avatarPath = dto.avatarPath;
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return this.getMe(userId);
  }

  async presignAvatar(
    userId: string,
    dto: AvatarPresignDto,
  ): Promise<AvatarPresignResponse> {
    const ext = CONTENT_TYPE_EXTENSIONS[dto.contentType];
    const path = `avatars/${userId}/${crypto.randomUUID()}.${ext}`;
    return this.storageService.createUploadUrl(this.getAvatarsBucket(), path);
  }
}
