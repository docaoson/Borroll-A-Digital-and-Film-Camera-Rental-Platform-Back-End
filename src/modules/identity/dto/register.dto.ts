import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { sanitizeEmailInput, sanitizePasswordInput } from './login.dto';

export class RegisterDto {
  @ApiProperty({ example: 'Nguyễn Văn A' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFC').trim() : value,
  )
  @IsString({ message: 'Họ tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  fullName!: string;

  @ApiProperty({ example: 'a@example.com' })
  @Transform(({ value }: { value: unknown }) => sanitizeEmailInput(value))
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  @ApiProperty({ example: '0912345678' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').trim() : value,
  )
  @Matches(/^0\d{9}$/, {
    message: 'Số điện thoại không hợp lệ (yêu cầu 10 chữ số bắt đầu bằng 0)',
  })
  phone!: string;

  @ApiProperty({ example: 'matkhau123', minLength: 8 })
  @Transform(({ value }: { value: unknown }) => sanitizePasswordInput(value))
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có tối thiểu 8 ký tự' })
  password!: string;
}
