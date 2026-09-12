import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';

import { loggerCtx, RATE_LIMIT_LOCKOUT_MS, RATE_LIMIT_MAX_FAILED_ATTEMPTS } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudQueryAuditLog } from '../entities/icloud-query-audit-log.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';
import { IcloudAuditResult, IcloudQueryTargetType, PublicMailItem, PublicMailQueryResult } from '../types';

import { IcloudAccessCodeService } from './icloud-access-code.service';

@Injectable()
export class IcloudPublicQueryService {
    /** In-memory failed attempt tracker (IP -> { count, lastAttemptAt }) */
    private failedAttempts = new Map<string, { count: number; lastAttemptAt: number }>();

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly codeService: IcloudAccessCodeService,
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
        const code = queryCode.trim().toUpperCase();
        const auditRepo = this.connection.getRepository(ctx, IcloudQueryAuditLog);

        // 1. Rate limiting check
        const lockCheck = this.checkRateLimit(clientIp);
        if (lockCheck) {
            await this.recordAudit(
                auditRepo,
                code,
                null,
                null,
                clientIp,
                userAgent || null,
                IcloudAuditResult.RATE_LIMITED,
            );
            return {
                success: false,
                message: '查询过于频繁，请 15 分钟后再试。',
                totalEmails: 0,
                items: [],
            };
        }

        // 2. Try matching as Virtual Email buyer code
        const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
        const virtualMatch = await virtualRepo.findOne({
            where: { buyerQueryCode: code },
            relations: ['primaryAccount'],
        });

        if (virtualMatch) {
            // Check expiration
            if (this.codeService.isExpired(virtualMatch.codeExpiresAt)) {
                await this.recordAudit(
                    auditRepo,
                    code,
                    IcloudQueryTargetType.VIRTUAL,
                    String(virtualMatch.id),
                    clientIp,
                    userAgent || null,
                    IcloudAuditResult.EXPIRED,
                );
                return {
                    success: false,
                    message: '该查询码已过期，请联系客服获取最新查询码。',
                    totalEmails: 0,
                    items: [],
                };
            }

            // Fetch emails for this virtual email
            const mailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);
            const mails = await mailRepo.find({
                where: { virtualEmailId: virtualMatch.id },
                order: { receivedAt: 'DESC' },
                take: 100,
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

        // 3. Try matching as Primary Account master code
        const primaryRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
        const primaryMatch = await primaryRepo.findOne({
            where: { masterQueryCode: code },
        });

        if (primaryMatch) {
            if (this.codeService.isExpired(primaryMatch.codeExpiresAt)) {
                await this.recordAudit(
                    auditRepo,
                    code,
                    IcloudQueryTargetType.PRIMARY,
                    String(primaryMatch.id),
                    clientIp,
                    userAgent || null,
                    IcloudAuditResult.EXPIRED,
                );
                return {
                    success: false,
                    message: '该主查询码已过期，请联系管理员。',
                    totalEmails: 0,
                    items: [],
                };
            }

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

        // 4. Code not found
        this.recordFailedAttempt(clientIp);
        await this.recordAudit(
            auditRepo,
            code,
            null,
            null,
            clientIp,
            userAgent || null,
            IcloudAuditResult.INVALID_CODE,
        );

        return {
            success: false,
            message: '无效的查询码，请检查后重试。',
            totalEmails: 0,
            items: [],
        };
    }

    // ==========================================
    // Rate Limiting (in-memory, lightweight)
    // ==========================================

    private checkRateLimit(ip: string): boolean {
        const record = this.failedAttempts.get(ip);
        if (!record) return false;

        if (record.count >= RATE_LIMIT_MAX_FAILED_ATTEMPTS) {
            const elapsed = Date.now() - record.lastAttemptAt;
            if (elapsed < RATE_LIMIT_LOCKOUT_MS) {
                return true; // Still locked out
            }
            // Lockout expired, reset
            this.failedAttempts.delete(ip);
            return false;
        }
        return false;
    }

    private recordFailedAttempt(ip: string): void {
        const record = this.failedAttempts.get(ip) || { count: 0, lastAttemptAt: 0 };
        record.count += 1;
        record.lastAttemptAt = Date.now();
        this.failedAttempts.set(ip, record);
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
            extractedCode: mail.extractedCode,
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
