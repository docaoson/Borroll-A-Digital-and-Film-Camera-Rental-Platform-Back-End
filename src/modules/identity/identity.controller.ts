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

  private extractRefreshTokenCookies(req: Request): string[] {
    const tokens: string[] = [];
    const headerCookie = req.headers.cookie;
    if (typeof headerCookie === 'string' && headerCookie.length > 0) {
      for (const pair of headerCookie.split(';')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx <= 0) continue;
        const name = pair.slice(0, eqIdx).trim();
        if (name === 'refreshToken') {
          const val = decodeURIComponent(pair.slice(eqIdx + 1).trim());
          if (val) tokens.push(val);
        }
      }
    }

    const cookies = req.cookies as Record<string, unknown> | undefined;
    const parsedToken = cookies?.refreshToken;
    if (typeof parsedToken === 'string' && parsedToken.length > 0) {
      tokens.push(parsedToken);
    }

    return Array.from(new Set(tokens));
  }

  private setNoCacheHeaders(res: Response) {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  private setRefreshTokenCookie(res: Response, refreshToken: string) {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.setNoCacheHeaders(res);
    // Không set maxAge để biến cookie thành Session Cookie (chuẩn theo phiên làm việc).
    // Khi người dùng đóng/thoát trình duyệt, phiên đăng nhập sẽ tự động kết thúc.
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }

  private clearRefreshTokenCookie(res: Response) {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.setNoCacheHeaders(res);
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
    const previousTokens = this.extractRefreshTokenCookies(req);
    const userAgent = req.headers['user-agent'];
    const result = await this.identityService.register(dto, userAgent);
    if (previousTokens.length > 0) {
      await this.identityService.logout(previousTokens);
    }
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
    const previousTokens = this.extractRefreshTokenCookies(req);
    const userAgent = req.headers['user-agent'];
    const result = await this.identityService.login(dto, userAgent);
    if (previousTokens.length > 0) {
      await this.identityService.logout(previousTokens);
    }
    this.setRefreshTokenCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
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
    const rawTokens = this.extractRefreshTokenCookies(req);
    const userAgent = req.headers['user-agent'];
    const result = await this.identityService.refresh(rawTokens, userAgent);
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
    const rawTokens = this.extractRefreshTokenCookies(req);
    await this.identityService.logout(rawTokens);
    this.clearRefreshTokenCookie(res);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin cá nhân hiện tại' })
  @ApiResponse({ status: 200, type: MeResponse })
  async getMe(
    @CurrentUser('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    this.setNoCacheHeaders(res);
    return this.identityService.getMe(userId);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân' })
  @ApiResponse({ status: 200, type: MeResponse })
  async updateMe(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    this.setNoCacheHeaders(res);
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
