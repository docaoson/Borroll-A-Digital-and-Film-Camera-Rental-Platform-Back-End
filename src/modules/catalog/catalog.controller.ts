import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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
  @Header(
    'Cache-Control',
    'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
  )
  @ApiOperation({ summary: 'Danh sách chi nhánh đang hoạt động' })
  getBranches() {
    return this.catalogService.getPublicBranches();
  }

  @Public()
  @Get('contact-settings')
  @Header(
    'Cache-Control',
    'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
  )
  @ApiOperation({ summary: 'Cấu hình liên hệ công khai & danh sách chi nhánh' })
  getContactSettings() {
    return this.catalogService.getPublicContactSettings();
  }

  @Public()
  @Get('payment-settings')
  @Header('Cache-Control', 'no-store, max-age=0')
  @ApiOperation({ summary: 'Cấu hình chuyển khoản công khai, không lưu cache' })
  getPaymentSettings() {
    return this.catalogService.getPublicPaymentSettings();
  }

  @Public()
  @Get('categories')
  @Header(
    'Cache-Control',
    'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
  )
  @ApiOperation({ summary: 'Cây danh mục thiết bị' })
  getCategories() {
    return this.catalogService.getPublicCategories();
  }

  @Public()
  @Get('brands')
  @Header(
    'Cache-Control',
    'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
  )
  @ApiOperation({ summary: 'Danh sách thương hiệu' })
  getBrands() {
    return this.catalogService.getPublicBrands();
  }

  @Public()
  @Get('film-products')
  @Header(
    'Cache-Control',
    'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
  )
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
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (res) {
      res.setHeader('Vary', 'Authorization');
      if (userId) {
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      } else {
        res.setHeader(
          'Cache-Control',
          'public, max-age=0, s-maxage=0, must-revalidate',
        );
      }
    }
    return this.catalogService.listPublicModels(query, userId);
  }

  @Public()
  @Get('models/:id/availability')
  @Header(
    'Cache-Control',
    'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
  )
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
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (res) {
      res.setHeader('Vary', 'Authorization');
      if (userId) {
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      } else {
        res.setHeader(
          'Cache-Control',
          'public, max-age=0, s-maxage=0, must-revalidate',
        );
      }
    }
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
