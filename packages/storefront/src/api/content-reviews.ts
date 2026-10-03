import type {
    AfterSalesEvidence,
    AfterSalesRequest,
    ConfirmAfterSalesReplacementInput,
    CreateAfterSalesRequestInput,
    CustomerProductActivity,
    CustomerServiceFeedback,
    CustomerServiceReviewRecord,
    StoreNotificationReference,
    StorefrontAuthSettings,
    StorefrontConfig,
    StorefrontContentResponse,
    StorefrontCouponCampaign,
    StorefrontCurrencyConfiguration,
    StorefrontReview,
    StorefrontReviewCandidate,
    StorefrontReviewList,
    SubmitAfterSalesReturnShipmentInput,
    SubmitCustomerServiceFeedbackInput,
    SubmitStorefrontReviewInput,
} from '../types';
import type { StorefrontContentQueryResult } from './helpers';

import { isAccountContentBlockType } from '../../../storefront-content-plugin/src/content-publication';
import { resolveAccountRecommendationSettings } from '../../../storefront-content-plugin/src/shared/account-recommendation-settings';
import {
    type StorefrontVisualPresetConfig,
    normalizeStorefrontDesktopLayout,
    normalizeStorefrontVisualPreset,
} from '../../../storefront-content-plugin/src/visual-presets';

import { BaseDomainApi } from './base-domain-api';
import { isSupportedContentSchemaFallback, unsupportedOptionalContentFields } from './content-compatibility';
import { afterSalesFields, storefrontReviewFields } from './fragments';

const defaultAuthSettings: StorefrontAuthSettings = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleEnabled: false,
    googleClientId: null,
};

export class ContentReviewsApi extends BaseDomainApi {
    async recordStorefrontHeartbeat(visitorId: string): Promise<boolean> {
        const { StoreNotificationsApi } = await import('./store-notifications');
        return new StoreNotificationsApi(this.ctx.request).recordStorefrontHeartbeat(visitorId);
    }
    async currentCustomerServiceReview(
        visitorId: string,
        orderCode?: string,
    ): Promise<CustomerServiceReviewRecord | null> {
        const { StoreNotificationsApi } = await import('./store-notifications');
        return new StoreNotificationsApi(this.ctx.request).currentCustomerServiceReview(visitorId, orderCode);
    }
    async submitCustomerServiceReview(input: {
        id?: string;
        visitorId: string;
        rating: number;
        tags: string[];
        comment: string;
        orderCode?: string;
    }): Promise<CustomerServiceReviewRecord> {
        const { StoreNotificationsApi } = await import('./store-notifications');
        return new StoreNotificationsApi(this.ctx.request).submitCustomerServiceReview(input);
    }

    async myCustomerProductActivity(signal?: AbortSignal): Promise<CustomerProductActivity> {
        const result = await this.request<{ myCustomerProductActivity: CustomerProductActivity }>(
            `query MyCustomerProductActivity {
                myCustomerProductActivity { favoriteProductIds recentProductVisits { productId visitedAt } }
            }`,
            undefined,
            signal,
        );
        return result.myCustomerProductActivity;
    }

    async setFavoriteProduct(productId: string, favorite: boolean): Promise<CustomerProductActivity> {
        const result = await this.request<{ setMyFavoriteProduct: CustomerProductActivity }>(
            `mutation SetMyFavoriteProduct($productId: ID!, $favorite: Boolean!) {
                setMyFavoriteProduct(productId: $productId, favorite: $favorite) {
                    favoriteProductIds recentProductVisits { productId visitedAt }
                }
            }`,
            { productId, favorite },
        );
        return result.setMyFavoriteProduct;
    }

    async removeFavoriteProducts(productIds: string[]): Promise<CustomerProductActivity> {
        const result = await this.request<{ removeMyFavoriteProducts: CustomerProductActivity }>(
            `mutation RemoveMyFavoriteProducts($productIds: [ID!]!) {
                removeMyFavoriteProducts(productIds: $productIds) {
                    favoriteProductIds recentProductVisits { productId visitedAt }
                }
            }`,
            { productIds },
        );
        return result.removeMyFavoriteProducts;
    }

