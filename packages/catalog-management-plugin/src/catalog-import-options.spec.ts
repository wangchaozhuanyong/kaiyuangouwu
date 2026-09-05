import {
    LanguageCode,
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductVariant,
    RequestContext,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { CatalogImportOptionsService } from './catalog-import-options.service';
import { catalogImportOptionCode, catalogImportOptionGroupCode } from './catalog-import-planning';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';

const ctx = { channelId: 'channel-1', languageCode: LanguageCode.zh_Hans } as RequestContext;
const product = new Product({ id: 'product-1' });

describe('catalog import variant options', () => {
    it('keeps a single new SKU without option groups unchanged', async () => {
        const fixture = createService();

        await expect(
            fixture.service.ensureImportVariantOptions(ctx, product, 'source-1', 'IMP-1', false),
        ).resolves.toEqual([]);
        expect(fixture.createGroup).not.toHaveBeenCalled();
        expect(fixture.updateVariants).not.toHaveBeenCalled();
    });

    it('creates distinct options for sibling SKUs and reuses the same source option on retry', async () => {
        const fixture = createService();

        const first = await fixture.service.ensureImportVariantOptions(
            ctx,
            product,
            'source-1',
            'IMP-1',
            true,
        );
        const second = await fixture.service.ensureImportVariantOptions(
            ctx,
            product,
            'source-2',
            'IMP-2',
            true,
        );
        const retry = await fixture.service.ensureImportVariantOptions(
            ctx,
            product,
            'source-2',
            'IMP-2',
            true,
        );

        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(first).not.toEqual(second);
        expect(retry).toEqual(second);
        expect(fixture.createGroup).toHaveBeenCalledTimes(1);
        expect(fixture.createOption).toHaveBeenCalledTimes(2);
        expect(fixture.addOptionGroup).toHaveBeenCalledWith(ctx, product.id, fixture.groups[0].id);
    });

    it('retrofits an already imported SKU using its own binding before adding a sibling', async () => {
        const variant = new ProductVariant({ id: 'variant-1', sku: 'IMP-1', options: [] });
        const fixture = createService(
            [variant],
            [],
            [new CatalogSourceBinding({ variantId: variant.id, sourceKey: 'source-1' })],
        );

        const second = await fixture.service.ensureImportVariantOptions(
            ctx,
            product,
            'source-2',
            'IMP-2',
            false,
        );

        expect(variant.options[0].code).toBe(catalogImportOptionCode('source-1'));
        expect(second).not.toEqual(variant.options.map(option => option.id));
        expect(fixture.findBindings).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ channelId: ctx.channelId, productId: product.id }),
            }),
        );
        await expect(
            fixture.service.ensureImportVariantOptions(ctx, product, 'source-2', 'IMP-2', false),
        ).resolves.toEqual(second);
        expect(fixture.updateVariants).toHaveBeenCalledTimes(1);
        expect(fixture.createOption).toHaveBeenCalledTimes(2);
    });

    it('preserves existing manual selections and supplies a missing selection for the new SKU', async () => {
        const color = new ProductOptionGroup({ id: 'color', code: 'color', options: [] });
        const red = new ProductOption({ id: 'red', code: 'red', groupId: color.id });
        color.options = [red];
        const variant = new ProductVariant({ id: 'variant-1', sku: 'MANUAL-1', options: [red] });
        const fixture = createService([variant], [color]);

        const next = await fixture.service.ensureImportVariantOptions(
            ctx,
            product,
            'source-2',
            'IMP-2',
            false,
        );

        expect(variant.options).toContain(red);
        expect(next).toHaveLength(2);
        expect(next).not.toContain(red.id);
        expect(color.options.find(option => next.includes(option.id))?.code).toBe(
            catalogImportOptionCode('unspecified-color'),
        );
        expect(
            fixture.groups.find(group => group.code === catalogImportOptionGroupCode(product.id)),
        ).toBeDefined();
    });
});

function createService(
    variants: ProductVariant[] = [],
    groups: ProductOptionGroup[] = [],
    bindings: CatalogSourceBinding[] = [],
) {
    const findBindings = vi.fn().mockResolvedValue(bindings);
    const getRepository = vi.fn((_ctx: RequestContext, entity: unknown) => {
        if (entity === ProductVariant) return { find: vi.fn().mockResolvedValue(variants) };
        if (entity === CatalogSourceBinding) return { find: findBindings };
        throw new Error('Unexpected repository');
    });
    const createGroup = vi.fn((_ctx: RequestContext, input: { code: string }) => {
        const group = new ProductOptionGroup({ id: 'import-group', code: input.code, options: [] });
        groups.push(group);
        return Promise.resolve(group);
    });
    let optionSequence = 0;
    const createOption = vi.fn((_ctx: RequestContext, group: ProductOptionGroup, input: { code: string }) =>
        Promise.resolve(
            new ProductOption({ id: `option-${++optionSequence}`, code: input.code, groupId: group.id }),
        ),
    );
    const updateVariants = vi.fn(
        (_ctx: RequestContext, updates: Array<{ id: string; optionIds: string[] }>) => {
            for (const update of updates) {
                const variant = variants.find(item => item.id === update.id);
                if (!variant) throw new Error('Unexpected variant');
                variant.options = groups.flatMap(group =>
                    group.options.filter(option => update.optionIds.includes(String(option.id))),
                );
            }
            return Promise.resolve(variants);
        },
    );
    const addOptionGroup = vi.fn();
    const service = new CatalogImportOptionsService(
        { getRepository } as never,
        { addOptionGroupToProduct: addOptionGroup } as never,
        { update: updateVariants } as never,
        {
            getOptionGroupsByProductId: vi.fn(() => Promise.resolve([...groups])),
            create: createGroup,
        } as never,
        { create: createOption } as never,
    );
    return { service, groups, createGroup, createOption, addOptionGroup, updateVariants, findBindings };
}
