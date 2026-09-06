import { useMutation, useQuery } from '@apollo/client/react';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CREATE_COUPON_CAMPAIGN_MUTATION,
    CREATE_FLASH_SALE_MUTATION,
    GRANT_STORE_COUPON_MUTATION,
    MARKETING_CATALOG_LOOKUP_QUERY,
    MARKETING_CUSTOMER_LOOKUP_QUERY,
    PromotionProductRecord,
    StoreCouponKind,
    StoreCouponRecord,
} from '../../graphql/marketing.graphql';
import { dataTableSortPolicy } from '../../utils/data-table-sort-policy';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney, majorInputToMoney } from '../Sales/sales-utils';
import {
    CouponDraft,
    couponDraftError,
    couponKindLabels,
    dateInput,
    errorText,
    FlashDraft,
    flashDraftError,
    newCouponDraft,
    newFlashDraft,
} from './promotion-model';
import {
    DateInput,
    FormInput,
    FormSelect,
    LoadingState,
    Modal,
    ModalFooter,
    MultiSelector,
} from './promotion-ui';

export function CouponEditor({
    currencyCode,
    onClose,
    onSaved,
    onError,
}: {
    currencyCode: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState<CouponDraft>(newCouponDraft());
    const [selectorSearch, setSelectorSearch] = useState('');
    const deferredSearch = useDeferredValue(selectorSearch.trim());
    const hasScope = draft.kind === 'COLLECTION_PERCENTAGE' || draft.kind === 'PRODUCT_PERCENTAGE';
    const catalog = useQuery<{
        collections: { totalItems: number; items: Array<{ id: string; name: string }> };
        products: { totalItems: number; items: PromotionProductRecord[] };
    }>(MARKETING_CATALOG_LOOKUP_QUERY, {
        variables: {
            collectionOptions: {
                take: draft.kind === 'COLLECTION_PERCENTAGE' ? 30 : 1,
                sort: dataTableSortPolicy.alphabeticalName,
                filter:
                    draft.kind === 'COLLECTION_PERCENTAGE' && deferredSearch
                        ? { name: { contains: deferredSearch } }
                        : {},
            },
            productOptions: {
                take: draft.kind === 'PRODUCT_PERCENTAGE' ? 30 : 1,
                sort: dataTableSortPolicy.alphabeticalName,
                filter:
                    draft.kind === 'PRODUCT_PERCENTAGE' && deferredSearch
                        ? { name: { contains: deferredSearch } }
                        : {},
            },
        },
        skip: !hasScope,
        fetchPolicy: 'cache-and-network',
    });
    const [create, state] = useMutation(CREATE_COUPON_CAMPAIGN_MUTATION);
    const validation = couponDraftError(draft);
    const submit = async () => {
        if (validation) return onError(validation);
        try {
            const minimumSpend = majorInputToMoney(draft.minimumSpend || '0', currencyCode);
            const discountAmount =
                draft.kind === 'ORDER_FIXED' ? majorInputToMoney(draft.discountValue, currencyCode) : null;
            if (minimumSpend == null || (draft.kind === 'ORDER_FIXED' && discountAmount == null))
                throw new Error('金额格式不正确');
            const optionalInt = (value: string) => (value.trim() ? Number.parseInt(value, 10) : null);
            await create({
                variables: {
                    input: {
                        name: draft.name.trim(),
                        kind: draft.kind,
                        minimumSpend,
                        discountAmount,
                        discountRate: draft.kind === 'ORDER_FIXED' ? null : Number(draft.discountValue),
                        collectionIds: draft.kind === 'COLLECTION_PERCENTAGE' ? draft.collectionIds : [],
                        productIds: draft.kind === 'PRODUCT_PERCENTAGE' ? draft.productIds : [],
                        startsAt: dateInput(draft.startsAt),
                        endsAt: dateInput(draft.endsAt),
                        usageLimit: optionalInt(draft.issueLimit),
                        perCustomerUsageLimit: 1,
                        claimStartsAt: dateInput(draft.claimStartsAt),
                        claimEndsAt: dateInput(draft.claimEndsAt),
                        validityDays: optionalInt(draft.validityDays),
                        issueLimit: optionalInt(draft.issueLimit),
                        perCustomerClaimLimit: 1,
                        stackPolicy: draft.stackPolicy,
                        returnOnCancellation: draft.returnOnCancellation,
                        returnOnFullRefund: draft.returnOnFullRefund,
                    },
                },
            });
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    const scopedItems =
        draft.kind === 'COLLECTION_PERCENTAGE'
            ? (catalog.data?.collections.items ?? [])
            : (catalog.data?.products.items ?? []);
    const scopedTotal =
        draft.kind === 'COLLECTION_PERCENTAGE'
            ? (catalog.data?.collections.totalItems ?? 0)
            : (catalog.data?.products.totalItems ?? 0);
    const selectedIds = draft.kind === 'COLLECTION_PERCENTAGE' ? draft.collectionIds : draft.productIds;
    const updateSelected = (ids: string[]) =>
        setDraft(
            draft.kind === 'COLLECTION_PERCENTAGE'
                ? { ...draft, collectionIds: ids }
                : { ...draft, productIds: ids },
        );
    return (
        <Modal
            title="新建优惠券活动"
            description="先设置客户看得懂的规则，系统会自动生成内部兑换码并记录全生命周期流水。"
            onClose={onClose}
            width="max-w-3xl"
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <FormInput
                    label="活动名称 *"
                    value={draft.name}
                    onChange={value => setDraft({ ...draft, name: value })}
                    placeholder="例如：新客首单满100减20"
                />
                <FormSelect
                    label="优惠类型 *"
                    value={draft.kind}
                    onChange={value => {
                        setSelectorSearch('');
                        setDraft({
                            ...draft,
                            kind: value as StoreCouponKind,
                            collectionIds: [],
                            productIds: [],
                        });
                    }}
                    options={Object.entries(couponKindLabels)}
                />
                <FormInput
                    label={`最低消费金额 (${currencyCode})`}
                    type="number"
                    value={draft.minimumSpend}
                    onChange={value => setDraft({ ...draft, minimumSpend: value })}
                />
                <FormInput
                    label={
                        draft.kind === 'ORDER_FIXED'
                            ? `减免金额 (${currencyCode}) *`
                            : '折扣（例如 8.5 表示八五折）*'
                    }
                    type="number"
                    value={draft.discountValue}
                    onChange={value => setDraft({ ...draft, discountValue: value })}
                />
                <DateInput
                    label="领取开始"
                    type="datetime-local"
                    value={draft.claimStartsAt}
                    onChange={value => setDraft({ ...draft, claimStartsAt: value, startsAt: value })}
                />
                <DateInput
                    label="领取结束"
                    type="datetime-local"
                    value={draft.claimEndsAt}
                    onChange={value => setDraft({ ...draft, claimEndsAt: value, endsAt: value })}
                />
                <FormInput
                    label="发放总量 *"
                    type="number"
                    value={draft.issueLimit}
                    onChange={value => setDraft({ ...draft, issueLimit: value })}
                />
                <FormInput
                    label="领取后有效天数 *"
                    type="number"
                    value={draft.validityDays}
                    onChange={value => setDraft({ ...draft, validityDays: value })}
                />
                <FormSelect
                    label="叠加策略"
                    value={draft.stackPolicy}
                    onChange={value =>
                        setDraft({ ...draft, stackPolicy: value as CouponDraft['stackPolicy'] })
                    }
                    options={[
                        ['EXCLUSIVE', '不可与其他优惠券叠加'],
                        ['STACKABLE', '允许叠加'],
                    ]}
                />
            </div>
            {(draft.kind === 'COLLECTION_PERCENTAGE' || draft.kind === 'PRODUCT_PERCENTAGE') && (
                <MultiSelector
                    title={draft.kind === 'COLLECTION_PERCENTAGE' ? '适用分类 *' : '适用商品 *'}
                    items={scopedItems}
                    totalItems={scopedTotal}
                    loading={catalog.loading}
                    error={catalog.error?.message}
                    selectedIds={selectedIds}
                    search={selectorSearch}
                    setSearch={setSelectorSearch}
                    onChange={updateSelected}
                />
            )}
            <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
                <label className="flex items-center justify-between gap-3">
                    <span>
                        <strong className="text-slate-800">订单取消时自动返券</strong>
                        <small className="block text-[10px] text-slate-400">
                            避免客户因取消未履约订单损失优惠券
                        </small>
                    </span>
                    <input
                        type="checkbox"
                        checked={draft.returnOnCancellation}
                        onChange={event => setDraft({ ...draft, returnOnCancellation: event.target.checked })}
                        className="h-4 w-4"
                    />
                </label>
                <label className="flex items-center justify-between gap-3">
                    <span>
                        <strong className="text-slate-800">全额退款后自动返券</strong>
                        <small className="block text-[10px] text-slate-400">部分退款不会自动返券</small>
                    </span>
                    <input
                        type="checkbox"
                        checked={draft.returnOnFullRefund}
                        onChange={event => setDraft({ ...draft, returnOnFullRefund: event.target.checked })}
                        className="h-4 w-4"
                    />
                </label>
            </div>
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={state.loading}
                disabled={Boolean(validation)}
                confirmLabel="创建优惠券"
            />
        </Modal>
    );
}

export function FlashEditor({
    currencyCode,
    onClose,
    onSaved,
    onError,
}: {
    currencyCode: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState<FlashDraft>(newFlashDraft());
    const [search, setSearch] = useState('');
    const [knownProducts, setKnownProducts] = useState<Record<string, PromotionProductRecord>>({});
    const deferredSearch = useDeferredValue(search.trim());
    const catalog = useQuery<{
        collections: { totalItems: number; items: Array<{ id: string; name: string }> };
        products: { totalItems: number; items: PromotionProductRecord[] };
    }>(MARKETING_CATALOG_LOOKUP_QUERY, {
        variables: {
            collectionOptions: { take: 1 },
            productOptions: {
                take: 30,
                sort: dataTableSortPolicy.alphabeticalName,
                filter: deferredSearch ? { name: { contains: deferredSearch } } : {},
            },
        },
        fetchPolicy: 'cache-and-network',
    });
    const products = catalog.data?.products.items ?? [];
    const [create, state] = useMutation(CREATE_FLASH_SALE_MUTATION);
    const productMap = new Map(
        [...Object.values(knownProducts), ...products].map(product => [product.id, product]),
    );
    const selectedProducts = draft.productIds
        .map(id => productMap.get(id))
        .filter((product): product is PromotionProductRecord => Boolean(product));
    const validation = flashDraftError(draft, selectedProducts, currencyCode);
    const submit = async () => {
        if (validation) return onError(validation);
        try {
            const variantPrices = selectedProducts.flatMap(product =>
                product.variants.flatMap(variant => {
                    const value = draft.variantPrices[variant.id]?.trim();
                    if (!value) return [];
                    const amount = majorInputToMoney(value, variant.currencyCode);
                    return amount == null ? [] : [{ productVariantId: variant.id, salePrice: amount }];
                }),
            );
            await create({
                variables: {
                    input: {
                        name: draft.name.trim(),
                        productIds: draft.productIds,
                        percentageOff: Number(draft.percentageOff),
                        variantPrices,
                        startsAt: dateInput(draft.startsAt),
                        endsAt: dateInput(draft.endsAt),
                    },
                },
            });
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="新建限时秒杀"
            description="秒杀价由后端结算，活动重叠或价格不合法时会阻止创建。"
            onClose={onClose}
            width="max-w-4xl"
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <FormInput
                    label="活动名称 *"
                    value={draft.name}
                    onChange={value => setDraft({ ...draft, name: value })}
                    placeholder="例如：周末数码限时秒杀"
                />
                <FormInput
                    label="统一降价比例 (%) *"
                    type="number"
                    value={draft.percentageOff}
                    onChange={value => setDraft({ ...draft, percentageOff: value })}
                />
                <DateInput
                    label="开始时间 *"
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={value => setDraft({ ...draft, startsAt: value })}
                />
                <DateInput
                    label="结束时间 *"
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={value => setDraft({ ...draft, endsAt: value })}
                />
            </div>
            <MultiSelector
                title={`秒杀商品 *（已选 ${draft.productIds.length}/50）`}
                items={products}
                totalItems={catalog.data?.products.totalItems ?? 0}
                loading={catalog.loading}
                error={catalog.error?.message}
                selectedIds={draft.productIds}
                search={search}
                setSearch={setSearch}
                onChange={ids => {
                    setKnownProducts(current => ({
                        ...current,
                        ...Object.fromEntries(products.map(product => [product.id, product])),
                    }));
                    setDraft({ ...draft, productIds: ids.slice(0, 50) });
                }}
            />
            {selectedProducts.length > 0 && (
                <div className="mt-4">
                    <h3 className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        可选：单独设置 SKU 秒杀价
                        <FeatureHelpButton topic="marketing.sku-sale-prices" title="单独设置 SKU 秒杀价" />
                    </h3>
                    <p className="mt-1 text-[10px] text-slate-400">
                        留空则按统一降价比例计算；填写价格必须低于原价。
                    </p>
                    <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                        {selectedProducts.flatMap(product =>
                            product.variants.map(variant => (
                                <div
                                    key={variant.id}
                                    className="grid grid-cols-[1fr_110px_120px] items-center gap-2 rounded-lg bg-slate-50 p-2 text-[11px]"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate font-bold text-slate-800">
                                            {product.name}
                                        </div>
                                        <div className="truncate text-slate-400">{variant.name}</div>
                                    </div>
                                    <span className="font-mono text-slate-500">
                                        原价 {formatMoney(variant.priceWithTax, variant.currencyCode)}
                                    </span>
                                    <input
                                        type="number"
                                        value={draft.variantPrices[variant.id] ?? ''}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                variantPrices: {
                                                    ...draft.variantPrices,
                                                    [variant.id]: event.target.value,
                                                },
                                            })
                                        }
                                        placeholder={currencyCode}
                                        className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                                    />
                                </div>
                            )),
                        )}
                    </div>
                </div>
            )}
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void submit()}
                pending={state.loading}
                disabled={Boolean(validation)}
                confirmLabel="创建秒杀"
            />
        </Modal>
    );
}

export function GrantCouponDialog({
    coupon,
    onClose,
    onSaved,
    onError,
}: {
    coupon: StoreCouponRecord;
    pending: boolean;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onError: (message: string) => void;
}) {
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search.trim());
    const filter = deferredSearch
        ? {
              _or: [
                  { firstName: { contains: deferredSearch } },
                  { lastName: { contains: deferredSearch } },
                  { emailAddress: { contains: deferredSearch } },
                  { phoneNumber: { contains: deferredSearch } },
              ],
          }
        : undefined;
    const lookup = useQuery<{
        customers: {
            totalItems: number;
            items: Array<{
                id: string;
                firstName: string;
                lastName: string;
                emailAddress: string;
                phoneNumber: string | null;
            }>;
        };
    }>(MARKETING_CUSTOMER_LOOKUP_QUERY, {
        variables: { options: { take: 20, sort: dataTableSortPolicy.newestCreated, filter } },
        fetchPolicy: 'cache-and-network',
    });
    const [grant, state] = useMutation(GRANT_STORE_COUPON_MUTATION);
    const submit = async (customerId: string) => {
        try {
            await grant({ variables: { campaignId: coupon.id, customerId } });
            await onSaved();
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={`指定发券：${coupon.name}`}
            description="选择客户后立即发放到其账户；同一客户的领取上限仍由后端校验。"
            onClose={onClose}
            width="max-w-lg"
        >
            <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    aria-label="搜索客户"
                    placeholder="搜索客户姓名、手机号或邮箱"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs"
                />
            </div>
            <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                {lookup.loading && !lookup.data ? (
                    <LoadingState label="正在查找客户…" />
                ) : lookup.error ? (
                    <p className="p-4 text-xs text-rose-600">
                        {toUserFacingError(lookup.error, '客户查找失败，请稍后重试')}
                    </p>
                ) : (
                    lookup.data?.customers.items.map(customer => (
                        <div
                            key={customer.id}
                            className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                        >
                            <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-slate-900">
                                    {`${customer.lastName}${customer.firstName}` || customer.emailAddress}
                                </div>
                                <div className="truncate text-[10px] text-slate-400">
                                    {customer.phoneNumber || customer.emailAddress}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => void submit(customer.id)}
                                disabled={state.loading}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                            >
                                发放
                            </button>
                        </div>
                    ))
                )}
                {lookup.data && !lookup.data.customers.items.length && (
                    <p className="p-8 text-center text-xs text-slate-400">没有匹配客户</p>
                )}
            </div>
            {lookup.data && (
                <p className="mt-2 text-[10px] text-slate-400">
                    匹配 {lookup.data.customers.totalItems} 位客户，当前显示前 20 位；继续输入可缩小范围
                </p>
            )}
        </Modal>
    );
}
