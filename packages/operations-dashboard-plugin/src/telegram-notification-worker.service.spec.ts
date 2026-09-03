import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { AdminNotificationRuntime } from './entities/admin-notification-runtime.entity';
import { TelegramClientError } from './telegram-client';
import {
    HIGH_PRIORITY_QUEUE_NAME,
    QUEUE_NAME,
    TelegramNotificationWorkerService,
} from './telegram-notification-worker.service';

describe('TelegramNotificationWorkerService', () => {
    it('moves retryable Telegram errors to RETRY using retry_after', async () => {
        const delivery = fixture();
        const test = workerTest(delivery, {
            sendMessage: vi
                .fn()
                .mockRejectedValue(new TelegramClientError('RATE_LIMITED', 'rate limited', true, 17)),
        });
        const before = Date.now();

        await test.process();

        const failure = test.deliveryRepository.update.mock.calls.at(-1)?.[1];
        expect(failure).toMatchObject({
            deliveryStatus: 'RETRY',
            attempts: 1,
            lastErrorCode: 'RATE_LIMITED',
        });
        expect((failure.availableAt as Date).getTime()).toBeGreaterThanOrEqual(before + 16_500);
    });

    it('moves non-retryable authorization failures directly to DEAD', async () => {
        const delivery = fixture();
        const test = workerTest(delivery, {
            sendMessage: vi
                .fn()
                .mockRejectedValue(new TelegramClientError('AUTHORIZATION', 'forbidden', false)),
        });

        await test.process();

        expect(test.deliveryRepository.update.mock.calls.at(-1)?.[1]).toMatchObject({
            deliveryStatus: 'DEAD',
            attempts: 1,
            lastErrorCode: 'AUTHORIZATION',
        });
    });

    it('moves a retryable failure to DEAD after the sixth attempt', async () => {
        const delivery = fixture({ attempts: 5, maxAttempts: 6 });
        const test = workerTest(delivery, {
            sendMessage: vi.fn().mockRejectedValue(new TelegramClientError('NETWORK', 'offline', true)),
        });

        await test.process();

        expect(test.deliveryRepository.update.mock.calls.at(-1)?.[1]).toMatchObject({
            deliveryStatus: 'DEAD',
            attempts: 6,
            lastErrorCode: 'NETWORK',
        });
    });

    it('falls back to a new message when editing a resolved incident fails', async () => {
        const delivery = fixture({
            mode: 'INCIDENT',
            eventState: 'RESOLVED',
            deliveryAction: 'EDIT',
            telegramMessageId: '88',
            resolvedAt: new Date(),
        });
        const editMessageText = vi
            .fn()
            .mockRejectedValue(new TelegramClientError('BAD_REQUEST', 'message to edit not found', false));
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '99' });
        const test = workerTest(delivery, { editMessageText, sendMessage });

        await test.process();

        expect(editMessageText).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: '-1001', silent: true }));
        expect(test.deliveryRepository.update).toHaveBeenCalledWith(
            delivery.id,
            expect.objectContaining({ deliveryStatus: 'SENT', telegramMessageId: '99' }),
        );
    });

    it('routes P0/P1 jobs to a separate high-priority queue', async () => {
        const highAdd = vi.fn().mockResolvedValue({ id: 'high-job' });
        const standardAdd = vi.fn().mockResolvedValue({ id: 'standard-job' });
        const deliveryRepository = {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi
                .fn()
                .mockResolvedValueOnce(fixture({ id: 1, severity: 'P0', deliveryStatus: 'PENDING' }))
                .mockResolvedValueOnce(fixture({ id: 2, severity: 'P3', deliveryStatus: 'PENDING' })),
            update: vi.fn().mockResolvedValue({ affected: 1 }),
        };
        const connection = {
            rawConnection: { getRepository: vi.fn().mockReturnValue(deliveryRepository) },
        };
        const jobQueueService = {
            createQueue: vi.fn().mockImplementation(({ name }: { name: string }) =>
                Promise.resolve({
                    add: name === HIGH_PRIORITY_QUEUE_NAME ? highAdd : standardAdd,
                }),
            ),
        };
        const worker = new TelegramNotificationWorkerService(
            connection as never,
            jobQueueService as never,
            { isWorker: false } as never,
            {} as never,
            {} as never,
        );
        await worker.onApplicationBootstrap();

        await worker.dispatch('1');
        await worker.dispatch('2');

        expect(jobQueueService.createQueue).toHaveBeenCalledWith(
            expect.objectContaining({ name: HIGH_PRIORITY_QUEUE_NAME }),
        );
        expect(jobQueueService.createQueue).toHaveBeenCalledWith(
            expect.objectContaining({ name: QUEUE_NAME }),
        );
        expect(highAdd).toHaveBeenCalledWith({ deliveryId: '1' }, { retries: 0 });
        expect(standardAdd).toHaveBeenCalledWith({ deliveryId: '2' }, { retries: 0 });
    });
});

