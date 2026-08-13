import {
    Check,
    ChevronDown,
    CircleHelp,
    Globe2,
    Minus,
    Package,
    Plus,
    Search,
    ShoppingBag,
    Trash2,
    Truck,
    X,
    Zap,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import { ShopApi } from './api';
import { copy, enabledMarkets, markets } from './i18n';
import {
    FulfillmentType,
    MarketCode,
    MarketConfig,
    Order,
    Product,
    ProductVariant,
    ShippingMethod,
} from './types';

type SortMode = 'recommended' | 'price-asc' | 'price-desc';
type Panel = 'cart' | 'checkout' | null;

export function App() {
    const [marketCode, setMarketCode] = useState<MarketCode>(() => {
        const stored = localStorage.getItem('storefront-market');
        return enabledMarkets.some(market => market.code === stored)
            ? (stored as MarketCode)
            : enabledMarkets[0].code;
    });
    const [products, setProducts] = useState<Product[]>([]);
    const [order, setOrder] = useState<Order | null>(null);
    const [query, setQuery] = useState('');
    const [sortMode, setSortMode] = useState<SortMode>('recommended');
    const [panel, setPanel] = useState<Panel>(null);
    const [loading, setLoading] = useState(true);
    const [cartLoading, setCartLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [cartError, setCartError] = useState<string | null>(null);
    const [addingVariantId, setAddingVariantId] = useState<string | null>(null);

    const market = markets[marketCode];
    const text = copy[marketCode];
    const api = useMemo(() => new ShopApi(market), [market]);

    useEffect(() => {
        localStorage.setItem('storefront-market', marketCode);
        document.documentElement.lang = marketCode === 'cn-mainland' ? 'zh-CN' : 'en-MY';
        document.title = `${text.brand} · ${text.marketTagline}`;
        setLoading(true);
        setCartLoading(true);
        setError(null);
        setCartError(null);
        setPanel(null);
        void Promise.allSettled([api.products(), api.activeOrder()]).then(([productResult, orderResult]) => {
            if (productResult.status === 'fulfilled') {
                setProducts(productResult.value);
            } else {
                setError(
                    productResult.reason instanceof Error ? productResult.reason.message : text.loadError,
                );
            }
            if (orderResult.status === 'fulfilled') {
                setOrder(orderResult.value);
            } else {
                setCartError(
                    orderResult.reason instanceof Error ? orderResult.reason.message : text.loadError,
                );
            }
            setLoading(false);
            setCartLoading(false);
        });
    }, [api, marketCode, text.brand, text.loadError, text.marketTagline]);

    const visibleProducts = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase(market.locale);
        const filtered = products.filter(product => {
            if (!normalizedQuery) return true;
            const searchable = [
                product.name,
                product.description,
                ...product.variants.flatMap(variant => [variant.name, variant.sku]),
            ]
                .join(' ')
                .toLocaleLowerCase(market.locale);
            return searchable.includes(normalizedQuery);
        });
        if (sortMode === 'recommended') return filtered;
        return [...filtered].sort((a, b) => {
            const aPrice = Math.min(...a.variants.map(variant => variant.priceWithTax));
            const bPrice = Math.min(...b.variants.map(variant => variant.priceWithTax));
            return sortMode === 'price-asc' ? aPrice - bPrice : bPrice - aPrice;
        });
    }, [market.locale, products, query, sortMode]);

    const addToCart = async (variant: ProductVariant) => {
        setAddingVariantId(variant.id);
        setCartError(null);
        try {
            setOrder(await api.addItem(variant.id));
            setPanel('cart');
        } catch (requestError) {
            setCartError(requestError instanceof Error ? requestError.message : text.loadError);
        } finally {
            setAddingVariantId(null);
        }
    };

    const updateQuantity = async (lineId: string, quantity: number) => {
        if (quantity < 1) return;
        setCartLoading(true);
        try {
            setOrder(await api.adjustLine(lineId, quantity));
        } catch (requestError) {
            setCartError(requestError instanceof Error ? requestError.message : text.loadError);
        } finally {
            setCartLoading(false);
        }
    };

    const removeLine = async (lineId: string) => {
        setCartLoading(true);
        try {
            setOrder(await api.removeLine(lineId));
        } catch (requestError) {
            setCartError(requestError instanceof Error ? requestError.message : text.loadError);
        } finally {
            setCartLoading(false);
        }
    };

    const refreshOrder = async () => setOrder(await api.activeOrder());

    const changeMarket = (nextMarket: MarketCode) => {
        setQuery('');
        setSortMode('recommended');
        setMarketCode(nextMarket);
    };

    return (
        <div className="storefront-shell">
            <header className="site-header">
                <div className="header-inner">
                    <a className="brand-lockup" href="#catalog" aria-label={text.brand}>
                        <span className="brand-mark">明</span>
                        <span>
                            <strong>{text.brand}</strong>
                            <small>{text.marketTagline}</small>
                        </span>
                    </a>
                    <nav className="primary-nav" aria-label={text.navProducts}>
                        <a href="#catalog">{text.navProducts}</a>
                    </nav>
                    <div className="header-actions">
                        <MarketSwitcher value={marketCode} label={text.marketLabel} onChange={changeMarket} />
                        <button className="cart-button" type="button" onClick={() => setPanel('cart')}>
                            <ShoppingBag aria-hidden="true" />
                            <span>{text.cart}</span>
                            <span className="cart-count" aria-label={`${order?.totalQuantity ?? 0}`}>
                                {order?.totalQuantity ?? 0}
                            </span>
                        </button>
                    </div>
                </div>
            </header>

            <main id="catalog" className="catalog-main">
                <section className="catalog-toolbar" aria-labelledby="catalog-title">
                    <div>
                        <p className="catalog-eyebrow">{text.marketTagline}</p>
                        <h1 id="catalog-title">{text.navProducts}</h1>
                        <p>{text.productsFound(visibleProducts.length)}</p>
                    </div>
                    <div className="catalog-controls">
                        <label className="search-box">
                            <Search aria-hidden="true" />
                            <span className="sr-only">{text.searchPlaceholder}</span>
                            <input
                                type="search"
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={text.searchPlaceholder}
                            />
                        </label>
                        <label className="sort-select">
                            <span className="sr-only">{text.sortRecommended}</span>
                            <select
                                value={sortMode}
                                onChange={event => setSortMode(event.target.value as SortMode)}
                            >
                                <option value="recommended">{text.sortRecommended}</option>
                                <option value="price-asc">{text.sortPriceAsc}</option>
                                <option value="price-desc">{text.sortPriceDesc}</option>
                            </select>
                            <ChevronDown aria-hidden="true" />
                        </label>
                    </div>
                </section>

                {loading ? (
                    <ProductSkeleton label={text.loading} />
                ) : error ? (
                    <EmptyState
                        title={text.loadError}
                        detail={error}
                        action={text.retry}
                        onAction={() => location.reload()}
                    />
                ) : visibleProducts.length === 0 ? (
                    <EmptyState title={text.emptySearch} />
                ) : (
                    <section className="product-grid" aria-live="polite">
                        {visibleProducts.map(product => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                market={market}
                                marketCode={marketCode}
                                addingVariantId={addingVariantId}
                                onAdd={variant => void addToCart(variant)}
                            />
                        ))}
                    </section>
                )}
            </main>

            {panel && (
                <div className="panel-layer" role="presentation" onMouseDown={() => setPanel(null)}>
                    <aside
                        className="side-panel"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="panel-title"
                        onMouseDown={event => event.stopPropagation()}
                    >
                        {panel === 'cart' ? (
                            <CartPanel
                                order={order}
                                market={market}
                                marketCode={marketCode}
                                loading={cartLoading}
                                error={cartError}
                                onClose={() => setPanel(null)}
                                onCheckout={() => setPanel('checkout')}
                                onContinue={() => setPanel(null)}
                                onUpdate={(lineId, quantity) => void updateQuantity(lineId, quantity)}
                                onRemove={lineId => void removeLine(lineId)}
                            />
                        ) : (
                            <CheckoutPanel
                                api={api}
                                order={order}
                                market={market}
                                marketCode={marketCode}
                                onBack={() => setPanel('cart')}
                                onClose={() => setPanel(null)}
                                onOrderChange={setOrder}
                                onRefresh={refreshOrder}
                            />
                        )}
                    </aside>
                </div>
            )}
        </div>
    );
}

