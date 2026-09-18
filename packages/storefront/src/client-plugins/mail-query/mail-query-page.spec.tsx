// @vitest-environment jsdom
/* eslint-disable import/order, @typescript-eslint/unbound-method -- Test harness setup */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShopApi } from '../../api';
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

    it('renders full portal UI with zero text flickering and complete sections', () => {
        const mockApi = {
            queryMails: vi.fn(),
        };

        const onBack = vi.fn();

        act(() => {
            root.render(
                <MailQueryPage
                    api={mockApi as unknown as ShopApi}
                    brandingName="大马通"
                    language="zh"
                    onBack={onBack}
                />,
            );
        });

        // Top nav
        expect(container.querySelector('.top-nav')).not.toBeNull();
        expect(container.textContent).toContain('返回商城服务');
        expect(container.textContent).toContain('邮件查询服务');

        // Hero section
        expect(container.querySelector('.hero-section')).not.toBeNull();
        expect(container.textContent).toContain('大马通 · 邮件中继服务');
        expect(container.textContent).toContain('邮件验证码实时查询中心');
        expect(container.textContent).toContain('输入专属查询码，实时查收验证码');

        // Query card
        expect(container.querySelector('.query-card')).not.toBeNull();
        expect(container.querySelector('#codeInput')).not.toBeNull();
        expect(container.querySelector('#pasteBtn')).not.toBeNull();
        expect(container.querySelector('#queryBtn')).not.toBeNull();

        // FAQ section
        expect(container.querySelector('.faq-section')).not.toBeNull();
        expect(container.textContent).toContain('常见问题与使用指南');
        expect(container.textContent).toContain('1. 查询码从哪里获取？');
        expect(container.textContent).toContain('2. 验证码多久能收到？');
        expect(container.textContent).toContain('3. 没收到邮件怎么办？');

        // Footer
        expect(container.querySelector('.portal-footer')).not.toBeNull();
        expect(container.textContent).toContain('数据经端到端加密与单向中继保护');
        expect(container.textContent).toContain('© 大马通 · 智能商业服务平台 · 联系客服');

        // Back button action
        const backBtn = container.querySelector<HTMLButtonElement>('#navBackLink');
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
                <MailQueryPage api={mockApi as unknown as ShopApi} brandingName="大马通" language="zh" />,
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
        const stored = localStorage.getItem('icloud_relay_recent_queries');
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
                <MailQueryPage api={mockApi as unknown as ShopApi} brandingName="大马通" language="zh" />,
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
    });

    it('shows toast when attempting query with empty input', async () => {
        const mockApi = {
            queryMails: vi.fn(),
        };

        act(() => {
            root.render(<MailQueryPage api={mockApi as unknown as ShopApi} language="zh" />);
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
