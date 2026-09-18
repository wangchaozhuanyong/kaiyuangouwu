// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllListSearch, saveListSearch } from '../utils/list-state-storage';
import { useAdminReturn } from './use-admin-return';

const cleanups: Array<() => void> = [];

beforeEach(() => {
    clearAllListSearch();
});

afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function renderAdminReturn(
    initialEntries: Array<{ pathname: string; search?: string; state?: unknown } | string>,
    fallbackPath: string,
) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    let currentReturnPath = '';
    function Harness() {
        const location = useLocation();
        const { returnPath, returnToList } = useAdminReturn(fallbackPath);
        useEffect(() => {
            currentReturnPath = returnPath;
        });
        return (
            <div>
                <span data-testid="current-url">
                    {location.pathname}
                    {location.search}
                </span>
                <button type="button" data-testid="return-btn" onClick={returnToList}>
                    {returnPath}
                </button>
            </div>
        );
    }

    await act(async () => {
        root.render(
            <MemoryRouter initialEntries={initialEntries}>
                <Harness />
            </MemoryRouter>,
        );
    });

    cleanups.push(() => {
        root.unmount();
        container.remove();
    });

    return {
        getReturnPath: () => currentReturnPath,
        clickReturn: async () => {
            const btn = container.querySelector<HTMLButtonElement>('[data-testid="return-btn"]')!;
            await act(async () => btn.click());
        },
        getCurrentUrl: () =>
            container.querySelector<HTMLSpanElement>('[data-testid="current-url"]')!.textContent!,
    };
}

describe('useAdminReturn', () => {
    it('returns location.state.returnTo with highest priority', async () => {
        saveListSearch('/catalog/list', '?page=99');

        const { clickReturn, getCurrentUrl, getReturnPath } = await renderAdminReturn(
            [
                {
                    pathname: '/catalog/products/123',
                    state: { returnTo: '/catalog/list?page=3&status=enabled' },
                },
            ],
            '/catalog/list',
        );

        expect(getReturnPath()).toBe('/catalog/list?page=3&status=enabled');
        await clickReturn();
        expect(getCurrentUrl()).toBe('/catalog/list?page=3&status=enabled');
    });

    it('returns cross-module origin from location.state.returnTo (e.g. inventory to product)', async () => {
        const { clickReturn, getCurrentUrl, getReturnPath } = await renderAdminReturn(
            [
                {
                    pathname: '/catalog/products/123',
                    state: { returnTo: '/catalog/inventory?tab=warehouses' },
                },
            ],
            '/catalog/list',
        );

        expect(getReturnPath()).toBe('/catalog/inventory?tab=warehouses');
        await clickReturn();
        expect(getCurrentUrl()).toBe('/catalog/inventory?tab=warehouses');
    });

    it('falls back to session storage remembered query if location.state is absent', async () => {
        saveListSearch('/sales/orders', '?tab=to-fulfill&search=ORD-999');

        const { clickReturn, getCurrentUrl, getReturnPath } = await renderAdminReturn(
            ['/sales/orders/456'],
            '/sales/orders',
        );

        expect(getReturnPath()).toBe('/sales/orders?tab=to-fulfill&search=ORD-999');
        await clickReturn();
        expect(getCurrentUrl()).toBe('/sales/orders?tab=to-fulfill&search=ORD-999');
    });

    it('falls back to clean fallbackPath if no state and no saved search exist', async () => {
        const { clickReturn, getCurrentUrl, getReturnPath } = await renderAdminReturn(
            ['/sales/orders/456'],
            '/sales/orders',
        );

        expect(getReturnPath()).toBe('/sales/orders');
        await clickReturn();
        expect(getCurrentUrl()).toBe('/sales/orders');
    });
});
