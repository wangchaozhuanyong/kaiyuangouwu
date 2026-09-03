import { describe, expect, it, vi } from 'vitest';

import { AdminNotificationHealthController } from './admin-notification-health.controller';

describe('AdminNotificationHealthController', () => {
    it('keeps liveness independent from the database', () => {
        const controller = new AdminNotificationHealthController({} as never);
        expect(controller.live()).toEqual({ status: 'ok' });
    });

    it('returns a simplified 503 readiness response when the database is unavailable', async () => {
        const controller = new AdminNotificationHealthController({
            rawConnection: { query: vi.fn().mockRejectedValue(new Error('contains private host details')) },
        } as never);
        const response = responseRecorder();

        await controller.ready(response);

        expect(response.status).toHaveBeenCalledWith(503);
        expect(response.json).toHaveBeenCalledWith({
            status: 'unavailable',
            components: { database: 'down' },
        });
        expect(JSON.stringify(response.json.mock.calls)).not.toContain('private host');
    });
});

function responseRecorder() {
    const response = {
        status: vi.fn(),
        json: vi.fn(),
    };
    response.status.mockReturnValue(response);
    return response;
}
