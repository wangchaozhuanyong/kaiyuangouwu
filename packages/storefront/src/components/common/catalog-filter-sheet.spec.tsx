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
    beforeEach(async () => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root.render(<Harness />);
            await vi.dynamicImportSettled();
        });
        await vi.waitFor(async () => {
            await act(async () => {
                await Promise.resolve();
            });
            expect(document.querySelector('[aria-label="最低价"]')).not.toBeNull();
        });
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.clearAllMocks();
    });
    it('validates inverted bounds and updates both price limits atomically', () => {
        expect(button('应用筛选').disabled).toBe(true);
        const minimum = document.querySelector('[aria-label="最低价"]') as HTMLInputElement;
        const maximum = document.querySelector('[aria-label="最高价"]') as HTMLInputElement;
        const error = document.querySelector('[role="alert"]');
        expect(minimum.getAttribute('aria-invalid')).toBe('true');
        expect(maximum.getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById(minimum.getAttribute('aria-describedby') ?? '')).toBe(error);
        expect(maximum.getAttribute('aria-describedby')).toBe(error?.id);
        act(() => button('100-300').click());
        expect((document.querySelector('[aria-label="最低价"]') as HTMLInputElement).value).toBe('100');
        expect((document.querySelector('[aria-label="最高价"]') as HTMLInputElement).value).toBe('300');
        expect(minimum.hasAttribute('aria-invalid')).toBe(false);
        expect(maximum.hasAttribute('aria-invalid')).toBe(false);
        expect(minimum.hasAttribute('aria-describedby')).toBe(false);
        expect(maximum.hasAttribute('aria-describedby')).toBe(false);
        expect(document.querySelector('[role="alert"]')).toBeNull();
        act(() => button('应用筛选').click());
        expect(apply).toHaveBeenCalledWith({
            fulfillment: 'digital',
            inStockOnly: true,
            minPrice: '100',
            maxPrice: '300',
        });
    });
    it.each([
        { minPrice: '-1', maxPrice: '100', invalid: '最低价', valid: '最高价' },
        { minPrice: '0', maxPrice: '-1', invalid: '最高价', valid: '最低价' },
        { minPrice: 'invalid', maxPrice: '100', invalid: '最低价', valid: '最高价' },
    ])(
        'associates only the invalid field: $minPrice / $maxPrice',
        async ({ minPrice, maxPrice, invalid, valid }) => {
            await act(async () => {
                root.render(
                    <CatalogFilterSheet
                        language="zh"
                        currencyCode="MYR"
                        value={{ fulfillment: 'all', inStockOnly: false, minPrice, maxPrice }}
                        resultCount={null}
                        onChange={vi.fn()}
                        onApply={apply}
                        onClose={close}
                    />,
                );
                await vi.dynamicImportSettled();
            });
            const field = document.querySelector(`[aria-label="${invalid}"]`);
            const other = document.querySelector(`[aria-label="${valid}"]`);
            const error = document.querySelector('[role="alert"]');
            expect(field?.getAttribute('aria-invalid')).toBe('true');
            expect(document.getElementById(field?.getAttribute('aria-describedby') ?? '')).toBe(error);
            expect(other?.hasAttribute('aria-invalid')).toBe(false);
            expect(other?.hasAttribute('aria-describedby')).toBe(false);
            expect(button('应用筛选').disabled).toBe(true);
            act(() => button('应用筛选').click());
            expect(apply).not.toHaveBeenCalled();
        },
    );

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
