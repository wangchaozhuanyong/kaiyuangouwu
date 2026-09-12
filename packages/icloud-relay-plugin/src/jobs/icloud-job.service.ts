import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { LessThan, MoreThan } from 'typeorm';

import { ICLOUD_RELAY_PLUGIN_OPTIONS, loggerCtx } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudReceivedMail } from '../entities/icloud-received-mail.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';
import { IcloudAccessCodeService } from '../services/icloud-access-code.service';
import { IcloudImapSyncService } from '../services/icloud-imap-sync.service';
import { updateIcloudRecord } from '../services/icloud-record-update';
import { IcloudAccountStatus, IcloudRelayPluginOptions } from '../types';

/**
 * Background job handler for scheduled tasks:
 * 1. Periodic IMAP sync
 * 2. Query code auto-rotation
 * 3. Old email retention/cleanup
 */
@Injectable()
export class IcloudJobService implements OnModuleInit {
    private syncTimer: ReturnType<typeof setInterval> | null = null;
    private codeRotationTimer: ReturnType<typeof setInterval> | null = null;
    private retentionTimer: ReturnType<typeof setInterval> | null = null;
    private readonly syncIntervalMs: number;
    private readonly retentionDays: number;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly imapSyncService: IcloudImapSyncService,
        private readonly codeService: IcloudAccessCodeService,
        @Optional()
        @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS)
        private readonly options?: IcloudRelayPluginOptions,
    ) {
        const syncSeconds = options?.syncIntervalSeconds ?? 120;
        this.syncIntervalMs = syncSeconds > 0 ? syncSeconds * 1000 : 0;
        this.retentionDays = options?.retentionDays ?? 30;
    }

    onModuleInit() {
        // 1. Start periodic IMAP sync
        if (this.syncIntervalMs > 0) {
            Logger.info(`iCloud IMAP 定时同步已启用, 周期: ${this.syncIntervalMs / 1000}s`, loggerCtx);
            this.syncTimer = setInterval(() => {
                void this.runImapSync();
            }, this.syncIntervalMs);
        }

        // 2. Code rotation check every hour
        this.codeRotationTimer = setInterval(
            () => {
                void this.runCodeRotation();
            },
            60 * 60 * 1000,
        );

        // 3. Email retention cleanup every 6 hours
        if (this.retentionDays > 0) {
            this.retentionTimer = setInterval(
                () => {
                    void this.runRetentionCleanup();
                },
                6 * 60 * 60 * 1000,
            );
        }
    }

    onModuleDestroy() {
        if (this.syncTimer) clearInterval(this.syncTimer);
        if (this.codeRotationTimer) clearInterval(this.codeRotationTimer);
        if (this.retentionTimer) clearInterval(this.retentionTimer);
    }

    // ==========================================
    // Job 1: Periodic IMAP Sync
    // ==========================================
    private async runImapSync(): Promise<void> {
        try {
            const ctx = RequestContext.empty();
            const repo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
            const activeAccounts = await repo.find({
                where: { status: IcloudAccountStatus.ACTIVE },
            });

            Logger.verbose(`iCloud 定时同步: 发现 ${activeAccounts.length} 个活跃主邮箱`, loggerCtx);

            for (const account of activeAccounts) {
                try {
                    const result = await this.imapSyncService.syncAccount(ctx, account);
                    if (result.syncedCount > 0) {
                        Logger.info(
                            `iCloud 同步 ${account.email}: 新增 ${result.syncedCount} 封邮件`,
                            loggerCtx,
                        );
                    }
                } catch (err: any) {
                    Logger.error(`iCloud 同步异常 ${account.email}: ${err.message}`, loggerCtx);
                }
            }
        } catch (err: any) {
            Logger.error(`iCloud 批量同步任务异常: ${err.message}`, loggerCtx);
        }
    }

    // ==========================================
    // Job 2: Query Code Auto-Rotation
    // ==========================================
    private async runCodeRotation(): Promise<void> {
        try {
            const ctx = RequestContext.empty();
            const now = new Date();

            // Rotate expired primary account master codes
            const primaryRepo = this.connection.getRepository(ctx, IcloudPrimaryAccount);
            const allPrimaries = await primaryRepo.find({
                where: {
                    codeExpiresAt: LessThan(now),
                    codeResetIntervalDays: MoreThan(0),
                },
            });
            for (const account of allPrimaries) {
                if (
                    account.codeResetIntervalDays > 0 &&
                    account.codeExpiresAt &&
                    new Date(account.codeExpiresAt) < now
                ) {
                    const changed = await updateIcloudRecord(
                        primaryRepo,
                        account,
                        {
                            masterQueryCode: this.codeService.generateCode('MSTR'),
                            codeExpiresAt: this.codeService.calculateExpiration(
                                account.codeResetIntervalDays,
                            ),
                        },
                        ['masterQueryCode', 'codeExpiresAt', 'codeResetIntervalDays'],
                        'skip',
                    );
                    if (!changed) continue;
                    Logger.info(`主邮箱 ${account.email} 查询码已自动重置`, loggerCtx);
                }
            }

            // Rotate expired virtual email buyer codes
            const virtualRepo = this.connection.getRepository(ctx, IcloudVirtualEmail);
            const allVirtuals = await virtualRepo.find({
                where: { codeExpiresAt: LessThan(now), codeResetIntervalDays: MoreThan(0) },
            });
            for (const virtual of allVirtuals) {
                if (
                    virtual.codeResetIntervalDays > 0 &&
                    virtual.codeExpiresAt &&
                    new Date(virtual.codeExpiresAt) < now
                ) {
                    const changed = await updateIcloudRecord(
                        virtualRepo,
                        virtual,
                        {
                            buyerQueryCode: this.codeService.generateCode('BUY'),
                            codeExpiresAt: this.codeService.calculateExpiration(
                                virtual.codeResetIntervalDays,
                            ),
                        },
                        ['buyerQueryCode', 'codeExpiresAt', 'codeResetIntervalDays'],
                        'skip',
                    );
                    if (!changed) continue;
                    Logger.verbose(`虚拟邮箱 ${virtual.aliasEmail} 查询码已自动重置`, loggerCtx);
                }
            }
        } catch (err: any) {
            Logger.error(`查询码自动轮转任务异常: ${err.message}`, loggerCtx);
        }
    }

    // ==========================================
    // Job 3: Email Retention Cleanup
    // ==========================================
    private async runRetentionCleanup(): Promise<void> {
        if (this.retentionDays <= 0) return;

        try {
            const ctx = RequestContext.empty();
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - this.retentionDays);

            const mailRepo = this.connection.getRepository(ctx, IcloudReceivedMail);
            const result = await mailRepo.delete({
                receivedAt: LessThan(cutoff),
            });

            if (result.affected && result.affected > 0) {
                Logger.info(
                    `邮件保留策略: 已清理 ${result.affected} 封超过 ${this.retentionDays} 天的旧邮件`,
                    loggerCtx,
                );
            }
        } catch (err: any) {
            Logger.error(`邮件清理任务异常: ${err.message}`, loggerCtx);
        }
    }
}
