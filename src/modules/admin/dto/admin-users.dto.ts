import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Role, UserStatus } from '@prisma/client';

export class ListAdminUsersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: [Role.RENTER, Role.STAFF, Role.ADMIN] })
  @IsOptional()
  @IsIn([Role.RENTER, Role.STAFF, Role.ADMIN])
  role?: Role;

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

export class UpdateAdminUserDto {
  @ApiPropertyOptional({
    enum: [Role.RENTER, Role.STAFF, Role.ADMIN],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn([Role.RENTER, Role.STAFF, Role.ADMIN], { each: true })
  roles?: Role[];

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
