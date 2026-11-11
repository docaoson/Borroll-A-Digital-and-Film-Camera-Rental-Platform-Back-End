import { Prisma, PrismaClient } from '@prisma/client';

export type PrismaTx = Prisma.TransactionClient | PrismaClient;

export async function writeAuditLog(
  db: PrismaTx,
  params: {
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ?? undefined,
    },
  });
}

