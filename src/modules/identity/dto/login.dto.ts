import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizeEmailWithTelex } from '../utils/telex.util';

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF\u2060]/g;

export function sanitizeEmailInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return normalizeEmailWithTelex(value);
}

export function sanitizePasswordInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.normalize('NFC').replace(ZERO_WIDTH_REGEX, '');
}

export class LoginDto {
  @ApiProperty({ example: 'a@example.com' })
  @Transform(({ value }: { value: unknown }) => sanitizeEmailInput(value))
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  @ApiProperty({ example: 'matkhau123' })
  @Transform(({ value }: { value: unknown }) => sanitizePasswordInput(value))
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password!: string;
}