function ProductCard({
    product,
    market,
    marketCode,
    addingVariantId,
    onAdd,
}: {
    product: Product;
    market: MarketConfig;
    marketCode: MarketCode;
    addingVariantId: string | null;
    onAdd: (variant: ProductVariant) => void;
}) {
    const text = copy[marketCode];
    const [selectedId, setSelectedId] = useState(product.variants[0]?.id ?? '');
    const variant = product.variants.find(item => item.id === selectedId) ?? product.variants[0];
    if (!variant) return null;
    const fulfillmentType = variant.customFields.fulfillmentType;
    const outOfStock = fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK';
    const isAdding = addingVariantId === variant.id;

    return (
        <article className="product-card">
            <div className="product-media">
                {product.featuredAsset ? (
                    <img src={product.featuredAsset.preview} alt="" loading="lazy" />
                ) : (
                    <Package aria-hidden="true" />
                )}
                <FulfillmentBadge type={fulfillmentType} marketCode={marketCode} />
            </div>
            <div className="product-copy">
                <div className="product-heading">
                    <h2>{product.name}</h2>
                    <strong>{formatMoney(variant.priceWithTax, variant.currencyCode, market.locale)}</strong>
                </div>
                <p>{product.description}</p>
                <label className="variant-select">
                    <span>{text.chooseVariant}</span>
                    <select value={variant.id} onChange={event => setSelectedId(event.target.value)}>
                        {product.variants.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                </label>
                <button
                    className="primary-button"
                    type="button"
                    disabled={outOfStock || isAdding}
                    onClick={() => onAdd(variant)}
                >
                    <ShoppingBag aria-hidden="true" />
                    {isAdding ? text.adding : outOfStock ? text.soldOut : text.addToCart}
                </button>
            </div>
        </article>
    );
}

function FulfillmentBadge({ type, marketCode }: { type: FulfillmentType; marketCode: MarketCode }) {
    const text = copy[marketCode];
    const help = type === 'digital' ? text.digitalHelp : text.physicalHelp;
    return (
        <span className={`fulfillment-badge ${type}`} title={help}>
            {type === 'digital' ? <Zap aria-hidden="true" /> : <Truck aria-hidden="true" />}
            {type === 'digital' ? text.digital : text.physical}
            <CircleHelp aria-label={text.helpLabel} />
        </span>
    );
}

function CartPanel({
    order,
    market,
    marketCode,
    loading,
    error,
    onClose,
    onCheckout,
    onContinue,
    onUpdate,
    onRemove,
}: {
    order: Order | null;
    market: MarketConfig;
    marketCode: MarketCode;
    loading: boolean;
    error: string | null;
    onClose: () => void;
    onCheckout: () => void;
    onContinue: () => void;
    onUpdate: (lineId: string, quantity: number) => void;
    onRemove: (lineId: string) => void;
}) {
    const text = copy[marketCode];
    const isEmpty = !order?.lines.length;
    return (
        <>
            <PanelHeader title={text.cartTitle} closeLabel={text.close} onClose={onClose} />
            <div className="panel-content">
                {loading && <p className="status-copy">{text.loadingCart}</p>}
                {error && <p className="inline-error">{error}</p>}
                {isEmpty ? (
                    <div className="empty-cart">
                        <ShoppingBag aria-hidden="true" />
                        <h3>{text.emptyCart}</h3>
                        <p>{text.emptyCartHint}</p>
                        <button type="button" className="secondary-button" onClick={onContinue}>
                            {text.continueShopping}
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="cart-lines">
                            {order.lines.map(line => (
                                <div className="cart-line" key={line.id}>
                                    <div className="cart-line-image">
                                        {line.productVariant.featuredAsset ? (
                                            <img src={line.productVariant.featuredAsset.preview} alt="" />
                                        ) : (
                                            <Package aria-hidden="true" />
                                        )}
                                    </div>
                                    <div className="cart-line-copy">
                                        <strong>{line.productVariant.name}</strong>
                                        <span>SKU {line.productVariant.sku}</span>
                                        <FulfillmentBadge
                                            type={line.customFields.fulfillmentTypeSnapshot}
                                            marketCode={marketCode}
                                        />
                                        <div className="quantity-row">
                                            <div className="quantity-control">
                                                <button
                                                    type="button"
                                                    onClick={() => onUpdate(line.id, line.quantity - 1)}
                                                    disabled={line.quantity <= 1 || loading}
                                                    aria-label="-"
                                                >
                                                    <Minus aria-hidden="true" />
                                                </button>
                                                <span>{line.quantity}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => onUpdate(line.id, line.quantity + 1)}
                                                    disabled={loading}
                                                    aria-label="+"
                                                >
                                                    <Plus aria-hidden="true" />
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                className="remove-button"
                                                onClick={() => onRemove(line.id)}
                                                disabled={loading}
                                                title={text.remove}
                                                aria-label={text.remove}
                                            >
                                                <Trash2 aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                    <strong className="line-price">
                                        {formatMoney(
                                            line.linePriceWithTax,
                                            order.currencyCode,
                                            market.locale,
                                        )}
                                    </strong>
                                </div>
                            ))}
                        </div>
                        <OrderSummary order={order} market={market} marketCode={marketCode} />
                    </>
                )}
            </div>
            {!isEmpty && (
                <div className="panel-footer">
                    <button className="primary-button wide" type="button" onClick={onCheckout}>
                        {text.checkout}
                    </button>
                </div>
            )}
        </>
    );
}

