import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AccountSecurityPage } from './account-security-page';
import { AddressesPage } from './addresses-page';
import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { ActiveCustomer, CustomerDeliveryEmail, MarketConfig } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const market: MarketConfig = {
    code: 'addresses-test-market',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: 'China',
};

const mockCustomer: ActiveCustomer = {
    id: 'customer-1',
    firstName: '测试',
    lastName: '用户',
    emailAddress: 'ppfzj1314@gmail.com',
    phoneNumber: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};

const mockDeliveryEmails: CustomerDeliveryEmail[] = [
    {
        id: 'email-1',
        emailAddress: 'ppfzj1314@gmail.com',
        label: '交付邮箱',
        isDefault: true,
        confirmedAt: '2026-09-01T00:00:00.000Z',
    },
];

function createMockApi(): ShopApi {
    return {
        activeStoreCommerceMode: vi.fn().mockResolvedValue('DIGITAL_ONLY'),
        myDeliveryEmails: vi.fn().mockResolvedValue(mockDeliveryEmails),
        activeCustomer: vi.fn().mockResolvedValue(mockCustomer),
        saveDeliveryEmail: vi.fn().mockResolvedValue(mockDeliveryEmails[0]),
        deleteDeliveryEmail: vi.fn().mockResolvedValue(true),
        setDefaultDeliveryEmail: vi.fn().mockResolvedValue(mockDeliveryEmails[0]),
        createAddress: vi.fn(),
        updateAddress: vi.fn(),
        deleteAddress: vi.fn(),
    } as unknown as ShopApi;
}

