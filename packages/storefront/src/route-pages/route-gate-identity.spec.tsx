// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { StorefrontContext, StorefrontContextValue } from '../StorefrontContext';

import { RouteGate } from './shared';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function LocalDraft() {
    const [value, setValue] = useState('');
    return (
        <button type="button" onClick={() => setValue('private draft')}>
            {value || 'empty draft'}
        </button>
    );
}

it('clears private page state when the customer or storefront changes', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const render = (customerId: string, marketCode: string) => {
        const runtime = {
            customer: { id: customerId },
            market: { code: marketCode },
            customerLoadState: 'ready',
        } as unknown as StorefrontContextValue;
        act(() =>
            root.render(
                <StorefrontContext.Provider value={runtime}>
                    <RouteGate name="reviews">
                        <LocalDraft />
                    </RouteGate>
                </StorefrontContext.Provider>,
            ),
        );
    };
    try {
        render('customer-a', 'store-a');
        act(() => host.querySelector('button')?.click());
        expect(host.textContent).toBe('private draft');

        render('customer-b', 'store-a');
        expect(host.textContent).toBe('empty draft');
        act(() => host.querySelector('button')?.click());
        render('customer-b', 'store-a');
        expect(host.textContent).toBe('private draft');

        render('customer-b', 'store-b');
        expect(host.textContent).toBe('empty draft');
    } finally {
        act(() => root.unmount());
    }
});
