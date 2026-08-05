import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { redactSensitive } from '@/lib/domain';

export type NotificationInput = { organizationId: string; type: string; recipient?: string; orderId?: string; message: string; dedupeKey: string; critical?: boolean };

function quietHours(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(date));
  return hour >= 23 || hour < 7;
}

export async function enqueueTelegram(input: NotificationInput): Promise<void> {
  const suppressed = quietHours() && !input.critical;
  await db.notificationEvent.upsert({ where: { dedupeKey: input.dedupeKey }, create: { organizationId: input.organizationId, orderId: input.orderId, type: input.type, recipient: input.recipient ?? env.telegramChatId, payloadJson: redactSensitive({ message: input.message, critical: input.critical }) as object, dedupeKey: input.dedupeKey, state: suppressed ? 'SUPPRESSED' : 'PENDING' }, update: {} });
}

export async function deliverPendingTelegram(limit = 20): Promise<number> {
  if (!env.telegramEnabled || !env.telegramBotToken) return 0;
  const rows = await db.notificationEvent.findMany({ where: { state: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, take: limit, orderBy: { createdAt: 'asc' } });
  let sent = 0;
  for (const row of rows) {
    try {
      const message = String((row.payloadJson as { message?: string }).message ?? '');
      const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.telegramBotToken)}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: row.recipient, text: message, disable_web_page_preview: true }) });
      if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
      await db.notificationEvent.update({ where: { id: row.id }, data: { state: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      await db.notificationEvent.update({ where: { id: row.id }, data: { state: attempts >= 3 ? 'FAILED' : 'PENDING', attempts, nextAttemptAt: new Date(Date.now() + Math.min(60_000 * 2 ** row.attempts, 3_600_000)), lastError: error instanceof Error ? error.message : 'Telegram error' } });
    }
  }
  return sent;
}
