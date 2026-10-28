import { Inject, Injectable, Optional } from '@nestjs/common';
import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from '../constants';
import { IcloudQueryTargetType, IcloudRelayPluginOptions, PublicMailQueryResult } from '../types';

import { IcloudMailSanitizerService, mailPreviewHtml, mailTextHtml } from './icloud-mail-sanitizer.service';
import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_BODY_CHARACTERS = 120_000;
function retryAfterSeconds(value: string | null): number | undefined {
    if (!value?.trim()) return undefined;
    const raw = value.trim();
    const seconds = /^\d+$/.test(raw)
        ? Number(raw)
        : /^[A-Za-z]{3}, /.test(raw)
          ? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
          : NaN;
    return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 2_147_483_647 ? seconds : undefined;
}

const unavailable = (): PublicMailQueryResult => ({
    success: false,
    message: '邮箱查询服务暂时不可用，请稍后重试。',
    totalEmails: 0,
    items: [],
});

/** Uses the existing public buyer-code API. Mail credentials never leave the ID system. */
@Injectable()
export class IcloudManagedMailboxClient {
    constructor(
        private readonly sanitizer: IcloudMailSanitizerService,
        private readonly otpExtractor: IcloudOtpExtractorService,
        @Optional() @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS) private readonly options?: IcloudRelayPluginOptions,
    ) {}

    get enabled(): boolean {
        return !!this.options?.managedMailboxQueryUrl?.trim();
    }

    async query(queryCode: string): Promise<PublicMailQueryResult> {
        // BUY/MSTR codes are owned by Vendure. Never send them back to the ID proxy.
        if (!/^[A-Za-z0-9_-]{5,64}$/.test(queryCode) || /^(BUY|MSTR)-/i.test(queryCode)) {
            return { ...unavailable(), message: '无效的查询码，请检查后重试。' };
        }
        try {
            const url = new URL(this.options?.managedMailboxQueryUrl ?? '');
            if (
                url.protocol !== 'https:' ||
                url.username ||
                url.password ||
                url.search ||
                url.hash ||
                url.pathname !== '/api/public/mailbox/query'
            )
                return unavailable();
            const response = await fetch(url, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(20_000),
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'cache-control': 'no-store',
                },
                body: JSON.stringify({ queryCode, limit: 5 }),
            });
            if (!response.ok) {
                const retryAfter =
                    response.status === 429
                        ? retryAfterSeconds(response.headers.get('retry-after'))
                        : undefined;
                await response.body?.cancel();
                return {
                    ...unavailable(),
                    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
                    message:
                        response.status === 429
                            ? retryAfter !== undefined
                                ? `查询过于频繁，请 ${retryAfter} 秒后再试。`
                                : '查询过于频繁，请稍后重试。'
                            : response.status === 400
                              ? '查询码无效或已过期，请核对后重试。'
                              : unavailable().message,
                };
            }
            if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
                await response.body?.cancel();
                return unavailable();
            }
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
                for (;;) {
                    const next = await reader.read();
                    if (next.done) break;
                    bytes += next.value.byteLength;
                    if (bytes > MAX_RESPONSE_BYTES) {
                        await reader.cancel();
                        return unavailable();
                    }
                    chunks.push(next.value);
                }
            } finally {
                reader.releaseLock();
            }
            const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                success?: boolean;
                data?: { email?: unknown; items?: unknown };
            };
            const data = envelope.data;
            if (
                envelope.success !== true ||
                !data ||
                typeof data.email !== 'string' ||
                !Array.isArray(data.items) ||
                data.items.length > 5
            )
                return unavailable();
            const occurrences = new Map<string, number>();
            const items = await Promise.all(
                data.items.map(async (raw: unknown) => {
                    if (!raw || typeof raw !== 'object') throw new Error('Invalid mail result');
                    const mail = raw as Record<string, unknown>;
                    if (
                        typeof mail.body !== 'string' ||
                        mail.body.length > MAX_BODY_CHARACTERS ||
                        typeof mail.from !== 'string' ||
                        typeof mail.to !== 'string' ||
                        typeof mail.subject !== 'string' ||
                        typeof mail.savedAt !== 'string' ||
                        !Number.isFinite(Date.parse(mail.savedAt))
                    )
                        throw new Error('Invalid mail result');
                    const messageId = createHash('sha256')
                        .update(
                            JSON.stringify([
                                data.email,
                                mail.id,
                                mail.to,
                                mail.from,
                                mail.savedAt,
                                mail.subject,
                                mail.body,
                            ]),
                        )
                        .digest('hex')
                        .slice(0, 32);
                    const occurrence = (occurrences.get(messageId) ?? 0) + 1;
                    occurrences.set(messageId, occurrence);
                    const isHtml = /<(?:html|body|p|div|a|table|pre|br)\b/i.test(mail.body);
                    const bodyText = isHtml
                        ? ((
                              await simpleParser(
                                  'MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n' +
                                      mail.body,
                                  {
                                      skipTextToHtml: true,
                                      skipImageLinks: true,
                                      maxHtmlLengthToParse: MAX_BODY_CHARACTERS,
                                  },
                              )
                          ).text ?? '')
                        : mail.body;
                    return {
                        id: `managed-${messageId}-${occurrence}`,
                        virtualEmailId: null,
                        fromAddress: mail.from,
                        fromName: '',
                        subject: mail.subject,
                        receivedAt: new Date(mail.savedAt),
                        extractedCode: this.otpExtractor.extractCode(mail.subject, bodyText),
                        bodyText,
                        bodyHtml: mailPreviewHtml(
                            this.sanitizer.sanitize(isHtml ? mail.body : mailTextHtml(mail.body)),
                        ),
                        targetEmail: mail.to || (data.email as string),
                    };
                }),
            );
            return {
                success: true,
                targetType: IcloudQueryTargetType.MANAGED,
                aliasEmail: data.email,
                totalEmails: items.length,
                items,
            };
        } catch {
            // Do not echo capability codes, mail content or upstream error bodies.
            return unavailable();
        }
    }
}
