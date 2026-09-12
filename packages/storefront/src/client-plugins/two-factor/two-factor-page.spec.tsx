// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveCustomer } from '../../types';
import type { TwoFactorAccount } from './types';

import { TwoFactorPage } from './two-factor-page';

const storageState = vi.hoisted(() => ({
    available: false,
    accounts: [] as TwoFactorAccount[],
}));

vi.mock('./use-browser-vault', () => ({
    useBrowserVault: () => ({
        accounts: storageState.accounts,
        available: storageState.available,
        exists: false,
        legacy: false,
        unlocked: false,
        busy: false,
        error: false,
        canWrite: true,
        save: vi.fn().mockResolvedValue(true),
        lock: vi.fn(),
        open: vi.fn(),
        backup: vi.fn(),
    }),
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

describe('TwoFactorPage', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        storageState.available = false;
        storageState.accounts = [];
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('allows a temporary account when persistent storage is unavailable', async () => {
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
        expect(saveButton?.disabled).toBe(false);
    });

    it('collapses both explanations by default and expands them on request', async () => {
        storageState.available = true;
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

        const secretLabel = container.querySelector<HTMLLabelElement>(
            'label[for="storefront-two-factor-secret"]',
        );
        expect(secretLabel?.classList.contains('sr-only')).toBe(true);
        expect(container.querySelector('#storefront-two-factor-query-description')).toBeNull();
        expect(container.querySelector('#storefront-two-factor-privacy-details')).toBeNull();

        const queryDescriptionButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
            button => button.textContent?.includes('查看说明'),
        );
        const privacyButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button =>
            button.textContent?.includes('数据与隐私'),
        );
        expect(queryDescriptionButton?.getAttribute('aria-expanded')).toBe('false');
        expect(privacyButton?.getAttribute('aria-expanded')).toBe('false');

        act(() => {
            queryDescriptionButton?.click();
            privacyButton?.click();
        });

        expect(container.querySelector('#storefront-two-factor-query-description')?.textContent).toContain(
            '密钥不会上传到服务器',
        );
        expect(container.querySelector('#storefront-two-factor-privacy-details')?.textContent).toContain(
            '默认临时使用',
        );
    });

    it('keeps each account compact and moves secondary details into the more menu', async () => {
        storageState.available = true;
        storageState.accounts = [
            {
                id: 'account-1',
                projectName: '测试',
                secret: 'JBSWY3DPEHPK3PXP',
                createdAt: '2026-08-29T00:00:00.000Z',
                lastUsedAt: null,
            },
        ];

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

        const accountCard = [...container.querySelectorAll<HTMLElement>('article')].find(article =>
            article.textContent?.includes('测试'),
        );
        expect(accountCard).toBeDefined();
        expect(accountCard?.children).toHaveLength(2);
        expect(accountCard?.querySelector('[role="dialog"]')).toBeNull();

        const moreButton = accountCard?.querySelector<HTMLButtonElement>(
            'button[aria-label="测试 账号详情与操作"]',
        );
        expect(moreButton?.getAttribute('aria-expanded')).toBe('false');

        act(() => moreButton?.click());

        const moreMenu = accountCard?.querySelector<HTMLElement>('[role="dialog"]');
        expect(moreButton?.getAttribute('aria-expanded')).toBe('true');
        expect(moreMenu?.textContent).toContain('最近使用: 尚未使用');
        expect(moreMenu?.textContent).toContain('显示密钥');
        expect(moreMenu?.textContent).toContain('编辑');
        expect(moreMenu?.textContent).toContain('删除');
    });

    it('keeps batch import and add account buttons aligned on the right without wrapping', async () => {
        storageState.available = true;
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

        const headerTitle = [...container.querySelectorAll<HTMLHeadingElement>('h2')].find(h2 =>
            h2.textContent?.includes('2FA 账号列表'),
        );
        expect(headerTitle).toBeDefined();

        const headerRow = headerTitle?.closest('div')?.parentElement;
        expect(headerRow).not.toBeNull();
        expect(headerRow?.className).toContain('flex');
        expect(headerRow?.className).toContain('items-center');
        expect(headerRow?.className).toContain('justify-between');
        expect(headerRow?.className).not.toContain('flex-wrap');

        const buttonGroup = headerRow?.lastElementChild as HTMLElement;
        expect(buttonGroup?.className).toContain('flex');
        expect(buttonGroup?.className).toContain('shrink-0');
        expect(buttonGroup?.className).toContain('items-center');
        expect(buttonGroup?.className).not.toContain('flex-wrap');

        const batchBtn = [...buttonGroup.querySelectorAll('button')].find(btn =>
            btn.textContent?.includes('批量导入'),
        );
        const addBtn = [...buttonGroup.querySelectorAll('button')].find(btn =>
            btn.textContent?.includes('添加账号'),
        );
        expect(batchBtn).toBeDefined();
        expect(addBtn).toBeDefined();
        expect(batchBtn?.className).toContain('shrink-0');
        expect(batchBtn?.className).toContain('whitespace-nowrap');
        expect(addBtn?.className).toContain('shrink-0');
        expect(addBtn?.className).toContain('whitespace-nowrap');
    });
});
