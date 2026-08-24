import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { inferSelectItemLabels } from './select-items.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';

function TestSelectItem({ children }: Readonly<{ value: string | number; children: React.ReactNode }>) {
    return <>{children}</>;
}

describe('inferSelectItemLabels', () => {
    it('collects localized labels from nested select items', () => {
        const labels = inferSelectItemLabels(
            <>
                <div>Not an option</div>
                <TestSelectItem value="BEST_SELLERS">热门商品</TestSelectItem>
                <section>
                    <TestSelectItem value="digital">数字商品</TestSelectItem>
                </section>
                <TestSelectItem value={12}>12 条/页</TestSelectItem>
            </>,
            TestSelectItem,
        );

        expect(labels).toEqual({
            BEST_SELLERS: '热门商品',
            digital: '数字商品',
            12: '12 条/页',
        });
    });

    it('uses the raw value only when an item has no display label', () => {
        const labels = inferSelectItemLabels(
            <TestSelectItem value="ACTIVE">{undefined}</TestSelectItem>,
            TestSelectItem,
        );

        expect(labels).toEqual({ ACTIVE: 'ACTIVE' });
    });
});

describe('Select localized value display', () => {
    it('renders the localized item label instead of the raw controlled value', async () => {
        const actEnvironment = globalThis as typeof globalThis & {
            IS_REACT_ACT_ENVIRONMENT?: boolean;
        };
        const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        const root = createRoot(container);

        await React.act(async () => {
            root.render(
                <Select value="BEST_SELLERS">
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="BEST_SELLERS">热门商品</SelectItem>
                    </SelectContent>
                </Select>,
            );
        });

        expect(container.querySelector('[data-slot="select-value"]')?.textContent).toBe('热门商品');

        await React.act(async () => root.unmount());
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    });
});
