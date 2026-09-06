import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { createPayment, getTodayPayments } from '../services/payment.service';

const router = Router();

const paymentSchema = z.object({
  source: z.string().default('yape'),
  amount: z.number().positive(),
  payerName: z.string().min(1),
  receivedAt: z.string(),
  notificationText: z.string().min(1),
  externalId: z.string().optional(),
});

router.post(
  '/',
  authenticate,
  requireRole('RECEIVER'),
  async (req, res) => {
    console.log('POST /payments recibido:', JSON.stringify(req.body));
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      console.log('Validación fallida:', JSON.stringify(parsed.error.flatten()));
      res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
      return;
    }

    try {
      const result = await createPayment({
        ...parsed.data,
        deviceId: req.device!.deviceId,
      });

      res.status(result.isDuplicate ? 200 : 201).json({
        payment: {
          id: result.payment.id,
          amount: Number(result.payment.amount),
          payerName: result.payment.payerName,
          receivedAt: result.payment.receivedAt.toISOString(),
          status: result.payment.status,
        },
        isDuplicate: result.isDuplicate,
      });
    } catch (err) {
      console.error('Error creando pago:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  }
);

router.get('/check', authenticate, async (req, res) => {
  const amount = parseFloat(req.query.amount as string);
  const since = req.query.since as string;
  if (!amount || !since) {
    res.status(400).json({ error: 'amount and since required' });
    return;
  }
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const payment = await prisma.payment.findFirst({
      where: {
        amount: { gte: amount - 0.50, lte: amount + 0.50 },
        createdAt: { gte: new Date(since) },
        status: { not: 'DUPLICATE' },
      },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.$disconnect();
    if (payment) {
      res.json({
        found: true,
        payment: {
          id: payment.id,
          amount: Number(payment.amount),
          payerName: payment.payerName,
          receivedAt: payment.receivedAt.toISOString(),
          source: payment.source,
        },
      });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    console.error('Error checking payment:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/', authenticate, async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  try {
    const result = await getTodayPayments(page, limit);
    res.json({
      payments: result.payments.map((p) => ({
        id: p.id,
        source: p.source,
        amount: Number(p.amount),
        payerName: p.payerName,
        receivedAt: p.receivedAt.toISOString(),
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (err) {
    console.error('Error obteniendo pagos:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
