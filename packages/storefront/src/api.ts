import type { ShopApiContext } from './api/client-context';
import type {
    ActiveCustomer,
    AfterSalesRequest,
    Asset,
    CollectionSummary,
    CreateAfterSalesRequestInput,
    CreateImageGenerationInput,
    CustomerAddress,
    CustomerAddressInput,
    CustomerAddressUpdateInput,
    CustomerDeliveryEmail,
    CustomerOrderCounts,
    ImageGenerationJob,
    ImageModelQuotaStatus,
    ImageModelRecommendation,
    ImagePrivateAssetView,
    ImagePromptOptimizationResult,
    ImagePromptQuotaStatus,
    ImageReferenceMode,
    ImageStudioConfig,
    ImageStudioWallet,
    MarketConfig,
    MyReferralOverview,
    Order,
    OrderConfirmationToken,
    OrderPage,
    PaymentMethod,
    Product,
    ProductSearchPage,
    ProductSearchSort,
    ReferralBalancePaymentResult,
    ReferralProgram,
    RegisterCustomerInput,
    ShippingMethod,
    StoreCommerceMode,
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCatalogInput,
    StorefrontCheckoutSession,
    StorefrontConfig,
    StorefrontContentResponse,
    StorefrontCouponCampaign,
    StorefrontReview,
    StorefrontReviewCandidate,
    StorefrontReviewList,
    StorefrontUsdtCheckoutQuote,
    SubmitStorefrontReviewInput,
    VendureLanguageCode,
} from './types';

import { AccountApi } from './api/account';
import { CartCheckoutApi } from './api/cart-checkout';
import { CatalogApi } from './api/catalog';
import { ContentReviewsApi } from './api/content-reviews';
import {
    abortableDelay,
    API_URL,
    AUTH_TOKEN_HEADER,
    authTokenStorageKey,
    calculateStorefrontRealtimeRetry,
    cancelStorefrontRealtimeBody,
    createRequestSignal,
    ErrorResult,
    GraphQlResponse,
    isStorefrontQuery,
    readSessionAuthToken,
    SEND_CLIENT_CHANNEL_TOKEN,
    SHOP_API_QUERY_TIMEOUT_MS,
    ShopApiError,
    ShopApiTimeoutError,
    STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS,
    StorefrontRealtimeConnectionError,
    storefrontRealtimeUrl,
} from './api/helpers';
import { ImageStudioApi } from './api/image-studio';
import { ReferralsApi } from './api/referrals';
import { consumeStorefrontRealtimeStream, StorefrontRealtimeEvent } from './realtime-updates';

export {
    calculateStorefrontRealtimeRetry,
    SHOP_API_QUERY_TIMEOUT_MS,
    ShopApiError,
    ShopApiTimeoutError,
    StorefrontRealtimeConnectionError,
};

export class ShopApi {
    private readonly authTokenStorageKey: string | null;
    private authToken: string | null;
    private storefrontCatalogAvailable: boolean | null = null;
    private readonly contentReviewsApi: ContentReviewsApi;
    private readonly catalogApi: CatalogApi;
    private readonly accountApi: AccountApi;
    private readonly referralsApi: ReferralsApi;
    private readonly imageStudioApi: ImageStudioApi;
    private readonly cartCheckoutApi: CartCheckoutApi;

    constructor(
        private readonly market: MarketConfig,
        private readonly languageCode: VendureLanguageCode = market.defaultLanguageCode,
    ) {
        this.authTokenStorageKey = authTokenStorageKey(market.code);
        this.authToken = readSessionAuthToken(this.authTokenStorageKey);
        const ctx: ShopApiContext = {
            market: this.market,
            languageCode: this.languageCode,
            getAuthToken: () => this.authToken,
            captureAuthToken: res => this.captureAuthToken(res),
            clearAuthToken: () => this.clearAuthToken(),
            request: (q, v, s, t, r) => this.request(q, v, s, t, r),
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
        this.referralsApi = new ReferralsApi(ctx);
        this.imageStudioApi = new ImageStudioApi(ctx);
        this.cartCheckoutApi = new CartCheckoutApi(ctx);
    }

    async storefrontConfig(signal?: AbortSignal): Promise<StorefrontConfig> {
        return this.contentReviewsApi.storefrontConfig(signal);
    }

    async storefrontContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        return this.contentReviewsApi.storefrontContent(signal);
    }

