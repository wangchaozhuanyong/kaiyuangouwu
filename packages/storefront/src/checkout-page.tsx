import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    CircleCheck,
    ClipboardCheck,
    Mail,
    MapPin,
    Minus,
    Package,
    Plus,
    RotateCcw,
    ShoppingBag,
    Sparkles,
    Truck,
    X,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { smartParseAddressText } from './address-parser';
import { ShopApi } from './api';
import { compactUiCopy } from './i18n';
import { formatDisplayMoney } from './money-display';
import { variantCanIncreaseQuantity } from './product-availability';
import { acquireBodyScrollLock } from './scroll-lock';
import { appliedCouponLabel } from './storefront-coupons';
import { routeNavigateOptions } from './storefront-router';
import { CouponSheet } from './storefront-ui/cart-ui';
import { SafeImage } from './storefront-ui/product-display';
import { checkoutPageStyles, pageClassName } from './tailwind/checkout-page-styles';
import { TaxSummaryRows } from './tax-summary';
import {
    ActiveCustomer,
    CustomerAddress,
    CustomerAddressInput,
    CustomerDeliveryEmail,
    MarketConfig,
    Order,
    ProductVariant,
    ShippingMethod,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontLanguage,
} from './types';

const checkoutPageClassName = (className?: string | false | null) =>
    pageClassName(checkoutPageStyles, className);

const ORDER_NOTE_MAX_LENGTH = 500;
type CheckoutRoute = { name: 'payment' | 'cart' | 'addresses' | 'coupons' };
type CheckoutMode = 'checkout' | 'purchase';

