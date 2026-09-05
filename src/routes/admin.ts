import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { getAdminStats } from '../services/payment.service';
import { getConnectedDevices } from '../services/websocket.service';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get(
  '/stats',
  authenticate,
  requireRole('ADMIN'),
  async (_req, res) => {
    try {
      const [stats, devices] = await Promise.all([
        getAdminStats(),
        prisma.device.findMany({
          select: { id: true, name: true, role: true, lastSeenAt: true },
        }),
      ]);

      const connectedIds = new Set(
        getConnectedDevices().map((d) => d.id)
      );

      res.json({
        ...stats,
        devices: devices.map((d) => ({
          ...d,
          connected: connectedIds.has(d.id),
        })),
      });
    } catch (err) {
      console.error('Error obteniendo stats:', err);
      res.status(500).json({ error: 'Error interno' });
    }
  }
);

export default router;
