import type { MailStreamCallbacks } from './mail-events';

import { BaseDomainApi } from './base-domain-api';
import { SEND_CLIENT_CHANNEL_TOKEN } from './helpers';

export interface IcloudMailItem {
    id: string;
    fromAddress: string;
    fromName: string;
    subject: string;
    receivedAt: string;
    extractedCode: string | null;
    bodyText: string;
    bodyHtml: string;
    targetEmail: string;
    virtualEmailId: string | null;
}

export interface IcloudVirtualEmailItem {
    id: string;
    aliasEmail: string;
    note: string | null;
}

export interface IcloudQueryResult {
    success: boolean;
    message: string | null;
    targetType: string;
    aliasEmail: string | null;
    primaryEmail: string | null;
    codeExpiresAt: string | null;
    remainingDays: number | null;
    totalEmails: number;
    items: IcloudMailItem[];
    virtualEmailsList: IcloudVirtualEmailItem[];
}

export class MailQueryApi extends BaseDomainApi {
    async watchMailEvents(code: string, callbacks: MailStreamCallbacks, signal: AbortSignal): Promise<void> {
        const headers: Record<string, string> = {};
        if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
        if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
        const { watchMailEvents } = await import('./mail-events');
        return watchMailEvents(code, headers, callbacks, signal);
    }

    async queryMails(code: string, signal?: AbortSignal): Promise<IcloudQueryResult> {
        const result = await this.request<{ icloudQueryMails: IcloudQueryResult }>(
            `
                query QueryMails($code: String!) {
                    icloudQueryMails(queryCode: $code) {
                        success
                        message
                        targetType
                        aliasEmail
                        primaryEmail
                        codeExpiresAt
                        remainingDays
                        totalEmails
                        items {
                            id
                            fromAddress
                            fromName
                            subject
                            receivedAt
                            extractedCode
                            bodyText
                            bodyHtml
                            targetEmail
                            virtualEmailId
                        }
                        virtualEmailsList {
                            id
                            aliasEmail
                            note
                        }
                    }
                }
            `,
            { code },
            signal,
        );
        return result.icloudQueryMails;
    }
}
