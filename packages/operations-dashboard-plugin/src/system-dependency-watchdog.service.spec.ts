import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';
import { SystemDependencyWatchdog } from './system-dependency-watchdog.service';

describe('SystemDependencyWatchdog', () => {
    it('sends one direct P0 alert after two consecutive database failures', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
        const watchdog = createWatchdog({
            query: vi.fn().mockRejectedValue(new Error('database unavailable')),
            sendMessage,
        });

        await watchdog.check();
        expect(sendMessage).not.toHaveBeenCalled();
        await watchdog.check();

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                chatId: '-1001',
                silent: false,
                text: expect.stringContaining('[P0][TECH]'),
            }),
        );
    });

    it('reports dead notification rows directly instead of relying on the broken queue', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ messageId: '1' });
        const watchdog = createWatchdog({
            query: vi.fn().mockResolvedValue([{ result: 1 }]),
            dead: 2,
            sendMessage,
        });

        await watchdog.check();
        await watchdog.check();

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                text: expect.stringMatching(/\[P1\]\[TECH\][\s\S]*dead：2/u),
            }),
        );
    });
});

function createWatchdog(options: {
    query: ReturnType<typeof vi.fn>;
    dead?: number;
    sendMessage: ReturnType<typeof vi.fn>;
}) {
    const deliveryRepository = {
        count: vi.fn().mockResolvedValue(options.dead ?? 0),
        findOne: vi.fn().mockResolvedValue(null),
    };
    const runtimeRepository = { findOne: vi.fn().mockResolvedValue(null) };
    const connection = {
        rawConnection: {
            query: options.query,
            getRepository: vi.fn((entity: unknown) =>
                entity === AdminNotificationDelivery ? deliveryRepository : runtimeRepository,
            ),
        },
    };
    const configService = {
        cachedConfig: vi.fn().mockReturnValue({ enabled: true, chatId: '-1001' }),
    };
    const telegram = {
        configured: vi.fn().mockReturnValue(true),
        sendMessage: options.sendMessage,
    };
    return new SystemDependencyWatchdog(
        connection as never,
        { isServer: true } as never,
        configService as never,
        telegram as never,
    );
}