export function CheckoutPage({
    mode = 'checkout',
    api,
    cart,
    order,
    customer,
    market,
    availableCountries,
    locale,
    language,
    onBack,
    onSessionChange,
    onCartChange,
    onNotify,
    coupons,
    onApplyCoupon,
    onRemoveCoupon,
}: {
    mode?: CheckoutMode;
    api: ShopApi;
    cart: StorefrontCart | null;
    order: Order | null;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    availableCountries: StorefrontConfig['availableCountries'];
    locale: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onSessionChange: (session: StorefrontCheckoutSession) => void;
    onCartChange: (cart: StorefrontCart) => void;
    onNotify: (message: string) => void;
    coupons: StoreCustomerCoupon[];
    onApplyCoupon: (customerCouponId: string) => Promise<string | null>;
    onRemoveCoupon: (customerCouponId: string) => Promise<string | null>;
}) {
    const navigate = useNavigate();
    const navigateTo = (route: CheckoutRoute, replace = false) =>
        void navigate({ ...routeNavigateOptions(route), replace } as never);
    const isZh = language === 'zh';
    const compactCopy = compactUiCopy[language];
    const directPurchase = mode === 'purchase';
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
    const [selectedShippingId, setSelectedShippingId] = useState('');
    const [preparedAddressKey, setPreparedAddressKey] = useState('');
    const [customerPrepared, setCustomerPrepared] = useState(Boolean(customer || order?.customer));
    const [shippingUpdating, setShippingUpdating] = useState(false);
    const [couponOpen, setCouponOpen] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const [noteError, setNoteError] = useState<string | null>(null);
    const [quantityUpdatingVariantId, setQuantityUpdatingVariantId] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [selectedAddressId, setSelectedAddressId] = useState<string>(
        customer?.addresses?.find(address => address.defaultShippingAddress)?.id ??
            customer?.addresses?.[0]?.id ??
            '',
    );
    const addressSwitcherRef = useRef<HTMLDivElement>(null);
    const addressChipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    useEffect(() => {
        const container = addressSwitcherRef.current;
        const chip = addressChipRefs.current.get(selectedAddressId);
        if (!container || !chip) return;
        const containerWidth = container.clientWidth;
        const targetScrollLeft = chip.offsetLeft - (containerWidth - chip.offsetWidth) / 2;
        container.scrollTo({
            left: Math.max(0, targetScrollLeft),
            behavior: 'smooth',
        });
    }, [selectedAddressId]);

    const activeAddress =
        customer?.addresses?.find(address => address.id === selectedAddressId) ??
        customer?.addresses?.find(address => address.defaultShippingAddress) ??
        customer?.addresses?.[0] ??
        null;
    const [smartPasteOpen, setSmartPasteOpen] = useState(false);
    const [smartPasteText, setSmartPasteText] = useState('');
    const [manualAddressDraft, setManualAddressDraft] = useState({
        fullName: '',
        phoneNumber: '',
        province: '',
        city: '',
        streetLine1: '',
        postalCode: '',
    });
    const defaultAddress = activeAddress;
    const isDigitalOnly = order?.checkoutFulfillment?.fulfillmentType === 'DIGITAL';
    const requiresShipping =
        !isDigitalOnly &&
        (order?.checkoutFulfillment?.requiresShippingAddress ??
            order?.lines.some(line => line.productVariant.customFields.fulfillmentType === 'physical'));
    const physicalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'physical') ?? [];
    const digitalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'digital') ?? [];
    const hasDigitalProducts = digitalLines.length > 0;
    const [deliveryEmails, setDeliveryEmails] = useState<CustomerDeliveryEmail[]>([]);
    const [selectedDeliveryEmailId, setSelectedDeliveryEmailId] = useState('');
    const [deliveryEmailPickerOpen, setDeliveryEmailPickerOpen] = useState(false);

    useEffect(() => {
        if (!customer || !hasDigitalProducts) {
            setDeliveryEmails([]);
            setSelectedDeliveryEmailId('');
            setDeliveryEmailPickerOpen(false);
            return;
        }
        const controller = new AbortController();
        void api
            .myDeliveryEmails(controller.signal)
            .then(items => {
                setDeliveryEmails(items);
                const matching = items.find(item => item.emailAddress === order?.customFields.deliveryEmail);
                setSelectedDeliveryEmailId(matching?.id ?? items.find(item => item.isDefault)?.id ?? '');
            })
            .catch(() => {
                if (!controller.signal.aborted) setDeliveryEmails([]);
            });
        return () => controller.abort();
    }, [api, customer, hasDigitalProducts, order?.customFields.deliveryEmail]);

    const updateDirectQuantity = async (productVariantId: string, quantity: number) => {
        if (!cart || quantity < 1) return;
        const cartLine = cart.lines.find(line => line.productVariant?.id === productVariantId);
        if (!cartLine) {
            setFormError(isZh ? '未找到本次购买商品' : 'The purchase item could not be found.');
            return;
        }
        setQuantityUpdatingVariantId(productVariantId);
        setFormError(null);
        try {
            onCartChange(await api.setLineQuantity(cartLine.id, quantity, cart.revision));
        } catch (requestError) {
            setFormError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '购买数量更新失败'
                      : 'Could not update the purchase quantity',
            );
        } finally {
            setQuantityUpdatingVariantId(null);
        }
    };

    const saveOrderNote = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const customerNote = noteDraft.trim();
        setNoteSaving(true);
        setNoteError(null);
        try {
            await api.setOrderNote(customerNote);
            onCartChange(await api.cart());
            setNoteOpen(false);
            onNotify(
                customerNote
                    ? isZh
                        ? '订单备注已保存'
                        : 'Order note saved'
                    : isZh
                      ? '订单备注已清空'
                      : 'Order note cleared',
            );
        } catch (requestError) {
            setNoteError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '订单备注保存失败'
                      : 'Could not save the order note',
            );
        } finally {
            setNoteSaving(false);
        }
    };

    const selectShippingMethod = async (shippingMethodId: string) => {
        const previousId = selectedShippingId;
        setSelectedShippingId(shippingMethodId);
        setShippingUpdating(true);
        setFormError(null);
        try {
            await api.setShippingMethod(shippingMethodId);
            onCartChange(await api.cart());
        } catch (requestError) {
            setSelectedShippingId(previousId);
            setFormError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '配送方式更新失败'
                      : 'Could not update the shipping method',
            );
        } finally {
            setShippingUpdating(false);
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!cart || !order) return;
        const data = new FormData(event.currentTarget);
        setSubmitting(true);
        setFormError(null);
        try {
            const getString = (key: string, fallback = '') => {
                const val = data.get(key);
                return typeof val === 'string' ? val : fallback;
            };

            if (hasDigitalProducts) {
                const selectedContactId = selectedDeliveryEmailId;
                if (selectedContactId) {
                    await api.setDeliveryEmail({ contactId: selectedContactId });
                } else {
                    const deliveryEmail = normalizeDeliveryEmail(getString('deliveryEmail'));
                    const confirmationEmail = normalizeDeliveryEmail(getString('confirmDeliveryEmail'));
                    if (!deliveryEmail) {
                        throw new Error(
                            isZh ? '请填写有效的交付邮箱' : 'Enter a valid delivery email address',
                        );
                    }
                    if (deliveryEmail !== confirmationEmail) {
                        throw new Error(
                            isZh ? '两次输入的交付邮箱不一致' : 'The delivery email entries do not match',
                        );
                    }
                    await api.setDeliveryEmail({
                        emailAddress: deliveryEmail,
                        confirmEmailAddress: confirmationEmail,
                        saveToAddressBook: Boolean(customer && data.get('saveDeliveryEmail')),
                        isDefault: Boolean(customer && data.get('defaultDeliveryEmail')),
                    });
                }
            }
            if (isDigitalOnly) {
                const deliveryEmail = selectedDeliveryEmailId
                    ? (deliveryEmails.find(item => item.id === selectedDeliveryEmailId)?.emailAddress ?? '')
                    : (normalizeDeliveryEmail(getString('deliveryEmail')) ?? '');
                if (!customerPrepared) {
                    await api.setCustomer({
                        firstName: 'Digital',
                        lastName: 'Customer',
                        emailAddress: deliveryEmail,
                    });
                    setCustomerPrepared(true);
                }
            }
            if (!isDigitalOnly && !customerPrepared) {
                await api.setCustomer({
                    firstName: getString('firstName'),
                    lastName: getString('lastName'),
                    emailAddress: getString('emailAddress'),
                });
                setCustomerPrepared(true);
            }
            if (requiresShipping) {
                const shippingAddress: CustomerAddressInput = {
                    fullName: getString('fullName'),
                    phoneNumber: getString('phoneNumber'),
                    streetLine1: getString('streetLine1'),
                    city: getString('city'),
                    province: getString('province'),
                    postalCode: getString('postalCode'),
                    countryCode: getString('countryCode', market.countryCode),
                };
                const addressKey = JSON.stringify(shippingAddress);
                if (addressKey !== preparedAddressKey || !shippingMethods.length) {
                    await api.setShippingAddress(shippingAddress);
                    const methods = await api.eligibleShippingMethods();
                    if (!methods.length)
                        throw new Error(
                            isZh ? '当前地址没有可用配送方式' : 'No shipping method is available',
                        );
                    const shippingId = methods.some(method => method.id === selectedShippingId)
                        ? selectedShippingId
                        : methods[0].id;
                    await api.setShippingMethod(shippingId);
                    setShippingMethods(methods);
                    setSelectedShippingId(shippingId);
                    setPreparedAddressKey(addressKey);
                    onCartChange(await api.cart());
                    onNotify(
                        isZh
                            ? '地址和运费已更新，请确认配送方式后提交订单'
                            : 'Address and shipping updated. Confirm the method, then submit.',
                    );
                    return;
                }
                if (!selectedShippingId)
                    throw new Error(isZh ? '当前地址没有可用配送方式' : 'No shipping method is available');
                await api.setShippingMethod(selectedShippingId);
            }
            const latestCart = await api.cart();
            onCartChange(latestCart);
            const session = await api.preparePayment(latestCart.revision);
            onSessionChange(session);
            onNotify(
                isZh ? '订单已准备，请继续选择支付方式' : 'Order prepared. Continue with a payment method.',
            );
            navigateTo({ name: 'payment' }, true);
        } catch (requestError) {
            const errorMessage =
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '提交订单失败'
                      : 'Could not submit order';
            setFormError(errorMessage);
            onNotify(errorMessage);
            try {
                onCartChange(await api.cart());
            } catch {
                // Keep the current form visible if the recovery refresh also fails.
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (!order || !cart) {
        return (
            <Subpage
                title={
                    directPurchase
                        ? isZh
                            ? '确认购买'
                            : 'Confirm purchase'
                        : isZh
                          ? '确认订单'
                          : 'Review order'
                }
                language={language}
                onBack={onBack}
            >
                <EmptyState
                    icon={<ShoppingBag />}
                    title={isZh ? '没有可结算商品' : 'Nothing to check out'}
                    action={
                        directPurchase
                            ? isZh
                                ? '返回商品'
                                : 'Back to product'
                            : isZh
                              ? '返回购物车'
                              : 'Back to cart'
                    }
                    onAction={directPurchase ? onBack : () => navigateTo({ name: 'cart' })}
                />
            </Subpage>
        );
    }

    const selectedCouponLabel = appliedCouponLabel(coupons, order.id, language);

    const renderCheckoutItems = () => (
        <>
            {!!physicalLines.length && (
                <CheckoutItemsGroup
                    title={
                        directPurchase
                            ? isZh
                                ? '本次购买'
                                : 'Your purchase'
                            : isZh
                              ? '快递配送'
                              : 'Delivery'
                    }
                    hint={
                        directPurchase
                            ? isZh
                                ? '单品直购'
                                : 'Buy now'
                            : isZh
                              ? `${physicalLines.length} 种 · 共 ${physicalLines.reduce((sum, line) => sum + line.quantity, 0)} 件`
                              : `${physicalLines.length} ${physicalLines.length === 1 ? 'product' : 'products'}`
                    }
                    lines={physicalLines}
                    locale={locale}
                    language={language}
                    directPurchase={directPurchase}
                    quantityUpdatingVariantId={quantityUpdatingVariantId}
                    onQuantity={(id, q) => void updateDirectQuantity(id, q)}
                />
            )}
            {!!digitalLines.length && (
                <CheckoutItemsGroup
                    title={
                        directPurchase
                            ? isZh
                                ? '本次购买'
                                : 'Your purchase'
                            : isZh
                              ? '数字交付'
                              : 'Digital delivery'
                    }
                    hint={
                        directPurchase
                            ? isZh
                                ? '单品直购'
                                : 'Buy now'
                            : isZh
                              ? `${digitalLines.length} 种 · 共 ${digitalLines.reduce((sum, line) => sum + line.quantity, 0)} 件`
                              : `${digitalLines.length} ${digitalLines.length === 1 ? 'product' : 'products'}`
                    }
                    lines={digitalLines}
                    locale={locale}
                    language={language}
                    directPurchase={directPurchase}
                    quantityUpdatingVariantId={quantityUpdatingVariantId}
                    onQuantity={(id, q) => void updateDirectQuantity(id, q)}
                />
            )}
        </>
    );

    return (
        <main
            className={checkoutPageClassName(
                `page subpage checkout-page${directPurchase ? ' purchase-page' : ''}`,
            )}
        >
            <SubHeader
                title={
                    directPurchase
                        ? isZh
                            ? '确认购买'
                            : 'Confirm purchase'
                        : isZh
                          ? '确认订单'
                          : 'Review order'
                }
                language={language}
                onBack={onBack}
            />
            <form
                ref={formRef}
                className={checkoutPageClassName('checkout-form')}
                onSubmit={event => void submit(event)}
            >
                {directPurchase && renderCheckoutItems()}
                {hasDigitalProducts && (
                    <section
                        className={checkoutPageClassName(
                            'checkout-section checkout-digital-delivery-section',
                        )}
                    >
                        <header className={checkoutPageClassName('digital-delivery-heading')}>
                            <div>
                                <h2>{isZh ? '接收方式' : 'Delivery contact'}</h2>
                                <p>
                                    {isZh
                                        ? '付款成功后，订单与数字内容领取入口将发送至此邮箱。'
                                        : 'Order updates and digital delivery instructions will be sent here after payment.'}
                                </p>
                            </div>
                            <span>{isZh ? '邮箱交付' : 'Email delivery'}</span>
                        </header>
                        {deliveryEmails.length > 0 && (
                            <DeliveryEmailPicker
                                deliveryEmails={deliveryEmails}
                                selectedId={selectedDeliveryEmailId}
                                open={deliveryEmailPickerOpen}
                                language={language}
                                onOpenChange={setDeliveryEmailPickerOpen}
                                onSelect={setSelectedDeliveryEmailId}
                            />
                        )}
                        {!selectedDeliveryEmailId && (
                            <>
                                <label className={checkoutPageClassName('digital-delivery-email-field')}>
                                    <span>{isZh ? '交付邮箱' : 'Delivery email'}</span>
                                    <input
                                        name="deliveryEmail"
                                        type="email"
                                        inputMode="email"
                                        autoComplete="email"
                                        defaultValue={
                                            order.customFields.deliveryEmail ??
                                            customer?.emailAddress ??
                                            order.customer?.emailAddress ??
                                            ''
                                        }
                                        required
                                    />
                                </label>
                                <label className={checkoutPageClassName('digital-delivery-email-field')}>
                                    <span>{isZh ? '再次输入交付邮箱' : 'Confirm delivery email'}</span>
                                    <input
                                        name="confirmDeliveryEmail"
                                        type="email"
                                        inputMode="email"
                                        autoComplete="email"
                                        required
                                    />
                                </label>
                                {customer && (
                                    <div className={checkoutPageClassName('checkout-delivery-email-options')}>
                                        <label>
                                            <input name="saveDeliveryEmail" type="checkbox" defaultChecked />{' '}
                                            {isZh ? '保存为交付邮箱' : 'Save to delivery emails'}
                                        </label>
                                        <label>
                                            <input name="defaultDeliveryEmail" type="checkbox" />{' '}
                                            {isZh ? '设为默认邮箱' : 'Set as default'}
                                        </label>
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                )}
                {!customer && !isDigitalOnly ? (
                    <section className={checkoutPageClassName('checkout-section checkout-contact-section')}>
                        <h2>{isZh ? '联系信息' : 'Contact'}</h2>
                        <div className={checkoutPageClassName('form-grid')}>
                            <Field name="firstName" label={isZh ? '名字' : 'First name'} />
                            <Field name="lastName" label={isZh ? '姓氏' : 'Last name'} />
                            <Field
                                name="emailAddress"
                                label={isZh ? '电子邮箱' : 'Email'}
                                type="email"
                                wide
                            />
                        </div>
                    </section>
                ) : null}
                {requiresShipping && (
                    <section className={checkoutPageClassName('checkout-section checkout-address-section')}>
                        <div className={checkoutPageClassName('checkout-section-header-row')}>
                            <h2>{isZh ? '收货地址' : 'Shipping address'}</h2>
                            <button
                                type="button"
                                className={checkoutPageClassName('smart-paste-toggle-btn')}
                                onClick={() => setSmartPasteOpen(!smartPasteOpen)}
                            >
                                <ClipboardCheck size={14} />
                                <span>{isZh ? '一键智能粘贴' : 'Smart Paste'}</span>
                            </button>
                        </div>

                        {smartPasteOpen && (
                            <div className={checkoutPageClassName('smart-paste-card')}>
                                <textarea
                                    className={checkoutPageClassName('smart-paste-input')}
                                    rows={3}
                                    placeholder={
                                        isZh
                                            ? '粘贴例如：张三，13800138000，广东省深圳市南山区科技园 518000'
                                            : 'Paste text with recipient, phone and address to auto fill'
                                    }
                                    value={smartPasteText}
                                    onChange={e => setSmartPasteText(e.target.value)}
                                />
                                <div className={checkoutPageClassName('smart-paste-actions')}>
                                    <button
                                        type="button"
                                        className={checkoutPageClassName('smart-paste-submit-btn')}
                                        onClick={() => {
                                            if (!smartPasteText.trim()) return;
                                            const parsed = smartParseAddressText(smartPasteText);
                                            setManualAddressDraft({
                                                fullName: parsed.fullName,
                                                phoneNumber: parsed.phoneNumber,
                                                province: parsed.province,
                                                city: parsed.city,
                                                streetLine1: parsed.streetLine1,
                                                postalCode: parsed.postalCode,
                                            });
                                            setSmartPasteOpen(false);
                                            onNotify(
                                                isZh
                                                    ? '✨ 已智能识别并填充收货地址'
                                                    : 'Address parsed and filled',
                                            );
                                        }}
                                    >
                                        <Sparkles size={14} />
                                        <span>{isZh ? '智能识别并填充' : 'Parse & Auto-Fill'}</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {customer?.addresses && customer.addresses.length > 1 && (
                            <div
                                ref={addressSwitcherRef}
                                className={checkoutPageClassName('checkout-address-quick-switcher')}
                                aria-label={isZh ? '快捷选择收货地址' : 'Quick select address'}
                            >
                                {customer.addresses.map(addr => (
                                    <button
                                        type="button"
                                        key={addr.id}
                                        ref={el => {
                                            if (el) addressChipRefs.current.set(addr.id, el);
                                            else addressChipRefs.current.delete(addr.id);
                                        }}
                                        className={checkoutPageClassName(
                                            `checkout-address-chip-card${addr.id === (activeAddress?.id ?? '') ? ' is-active' : ''}`,
                                        )}
                                        onClick={() => setSelectedAddressId(addr.id)}
                                    >
                                        <div className={checkoutPageClassName('chip-card-top')}>
                                            <strong>{addr.fullName}</strong>
                                            <span>{addr.phoneNumber}</span>
                                            {addr.defaultShippingAddress && (
                                                <em className={checkoutPageClassName('default-tag')}>
                                                    {isZh ? '默认' : 'Default'}
                                                </em>
                                            )}
                                        </div>
                                        <small className={checkoutPageClassName('chip-card-address')}>
                                            {addressText(addr)}
                                        </small>
                                    </button>
                                ))}
                            </div>
                        )}

                        {defaultAddress ? (
                            <>
                                <button
                                    className={checkoutPageClassName('saved-address')}
                                    type="button"
                                    onClick={() => navigateTo({ name: 'addresses' })}
                                >
                                    <MapPin />
                                    <span>
                                        <strong>
                                            {defaultAddress.fullName} {defaultAddress.phoneNumber}
                                        </strong>
                                        <small>{addressText(defaultAddress)}</small>
                                    </span>
                                    <ChevronRight />
                                </button>
                                <input type="hidden" name="fullName" value={defaultAddress.fullName ?? ''} />
                                <input
                                    type="hidden"
                                    name="phoneNumber"
                                    value={defaultAddress.phoneNumber ?? ''}
                                />
                                <input type="hidden" name="province" value={defaultAddress.province ?? ''} />
                                <input type="hidden" name="city" value={defaultAddress.city ?? ''} />
                                <input type="hidden" name="streetLine1" value={defaultAddress.streetLine1} />
                                <input type="hidden" name="countryCode" value={defaultAddress.country.code} />
                                <input
                                    type="hidden"
                                    name="postalCode"
                                    value={defaultAddress.postalCode ?? ''}
                                />
                            </>
                        ) : (
                            <div className={checkoutPageClassName('form-grid')}>
                                <CountryField
                                    countries={availableCountries}
                                    defaultCountryCode={market.countryCode}
                                    language={language}
                                />
                                <Field
                                    name="fullName"
                                    label={isZh ? '收货人' : 'Full name'}
                                    defaultValue={manualAddressDraft.fullName || undefined}
                                    key={`name-${manualAddressDraft.fullName}`}
                                />
                                <Field
                                    name="phoneNumber"
                                    label={isZh ? '手机号' : 'Phone'}
                                    defaultValue={manualAddressDraft.phoneNumber || undefined}
                                    key={`phone-${manualAddressDraft.phoneNumber}`}
                                />
                                <Field
                                    name="province"
                                    label={isZh ? '省/州' : 'Province'}
                                    defaultValue={manualAddressDraft.province || undefined}
                                    key={`prov-${manualAddressDraft.province}`}
                                />
                                <Field
                                    name="city"
                                    label={isZh ? '城市' : 'City'}
                                    defaultValue={manualAddressDraft.city || undefined}
                                    key={`city-${manualAddressDraft.city}`}
                                />
                                <Field
                                    name="streetLine1"
                                    label={isZh ? '详细地址' : 'Street address'}
                                    defaultValue={manualAddressDraft.streetLine1 || undefined}
                                    key={`street-${manualAddressDraft.streetLine1}`}
                                    wide
                                />
                                <Field
                                    name="postalCode"
                                    label={isZh ? '邮政编码' : 'Postal code'}
                                    defaultValue={manualAddressDraft.postalCode || undefined}
                                    key={`postal-${manualAddressDraft.postalCode}`}
                                    wide
                                />
                            </div>
                        )}
                    </section>
                )}
                {!directPurchase && renderCheckoutItems()}
                <section className={checkoutPageClassName('checkout-section checkout-options')}>
                    {isDigitalOnly && (
                        <div
                            className={checkoutPageClassName('digital-delivery-method')}
                            aria-label={isZh ? '交付方式' : 'Delivery method'}
                        >
                            <span>{isZh ? '交付方式' : 'Delivery method'}</span>
                            <small>
                                <strong>{isZh ? '邮箱自动交付' : 'Automatic email delivery'}</strong>
                                <em>{isZh ? '免费' : 'Free'}</em>
                            </small>
                        </div>
                    )}
                    {requiresShipping && !shippingMethods.length && (
                        <button type="button" onClick={() => formRef.current?.requestSubmit()}>
                            <span>{isZh ? '配送方式' : 'Delivery'}</span>
                            <small>
                                {isZh ? '填写地址后计算' : 'Calculate after address'}
                                <ChevronRight />
                            </small>
                        </button>
                    )}
                    {requiresShipping && !!shippingMethods.length && (
                        <fieldset
                            className={checkoutPageClassName('shipping-method-list')}
                            disabled={shippingUpdating || submitting}
                        >
                            <legend>{isZh ? '配送方式' : 'Delivery'}</legend>
                            {shippingMethods.map(method => (
                                <label key={method.id}>
                                    <input
                                        type="radio"
                                        name="shippingMethod"
                                        value={method.id}
                                        checked={selectedShippingId === method.id}
                                        onChange={() => void selectShippingMethod(method.id)}
                                    />
                                    <span>
                                        <strong>{method.name}</strong>
                                        {method.description && <small>{method.description}</small>}
                                        {shippingMethodDetails(
                                            method,
                                            order.currencyCode,
                                            locale,
                                            language,
                                        ) && (
                                            <small className={checkoutPageClassName('shipping-method-meta')}>
                                                {shippingMethodDetails(
                                                    method,
                                                    order.currencyCode,
                                                    locale,
                                                    language,
                                                )}
                                            </small>
                                        )}
                                    </span>
                                    <b>{formatMoney(method.priceWithTax, order.currencyCode, locale)}</b>
                                </label>
                            ))}
                        </fieldset>
                    )}
                    <button
                        type="button"
                        onClick={() =>
                            onNotify(
                                isZh
                                    ? '订单提交后继续选择支付方式'
                                    : 'Choose a payment method after placing the order',
                            )
                        }
                    >
                        <span>{isZh ? '支付方式' : 'Payment method'}</span>
                        <small>
                            {isZh ? '提交后选择' : 'Choose after submission'}
                            <ChevronRight />
                        </small>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setNoteDraft(order.customFields.customerNote ?? '');
                            setNoteError(null);
                            setNoteOpen(true);
                        }}
                    >
                        <span>{isZh ? '订单备注' : 'Order note'}</span>
                        <small>
                            {order.customFields.customerNote
                                ? trimText(order.customFields.customerNote, 20)
                                : isZh
                                  ? '添加备注'
                                  : 'Add a note'}
                            <ChevronRight />
                        </small>
                    </button>
                    <button type="button" onClick={() => setCouponOpen(true)}>
                        <span>{isZh ? '优惠券' : 'Coupon'}</span>
                        <small title={selectedCouponLabel ?? undefined}>
                            {selectedCouponLabel ?? (isZh ? '选择已领取优惠券' : 'Choose a claimed coupon')}
                            <ChevronRight />
                        </small>
                    </button>
                </section>
                <section className={checkoutPageClassName('checkout-section checkout-summary-section')}>
                    <PriceSummary
                        order={order}
                        locale={locale}
                        language={language}
                        requiresShipping={requiresShipping}
                    />
                </section>
                <section
                    className={checkoutPageClassName('checkout-assurance checkout-protection-section')}
                    aria-label={isZh ? '购物保障' : 'Purchase protection'}
                >
                    <span>
                        <CircleCheck />
                        {physicalLines.length
                            ? isZh
                                ? '下单信息'
                                : 'Order details'
                            : isZh
                              ? '安全购买'
                              : 'Secure purchase'}
                    </span>
                    <span>
                        <Truck />
                        {physicalLines.length
                            ? isZh
                                ? '配送可追踪'
                                : 'Tracked delivery'
                            : isZh
                              ? '邮箱交付'
                              : 'Email delivery'}
                    </span>
                    <span>
                        <RotateCcw />
                        {compactCopy.orders.returns}
                    </span>
                </section>
                <div className={checkoutPageClassName('submit-order-bar')}>
                    <button type="submit" disabled={submitting}>
                        {(() => {
                            if (submitting) return isZh ? '处理中…' : 'Processing…';
                            if (requiresShipping && !shippingMethods.length) {
                                return isZh ? '下一步，选择配送' : 'Continue to delivery';
                            }
                            const totalFormatted = formatMoney(
                                order.totalWithTax,
                                order.currencyCode,
                                locale,
                            );
                            const itemLabel = `${order.totalQuantity} ${order.totalQuantity === 1 ? 'item' : 'items'}`;
                            if (directPurchase) {
                                return isZh
                                    ? `确认并支付（${order.totalQuantity}件）需支付 ${totalFormatted}`
                                    : `Confirm and pay (${itemLabel}) · ${totalFormatted}`;
                            }
                            return isZh
                                ? `提交订单（${order.totalQuantity}件）需支付 ${totalFormatted}`
                                : `Place order (${itemLabel}) · ${totalFormatted}`;
                        })()}
                    </button>
                </div>
            </form>
            {couponOpen && (
                <CouponSheet
                    coupons={coupons}
                    orderId={order.id}
                    language={language}
                    loading={submitting}
                    onApply={onApplyCoupon}
                    onRemove={onRemoveCoupon}
                    onBrowseCoupons={() => {
                        setCouponOpen(false);
                        navigateTo({ name: 'coupons' });
                    }}
                    onClose={() => setCouponOpen(false)}
                />
            )}
            {noteOpen && (
                <Sheet
                    title={isZh ? '订单备注' : 'Order note'}
                    language={language}
                    onClose={() => !noteSaving && setNoteOpen(false)}
                >
                    <form
                        className={checkoutPageClassName('order-note-sheet')}
                        onSubmit={event => void saveOrderNote(event)}
                    >
                        <label>
                            <span>{isZh ? '给商家留言' : 'Message for the store'}</span>
                            <textarea
                                value={noteDraft}
                                maxLength={ORDER_NOTE_MAX_LENGTH}
                                rows={6}
                                autoFocus
                                placeholder={
                                    isZh
                                        ? '例如配送时间、包装要求；不要填写支付密码等敏感信息'
                                        : 'For example, delivery or packaging instructions. Do not enter passwords.'
                                }
                                onChange={event => setNoteDraft(event.currentTarget.value)}
                            />
                        </label>
                        <div className={checkoutPageClassName('order-note-meta')}>
                            <small>{isZh ? '最多 500 个字符' : 'Up to 500 characters'}</small>
                            <span>
                                {noteDraft.length}/{ORDER_NOTE_MAX_LENGTH}
                            </span>
                        </div>
                        {noteError && <InlineError message={noteError} />}
                        <div className={checkoutPageClassName('order-note-actions')}>
                            <button
                                type="button"
                                disabled={noteSaving || !noteDraft}
                                onClick={() => setNoteDraft('')}
                            >
                                {isZh ? '清空' : 'Clear'}
                            </button>
                            <button
                                className={checkoutPageClassName('primary-action')}
                                type="submit"
                                disabled={noteSaving}
                            >
                                {noteSaving ? (isZh ? '保存中' : 'Saving') : isZh ? '保存备注' : 'Save note'}
                            </button>
                        </div>
                    </form>
                </Sheet>
            )}
        </main>
    );
}

function CheckoutItemsGroup({
    title,
    hint,
    lines,
    locale,
    language,
    directPurchase = false,
    quantityUpdatingVariantId,
    onQuantity,
}: {
    title: string;
    hint: string;
    lines: Order['lines'];
    locale: string;
    language: StorefrontLanguage;
    directPurchase?: boolean;
    quantityUpdatingVariantId?: string | null;
    onQuantity?: (productVariantId: string, quantity: number) => void;
}) {
    const isZh = language === 'zh';
    return (
        <section className={checkoutPageClassName('checkout-section checkout-product-group')}>
            <header className={checkoutPageClassName('checkout-section-title')}>
                <h2>{title}</h2>
                <span>{hint}</span>
            </header>
            <div className={checkoutPageClassName('checkout-items')}>
                {lines.map(line => (
                    <article key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <div>
                            <strong>{line.productVariant.name}</strong>
                            <em>{checkoutLinePolicyText(line, isZh)}</em>
                        </div>
                        <span className={checkoutPageClassName('checkout-line-meta')}>
                            <b>
                                {formatMoney(line.linePriceWithTax, line.productVariant.currencyCode, locale)}
                            </b>
                            {directPurchase ? (
                                <span
                                    className={checkoutPageClassName('purchase-quantity-control')}
                                    aria-label={isZh ? '购买数量' : 'Quantity'}
                                >
                                    <button
                                        type="button"
                                        disabled={
                                            line.quantity <= 1 ||
                                            quantityUpdatingVariantId === line.productVariant.id
                                        }
                                        onClick={() =>
                                            onQuantity?.(line.productVariant.id, line.quantity - 1)
                                        }
                                        aria-label={isZh ? '减少数量' : 'Decrease quantity'}
                                    >
                                        <Minus aria-hidden="true" />
                                    </button>
                                    <small aria-live="polite">{line.quantity}</small>
                                    <button
                                        type="button"
                                        disabled={
                                            quantityUpdatingVariantId === line.productVariant.id ||
                                            !variantCanIncreaseQuantity(line.productVariant, line.quantity)
                                        }
                                        onClick={() =>
                                            onQuantity?.(line.productVariant.id, line.quantity + 1)
                                        }
                                        aria-label={isZh ? '增加数量' : 'Increase quantity'}
                                    >
                                        <Plus aria-hidden="true" />
                                    </button>
                                </span>
                            ) : (
                                <small>×{line.quantity}</small>
                            )}
                        </span>
                    </article>
                ))}
            </div>
        </section>
    );
}

function checkoutLinePolicyText(line: Order['lines'][number], isZh: boolean): string {
    const mode = line.productVariant.customFields.digitalDeliveryMode;
    const policy = line.customFields.refundPolicySnapshot ?? 'MERCHANT_REVIEW';
    const policyText =
        policy === 'NON_REFUNDABLE'
            ? isZh
                ? '不支持退款，交付异常可联系客服'
                : 'Non-refundable; support is available for delivery issues'
            : policy === 'SEVEN_DAY_NO_REASON'
              ? isZh
                  ? '支持7天无理由'
                  : 'Seven-day no-reason return'
              : isZh
                ? '可申请退款，由商家审核'
                : 'Refund requests are reviewed by the merchant';
    if (mode === 'auto_card') {
        const stock = line.productVariant.autoCardAvailableStock ?? 0;
        return isZh
            ? `付款后邮箱自动发卡 · ${policyText} · 可用 ${stock} 份`
            : `Automatic email delivery · ${policyText} · ${stock} available`;
    }
    if (mode === 'file_download') {
        return `${isZh ? '付款后可在订单内下载文件' : 'Download the file from your order after payment'} · ${policyText}`;
    }
    if (line.productVariant.customFields.fulfillmentType === 'digital') {
        const sla = formatCheckoutSla(line.customFields.manualDeliverySlaMinutesSnapshot ?? 1440, isZh);
        return isZh
            ? `付款后由商家处理，预计${sla}内发送至邮箱 · ${policyText}`
            : `Merchant processed and emailed within ${sla} · ${policyText}`;
    }
    return isZh
        ? `配送与售后信息以订单为准 · ${policyText}`
        : `Shipping and returns follow the order · ${policyText}`;
}

function formatCheckoutSla(minutesInput: number, isZh: boolean): string {
    const minutes = Math.max(5, Math.trunc(minutesInput));
    if (minutes % 1440 === 0) {
        const days = minutes / 1440;
        return isZh ? `${days}天` : `${days} ${days === 1 ? 'day' : 'days'}`;
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return isZh ? `${hours}小时` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    return isZh ? `${minutes}分钟` : `${minutes} minutes`;
}
function PriceSummary({
    order,
    locale,
    language,
    requiresShipping = true,
}: {
    order: Order;
    locale: string;
    language: StorefrontLanguage;
    requiresShipping?: boolean;
}) {
    const isZh = language === 'zh';
    const discount = Math.abs(order.discounts.reduce((sum, item) => sum + item.amountWithTax, 0));
    return (
        <dl className={checkoutPageClassName('price-summary')}>
            <div>
                <dt>{isZh ? '商品金额' : 'Items'}</dt>
                <dd>{formatMoney(order.subTotalWithTax + discount, order.currencyCode, locale)}</dd>
            </div>
            <div>
                <dt>
                    {requiresShipping ? (isZh ? '运费' : 'Shipping') : isZh ? '邮箱交付' : 'Email delivery'}
                </dt>
                <dd>{formatMoney(order.shippingWithTax, order.currencyCode, locale)}</dd>
            </div>
            {discount > 0 && (
                <div className={checkoutPageClassName('discount')}>
                    <dt>{isZh ? '优惠' : 'Discount'}</dt>
                    <dd>-{formatMoney(discount, order.currencyCode, locale)}</dd>
                </div>
            )}
            <TaxSummaryRows order={order} locale={locale} language={language} useDisplayCurrency />
            <div className={checkoutPageClassName('summary-total')}>
                <dt>{isZh ? '合计' : 'Total'}</dt>
                <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
            </div>
        </dl>
    );
}

function normalizeDeliveryEmail(value: string): string | null {
    const email = value.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

function shippingMethodDetails(
    method: ShippingMethod,
    currencyCode: string,
    locale: string,
    language: StorefrontLanguage,
): string {
    const metadata = method.metadata;
    if (!metadata) return '';
    const details: string[] = [];
    if (metadata.estimateMinDays != null || metadata.estimateMaxDays != null) {
        const minimum = metadata.estimateMinDays ?? metadata.estimateMaxDays ?? 0;
        const maximum = metadata.estimateMaxDays ?? minimum;
        const range = minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
        details.push(language === 'zh' ? `预计 ${range} 天送达` : `Estimated ${range} days`);
    }
    if (metadata.freeShippingApplied) {
        details.push(language === 'zh' ? '已享免邮' : 'Free shipping applied');
    } else if ((metadata.freeShippingThreshold ?? 0) > 0) {
        const threshold = formatMoney(metadata.freeShippingThreshold ?? 0, currencyCode, locale);
        details.push(
            language === 'zh' ? `实物商品满 ${threshold} 免邮` : `Free over ${threshold} physical subtotal`,
        );
    }
    return details.join(' · ');
}

export function DeliveryEmailPicker({
    deliveryEmails,
    selectedId,
    open,
    language,
    onOpenChange,
    onSelect,
}: {
    deliveryEmails: CustomerDeliveryEmail[];
    selectedId: string;
    open: boolean;
    language: StorefrontLanguage;
    onOpenChange: (open: boolean) => void;
    onSelect: (id: string) => void;
}) {
    const isZh = language === 'zh';
    const selectedEmail = deliveryEmails.find(item => item.id === selectedId) ?? null;
    const selectedMeta = selectedEmail
        ? [selectedEmail.label, selectedEmail.isDefault ? (isZh ? '默认邮箱' : 'Default email') : '']
              .filter(Boolean)
              .join(' · ')
        : isZh
          ? '手动填写并再次确认'
          : 'Enter and confirm the address manually';
    const selectEmail = (id: string) => {
        onSelect(id);
        onOpenChange(false);
    };

    return (
        <>
            <div className={checkoutPageClassName('digital-delivery-email-field')}>
                <span>{isZh ? '选择已保存邮箱' : 'Saved delivery email'}</span>
                <button
                    type="button"
                    className={checkoutPageClassName(
                        `digital-delivery-email-trigger${open ? ' is-open' : ''}`,
                    )}
                    aria-label={
                        isZh
                            ? `选择交付邮箱，当前为${selectedEmail?.emailAddress ?? '使用新邮箱'}`
                            : `Choose delivery email, currently ${selectedEmail?.emailAddress ?? 'using a new email'}`
                    }
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => onOpenChange(true)}
                >
                    <span>
                        <strong>
                            {selectedEmail?.emailAddress ?? (isZh ? '使用新邮箱' : 'Use a new email')}
                        </strong>
                        <small>{selectedMeta}</small>
                    </span>
                    <ChevronDown aria-hidden="true" />
                </button>
            </div>
            {open && (
                <Sheet
                    title={isZh ? '选择交付邮箱' : 'Choose delivery email'}
                    language={language}
                    className="delivery-email-picker-sheet"
                    showHandle
                    onClose={() => onOpenChange(false)}
                >
                    <div className={checkoutPageClassName('delivery-email-picker-content')}>
                        <p>
                            {isZh
                                ? '选中的邮箱将用于接收订单和数字内容领取入口。'
                                : 'We will send order updates and digital delivery instructions to this address.'}
                        </p>
                        <div
                            className={checkoutPageClassName('delivery-email-picker-list')}
                            role="radiogroup"
                            aria-label={isZh ? '已保存的交付邮箱' : 'Saved delivery emails'}
                        >
                            {deliveryEmails.map(item => {
                                const selected = item.id === selectedId;
                                const meta = [
                                    item.label,
                                    item.isDefault ? (isZh ? '默认邮箱' : 'Default email') : '',
                                ]
                                    .filter(Boolean)
                                    .join(' · ');
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        className={checkoutPageClassName(
                                            `delivery-email-picker-option${selected ? ' is-selected' : ''}`,
                                        )}
                                        onClick={() => selectEmail(item.id)}
                                    >
                                        <span className="delivery-email-picker-icon">
                                            <Mail aria-hidden="true" />
                                        </span>
                                        <span>
                                            <strong>{item.emailAddress}</strong>
                                            {meta && <small>{meta}</small>}
                                        </span>
                                        {selected ? <CircleCheck aria-hidden="true" /> : <span />}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                role="radio"
                                aria-checked={!selectedId}
                                className={checkoutPageClassName(
                                    `delivery-email-picker-option${selectedId ? '' : ' is-selected'}`,
                                )}
                                onClick={() => selectEmail('')}
                            >
                                <span className="delivery-email-picker-icon">
                                    <Plus aria-hidden="true" />
                                </span>
                                <span>
                                    <strong>{isZh ? '使用新邮箱' : 'Use a new email'}</strong>
                                    <small>
                                        {isZh
                                            ? '手动填写并确认本次交付邮箱'
                                            : 'Enter and confirm an address for this order'}
                                    </small>
                                </span>
                                {!selectedId ? <CircleCheck aria-hidden="true" /> : <span />}
                            </button>
                        </div>
                    </div>
                </Sheet>
            )}
        </>
    );
}

function Sheet({
    title,
    language,
    onClose,
    children,
    className,
    showHandle = false,
}: {
    title: string;
    language: StorefrontLanguage;
    onClose: () => void;
    children: ReactNode;
    className?: string;
    showHandle?: boolean;
}) {
    const dialogRef = useRef<HTMLElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const titleId = useId();
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const releaseBodyScrollLock = acquireBodyScrollLock();
        const selector =
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        const focusable = () =>
            Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
                element => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
            );
        const frame = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus());
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable();
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
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
            previousFocus.current?.focus();
        };
    }, []);
    return (
        <div
            className={checkoutPageClassName(`sheet-layer${className ? ` ${className}-layer` : ''}`)}
            role="presentation"
        >
            <button
                className={checkoutPageClassName('sheet-mask')}
                type="button"
                onClick={onClose}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className={checkoutPageClassName(`sheet${className ? ` ${className}` : ''}`)}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                {showHandle ? (
                    <span
                        className={checkoutPageClassName('delivery-email-picker-handle')}
                        aria-hidden="true"
                    />
                ) : null}
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
function SubHeader({
    title,
    language,
    onBack,
}: {
    title: string;
    language: StorefrontLanguage;
    onBack: () => void;
}) {
    return (
        <header className={checkoutPageClassName('topbar subpage-header')}>
            <button type="button" onClick={onBack} aria-label={language === 'zh' ? '返回' : 'Back'}>
                <ArrowLeft aria-hidden="true" />
            </button>
            <strong>{title}</strong>
            <span />
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
        <main className={checkoutPageClassName('page subpage')}>
            <SubHeader title={title} language={language} onBack={onBack} />
            {children}
        </main>
    );
}
function EmptyState({
    icon,
    title,
    action,
    onAction,
}: {
    icon: ReactNode;
    title: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <section className={checkoutPageClassName('empty-state')}>
            <span>{icon}</span>
            <h2>{title}</h2>
            {action && (
                <button type="button" onClick={onAction}>
                    {action}
                </button>
            )}
        </section>
    );
}
function InlineError({ message }: { message: string }) {
    return (
        <div
            className={checkoutPageClassName('inline-error')}
            role="alert"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}
        >
            <span>{message}</span>
        </div>
    );
}
function Field({
    name,
    label,
    defaultValue,
    type = 'text',
    wide = false,
}: {
    name: string;
    label: string;
    defaultValue?: string;
    type?: string;
    wide?: boolean;
}) {
    return (
        <label className={checkoutPageClassName(wide ? 'field-wide' : undefined)}>
            <span>{label}</span>
            <input name={name} type={type} defaultValue={defaultValue} required />
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
        <label className={checkoutPageClassName('field-wide')}>
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
function ProductVariantImage({ variant, alt }: { variant: ProductVariant; alt: string }) {
    const src = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    if (!src)
        return (
            <div className={checkoutPageClassName('image-placeholder')} aria-hidden="true">
                <Package />
            </div>
        );
    return <SafeImage src={src} alt={alt} imageKind="thumbnail" loading="lazy" decoding="async" />;
}
function formatMoney(value: number, currency: string, locale: string) {
    return formatDisplayMoney(value, currency, locale);
}
function addressText(address: CustomerAddress) {
    return [address.province, address.city, address.streetLine1, address.streetLine2, address.postalCode]
        .filter(Boolean)
        .join(' ');
}
function trimText(value: string, length: number) {
    const clean = value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}
