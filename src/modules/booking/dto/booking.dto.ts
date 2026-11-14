import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingStatus } from '@prisma/client';

export class BookingItemInputDto {
  @ApiProperty({ example: 'clx...' })
  @IsString()
  @IsNotEmpty()
  modelId!: string;
}

export class BookingAddonInputDto {
  @ApiProperty({ example: 'f1' })
  @IsString()
  @IsNotEmpty()
  filmProductId!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class QuoteBookingDto {
  @ApiProperty({ example: 'tay-ho' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn chi nhánh' })
  branchSlug!: string;

  @ApiProperty({ example: '2026-12-12' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn ngày nhận máy' })
  startDate!: string;

  @ApiProperty({ example: '2026-12-15' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn ngày trả máy' })
  endDate!: string;

  @ApiProperty({ type: [BookingItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Vui lòng chọn ít nhất một thiết bị' })
  @ValidateNested({ each: true })
  @Type(() => BookingItemInputDto)
  items!: BookingItemInputDto[];

  @ApiPropertyOptional({ type: [BookingAddonInputDto], default: [] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingAddonInputDto)
  addons?: BookingAddonInputDto[] = [];
}

export class CreateBookingDto extends QuoteBookingDto {
  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên người nhận máy' })
  contactName!: string;

  @ApiProperty({ example: '0912345678' })
  @Matches(/^0\d{9}$/, {
    message: 'Số điện thoại không hợp lệ (yêu cầu 10 chữ số bắt đầu bằng 0)',
  })
  contactPhone!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  setupPlanId?: string | null;

  @ApiPropertyOptional({
    description: 'Khóa chống gửi trùng lặp (Idempotency Key)',
    example: 'd9b1c23a-5f4b-4a7c-95b8-d21b76174a6b',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ListMyBookingsQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class CancelBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
