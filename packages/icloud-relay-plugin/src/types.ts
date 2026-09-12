import { ID } from '@vendure/core';

export enum IcloudAccountStatus {
    ACTIVE = 'ACTIVE',
    DISABLED = 'DISABLED',
    AUTH_ERROR = 'AUTH_ERROR',
    SYNCING = 'SYNCING',
}

export enum IcloudVirtualEmailStatus {
    ACTIVE = 'ACTIVE',
    DISABLED = 'DISABLED',
}

export enum IcloudAuditResult {
    SUCCESS = 'SUCCESS',
    EXPIRED = 'EXPIRED',
    INVALID_CODE = 'INVALID_CODE',
    RATE_LIMITED = 'RATE_LIMITED',
}

export enum IcloudQueryTargetType {
    PRIMARY = 'PRIMARY',
    VIRTUAL = 'VIRTUAL',
}

export interface IcloudRelayPluginOptions {
    /**
     * Secret key used for encrypting iCloud app-specific passwords at rest.
     * If not provided, falls back to VENDURE_COOKIE_SECRET or default fallback.
     */
    encryptionKey?: string;
    /**
     * Automatic sync interval in seconds. Set to 0 to disable background cron sync.
     * Default: 120 seconds.
     */
    syncIntervalSeconds?: number;
    /**
     * Email retention period in days. Emails older than this will be pruned.
     * Default: 30 days (0 = keep forever).
     */
    retentionDays?: number;
    /**
     * Route prefix for public web query portal. Default: 'mail-query'
     */
    portalRoute?: string;
}

export interface CreatePrimaryAccountInput {
    email: string;
    appPassword: string;
    note?: string;
    imapHost?: string;
    imapPort?: number;
    codeResetIntervalDays?: number;
    masterQueryCode?: string;
}

export interface UpdatePrimaryAccountInput {
    id: ID;
    email?: string;
    appPassword?: string;
    note?: string;
    status?: IcloudAccountStatus;
    imapHost?: string;
    imapPort?: number;
    codeResetIntervalDays?: number;
    masterQueryCode?: string;
}

export interface CreateVirtualEmailInput {
    primaryAccountId: ID;
    aliasEmail: string;
    note?: string;
    buyerQueryCode?: string;
    codeResetIntervalDays?: number;
}

export interface BatchCreateVirtualEmailsInput {
    primaryAccountId: ID;
    /**
     * Multi-line or comma-separated emails. Lines can be formatted as:
     * email@privaterelay.appleid.com
     * email@privaterelay.appleid.com,note
     */
    rawInput: string;
    codeResetIntervalDays?: number;
}

export interface UpdateVirtualEmailInput {
    id: ID;
    aliasEmail?: string;
    note?: string;
    status?: IcloudVirtualEmailStatus;
    buyerQueryCode?: string;
    codeResetIntervalDays?: number;
}

export interface PublicMailItem {
    id: ID;
    virtualEmailId?: ID | null;
    fromAddress: string;
    fromName: string;
    subject: string;
    receivedAt: Date;
    extractedCode?: string | null;
    bodyText?: string | null;
    bodyHtml?: string | null;
    targetEmail: string;
}

export interface PublicMailQueryResult {
    success: boolean;
    message?: string;
    targetType?: IcloudQueryTargetType;
    aliasEmail?: string;
    primaryEmail?: string;
    codeExpiresAt?: Date | null;
    remainingDays?: number | null;
    totalEmails: number;
    items: PublicMailItem[];
    virtualEmailsList?: Array<{
        id: ID;
        aliasEmail: string;
        note?: string;
    }>;
}
