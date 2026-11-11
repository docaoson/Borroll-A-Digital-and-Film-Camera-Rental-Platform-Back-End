import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ModelKind } from '@prisma/client';
import {
  diffDaysIso,
  getTodayVietnamIso,
  parseIsoDateToUtc,
} from '../../common/utils/date.util';
import { CatalogService } from '../catalog';
import { QuoteBookingDto } from './dto/booking.dto';

export interface PricedLine {
  modelId: string;
  name: string;
  kind: ModelKind;
  thumbnailUrl: string | null;
  pricePerDay: number;
  rentalAmount: number;
  depositAmount: number;
}

export interface PricedAddon {
  filmProductId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface CalculatedQuote {
  branch: {
    id: string;
    slug: string;
    name: string;
    address: string;
    phone: string;
  };
  startDateObj: Date;
  endDateObj: Date;
  days: number;
  lines: PricedLine[];
  addons: PricedAddon[];
  rentalAmount: number;
  addonsAmount: number;
  depositAmount: number;
  totalDueAtPickup: number;
}

@Injectable()
export class PricingService {
  constructor(private readonly catalogService: CatalogService) {}

  computeModelRental(
    pricePerDay: number,
    pricePerWeek: number | null,
    days: number,
  ): number {
    if (pricePerWeek !== null && pricePerWeek > 0 && days >= 7) {
      const weeks = Math.floor(days / 7);
      const remainder = days % 7;
      return weeks * pricePerWeek + remainder * pricePerDay;
    }
    return days * pricePerDay;
  }

  async calculateQuote(dto: QuoteBookingDto): Promise<CalculatedQuote> {
    const startDateObj = parseIsoDateToUtc(dto.startDate);
    const endDateObj = parseIsoDateToUtc(dto.endDate);
    const todayIso = getTodayVietnamIso();

    if (dto.startDate < todayIso) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ngày nhận máy không được ở trong quá khứ.',
        details: { fields: { startDate: 'Ngày nhận không được ở quá khứ' } },
      });
    }

    const days = diffDaysIso(dto.startDate, dto.endDate);
    if (days < 1) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Ngày trả máy phải sau ngày nhận máy.',
        details: { fields: { endDate: 'Ngày trả phải sau ngày nhận' } },
      });
    }

    const branch = await this.catalogService.findActiveBranchBySlug(
      dto.branchSlug,
    );
    if (!branch) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Không tìm thấy chi nhánh đã chọn.',
        details: {},
      });
    }

    const uniqueModelIds = Array.from(
      new Set(dto.items.map((item) => item.modelId)),
    );
    const models =
      await this.catalogService.findModelsForBooking(uniqueModelIds);
    const modelMap = new Map(models.map((m) => [m.id, m]));

    const resolvedItems = dto.items.map((item) => {
      const model = modelMap.get(item.modelId);
      if (!model || !model.isActive) {
        throw new UnprocessableEntityException({
          code: 'MODEL_NOT_BOOKABLE',
          message: 'Mẫu máy đang ẩn hoặc ngừng cho thuê.',
          details: { modelId: item.modelId },
        });
      }
      return model;
    });

    const cameras = resolvedItems.filter((m) => m.kind === ModelKind.CAMERA);
    if (cameras.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Đơn thuê phải có ít nhất một thân máy ảnh.',
        details: { fields: { items: 'Cần chọn ít nhất một thân máy ảnh' } },
      });
    }

    const cameraMounts = new Set(
      cameras
        .map((c) => c.mount)
        .filter((mount): mount is string => Boolean(mount)),
    );
    const lenses = resolvedItems.filter((m) => m.kind === ModelKind.LENS);
    for (const lens of lenses) {
      if (!lens.mount || !cameraMounts.has(lens.mount)) {
        throw new UnprocessableEntityException({
          code: 'INCOMPATIBLE_ITEMS',
          message: 'Ống kính không cùng ngàm với thân máy trong đơn.',
          details: { lensModelId: lens.id },
        });
      }
    }

    const lines: PricedLine[] = resolvedItems.map((model) => ({
      modelId: model.id,
      name: model.name,
      kind: model.kind,
      thumbnailUrl: model.thumbnailUrl,
      pricePerDay: model.pricePerDay,
      rentalAmount: this.computeModelRental(
        model.pricePerDay,
        model.pricePerWeek,
        days,
      ),
      depositAmount: model.deposit,
    }));

    // Merge duplicate addon IDs if any
    const addonQtyMap = new Map<string, number>();
    for (const addon of dto.addons ?? []) {
      addonQtyMap.set(
        addon.filmProductId,
        (addonQtyMap.get(addon.filmProductId) ?? 0) + addon.quantity,
      );
    }

    const addonIds = Array.from(addonQtyMap.keys());
    const filmProducts =
      addonIds.length > 0
        ? await this.catalogService.findFilmProductsByIds(addonIds)
        : [];
    const filmMap = new Map(filmProducts.map((f) => [f.id, f]));

    const addons: PricedAddon[] = addonIds.map((filmId) => {
      const film = filmMap.get(filmId);
      if (!film || !film.inStock) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Sản phẩm film không tồn tại hoặc đã hết hàng.',
          details: { fields: { addons: 'Film không khả dụng' } },
        });
      }
      const quantity = addonQtyMap.get(filmId)!;
      return {
        filmProductId: film.id,
        name: film.name,
        quantity,
        unitPrice: film.price,
        amount: film.price * quantity,
      };
    });

    const rentalAmount = lines.reduce((sum, l) => sum + l.rentalAmount, 0);
    const addonsAmount = addons.reduce((sum, a) => sum + a.amount, 0);
    const depositAmount = lines.reduce((sum, l) => sum + l.depositAmount, 0);

    return {
      branch: {
        id: branch.id,
        slug: branch.slug,
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
      },
      startDateObj,
      endDateObj,
      days,
      lines,
      addons,
      rentalAmount,
      addonsAmount,
      depositAmount,
      totalDueAtPickup: rentalAmount + addonsAmount + depositAmount,
    };
  }
}
