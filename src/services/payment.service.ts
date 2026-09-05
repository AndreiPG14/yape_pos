import { PrismaClient, PaymentStatus } from '@prisma/client';
import { buildDedupHash } from '../utils/dedup';
import { broadcastPayment } from './websocket.service';
import { config } from '../config';

const prisma = new PrismaClient();

interface CreatePaymentInput {
  source: string;
  amount: number;
  payerName: string;
  receivedAt: string;
  notificationText: string;
  externalId?: string;
  deviceId: string;
}

export async function createPayment(input: CreatePaymentInput) {
  const dedupHash = buildDedupHash(
    input.amount,
    input.payerName,
    input.receivedAt,
    input.deviceId
  );

  const windowStart = new Date(
    new Date(input.receivedAt).getTime() - config.dedupWindowMinutes * 60 * 1000
  );

  const existing = await prisma.payment.findFirst({
    where: {
      dedupHash,
      createdAt: { gte: windowStart },
    },
  });

  if (existing) {
    const dup = await prisma.payment.create({
      data: {
        source: input.source,
        amount: input.amount,
        payerName: input.payerName,
        receivedAt: new Date(input.receivedAt),
        notificationText: input.notificationText,
        externalId: input.externalId,
        deviceId: input.deviceId,
        dedupHash,
        status: PaymentStatus.DUPLICATE,
      },
    });
    return { payment: dup, isDuplicate: true };
  }

  const payment = await prisma.payment.create({
    data: {
      source: input.source,
      amount: input.amount,
      payerName: input.payerName,
      receivedAt: new Date(input.receivedAt),
      notificationText: input.notificationText,
      externalId: input.externalId,
      deviceId: input.deviceId,
      dedupHash,
      status: PaymentStatus.RECEIVED,
    },
  });

  broadcastPayment({
    id: payment.id,
    amount: Number(payment.amount),
    payerName: payment.payerName,
    receivedAt: payment.receivedAt.toISOString(),
    source: payment.source,
  });

  return { payment, isDuplicate: false };
}

export async function getTodayPayments(page = 1, limit = 50) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: {
        createdAt: { gte: startOfDay },
        status: { not: PaymentStatus.DUPLICATE },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({
      where: {
        createdAt: { gte: startOfDay },
        status: { not: PaymentStatus.DUPLICATE },
      },
    }),
  ]);

  return { payments, total, page, limit };
}

export async function getAdminStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayPayments, duplicates, lastPayment] = await Promise.all([
    prisma.payment.findMany({
      where: {
        createdAt: { gte: startOfDay },
        status: { not: PaymentStatus.DUPLICATE },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.count({
      where: {
        createdAt: { gte: startOfDay },
        status: PaymentStatus.DUPLICATE,
      },
    }),
    prisma.payment.findFirst({
      where: { status: { not: PaymentStatus.DUPLICATE } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const totalAmount = todayPayments.reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );

  return {
    todayCount: todayPayments.length,
    totalAmount,
    duplicateCount: duplicates,
    lastPayment: lastPayment
      ? {
          id: lastPayment.id,
          amount: Number(lastPayment.amount),
          payerName: lastPayment.payerName,
          receivedAt: lastPayment.receivedAt.toISOString(),
        }
      : null,
  };
}
