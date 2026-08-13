import { describe, expect, it, vi } from 'vitest';

import { Logger } from '../config/logger/vendure-logger';

import { CustomFieldsValidationSubscriber } from './custom-fields-validation-subscriber';

function createSubscriber(customFields: Record<string, any[]>) {
    return new CustomFieldsValidationSubscriber(
        { rawConnection: { subscribers: [] } } as any,
        { customFields } as any,
    );
}

describe('CustomFieldsValidationSubscriber', () => {
    it('accepts the GraphQL input name for a list relation field', () => {
        const subscriber = createSubscriber({
            Product: [{ name: 'reviews', type: 'relation', list: true }],
        });
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

        subscriber.validateCustomFields('Product', { customFields: { reviewsIds: ['1'] } } as any);

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('accepts the GraphQL input name for a single relation field', () => {
        const subscriber = createSubscriber({
            Product: [{ name: 'featuredReview', type: 'relation', list: false }],
        });
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

        subscriber.validateCustomFields('Product', { customFields: { featuredReviewId: '1' } } as any);

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('continues to warn for an unknown field', () => {
        const subscriber = createSubscriber({
            Product: [{ name: 'reviews', type: 'relation', list: true }],
        });
        const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

        subscriber.validateCustomFields('Product', { customFields: { unknownIds: ['1'] } } as any);

        expect(warnSpy).toHaveBeenCalledWith('Custom field unknownIds not found for entity Product');
        warnSpy.mockRestore();
    });
});
