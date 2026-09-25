// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogFilterSheet, type CatalogFilterValues } from './catalog-filter-sheet';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('shared catalog filter draft', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    const apply = vi.fn();
    const close = vi.fn();
    function Harness() {
        const [value, onChange] = useState<CatalogFilterValues>({
            fulfillment: 'digital',
            inStockOnly: true,
            minPrice: '500',
            maxPrice: '100',
        });
        return (
            <CatalogFilterSheet
                language="zh"
                currencyCode="MYR"
                value={value}
                resultCount={null}
                onChange={onChange}
                onApply={apply}
                onClose={close}
            />
        );
    }
    const button = (text: string) => {
        const target = [...document.querySelectorAll('button')].find(
            item => item.textContent?.trim() === text,
        );
        if (!target) throw new Error(`Missing filter button: ${text}`);
        return target;
    };
    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        act(() => root.render(<Harness />));
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.clearAllMocks();
    });
    it('validates inverted bounds and updates both price limits atomically', () => {
        expect(button('应用筛选').disabled).toBe(true);
        act(() => button('100-300').click());
        expect((document.querySelector('[aria-label="最低价"]') as HTMLInputElement).value).toBe('100');
        expect((document.querySelector('[aria-label="最高价"]') as HTMLInputElement).value).toBe('300');
        act(() => button('应用筛选').click());
        expect(apply).toHaveBeenCalledWith({
            fulfillment: 'digital',
            inStockOnly: true,
            minPrice: '100',
            maxPrice: '300',
        });
    });
    it('resets every draft field together without applying until confirmed', () => {
        act(() => button('重置').click());
        expect(apply).not.toHaveBeenCalled();
        act(() => button('应用筛选').click());
        expect(apply).toHaveBeenCalledWith({
            fulfillment: 'all',
            inStockOnly: false,
            minPrice: '',
            maxPrice: '',
        });
    });
    it('closes on Escape without applying the draft', async () => {
        await act(async () => {
            button('0-100').click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await Promise.resolve();
        });
        expect(close).toHaveBeenCalledOnce();
        expect(apply).not.toHaveBeenCalled();
    });
});
