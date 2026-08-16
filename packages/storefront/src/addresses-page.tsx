import { ArrowLeft, CircleCheck, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ShopApi } from './api';
import {
    ActiveCustomer,
    CustomerAddress,
    CustomerAddressInput,
    MarketConfig,
    StorefrontConfig,
    StorefrontLanguage,
} from './types';

export function AddressesPage({
    api,
    customer,
    market,
    availableCountries,
    language,
    onBack,
    onCustomerChange,
    onNavigate,
    onNotify,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    availableCountries: StorefrontConfig['availableCountries'];
    language: StorefrontLanguage;
    onBack: () => void;
    onCustomerChange: (customer: ActiveCustomer | null) => void;
    onNavigate: (route: { name: 'login' }) => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const [open, setOpen] = useState(false);
    const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    if (!customer) {
        return (
            <Subpage title={isZh ? '地址管理' : 'Addresses'} language={language} onBack={onBack}>
                <EmptyState
                    icon={<MapPin />}
                    title={isZh ? '登录后管理地址' : 'Sign in to manage addresses'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => onNavigate({ name: 'login' })}
                />
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
                fullName: String(data.get('fullName')),
                phoneNumber: String(data.get('phoneNumber')),
                province: String(data.get('province')),
                city: String(data.get('city')),
                streetLine1: String(data.get('streetLine1')),
                streetLine2: String(data.get('streetLine2') ?? ''),
                postalCode: String(data.get('postalCode')),
                countryCode: String(data.get('countryCode') ?? market.countryCode),
                defaultShippingAddress:
                    customer.addresses?.length === 0 || data.get('defaultShippingAddress') === 'on',
            };
            if (editingAddress) await api.updateAddress({ ...input, id: editingAddress.id });
            else await api.createAddress(input);
            onCustomerChange(await api.activeCustomer());
            setOpen(false);
            setEditingAddress(null);
            onNotify(isZh ? '地址已保存' : 'Address saved');
        } catch (requestError) {
            setFormError(
                requestError instanceof Error
                    ? requestError.message
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
                    ? requestError.message
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
                    ? requestError.message
                    : isZh
                      ? '设置默认地址失败'
                      : 'Could not set the default address',
            );
        }
    };
    const startEdit = (address: CustomerAddress | null) => {
        setEditingAddress(address);
        setFormError('');
        setOpen(true);
    };
    return (
        <main className="page subpage addresses-page">
            <SubHeader
                title={isZh ? '地址管理' : 'Addresses'}
                language={language}
                onBack={onBack}
                action={
                    <button
                        type="button"
                        onClick={() => startEdit(null)}
                        aria-label={isZh ? '新增地址' : 'Add address'}
                    >
                        <Plus />
                    </button>
                }
            />
            {customer.addresses?.length ? (
                <div className="address-list">
                    {customer.addresses.map(address => (
                        <article className="address-card" key={address.id}>
                            <header>
                                <strong>{address.fullName}</strong>
                                <span>{address.phoneNumber}</span>
                                {address.defaultShippingAddress && <em>{isZh ? '默认' : 'Default'}</em>}
                            </header>
                            <p>{addressText(address)}</p>
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
                        setOpen(false);
                        setEditingAddress(null);
                    }}
                >
                    <form className="address-form" onSubmit={event => void save(event)}>
                        <CountryField
                            countries={availableCountries}
                            defaultCountryCode={editingAddress?.country.code ?? market.countryCode}
                            language={language}
                        />
                        <Field
                            name="fullName"
                            label={isZh ? '收货人' : 'Full name'}
                            defaultValue={editingAddress?.fullName ?? ''}
                            wide
                        />
                        <Field
                            name="phoneNumber"
                            label={isZh ? '手机号' : 'Phone'}
                            defaultValue={editingAddress?.phoneNumber ?? ''}
                            wide
                        />
                        <Field
                            name="province"
                            label={isZh ? '省/州' : 'Province'}
                            defaultValue={editingAddress?.province ?? ''}
                        />
                        <Field
                            name="city"
                            label={isZh ? '城市' : 'City'}
                            defaultValue={editingAddress?.city ?? ''}
                        />
                        <Field
                            name="streetLine1"
                            label={isZh ? '详细地址' : 'Street address'}
                            defaultValue={editingAddress?.streetLine1 ?? ''}
                            wide
                        />
                        <Field
                            name="streetLine2"
                            label={isZh ? '楼栋、单元等（选填）' : 'Apartment, suite, etc. (optional)'}
                            defaultValue={editingAddress?.streetLine2 ?? ''}
                            required={false}
                            wide
                        />
                        <Field
                            name="postalCode"
                            label={isZh ? '邮政编码' : 'Postal code'}
                            defaultValue={editingAddress?.postalCode ?? ''}
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
                            {submitting ? (isZh ? '保存中' : 'Saving') : isZh ? '保存地址' : 'Save address'}
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
    required = true,
    wide = false,
}: {
    name: string;
    label: string;
    defaultValue: string;
    required?: boolean;
    wide?: boolean;
}) {
    return (
        <label className={wide ? 'field-wide' : undefined}>
            <span>{label}</span>
            <input name={name} defaultValue={defaultValue} required={required} />
        </label>
    );
}
function CountryField({
    countries,
    defaultCountryCode,
    language,
}: {
    countries: StorefrontConfig['availableCountries'];
    defaultCountryCode: string;
    language: StorefrontLanguage;
}) {
    const options = countries.length ? countries : [{ code: defaultCountryCode, name: defaultCountryCode }];
    const selected = options.some(country => country.code === defaultCountryCode)
        ? defaultCountryCode
        : options[0].code;
    return (
        <label className="field-wide">
            <span>{language === 'zh' ? '国家/地区' : 'Country/region'}</span>
            <select name="countryCode" defaultValue={selected} required>
                {options.map(country => (
                    <option key={country.code} value={country.code}>
                        {country.name}
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
        const overflow = document.body.style.overflow;
        const selector =
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        const items = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
        const frame = requestAnimationFrame(() => (items()[0] ?? dialog).focus());
        const keydown = (event: KeyboardEvent) => {
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
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = overflow;
            previousFocus.current?.focus();
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
function addressText(address: CustomerAddress) {
    return [address.province, address.city, address.streetLine1, address.streetLine2, address.postalCode]
        .filter(Boolean)
        .join(' ');
}
