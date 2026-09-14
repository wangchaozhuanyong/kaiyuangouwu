// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { StoreCouponRecord } from '../../graphql/marketing.graphql';
import { GrantCouponDialog } from './promotion-editors';

const mocks = vi.hoisted(() => ({ grant: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useMutation: () => [mocks.grant, { loading: false }],
    useQuery: () => ({
        data: {
            customers: {
                totalItems: 1,
                items: [
                    {
                        id: '27',
                        firstName: '模拟',
                        lastName: '林',
                        emailAddress: 'sim@example.test',
                        phoneNumber: null,
                    },
                ],
            },
        },
        loading: false,
    }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('GrantCouponDialog', () => {
    it('explains manual repeat grants and keeps rejection visible until a successful retry', async () => {
        mocks.grant.mockReset().mockRejectedValueOnce(new Error('优惠券已领完')).mockResolvedValueOnce({});
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onSaved = vi.fn(async () => undefined);
        const onError = vi.fn();
        try {
            await act(async () =>
                root.render(
                    <GrantCouponDialog
                        coupon={{ id: '4', name: '模拟订单九折' } as StoreCouponRecord}
                        pending={false}
                        onClose={vi.fn()}
                        onSaved={onSaved}
                        onError={onError}
                    />,
                ),
            );
            expect(host.textContent).toContain('管理员可重复发放给同一客户');
            expect(host.textContent).not.toContain('同一客户的领取上限仍由后端校验');
            const submit = [...host.querySelectorAll('button')].find(
                button => button.textContent === '发放',
            )!;
            await act(async () => submit.click());
            expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
                '优惠券已领完',
            );
            expect(onSaved).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledOnce();
            await act(async () => submit.click());
            expect(host.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
            expect(onSaved).toHaveBeenCalledOnce();
            expect(mocks.grant).toHaveBeenLastCalledWith({
                variables: { campaignId: '4', customerId: '27' },
            });
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});
