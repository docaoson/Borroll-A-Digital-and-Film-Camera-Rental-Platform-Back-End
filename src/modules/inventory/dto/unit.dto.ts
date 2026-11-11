import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { UnitCondition, UnitStatus } from '@prisma/client';

export class ListUnitsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ enum: UnitStatus })
  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;

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

export class ListUnitBlocksQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitId?: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;
}

export class CreateUnitBlockDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn chiếc máy' })
  unitId!: string;

  @ApiProperty({ example: '2026-12-10' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn ngày bắt đầu khóa' })
  startDate!: string;

  @ApiProperty({ example: '2026-12-12' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn ngày kết thúc khóa' })
  endDate!: string;

  @ApiProperty({ example: 'Thay pin, vệ sinh' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do khóa bảo trì' })
  reason!: string;
}

export class CreateUnitDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn mẫu máy' })
  modelId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn chi nhánh' })
  branchId!: string;

  @ApiProperty({ example: 'OXA-0042' })
  @IsString()
  @IsNotEmpty({ message: 'Số serial không được để trống' })
  serialNumber!: string;

  @ApiPropertyOptional({
    enum: UnitCondition,
    default: UnitCondition.EXCELLENT,
  })
  @IsOptional()
  @IsEnum(UnitCondition)
  condition?: UnitCondition = UnitCondition.EXCELLENT;

  @ApiPropertyOptional({ enum: UnitStatus, default: UnitStatus.AVAILABLE })
  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus = UnitStatus.AVAILABLE;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  purchasedAt?: string | null;
}

export class UpdateUnitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Số serial không được để trống' })
  serialNumber?: string;

  @ApiPropertyOptional({ enum: UnitCondition })
  @IsOptional()
  @IsEnum(UnitCondition)
  condition?: UnitCondition;

  @ApiPropertyOptional({ enum: UnitStatus })
  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  purchasedAt?: string | null;
}
