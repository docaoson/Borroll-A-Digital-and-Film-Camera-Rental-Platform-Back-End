import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { writeAuditLog } from '../../../common/utils/audit.util';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../../infra/storage/storage.service';
import {
  CreateFilmProductDto,
  PaginationQueryDto,
  UpdateFilmProductDto,
} from '../dto/catalog.dto';

@Injectable()
export class FilmProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  private getModelImageUrl(path: string): string {
    const bucket = this.configService.get<string>(
      'STORAGE_BUCKET_RENTAL_IMAGES',
      'rental-images',
    );
    return this.storageService.getPublicUrl(bucket, path);
  }

  async getPublicFilmProducts() {
    const items = await this.prisma.filmProduct.findMany({
      where: { isActive: true, inStock: true },
      orderBy: [{ name: 'asc' }],
    });
    return {
      items: items.map((f) => ({
        id: f.id,
        name: f.name,
        iso: f.iso,
        format: f.format,
        price: f.price,
        inStock: f.inStock,
        imageUrl: f.imagePath ? this.getModelImageUrl(f.imagePath) : null,
      })),
    };
  }

  async findFilmProductsByIds(ids: string[]) {
    return this.prisma.filmProduct.findMany({
      where: { id: { in: ids } },
    });
  }

  async listAdminFilmProducts(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [items, total] = await Promise.all([
      this.prisma.filmProduct.findMany({
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.filmProduct.count(),
    ]);

    return { items, page, pageSize, total };
  }

  async createFilmProduct(dto: CreateFilmProductDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const film = await tx.filmProduct.create({
        data: {
          name: dto.name.trim(),
          iso: dto.iso,
          format: dto.format.trim(),
          price: dto.price,
          inStock: dto.inStock ?? true,
          isActive: dto.isActive ?? true,
        },
      });
      await writeAuditLog(tx, {
        actorId,
        action: 'FILM_PRODUCT_CREATED',
        targetType: 'FILM_PRODUCT',
        targetId: film.id,
        metadata: { name: film.name, price: film.price },
      });
      return film;
    });
  }

  async updateFilmProduct(
    id: string,
    dto: UpdateFilmProductDto,
    actorId: string,
  ) {
    const existing = await this.prisma.filmProduct.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy film.',
        details: {},
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.filmProduct.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          iso: dto.iso,
          format: dto.format?.trim(),
          price: dto.price,
          inStock: dto.inStock,
          isActive: dto.isActive,
        },
      });
      await writeAuditLog(tx, {
        actorId,
        action: 'FILM_PRODUCT_UPDATED',
        targetType: 'FILM_PRODUCT',
        targetId: id,
        metadata: { name: updated.name },
      });
      return updated;
    });
  }

  async deleteFilmProduct(id: string, actorId: string) {
    const existing = await this.prisma.filmProduct.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy film.',
        details: {},
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.filmProduct.delete({ where: { id } });
      await writeAuditLog(tx, {
        actorId,
        action: 'FILM_PRODUCT_DELETED',
        targetType: 'FILM_PRODUCT',
        targetId: id,
        metadata: { name: existing.name },
      });
    });
    return { success: true };
  }
}