    async clearFavoriteProducts(): Promise<CustomerProductActivity> {
        const result = await this.request<{ clearMyFavoriteProducts: CustomerProductActivity }>(
            `mutation ClearMyFavoriteProducts {
                clearMyFavoriteProducts { favoriteProductIds recentProductVisits { productId visitedAt } }
            }`,
        );
        return result.clearMyFavoriteProducts;
    }

    async recordProductVisit(productId: string): Promise<CustomerProductActivity> {
        const result = await this.request<{ recordMyProductVisit: CustomerProductActivity }>(
            `mutation RecordMyProductVisit($productId: ID!) {
                recordMyProductVisit(productId: $productId) {
                    favoriteProductIds recentProductVisits { productId visitedAt }
                }
            }`,
            { productId },
        );
        return result.recordMyProductVisit;
    }

    async clearProductVisits(): Promise<CustomerProductActivity> {
        const result = await this.request<{ clearMyProductVisits: CustomerProductActivity }>(
            `mutation ClearMyProductVisits {
                clearMyProductVisits { favoriteProductIds recentProductVisits { productId visitedAt } }
            }`,
        );
        return result.clearMyProductVisits;
    }

    async myCustomerServiceFeedback(
        orderCode?: string,
        signal?: AbortSignal,
    ): Promise<CustomerServiceFeedback | null> {
        const result = await this.request<{ myCustomerServiceFeedback: CustomerServiceFeedback | null }>(
            `query MyCustomerServiceFeedback($orderCode: String) {
                myCustomerServiceFeedback(orderCode: $orderCode) {
                    id orderCode rating tags comment createdAt updatedAt
                }
            }`,
            { orderCode: orderCode ?? null },
            signal,
        );
        return result.myCustomerServiceFeedback;
    }

    async submitCustomerServiceFeedback(
        input: SubmitCustomerServiceFeedbackInput,
    ): Promise<CustomerServiceFeedback> {
        const result = await this.request<{ submitMyCustomerServiceFeedback: CustomerServiceFeedback }>(
            `mutation SubmitMyCustomerServiceFeedback($input: SubmitCustomerServiceFeedbackInput!) {
                submitMyCustomerServiceFeedback(input: $input) {
                    id orderCode rating tags comment createdAt updatedAt
                }
            }`,
            { input },
        );
        return result.submitMyCustomerServiceFeedback;
    }

    async notificationReadKeys(
        references: StoreNotificationReference[],
        signal?: AbortSignal,
    ): Promise<string[]> {
        const result = await this.request<{ myStoreNotificationReadKeys: string[] }>(
            `query MyStoreNotificationReadKeys($references: [StoreNotificationReferenceInput!]!) {
                myStoreNotificationReadKeys(references: $references)
            }`,
            { references },
            signal,
        );
        return result.myStoreNotificationReadKeys;
    }

    async markNotificationsRead(references: StoreNotificationReference[]): Promise<string[]> {
        const result = await this.request<{ markMyStoreNotificationsRead: string[] }>(
            `mutation MarkMyStoreNotificationsRead($references: [StoreNotificationReferenceInput!]!) {
                markMyStoreNotificationsRead(references: $references)
            }`,
            { references },
        );
        return result.markMyStoreNotificationsRead;
    }

    async uploadAfterSalesEvidence(orderId: string, file: File): Promise<AfterSalesEvidence> {
        const result = await this.upload<{ uploadAfterSalesEvidence: AfterSalesEvidence }>(
            `mutation UploadAfterSalesEvidence($orderId: ID!, $file: Upload!) {
                uploadAfterSalesEvidence(orderId: $orderId, file: $file) {
                    id createdAt mimeType byteSize available previewUrl expiresAt
                }
            }`,
            { orderId },
            file,
            '凭证上传超时，请刷新凭证列表确认上传结果',
        );
        return result.uploadAfterSalesEvidence;
    }

    async afterSalesEvidenceDrafts(orderId: string): Promise<AfterSalesEvidence[]> {
        const result = await this.request<{ myAfterSalesEvidenceDrafts: AfterSalesEvidence[] }>(
            `query MyAfterSalesEvidenceDrafts($orderId: ID!) {
                myAfterSalesEvidenceDrafts(orderId: $orderId) { id createdAt mimeType byteSize available previewUrl expiresAt }
            }`,
            { orderId },
        );
        return result.myAfterSalesEvidenceDrafts;
    }

