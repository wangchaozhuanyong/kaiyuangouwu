import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CircleCheck, Mail, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { smartParseAddressText } from './address-parser';
import { provinceCodeForValue, provinceDisplayName, provincesForCountry } from './address-region-options';
import { ShopApi } from './api';
import { isCompleteShippingAddress, shippingAddressInput } from './checkout-address';
import { languageCodeFor } from './i18n';
import { isInputMethodKey } from './input-method';
import {
    PUBLIC_QUERY_GC_TIME,
    PUBLIC_QUERY_STALE_TIME,
    publicQueryMeta,
    ROUTE_QUERY_STALE_TIME,
    storefrontQueryKeys,
} from './query-client';
import { PageSkeleton } from './route-loading';
import { acquireBodyScrollLock } from './scroll-lock';
import { storefrontErrorMessage } from './storefront-errors';
import { routeNavigateOptions } from './storefront-router';
import {
    ActiveCustomer,
    CustomerAddress,
    CustomerAddressInput,
    MarketConfig,
    StoreCommerceMode,
    StorefrontConfig,
    StorefrontLanguage,
    StorefrontProvince,
} from './types';

function formText(data: FormData, name: string, fallback = ''): string {
    const value = data.get(name);
    return typeof value === 'string' ? value : fallback;
}

