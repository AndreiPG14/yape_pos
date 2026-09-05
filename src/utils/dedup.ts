import crypto from 'crypto';

export function buildDedupHash(
  amount: number,
  payerName: string,
  receivedAt: string,
  deviceId: string
): string {
  const dateMinute = receivedAt.slice(0, 16);
  const raw = `${amount}|${payerName.trim().toLowerCase()}|${dateMinute}|${deviceId}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
