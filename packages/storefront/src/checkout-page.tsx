import { useNavigate } from '@tanstack/react-router';
import {
    ArrowLeft,
    ChevronRight,
    CircleCheck,
    ClipboardCheck,
    MapPin,
    Minus,
    Package,
    Plus,
    RotateCcw,
    ShoppingBag,
    Sparkles,
    TicketPercent,
    Truck,
    X,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { smartParseAddressText } from './address-parser';
import { ShopApi } from './api';
import { responsiveImageSources } from './responsive-image';
import { routeNavigateOptions } from './storefront-router';
import { checkoutPageStyles, pageClassName } from './tailwind/checkout-page-styles';
import { TaxSummaryRows } from './tax-summary';
import {
    ActiveCustomer,
    CustomerAddress,
    CustomerAddressInput,
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
type CheckoutRoute = { name: 'payment' | 'cart' | 'addresses' };
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

            if (isDigitalOnly) {
                const deliveryEmail = normalizeDeliveryEmail(getString('deliveryEmail'));
                if (!deliveryEmail) {
                    throw new Error(isZh ? '请填写有效的交付邮箱' : 'Enter a valid delivery email address');
                }
                await api.setDeliveryEmail(deliveryEmail);
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
            setFormError(
                requestError instanceof Error
                    ? requestError.message
                    : isZh
                      ? '提交订单失败'
                      : 'Could not submit order',
            );
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
                {isDigitalOnly ? (
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
                    </section>
                ) : !customer ? (
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
                                className={checkoutPageClassName('checkout-address-quick-switcher')}
                                aria-label={isZh ? '快捷选择收货地址' : 'Quick select address'}
                            >
                                {customer.addresses.map(addr => (
                                    <button
                                        type="button"
                                        key={addr.id}
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
                        <small>
                            {coupons.some(coupon => coupon.lockedOrderId === order.id)
                                ? isZh
                                    ? '已使用优惠券'
                                    : 'Coupon applied'
                                : isZh
                                  ? '选择已领取优惠券'
                                  : 'Choose a claimed coupon'}
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
                        {isZh ? '售后支持' : 'After-sales'}
                    </span>
                </section>
                {formError && <InlineError message={formError} />}
                <div className={checkoutPageClassName('submit-order-bar')}>
                    <div
                        className={checkoutPageClassName(
                            directPurchase ? 'purchase-submit-total' : undefined,
                        )}
                    >
                        {directPurchase ? (
                            <>
                                <small>{isZh ? '合计' : 'Total'}</small>
                                <strong>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</strong>
                            </>
                        ) : (
                            <>
                                <small>
                                    {isZh
                                        ? `共 ${order.totalQuantity} 件`
                                        : `${order.totalQuantity} ${order.totalQuantity === 1 ? 'item' : 'items'}`}
                                </small>
                                <span>
                                    {isZh ? '合计' : 'Total'}{' '}
                                    <strong>
                                        {formatMoney(order.totalWithTax, order.currencyCode, locale)}
                                    </strong>
                                </span>
                            </>
                        )}
                    </div>
                    <button type="submit" disabled={submitting}>
                        {submitting
                            ? isZh
                                ? '处理中'
                                : 'Processing'
                            : requiresShipping && !shippingMethods.length
                              ? isZh
                                  ? '下一步，选择配送'
                                  : 'Continue to delivery'
                              : directPurchase
                                ? isZh
                                    ? '确认并支付'
                                    : 'Confirm and pay'
                                : isZh
                                  ? '提交订单'
                                  : 'Submit order'}
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
                            <small>{line.productVariant.sku}</small>
                            <em>
                                {line.productVariant.customFields.digitalDeliveryMode === 'auto_card'
                                    ? isZh
                                        ? `付款后邮箱自动发卡 · 不支持退款 · 可用 ${line.productVariant.autoCardAvailableStock ?? 0} 份`
                                        : `Automatic email delivery · non-refundable · ${line.productVariant.autoCardAvailableStock ?? 0} available`
                                    : line.productVariant.customFields.digitalDeliveryMode === 'file_download'
                                      ? isZh
                                          ? '付款后可在订单内下载文件'
                                          : 'Download the file from your order after payment'
                                      : line.productVariant.customFields.fulfillmentType === 'digital'
                                        ? isZh
                                            ? '付款后由商家处理，进度与结果通过订单和邮箱通知'
                                            : 'Processed by the merchant after payment with order and email updates'
                                        : isZh
                                          ? '配送与售后信息以订单为准'
                                          : 'After-sales support'}
                            </em>
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
                                            (line.productVariant.customFields.digitalDeliveryMode ===
                                                'auto_card' &&
                                                line.quantity >=
                                                    (line.productVariant.autoCardAvailableStock ?? 0))
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
            <TaxSummaryRows order={order} locale={locale} language={language} />
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
function CouponSheet({
    coupons,
    orderId,
    language,
    loading,
    onApply,
    onRemove,
    onClose,
}: {
    coupons: StoreCustomerCoupon[];
    orderId: string;
    language: StorefrontLanguage;
    loading: boolean;
    onApply: (customerCouponId: string) => Promise<string | null>;
    onRemove: (customerCouponId: string) => Promise<string | null>;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const choose = async (coupon: StoreCustomerCoupon) => {
        setSubmitting(true);
        setError('');
        const applied = coupon.lockedOrderId === orderId;
        const nextError = await (applied ? onRemove(coupon.id) : onApply(coupon.id));
        setSubmitting(false);
        if (nextError) setError(nextError);
    };
    const selectableCoupons = coupons.filter(coupon => coupon.usable || coupon.lockedOrderId === orderId);
    return (
        <Sheet title={isZh ? '选择优惠券' : 'Choose a coupon'} language={language} onClose={onClose}>
            <div className={checkoutPageClassName('coupon-sheet-content')}>
                {selectableCoupons.length ? (
                    <section className={checkoutPageClassName('applied-coupons')}>
                        <strong>{isZh ? '我的可用优惠券' : 'My available coupons'}</strong>
                        {selectableCoupons.map(coupon => {
                            const applied = coupon.lockedOrderId === orderId;
                            return (
                                <div key={coupon.id}>
                                    <span>
                                        <TicketPercent />
                                        {coupon.campaignName}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void choose(coupon)}
                                        disabled={loading || submitting}
                                    >
                                        {applied ? (isZh ? '移除' : 'Remove') : isZh ? '使用' : 'Apply'}
                                    </button>
                                </div>
                            );
                        })}
                    </section>
                ) : (
                    <p>{isZh ? '暂无可用优惠券，请先到领券中心领取' : 'No coupons available yet.'}</p>
                )}
                {error && <small className={checkoutPageClassName('form-error')}>{error}</small>}
            </div>
        </Sheet>
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
    const onCloseRef = useRef(onClose);
    const titleId = useId();
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
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
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', keydown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previousOverflow;
            previousFocus.current?.focus();
        };
    }, []);
    return (
        <div className={checkoutPageClassName('sheet-layer')} role="presentation">
            <button
                className={checkoutPageClassName('sheet-mask')}
                type="button"
                onClick={onClose}
                aria-label={language === 'zh' ? '关闭' : 'Close'}
            />
            <section
                ref={dialogRef}
                className={checkoutPageClassName('sheet')}
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
        <div className={checkoutPageClassName('inline-error')} role="alert">
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
    const source = responsiveImageSources(src, 'thumbnail');
    return source ? (
        <picture className={checkoutPageClassName('responsive-picture safe-image-frame')}>
            <source type="image/webp" srcSet={source.webpSrcSet} sizes={source.sizes} />
            <img
                className={checkoutPageClassName('safe-image is-loaded')}
                src={source.fallbackSrc}
                srcSet={source.fallbackSrcSet}
                sizes={source.sizes}
                width={source.width}
                height={source.height}
                alt={alt}
                loading="lazy"
                decoding="async"
            />
        </picture>
    ) : (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
    );
}
function formatMoney(value: number, currency: string, locale: string) {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
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