export function AddressesPage({
    api,
    customer,
    market,
    availableCountries,
    availableProvinces = [],
    language,
    commerceMode: initialCommerceMode,
    onBack,
    selection,
    onCustomerChange,
    onNotify,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    availableCountries: StorefrontConfig['availableCountries'];
    availableProvinces?: StorefrontProvince[];
    language: StorefrontLanguage;
    commerceMode?: StoreCommerceMode | null;
    onBack: () => void;
    selection?: {
        addressId?: string;
        editAddress?: boolean;
        onUse: (address: CustomerAddress) => void;
    };
    onCustomerChange: (customer: ActiveCustomer | null) => void;
    onNotify: (message: string) => void;
}) {
    const navigate = useNavigate();
    const isZh = language === 'zh';
    const vendureLanguage = languageCodeFor(language);
    // RouteGate resolves the customer before mounting. Initialize once, so closing the
    // first-address form never reopens it when the customer/query refreshes.
    const initialAddress = selection?.editAddress
        ? (customer?.addresses?.find(address => address.id === selection.addressId) ?? null)
        : null;
    const [open, setOpen] = useState(Boolean(selection && (!customer?.addresses?.length || initialAddress)));
    const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(initialAddress);
    const [addressDraft, setAddressDraft] = useState(() =>
        shippingAddressInput(initialAddress, market.countryCode),
    );
    const [selectedAddressId, setSelectedAddressId] = useState(selection?.addressId ?? '');
    const [smartPasteText, setSmartPasteText] = useState('');
    const [parseMessage, setParseMessage] = useState('');
    const addressCountryCode = addressDraft.countryCode;
    const addressProvince = addressDraft.province;
    const setDraftField = (field: keyof CustomerAddressInput, value: string) =>
        setAddressDraft(current => ({ ...current, [field]: value }));
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [emailOpen, setEmailOpen] = useState(false);
    const [selectedTab, setSelectedTab] = useState<'physical' | 'email' | null>(null);

    const commerceModeQuery = useQuery({
        queryKey: storefrontQueryKeys.commerceMode(storefrontQueryKeys.market(market)),
        queryFn: ({ signal }) => api.activeStoreCommerceMode(signal),
        initialData: initialCommerceMode ?? undefined,
        staleTime: PUBLIC_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const commerceMode = commerceModeQuery.data ?? initialCommerceMode ?? null;

    const deliveryEmailsQueryKey = customer
        ? storefrontQueryKeys.deliveryEmails(storefrontQueryKeys.market(market), vendureLanguage, customer.id)
        : null;

    const deliveryEmailsQuery = useQuery({
        queryKey: deliveryEmailsQueryKey ?? ['storefront', 'anonymous', 'delivery-emails'],
        queryFn: ({ signal }) => api.myDeliveryEmails(signal),
        enabled: Boolean(
            customer &&
            (commerceMode === null || commerceMode === 'HYBRID' || commerceMode === 'DIGITAL_ONLY'),
        ),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const deliveryEmails = deliveryEmailsQuery.data ?? [];

    const effectiveTab: 'physical' | 'email' = selection
        ? 'physical'
        : commerceMode === 'DIGITAL_ONLY'
          ? 'email'
          : commerceMode === 'PHYSICAL_ONLY'
            ? 'physical'
            : (selectedTab ??
              (customer?.addresses?.length ? 'physical' : deliveryEmails.length ? 'email' : 'physical'));

    if (!customer) {
        return (
            <Subpage title={isZh ? '收货信息' : 'Delivery contacts'} language={language} onBack={onBack}>
                <EmptyState
                    icon={<MapPin />}
                    title={isZh ? '登录后管理地址' : 'Sign in to manage addresses'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => void navigate(routeNavigateOptions({ name: 'login' }) as never)}
                />
            </Subpage>
        );
    }

    if (!commerceMode && commerceModeQuery.isLoading) {
        return (
            <Subpage title={isZh ? '收货信息' : 'Delivery contacts'} language={language} onBack={onBack}>
                <PageSkeleton label={isZh ? '正在加载收货信息' : 'Loading delivery contacts'} />
            </Subpage>
        );
    }
    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError('');
        try {
            const input: CustomerAddressInput = {
                fullName: formText(data, 'fullName'),
                phoneNumber: formText(data, 'phoneNumber'),
                province: formText(data, 'province'),
                city: formText(data, 'city'),
                streetLine1: formText(data, 'streetLine1'),
                streetLine2: formText(data, 'streetLine2'),
                postalCode: formText(data, 'postalCode'),
                countryCode: formText(data, 'countryCode', market.countryCode),
                defaultShippingAddress:
                    !customer.addresses?.length || data.get('defaultShippingAddress') === 'on',
            };
            const savedAddress = editingAddress
                ? await api.updateAddress({ ...input, id: editingAddress.id })
                : await api.createAddress(input);
            // Keep the saved ID if refreshing fails, so retry updates instead of creating a duplicate.
            setEditingAddress(savedAddress);
            const updatedCustomer = await api.activeCustomer();
            if (!updatedCustomer?.addresses?.some(address => address.id === savedAddress.id)) {
                setFormError(
                    isZh ? '地址已保存，刷新失败，请重试' : 'Address saved. Refresh failed; please retry.',
                );
                return;
            }
            onCustomerChange(updatedCustomer);
            setOpen(false);
            setEditingAddress(null);
            onNotify(isZh ? '地址已保存' : 'Address saved');
            selection?.onUse(updatedCustomer.addresses.find(address => address.id === savedAddress.id)!);
        } catch (requestError) {
            setFormError(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '保存失败'
                      : 'Could not save address',
            );
        } finally {
            setSubmitting(false);
        }
    };
    const remove = async (id: string) => {
        if (!window.confirm(isZh ? '确定删除这个地址吗？' : 'Delete this address?')) return;
        try {
            await api.deleteAddress(id);
            onCustomerChange(await api.activeCustomer());
            onNotify(isZh ? '地址已删除' : 'Address deleted');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '删除失败'
                      : 'Could not delete address',
            );
        }
    };
    const makeDefault = async (address: CustomerAddress) => {
        try {
            await api.updateAddress({
                id: address.id,
                fullName: address.fullName ?? '',
                phoneNumber: address.phoneNumber ?? '',
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2 ?? '',
                city: address.city ?? '',
                province: address.province ?? '',
                postalCode: address.postalCode ?? '',
                countryCode: address.country.code,
                defaultShippingAddress: true,
            });
            onCustomerChange(await api.activeCustomer());
            onNotify(isZh ? '默认地址已更新' : 'Default address updated');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '设置默认地址失败'
                      : 'Could not set the default address',
            );
        }
    };
    const startEdit = (address: CustomerAddress | null) => {
        setEditingAddress(address);
        setAddressDraft(shippingAddressInput(address, market.countryCode));
        setSmartPasteText('');
        setParseMessage('');
        setFormError('');
        setOpen(true);
    };
    const saveEmail = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError('');
        try {
            await api.saveDeliveryEmail({
                emailAddress: formText(data, 'emailAddress'),
                confirmEmailAddress: formText(data, 'confirmEmailAddress'),
                label: formText(data, 'label'),
                isDefault: data.get('isDefault') === 'on',
            });
            await deliveryEmailsQuery.refetch();
            setEmailOpen(false);
            onNotify(isZh ? '交付邮箱已保存' : 'Delivery email saved');
        } catch (requestError) {
            setFormError(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '保存失败'
                      : 'Could not save email',
            );
        } finally {
            setSubmitting(false);
        }
    };
    const removeEmail = async (id: string) => {
        if (!window.confirm(isZh ? '确定删除这个交付邮箱吗？' : 'Delete this delivery email?')) return;
        try {
            await api.deleteDeliveryEmail(id);
            await deliveryEmailsQuery.refetch();
            onNotify(isZh ? '交付邮箱已删除' : 'Delivery email deleted');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '删除失败'
                      : 'Could not delete email',
            );
        }
    };
    const makeDefaultEmail = async (id: string) => {
        try {
            await api.setDefaultDeliveryEmail(id);
            await deliveryEmailsQuery.refetch();
            onNotify(isZh ? '默认交付邮箱已更新' : 'Default delivery email updated');
        } catch (requestError) {
            onNotify(
                requestError instanceof Error
                    ? storefrontErrorMessage(requestError, language)
                    : isZh
                      ? '设置默认交付邮箱失败'
                      : 'Could not set default email',
            );
        }
    };

    const selectedAddress = customer.addresses?.find(address => address.id === selectedAddressId) ?? null;
    const parseAddress = () => {
        const parsed = smartParseAddressText(smartPasteText);
        const nonEmpty = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value?.trim()));
        // The parser currently recognizes Chinese regions. Keep the chosen country and
        // never fill a foreign province into a country's managed region list.
        delete nonEmpty.countryCode;
        if (parsed.province) {
            const code = provinceCodeForValue(availableProvinces, addressCountryCode, parsed.province);
            const options = provincesForCountry(availableProvinces, addressCountryCode);
            if (options.some(province => province.code === code)) nonEmpty.province = code;
            else if (addressCountryCode !== 'CN') delete nonEmpty.province;
        }
        if (!Object.keys(nonEmpty).length) {
            setParseMessage(
                isZh
                    ? '未识别到地址内容，请手动填写'
                    : 'No address details recognized. Please fill in the form.',
            );
            return;
        }
        setAddressDraft(current => ({ ...current, ...nonEmpty }));
        setParseMessage(isZh ? '已填入，请核对后保存' : 'Filled in. Please review before saving.');
    };
    const pageTitle = selection
        ? isZh
            ? '选择收货地址'
            : 'Choose shipping address'
        : commerceMode === 'PHYSICAL_ONLY'
          ? isZh
              ? '收货地址'
              : 'Delivery addresses'
          : isZh
            ? '收货信息'
            : 'Delivery contacts';

    return (
        <main className={`page subpage addresses-page${selection ? ' is-selecting-address' : ''}`}>
            <SubHeader
                title={pageTitle}
                language={language}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => (effectiveTab === 'email' ? setEmailOpen(true) : startEdit(null))}
                        aria-label={
                            effectiveTab === 'email'
                                ? isZh
                                    ? '新增交付邮箱'
                                    : 'Add delivery email'
                                : isZh
                                  ? '新增地址'
                                  : 'Add address'
                        }
                    >
                        <Plus />
                    </button>
                }
            />
            {!selection && commerceMode === 'HYBRID' && (
                <nav
                    className="address-type-tabs"
                    aria-label={isZh ? '收货信息类型' : 'Delivery contact type'}
                >
                    <button
                        type="button"
                        className={effectiveTab === 'physical' ? 'is-active' : undefined}
                        onClick={() => setSelectedTab('physical')}
                    >
                        <MapPin />
                        {isZh ? '实际地址' : 'Physical addresses'}
                    </button>
                    <button
                        type="button"
                        className={effectiveTab === 'email' ? 'is-active' : undefined}
                        onClick={() => setSelectedTab('email')}
                    >
                        <Mail />
                        {isZh ? '交付邮箱' : 'Delivery emails'}
                    </button>
                </nav>
            )}
            {effectiveTab === 'physical' &&
                (customer.addresses?.length ? (
                    <div className="address-list">
                        {customer.addresses.map(address => (
                            <article
                                className={`address-card${selection && selectedAddressId === address.id ? ' is-selected' : ''}`}
                                key={address.id}
                            >
                                {selection && (
                                    <label className="address-selection-control">
                                        <input
                                            type="radio"
                                            name="checkoutAddress"
                                            value={address.id}
                                            checked={selectedAddressId === address.id}
                                            onChange={() => setSelectedAddressId(address.id)}
                                        />
                                        <span>
                                            {address.fullName} ·{' '}
                                            {selection.addressId === address.id
                                                ? isZh
                                                    ? '本次使用'
                                                    : 'Current address'
                                                : isZh
                                                  ? '选择此地址'
                                                  : 'Select this address'}
                                        </span>
                                    </label>
                                )}
                                <header>
                                    <strong>{address.fullName}</strong>
                                    <span>{address.phoneNumber}</span>
                                    {address.defaultShippingAddress && <em>{isZh ? '默认' : 'Default'}</em>}
                                </header>
                                <p>{addressText(address, availableProvinces)}</p>
                                {selection && !isCompleteShippingAddress(address) && (
                                    <small className="form-error">
                                        {isZh ? '请完善收货地址' : 'Complete the shipping address'}
                                    </small>
                                )}
                                <footer>
                                    <span>{address.country.name}</span>
                                    <div className="address-actions">
                                        {!address.defaultShippingAddress && (
                                            <button type="button" onClick={() => void makeDefault(address)}>
                                                <CircleCheck />
                                                {isZh ? '设为默认' : 'Make default'}
                                            </button>
                                        )}
                                        <button type="button" onClick={() => startEdit(address)}>
                                            <Pencil />
                                            {isZh ? '编辑' : 'Edit'}
                                        </button>
                                        <button type="button" onClick={() => void remove(address.id)}>
                                            <Trash2 />
                                            {isZh ? '删除' : 'Delete'}
                                        </button>
                                    </div>
                                </footer>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon={<MapPin />}
                        title={isZh ? '还没有收货地址' : 'No saved addresses'}
                        detail={isZh ? '新增地址后，结算会更方便' : 'Save an address for faster checkout'}
                        action={isZh ? '新增地址' : 'Add address'}
                        onAction={() => startEdit(null)}
                    />
                ))}
            {effectiveTab === 'email' &&
                (deliveryEmailsQuery.isLoading && !deliveryEmailsQuery.data ? (
                    <PageSkeleton label={isZh ? '正在加载交付邮箱' : 'Loading delivery emails'} />
                ) : deliveryEmails.length ? (
                    <div className="address-list delivery-email-list">
                        {deliveryEmails.map(email => (
                            <article className="address-card delivery-email-card" key={email.id}>
                                <header>
                                    <strong>{email.label || (isZh ? '交付邮箱' : 'Delivery email')}</strong>
                                    {email.isDefault && <em>{isZh ? '默认' : 'Default'}</em>}
                                </header>
                                <p>{email.emailAddress}</p>
                                <footer>
                                    <span>{isZh ? '已确认' : 'Confirmed'}</span>
                                    <div className="address-actions">
                                        {!email.isDefault && (
                                            <button
                                                type="button"
                                                onClick={() => void makeDefaultEmail(email.id)}
                                            >
                                                <CircleCheck />
                                                {isZh ? '设为默认' : 'Make default'}
                                            </button>
                                        )}
                                        <button type="button" onClick={() => void removeEmail(email.id)}>
                                            <Trash2 />
                                            {isZh ? '删除' : 'Delete'}
                                        </button>
                                    </div>
                                </footer>
                            </article>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon={<Mail />}
                        title={isZh ? '还没有交付邮箱' : 'No delivery emails'}
                        detail={isZh ? '保存后可在结账时直接选择' : 'Save one for faster digital checkout'}
                        action={isZh ? '新增交付邮箱' : 'Add delivery email'}
                        onAction={() => setEmailOpen(true)}
                    />
                ))}
            {selection && Boolean(customer.addresses?.length) && (
                <div className="address-use-bar">
                    <button
                        type="button"
                        className="primary-action wide-action"
                        disabled={!selectedAddress || submitting}
                        onClick={() => {
                            if (!selectedAddress) return;
                            if (!isCompleteShippingAddress(selectedAddress)) startEdit(selectedAddress);
                            else selection.onUse(selectedAddress);
                        }}
                    >
                        {selectedAddress && !isCompleteShippingAddress(selectedAddress)
                            ? isZh
                                ? '完善并使用此地址'
                                : 'Complete and use this address'
                            : isZh
                              ? '使用此地址'
                              : 'Use this address'}
                    </button>
                </div>
            )}
            {open && (
                <Sheet
                    title={
                        editingAddress
                            ? isZh
                                ? '编辑收货地址'
                                : 'Edit address'
                            : isZh
                              ? '新增收货地址'
                              : 'Add address'
                    }
                    language={language}
                    onClose={() => {
                        if (submitting) return;
                        setOpen(false);
                        setEditingAddress(null);
                        setFormError('');
                    }}
                >
                    <form className="address-form" onSubmit={event => void save(event)}>
                        <div className="address-smart-paste field-wide">
                            <label>
                                <span>
                                    {isZh ? '粘贴地址，自动填写' : 'Paste an address to fill in the form'}
                                </span>
                                <textarea
                                    rows={3}
                                    value={smartPasteText}
                                    onChange={event => {
                                        setSmartPasteText(event.target.value);
                                        setParseMessage('');
                                    }}
                                    placeholder={
                                        isZh
                                            ? '粘贴收货人、电话和详细地址'
                                            : 'Paste recipient, phone and street address'
                                    }
                                />
                            </label>
                            <p>
                                {isZh
                                    ? '目前主要识别中文地址；请核对国家、省/州及其他字段。'
                                    : 'Best suited to Chinese addresses. Check the country, state and all other fields.'}
                            </p>
                            <button
                                type="button"
                                onClick={parseAddress}
                                disabled={!smartPasteText.trim() || submitting}
                            >
                                {isZh ? '识别并填写' : 'Recognize and fill'}
                            </button>
                            {parseMessage && <small role="status">{parseMessage}</small>}
                        </div>
                        <CountryField
                            countries={availableCountries}
                            defaultCountryCode={editingAddress?.country.code ?? market.countryCode}
                            value={addressCountryCode}
                            onChange={countryCode => {
                                setAddressDraft(current => ({ ...current, countryCode, province: '' }));
                            }}
                            language={language}
                        />
                        <Field
                            name="fullName"
                            label={isZh ? '收货人' : 'Full name'}
                            value={addressDraft.fullName ?? ''}
                            onChange={value => setDraftField('fullName', value)}
                            wide
                        />
                        <Field
                            name="phoneNumber"
                            label={isZh ? '手机号' : 'Phone'}
                            value={addressDraft.phoneNumber ?? ''}
                            onChange={value => setDraftField('phoneNumber', value)}
                            wide
                        />
                        <ProvinceField
                            provinces={availableProvinces}
                            countryCode={addressCountryCode}
                            value={addressProvince}
                            onChange={value => setDraftField('province', value)}
                            language={language}
                        />
                        <Field
                            name="city"
                            label={isZh ? '城市' : 'City'}
                            value={addressDraft.city ?? ''}
                            onChange={value => setDraftField('city', value)}
                        />
                        <Field
                            name="streetLine1"
                            label={isZh ? '详细地址' : 'Street address'}
                            value={addressDraft.streetLine1 ?? ''}
                            onChange={value => setDraftField('streetLine1', value)}
                            wide
                        />
                        <Field
                            name="streetLine2"
                            label={isZh ? '楼栋、单元等（选填）' : 'Apartment, suite, etc. (optional)'}
                            value={addressDraft.streetLine2 ?? ''}
                            onChange={value => setDraftField('streetLine2', value)}
                            required={false}
                            wide
                        />
                        <Field
                            name="postalCode"
                            label={isZh ? '邮政编码' : 'Postal code'}
                            value={addressDraft.postalCode ?? ''}
                            onChange={value => setDraftField('postalCode', value)}
                            wide
                        />
                        <label className="address-default-toggle field-wide">
                            <input
                                type="checkbox"
                                name="defaultShippingAddress"
                                defaultChecked={Boolean(editingAddress?.defaultShippingAddress)}
                            />
                            <span>{isZh ? '设为默认收货地址' : 'Set as default shipping address'}</span>
                        </label>
                        {formError && <small className="form-error">{formError}</small>}
                        <button className="primary-action wide-action" type="submit" disabled={submitting}>
                            {submitting
                                ? isZh
                                    ? '保存中'
                                    : 'Saving'
                                : selection
                                  ? isZh
                                      ? '保存并使用'
                                      : 'Save and use'
                                  : isZh
                                    ? '保存地址'
                                    : 'Save address'}
                        </button>
                    </form>
                </Sheet>
            )}
            {emailOpen && (
                <Sheet
                    title={isZh ? '新增交付邮箱' : 'Add delivery email'}
                    language={language}
                    onClose={() => {
                        setEmailOpen(false);
                        setFormError('');
                    }}
                >
                    <form className="address-form" onSubmit={event => void saveEmail(event)}>
                        <Field
                            name="label"
                            label={isZh ? '备注名称（选填）' : 'Label (optional)'}
                            defaultValue=""
                            required={false}
                            wide
                        />
                        <Field
                            name="emailAddress"
                            label={isZh ? '交付邮箱' : 'Delivery email'}
                            defaultValue={customer.emailAddress}
                            wide
                        />
                        <Field
                            name="confirmEmailAddress"
                            label={isZh ? '再次输入交付邮箱' : 'Confirm delivery email'}
                            defaultValue=""
                            wide
                        />
                        <label className="address-default-toggle field-wide">
                            <input type="checkbox" name="isDefault" />
                            <span>{isZh ? '设为默认交付邮箱' : 'Set as default delivery email'}</span>
                        </label>
                        {formError && <small className="form-error">{formError}</small>}
                        <button className="primary-action wide-action" type="submit" disabled={submitting}>
                            {submitting ? (isZh ? '保存中' : 'Saving') : isZh ? '保存邮箱' : 'Save email'}
                        </button>
                    </form>
                </Sheet>
            )}
        </main>
    );
}

function SubHeader({
    title,
    language,
    onBack,
    action,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    action?: ReactNode;
}) {
    return (
        <header className="topbar subpage-header">
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span>{action}</span>
        </header>
    );
}
function Subpage({
    title,
    language,
    onBack,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <main className="page subpage">
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}
function EmptyState({
    icon,
    title,
    detail,
    action,
    onAction,
}: {
    icon: ReactNode;
    title: string;
    detail?: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <section className="empty-state">
            <span>{icon}</span>
            <h2>{title}</h2>
            {detail && <p>{detail}</p>}
            <button type="button" onClick={onAction}>
                {action}
            </button>
        </section>
    );
}
function Field({
    name,
    label,
    defaultValue,
    value,
    onChange,
    required = true,
    wide = false,
}: {
    name: string;
    label: string;
    defaultValue?: string;
    value?: string;
    onChange?: (value: string) => void;
    required?: boolean;
    wide?: boolean;
}) {
    return (
        <label className={wide ? 'field-wide' : undefined}>
            <span>{label}</span>
            <input
                name={name}
                defaultValue={defaultValue}
                value={value}
                onChange={onChange ? event => onChange(event.target.value) : undefined}
                required={required}
            />
        </label>
    );
}
function CountryField({
    countries,
    defaultCountryCode,
    value,
    onChange,
    language,
}: {
    countries: StorefrontConfig['availableCountries'];
    defaultCountryCode: string;
    value: string;
    onChange: (countryCode: string) => void;
    language: StorefrontLanguage;
}) {
    const options = countries.length ? countries : [{ code: defaultCountryCode, name: defaultCountryCode }];
    const selected = options.some(country => country.code === value)
        ? value
        : options.some(country => country.code === defaultCountryCode)
          ? defaultCountryCode
          : options[0].code;
    return (
        <label className="field-wide">
            <span>{language === 'zh' ? '国家/地区' : 'Country/region'}</span>
            <select
                name="countryCode"
                value={selected}
                onChange={event => onChange(event.target.value)}
                required
            >
                {options.map(country => (
                    <option key={country.code} value={country.code}>
                        {country.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
function ProvinceField({
    provinces,
    countryCode,
    value,
    onChange,
    language,
}: {
    provinces: readonly StorefrontProvince[];
    countryCode: string;
    value: string;
    onChange: (province: string) => void;
    language: StorefrontLanguage;
}) {
    const options = provincesForCountry(provinces, countryCode);
    const selected = provinceCodeForValue(provinces, countryCode, value);
    const hasLegacyValue = Boolean(selected && !options.some(province => province.code === selected));
    const label = language === 'zh' ? '省/州' : 'State/Province';
    if (!options.length) {
        return (
            <label>
                <span>{label}</span>
                <input
                    name="province"
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    required
                />
            </label>
        );
    }
    return (
        <label>
            <span>{label}</span>
            <select
                name="province"
                value={selected}
                onChange={event => onChange(event.target.value)}
                required
            >
                <option value="">{language === 'zh' ? '请选择省/州' : 'Select a state/province'}</option>
                {hasLegacyValue && <option value={selected}>{selected}</option>}
                {options.map(province => (
                    <option key={province.code} value={province.code}>
                        {province.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
function Sheet({
    title,
    language,
    onClose,
    children,
}: {
    title: string;
    language: StorefrontLanguage;
    onClose: () => void;
    children: ReactNode;
}) {
    const dialogRef = useRef<HTMLElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const closeRef = useRef(onClose);
    const titleId = useId();
    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const releaseBodyScrollLock = acquireBodyScrollLock();
        const selector =
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        const items = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
        const frame = requestAnimationFrame(() => (items()[0] ?? dialog).focus({ preventScroll: true }));
        const keydown = (event: KeyboardEvent) => {
            if (isInputMethodKey(event)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = items();
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            releaseBodyScrollLock();
            previousFocus.current?.focus({ preventScroll: true });
        };
    }, []);
    return (
        <div className="sheet-layer" role="presentation">
            <button
                className="sheet-mask"
                type="button"
                onClick={onClose}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className="sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header>
                    <strong id={titleId}>{title}</strong>
                    <button type="button" onClick={onClose} aria-label={language === 'zh' ? '关闭' : 'Close'}>
                        <X aria-hidden="true" />
                    </button>
                </header>
                {children}
            </section>
        </div>
    );
}
function addressText(address: CustomerAddress, provinces: readonly StorefrontProvince[]) {
    return [
        provinceDisplayName(provinces, address.country.code, address.province),
        address.city,
        address.streetLine1,
        address.streetLine2,
        address.postalCode,
    ]
        .filter(Boolean)
        .join(' ');
}
