// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line import/order -- Prettier keeps this type-only import with the value group.
import type { ReferralProgram } from './types';

import { AccountPage } from './pages/account-page';
import { createStorefrontQueryClient } from './query-client';
import { writeCachedReferralProgram } from './referral-client-feature';
import { AccountPageContext } from './storefront-page-contexts';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

describe('cached referral feature refresh', () => {
    it.each([true, false])(
        'revalidates a cached opposite feature flag on mount: enabled=%s',
        async enabled => {
            (
                globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
            ).IS_REACT_ACT_ENVIRONMENT = true;
            const market = {
                code: 'sim-referral-cache',
                defaultLanguageCode: 'zh_Hans',
                currencyCode: 'CNY',
                countryCode: 'CN',
                locale: 'zh-CN',
                label: '模拟',
            };
            const program = {
                enabled,
                channelId: '16',
                rewardRate: 5,
                releaseDelayDays: 0,
                minimumOrderAmount: 0,
                maxRewardPerOrder: null,
                allowBalanceSpend: true,
                attributionWindowDays: 7,
                defaultPosterTemplate: 'BRAND_MINIMAL',
                posterTemplates: ['BRAND_MINIMAL'],
            } as ReferralProgram;
            writeCachedReferralProgram(market.code, { ...program, enabled: !enabled });
            const api = { referralProgram: vi.fn().mockResolvedValue(program) };
            const client = createStorefrontQueryClient();
            const host = document.createElement('div');
            document.body.append(host);
            const root = createRoot(host);
            try {
                await act(async () => {
                    root.render(
                        <QueryClientProvider client={client}>
                            <AccountPageContext.Provider
                                value={
                                    {
                                        api,
                                        customer: null,
                                        products: [],
                                        market,
                                        locale: 'zh-CN',
                                        language: 'zh',
                                        storefrontName: '模拟店',
                                        logoUrl: null,
                                        accountHeroImageUrl: null,
                                        favoriteProductCount: 0,
                                        announcementCount: 0,
                                        couponCount: 0,
                                        onContentTarget: vi.fn(),
                                        onLogout: vi.fn(),
                                    } as never
                                }
                            >
                                <AccountPage />
                            </AccountPageContext.Provider>
                        </QueryClientProvider>,
                    );
                    await Promise.resolve();
                });
                expect(api.referralProgram).toHaveBeenCalledTimes(1);
                const cached = localStorage.getItem('storefront:referral-program:sim-referral-cache');
                expect(cached).not.toBeNull();
                expect(JSON.parse(cached ?? '{}').enabled).toBe(enabled);
            } finally {
                act(() => root.unmount());
                host.remove();
                client.clear();
                localStorage.removeItem('storefront:referral-program:sim-referral-cache');
            }
        },
    );
});
