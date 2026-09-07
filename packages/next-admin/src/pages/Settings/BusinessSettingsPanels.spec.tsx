// @vitest-environment jsdom

import type { ReactElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';

import { ConfirmDialogContext, type RequestConfirmation } from '../../components/confirm-dialog-context';
import {
    DELETE_BUSINESS_COUNTRY_MUTATION,
    DELETE_BUSINESS_TAX_CATEGORY_MUTATION,
    DELETE_BUSINESS_TAX_RATE_MUTATION,
    DELETE_BUSINESS_ZONE_MUTATION,
    UPDATE_BUSINESS_CHANNEL_MUTATION,
    type BusinessSettingsResult,
} from '../../graphql/management.graphql';

import { BusinessBasicsPanel } from './BusinessSettingsPanels';

const apolloMocks = vi.hoisted(() => ({
    useMutation: vi.fn(),
    useQuery: vi.fn(),
}));
const sensitiveActionContextMock = vi.hoisted(() =>
    vi.fn((currentPassword: string) => ({
        headers: { 'x-vendure-sensitive-action-password': currentPassword },
    })),
);

vi.mock('@apollo/client/react', () => apolloMocks);
vi.mock('../../apollo', () => ({ sensitiveActionContext: sensitiveActionContextMock }));

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
    channels: {
        items: [
            {
                id: 'channel-1',
                code: 'malaysia-store',
                defaultTaxZone: { id: 'zone-1' },
                defaultShippingZone: { id: 'zone-1' },
            },
        ],
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

    it('sends explicit nulls for cleared default Zones and verifies the persisted server state', async () => {
        const persistedSettings: BusinessSettingsResult = {
            ...businessSettings,
            activeChannel: {
                ...businessSettings.activeChannel,
                defaultTaxZone: null,
                defaultShippingZone: null,
            },
        };
        const updateChannel = vi.fn().mockResolvedValue({
            data: {
                updateChannel: {
                    __typename: 'Channel',
                    ...persistedSettings.activeChannel,
                },
            },
        });
        const onChanged = vi.fn().mockResolvedValue(undefined);
        refetch.mockResolvedValue({ data: persistedSettings });
        apolloMocks.useMutation.mockImplementation(document =>
            document === UPDATE_BUSINESS_CHANNEL_MUTATION
                ? [updateChannel, { loading: false }]
                : [vi.fn(), { loading: false }],
        );

        await act(async () => {
            root.render(
                <FeatureHelpProvider>
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <BusinessBasicsPanel onChanged={onChanged} onError={() => undefined} />
                    </ConfirmDialogContext.Provider>
                </FeatureHelpProvider>,
            );
        });

        const taxZoneSelect = findFieldSelect('默认计税区域');
        const shippingZoneSelect = findFieldSelect('默认配送区域');
        await act(async () => {
            taxZoneSelect.value = '';
            taxZoneSelect.dispatchEvent(new Event('change', { bubbles: true }));
            shippingZoneSelect.value = '';
            shippingZoneSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const saveButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '保存基础参数',
        );
        expect(saveButton).toBeDefined();
        await act(async () => saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(updateChannel).toHaveBeenCalledWith(
            expect.objectContaining({
                variables: expect.objectContaining({
                    input: expect.objectContaining({
                        defaultTaxZoneId: null,
                        defaultShippingZoneId: null,
                    }),
                }),
                context: { adminFeedback: false },
            }),
        );
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(onChanged).toHaveBeenCalledWith('当前店铺的语言、币种和业务参数已更新');
    });

    it('reports a persistence error instead of success when the server returns old settings', async () => {
        const updateChannel = vi.fn().mockResolvedValue({
            data: {
                updateChannel: {
                    __typename: 'Channel',
                    ...businessSettings.activeChannel,
                },
            },
        });
        const onChanged = vi.fn().mockResolvedValue(undefined);
        const onError = vi.fn();
        apolloMocks.useMutation.mockImplementation(document =>
            document === UPDATE_BUSINESS_CHANNEL_MUTATION
                ? [updateChannel, { loading: false }]
                : [vi.fn(), { loading: false }],
        );

        await act(async () => {
            root.render(
                <FeatureHelpProvider>
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <BusinessBasicsPanel onChanged={onChanged} onError={onError} />
                    </ConfirmDialogContext.Provider>
                </FeatureHelpProvider>,
            );
        });

        const taxZoneSelect = findFieldSelect('默认计税区域');
        await act(async () => {
            taxZoneSelect.value = '';
            taxZoneSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const saveButton = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '保存基础参数',
        );
        await act(async () => saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(onError).toHaveBeenCalledWith('设置未真正保存，服务端回读仍是旧值：默认计税区域');
        expect(refetch).not.toHaveBeenCalled();
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('collects the password in the delete confirmation and sends it with each mutation', async () => {
        const requestConfirmation = vi
            .fn<RequestConfirmation>()
            .mockResolvedValue({ currentPassword: 'Current123!' });
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
        const deletionReadySettings: BusinessSettingsResult = {
            ...businessSettings,
            channels: {
                items: businessSettings.channels.items.map(channel => ({
                    ...channel,
                    defaultTaxZone: null,
                    defaultShippingZone: null,
                })),
            },
            taxRates: {
                ...businessSettings.taxRates,
                items: businessSettings.taxRates.items.map(rate => ({
                    ...rate,
                    zone: { id: 'zone-other', name: '其他区域' },
                })),
            },
        };
        apolloMocks.useQuery.mockReturnValue({
            data: deletionReadySettings,
            error: undefined,
            fetchMore: vi.fn(),
            loading: false,
            refetch,
        });

        await act(async () => {
            root.render(
                <FeatureHelpProvider>
                    <ConfirmDialogContext.Provider value={requestConfirmation}>
                        <BusinessBasicsPanel onChanged={async () => undefined} onError={() => undefined} />
                    </ConfirmDialogContext.Provider>
                </FeatureHelpProvider>,
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
            expect(options).toMatchObject({
                confirmLabel: '验证并删除',
                tone: 'danger',
                requireCurrentPassword: true,
            });
        }
        expect(sensitiveActionContextMock).toHaveBeenCalledTimes(4);
        expect(sensitiveActionContextMock).toHaveBeenCalledWith('Current123!');
        const context = { headers: { 'x-vendure-sensitive-action-password': 'Current123!' } };
        expect(deleteCategory).toHaveBeenCalledWith({
            variables: { id: 'category-1' },
            context: {
                ...context,
                adminFeedback: expect.objectContaining({ target: '税务分类“标准商品”' }),
            },
        });
        expect(deleteRate).toHaveBeenCalledWith({
            variables: { id: 'rate-1' },
            context: {
                ...context,
                adminFeedback: expect.objectContaining({ target: '税率“标准商品 · 马来西亚区域 · 6%”' }),
            },
        });
        expect(deleteZone).toHaveBeenCalledWith({
            variables: { id: 'zone-1' },
            context: {
                ...context,
                adminFeedback: expect.objectContaining({ target: '业务区域“马来西亚区域”' }),
            },
        });
        expect(deleteCountry).toHaveBeenCalledWith({
            variables: { id: 'country-1' },
            context: {
                ...context,
                adminFeedback: expect.objectContaining({ target: '国家或地区“马来西亚”' }),
            },
        });
    });

    it('names every loaded channel and tax rate blocking a zone deletion before asking for a password', async () => {
        const requestConfirmation = vi.fn<RequestConfirmation>();
        const deleteZone = vi.fn();
        const onError = vi.fn();
        apolloMocks.useMutation.mockImplementation(document =>
            document === DELETE_BUSINESS_ZONE_MUTATION
                ? [deleteZone, { loading: false }]
                : [vi.fn(), { loading: false }],
        );

        await act(async () => {
            root.render(
                <FeatureHelpProvider>
                    <ConfirmDialogContext.Provider value={requestConfirmation}>
                        <BusinessBasicsPanel onChanged={async () => undefined} onError={onError} />
                    </ConfirmDialogContext.Provider>
                </FeatureHelpProvider>,
            );
        });
        const button = container.querySelector<HTMLButtonElement>(
            'button[aria-label="删除区域马来西亚区域"]',
        );
        await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(requestConfirmation).not.toHaveBeenCalled();
        expect(deleteZone).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(
            expect.stringContaining('店铺 Channel“malaysia-store”（默认税务区域、默认配送区域）'),
        );
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('税率“标准商品 · 马来西亚区域 · 6%”'));
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('先把这些店铺的默认区域和税率改绑'));
    });
});

function renderToStaticMarkup(element: ReactElement) {
    return renderMarkup(<FeatureHelpProvider>{element}</FeatureHelpProvider>);
}

function findFieldSelect(label: string) {
    const field = Array.from(container.querySelectorAll('label')).find(element =>
        element.textContent?.includes(label),
    );
    const select = field?.querySelector('select');
    if (!select) throw new Error(`找不到字段：${label}`);
    return select;
}
