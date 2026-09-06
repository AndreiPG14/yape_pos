import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { initWebSocket } from './services/websocket.service';
import authRoutes from './routes/auth';
import paymentRoutes from './routes/payments';
import adminRoutes from './routes/admin';

const app = express();
const server = createServer(app);

const io = new SocketServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

initWebSocket(io);

server.listen(config.port, () => {
  console.log(`Yape POS Backend corriendo en puerto ${config.port}`);
});
