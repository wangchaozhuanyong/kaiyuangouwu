import { describe, expect, it, vi } from 'vitest';

import { Logger } from '../../config/logger/vendure-logger';

import { safeOperationErrorMessage } from './safe-operation-error';

describe('safeOperationErrorMessage', () => {
    it('logs the technical cause but returns only the translated business reason', () => {
        const logger = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const ctx = {
            translate: vi.fn().mockReturnValue('无法删除库存点，因为库存关联数据已发生变化'),
        };

        const message = safeOperationErrorMessage(
            ctx as any,
            new Error('QueryFailedError: violates constraint FK_secret'),
            'message.stock-location-delete-data-conflict',
            { name: '主仓库' },
            'Could not delete StockLocation location-1',
        );

        expect(message).toBe('无法删除库存点，因为库存关联数据已发生变化');
        expect(message).not.toContain('FK_secret');
        expect(ctx.translate).toHaveBeenCalledWith('message.stock-location-delete-data-conflict', {
            name: '主仓库',
        });
        expect(logger).toHaveBeenCalledWith(
            'Could not delete StockLocation location-1',
            undefined,
            expect.stringContaining('FK_secret'),
        );
    });
});
