import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
    inventorySkuSummaries,
    InventoryStockOverview,
    inventoryStockStatus,
} from './InventoryWarehouseModule';

describe('warehouse inventory status', () => {
    it.each([true, false])('does not mark explicitly untracked SKUs as sold out (global=%s)', global => {
        expect(inventoryStockStatus('FALSE', global, 0, 0)).toBe('NOT_TRACKED');
    });
    it('respects disabled inherited stock tracking', () => {
        expect(inventoryStockStatus('INHERIT', false, 0, 5)).toBe('NOT_TRACKED');
    });
    it.each(['TRUE', 'INHERIT'] as const)('keeps tracked stock boundaries (%s)', track => {
        expect(inventoryStockStatus(track, true, 0, 5)).toBe('OUT_OF_STOCK');
        expect(inventoryStockStatus(track, true, 3, 5)).toBe('LOW_STOCK');
        expect(inventoryStockStatus(track, true, 6, 5)).toBe('NORMAL');
    });
    it('keeps explicit tracking when global tracking is disabled', () => {
        expect(inventoryStockStatus('TRUE', false, 0, 0)).toBe('OUT_OF_STOCK');
    });
});

const variants: Parameters<typeof inventorySkuSummaries>[0] = [
    {
        id: 'queen',
        name: '测试床垫 · 尺寸:Queen',
        sku: 'QUEEN-01',
        trackInventory: 'TRUE',
        product: { id: 'mattress', name: '测试床垫' },
    },
    {
        id: 'king',
        name: '测试床垫 · 尺寸:King',
        sku: 'KING-01',
        trackInventory: 'TRUE',
        product: { id: 'mattress', name: '测试床垫' },
    },
];
const stockRow = (
    variantId: string,
    locationId: string,
    stockOnHand: number,
    stockAllocated = 0,
    safetyThreshold = 5,
): Parameters<typeof inventorySkuSummaries>[1][number] => ({
    id: `${variantId}:${locationId}`,
    variantId,
    locationId,
    productName: '测试床垫',
    variantName: `测试床垫 · ${variantId}`,
    sku: variantId === 'queen' ? 'QUEEN-01' : 'KING-01',
    warehouse: `仓库 ${locationId}`,
    stockOnHand,
    stockAllocated,
    stockAvailable: stockOnHand - stockAllocated,
    safetyThreshold,
    status: inventoryStockStatus('TRUE', true, stockOnHand - stockAllocated, safetyThreshold),
});
const rows = [
    stockRow('queen', '1', 0),
    stockRow('queen', '2', 0),
    stockRow('queen', '3', 100, 7),
    stockRow('king', '3', 30, 4),
];
const summaries = inventorySkuSummaries(variants, rows, true);
const markup = (expandedSkuIds = new Set<string>(), items = summaries) =>
    renderToStaticMarkup(
        <InventoryStockOverview
            items={items}
            expandedSkuIds={expandedSkuIds}
            onToggle={vi.fn()}
            sortField="updatedAt"
            sortDirection="DESC"
            onSort={vi.fn()}
            onAdjust={vi.fn()}
        />,
    );

describe('SKU stock overview', () => {
    it('collapses warehouse rows into one record per variant without combining sizes', () => {
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
            variantId: 'queen',
            stockOnHand: 100,
            stockAllocated: 7,
            stockAvailable: 93,
            status: 'LOW_STOCK',
        });
        expect(summaries[0].locations).toHaveLength(3);
        expect(summaries[1]).toMatchObject({
            variantId: 'king',
            stockOnHand: 30,
            stockAllocated: 4,
            stockAvailable: 26,
            status: 'NORMAL',
        });
    });
    it('preserves negative available stock instead of clamping each warehouse to zero', () => {
        const [item] = inventorySkuSummaries(
            [variants[0]],
            [stockRow('queen', '1', 0, 10), stockRow('queen', '2', 8)],
            true,
        );
        expect(item.stockAvailable).toBe(-2);
        expect(item.status).toBe('OUT_OF_STOCK');
    });
    it('retains per-warehouse replenishment thresholds when determining SKU status', () => {
        expect(
            inventorySkuSummaries([variants[0]], [stockRow('queen', '3', 30, 0, 40)], true)[0].status,
        ).toBe('LOW_STOCK');
    });
    it.each(['FALSE', 'INHERIT'] as const)('respects untracked inventory (%s)', trackInventory => {
        const [item] = inventorySkuSummaries(
            [{ ...variants[0], trackInventory }],
            [stockRow('queen', '1', 0)],
            false,
        );
        expect(item.status).toBe('NOT_TRACKED');
        expect(markup(new Set(), [item])).toContain('不跟踪仓库库存');
    });
    it('keeps SKUs with no warehouse visible without reporting missing inventory as measured zero', () => {
        const items = inventorySkuSummaries([variants[0]], [], true);
        const html = markup(new Set(['queen']), items);
        expect(html).toContain('未关联库存点');
        expect(html).toContain('请进入商品编辑页建立库存记录');
        expect(html).not.toContain('>缺货<');
    });
    it('shows the product name once and keeps warehouses collapsed by default', () => {
        const html = markup();
        expect(html.match(/测试床垫/g)).toHaveLength(1);
        expect(html).toContain('尺寸:Queen');
        expect(html).toContain('尺寸:King');
        expect(html).not.toContain('仓库 1');
        expect(html).not.toContain('盘点调整');
        expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    });
    it('expands only the requested SKU and exposes a separate adjustment for each warehouse', () => {
        const html = markup(new Set(['queen']));
        expect(html).toContain('aria-controls="stock-sku-queen"');
        expect(html).toContain('仓库 1');
        expect(html.match(/aria-label="盘点调整 QUEEN-01 仓库/g)).toHaveLength(3);
        expect(html).not.toContain('aria-label="盘点调整 KING-01');
    });
    it('shows a filtered empty state', () => {
        expect(markup(new Set(), [])).toContain('当前筛选条件下暂无 SKU');
    });
});
