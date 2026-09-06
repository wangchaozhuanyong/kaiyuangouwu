import type { DocumentNode } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_PRODUCT, UPDATE_PRODUCT_VARIANTS } from '../../graphql/catalog.graphql';
import type { ProductDetailRecord } from './product-editor-types';
import { useProductEditorSave } from './useProductEditorSave';

const mocks = vi.hoisted(() => ({
    mutations: new Map<DocumentNode, ReturnType<typeof vi.fn>>(),
    query: vi.fn(),
}));
vi.mock('@apollo/client/react', () => ({
    useMutation: (document: DocumentNode) => {
        if (!mocks.mutations.has(document)) mocks.mutations.set(document, vi.fn().mockResolvedValue({}));
        return [mocks.mutations.get(document)];
    },
}));
vi.mock('../../apollo', () => ({
    client: { query: mocks.query },
    sensitiveActionContext: vi.fn(),
}));

type SaveInput = Parameters<typeof useProductEditorSave>[0];

function fixture(): SaveInput {
    const product: ProductDetailRecord = {
        id: 'product-1',
        enabled: true,
        name: '原名称',
        slug: 'original',
        description: '原详情',
        assets: [],
        facetValues: [],
        optionGroups: [],
        collections: [],
        channels: [],
        translations: [
            { id: 'zh', languageCode: 'zh_Hans', name: '原名称', slug: 'original', description: '原详情' },
            {
                id: 'en',
                languageCode: 'en',
                name: 'English name',
                slug: 'english',
                description: 'English details',
            },
        ],
        variants: [
            {
                id: 'variant-1',
                enabled: true,
                name: '规格',
                sku: 'SKU-1',
                price: 1000,
                stockOnHand: 5,
                stockAllocated: 0,
                trackInventory: 'INHERIT',
                options: [],
                translations: [],
            },
        ],
    };
    return {
        productId: product.id,
        productExtensionFields: [],
        draft: {
            productName: '新名称',
            slug: 'updated',
            enabled: true,
            description: '新详情',
            fulfillmentType: 'physical',
            refundPolicy: 'MERCHANT_REVIEW',
            manualDeliverySlaMinutes: 60,
            featuredAssetId: null,
            selectedAssetIds: [],
            selectedFacetValueIds: [],
            selectedCollectionIds: [],
            selectedChannelIds: [],
            selectedOptionGroupIds: [],
            dynamicCustomFields: {},
            variants: [
                {
                    id: 'variant-1',
                    enabled: true,
                    name: '规格',
                    sku: 'SKU-1',
                    price: '10.50',
                    stockOnHand: 5,
                    stockAllocated: 0,
                    digitalDeliveryMode: 'manual_service',
                    digitalStockPolicy: 'limited',
                    optionIds: [],
                },
            ],
        },
        data: {
            productData: { product },
            catalogChannelsData: undefined,
            refetchProduct: vi.fn().mockResolvedValue({ data: { product } }),
            refetchCollections: vi.fn().mockResolvedValue({}),
        },
        controls: {
            requestConfirmation: vi.fn().mockResolvedValue(null),
            navigate: vi.fn(),
            setActiveTab: vi.fn(),
            setErrorMessage: vi.fn(),
            setFormErrors: vi.fn(),
            setSaving: vi.fn(),
            showError: vi.fn(),
            showNotice: vi.fn(),
        },
    };
}

describe('product save orchestration', () => {
    beforeEach(() => {
        mocks.mutations.clear();
        mocks.query.mockReset();
    });

    it('rejects duplicate SKU codes before making any write', async () => {
        const input = fixture();
        input.draft.variants.push({ ...input.draft.variants[0], id: undefined, isNew: true, sku: ' sku-1 ' });
        await useProductEditorSave(input).handleSave();
        for (const mutation of mocks.mutations.values()) expect(mutation).not.toHaveBeenCalled();
        expect(input.controls.setActiveTab).toHaveBeenCalledWith('VARIANTS');
        expect(input.controls.showNotice).not.toHaveBeenCalled();
    });

    it('preserves other languages and saves SKU prices in minor units', async () => {
        const input = fixture();
        await useProductEditorSave(input).handleSave();
        const productMutation = mocks.mutations.get(UPDATE_PRODUCT)!;
        const variantMutation = mocks.mutations.get(UPDATE_PRODUCT_VARIANTS)!;
        const saved = productMutation.mock.calls[0][0].variables.input;
        expect(saved.translations).toEqual([
            { id: 'zh', languageCode: 'zh_Hans', name: '新名称', slug: 'updated', description: '新详情' },
            input.data.productData!.product!.translations[1],
        ]);
        expect(variantMutation.mock.calls[0][0].variables.input[0]).toMatchObject({
            id: 'variant-1',
            price: 1050,
        });
        expect(productMutation.mock.invocationCallOrder[0]).toBeLessThan(
            variantMutation.mock.invocationCallOrder[0],
        );
        expect(input.data.refetchProduct).toHaveBeenCalledOnce();
        expect(input.controls.showNotice).toHaveBeenCalledOnce();
        expect(input.controls.showError).not.toHaveBeenCalled();
        expect(input.controls.setSaving).toHaveBeenLastCalledWith(false);
    });

    it('reloads committed data and reports partial completion if a later stage fails', async () => {
        const input = fixture();
        const { handleSave } = useProductEditorSave(input);
        mocks.mutations.get(UPDATE_PRODUCT_VARIANTS)!.mockRejectedValueOnce(new Error('SKU write failed'));
        await handleSave();
        expect(mocks.mutations.get(UPDATE_PRODUCT)).toHaveBeenCalledOnce();
        expect(input.data.refetchProduct).toHaveBeenCalledOnce();
        expect(input.controls.showError).toHaveBeenCalledWith(expect.stringContaining('部分内容已保存'));
        expect(input.controls.showError).toHaveBeenCalledWith(expect.stringContaining('SKU write failed'));
        expect(input.controls.showNotice).not.toHaveBeenCalled();
        expect(input.controls.setSaving).toHaveBeenLastCalledWith(false);
    });

    it('does not claim the form was refreshed when reloading committed data fails', async () => {
        const input = fixture();
        vi.mocked(input.data.refetchProduct).mockRejectedValueOnce(new Error('Reload unavailable'));
        const { handleSave } = useProductEditorSave(input);
        mocks.mutations.get(UPDATE_PRODUCT_VARIANTS)!.mockRejectedValueOnce(new Error('SKU write failed'));
        await handleSave();
        expect(input.controls.showError).toHaveBeenCalledWith(expect.stringContaining('重新加载失败'));
        expect(input.controls.showError).not.toHaveBeenCalledWith(
            expect.stringContaining('页面已按后端当前数据重新加载'),
        );
        expect(input.controls.showNotice).not.toHaveBeenCalled();
        expect(input.controls.setSaving).toHaveBeenLastCalledWith(false);
    });

    it('makes no writes when an availability confirmation is cancelled', async () => {
        const input = fixture();
        input.draft.enabled = false;
        await useProductEditorSave(input).handleSave();
        expect(input.controls.requestConfirmation).toHaveBeenCalledWith(
            expect.objectContaining({ requireCurrentPassword: true }),
        );
        for (const mutation of mocks.mutations.values()) expect(mutation).not.toHaveBeenCalled();
        expect(input.controls.showNotice).not.toHaveBeenCalled();
        expect(input.controls.setSaving).toHaveBeenLastCalledWith(false);
    });
});
