// @vitest-environment jsdom
/* eslint-disable import/order, @typescript-eslint/unbound-method -- Test harness setup */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShopApi } from '../../api';
import type { MailStreamCallbacks } from '../../api/mail-events';
import { MailQueryPage } from './mail-query-page';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
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
        vi.useFakeTimers();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            vi.runOnlyPendingTimers();
            root.unmount();
        });
        container.remove();
        localStorage.clear();
        vi.useRealTimers();
    });

    it('keeps recent query codes in their own store and account without exposing legacy records', () => {
        const record = (code: string) =>
            JSON.stringify([{ code, updatedAt: Date.now(), aliasEmail: `${code}@example.test` }]);
        localStorage.setItem('icloud_relay_recent_queries', record('BUY-LEGACY-0001'));
        localStorage.setItem('icloud_relay_recent_queries:store-a', record('BUY-OLD-0001'));
        localStorage.setItem('icloud_relay_recent_queries:store-a:customer:alice', record('BUY-AAAA-0001'));
        localStorage.setItem('icloud_relay_recent_queries:store-a:customer:bob', record('BUY-BBBB-0002'));
        localStorage.setItem('icloud_relay_recent_queries:store-b:customer:alice', record('BUY-CCCC-0003'));
        localStorage.setItem('icloud_relay_recent_queries:store-a:guest', record('BUY-GGGG-0004'));
        const api = { queryMails: vi.fn() } as unknown as ShopApi;

        act(() => {
            root.render(
                <MailQueryPage
                    key="store-a:alice"
                    api={api}
                    marketCode="store-a"
                    customerId="alice"
                    language="zh"
                />,
            );
        });
        expect(container.textContent).toContain('BUY-AAAA-0001');
        expect(container.textContent).not.toContain('BUY-BBBB-0002');
        expect(container.textContent).not.toContain('BUY-LEGACY-0001');
        expect(container.textContent).not.toContain('BUY-OLD-0001');
        expect(container.textContent).not.toContain('BUY-GGGG-0004');

        act(() => {
            root.render(
                <MailQueryPage
                    key="store-a:bob"
                    api={api}
                    marketCode="store-a"
                    customerId="bob"
                    language="zh"
                />,
            );
        });
        expect(container.textContent).toContain('BUY-BBBB-0002');
        expect(container.textContent).not.toContain('BUY-AAAA-0001');

        act(() => {
            container.querySelector<HTMLButtonElement>('#clearAllHistoryBtn')?.click();
        });
        expect(localStorage.getItem('icloud_relay_recent_queries:store-a:customer:bob')).toBeNull();
        expect(localStorage.getItem('icloud_relay_recent_queries:store-a:customer:alice')).not.toBeNull();
        expect(localStorage.getItem('icloud_relay_recent_queries:store-a')).not.toBeNull();

        act(() => {
            root.render(
                <MailQueryPage
                    key="store-b:alice"
                    api={api}
                    marketCode="store-b"
                    customerId="alice"
                    language="zh"
                />,
            );
        });
        expect(container.textContent).toContain('BUY-CCCC-0003');
        expect(container.textContent).not.toContain('BUY-AAAA-0001');

        act(() => {
            root.render(<MailQueryPage key="store-a:guest" api={api} marketCode="store-a" language="zh" />);
        });
        expect(container.textContent).toContain('BUY-GGGG-0004');
        expect(container.textContent).not.toContain('BUY-AAAA-0001');
    });

    it('renders the shared page header, labeled query controls and compact help', () => {
        const mockApi = {
            queryMails: vi.fn(),
        };

        const onBack = vi.fn();

        act(() => {
            root.render(
                <MailQueryPage
                    api={mockApi as unknown as ShopApi}
                    marketCode="my-malaysia"
                    brandingName="大马通"
                    language="zh"
                    onBack={onBack}
                />,
            );
        });

        expect(container.querySelector('.subpage-header')?.textContent).toContain('邮箱查询服务');
        expect(container.querySelector('.hero-section')).toBeNull();
        expect(container.querySelector('.nav-status')).toBeNull();
        expect(container.querySelector('.portal-footer')).toBeNull();
        expect(container.querySelector('.query-card')).not.toBeNull();
        expect(container.querySelector('label[for="codeInput"]')?.textContent).toContain('专属查询码');
        expect(container.querySelector('#pasteBtn')).not.toBeNull();
        expect(container.querySelector('#queryBtn')?.textContent).toBe('查询邮件');
        expect(container.querySelectorAll('.faq-section details')).toHaveLength(3);
        expect(container.querySelector('.faq-section details[open]')).toBeNull();
        expect(container.querySelector('.mail-query-support')?.getAttribute('href')).toBe('/support');

        // Back button action
        const backBtn = container.querySelector<HTMLButtonElement>(
            '.subpage-header button[aria-label="返回"]',
        );
        expect(backBtn).not.toBeNull();
        act(() => {
            backBtn?.click();
        });
        expect(onBack).toHaveBeenCalled();
    });

    it('executes query and displays results with OTP code and copy button', async () => {
        const mockQueryMails = vi.fn().mockResolvedValue({
            success: true,
            message: null,
            targetType: 'VIRTUAL',
            aliasEmail: 'test_alias@icloud.com',
            primaryEmail: null,
            codeExpiresAt: null,
            remainingDays: 25,
            totalEmails: 1,
            items: [
                {
                    id: 'mail-101',
                    fromAddress: 'no-reply@service.com',
                    fromName: 'Verification System',
                    subject: 'Your Login Code is 739201',
                    receivedAt: new Date().toISOString(),
                    extractedCode: '739201',
                    bodyText: 'Your verification code is 739201',
                    bodyHtml: '<p>Your code: 739201</p>',
                    targetEmail: 'test_alias@icloud.com',
                    virtualEmailId: 'v-101',
                },
            ],
            virtualEmailsList: [],
        });

        const mockApi = {
            queryMails: mockQueryMails,
        };

        act(() => {
            root.render(
                <MailQueryPage
                    api={mockApi as unknown as ShopApi}
                    marketCode="my-malaysia"
                    brandingName="大马通"
                    language="zh"
                />,
            );
        });

        const input = container.querySelector<HTMLInputElement>('#codeInput');
        expect(input).not.toBeNull();
        if (!input) throw new Error('input not found');

        act(() => {
            setInputValue(input, 'BUY-ABCD-1234');
        });

        const queryBtn = container.querySelector<HTMLButtonElement>('#queryBtn');
        expect(queryBtn).not.toBeNull();

        await act(async () => {
            queryBtn?.click();
            await Promise.resolve();
        });

        expect(mockQueryMails).toHaveBeenCalledWith('BUY-ABCD-1234', expect.any(AbortSignal));

        // Result view displayed
        expect(container.querySelector('#resultSection')).not.toBeNull();
        expect(container.textContent).toContain('test_alias@icloud.com');
        expect(container.textContent).toContain('买家专属');
        expect(container.textContent).toContain('有效期剩余 25 天');
        expect(container.textContent).toContain('739201');
        expect(container.textContent).toContain('Verification System');
        expect(container.textContent).toContain('一键复制');

        // Check recent queries saved to localStorage
        const stored = localStorage.getItem('icloud_relay_recent_queries:my-malaysia:guest');
        expect(stored).not.toBeNull();
        expect(stored).toContain('BUY-ABCD-1234');
    });

    it('displays error toast when query returns unsuccessful', async () => {
        const mockQueryMails = vi.fn().mockResolvedValue({
            success: false,
            message: '专属查询码无效或已过期',
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
                <MailQueryPage
                    api={mockApi as unknown as ShopApi}
                    marketCode="my-malaysia"
                    brandingName="大马通"
                    language="zh"
                />,
            );
        });

        const input = container.querySelector<HTMLInputElement>('#codeInput');
        if (!input) throw new Error('input not found');

        act(() => {
            setInputValue(input, 'BUY-EXPIRED-CODE');
        });

        const queryBtn = container.querySelector<HTMLButtonElement>('#queryBtn');
        await act(async () => {
            queryBtn?.click();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('专属查询码无效或已过期');
        act(() => {
            vi.advanceTimersByTime(10);
        });
        expect(container.querySelector('.input-wrapper.has-error')).not.toBeNull();

        mockQueryMails.mockResolvedValue({
            success: true,
            targetType: 'VIRTUAL',
            aliasEmail: 'buyer@example.test',
            totalEmails: 0,
            items: [],
            virtualEmailsList: [],
        });
        await act(async () => {
            queryBtn?.click();
            await Promise.resolve();
        });
        act(() => container.querySelector<HTMLButtonElement>('#backQueryBtn')?.click());
        expect(container.querySelector('#codeInput')?.getAttribute('aria-invalid')).toBeNull();
        expect(container.querySelector('.input-wrapper.has-error')).toBeNull();
    });

    it('refreshes new mail and keeps the last result when a later refresh fails', async () => {
        const first = {
            success: true,
            message: null,
            targetType: 'VIRTUAL',
            aliasEmail: 'buyer@example.test',
            primaryEmail: null,
            codeExpiresAt: null,
            remainingDays: 4,
            totalEmails: 1,
            items: [
                {
                    id: 'mail-first',
                    fromAddress: 'sender@example.test',
                    fromName: 'Sender',
                    subject: 'First mail',
                    receivedAt: new Date().toISOString(),
                    extractedCode: null,
                    bodyText: 'First mail',
                    bodyHtml: '',
                    targetEmail: 'buyer@example.test',
                    virtualEmailId: 'virtual-1',
                },
            ],
            virtualEmailsList: [],
        };
        const queryMails = vi
            .fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce({
                ...first,
                totalEmails: 2,
                items: [...first.items, { ...first.items[0], id: 'mail-second', subject: 'New mail' }],
            })
            .mockRejectedValueOnce(new Error('Temporary network error'));
        act(() => {
            root.render(
                <MailQueryPage
                    api={{ queryMails } as unknown as ShopApi}
                    marketCode="my-malaysia"
                    language="zh"
                />,
            );
        });
        const input = container.querySelector<HTMLInputElement>('#codeInput');
        if (!input) throw new Error('Missing query input');
        act(() => setInputValue(input, 'BUY-AAAA-1234'));
        await act(async () => {
            container.querySelector<HTMLButtonElement>('#queryBtn')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('First mail');

        await act(async () => {
            container.querySelector<HTMLButtonElement>('#refreshNowBtn')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('New mail');
        expect(container.querySelector('#totalMailCount')?.textContent).toContain('2');

        await act(async () => {
            container.querySelector<HTMLButtonElement>('#refreshNowBtn')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('New mail');
        expect(container.querySelector('#refreshStatus')?.textContent).toContain('Temporary network error');
        expect(queryMails).toHaveBeenCalledTimes(3);
    });

    it('receives events without idle polling and preserves the mailbox filter, expanded body and language changes', async () => {
        const first = {
            success: true,
            message: null,
            targetType: 'PRIMARY',
            primaryEmail: 'own***@example.test',
            aliasEmail: null,
            codeExpiresAt: null,
            remainingDays: 3,
            totalEmails: 1,
            items: [
                {
                    id: 'm1',
                    virtualEmailId: 'v1',
                    fromAddress: 'sender@example.test',
                    fromName: 'Sender',
                    subject: 'First mail',
                    receivedAt: '2026-10-04T12:00:00Z',
                    extractedCode: null,
                    bodyText: 'Expanded mail body',
                    bodyHtml: '',
                    targetEmail: 'ali***@example.test',
                },
            ],
            virtualEmailsList: [
                { id: 'v1', aliasEmail: 'one***@example.test', note: null },
                { id: 'v2', aliasEmail: 'two***@example.test', note: null },
            ],
        };
        const queryMails = vi
            .fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValue({
                ...first,
                totalEmails: 2,
                items: [
                    {
                        ...first.items[0],
                        id: 'm2',
                        virtualEmailId: 'v2',
                        subject: 'Other alias',
                        receivedAt: '2026-10-04T13:00:00Z',
                    },
                    ...first.items,
                ],
            });
        let callbacks!: MailStreamCallbacks;
        let subscription!: AbortSignal;
        const watchMailEvents = vi.fn((_code: string, next: MailStreamCallbacks, signal: AbortSignal) => {
            callbacks = next;
            subscription = signal;
            next.onStatus('live');
            return new Promise<void>(resolve =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
            );
        });
        const api = { queryMails, watchMailEvents } as unknown as ShopApi;
        await act(async () => {
            root.render(<MailQueryPage api={api} marketCode="store-a" initialCode="MSTR-AAAA-BBBB" />);
            await Promise.resolve();
        });
        expect(container.querySelector<HTMLInputElement>('#liveUpdatesToggle')?.checked).toBe(true);
        expect(watchMailEvents).toHaveBeenCalledOnce();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(120_000);
        });
        expect(queryMails).toHaveBeenCalledOnce();
        const select = container.querySelector<HTMLSelectElement>('#filterSelect');
        if (!select) throw new Error('Missing alias filter');
        act(() => {
            select.value = 'v1';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            container.querySelector<HTMLButtonElement>('.toggle-body-btn')?.click();
        });
        const pending: Array<Promise<void>> = [];
        await act(async () => {
            pending.push(Promise.resolve(callbacks.onChange()), Promise.resolve(callbacks.onChange()));
            await vi.advanceTimersByTimeAsync(100);
            await Promise.all(pending);
        });
        expect(queryMails).toHaveBeenCalledTimes(2);
        expect(select.value).toBe('v1');
        expect(container.textContent).toContain('Expanded mail body');
        expect(container.textContent).not.toContain('Other alias');
        expect(container.querySelector('#totalMailCount')?.textContent).toContain('2');
        await act(async () => {
            root.render(
                <MailQueryPage api={api} marketCode="store-a" language="en" initialCode="MSTR-AAAA-BBBB" />,
            );
            await Promise.resolve();
        });
        expect(queryMails).toHaveBeenCalledTimes(2);
        expect(watchMailEvents).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Latest received:');
        act(() => container.querySelector<HTMLInputElement>('#liveUpdatesToggle')?.click());
        expect(subscription.aborted).toBe(true);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(120_000);
        });
        expect(queryMails).toHaveBeenCalledTimes(2);
    });

    it('reads again when a distinct event arrives during an in-flight refresh and ignores old query responses', async () => {
        const result = (subject: string) => ({
            success: true,
            targetType: 'VIRTUAL',
            aliasEmail: 'buy***@example.test',
            totalEmails: 1,
            items: [{ id: subject, subject, receivedAt: '2026-10-04T12:00:00Z', bodyText: subject }],
            virtualEmailsList: [],
        });
        let finish!: (value: unknown) => void;
        const queryMails = vi
            .fn()
            .mockResolvedValueOnce(result('initial'))
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        finish = resolve;
                    }),
            )
            .mockResolvedValueOnce(result('latest'));
        let callbacks!: MailStreamCallbacks;
        const watchMailEvents = vi.fn((_code: string, next: MailStreamCallbacks, signal: AbortSignal) => {
            callbacks = next;
            return new Promise<void>(resolve =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
            );
        });
        const api = { queryMails, watchMailEvents } as unknown as ShopApi;
        await act(async () => {
            root.render(<MailQueryPage api={api} marketCode="store-a" initialCode="BUY-AAAA-BBBB" />);
            await Promise.resolve();
        });
        const pending: Array<Promise<void>> = [];
        await act(async () => {
            pending.push(Promise.resolve(callbacks.onChange()));
            await vi.advanceTimersByTimeAsync(100);
        });
        await act(async () => {
            pending.push(Promise.resolve(callbacks.onChange()));
            await vi.advanceTimersByTimeAsync(100);
            finish(result('stale'));
            await Promise.all(pending);
        });
        expect(queryMails).toHaveBeenCalledTimes(3);
        expect(container.textContent).toContain('latest');
        expect(container.textContent).not.toContain('stale');
        let staleFinish!: (value: unknown) => void;
        queryMails.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    staleFinish = resolve;
                }),
        );
        await act(async () => {
            container.querySelector<HTMLButtonElement>('#refreshNowBtn')?.click();
            await Promise.resolve();
        });
        const oldSignal = queryMails.mock.calls[3][1] as AbortSignal;
        act(() => {
            container.querySelector<HTMLButtonElement>('#backQueryBtn')?.click();
        });
        expect(oldSignal.aborted).toBe(true);
        const input = container.querySelector<HTMLInputElement>('#codeInput');
        if (!input) throw new Error('Missing query input');
        act(() => setInputValue(input, 'BUY-CCCC-DDDD'));
        queryMails.mockResolvedValue(result('new query'));
        await act(async () => {
            container.querySelector<HTMLButtonElement>('#queryBtn')?.click();
            await Promise.resolve();
        });
        await act(async () => {
            staleFinish(result('old response'));
            await Promise.resolve();
        });
        expect(container.textContent).toContain('new query');
        expect(container.textContent).not.toContain('old response');
    });

    it('shows toast when attempting query with empty input', async () => {
        const mockApi = {
            queryMails: vi.fn(),
        };

        act(() => {
            root.render(
                <MailQueryPage api={mockApi as unknown as ShopApi} marketCode="my-malaysia" language="zh" />,
            );
        });

        const queryBtn = container.querySelector<HTMLButtonElement>('#queryBtn');
        await act(async () => {
            queryBtn?.click();
            await Promise.resolve();
        });

        expect(mockApi.queryMails).not.toHaveBeenCalled();
        expect(container.textContent).toContain('请输入专属查询码');
    });
});
