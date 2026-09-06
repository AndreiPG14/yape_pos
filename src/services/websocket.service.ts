import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthPayload } from '../middleware/auth.middleware';

let io: SocketServer;

interface PendingCharge {
  deviceId: string;
  socketId: string;
  amount: number;
  createdAt: number;
}

const pendingCharges: PendingCharge[] = [];

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

    // Update socketId for existing pending charge on reconnect
    const existing = pendingCharges.find((c) => c.deviceId === device.deviceId);
    if (existing) {
      existing.socketId = socket.id;
      console.log(`Cobro pendiente restaurado: ${device.deviceId} S/ ${existing.amount} (nuevo socket)`);
    }

    socket.on('charge:start', (data: { amount: number }) => {
      const idx = pendingCharges.findIndex((c) => c.deviceId === device.deviceId);
      if (idx !== -1) pendingCharges.splice(idx, 1);
      pendingCharges.push({
        deviceId: device.deviceId,
        socketId: socket.id,
        amount: data.amount,
        createdAt: Date.now(),
      });
      console.log(`Cobro pendiente: ${device.deviceId} espera S/ ${data.amount}`);
    });

    socket.on('charge:cancel', () => {
      const idx = pendingCharges.findIndex((c) => c.deviceId === device.deviceId);
      if (idx !== -1) pendingCharges.splice(idx, 1);
    });

    socket.on('disconnect', () => {
      // Don't remove pending charges on disconnect — worker may reconnect
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

  // Remove expired charges (older than 10 minutes)
  const now = Date.now();
  for (let i = pendingCharges.length - 1; i >= 0; i--) {
    if (now - pendingCharges[i].createdAt > 10 * 60 * 1000) {
      pendingCharges.splice(i, 1);
    }
  }

  // Find the first pending charge that matches the amount (within 0.50)
  const matchIdx = pendingCharges.findIndex(
    (c) => Math.abs(c.amount - payment.amount) < 0.50
  );

  if (matchIdx !== -1) {
    const match = pendingCharges[matchIdx];
    pendingCharges.splice(matchIdx, 1);
    // Send to the specific worker's socket AND broadcast to workers room as fallback
    const targetSocket = io.sockets.sockets.get(match.socketId);
    if (targetSocket?.connected) {
      targetSocket.emit('payment:confirmed', payment);
      console.log(`Pago S/ ${payment.amount} asignado a ${match.deviceId}`);
    } else {
      // Worker disconnected, broadcast to all
      io.to('workers').emit('payment:confirmed', payment);
      console.log(`Pago S/ ${payment.amount} broadcast (worker ${match.deviceId} desconectado)`);
    }
  } else {
    // No pending charge matches, broadcast to all workers
    io.to('workers').emit('payment:confirmed', payment);
    console.log(`Pago S/ ${payment.amount} broadcast a todos (sin cobro pendiente)`);
  }
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
