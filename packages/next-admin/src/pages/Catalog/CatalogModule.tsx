import { gql } from '@apollo/client';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import {
    AdminMobileField,
    AdminMobileList,
    AdminMobileRecord,
    AdminMobileSort,
} from '../../components/AdminMobileList';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { useAdminPageRefresh, useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { StoreOfferDialog } from './StoreOfferDialog';
/* eslint-disable max-len -- Tailwind utility lists are intentionally kept as single JSX attributes. */
import { useMutation } from '@apollo/client/react';
import {
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Edit3,
    Image as ImageIcon,
    Package,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVirtualRows } from '../../hooks/use-virtual-rows';

import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { SearchInput } from '../../components/SearchInput';
import { SortableTableHeader } from '../../components/SortableTableHeader';
import { NextAdminActions } from '../../extensions/extension-hosts';
import {
    GET_CATALOG_CHANNEL_ASSIGNMENTS,
    type AssignmentChannel,
    type CatalogChannelAssignmentsData,
} from '../../graphql/catalog-channel-assignments.graphql';
import {
    CATALOG_PRODUCT_OPERATIONS_QUERY,
    type CatalogProductOperationsResult,
} from '../../graphql/catalog-operations.graphql';
import {
    DELETE_PRODUCT,
    GET_CATALOG_CHANNELS,
    GET_COLLECTIONS,
    GET_PRODUCTS,
} from '../../graphql/catalog.graphql';
import {
    STORE_COMMERCE_MODE_QUERY,
    type DigitalDeliveryMode,
    type DigitalStockPolicy,
    type FulfillmentType,
    type StoreCommerceModeData,
} from '../../graphql/commerce.graphql';
import {
    catalogDigitalStockQuery,
    type CatalogDigitalStockResult,
} from '../../graphql/product-domains.graphql';
import { useUrlListState } from '../../hooks/use-url-list-state';
import { useUrlSortState } from '../../hooks/use-url-sort-state';
import { AdminImage } from '../../utils/admin-image';
import {
    getCatalogEmptyStateDescription,
    getChannelDisplayLabel,
    getChannelDisplayName,
} from '../../utils/channel-display';
import { collectionHierarchySummary } from '../../utils/commerce-mode';

interface ProductVariantItem {
    id: string;
    name: string;
    sku: string;
    price: number;
    currencyCode: string;
    stockLevel?: string;
    stockOnHand?: number;
    stockAllocated?: number;
    enabled: boolean;
    autoCardAvailableStock?: number | null;
    customFields?: {
        fulfillmentType?: FulfillmentType | null;
        digitalDeliveryMode?: DigitalDeliveryMode | null;
        digitalStockPolicy?: DigitalStockPolicy | null;
    } | null;
}

interface ProductItem {
    id: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
    name: string;
    slug: string;
    description?: string;
    customFields?: {
        fulfillmentType?: FulfillmentType | null;
        pricingMode?: 'FIXED' | 'QUOTE_ONLY' | null;
        refundPolicy?: string | null;
        manualDeliverySlaMinutes?: number | null;
    } | null;
    featuredAsset?: {
        id: string;
        preview: string;
        name?: string;
    } | null;
    variants: ProductVariantItem[];
    facetValues?: Array<{
        id: string;
        code: string;
        name: string;
    }>;
    collections?: Array<{
        id: string;
        name: string;
        slug: string;
        parent?: {
            id: string;
            name: string;
            slug: string;
        } | null;
    }>;
}

interface GetProductsData {
    products: {
        items: ProductItem[];
        totalItems: number;
    };
}

interface GetCatalogChannelsData {
    activeChannel: {
        id: string;
        code: string;
        token: string;
        defaultCurrencyCode: string;
        customFields?: { storefrontNameZh?: string | null; storefrontNameEn?: string | null } | null;
    };
}

interface CollectionFilterItem {
    id: string;
    name: string;
}

const PRODUCT_SORT_FIELDS = ['updatedAt', 'name', 'slug'] as const;

const formatMoney = (amount: number, currencyCode: string) => {
    try {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
        }).format(amount / 100);
    } catch {
        return `${currencyCode} ${(amount / 100).toFixed(2)}`;
    }
};

const formatMicrounits = (amount: number, currencyCode: string) => {
    try {
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
            maximumFractionDigits: 3,
        }).format(amount / 1_000);
    } catch {
        return `${currencyCode} ${(amount / 1_000).toFixed(3)}`;
    }
};

const formatRange = (
    minimum: number | null | undefined,
    maximum: number | null | undefined,
    format: (value: number) => string,
) => {
    if (minimum == null) return '—';
    if (maximum == null || maximum === minimum) return format(minimum);
    return `${format(minimum)} – ${format(maximum)}`;
};

