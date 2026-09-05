import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { DeviceRole } from '@prisma/client';

export interface AuthPayload {
  deviceId: string;
  role: DeviceRole;
}

declare global {
  namespace Express {
    interface Request {
      device?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthPayload;
    req.device = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

export function requireRole(...roles: DeviceRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.device || !roles.includes(req.device.role)) {
      res.status(403).json({ error: 'Acceso denegado' });
      return;
    }
    next();
  };
}
