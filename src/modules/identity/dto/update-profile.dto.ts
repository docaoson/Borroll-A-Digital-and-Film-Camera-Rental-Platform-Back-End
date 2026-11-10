import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn B' })
  @IsOptional()
  @IsString({ message: 'Họ tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Họ và tên không được để rỗng' })
  fullName?: string;

  @ApiPropertyOptional({ example: '0987654321' })
  @IsOptional()
  @Matches(/^0\d{9}$/, {
    message: 'Số điện thoại không hợp lệ (yêu cầu 10 chữ số bắt đầu bằng 0)',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'avatars/clx123/abc.jpg',
    nullable: true,
    description:
      'Đường dẫn ảnh đại diện nhận từ /me/avatar/presign, hoặc null để xóa ảnh',
  })
  @IsOptional()
  @IsString({ message: 'Đường dẫn ảnh đại diện phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Đường dẫn ảnh đại diện không được để rỗng' })
  avatarPath?: string | null;
}
