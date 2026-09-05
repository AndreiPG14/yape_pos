import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthPayload } from '../middleware/auth.middleware';

let io: SocketServer;

export function initWebSocket(socketServer: SocketServer) {
  io = socketServer;

  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string;
    if (!token) return next(new Error('Token requerido'));
    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      socket.data.device = payload;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    const device = socket.data.device as AuthPayload;
    console.log(`Dispositivo conectado: ${device.deviceId} (${device.role})`);

    if (device.role === 'WORKER' || device.role === 'ADMIN') {
      socket.join('workers');
    }
    if (device.role === 'ADMIN') {
      socket.join('admins');
    }

    socket.on('disconnect', () => {
      console.log(`Dispositivo desconectado: ${device.deviceId}`);
    });
  });
}

export function broadcastPayment(payment: {
  id: string;
  amount: number;
  payerName: string;
  receivedAt: string;
  source: string;
}) {
  if (!io) return;
  io.to('workers').emit('payment:confirmed', payment);
}

export function getConnectedDevices(): { id: string; role: string }[] {
  if (!io) return [];
  const devices: { id: string; role: string }[] = [];
  for (const [, socket] of io.sockets.sockets) {
    const d = socket.data.device as AuthPayload;
    if (d) devices.push({ id: d.deviceId, role: d.role });
  }
  return devices;
}
