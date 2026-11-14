import {
  BadRequestException,
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
import { writeAuditLog } from '../../common/utils/audit.util';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../infra/storage/storage.service';
import {
  AvatarContentType,
  AvatarPresignDto,
  MAX_AVATAR_UPLOAD_BYTES,
} from './dto/avatar-presign.dto';
import {
  LoginDto,
  sanitizeEmailInput,
  sanitizePasswordInput,
} from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  AvatarPresignResponse,
  MeResponse,
} from './entities/user-response.entity';
import {
  generateVietnameseImeCandidates,
  normalizeEmailWithTelex,
} from './utils/telex.util';

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
    const email = String(sanitizeEmailInput(dto.email));
    const normalizedPassword = String(sanitizePasswordInput(dto.password));
    const passwordHash = await argon2.hash(normalizedPassword);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          fullName: dto.fullName.normalize('NFC').trim(),
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
    const familyId = crypto.randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(user.id, roles, user.email),
      this.createRefreshTokenRecord(user.id, familyId, userAgent),
    ]);

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
    const email = normalizeEmailWithTelex(
      String(sanitizeEmailInput(dto.email)),
    );
    const normalizedPassword = String(sanitizePasswordInput(dto.password));
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });

    if (!user) {
      const emailCandidates = generateVietnameseImeCandidates(email)
        .map((c) => c.toLowerCase())
        .filter((c) => c !== email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c));
      if (emailCandidates.length > 0) {
        const candidates = await this.prisma.user.findMany({
          where: { email: { in: emailCandidates } },
          include: { roles: true },
        });
        for (const candidateEmail of emailCandidates) {
          const found = candidates.find((u) => u.email === candidateEmail);
          if (found) {
            user = found;
            break;
          }
        }
      }
    }

    const hashToVerify = user ? user.passwordHash : await this.getDummyHash();
    let isMatch = await argon2.verify(hashToVerify, normalizedPassword);

    if (!isMatch && user) {
      const fallbackCandidates = generateVietnameseImeCandidates(
        dto.password,
      ).filter((candidate) => candidate !== normalizedPassword);

      for (const candidate of fallbackCandidates) {
        if (await argon2.verify(user.passwordHash, candidate)) {
          isMatch = true;
          break;
        }
      }
    }

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
    const familyId = crypto.randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(user.id, roles, user.email),
      this.createRefreshTokenRecord(user.id, familyId, userAgent),
    ]);

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

  async refresh(rawTokenInput?: string | string[], userAgent?: string) {
    const rawTokens = (
      Array.isArray(rawTokenInput)
        ? rawTokenInput
        : rawTokenInput
          ? [rawTokenInput]
          : []
    ).filter((t): t is string => typeof t === 'string' && t.length > 0);

    if (rawTokens.length === 0) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Không tìm thấy refresh token.',
        details: {},
      });
    }

    const tokenHashes = Array.from(
      new Set(rawTokens.map((t) => this.hashToken(t))),
    );
    const matchingRecords = await this.prisma.refreshToken.findMany({
      where: { tokenHash: { in: tokenHashes } },
      orderBy: { createdAt: 'desc' },
    });

    // Ưu tiên token mới nhất chưa bị revoke (tránh trường hợp trình duyệt gửi kèm cookie cũ từ path khác)
    const tokenRecord =
      matchingRecords.find((r) => r.revokedAt === null) ?? matchingRecords[0];

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
    const [newAccessToken, newRefreshToken] = await Promise.all([
      this.generateAccessToken(user.id, roles, user.email),
      this.createRefreshTokenRecord(user.id, tokenRecord.familyId, userAgent),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(rawTokenInput?: string | string[]) {
    const rawTokens = (
      Array.isArray(rawTokenInput)
        ? rawTokenInput
        : rawTokenInput
          ? [rawTokenInput]
          : []
    ).filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (rawTokens.length === 0) return;

    const tokenHashes = Array.from(
      new Set(rawTokens.map((t) => this.hashToken(t))),
    );
    const records = await this.prisma.refreshToken.findMany({
      where: { tokenHash: { in: tokenHashes } },
      select: { familyId: true },
    });
    const familyIds = Array.from(new Set(records.map((r) => r.familyId)));

    await this.prisma.refreshToken.updateMany({
      where: {
        OR: [
          { tokenHash: { in: tokenHashes } },
          ...(familyIds.length > 0 ? [{ familyId: { in: familyIds } }] : []),
        ],
        revokedAt: null,
      },
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
          {
            maxBytes: MAX_AVATAR_UPLOAD_BYTES,
            allowedMimeTypes: Object.keys(CONTENT_TYPE_EXTENSIONS),
          },
        );
        data.avatarPath = dto.avatarPath;
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { roles: true },
    });

    return {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      phone: updated.phone,
      avatarUrl: this.constructAvatarUrl(updated.avatarPath),
      roles: updated.roles.map((r) => r.role),
    };
  }

  async presignAvatar(
    userId: string,
    dto: AvatarPresignDto,
  ): Promise<AvatarPresignResponse> {
    const ext = CONTENT_TYPE_EXTENSIONS[dto.contentType];
    const path = `avatars/${userId}/${crypto.randomUUID()}.${ext}`;
    return this.storageService.createUploadUrl(this.getAvatarsBucket(), path);
  }

  async listUsersForAdmin(params: {
    q?: string;
    role?: Role;
    page?: number;
    pageSize?: number;
  }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where: Prisma.UserWhereInput = {};
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (params.role) {
      where.roles = { some: { role: params.role } };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { roles: true },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        status: u.status,
        roles: u.roles.map((r) => r.role),
        createdAt: u.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async updateUserAccessForAdmin(params: {
    targetUserId: string;
    actorId: string;
    roles?: Role[];
    status?: UserStatus;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.targetUserId },
      include: { roles: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy người dùng.',
        details: {},
      });
    }

    if (
      params.targetUserId === params.actorId &&
      params.roles !== undefined &&
      !params.roles.includes(Role.ADMIN)
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Admin không thể tự gỡ quyền ADMIN của chính mình.',
        details: {
          fields: { roles: 'Không thể tự bỏ quyền ADMIN của chính mình' },
        },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (params.status !== undefined) {
        await tx.user.update({
          where: { id: params.targetUserId },
          data: { status: params.status },
        });
      }

      if (params.roles !== undefined) {
        const uniqueRoles = Array.from(new Set(params.roles));
        await tx.userRole.deleteMany({
          where: { userId: params.targetUserId },
        });
        await tx.userRole.createMany({
          data: uniqueRoles.map((role) => ({
            userId: params.targetUserId,
            role,
          })),
        });
      }

      await writeAuditLog(tx, {
        actorId: params.actorId,
        action: 'USER_ACCESS_UPDATED',
        targetType: 'USER',
        targetId: params.targetUserId,
        metadata: {
          roles: params.roles ?? user.roles.map((r) => r.role),
          status: params.status ?? user.status,
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: params.targetUserId },
        include: { roles: true },
      });
    });

    return {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      phone: updated.phone,
      status: updated.status,
      roles: updated.roles.map((r) => r.role),
      createdAt: updated.createdAt.toISOString(),
    };
  }
}
