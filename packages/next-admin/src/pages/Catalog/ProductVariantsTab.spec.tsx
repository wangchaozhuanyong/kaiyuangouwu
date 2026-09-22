// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ProductVariantsTab } from './ProductVariantsTab';

const editorState = vi.hoisted(() => ({
    activeCurrencyCode: 'CNY',
    effectiveFulfillmentType: 'physical',
    variants: [],
    selectedOptionGroupIds: [] as string[],
    knownOptionGroups: {} as Record<string, any>,
    optionGroupSearch: '',
    optionGroupPage: 0,
    optionGroupPageSize: 20,
    optionGroupsData: { productOptionGroups: { items: [], totalItems: 0 } },
    catalogChannelsData: {
        activeChannel: {
            id: 'default',
            code: '__default_channel__',
            customFields: null as {
                storefrontNameZh?: string | null;
                storefrontNameEn?: string | null;
            } | null,
        },
        channels: {
            items: [
                {
                    id: 'default',
                    code: '__default_channel__',
                    defaultCurrencyCode: 'CNY',
                    customFields: null,
                },
                {
                    id: 'meiyijia',
                    code: 'meiyijia',
                    defaultCurrencyCode: 'MYR',
                    customFields: { storefrontNameZh: '美宜佳', storefrontNameEn: 'MYNEWS' },
                },
            ],
        },
    },
    selectedChannelIds: [] as string[],
    setSelectedChannelIds: vi.fn(),
    formErrors: {},
    isCreateMode: false,
    productData: { product: { id: 'product-1' } },
    isOptionTemplatesOpen: false,
    setIsOptionTemplatesOpen: vi.fn(),
    isQuickCreateSpecOpen: false,
    setIsQuickCreateSpecOpen: vi.fn(),
    handleApplyOptionGroup: vi.fn(),
}));

vi.mock('./ProductEditorContext', () => ({ useProductEditor: () => editorState }));

describe('ProductVariantsTab store isolation', () => {
    it('shows only the selected store as the product owner and offers no cross-store checkbox', () => {
        editorState.catalogChannelsData.activeChannel = {
            id: 'meiyijia',
            code: 'my-malaysia',
            customFields: { storefrontNameZh: '美宜佳', storefrontNameEn: 'MYNEWS' },
        };
        const container = document.createElement('div');
        container.innerHTML = renderToStaticMarkup(
            <FeatureHelpProvider>
                <ProductVariantsTab />
            </FeatureHelpProvider>,
        );

        expect(container.textContent).toContain('本商品仅属于 美宜佳');
        expect(container.textContent).toContain('单店独立');
        expect(container.textContent).toContain('重新创建或导入独立副本');
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
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

        expect(container.textContent).toContain('快速新建规格');
        expect(container.textContent).toContain('商品专属规格');
        expect(container.textContent).toContain('单盒 / 整条');
    });
});
