import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowLeft,
    Check,
    ChevronDown,
    ChevronUp,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    UserRound,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    ADD_ITEM_TO_DRAFT_ORDER,
    ADJUST_DRAFT_ORDER_LINE,
    APPLY_DRAFT_ORDER_COUPON,
    DELETE_DRAFT_ORDER,
    GET_DRAFT_ORDER_SHIPPING_METHODS,
    GET_SALES_ORDER,
    MODIFY_SALES_ORDER,
    ORDER_CUSTOMER_SEARCH_QUERY,
    ORDER_VARIANT_SEARCH_QUERY,
    REMOVE_DRAFT_ORDER_COUPON,
    REMOVE_DRAFT_ORDER_LINE,
    SET_DRAFT_ORDER_BILLING_ADDRESS,
    SET_DRAFT_ORDER_CUSTOMER,
    SET_DRAFT_ORDER_SHIPPING_ADDRESS,
    SET_DRAFT_ORDER_SHIPPING_METHOD,
    TRANSITION_SALES_ORDER,
} from '../../graphql/sales.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney, getMutationError, getOrderStateLabel, majorInputToMoney } from './sales-utils';

interface ResultPayload {
    __typename: string;
    id?: string;
    state?: string;
    errorCode?: string;
    message?: string;
}

interface WorkflowAddress {
    fullName?: string | null;
    company?: string | null;
    streetLine1?: string | null;
    streetLine2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    countryCode?: string | null;
    phoneNumber?: string | null;
}

interface WorkflowOrderLine {
    id: string;
    quantity: number;
    unitPriceWithTax: number;
    linePriceWithTax: number;
    productVariant: { id: string; name: string; sku: string };
}

interface WorkflowPayment {
    id: string;
    state: string;
    method: string;
    amount: number;
    refunds: Array<{ state: string; total: number }>;
}

interface WorkflowOrder {
    id: string;
    code: string;
    state: string;
    nextStates: string[];
    currencyCode: string;
    totalWithTax: number;
    couponCodes: string[];
    customer?: {
        id: string;
        firstName?: string | null;
        lastName?: string | null;
        emailAddress: string;
        phoneNumber?: string | null;
    } | null;
    shippingAddress?: WorkflowAddress | null;
    billingAddress?: WorkflowAddress | null;
    shippingLines: Array<{ shippingMethod: { id: string; name: string; code: string } }>;
    lines: WorkflowOrderLine[];
    payments?: WorkflowPayment[] | null;
}

interface OrderQueryData {
    order?: WorkflowOrder | null;
}

interface VariantItem {
    id: string;
    name: string;
    sku: string;
    price: number;
    currencyCode: string;
    stockLevel: string;
    enabled: boolean;
    featuredAsset?: { id: string; preview: string } | null;
}

interface CustomerAddress extends Omit<WorkflowAddress, 'country'> {
    id: string;
    defaultShippingAddress: boolean;
    defaultBillingAddress: boolean;
    country: { code: string; name: string };
}

interface CustomerItem {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    emailAddress: string;
    phoneNumber?: string | null;
    addresses: CustomerAddress[];
}

interface AddressForm {
    fullName: string;
    company: string;
    streetLine1: string;
    streetLine2: string;
    city: string;
    province: string;
    postalCode: string;
    countryCode: string;
    phoneNumber: string;
}

const resultOrThrow = (result: ResultPayload | null | undefined) => {
    if (result?.__typename !== 'Order') throw new Error(getMutationError(result));
    return result;
};

const customerName = (customer: Pick<CustomerItem, 'firstName' | 'lastName' | 'emailAddress'>) =>
    [customer.lastName, customer.firstName].filter(Boolean).join('') || customer.emailAddress;

const addressToForm = (address?: CustomerAddress | WorkflowAddress | null): AddressForm => ({
    fullName: address?.fullName ?? '',
    company: address?.company ?? '',
    streetLine1: address?.streetLine1 ?? '',
    streetLine2: address?.streetLine2 ?? '',
    city: address?.city ?? '',
    province: address?.province ?? '',
    postalCode: address?.postalCode ?? '',
    countryCode:
        (typeof address?.country === 'object' && address.country !== null
            ? address.country.code
            : address?.countryCode) ?? 'CN',
    phoneNumber: address?.phoneNumber ?? '',
});

