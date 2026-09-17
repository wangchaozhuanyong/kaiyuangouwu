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
        activeChannel: { id: 'default', code: '__default_channel__' },
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
    isCreateMode: false,
    productData: { product: { id: 'product-1' } },
    isOptionTemplatesOpen: false,
    setIsOptionTemplatesOpen: vi.fn(),
    isQuickCreateSpecOpen: false,
    setIsQuickCreateSpecOpen: vi.fn(),
    handleApplyOptionGroup: vi.fn(),
}));

vi.mock('./ProductEditorContext', () => ({ useProductEditor: () => editorState }));

describe('ProductVariantsTab explicit store assignments', () => {
    it.each([
        ['default', ['meiyijia']],
        ['meiyijia', ['meiyijia']],
        ['default', ['default', 'meiyijia']],
    ] as const)(
        'shows actual assignments when the active store is %s and membership is %j',
        (activeId, ids) => {
            editorState.catalogChannelsData.activeChannel = {
                id: activeId,
                code: activeId === 'default' ? '__default_channel__' : '美宜佳',
            };
            editorState.selectedChannelIds = [...ids];
            const container = document.createElement('div');
            container.innerHTML = renderToStaticMarkup(
                <FeatureHelpProvider>
                    <ProductVariantsTab />
                </FeatureHelpProvider>,
            );

            for (const channel of editorState.catalogChannelsData.channels.items) {
                const label = Array.from(container.querySelectorAll('label')).find(item =>
                    item.textContent?.startsWith(channel.id === 'default' ? '默认店铺' : '美宜佳'),
                );
                expect(label?.querySelector('input')?.checked).toBe(
                    editorState.selectedChannelIds.includes(channel.id),
                );
            }
            expect(container.textContent).toContain(`已发布 ${ids.length} 个店铺`);
        },
    );

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