    async removeAfterSalesEvidenceDraft(id: string): Promise<boolean> {
        const result = await this.request<{ removeMyAfterSalesEvidenceDraft: boolean }>(
            `mutation RemoveMyAfterSalesEvidenceDraft($id: ID!) { removeMyAfterSalesEvidenceDraft(id: $id) }`,
            { id },
        );
        return result.removeMyAfterSalesEvidenceDraft;
    }

    async storefrontVisualPreset(signal?: AbortSignal): Promise<StorefrontVisualPresetConfig> {
        type PresetResponse = {
            activeChannel: { id: string };
            storefrontVisualPreset: StorefrontVisualPresetConfig;
        };
        let result: PresetResponse;
        try {
            try {
                result = await this.request<PresetResponse>(
                    `query StorefrontVisualPreset { activeChannel { id } storefrontVisualPreset { channelId presetId desktopLayout revision } }`,
                    undefined,
                    signal,
                );
            } catch (error) {
                if (!isSupportedContentSchemaFallback(error, 'desktopLayout')) throw error;
                result = await this.request<PresetResponse>(
                    `query StorefrontVisualPreset { activeChannel { id } storefrontVisualPreset { channelId presetId revision } }`,
                    undefined,
                    signal,
                );
            }
        } catch (error) {
            if (!isSupportedContentSchemaFallback(error, 'visualPreset')) throw error;
            return { channelId: '', presetId: 'classic', desktopLayout: 'classic', revision: 'default' };
        }
        if (result.activeChannel.id !== result.storefrontVisualPreset.channelId)
            throw new Error('Storefront channel mismatch');
        return {
            ...result.storefrontVisualPreset,
            presetId: normalizeStorefrontVisualPreset(result.storefrontVisualPreset.presetId),
            desktopLayout: normalizeStorefrontDesktopLayout(result.storefrontVisualPreset.desktopLayout),
        };
    }

    async storefrontConfig(signal?: AbortSignal): Promise<StorefrontConfig> {
        type StorefrontConfigResponse = {
            activeChannel: Omit<
                StorefrontConfig,
                'availableCountries' | 'availableProvinces' | 'logoUrl' | 'description'
            >;
            availableCountries: StorefrontConfig['availableCountries'];
            availableStorefrontProvinces?: NonNullable<StorefrontConfig['availableProvinces']>;
            storefrontBranding: {
                logoUrl: string | null;
                logoOnLightUrl: string | null;
                logoOnDarkUrl: string | null;
                description: string;
                tagline: string;
                backgroundColor: string | null;
                primaryColor: string | null;
                accentColor: string | null;
                highlightColor: string | null;
                legalEntityName: string | null;
                legalRegistrationCountry: string | null;
                legalRegistrationNumber: string | null;
                legalContactAddress: string | null;
                supportEmail: string | null;
                privacyEmail: string | null;
            };
            storefrontCurrencyConfiguration: StorefrontCurrencyConfiguration;
        };
        const loadConfig = (includeProvinces: boolean) =>
            this.request<StorefrontConfigResponse>(
                `
            query StorefrontConfig {
                activeChannel {
                    code
                    defaultLanguageCode
                    defaultCurrencyCode
                    customFields {
                        storefrontNameZh
                        storefrontNameEn
                    }
                }
                availableCountries {
                    code
                    name
                }
                ${
                    includeProvinces
                        ? `availableStorefrontProvinces {
                    code
                    name
                    countryCode
                }`
                        : ''
                }
                storefrontBranding {
                    logoUrl
                    logoOnLightUrl
                    logoOnDarkUrl
                    description
                    tagline
                    backgroundColor
                    primaryColor
                    accentColor
                    highlightColor
                    legalEntityName
                    legalRegistrationCountry
                    legalRegistrationNumber
                    legalContactAddress
                    supportEmail
                    privacyEmail
                }
                storefrontCurrencyConfiguration {
                    defaultCurrencyCode
                    availableCurrencyCodes
                    selectorEnabled
                    cnyToMyrRate
                    rateUpdatedAt
                    usdtDisplayEnabled
                    usdtMarkupPercent
                    cnyPerUsdtRate
                    myrPerUsdtRate
                    usdtRateSource
                    usdtRateUpdatedAt
                    usdtRateAvailable
                    usdtPaymentConfigured
                }
            }
        `,
                undefined,
                signal,
            );
        let result: StorefrontConfigResponse;
        try {
            result = await loadConfig(true);
        } catch (error) {
            if (!isSupportedContentSchemaFallback(error, 'provinces')) throw error;
            result = await loadConfig(false);
        }
        return {
            ...result.activeChannel,
            availableCountries: result.availableCountries,
            availableProvinces: result.availableStorefrontProvinces ?? [],
            logoUrl: result.storefrontBranding?.logoUrl ?? null,
            logoOnLightUrl: result.storefrontBranding?.logoOnLightUrl ?? null,
            logoOnDarkUrl: result.storefrontBranding?.logoOnDarkUrl ?? null,
            description: result.storefrontBranding?.description ?? '',
            tagline: result.storefrontBranding?.tagline ?? '',
            brandBackgroundColor: result.storefrontBranding?.backgroundColor ?? null,
            brandPrimaryColor: result.storefrontBranding?.primaryColor ?? null,
            brandAccentColor: result.storefrontBranding?.accentColor ?? null,
            brandHighlightColor: result.storefrontBranding?.highlightColor ?? null,
            legalEntityName: result.storefrontBranding?.legalEntityName ?? null,
            legalRegistrationCountry: result.storefrontBranding?.legalRegistrationCountry ?? null,
            legalRegistrationNumber: result.storefrontBranding?.legalRegistrationNumber ?? null,
            legalContactAddress: result.storefrontBranding?.legalContactAddress ?? null,
            supportEmail: result.storefrontBranding?.supportEmail ?? null,
            privacyEmail: result.storefrontBranding?.privacyEmail ?? null,
            currencyConfiguration: result.storefrontCurrencyConfiguration,
        };
    }