describe('AddressesPage zero-flicker rendering', () => {
    it('directly renders delivery email without flashing physical address empty state or "新增地址" button in DIGITAL_ONLY mode', () => {
        const queryClient = createStorefrontQueryClient();
        const api = createMockApi();

        queryClient.setQueryData(
            storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
            'DIGITAL_ONLY',
        );
        queryClient.setQueryData(
            storefrontQueryKeys.deliveryEmails(
                storefrontQueryKeys.market(market),
                languageCodeFor('zh'),
                mockCustomer.id,
            ),
            mockDeliveryEmails,
        );

        const markup = renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(AddressesPage, {
                    api,
                    customer: mockCustomer,
                    market,
                    availableCountries: [{ code: 'CN', name: '中国' }],
                    language: 'zh',
                    commerceMode: 'DIGITAL_ONLY',
                    onBack: vi.fn(),
                    onCustomerChange: vi.fn(),
                    onNotify: vi.fn(),
                }),
            ),
        );

        expect(markup).toContain('ppfzj1314@gmail.com');
        expect(markup).toContain('收货信息');
        expect(markup).toContain('aria-label="新增交付邮箱"');
        expect(markup).not.toContain('还没有收货地址');
        expect(markup).not.toContain('新增地址');
        expect(markup).not.toContain('address-type-tabs');
        expect(markup).not.toContain('实际地址');
    });

    it('renders delivery email empty state when customer has no delivery emails in DIGITAL_ONLY mode', () => {
        const queryClient = createStorefrontQueryClient();
        const api = createMockApi();

        queryClient.setQueryData(
            storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
            'DIGITAL_ONLY',
        );
        queryClient.setQueryData(
            storefrontQueryKeys.deliveryEmails(
                storefrontQueryKeys.market(market),
                languageCodeFor('zh'),
                mockCustomer.id,
            ),
            [],
        );

        const markup = renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(AddressesPage, {
                    api,
                    customer: mockCustomer,
                    market,
                    availableCountries: [{ code: 'CN', name: '中国' }],
                    language: 'zh',
                    commerceMode: 'DIGITAL_ONLY',
                    onBack: vi.fn(),
                    onCustomerChange: vi.fn(),
                    onNotify: vi.fn(),
                }),
            ),
        );

        expect(markup).toContain('还没有交付邮箱');
        expect(markup).toContain('新增交付邮箱');
        expect(markup).not.toContain('还没有收货地址');
        expect(markup).not.toContain('新增地址');
    });

    it('renders physical addresses and "新增地址" when in PHYSICAL_ONLY mode', () => {
        const queryClient = createStorefrontQueryClient();
        const api = createMockApi();

        queryClient.setQueryData(
            storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
            'PHYSICAL_ONLY',
        );

        const markup = renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(AddressesPage, {
                    api,
                    customer: mockCustomer,
                    market,
                    availableCountries: [{ code: 'CN', name: '中国' }],
                    language: 'zh',
                    commerceMode: 'PHYSICAL_ONLY',
                    onBack: vi.fn(),
                    onCustomerChange: vi.fn(),
                    onNotify: vi.fn(),
                }),
            ),
        );

        expect(markup).toContain('收货地址');
        expect(markup).toContain('还没有收货地址');
        expect(markup).toContain('新增地址');
        expect(markup).toContain('aria-label="新增地址"');
        expect(markup).not.toContain('address-type-tabs');
        expect(markup).not.toContain('交付邮箱');
    });

    it('renders tabs in HYBRID mode', () => {
        const queryClient = createStorefrontQueryClient();
        const api = createMockApi();

        queryClient.setQueryData(
            storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
            'HYBRID',
        );
        queryClient.setQueryData(
            storefrontQueryKeys.deliveryEmails(
                storefrontQueryKeys.market(market),
                languageCodeFor('zh'),
                mockCustomer.id,
            ),
            mockDeliveryEmails,
        );

        const markup = renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(AddressesPage, {
                    api,
                    customer: mockCustomer,
                    market,
                    availableCountries: [{ code: 'CN', name: '中国' }],
                    language: 'zh',
                    commerceMode: 'HYBRID',
                    onBack: vi.fn(),
                    onCustomerChange: vi.fn(),
                    onNotify: vi.fn(),
                }),
            ),
        );

        expect(markup).toContain('address-type-tabs');
        expect(markup).toContain('实际地址');
        expect(markup).toContain('交付邮箱');
    });

    it('renders loading skeleton when commerceMode is not yet available, preventing premature error state', () => {
        const queryClient = createStorefrontQueryClient();
        const api = createMockApi();

        const markup = renderToStaticMarkup(
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(AddressesPage, {
                    api,
                    customer: mockCustomer,
                    market,
                    availableCountries: [{ code: 'CN', name: '中国' }],
                    language: 'zh',
                    commerceMode: null,
                    onBack: vi.fn(),
                    onCustomerChange: vi.fn(),
                    onNotify: vi.fn(),
                }),
            ),
        );

        expect(markup).toContain('正在加载收货信息');
        expect(markup).not.toContain('还没有收货地址');
        expect(markup).not.toContain('新增地址');
    });
});

describe('AccountSecurityPage commerceMode adaptation', () => {
    it('adapts address entry to "交付邮箱管理" in DIGITAL_ONLY mode', () => {
        const markup = renderToStaticMarkup(
            createElement(AccountSecurityPage, {
                customer: mockCustomer,
                language: 'zh',
                storefrontName: '测试商城',
                commerceMode: 'DIGITAL_ONLY',
                onBack: vi.fn(),
                onAvatarChange: vi.fn(),
                onLogout: vi.fn(),
            }),
        );

        expect(markup).toContain('交付邮箱管理');
        expect(markup).toContain('管理数字商品交付邮箱');
        expect(markup).toContain('去管理');
        expect(markup).not.toContain('收货地址管理');
        expect(markup).not.toContain('0 个地址');
    });

    it('retains "收货地址管理" in PHYSICAL_ONLY or HYBRID mode', () => {
        const markup = renderToStaticMarkup(
            createElement(AccountSecurityPage, {
                customer: mockCustomer,
                language: 'zh',
                storefrontName: '测试商城',
                commerceMode: 'HYBRID',
                onBack: vi.fn(),
                onAvatarChange: vi.fn(),
                onLogout: vi.fn(),
            }),
        );

        expect(markup).toContain('收货地址管理');
        expect(markup).toContain('管理实物商品默认收货地址');
        expect(markup).toContain('0 个地址');
    });
});
