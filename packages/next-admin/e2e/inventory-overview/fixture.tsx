import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { InventoryWarehouseModule } from '../../src/pages/Catalog/InventoryWarehouseModule';

// Local browser sample: all inventory responses and adjustments are held in memory.
// No production API or database is accessed.
const params = new URLSearchParams(location.search);
const warehouses = ['测试仓库 A', '测试仓库 B', '测试仓库 C'].map((name, index) => ({
    id: `warehouse-${index + 1}`,
    name,
    description: '本地验收仓库',
}));
const variants = Array.from({ length: params.has('empty') ? 0 : 26 }, (_, index) => {
    const productName =
        index < 2
            ? 'HelloSleep 十二英寸弹簧床垫（样本）'
            : index < 5
              ? 'POLARE Reserve 十英寸床垫（样本）'
              : `验收商品 ${index - 4}`;
    const size = index === 0 || index === 3 ? 'Queen' : index === 1 || index === 4 ? 'King' : 'Super Single';
    return {
        id: `variant-${index + 1}`,
        product: {
            id: index < 2 ? 'mattress-1' : index < 5 ? 'mattress-2' : `product-${index}`,
            name: productName,
        },
        name: `${productName} · 尺寸:${size}`,
        sku:
            index === 0
                ? 'HS-12INC-0512'
                : index === 1
                  ? 'HS-12INC-0612'
                  : `SAMPLE-${String(index + 1).padStart(3, '0')}`,
        enabled: true,
        price: 10000,
        currencyCode: 'MYR',
        trackInventory: index === 24 ? 'FALSE' : 'TRUE',
        outOfStockThreshold: 0,
        useGlobalOutOfStockThreshold: true,
        stockLevels:
            index === 25
                ? []
                : (index < 5 ? warehouses : warehouses.slice(2)).map((stockLocation, position) => ({
                      id: `stock-${index}-${position}`,
                      stockLocationId: stockLocation.id,
                      stockLocation,
                      stockOnHand: index < 5 && position < 2 ? 0 : index === 5 ? 0 : 100,
                      stockAllocated: index === 0 && position === 2 ? 7 : 0,
                  })),
        stockMovements: { items: [], totalItems: 0 },
    };
});
const alertOverview = () => {
    const items = variants
        .filter(variant => variant.trackInventory !== 'FALSE')
        .map(variant => {
            const locations = variant.stockLevels.map(level => ({
                productVariantId: variant.id,
                stockLocationId: level.stockLocationId,
                stockLocationName: level.stockLocation.name,
                stockOnHand: level.stockOnHand,
                stockAllocated: level.stockAllocated,
                stockAvailable: level.stockOnHand - level.stockAllocated,
                replenishmentThreshold: 5,
                usesDefaultThreshold: true,
                status:
                    level.stockOnHand - level.stockAllocated <= 0
                        ? 'OUT_OF_STOCK'
                        : level.stockOnHand - level.stockAllocated <= 5
                          ? 'LOW_STOCK'
                          : 'NORMAL',
            }));
            const stockOnHand = locations.reduce((sum, level) => sum + level.stockOnHand, 0);
            const stockAllocated = locations.reduce((sum, level) => sum + level.stockAllocated, 0);
            const stockAvailable = stockOnHand - stockAllocated;
            return {
                productId: variant.product.id,
                productName: variant.product.name,
                variantId: variant.id,
                variantName: variant.name,
                sku: variant.sku,
                stockOnHand,
                stockAllocated,
                stockAvailable,
                locations,
                status:
                    stockAvailable <= 0
                        ? 'OUT_OF_STOCK'
                        : locations.some(level => level.status !== 'NORMAL')
                          ? 'LOW_STOCK'
                          : 'NORMAL',
            };
        });
    return {
        defaultReplenishmentThreshold: 5,
        lowStockSkuCount: items.filter(item => item.status === 'LOW_STOCK').length,
        outOfStockSkuCount: items.filter(item => item.status === 'OUT_OF_STOCK').length,
        items,
    };
};
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const timer = window.setTimeout(() => {
                    if (params.has('error')) {
                        observer.error(new Error('本地模拟：库存读取失败'));
                        return;
                    }
                    let data: Record<string, unknown>;
                    if (operation.operationName === 'GetInventoryOverview') {
                        const options = operation.variables.variantOptions ?? {};
                        const search = options.filter?._or?.[0]?.sku?.contains?.toLowerCase() ?? '';
                        const matched = variants.filter(
                            variant =>
                                !search ||
                                [variant.sku, variant.name].some(value =>
                                    value.toLowerCase().includes(search),
                                ),
                        );
                        const [sortField, direction] = Object.entries(
                            options.sort ?? { updatedAt: 'DESC' },
                        )[0];
                        const numericValue = (variant: (typeof variants)[number]) =>
                            variant.stockLevels.reduce(
                                (sum, level) =>
                                    sum +
                                    (sortField === 'stockAllocated'
                                        ? level.stockAllocated
                                        : level.stockOnHand),
                                0,
                            );
                        matched.sort((left, right) => {
                            const order =
                                sortField === 'name' || sortField === 'sku'
                                    ? left[sortField].localeCompare(right[sortField])
                                    : sortField === 'stockOnHand' || sortField === 'stockAllocated'
                                      ? numericValue(left) - numericValue(right)
                                      : 0;
                            return direction === 'DESC' ? -order : order;
                        });
                        data = {
                            productVariants: {
                                items: matched.slice(
                                    options.skip ?? 0,
                                    (options.skip ?? 0) + (options.take ?? 20),
                                ),
                                totalItems: matched.length,
                            },
                            globalSettings: { outOfStockThreshold: 0, trackInventory: true },
                        };
                    } else if (operation.operationName === 'GetStockLocations') {
                        data = { stockLocations: { items: warehouses, totalItems: warehouses.length } };
                    } else if (operation.operationName === 'NextAdminCatalogInventoryAlertOverview') {
                        data = { catalogInventoryAlertOverview: alertOverview() };
                    } else if (operation.operationName === 'NextAdminAdjustCatalogLegacyInventory') {
                        const input = operation.variables.input;
                        const stock = variants
                            .find(variant => variant.id === input.productVariantId)
                            ?.stockLevels.find(level => level.stockLocationId === input.stockLocationId);
                        if (!stock) {
                            observer.error(new Error('本地样本没有对应仓库库存'));
                            return;
                        }
                        stock.stockOnHand = input.stockOnHand;
                        data = {
                            adjustCatalogLegacyInventory: {
                                id: 'local-adjustment',
                                code: 'LOCAL-ONLY',
                                reason: input.reason,
                                postedAt: '2026-10-02T00:00:00.000Z',
                            },
                        };
                    } else {
                        observer.error(new Error(`Unexpected local operation: ${operation.operationName}`));
                        return;
                    }
                    observer.next({ data: structuredClone(data) });
                    observer.complete();
                }, 80);
                return () => window.clearTimeout(timer);
            }),
    ),
});
createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <BrowserRouter>
            <ConfirmDialogContext.Provider value={async () => false}>
                <FeatureHelpProvider>
                    <div className="bg-blue-50 px-5 py-2 text-xs text-blue-800">
                        本地验收样本 · 实际库存管理组件 · 数据和盘点仅保存在内存
                    </div>
                    <InventoryWarehouseModule />
                </FeatureHelpProvider>
            </ConfirmDialogContext.Provider>
        </BrowserRouter>
    </ApolloProvider>,
);
