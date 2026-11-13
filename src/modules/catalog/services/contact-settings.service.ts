import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '../../../common/utils/audit.util';
import { PrismaService } from '../../../infra/database/prisma.service';
import { UpdateContactSettingsDto } from '../dto/catalog.dto';

const CONTACT_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;
const CONTACT_SETTINGS_DEFAULT_ID = 'default';

export interface PublicContactSettingsResponse {
  chatEnabled: boolean;
  welcomeMessage: string | null;
  zalo: {
    oaId: string | null;
    url: string | null;
  };
  messenger: {
    url: string | null;
  };
  instagram: {
    handle: string | null;
    url: string | null;
  };
  hotline: string | null;
  branches: Array<{
    slug: string;
    name: string;
    phone: string;
  }>;
}

@Injectable()
export class ContactSettingsService {
  private contactSettingsCache: {
    data: PublicContactSettingsResponse;
    expiresAt: number;
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  public invalidateContactSettingsCache(): void {
    this.contactSettingsCache = null;
  }

  private containsUrlOrHtml(value: string): boolean {
    if (/[<>]|javascript:|vbscript:|data:text\/html|on\w+\s*=/i.test(value)) {
      return true;
    }
    if (
      /(https?:\/\/|www\.|:\/\/|zalo\.me|m\.me|facebook\.com|fb\.com)/i.test(
        value,
      )
    ) {
      return true;
    }
    return false;
  }

  async getPublicContactSettings(): Promise<PublicContactSettingsResponse> {
    const now = Date.now();
    if (
      this.contactSettingsCache &&
      now < this.contactSettingsCache.expiresAt
    ) {
      return this.contactSettingsCache.data;
    }

    const [row, branches] = await Promise.all([
      this.prisma.contactSetting.findUnique({
        where: { id: CONTACT_SETTINGS_DEFAULT_ID },
      }),
      this.prisma.branch.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }],
        select: { slug: true, name: true, phone: true },
      }),
    ]);

    const zaloOaId = row?.zaloOaId?.trim() || null;
    const zaloPhone = row?.zaloPhone?.trim() || null;
    const messengerPage = row?.messengerPage?.trim() || null;
    const instagramHandle = row?.instagramHandle?.trim() || null;
    const hotline = row?.hotline?.trim() || null;
    const welcomeMessage = row?.welcomeMessage?.trim() || null;

    const data: PublicContactSettingsResponse = {
      chatEnabled: Boolean(row?.isChatEnabled),
      welcomeMessage,
      zalo: {
        oaId: zaloOaId,
        url: zaloPhone ? `https://zalo.me/${zaloPhone}` : null,
      },
      messenger: {
        url: messengerPage ? `https://m.me/${messengerPage}` : null,
      },
      instagram: {
        handle: instagramHandle,
        url: instagramHandle
          ? `https://instagram.com/${instagramHandle}`
          : null,
      },
      hotline,
      branches: branches.map((b) => ({
        slug: b.slug,
        name: b.name,
        phone: b.phone,
      })),
    };

    this.contactSettingsCache = {
      data,
      expiresAt: now + CONTACT_SETTINGS_CACHE_TTL_MS,
    };

    return data;
  }

  async updateContactSettings(
    dto: UpdateContactSettingsDto,
    actorId: string,
  ): Promise<PublicContactSettingsResponse> {
    const fields: Record<string, string> = {};

    const rawZaloOaId =
      dto.zaloOaId !== undefined ? dto.zaloOaId : dto.zalo_oa_id;
    const rawZaloPhone =
      dto.zaloPhone !== undefined ? dto.zaloPhone : dto.zalo_phone;
    const rawMessengerPage =
      dto.messengerPage !== undefined ? dto.messengerPage : dto.messenger_page;
    const rawInstagramHandle =
      dto.instagramHandle !== undefined
        ? dto.instagramHandle
        : dto.instagram_handle;
    const rawHotline = dto.hotline;
    const rawWelcomeMessage =
      dto.welcomeMessage !== undefined
        ? dto.welcomeMessage
        : dto.welcome_message;
    const rawChatEnabled =
      dto.isChatEnabled !== undefined
        ? dto.isChatEnabled
        : dto.is_chat_enabled !== undefined
          ? dto.is_chat_enabled
          : dto.chatEnabled;

    const normalizeNullable = (
      val: string | null | undefined,
    ): string | null | undefined => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      const trimmed = val.trim();
      return trimmed.length === 0 ? null : trimmed;
    };

    const zaloOaId = normalizeNullable(rawZaloOaId);
    const zaloPhone = normalizeNullable(rawZaloPhone);
    const messengerPage = normalizeNullable(rawMessengerPage);
    const instagramHandle = normalizeNullable(rawInstagramHandle);
    const hotline = normalizeNullable(rawHotline);
    const welcomeMessage = normalizeNullable(rawWelcomeMessage);

    if (typeof zaloOaId === 'string') {
      if (this.containsUrlOrHtml(zaloOaId) || !/^\d{1,30}$/.test(zaloOaId)) {
        fields.zaloOaId = 'Zalo OA ID chỉ gồm chữ số (tối đa 30 ký tự).';
      }
    }

    if (typeof zaloPhone === 'string') {
      if (this.containsUrlOrHtml(zaloPhone) || !/^0\d{9}$/.test(zaloPhone)) {
        fields.zaloPhone =
          'Số điện thoại Zalo phải gồm 10 chữ số bắt đầu bằng 0.';
      }
    }

    if (typeof hotline === 'string') {
      if (this.containsUrlOrHtml(hotline) || !/^0\d{9}$/.test(hotline)) {
        fields.hotline = 'Số hotline phải gồm 10 chữ số bắt đầu bằng 0.';
      }
    }

    if (typeof messengerPage === 'string') {
      if (
        this.containsUrlOrHtml(messengerPage) ||
        !/^[A-Za-z0-9.]{5,50}$/.test(messengerPage)
      ) {
        fields.messengerPage =
          'Tên trang Messenger chỉ gồm chữ cái, chữ số hoặc dấu chấm (5-50 ký tự), không nhận URL.';
      }
    }

    if (typeof instagramHandle === 'string') {
      if (
        this.containsUrlOrHtml(instagramHandle) ||
        !/^[A-Za-z0-9._]{1,30}$/.test(instagramHandle)
      ) {
        fields.instagramHandle =
          'Tài khoản Instagram chỉ gồm chữ cái, chữ số, dấu gạch dưới hoặc dấu chấm (tối đa 30 ký tự), không nhận URL.';
      }
    }

    if (typeof welcomeMessage === 'string') {
      if (this.containsUrlOrHtml(welcomeMessage)) {
        fields.welcomeMessage =
          'Lời chào không được chứa đường dẫn URL hoặc mã HTML/script.';
      } else if (welcomeMessage.length > 120) {
        fields.welcomeMessage = 'Lời chào tối đa 120 ký tự.';
      }
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu cấu hình liên hệ không hợp lệ.',
        details: { fields },
      });
    }

    const updateData: Prisma.ContactSettingUncheckedUpdateInput = {
      updatedBy: actorId,
    };
    const createData: Prisma.ContactSettingUncheckedCreateInput = {
      id: CONTACT_SETTINGS_DEFAULT_ID,
      zaloOaId: zaloOaId ?? null,
      zaloPhone: zaloPhone ?? null,
      messengerPage: messengerPage ?? null,
      instagramHandle: instagramHandle ?? null,
      hotline: hotline ?? null,
      welcomeMessage: welcomeMessage ?? null,
      isChatEnabled: rawChatEnabled ?? false,
      updatedBy: actorId,
    };

    if (zaloOaId !== undefined) updateData.zaloOaId = zaloOaId;
    if (zaloPhone !== undefined) updateData.zaloPhone = zaloPhone;
    if (messengerPage !== undefined) updateData.messengerPage = messengerPage;
    if (instagramHandle !== undefined) {
      updateData.instagramHandle = instagramHandle;
    }
    if (hotline !== undefined) updateData.hotline = hotline;
    if (welcomeMessage !== undefined) {
      updateData.welcomeMessage = welcomeMessage;
    }
    if (rawChatEnabled !== undefined) {
      updateData.isChatEnabled = rawChatEnabled;
    }

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.contactSetting.upsert({
        where: { id: CONTACT_SETTINGS_DEFAULT_ID },
        update: updateData,
        create: createData,
      });

      await writeAuditLog(tx, {
        actorId,
        action: 'CONTACT_SETTINGS_UPDATED',
        targetType: 'CONTACT_SETTINGS',
        targetId: saved.id,
        metadata: {
          zaloOaId: saved.zaloOaId,
          zaloPhone: saved.zaloPhone,
          messengerPage: saved.messengerPage,
          instagramHandle: saved.instagramHandle,
          hotline: saved.hotline,
          welcomeMessage: saved.welcomeMessage,
          isChatEnabled: saved.isChatEnabled,
        },
      });
    });

    this.invalidateContactSettingsCache();
    return this.getPublicContactSettings();
  }
}

