import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';

import { loggerCtx, RATE_LIMIT_LOCKOUT_MS, RATE_LIMIT_MAX_FAILED_ATTEMPTS } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudQueryAuditLog } from '../entities/icloud-query-audit-log.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';
import {
    IcloudAccountStatus,
    IcloudAuditResult,
    IcloudQueryTargetType,
    PublicMailItem,
    PublicMailQueryResult,
} from '../types';

import { IcloudAccessCodeService } from './icloud-access-code.service';
import { IcloudOtpExtractorService } from './icloud-otp-extractor.service';

const MAX_FAILED_IP_RECORDS = 10_000;
const FAILED_IP_CLEANUP_INTERVAL_MS = 60_000;
const rateLimitMessage = '查询过于频繁，请 15 分钟后再试。';

@Injectable()
export class IcloudPublicQueryService {
    /** In-memory failed attempt tracker (IP -> { count, lastAttemptAt }) */
    private failedAttempts = new Map<string, { count: number; lastAttemptAt: number }>();
    private nextFailedAttemptCleanupAt = 0;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly codeService: IcloudAccessCodeService,
        private readonly otpExtractor: IcloudOtpExtractorService,
    ) {}

    /**
     * Public query: given a query code and client IP, return matched emails
     */
    async queryByCode(
        ctx: RequestContext,
        queryCode: string,
        clientIp: string,
        userAgent?: string,
    ): Promise<PublicMailQueryResult> {
        const target = await this.authorizeQueryTarget(ctx, queryCode, clientIp, userAgent);
        if (target.error) return { success: false, message: target.error, totalEmails: 0, items: [] };
        const code = queryCode.trim().toUpperCase();
        const auditRepo = this.connection.getRepository(ctx, IcloudQueryAuditLog);
        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const primaryRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const virtualMatch = target.virtual;
        const primaryMatch = target.primary;
        if (virtualMatch) {
            // Fetch emails for this virtual email
            const mailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);
            const mails = await mailRepo.find({
                where: { virtualEmailId: virtualMatch.id },
                order: { receivedAt: 'DESC', id: 'DESC' },
                take: 5,
            });

            // Update query tracking
            await virtualRepo.update(
                { id: virtualMatch.id },
                { lastQueriedAt: new Date(), lastQueriedIp: clientIp },
            );

            // Reset failed attempts on success
            this.failedAttempts.delete(clientIp);

            await this.recordAudit(
                auditRepo,
                code,
                IcloudQueryTargetType.VIRTUAL,
                String(virtualMatch.id),
                clientIp,
                userAgent || null,
                IcloudAuditResult.SUCCESS,
            );

            return {
                success: true,
                targetType: IcloudQueryTargetType.VIRTUAL,
                aliasEmail: this.maskEmail(virtualMatch.aliasEmail),
                codeExpiresAt: virtualMatch.codeExpiresAt,
                remainingDays: this.codeService.getRemainingDays(virtualMatch.codeExpiresAt),
                totalEmails: mails.length,
                items: mails.map(m => this.toPublicMailItem(m, virtualMatch.aliasEmail)),
            };
        }
        if (primaryMatch) {
            // Fetch all emails for this primary account
            const mailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);
            const mails = await mailRepo.find({
                where: { primaryAccountId: primaryMatch.id },
                order: { receivedAt: 'DESC' },
                take: 200,
            });

            // Fetch virtual emails list for filtering
            const virtuals = await virtualRepo.find({
                where: { primaryAccountId: primaryMatch.id },
                select: ['id', 'aliasEmail', 'note'],
            });

            const aliasById = new Map(virtuals.map(v => [String(v.id), v.aliasEmail]));

            // Update query tracking
            await primaryRepo.update(
                { id: primaryMatch.id },
                { lastQueriedAt: new Date(), lastQueriedIp: clientIp },
            );

            this.failedAttempts.delete(clientIp);

            await this.recordAudit(
                auditRepo,
                code,
                IcloudQueryTargetType.PRIMARY,
                String(primaryMatch.id),
                clientIp,
                userAgent || null,
                IcloudAuditResult.SUCCESS,
            );

            return {
                success: true,
                targetType: IcloudQueryTargetType.PRIMARY,
                primaryEmail: this.maskEmail(primaryMatch.email),
                codeExpiresAt: primaryMatch.codeExpiresAt,
                remainingDays: this.codeService.getRemainingDays(primaryMatch.codeExpiresAt),
                totalEmails: mails.length,
                items: mails.map(m =>
                    this.toPublicMailItem(m, aliasById.get(String(m.virtualEmailId)) || primaryMatch.email),
                ),
                virtualEmailsList: virtuals.map(v => ({
                    id: v.id,
                    aliasEmail: this.maskEmail(v.aliasEmail),
                    note: v.note || undefined,
                })),
            };
        }
        return { success: false, message: '无效的查询码，请检查后重试。', totalEmails: 0, items: [] };
    }

    /** Shared authorization for public reads and subscriptions. Does not read mail. */
    async authorizeQueryTarget(
        ctx: RequestContext,
        queryCode: string,
        clientIp: string,
        userAgent?: string,
    ): Promise<{
        virtual?: IcloudVirtualEmail;
        primary?: IcloudPrimaryAccount;
        error?: string;
    }> {
        const code = queryCode.trim().toUpperCase();
        const auditRepo = this.connection.getRepository(ctx, IcloudQueryAuditLog);
        if (this.checkRateLimit(clientIp)) {
            await this.recordAudit(
                auditRepo,
                code,
                null,
                null,
                clientIp,
                userAgent ?? null,
                IcloudAuditResult.RATE_LIMITED,
            );
            return { error: rateLimitMessage };
        }
        const virtual = await this.connection.getRepository(ctx, IcloudVirtualEmail).findOne({
            where: { buyerQueryCode: code },
            relations: ['primaryAccount'],
        });
        const primary = virtual
            ? undefined
            : ((await this.connection
                  .getRepository(ctx, IcloudPrimaryAccount)
                  .findOne({ where: { masterQueryCode: code } })) ?? undefined);
        const match = virtual ?? primary;
        if (!match) {
            // Other requests can fill the tracker or lock this source while the lookups are pending.
            const recorded = this.recordFailedAttempt(clientIp);
            await this.recordAudit(
                auditRepo,
                code,
                null,
                null,
                clientIp,
                userAgent ?? null,
                recorded ? IcloudAuditResult.INVALID_CODE : IcloudAuditResult.RATE_LIMITED,
            );
            return { error: recorded ? '无效的查询码，请检查后重试。' : rateLimitMessage };
        }
        const type = virtual ? IcloudQueryTargetType.VIRTUAL : IcloudQueryTargetType.PRIMARY;
        if (
            match.status === IcloudAccountStatus.DISABLED ||
            virtual?.primaryAccount?.status === IcloudAccountStatus.DISABLED
        ) {
            await this.recordAudit(
                auditRepo,
                code,
                type,
                String(match.id),
                clientIp,
                userAgent ?? null,
                IcloudAuditResult.DISABLED,
            );
            return { error: virtual ? '该邮箱已禁用，请联系客服。' : '该主邮箱已禁用，请联系管理员。' };
        }
        if (this.codeService.isExpired(match.codeExpiresAt)) {
            await this.recordAudit(
                auditRepo,
                code,
                type,
                String(match.id),
                clientIp,
                userAgent ?? null,
                IcloudAuditResult.EXPIRED,
            );
            return {
                error: virtual
                    ? '该查询码已过期，请联系客服获取最新查询码。'
                    : '该主查询码已过期，请联系管理员。',
            };
        }
        this.failedAttempts.delete(clientIp);
        return { virtual: virtual ?? undefined, primary };
    }

    // ==========================================
    // Rate Limiting (in-memory, lightweight)
    // ==========================================

    private checkRateLimit(ip: string): boolean {
        const now = Date.now();
        this.pruneFailedAttempts(now);
        const record = this.currentFailedAttempt(ip, now);
        // At capacity, fail closed for untracked sources rather than evicting an effective lockout.
        return record
            ? record.count >= RATE_LIMIT_MAX_FAILED_ATTEMPTS
            : this.failedAttempts.size >= MAX_FAILED_IP_RECORDS;
    }

    private recordFailedAttempt(ip: string): boolean {
        const now = Date.now();
        this.pruneFailedAttempts(now);
        const record = this.currentFailedAttempt(ip, now);
        if (
            (record && record.count >= RATE_LIMIT_MAX_FAILED_ATTEMPTS) ||
            (!record && this.failedAttempts.size >= MAX_FAILED_IP_RECORDS)
        ) {
            return false;
        }
        this.failedAttempts.set(ip, { count: (record?.count ?? 0) + 1, lastAttemptAt: now });
        return true;
    }

    private currentFailedAttempt(ip: string, now: number) {
        const record = this.failedAttempts.get(ip);
        if (record && now - record.lastAttemptAt >= RATE_LIMIT_LOCKOUT_MS) {
            this.failedAttempts.delete(ip);
            return undefined;
        }
        return record;
    }

    private pruneFailedAttempts(now: number): void {
        if (now < this.nextFailedAttemptCleanupAt) return;
        this.nextFailedAttemptCleanupAt = now + FAILED_IP_CLEANUP_INTERVAL_MS;
        // Both the scan frequency and its maximum work are bounded; no per-IP timers are retained.
        for (const [ip, record] of this.failedAttempts) {
            if (now - record.lastAttemptAt >= RATE_LIMIT_LOCKOUT_MS) this.failedAttempts.delete(ip);
        }
    }

    // ==========================================
    // Audit & Helpers
    // ==========================================

    private async recordAudit(
        repo: any,
        queryCode: string,
        targetType: IcloudQueryTargetType | null,
        targetId: string | null,
        ipAddress: string,
        userAgent: string | null,
        result: IcloudAuditResult,
    ): Promise<void> {
        try {
            const log = new IcloudQueryAuditLog({
                queryCode: queryCode.substring(0, 64),
                targetType: targetType || null,
                targetId: targetId || null,
                ipAddress,
                userAgent,
                result,
                queriedAt: new Date(),
            });
            await repo.save(log);
        } catch (err: any) {
            Logger.error(`Failed to write audit log: ${err.message}`, loggerCtx);
        }
    }

    private toPublicMailItem(mail: IcloudReceivedMail, targetEmail: string): PublicMailItem {
        return {
            id: mail.id,
            virtualEmailId: mail.virtualEmailId,
            fromAddress: mail.fromAddress,
            fromName: mail.fromName,
            subject: mail.subject,
            receivedAt: mail.receivedAt,
            // Recompute on read so historical extraction errors do not reach the copy button.
            extractedCode: this.otpExtractor.extractCode(mail.subject, mail.bodyText || ''),
            bodyText: mail.bodyText,
            bodyHtml: mail.bodyHtml,
            targetEmail: this.maskEmail(targetEmail),
        };
    }

    /**
     * Mask email for public display: "abc***@privaterelay.appleid.com"
     */
    private maskEmail(email: string): string {
        if (!email) return '***';
        const [local, domain] = email.split('@');
        if (!local || !domain) return '***';
        const visible = local.substring(0, Math.min(3, local.length));
        return `${visible}***@${domain}`;
    }
}
