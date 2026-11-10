import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

const ALLOWED_AVATAR_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AvatarContentType = (typeof ALLOWED_AVATAR_CONTENT_TYPES)[number];

export class AvatarPresignDto {
  @ApiProperty({
    example: 'image/jpeg',
    enum: ALLOWED_AVATAR_CONTENT_TYPES,
  })
  @IsString({ message: 'Định dạng ảnh phải là chuỗi ký tự' })
  @IsIn(ALLOWED_AVATAR_CONTENT_TYPES, {
    message: 'Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP',
  })
  contentType!: AvatarContentType;
}
