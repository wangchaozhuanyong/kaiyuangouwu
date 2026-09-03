// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeliveryEmailPicker } from './checkout-page';
import { CustomerDeliveryEmail } from './types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deliveryEmails: CustomerDeliveryEmail[] = [
    {
        id: 'email-default',
        emailAddress: 'ppfzj1314@gmail.com',
        label: '',
        isDefault: true,
        confirmedAt: '2026-09-04T00:00:00.000Z',
    },
    {
        id: 'email-work',
        emailAddress: 'orders@example.com',
        label: '工作',
        isDefault: false,
        confirmedAt: '2026-09-04T00:00:00.000Z',
    },
];

function PickerHarness() {
    const [selectedId, setSelectedId] = useState('email-default');
    const [open, setOpen] = useState(false);
    return (
        <DeliveryEmailPicker
            deliveryEmails={deliveryEmails}
            selectedId={selectedId}
            open={open}
            language="zh"
            onOpenChange={setOpen}
            onSelect={setSelectedId}
        />
    );
}

describe('DeliveryEmailPicker', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
    });

    it('opens from the full trigger including its arrow and switches the selected email', () => {
        act(() => root.render(<PickerHarness />));

        const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
        expect(trigger?.textContent).toContain('ppfzj1314@gmail.com');
        expect(trigger?.textContent).toContain('默认邮箱');
        expect(trigger?.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('select')).toBeNull();

        act(() => {
            trigger?.querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        const workEmailOption = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
            option => option.textContent?.includes('orders@example.com'),
        );
        expect(workEmailOption?.getAttribute('aria-checked')).toBe('false');

        act(() => workEmailOption?.click());

        const updatedTrigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
        expect(updatedTrigger?.textContent).toContain('orders@example.com');
        expect(updatedTrigger?.textContent).toContain('工作');
        expect(updatedTrigger?.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('offers a new-email option in the same bottom drawer', () => {
        act(() => root.render(<PickerHarness />));
        const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');

        act(() => trigger?.click());
        const newEmailOption = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
            option => option.textContent?.includes('使用新邮箱'),
        );
        act(() => newEmailOption?.click());

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('button[aria-haspopup="dialog"]')?.textContent).toContain(
            '使用新邮箱',
        );
    });
});
