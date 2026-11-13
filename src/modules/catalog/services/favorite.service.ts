import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../../infra/storage/storage.service';
import { PaginationQueryDto } from '../dto/catalog.dto';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class FavoriteService {
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

  private buildBadges(createdAt: Date): string[] {
    return Date.now() - createdAt.getTime() <= FOURTEEN_DAYS_MS ? ['NEW'] : [];
  }

  async addFavorite(userId: string, modelId: string): Promise<void> {
    const model = await this.prisma.rentalModel.findFirst({
      where: { id: modelId, isActive: true },
      select: { id: true },
    });
    if (!model) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy mẫu máy.',
        details: {},
      });
    }

    await this.prisma.favorite.upsert({
      where: { userId_modelId: { userId, modelId } },
      update: {},
      create: { userId, modelId },
    });
  }

  async removeFavorite(userId: string, modelId: string): Promise<void> {
    await this.prisma.favorite.deleteMany({
      where: { userId, modelId },
    });
  }

  async listFavorites(userId: string, query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.FavoriteWhereInput = {
      userId,
      model: { isActive: true },
    };

    const [favs, total] = await Promise.all([
      this.prisma.favorite.findMany({
        where,
        include: {
          model: {
            include: {
              brand: { select: { slug: true, name: true } },
              category: { select: { slug: true, name: true } },
              images: {
                where: { kind: 'PRODUCT' },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.favorite.count({ where }),
    ]);

    return {
      items: favs.map(({ model: m }) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        kind: m.kind,
        cameraType: m.cameraType,
        brand: m.brand,
        category: m.category,
        mount: m.mount,
        pricePerDay: m.pricePerDay,
        pricePerWeek: m.pricePerWeek,
        deposit: m.deposit,
        thumbnailUrl: m.images[0]
          ? this.getModelImageUrl(m.images[0].path)
          : null,
        isFeatured: m.isFeatured,
        badges: this.buildBadges(m.createdAt),
        isFavorite: true,
      })),
      page,
      pageSize,
      total,
    };
  }
}

