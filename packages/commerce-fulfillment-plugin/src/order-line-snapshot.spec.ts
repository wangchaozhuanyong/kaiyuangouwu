import { LanguageCode, OrderLine, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { orderLineProductName } from './order-line-snapshot';

describe('order lifecycle product name snapshots', () => {
    const line = {
        productVariant: {
            translations: [
                { languageCode: LanguageCode.en, name: 'Digital service' },
                { languageCode: LanguageCode.zh_Hans, name: '数字服务' },
            ],
        },
    } as OrderLine;
    it('translates raw payment-event entities before saving delivery records', () => {
        expect(
            orderLineProductName(
                {
                    languageCode: LanguageCode.zh_Hans,
                    channel: { defaultLanguageCode: LanguageCode.en },
                } as RequestContext,
                line,
            ),
        ).toBe('数字服务');
    });
    it('uses the channel language when the requested translation is unavailable', () => {
        expect(
            orderLineProductName(
                {
                    languageCode: LanguageCode.de,
                    channel: { defaultLanguageCode: LanguageCode.en },
                } as RequestContext,
                line,
            ),
        ).toBe('Digital service');
    });
});
