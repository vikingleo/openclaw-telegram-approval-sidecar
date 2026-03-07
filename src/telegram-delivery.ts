import { ProxyAgent } from "undici";

import type {
  RenderedTelegramMessage,
  RuntimeConfig,
  SendMessageResult,
  TelegramTarget,
} from "./types.js";

export class TelegramDelivery {
  private readonly apiBaseUrl: string;

  private readonly botToken: string;

  private readonly requestTimeoutMs: number;

  private readonly retryCount: number;

  private readonly retryBaseMs: number;

  private readonly proxyDispatcher: ProxyAgent | null;

  constructor(config: RuntimeConfig) {
    this.apiBaseUrl = config.telegram.apiBaseUrl.replace(/\/$/, "");
    this.botToken = config.telegram.botToken;
    this.requestTimeoutMs = config.telegram.requestTimeoutMs;
    this.retryCount = config.telegram.retryCount;
    this.retryBaseMs = config.telegram.retryBaseMs;
    this.proxyDispatcher = config.telegram.proxyUrl ? new ProxyAgent(config.telegram.proxyUrl) : null;
  }

  async sendMessage(target: TelegramTarget, message: RenderedTelegramMessage): Promise<SendMessageResult> {
    const result = await this.callTelegram<{ result: { message_id: number } }>("sendMessage", {
      chat_id: normalizeChatId(target.chatId),
      text: message.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(target.threadId ? { message_thread_id: target.threadId } : {}),
      ...(message.replyMarkup ? { reply_markup: message.replyMarkup } : {}),
    });

    return {
      messageId: result.result.message_id,
    };
  }

  async editMessage(target: TelegramTarget, messageId: number, message: RenderedTelegramMessage): Promise<void> {
    try {
      await this.callTelegram("editMessageText", {
        chat_id: normalizeChatId(target.chatId),
        message_id: messageId,
        text: message.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(message.replyMarkup ? { reply_markup: message.replyMarkup } : {}),
      });
    } catch (error) {
      const messageText = String(error);
      if (messageText.includes("message is not modified")) {
        return;
      }

      throw error;
    }
  }

  private async callTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.retryCount) {
      try {
        return await this.callTelegramOnce<T>(method, body);
      } catch (error) {
        lastError = error;
        if (attempt >= this.retryCount || !isRetryableTelegramError(error)) {
          break;
        }

        const waitMs = Math.round(this.retryBaseMs * 2 ** attempt + Math.random() * 250);
        await sleep(waitMs);
      }

      attempt += 1;
    }

    throw lastError;
  }

  private async callTelegramOnce<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(`${this.apiBaseUrl}/bot${this.botToken}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(this.proxyDispatcher ? { dispatcher: this.proxyDispatcher } : {}),
      } as RequestInit & { dispatcher?: ProxyAgent });

      const payload = await response.json() as { ok?: boolean; description?: string; error_code?: number } & T;
      if (!response.ok || payload.ok === false) {
        const description = payload.description ?? `HTTP ${response.status}`;
        throw new Error(`Telegram API ${method} failed: ${description}`);
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeChatId(chatId: string): string | number {
  if (/^-?\d+$/.test(chatId)) {
    return Number(chatId);
  }

  return chatId;
}

function isRetryableTelegramError(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return text.includes("http 429")
    || text.includes("http 500")
    || text.includes("http 502")
    || text.includes("http 503")
    || text.includes("http 504")
    || text.includes("timeout")
    || text.includes("aborted")
    || text.includes("fetch failed")
    || text.includes("networkerror");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
