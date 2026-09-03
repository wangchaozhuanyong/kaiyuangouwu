import { Injectable, Optional } from '@nestjs/common';

export interface TelegramClientOptions {
    token?: string;
    apiBaseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}

export interface TelegramBotIdentity {
    id: string;
    username: string | null;
    displayName: string;
}

export interface TelegramMessageResult {
    messageId: string;
}

export interface TelegramMessageRequest {
    chatId: string;
    text: string;
    silent?: boolean;
    button?: { label: string; url: string };
}

interface TelegramApiResponse<T> {
    ok: boolean;
    result?: T;
    error_code?: number;
    description?: string;
    parameters?: { retry_after?: number };
}

export class TelegramClientError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly retryable: boolean,
        public readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = 'TelegramClientError';
    }
}

@Injectable()
export class TelegramClient {
    private readonly token: string;
    private readonly apiBaseUrl: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(@Optional() options: TelegramClientOptions = {}) {
        this.token = options.token?.trim() ?? process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
        this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/$/u, '');
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    configured(): boolean {
        return Boolean(this.token);
    }

    async getMe(): Promise<TelegramBotIdentity> {
        const result = await this.request<{ id: number | string; username?: string; first_name?: string }>(
            'getMe',
            {},
        );
        return {
            id: String(result.id),
            username: result.username?.trim() || null,
            displayName: result.first_name?.trim() || result.username?.trim() || String(result.id),
        };
    }

    async sendMessage(request: TelegramMessageRequest): Promise<TelegramMessageResult> {
        const result = await this.request<{ message_id: number | string }>('sendMessage', {
            chat_id: request.chatId,
            text: request.text,
            parse_mode: 'HTML',
            disable_notification: request.silent ?? false,
            ...(request.button ? { reply_markup: inlineKeyboard(request.button) } : {}),
        });
        return { messageId: String(result.message_id) };
    }

    async editMessageText(
        request: TelegramMessageRequest & { messageId: string },
    ): Promise<TelegramMessageResult> {
        const result = await this.request<{ message_id: number | string }>('editMessageText', {
            chat_id: request.chatId,
            message_id: request.messageId,
            text: request.text,
            parse_mode: 'HTML',
            ...(request.button ? { reply_markup: inlineKeyboard(request.button) } : {}),
        });
        return { messageId: String(result.message_id) };
    }

    private async request<T>(method: string, body: Record<string, unknown>): Promise<T> {
        if (!this.token) {
            throw new TelegramClientError('NOT_CONFIGURED', 'Telegram Bot Token 未配置', false);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.token}/${method}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const payload = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;
            if (!response.ok || !payload?.ok || payload.result === undefined) {
                throw telegramApiError(response.status, payload);
            }
            return payload.result;
        } catch (error) {
            if (error instanceof TelegramClientError) throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw new TelegramClientError('TIMEOUT', 'Telegram 请求超时', true);
            }
            throw new TelegramClientError('NETWORK', 'Telegram 网络请求失败', true);
        } finally {
            clearTimeout(timeout);
        }
    }
}

function telegramApiError(status: number, payload: TelegramApiResponse<unknown> | null): TelegramClientError {
    const apiCode = payload?.error_code ?? status;
    const retryAfter = payload?.parameters?.retry_after;
    const description = sanitizeTelegramDescription(payload?.description);
    if (apiCode === 429) {
        return new TelegramClientError(
            'RATE_LIMITED',
            description || 'Telegram 请求过于频繁',
            true,
            retryAfter,
        );
    }
    if (apiCode === 401 || apiCode === 403) {
        return new TelegramClientError('AUTHORIZATION', 'Telegram Token 或群权限无效', false);
    }
    if (apiCode === 400) {
        return new TelegramClientError('BAD_REQUEST', description || 'Telegram 消息参数无效', false);
    }
    return new TelegramClientError(`HTTP_${apiCode || 'UNKNOWN'}`, description || 'Telegram 服务异常', true);
}

function sanitizeTelegramDescription(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 300);
}

function inlineKeyboard(button: { label: string; url: string }) {
    return { inline_keyboard: [[{ text: button.label, url: button.url }]] };
}
