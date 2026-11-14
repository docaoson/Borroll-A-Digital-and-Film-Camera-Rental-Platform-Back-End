import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BookingStatus, PaymentMethod, PaymentType } from '@prisma/client';

export class StaffDashboardQueryDto {
  @ApiPropertyOptional({ example: 'tay-ho' })
  @IsOptional()
  @IsString()
  branch?: string;
}

export class StaffBookingsQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ example: '2026-12-12' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

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

export class ReasonBodyDto {
  @ApiProperty({ example: 'Hết máy dự phòng' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do' })
  reason!: string;
}

export const MAX_HANDOVER_PHOTO_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export class HandoverPhotoPresignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp'], {
    message: 'Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP',
  })
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @ApiPropertyOptional({
    example: 1024000,
    description: 'Kích thước tệp tin tính bằng byte (tối đa 8MB)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Kích thước tệp tin phải là số nguyên' })
  @Min(1, { message: 'Kích thước tệp tin phải lớn hơn 0' })
  @Max(MAX_HANDOVER_PHOTO_UPLOAD_BYTES, {
    message: 'Dung lượng ảnh biên bản tối đa là 8 MB',
  })
  fileSize?: number;
}

export class HandoverChecklistItemDto {
  @ApiProperty({ example: 'Thân máy' })
  @IsString()
  @IsNotEmpty()
  item!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  ok!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class PickupPaymentItemDto {
  @ApiProperty({
    enum: [PaymentType.DEPOSIT_RECEIVED, PaymentType.RENTAL_RECEIVED],
  })
  @IsIn([PaymentType.DEPOSIT_RECEIVED, PaymentType.RENTAL_RECEIVED])
  type!: 'DEPOSIT_RECEIVED' | 'RENTAL_RECEIVED';

  @ApiProperty({ example: 3000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class PickupBookingDto {
  @ApiProperty({ type: [HandoverChecklistItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HandoverChecklistItemDto)
  checklist!: HandoverChecklistItemDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  conditionNotes?: string | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần tối thiểu 1 ảnh biên bản giao máy' })
  @IsString({ each: true })
  photoPaths!: string[];

  @ApiProperty({ example: true })
  @IsBoolean()
  idChecked!: boolean;

  @ApiProperty({ type: [PickupPaymentItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickupPaymentItemDto)
  payments!: PickupPaymentItemDto[];
}

export class ReturnBookingDto {
  @ApiProperty({ type: [HandoverChecklistItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HandoverChecklistItemDto)
  checklist!: HandoverChecklistItemDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  conditionNotes?: string | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Cần tối thiểu 1 ảnh biên bản nhận máy' })
  @IsString({ each: true })
  photoPaths!: string[];
}

export class CompleteChargeItemDto {
  @ApiProperty({ enum: [PaymentType.DAMAGE_CHARGE, PaymentType.LATE_FEE] })
  @IsIn([PaymentType.DAMAGE_CHARGE, PaymentType.LATE_FEE])
  type!: 'DAMAGE_CHARGE' | 'LATE_FEE';

  @ApiProperty({ example: 200000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class CompleteBookingDto {
  @ApiPropertyOptional({ type: [CompleteChargeItemDto], default: [] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteChargeItemDto)
  charges?: CompleteChargeItemDto[] = [];

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  refundMethod!: PaymentMethod;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;
}
