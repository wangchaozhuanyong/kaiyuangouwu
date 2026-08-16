import {
    ArrowLeft,
    ChevronRight,
    CircleCheck,
    MapPin,
    Package,
    RotateCcw,
    ShoppingBag,
    TicketPercent,
    Truck,
    X,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ShopApi } from './api';
import { responsiveImageSources } from './responsive-image';
import {
    ActiveCustomer,
    CustomerAddress,
    CustomerAddressInput,
    MarketConfig,
    Order,
    ProductVariant,
    ShippingMethod,
    StorefrontCart,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontLanguage,
} from './types';

const ORDER_NOTE_MAX_LENGTH = 500;
type CheckoutRoute = { name: 'payment' | 'cart' | 'addresses' };

export function CheckoutPage({
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
    onNavigate,
    onNotify,
    onApplyCoupon,
    onRemoveCoupon,
}: {
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
    onNavigate: (route: CheckoutRoute, replace?: boolean) => void;
    onNotify: (message: string) => void;
    onApplyCoupon: (couponCode: string) => Promise<string | null>;
    onRemoveCoupon: (couponCode: string) => Promise<string | null>;
}) {
    const isZh = language === 'zh';
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
    const [selectedShippingId, setSelectedShippingId] = useState('');
    const [preparedAddressKey, setPreparedAddressKey] = useState('');
    const [customerPrepared, setCustomerPrepared] = useState(Boolean(customer));
    const [shippingUpdating, setShippingUpdating] = useState(false);
    const [couponOpen, setCouponOpen] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const [noteError, setNoteError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const defaultAddress =
        customer?.addresses?.find(address => address.defaultShippingAddress) ?? customer?.addresses?.[0];
    const requiresShipping =
        order?.checkoutFulfillment?.requiresShippingAddress ??
        order?.lines.some(line => line.productVariant.customFields.fulfillmentType === 'physical');
    const physicalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'physical') ?? [];
    const digitalLines =
        order?.lines.filter(line => line.productVariant.customFields.fulfillmentType === 'digital') ?? [];

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
            if (!customerPrepared) {
                await api.setCustomer({
                    firstName: String(data.get('firstName') ?? ''),
                    lastName: String(data.get('lastName') ?? ''),
                    emailAddress: String(data.get('emailAddress') ?? ''),
                });
                setCustomerPrepared(true);
            }
            if (requiresShipping) {
                const shippingAddress: CustomerAddressInput = {
                    fullName: String(data.get('fullName') ?? ''),
                    phoneNumber: String(data.get('phoneNumber') ?? ''),
                    streetLine1: String(data.get('streetLine1') ?? ''),
                    city: String(data.get('city') ?? ''),
                    province: String(data.get('province') ?? ''),
                    postalCode: String(data.get('postalCode') ?? ''),
                    countryCode: String(data.get('countryCode') ?? market.countryCode),
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
            onNavigate({ name: 'payment' }, true);
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
            <Subpage title={isZh ? '确认订单' : 'Review order'} language={language} onBack={onBack}>
                <EmptyState
                    icon={<ShoppingBag />}
                    title={isZh ? '没有可结算商品' : 'Nothing to check out'}
                    action={isZh ? '返回购物车' : 'Back to cart'}
                    onAction={() => onNavigate({ name: 'cart' })}
                />
            </Subpage>
        );
    }

    return (
        <main className="page subpage checkout-page">
            <SubHeader title={isZh ? '确认订单' : 'Review order'} language={language} onBack={onBack} />
            <form ref={formRef} className="checkout-form" onSubmit={event => void submit(event)}>
                {!customer && (
                    <section className="checkout-section">
                        <h2>{isZh ? '联系信息' : 'Contact'}</h2>
                        <div className="form-grid">
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
                )}
                {requiresShipping && (
                    <section className="checkout-section">
                        <h2>{isZh ? '收货地址' : 'Shipping address'}</h2>
                        {defaultAddress ? (
                            <>
                                <button
                                    className="saved-address"
                                    type="button"
                                    onClick={() => onNavigate({ name: 'addresses' })}
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
                            <div className="form-grid">
                                <CountryField
                                    countries={availableCountries}
                                    defaultCountryCode={market.countryCode}
                                    language={language}
                                />
                                <Field name="fullName" label={isZh ? '收货人' : 'Full name'} />
                                <Field name="phoneNumber" label={isZh ? '手机号' : 'Phone'} />
                                <Field name="province" label={isZh ? '省/州' : 'Province'} />
                                <Field name="city" label={isZh ? '城市' : 'City'} />
                                <Field name="streetLine1" label={isZh ? '详细地址' : 'Street address'} wide />
                                <Field name="postalCode" label={isZh ? '邮政编码' : 'Postal code'} wide />
                            </div>
                        )}
                    </section>
                )}
                {!!physicalLines.length && (
                    <CheckoutItemsGroup
                        title={isZh ? '快递配送' : 'Delivery'}
                        hint={
                            isZh
                                ? `${physicalLines.length} 种 · 共 ${physicalLines.reduce((sum, line) => sum + line.quantity, 0)} 件`
                                : `${physicalLines.length} ${physicalLines.length === 1 ? 'product' : 'products'}`
                        }
                        lines={physicalLines}
                        locale={locale}
                        language={language}
                    />
                )}
                {!!digitalLines.length && (
                    <CheckoutItemsGroup
                        title={isZh ? '数字交付' : 'Digital delivery'}
                        hint={
                            isZh
                                ? `${digitalLines.length} 种 · 共 ${digitalLines.reduce((sum, line) => sum + line.quantity, 0)} 件`
                                : `${digitalLines.length} ${digitalLines.length === 1 ? 'product' : 'products'}`
                        }
                        lines={digitalLines}
                        locale={locale}
                        language={language}
                    />
                )}
                <section className="checkout-section checkout-options">
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
                        <fieldset className="shipping-method-list" disabled={shippingUpdating || submitting}>
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
                            {order.couponCodes.length
                                ? isZh
                                    ? `已使用 ${order.couponCodes.length} 个优惠码`
                                    : `${order.couponCodes.length} applied`
                                : isZh
                                  ? '输入优惠码'
                                  : 'Enter coupon code'}
                            <ChevronRight />
                        </small>
                    </button>
                </section>
                <section className="checkout-section">
                    <PriceSummary
                        order={order}
                        locale={locale}
                        language={language}
                        requiresShipping={requiresShipping}
                    />
                </section>
                <section
                    className="checkout-assurance"
                    aria-label={isZh ? '购物保障' : 'Purchase protection'}
                >
                    <span>
                        <CircleCheck />
                        {physicalLines.length
                            ? isZh
                                ? '正品保障'
                                : 'Authenticity'
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
                              ? '自动交付'
                              : 'Automatic delivery'}
                    </span>
                    <span>
                        <RotateCcw />
                        {isZh ? '售后支持' : 'After-sales'}
                    </span>
                </section>
                {formError && <InlineError message={formError} />}
                <div className="submit-order-bar">
                    <div>
                        <small>
                            {isZh
                                ? `共 ${order.totalQuantity} 件`
                                : `${order.totalQuantity} ${order.totalQuantity === 1 ? 'item' : 'items'}`}
                        </small>
                        <span>
                            {isZh ? '合计' : 'Total'}{' '}
                            <strong>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</strong>
                        </span>
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
                              : isZh
                                ? '提交订单'
                                : 'Submit order'}
                    </button>
                </div>
            </form>
            {couponOpen && (
                <CouponSheet
                    couponCodes={order.couponCodes}
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
                    <form className="order-note-sheet" onSubmit={event => void saveOrderNote(event)}>
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
                        <div className="order-note-meta">
                            <small>{isZh ? '最多 500 个字符' : 'Up to 500 characters'}</small>
                            <span>
                                {noteDraft.length}/{ORDER_NOTE_MAX_LENGTH}
                            </span>
                        </div>
                        {noteError && <InlineError message={noteError} />}
                        <div className="order-note-actions">
                            <button
                                type="button"
                                disabled={noteSaving || !noteDraft}
                                onClick={() => setNoteDraft('')}
                            >
                                {isZh ? '清空' : 'Clear'}
                            </button>
                            <button className="primary-action" type="submit" disabled={noteSaving}>
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
}: {
    title: string;
    hint: string;
    lines: Order['lines'];
    locale: string;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    return (
        <section className="checkout-section checkout-product-group">
            <header className="checkout-section-title">
                <h2>{title}</h2>
                <span>{hint}</span>
            </header>
            <div className="checkout-items">
                {lines.map(line => (
                    <article key={line.id}>
                        <ProductVariantImage variant={line.productVariant} alt={line.productVariant.name} />
                        <div>
                            <strong>{line.productVariant.name}</strong>
                            <small>{line.productVariant.sku}</small>
                            <em>
                                {line.productVariant.customFields.fulfillmentType === 'digital'
                                    ? isZh
                                        ? '付款后自动交付'
                                        : 'Delivered after payment'
                                    : isZh
                                      ? '售后支持 · 正品保障'
                                      : 'After-sales support'}
                            </em>
                        </div>
                        <span>
                            <b>
                                {formatMoney(line.linePriceWithTax, line.productVariant.currencyCode, locale)}
                            </b>
                            <small>×{line.quantity}</small>
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
        <dl className="price-summary">
            <div>
                <dt>{isZh ? '商品金额' : 'Items'}</dt>
                <dd>{formatMoney(order.subTotalWithTax + discount, order.currencyCode, locale)}</dd>
            </div>
            <div>
                <dt>
                    {requiresShipping ? (isZh ? '运费' : 'Shipping') : isZh ? '数字交付' : 'Digital delivery'}
                </dt>
                <dd>{formatMoney(order.shippingWithTax, order.currencyCode, locale)}</dd>
            </div>
            {discount > 0 && (
                <div className="discount">
                    <dt>{isZh ? '优惠' : 'Discount'}</dt>
                    <dd>-{formatMoney(discount, order.currencyCode, locale)}</dd>
                </div>
            )}
            <div className="summary-total">
                <dt>{isZh ? '合计' : 'Total'}</dt>
                <dd>{formatMoney(order.totalWithTax, order.currencyCode, locale)}</dd>
            </div>
        </dl>
    );
}
function CouponSheet({
    couponCodes,
    language,
    loading,
    onApply,
    onRemove,
    onClose,
}: {
    couponCodes: string[];
    language: StorefrontLanguage;
    loading: boolean;
    onApply: (couponCode: string) => Promise<string | null>;
    onRemove: (couponCode: string) => Promise<string | null>;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const [couponCode, setCouponCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const apply = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const code = couponCode.trim();
        if (!code) return;
        setSubmitting(true);
        setError('');
        const nextError = await onApply(code);
        setSubmitting(false);
        if (nextError) setError(nextError);
        else setCouponCode('');
    };
    const remove = async (code: string) => {
        setSubmitting(true);
        setError('');
        const nextError = await onRemove(code);
        setSubmitting(false);
        if (nextError) setError(nextError);
    };
    return (
        <Sheet title={isZh ? '优惠码' : 'Coupon code'} language={language} onClose={onClose}>
            <div className="coupon-sheet-content">
                <form className="coupon-code-form" onSubmit={event => void apply(event)}>
                    <label>
                        <span>{isZh ? '输入优惠码' : 'Enter coupon code'}</span>
                        <input
                            value={couponCode}
                            onChange={event => setCouponCode(event.target.value)}
                            autoComplete="off"
                            placeholder={isZh ? '例如 SAVE10' : 'For example, SAVE10'}
                        />
                    </label>
                    <button type="submit" disabled={loading || submitting || !couponCode.trim()}>
                        {submitting ? (isZh ? '处理中' : 'Applying') : isZh ? '应用' : 'Apply'}
                    </button>
                </form>
                {!!couponCodes.length && (
                    <section className="applied-coupons">
                        <strong>{isZh ? '已使用' : 'Applied'}</strong>
                        {couponCodes.map(code => (
                            <div key={code}>
                                <span>
                                    <TicketPercent />
                                    {code}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void remove(code)}
                                    disabled={loading || submitting}
                                >
                                    {isZh ? '移除' : 'Remove'}
                                </button>
                            </div>
                        ))}
                    </section>
                )}
                {error && <small className="form-error">{error}</small>}
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
        <header className="topbar subpage-header">
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
        <main className="page subpage">
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
        <section className="empty-state">
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
        <div className="inline-error" role="alert">
            <span>{message}</span>
        </div>
    );
}
function Field({
    name,
    label,
    type = 'text',
    wide = false,
}: {
    name: string;
    label: string;
    type?: string;
    wide?: boolean;
}) {
    return (
        <label className={wide ? 'field-wide' : undefined}>
            <span>{label}</span>
            <input name={name} type={type} required />
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
function ProductVariantImage({ variant, alt }: { variant: ProductVariant; alt: string }) {
    const src = variant.featuredAsset?.preview ?? variant.product.featuredAsset?.preview;
    if (!src)
        return (
            <div className="image-placeholder" aria-hidden="true">
                <Package />
            </div>
        );
    const source = responsiveImageSources(src, 'thumbnail');
    return source ? (
        <picture className="responsive-picture safe-image-frame">
            <source type="image/avif" srcSet={source.avifSrcSet} sizes={source.sizes} />
            <source type="image/webp" srcSet={source.webpSrcSet} sizes={source.sizes} />
            <img
                className="safe-image is-loaded"
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
