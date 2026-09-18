import { BaseDomainApi } from './base-domain-api';

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
