import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    defineDashboardExtension: vi.fn(),
}));

vi.mock('@vendure/dashboard', () => ({
    defineDashboardExtension: mocks.defineDashboardExtension,
}));
vi.mock('./merchant-navigation', () => ({ restrictPlatformNavigation: vi.fn() }));
vi.mock('./merchant-password-gate', () => ({ MerchantPasswordGate: vi.fn() }));
vi.mock('./my-store-profile-page', () => ({ myStoreProfileRoute: {} }));
vi.mock('./store-commerce-settings-page', () => ({ storeCommerceSettingsRoute: {} }));
vi.mock('./store-management-page', () => ({ storeManagementRoute: {} }));
vi.mock('./store-provisioning-page', () => ({ storeProvisioningRoute: {} }));
vi.mock('./storefront-promotion-page', () => ({ storefrontPromotionRoute: {} }));
vi.mock('./store-promotion-campaign-page', () => ({
    storeCouponCampaignRoute: {},
    storeFlashSaleRoute: {},
    storePromotionCampaignRoute: {},
}));
vi.mock('./system-announcement-page', () => ({ systemAnnouncementRoute: {} }));
vi.mock('./usdt-payment-management-page', () => ({ usdtPaymentManagementRoute: {} }));

describe('store management dashboard extension', () => {
    beforeEach(() => {
        mocks.defineDashboardExtension.mockClear();
    });

    it('mounts the initial password gate before the authenticated layout bootstraps', async () => {
        await import('./index.js');

        expect(mocks.defineDashboardExtension).toHaveBeenCalledWith(
            expect.objectContaining({
                customProviders: [
                    expect.objectContaining({
                        id: 'merchant-initial-password-gate',
                        location: 'app',
                    }),
                ],
            }),
        );
    });
});