function VariantSearch({
    currencyCode,
    disabled,
    onSelect,
}: {
    currencyCode: string;
    disabled: boolean;
    onSelect: (variant: VariantItem) => void;
}) {
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    const query = deferredSearch.trim();
    const { data, loading, error } = useQuery<{
        productVariants: { items: VariantItem[]; totalItems: number };
    }>(ORDER_VARIANT_SEARCH_QUERY, {
        variables: {
            options: {
                take: 20,
                sort: { name: 'ASC' },
                filter: {
                    enabled: { eq: true },
                    _or: [{ name: { contains: query } }, { sku: { contains: query } }],
                },
            },
        },
        skip: query.length === 0,
        fetchPolicy: 'cache-first',
    });

    return (
        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700">添加商品</label>
            <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="输入商品名称或 SKU"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
            </div>
            {loading && <p className="text-[11px] text-slate-400">正在搜索商品…</p>}
            {error && <p className="text-[11px] text-rose-600">商品搜索失败，请重试</p>}
            {query && !loading && !error && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                    {(data?.productVariants.items ?? []).map(variant => (
                        <button
                            key={variant.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => onSelect(variant)}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
                        >
                            <span className="min-w-0">
                                <strong className="block truncate text-xs text-slate-900">
                                    {variant.name}
                                </strong>
                                <span className="font-mono text-[10px] text-slate-400">{variant.sku}</span>
                            </span>
                            <span className="shrink-0 font-mono text-xs text-slate-700">
                                {formatMoney(variant.price, variant.currencyCode || currencyCode)}
                            </span>
                        </button>
                    ))}
                    {data?.productVariants.items.length === 0 && (
                        <p className="p-3 text-center text-xs text-slate-400">没有匹配的可用规格</p>
                    )}
                </div>
            )}
        </div>
    );
}

