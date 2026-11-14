import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const ALLOWED_AVATAR_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

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

  @ApiPropertyOptional({
    example: 512000,
    description: 'Kích thước tệp tin tính bằng byte (tối đa 2MB)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Kích thước tệp tin phải là số nguyên' })
  @Min(1, { message: 'Kích thước tệp tin phải lớn hơn 0' })
  @Max(MAX_AVATAR_UPLOAD_BYTES, {
    message: 'Dung lượng ảnh đại diện tối đa là 2 MB',
  })
  fileSize?: number;
}
