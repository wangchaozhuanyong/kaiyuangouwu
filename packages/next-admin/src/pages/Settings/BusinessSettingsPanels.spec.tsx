// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialogContext, type RequestConfirmation } from '../../components/confirm-dialog-context';
import {
    DELETE_BUSINESS_COUNTRY_MUTATION,
    DELETE_BUSINESS_TAX_CATEGORY_MUTATION,
    DELETE_BUSINESS_TAX_RATE_MUTATION,
    DELETE_BUSINESS_ZONE_MUTATION,
    type BusinessSettingsResult,
} from '../../graphql/management.graphql';

import { BusinessBasicsPanel } from './BusinessSettingsPanels';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));

vi.mock('@apollo/client/react', () => apolloMocks);

const businessSettings: BusinessSettingsResult = {
    activeChannel: {
        id: 'channel-1',
        code: 'malaysia-store',
        defaultLanguageCode: 'zh_Hans',
        availableLanguageCodes: ['zh_Hans', 'en'],
        defaultCurrencyCode: 'MYR',
        availableCurrencyCodes: ['MYR', 'CNY'],
        pricesIncludeTax: true,
        trackInventory: true,
        outOfStockThreshold: 0,
        customFields: null,
        defaultTaxZone: { id: 'zone-1', name: '马来西亚区域' },
        defaultShippingZone: { id: 'zone-1', name: '马来西亚区域' },
    },
    globalSettings: {
        availableLanguages: ['zh_Hans', 'en'],
        trackInventory: true,
        outOfStockThreshold: 0,
    },
    zones: {
        totalItems: 1,
        items: [
            {
                id: 'zone-1',
                name: '马来西亚区域',
                members: [{ id: 'country-1', code: 'MY', name: '马来西亚', enabled: true }],
            },
        ],
    },
    countries: {
        totalItems: 1,
        items: [{ id: 'country-1', code: 'MY', name: '马来西亚', enabled: true }],
    },
    taxCategories: {
        totalItems: 1,
        items: [{ id: 'category-1', name: '标准商品', isDefault: true }],
    },
    taxRates: {
        totalItems: 1,
        items: [
            {
                id: 'rate-1',
                name: '标准商品 · 马来西亚区域 · 6%',
                enabled: true,
                value: 6,
                category: { id: 'category-1', name: '标准商品' },
                zone: { id: 'zone-1', name: '马来西亚区域' },
            },
        ],
    },
};

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;
let refetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    refetch = vi.fn().mockResolvedValue({ data: businessSettings });
    apolloMocks.useQuery.mockReturnValue({
        data: businessSettings,
        error: undefined,
        fetchMore: vi.fn(),
        loading: false,
        refetch,
    });
    apolloMocks.useMutation.mockReturnValue([vi.fn(), { loading: false }]);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
});

describe('BusinessBasicsPanel', () => {
    it('uses guided choices instead of asking operators to remember language and currency codes', () => {
        const html = renderToStaticMarkup(
            <ConfirmDialogContext.Provider value={async () => false}>
                <BusinessBasicsPanel onChanged={async () => undefined} onError={() => undefined} />
            </ConfirmDialogContext.Provider>,
        );

        expect(html).toContain('按业务选项配置，不需要记代码');
        expect(html).toContain('平台可用语言');
        expect(html).toContain('店铺内容语言');
        expect(html).toContain('选择要添加的币种');
        expect(html).toContain('请选择要创建的税类');
        expect(html).toContain('请选择国家/地区');
        expect(html).toContain('请选择要添加的国家/地区');
        expect(html).not.toContain('placeholder="zh_Hans, en"');
        expect(html).not.toContain('placeholder="CNY, USD"');
    });

    it('keeps deletion confirmation local and delegates password enforcement to Apollo', async () => {
        const requestConfirmation = vi.fn<RequestConfirmation>().mockResolvedValue({});
        const deleteCountry = vi.fn().mockResolvedValue({
            data: { deleteCountry: { result: 'DELETED', message: null } },
        });
        const deleteCategory = vi.fn().mockResolvedValue({
            data: { deleteTaxCategory: { result: 'DELETED', message: null } },
        });
        const deleteRate = vi.fn().mockResolvedValue({
            data: { deleteTaxRate: { result: 'DELETED', message: null } },
        });
        const deleteZone = vi.fn().mockResolvedValue({
            data: { deleteZone: { result: 'DELETED', message: null } },
        });
        apolloMocks.useMutation.mockImplementation(document => {
            if (document === DELETE_BUSINESS_COUNTRY_MUTATION) return [deleteCountry, { loading: false }];
            if (document === DELETE_BUSINESS_TAX_CATEGORY_MUTATION)
                return [deleteCategory, { loading: false }];
            if (document === DELETE_BUSINESS_TAX_RATE_MUTATION) return [deleteRate, { loading: false }];
            if (document === DELETE_BUSINESS_ZONE_MUTATION) return [deleteZone, { loading: false }];
            return [vi.fn(), { loading: false }];
        });

        await act(async () => {
            root.render(
                <ConfirmDialogContext.Provider value={requestConfirmation}>
                    <BusinessBasicsPanel onChanged={async () => undefined} onError={() => undefined} />
                </ConfirmDialogContext.Provider>,
            );
        });

        for (const label of [
            '删除税类标准商品',
            '删除税率标准商品 · 马来西亚区域 · 6%',
            '删除区域马来西亚区域',
            '删除马来西亚',
        ]) {
            const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
            expect(button, label).not.toBeNull();
            await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        }

        expect(requestConfirmation).toHaveBeenCalledTimes(4);
        for (const [options] of requestConfirmation.mock.calls) {
            expect(options).toMatchObject({ tone: 'danger' });
            expect(options).not.toHaveProperty('requireCurrentPassword');
        }
        expect(deleteCategory).toHaveBeenCalledWith({ variables: { id: 'category-1' } });
        expect(deleteRate).toHaveBeenCalledWith({ variables: { id: 'rate-1' } });
        expect(deleteZone).toHaveBeenCalledWith({ variables: { id: 'zone-1' } });
        expect(deleteCountry).toHaveBeenCalledWith({ variables: { id: 'country-1' } });
    });
});
