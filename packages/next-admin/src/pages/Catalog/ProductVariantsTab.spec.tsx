// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ProductMoreSettings } from './ProductMoreSettings';
import { ProductVariantsTab } from './ProductVariantsTab';
import type { ProductVariantState } from './product-editor-types';

const editorState = vi.hoisted(() => ({
    activeCurrencyCode: 'CNY',
    effectiveFulfillmentType: 'physical',
    variants: [] as ProductVariantState[],
    selectedOptionGroupIds: [] as string[],
    knownOptionGroups: {} as Record<string, any>,
    optionGroupSearch: '',
    optionGroupPage: 0,
    optionGroupPageSize: 20,
    optionGroupsData: { productOptionGroups: { items: [], totalItems: 0 } },
    catalogChannelsData: {
        activeChannel: { id: 'default', code: '__default_channel__', displayName: '平台' },
        channels: {
            items: [
                { id: 'default', code: '__default_channel__', defaultCurrencyCode: 'CNY' },
                { id: 'meiyijia', code: '美宜佳', defaultCurrencyCode: 'MYR' },
            ],
        },
    },
    selectedChannelIds: [] as string[],
    setSelectedChannelIds: vi.fn(),
    formErrors: {},
    productExtensionFields: [],
    dynamicCustomFieldValues: {},
    isCreateMode: false,
    productData: { product: { id: 'product-1' } },
    isOptionTemplatesOpen: false,
    setIsOptionTemplatesOpen: vi.fn(),
    isQuickCreateSpecOpen: false,
    setIsQuickCreateSpecOpen: vi.fn(),
    handleApplyOptionGroup: vi.fn(),
}));

vi.mock('@apollo/client/react', () => ({ useMutation: () => [vi.fn(), { loading: false }] }));
vi.mock('./ProductEditorContext', () => ({ useProductEditor: () => editorState }));
vi.mock('./ProductSupplySettings', () => ({
    ProductSupplySettings: ({ variantIndex }: { variantIndex: number }) => (
        <div data-supplier-index={variantIndex} />
    ),
}));
vi.mock('./DigitalProductWorkspace', () => ({
    DigitalProductWorkspace: ({ variantIndex, inline }: { variantIndex: number; inline: boolean }) => (
        <div data-domain="digital" data-index={variantIndex} data-inline={String(inline)} />
    ),
}));
vi.mock('./PhysicalProductWorkspace', () => ({
    PhysicalProductWorkspace: ({ variantIndex, inline }: { variantIndex: number; inline: boolean }) => (
        <div data-domain="physical" data-index={variantIndex} data-inline={String(inline)} />
    ),
}));

describe('ProductVariantsTab store isolation', () => {
    it('preserves single-store ownership when an older draft contains other channel IDs', () => {
        editorState.catalogChannelsData.activeChannel = {
            id: 'meiyijia',
            code: 'merchant-store',
            displayName: '美宜佳',
        };
        editorState.selectedChannelIds = ['default', 'meiyijia'];
        const container = document.createElement('div');
        container.innerHTML = renderToStaticMarkup(
            <FeatureHelpProvider>
                <ProductMoreSettings />
            </FeatureHelpProvider>,
        );
        expect(container.textContent).toContain('本商品仅属于 美宜佳');
        expect(container.textContent).toContain('单店独立');
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
        expect(container.querySelector('button[aria-label="查看“店铺独立商品”功能说明"]')).not.toBeNull();
    });

    it('renders quick create button and displays imported exclusive specification badges', () => {
        editorState.selectedOptionGroupIds = ['import-group-1'];
        editorState.knownOptionGroups = {
            'import-group-1': {
                id: 'import-group-1',
                code: 'import-sku-5905',
                name: '导入规格',
                options: [
                    { id: 'opt-box', code: 'box', name: '单盒' },
                    { id: 'opt-carton', code: 'carton', name: '整条' },
                ],
            },
        };

        const container = document.createElement('div');
        container.innerHTML = renderToStaticMarkup(
            <FeatureHelpProvider>
                <ProductVariantsTab />
            </FeatureHelpProvider>,
        );

        expect(container.textContent).toContain('生成规格');
        expect(container.textContent).toContain('导入规格');
        expect(container.textContent).toContain('单盒、整条');
    });
});

it.each(['digital', 'physical'])(
    'keeps each %s SKU price, cost and inventory settings in its own sales row',
    domain => {
        editorState.effectiveFulfillmentType = domain;
        editorState.variants = [0, 1].map(index => ({
            id: `variant-${index}`,
            name: `规格 ${index}`,
            sku: `sku-${index}`,
            price: String(100 + index),
            costPrice: '20',
            stockOnHand: 0,
            stockAllocated: 0,
            enabled: true,
            digitalDeliveryMode: 'manual_service',
            digitalStockPolicy: 'limited',
            optionIds: [],
        }));
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
            <FeatureHelpProvider>
                <ProductVariantsTab />
            </FeatureHelpProvider>,
        );
        expect(host.textContent).toContain('规格、价格与库存');
        const rows = host.querySelectorAll('.product-editor-sale-row');
        expect(rows).toHaveLength(2);
        rows.forEach((row, index) => {
            expect(row.querySelector(`[aria-label="规格 ${index + 1} 售价"]`)).not.toBeNull();
            expect(row.querySelector(`[aria-label="规格 ${index + 1} 成本"]`)).not.toBeNull();
            expect(
                row.querySelector(`[data-domain="${domain}"][data-index="${index}"][data-inline="true"]`),
            ).not.toBeNull();
            expect(row.querySelector('.product-editor-variant-more summary')!.textContent).toBe(
                '更多销售设置',
            );
        });
        editorState.variants = [];
    },
);
