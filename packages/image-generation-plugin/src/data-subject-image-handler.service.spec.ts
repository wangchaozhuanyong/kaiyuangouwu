import { describe, expect, it, vi } from 'vitest';

import { DataSubjectImageHandlerService } from './data-subject-image-handler.service';

describe('DataSubjectImageHandlerService', () => {
    it('registers blocking image cleanup before account anonymization', async () => {
        let registration:
            | {
                  id: string;
                  handler: (event: { ctx: unknown; customerId: string; reason: string }) => Promise<unknown>;
              }
            | undefined;
        const events = {
            registerBlockingEventHandler: vi.fn(value => {
                registration = value;
            }),
        };
        const generations = { complianceAnonymizeCustomer: vi.fn().mockResolvedValue({}) };
        new DataSubjectImageHandlerService(events as never, generations as never).onApplicationBootstrap();

        expect(registration?.id).toBe('image-generation-account-anonymization');
        await registration?.handler({ ctx: {}, customerId: 'customer-1', reason: 'closure request' });
        expect(generations.complianceAnonymizeCustomer).toHaveBeenCalledWith(
            {},
            'customer-1',
            'closure request',
        );
    });
});
