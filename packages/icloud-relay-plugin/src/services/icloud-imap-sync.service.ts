import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { LessThan } from 'typeorm';

import { loggerCtx } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';
import { IcloudAccountStatus } from '../types';

import { IcloudCipherService } from './icloud-cipher.service';
import { extractMailRecipients, matchMailRecipient, RECIPIENT_HEADERS } from './icloud-mail-recipients';
import { IcloudMailSanitizerService } from './icloud-mail-sanitizer.service';
import { lockMailAccount, refreshMailCounts } from './icloud-mail-storage';
import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';

export interface TestConnectionResult {
    success: boolean;
    message: string;
}

export interface SyncAccountResult {
    success: boolean;
    syncedCount: number;
    error?: string;
}

export function isIcloudAuthenticationFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const failure = error as {
        authenticationFailed?: unknown;
        serverResponseCode?: unknown;
    };
    return (
        failure.authenticationFailed === true ||
        (typeof failure.serverResponseCode === 'string' &&
            failure.serverResponseCode.toUpperCase() === 'AUTHENTICATIONFAILED')
    );
}

@Injectable()
export class IcloudImapSyncService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: IcloudCipherService,
        private readonly otpExtractor: IcloudOtpExtractorService,
        private readonly sanitizer: IcloudMailSanitizerService,
    ) {}

    /**
     * Test IMAP connection for an iCloud primary account
     */
    async testConnection(
        account: IcloudPrimaryAccount,
        plainPasswordOverride?: string,
    ): Promise<TestConnectionResult> {
        const plainPassword = plainPasswordOverride || this.cipher.decrypt(account.encryptedAppPassword);
        if (!plainPassword) {
            return { success: false, message: '专用密码未配置或解密失败' };
        }

        const client = new ImapFlow({
            host: account.imapHost || 'imap.mail.me.com',
            port: account.imapPort || 993,
            secure: true,
            auth: {
                user: account.email,
                pass: plainPassword,
            },
            logger: false,
        });

        try {
            await client.connect();
            const lock = await client.getMailboxLock('INBOX');
            lock.release();
            await client.logout();
            return { success: true, message: 'iCloud IMAP 连接测试成功！收件箱访问正常。' };
        } catch (err: any) {
            Logger.warn(`iCloud IMAP connection test failed for ${account.email}: ${err.message}`, loggerCtx);
            return {
                success: false,
                message: `IMAP 连接失败: ${err.message || '请确认 Apple ID 与 App 专用密码是否有效'}`,
            };
        }
    }

    /**
     * Synchronize emails from iCloud IMAP for a primary account
     */
    async syncAccount(ctx: RequestContext, account: IcloudPrimaryAccount): Promise<SyncAccountResult> {
        const plainPassword = this.cipher.decrypt(account.encryptedAppPassword);
        if (!plainPassword) {
            return { success: false, syncedCount: 0, error: '专用密码解密失败' };
        }

        const client = new ImapFlow({
            host: account.imapHost || 'imap.mail.me.com',
            port: account.imapPort || 993,
            secure: true,
            auth: {
                user: account.email,
                pass: plainPassword,
            },
            logger: false,
        });

        const primaryAccountRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);

        let syncedCount = 0;

        try {
            await client.connect();
            const lock = await client.getMailboxLock('INBOX');

            try {
                const range = account.lastSyncedUid > 0 ? `${account.lastSyncedUid + 1}:*` : '1:*';

                const messagesToProcess: Array<{ uid: number; source: Buffer }> = [];
                for await (const message of client.fetch(
                    range,
                    {
                        source: true,
                        uid: true,
                    },
                    { uid: true },
                )) {
                    if (message.uid <= account.lastSyncedUid) {
                        continue;
                    }
                    if (message.source) {
                        messagesToProcess.push({ uid: message.uid, source: message.source });
                    }
                }

                let maxUid = account.lastSyncedUid;

                for (const item of messagesToProcess) {
                    maxUid = Math.max(maxUid, item.uid);
                    try {
                        const parsed = await simpleParser(item.source);
                        const messageId =
                            parsed.messageId || `<icloud-${account.id}-${item.uid}-${Date.now()}@relay>`;

                        const recipientCandidates = extractMailRecipients(parsed);
                        // Subject & Body extraction
                        const subject = parsed.subject || '(无主题)';
                        const bodyText = parsed.text || '';
                        const rawHtml = parsed.html || (bodyText ? `<pre>${bodyText}</pre>` : '');
                        const sanitizedHtml = this.sanitizer.sanitize(rawHtml);

                        // Smart OTP Extraction
                        const extractedCode = this.otpExtractor.extractCode(subject, bodyText);

                        const receivedAt = parsed.date || new Date();
                        const fromAddress = parsed.from?.value?.[0]?.address || 'unknown@sender.com';
                        const fromName = parsed.from?.value?.[0]?.name || '';

                        const inserted = await this.connection.withTransaction(ctx, async transactionCtx => {
                            await lockMailAccount(transactionCtx, this.connection, account.id);
                            const mails = this.connection.getRepository(transactionCtx, IcloudReceivedMail);
                            if (await mails.findOne({ where: { primaryAccountId: account.id, messageId } }))
                                return false;
                            const virtuals = await this.connection
                                .getRepository(transactionCtx, IcloudVirtualEmail)
                                .find({
                                    where: { primaryAccountId: account.id },
                                });
                            const matchedVirtualEmail = matchMailRecipient(
                                recipientCandidates,
                                virtuals,
                                account.id,
                            ).match;
                            const newMail = new IcloudReceivedMail({
                                primaryAccountId: account.id,
                                virtualEmailId: matchedVirtualEmail?.id || null,
                                messageId,
                                imapUid: item.uid,
                                fromAddress,
                                fromName,
                                toAddressesJson: JSON.stringify(recipientCandidates),
                                subject,
                                bodyHtml: sanitizedHtml,
                                bodyText,
                                extractedCode,
                                receivedAt,
                                isRead: false,
                                isStarred: false,
                            });

                            await mails.save(newMail);
                            if (matchedVirtualEmail)
                                await refreshMailCounts(transactionCtx, this.connection, account.id, [
                                    matchedVirtualEmail.id,
                                ]);
                            return true;
                        });
                        if (inserted) syncedCount++;
                    } catch (parseErr: any) {
                        Logger.error(`Failed to parse email UID ${item.uid}: ${parseErr.message}`, loggerCtx);
                    }
                }

                // Update account sync state
                // Sync owns only sync fields. Never restore stale credentials, notes or codes.
                await primaryAccountRepo.update(
                    { id: account.id, lastSyncedUid: LessThan(maxUid) },
                    { lastSyncedUid: maxUid },
                );
                await primaryAccountRepo.update({ id: account.id }, { lastSyncedAt: new Date() });
                if (account.status !== IcloudAccountStatus.DISABLED)
                    await primaryAccountRepo.update(
                        {
                            id: account.id,
                            status: account.status,
                            encryptedAppPassword: account.encryptedAppPassword,
                            imapHost: account.imapHost,
                            imapPort: account.imapPort,
                        },
                        { status: IcloudAccountStatus.ACTIVE, lastSyncError: null },
                    );

                return { success: true, syncedCount };
            } finally {
                lock.release();
                await client.logout();
            }
        } catch (err: any) {
            Logger.error(`IMAP sync error for ${account.email}: ${err.message}`, loggerCtx);
            if (account.status !== IcloudAccountStatus.DISABLED)
                await primaryAccountRepo.update(
                    {
                        id: account.id,
                        status: account.status,
                        encryptedAppPassword: account.encryptedAppPassword,
                        imapHost: account.imapHost,
                        imapPort: account.imapPort,
                    },
                    {
                        status: isIcloudAuthenticationFailure(err)
                            ? IcloudAccountStatus.AUTH_ERROR
                            : account.status,
                        lastSyncError: err.message,
                    },
                );
            return { success: false, syncedCount, error: err.message };
        }
    }

    /** Read only the original recipient headers. A reused UID must never reassign a different message. */
    async readRecipientHeaders(
        account: IcloudPrimaryAccount,
        mails: IcloudReceivedMail[],
    ): Promise<Map<string, string[]>> {
        const recovered = new Map<string, string[]>();
        const password = this.cipher.decrypt(account.encryptedAppPassword);
        if (!password) return recovered;
        const client = new ImapFlow({
            host: account.imapHost || 'imap.mail.me.com',
            port: account.imapPort || 993,
            secure: true,
            auth: { user: account.email, pass: password },
            logger: false,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
        });
        try {
            await client.connect();
            const lock = await client.getMailboxLock('INBOX', { readOnly: true });
            try {
                for (const mail of mails) {
                    if (mail.imapUid <= 0 || !mail.messageId) continue;
                    const message = await client.fetchOne(
                        String(mail.imapUid),
                        { uid: true, headers: RECIPIENT_HEADERS },
                        { uid: true },
                    );
                    if (!message || message.uid !== mail.imapUid || !message.headers) continue;
                    const parsed = await simpleParser(message.headers);
                    if (!parsed.messageId || parsed.messageId.trim() !== mail.messageId.trim()) continue;
                    recovered.set(String(mail.id), extractMailRecipients(parsed));
                }
            } finally {
                lock.release();
            }
        } catch {
            // Missing/unverifiable headers remain unresolved; never publish IMAP credentials or raw errors.
        } finally {
            await client.logout().catch(() => client.close());
        }
        return recovered;
    }
}