export function DraftOrderEditor() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const requestConfirmation = useConfirmDialog();
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [customerSearch, setCustomerSearch] = useState('');
    const deferredCustomerSearch = useDeferredValue(customerSearch);
    const [addressDraft, setAddressDraft] = useState<{
        orderId: string;
        form: AddressForm;
    } | null>(null);
    const [billingSame, setBillingSame] = useState(true);
    const [couponCode, setCouponCode] = useState('');

    const orderQuery = useQuery<OrderQueryData>(GET_SALES_ORDER, {
        variables: { id },
        skip: !id,
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const customerTerm = deferredCustomerSearch.trim();
    const customerQuery = useQuery<{
        customers: { items: CustomerItem[]; totalItems: number };
    }>(ORDER_CUSTOMER_SEARCH_QUERY, {
        variables: {
            options: {
                take: 20,
                sort: { createdAt: 'DESC' },
                filter: {
                    _or: [
                        { firstName: { contains: customerTerm } },
                        { lastName: { contains: customerTerm } },
                        { emailAddress: { contains: customerTerm } },
                        { phoneNumber: { contains: customerTerm } },
                    ],
                },
            },
        },
        skip: customerTerm.length === 0,
        fetchPolicy: 'cache-first',
    });
    const shippingMethodsQuery = useQuery<{
        eligibleShippingMethodsForDraftOrder: Array<{
            id: string;
            code: string;
            name: string;
            description: string;
            priceWithTax: number;
        }>;
    }>(GET_DRAFT_ORDER_SHIPPING_METHODS, {
        variables: { orderId: id },
        skip: !id || !orderQuery.data?.order?.shippingAddress?.streetLine1,
        fetchPolicy: 'network-only',
    });

    const [addItem, addItemState] = useMutation<{ addItemToDraftOrder: ResultPayload }>(
        ADD_ITEM_TO_DRAFT_ORDER,
    );
    const [adjustLine, adjustLineState] = useMutation<{ adjustDraftOrderLine: ResultPayload }>(
        ADJUST_DRAFT_ORDER_LINE,
    );
    const [removeLine, removeLineState] = useMutation<{ removeDraftOrderLine: ResultPayload }>(
        REMOVE_DRAFT_ORDER_LINE,
    );
    const [setCustomer, setCustomerState] = useMutation<{ setCustomerForDraftOrder: ResultPayload }>(
        SET_DRAFT_ORDER_CUSTOMER,
    );
    const [setShippingAddress, shippingAddressState] = useMutation(SET_DRAFT_ORDER_SHIPPING_ADDRESS);
    const [setBillingAddress, billingAddressState] = useMutation(SET_DRAFT_ORDER_BILLING_ADDRESS);
    const [setShippingMethod, shippingMethodState] = useMutation<{
        setDraftOrderShippingMethod: ResultPayload;
    }>(SET_DRAFT_ORDER_SHIPPING_METHOD);
    const [applyCoupon, applyCouponState] = useMutation<{ applyCouponCodeToDraftOrder: ResultPayload }>(
        APPLY_DRAFT_ORDER_COUPON,
    );
    const [removeCoupon, removeCouponState] = useMutation(REMOVE_DRAFT_ORDER_COUPON);
    const [transitionOrder, transitionState] = useMutation<{
        transitionOrderToState: ResultPayload | null;
    }>(TRANSITION_SALES_ORDER);
    const [deleteDraft, deleteState] = useMutation<{
        deleteDraftOrder: { result: string; message?: string | null };
    }>(DELETE_DRAFT_ORDER);

    const order = orderQuery.data?.order;
    const address =
        addressDraft && addressDraft.orderId === order?.id
            ? addressDraft.form
            : addressToForm(order?.shippingAddress);
    const setAddress = (next: AddressForm | ((current: AddressForm) => AddressForm)) => {
        const orderId = order?.id ?? id ?? '';
        setAddressDraft(currentDraft => {
            const current =
                currentDraft?.orderId === orderId ? currentDraft.form : addressToForm(order?.shippingAddress);
            return {
                orderId,
                form: typeof next === 'function' ? next(current) : next,
            };
        });
    };
    const busy =
        addItemState.loading ||
        adjustLineState.loading ||
        removeLineState.loading ||
        setCustomerState.loading ||
        shippingAddressState.loading ||
        billingAddressState.loading ||
        shippingMethodState.loading ||
        applyCouponState.loading ||
        removeCouponState.loading ||
        transitionState.loading ||
        deleteState.loading;

    const refresh = async (message: string) => {
        await orderQuery.refetch();
        setActionError('');
        setNotice(message);
        window.setTimeout(() => setNotice(''), 3500);
    };
    const fail = (error: unknown, fallback: string) => setActionError(toUserFacingError(error, fallback));

    const handleAddItem = async (variant: VariantItem) => {
        if (!order) return;
        try {
            const response = await addItem({
                variables: { orderId: order.id, input: { productVariantId: variant.id, quantity: 1 } },
            });
            resultOrThrow(response.data?.addItemToDraftOrder);
            await refresh(`已添加 ${variant.name}`);
        } catch (error) {
            fail(error, '商品添加失败');
        }
    };

    const changeLineQuantity = async (line: WorkflowOrderLine, quantity: number) => {
        if (!order) return;
        try {
            if (quantity <= 0) {
                const response = await removeLine({
                    variables: { orderId: order.id, orderLineId: line.id },
                });
                resultOrThrow(response.data?.removeDraftOrderLine);
            } else {
                const response = await adjustLine({
                    variables: { orderId: order.id, input: { orderLineId: line.id, quantity } },
                });
                resultOrThrow(response.data?.adjustDraftOrderLine);
            }
            await refresh('订单商品数量已更新');
        } catch (error) {
            fail(error, '商品数量更新失败');
        }
    };

    const chooseCustomer = async (customer: CustomerItem) => {
        if (!order) return;
        try {
            const response = await setCustomer({
                variables: { orderId: order.id, customerId: customer.id },
            });
            resultOrThrow(response.data?.setCustomerForDraftOrder);
            const shipping =
                customer.addresses.find(item => item.defaultShippingAddress) ?? customer.addresses[0];
            const billing = customer.addresses.find(item => item.defaultBillingAddress) ?? shipping;
            if (shipping) {
                const shippingInput = addressToForm(shipping);
                setAddress(shippingInput);
                await setShippingAddress({ variables: { orderId: order.id, input: shippingInput } });
            }
            if (billing) {
                await setBillingAddress({
                    variables: { orderId: order.id, input: addressToForm(billing) },
                });
            }
            setCustomerSearch('');
            await refresh('客户及默认地址已写入草稿订单');
        } catch (error) {
            fail(error, '客户设置失败');
        }
    };

    const saveAddress = async () => {
        if (!order) return;
        if (!address.fullName.trim() || !address.streetLine1.trim() || !address.countryCode.trim()) {
            setActionError('收件人、详细地址和国家代码为必填项');
            return;
        }
        try {
            await setShippingAddress({ variables: { orderId: order.id, input: address } });
            if (billingSame) {
                await setBillingAddress({ variables: { orderId: order.id, input: address } });
            }
            await refresh('订单地址已保存');
        } catch (error) {
            fail(error, '地址保存失败');
        }
    };

    const chooseShippingMethod = async (shippingMethodId: string) => {
        if (!order) return;
        try {
            const response = await setShippingMethod({
                variables: { orderId: order.id, shippingMethodId },
            });
            resultOrThrow(response.data?.setDraftOrderShippingMethod);
            await refresh('配送方式已更新');
        } catch (error) {
            fail(error, '配送方式设置失败');
        }
    };

    const handleApplyCoupon = async () => {
        if (!order || !couponCode.trim()) return;
        try {
            const response = await applyCoupon({
                variables: { orderId: order.id, couponCode: couponCode.trim() },
            });
            resultOrThrow(response.data?.applyCouponCodeToDraftOrder);
            setCouponCode('');
            await refresh('优惠码已应用');
        } catch (error) {
            fail(error, '优惠码应用失败');
        }
    };

    const handleRemoveCoupon = async (code: string) => {
        if (!order) return;
        try {
            await removeCoupon({ variables: { orderId: order.id, couponCode: code } });
            await refresh('优惠码已移除');
        } catch (error) {
            fail(error, '优惠码移除失败');
        }
    };

    const handleTransition = async (state: string) => {
        if (!order) return;
        try {
            const response = await transitionOrder({ variables: { id: order.id, state } });
            resultOrThrow(response.data?.transitionOrderToState);
            await refresh(`订单已进入${getOrderStateLabel(state)}`);
            navigate(`/sales/orders/${order.id}`);
        } catch (error) {
            fail(error, '订单状态推进失败，请检查客户、地址、配送和商品是否完整');
        }
    };

    const handleDelete = async () => {
        if (!order) return;
        const confirmed = await requestConfirmation({
            title: '删除草稿订单',
            description: `确定删除草稿 ${order.code}？该操作不会影响已完成订单。`,
            confirmLabel: '删除草稿',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            const response = await deleteDraft({ variables: { orderId: order.id } });
            if (response.data?.deleteDraftOrder.result !== 'DELETED') {
                throw new Error(response.data?.deleteDraftOrder.message || '草稿未删除');
            }
            navigate('/sales/orders?tab=drafts');
        } catch (error) {
            fail(error, '草稿删除失败');
        }
    };

    if (orderQuery.loading && !orderQuery.data) return <WorkflowLoading label="正在加载草稿订单…" />;
    if (orderQuery.error || !order)
        return (
            <WorkflowError
                message={toUserFacingError(orderQuery.error, '草稿订单不存在或加载失败')}
                onBack={() => navigate('/sales/orders?tab=drafts')}
                onRetry={() => void orderQuery.refetch()}
            />
        );

    return (
        <main className="flex h-full min-w-0 flex-col overflow-hidden bg-slate-50">
            <WorkflowHeader
                title={`草稿订单 ${order.code}`}
                subtitle={`状态：${getOrderStateLabel(order.state)} · 所有修改直接写入草稿`}
                onBack={() => navigate('/sales/orders?tab=drafts')}
                actions={
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete()}
                        className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                        删除草稿
                    </button>
                }
            />
            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                <div className="mx-auto w-full max-w-none space-y-4">
                    <WorkflowMessages
                        notice={notice}
                        error={actionError}
                        onClose={() => setActionError('')}
                    />
                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                        <h2 className="text-sm font-semibold text-slate-900">订单商品</h2>
                        <div className="mt-4 space-y-2">
                            {order.lines.map(line => (
                                <div
                                    key={line.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                                >
                                    <div className="min-w-0">
                                        <strong className="block truncate text-xs text-slate-900">
                                            {line.productVariant.name}
                                        </strong>
                                        <span className="font-mono text-[10px] text-slate-400">
                                            {line.productVariant.sku} ·{' '}
                                            {formatMoney(line.unitPriceWithTax, order.currencyCode)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void changeLineQuantity(line, line.quantity - 1)}
                                            className="rounded-md border border-slate-300 p-1.5 text-slate-600"
                                            aria-label={`减少${line.productVariant.name}数量`}
                                        >
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                        <span className="w-8 text-center font-mono text-xs font-semibold">
                                            {line.quantity}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void changeLineQuantity(line, line.quantity + 1)}
                                            className="rounded-md border border-slate-300 p-1.5 text-slate-600"
                                            aria-label={`增加${line.productVariant.name}数量`}
                                        >
                                            <ChevronUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void changeLineQuantity(line, 0)}
                                            className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                            aria-label={`移除${line.productVariant.name}`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {order.lines.length === 0 && (
                                <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-400">
                                    草稿还没有商品
                                </p>
                            )}
                        </div>
                        <div className="mt-5 border-t border-slate-100 pt-4">
                            <VariantSearch
                                currencyCode={order.currencyCode}
                                disabled={busy}
                                onSelect={variant => void handleAddItem(variant)}
                            />
                        </div>
                    </section>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <UserRound className="h-4 w-4 text-blue-600" /> 客户
                            </h2>
                            {order.customer && (
                                <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
                                    <strong>{customerName(order.customer)}</strong>
                                    <p className="mt-1 text-blue-700">{order.customer.emailAddress}</p>
                                </div>
                            )}
                            <input
                                value={customerSearch}
                                onChange={event => setCustomerSearch(event.target.value)}
                                placeholder="搜索姓名、手机号或邮箱"
                                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
                            />
                            {customerTerm && (
                                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                                    {(customerQuery.data?.customers.items ?? []).map(customer => (
                                        <button
                                            key={customer.id}
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void chooseCustomer(customer)}
                                            className="block w-full rounded-md px-3 py-2 text-left text-xs hover:bg-slate-50"
                                        >
                                            <strong>{customerName(customer)}</strong>
                                            <span className="ml-2 text-slate-400">
                                                {customer.emailAddress}
                                            </span>
                                        </button>
                                    ))}
                                    {!customerQuery.loading &&
                                        customerQuery.data?.customers.items.length === 0 && (
                                            <p className="p-3 text-center text-xs text-slate-400">
                                                没有匹配客户
                                            </p>
                                        )}
                                </div>
                            )}
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                            <h2 className="text-sm font-semibold text-slate-900">金额与优惠</h2>
                            <div className="mt-3 flex items-end justify-between rounded-lg bg-slate-900 p-4 text-white">
                                <span className="text-xs text-slate-300">草稿合计</span>
                                <strong className="font-mono text-xl">
                                    {formatMoney(order.totalWithTax, order.currencyCode)}
                                </strong>
                            </div>
                            <div className="mt-3 flex gap-2">
                                <input
                                    value={couponCode}
                                    onChange={event => setCouponCode(event.target.value)}
                                    placeholder="优惠码"
                                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                                />
                                <button
                                    type="button"
                                    disabled={busy || !couponCode.trim()}
                                    onClick={() => void handleApplyCoupon()}
                                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                    应用
                                </button>
                            </div>
                            {order.couponCodes.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {order.couponCodes.map(code => (
                                        <button
                                            key={code}
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void handleRemoveCoupon(code)}
                                            className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700"
                                        >
                                            {code} ×
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>

                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                        <h2 className="text-sm font-semibold text-slate-900">收货与账单地址</h2>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {(
                                [
                                    ['fullName', '收件人 *'],
                                    ['phoneNumber', '联系电话'],
                                    ['countryCode', '国家代码 *'],
                                    ['province', '省/州'],
                                    ['city', '城市'],
                                    ['postalCode', '邮编'],
                                    ['streetLine1', '详细地址 *'],
                                    ['streetLine2', '补充地址'],
                                    ['company', '公司'],
                                ] as Array<[keyof AddressForm, string]>
                            ).map(([key, label]) => (
                                <label key={key} className="text-xs font-semibold text-slate-700">
                                    {label}
                                    <input
                                        value={address[key]}
                                        onChange={event =>
                                            setAddress(current => ({ ...current, [key]: event.target.value }))
                                        }
                                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-normal"
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <label className="flex items-center gap-2 text-xs text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={billingSame}
                                    onChange={event => setBillingSame(event.target.checked)}
                                />
                                账单地址与收货地址相同
                            </label>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void saveAddress()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                            >
                                保存地址
                            </button>
                        </div>
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                        <h2 className="text-sm font-semibold text-slate-900">配送与完成草稿</h2>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <div>
                                <label className="text-xs font-semibold text-slate-700">配送方式</label>
                                <select
                                    value={order.shippingLines[0]?.shippingMethod.id ?? ''}
                                    onChange={event => void chooseShippingMethod(event.target.value)}
                                    disabled={busy || shippingMethodsQuery.loading}
                                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                                >
                                    <option value="">请选择配送方式</option>
                                    {(
                                        shippingMethodsQuery.data?.eligibleShippingMethodsForDraftOrder ?? []
                                    ).map(method => (
                                        <option key={method.id} value={method.id}>
                                            {method.name} ·{' '}
                                            {formatMoney(method.priceWithTax, order.currencyCode)}
                                        </option>
                                    ))}
                                </select>
                                {!order.shippingAddress?.streetLine1 && (
                                    <p className="mt-2 text-[10px] text-amber-700">
                                        先保存地址后才能计算可用配送方式
                                    </p>
                                )}
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-700">下一状态</p>
                                <div className="mt-1.5 flex flex-wrap gap-2">
                                    {order.nextStates.map(state => (
                                        <button
                                            key={state}
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void handleTransition(state)}
                                            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            完成草稿并进入{getOrderStateLabel(state)}
                                        </button>
                                    ))}
                                    {order.nextStates.length === 0 && (
                                        <p className="text-xs text-slate-400">当前状态没有可用的下一步</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}

interface SurchargeDraft {
    id: string;
    description: string;
    price: string;
}

interface PreviewOrder {
    __typename: string;
    id?: string;
    code?: string;
    state?: string;
    totalWithTax?: number;
    currencyCode?: string;
    lines?: WorkflowOrderLine[];
    message?: string;
    errorCode?: string;
}

export function ModifyOrderEditor() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const requestConfirmation = useConfirmDialog();
    const orderQuery = useQuery<OrderQueryData>(GET_SALES_ORDER, {
        variables: { id },
        skip: !id,
        fetchPolicy: 'cache-and-network',
    });
    const [adjustments, setAdjustments] = useState<Record<string, number>>({});
    const [addedItems, setAddedItems] = useState<Record<string, { variant: VariantItem; quantity: number }>>(
        {},
    );
    const [surcharges, setSurcharges] = useState<SurchargeDraft[]>([]);
    const [note, setNote] = useState('');
    const [preview, setPreview] = useState<PreviewOrder | null>(null);
    const [actionError, setActionError] = useState('');
    const [modifyOrder, modifyState] = useMutation<{ modifyOrder: PreviewOrder }>(MODIFY_SALES_ORDER);
    const order = orderQuery.data?.order;

    const changedLines = useMemo(
        () => order?.lines.filter(line => Object.prototype.hasOwnProperty.call(adjustments, line.id)) ?? [],
        [adjustments, order?.lines],
    );
    const hasChanges = changedLines.length > 0 || Object.keys(addedItems).length > 0 || surcharges.length > 0;
    const priceDifference =
        preview?.__typename === 'Order' && typeof preview.totalWithTax === 'number' && order
            ? preview.totalWithTax - order.totalWithTax
            : null;

    const invalidatePreview = () => {
        setPreview(null);
        setActionError('');
    };
    const setLineQuantity = (line: WorkflowOrderLine, quantity: number) => {
        setAdjustments(current => {
            if (quantity === line.quantity) {
                const next = { ...current };
                delete next[line.id];
                return next;
            }
            return { ...current, [line.id]: Math.max(0, quantity) };
        });
        invalidatePreview();
    };
    const addVariant = (variant: VariantItem) => {
        const existingLine = order?.lines.find(line => line.productVariant.id === variant.id);
        if (existingLine) {
            const currentQuantity = adjustments[existingLine.id] ?? existingLine.quantity;
            setLineQuantity(existingLine, currentQuantity + 1);
            return;
        }
        setAddedItems(current => ({
            ...current,
            [variant.id]: {
                variant,
                quantity: (current[variant.id]?.quantity ?? 0) + 1,
            },
        }));
        invalidatePreview();
    };
    const setAddedQuantity = (variantId: string, quantity: number) => {
        setAddedItems(current => {
            if (quantity <= 0) {
                const next = { ...current };
                delete next[variantId];
                return next;
            }
            return { ...current, [variantId]: { ...current[variantId], quantity } };
        });
        invalidatePreview();
    };

    const buildInput = (
        dryRun: boolean,
        refunds?: Array<{ paymentId: string; amount: number; reason: string }>,
    ) => {
        if (!order) return null;
        return {
            orderId: order.id,
            dryRun,
            addItems: Object.values(addedItems).map(item => ({
                productVariantId: item.variant.id,
                quantity: item.quantity,
            })),
            adjustOrderLines: changedLines.map(line => ({
                orderLineId: line.id,
                quantity: adjustments[line.id],
            })),
            surcharges: surcharges.map(item => ({
                description: item.description.trim(),
                sku: '',
                price: majorInputToMoney(item.price, order.currencyCode) ?? 0,
                priceIncludesTax: true,
            })),
            note: note.trim(),
            refunds,
            options: { recalculateShipping: true },
        };
    };

    const handlePreview = async () => {
        if (!order || !hasChanges) {
            setActionError('请先调整商品数量、添加商品或附加费用');
            return;
        }
        if (!note.trim()) {
            setActionError('请填写修改原因，便于订单审计');
            return;
        }
        if (
            surcharges.some(
                item => !item.description.trim() || majorInputToMoney(item.price, order.currencyCode) == null,
            )
        ) {
            setActionError('附加费用需要填写说明和有效金额');
            return;
        }
        try {
            const response = await modifyOrder({ variables: { input: buildInput(true) } });
            const result = response.data?.modifyOrder;
            if (result?.__typename !== 'Order') throw new Error(getMutationError(result));
            setPreview(result);
            setActionError('');
        } catch (error) {
            setActionError(toUserFacingError(error, '订单修改预览失败'));
        }
    };

    const allocateRefunds = (amount: number) => {
        if (!order) return [];
        let remaining = amount;
        const allocations: Array<{ paymentId: string; amount: number; reason: string }> = [];
        for (const payment of order.payments ?? []) {
            if (payment.state !== 'Settled' || remaining <= 0) continue;
            const alreadyRefunded = payment.refunds
                .filter(refund => !['Failed', 'Cancelled'].includes(refund.state))
                .reduce((sum, refund) => sum + refund.total, 0);
            const available = Math.max(0, payment.amount - alreadyRefunded);
            const allocated = Math.min(available, remaining);
            if (allocated > 0) {
                allocations.push({ paymentId: payment.id, amount: allocated, reason: note.trim() });
                remaining -= allocated;
            }
        }
        if (remaining > 0) throw new Error('已结算支付的可退款余额不足，无法完成本次订单减价');
        return allocations;
    };

    const handleConfirm = async () => {
        if (!order || preview?.__typename !== 'Order' || priceDifference == null) return;
        const confirmed = await requestConfirmation({
            title: '确认修改订单',
            description:
                priceDifference < 0
                    ? `订单将减少 ${formatMoney(Math.abs(priceDifference), order.currencyCode)}，系统会按已结算支付余额创建退款。\n修改原因：${note.trim()}`
                    : priceDifference > 0
                      ? `订单将增加 ${formatMoney(priceDifference, order.currencyCode)}，提交后需要继续处理补充支付。\n修改原因：${note.trim()}`
                      : `订单金额不变。\n修改原因：${note.trim()}`,
            confirmLabel: '写入修改',
            tone: priceDifference === 0 ? 'default' : 'warning',
        });
        if (!confirmed) return;
        try {
            const refunds = priceDifference < 0 ? allocateRefunds(Math.abs(priceDifference)) : undefined;
            const response = await modifyOrder({ variables: { input: buildInput(false, refunds) } });
            const result = response.data?.modifyOrder;
            if (result?.__typename !== 'Order') throw new Error(getMutationError(result));
            navigate(`/sales/orders/${order.id}`);
        } catch (error) {
            setActionError(toUserFacingError(error, '订单修改提交失败'));
        }
    };

    if (orderQuery.loading && !orderQuery.data) return <WorkflowLoading label="正在加载订单修改数据…" />;
    if (orderQuery.error || !order)
        return (
            <WorkflowError
                message={toUserFacingError(orderQuery.error, '订单不存在或加载失败')}
                onBack={() => navigate('/sales/orders')}
                onRetry={() => void orderQuery.refetch()}
            />
        );
    if (order.state !== 'Modifying')
        return (
            <WorkflowError
                message={`订单当前处于${getOrderStateLabel(order.state)}，必须先从订单详情将状态推进到“修改中”。`}
                onBack={() => navigate(`/sales/orders/${order.id}`)}
            />
        );

    return (
        <main className="flex h-full min-w-0 flex-col overflow-hidden bg-slate-50">
            <WorkflowHeader
                title={`修改订单 ${order.code}`}
                subtitle="先预览金额和退款影响，再写入真实订单"
                onBack={() => navigate(`/sales/orders/${order.id}`)}
            />
            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                <div className="mx-auto grid w-full max-w-none items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                    <div className="space-y-4">
                        <WorkflowMessages error={actionError} onClose={() => setActionError('')} />
                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                            <h2 className="text-sm font-semibold text-slate-900">调整订单商品</h2>
                            <div className="mt-4 space-y-2">
                                {order.lines.map(line => {
                                    const quantity = adjustments[line.id] ?? line.quantity;
                                    return (
                                        <div
                                            key={line.id}
                                            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${quantity === 0 ? 'border-rose-200 bg-rose-50/50 opacity-70' : 'border-slate-200'}`}
                                        >
                                            <div>
                                                <strong className="block text-xs">
                                                    {line.productVariant.name}
                                                </strong>
                                                <span className="font-mono text-[10px] text-slate-400">
                                                    {line.productVariant.sku} · 原数量 {line.quantity}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setLineQuantity(line, quantity - 1)}
                                                    className="rounded border border-slate-300 p-1.5"
                                                    aria-label={`减少${line.productVariant.name}数量`}
                                                >
                                                    <ChevronDown className="h-3.5 w-3.5" />
                                                </button>
                                                <span className="w-8 text-center font-mono text-xs font-semibold">
                                                    {quantity}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setLineQuantity(line, quantity + 1)}
                                                    className="rounded border border-slate-300 p-1.5"
                                                    aria-label={`增加${line.productVariant.name}数量`}
                                                >
                                                    <ChevronUp className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setLineQuantity(line, 0)}
                                                    className="rounded p-1.5 text-rose-600"
                                                    aria-label={`移除${line.productVariant.name}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {Object.values(addedItems).map(item => (
                                    <div
                                        key={item.variant.id}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"
                                    >
                                        <div>
                                            <strong className="block text-xs text-emerald-900">
                                                新增：{item.variant.name}
                                            </strong>
                                            <span className="font-mono text-[10px] text-emerald-700">
                                                {item.variant.sku}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setAddedQuantity(item.variant.id, item.quantity - 1)
                                                }
                                                className="rounded border border-emerald-300 p-1.5"
                                            >
                                                <ChevronDown className="h-3.5 w-3.5" />
                                            </button>
                                            <span className="w-8 text-center font-mono text-xs font-semibold">
                                                {item.quantity}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setAddedQuantity(item.variant.id, item.quantity + 1)
                                                }
                                                className="rounded border border-emerald-300 p-1.5"
                                            >
                                                <ChevronUp className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 border-t border-slate-100 pt-4">
                                <VariantSearch
                                    currencyCode={order.currencyCode}
                                    disabled={modifyState.loading}
                                    onSelect={addVariant}
                                />
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold text-slate-900">附加费用</h2>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSurcharges(current => [
                                            ...current,
                                            { id: crypto.randomUUID(), description: '', price: '' },
                                        ]);
                                        invalidatePreview();
                                    }}
                                    className="flex items-center gap-1 text-xs font-semibold text-blue-600"
                                >
                                    <Plus className="h-3.5 w-3.5" /> 添加费用
                                </button>
                            </div>
                            <div className="mt-3 space-y-2">
                                {surcharges.map(item => (
                                    <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                                        <input
                                            value={item.description}
                                            onChange={event => {
                                                setSurcharges(current =>
                                                    current.map(currentItem =>
                                                        currentItem.id === item.id
                                                            ? {
                                                                  ...currentItem,
                                                                  description: event.target.value,
                                                              }
                                                            : currentItem,
                                                    ),
                                                );
                                                invalidatePreview();
                                            }}
                                            placeholder="费用说明"
                                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                                        />
                                        <input
                                            value={item.price}
                                            onChange={event => {
                                                setSurcharges(current =>
                                                    current.map(currentItem =>
                                                        currentItem.id === item.id
                                                            ? { ...currentItem, price: event.target.value }
                                                            : currentItem,
                                                    ),
                                                );
                                                invalidatePreview();
                                            }}
                                            inputMode="decimal"
                                            placeholder="金额"
                                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSurcharges(current =>
                                                    current.filter(row => row.id !== item.id),
                                                );
                                                invalidatePreview();
                                            }}
                                            className="rounded-lg p-2 text-rose-600"
                                            aria-label="删除附加费用"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                                {surcharges.length === 0 && (
                                    <p className="text-xs text-slate-400">没有新增附加费用</p>
                                )}
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
                            <label className="text-sm font-semibold text-slate-900">
                                修改原因 *
                                <textarea
                                    value={note}
                                    onChange={event => {
                                        setNote(event.target.value);
                                        invalidatePreview();
                                    }}
                                    rows={3}
                                    maxLength={500}
                                    placeholder="说明客户诉求、客服工单或修改依据"
                                    className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-xs font-normal outline-none focus:border-blue-500"
                                />
                            </label>
                        </section>
                    </div>

                    <aside className="space-y-4 lg:sticky lg:top-0">
                        <section className="rounded-xl bg-slate-900 p-5 text-white shadow-sm">
                            <p className="text-xs text-slate-300">原订单金额</p>
                            <strong className="mt-2 block font-mono text-2xl">
                                {formatMoney(order.totalWithTax, order.currencyCode)}
                            </strong>
                            {preview?.__typename === 'Order' && typeof preview.totalWithTax === 'number' && (
                                <div className="mt-4 border-t border-white/10 pt-4">
                                    <p className="text-xs text-slate-300">修改后金额</p>
                                    <strong className="mt-1 block font-mono text-xl">
                                        {formatMoney(preview.totalWithTax, order.currencyCode)}
                                    </strong>
                                    <p
                                        className={`mt-2 text-xs font-semibold ${priceDifference && priceDifference < 0 ? 'text-amber-300' : priceDifference && priceDifference > 0 ? 'text-rose-300' : 'text-emerald-300'}`}
                                    >
                                        {priceDifference === 0
                                            ? '无需补款或退款'
                                            : priceDifference && priceDifference > 0
                                              ? `需补款 ${formatMoney(priceDifference, order.currencyCode)}`
                                              : `需退款 ${formatMoney(Math.abs(priceDifference ?? 0), order.currencyCode)}`}
                                    </p>
                                </div>
                            )}
                        </section>
                        <button
                            type="button"
                            disabled={!hasChanges || modifyState.loading}
                            onClick={() => void handlePreview()}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        >
                            {modifyState.loading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                            预览修改结果
                        </button>
                        <button
                            type="button"
                            disabled={preview?.__typename !== 'Order' || modifyState.loading}
                            onClick={() => void handleConfirm()}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <Check className="h-4 w-4" /> 确认写入订单
                        </button>
                        <p className="text-[10px] leading-5 text-slate-400">
                            减价会从已结算支付中分配退款；加价后需在订单支付流程中继续收取补款。
                        </p>
                    </aside>
                </div>
            </div>
        </main>
    );
}

function WorkflowHeader({
    actions,
    onBack,
    subtitle,
    title,
}: {
    actions?: React.ReactNode;
    onBack: () => void;
    subtitle: string;
    title: string;
}) {
    return (
        <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                        aria-label="返回订单"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="min-w-0">
                        <h1 className="truncate text-base font-semibold text-slate-950">{title}</h1>
                        <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>
                    </div>
                </div>
                {actions}
            </div>
        </header>
    );
}

function WorkflowMessages({
    error,
    notice,
    onClose,
}: {
    error?: string;
    notice?: string;
    onClose: () => void;
}) {
    return (
        <>
            {notice && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                    <Check className="h-4 w-4" /> {notice}
                </div>
            )}
            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                    <button type="button" onClick={onClose} className="ml-auto" aria-label="关闭错误提示">
                        ×
                    </button>
                </div>
            )}
        </>
    );
}

function WorkflowLoading({ label }: { label: string }) {
    return (
        <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> {label}
        </div>
    );
}

function WorkflowError({
    message,
    onBack,
    onRetry,
}: {
    message: string;
    onBack: () => void;
    onRetry?: () => void;
}) {
    return (
        <div className="flex h-full items-center justify-center bg-slate-50 p-6">
            <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
                <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
                <h1 className="mt-3 text-sm font-semibold text-slate-900">订单操作暂不可用</h1>
                <p className="mt-2 text-xs leading-5 text-slate-500">{message}</p>
                <div className="mt-4 flex justify-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
                    >
                        返回
                    </button>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
                        >
                            重试
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
}
