import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { CameraType, ImageKind, ModelKind } from '@prisma/client';

export class ListModelsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Comma-separated category slugs' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Comma-separated brand slugs' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ enum: ModelKind })
  @IsOptional()
  @IsEnum(ModelKind)
  kind?: ModelKind;

  @ApiPropertyOptional({ enum: CameraType })
  @IsOptional()
  @IsEnum(CameraType)
  cameraType?: CameraType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mount?: string;

  @ApiPropertyOptional({ description: 'Giá thuê tối thiểu (VNĐ), tối đa 100.000.000' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000, { message: 'Giá lọc tối thiểu không được vượt quá 100.000.000₫' })
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Giá thuê tối đa (VNĐ), tối đa 100.000.000' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000, { message: 'Giá lọc tối đa không được vượt quá 100.000.000₫' })
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({ example: '2026-12-10' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-12' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['true', 'false'])
  featured?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excludeId?: string;

  @ApiPropertyOptional({
    enum: ['default', 'price_asc', 'price_desc', 'newest'],
  })
  @IsOptional()
  @IsIn(['default', 'price_asc', 'price_desc', 'newest'])
  sort?: 'default' | 'price_asc' | 'price_desc' | 'newest' = 'default';

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

export class ModelAvailabilityQueryDto {
  @ApiProperty({ example: 'tay-ho' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn chi nhánh' })
  branch!: string;

  @ApiProperty({ example: '2026-12' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng chọn tháng (YYYY-MM)' })
  month!: string;
}

export class PaginationQueryDto {
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

export class InspectionNoteItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty()
  @IsBoolean()
  ok!: boolean;
}

export class CreateModelDto {
  @ApiProperty({ enum: ModelKind })
  @IsEnum(ModelKind)
  kind!: ModelKind;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  brandId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({ enum: CameraType, nullable: true })
  @IsOptional()
  @IsEnum(CameraType)
  cameraType?: CameraType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  mount?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  filmFormat?: string | null;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerDay!: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerWeek?: number | null;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deposit!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean = false;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  lastInspectedAt?: string | null;

  @ApiPropertyOptional({ type: [InspectionNoteItemDto], nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionNoteItemDto)
  inspectionNotes?: InspectionNoteItemDto[] | null;
}

export class UpdateModelDto {
  @ApiPropertyOptional({ enum: ModelKind })
  @IsOptional()
  @IsEnum(ModelKind)
  kind?: ModelKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ enum: CameraType, nullable: true })
  @IsOptional()
  @IsEnum(CameraType)
  cameraType?: CameraType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  mount?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  filmFormat?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerDay?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pricePerWeek?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deposit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  lastInspectedAt?: string | null;

  @ApiPropertyOptional({ type: [InspectionNoteItemDto], nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionNoteItemDto)
  inspectionNotes?: InspectionNoteItemDto[] | null;
}

export class UpdateModelSpecsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  exposure?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  controls?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  power?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  quirks?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  beginnerNotes?: unknown[];
}

export class ImagePresignDto {
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp'], {
    message: 'Chỉ hỗ trợ ảnh định dạng JPG, PNG hoặc WebP',
  })
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';
}

export class CreateModelImageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  path!: string;

  @ApiPropertyOptional({ enum: ImageKind, default: ImageKind.PRODUCT })
  @IsOptional()
  @IsEnum(ImageKind)
  kind?: ImageKind = ImageKind.PRODUCT;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  caption?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  sampleLens?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number = 0;
}

export class ReorderImagesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  imageIds!: string[];
}

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number = 0;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBrandDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateBrandDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBranchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  openHours!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  mapUrl?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateBranchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  openHours?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  mapUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateFilmProductDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  iso!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  format!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  inStock?: boolean = true;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateFilmProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  iso?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  format?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateContactSettingsDto {
  @ApiPropertyOptional({ nullable: true, example: '1234567890123456789' })
  @IsOptional()
  @IsString()
  zaloOaId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  zalo_oa_id?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '0912345678' })
  @IsOptional()
  @IsString()
  zaloPhone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  zalo_phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'borroll.camera' })
  @IsOptional()
  @IsString()
  messengerPage?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  messenger_page?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'borroll.camera' })
  @IsOptional()
  @IsString()
  instagramHandle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  instagram_handle?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '0912345678' })
  @IsOptional()
  @IsString()
  hotline?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Xin chào! BORROLL có thể hỗ trợ gì cho bạn?',
  })
  @IsOptional()
  @IsString()
  welcomeMessage?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  welcome_message?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isChatEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_chat_enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  chatEnabled?: boolean;
}
