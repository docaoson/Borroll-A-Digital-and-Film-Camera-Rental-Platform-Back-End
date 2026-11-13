import { Injectable } from '@nestjs/common';
import {
  CreateBranchDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateFilmProductDto,
  CreateModelDto,
  CreateModelImageDto,
  ImagePresignDto,
  ListModelsQueryDto,
  ModelAvailabilityQueryDto,
  PaginationQueryDto,
  ReorderImagesDto,
  UpdateBranchDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateContactSettingsDto,
  UpdateFilmProductDto,
  UpdateModelDto,
  UpdateModelSpecsDto,
} from './dto/catalog.dto';
import {
  BranchService,
  BrandService,
  CategoryService,
  ContactSettingsService,
  FavoriteService,
  FilmProductService,
  ModelService,
  PublicContactSettingsResponse,
} from './services';

export { PublicContactSettingsResponse } from './services/contact-settings.service';

/**
 * CatalogService facade - Điều phối các service chuyên biệt trong module Catalog.
 *
 * Đã được tái cấu trúc thành 7 sub-services:
 * - BranchService: Chi nhánh & điểm nhận trả
 * - CategoryService: Cây danh mục thiết bị
 * - BrandService: Hãng máy ảnh
 * - FilmProductService: Cuộn film bán kèm
 * - ContactSettingsService: Kênh liên hệ đa kênh & bộ nhớ đệm
 * - FavoriteService: Danh sách yêu thích
 * - ModelService: Mẫu máy, ảnh, thông số & tra cứu lịch
 */
@Injectable()
export class CatalogService {
  constructor(
    public readonly branchService: BranchService,
    public readonly categoryService: CategoryService,
    public readonly brandService: BrandService,
    public readonly filmProductService: FilmProductService,
    public readonly contactSettingsService: ContactSettingsService,
    public readonly favoriteService: FavoriteService,
    public readonly modelService: ModelService,
  ) {}

  // 1. Branch
  getPublicBranches() {
    return this.branchService.getPublicBranches();
  }
  findActiveBranchBySlug(slug: string) {
    return this.branchService.findActiveBranchBySlug(slug);
  }
  listAdminBranches(query: PaginationQueryDto) {
    return this.branchService.listAdminBranches(query);
  }
  createBranch(dto: CreateBranchDto, actorId: string) {
    return this.branchService.createBranch(dto, actorId);
  }
  updateBranch(id: string, dto: UpdateBranchDto, actorId: string) {
    return this.branchService.updateBranch(id, dto, actorId);
  }
  deleteBranch(id: string, actorId: string) {
    return this.branchService.deleteBranch(id, actorId);
  }

  // 2. Contact Settings
  getPublicContactSettings(): Promise<PublicContactSettingsResponse> {
    return this.contactSettingsService.getPublicContactSettings();
  }
  updateContactSettings(dto: UpdateContactSettingsDto, actorId: string) {
    return this.contactSettingsService.updateContactSettings(dto, actorId);
  }

  // 3. Category
  getPublicCategories() {
    return this.categoryService.getPublicCategories();
  }
  listAdminCategories(query: PaginationQueryDto) {
    return this.categoryService.listAdminCategories(query);
  }
  createCategory(dto: CreateCategoryDto, actorId: string) {
    return this.categoryService.createCategory(dto, actorId);
  }
  updateCategory(id: string, dto: UpdateCategoryDto, actorId: string) {
    return this.categoryService.updateCategory(id, dto, actorId);
  }
  deleteCategory(id: string, actorId: string) {
    return this.categoryService.deleteCategory(id, actorId);
  }

  // 4. Brand
  getPublicBrands() {
    return this.brandService.getPublicBrands();
  }
  listAdminBrands(query: PaginationQueryDto) {
    return this.brandService.listAdminBrands(query);
  }
  createBrand(dto: CreateBrandDto, actorId: string) {
    return this.brandService.createBrand(dto, actorId);
  }
  updateBrand(id: string, dto: UpdateBrandDto, actorId: string) {
    return this.brandService.updateBrand(id, dto, actorId);
  }
  deleteBrand(id: string, actorId: string) {
    return this.brandService.deleteBrand(id, actorId);
  }

  // 5. Film Product
  getPublicFilmProducts() {
    return this.filmProductService.getPublicFilmProducts();
  }
  findFilmProductsByIds(ids: string[]) {
    return this.filmProductService.findFilmProductsByIds(ids);
  }
  listAdminFilmProducts(query: PaginationQueryDto) {
    return this.filmProductService.listAdminFilmProducts(query);
  }
  createFilmProduct(dto: CreateFilmProductDto, actorId: string) {
    return this.filmProductService.createFilmProduct(dto, actorId);
  }
  updateFilmProduct(id: string, dto: UpdateFilmProductDto, actorId: string) {
    return this.filmProductService.updateFilmProduct(id, dto, actorId);
  }
  deleteFilmProduct(id: string, actorId: string) {
    return this.filmProductService.deleteFilmProduct(id, actorId);
  }

  // 6. Favorite
  addFavorite(userId: string, modelId: string): Promise<void> {
    return this.favoriteService.addFavorite(userId, modelId);
  }
  removeFavorite(userId: string, modelId: string): Promise<void> {
    return this.favoriteService.removeFavorite(userId, modelId);
  }
  listFavorites(userId: string, query: PaginationQueryDto) {
    return this.favoriteService.listFavorites(userId, query);
  }

  // 7. Model
  listPublicModels(query: ListModelsQueryDto, userId?: string) {
    return this.modelService.listPublicModels(query, userId);
  }
  getPublicModelBySlug(slug: string, userId?: string) {
    return this.modelService.getPublicModelBySlug(slug, userId);
  }
  getModelAvailability(modelId: string, query: ModelAvailabilityQueryDto) {
    return this.modelService.getModelAvailability(modelId, query);
  }
  findModelsForBooking(modelIds: string[]) {
    return this.modelService.findModelsForBooking(modelIds);
  }
  listAdminModels(query: PaginationQueryDto) {
    return this.modelService.listAdminModels(query);
  }
  getAdminModel(id: string) {
    return this.modelService.getAdminModel(id);
  }
  createAdminModel(dto: CreateModelDto, actorId: string) {
    return this.modelService.createAdminModel(dto, actorId);
  }
  updateAdminModel(id: string, dto: UpdateModelDto, actorId: string) {
    return this.modelService.updateAdminModel(id, dto, actorId);
  }
  deleteAdminModel(id: string, actorId: string) {
    return this.modelService.deleteAdminModel(id, actorId);
  }
  updateModelSpecs(modelId: string, dto: UpdateModelSpecsDto, actorId: string) {
    return this.modelService.updateModelSpecs(modelId, dto, actorId);
  }
  presignModelImage(modelId: string, dto: ImagePresignDto) {
    return this.modelService.presignModelImage(modelId, dto);
  }
  addModelImage(modelId: string, dto: CreateModelImageDto, actorId: string) {
    return this.modelService.addModelImage(modelId, dto, actorId);
  }
  reorderModelImages(modelId: string, dto: ReorderImagesDto, actorId: string) {
    return this.modelService.reorderModelImages(modelId, dto, actorId);
  }
  deleteModelImage(modelId: string, imageId: string, actorId: string) {
    return this.modelService.deleteModelImage(modelId, imageId, actorId);
  }
}
