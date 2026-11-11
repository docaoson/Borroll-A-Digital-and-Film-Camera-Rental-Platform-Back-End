import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateBranchDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateFilmProductDto,
  CreateModelDto,
  CreateModelImageDto,
  ImagePresignDto,
  PaginationQueryDto,
  ReorderImagesDto,
  UpdateBranchDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateFilmProductDto,
  UpdateModelDto,
  UpdateModelSpecsDto,
} from './dto/catalog.dto';
import { CatalogService } from './catalog.service';

@ApiTags('Admin Catalog')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class CatalogAdminController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('models')
  @ApiOperation({ summary: 'Admin: Danh sách mẫu máy' })
  listModels(@Query() query: PaginationQueryDto) {
    return this.catalogService.listAdminModels(query);
  }

  @Get('models/:id')
  @ApiOperation({ summary: 'Admin: Chi tiết mẫu máy' })
  getModel(@Param('id') id: string) {
    return this.catalogService.getAdminModel(id);
  }

  @Post('models')
  @ApiOperation({ summary: 'Admin: Tạo mẫu máy mới' })
  createModel(
    @Body() dto: CreateModelDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.createAdminModel(dto, actorId);
  }

  @Patch('models/:id')
  @ApiOperation({ summary: 'Admin: Cập nhật mẫu máy' })
  updateModel(
    @Param('id') id: string,
    @Body() dto: UpdateModelDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.updateAdminModel(id, dto, actorId);
  }

  @Delete('models/:id')
  @ApiOperation({ summary: 'Admin: Ẩn hoặc xóa mẫu máy' })
  deleteModel(@Param('id') id: string, @CurrentUser('userId') actorId: string) {
    return this.catalogService.deleteAdminModel(id, actorId);
  }

  @Put('models/:id/specs')
  @ApiOperation({ summary: 'Admin: Cập nhật thông số kỹ thuật mẫu máy' })
  updateSpecs(
    @Param('id') id: string,
    @Body() dto: UpdateModelSpecsDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.updateModelSpecs(id, dto, actorId);
  }

  @Post('models/:id/images/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Xin URL tải ảnh mẫu máy lên Storage' })
  presignImage(@Param('id') id: string, @Body() dto: ImagePresignDto) {
    return this.catalogService.presignModelImage(id, dto);
  }

  @Post('models/:id/images')
  @ApiOperation({ summary: 'Admin: Đăng ký ảnh mẫu máy đã tải lên' })
  addImage(
    @Param('id') id: string,
    @Body() dto: CreateModelImageDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.addModelImage(id, dto, actorId);
  }

  @Patch('models/:id/images/order')
  @ApiOperation({ summary: 'Admin: Sắp xếp thứ tự ảnh mẫu máy' })
  reorderImages(
    @Param('id') id: string,
    @Body() dto: ReorderImagesDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.reorderModelImages(id, dto, actorId);
  }

  @Delete('models/:id/images/:imageId')
  @ApiOperation({ summary: 'Admin: Xóa ảnh mẫu máy' })
  deleteImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.deleteModelImage(id, imageId, actorId);
  }

  @Get('categories')
  listCategories(@Query() query: PaginationQueryDto) {
    return this.catalogService.listAdminCategories(query);
  }

  @Post('categories')
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.createCategory(dto, actorId);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.updateCategory(id, dto, actorId);
  }

  @Delete('categories/:id')
  deleteCategory(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.deleteCategory(id, actorId);
  }

  @Get('brands')
  listBrands(@Query() query: PaginationQueryDto) {
    return this.catalogService.listAdminBrands(query);
  }

  @Post('brands')
  createBrand(
    @Body() dto: CreateBrandDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.createBrand(dto, actorId);
  }

  @Patch('brands/:id')
  updateBrand(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.updateBrand(id, dto, actorId);
  }

  @Delete('brands/:id')
  deleteBrand(@Param('id') id: string, @CurrentUser('userId') actorId: string) {
    return this.catalogService.deleteBrand(id, actorId);
  }

  @Get('branches')
  listBranches(@Query() query: PaginationQueryDto) {
    return this.catalogService.listAdminBranches(query);
  }

  @Post('branches')
  createBranch(
    @Body() dto: CreateBranchDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.createBranch(dto, actorId);
  }

  @Patch('branches/:id')
  updateBranch(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.updateBranch(id, dto, actorId);
  }

  @Delete('branches/:id')
  deleteBranch(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.deleteBranch(id, actorId);
  }

  @Get('film-products')
  listFilmProducts(@Query() query: PaginationQueryDto) {
    return this.catalogService.listAdminFilmProducts(query);
  }

  @Post('film-products')
  createFilmProduct(
    @Body() dto: CreateFilmProductDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.createFilmProduct(dto, actorId);
  }

  @Patch('film-products/:id')
  updateFilmProduct(
    @Param('id') id: string,
    @Body() dto: UpdateFilmProductDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.updateFilmProduct(id, dto, actorId);
  }

  @Delete('film-products/:id')
  deleteFilmProduct(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.catalogService.deleteFilmProduct(id, actorId);
  }
}
