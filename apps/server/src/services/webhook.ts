import type { WebhookPayload } from '@opencharts/common';
import { logger } from './logger';

/**
 * WebhookService — delivers alert notifications to user-configured webhook URLs.
 * Uses fire-and-forget with retry (up to 3 attempts).
 */
export class WebhookService {
  private maxRetries = 3;
  private retryDelayMs = 2000;

  async deliver(
    url: string,
    payload: WebhookPayload,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'OpenCharts-Webhook/1.0',
            ...headers,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          logger.info({ alertId: payload.alertId, url, status: res.status }, '[Webhook] Delivered');
          return true;
        }

        logger.warn(
          { alertId: payload.alertId, url, status: res.status, attempt },
          '[Webhook] Non-OK response',
        );
      } catch (err) {
        logger.warn(
          { alertId: payload.alertId, url, attempt, err: (err as Error).message },
          '[Webhook] Delivery failed',
        );
      }

      if (attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      }
    }

    logger.error({ alertId: payload.alertId, url }, '[Webhook] All retries exhausted');
    return false;
  }
}

export const webhookService = new WebhookService();
