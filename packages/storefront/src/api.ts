import type { ShopApiContext } from './api/client-context';
import type { ImageStudioApi } from './api/image-studio';
import type { IcloudMailItem, IcloudQueryResult, MailQueryApi } from './api/mail-query';
import type { RealtimeApi } from './api/realtime';
import type { ReferralsApi } from './api/referrals';
import type { CartController } from './cart/cart-controller';
import type { StorefrontPageViewInput } from './storefront-traffic';
import type {
    ActiveCustomer,
    AfterSalesRequest,
    Asset,
    CollectionSummary,
    ConfirmAfterSalesReplacementInput,
    CreateAfterSalesRequestInput,
    CustomerAddress,
    CustomerAddressInput,
    CustomerAddressUpdateInput,
    CustomerAvatarHistoryEntry,
    CustomerDeliveryEmail,
    DataSubjectExportPayload,
    DataSubjectRequest,
    FraudRiskCase,
    MarketConfig,
    MyReferralOverview,
    Order,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    ReferralBalancePaymentResult,
    ReferralProgram,
    RegisterCustomerInput,
    StoreCommerceMode,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCatalogInput,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontContentResponse,
    StorefrontCouponCampaign,
    StorefrontRegistrationConsentInput,
    StorefrontUsdtCheckoutQuote,
    SubmitAfterSalesReturnShipmentInput,
    SubmitStorefrontReviewInput,
    VendureLanguageCode,
} from './types';

import { type StorefrontVisualPresetConfig } from '../../storefront-content-plugin/src/visual-presets';

import { AccountApi } from './api/account';
import { AuthTokenState } from './api/auth-token-state';
import { CartCheckoutApi } from './api/cart-checkout';
import { CatalogApi } from './api/catalog';
import { ContentReviewsApi } from './api/content-reviews';
import {
    API_URL,
    authTokenStorageKey,
    calculateStorefrontRealtimeRetry,
    createRequestSignal,
    ErrorResult,
    isStorefrontQuery,
    parseShopApiResponse,
    SEND_CLIENT_CHANNEL_TOKEN,
    SHOP_API_QUERY_TIMEOUT_MS,
    ShopApiError,
    ShopApiTimeoutError,
    StorefrontRealtimeConnectionError,
} from './api/helpers';
import { publishAuthSessionChange } from './auth-session-sync';
import { StorefrontRealtimeEvent } from './realtime-updates';

export {
    calculateStorefrontRealtimeRetry,
    SHOP_API_QUERY_TIMEOUT_MS,
    ShopApiError,
    ShopApiTimeoutError,
    StorefrontRealtimeConnectionError,
};
export type { IcloudMailItem, IcloudQueryResult };

export class ShopApi {
    private readonly authTokens: AuthTokenState;
    private storefrontCatalogAvailable: boolean | null = null;
    readonly contentReviewsApi: ContentReviewsApi;
    private readonly catalogApi: CatalogApi;
    private readonly accountApi: AccountApi;
    private readonly createReferralsApi: () => Promise<ReferralsApi>;
    private readonly createImageStudioApi: () => Promise<ImageStudioApi>;
    private readonly createMailQueryApi: () => Promise<MailQueryApi>;
    readonly watchMailEvents: MailQueryApi['watchMailEvents'];
    private readonly cartCheckoutApi: CartCheckoutApi;
    private readonly createRealtimeApi: () => Promise<RealtimeApi>;
    constructor(
        private readonly market: MarketConfig,
        private readonly languageCode: VendureLanguageCode = market.defaultLanguageCode,
    ) {
        this.authTokens = new AuthTokenState(authTokenStorageKey(market.code));
        const ctx: ShopApiContext = {
            market: this.market,
            languageCode: this.languageCode,
            getAuthToken: () => this.authTokens.value,
            createAuthTokenCapture: () => this.authTokens.createCapture(),
            clearAuthToken: () => this.authTokens.clear(),
            request: (q, v, s, t, r, c) => this.request(q, v, s, t, r, false, c),
            authenticationRequest: (q, v) => this.request(q, v, undefined, undefined, false, true),
            assertCart: res => this.assertCart(res),
            assertCheckoutSession: res => this.assertCheckoutSession(res),
            assertOrder: res => this.assertOrder(res),
            assertNoError: res => this.assertNoError(res),
            getStorefrontCatalogAvailable: () => this.storefrontCatalogAvailable,
            setStorefrontCatalogAvailable: val => {
                this.storefrontCatalogAvailable = val;
            },
        };
        this.contentReviewsApi = new ContentReviewsApi(ctx);
        this.catalogApi = new CatalogApi(ctx);
        this.accountApi = new AccountApi(ctx);
        this.createReferralsApi = async () => {
            const { ReferralsApi } = await import('./api/referrals');
            return new ReferralsApi(ctx);
        };
        this.createImageStudioApi = async () => {
            const { ImageStudioApi } = await import('./api/image-studio');
            return new ImageStudioApi(ctx);
        };
        this.createMailQueryApi = async () => {
            const { MailQueryApi } = await import('./api/mail-query');
            return new MailQueryApi(ctx);
        };
        this.watchMailEvents = async (code, callbacks, signal) => {
            if (signal.aborted) return;
            const mail = await this.createMailQueryApi();
            if (signal.aborted) return;
            return mail.watchMailEvents(code, callbacks, signal);
        };
        this.cartCheckoutApi = new CartCheckoutApi(ctx);
        this.createRealtimeApi = async () => {
            const { RealtimeApi } = await import('./api/realtime');
            return new RealtimeApi(ctx);
        };
    }

