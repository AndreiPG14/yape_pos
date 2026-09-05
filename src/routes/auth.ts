import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config';

const router = Router();
const prisma = new PrismaClient();

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['RECEIVER', 'WORKER', 'ADMIN']),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
    return;
  }

  const { name, role } = parsed.data;

  if (role === 'RECEIVER') {
    const existing = await prisma.device.findFirst({ where: { role: 'RECEIVER' } });
    if (existing) {
      res.status(409).json({ error: 'Ya existe un dispositivo receptor registrado' });
      return;
    }
  }

  const deviceToken = crypto.randomBytes(32).toString('hex');

  const device = await prisma.device.create({
    data: { name, role, token: deviceToken },
  });

  const jwtToken = jwt.sign(
    { deviceId: device.id, role: device.role },
    config.jwtSecret,
    { expiresIn: '365d' }
  );

  res.status(201).json({
    device: { id: device.id, name: device.name, role: device.role },
    token: jwtToken,
    deviceToken,
  });
});

const loginSchema = z.object({
  deviceToken: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Token de dispositivo requerido' });
    return;
  }

  const device = await prisma.device.findUnique({
    where: { token: parsed.data.deviceToken },
  });

  if (!device) {
    res.status(401).json({ error: 'Dispositivo no encontrado' });
    return;
  }

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  const jwtToken = jwt.sign(
    { deviceId: device.id, role: device.role },
    config.jwtSecret,
    { expiresIn: '365d' }
  );

  res.json({
    device: { id: device.id, name: device.name, role: device.role },
    token: jwtToken,
  });
});

export default router;
