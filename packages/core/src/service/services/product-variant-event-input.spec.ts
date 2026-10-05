import { describe, expect, it, vi } from 'vitest';

import { ProductVariantService } from './product-variant.service';
describe('product variant event caller input', () => {
    it('preserves omitted physical fields when a create save fills custom-field defaults', async () => {
        const input = [{ productId: 'product', customFields: { digitalDeliveryMode: 'manual_service' } }];
        const publish = vi.fn();
        const service = Object.assign(Object.create(ProductVariantService.prototype), {
            createSingle: vi.fn((ctx, value) => {
                return Promise.resolve().then(() => {
                    Object.assign(value.customFields, { packageQuantity: 1, purchaseUnit: '件' });
                    value.taxCategoryId = 'generated-tax';
                    return 'variant';
                });
            }),
            findByIds: vi.fn().mockResolvedValue([{ id: 'variant' }]),
            eventBus: { publish },
        }) as ProductVariantService;
        await service.create({} as any, input as any);
        const eventInput = publish.mock.calls[0][0].input;
        expect(eventInput).toEqual([
            { productId: 'product', customFields: { digitalDeliveryMode: 'manual_service' } },
        ]);
        expect(eventInput[0].customFields).not.toBe(input[0].customFields);
    });
    it('preserves explicit physical values so policy handlers can reject them', async () => {
        const input = [{ id: 'variant', price: 100, customFields: { packageQuantity: 1 } }];
        const publish = vi.fn();
        const service = Object.assign(Object.create(ProductVariantService.prototype), {
            connection: {
                getEntityOrThrow: vi.fn().mockResolvedValue({ productId: 'product' }),
                getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }),
            },
            updateSingle: vi.fn((ctx, value) => {
                return Promise.resolve().then(() => {
                    Object.assign(value.customFields, { purchaseUnit: '件' });
                });
            }),
            findByIds: vi.fn().mockResolvedValue([{ id: 'variant' }]),
            eventBus: { publish },
        }) as ProductVariantService;
        await service.update({ channelId: 'channel' } as any, input);
        expect(publish.mock.calls[0][0].input).toEqual([
            { id: 'variant', price: 100, customFields: { packageQuantity: 1 } },
        ]);
    });
});
