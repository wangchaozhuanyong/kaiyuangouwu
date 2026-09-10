import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { loggerCtx } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';
import { IcloudAccountStatus } from '../types';

import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudMailSanitizerService } from './icloud-mail-sanitizer.service';
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
        const virtualEmailRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const receivedMailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);

        let syncedCount = 0;

        try {
            await client.connect();
            const lock = await client.getMailboxLock('INBOX');

            try {
                // Fetch all virtual emails belonging to this primary account
                const virtualEmails = await virtualEmailRepo.find({
                    where: { primaryAccountId: account.id },
                });
                const virtualEmailMap = new Map<string, IcloudVirtualEmail>();
                for (const v of virtualEmails) {
                    virtualEmailMap.set(v.aliasEmail.toLowerCase().trim(), v);
                }

                // Search query: if lastSyncedUid > 0, fetch UID (lastSyncedUid + 1):*
                // Otherwise fetch the latest 50 messages
                let searchCriteria: any = '1:*';
                if (account.lastSyncedUid > 0) {
                    searchCriteria = { uid: `${account.lastSyncedUid + 1}:*` };
                }

                const messagesToProcess: Array<{ uid: number; source: Buffer }> = [];
                for await (const message of client.fetch(searchCriteria, {
                    source: true,
                    uid: true,
                })) {
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

                        // Check if mail already exists in DB
                        const existing = await receivedMailRepo.findOne({
                            where: { primaryAccountId: account.id, messageId },
                        });
                        if (existing) {
                            continue;
                        }

                        // Multi-level recipient sniffing
                        const recipientCandidates = this.extractRecipientCandidates(parsed);

                        // Find matching virtual email
                        let matchedVirtualEmail: IcloudVirtualEmail | null = null;
                        for (const candidate of recipientCandidates) {
                            const found = virtualEmailMap.get(candidate);
                            if (found) {
                                matchedVirtualEmail = found;
                                break;
                            }
                        }

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

                        await receivedMailRepo.save(newMail);
                        syncedCount++;

                        // Update virtual email counter
                        if (matchedVirtualEmail) {
                            matchedVirtualEmail.mailCount += 1;
                            matchedVirtualEmail.lastMailReceivedAt = receivedAt;
                            await virtualEmailRepo.save(matchedVirtualEmail);
                        }
                    } catch (parseErr: any) {
                        Logger.error(`Failed to parse email UID ${item.uid}: ${parseErr.message}`, loggerCtx);
                    }
                }

                // Update account sync state
                account.lastSyncedUid = maxUid;
                account.lastSyncedAt = new Date();
                account.status = IcloudAccountStatus.ACTIVE;
                account.lastSyncError = null;
                await primaryAccountRepo.save(account);

                return { success: true, syncedCount };
            } finally {
                lock.release();
                await client.logout();
            }
        } catch (err: any) {
            Logger.error(`IMAP sync error for ${account.email}: ${err.message}`, loggerCtx);
            account.status = IcloudAccountStatus.AUTH_ERROR;
            account.lastSyncError = err.message;
            await primaryAccountRepo.save(account);
            return { success: false, syncedCount, error: err.message };
        }
    }

    /**
     * Multi-level header resolution algorithm:
     * 1. Check To addresses
     * 2. Check Cc addresses
     * 3. Check Delivered-To, X-Original-To, Envelope-To
     * 4. Check Apple-specific relay headers
     * 5. Scan Received headers for 'for <...>'
     */
    private extractRecipientCandidates(parsed: any): string[] {
        const candidates = new Set<string>();

        const addCandidate = (addr: string | undefined | null) => {
            if (!addr) return;
            const cleaned = addr.toLowerCase().trim();
            if (cleaned.includes('@')) {
                candidates.add(cleaned);
            }
        };

        // 1. To addresses
        if (parsed.to) {
            const list = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
            for (const item of list) {
                if (item.value) {
                    for (const v of item.value) {
                        addCandidate(v.address);
                    }
                }
            }
        }

        // 2. Cc addresses
        if (parsed.cc) {
            const list = Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc];
            for (const item of list) {
                if (item.value) {
                    for (const v of item.value) {
                        addCandidate(v.address);
                    }
                }
            }
        }

        // 3. Headers inspection
        const headers = parsed.headers;
        if (headers) {
            const deliveredTo = headers.get('delivered-to');
            if (typeof deliveredTo === 'string') addCandidate(deliveredTo);

            const xOriginalTo = headers.get('x-original-to');
            if (typeof xOriginalTo === 'string') addCandidate(xOriginalTo);

            const envelopeTo = headers.get('envelope-to');
            if (typeof envelopeTo === 'string') addCandidate(envelopeTo);

            const appleAlias = headers.get('x-apple-alias-address');
            if (typeof appleAlias === 'string') addCandidate(appleAlias);

            // 4. Scan Received headers
            const receivedHeaders = headers.get('received');
            if (receivedHeaders) {
                const lines = Array.isArray(receivedHeaders) ? receivedHeaders : [receivedHeaders];
                for (const line of lines) {
                    if (typeof line === 'string') {
                        const match = line.match(/for\s+<([^>]+)>/i);
                        if (match && match[1]) {
                            addCandidate(match[1]);
                        }
                    }
                }
            }
        }

        return Array.from(candidates);
    }
}
