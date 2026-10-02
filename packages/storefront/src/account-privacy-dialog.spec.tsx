// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AccountSecurityPage } from './account-security-page';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./storefront-ui/page-shell', () => ({ SubHeader: () => null, Subpage: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const exportData = vi.fn();
const requestClosure = vi.fn();

beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        callback(0);
        return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(vi.fn());
    exportData.mockReset();
    requestClosure.mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    renderPage();
});

function renderPage(exportEnabled = true) {
    act(() => {
        root.render(
            <AccountSecurityPage
                customer={{
                    id: 'fixture-customer',
                    firstName: 'Fixture',
                    lastName: '',
                    emailAddress: 'fixture@example.test',
                    phoneNumber: null,
                    addresses: [],
                    orders: { items: [], totalItems: 0 },
                }}
                language="zh"
                storefrontName="Fixture store"
                onBack={vi.fn()}
                onAvatarChange={vi.fn()}
                onDataExport={exportEnabled ? exportData : undefined}
                onRequestAccountClosure={requestClosure}
                onLogout={vi.fn()}
            />,
        );
    });
}

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
});

function openDialog(label: string) {
    const trigger = Array.from(host.querySelectorAll('button')).find(button =>
        button.textContent?.includes(label),
    );
    if (!trigger) throw new Error(`Missing ${label}`);
    trigger.focus();
    void act(() => trigger.click());
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    const input = dialog?.querySelector<HTMLInputElement>('input');
    if (!dialog || !input) throw new Error('Missing privacy dialog');
    return { trigger, dialog, input };
}

function key(target: EventTarget, value: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    void act(() => target.dispatchEvent(event));
    return event;
}

it.each(['导出我的个人数据', '申请注销账户'])(
    'keeps focus inside %s and restores it on Escape without a request',
    label => {
        const { trigger, dialog, input } = openDialog(label);
        expect(document.activeElement).toBe(input);
        expect(document.body.style.overflow).toBe('hidden');
        const enabled = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
        enabled.at(-1)?.focus();
        expect(key(document, 'Tab').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(enabled[0]);
        expect(key(document, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(enabled.at(-1));
        key(document, 'Escape', { isComposing: true });
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
        key(document, 'Escape');
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.overflow).not.toBe('hidden');
        expect(exportData).not.toHaveBeenCalled();
        expect(requestClosure).not.toHaveBeenCalled();
    },
);

it('ignores IME confirmation and duplicate Enter while a fixture request is pending', async () => {
    const { dialog, input } = openDialog('申请注销账户');
    let rejectRequest!: (reason: Error) => void;
    requestClosure.mockImplementation(
        () =>
            new Promise<void>((_resolve, reject) => {
                rejectRequest = reject;
            }),
    );
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            'fixture-pass',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(input, 'Enter', { isComposing: true });
    key(input, 'Enter', { keyCode: 229 });
    expect(requestClosure).not.toHaveBeenCalled();
    key(input, 'Enter');
    expect(requestClosure).toHaveBeenCalledOnce();
    key(input, 'Enter');
    key(document, 'Escape');
    expect(requestClosure).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="dialog"]')).toBe(dialog);
    dialog.focus();
    key(document, 'Tab');
    expect(document.activeElement).toBe(dialog);
    await act(async () => {
        rejectRequest(new Error('Fixture failure'));
        await Promise.resolve();
    });
    expect(dialog.querySelector('.security-privacy-dialog-error')?.textContent).toBe(
        '操作暂时未能完成，请稍后重试。',
    );
    key(document, 'Escape');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps account closure working when personal-data export is not exposed', async () => {
    renderPage(false);
    expect(host.textContent).not.toContain('导出我的个人数据');
    requestClosure.mockResolvedValue(undefined);
    const { dialog, input } = openDialog('申请注销账户');
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            'local-test-password',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
        dialog.querySelector<HTMLButtonElement>('.security-privacy-dialog-actions .is-danger')?.click();
        await Promise.resolve();
    });
    expect(requestClosure).toHaveBeenCalledWith('local-test-password');
    expect(exportData).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
});