function CheckoutPanel({
    api,
    order,
    market,
    marketCode,
    onBack,
    onClose,
    onOrderChange,
    onRefresh,
}: {
    api: ShopApi;
    order: Order | null;
    market: MarketConfig;
    marketCode: MarketCode;
    onBack: () => void;
    onClose: () => void;
    onOrderChange: (order: Order | null) => void;
    onRefresh: () => Promise<void>;
}) {
    const text = copy[marketCode];
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
    const [selectedShippingId, setSelectedShippingId] = useState('');

    const needsAddress = order?.checkoutFulfillment.requiresShippingAddress ?? false;
    const isMixed = order?.checkoutFulfillment.fulfillmentType === 'MIXED';
    const selectedShippingMethod = shippingMethods.find(method => method.id === selectedShippingId);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        const data = new FormData(event.currentTarget);
        try {
            if (!order) return;
            if (!order.customer) {
                await api.setCustomer({
                    firstName: String(data.get('firstName')),
                    lastName: String(data.get('lastName')),
                    emailAddress: String(data.get('email')),
                    phoneNumber: String(data.get('phone')),
                });
            }
            if (needsAddress) {
                await api.setShippingAddress({
                    fullName: String(data.get('fullName')),
                    streetLine1: String(data.get('streetLine1')),
                    streetLine2: String(data.get('streetLine2')),
                    city: String(data.get('city')),
                    province: String(data.get('province')),
                    postalCode: String(data.get('postalCode')),
                    countryCode: market.countryCode,
                    phoneNumber: String(data.get('phone')),
                });
                let methods = shippingMethods;
                if (!methods.length) {
                    methods = await api.eligibleShippingMethods();
                    setShippingMethods(methods);
                }
                const shippingId = selectedShippingId || methods[0]?.id;
                if (!shippingId) throw new Error(text.checkoutError);
                await api.setShippingMethod(shippingId);
            }
            const updatedOrder = await api.transitionToPayment();
            onOrderChange(updatedOrder);
            setSuccess(true);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : text.checkoutError);
            await onRefresh().catch(() => undefined);
        } finally {
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (!needsAddress) return;
        api.eligibleShippingMethods()
            .then(methods => {
                setShippingMethods(methods);
                setSelectedShippingId(methods[0]?.id ?? '');
            })
            .catch(requestError => {
                setError(requestError instanceof Error ? requestError.message : text.checkoutError);
            });
    }, [api, needsAddress, text.checkoutError]);

    if (!order) return null;

    if (success) {
        return (
            <>
                <PanelHeader title={text.checkoutSuccess} closeLabel={text.close} onClose={onClose} />
                <div className="success-state">
                    <span>
                        <Check aria-hidden="true" />
                    </span>
                    <h3>{text.checkoutSuccess}</h3>
                    <p>{text.checkoutSuccessDescription}</p>
                    <div className="order-reference">{order.code}</div>
                </div>
            </>
        );
    }

    return (
        <>
            <PanelHeader
                title={text.checkoutTitle}
                closeLabel={text.close}
                onClose={onClose}
                backLabel={text.backToCart}
                onBack={onBack}
            />
            <form className="checkout-form" onSubmit={event => void handleSubmit(event)}>
                <div className="panel-content">
                    {order.checkoutFulfillment.fulfillmentType === 'DIGITAL' && (
                        <div className="checkout-notice digital">
                            <Zap aria-hidden="true" />
                            <div>
                                <strong>{text.digitalCheckoutTitle}</strong>
                                <p>{text.digitalCheckoutDescription}</p>
                            </div>
                        </div>
                    )}
                    {isMixed && (
                        <div className="checkout-notice mixed">
                            <Package aria-hidden="true" />
                            <p>{text.mixedNotice}</p>
                        </div>
                    )}
                    <fieldset>
                        <legend>{text.contactTitle}</legend>
                        <div className="form-grid two-columns">
                            <FormInput name="firstName" label={text.firstName} required />
                            <FormInput name="lastName" label={text.lastName} required />
                            <FormInput name="email" label={text.email} type="email" required fullWidth />
                            <FormInput name="phone" label={text.phone} type="tel" required fullWidth />
                        </div>
                    </fieldset>
                    {needsAddress && (
                        <fieldset>
                            <legend>{text.addressTitle}</legend>
                            <div className="form-grid two-columns">
                                <FormInput name="fullName" label={text.fullName} required fullWidth />
                                <FormInput name="streetLine1" label={text.streetLine1} required fullWidth />
                                <FormInput name="streetLine2" label={text.streetLine2} fullWidth />
                                <FormInput name="city" label={text.city} required />
                                <FormInput name="province" label={text.province} required />
                                <FormInput name="postalCode" label={text.postalCode} required fullWidth />
                            </div>
                        </fieldset>
                    )}
                    {needsAddress && (
                        <fieldset>
                            <legend>{text.shippingTitle}</legend>
                            <div className="shipping-methods">
                                {shippingMethods.map(method => (
                                    <label key={method.id} className="shipping-method">
                                        <input
                                            type="radio"
                                            name="shippingMethod"
                                            value={method.id}
                                            checked={selectedShippingId === method.id}
                                            onChange={() => setSelectedShippingId(method.id)}
                                        />
                                        <span>
                                            <strong>{method.name}</strong>
                                            <small>{method.description}</small>
                                        </span>
                                        <strong>
                                            {formatMoney(
                                                method.priceWithTax,
                                                order.currencyCode,
                                                market.locale,
                                            )}
                                        </strong>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    )}
                    {error && <p className="inline-error">{error}</p>}
                    <OrderSummary
                        order={order}
                        market={market}
                        marketCode={marketCode}
                        shippingPreviewWithTax={selectedShippingMethod?.priceWithTax}
                    />
                </div>
                <div className="panel-footer">
                    <button className="primary-button wide" type="submit" disabled={submitting}>
                        {submitting ? text.submittingOrder : text.submitOrder}
                    </button>
                </div>
            </form>
        </>
    );
}

function FormInput({
    name,
    label,
    type = 'text',
    required = false,
    fullWidth = false,
}: {
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    fullWidth?: boolean;
}) {
    return (
        <label className={fullWidth ? 'full-width' : undefined}>
            <span>
                {label}
                {required ? ' *' : ''}
            </span>
            <input name={name} type={type} required={required} autoComplete={autoCompleteFor(name)} />
        </label>
    );
}

function OrderSummary({
    order,
    market,
    marketCode,
    shippingPreviewWithTax,
}: {
    order: Order;
    market: MarketConfig;
    marketCode: MarketCode;
    shippingPreviewWithTax?: number;
}) {
    const text = copy[marketCode];
    const shippingWithTax = shippingPreviewWithTax ?? order.shippingWithTax;
    const totalWithTax = order.totalWithTax - order.shippingWithTax + shippingWithTax;
    return (
        <dl className="order-summary">
            <div>
                <dt>{text.subtotal}</dt>
                <dd>{formatMoney(order.subTotalWithTax, order.currencyCode, market.locale)}</dd>
            </div>
            <div>
                <dt>{text.shipping}</dt>
                <dd>{formatMoney(shippingWithTax, order.currencyCode, market.locale)}</dd>
            </div>
            <div className="order-total">
                <dt>{text.total}</dt>
                <dd>{formatMoney(totalWithTax, order.currencyCode, market.locale)}</dd>
            </div>
        </dl>
    );
}

function PanelHeader({
    title,
    closeLabel,
    onClose,
    backLabel,
    onBack,
}: {
    title: string;
    closeLabel: string;
    onClose: () => void;
    backLabel?: string;
    onBack?: () => void;
}) {
    return (
        <header className="panel-header">
            <div>
                {onBack && (
                    <button className="back-button" type="button" onClick={onBack}>
                        {backLabel}
                    </button>
                )}
                <h2 id="panel-title">{title}</h2>
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label={closeLabel}>
                <X aria-hidden="true" />
            </button>
        </header>
    );
}

function MarketSwitcher({
    value,
    label,
    onChange,
}: {
    value: MarketCode;
    label: string;
    onChange: (value: MarketCode) => void;
}) {
    return (
        <label className="market-switcher">
            <Globe2 aria-hidden="true" />
            <span className="sr-only">{label}</span>
            <select value={value} onChange={event => onChange(event.target.value as MarketCode)}>
                {enabledMarkets.map(market => (
                    <option key={market.code} value={market.code}>
                        {market.label}
                    </option>
                ))}
            </select>
            <ChevronDown aria-hidden="true" />
        </label>
    );
}

function ProductSkeleton({ label }: { label: string }) {
    return (
        <div className="product-skeleton" aria-live="polite">
            <span className="spinner" />
            {label}
        </div>
    );
}

function EmptyState({
    title,
    detail,
    action,
    onAction,
}: {
    title: string;
    detail?: string;
    action?: string;
    onAction?: () => void;
}) {
    return (
        <div className="catalog-empty">
            <Package aria-hidden="true" />
            <h2>{title}</h2>
            {detail && <p>{detail}</p>}
            {action && (
                <button className="secondary-button" onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
    );
}

function formatMoney(value: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value / 100);
}

function autoCompleteFor(name: string): string {
    return (
        (
            {
                firstName: 'given-name',
                lastName: 'family-name',
                email: 'email',
                phone: 'tel',
                fullName: 'name',
                streetLine1: 'address-line1',
                streetLine2: 'address-line2',
                city: 'address-level2',
                province: 'address-level1',
                postalCode: 'postal-code',
            } as Record<string, string>
        )[name] ?? 'off'
    );
}
