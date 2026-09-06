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

interface RecentPayment {
  id: string;
  amount: number;
  payerName: string;
  receivedAt: string;
  source: string;
  timestamp: number;
}

const pendingCharges: PendingCharge[] = [];
// Store recent undelivered payments for retry
let lastUndeliveredPayment: RecentPayment | null = null;

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

      // Update socketId for existing pending charge on reconnect
      const existing = pendingCharges.find((c) => c.deviceId === device.deviceId);
      if (existing) {
        existing.socketId = socket.id;
        console.log(`Cobro pendiente restaurado: ${device.deviceId} S/ ${existing.amount}`);
      }

      // Deliver undelivered payment if it matches this worker's pending charge
      if (lastUndeliveredPayment) {
        const elapsed = Date.now() - lastUndeliveredPayment.timestamp;
        if (elapsed < 2 * 60 * 1000) {
          const chargeIdx = pendingCharges.findIndex(
            (c) => c.deviceId === device.deviceId && Math.abs(c.amount - lastUndeliveredPayment!.amount) < 0.50
          );
          if (chargeIdx !== -1) {
            pendingCharges.splice(chargeIdx, 1);
            socket.emit('payment:confirmed', lastUndeliveredPayment);
            console.log(`Pago pendiente entregado a ${device.deviceId}: S/ ${lastUndeliveredPayment.amount}`);
            lastUndeliveredPayment = null;
          }
        } else {
          lastUndeliveredPayment = null;
        }
      }
    }
    if (device.role === 'ADMIN') {
      socket.join('admins');
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

      // Check if there's an undelivered payment that matches
      if (lastUndeliveredPayment) {
        const elapsed = Date.now() - lastUndeliveredPayment.timestamp;
        if (elapsed < 2 * 60 * 1000 && Math.abs(data.amount - lastUndeliveredPayment.amount) < 0.50) {
          const chargeIdx = pendingCharges.findIndex((c) => c.deviceId === device.deviceId);
          if (chargeIdx !== -1) pendingCharges.splice(chargeIdx, 1);
          socket.emit('payment:confirmed', lastUndeliveredPayment);
          console.log(`Pago pendiente entregado (charge:start) a ${device.deviceId}: S/ ${lastUndeliveredPayment.amount}`);
          lastUndeliveredPayment = null;
        }
      }
    });

    socket.on('charge:cancel', () => {
      const idx = pendingCharges.findIndex((c) => c.deviceId === device.deviceId);
      if (idx !== -1) pendingCharges.splice(idx, 1);
    });

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

  // Remove expired charges (older than 10 minutes)
  const now = Date.now();
  for (let i = pendingCharges.length - 1; i >= 0; i--) {
    if (now - pendingCharges[i].createdAt > 10 * 60 * 1000) {
      pendingCharges.splice(i, 1);
    }
  }

  const matchIdx = pendingCharges.findIndex(
    (c) => Math.abs(c.amount - payment.amount) < 0.50
  );

  if (matchIdx !== -1) {
    const match = pendingCharges[matchIdx];
    pendingCharges.splice(matchIdx, 1);
    const targetSocket = io.sockets.sockets.get(match.socketId);
    if (targetSocket?.connected) {
      targetSocket.emit('payment:confirmed', payment);
      console.log(`Pago S/ ${payment.amount} asignado a ${match.deviceId}`);
    } else {
      // Worker disconnected — store for retry when they reconnect
      lastUndeliveredPayment = { ...payment, timestamp: Date.now() };
      // Also broadcast to any connected workers
      io.to('workers').emit('payment:confirmed', payment);
      console.log(`Pago S/ ${payment.amount} guardado para retry (worker ${match.deviceId} desconectado)`);
    }
  } else {
    // No pending charge, broadcast to all and store for retry
    const workersRoom = io.sockets.adapter.rooms.get('workers');
    if (!workersRoom || workersRoom.size === 0) {
      lastUndeliveredPayment = { ...payment, timestamp: Date.now() };
      console.log(`Pago S/ ${payment.amount} guardado (no hay workers conectados)`);
    } else {
      io.to('workers').emit('payment:confirmed', payment);
      console.log(`Pago S/ ${payment.amount} broadcast a ${workersRoom.size} workers`);
    }
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
