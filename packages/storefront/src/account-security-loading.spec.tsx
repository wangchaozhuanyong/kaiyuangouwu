// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { AccountSecurityPage } from './account-security-page';
import { ActiveCustomer, FraudRiskCase } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const customer = {
    id: 'fixture-customer',
    firstName: 'Fixture',
    lastName: '',
    emailAddress: 'fixture@example.test',
    addresses: [],
} as unknown as ActiveCustomer;
const riskCase = {
    id: 'fixture-risk',
    caseCode: 'FIXTURE-REVIEW',
    status: 'OPEN',
    orderId: null,
    appeals: [],
} as unknown as FraudRiskCase;

it('never inserts an empty risk card while checking an account without cases', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const render = (loading: boolean) =>
        act(() =>
            root.render(
                <AccountSecurityPage
                    customer={customer}
                    language="zh"
                    storefrontName="Fixture"
                    onBack={vi.fn()}
                    onAvatarChange={vi.fn()}
                    onLogout={vi.fn()}
                    fraudRiskCases={[]}
                    fraudRiskLoading={loading}
                />,
            ),
        );
    try {
        render(true);
        expect(host.textContent).not.toContain('订单风险复核');
        const groups = host.querySelectorAll('.security-group').length;
        render(false);
        expect(host.querySelectorAll('.security-group')).toHaveLength(groups);
        render(true);
        expect(host.querySelectorAll('.security-group')).toHaveLength(groups);
        expect(host.textContent).not.toContain('正在读取复核状态');
    } finally {
        act(() => root.unmount());
    }
});

it('keeps a confirmed risk card and typed appeal during refresh, including failed refreshes', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const appeal = vi.fn();
    const retry = vi.fn();
    const render = (loading: boolean, error?: string) =>
        act(() =>
            root.render(
                <AccountSecurityPage
                    customer={customer}
                    language="zh"
                    storefrontName="Fixture"
                    onBack={vi.fn()}
                    onAvatarChange={vi.fn()}
                    onLogout={vi.fn()}
                    fraudRiskCases={[riskCase]}
                    fraudRiskLoading={loading}
                    onAppealFraudRiskCase={appeal}
                    loadError={error}
                    onRetry={retry}
                />,
            ),
        );
    try {
        render(false);
        const open = host.querySelector<HTMLButtonElement>('.security-risk-open');
        if (!open) throw new Error('Expected the confirmed risk action');
        expect(open.disabled).toBe(false);
        act(() => open.click());
        const field = host.querySelector('textarea');
        if (!field) throw new Error('Expected the appeal field');
        render(true);
        expect(host.querySelector('.security-risk-case')?.textContent).toContain('FIXTURE-REVIEW');
        expect(host.querySelector('textarea')).toBe(field);
        expect(host.textContent).not.toContain('正在读取复核状态');
        render(true, 'Fixture refresh error');
        expect(host.querySelector('textarea')).toBe(field);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('Fixture refresh error');
        const retryButton = host.querySelector<HTMLButtonElement>('[role="alert"] button');
        if (!retryButton) throw new Error('Expected the retry action');
        act(() => retryButton.click());
        expect(retry).toHaveBeenCalledOnce();
        expect(appeal).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
    }
});
