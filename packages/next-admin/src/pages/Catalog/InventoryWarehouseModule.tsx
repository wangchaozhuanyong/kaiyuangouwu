import { useMutation } from '@apollo/client/react';
import type { CatalogExportRowRecord } from '@vendure/catalog-management-plugin/browser';
import { visit } from 'graphql';
import {
    AlertCircle,
    AlertTriangle,
    ArrowDownRight,
    ArrowRightLeft,
    ArrowUpRight,
    Boxes,
    CalendarClock,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Edit3,
    Plus,
    RefreshCw,
    Search,
    ShieldAlert,
    Trash2,
    Warehouse,
    X,
} from 'lucide-react';
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { systemStatusDisplayLabel } from '../../../../common/src/system-display-labels';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { AdminMobileSort } from '../../components/AdminMobileList';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { SortableTableHeader } from '../../components/SortableTableHeader';
import {
    CREATE_STOCK_LOCATION,
    DELETE_STOCK_LOCATION,
    DELETE_STOCK_LOCATIONS,
    GET_INVENTORY_OVERVIEW,
    GET_STOCK_LOCATIONS,
    UPDATE_STOCK_LOCATION,
} from '../../graphql/catalog-admin.graphql';
import {
    ADJUST_CATALOG_LEGACY_INVENTORY_MUTATION,
    CATALOG_EXPORT_ROWS_QUERY,
    CATALOG_INVENTORY_ALERT_OVERVIEW_QUERY,
    SAVE_CATALOG_INVENTORY_LOT_MUTATION,
    TRANSFER_CATALOG_INVENTORY_LOT_MUTATION,
    UPDATE_CATALOG_INVENTORY_THRESHOLD_MUTATION,
} from '../../graphql/catalog-operations.graphql';
import { UPDATE_PRODUCT_VARIANTS } from '../../graphql/catalog.graphql';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { usePageSize } from '../../hooks/use-page-size';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { type SortDirection, useUrlSortState } from '../../hooks/use-url-sort-state';
import { useUrlTab } from '../../hooks/use-url-tab';
import { selectQueryFields } from '../../utils/select-query-fields';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney } from '../Sales/sales-utils';
import { dateInputToUtcDateTime } from './catalog-date';

type InventoryTab =
    'SKU_OPERATIONS' | 'ALL' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'MOVEMENTS_LOG' | 'LOTS' | 'WAREHOUSES';
const INVENTORY_TABS = {
    skus: 'SKU_OPERATIONS',
    all: 'ALL',
    'low-stock': 'LOW_STOCK',
    'out-of-stock': 'OUT_OF_STOCK',
    movements: 'MOVEMENTS_LOG',
    lots: 'LOTS',
    warehouses: 'WAREHOUSES',
} as const;
type StockStatus = 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'NOT_TRACKED';
type InventoryAlertStatus = Exclude<StockStatus, 'NOT_TRACKED'>;

// oxlint-disable-next-line react/only-export-components -- exported for focused regression tests
export function inventoryStockStatus(
    trackInventory: 'TRUE' | 'FALSE' | 'INHERIT',
    globalTrackInventory: boolean,
    available: number,
    threshold: number,
): StockStatus {
    if (trackInventory === 'FALSE' || (trackInventory === 'INHERIT' && !globalTrackInventory)) {
        return 'NOT_TRACKED';
    }
    return available <= 0 ? 'OUT_OF_STOCK' : available <= threshold ? 'LOW_STOCK' : 'NORMAL';
}

interface StockLocationItem {
    id: string;
    name: string;
    description?: string | null;
}

interface StockLevelItem {
    id: string;
    stockLocationId: string;
    stockOnHand: number;
    stockAllocated: number;
    stockLocation: StockLocationItem;
}

interface StockMovementItem {
    id: string;
    createdAt: string;
    type: 'ADJUSTMENT' | 'ALLOCATION' | 'RELEASE' | 'SALE' | 'CANCELLATION' | 'RETURN';
    quantity: number;
}

interface ProductVariantItem {
    id: string;
    name: string;
    sku: string;
    enabled: boolean;
    price: number;
    currencyCode: string;
    trackInventory: 'TRUE' | 'FALSE' | 'INHERIT';
    outOfStockThreshold: number;
    useGlobalOutOfStockThreshold: boolean;
    product: { id: string; name: string };
    stockLevels: StockLevelItem[];
    stockMovements: { items: StockMovementItem[]; totalItems: number };
}

interface InventoryData {
    productVariants: { items: ProductVariantItem[]; totalItems: number };
    globalSettings: { outOfStockThreshold: number; trackInventory: boolean };
}

interface InventoryAlertLocation {
    productVariantId: string;
    stockLocationId: string;
    stockLocationName: string;
    stockOnHand: number;
    stockAllocated: number;
    stockAvailable: number;
    replenishmentThreshold: number;
    usesDefaultThreshold: boolean;
    status: InventoryAlertStatus;
}

interface InventoryAlertItem {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string;
    stockOnHand: number;
    stockAllocated: number;
    stockAvailable: number;
    status: InventoryAlertStatus;
    locations: InventoryAlertLocation[];
}

interface InventoryAlertData {
    catalogInventoryAlertOverview: {
        defaultReplenishmentThreshold: number;
        lowStockSkuCount: number;
        outOfStockSkuCount: number;
        items: InventoryAlertItem[];
    };
}

interface StockLocationsData {
    stockLocations: { items: StockLocationItem[]; totalItems: number };
}

interface StockRow {
    id: string;
    variantId: string;
    locationId: string;
    productName: string;
    variantName: string;
    sku: string;
    warehouse: string;
    stockOnHand: number;
    stockAllocated: number;
    stockAvailable: number;
    safetyThreshold: number;
    status: StockStatus;
}

interface InventorySkuSummary {
    variantId: string;
    productId: string;
    productName: string;
    variantName: string;
    sku: string;
    stockOnHand: number;
    stockAllocated: number;
    stockAvailable: number;
    status: StockStatus;
    locations: StockRow[];
}

// oxlint-disable-next-line react/only-export-components -- exported for inventory aggregation regressions
export function inventorySkuSummaries(
    variants: Array<Pick<ProductVariantItem, 'id' | 'product' | 'name' | 'sku' | 'trackInventory'>>,
    stockRows: StockRow[],
    globalTrackInventory: boolean,
): InventorySkuSummary[] {
    const locationsByVariant = new Map<string, StockRow[]>();
    for (const row of stockRows) {
        const locations = locationsByVariant.get(row.variantId) ?? [];
        locations.push(row);
        locationsByVariant.set(row.variantId, locations);
    }
    return variants.map(variant => {
        const locations = locationsByVariant.get(variant.id) ?? [];
        const stockOnHand = locations.reduce((total, level) => total + level.stockOnHand, 0);
        const stockAllocated = locations.reduce((total, level) => total + level.stockAllocated, 0);
        const stockAvailable = stockOnHand - stockAllocated;
        const trackedStatus = inventoryStockStatus(
            variant.trackInventory,
            globalTrackInventory,
            stockAvailable,
            0,
        );
        // Match the alert overview: positive total with any depleted/low warehouse needs replenishment.
        const status =
            trackedStatus === 'NORMAL' &&
            locations.some(level => level.status === 'LOW_STOCK' || level.status === 'OUT_OF_STOCK')
                ? 'LOW_STOCK'
                : trackedStatus;
        return {
            variantId: variant.id,
            productId: variant.product.id,
            productName: variant.product.name,
            variantName: variant.name,
            sku: variant.sku,
            stockOnHand,
            stockAllocated,
            stockAvailable,
            status,
            locations,
        };
    });
}

interface MovementRow extends StockMovementItem {
    variantId: string;
    productName: string;
    sku: string;
}

interface InventoryLotRow {
    id: string;
    productId: string;
    productName: string;
    variantId: string;
    sku: string;
    stockLocationId: string;
    stockLocationName: string;
    lotCode: string;
    manufacturedAt: string | null;
    expiresAt: string | null;
    quantityOnHand: number;
    purchaseCostMicrounits: number | null;
    currencyCode: string;
    state: string;
}

interface InventoryLotDraft {
    reconcileExistingStock?: boolean;
    id?: string;
    productVariantId: string;
    stockLocationId: string;
    lotCode: string;
    manufacturedAt: string;
    expiresAt: string;
    quantityOnHand: string;
    purchaseCost: string;
    reason: string;
}

export function validateInventoryLotDraft(
    draft: InventoryLotDraft,
    variants: Array<Pick<CatalogExportRowRecord, 'variantId'>>,
): string | undefined {
    const variant = variants.find(item => item.variantId === draft.productVariantId);
    const lotCode = draft.lotCode.trim();
    const quantityText = draft.quantityOnHand.trim();
    const quantityOnHand = Number(quantityText);
    const purchaseCost = draft.purchaseCost.trim() ? Number(draft.purchaseCost) : null;
    if (!variant || !lotCode) return '请选择 SKU 并填写批次号';
    if (!quantityText || !Number.isInteger(quantityOnHand) || quantityOnHand < 0)
        return '批次数量必须是不小于 0 的整数';
    if (purchaseCost != null && (!Number.isFinite(purchaseCost) || purchaseCost < 0))
        return '请输入有效的非负批次成本';
    if (!draft.reason.trim()) return '请填写库存调整原因';
    return undefined;
}

interface InventoryLotTransferDraft {
    inventoryLotId: string;
    sku: string;
    lotCode: string;
    sourceLocationId: string;
    targetStockLocationId: string;
    quantity: string;
    maximumQuantity: number;
    reason: string;
}

const EMPTY_VARIANTS: ProductVariantItem[] = [];
const EMPTY_LOCATIONS: StockLocationItem[] = [];
const EMPTY_CATALOG_EXPORT_ROWS: CatalogExportRowRecord[] = [];
const INVENTORY_SORT_FIELDS = ['updatedAt', 'name', 'sku', 'price', 'stockOnHand', 'stockAllocated'] as const;
type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];
const INVENTORY_MOBILE_SORT_FIELDS = [
    { value: 'updatedAt', label: '更新时间' },
    { value: 'name', label: '规格名称' },
    { value: 'sku', label: 'SKU' },
    { value: 'price', label: '当前店铺价格' },
    { value: 'stockOnHand', label: '在手库存' },
    { value: 'stockAllocated', label: '锁定库存' },
];
const movementLabels: Record<StockMovementItem['type'], string> = {
    ADJUSTMENT: '库存盘点调整',
    ALLOCATION: '订单占用',
    RELEASE: '释放占用',
    SALE: '订单销售出库',
    CANCELLATION: '取消订单回补',
    RETURN: '售后退货入库',
};

const formatDateTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
          }).format(date);
};

