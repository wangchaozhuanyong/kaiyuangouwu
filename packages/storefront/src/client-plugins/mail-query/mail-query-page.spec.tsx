// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailQueryPage } from './mail-query-page';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (set) {
        set.call(input, value);
    } else {
        input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('MailQueryPage', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    it('renders input and executes mail query', async () => {
        const mockQueryMails = vi.fn().mockResolvedValue({
            success: true,
            message: null,
            targetType: 'VIRTUAL',
            aliasEmail: 'test_alias@example.com',
            primaryEmail: null,
            codeExpiresAt: null,
            remainingDays: 30,
            totalEmails: 1,
            items: [
                {
                    id: 'mail-1',
                    fromAddress: 'service@github.com',
                    fromName: 'GitHub',
                    subject: 'Your verification code',
                    receivedAt: new Date().toISOString(),
                    extractedCode: '849201',
                    bodyText: 'Your code is 849201',
                    bodyHtml: '<p>Your code is 849201</p>',
                    targetEmail: 'test_alias@example.com',
                    virtualEmailId: 'v1',
                },
            ],
            virtualEmailsList: [],
        });

        const mockApi = {
            queryMails: mockQueryMails,
        };

        const onBack = vi.fn();
        const onNotify = vi.fn();

        act(() => {
            root.render(
                <MailQueryPage api={mockApi as any} language="zh" onBack={onBack} onNotify={onNotify} />,
            );
        });

        const input = container.querySelector<HTMLInputElement>('#mail-query-input');
        expect(input).not.toBeNull();
        if (!input) throw new Error('input not found');

        // Type query code
        act(() => {
            setInputValue(input, 'DEMOCODE123');
        });

        // Click query button
        const button = container.querySelector<HTMLButtonElement>('.mail-query-btn');
        expect(button).not.toBeNull();
        if (!button) throw new Error('button not found');

        await act(async () => {
            button.click();
            await Promise.resolve();
        });

        expect(mockQueryMails).toHaveBeenCalledWith('DEMOCODE123', expect.any(AbortSignal));

        // Code should be displayed
        expect(container.textContent).toContain('849201');
        expect(container.textContent).toContain('GitHub');
        expect(container.textContent).toContain('test_alias@example.com');
    });

    it('displays error when query fails', async () => {
        const mockQueryMails = vi.fn().mockResolvedValue({
            success: false,
            message: '查询码不存在或已过期',
            targetType: '',
            aliasEmail: null,
            primaryEmail: null,
            codeExpiresAt: null,
            remainingDays: null,
            totalEmails: 0,
            items: [],
            virtualEmailsList: [],
        });

        const mockApi = {
            queryMails: mockQueryMails,
        };

        act(() => {
            root.render(
                <MailQueryPage api={mockApi as any} language="zh" onBack={vi.fn()} onNotify={vi.fn()} />,
            );
        });

        const input = container.querySelector<HTMLInputElement>('#mail-query-input');
        expect(input).not.toBeNull();
        if (!input) throw new Error('input not found');

        act(() => {
            setInputValue(input, 'WRONGCODE');
        });

        const button = container.querySelector<HTMLButtonElement>('.mail-query-btn');
        expect(button).not.toBeNull();
        if (!button) throw new Error('button not found');

        await act(async () => {
            button.click();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('查询码不存在或已过期');
    });
});
