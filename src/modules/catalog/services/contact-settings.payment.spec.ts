import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infra/database/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { ContactSettingsService } from './contact-settings.service';

describe('ContactSettingsService public payment settings', () => {
  it('persists admin payment fields and verifies the uploaded QR before saving', async () => {
    const saved = {
      id: 'default',
      paymentEnabled: true,
      paymentBankName: 'Bank',
      paymentAccountNumber: '123456',
      paymentAccountName: 'BORROLL CO',
      paymentQrPath: 'payment-qr/qr.png',
      paymentInstructions: 'Use booking code',
      zaloOaId: null,
      zaloPhone: null,
      messengerPage: null,
      instagramHandle: null,
      hotline: null,
      welcomeMessage: null,
      isChatEnabled: false,
    };
    const tx = {
      contactSetting: { upsert: jest.fn().mockResolvedValue(saved) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      contactSetting: { findUnique: jest.fn().mockResolvedValue(saved) },
      branch: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback) => callback(tx)),
    } as unknown as PrismaService;
    const config = {
      get: jest.fn().mockReturnValue('payment-assets'),
    } as unknown as ConfigService;
    const storage = {
      assertOwnedFile: jest.fn().mockResolvedValue(undefined),
      getPublicUrl: jest.fn().mockReturnValue('https://storage.example/qr.png'),
    } as unknown as StorageService;
    const service = new ContactSettingsService(prisma, config, storage);

    await service.updateContactSettings(
      {
        paymentEnabled: true,
        paymentBankName: 'Bank',
        paymentAccountNumber: '123456',
        paymentAccountName: 'BORROLL CO',
        paymentQrPath: 'payment-qr/qr.png',
        paymentInstructions: 'Use booking code',
      },
      'admin-id',
    );

    expect(storage.assertOwnedFile).toHaveBeenCalledWith(
      'payment-assets',
      'payment-qr/qr.png',
      'payment-qr/',
      expect.objectContaining({ allowedMimeTypes: ['image/jpeg', 'image/png'] }),
    );
    expect(tx.contactSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'default' },
        update: expect.objectContaining({
          paymentEnabled: true,
          paymentBankName: 'Bank',
          paymentAccountNumber: '123456',
          paymentAccountName: 'BORROLL CO',
          paymentQrPath: 'payment-qr/qr.png',
          paymentInstructions: 'Use booking code',
        }),
      }),
    );
    expect(prisma.contactSetting.findUnique).toHaveBeenCalledWith({
      where: { id: 'default' },
    });
  });

  it('returns persisted bank fields and a public QR URL without caching the result', async () => {
    const row = {
      paymentEnabled: true,
      paymentBankName: 'Bank',
      paymentAccountNumber: '123456',
      paymentAccountName: 'BORROLL CO',
      paymentQrPath: 'payment-qr/qr.png',
      paymentInstructions: 'Use booking code',
    };
    const prisma = {
      contactSetting: { findUnique: jest.fn().mockResolvedValue(row) },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn().mockReturnValue('payment-assets'),
    } as unknown as ConfigService;
    const storage = {
      getPublicUrl: jest.fn().mockReturnValue('https://storage.example/qr.png'),
    } as unknown as StorageService;
    const service = new ContactSettingsService(prisma, config, storage);

    const first = await service.getPublicPaymentSettings();
    const second = await service.getPublicPaymentSettings();

    expect(first).toEqual({
      enabled: true,
      bankName: 'Bank',
      accountNumber: '123456',
      accountName: 'BORROLL CO',
      qrImageUrl: 'https://storage.example/qr.png',
      qrPath: 'payment-qr/qr.png',
      instructions: 'Use booking code',
    });
    expect(second).toEqual(first);
    expect(prisma.contactSetting.findUnique).toHaveBeenCalledTimes(2);
    expect(storage.getPublicUrl).toHaveBeenCalledWith(
      'payment-assets',
      'payment-qr/qr.png',
    );
    expect(first).not.toHaveProperty('serviceRoleKey');
  });

  it('returns an empty disabled configuration if no ContactSetting row exists', async () => {
    const prisma = {
      contactSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const config = { get: jest.fn() } as unknown as ConfigService;
    const storage = { getPublicUrl: jest.fn() } as unknown as StorageService;
    const service = new ContactSettingsService(prisma, config, storage);

    await expect(service.getPublicPaymentSettings()).resolves.toEqual({
      enabled: false,
      bankName: null,
      accountNumber: null,
      accountName: null,
      qrImageUrl: null,
      qrPath: null,
      instructions: null,
    });
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });
});