export function InventoryWarehouseModule() {
    const standalonePage = useStandaloneAdminPage();
    const location = useLocation();
    const requestConfirmation = useConfirmDialog();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useUrlTab<InventoryTab>(INVENTORY_TABS, 'all');
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm.trim());
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setPage);
    const { sortDirection, sortField, toggleSort } = useUrlSortState({
        fields: INVENTORY_SORT_FIELDS,
        defaultField: 'updatedAt',
        defaultDirection: 'DESC',
    });
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [selectedStock, setSelectedStock] = useState<StockRow | null>(null);
    const [adjustAmount, setAdjustAmount] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const [adjusting, setAdjusting] = useState(false);
    const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
    const [editingLocation, setEditingLocation] = useState<StockLocationItem | null>(null);
    const [locationName, setLocationName] = useState('');
    const [locationDescription, setLocationDescription] = useState('');
    const [transferToLocationId, setTransferToLocationId] = useState('');
    const [savingLocation, setSavingLocation] = useState(false);
    const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
    const [bulkLocationTransferId, setBulkLocationTransferId] = useState('');
    const [bulkPrice, setBulkPrice] = useState('');
    const [bulkUpdating, setBulkUpdating] = useState(false);
    const [lotDraft, setLotDraft] = useState<InventoryLotDraft | null>(null);
    const [lotTransferDraft, setLotTransferDraft] = useState<InventoryLotTransferDraft | null>(null);
    const [expandedAlertSkuIds, setExpandedAlertSkuIds] = useState<Set<string>>(() => new Set());
    const [expandedStockSkuIds, setExpandedStockSkuIds] = useState<Set<string>>(() => new Set());
    const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
    const [savingThresholdKey, setSavingThresholdKey] = useState<string | null>(null);
    const loadingAllLocationsRef = useRef(false);

    const inventoryPageKey = standalonePage?.key;
    const inventoryDocument = useMemo(() => {
        if (!inventoryPageKey) return GET_INVENTORY_OVERVIEW;
        const movements = inventoryPageKey === 'movements';
        const document = visit(GET_INVENTORY_OVERVIEW, {
            Field(node) {
                if (!movements && node.name.value === 'stockMovements') return null;
                if (
                    movements &&
                    [
                        'stockLevels',
                        'globalSettings',
                        'price',
                        'currencyCode',
                        'trackInventory',
                        'outOfStockThreshold',
                        'useGlobalOutOfStockThreshold',
                    ].includes(node.name.value)
                )
                    return null;
            },
        });
        return selectQueryFields(
            document,
            movements ? ['productVariants'] : ['productVariants', 'globalSettings'],
        );
    }, [inventoryPageKey]);
    const { data, loading, error, refetch } = useQuery<InventoryData>(inventoryDocument, {
        skip: standalonePage?.key === 'warehouses' || standalonePage?.key === 'lots',
        variables: {
            variantOptions: {
                skip: page * pageSize,
                take: pageSize,
                sort: { [sortField]: sortDirection },
                filter: deferredSearchTerm
                    ? {
                          _or: [
                              { sku: { contains: deferredSearchTerm } },
                              { name: { contains: deferredSearchTerm } },
                          ],
                      }
                    : undefined,
            },
        },

        notifyOnNetworkStatusChange: true,
    });
    const locationQuery = useQuery<StockLocationsData>(GET_STOCK_LOCATIONS, {
        variables: { options: { skip: 0, take: 100, sort: { name: 'ASC', id: 'ASC' } } },
    });
    const {
        data: locationData,
        error: locationError,
        fetchMore: fetchMoreLocations,
        loading: locationsLoading,
    } = locationQuery;
    const lotQuery = useQuery<{
        catalogExportRows: { items: CatalogExportRowRecord[]; totalItems: number };
    }>(CATALOG_EXPORT_ROWS_QUERY, {
        variables: { skip: page * pageSize, take: pageSize },
        skip: activeTab !== 'LOTS',

        notifyOnNetworkStatusChange: true,
    });
    const alertQuery = useQuery<InventoryAlertData>(CATALOG_INVENTORY_ALERT_OVERVIEW_QUERY, {
        skip: Boolean(standalonePage) && !['all', 'skus'].includes(standalonePage!.key),
        notifyOnNetworkStatusChange: true,
    });

    useEffect(() => {
        const result = locationData?.stockLocations;
        if (!result || locationsLoading || locationError || loadingAllLocationsRef.current) return;
        const loadedCount = result.items.length;
        if (loadedCount >= result.totalItems) return;
        loadingAllLocationsRef.current = true;
        void fetchMoreLocations({
            variables: { options: { skip: loadedCount, take: 100, sort: { name: 'ASC', id: 'ASC' } } },
            updateQuery: (previous, { fetchMoreResult }) => ({
                stockLocations: {
                    ...fetchMoreResult.stockLocations,
                    items: [
                        ...new Map(
                            [...previous.stockLocations.items, ...fetchMoreResult.stockLocations.items].map(
                                location => [location.id, location],
                            ),
                        ).values(),
                    ],
                },
            }),
        })
            .catch(fetchError => {
                setActionError(toUserFacingError(fetchError, '库存点未能全部加载'));
            })
            .finally(() => {
                loadingAllLocationsRef.current = false;
            });
    }, [fetchMoreLocations, locationData, locationError, locationsLoading]);
    const [adjustLegacyInventory] = useMutation(ADJUST_CATALOG_LEGACY_INVENTORY_MUTATION);
    const [createLocation] = useMutation(CREATE_STOCK_LOCATION);
    const [updateLocation] = useMutation(UPDATE_STOCK_LOCATION);
    const [deleteLocation] = useMutation<{ deleteStockLocation: { result: string; message?: string } }>(
        DELETE_STOCK_LOCATION,
    );
    const [deleteLocations, deleteLocationsState] = useMutation<{
        deleteStockLocations: Array<{ result: string; message?: string }>;
    }>(DELETE_STOCK_LOCATIONS);
    const [updateProductVariants] = useMutation<{
        updateProductVariants: Array<{ id: string } | null>;
    }>(UPDATE_PRODUCT_VARIANTS);
    const [saveInventoryLot, saveInventoryLotState] = useMutation(SAVE_CATALOG_INVENTORY_LOT_MUTATION);
    const [transferInventoryLot, transferInventoryLotState] = useMutation(
        TRANSFER_CATALOG_INVENTORY_LOT_MUTATION,
    );
    const [updateInventoryThreshold] = useMutation(UPDATE_CATALOG_INVENTORY_THRESHOLD_MUTATION);

    const variants = data?.productVariants?.items ?? EMPTY_VARIANTS;
    const locations = locationData?.stockLocations.items ?? EMPTY_LOCATIONS;
    const globalTrackInventory = data?.globalSettings?.trackInventory ?? true;
    const alertOverview = alertQuery.data?.catalogInventoryAlertOverview;
    const defaultReplenishmentThreshold = alertOverview?.defaultReplenishmentThreshold ?? 5;
    const alertLocationByKey = useMemo(
        () =>
            new Map(
                (alertOverview?.items ?? []).flatMap(item =>
                    item.locations.map(
                        level => [`${level.productVariantId}:${level.stockLocationId}`, level] as const,
                    ),
                ),
            ),
        [alertOverview?.items],
    );
    const totalVariants = data?.productVariants?.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalVariants / pageSize));
    const refetchAll = async () => {
        await Promise.all([
            ...(!standalonePage || !['warehouses', 'lots'].includes(standalonePage.key) ? [refetch()] : []),
            ...(!standalonePage || ['all', 'skus'].includes(standalonePage.key)
                ? [alertQuery.refetch()]
                : []),
            locationQuery.refetch(),
            ...(activeTab === 'LOTS' ? [lotQuery.refetch()] : []),
        ]);
    };
    const pageLoading =
        loading ||
        locationsLoading ||
        (activeTab === 'LOTS' && lotQuery.loading) ||
        (['LOW_STOCK', 'OUT_OF_STOCK'].includes(activeTab) && alertQuery.loading);
    const pageError =
        error ?? locationError ?? alertQuery.error ?? (activeTab === 'LOTS' ? lotQuery.error : undefined);

    const stockList = useMemo<StockRow[]>(
        () =>
            variants.flatMap(variant => {
                return (variant.stockLevels ?? []).map(level => {
                    const alertLocation = alertLocationByKey.get(`${variant.id}:${level.stockLocationId}`);
                    const threshold = alertLocation?.replenishmentThreshold ?? defaultReplenishmentThreshold;
                    const available = level.stockOnHand - level.stockAllocated;
                    const status = inventoryStockStatus(
                        variant.trackInventory,
                        globalTrackInventory,
                        available,
                        threshold,
                    );
                    return {
                        id: variant.id + ':' + level.stockLocationId,
                        variantId: variant.id,
                        locationId: level.stockLocationId,
                        productName: variant.product.name,
                        variantName: variant.name,
                        sku: variant.sku,
                        warehouse: level.stockLocation.name,
                        stockOnHand: level.stockOnHand,
                        stockAllocated: level.stockAllocated,
                        stockAvailable: available,
                        safetyThreshold: threshold,
                        status,
                    };
                });
            }),
        [alertLocationByKey, defaultReplenishmentThreshold, globalTrackInventory, variants],
    );

    const movementLogs = useMemo<MovementRow[]>(
        () =>
            variants
                .flatMap(variant =>
                    (variant.stockMovements?.items ?? []).map(movement => ({
                        ...movement,
                        variantId: variant.id,
                        productName: variant.product.name,
                        sku: variant.sku,
                    })),
                )
                .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
        [variants],
    );
    const lotVariants = lotQuery.data?.catalogExportRows?.items ?? EMPTY_CATALOG_EXPORT_ROWS;
    const lotRows = useMemo<InventoryLotRow[]>(
        () =>
            lotVariants.flatMap(variant =>
                variant.lots.map(lot => ({
                    ...lot,
                    productId: variant.productId,
                    productName: variant.productName,
                    variantId: variant.variantId,
                    sku: variant.sku,
                })),
            ),
        [lotVariants],
    );
    const lotTotalVariants = lotQuery.data?.catalogExportRows?.totalItems ?? 0;
    const lotTotalPages = Math.max(1, Math.ceil(lotTotalVariants / pageSize));

    const stockSkuSummaries = useMemo(
        () => inventorySkuSummaries(variants, stockList, globalTrackInventory),
        [variants, stockList, globalTrackInventory],
    );
    const alertItems = useMemo(() => {
        const targetStatus = activeTab === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'LOW_STOCK';
        const search = deferredSearchTerm.toLocaleLowerCase();
        return (alertOverview?.items ?? []).filter(item => {
            if (item.status !== targetStatus) return false;
            if (!search) return true;
            return [item.productName, item.variantName, item.sku].some(value =>
                value.toLocaleLowerCase().includes(search),
            );
        });
    }, [activeTab, alertOverview?.items, deferredSearchTerm]);

    const showNotice = (message: string) => {
        setNotification(message);
        setActionError('');
        window.setTimeout(() => setNotification(''), 3500);
    };
    const showError = (message: string) => {
        setActionError(message);
        setNotification('');
    };

    const toggleAlertSku = (variantId: string) => {
        setExpandedAlertSkuIds(current => {
            const next = new Set(current);
            if (next.has(variantId)) next.delete(variantId);
            else next.add(variantId);
            return next;
        });
    };

    const handleThresholdSave = async (
        item: InventoryAlertItem,
        level: InventoryAlertLocation,
        useDefault: boolean,
    ) => {
        const key = `${level.productVariantId}:${level.stockLocationId}`;
        const rawValue = thresholdDrafts[key] ?? String(level.replenishmentThreshold);
        const threshold = Number(rawValue);
        if (!useDefault && (!Number.isInteger(threshold) || threshold < 0)) {
            showError('补货预警值必须是不小于 0 的整数');
            return;
        }
        setSavingThresholdKey(key);
        setActionError('');
        try {
            await updateInventoryThreshold({
                variables: {
                    input: {
                        productVariantId: level.productVariantId,
                        stockLocationId: level.stockLocationId,
                        threshold: useDefault ? null : threshold,
                    },
                },
            });
            setThresholdDrafts(current => {
                const next = { ...current };
                delete next[key];
                return next;
            });
            await Promise.all([alertQuery.refetch(), refetch()]);
            showNotice(
                useDefault
                    ? `${item.sku} / ${level.stockLocationName} 已恢复默认预警值 ${defaultReplenishmentThreshold}`
                    : `${item.sku} / ${level.stockLocationName} 的补货预警值已更新为 ${threshold}`,
            );
        } catch (thresholdError) {
            showError(toUserFacingError(thresholdError, '补货预警值保存失败，请稍后重试'));
        } finally {
            setSavingThresholdKey(null);
        }
    };

    const openNewLot = () => {
        const variant = lotVariants.find(item => item.stockLevels.length > 0);
        if (!variant) {
            showError('当前页没有可用的 SKU 与库存点，请先完成库存点关联');
            return;
        }
        setLotDraft({
            productVariantId: variant.variantId,
            stockLocationId: variant.stockLevels[0].stockLocationId,
            lotCode: '',
            manufacturedAt: '',
            expiresAt: '',
            quantityOnHand: '0',
            purchaseCost: '',
            reason: '',
        });
        setActionError('');
    };

    const saveLot = async () => {
        if (!lotDraft) return;
        const variant = lotVariants.find(item => item.variantId === lotDraft.productVariantId);
        const lotCode = lotDraft.lotCode.trim();
        const quantityOnHand = Number(lotDraft.quantityOnHand);
        const purchaseCost = lotDraft.purchaseCost.trim() ? Number(lotDraft.purchaseCost) : null;
        const validationError = validateInventoryLotDraft(lotDraft, lotVariants);
        if (validationError) {
            showError(validationError);
            return;
        }
        if (!variant) return;
        setActionError('');
        try {
            await saveInventoryLot({
                variables: {
                    input: {
                        ...(lotDraft.id ? { id: lotDraft.id } : {}),
                        productVariantId: lotDraft.productVariantId,
                        stockLocationId: lotDraft.stockLocationId,
                        lotCode,
                        manufacturedAt: dateInputToUtcDateTime(lotDraft.manufacturedAt),
                        expiresAt: dateInputToUtcDateTime(lotDraft.expiresAt),
                        quantityOnHand,
                        reconcileExistingStock: lotDraft.reconcileExistingStock ?? false,
                        purchaseCostMicrounits:
                            purchaseCost == null ? null : Math.round(purchaseCost * 1_000),
                        currencyCode: variant.currencyCode,
                        idempotencyKey: crypto.randomUUID(),
                        reason: lotDraft.reason.trim(),
                    },
                },
            });
            setLotDraft(null);
            await Promise.all([lotQuery.refetch(), refetch()]);
            showNotice('库存批次已保存，对应库存流水已同步');
        } catch (lotError) {
            showError(toUserFacingError(lotError, '库存批次保存失败，请检查输入后重试'));
        }
    };

    const closeStockAdjustment = () => {
        if (adjusting) return;
        setSelectedStock(null);
        setAdjustAmount('');
        setAdjustReason('');
        setActionError('');
    };

    const handleAdjustSubmit = async () => {
        if (!selectedStock) return;
        const increment = Number(adjustAmount);
        if (!Number.isInteger(increment) || increment === 0) {
            showError('请输入不等于 0 的整数调整数量');
            return;
        }
        const nextStock = selectedStock.stockOnHand + increment;
        if (nextStock < 0) {
            showError('调整后库存不能小于 0，当前最多可减少 ' + selectedStock.stockOnHand);
            return;
        }
        if (!adjustReason.trim()) {
            showError('请填写盘点调整原因');
            return;
        }
        setAdjusting(true);
        setActionError('');
        try {
            await adjustLegacyInventory({
                variables: {
                    input: {
                        productVariantId: selectedStock.variantId,
                        stockLocationId: selectedStock.locationId,
                        stockOnHand: nextStock,
                        idempotencyKey: crypto.randomUUID(),
                        reason: adjustReason.trim(),
                        reference: 'NEXT_ADMIN_INVENTORY',
                    },
                },
            });
            await refetchAll();
            showNotice(
                '已将 ' +
                    selectedStock.sku +
                    ' 在《' +
                    selectedStock.warehouse +
                    '》的在手库存调整为 ' +
                    nextStock,
            );
            setSelectedStock(null);
            setAdjustAmount('');
            setAdjustReason('');
        } catch (adjustError) {
            showError(toUserFacingError(adjustError, '库存调整失败，请稍后重试'));
        } finally {
            setAdjusting(false);
        }
    };

    const saveLotTransfer = async () => {
        if (!lotTransferDraft) return;
        const quantity = Number(lotTransferDraft.quantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > lotTransferDraft.maximumQuantity) {
            showError(`转仓数量必须是 1 到 ${lotTransferDraft.maximumQuantity} 的整数`);
            return;
        }
        if (!lotTransferDraft.targetStockLocationId || !lotTransferDraft.reason.trim()) {
            showError('请选择目标仓库并填写转仓原因');
            return;
        }
        setActionError('');
        try {
            await transferInventoryLot({
                variables: {
                    input: {
                        inventoryLotId: lotTransferDraft.inventoryLotId,
                        targetStockLocationId: lotTransferDraft.targetStockLocationId,
                        quantity,
                        idempotencyKey: crypto.randomUUID(),
                        reason: lotTransferDraft.reason.trim(),
                        reference: 'NEXT_ADMIN_INVENTORY',
                    },
                },
            });
            setLotTransferDraft(null);
            await Promise.all([lotQuery.refetch(), refetch()]);
            showNotice('批次转仓已入账，来源与去向流水已保留');
        } catch (cause) {
            showError(toUserFacingError(cause, '批次转仓失败'));
        }
    };

    const openLocationModal = (location: StockLocationItem | null = null) => {
        setEditingLocation(location);
        setLocationName(location?.name ?? '');
        setLocationDescription(location?.description ?? '');
        setTransferToLocationId('');
        setActionError('');
        setIsLocationModalOpen(true);
    };
    const closeLocationModal = () => {
        if (savingLocation) return;
        setIsLocationModalOpen(false);
        setEditingLocation(null);
        setLocationName('');
        setLocationDescription('');
        setTransferToLocationId('');
        setActionError('');
    };

    const handleSaveLocation = async () => {
        const name = locationName.trim();
        if (!name) {
            showError('库存点名称不能为空');
            return;
        }
        setSavingLocation(true);
        setActionError('');
        try {
            if (editingLocation) {
                await updateLocation({
                    variables: {
                        input: {
                            id: editingLocation.id,
                            name,
                            description: locationDescription.trim(),
                        },
                    },
                });
            } else {
                await createLocation({
                    variables: { input: { name, description: locationDescription.trim() } },
                });
            }
            await refetchAll();
            showNotice((editingLocation ? '已保存' : '已创建') + '库存点《' + name + '》');
            setIsLocationModalOpen(false);
            setEditingLocation(null);
        } catch (locationError) {
            showError(toUserFacingError(locationError, '库存点保存失败，请稍后重试'));
        } finally {
            setSavingLocation(false);
        }
    };

    const handleDeleteLocation = async () => {
        if (!editingLocation) return;
        const stockCount = stockList.filter(stock => stock.locationId === editingLocation.id).length;
        if (stockCount > 0 && !transferToLocationId) {
            showError('该库存点仍有关联 SKU，请先选择库存迁移目标');
            return;
        }
        const confirmation = await requestConfirmation({
            title: `删除库存点《${editingLocation.name}》？`,
            description: transferToLocationId
                ? '该库存点关联的库存会先迁移到所选目标库存点，然后删除。'
                : '删除后无法恢复，请确认该库存点不再使用。',
            confirmLabel: '确认删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        setSavingLocation(true);
        setActionError('');
        try {
            const result = await deleteLocation({
                variables: {
                    input: {
                        id: editingLocation.id,
                        transferToLocationId: transferToLocationId || undefined,
                    },
                },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            if (result.data?.deleteStockLocation.result !== 'DELETED') {
                throw new Error(result.data?.deleteStockLocation.message || '后端拒绝删除该库存点');
            }
            await refetchAll();
            showNotice('已删除库存点《' + editingLocation.name + '》');
            setIsLocationModalOpen(false);
            setEditingLocation(null);
        } catch (deleteError) {
            showError(toUserFacingError(deleteError, '库存点删除失败，请稍后重试'));
        } finally {
            setSavingLocation(false);
        }
    };

    const handleBulkEnabledChange = async (nextEnabled: boolean) => {
        if (selectedVariantIds.length === 0 || bulkUpdating) return;
        const confirmation = await requestConfirmation({
            title: `批量${nextEnabled ? '上架' : '下架'} ${selectedVariantIds.length} 个 SKU？`,
            description: nextEnabled
                ? '上架后买家可在商品启用且有库存时购买这些 SKU。'
                : '下架后这些 SKU 会立即停止销售，已有订单不受影响。',
            confirmLabel: `验证并${nextEnabled ? '上架' : '下架'}`,
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        setBulkUpdating(true);
        setActionError('');
        try {
            const response = await updateProductVariants({
                variables: { input: selectedVariantIds.map(id => ({ id, enabled: nextEnabled })) },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const updatedIds = new Set(
                (response.data?.updateProductVariants ?? [])
                    .filter((item): item is { id: string } => Boolean(item?.id))
                    .map(item => item.id),
            );
            const failedIds = selectedVariantIds.filter(id => !updatedIds.has(id));
            await refetchAll();
            setSelectedVariantIds(failedIds);
            if (failedIds.length) {
                throw new Error(`已更新 ${updatedIds.size} 个，${failedIds.length} 个 SKU 未被后端确认`);
            }
            showNotice(`已批量${nextEnabled ? '上架' : '下架'} ${updatedIds.size} 个 SKU`);
        } catch (updateError) {
            showError(toUserFacingError(updateError, 'SKU 批量状态更新失败，请稍后重试'));
        } finally {
            setBulkUpdating(false);
        }
    };

    const handleBulkDeleteLocations = async () => {
        if (!selectedLocationIds.length || deleteLocationsState.loading) return;
        if (bulkLocationTransferId && selectedLocationIds.includes(bulkLocationTransferId)) {
            showError('库存迁移目标不能同时被删除');
            return;
        }
        const confirmation = await requestConfirmation({
            title: `批量删除 ${selectedLocationIds.length} 个库存点？`,
            description: bulkLocationTransferId
                ? '后端会将关联库存迁移到指定目标后逐项删除，并回传每项结果。'
                : '未选择迁移目标；仍有关联库存的库存点将由后端拒绝删除。',
            confirmLabel: '验证并批量删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        setActionError('');
        try {
            const response = await deleteLocations({
                variables: {
                    input: selectedLocationIds.map(id => ({
                        id,
                        transferToLocationId: bulkLocationTransferId || undefined,
                    })),
                },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const results = response.data?.deleteStockLocations ?? [];
            const deletedIds = selectedLocationIds.filter(
                (_id, index) => results[index]?.result === 'DELETED',
            );
            const failures = results
                .map((result, index) => ({ result, id: selectedLocationIds[index] }))
                .filter(item => item.result.result !== 'DELETED');
            const failedCount = selectedLocationIds.length - deletedIds.length;
            await refetchAll();
            setSelectedLocationIds(current => current.filter(id => !deletedIds.includes(id)));
            if (failedCount) {
                showError(
                    `已删除 ${deletedIds.length} 个，${failedCount} 个失败：${
                        failures.map(item => item.result.message || `ID ${item.id}`).join('；') ||
                        '后端未返回完整结果'
                    }`,
                );
            } else {
                showNotice(`已删除 ${deletedIds.length} 个库存点`);
                setBulkLocationTransferId('');
            }
        } catch (deleteError) {
            showError(toUserFacingError(deleteError, '库存点批量删除失败'));
        }
    };

    const handleBulkPriceChange = async () => {
        const amount = Number(bulkPrice);
        if (selectedVariantIds.length === 0) return;
        if (!Number.isFinite(amount) || amount < 0) {
            showError('请输入有效的非负销售价');
            return;
        }
        const confirmation = await requestConfirmation({
            title: `统一调整 ${selectedVariantIds.length} 个 SKU 的价格？`,
            description: `所选 SKU 在当前店铺的销售价将统一改为 ${amount.toFixed(2)}，其他店铺价格不受影响。`,
            confirmLabel: '确认调价',
            tone: 'warning',
        });
        if (!confirmation) return;
        setBulkUpdating(true);
        setActionError('');
        try {
            const response = await updateProductVariants({
                variables: { input: selectedVariantIds.map(id => ({ id, price: Math.round(amount * 100) })) },
            });
            const updatedIds = new Set(
                (response.data?.updateProductVariants ?? [])
                    .filter((item): item is { id: string } => Boolean(item?.id))
                    .map(item => item.id),
            );
            const failedIds = selectedVariantIds.filter(id => !updatedIds.has(id));
            await refetchAll();
            setSelectedVariantIds(failedIds);
            if (failedIds.length) {
                throw new Error(`已更新 ${updatedIds.size} 个，${failedIds.length} 个 SKU 未被后端确认`);
            }
            showNotice(`已更新 ${updatedIds.size} 个 SKU 的销售价`);
            setBulkPrice('');
        } catch (updateError) {
            showError(toUserFacingError(updateError, 'SKU 批量调价失败，请稍后重试'));
        } finally {
            setBulkUpdating(false);
        }
    };

    const changePage = (nextPage: number) => {
        setPage(nextPage);
        setSelectedVariantIds([]);
    };
    const changeSort = (field: InventorySortField, initialDirection?: SortDirection) => {
        toggleSort(field, initialDirection);
        setPage(0);
        setSelectedVariantIds([]);
    };

    const lowStockCount = alertOverview?.lowStockSkuCount;
    const outOfStockCount = alertOverview?.outOfStockSkuCount;
    const tabs: Array<[InventoryTab, typeof Boxes, string]> = [
        ['SKU_OPERATIONS', Boxes, 'SKU 运营 (' + totalVariants + ')'],
        ['ALL', Boxes, '库存总览 (' + totalVariants + ' 个 SKU)'],
        ['LOW_STOCK', AlertTriangle, `全店低库存 (${lowStockCount ?? '…'})`],
        ['OUT_OF_STOCK', ShieldAlert, `全店缺货 (${outOfStockCount ?? '…'})`],
        ['MOVEMENTS_LOG', ArrowRightLeft, '本页流水 (' + movementLogs.length + ')'],
        ['LOTS', CalendarClock, '批次与效期 (' + lotRows.length + ')'],
        ['WAREHOUSES', Warehouse, '库存点 (' + locations.length + ')'],
    ];

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        {standalonePage?.title ?? '库存与多仓管理'}
                        <FeatureHelpButton
                            topic="catalog.inventory"
                            title="库存与多仓管理"
                            description={
                                '读取 Vendure 多库存点数据，统一处理在手、锁定、可售库存与真实变动流水'
                            }
                        />
                    </h1>
                </div>
                {activeTab === 'WAREHOUSES' ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <AdminSelect
                            value={bulkLocationTransferId}
                            onChange={event => setBulkLocationTransferId(event.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                            aria-label="批量删除前的库存迁移目标"
                        >
                            <option value="">不迁移关联库存</option>
                            {locations
                                .filter(location => !selectedLocationIds.includes(location.id))
                                .map(location => (
                                    <option key={location.id} value={location.id}>
                                        迁移到 {location.name}
                                    </option>
                                ))}
                        </AdminSelect>
                        <AdminButton
                            type="button"
                            onClick={() => void handleBulkDeleteLocations()}
                            disabled={!selectedLocationIds.length || deleteLocationsState.loading}
                            className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            批量删除 {selectedLocationIds.length || ''}
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={() => openLocationModal()}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            新增库存点
                        </AdminButton>
                    </div>
                ) : activeTab === 'LOTS' ? (
                    <div className="flex flex-wrap gap-2">
                        <AdminButton
                            refreshPage
                            type="button"
                            onClick={() => void lotQuery.refetch()}
                            disabled={lotQuery.loading}
                            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                        >
                            <RefreshCw
                                className={
                                    'h-3.5 w-3.5 ' +
                                    (lotQuery.loading && !lotQuery.data ? 'animate-spin' : '')
                                }
                            />
                            刷新批次
                        </AdminButton>
                        <AdminButton
                            type="button"
                            onClick={openNewLot}
                            disabled={!lotVariants.some(variant => variant.stockLevels.length > 0)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            新增库存批次
                        </AdminButton>
                    </div>
                ) : (
                    <AdminButton
                        refreshPage
                        type="button"
                        onClick={() => void refetchAll()}
                        disabled={pageLoading}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                        <RefreshCw className={'h-3.5 w-3.5 ' + (pageLoading ? 'animate-spin' : '')} />
                        刷新库存
                    </AdminButton>
                )}
            </div>

            {(!standalonePage || standalonePage.key === 'all') && (
                <div className="px-4 py-3 md:hidden">
                    <AdminField label="库存管理章节">
                        <AdminSelect
                            aria-label="库存管理章节"
                            value={activeTab}
                            onChange={event => {
                                setActiveTab(event.target.value as typeof activeTab);
                                setPage(0);
                                setSelectedVariantIds([]);
                            }}
                        >
                            {tabs
                                .filter(
                                    ([key]) =>
                                        !standalonePage || ['ALL', 'LOW_STOCK', 'OUT_OF_STOCK'].includes(key),
                                )
                                .map(([key, , label]) => (
                                    <option key={key} value={key}>
                                        {label}
                                    </option>
                                ))}
                        </AdminSelect>
                    </AdminField>
                </div>
            )}
            {(!standalonePage || standalonePage.key === 'all') && (
                <div className="scrollbar-hidden hidden md:flex shrink-0 gap-6 overflow-x-auto border-b border-slate-200 bg-white px-5 text-xs font-bold sm:px-8">
                    {tabs
                        .filter(
                            ([key]) => !standalonePage || ['ALL', 'LOW_STOCK', 'OUT_OF_STOCK'].includes(key),
                        )
                        .map(([key, Icon, label]) => (
                            <AdminButton
                                type="button"
                                key={key}
                                onClick={() => {
                                    setActiveTab(key);
                                    setPage(0);
                                    setSelectedVariantIds([]);
                                }}
                                className={
                                    'flex shrink-0 items-center gap-1.5 border-b-2 py-3.5 ' +
                                    (activeTab === key
                                        ? 'border-blue-600 text-blue-600'
                                        : 'border-transparent text-slate-500 hover:text-slate-800')
                                }
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {label}
                            </AdminButton>
                        ))}
                </div>
            )}

            <div className="mx-auto w-full max-w-none flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {notification && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" />
                        {notification}
                    </div>
                )}
                {(pageError || actionError) && (
                    <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>
                                {actionError || toUserFacingError(pageError, '库存数据读取失败，请稍后重试')}
                            </span>
                        </div>
                        {pageError && (
                            <AdminButton
                                type="button"
                                onClick={() => void refetchAll()}
                                className="rounded bg-rose-600 px-3 py-1 font-bold text-white"
                            >
                                重试
                            </AdminButton>
                        )}
                    </div>
                )}

                {pageLoading && (!data || !locationData) ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
                        {[1, 2, 3, 4].map(item => (
                            <div key={item} className="h-14 animate-pulse rounded-lg bg-slate-100" />
                        ))}
                    </div>
                ) : activeTab === 'SKU_OPERATIONS' ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 p-4 xl:flex-row xl:items-center xl:justify-between">
                            <div className="relative w-full max-w-sm">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <AdminInput
                                    value={searchTerm}
                                    onChange={event => {
                                        setSearchTerm(event.target.value);
                                        setPage(0);
                                        setSelectedVariantIds([]);
                                    }}
                                    aria-label="搜索 SKU 库存"
                                    placeholder="按 SKU / 规格名称检索全部数据..."
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-slate-500">
                                    已选{' '}
                                    <strong className="font-mono text-slate-900">
                                        {selectedVariantIds.length}
                                    </strong>{' '}
                                    项
                                </span>
                                <AdminButton
                                    type="button"
                                    onClick={() => void handleBulkEnabledChange(true)}
                                    disabled={selectedVariantIds.length === 0 || bulkUpdating}
                                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-40"
                                >
                                    批量上架
                                </AdminButton>
                                <AdminButton
                                    type="button"
                                    onClick={() => void handleBulkEnabledChange(false)}
                                    disabled={selectedVariantIds.length === 0 || bulkUpdating}
                                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 disabled:opacity-40"
                                >
                                    批量下架
                                </AdminButton>
                                <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
                                    <AdminInput
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={bulkPrice}
                                        onChange={event => setBulkPrice(event.target.value)}
                                        placeholder="统一价格"
                                        aria-label="批量设置销售价"
                                        className="w-28 px-3 py-2 text-xs outline-none"
                                    />
                                    <AdminButton
                                        type="button"
                                        onClick={() => void handleBulkPriceChange()}
                                        disabled={
                                            selectedVariantIds.length === 0 ||
                                            bulkUpdating ||
                                            !bulkPrice.trim()
                                        }
                                        className="border-l border-slate-300 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-40"
                                    >
                                        批量调价
                                    </AdminButton>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 p-4 md:hidden">
                            <AdminMobileSort
                                fields={INVENTORY_MOBILE_SORT_FIELDS}
                                sortField={sortField}
                                sortDirection={sortDirection}
                                onSort={(field, direction) =>
                                    changeSort(field as InventorySortField, direction)
                                }
                            />
                            <label className="flex min-h-11 items-center gap-2 text-sm">
                                <AdminInput
                                    type="checkbox"
                                    aria-label="手机选择当前页全部 SKU"
                                    checked={
                                        variants.length > 0 &&
                                        variants.every(variant => selectedVariantIds.includes(variant.id))
                                    }
                                    onChange={event =>
                                        setSelectedVariantIds(
                                            event.target.checked ? variants.map(variant => variant.id) : [],
                                        )
                                    }
                                />
                                全选本页
                            </label>
                        </div>
                        {variants.length === 0 ? (
                            <div className="p-16 text-center text-xs text-slate-400">当前条件下没有 SKU</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="admin-mobile-record-table w-full min-w-[1380px] border-collapse text-left text-xs">
                                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                        <tr>
                                            <th
                                                scope="col"
                                                className="sticky left-0 z-20 w-12 bg-slate-50 px-3 py-3"
                                            >
                                                <AdminInput
                                                    type="checkbox"
                                                    checked={
                                                        variants.length > 0 &&
                                                        variants.every(variant =>
                                                            selectedVariantIds.includes(variant.id),
                                                        )
                                                    }
                                                    onChange={event =>
                                                        setSelectedVariantIds(
                                                            event.target.checked
                                                                ? variants.map(variant => variant.id)
                                                                : [],
                                                        )
                                                    }
                                                    aria-label="选择当前页全部 SKU"
                                                />
                                            </th>
                                            <th
                                                scope="col"
                                                className="sticky left-12 z-20 w-56 whitespace-nowrap bg-slate-50 px-3 py-3"
                                            >
                                                商品名称
                                            </th>
                                            <SortableTableHeader
                                                label="规格名称"
                                                sortField="name"
                                                activeSortField={sortField}
                                                sortDirection={sortDirection}
                                                onSort={changeSort}
                                                className="w-56 whitespace-nowrap px-3 py-3"
                                            />
                                            <SortableTableHeader
                                                label="SKU"
                                                sortField="sku"
                                                activeSortField={sortField}
                                                sortDirection={sortDirection}
                                                onSort={changeSort}
                                                className="w-44 whitespace-nowrap px-3 py-3"
                                            />
                                            <SortableTableHeader
                                                label="当前店铺价格"
                                                sortField="price"
                                                activeSortField={sortField}
                                                sortDirection={sortDirection}
                                                onSort={changeSort}
                                                initialDirection="DESC"
                                                className="w-36 whitespace-nowrap px-3 py-3"
                                            />
                                            <SortableTableHeader
                                                label="在手"
                                                sortField="stockOnHand"
                                                activeSortField={sortField}
                                                sortDirection={sortDirection}
                                                onSort={changeSort}
                                                initialDirection="DESC"
                                                className="w-24 whitespace-nowrap px-3 py-3"
                                            />
                                            <SortableTableHeader
                                                label="锁定"
                                                sortField="stockAllocated"
                                                activeSortField={sortField}
                                                sortDirection={sortDirection}
                                                onSort={changeSort}
                                                initialDirection="DESC"
                                                className="w-24 whitespace-nowrap px-3 py-3"
                                            />
                                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                状态
                                            </th>
                                            <th
                                                scope="col"
                                                className="sticky right-0 z-20 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                            >
                                                操作
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {variants.map(variant => {
                                            const onHand = variant.stockLevels.reduce(
                                                (total, level) => total + level.stockOnHand,
                                                0,
                                            );
                                            const allocated = variant.stockLevels.reduce(
                                                (total, level) => total + level.stockAllocated,
                                                0,
                                            );
                                            return (
                                                <tr
                                                    key={variant.id}
                                                    className="group h-[52px] hover:bg-slate-50"
                                                >
                                                    <td
                                                        data-label="选择"
                                                        className="sticky left-0 z-10 h-[52px] bg-white px-3 py-0 group-hover:bg-slate-50"
                                                    >
                                                        <AdminInput
                                                            type="checkbox"
                                                            checked={selectedVariantIds.includes(variant.id)}
                                                            onChange={event =>
                                                                setSelectedVariantIds(previous =>
                                                                    event.target.checked
                                                                        ? [
                                                                              ...new Set([
                                                                                  ...previous,
                                                                                  variant.id,
                                                                              ]),
                                                                          ]
                                                                        : previous.filter(
                                                                              id => id !== variant.id,
                                                                          ),
                                                                )
                                                            }
                                                            aria-label={`选择 SKU ${variant.sku}`}
                                                        />
                                                    </td>
                                                    <td
                                                        data-label="商品名称"
                                                        className="sticky left-12 z-10 h-[52px] max-w-56 bg-white px-3 py-0 group-hover:bg-slate-50"
                                                    >
                                                        <span
                                                            className="block truncate font-bold text-slate-900"
                                                            title={variant.product.name}
                                                        >
                                                            {variant.product.name}
                                                        </span>
                                                    </td>
                                                    <td
                                                        data-label="规格名称"
                                                        className="h-[52px] max-w-56 px-3 py-0"
                                                    >
                                                        <span
                                                            className="block truncate text-slate-500"
                                                            title={variant.name}
                                                        >
                                                            {variant.name}
                                                        </span>
                                                    </td>
                                                    <td
                                                        data-label="SKU"
                                                        className="h-[52px] max-w-44 px-3 py-0 font-mono font-bold text-slate-700"
                                                    >
                                                        <span className="block truncate" title={variant.sku}>
                                                            {variant.sku}
                                                        </span>
                                                    </td>
                                                    <td
                                                        data-label="当前店铺价格"
                                                        className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold text-slate-900"
                                                    >
                                                        {formatMoney(variant.price, variant.currencyCode)}
                                                    </td>
                                                    <td
                                                        data-label="在手"
                                                        className="h-[52px] whitespace-nowrap px-3 py-0 font-mono font-bold text-slate-900"
                                                    >
                                                        {onHand}
                                                    </td>
                                                    <td
                                                        data-label="锁定"
                                                        className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-amber-600"
                                                    >
                                                        {allocated}
                                                    </td>
                                                    <td
                                                        data-label="状态"
                                                        className="h-[52px] whitespace-nowrap px-3 py-0"
                                                    >
                                                        {variant.enabled ? (
                                                            <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                                                                销售中
                                                            </span>
                                                        ) : (
                                                            <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-600">
                                                                已下架
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td
                                                        data-label="操作"
                                                        className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50"
                                                    >
                                                        <AdminButton
                                                            type="button"
                                                            onClick={() =>
                                                                navigate(
                                                                    `/catalog/products/${variant.product.id}?tab=variants`,
                                                                    {
                                                                        state: {
                                                                            returnTo: `${location.pathname}${location.search}`,
                                                                        },
                                                                    },
                                                                )
                                                            }
                                                            className="whitespace-nowrap rounded bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                                        >
                                                            编辑商品
                                                        </AdminButton>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <InventoryPagination
                            loading={pageLoading}
                            pageSize={pageSize}
                            onPageSizeChange={size => {
                                setPageSize(size);
                                setSelectedVariantIds([]);
                            }}
                            page={page}
                            totalPages={totalPages}
                            totalItems={totalVariants}
                            onPageChange={changePage}
                        />
                    </div>
                ) : activeTab === 'ALL' ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/50 p-4">
                            <div className="relative w-full sm:w-72">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <AdminInput
                                    value={searchTerm}
                                    onChange={event => {
                                        setSearchTerm(event.target.value);
                                        setPage(0);
                                    }}
                                    aria-label="搜索库存总览"
                                    placeholder="按 SKU / 规格名称搜索"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-4 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div className="text-xs text-slate-500">
                                当前页{' '}
                                <strong className="font-mono text-slate-700">
                                    {stockSkuSummaries.length}
                                </strong>{' '}
                                个 SKU · 展开查看各仓库库存
                            </div>
                        </div>
                        <InventoryStockOverview
                            items={stockSkuSummaries}
                            expandedSkuIds={expandedStockSkuIds}
                            onToggle={variantId =>
                                setExpandedStockSkuIds(current => {
                                    const next = new Set(current);
                                    if (next.has(variantId)) next.delete(variantId);
                                    else next.add(variantId);
                                    return next;
                                })
                            }
                            sortField={sortField}
                            sortDirection={sortDirection}
                            onSort={changeSort}
                            onAdjust={stock => {
                                setSelectedStock(stock);
                                setAdjustAmount('');
                                setAdjustReason('');
                                setActionError('');
                            }}
                        />
                        <InventoryPagination
                            loading={pageLoading}
                            pageSize={pageSize}
                            onPageSizeChange={size => {
                                setPageSize(size);
                                setSelectedVariantIds([]);
                            }}
                            page={page}
                            totalPages={totalPages}
                            totalItems={totalVariants}
                            onPageChange={changePage}
                        />
                    </div>
                ) : ['LOW_STOCK', 'OUT_OF_STOCK'].includes(activeTab) ? (
                    <InventoryAlertPanel
                        items={alertItems}
                        loading={alertQuery.loading}
                        searchTerm={searchTerm}
                        onSearchChange={value => {
                            setSearchTerm(value);
                            setPage(0);
                        }}
                        defaultThreshold={defaultReplenishmentThreshold}
                        expandedSkuIds={expandedAlertSkuIds}
                        onToggle={toggleAlertSku}
                        thresholdDrafts={thresholdDrafts}
                        onThresholdDraftChange={(key, value) =>
                            setThresholdDrafts(current => ({ ...current, [key]: value }))
                        }
                        savingThresholdKey={savingThresholdKey}
                        onThresholdSave={(item, level, useDefault) =>
                            void handleThresholdSave(item, level, useDefault)
                        }
                        onAdjust={(item, level) => {
                            setSelectedStock({
                                id: `${level.productVariantId}:${level.stockLocationId}`,
                                variantId: level.productVariantId,
                                locationId: level.stockLocationId,
                                productName: item.productName,
                                variantName: item.variantName,
                                sku: item.sku,
                                warehouse: level.stockLocationName,
                                stockOnHand: level.stockOnHand,
                                stockAllocated: level.stockAllocated,
                                stockAvailable: level.stockAvailable,
                                safetyThreshold: level.replenishmentThreshold,
                                status: level.status,
                            });
                            setAdjustAmount('');
                            setAdjustReason('');
                            setActionError('');
                        }}
                        onEditProduct={item =>
                            navigate(`/catalog/products/${item.productId}?tab=variants`, {
                                state: { returnTo: `${location.pathname}${location.search}` },
                            })
                        }
                    />
                ) : activeTab === 'LOTS' ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="border-b border-amber-100 bg-amber-50 p-3 text-[11px] text-amber-800">
                            按商品分页读取当前店铺的真实批次；保存数量时后端会同步生成库存调整流水。
                        </div>
                        {lotRows.length === 0 ? (
                            <div className="space-y-3 p-16 text-center text-xs text-slate-400">
                                <CalendarClock className="mx-auto h-10 w-10 text-slate-300" />
                                <p>当前页还没有库存批次</p>
                                <AdminButton
                                    type="button"
                                    onClick={openNewLot}
                                    disabled={!lotVariants.some(variant => variant.stockLevels.length > 0)}
                                    className="font-bold text-blue-600 disabled:text-slate-300"
                                >
                                    为当前页 SKU 创建第一个批次
                                </AdminButton>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="admin-mobile-record-table w-full min-w-[1260px] border-collapse text-left text-xs">
                                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                        <tr>
                                            {[
                                                '商品',
                                                'SKU',
                                                '库存点',
                                                '批次号',
                                                '生产日期',
                                                '到期日期',
                                                '数量',
                                                '批次成本',
                                                '状态',
                                                '操作',
                                            ].map(label => (
                                                <th
                                                    key={label}
                                                    scope="col"
                                                    className="whitespace-nowrap px-3 py-3"
                                                >
                                                    {label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {lotRows.map(lot => (
                                            <tr key={lot.id} className="h-[52px] hover:bg-slate-50">
                                                <td
                                                    data-label="商品"
                                                    className="max-w-56 px-3 py-0 font-bold text-slate-900"
                                                >
                                                    <span className="block truncate" title={lot.productName}>
                                                        {lot.productName}
                                                    </span>
                                                </td>
                                                <td
                                                    data-label="SKU"
                                                    className="max-w-44 px-3 py-0 font-mono text-[10px]"
                                                >
                                                    <span className="block truncate" title={lot.sku}>
                                                        {lot.sku}
                                                    </span>
                                                </td>
                                                <td
                                                    data-label="库存点"
                                                    className="whitespace-nowrap px-3 py-0"
                                                >
                                                    {lot.stockLocationName}
                                                </td>
                                                <td
                                                    data-label="批次号"
                                                    className="whitespace-nowrap px-3 py-0 font-mono font-bold"
                                                >
                                                    {lot.lotCode}
                                                </td>
                                                <td
                                                    data-label="生产日期"
                                                    className="whitespace-nowrap px-3 py-0"
                                                >
                                                    {formatDate(lot.manufacturedAt)}
                                                </td>
                                                <td
                                                    data-label="到期日期"
                                                    className="whitespace-nowrap px-3 py-0"
                                                >
                                                    {formatDate(lot.expiresAt)}
                                                </td>
                                                <td
                                                    data-label="数量"
                                                    className="px-3 py-0 font-mono font-bold"
                                                >
                                                    {lot.quantityOnHand}
                                                </td>
                                                <td
                                                    data-label="批次成本"
                                                    className="whitespace-nowrap px-3 py-0 font-mono"
                                                >
                                                    {lot.purchaseCostMicrounits == null
                                                        ? '—'
                                                        : `${lot.currencyCode} ${(lot.purchaseCostMicrounits / 1_000).toFixed(3)}`}
                                                </td>
                                                <td data-label="状态" className="whitespace-nowrap px-3 py-0">
                                                    {systemStatusDisplayLabel(lot.state)}
                                                </td>
                                                <td data-label="操作" className="whitespace-nowrap px-3 py-0">
                                                    <AdminButton
                                                        type="button"
                                                        onClick={() =>
                                                            setLotDraft({
                                                                id: lot.id,
                                                                productVariantId: lot.variantId,
                                                                stockLocationId: lot.stockLocationId,
                                                                lotCode: lot.lotCode,
                                                                manufacturedAt: inputDate(lot.manufacturedAt),
                                                                expiresAt: inputDate(lot.expiresAt),
                                                                quantityOnHand: String(lot.quantityOnHand),
                                                                purchaseCost:
                                                                    lot.purchaseCostMicrounits == null
                                                                        ? ''
                                                                        : (
                                                                              lot.purchaseCostMicrounits /
                                                                              1_000
                                                                          ).toFixed(3),
                                                                reason: '',
                                                            })
                                                        }
                                                        className="mr-3 font-bold text-blue-600 hover:underline"
                                                    >
                                                        编辑
                                                    </AdminButton>
                                                    <AdminButton
                                                        type="button"
                                                        disabled={
                                                            lot.quantityOnHand <= 0 || locations.length < 2
                                                        }
                                                        onClick={() =>
                                                            setLotTransferDraft({
                                                                inventoryLotId: lot.id,
                                                                sku: lot.sku,
                                                                lotCode: lot.lotCode,
                                                                sourceLocationId: lot.stockLocationId,
                                                                targetStockLocationId:
                                                                    locations.find(
                                                                        location =>
                                                                            location.id !==
                                                                            lot.stockLocationId,
                                                                    )?.id ?? '',
                                                                quantity: '1',
                                                                maximumQuantity: lot.quantityOnHand,
                                                                reason: '',
                                                            })
                                                        }
                                                        className="mr-3 font-bold text-blue-600 hover:underline disabled:text-slate-300"
                                                    >
                                                        转仓
                                                    </AdminButton>
                                                    <AdminButton
                                                        type="button"
                                                        onClick={() =>
                                                            navigate(
                                                                `/catalog/products/${lot.productId}?tab=variants`,
                                                                {
                                                                    state: {
                                                                        returnTo: `${location.pathname}${location.search}`,
                                                                    },
                                                                },
                                                            )
                                                        }
                                                        className="font-bold text-slate-500 hover:underline"
                                                    >
                                                        商品详情
                                                    </AdminButton>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <InventoryPagination
                            loading={pageLoading}
                            pageSize={pageSize}
                            onPageSizeChange={size => {
                                setPageSize(size);
                                setSelectedVariantIds([]);
                            }}
                            page={page}
                            totalPages={lotTotalPages}
                            totalItems={lotTotalVariants}
                            itemLabel="个 SKU"
                            onPageChange={changePage}
                        />
                    </div>
                ) : activeTab === 'MOVEMENTS_LOG' ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="border-b border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-700">
                            Vendure
                            原生库存流水保存变动类型、数量和时间，不包含人工备注、操作人或库存点字段；本页显示当前商品页中每个
                            SKU 最近 20 条，不会伪造缺失信息。
                        </div>
                        {movementLogs.length === 0 ? (
                            <div className="p-16 text-center text-xs text-slate-400">
                                当前页暂无库存变动流水
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="admin-mobile-record-table w-full min-w-[920px] border-collapse text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
                                            <th scope="col" className="w-32 whitespace-nowrap px-3 py-3">
                                                类型
                                            </th>
                                            <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                数量
                                            </th>
                                            <th scope="col" className="w-64 whitespace-nowrap px-3 py-3">
                                                名称
                                            </th>
                                            <th scope="col" className="w-48 whitespace-nowrap px-3 py-3">
                                                SKU
                                            </th>
                                            <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                时间
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {movementLogs.map(log => (
                                            <tr
                                                key={log.variantId + ':' + log.id}
                                                className="h-[52px] hover:bg-slate-50/80"
                                            >
                                                <td
                                                    data-label="类型"
                                                    className="h-[52px] whitespace-nowrap px-3 py-0"
                                                >
                                                    <span className="flex w-max items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-700">
                                                        {log.quantity >= 0 ? (
                                                            <ArrowDownRight className="h-3.5 w-3.5" />
                                                        ) : (
                                                            <ArrowUpRight className="h-3.5 w-3.5" />
                                                        )}
                                                        {movementLabels[log.type]}
                                                    </span>
                                                </td>
                                                <td
                                                    data-label="数量"
                                                    className={
                                                        'h-[52px] whitespace-nowrap px-3 py-0 font-mono text-xs font-bold ' +
                                                        (log.quantity >= 0
                                                            ? 'text-emerald-600'
                                                            : 'text-rose-600')
                                                    }
                                                >
                                                    {log.quantity > 0 ? '+' + log.quantity : log.quantity}
                                                </td>
                                                <td data-label="名称" className="h-[52px] max-w-64 px-3 py-0">
                                                    <span
                                                        className="block truncate font-bold text-slate-900"
                                                        title={log.productName}
                                                    >
                                                        {log.productName}
                                                    </span>
                                                </td>
                                                <td
                                                    data-label="SKU"
                                                    className="h-[52px] max-w-48 px-3 py-0 font-mono text-[10px] text-slate-500"
                                                >
                                                    <span className="block truncate" title={log.sku}>
                                                        {log.sku}
                                                    </span>
                                                </td>
                                                <td
                                                    data-label="时间"
                                                    className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500"
                                                >
                                                    {formatDateTime(log.createdAt)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <InventoryPagination
                            loading={pageLoading}
                            pageSize={pageSize}
                            onPageSizeChange={size => {
                                setPageSize(size);
                                setSelectedVariantIds([]);
                            }}
                            page={page}
                            totalPages={totalPages}
                            totalItems={totalVariants}
                            onPageChange={changePage}
                        />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {locations.map(location => {
                            const skuCount = stockList.filter(
                                stock => stock.locationId === location.id,
                            ).length;
                            return (
                                <div
                                    key={location.id}
                                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
                                >
                                    <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                                        <div className="flex items-start gap-3">
                                            <AdminInput
                                                type="checkbox"
                                                checked={selectedLocationIds.includes(location.id)}
                                                onChange={() =>
                                                    setSelectedLocationIds(current =>
                                                        current.includes(location.id)
                                                            ? current.filter(id => id !== location.id)
                                                            : [...current, location.id],
                                                    )
                                                }
                                                aria-label={`选择库存点 ${location.name}`}
                                            />
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900">
                                                    {location.name}
                                                </h3>
                                                <div className="font-mono text-[10px] text-slate-400">
                                                    ID: {location.id}
                                                </div>
                                            </div>
                                        </div>
                                        <AdminButton
                                            type="button"
                                            onClick={() => openLocationModal(location)}
                                            className="p-1.5 text-slate-400 hover:text-blue-600"
                                            aria-label={'编辑库存点 ' + location.name}
                                        >
                                            <Edit3 className="h-4 w-4" />
                                        </AdminButton>
                                    </div>
                                    <div className="text-xs leading-5 text-slate-600">
                                        {location.description || '未填写库存点说明'}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        关联 <strong className="font-mono text-slate-900">{skuCount}</strong>{' '}
                                        条 SKU 库存记录
                                    </div>
                                </div>
                            );
                        })}
                        {locations.length === 0 && (
                            <div className="col-span-full rounded-xl border border-slate-200 bg-white p-16 text-center text-xs text-slate-400">
                                尚未创建任何库存点
                            </div>
                        )}
                    </div>
                )}
            </div>

            {selectedStock && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs"
                    onClick={closeStockAdjustment}
                >
                    <AccessibleDialogSurface
                        accessibleName="库存操作"
                        onRequestClose={closeStockAdjustment}
                        className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                实物库存盘点调整
                                <FeatureHelpButton topic="catalog.inventory" title="实物库存盘点调整" />
                            </h3>
                            <AdminButton
                                type="button"
                                onClick={closeStockAdjustment}
                                disabled={adjusting}
                                className="text-slate-400"
                                aria-label="关闭库存调整"
                            >
                                <X className="h-5 w-5" />
                            </AdminButton>
                        </div>
                        <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                            <div>
                                <strong>商品：</strong>
                                {selectedStock.productName}
                            </div>
                            <div>
                                <strong>SKU：</strong>
                                <span className="font-mono">{selectedStock.sku}</span>
                            </div>
                            <div>
                                <strong>库存点：</strong>
                                {selectedStock.warehouse}
                            </div>
                            <div>
                                <strong>当前在手：</strong>
                                <span className="font-mono text-sm font-bold">
                                    {selectedStock.stockOnHand}
                                </span>
                            </div>
                        </div>
                        <AdminField
                            label={<span className="mb-1 block font-bold text-slate-700">调整增量 *</span>}
                            description={
                                <>
                                    <p className="mt-1 text-[10px] text-slate-400">
                                        保存后会记录调整前后数量、操作人、时间和原因。
                                    </p>
                                </>
                            }
                        >
                            <AdminInput
                                type="number"
                                value={adjustAmount}
                                onChange={event => setAdjustAmount(event.target.value)}
                                placeholder="正数入库，负数出库"
                                className="w-full rounded-lg border border-slate-300 p-2.5 font-mono font-bold outline-none focus:ring-1 focus:ring-blue-500"
                                autoFocus
                            />
                        </AdminField>
                        <AdminField
                            label={<span className="mb-1 block font-bold text-slate-700">调整原因 *</span>}
                        >
                            <AdminInput
                                type="text"
                                value={adjustReason}
                                onChange={event => setAdjustReason(event.target.value)}
                                placeholder="例如：月底盘点差异、破损报废"
                                className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </AdminField>
                        {actionError && (
                            <div className="rounded-lg bg-rose-50 p-3 text-rose-700">{actionError}</div>
                        )}
                        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                            <AdminButton
                                type="button"
                                onClick={closeStockAdjustment}
                                disabled={adjusting}
                                className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700"
                            >
                                取消
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={handleAdjustSubmit}
                                disabled={adjusting}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                            >
                                {adjusting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}确认调整
                            </AdminButton>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}

            {isLocationModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs"
                    onClick={closeLocationModal}
                >
                    <AccessibleDialogSurface
                        accessibleName="库存点编辑"
                        onRequestClose={closeLocationModal}
                        className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-slate-900">
                                {editingLocation ? '编辑库存点' : '新增库存点'}
                            </h3>
                            <AdminButton
                                type="button"
                                onClick={closeLocationModal}
                                disabled={savingLocation}
                                className="text-slate-400"
                                aria-label="关闭库存点编辑"
                            >
                                <X className="h-5 w-5" />
                            </AdminButton>
                        </div>
                        <AdminField
                            label={<span className="mb-1 block font-bold text-slate-700">库存点名称 *</span>}
                        >
                            <AdminInput
                                value={locationName}
                                onChange={event => setLocationName(event.target.value)}
                                className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                                autoFocus
                            />
                        </AdminField>
                        <div>
                            <label className="mb-1 block font-bold text-slate-700">说明</label>
                            <AdminTextArea
                                value={locationDescription}
                                onChange={event => setLocationDescription(event.target.value)}
                                rows={3}
                                placeholder="可填写地址、用途、负责人等运营说明"
                                className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        {editingLocation &&
                            stockList.some(stock => stock.locationId === editingLocation.id) &&
                            locations.length > 1 && (
                                <AdminField
                                    label={
                                        <span className="mb-1 block font-bold text-slate-700">
                                            删除时库存迁移至
                                        </span>
                                    }
                                >
                                    <AdminSelect
                                        value={transferToLocationId}
                                        onChange={event => setTransferToLocationId(event.target.value)}
                                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
                                    >
                                        <option value="">请选择迁移目标</option>
                                        {locations
                                            .filter(location => location.id !== editingLocation.id)
                                            .map(location => (
                                                <option key={location.id} value={location.id}>
                                                    {location.name}
                                                </option>
                                            ))}
                                    </AdminSelect>
                                </AdminField>
                            )}
                        {actionError && (
                            <div className="rounded-lg bg-rose-50 p-3 text-rose-700">{actionError}</div>
                        )}
                        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                            {editingLocation ? (
                                <AdminButton
                                    type="button"
                                    onClick={handleDeleteLocation}
                                    disabled={savingLocation}
                                    className="flex items-center gap-1 rounded-lg px-3 py-2 font-bold text-rose-600 hover:bg-rose-50"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    删除库存点
                                </AdminButton>
                            ) : (
                                <span />
                            )}
                            <div className="flex gap-2">
                                <AdminButton
                                    type="button"
                                    onClick={closeLocationModal}
                                    disabled={savingLocation}
                                    className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700"
                                >
                                    取消
                                </AdminButton>
                                <AdminButton
                                    type="button"
                                    onClick={handleSaveLocation}
                                    disabled={savingLocation}
                                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                                >
                                    {savingLocation && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}保存
                                </AdminButton>
                            </div>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}

            {lotDraft && (
                <InventoryLotDialog
                    draft={lotDraft}
                    variants={lotVariants}
                    saving={saveInventoryLotState.loading}
                    error={actionError}
                    onChange={setLotDraft}
                    onClose={() => {
                        if (saveInventoryLotState.loading) return;
                        setLotDraft(null);
                        setActionError('');
                    }}
                    onSave={() => void saveLot()}
                />
            )}
            {lotTransferDraft && (
                <InventoryLotTransferDialog
                    draft={lotTransferDraft}
                    locations={locations}
                    saving={transferInventoryLotState.loading}
                    error={actionError}
                    onChange={setLotTransferDraft}
                    onClose={() => {
                        if (transferInventoryLotState.loading) return;
                        setLotTransferDraft(null);
                        setActionError('');
                    }}
                    onSave={() => void saveLotTransfer()}
                />
            )}
        </div>
    );
}

export function InventoryStockOverview({
    items,
    expandedSkuIds,
    onToggle,
    sortField,
    sortDirection,
    onSort,
    onAdjust,
}: {
    items: InventorySkuSummary[];
    expandedSkuIds: Set<string>;
    onToggle: (variantId: string) => void;
    sortField: InventorySortField;
    sortDirection: SortDirection;
    onSort: (field: InventorySortField, initialDirection?: SortDirection) => void;
    onAdjust: (stock: StockRow) => void;
}) {
    const products = new Map<string, { name: string; items: InventorySkuSummary[] }>();
    for (const item of items) {
        const product = products.get(item.productId) ?? { name: item.productName, items: [] };
        product.items.push(item);
        products.set(item.productId, product);
    }
    if (!items.length) {
        return (
            <div className="space-y-2 p-12 text-center text-xs text-slate-400">
                <Boxes className="mx-auto h-10 w-10 text-slate-300" />
                <p>当前筛选条件下暂无 SKU</p>
            </div>
        );
    }
    return (
        <div className="overflow-x-auto">
            <div className="p-4 md:hidden">
                <AdminMobileSort
                    fields={INVENTORY_MOBILE_SORT_FIELDS.filter(field => field.value !== 'price')}
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={(field, direction) => onSort(field as InventorySortField, direction)}
                />
            </div>
            <table
                aria-label="SKU 库存总览"
                className="admin-mobile-record-table w-full min-w-[880px] border-collapse text-left text-xs"
            >
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                        <SortableTableHeader
                            label="规格"
                            sortField="name"
                            activeSortField={sortField}
                            sortDirection={sortDirection}
                            onSort={onSort}
                            className="min-w-56 px-4 py-3"
                        />
                        <SortableTableHeader
                            label="SKU"
                            sortField="sku"
                            activeSortField={sortField}
                            sortDirection={sortDirection}
                            onSort={onSort}
                            className="px-3 py-3"
                        />
                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                            库存点
                        </th>
                        <SortableTableHeader
                            label="总在手"
                            sortField="stockOnHand"
                            activeSortField={sortField}
                            sortDirection={sortDirection}
                            onSort={onSort}
                            initialDirection="DESC"
                            className="px-3 py-3"
                        />
                        <SortableTableHeader
                            label="总锁定"
                            sortField="stockAllocated"
                            activeSortField={sortField}
                            sortDirection={sortDirection}
                            onSort={onSort}
                            initialDirection="DESC"
                            className="px-3 py-3"
                        />
                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                            总可售
                        </th>
                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                            库存状态
                        </th>
                        <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">
                            仓库明细
                        </th>
                    </tr>
                </thead>
                {Array.from(products, ([productId, product]) => (
                    <tbody key={productId} className="divide-y divide-slate-100">
                        <tr className="bg-slate-50/70">
                            <th scope="rowgroup" colSpan={8} className="px-4 py-3 font-bold text-slate-900">
                                {product.name}
                                <span className="mt-1 block whitespace-nowrap font-normal text-slate-500 md:ml-3 md:mt-0 md:inline">
                                    本页 {product.items.length} 个 SKU
                                </span>
                            </th>
                        </tr>
                        {product.items.map(item => {
                            const expanded = expandedSkuIds.has(item.variantId);
                            const detailsId = `stock-sku-${item.variantId}`;
                            const hasStock = item.locations.length > 0;
                            const tracked = item.status !== 'NOT_TRACKED';
                            const variantLabel = item.variantName.startsWith(item.productName)
                                ? item.variantName
                                      .slice(item.productName.length)
                                      .replace(/^[\s·•:：/—-]+/u, '') || '默认规格'
                                : item.variantName;
                            return (
                                <Fragment key={item.variantId}>
                                    <tr className="h-14 hover:bg-slate-50">
                                        <th
                                            scope="row"
                                            data-label="规格 / 库存点"
                                            className="px-4 py-3 font-medium text-slate-800"
                                        >
                                            {variantLabel}
                                        </th>
                                        <td
                                            data-label="SKU"
                                            className="px-3 py-3 font-mono text-[11px] text-slate-600"
                                        >
                                            {item.sku}
                                        </td>
                                        <td data-label="库存点" className="px-3 py-3 text-slate-500">
                                            {item.locations.length} 个
                                        </td>
                                        <td
                                            data-label="总在手"
                                            className="px-3 py-3 font-mono font-bold text-slate-900"
                                        >
                                            {hasStock ? item.stockOnHand : '—'}
                                        </td>
                                        <td
                                            data-label="总锁定"
                                            className="px-3 py-3 font-mono text-amber-700"
                                        >
                                            {hasStock ? item.stockAllocated : '—'}
                                        </td>
                                        <td
                                            data-label="总可售"
                                            className={`px-3 py-3 font-mono font-bold ${item.stockAvailable <= 0 ? 'text-rose-700' : 'text-emerald-700'}`}
                                        >
                                            {hasStock && tracked ? item.stockAvailable : '—'}
                                        </td>
                                        <td data-label="库存状态" className="whitespace-nowrap px-3 py-3">
                                            {!tracked ? (
                                                <span className="text-slate-500">不跟踪仓库库存</span>
                                            ) : !hasStock ? (
                                                <span className="text-slate-500">未关联库存点</span>
                                            ) : (
                                                <InventoryAlertBadge
                                                    status={item.status as InventoryAlertStatus}
                                                />
                                            )}
                                        </td>
                                        <td data-label="仓库明细" className="px-4 py-3 text-right">
                                            <AdminButton
                                                type="button"
                                                onClick={() => onToggle(item.variantId)}
                                                aria-expanded={expanded}
                                                aria-controls={expanded ? detailsId : undefined}
                                                aria-label={`${expanded ? '收起' : '展开'} ${item.sku} 仓库明细`}
                                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1.5 font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500"
                                            >
                                                {expanded ? '收起' : '查看仓库'}
                                                {expanded ? (
                                                    <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                                                ) : (
                                                    <ChevronRight
                                                        aria-hidden="true"
                                                        className="h-3.5 w-3.5"
                                                    />
                                                )}
                                            </AdminButton>
                                        </td>
                                    </tr>
                                    {expanded && (
                                        <tr id={detailsId}>
                                            <td colSpan={8} className="bg-slate-50/50 px-4 py-4">
                                                {!hasStock ? (
                                                    <p className="text-slate-500">
                                                        该 SKU 尚未关联库存点，请进入商品编辑页建立库存记录。
                                                    </p>
                                                ) : (
                                                    <>
                                                        <p className="mb-3 text-[11px] text-slate-500">
                                                            {item.sku} · 以下库存和状态仅对应各仓库
                                                        </p>
                                                        <table
                                                            aria-label={`${item.sku} 仓库库存`}
                                                            className="admin-mobile-record-table w-full text-left text-[11px]"
                                                        >
                                                            <thead className="border-b border-slate-200 text-slate-500">
                                                                <tr>
                                                                    {[
                                                                        '库存点',
                                                                        '在手',
                                                                        '锁定',
                                                                        '可售',
                                                                        '补货预警值',
                                                                        '仓库状态',
                                                                        '操作',
                                                                    ].map(label => (
                                                                        <th
                                                                            scope="col"
                                                                            key={label}
                                                                            className="px-3 pb-2"
                                                                        >
                                                                            {label}
                                                                        </th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {item.locations.map(stock => (
                                                                    <tr key={stock.id} className="h-12">
                                                                        <th
                                                                            scope="row"
                                                                            data-label="规格 / 库存点"
                                                                            className="px-3 py-2 font-medium text-slate-700"
                                                                        >
                                                                            {stock.warehouse}
                                                                        </th>
                                                                        <td
                                                                            data-label="在手"
                                                                            className="px-3 py-2 font-mono"
                                                                        >
                                                                            {stock.stockOnHand}
                                                                        </td>
                                                                        <td
                                                                            data-label="锁定"
                                                                            className="px-3 py-2 font-mono text-amber-700"
                                                                        >
                                                                            {stock.stockAllocated}
                                                                        </td>
                                                                        <td
                                                                            data-label="可售"
                                                                            className="px-3 py-2 font-mono font-bold"
                                                                        >
                                                                            {tracked
                                                                                ? stock.stockAvailable
                                                                                : '—'}
                                                                        </td>
                                                                        <td
                                                                            data-label="补货预警值"
                                                                            className="px-3 py-2 font-mono text-slate-500"
                                                                        >
                                                                            {tracked
                                                                                ? stock.safetyThreshold
                                                                                : '—'}
                                                                        </td>
                                                                        <td
                                                                            data-label="仓库状态"
                                                                            className="whitespace-nowrap px-3 py-2"
                                                                        >
                                                                            {stock.status ===
                                                                            'NOT_TRACKED' ? (
                                                                                <span className="text-slate-500">
                                                                                    不跟踪仓库库存
                                                                                </span>
                                                                            ) : (
                                                                                <InventoryAlertBadge
                                                                                    status={stock.status}
                                                                                />
                                                                            )}
                                                                        </td>
                                                                        <td
                                                                            data-label="操作"
                                                                            className="px-3 py-2 text-right"
                                                                        >
                                                                            <AdminButton
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    onAdjust(stock)
                                                                                }
                                                                                aria-label={`盘点调整 ${stock.sku} ${stock.warehouse}`}
                                                                                className="whitespace-nowrap rounded bg-blue-50 px-2.5 py-1.5 font-bold text-blue-700 hover:bg-blue-100"
                                                                            >
                                                                                盘点调整
                                                                            </AdminButton>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                ))}
            </table>
        </div>
    );
}

function InventoryAlertPanel({
    items,
    loading,
    searchTerm,
    onSearchChange,
    defaultThreshold,
    expandedSkuIds,
    onToggle,
    thresholdDrafts,
    onThresholdDraftChange,
    savingThresholdKey,
    onThresholdSave,
    onAdjust,
    onEditProduct,
}: {
    items: InventoryAlertItem[];
    loading: boolean;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    defaultThreshold: number;
    expandedSkuIds: Set<string>;
    onToggle: (variantId: string) => void;
    thresholdDrafts: Record<string, string>;
    onThresholdDraftChange: (key: string, value: string) => void;
    savingThresholdKey: string | null;
    onThresholdSave: (item: InventoryAlertItem, level: InventoryAlertLocation, useDefault: boolean) => void;
    onAdjust: (item: InventoryAlertItem, level: InventoryAlertLocation) => void;
    onEditProduct: (item: InventoryAlertItem) => void;
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-3">
                <div className="bg-blue-50 p-3 text-xs text-blue-900">
                    <strong>可售库存 = 在手库存 − 已锁定库存</strong>
                    <p className="mt-1 text-[11px] text-blue-700">计算结果保留真实负数，不再显示成 0。</p>
                </div>
                <div className="bg-amber-50 p-3 text-xs text-amber-900">
                    <strong>低库存</strong>
                    <p className="mt-1 text-[11px] text-amber-700">
                        可售大于 0，且至少一个仓库达到补货预警值。
                    </p>
                </div>
                <div className="bg-rose-50 p-3 text-xs text-rose-900">
                    <strong>缺货</strong>
                    <p className="mt-1 text-[11px] text-rose-700">SKU 全仓可售合计小于或等于 0。</p>
                </div>
            </div>
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <AdminInput
                        value={searchTerm}
                        onChange={event => onSearchChange(event.target.value)}
                        aria-label="搜索全店库存预警"
                        placeholder="按商品 / 规格 / SKU 搜索全店预警..."
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
                <div className="text-xs text-slate-500">
                    按 SKU 去重，当前显示 <strong className="font-mono text-slate-900">{items.length}</strong>{' '}
                    个；未单独设置时使用默认预警值{' '}
                    <strong className="font-mono text-slate-900">{defaultThreshold}</strong>
                </div>
            </div>
            {loading && items.length === 0 ? (
                <div className="space-y-3 p-6" aria-label="正在读取全店库存预警">
                    {[1, 2, 3].map(item => (
                        <div key={item} className="h-14 animate-pulse rounded-lg bg-slate-100" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <div className="space-y-2 p-16 text-center text-xs text-slate-400">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-300" />
                    <p>当前全店没有符合条件的库存预警</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="admin-mobile-record-table w-full min-w-[1040px] border-collapse text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-500">
                            <tr>
                                <th scope="col" className="w-12 px-3 py-3" aria-label="展开仓库明细" />
                                <th scope="col" className="w-64 px-3 py-3">
                                    商品 / 规格
                                </th>
                                <th scope="col" className="w-44 px-3 py-3">
                                    SKU
                                </th>
                                <th scope="col" className="w-24 px-3 py-3">
                                    全仓在手
                                </th>
                                <th scope="col" className="w-24 px-3 py-3">
                                    全仓锁定
                                </th>
                                <th scope="col" className="w-24 px-3 py-3">
                                    全仓可售
                                </th>
                                <th scope="col" className="w-24 px-3 py-3">
                                    状态
                                </th>
                                <th scope="col" className="w-28 px-3 py-3 text-right">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        {items.map(item => {
                            const expanded = expandedSkuIds.has(item.variantId);
                            return (
                                <tbody
                                    key={item.variantId}
                                    className="border-b border-slate-100 last:border-0"
                                >
                                    <tr className="h-[58px] hover:bg-slate-50/80">
                                        <td data-label="仓库明细" className="px-3 py-0">
                                            <AdminButton
                                                type="button"
                                                onClick={() => onToggle(item.variantId)}
                                                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                                                aria-label={`${expanded ? '收起' : '展开'} ${item.sku} 的仓库明细`}
                                                aria-expanded={expanded}
                                            >
                                                {expanded ? (
                                                    <ChevronDown className="h-4 w-4" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4" />
                                                )}
                                            </AdminButton>
                                        </td>
                                        <td data-label="商品 / 规格" className="max-w-64 px-3 py-0">
                                            <span
                                                className="block truncate font-bold text-slate-900"
                                                title={item.productName}
                                            >
                                                {item.productName}
                                            </span>
                                            <span
                                                className="block truncate text-[11px] text-slate-500"
                                                title={item.variantName}
                                            >
                                                {item.variantName}
                                            </span>
                                        </td>
                                        <td
                                            data-label="SKU"
                                            className="max-w-44 px-3 py-0 font-mono text-[11px] text-slate-700"
                                        >
                                            <span className="block truncate" title={item.sku}>
                                                {item.sku}
                                            </span>
                                        </td>
                                        <td
                                            data-label="全仓在手"
                                            className="px-3 py-0 font-mono font-bold text-slate-900"
                                        >
                                            {item.stockOnHand}
                                        </td>
                                        <td
                                            data-label="全仓锁定"
                                            className="px-3 py-0 font-mono text-amber-700"
                                        >
                                            {item.stockAllocated}
                                        </td>
                                        <td
                                            data-label="全仓可售"
                                            className={`px-3 py-0 font-mono font-bold ${item.stockAvailable <= 0 ? 'text-rose-700' : 'text-amber-700'}`}
                                        >
                                            {item.stockAvailable}
                                        </td>
                                        <td data-label="状态" className="px-3 py-0">
                                            <InventoryAlertBadge status={item.status} />
                                        </td>
                                        <td data-label="操作" className="px-3 py-0 text-right">
                                            <AdminButton
                                                type="button"
                                                onClick={() => onEditProduct(item)}
                                                className="rounded bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                            >
                                                编辑商品
                                            </AdminButton>
                                        </td>
                                    </tr>
                                    {expanded && (
                                        <tr>
                                            <td colSpan={8} className="bg-slate-50/70 px-5 py-4">
                                                {item.locations.length === 0 ? (
                                                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                                                        该 SKU 尚未关联库存点，请进入商品编辑页建立库存记录。
                                                    </div>
                                                ) : (
                                                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                                        <table className="admin-mobile-record-table w-full min-w-[920px] text-left text-[11px]">
                                                            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                                                <tr>
                                                                    <th className="px-3 py-2">库存点</th>
                                                                    <th className="px-3 py-2">在手</th>
                                                                    <th className="px-3 py-2">锁定</th>
                                                                    <th className="px-3 py-2">可售</th>
                                                                    <th className="px-3 py-2">补货预警值</th>
                                                                    <th className="px-3 py-2">状态</th>
                                                                    <th className="px-3 py-2 text-right">
                                                                        操作
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {item.locations.map(level => {
                                                                    const key = `${level.productVariantId}:${level.stockLocationId}`;
                                                                    const saving = savingThresholdKey === key;
                                                                    return (
                                                                        <tr key={key} className="h-[54px]">
                                                                            <td
                                                                                data-label="库存点"
                                                                                className="px-3 py-0 font-bold text-slate-800"
                                                                            >
                                                                                {level.stockLocationName}
                                                                            </td>
                                                                            <td
                                                                                data-label="在手"
                                                                                className="px-3 py-0 font-mono"
                                                                            >
                                                                                {level.stockOnHand}
                                                                            </td>
                                                                            <td
                                                                                data-label="锁定"
                                                                                className="px-3 py-0 font-mono text-amber-700"
                                                                            >
                                                                                {level.stockAllocated}
                                                                            </td>
                                                                            <td
                                                                                data-label="可售"
                                                                                className={`px-3 py-0 font-mono font-bold ${level.stockAvailable <= 0 ? 'text-rose-700' : 'text-slate-900'}`}
                                                                            >
                                                                                {level.stockAvailable}
                                                                            </td>
                                                                            <td
                                                                                data-label="补货预警值"
                                                                                className="px-3 py-0"
                                                                            >
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <AdminInput
                                                                                        type="number"
                                                                                        min="0"
                                                                                        step="1"
                                                                                        value={
                                                                                            thresholdDrafts[
                                                                                                key
                                                                                            ] ??
                                                                                            String(
                                                                                                level.replenishmentThreshold,
                                                                                            )
                                                                                        }
                                                                                        onChange={event =>
                                                                                            onThresholdDraftChange(
                                                                                                key,
                                                                                                event.target
                                                                                                    .value,
                                                                                            )
                                                                                        }
                                                                                        disabled={saving}
                                                                                        aria-label={`${item.sku} ${level.stockLocationName} 补货预警值`}
                                                                                        className="w-20 rounded border border-slate-300 px-2 py-1 font-mono outline-none focus:ring-1 focus:ring-blue-500"
                                                                                    />
                                                                                    {level.usesDefaultThreshold && (
                                                                                        <span className="whitespace-nowrap text-[10px] text-slate-400">
                                                                                            默认
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td
                                                                                data-label="状态"
                                                                                className="px-3 py-0"
                                                                            >
                                                                                <InventoryAlertBadge
                                                                                    status={level.status}
                                                                                />
                                                                            </td>
                                                                            <td
                                                                                data-label="操作"
                                                                                className="px-3 py-0 text-right whitespace-nowrap"
                                                                            >
                                                                                <AdminButton
                                                                                    type="button"
                                                                                    disabled={saving}
                                                                                    onClick={() =>
                                                                                        onThresholdSave(
                                                                                            item,
                                                                                            level,
                                                                                            false,
                                                                                        )
                                                                                    }
                                                                                    className="mr-2 font-bold text-blue-700 disabled:opacity-40"
                                                                                >
                                                                                    {saving
                                                                                        ? '保存中…'
                                                                                        : '保存预警值'}
                                                                                </AdminButton>
                                                                                {!level.usesDefaultThreshold && (
                                                                                    <AdminButton
                                                                                        type="button"
                                                                                        disabled={saving}
                                                                                        onClick={() =>
                                                                                            onThresholdSave(
                                                                                                item,
                                                                                                level,
                                                                                                true,
                                                                                            )
                                                                                        }
                                                                                        className="mr-2 font-bold text-slate-500 disabled:opacity-40"
                                                                                    >
                                                                                        恢复默认{' '}
                                                                                        {defaultThreshold}
                                                                                    </AdminButton>
                                                                                )}
                                                                                <AdminButton
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                        onAdjust(item, level)
                                                                                    }
                                                                                    className="font-bold text-emerald-700"
                                                                                >
                                                                                    盘点调整
                                                                                </AdminButton>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            );
                        })}
                    </table>
                </div>
            )}
        </div>
    );
}

function InventoryAlertBadge({ status }: { status: InventoryAlertStatus }) {
    return status === 'OUT_OF_STOCK' ? (
        <span className="whitespace-nowrap rounded bg-rose-100 px-2 py-0.5 font-bold text-rose-800">
            缺货
        </span>
    ) : status === 'LOW_STOCK' ? (
        <span className="whitespace-nowrap rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
            需补货
        </span>
    ) : (
        <span className="whitespace-nowrap rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
            充足
        </span>
    );
}

function InventoryPagination({
    loading = false,
    pageSize,
    onPageSizeChange,
    page,
    totalPages,
    totalItems,
    itemLabel = '个 SKU',
    onPageChange,
}: {
    loading?: boolean;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    page: number;
    totalPages: number;
    totalItems: number;
    itemLabel?: string;
    onPageChange: (page: number) => void;
}) {
    return (
        <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span>
                共 {totalItems} {itemLabel}，第 {page + 1}/{totalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={loading} />
                <AdminButton
                    type="button"
                    disabled={loading || page === 0}
                    onClick={() => onPageChange(page - 1)}
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-4 w-4" />
                </AdminButton>
                <AdminButton
                    type="button"
                    disabled={loading || page + 1 >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                    className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-4 w-4" />
                </AdminButton>
            </div>
        </div>
    );
}

function InventoryLotTransferDialog({
    draft,
    locations,
    saving,
    error,
    onChange,
    onClose,
    onSave,
}: {
    draft: InventoryLotTransferDraft;
    locations: StockLocationItem[];
    saving: boolean;
    error?: string;
    onChange: (draft: InventoryLotTransferDraft) => void;
    onClose: () => void;
    onSave: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
            onClick={onClose}
        >
            <AccessibleDialogSurface
                accessibleName="批次转仓"
                onRequestClose={onClose}
                onClick={event => event.stopPropagation()}
                className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 text-xs shadow-2xl"
            >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-bold">
                            批次转仓
                            <FeatureHelpButton topic="catalog.inventory" title="批次转仓" />
                        </h2>
                        <p className="mt-1 text-slate-500">
                            {draft.sku} · {draft.lotCode}，最多可转 {draft.maximumQuantity}
                        </p>
                    </div>
                    <AdminButton type="button" onClick={onClose} disabled={saving} aria-label="关闭转仓">
                        <X className="h-5 w-5 text-slate-400" />
                    </AdminButton>
                </div>
                <AdminField className="block font-bold text-slate-600" label="目标仓库 *">
                    <AdminSelect
                        value={draft.targetStockLocationId}
                        onChange={event => onChange({ ...draft, targetStockLocationId: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                    >
                        {locations
                            .filter(location => location.id !== draft.sourceLocationId)
                            .map(location => (
                                <option key={location.id} value={location.id}>
                                    {location.name}
                                </option>
                            ))}
                    </AdminSelect>
                </AdminField>
                <InventoryLotField
                    label="转仓数量 *"
                    type="number"
                    value={draft.quantity}
                    onChange={quantity => onChange({ ...draft, quantity })}
                />
                <InventoryLotField
                    label="转仓原因 *"
                    value={draft.reason}
                    onChange={reason => onChange({ ...draft, reason })}
                />
                {error && (
                    <div role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">
                        {error}
                    </div>
                )}
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                    <AdminButton
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-lg bg-slate-100 px-4 py-2 font-bold"
                    >
                        取消
                    </AdminButton>
                    <AdminButton
                        type="button"
                        onClick={onSave}
                        disabled={saving || !draft.reason.trim()}
                        className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-40"
                    >
                        {saving ? '转仓中…' : '确认转仓'}
                    </AdminButton>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}

export function InventoryLotDialog({
    draft,
    variants,
    saving,
    error,
    onChange,
    onClose,
    onSave,
}: {
    draft: InventoryLotDraft;
    variants: CatalogExportRowRecord[];
    saving: boolean;
    error?: string;
    onChange: (draft: InventoryLotDraft) => void;
    onClose: () => void;
    onSave: () => void;
}) {
    const selectedVariant =
        variants.find(variant => variant.variantId === draft.productVariantId) ?? variants[0];
    const update = (patch: Partial<InventoryLotDraft>) => onChange({ ...draft, ...patch });

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
            onClick={onClose}
        >
            <AccessibleDialogSurface
                accessibleName={draft.id ? '编辑库存批次' : '新增库存批次'}
                onRequestClose={onClose}
                onClick={event => event.stopPropagation()}
                className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 text-xs shadow-2xl"
            >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">
                            {draft.id ? '编辑库存批次' : '新增库存批次'}
                        </h2>
                        <p className="mt-1 text-slate-500">数量变化会同步写入 Vendure 库存流水。</p>
                    </div>
                    <AdminButton type="button" onClick={onClose} disabled={saving} aria-label="关闭批次编辑">
                        <X className="h-5 w-5 text-slate-400" />
                    </AdminButton>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <AdminField className="font-bold text-slate-600" label="SKU *">
                        <AdminSelect
                            value={draft.productVariantId}
                            onChange={event => {
                                const next = variants.find(
                                    variant => variant.variantId === event.target.value,
                                );
                                update({
                                    productVariantId: event.target.value,
                                    stockLocationId: next?.stockLevels[0]?.stockLocationId ?? '',
                                });
                            }}
                            disabled={Boolean(draft.id)}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100"
                        >
                            {variants.map(variant => (
                                <option key={variant.variantId} value={variant.variantId}>
                                    {variant.productName} · {variant.sku}
                                </option>
                            ))}
                        </AdminSelect>
                    </AdminField>
                    <AdminField className="font-bold text-slate-600" label="库存点 *">
                        <AdminSelect
                            value={draft.stockLocationId}
                            onChange={event => update({ stockLocationId: event.target.value })}
                            disabled={Boolean(draft.id)}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100"
                        >
                            {selectedVariant?.stockLevels.map(location => (
                                <option key={location.stockLocationId} value={location.stockLocationId}>
                                    {location.stockLocationName}
                                </option>
                            ))}
                        </AdminSelect>
                    </AdminField>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:col-span-2">
                        <AdminInput
                            type="checkbox"
                            checked={draft.reconcileExistingStock ?? false}
                            onChange={event => update({ reconcileExistingStock: event.target.checked })}
                        />
                        分配现有库存（数量不变）
                        <FeatureHelpButton
                            title="批次操作"
                            content={{
                                purpose:
                                    '首次启用批次时，先分配仓库现有数量。完成分配后，新增批次入库才增加在库数量。',
                                requirements: [],
                                example: '',
                            }}
                        />
                    </label>
                    <InventoryLotField
                        label="批次号 *"
                        value={draft.lotCode}
                        onChange={lotCode => update({ lotCode })}
                    />
                    <InventoryLotField
                        label="批次数量 *"
                        type="number"
                        value={draft.quantityOnHand}
                        onChange={quantityOnHand => update({ quantityOnHand })}
                    />
                    <InventoryLotField
                        label="生产日期"
                        type="date"
                        value={draft.manufacturedAt}
                        onChange={manufacturedAt => update({ manufacturedAt })}
                    />
                    <InventoryLotField
                        label="到期日期"
                        type="date"
                        value={draft.expiresAt}
                        onChange={expiresAt => update({ expiresAt })}
                    />
                    <InventoryLotField
                        label={`批次成本 (${selectedVariant?.currencyCode ?? '当前店铺币种'})`}
                        type="number"
                        value={draft.purchaseCost}
                        onChange={purchaseCost => update({ purchaseCost })}
                    />
                    <InventoryLotField
                        label="调整原因 *"
                        value={draft.reason}
                        onChange={reason => update({ reason })}
                    />
                </div>
                {error && (
                    <div role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">
                        {error}
                    </div>
                )}
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                    <AdminButton
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700"
                    >
                        取消
                    </AdminButton>
                    <AdminButton
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-40"
                    >
                        {saving ? '保存中…' : '保存批次'}
                    </AdminButton>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}

function InventoryLotField({
    label,
    value,
    type = 'text',
    onChange,
}: {
    label: string;
    value: string;
    type?: 'text' | 'number' | 'date';
    onChange: (value: string) => void;
}) {
    return (
        <AdminField className="font-bold text-slate-600" label={label}>
            <AdminInput
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal outline-none focus:ring-1 focus:ring-blue-500"
            />
        </AdminField>
    );
}

function formatDate(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
}

function inputDate(value: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
