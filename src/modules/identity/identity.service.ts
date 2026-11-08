import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MeResponse } from './entities/user-response.entity';

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateRandomToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }

  private constructAvatarUrl(avatarPath: string | null): string | null {
    if (!avatarPath) return null;
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const bucket = this.configService.get<string>(
      'STORAGE_BUCKET_AVATARS',
      'avatars',
    );
    return `${supabaseUrl}/storage/v1/object/public/${bucket}/${avatarPath}`;
  }

  private async generateAccessToken(
    userId: string,
    roles: string[],
    email: string,
  ): Promise<string> {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const expiresIn = this.configService.get<string>('JWT_ACCESS_TTL', '15m');
    return this.jwtService.signAsync(
      { sub: userId, roles, email },
      { secret, expiresIn: expiresIn as any },
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
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_USED',
        message: 'Email này đã được sử dụng.',
        details: { fields: { email: 'Email này đã được đăng ký tài khoản' } },
      });
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
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

      return createdUser;
    });

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

    if (!user) {
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

    const isMatch = await argon2.verify(user.passwordHash, dto.password);
    if (!isMatch) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
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

  async refresh(rawToken: string, userAgent?: string) {
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

    // Reuse detection
    if (tokenRecord.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: tokenRecord.familyId },
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

    // Rotate token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

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
      kycStatus: user.kycStatus,
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

    const data: { fullName?: string; phone?: string } = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return this.getMe(userId);
  }

  async becomeHost(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy người dùng.',
        details: {},
      });
    }

    const fields: Record<string, string> = {};
    if (!user.fullName || user.fullName.trim() === '') {
      fields.fullName = 'Cần cập nhật họ và tên trước khi trở thành chủ máy';
    }
    if (!user.phone || user.phone.trim() === '') {
      fields.phone = 'Cần cập nhật số điện thoại trước khi trở thành chủ máy';
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'Vui lòng hoàn thiện họ tên và số điện thoại trước khi trở thành chủ máy.',
        details: { fields },
      });
    }

    const hasHostRole = user.roles.some((r) => r.role === Role.HOST);
    if (!hasHostRole) {
      await this.prisma.userRole.create({
        data: {
          userId,
          role: Role.HOST,
        },
      });
    }

    return this.getMe(userId);
  }
}
