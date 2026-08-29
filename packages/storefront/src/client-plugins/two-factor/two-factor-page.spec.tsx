// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCustomer } from '../../types';

import { TwoFactorPage } from './two-factor-page';

const storageState = vi.hoisted(() => ({ available: false }));

vi.mock('./session-storage', () => ({
    clearSessionAccounts: vi.fn(),
    loadSessionAccounts: vi.fn(() => ({ accounts: [], available: storageState.available })),
    saveSessionAccounts: vi.fn(() => storageState.available),
}));

vi.mock('./totp', async () => {
    const actual = await vi.importActual<typeof import('./totp')>('./totp');
    return {
        ...actual,
        generateTotp: vi.fn(() => Promise.resolve('123456')),
    };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const customer: ActiveCustomer = {
    id: 'customer-1',
    firstName: '测试',
    lastName: '用户',
    emailAddress: 'customer@example.com',
    phoneNumber: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};

describe('TwoFactorPage storage availability', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        storageState.available = false;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('disables saving a generated code when Session Storage is unavailable', async () => {
        await act(async () => {
            root.render(
                <TwoFactorPage
                    customer={customer}
                    language="zh"
                    onBack={vi.fn()}
                    onSignIn={vi.fn()}
                    onNotify={vi.fn()}
                />,
            );
            await Promise.resolve();
        });

        const secretInput = container.querySelector<HTMLInputElement>('#storefront-two-factor-secret');
        expect(secretInput).not.toBeNull();

        act(() => {
            const valueSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set?.bind(secretInput);
            valueSetter?.('JBSWY3DPEHPK3PXP');
            secretInput?.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await act(async () => {
            secretInput?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await Promise.resolve();
        });

        const saveButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button =>
            button.textContent?.includes('保存到列表'),
        );
        expect(saveButton).toBeDefined();
        expect(saveButton?.disabled).toBe(true);
    });
});
