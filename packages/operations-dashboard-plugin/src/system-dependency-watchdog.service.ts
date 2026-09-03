import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ProcessContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

import { AdminNotificationConfigService } from './admin-notification-config.service';
import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { AdminNotificationRuntime } from './entities/admin-notification-runtime.entity';
import { TelegramClient } from './telegram-client';

const LOGGER_CTX = 'SystemDependencyWatchdog';
const INTERVAL_MS = 30_000;
const COOLDOWN_MS = 30 * 60_000;
const PIPELINE_LAG_MS = 5 * 60_000;
const WORKER_STALE_MS = 90_000;

@Injectable()
export class SystemDependencyWatchdog implements OnApplicationBootstrap, OnApplicationShutdown {
    private timer: ReturnType<typeof setInterval> | undefined;
    private consecutiveFailures = 0;
    private consecutiveSuccesses = 0;
    private incidentActive = false;
    private lastDatabaseSentAt = 0;
    private pipelineFailures = 0;
    private pipelineSuccesses = 0;
    private pipelineIncidentActive = false;
    private lastPipelineSentAt = 0;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly processContext: ProcessContext,
        private readonly configService: AdminNotificationConfigService,
        private readonly telegram: TelegramClient,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        // Keep the watchdog on the API process so it can still report a stopped worker.
        if (!this.processContext.isServer) return;
        await this.configService.get().catch(() => null);
        this.timer = setInterval(() => {
            void this.check().catch(error =>
                Logger.error(`依赖监控执行失败：${safeError(error)}`, undefined, LOGGER_CTX),
            );
        }, INTERVAL_MS);
        this.timer.unref?.();
    }

    onApplicationShutdown(): void {
        if (this.timer) clearInterval(this.timer);
    }

    async check(): Promise<void> {
        const healthy = await this.databaseAvailable();
        if (healthy) {
            this.consecutiveFailures = 0;
            this.consecutiveSuccesses += 1;
            if (this.incidentActive && this.consecutiveSuccesses >= 2) {
                await this.sendEmergency(
                    '✅ [已恢复][TECH] 数据库连接恢复\n\n责任部门：网站技术与自动化部\n协作部门：数据财务与经营分析部、质量合规安全与 AI 治理部',
                );
                this.incidentActive = false;
            }
            await this.checkNotificationPipeline();
            return;
        }
        this.consecutiveSuccesses = 0;
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures < 2) return;
        const repeatDue = !this.lastDatabaseSentAt || Date.now() - this.lastDatabaseSentAt >= COOLDOWN_MS;
        if (!this.incidentActive || repeatDue) {
            if (
                await this.sendEmergency(
                    '🚨 [P0][TECH] 数据库连接中断\n\n责任部门：网站技术与自动化部\n协作部门：数据财务与经营分析部、质量合规安全与 AI 治理部\n升级部门：AI 总经办与运营调度中心\n处理要求：立即检查数据库连接、容量与最近变更',
                )
            ) {
                this.lastDatabaseSentAt = Date.now();
            }
            this.incidentActive = true;
        }
    }

    private async checkNotificationPipeline(): Promise<void> {
        const deliveryRepository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const runtimeRepository = this.connection.rawConnection.getRepository(AdminNotificationRuntime);
        const [runtime, dead, oldestCritical] = await Promise.all([
            runtimeRepository.findOne({ where: { key: 'telegram-worker' } }),
            deliveryRepository.count({ where: { deliveryStatus: 'DEAD' } }),
            deliveryRepository.findOne({
                where: {
                    deliveryStatus: In(['PENDING', 'CLAIMED', 'RETRY']),
                    severity: In(['P0', 'P1']),
                },
                order: { createdAt: 'ASC' },
            }),
        ]);
        const now = Date.now();
        const workerFresh = Boolean(
            runtime?.heartbeatAt && now - runtime.heartbeatAt.getTime() <= WORKER_STALE_MS,
        );
        const criticalLagMs = oldestCritical ? Math.max(0, now - oldestCritical.createdAt.getTime()) : 0;
        const unhealthy = dead > 0 || (criticalLagMs >= PIPELINE_LAG_MS && !workerFresh);
        if (!unhealthy) {
            this.pipelineFailures = 0;
            this.pipelineSuccesses += 1;
            if (this.pipelineIncidentActive && this.pipelineSuccesses >= 2) {
                await this.sendEmergency(
                    '✅ [已恢复][TECH] Telegram 通知队列恢复\n\n责任部门：网站技术与自动化部',
                );
                this.pipelineIncidentActive = false;
            }
            return;
        }
        this.pipelineSuccesses = 0;
        this.pipelineFailures += 1;
        if (this.pipelineFailures < 2) return;
        const repeatDue = !this.lastPipelineSentAt || now - this.lastPipelineSentAt >= COOLDOWN_MS;
        if (!this.pipelineIncidentActive || repeatDue) {
            const severity = criticalLagMs >= PIPELINE_LAG_MS && !workerFresh ? 'P0' : 'P1';
            const details = [
                `dead：${dead}`,
                `P0/P1 最长积压：${Math.floor(criticalLagMs / 1000)} 秒`,
                `Worker 心跳：${workerFresh ? '正常' : '超时'}`,
            ].join('\n');
            if (
                await this.sendEmergency(
                    `⚠️ [${severity}][TECH] Telegram 通知队列异常\n\n责任部门：网站技术与自动化部\n升级部门：AI 总经办与运营调度中心\n${details}`,
                )
            ) {
                this.lastPipelineSentAt = now;
            }
            this.pipelineIncidentActive = true;
        }
    }

    private async databaseAvailable(): Promise<boolean> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                this.connection.rawConnection.query('SELECT 1'),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('database watchdog timeout')), 3_000);
                }),
            ]);
            return true;
        } catch {
            return false;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async sendEmergency(text: string): Promise<boolean> {
        const config = this.configService.cachedConfig();
        const environmentChatId = process.env.TELEGRAM_OPS_CHAT_ID?.trim();
        const chatId = environmentChatId || config?.chatId;
        const enabled = config?.enabled || process.env.TELEGRAM_EMERGENCY_ENABLED === 'true';
        if (!enabled || !chatId || !this.telegram.configured()) return false;
        try {
            await this.telegram.sendMessage({ chatId, text, silent: false });
            return true;
        } catch (error) {
            Logger.error(`紧急 Telegram 通知失败：${safeError(error)}`, undefined, LOGGER_CTX);
            return false;
        }
    }
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 300);
}
