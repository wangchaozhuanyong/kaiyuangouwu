// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccountShortcut, ServiceButton } from '../../storefront-ui/page-shell';

import { CountBadge, countBadgeLabel } from './count-badge';

function renderContent(content: ReactNode): HTMLDivElement {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(content);
    return host;
}

const noAction = () => undefined;
const icon = <svg aria-hidden="true" />;

describe('shared count badge', () => {
    it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'omits unavailable or non-positive count %s from the visual and accessible label',
        count => {
            const host = renderContent(<CountBadge count={count} />);
            expect(host.querySelector('.count-badge')).toBeNull();
            expect(host.textContent).toBe('');
            expect(countBadgeLabel('购物车', count)).toBe('购物车');
        },
    );

    it.each([
        [1, '1'],
        [9, '9'],
        [10, '10'],
        [99, '99'],
        [100, '99+'],
    ] as const)('displays count %i as %s while retaining the full quantity', (count, visible) => {
        const badge = renderContent(<CountBadge count={count} />).querySelector('.count-badge');
        expect(badge?.textContent).toBe(visible);
        expect(badge?.getAttribute('title')).toBe(String(count));
        expect(countBadgeLabel('购物车', count)).toBe(`购物车 ${count}`);
    });
});

describe('account count badge integration', () => {
    it('uses the shared overlay badge and full accessible quantity for order shortcuts', () => {
        const host = renderContent(
            <AccountShortcut icon={icon} label="待付款" count={124} onClick={noAction} />,
        );
        const badge = host.querySelector('.count-badge.is-overlay');
        expect(badge?.textContent).toBe('99+');
        expect(badge?.getAttribute('title')).toBe('124');
        expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('待付款 124');
        expect(host.querySelector('small')?.textContent).toBe('待付款');
        expect(host.querySelector('.desktop-shortcut-count')).toBeNull();
    });

    it('uses the same overlay badge and full accessible quantity for service shortcuts', () => {
        const host = renderContent(
            <ServiceButton icon={icon} label="优惠券" badge={124} onClick={noAction} />,
        );
        const badge = host.querySelector('.count-badge.is-overlay');
        expect(badge?.textContent).toBe('99+');
        expect(badge?.getAttribute('title')).toBe('124');
        expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('优惠券 124');
        expect(host.querySelector('button > b')?.textContent).toBe('优惠券');
    });

    it.each([undefined, 0, Number.NaN, Number.POSITIVE_INFINITY])(
        'keeps both shortcut labels usable without an unavailable count %s',
        count => {
            const host = renderContent(
                <>
                    <AccountShortcut icon={icon} label="待付款" count={count} onClick={noAction} />
                    <ServiceButton icon={icon} label="优惠券" badge={count} onClick={noAction} />
                </>,
            );
            expect(host.querySelector('.count-badge')).toBeNull();
            expect(
                Array.from(host.querySelectorAll('button'), button => button.getAttribute('aria-label')),
            ).toEqual(['待付款', '优惠券']);
        },
    );

    it.each([
        { count: 0, visible: '0' },
        { count: undefined, visible: '—' },
        { count: 124, visible: '124' },
    ])('preserves desktop inline quantity $visible in the control name', ({ count, visible }) => {
        const host = renderContent(
            <AccountShortcut icon={icon} label="待付款" count={count} inlineCount onClick={noAction} />,
        );
        expect(host.querySelector('.desktop-shortcut-count')?.textContent).toBe(visible);
        expect(host.querySelector('.count-badge')).toBeNull();
        expect(host.querySelector('button')?.hasAttribute('aria-label')).toBe(false);
        expect(host.querySelector('button')?.textContent).toBe(`待付款${visible}`);
    });
});