    enableCartCommands(controller: CartController): void {
        this.cartCheckoutApi.connect(controller);
    }

    async storefrontConfig(signal?: AbortSignal): Promise<StorefrontConfig> {
        return this.contentReviewsApi.storefrontConfig(signal);
    }

    async storefrontVisualPreset(signal?: AbortSignal): Promise<StorefrontVisualPresetConfig> {
        return this.contentReviewsApi.storefrontVisualPreset(signal);
    }

    async storefrontContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        return this.contentReviewsApi.storefrontContent(signal);
    }

    async storefrontAccountContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        return this.contentReviewsApi.storefrontAccountContent(signal);
    }

    activeFlashSales = (signal?: AbortSignal) => this.contentReviewsApi.activeFlashSales(signal);

    async activeCouponCampaigns(signal?: AbortSignal): Promise<StorefrontCouponCampaign[]> {
        return this.contentReviewsApi.activeCouponCampaigns(signal);
    }

    async products(take = 12, signal?: AbortSignal): Promise<Product[]> {
        return this.catalogApi.products(take, signal);
    }

    async product(id: string, signal?: AbortSignal): Promise<Product | null> {
        return this.catalogApi.product(id, signal);
    }

    async productsByIds(ids: string[], signal?: AbortSignal): Promise<Product[]> {
        return this.catalogApi.productsByIds(ids, signal);
    }

    async searchProducts(
        term: string,
        sort: ProductSearchSort = 'recommended',
        skip = 0,
        take = 20,
        collectionId?: string,
        signal?: AbortSignal,
    ): Promise<ProductSearchPage> {
        return this.catalogApi.searchProducts(term, sort, skip, take, collectionId, signal);
    }

    async catalog(input: StorefrontCatalogInput, signal?: AbortSignal): Promise<ProductSearchPage> {
        return this.catalogApi.catalog(input, signal);
    }

    dailyRecommendations = (signal?: AbortSignal) => this.catalogApi.dailyRecommendations(signal);

    async productSales(productIds: string[], signal?: AbortSignal): Promise<Record<string, number>> {
        return this.catalogApi.productSales(productIds, signal);
    }

    async collections(signal?: AbortSignal): Promise<CollectionSummary[]> {
        return this.catalogApi.collections(signal);
    }

    async activeCustomer(signal?: AbortSignal): Promise<ActiveCustomer | null> {
        return this.accountApi.activeCustomer(signal);
    }

    async uploadCustomerAvatar(file: File): Promise<Asset> {
        return this.accountApi.uploadCustomerAvatar(file);
    }

    async customerAvatarHistory(signal?: AbortSignal): Promise<CustomerAvatarHistoryEntry[]> {
        return this.accountApi.customerAvatarHistory(signal);
    }

    async restoreCustomerAvatar(retentionId: string): Promise<Asset> {
        return this.accountApi.restoreCustomerAvatar(retentionId);
    }

    async removeCustomerAvatar(): Promise<boolean> {
        return this.accountApi.removeCustomerAvatar();
    }

    async dataSubjectRequests(signal?: AbortSignal): Promise<DataSubjectRequest[]> {
        return this.accountApi.dataSubjectRequests(signal);
    }

    async exportPersonalData(password: string): Promise<DataSubjectExportPayload> {
        return this.accountApi.exportPersonalData(password);
    }

    async requestAccountClosure(password: string): Promise<DataSubjectRequest> {
        return this.accountApi.requestAccountClosure(password);
    }

    async cancelAccountClosure(): Promise<DataSubjectRequest> {
        return this.accountApi.cancelAccountClosure();
    }

    async fraudRiskCases(signal?: AbortSignal): Promise<FraudRiskCase[]> {
        return this.accountApi.fraudRiskCases(signal);
    }

    appealFraudRiskCase: AccountApi['appealFraudRiskCase'] = (...args) =>
        this.accountApi.appealFraudRiskCase(...args);

    customerOrders: AccountApi['customerOrders'] = (...args) => this.accountApi.customerOrders(...args);

    customerOrderCounts: AccountApi['customerOrderCounts'] = (...args) =>
        this.accountApi.customerOrderCounts(...args);

    order: AccountApi['order'] = (...args) => this.accountApi.order(...args);

    digitalDeliveryStatuses: AccountApi['digitalDeliveryStatuses'] = (...args) =>
        this.accountApi.digitalDeliveryStatuses(...args);

    claimDigitalDelivery: AccountApi['claimDigitalDelivery'] = (...args) =>
        this.accountApi.claimDigitalDelivery(...args);

    orderAdditionalPaymentQuote: AccountApi['orderAdditionalPaymentQuote'] = (...args) =>
        this.accountApi.orderAdditionalPaymentQuote(...args);

    addPaymentToModifiedOrder: AccountApi['addPaymentToModifiedOrder'] = (...args) =>
        this.accountApi.addPaymentToModifiedOrder(...args);

    orderByConfirmationToken: AccountApi['orderByConfirmationToken'] = (...args) =>
        this.accountApi.orderByConfirmationToken(...args);

    createModifiedOrderUsdtQuote: AccountApi['createModifiedOrderUsdtQuote'] = (...args) =>
        this.accountApi.createModifiedOrderUsdtQuote(...args);

    useModifiedOrderReferralBalance: AccountApi['useModifiedOrderReferralBalance'] = (...args) =>
        this.accountApi.useModifiedOrderReferralBalance(...args);

    createOrderConfirmationToken: AccountApi['createOrderConfirmationToken'] = (...args) =>
        this.accountApi.createOrderConfirmationToken(...args);

    cancelMyAuthorizedOrder: AccountApi['cancelMyAuthorizedOrder'] = (...args) =>
        this.accountApi.cancelMyAuthorizedOrder(...args);

    confirmFulfillmentDelivery: AccountApi['confirmFulfillmentDelivery'] = (...args) =>
        this.accountApi.confirmFulfillmentDelivery(...args);

    async afterSalesRequests(signal?: AbortSignal): Promise<AfterSalesRequest[]> {
        return this.contentReviewsApi.afterSalesRequests(signal);
    }

    async createAfterSalesRequest(input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        return this.contentReviewsApi.createAfterSalesRequest(input);
    }

    async cancelAfterSalesRequest(id: string): Promise<AfterSalesRequest> {
        return this.contentReviewsApi.cancelAfterSalesRequest(id);
    }

    async submitAfterSalesReturnShipment(
        input: SubmitAfterSalesReturnShipmentInput,
    ): Promise<AfterSalesRequest> {
        return this.contentReviewsApi.submitAfterSalesReturnShipment(input);
    }

    async confirmAfterSalesReplacement(input: ConfirmAfterSalesReplacementInput): Promise<AfterSalesRequest> {
        return this.contentReviewsApi.confirmAfterSalesReplacement(input);
    }

    reviewSettings = (signal?: AbortSignal) => this.contentReviewsApi.reviewSettings(signal);

    productReviews = (
        productId: string,
        options: { skip?: number; take?: number } = { take: 20 },
        signal?: AbortSignal,
    ) => this.contentReviewsApi.productReviews(productId, options, signal);

    myReviews = (signal?: AbortSignal) => this.contentReviewsApi.myReviews(signal);

    reviewCandidates = (options: { skip?: number; take?: number } = {}, signal?: AbortSignal) =>
        this.contentReviewsApi.reviewCandidates(options, signal);

    submitReview = (input: SubmitStorefrontReviewInput) => this.contentReviewsApi.submitReview(input);

    async login(emailAddress: string, password: string, rememberMe = true): Promise<void> {
        await this.accountApi.login(emailAddress, password, rememberMe);
        this.publishCookieAuthenticationChange();
    }

    async authenticateWithGoogle(
        credential: string,
        consent: StorefrontRegistrationConsentInput,
        options: { rememberMe?: boolean; inviteCode?: string; referralSource?: string } = {},
    ): Promise<void> {
        await this.accountApi.authenticateWithGoogle(credential, consent, options);
        this.publishCookieAuthenticationChange();
    }

    async referralProgram(signal?: AbortSignal): Promise<ReferralProgram> {
        return (await this.createReferralsApi()).referralProgram(signal);
    }

    async validateReferralInviteCode(code: string, signal?: AbortSignal): Promise<boolean> {
        return (await this.createReferralsApi()).validateReferralInviteCode(code, signal);
    }

    async myReferralOverview(signal?: AbortSignal): Promise<MyReferralOverview> {
        return (await this.createReferralsApi()).myReferralOverview(signal);
    }

    async registerCustomerAccount(
        input: RegisterCustomerInput,
        consent: StorefrontRegistrationConsentInput,
        inviteCode?: string,
        source?: 'LINK' | 'POSTER' | 'CODE',
    ): Promise<void> {
        return (await this.createReferralsApi()).registerCustomerAccount(input, consent, inviteCode, source);
    }

    async useReferralBalance(amount: number): Promise<ReferralBalancePaymentResult> {
        return (await this.createReferralsApi()).useReferralBalance(amount);
    }

    imageStudioConfig: ImageStudioApi['imageStudioConfig'] = async (...args) =>
        (await this.createImageStudioApi()).imageStudioConfig(...args);

    previewImageGenerationPrompt: ImageStudioApi['previewImageGenerationPrompt'] = async (...args) =>
        (await this.createImageStudioApi()).previewImageGenerationPrompt(...args);

    imageStudioBalance: ImageStudioApi['imageStudioBalance'] = async (...args) =>
        (await this.createImageStudioApi()).imageStudioBalance(...args);

    imageStudioWallet: ImageStudioApi['imageStudioWallet'] = async (...args) =>
        (await this.createImageStudioApi()).imageStudioWallet(...args);

    imagePromptQuotaStatus: ImageStudioApi['imagePromptQuotaStatus'] = async (...args) =>
        (await this.createImageStudioApi()).imagePromptQuotaStatus(...args);

    imageModelQuotaStatus: ImageStudioApi['imageModelQuotaStatus'] = async (...args) =>
        (await this.createImageStudioApi()).imageModelQuotaStatus(...args);

    optimizeImagePrompt: ImageStudioApi['optimizeImagePrompt'] = async (...args) =>
        (await this.createImageStudioApi()).optimizeImagePrompt(...args);

    recommendImageModel: ImageStudioApi['recommendImageModel'] = async (...args) =>
        (await this.createImageStudioApi()).recommendImageModel(...args);

    uploadImageReference: ImageStudioApi['uploadImageReference'] = async (...args) =>
        (await this.createImageStudioApi()).uploadImageReference(...args);

    createImageGeneration: ImageStudioApi['createImageGeneration'] = async (...args) =>
        (await this.createImageStudioApi()).createImageGeneration(...args);

    myImageGenerationJob: ImageStudioApi['myImageGenerationJob'] = async (...args) =>
        (await this.createImageStudioApi()).myImageGenerationJob(...args);

    myImageGenerationJobs: ImageStudioApi['myImageGenerationJobs'] = async (...args) =>
        (await this.createImageStudioApi()).myImageGenerationJobs(...args);
    releaseImageReference: ImageStudioApi['releaseImageReference'] = async (...args) =>
        (await this.createImageStudioApi()).releaseImageReference(...args);

    cancelQueuedImageGeneration: ImageStudioApi['cancelQueuedImageGeneration'] = async (...args) =>
        (await this.createImageStudioApi()).cancelQueuedImageGeneration(...args);

    deleteMyGeneratedImage: ImageStudioApi['deleteMyGeneratedImage'] = async (...args) =>
        (await this.createImageStudioApi()).deleteMyGeneratedImage(...args);

    deleteMyImageGenerationJob: ImageStudioApi['deleteMyImageGenerationJob'] = async (...args) =>
        (await this.createImageStudioApi()).deleteMyImageGenerationJob(...args);

    async recordStorefrontVisit(): Promise<boolean> {
        return (await this.createReferralsApi()).recordStorefrontVisit();
    }

    async recordStorefrontPageView(input: StorefrontPageViewInput): Promise<boolean> {
        return (await this.createReferralsApi()).recordStorefrontPageView(input);
    }

    async recordAnalyticsConsent(input: { consentId: string; granted: boolean; locale: string }) {
        return (await this.createReferralsApi()).recordAnalyticsConsent(input);
    }

    async refreshCustomerVerification(emailAddress: string): Promise<void> {
        return this.accountApi.refreshCustomerVerification(emailAddress);
    }

    async verifyCustomerAccount(token: string, password?: string): Promise<void> {
        await this.accountApi.verifyCustomerAccount(token, password);
        this.publishCookieAuthenticationChange();
    }

    async requestPasswordReset(emailAddress: string): Promise<void> {
        return this.accountApi.requestPasswordReset(emailAddress);
    }

    async resetPassword(token: string, password: string): Promise<void> {
        await this.accountApi.resetPassword(token, password);
        this.publishCookieAuthenticationChange();
    }

    async logout(): Promise<void> {
        this.cartCheckoutApi.controller?.reset();
        await this.accountApi.logout();
        this.publishCookieAuthenticationChange();
    }

    async createAddress(input: CustomerAddressInput): Promise<CustomerAddress> {
        return this.accountApi.createAddress(input);
    }

    async updateAddress(input: CustomerAddressUpdateInput): Promise<CustomerAddress> {
        return this.accountApi.updateAddress(input);
    }

    async deleteAddress(id: string): Promise<void> {
        return this.accountApi.deleteAddress(id);
    }

    async cart(signal?: AbortSignal): Promise<StorefrontCart> {
        return this.cartCheckoutApi.cart(signal);
    }

    async addItem(productVariantId: string, expectedRevision: number, quantity = 1): Promise<StorefrontCart> {
        return this.cartCheckoutApi.addItem(productVariantId, expectedRevision, quantity);
    }

    async setLineQuantity(
        lineId: string,
        quantity: number,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        return this.cartCheckoutApi.setLineQuantity(lineId, quantity, expectedRevision);
    }

    async removeLines(lineIds: string[], expectedRevision: number): Promise<StorefrontCart> {
        return this.cartCheckoutApi.removeLines(lineIds, expectedRevision);
    }

    async setLinesSelected(
        lineIds: string[],
        selected: boolean,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        return this.cartCheckoutApi.setLinesSelected(lineIds, selected, expectedRevision);
    }

    async setAllLinesSelected(selected: boolean, expectedRevision: number): Promise<StorefrontCart> {
        return this.cartCheckoutApi.setAllLinesSelected(selected, expectedRevision);
    }

    async beginCheckout(expectedRevision: number): Promise<StorefrontCheckoutSession> {
        return this.cartCheckoutApi.beginCheckout(expectedRevision);
    }

    async preparePayment(expectedRevision: number): Promise<StorefrontCheckoutSession> {
        return this.cartCheckoutApi.preparePayment(expectedRevision);
    }

    async reopenCart(expectedRevision: number): Promise<StorefrontCart> {
        return this.cartCheckoutApi.reopenCart(expectedRevision);
    }

    myCouponsPage: CartCheckoutApi['myCouponsPage'] = (...args) =>
        this.cartCheckoutApi.myCouponsPage(...args);
    myCouponUsageRecordsPage: CartCheckoutApi['myCouponUsageRecordsPage'] = (...args) =>
        this.cartCheckoutApi.myCouponUsageRecordsPage(...args);
    myAvailableCoupons: CartCheckoutApi['myAvailableCoupons'] = (...args) =>
        this.cartCheckoutApi.myAvailableCoupons(...args);

    myCoupons: CartCheckoutApi['myCoupons'] = (...args) => this.cartCheckoutApi.myCoupons(...args);

    myCouponUsageRecords: CartCheckoutApi['myCouponUsageRecords'] = (...args) =>
        this.cartCheckoutApi.myCouponUsageRecords(...args);

    async claimCoupon(campaignId: string): Promise<StoreCustomerCoupon> {
        return this.cartCheckoutApi.claimCoupon(campaignId);
    }

    async applyCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        return this.cartCheckoutApi.applyCustomerCoupon(id);
    }

    async applyBestCustomerCoupon(): Promise<StoreCustomerCoupon | null> {
        return this.cartCheckoutApi.applyBestCustomerCoupon();
    }

    async removeCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        return this.cartCheckoutApi.removeCustomerCoupon(id);
    }

    async applyCouponCode(couponCode: string): Promise<Order> {
        return this.cartCheckoutApi.applyCouponCode(couponCode);
    }

    async removeCouponCode(couponCode: string): Promise<Order> {
        return this.cartCheckoutApi.removeCouponCode(couponCode);
    }

    async setOrderNote(customerNote: string): Promise<Order> {
        return this.cartCheckoutApi.setOrderNote(customerNote);
    }

    async setDeliveryEmail(
        inputOrEmail:
            | string
            | {
                  contactId?: string;
                  emailAddress?: string;
                  confirmEmailAddress?: string;
                  label?: string;
                  saveToAddressBook?: boolean;
                  isDefault?: boolean;
              },
    ): Promise<Order> {
        return this.cartCheckoutApi.setDeliveryEmail(inputOrEmail);
    }

    async myDeliveryEmails(signal?: AbortSignal): Promise<CustomerDeliveryEmail[]> {
        return this.cartCheckoutApi.myDeliveryEmails(signal);
    }

    async activeStoreCommerceMode(signal?: AbortSignal): Promise<StoreCommerceMode> {
        return this.cartCheckoutApi.activeStoreCommerceMode(signal);
    }

    async saveDeliveryEmail(input: {
        emailAddress: string;
        confirmEmailAddress: string;
        label?: string;
        isDefault?: boolean;
    }): Promise<CustomerDeliveryEmail> {
        return this.cartCheckoutApi.saveDeliveryEmail(input);
    }

    async setDefaultDeliveryEmail(id: string): Promise<CustomerDeliveryEmail> {
        return this.cartCheckoutApi.setDefaultDeliveryEmail(id);
    }

    async deleteDeliveryEmail(id: string): Promise<boolean> {
        return this.cartCheckoutApi.deleteDeliveryEmail(id);
    }

    async setCustomer(input: Record<string, string>): Promise<void> {
        return this.cartCheckoutApi.setCustomer(input);
    }

    setShippingAddress: CartCheckoutApi['setShippingAddress'] = input =>
        this.cartCheckoutApi.setShippingAddress(input);
    prepareShipping: CartCheckoutApi['prepareShipping'] = input =>
        this.cartCheckoutApi.prepareShipping(input);
    eligibleShippingMethods = () => this.cartCheckoutApi.eligibleShippingMethods();
    setShippingMethod = (id: string) => this.cartCheckoutApi.setShippingMethod(id);
    setShippingMethodWithCart = (id: string) => this.cartCheckoutApi.setShippingMethodWithCart(id);

    async setCurrencyForOrder(currencyCode: string): Promise<Order> {
        return this.cartCheckoutApi.setCurrencyForOrder(currencyCode);
    }

    setPaymentCurrencyForOrder = (currencyCode: string) =>
        this.cartCheckoutApi.setPaymentCurrencyForOrder(currencyCode);
    eligiblePaymentMethods = (signal?: AbortSignal, orderId?: string) =>
        this.cartCheckoutApi.eligiblePaymentMethods(signal, orderId);
    prefetchEligiblePaymentMethods = (orderId: string) =>
        this.cartCheckoutApi.prefetchEligiblePaymentMethods(orderId);
    cachedEligiblePaymentMethods = (orderId: string) =>
        this.cartCheckoutApi.cachedEligiblePaymentMethods(orderId);

    async createUsdtCheckoutQuote(signal?: AbortSignal): Promise<StorefrontUsdtCheckoutQuote> {
        return this.cartCheckoutApi.createUsdtCheckoutQuote(signal);
    }

    async addPaymentToOrder(method: string, metadata: Record<string, unknown> = {}): Promise<Order> {
        return this.cartCheckoutApi.addPaymentToOrder(method, metadata);
    }

    async watchRealtime(
        onEvent: (event: StorefrontRealtimeEvent) => void,
        signal: AbortSignal,
        onConnectionChange?: (connected: boolean) => void,
    ): Promise<void> {
        if (signal.aborted) return;
        const realtimeApi = await this.createRealtimeApi();
        if (signal.aborted) return;
        return realtimeApi.watchRealtime(onEvent, signal, onConnectionChange);
    }

    private async request<T>(
        query: string,
        variables?: Record<string, unknown>,
        signal?: AbortSignal,
        timeoutMs?: number,
        resultUnknownOnTimeout = false,
        authenticates = false,
        readCurrencyCode?: string,
    ): Promise<T> {
        const captureAuthToken = this.authTokens.createCapture(authenticates);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'language-code': this.languageCode,
        };
        if (SEND_CLIENT_CHANNEL_TOKEN) {
            headers['vendure-token'] = this.market.code;
        }
        if (this.authTokens.value) {
            headers.authorization = `Bearer ${this.authTokens.value}`;
        }
        const languageSeparator = API_URL.includes('?') ? '&' : '?';
        const requestUrl =
            `${API_URL}${languageSeparator}languageCode=${encodeURIComponent(this.languageCode)}` +
            `&currencyCode=${encodeURIComponent(readCurrencyCode ?? this.market.currencyCode)}`;
        const effectiveTimeoutMs =
            timeoutMs ?? (isStorefrontQuery(query) ? SHOP_API_QUERY_TIMEOUT_MS : undefined);
        const timeout = createRequestSignal(signal, effectiveTimeoutMs);
        let response: Response;
        let rawBody: string;
        try {
            response = await fetch(requestUrl, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify({ query, variables }),
                signal: timeout.signal,
            });
            captureAuthToken(response);
            rawBody = await response.text();
        } catch (error) {
            if (timeout.didTimeout()) {
                throw new ShopApiTimeoutError(
                    resultUnknownOnTimeout
                        ? '请求超时，提交结果暂时无法确认，请勿更改参数后重复提交'
                        : '请求超时，请检查网络后重试',
                    resultUnknownOnTimeout,
                );
            }
            throw error;
        } finally {
            timeout.cleanup();
        }
        return parseShopApiResponse<T>(rawBody, response.status, response.ok);
    }

    private publishCookieAuthenticationChange(): void {
        if (this.authTokens.usesCookieAuthentication) publishAuthSessionChange(this.market.code);
    }

    private assertCart(result: StorefrontCart & ErrorResult): StorefrontCart {
        this.assertNoError(result);
        return result;
    }

    private assertCheckoutSession(
        result: StorefrontCheckoutSession & ErrorResult,
    ): StorefrontCheckoutSession {
        this.assertNoError(result);
        return result;
    }

    private assertOrder(result: Order & ErrorResult): Order {
        this.assertNoError(result);
        return result;
    }

    async queryMails(code: string, signal?: AbortSignal): Promise<IcloudQueryResult> {
        const mail = await this.createMailQueryApi();
        signal?.throwIfAborted();
        return mail.queryMails(code, signal);
    }

    private assertNoError(result: ErrorResult): void {
        if (result.errorCode) {
            throw new ShopApiError(
                result.causeCode ?? result.errorCode,
                result.message ?? result.errorCode,
                result.authenticationError,
            );
        }
    }
}
