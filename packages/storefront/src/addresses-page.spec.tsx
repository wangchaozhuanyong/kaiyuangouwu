// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSecurityPage } from './account-security-page';
import { AddressesPage } from './addresses-page';
import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { ActiveCustomer, CustomerAddress, CustomerDeliveryEmail, MarketConfig } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
                    availableProvinces: [{ code: 'CN-GD', name: '广东省', countryCode: 'CN' }],
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

describe('AddressesPage checkout selection and editing', () => {
    const address: CustomerAddress = {
        id: 'address-1',
        fullName: '原收货人',
        phoneNumber: '13800138000',
        streetLine1: '南山区科技园',
        streetLine2: 'A栋12楼',
        city: '深圳市',
        province: 'CN-GD',
        postalCode: '518000',
        defaultShippingAddress: true,
        defaultBillingAddress: false,
        country: { code: 'CN', name: '中国' },
    };
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let client: ReturnType<typeof createStorefrontQueryClient>;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        client = createStorefrontQueryClient();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        container.remove();
        vi.unstubAllGlobals();
    });
    async function interact(action: () => void = () => undefined) {
        await act(async () => {
            action();
            await Promise.resolve();
        });
    }
    function element<T extends Element = HTMLElement>(selector: string): T {
        const value = container.querySelector<T>(selector);
        if (!value) throw new Error(`Missing address element: ${selector}`);
        return value;
    }
    const button = (text: string) => {
        const value = [...container.querySelectorAll('button')].find(item => item.textContent === text);
        if (!value) throw new Error(`Missing address action: ${text}`);
        return value;
    };
    function mount(overrides: Partial<ComponentProps<typeof AddressesPage>> = {}) {
        const customer = { ...mockCustomer, addresses: [address] };
        const api = {
            ...createMockApi(),
            activeCustomer: vi.fn().mockResolvedValue(customer),
            updateAddress: vi.fn().mockResolvedValue(address),
            createAddress: vi.fn().mockResolvedValue(address),
        };
        const props: ComponentProps<typeof AddressesPage> = {
            api: api as unknown as ShopApi,
            customer,
            market,
            availableCountries: [
                { code: 'CN', name: '中国' },
                { code: 'MY', name: 'Malaysia' },
            ],
            availableProvinces: [
                { code: 'CN-GD', name: '广东省', countryCode: 'CN' },
                { code: 'MY-14', name: 'Kuala Lumpur', countryCode: 'MY' },
            ],
            language: 'zh',
            commerceMode: 'PHYSICAL_ONLY',
            onBack: vi.fn(),
            onCustomerChange: vi.fn(),
            onNotify: vi.fn(),
            selection: { addressId: address.id, onUse: vi.fn() },
            ...overrides,
        };
        const render = (next = props) =>
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client }, createElement(AddressesPage, next)),
                ),
            );
        render();
        return { api, props, render };
    }
    async function fill(name: string, value: string) {
        await interact(() => {
            const input = element<HTMLInputElement>(`input[name="${name}"]`);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }
    async function paste(value: string) {
        await interact(() => {
            const input = element<HTMLTextAreaElement>('.address-smart-paste textarea');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await interact(() => button('识别并填写').click());
    }
    async function save() {
        await interact(() =>
            element('form.address-form').dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true }),
            ),
        );
    }

    it('selects for this checkout only, keeping default unchanged until the user confirms', async () => {
        const second = { ...address, id: 'address-2', fullName: '第二收货人', defaultShippingAddress: false };
        const { api, props } = mount({ customer: { ...mockCustomer, addresses: [address, second] } });
        expect(container.textContent).toContain('选择收货地址');
        expect(container.textContent).toContain('本次使用');
        await interact(() => element<HTMLInputElement>('input[value="address-2"]').click());
        expect(props.selection?.onUse).not.toHaveBeenCalled();
        expect(api.updateAddress).not.toHaveBeenCalled();
        await interact(() => button('使用此地址').click());
        expect(props.selection?.onUse).toHaveBeenCalledWith(second);
        expect(address.defaultShippingAddress).toBe(true);
    });

    it('opens the first address form once and leaves it closed after cancellation and refresh', async () => {
        const { render, props } = mount({ customer: mockCustomer });
        expect(container.textContent).toContain('新增收货地址');
        await interact(() => element<HTMLButtonElement>('.sheet > header button').click());
        render({ ...props, customer: { ...mockCustomer } });
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        await interact(() => button('新增地址').click());
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('fills recognized text for review without saving and keeps the selected country', async () => {
        const { api, props } = mount({ customer: mockCustomer });
        await paste('张三，13800138000，广东省深圳市南山区科技园 518000');
        expect(element<HTMLInputElement>('input[name="fullName"]').value).toBe('张三');
        expect(element<HTMLSelectElement>('select[name="province"]').value).toBe('CN-GD');
        expect(element<HTMLInputElement>('input[name="city"]').value).toBe('深圳市');
        expect(container.textContent).toContain('已填入，请核对后保存');
        expect(api.createAddress).not.toHaveBeenCalled();
        expect(props.selection?.onUse).not.toHaveBeenCalled();
        await save();
        expect(api.createAddress).toHaveBeenCalledWith(
            expect.objectContaining({ fullName: '张三', defaultShippingAddress: true }),
        );
        expect(props.onCustomerChange).toHaveBeenCalled();
        expect(props.selection?.onUse).toHaveBeenCalledWith(address);
    });

    it('does not erase existing fields when parsing only a phone number', async () => {
        mount({ selection: { addressId: address.id, editAddress: true, onUse: vi.fn() } });
        await paste('13900139000');
        expect(element<HTMLInputElement>('input[name="phoneNumber"]').value).toBe('13900139000');
        expect(element<HTMLInputElement>('input[name="fullName"]').value).toBe(address.fullName);
        expect(element<HTMLInputElement>('input[name="streetLine2"]').value).toBe('A栋12楼');
        expect(element<HTMLInputElement>('input[name="city"]').value).toBe(address.city);
    });

    it('retains all entered values and stays in the editor on save failure', async () => {
        const { api, props } = mount({
            selection: { addressId: address.id, editAddress: true, onUse: vi.fn() },
        });
        vi.mocked(api.updateAddress).mockRejectedValueOnce(new Error('INTERNAL_FAILURE'));
        await fill('streetLine2', 'B栋9楼');
        await save();
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(element<HTMLInputElement>('input[name="streetLine2"]').value).toBe('B栋9楼');
        expect(container.textContent).not.toContain('INTERNAL_FAILURE');
        expect(props.selection?.onUse).not.toHaveBeenCalled();
        await save();
        expect(props.selection?.onUse).toHaveBeenCalledWith(address);
    });

    it('locks the form and prevents closing while a save is pending', async () => {
        const { api, props } = mount({
            selection: { addressId: address.id, editAddress: true, onUse: vi.fn() },
        });
        let finishSave = (_value: CustomerAddress) => undefined as void;
        api.updateAddress.mockImplementationOnce(
            () =>
                new Promise<CustomerAddress>(resolve => {
                    finishSave = resolve;
                }),
        );
        await save();
        expect(element<HTMLFieldSetElement>('.address-form-fields').disabled).toBe(true);
        expect(element<HTMLInputElement>('input[name="phoneNumber"]').matches(':disabled')).toBe(true);
        await interact(() => element<HTMLButtonElement>('.sheet > header button').click());
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(props.selection?.onUse).not.toHaveBeenCalled();
        await interact(() => finishSave(address));
        expect(props.selection?.onUse).toHaveBeenCalledWith(address);
    });

    it('waits for refreshed customer data and retries a saved address without duplicating it', async () => {
        const { api, props } = mount({ customer: mockCustomer });
        vi.mocked(api.activeCustomer).mockRejectedValueOnce(new Error('NETWORK_ERROR'));
        await paste('张三，13800138000，广东省深圳市南山区科技园 518000');
        await save();
        expect(api.createAddress).toHaveBeenCalledTimes(1);
        expect(props.selection?.onUse).not.toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        await save();
        expect(api.createAddress).toHaveBeenCalledTimes(1);
        expect(api.updateAddress).toHaveBeenCalledWith(expect.objectContaining({ id: address.id }));
        const customerCall = (props.onCustomerChange as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        const selectionCall = (props.selection?.onUse as ReturnType<typeof vi.fn>).mock
            .invocationCallOrder[0];
        expect(customerCall).toBeLessThan(selectionCall);
    });

    it('keeps normal account address management in the list after saving', async () => {
        const { api, props } = mount({ selection: undefined });
        expect(container.textContent).not.toContain('使用此地址');
        await interact(() => button('编辑').click());
        expect(button('保存地址')).toBeDefined();
        await fill('streetLine2', '新楼层');
        await save();
        expect(api.updateAddress).toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(props.onBack).not.toHaveBeenCalled();
    });

    it('opens an incomplete selection for editing instead of returning it', async () => {
        const incomplete = { ...address, phoneNumber: '' };
        const { props } = mount({ customer: { ...mockCustomer, addresses: [incomplete] } });
        await interact(() => button('完善并使用此地址').click());
        expect(element<HTMLInputElement>('input[name="phoneNumber"]').value).toBe('');
        expect(props.selection?.onUse).not.toHaveBeenCalled();
    });

    it('keeps the Malaysian country and existing state when pasted text has a Chinese province', async () => {
        const myAddress = { ...address, country: { code: 'MY', name: 'Malaysia' }, province: 'MY-14' };
        mount({
            customer: { ...mockCustomer, addresses: [myAddress] },
            selection: { addressId: address.id, editAddress: true, onUse: vi.fn() },
        });
        await paste('张三，13800138000，广东省深圳市南山区科技园 518000');
        expect(element<HTMLSelectElement>('select[name="countryCode"]').value).toBe('MY');
        expect(element<HTMLSelectElement>('select[name="province"]').value).toBe('MY-14');
    });

    it('uses English throughout the selection and editing actions', async () => {
        mount({ language: 'en' });
        expect(container.textContent).toContain('Choose shipping address');
        await interact(() => button('Edit').click());
        expect(container.textContent).toContain('Save and use');
        expect(container.textContent).toContain('Recognize and fill');
        expect(container.textContent).not.toContain('保存');
    });
});
