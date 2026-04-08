import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from './logger';
import { webhookService } from './webhook';
import type { WebhookPayload } from '@opencharts/common';

const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

// ── Queues ────────────────────────────────────────────

export const alertCheckQueue = new Queue('alert-check', { connection });
export const dataBackfillQueue = new Queue('data-backfill', { connection });

// ── Alert-check worker ───────────────────────────────
// Runs every time a new price arrives to check if any alerts should fire.
export const alertCheckWorker = new Worker(
  'alert-check',
  async (job: Job<{ symbol: string; price: number }>) => {
    const { symbol, price } = job.data;

    const result = await pool.query(
      `UPDATE alerts
       SET triggered = TRUE, triggered_at = NOW(), active = FALSE
       WHERE symbol = $1 AND active = TRUE AND triggered = FALSE
         AND (
           (condition = 'crosses_above' AND price <= $2 AND $2 >= price)
           OR (condition = 'crosses_below' AND price >= $2 AND $2 <= price)
           OR (condition = 'greater_than' AND $2 >= price)
           OR (condition = 'less_than' AND $2 <= price)
         )
       RETURNING id, user_id, message, condition, price, webhook_url, webhook_headers`,
      [symbol, price],
    );

    // Fire webhooks for triggered alerts
    for (const row of result.rows) {
      if (row.webhook_url) {
        const payload: WebhookPayload = {
          alertId: row.id,
          symbol,
          condition: row.condition,
          price: parseFloat(row.price),
          currentPrice: price,
          message: row.message,
          triggeredAt: new Date().toISOString(),
        };
        // Fire-and-forget
        webhookService.deliver(row.webhook_url, payload, row.webhook_headers ?? undefined).catch(() => {});
      }
    }

    return { triggered: result.rows.length, alerts: result.rows };
  },
  { connection, concurrency: 5 },
);

// ── Data backfill worker ─────────────────────────────
// Fetches historical bars for a symbol/resolution and inserts them.
export const dataBackfillWorker = new Worker(
  'data-backfill',
  async (job: Job<{ symbol: string; resolution: string; from: number; to: number }>) => {
    const { symbol, resolution, from, to } = job.data;
    // Placeholder — providers (ccxt/alpaca) can be called here to fetch and store
    logger.info({ symbol, resolution, from, to }, '[backfill] Starting');
    await job.updateProgress(100);
    return { symbol, resolution, barsInserted: 0 };
  },
  { connection, concurrency: 2 },
);

// ── Repeatable: periodic alert sweep ─────────────────
export async function scheduleAlertSweep() {
  await alertCheckQueue.upsertJobScheduler(
    'periodic-alert-sweep',
    { every: 60_000 },
    { name: 'alert-sweep', data: { symbol: '*', price: 0 } },
  );
}

// ── Graceful shutdown ────────────────────────────────
export async function closeQueues() {
  await alertCheckWorker.close();
  await dataBackfillWorker.close();
  await alertCheckQueue.close();
  await dataBackfillQueue.close();
  await connection.quit();
}
