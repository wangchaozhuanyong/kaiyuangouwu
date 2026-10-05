// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { ProductMoreSettings } from './ProductMoreSettings';
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
