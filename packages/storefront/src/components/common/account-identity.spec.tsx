// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { type ActiveCustomer } from '../../types';

import { AccountIdentity, maskedAccountEmail } from './account-identity';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const customer: ActiveCustomer = {
    id: 'identity-test',
    firstName: '雪',
    lastName: '潘',
    emailAddress: 'private.member@example.com',
    phoneNumber: null,
    orders: { items: [], totalItems: 0 },
    addresses: [],
};

async function withIdentity(
    overrides: Partial<Parameters<typeof AccountIdentity>[0]>,
    verify: (host: HTMLDivElement, navigate: ReturnType<typeof vi.fn>) => Promise<void> | void,
) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const navigate = vi.fn();
    try {
        act(() =>
            root.render(
                <AccountIdentity
                    customer={customer}
                    storefrontName="测试商城"
                    language="zh"
                    favoriteCount={4}
                    couponCount={2}
                    referralEnabled={true}
                    referralPending={false}
                    referralBalance={undefined}
                    currencyCode="MYR"
                    locale="zh-CN"
                    navigate={navigate}
                    {...overrides}
                />,
            ),
        );
        await verify(host, navigate);
    } finally {
        act(() => root.unmount());
        host.remove();
    }
}

function button(host: HTMLDivElement, selector: string): HTMLButtonElement {
    const result = host.querySelector<HTMLButtonElement>(selector);
    if (!result) throw new Error('Missing button: ' + selector);
    return result;
}

describe('account identity navigation and data', () => {
    it('keeps all three shortcuts and opens their actual routes', async () => {
        await withIdentity({}, (host, navigate) => {
            const buttons = Array.from(
                host.querySelectorAll<HTMLButtonElement>('.account-identity-assets > button'),
            );
            expect(buttons).toHaveLength(3);
            expect(buttons[0].textContent).toContain('4');
            expect(buttons[1].textContent).toContain('2');
            for (const [index, name] of ['favorites', 'coupons', 'referral'].entries()) {
                act(() => buttons[index].click());
                expect(navigate).toHaveBeenLastCalledWith({ name });
            }
            act(() => button(host, '.account-identity-edit').click());
            expect(navigate).toHaveBeenLastCalledWith({ name: 'account-security' });
            act(() => button(host, '.account-identity-promotion-actions button').click());
            expect(navigate).toHaveBeenLastCalledWith({ name: 'referral' });
            expect(host.textContent).toContain('pr***@example.com');
            expect(host.textContent).not.toContain(customer.emailAddress);
            expect(host.querySelector('.account-identity-promotion-actions strong')?.textContent).toBe('—');
        });
    });
    it('disables unavailable referral without inventing a balance', async () => {
        await withIdentity({ referralEnabled: false }, (host, navigate) => {
            const referral = button(host, '.account-identity-assets > button:last-child');
            expect(referral.disabled).toBe(true);
            expect(referral.textContent).toContain('暂未开放');
            expect(host.querySelector('.account-identity-promotion')).toBeNull();
            act(() => referral.click());
            expect(navigate).not.toHaveBeenCalled();
        });
    });
    it('keeps guest login and registration working', async () => {
        await withIdentity({ customer: null }, (host, navigate) => {
            expect(host.querySelector('.account-identity-assets')).toBeNull();
            const buttons = host.querySelectorAll<HTMLButtonElement>(
                '.account-identity-guest-actions button',
            );
            act(() => buttons[0].click());
            expect(navigate).toHaveBeenLastCalledWith({ name: 'login' });
            act(() => buttons[1].click());
            expect(navigate).toHaveBeenLastCalledWith({ name: 'register' });
        });
    });
    it('does not expose an invalid account identifier', () => {
        expect(maskedAccountEmail('private-account')).toBe('•••');
        expect(maskedAccountEmail('x@example.com')).toBe('x***@example.com');
    });
});
