import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { Job, JobQueue, JobQueueService, ProcessContext, TransactionalConnection } from '@vendure/core';
import { hostname } from 'node:os';
import { In, LessThan, LessThanOrEqual } from 'typeorm';

import { AdminNotificationConfigService } from './admin-notification-config.service';
import {
    AdminNotificationDelivery,
    NotificationDeliveryStatus,
} from './entities/admin-notification-delivery.entity';
import { AdminNotificationRuntime } from './entities/admin-notification-runtime.entity';
import { TelegramClient, TelegramClientError } from './telegram-client';
import { formatTelegramNotification } from './telegram-notification-formatter';

const LOGGER_CTX = 'TelegramNotificationWorker';
const QUEUE_NAME = 'telegram-internal-notification';
const HIGH_PRIORITY_QUEUE_NAME = 'telegram-internal-notification-high';
const CLAIM_LEASE_MS = 2 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface TelegramDeliveryJobData {
    deliveryId: string;
}

@Injectable()
export class TelegramNotificationWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
    private standardQueue: JobQueue<TelegramDeliveryJobData>;
    private highPriorityQueue: JobQueue<TelegramDeliveryJobData>;
    private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    private readonly workerId = `${hostname()}:${process.pid}`;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly jobQueueService: JobQueueService,
        private readonly processContext: ProcessContext,
        private readonly configService: AdminNotificationConfigService,
        private readonly telegram: TelegramClient,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.highPriorityQueue = await this.jobQueueService.createQueue({
            name: HIGH_PRIORITY_QUEUE_NAME,
            process: job => this.process(job),
        });
        this.standardQueue = await this.jobQueueService.createQueue({
            name: QUEUE_NAME,
            process: job => this.process(job),
        });
        await this.recoverExpiredClaims();
        await this.dispatchDue();
        if (this.processContext.isWorker) {
            await this.writeHeartbeat('RUNNING').catch(error =>
                Logger.warn(`无法写入 Worker 心跳：${safeError(error)}`, LOGGER_CTX),
            );
            this.heartbeatTimer = setInterval(() => {
                void this.writeHeartbeat('RUNNING').catch(error =>
                    Logger.warn(`无法写入 Worker 心跳：${safeError(error)}`, LOGGER_CTX),
                );
            }, HEARTBEAT_INTERVAL_MS);
            this.heartbeatTimer.unref?.();
        }
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.processContext.isWorker) await this.writeHeartbeat('STOPPED').catch(() => undefined);
    }

    async dispatch(deliveryId: ID): Promise<boolean> {
        return this.claimAndQueue(String(deliveryId));
    }

    async dispatchDue(): Promise<number> {
        await this.recoverExpiredClaims();
        const repository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const candidates = await repository.find({
            where: {
                deliveryStatus: In<NotificationDeliveryStatus>(['PENDING', 'RETRY']),
                availableAt: LessThanOrEqual(new Date()),
            },
            order: { priority: 'DESC', availableAt: 'ASC', id: 'ASC' },
            take: 100,
        });
        let dispatched = 0;
        for (const delivery of candidates) {
            if (
                await this.claimAndQueue(String(delivery.id), {
                    deliveryStatus: delivery.deliveryStatus,
                    severity: delivery.severity,
                })
            ) {
                dispatched += 1;
            }
        }
        return dispatched;
    }

    async status(): Promise<{
        running: boolean;
        processed: number;
        failures: number;
        pending: number;
        retrying: number;
        dead: number;
        oldestLagSeconds: number;
        lastSuccessAt: Date | null;
        lastErrorAt: Date | null;
        lastError: string | null;
    }> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const [runtime, pending, retrying, dead, oldest] = await Promise.all([
            this.connection.rawConnection
                .getRepository(AdminNotificationRuntime)
                .findOne({ where: { key: 'telegram-worker' } }),
            repository.count({ where: { deliveryStatus: In(['PENDING', 'CLAIMED']) } }),
            repository.count({ where: { deliveryStatus: 'RETRY' } }),
            repository.count({ where: { deliveryStatus: 'DEAD' } }),
            repository.findOne({
                where: { deliveryStatus: In(['PENDING', 'CLAIMED', 'RETRY']) },
                order: { createdAt: 'ASC' },
            }),
        ]);
        const heartbeatFresh = Boolean(
            runtime?.heartbeatAt && Date.now() - runtime.heartbeatAt.getTime() <= HEARTBEAT_INTERVAL_MS * 3,
        );
        return {
            running: runtime?.state === 'RUNNING' && heartbeatFresh,
            processed: runtime?.processed ?? 0,
            failures: runtime?.failures ?? 0,
            pending,
            retrying,
            dead,
            oldestLagSeconds: oldest
                ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000))
                : 0,
            lastSuccessAt: runtime?.lastSuccessAt ?? null,
            lastErrorAt: runtime?.lastErrorAt ?? null,
            lastError: runtime?.lastError ?? null,
        };
    }

    private async claimAndQueue(
        deliveryId: string,
        expected?: Pick<AdminNotificationDelivery, 'deliveryStatus' | 'severity'>,
    ): Promise<boolean> {
        if (!this.standardQueue || !this.highPriorityQueue) return false;
        const repository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const delivery = expected
            ? ({ id: deliveryId as ID, ...expected } as const)
            : await repository.findOne({ where: { id: deliveryId as ID } });
        if (!delivery || !['PENDING', 'RETRY'].includes(delivery.deliveryStatus)) return false;
        const claim = await repository.update(
            { id: deliveryId as ID, deliveryStatus: delivery.deliveryStatus },
            {
                deliveryStatus: 'CLAIMED',
                claimedAt: new Date(),
                claimedBy: this.workerId,
                lastErrorCode: null,
            },
        );
        if (claim.affected !== 1) return false;
        try {
            const queue =
                delivery.severity === 'P0' || delivery.severity === 'P1'
                    ? this.highPriorityQueue
                    : this.standardQueue;
            const queued = await queue.add({ deliveryId }, { retries: 0 });
            await repository.update(
                { id: deliveryId as ID, deliveryStatus: 'CLAIMED' },
                { queueJobId: queued.id == null ? null : String(queued.id) },
            );
            return true;
        } catch (error) {
            await repository.update(
                { id: deliveryId as ID, deliveryStatus: 'CLAIMED' },
                {
                    deliveryStatus: 'RETRY',
                    availableAt: new Date(Date.now() + 60_000),
                    claimedAt: null,
                    claimedBy: null,
                    lastErrorCode: 'QUEUE_ADD_FAILED',
                    lastError: safeError(error),
                },
            );
            return false;
        }
    }

    private async process(
        job: Job<TelegramDeliveryJobData>,
    ): Promise<{ deliveryId: string; status: string }> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationDelivery);
        const delivery = await repository.findOne({ where: { id: job.data.deliveryId as ID } });
        if (!delivery || delivery.deliveryStatus !== 'CLAIMED') {
            return { deliveryId: job.data.deliveryId, status: delivery?.deliveryStatus ?? 'MISSING' };
        }
        const config = await this.configService.get();
        if (!config.enabled) {
            await repository.update(delivery.id, {
                deliveryStatus: 'SKIPPED',
                lastErrorCode: 'DISABLED',
                lastError: 'Telegram 内部通知已停用',
                claimedAt: null,
                claimedBy: null,
            });
            return { deliveryId: job.data.deliveryId, status: 'SKIPPED' };
        }
        if (!config.tokenConfigured || !config.chatId) {
            await this.markFailure(
                delivery,
                new TelegramClientError('NOT_CONFIGURED', 'Token 或 Chat ID 未配置', false),
            );
            return { deliveryId: job.data.deliveryId, status: 'DEAD' };
        }
        try {
            const formatted = formatTelegramNotification(delivery, {
                timezone: config.timezone,
                adminBaseUrl: config.adminBaseUrl,
                departmentMentions:
                    delivery.severity === 'P0' || delivery.severity === 'P1'
                        ? config.departmentMentions
                        : undefined,
            });
            let result;
            if (delivery.deliveryAction === 'EDIT' && delivery.telegramMessageId) {
                try {
                    result = await this.telegram.editMessageText({
                        chatId: config.chatId,
                        messageId: delivery.telegramMessageId,
                        text: formatted.text,
                        button: formatted.button,
                    });
                } catch (error) {
                    if (
                        error instanceof TelegramClientError &&
                        /message is not modified/iu.test(error.message)
                    ) {
                        result = { messageId: delivery.telegramMessageId };
                    } else if (delivery.eventState === 'RESOLVED' && error instanceof TelegramClientError) {
                        result = await this.telegram.sendMessage({
                            chatId: config.chatId,
                            text: formatted.text,
                            silent: true,
                            button: formatted.button,
                        });
                    } else {
                        throw error;
                    }
                }
            } else {
                result = await this.telegram.sendMessage({
                    chatId: config.chatId,
                    text: formatted.text,
                    silent: delivery.silent,
                    button: formatted.button,
                });
            }
            await repository.update(delivery.id, {
                deliveryStatus: 'SENT',
                telegramMessageId: result.messageId,
                attempts: delivery.attempts + 1,
                sentAt: new Date(),
                claimedAt: null,
                claimedBy: null,
                lastErrorCode: null,
                lastError: null,
            });
            await this.recordRuntimeSuccess();
            return { deliveryId: job.data.deliveryId, status: 'SENT' };
        } catch (error) {
            await this.markFailure(delivery, error);
            return { deliveryId: job.data.deliveryId, status: 'FAILED' };
        }
    }

    private async markFailure(delivery: AdminNotificationDelivery, error: unknown): Promise<void> {
        const telegramError = error instanceof TelegramClientError ? error : null;
        const attempts = delivery.attempts + 1;
        const dead = (telegramError && !telegramError.retryable) || attempts >= delivery.maxAttempts;
        const retryDelay = telegramError?.retryAfterSeconds
            ? telegramError.retryAfterSeconds * 1000
            : retryDelayMs(attempts);
        const message = safeError(error);
        await this.connection.rawConnection.getRepository(AdminNotificationDelivery).update(delivery.id, {
            deliveryStatus: dead ? 'DEAD' : 'RETRY',
            availableAt: new Date(Date.now() + retryDelay),
            attempts,
            claimedAt: null,
            claimedBy: null,
            lastErrorCode: telegramError?.code ?? 'UNKNOWN',
            lastError: message,
        });
        await this.recordRuntimeFailure(message);
    }

    private async recoverExpiredClaims(): Promise<void> {
        await this.connection.rawConnection.getRepository(AdminNotificationDelivery).update(
            { deliveryStatus: 'CLAIMED', claimedAt: LessThan(new Date(Date.now() - CLAIM_LEASE_MS)) },
            {
                deliveryStatus: 'RETRY',
                availableAt: new Date(),
                claimedAt: null,
                claimedBy: null,
                lastErrorCode: 'CLAIM_EXPIRED',
                lastError: '发送租约过期，已安排重新领取',
            },
        );
    }

    private async writeHeartbeat(state: string): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationRuntime);
        const existing = await repository.findOne({ where: { key: 'telegram-worker' } });
        const runtime =
            existing ?? new AdminNotificationRuntime({ key: 'telegram-worker', processed: 0, failures: 0 });
        runtime.state = state;
        runtime.workerId = this.workerId;
        runtime.heartbeatAt = new Date();
        await repository.save(runtime);
    }

    private async recordRuntimeSuccess(): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationRuntime);
        const runtime =
            (await repository.findOne({ where: { key: 'telegram-worker' } })) ??
            new AdminNotificationRuntime({ key: 'telegram-worker', processed: 0, failures: 0 });
        runtime.state = 'RUNNING';
        runtime.workerId = this.workerId;
        runtime.heartbeatAt = new Date();
        runtime.lastSuccessAt = new Date();
        runtime.lastError = null;
        runtime.processed += 1;
        await repository.save(runtime);
    }

    private async recordRuntimeFailure(message: string): Promise<void> {
        const repository = this.connection.rawConnection.getRepository(AdminNotificationRuntime);
        const runtime =
            (await repository.findOne({ where: { key: 'telegram-worker' } })) ??
            new AdminNotificationRuntime({ key: 'telegram-worker', processed: 0, failures: 0 });
        runtime.state = 'RUNNING';
        runtime.workerId = this.workerId;
        runtime.heartbeatAt = new Date();
        runtime.lastErrorAt = new Date();
        runtime.lastError = message;
        runtime.failures += 1;
        await repository.save(runtime);
    }
}

function retryDelayMs(attempts: number): number {
    return [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000][attempts - 1] ?? 6 * 60 * 60_000;
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 500);
}

export { HIGH_PRIORITY_QUEUE_NAME, QUEUE_NAME };