    async storefrontAccountContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        const result = await this.request<Pick<StorefrontContentQueryResult, 'storefrontContent'>>(
            `query StorefrontAccountContent {
                storefrontContent {
                    id code type layoutVariant enabled position startsAt endsAt
                    title subtitle body ctaLabel imageUrl backgroundColor textColor
                    targetType targetValue settings
                    items {
                        id enabled position imageUrl targetType targetValue settings label description
                    }
                }
            }`,
            undefined,
            signal,
        );
        return {
            blocks: result.storefrontContent.filter(block => isAccountContentBlockType(block.type)),
            flashSales: [],
            systemAnnouncements: [],
            settings: {
                heroAutoplayIntervalSeconds: 5,
                configuredBlockTypes: [],
                auth: defaultAuthSettings,
            },
        };
    }

    async storefrontContent(signal?: AbortSignal): Promise<StorefrontContentResponse> {
        const modernQuery = (
            announcementCreatedAt: boolean,
            personalDataExport = true,
            accountRecommendations = true,
        ) => `
query StorefrontContent {
storefrontContentSettings {
heroAutoplayIntervalSeconds
configuredBlockTypes
${personalDataExport ? 'personalDataExportEnabled' : ''}
${accountRecommendations ? 'accountRecommendations { enabled titleZh titleEn limit }' : ''}
auth {
emailPasswordEnabled
emailAutoRegistrationEnabled
emailQuickRegistrationEnabled
googleEnabled
googleClientId
}
}
activeStorefrontFlashSales {
id
startsAt
endsAt
items {
productId
productVariantId
productName
variantName
originalPrice
salePrice
currencyCode
imageUrl
}
}
activeSystemAnnouncements {
id
${announcementCreatedAt ? 'createdAt' : ''}
title
content
linkUrl
startsAt
endsAt
}
storefrontContent {
id
code
internalName
type
layoutVariant
enabled
position
startsAt
endsAt
imageUrl
imageAsset { width height }
backgroundColor
textColor
targetType
targetValue
settings
title
subtitle
body
ctaLabel
items {
id
enabled
position
imageUrl
targetType
targetValue
settings
label
description
}
}
}
        `;
        const result = await (async (): Promise<StorefrontContentQueryResult> => {
            try {
                return await this.request<StorefrontContentQueryResult>(modernQuery(true), undefined, signal);
            } catch (error) {
                let fallbackError: unknown = error;
                let personalDataExport = true;
                let accountRecommendations = true;
                let announcementCreatedAt = true;
                // Remove only explicitly unsupported optional fields; preserve all other modern settings.
                for (let attempt = 0; attempt < 3; attempt++) {
                    const unsupported = unsupportedOptionalContentFields(fallbackError);
                    if (!unsupported.size) break;
                    accountRecommendations &&= !unsupported.has(
                        'StorefrontContentSettings.accountRecommendations',
                    );
                    personalDataExport &&= !unsupported.has(
                        'StorefrontContentSettings.personalDataExportEnabled',
                    );
                    announcementCreatedAt &&= !unsupported.has('StorefrontSystemAnnouncement.createdAt');
                    try {
                        return await this.request<StorefrontContentQueryResult>(
                            modernQuery(announcementCreatedAt, personalDataExport, accountRecommendations),
                            undefined,
                            signal,
                        );
                    } catch (retryError) {
                        fallbackError = retryError;
                    }
                }
                if (!isSupportedContentSchemaFallback(fallbackError, 'content')) {
                    throw fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
                }
                return this.request<StorefrontContentQueryResult>(
                    `
                query StorefrontContentLegacy {
                    storefrontContentSettings {
                        heroAutoplayIntervalSeconds
                    }
                    storefrontContent {
                        id
                        code
                        type
                        enabled
                        position
                        startsAt
                        endsAt
                        imageUrl
                        backgroundColor
                        textColor
                        targetType
                        targetValue
                        title
                        subtitle
                        body
                        ctaLabel
                        items {
                            id
                            enabled
                            position
                            imageUrl
                            targetType
                            targetValue
                            label
                            description
                        }
                    }
                }
            `,
                    undefined,
                    signal,
                );
            }
        })();
        return {
            blocks: result.storefrontContent,
            flashSales: result.activeStorefrontFlashSales ?? [],
            systemAnnouncements: result.activeSystemAnnouncements ?? [],
            settings: {
                heroAutoplayIntervalSeconds:
                    result.storefrontContentSettings?.heroAutoplayIntervalSeconds ?? 5,
                configuredBlockTypes: result.storefrontContentSettings?.configuredBlockTypes ?? [],
                auth: result.storefrontContentSettings?.auth ?? defaultAuthSettings,
                personalDataExportEnabled:
                    result.storefrontContentSettings?.personalDataExportEnabled === true,
                accountRecommendations: resolveAccountRecommendationSettings(
                    result.storefrontContentSettings?.accountRecommendations,
                ),
            },
        };
    }

    async activeCouponCampaigns(signal?: AbortSignal): Promise<StorefrontCouponCampaign[]> {
        try {
            const result = await this.request<{ activeStorefrontCoupons: StorefrontCouponCampaign[] }>(
                `
                query ActiveStorefrontCoupons {
                    activeStorefrontCoupons {
                        id
                        name
                        kind
                        appearanceTheme
                        startsAt
                        endsAt
                        claimStartsAt
                        claimEndsAt
                        validityDays
                        minimumSpend
                        currencyCode
                        discountAmount
                        discountRate
                        collectionIds
                        productVariantIds
                        remainingIssueCount
                        claimed
                        claimable
                    }
                }
            `,
                undefined,
                signal,
            );
            return result.activeStorefrontCoupons;
        } catch (error) {
            if (isSupportedContentSchemaFallback(error, 'coupons')) return [];
            throw error;
        }
    }

    async afterSalesRequests(signal?: AbortSignal): Promise<AfterSalesRequest[]> {
        const result = await this.request<{ myAfterSalesRequests: AfterSalesRequest[] }>(
            `
                query MyAfterSalesRequests {
                    myAfterSalesRequests { ${afterSalesFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myAfterSalesRequests;
    }

    async createAfterSalesRequest(input: CreateAfterSalesRequestInput): Promise<AfterSalesRequest> {
        const result = await this.request<{ createAfterSalesRequest: AfterSalesRequest }>(
            `
                mutation CreateAfterSalesRequest($input: CreateAfterSalesRequestInput!) {
                    createAfterSalesRequest(input: $input) { ${afterSalesFields} }
                }
            `,
            { input },
        );
        return result.createAfterSalesRequest;
    }

    async cancelAfterSalesRequest(id: string): Promise<AfterSalesRequest> {
        const result = await this.request<{ cancelMyAfterSalesRequest: AfterSalesRequest }>(
            `
                mutation CancelMyAfterSalesRequest($id: ID!) {
                    cancelMyAfterSalesRequest(id: $id) { ${afterSalesFields} }
                }
            `,
            { id },
        );
        return result.cancelMyAfterSalesRequest;
    }

    async submitAfterSalesReturnShipment(
        input: SubmitAfterSalesReturnShipmentInput,
    ): Promise<AfterSalesRequest> {
        const result = await this.request<{ submitMyAfterSalesReturnShipment: AfterSalesRequest }>(
            `
                mutation SubmitMyAfterSalesReturnShipment($input: SubmitAfterSalesReturnShipmentInput!) {
                    submitMyAfterSalesReturnShipment(input: $input) { ${afterSalesFields} }
                }
            `,
            { input },
        );
        return result.submitMyAfterSalesReturnShipment;
    }

    async confirmAfterSalesReplacement(input: ConfirmAfterSalesReplacementInput): Promise<AfterSalesRequest> {
        const result = await this.request<{ confirmMyAfterSalesReplacement: AfterSalesRequest }>(
            `
                mutation ConfirmMyAfterSalesReplacement($input: ConfirmAfterSalesReplacementInput!) {
                    confirmMyAfterSalesReplacement(input: $input) { ${afterSalesFields} }
                }
            `,
            { input },
        );
        return result.confirmMyAfterSalesReplacement;
    }

    async reviewSettings(signal?: AbortSignal): Promise<{ enabled: boolean }> {
        const result = await this.request<{ storefrontReviewSettings: { enabled: boolean } }>(
            `query StorefrontReviewSettings { storefrontReviewSettings { enabled } }`,
            undefined,
            signal,
        );
        return result.storefrontReviewSettings;
    }

    async productReviews(
        productId: string,
        options: { skip?: number; take?: number } = { take: 20 },
        signal?: AbortSignal,
    ): Promise<StorefrontReviewList> {
        const result = await this.request<{ storefrontProductReviews: StorefrontReviewList }>(
            `
                query StorefrontProductReviews($productId: ID!, $options: StorefrontReviewListOptions) {
                    storefrontProductReviews(productId: $productId, options: $options) {
                        totalItems
                        averageRating
                        items { ${storefrontReviewFields} }
                    }
                }
            `,
            { productId, options },
            signal,
        );
        return result.storefrontProductReviews;
    }

    async myReviews(signal?: AbortSignal): Promise<StorefrontReview[]> {
        const result = await this.request<{ myStorefrontReviews: StorefrontReview[] }>(
            `
                query MyStorefrontReviews {
                    myStorefrontReviews { ${storefrontReviewFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontReviews;
    }

    async reviewCandidates(
        options: { skip?: number; take?: number } = {},
        signal?: AbortSignal,
    ): Promise<StorefrontReviewCandidate[]> {
        const result = await this.request<{ myStorefrontReviewCandidates: StorefrontReviewCandidate[] }>(
            `
                query MyStorefrontReviewCandidates($options: StorefrontReviewListOptions) {
                    myStorefrontReviewCandidates(options: $options) {
                        orderLineId
                        orderId
                        orderCode
                        orderState
                        orderPlacedAt
                        productId
                        productVariantId
                        productName
                        variantName
                        sku
                        unitPriceWithTax
                        currencyCode
                        fulfillmentType
                        imageUrl
                    }
                }
            `,
            { options },
            signal,
        );
        return result.myStorefrontReviewCandidates;
    }

    async submitReview(input: SubmitStorefrontReviewInput): Promise<StorefrontReview> {
        const { images = [], ...reviewInput } = input;
        const mutation = `
            mutation SubmitStorefrontReview($input: SubmitStorefrontReviewInput!, $files: [Upload!]) {
                submitStorefrontReview(input: $input, files: $files) { ${storefrontReviewFields} }
            }
        `;
        const result = images.length
            ? await this.uploadFiles<{ submitStorefrontReview: StorefrontReview }>(
                  mutation,
                  { input: reviewInput },
                  images,
                  '评价提交超时，请到我的评价确认结果',
                  'files',
              )
            : await this.request<{ submitStorefrontReview: StorefrontReview }>(mutation, {
                  input: reviewInput,
              });
        return result.submitStorefrontReview;
    }
}
