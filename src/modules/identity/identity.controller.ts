import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AvatarPresignDto } from './dto/avatar-presign.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  AuthResponse,
  AvatarPresignResponse,
  MeResponse,
} from './entities/user-response.entity';
import { IdentityService } from './identity.service';

@ApiTags('Auth & Identity')
@Controller()
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly configService: ConfigService,
  ) {}

  private extractRefreshTokenCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const rawToken = cookies?.refreshToken;
    return typeof rawToken === 'string' ? rawToken : undefined;
  }

  private setRefreshTokenCookie(res: Response, refreshToken: string) {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshTokenCookie(res: Response) {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('auth/register')
  @ApiOperation({ summary: 'Đăng ký tài khoản người dùng' })
  @ApiResponse({ status: 201, type: AuthResponse })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const userAgent = req.headers['user-agent'];
    const result = await this.identityService.register(dto, userAgent);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập tài khoản' })
  @ApiResponse({ status: 200, type: AuthResponse })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const userAgent = req.headers['user-agent'];
    const result = await this.identityService.login(dto, userAgent);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Làm mới Access Token qua cookie Refresh Token' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: { accessToken: { type: 'string' } },
    },
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const rawToken = this.extractRefreshTokenCookie(req);
    const userAgent = req.headers['user-agent'];
    const result = await this.identityService.refresh(rawToken, userAgent);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
    };
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đăng xuất tài khoản' })
  @ApiResponse({ status: 204 })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawToken = this.extractRefreshTokenCookie(req);
    await this.identityService.logout(rawToken);
    this.clearRefreshTokenCookie(res);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin cá nhân hiện tại' })
  @ApiResponse({ status: 200, type: MeResponse })
  async getMe(@CurrentUser('userId') userId: string): Promise<MeResponse> {
    return this.identityService.getMe(userId);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân' })
  @ApiResponse({ status: 200, type: MeResponse })
  async updateMe(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeResponse> {
    return this.identityService.updateMe(userId, dto);
  }

  @ApiBearerAuth()
  @Post('me/avatar/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xin URL tải ảnh đại diện lên Storage' })
  @ApiResponse({ status: 200, type: AvatarPresignResponse })
  async presignAvatar(
    @CurrentUser('userId') userId: string,
    @Body() dto: AvatarPresignDto,
  ): Promise<AvatarPresignResponse> {
    return this.identityService.presignAvatar(userId, dto);
  }
}
