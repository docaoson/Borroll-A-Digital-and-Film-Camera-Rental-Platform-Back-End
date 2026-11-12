import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import {
  ListModelsQueryDto,
  ModelAvailabilityQueryDto,
  PaginationQueryDto,
} from './dto/catalog.dto';
import { CatalogService } from './catalog.service';

@ApiTags('Catalog & Favorites')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get('branches')
  @ApiOperation({ summary: 'Danh sách chi nhánh đang hoạt động' })
  getBranches() {
    return this.catalogService.getPublicBranches();
  }

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Cây danh mục thiết bị' })
  getCategories() {
    return this.catalogService.getPublicCategories();
  }

  @Public()
  @Get('brands')
  @ApiOperation({ summary: 'Danh sách thương hiệu' })
  getBrands() {
    return this.catalogService.getPublicBrands();
  }

  @Public()
  @Get('film-products')
  @ApiOperation({ summary: 'Danh sách film bán kèm' })
  getFilmProducts() {
    return this.catalogService.getPublicFilmProducts();
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('models')
  @ApiOperation({ summary: 'Tìm kiếm và lọc mẫu máy cho thuê' })
  listModels(
    @Query() query: ListModelsQueryDto,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.catalogService.listPublicModels(query, userId);
  }

  @Public()
  @Get('models/:id/availability')
  @ApiOperation({ summary: 'Lịch ngày hết máy theo tháng và chi nhánh' })
  getModelAvailability(
    @Param('id') id: string,
    @Query() query: ModelAvailabilityQueryDto,
  ) {
    return this.catalogService.getModelAvailability(id, query);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('models/:slug')
  @ApiOperation({ summary: 'Chi tiết mẫu máy theo slug' })
  getModelBySlug(
    @Param('slug') slug: string,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.catalogService.getPublicModelBySlug(slug, userId);
  }

  @ApiBearerAuth()
  @Get('favorites')
  @ApiOperation({ summary: 'Danh sách mẫu máy yêu thích' })
  listFavorites(
    @CurrentUser('userId') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.catalogService.listFavorites(userId, query);
  }

  @ApiBearerAuth()
  @Post('favorites/:modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Thêm mẫu máy vào yêu thích' })
  addFavorite(
    @CurrentUser('userId') userId: string,
    @Param('modelId') modelId: string,
  ) {
    return this.catalogService.addFavorite(userId, modelId);
  }

  @ApiBearerAuth()
  @Delete('favorites/:modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa mẫu máy khỏi yêu thích' })
  removeFavorite(
    @CurrentUser('userId') userId: string,
    @Param('modelId') modelId: string,
  ) {
    return this.catalogService.removeFavorite(userId, modelId);
  }
}