function workerTest(delivery: AdminNotificationDelivery, telegramOverrides: Record<string, unknown>) {
    const deliveryRepository = {
        findOne: vi.fn().mockResolvedValue(delivery),
        update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const runtimeRepository = {
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockImplementation(value => Promise.resolve(value)),
    };
    const connection = {
        rawConnection: {
            getRepository: vi.fn((entity: unknown) =>
                entity === AdminNotificationRuntime ? runtimeRepository : deliveryRepository,
            ),
        },
    };
    const configService = {
        get: vi.fn().mockResolvedValue({
            enabled: true,
            tokenConfigured: true,
            chatId: '-1001',
            timezone: 'Asia/Kuala_Lumpur',
            adminBaseUrl: 'https://console.example.com/dashboard',
            departmentMentions: {},
        }),
    };
    const telegram = {
        sendMessage: vi.fn().mockResolvedValue({ messageId: '55' }),
        editMessageText: vi.fn().mockResolvedValue({ messageId: '55' }),
        ...telegramOverrides,
    };
    const worker = new TelegramNotificationWorkerService(
        connection as never,
        {} as never,
        { isWorker: true } as never,
        configService as never,
        telegram as never,
    );
    return {
        deliveryRepository,
        process: () =>
            (
                worker as unknown as { process(job: { data: { deliveryId: string } }): Promise<unknown> }
            ).process({
                data: { deliveryId: String(delivery.id) },
            }),
    };
}

function fixture(overrides: Partial<AdminNotificationDelivery> = {}): AdminNotificationDelivery {
    return Object.assign(
        new AdminNotificationDelivery({
            eventType: 'commerce.payment.settled',
            category: 'PAYMENT',
            ownerDepartmentCode: 'FULFILLMENT',
            collaboratorDepartmentCodes: ['DATA_FINANCE'],
            escalationDepartmentCode: null,
            actionRequired: true,
            slaDueAt: null,
            actionHint: '处理订单',
            severity: 'P2',
            mode: 'ONE_OFF',
            eventState: 'INFO',
            sourceType: 'Payment',
            sourceId: 'payment-1',
            dedupKey: 'payment:1',
            fingerprint: null,
            activeFingerprint: null,
            title: '支付成功',
            occurrenceCount: 1,
            firstOccurredAt: new Date('2026-09-03T10:00:00Z'),
            lastOccurredAt: new Date('2026-09-03T10:00:00Z'),
            resolvedAt: null,
            escalatedAt: null,
            priority: 50,
            silent: true,
            deliveryAction: 'SEND',
            deliveryStatus: 'CLAIMED',
            availableAt: new Date(),
            attempts: 0,
            maxAttempts: 6,
            claimedAt: new Date(),
            claimedBy: 'worker',
            telegramMessageId: null,
            queueJobId: 'job-1',
            lastErrorCode: null,
            lastError: null,
            sentAt: null,
        }),
        { id: 1, payload: { orderCode: 'ORDER-1' }, ...overrides },
    );
}