    async activeCouponCampaigns(signal?: AbortSignal): Promise<StorefrontCouponCampaign[]> {
        return this.contentReviewsApi.activeCouponCampaigns(signal);
    }

    async products(take = 16, signal?: AbortSignal): Promise<Product[]> {
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

    async productSales(productIds: string[]): Promise<Record<string, number>> {
        return this.catalogApi.productSales(productIds);
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

    async customerOrders(
        skip = 0,
        take = 10,
        states?: string[],
        code?: string,
        signal?: AbortSignal,
    ): Promise<OrderPage> {
        return this.accountApi.customerOrders(skip, take, states, code, signal);
    }

    async customerOrderCounts(signal?: AbortSignal): Promise<CustomerOrderCounts> {
        return this.accountApi.customerOrderCounts(signal);
    }

    async order(id: string, signal?: AbortSignal): Promise<Order | null> {
        return this.accountApi.order(id, signal);
    }

    async orderByConfirmationToken(token: string, signal?: AbortSignal): Promise<Order | null> {
        return this.accountApi.orderByConfirmationToken(token, signal);
    }

    async createOrderConfirmationToken(): Promise<OrderConfirmationToken> {
        return this.accountApi.createOrderConfirmationToken();
    }

    async cancelMyAuthorizedOrder(orderId: string, reason: string): Promise<Order> {
        return this.accountApi.cancelMyAuthorizedOrder(orderId, reason);
    }

    async afterSalesRequests(signal?: AbortSignal): Promise<AfterSalesRequest[]> {
        return this.contentReviewsApi.afterSalesRequests(signal);
    }

    async createAfterSalesRequest(input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        return this.contentReviewsApi.createAfterSalesRequest(input);
    }

    async cancelAfterSalesRequest(id: string): Promise<AfterSalesRequest> {
        return this.contentReviewsApi.cancelAfterSalesRequest(id);
    }

    async productReviews(productId: string, signal?: AbortSignal): Promise<StorefrontReviewList> {
        return this.contentReviewsApi.productReviews(productId, signal);
    }

    async myReviews(signal?: AbortSignal): Promise<StorefrontReview[]> {
        return this.contentReviewsApi.myReviews(signal);
    }

    async reviewCandidates(signal?: AbortSignal): Promise<StorefrontReviewCandidate[]> {
        return this.contentReviewsApi.reviewCandidates(signal);
    }

    async submitReview(input: SubmitStorefrontReviewInput): Promise<StorefrontReview> {
        return this.contentReviewsApi.submitReview(input);
    }

    async login(emailAddress: string, password: string): Promise<void> {
        return this.accountApi.login(emailAddress, password);
    }

    async referralProgram(signal?: AbortSignal): Promise<ReferralProgram> {
        return this.referralsApi.referralProgram(signal);
    }

    async validateReferralInviteCode(code: string, signal?: AbortSignal): Promise<boolean> {
        return this.referralsApi.validateReferralInviteCode(code, signal);
    }

    async myReferralOverview(signal?: AbortSignal): Promise<MyReferralOverview> {
        return this.referralsApi.myReferralOverview(signal);
    }

    async registerCustomerAccount(
        input: RegisterCustomerInput,
        inviteCode?: string,
        source?: 'LINK' | 'POSTER' | 'CODE',
    ): Promise<void> {
        return this.referralsApi.registerCustomerAccount(input, inviteCode, source);
    }

    async useReferralBalance(amount: number): Promise<ReferralBalancePaymentResult> {
        return this.referralsApi.useReferralBalance(amount);
    }

    async imageStudioConfig(signal?: AbortSignal): Promise<ImageStudioConfig> {
        return this.imageStudioApi.imageStudioConfig(signal);
    }

    async imageStudioBalance(signal?: AbortSignal): Promise<number> {
        return this.imageStudioApi.imageStudioBalance(signal);
    }

    async imageStudioWallet(signal?: AbortSignal): Promise<ImageStudioWallet> {
        return this.imageStudioApi.imageStudioWallet(signal);
    }

    async imagePromptQuotaStatus(signal?: AbortSignal): Promise<ImagePromptQuotaStatus> {
        return this.imageStudioApi.imagePromptQuotaStatus(signal);
    }

    async imageModelQuotaStatus(signal?: AbortSignal): Promise<ImageModelQuotaStatus[]> {
        return this.imageStudioApi.imageModelQuotaStatus(signal);
    }

    async optimizeImagePrompt(
        prompt: string,
        referenceMode: ImageReferenceMode,
        quote?: { expectedPrice?: number | null; currencyCode?: string | null; idempotencyKey?: string },
    ): Promise<ImagePromptOptimizationResult> {
        return this.imageStudioApi.optimizeImagePrompt(prompt, referenceMode, quote);
    }

    async recommendImageModel(
        prompt: string,
        referenceMode: ImageReferenceMode,
    ): Promise<ImageModelRecommendation> {
        return this.imageStudioApi.recommendImageModel(prompt, referenceMode);
    }

    async uploadImageReference(file: File, termsAccepted: boolean): Promise<ImagePrivateAssetView> {
        return this.imageStudioApi.uploadImageReference(file, termsAccepted);
    }

    async createImageGeneration(input: CreateImageGenerationInput): Promise<ImageGenerationJob> {
        return this.imageStudioApi.createImageGeneration(input);
    }

    async myImageGenerationJob(id: string, signal?: AbortSignal): Promise<ImageGenerationJob> {
        return this.imageStudioApi.myImageGenerationJob(id, signal);
    }

    async myImageGenerationJobs(skip = 0, take = 20, signal?: AbortSignal) {
        return this.imageStudioApi.myImageGenerationJobs(skip, take, signal);
    }

    async cancelQueuedImageGeneration(id: string): Promise<ImageGenerationJob> {
        return this.imageStudioApi.cancelQueuedImageGeneration(id);
    }

    async deleteMyGeneratedImage(outputId: string): Promise<boolean> {
        return this.imageStudioApi.deleteMyGeneratedImage(outputId);
    }

    async deleteMyImageGenerationJob(id: string): Promise<boolean> {
        return this.imageStudioApi.deleteMyImageGenerationJob(id);
    }

    async recordStorefrontVisit(): Promise<boolean> {
        return this.referralsApi.recordStorefrontVisit();
    }

    async refreshCustomerVerification(emailAddress: string): Promise<void> {
        return this.accountApi.refreshCustomerVerification(emailAddress);
    }

    async verifyCustomerAccount(token: string, password?: string): Promise<void> {
        return this.accountApi.verifyCustomerAccount(token, password);
    }

    async requestPasswordReset(emailAddress: string): Promise<void> {
        return this.accountApi.requestPasswordReset(emailAddress);
    }

    async resetPassword(token: string, password: string): Promise<void> {
        return this.accountApi.resetPassword(token, password);
    }

    async logout(): Promise<void> {
        return this.accountApi.logout();
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

    async myCoupons(signal?: AbortSignal): Promise<StoreCustomerCoupon[]> {
        return this.cartCheckoutApi.myCoupons(signal);
    }

    async myCouponUsageRecords(signal?: AbortSignal): Promise<StoreCouponUsageRecord[]> {
        return this.cartCheckoutApi.myCouponUsageRecords(signal);
    }

    async claimCoupon(campaignId: string): Promise<StoreCustomerCoupon> {
        return this.cartCheckoutApi.claimCoupon(campaignId);
    }

    async applyCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        return this.cartCheckoutApi.applyCustomerCoupon(id);
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

    async setShippingAddress(input: CustomerAddressInput): Promise<Order> {
        return this.cartCheckoutApi.setShippingAddress(input);
    }

    async eligibleShippingMethods(): Promise<ShippingMethod[]> {
        return this.cartCheckoutApi.eligibleShippingMethods();
    }

    async setShippingMethod(id: string): Promise<Order> {
        return this.cartCheckoutApi.setShippingMethod(id);
    }

    async setCurrencyForOrder(currencyCode: string): Promise<Order> {
        return this.cartCheckoutApi.setCurrencyForOrder(currencyCode);
    }

    async eligiblePaymentMethods(signal?: AbortSignal): Promise<PaymentMethod[]> {
        return this.cartCheckoutApi.eligiblePaymentMethods(signal);
    }

    async createUsdtCheckoutQuote(signal?: AbortSignal): Promise<StorefrontUsdtCheckoutQuote> {
        return this.cartCheckoutApi.createUsdtCheckoutQuote(signal);
    }

    async addPaymentToOrder(method: string, metadata: Record<string, unknown> = {}): Promise<Order> {
        return this.cartCheckoutApi.addPaymentToOrder(method, metadata);
    }

    async watchRealtime(
        onEvent: (event: StorefrontRealtimeEvent) => void,
        signal: AbortSignal,
    ): Promise<void> {
        let retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
        while (!signal.aborted) {
            try {
                const headers: Record<string, string> = { accept: 'text/event-stream' };
                if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
                if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
                const response = await fetch(storefrontRealtimeUrl(), {
                    method: 'GET',
                    credentials: 'include',
                    headers,
                    cache: 'no-store',
                    signal,
                });
                if (!response.ok) {
                    const error = new StorefrontRealtimeConnectionError(
                        response.status,
                        response.headers.get('retry-after'),
                    );
                    await cancelStorefrontRealtimeBody(response.body, error);
                    throw error;
                }
                if (!response.body) {
                    throw new StorefrontRealtimeConnectionError(response.status, null);
                }
                await consumeStorefrontRealtimeStream(response.body, onEvent, {
                    signal,
                    onReady: () => {
                        retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
                    },
                });
                if (!signal.aborted) throw new Error('Storefront realtime connection closed');
            } catch (error) {
                if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
                const retry = calculateStorefrontRealtimeRetry({
                    status: error instanceof StorefrontRealtimeConnectionError ? error.status : undefined,
                    retryAfter:
                        error instanceof StorefrontRealtimeConnectionError ? error.retryAfter : undefined,
                    baseDelayMs: retryDelayMs,
                });
                await abortableDelay(retry.delayMs, signal);
                retryDelayMs = retry.nextBaseDelayMs;
            }
        }
    }

    private async request<T>(
        query: string,
        variables?: Record<string, unknown>,
        signal?: AbortSignal,
        timeoutMs?: number,
        resultUnknownOnTimeout = false,
    ): Promise<T> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'language-code': this.languageCode,
        };
        if (SEND_CLIENT_CHANNEL_TOKEN) {
            headers['vendure-token'] = this.market.code;
        }
        if (this.authToken) {
            headers.authorization = `Bearer ${this.authToken}`;
        }
        const languageSeparator = API_URL.includes('?') ? '&' : '?';
        const requestUrl =
            `${API_URL}${languageSeparator}languageCode=${encodeURIComponent(this.languageCode)}` +
            `&currencyCode=${encodeURIComponent(this.market.currencyCode)}`;
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
            this.captureAuthToken(response);
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
        let body: GraphQlResponse<T>;
        try {
            body = JSON.parse(rawBody) as GraphQlResponse<T>;
        } catch {
            throw new Error(
                rawBody.trim()
                    ? `Shop API returned an invalid response (${response.status})`
                    : `Shop API did not respond (${response.status})`,
            );
        }
        if (!response.ok || body.errors?.length || !body.data) {
            throw new Error(body.errors?.[0]?.message ?? `Shop API request failed (${response.status})`);
        }
        return body.data;
    }

    private captureAuthToken(response: Response): void {
        const authToken = response.headers.get(AUTH_TOKEN_HEADER)?.trim();
        if (!authToken) return;
        this.authToken = authToken;
        if (!this.authTokenStorageKey) return;
        try {
            sessionStorage.setItem(this.authTokenStorageKey, authToken);
        } catch {
            // The in-memory token still preserves the session for this page lifetime.
        }
    }

    private clearAuthToken(): void {
        this.authToken = null;
        if (!this.authTokenStorageKey) return;
        try {
            sessionStorage.removeItem(this.authTokenStorageKey);
        } catch {
            // Storage can be unavailable in privacy-restricted browser contexts.
        }
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

    private assertNoError(result: ErrorResult): void {
        if (result.errorCode) {
            throw new ShopApiError(
                result.errorCode,
                result.message ?? result.errorCode,
                result.authenticationError,
            );
        }
    }
}
