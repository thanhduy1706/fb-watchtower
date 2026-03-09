import { createLogger, type Logger } from '../core/logger.js';

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface DeliveryResult {
  success: boolean;
  statusCode: number | null;
  attempts: number;
  error: string | null;
}

export interface Decision {
  changeDetected: boolean;
  postLink: string | null;
  contentPreview?: string | null;
}

export class NotificationAgent {
  #webhookUrl: string;
  #maxRetries: number;
  #log: Logger;

  constructor(webhookUrl: string, options: { maxRetries?: number; logger?: Logger } = {}) {
    if (!webhookUrl) {
      throw new Error('NotificationAgent requires a Slack webhook URL');
    }

    this.#webhookUrl = webhookUrl;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#log = options.logger ?? createLogger('Notification');
  }

  // ── Public API ──────────────────────────────────────────────────

  async notify(decision: Decision): Promise<DeliveryResult> {
    const payload = this.#buildPayload(decision);

    this.#log.info(`Sending Slack notification for: ${decision.postLink}`);

    let lastError: string | null = null;
    let statusCode: number | null = null;

    for (let attempt = 1; attempt <= this.#maxRetries; attempt++) {
      try {
        const response = await fetch(this.#webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        statusCode = response.status;

        // Success
        if (response.ok) {
          const result = this.#buildResult(true, statusCode, attempt, null);
          this.#log.info(`Delivered (${statusCode}) on attempt ${attempt}`);
          return result;
        }

        // Client error — no point retrying
        if (statusCode >= 400 && statusCode < 500) {
          const body = await this.#safeReadBody(response);
          const msg = `Slack returned ${statusCode}: ${body}`;
          this.#log.error(msg);
          return this.#buildResult(false, statusCode, attempt, msg);
        }

        // Server error — retry with backoff
        lastError = `Slack returned ${statusCode}`;
        this.#log.warn(`Attempt ${attempt}/${this.#maxRetries} failed (${statusCode}) — retrying…`);

        if (attempt < this.#maxRetries) {
          await this.#sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      } catch (err: any) {
        lastError = err.message;
        statusCode = null;
        this.#log.warn(`Attempt ${attempt}/${this.#maxRetries} threw: ${err.message}`);

        if (attempt < this.#maxRetries) {
          await this.#sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    // All retries exhausted
    const msg = `All ${this.#maxRetries} attempts failed. Last error: ${lastError}`;
    this.#log.error(msg);
    return this.#buildResult(false, statusCode, this.#maxRetries, msg);
  }

  // ── Private helpers ─────────────────────────────────────────────

  #buildPayload(decision: Decision): any {
    const dateStr = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📢', emoji: true },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Link:*\n<${decision.postLink}|View on Facebook>`,
        },
      },
    ];

    if (decision.contentPreview) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Preview:*\n> ${decision.contentPreview.replace(/\n/g, '\n> ')}`,
        },
      });
    }

    blocks.push(
      {
        type: 'divider',
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Post',
              emoji: true,
            },
            url: decision.postLink!,
            action_id: 'view_post_btn',
            style: 'primary',
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*fb-watchtower* • Detected at ${dateStr} (ICT)`,
          },
        ],
      },
    );

    return { blocks };
  }

  #buildResult(
    success: boolean,
    statusCode: number | null,
    attempts: number,
    error: string | null,
  ): DeliveryResult {
    return { success, statusCode, attempts, error };
  }

  async #safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '(unable to read body)';
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