export function CatalogModule() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(false);
    const [mobileStatsExpanded, setMobileStatsExpanded] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const {
        isFiltered,
        page,
        pageSize,
        resetFilters,
        searchParams,
        searchTerm,
        setFilter,
        setPage,
        setPageSize,
        setSearchTerm,
    } = useUrlListState();
    const { sortDirection, sortField, toggleSort } = useUrlSortState({
        fields: PRODUCT_SORT_FIELDS,
        defaultField: 'updatedAt',
        defaultDirection: 'DESC',
    });
    const statusParameter = searchParams.get('status');
    const channelParameter = searchParams.get('channel') ?? 'ALL';
    const categoryId = searchParams.get('category') ?? '';
    const statusFilter: 'ALL' | 'ENABLED' | 'DISABLED' =
        statusParameter === 'enabled' ? 'ENABLED' : statusParameter === 'disabled' ? 'DISABLED' : 'ALL';
    const statusQuery = useQuery<{
        myStoreCatalogStatus: {
            authorized: number;
            listed: number;
            paused: number;
            pending: number;
            outOfStock: number;
            items: Array<{
                productId: string;
                listed: boolean;
                pending: boolean;
                paused: boolean;
                outOfStock: boolean;
            }>;
        };
    }>(
        gql`
            query StoreCatalogStatus {
                myStoreCatalogStatus
            }
        `,
        {},
    );
    const storeStatus = statusQuery.data?.myStoreCatalogStatus;
    const setStatusFilter = (status: 'ALL' | 'ENABLED' | 'DISABLED') => {
        setFilter('status', status.toLowerCase(), 'all');
    };

    const [offerProductId, setOfferProductId] = useState<string | null>(null);
    const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(
        null,
    );
    const [productToDelete, setProductToDelete] = useState<{ id: string; name: string } | null>(null);
    const [deletePassword, setDeletePassword] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const commerceModeQuery = useQuery<StoreCommerceModeData>(STORE_COMMERCE_MODE_QUERY, {});
    const commerceMode = commerceModeQuery.data?.myStoreCommerceMode.mode ?? 'HYBRID';
    const collectionsQuery = useQuery<{
        collections: { items: CollectionFilterItem[]; totalItems: number };
    }>(GET_COLLECTIONS, {
        variables: {
            options: { topLevelOnly: false, take: 250, sort: { name: 'ASC', id: 'ASC' } },
        },
    });

    useEffect(() => {
        const collections = collectionsQuery.data?.collections;
        if (
            categoryId &&
            collections &&
            collections.items.length === collections.totalItems &&
            !collections.items.some(collection => collection.id === categoryId)
        ) {
            setFilter('category', '');
        }
    }, [categoryId, collectionsQuery.data, setFilter]);

    useEffect(() => {
        if (!notification) return;
        const timeout = window.setTimeout(() => setNotification(null), 3500);
        return () => window.clearTimeout(timeout);
    }, [notification]);

    // 商品归属异常必须先在服务端筛选，再分页；当前页内过滤会漏掉后续页的异常商品。
    const assignmentMode = channelParameter === 'UNASSIGNED' ? 'UNASSIGNED' : 'MULTI';
    const isAssignmentFilter = channelParameter !== 'ALL';
    const baseFilter = useMemo(() => {
        const filter: Record<string, unknown> = {};
        if (deferredSearchTerm.trim()) {
            filter.name = { contains: deferredSearchTerm.trim() };
        }
        if (statusFilter === 'ENABLED') {
            filter.id = {
                in: storeStatus?.items.filter(item => item.listed).map(item => item.productId) ?? [],
            };
        } else if (statusFilter === 'DISABLED') {
            filter.id = {
                in: storeStatus?.items.filter(item => !item.listed).map(item => item.productId) ?? [],
            };
        }
        if (categoryId) {
            filter.collectionId = { eq: categoryId };
        }

        return Object.keys(filter).length > 0 ? filter : undefined;
    }, [categoryId, deferredSearchTerm, statusFilter, storeStatus]);
    const assignmentQuery = useQuery<CatalogChannelAssignmentsData>(GET_CATALOG_CHANNEL_ASSIGNMENTS, {
        variables: {
            options: {
                skip: page * pageSize,
                take: pageSize,
                filter: baseFilter,
                sort: { [sortField]: sortDirection },
            },
            assignmentFilter: { mode: assignmentMode },
        },
        skip: !isAssignmentFilter,

        notifyOnNetworkStatusChange: true,
    });
    const assignmentIds = useMemo(
        () => assignmentQuery.data?.catalogProductChannelAssignments.items.map(item => item.id) ?? [],
        [assignmentQuery.data],
    );
    const queryVariables = useMemo(() => {
        const filter = isAssignmentFilter ? { id: { in: assignmentIds } } : baseFilter;
        return {
            options: {
                skip: isAssignmentFilter ? 0 : page * pageSize,
                take: pageSize,
                filter,
                sort: { [sortField]: sortDirection },
            },
        };
    }, [assignmentIds, baseFilter, isAssignmentFilter, page, pageSize, sortDirection, sortField]);

    const productQuery = useQuery<GetProductsData>(GET_PRODUCTS, {
        variables: queryVariables,
        skip:
            (statusFilter !== 'ALL' && !storeStatus) ||
            (isAssignmentFilter && (assignmentQuery.loading || assignmentIds.length === 0)),

        notifyOnNetworkStatusChange: true,
    });
    const { data } = productQuery;
    const loading =
        assignmentQuery.loading || productQuery.loading || (statusFilter !== 'ALL' && statusQuery.loading);
    const error =
        (statusFilter !== 'ALL' ? statusQuery.error : undefined) ??
        (isAssignmentFilter ? assignmentQuery.error : undefined) ??
        productQuery.error;
    const refetch = useAdminPageRefresh();
    const activeChannelQuery = useQuery<GetCatalogChannelsData>(GET_CATALOG_CHANNELS, {});
    const productIds = useMemo(() => data?.products.items.map(product => product.id) ?? [], [data]);
    const operationsQuery = useQuery<CatalogProductOperationsResult>(CATALOG_PRODUCT_OPERATIONS_QUERY, {
        variables: { productIds },
        skip: productIds.length === 0,
    });
    const digitalProductIds = useMemo(
        () =>
            data?.products.items
                .filter(product => product.customFields?.fulfillmentType !== 'physical')
                .map(product => product.id) ?? [],
        [data],
    );
    const digitalStockDocument = useMemo(
        () => catalogDigitalStockQuery(digitalProductIds.length),
        [digitalProductIds.length],
    );
    const digitalStockVariables = useMemo(
        () => Object.fromEntries(digitalProductIds.map((id, index) => [`product${index}`, id])),
        [digitalProductIds],
    );
    const digitalStockQuery = useQuery<CatalogDigitalStockResult>(digitalStockDocument, {
        variables: digitalStockVariables,
        skip: digitalProductIds.length === 0,
    });
    const digitalStockByProduct = useMemo(() => {
        const workspaces = new Map<string, CatalogDigitalStockResult[string]>();
        digitalProductIds.forEach((id, index) => {
            const workspace = digitalStockQuery.data?.[`product${index}`];
            if (workspace?.productId === id) workspaces.set(id, workspace);
        });
        return workspaces;
    }, [digitalProductIds, digitalStockQuery.data]);

    const channelAssignmentsQuery = useQuery<CatalogChannelAssignmentsData>(GET_CATALOG_CHANNEL_ASSIGNMENTS, {
        variables: {
            options: {
                take: 100,
                filter: productIds.length > 0 ? { id: { in: productIds } } : undefined,
            },
        },
        skip: productIds.length === 0,
    });

    const channelAssignmentsByProduct = useMemo(() => {
        const map = new Map<string, AssignmentChannel[]>();
        for (const item of channelAssignmentsQuery.data?.catalogProductChannelAssignments.items ?? []) {
            map.set(
                item.id,
                item.channels.filter(channel => !channel.isDefault),
            );
        }
        return map;
    }, [channelAssignmentsQuery.data]);

    const [prevFilterKey, setPrevFilterKey] = useState(
        `${page}-${pageSize}-${statusFilter}-${categoryId}-${searchTerm}-${channelParameter}`,
    );
    const currentFilterKey = `${page}-${pageSize}-${statusFilter}-${categoryId}-${searchTerm}-${channelParameter}`;
    if (prevFilterKey !== currentFilterKey) {
        setPrevFilterKey(currentFilterKey);
        setSelectedProductIds([]);
    }

    const [deleteProductMutation, { loading: deleting }] = useMutation<{
        deleteProduct: { result: string; message?: string };
    }>(DELETE_PRODUCT, {
        onCompleted: res => {
            if (res?.deleteProduct?.result === 'DELETED') {
                showNotice(`商品《${productToDelete?.name || ''}》已删除`);
                setProductToDelete(null);
                setDeletePassword('');
                void refetch();
            }
        },
    });

    const showNotice = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ type, message });
    };

    const totalItems = isAssignmentFilter
        ? (assignmentQuery.data?.catalogProductChannelAssignments.totalItems ?? 0)
        : (data?.products?.totalItems ?? 0);
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const productList = useMemo(
        () => (isAssignmentFilter && (loading || !assignmentIds.length) ? [] : (data?.products?.items ?? [])),
        [assignmentIds, data?.products?.items, isAssignmentFilter, loading],
    );
    const displayProducts = useMemo(() => {
        if (!isAssignmentFilter) return productList;
        const ids = new Set(assignmentIds);
        return productList.filter(product => ids.has(product.id));
    }, [assignmentIds, isAssignmentFilter, productList]);

    const operationsByProduct = useMemo(
        () =>
            new Map(
                (operationsQuery.data?.catalogProductOperations ?? []).map(summary => [
                    summary.productId,
                    summary,
                ]),
            ),
        [operationsQuery.data],
    );
    const assignmentsByProduct = useMemo(
        () => new Map(storeStatus?.items.map(item => [item.productId, item]) ?? []),
        [storeStatus],
    );
    const activeChannel = activeChannelQuery.data?.activeChannel;
    const activeChannelLabel = activeChannel ? getChannelDisplayLabel(activeChannel) : '当前店铺';

    const handleDeleteConfirm = () => {
        if (!productToDelete) return;
        if (!deletePassword) {
            showNotice('请输入当前管理员密码后再删除商品', 'error');
            return;
        }
        void deleteProductMutation({
            variables: { id: productToDelete.id },
            context: {
                ...sensitiveActionContext(deletePassword),
                adminFeedback: {
                    target: `商品“${productToDelete.name}”`,
                    resolution: [
                        '检查商品是否仍有在售 SKU、订单或其他业务记录引用',
                        '先停用或解除关联，再重新删除商品',
                    ],
                    skipSuccess: true,
                },
            },
        });
    };

    const productRows = useMemo(
        () =>
            displayProducts.map(product => {
                const operations = operationsByProduct.get(product.id);
                const variants = product.variants || [];
                const pricedVariants = variants.filter(v => typeof v.price === 'number' && !isNaN(v.price));
                const minPriceVariant = pricedVariants.reduce<ProductVariantItem | null>(
                    (lowest, current) => (!lowest || current.price < lowest.price ? current : lowest),
                    null,
                );
                const totalStock = variants.reduce((acc, v) => acc + (v.stockOnHand || 0), 0);
                const fulfillmentType: FulfillmentType =
                    product.customFields?.fulfillmentType === 'physical' ? 'physical' : 'digital';
                const quoteOnly = product.customFields?.pricingMode === 'QUOTE_ONLY';
                const categories = collectionHierarchySummary(product.collections);
                const workspaceVariants = new Map(
                    digitalStockByProduct.get(product.id)?.variants.map(variant => [variant.id, variant]) ??
                        [],
                );
                const digitalVariants = variants.map(variant => {
                    const workspace = workspaceVariants.get(variant.id);
                    const deliveryMode = workspace?.deliveryMode ?? variant.customFields?.digitalDeliveryMode;
                    const stockPolicy = workspace?.stockPolicy ?? variant.customFields?.digitalStockPolicy;
                    if (deliveryMode === 'auto_card') {
                        return {
                            stockPolicy: 'pool_derived',
                            available: variant.autoCardAvailableStock ?? undefined,
                        };
                    }
                    if (!workspace) return { stockPolicy, available: undefined };
                    if (stockPolicy === 'unlimited') return { stockPolicy, available: null };
                    // Active digital quotas already exclude held reservations. Never subtract legacy allocation again.
                    const available = workspace.migrationRequired
                        ? typeof variant.stockOnHand === 'number' &&
                          typeof variant.stockAllocated === 'number'
                            ? Math.max(0, variant.stockOnHand - variant.stockAllocated)
                            : undefined
                        : (workspace.availableQuantity ?? undefined);
                    return { stockPolicy, available };
                });
                const unlimitedDigitalStock =
                    fulfillmentType === 'digital' &&
                    digitalVariants.length > 0 &&
                    digitalVariants.every(variant => variant.stockPolicy === 'unlimited');
                const hasUnlimitedDigitalStock =
                    fulfillmentType === 'digital' &&
                    digitalVariants.some(variant => variant.stockPolicy === 'unlimited');
                const digitalStock = digitalVariants.reduce(
                    (total, variant) => total + (variant.available ?? 0),
                    0,
                );

                const stockUnavailable = variants.some((variant, index) => {
                    if (fulfillmentType === 'physical') return typeof variant.stockOnHand !== 'number';
                    return digitalVariants[index].available === undefined;
                });
                const stockSummary = stockUnavailable
                    ? '未获取'
                    : fulfillmentType === 'physical'
                      ? totalStock
                      : unlimitedDigitalStock
                        ? '无限'
                        : hasUnlimitedDigitalStock
                          ? '部分无限'
                          : digitalStock;
                const localAssignment = assignmentsByProduct.get(product.id);
                return {
                    product,
                    operations,
                    variants,
                    minPriceVariant,
                    totalStock,
                    fulfillmentType,
                    quoteOnly,
                    categories,
                    stockSummary,
                    localAssignment,
                };
            }),
        [displayProducts, operationsByProduct, assignmentsByProduct, digitalStockByProduct],
    );
    const rowKeys = useMemo(() => productRows.map(row => row.product.id), [productRows]);
    const tableBodyRef = useRef<HTMLTableSectionElement>(null);
    const virtualRows = useVirtualRows({
        contentRef: tableBodyRef,
        keys: rowKeys,
        scrollRef,
        estimateSize: 52,
        enabled: productRows.length > 50,
    });
    const toggleProductSelection = (productId: string) =>
        setSelectedProductIds(previous =>
            previous.includes(productId) ? previous.filter(id => id !== productId) : [...previous, productId],
        );
    const togglePageSelection = () =>
        setSelectedProductIds(previous => {
            const allSelected =
                displayProducts.length > 0 && displayProducts.every(product => previous.includes(product.id));
            return allSelected
                ? previous.filter(id => !displayProducts.some(product => product.id === id))
                : Array.from(new Set([...previous, ...displayProducts.map(product => product.id)]));
        });
    const editProduct = (productId: string) =>
        navigate(`/catalog/products/${productId}`, {
            state: { returnTo: `${location.pathname}${location.search}` },
        });
    const requestDeleteProduct = (product: ProductItem) => {
        setDeletePassword('');
        setProductToDelete({ id: product.id, name: product.name });
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header */}
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        商品管理
                        <FeatureHelpButton
                            topic="catalog.products"
                            title="商品管理"
                            description={'管理商品状态、规格、库存量和销售价'}
                        />
                    </h1>
                </div>

                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3 [&>button]:shrink-0">
                    <NextAdminActions pageId="product-list" collapseOnMobile />
                    <AdminButton
                        refreshPage
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
                        <span>刷新</span>
                    </AdminButton>

                    <AdminButton
                        type="button"
                        capabilityId="/catalog/products/new"
                        onClick={() =>
                            navigate('/catalog/products/new', {
                                state: { returnTo: `${location.pathname}${location.search}` },
                            })
                        }
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shadow-sm cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        发布新商品
                    </AdminButton>
                </div>
            </div>

            {/* Main Content */}
            <div ref={scrollRef} className="w-full max-w-none min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="flex flex-col gap-1 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                        当前数据范围：<strong>{activeChannelLabel}</strong>
                    </span>
                    <span className="text-[11px] text-blue-700">仅显示分配到当前店铺的商品、库存和价格</span>
                </div>
                {notification && (
                    <div
                        role="status"
                        className={`flex items-center gap-2 rounded-xl border p-3.5 text-xs font-medium animate-fadeIn ${notification.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
                    >
                        {notification.type === 'success' ? (
                            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                        )}
                        {notification.message}
                    </div>
                )}

                <AdminButton
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg bg-white px-4 py-2 text-sm md:hidden"
                    aria-expanded={mobileStatsExpanded}
                    onClick={() => setMobileStatsExpanded(value => !value)}
                >
                    <span>本店经营统计</span>
                    <span>{mobileStatsExpanded ? '收起' : '展开'}</span>
                </AdminButton>
                <section
                    className={`${mobileStatsExpanded ? 'flex' : 'hidden md:flex'} flex-wrap gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs`}
                    aria-label="本店经营统计"
                >
                    <span>本店已授权：{storeStatus?.authorized ?? '未获取'}</span>
                    <span>上架：{storeStatus?.listed ?? '未获取'}</span>
                    <span>暂停：{storeStatus?.paused ?? '未获取'}</span>
                    <span>待配置：{storeStatus?.pending ?? '未获取'}</span>
                    <span>缺货：{storeStatus?.outOfStock ?? '未获取'}</span>
                    <span>
                        本店上架率：
                        {storeStatus
                            ? storeStatus.authorized
                                ? `${Math.round((storeStatus.listed / storeStatus.authorized) * 100)}%`
                                : '无授权商品'
                            : '未获取'}
                    </span>
                    <p className="w-full text-xs text-slate-500">
                        范围为本店已授权商品；上架要求本店售价与交付配置完整，缺货单列。其他店铺统计请在平台管理中心查看。
                    </p>
                    {statusQuery.error && !storeStatus && (
                        <p className="w-full text-xs text-rose-600">本店统计未获取，请刷新重试。</p>
                    )}
                </section>
                {/* 错误态：真实 API 错误提示 (杜绝假数据回退) */}
                {error && !data && (
                    <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-800 text-xs animate-fadeIn">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>商品数据加载失败，请稍后重试或联系系统管理员。</span>
                        </div>
                        <AdminButton
                            refreshPage
                            type="button"
                            onClick={() => refetch()}
                            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer transition-colors"
                        >
                            重试本页
                        </AdminButton>
                    </div>
                )}

                {/* Table Container */}
                <div className="bg-white rounded-xl shadow-2xs border border-slate-200 flex flex-col">
                    {/* Toolbar */}
                    <div
                        data-testid="catalog-filter-toolbar"
                        className="relative md:sticky z-30 flex flex-wrap items-center gap-3 rounded-t-xl border-b border-slate-200 bg-slate-50 p-4 md:-top-8"
                    >
                        <div className="flex flex-wrap gap-1.5">
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setStatusFilter('ALL');
                                }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${statusFilter === 'ALL' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                            >
                                全部商品
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setStatusFilter('ENABLED');
                                }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${statusFilter === 'ENABLED' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                            >
                                已上架
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={() => {
                                    setStatusFilter('DISABLED');
                                }}
                                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${statusFilter === 'DISABLED' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                            >
                                未上架
                            </AdminButton>
                        </div>

                        <div className="flex w-full flex-wrap items-center gap-2 md:order-last md:ml-auto md:w-auto">
                            <div className="relative w-full md:w-auto">
                                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                                <SearchInput
                                    type="search"
                                    autoComplete="off"
                                    disabled={Boolean(productToDelete)}
                                    value={searchTerm}
                                    onValueChange={setSearchTerm}
                                    aria-label="搜索商品"
                                    placeholder="搜索名称"
                                    className="pl-9 pr-12 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 w-full md:w-64 bg-white"
                                />
                                {searchTerm && (
                                    <AdminButton
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                        }}
                                        className="absolute right-0 top-0 flex h-full w-11 items-center justify-center text-slate-400 hover:text-slate-600"
                                        aria-label="清空商品搜索"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </AdminButton>
                                )}
                            </div>

                            <AdminButton
                                type="button"
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 md:hidden"
                                aria-expanded={mobileFiltersExpanded}
                                onClick={() => setMobileFiltersExpanded(value => !value)}
                            >
                                {mobileFiltersExpanded
                                    ? '收起筛选与排序'
                                    : `筛选与排序${categoryId ? ' · 已选分类' : ''}`}
                            </AdminButton>
                        </div>
                        <div
                            className={`${mobileFiltersExpanded ? 'flex' : 'hidden md:flex'} w-full flex-wrap items-center gap-3 md:w-auto`}
                        >
                            <AdminSelect
                                value={categoryId}
                                onChange={event => setFilter('category', event.target.value)}
                                aria-label="按商品分类筛选"
                                className="max-w-48 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">全部分类</option>
                                {(collectionsQuery.data?.collections.items ?? []).map(collection => (
                                    <option key={collection.id} value={collection.id}>
                                        {collection.name}
                                    </option>
                                ))}
                            </AdminSelect>
                            {isFiltered && (
                                <AdminButton
                                    type="button"
                                    onClick={resetFilters}
                                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                                    title="清空所有筛选条件并重置列表"
                                >
                                    <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                                    <span>重置筛选</span>
                                </AdminButton>
                            )}
                            <div className="w-full md:hidden">
                                <AdminMobileSort
                                    fields={[
                                        { value: 'updatedAt', label: '更新时间' },
                                        { value: 'name', label: '商品名称' },
                                        { value: 'slug', label: '商品访问标识' },
                                    ]}
                                    sortField={sortField}
                                    sortDirection={sortDirection}
                                    onSort={(field, direction) =>
                                        toggleSort(field as typeof sortField, direction)
                                    }
                                    label="商品排序"
                                />
                            </div>
                        </div>
                    </div>

                    {selectedProductIds.length > 0 && (
                        <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50/50 p-3 text-xs text-blue-800">
                            <span>
                                已选 {selectedProductIds.length} 个商品。跨店销售授权由平台管理中心分配。
                            </span>
                            <AdminButton
                                type="button"
                                onClick={() => setSelectedProductIds([])}
                                className="rounded border border-blue-200 bg-white px-2 py-1 font-bold text-blue-700"
                            >
                                取消选择
                            </AdminButton>
                        </div>
                    )}

                    {/* Table Data / Loading / Empty State */}
                    <div className="overflow-x-auto flex-1 relative">
                        {/* 加载态：骨架屏 */}
                        {loading && (isAssignmentFilter || !data) && (
                            <div className="p-8 space-y-4">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div
                                        key={i}
                                        className="h-12 bg-slate-100 animate-pulse rounded-lg flex items-center px-4 gap-4"
                                    >
                                        <div className="w-10 h-10 bg-slate-200 rounded shrink-0"></div>
                                        <div className="w-48 h-4 bg-slate-200 rounded"></div>
                                        <div className="w-20 h-4 bg-slate-200 rounded"></div>
                                        <div className="w-24 h-4 bg-slate-200 rounded ml-auto"></div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 空状态：真实无数据 */}
                        {!loading && !error && displayProducts.length === 0 && (
                            <div className="flex flex-col items-center justify-center px-6 py-8 text-center space-y-3">
                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                                    <Package className="w-6 h-6" />
                                </div>
                                <div className="text-sm font-bold text-slate-700">暂无匹配的商品</div>
                                <p className="text-xs text-slate-400 max-w-xs">
                                    {getCatalogEmptyStateDescription({
                                        channel: activeChannel,
                                        searchTerm,
                                        hasFilters:
                                            statusFilter !== 'ALL' ||
                                            Boolean(categoryId) ||
                                            channelParameter !== 'ALL',
                                    })}
                                </p>
                                <div className="mt-2 flex flex-wrap justify-center gap-2">
                                    <AdminButton
                                        type="button"
                                        capabilityId="/catalog/products/new"
                                        onClick={() =>
                                            navigate('/catalog/products/new', {
                                                state: { returnTo: `${location.pathname}${location.search}` },
                                            })
                                        }
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                                    >
                                        发布新商品
                                    </AdminButton>
                                </div>
                            </div>
                        )}

                        {productRows.length > 0 && (
                            <AdminMobileList ariaLabel="商品摘要列表">
                                <div className="flex flex-wrap items-end gap-3">
                                    <label className="flex min-h-11 items-center gap-2 text-sm">
                                        <AdminInput
                                            type="checkbox"
                                            aria-label="选择本页全部商品"
                                            checked={displayProducts.every(product =>
                                                selectedProductIds.includes(product.id),
                                            )}
                                            onChange={togglePageSelection}
                                        />
                                        全选本页
                                    </label>
                                </div>
                                {productRows.map(
                                    ({
                                        product,
                                        variants,
                                        minPriceVariant,
                                        fulfillmentType,
                                        quoteOnly,
                                        categories,
                                        stockSummary,
                                        localAssignment,
                                    }) => (
                                        <AdminMobileRecord
                                            key={product.id}
                                            title={
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <AdminImage
                                                        src={product.featuredAsset?.preview}
                                                        alt=""
                                                        className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-contain"
                                                        sizes="40px"
                                                        fallbackIcon={<ImageIcon className="h-5 w-5" />}
                                                    />
                                                    <span className="break-words">{product.name}</span>
                                                </div>
                                            }
                                            status={
                                                !localAssignment
                                                    ? '未获取'
                                                    : localAssignment.listed
                                                      ? '已上架'
                                                      : '仓库中'
                                            }
                                            selection={
                                                <AdminInput
                                                    type="checkbox"
                                                    aria-label={`移动端选择商品 ${product.name}`}
                                                    checked={selectedProductIds.includes(product.id)}
                                                    onChange={() => toggleProductSelection(product.id)}
                                                />
                                            }
                                            actions={
                                                <>
                                                    <AdminButton
                                                        className="rounded-lg bg-blue-600 px-4 py-2 text-white"
                                                        onClick={() => editProduct(product.id)}
                                                    >
                                                        编辑商品
                                                    </AdminButton>
                                                    <AdminButton
                                                        onClick={() => setOfferProductId(product.id)}
                                                    >
                                                        本店经营设置
                                                    </AdminButton>
                                                    <AdminButton
                                                        onClick={() => requestDeleteProduct(product)}
                                                        aria-label={`删除商品 ${product.name}`}
                                                        className="text-rose-600"
                                                    >
                                                        删除
                                                    </AdminButton>
                                                </>
                                            }
                                        >
                                            <AdminMobileField label="销售价（起）">
                                                {quoteOnly
                                                    ? '联系客服询价'
                                                    : minPriceVariant
                                                      ? formatMoney(
                                                            minPriceVariant.price,
                                                            minPriceVariant.currencyCode,
                                                        )
                                                      : '未配置'}
                                            </AdminMobileField>
                                            <AdminMobileField
                                                label={
                                                    fulfillmentType === 'physical'
                                                        ? '在手总库存'
                                                        : '虚拟可售库存'
                                                }
                                            >
                                                {variants.length ? stockSummary : '未配置'}
                                            </AdminMobileField>
                                            <AdminMobileField label="商品类型">
                                                {fulfillmentType === 'digital' ? '虚拟商品' : '实物商品'}
                                            </AdminMobileField>
                                            <AdminMobileField label="规格数量">
                                                {quoteOnly
                                                    ? '—'
                                                    : variants.length
                                                      ? `${variants.length} 个规格`
                                                      : '未配置规格'}
                                            </AdminMobileField>
                                            <AdminMobileField label="分类" fullWidth>
                                                {categories.topLevel.primary} /{' '}
                                                {categories.secondLevel.primary === '未分类'
                                                    ? '未设置'
                                                    : categories.secondLevel.primary}
                                            </AdminMobileField>
                                            <AdminMobileField label="完整信息" fullWidth>
                                                进入编辑查看 SKU、成本、毛利率及库存策略。
                                            </AdminMobileField>
                                        </AdminMobileRecord>
                                    ),
                                )}
                            </AdminMobileList>
                        )}

                        {/* 真实数据列表 */}
                        {displayProducts.length > 0 && (
                            <table
                                aria-rowcount={productRows.length + 1}
                                className="admin-desktop-table w-full min-w-[2280px] border-collapse text-left text-xs"
                            >
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-bold whitespace-nowrap">
                                        <th
                                            scope="col"
                                            className="sticky left-0 z-20 w-10 bg-slate-50 px-3 py-3"
                                        >
                                            <AdminInput
                                                type="checkbox"
                                                aria-label="全选本页商品"
                                                checked={
                                                    displayProducts.length > 0 &&
                                                    displayProducts.every(p =>
                                                        selectedProductIds.includes(p.id),
                                                    )
                                                }
                                                ref={el => {
                                                    if (el) {
                                                        const someSelected = displayProducts.some(p =>
                                                            selectedProductIds.includes(p.id),
                                                        );
                                                        const allSelected =
                                                            displayProducts.length > 0 &&
                                                            displayProducts.every(p =>
                                                                selectedProductIds.includes(p.id),
                                                            );
                                                        el.indeterminate = someSelected && !allSelected;
                                                    }
                                                }}
                                                onChange={togglePageSelection}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                            />
                                        </th>
                                        <th
                                            scope="col"
                                            className="sticky left-10 z-20 w-14 bg-slate-50 px-3 py-3"
                                        >
                                            主图
                                        </th>
                                        <SortableTableHeader
                                            label="商品名称"
                                            sortField="name"
                                            activeSortField={sortField}
                                            sortDirection={sortDirection}
                                            onSort={toggleSort}
                                            className="sticky left-24 z-20 w-60 bg-slate-50 px-3 py-3"
                                        />
                                        <SortableTableHeader
                                            label="商品访问标识"
                                            sortField="slug"
                                            activeSortField={sortField}
                                            sortDirection={sortDirection}
                                            onSort={toggleSort}
                                            className="w-56 px-3 py-3"
                                        />
                                        <th scope="col" className="w-48 px-3 py-3">
                                            一级分类
                                        </th>
                                        <th scope="col" className="w-48 px-3 py-3">
                                            二级分类
                                        </th>
                                        <th scope="col" className="w-56 px-3 py-3">
                                            销售店铺
                                        </th>
                                        <th scope="col" className="w-28 px-3 py-3">
                                            商品类型
                                        </th>
                                        <th scope="col" className="w-28 px-3 py-3">
                                            商品状态
                                        </th>
                                        <th scope="col" className="w-28 px-3 py-3">
                                            规格数量
                                        </th>
                                        <th scope="col" className="w-28 px-3 py-3">
                                            {commerceMode === 'DIGITAL_ONLY'
                                                ? '虚拟可售库存'
                                                : commerceMode === 'PHYSICAL_ONLY'
                                                  ? '在手总库存'
                                                  : '库存状态'}
                                        </th>
                                        <th scope="col" className="w-36 px-3 py-3">
                                            销售价（起）
                                        </th>
                                        <th scope="col" className="w-40 px-3 py-3">
                                            成本价
                                        </th>
                                        <th scope="col" className="w-32 px-3 py-3">
                                            毛利率
                                        </th>
                                        <th scope="col" className="w-36 px-3 py-3">
                                            库存下限 / 上限
                                        </th>
                                        <th
                                            scope="col"
                                            className="sticky right-0 z-20 w-32 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                        >
                                            操作
                                        </th>
                                    </tr>
                                </thead>
                                <tbody
                                    ref={tableBodyRef}
                                    className="divide-y divide-slate-100 text-slate-700"
                                >
                                    {virtualRows.before > 0 && (
                                        <tr aria-hidden="true">
                                            <td
                                                colSpan={16}
                                                style={{ height: virtualRows.before, padding: 0, border: 0 }}
                                            />
                                        </tr>
                                    )}
                                    {productRows
                                        .slice(virtualRows.start, virtualRows.end)
                                        .map(
                                            (
                                                {
                                                    product,
                                                    operations,
                                                    variants,
                                                    minPriceVariant,
                                                    totalStock,
                                                    fulfillmentType,
                                                    quoteOnly,
                                                    categories,
                                                    stockSummary,
                                                    localAssignment,
                                                },
                                                rowOffset,
                                            ) => {
                                                return (
                                                    <tr
                                                        key={product.id}
                                                        data-admin-virtual-row={virtualRows.start + rowOffset}
                                                        aria-rowindex={virtualRows.start + rowOffset + 2}
                                                        className="group h-[52px] transition-colors hover:bg-slate-50/80"
                                                    >
                                                        {/* Checkbox */}
                                                        <td className="sticky left-0 z-10 h-[52px] w-10 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                            <AdminInput
                                                                type="checkbox"
                                                                aria-label={`选择商品 ${product.name}`}
                                                                checked={selectedProductIds.includes(
                                                                    product.id,
                                                                )}
                                                                onChange={() =>
                                                                    toggleProductSelection(product.id)
                                                                }
                                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                            />
                                                        </td>

                                                        {/* Featured Asset (真实素材) */}
                                                        <td className="sticky left-10 z-10 h-[52px] w-14 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                            <AdminButton
                                                                type="button"
                                                                onClick={() => editProduct(product.id)}
                                                                className="w-10 h-10 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer shadow-2xs"
                                                                aria-label={`编辑商品：${product.name}`}
                                                            >
                                                                <AdminImage
                                                                    src={product.featuredAsset?.preview}
                                                                    alt={product.name}
                                                                    className="w-full h-full object-contain"
                                                                    sizes="40px"
                                                                    fallbackIcon={
                                                                        <ImageIcon className="w-4 h-4 text-slate-300" />
                                                                    }
                                                                />
                                                            </AdminButton>
                                                        </td>

                                                        {/* Name */}
                                                        <td className="sticky left-24 z-10 h-[52px] max-w-60 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                            <AdminButton
                                                                type="button"
                                                                onClick={() => editProduct(product.id)}
                                                                className="block max-w-56 cursor-pointer truncate whitespace-nowrap text-left text-xs font-bold text-slate-900 hover:text-blue-600"
                                                                title={product.name}
                                                            >
                                                                {product.name}
                                                            </AdminButton>
                                                        </td>

                                                        {/* Slug */}
                                                        <td className="h-[52px] max-w-56 px-3 py-0 font-mono text-[10px] text-slate-500">
                                                            <span
                                                                className="block truncate"
                                                                title={product.slug}
                                                            >
                                                                {product.slug}
                                                            </span>
                                                        </td>

                                                        {/* First-level category */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                            <span
                                                                className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold ${categories.topLevel.primary === '未分类' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}
                                                            >
                                                                {categories.topLevel.primary}
                                                            </span>
                                                            {categories.topLevel.extraCount > 0 && (
                                                                <span className="ml-1 text-[10px] text-slate-400">
                                                                    +{categories.topLevel.extraCount}
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* Second-level category */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                            <span
                                                                className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold ${categories.secondLevel.primary === '未分类' ? 'bg-slate-50 text-slate-400' : 'bg-cyan-50 text-cyan-700'}`}
                                                            >
                                                                {categories.secondLevel.primary === '未分类'
                                                                    ? '未设置'
                                                                    : categories.secondLevel.primary}
                                                            </span>
                                                            {categories.secondLevel.extraCount > 0 && (
                                                                <span className="ml-1 text-[10px] text-slate-400">
                                                                    +{categories.secondLevel.extraCount}
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* 当前店铺销售授权与经营入口 */}
                                                        <td className="h-[52px] px-3 py-0 whitespace-nowrap">
                                                            <AdminButton
                                                                className="mr-2 text-xs font-medium text-blue-600"
                                                                onClick={() => setOfferProductId(product.id)}
                                                            >
                                                                本店经营设置
                                                            </AdminButton>
                                                            {(() => {
                                                                const assigned =
                                                                    channelAssignmentsByProduct.get(
                                                                        product.id,
                                                                    );
                                                                if (
                                                                    !assigned &&
                                                                    channelAssignmentsQuery.loading
                                                                ) {
                                                                    return (
                                                                        <span className="text-[11px] text-slate-400 animate-pulse">
                                                                            读取中…
                                                                        </span>
                                                                    );
                                                                }
                                                                if (!assigned || assigned.length === 0) {
                                                                    return (
                                                                        <span className="text-[11px] text-slate-400 italic">
                                                                            授权信息未获取
                                                                        </span>
                                                                    );
                                                                }
                                                                return (
                                                                    <div className="flex flex-wrap items-center gap-1 max-w-56">
                                                                        {assigned.map(ch => (
                                                                            <span
                                                                                key={ch.id}
                                                                                className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"
                                                                            >
                                                                                {getChannelDisplayName(ch)}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>

                                                        {/* Product type */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                            <span
                                                                className={`inline-flex rounded-md px-2 py-1 text-[11px] font-bold ${fulfillmentType === 'digital' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}
                                                            >
                                                                {fulfillmentType === 'digital'
                                                                    ? '虚拟商品'
                                                                    : '实物商品'}
                                                            </span>
                                                        </td>

                                                        {/* Status */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                            {!localAssignment ? (
                                                                <span className="text-xs text-slate-400">
                                                                    未获取
                                                                </span>
                                                            ) : localAssignment.listed ? (
                                                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded flex items-center gap-1 w-max">
                                                                    <CheckCircle className="w-3 h-3" /> 已上架
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-bold rounded flex items-center gap-1 w-max">
                                                                    <Package className="w-3 h-3" /> 仓库中
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* Variants Count */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-slate-600">
                                                            {quoteOnly ? (
                                                                '—'
                                                            ) : variants.length > 0 ? (
                                                                <span>
                                                                    <strong className="text-slate-900">
                                                                        {variants.length}
                                                                    </strong>{' '}
                                                                    个规格
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400 italic">
                                                                    未配置规格
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* Stock */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold">
                                                            {variants.length > 0 ? (
                                                                <span
                                                                    className={
                                                                        stockSummary === '未获取'
                                                                            ? 'text-slate-500'
                                                                            : totalStock <= 5
                                                                              ? 'text-rose-600 font-bold'
                                                                              : 'text-slate-800'
                                                                    }
                                                                >
                                                                    {stockSummary}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </td>

                                                        {/* Price */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs font-bold text-slate-900">
                                                            {quoteOnly
                                                                ? '联系客服询价'
                                                                : minPriceVariant
                                                                  ? formatMoney(
                                                                        minPriceVariant.price,
                                                                        minPriceVariant.currencyCode,
                                                                    )
                                                                  : '-'}
                                                        </td>

                                                        {/* Purchase cost */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs">
                                                            {operationsQuery.error && !operations ? (
                                                                <span
                                                                    className="font-bold text-rose-600"
                                                                    title="成本与库存策略读取失败"
                                                                >
                                                                    读取失败
                                                                </span>
                                                            ) : operationsQuery.loading && !operations ? (
                                                                <span className="text-slate-400">
                                                                    读取中…
                                                                </span>
                                                            ) : quoteOnly &&
                                                              operations?.minimumPurchaseCostMicrounits ==
                                                                  null ? (
                                                                <span className="text-slate-400">未填写</span>
                                                            ) : operations?.minimumPurchaseCostMicrounits ==
                                                              null ? (
                                                                <span className="font-bold text-rose-600">
                                                                    缺成本
                                                                </span>
                                                            ) : (
                                                                <div>
                                                                    <div className="font-bold text-slate-900">
                                                                        {formatRange(
                                                                            operations.minimumPurchaseCostMicrounits,
                                                                            operations.maximumPurchaseCostMicrounits,
                                                                            value =>
                                                                                formatMicrounits(
                                                                                    value,
                                                                                    activeChannel?.defaultCurrencyCode ??
                                                                                        minPriceVariant?.currencyCode ??
                                                                                        'CNY',
                                                                                ),
                                                                        )}
                                                                    </div>
                                                                    {operations.missingCostVariants > 0 && (
                                                                        <div className="text-[10px] font-bold text-rose-600">
                                                                            另有{' '}
                                                                            {operations.missingCostVariants}{' '}
                                                                            个 SKU 缺成本
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* Margin */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs font-bold">
                                                            {quoteOnly ||
                                                            operations?.minimumMargin == null ? (
                                                                <span className="text-slate-400">—</span>
                                                            ) : (
                                                                <span
                                                                    className={
                                                                        operations.minimumMargin < 0
                                                                            ? 'text-rose-600'
                                                                            : 'text-emerald-700'
                                                                    }
                                                                >
                                                                    {formatRange(
                                                                        operations.minimumMargin,
                                                                        operations.maximumMargin,
                                                                        value =>
                                                                            `${(value * 100).toFixed(1)}%`,
                                                                    )}
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* Inventory policy */}
                                                        <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs font-bold">
                                                            <span
                                                                className={
                                                                    operations?.lowStock
                                                                        ? 'text-rose-600'
                                                                        : 'text-slate-700'
                                                                }
                                                            >
                                                                {operations?.minimumStock == null
                                                                    ? '—'
                                                                    : `${operations.minimumStock} / ${operations.maximumStock ?? '—'}`}
                                                            </span>
                                                            {operations?.lowStock && (
                                                                <div className="text-[10px]">已低于下限</div>
                                                            )}
                                                        </td>

                                                        {/* Actions */}
                                                        <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50">
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <AdminButton
                                                                    type="button"
                                                                    onClick={() => editProduct(product.id)}
                                                                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                                                >
                                                                    <Edit3 className="w-3.5 h-3.5" /> 编辑
                                                                </AdminButton>
                                                                <AdminButton
                                                                    type="button"
                                                                    onClick={() =>
                                                                        requestDeleteProduct(product)
                                                                    }
                                                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                                                    title="删除商品"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </AdminButton>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            },
                                        )}
                                    {virtualRows.after > 0 && (
                                        <tr aria-hidden="true">
                                            <td
                                                colSpan={16}
                                                style={{ height: virtualRows.after, padding: 0, border: 0 }}
                                            />
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Pagination */}
                    <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap gap-y-3 gap-x-4 items-center justify-between text-xs text-slate-500">
                        <div>
                            共 <span className="font-bold text-slate-800 font-mono">{totalItems}</span>{' '}
                            件商品，当前第{' '}
                            <span className="font-bold text-slate-800 font-mono">{page + 1}</span> /{' '}
                            <span className="font-bold text-slate-800 font-mono">{totalPages}</span> 页
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <PageSizeSelect
                                pageSize={pageSize}
                                onPageSizeChange={setPageSize}
                                disabled={loading}
                            />
                            <AdminButton
                                type="button"
                                disabled={loading || page === 0}
                                onClick={() => setPage(Math.max(0, page - 1))}
                                className="px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium flex items-center gap-1"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" /> 上一页
                            </AdminButton>
                            <AdminButton
                                type="button"
                                disabled={loading || page + 1 >= totalPages}
                                onClick={() => setPage(page + 1)}
                                className="px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-medium flex items-center gap-1"
                            >
                                下一页 <ChevronRight className="w-3.5 h-3.5" />
                            </AdminButton>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backend soft-deletes the shared product; this is not physical erasure. */}
            {productToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
                    <AccessibleDialogSurface
                        accessibleName="删除商品确认"
                        onRequestClose={() => {
                            if (!deleting) {
                                setProductToDelete(null);
                                setDeletePassword('');
                            }
                        }}
                        role="alertdialog"
                        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-scaleIn"
                    >
                        <div className="flex items-center gap-3 text-rose-600">
                            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <h3 className="text-base font-bold text-slate-900">确认删除该商品？</h3>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">
                            确定要删除商品{' '}
                            <strong className="text-slate-900">《{productToDelete.name}》</strong>{' '}
                            吗？该商品及下属 SKU 将从所有已分配店铺的商品列表和商城中移除，历史业务记录保留。
                            这是标记删除，不会物理擦除数据库记录；当前后台没有恢复入口。
                        </p>

                        <form
                            onSubmit={event => {
                                event.preventDefault();
                                if (deleting || !deletePassword) return;
                                void handleDeleteConfirm();
                            }}
                            className="space-y-4"
                        >
                            <AdminInput
                                type="text"
                                name="username"
                                autoComplete="username"
                                tabIndex={-1}
                                aria-hidden="true"
                                className="sr-only pointer-events-none absolute h-0 w-0 opacity-0 -z-10"
                                readOnly
                            />
                            <AdminField
                                className="block text-xs font-bold text-slate-700"
                                label="当前管理员密码 *"
                            >
                                <AdminInput
                                    type="password"
                                    name="current-password"
                                    autoComplete="current-password"
                                    value={deletePassword}
                                    onChange={event => setDeletePassword(event.target.value)}
                                    placeholder="输入密码确认本人操作"
                                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                                />
                            </AdminField>

                            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                                <AdminButton
                                    type="button"
                                    onClick={() => {
                                        setProductToDelete(null);
                                        setDeletePassword('');
                                    }}
                                    disabled={deleting}
                                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                                >
                                    取消
                                </AdminButton>
                                <AdminButton
                                    type="submit"
                                    disabled={deleting || !deletePassword}
                                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {deleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                                    <span>确认删除</span>
                                </AdminButton>
                            </div>
                        </form>
                    </AccessibleDialogSurface>
                </div>
            )}
            {offerProductId && (
                <StoreOfferDialog
                    key={offerProductId}
                    productId={offerProductId}
                    onClose={() => setOfferProductId(null)}
                    onSaved={() => void refetch()}
                />
            )}
        </div>
    );
}
