import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { ImageGenerationService, referenceModeInstruction } from './image-generation.service';

describe('ImageGenerationService settlement currency', () => {
    it('reads the referral wallet for the active request currency', async () => {
        const findOne = vi.fn(() => Promise.resolve({ availableBalance: 880 }));
        const connection = { getRepository: vi.fn(() => ({ findOne })) };
        const service = new ImageGenerationService(
            connection as never,
            { findOneByUserId: vi.fn(() => Promise.resolve({ id: 42 })) } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(
            service.wallet({
                activeUserId: 9,
                channelId: 3,
                currencyCode: CurrencyCode.MYR,
            } as never),
        ).resolves.toEqual({ availableBalance: 880, currencyCode: CurrencyCode.MYR });
        expect(findOne).toHaveBeenCalledWith({
            where: { channelId: 3, customerId: 42, currencyCode: CurrencyCode.MYR },
        });
    });
});

describe('reference image prompt language', () => {
    it('uses Chinese instructions for Chinese prompts', () => {
        expect(referenceModeInstruction('PRODUCT', 'zh')).toContain('保留商品外形');
        expect(referenceModeInstruction('PRODUCT', 'zh')).not.toContain('Preserve the product');
    });

    it('uses English instructions for English prompts', () => {
        expect(referenceModeInstruction('PRODUCT', 'en')).toContain('Preserve the product shape');
    });
});
