import { ApiProperty } from '@nestjs/swagger';

export class AuthUserEntity {
  @ApiProperty({ example: 'clx...' })
  id!: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  fullName!: string;

  @ApiProperty({ example: 'a@example.com' })
  email!: string;

  @ApiProperty({ example: ['RENTER'], type: [String] })
  roles!: string[];
}

export class AuthResponse {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1Ni...' })
  accessToken!: string;

  @ApiProperty({ type: () => AuthUserEntity })
  user!: AuthUserEntity;
}

export class MeResponse {
  @ApiProperty({ example: 'clx...' })
  id!: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  fullName!: string;

  @ApiProperty({ example: 'a@example.com' })
  email!: string;

  @ApiProperty({ example: '0912345678', nullable: true })
  phone!: string | null;

  @ApiProperty({ example: null, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ example: ['RENTER'], type: [String] })
  roles!: string[];
}

export class AvatarPresignResponse {
  @ApiProperty({ example: 'https://...' })
  uploadUrl!: string;

  @ApiProperty({ example: 'avatars/u1/abc.jpg' })
  path!: string;

  @ApiProperty({ example: 'eyJhbGciOi...' })
  token!: string;
}
