import { LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { CatalogSupplierService } from './catalog-supplier.service';

describe('supplier linked SKU names', () => {
    const variant = {
        sku: 'SIM-SKU',
        productId: 28,
        enabled: true,
        translations: [
            { languageCode: LanguageCode.zh_Hans, name: '标准件' },
            { languageCode: LanguageCode.en, name: 'Standard' },
        ],
        product: {
            translations: [
                { languageCode: LanguageCode.zh_Hans, name: '模拟商品' },
                { languageCode: LanguageCode.en, name: 'Sim product' },
            ],
        },
    };
    function setup(currentVariant = variant) {
        const findOne = vi.fn().mockResolvedValue({ id: '1', channelId: '16' });
        const findAndCount = vi.fn().mockResolvedValue([[{ variantId: 27, variant: currentVariant }], 1]);
        const service = new CatalogSupplierService({
            getRepository: () => ({ findOne, findAndCount }),
        } as never);
        return { service, findOne, findAndCount };
    }
    it.each([
        [LanguageCode.zh_Hans, '标准件', '模拟商品'],
        [LanguageCode.en, 'Standard', 'Sim product'],
        [LanguageCode.de, '标准件', '模拟商品'],
    ])('resolves raw translations for %s', async (languageCode, name, productName) => {
        const { service, findAndCount } = setup();
        const result = await service.linkedVariants(
            {
                channelId: '16',
                languageCode,
                channel: { defaultLanguageCode: LanguageCode.zh_Hans },
            } as never,
            '1',
        );
        expect(result).toEqual({
            items: [{ id: '27', productId: '28', sku: 'SIM-SKU', enabled: true, name, productName }],
            totalItems: 1,
        });
        expect(findAndCount.mock.calls[0][0].where).toEqual({ channelId: '16', supplierId: '1' });
    });
    it('falls back to the SKU if a legacy entity has no names', async () => {
        const { service } = setup({ ...variant, translations: [], product: { translations: [] } });
        const result = await service.linkedVariants(
            {
                channelId: '16',
                languageCode: LanguageCode.zh_Hans,
                channel: { defaultLanguageCode: LanguageCode.zh_Hans },
            } as never,
            '1',
        );
        expect(result.items[0]).toMatchObject({ name: 'SIM-SKU', productName: 'SIM-SKU' });
    });
    it('does not list associations when the supplier is outside the current shop', async () => {
        const { service, findOne, findAndCount } = setup();
        findOne.mockResolvedValue(null);
        await expect(service.linkedVariants({ channelId: '17' } as never, '1')).rejects.toThrow();
        expect(findAndCount).not.toHaveBeenCalled();
    });
});
