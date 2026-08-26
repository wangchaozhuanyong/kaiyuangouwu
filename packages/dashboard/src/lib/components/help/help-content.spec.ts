import { describe, expect, it } from 'vitest';
import type { ImageSizeGuidance } from './help-content.js';
import {
    getFieldHelpTopic,
    getImageSizeGuidance,
    getPageHelpMode,
    getPageHelpTopic,
    localizeHelpText,
} from './help-content.js';

const pageIds = [
    'insights',
    'product-list',
    'product-detail',
    'manage-product-variants',
    'product-variant-list',
    'product-variant-detail',
    'option-group-list',
    'option-group-detail',
    'option-group-option-detail',
    'facet-list',
    'facet-detail',
    'facet-value-detail',
    'collection-list',
    'collection-detail',
    'asset-list',
    'asset-detail',
    'review-list',
    'review-detail',
    'order-list',
    'order-detail',
    'draft-order-detail',
    'order-modify',
    'seller-order-detail',
    'customer-list',
    'customer-detail',
    'customer-group-list',
    'customer-group-detail',
    'promotion-list',
    'promotion-detail',
    'seller-list',
    'seller-detail',
    'channel-list',
    'channel-detail',
    'stock-location-list',
    'stock-location-detail',
    'administrator-list',
    'administrator-detail',
    'role-list',
    'role-detail',
    'shipping-method-list',
    'shipping-method-detail',
    'payment-method-list',
    'payment-method-detail',
    'tax-category-list',
    'tax-category-detail',
    'tax-rate-list',
    'tax-rate-detail',
    'country-list',
    'country-detail',
    'zone-list',
    'zone-detail',
    'global-settings',
    'job-queue-list',
    'scheduled-tasks-list',
    'settings-store-list',
    'api-key-list',
    'api-key-detail',
    'profile',
] as const;

const documentedFields = [
    'name',
    'description',
    'enabled',
    'code',
    'slug',
    'sku',
    'token',
    'defaultLanguageCode',
    'availableLanguageCodes',
    'availableLanguages',
    'defaultCurrencyCode',
    'availableCurrencyCodes',
    'pricesIncludeTax',
    'value',
    'categoryId',
    'zoneId',
    'startsAt',
    'endsAt',
    'couponCode',
    'perCustomerUsageLimit',
    'usageLimit',
    'conditions',
    'actions',
    'fulfillmentHandler',
    'checker',
    'calculator',
    'handler',
    'trackInventory',
    'outOfStockThreshold',
    'stockLevels.0.stockOnHand',
] as const;

const imageGuidanceKinds: ImageSizeGuidance[] = [
    'assetLibrary',
    'product',
    'productGroup',
    'richText',
    'logo',
    'hero',
    'banner',
    'contentCard',
    'icon',
];

describe('China-first contextual help', () => {
    it.each(pageIds)('provides bilingual help for %s', pageId => {
        const topic = getPageHelpTopic(pageId);
        expect(topic).toBeDefined();
        expect(topic?.title.zh_Hans).toMatch(/[\u4e00-\u9fff]/u);
        expect(topic?.title.en).toMatch(/[A-Za-z]/u);
        expect(topic?.tips.length).toBeGreaterThan(0);
    });

    it.each(documentedFields)('provides field help for %s', fieldName => {
        const topic = getFieldHelpTopic(fieldName);
        expect(topic).toBeDefined();
        expect(topic?.description.zh_Hans).toMatch(/[\u4e00-\u9fff]/u);
        expect(topic?.description.en).toMatch(/[A-Za-z]/u);
    });

    it('uses Chinese as the authoritative zh locale and English otherwise', () => {
        const value = { zh_Hans: '中文说明', en: 'English guide' };
        expect(localizeHelpText(value, 'zh_Hans')).toBe('中文说明');
        expect(localizeHelpText(value, 'zh-CN')).toBe('中文说明');
        expect(localizeHelpText(value, 'en')).toBe('English guide');
    });

    it.each(imageGuidanceKinds)('provides bilingual image dimensions for %s', kind => {
        const guidance = getImageSizeGuidance(kind);

        expect(guidance.zh_Hans).toMatch(/[\u4e00-\u9fff]/u);
        expect(guidance.en).toMatch(/[A-Za-z]/u);
        expect(guidance.zh_Hans).toMatch(/\d+\s*×\s*\d+|1200 px/u);
        expect(guidance.en).toMatch(/\d+\s*×\s*\d+|1200 px/u);
    });

    it('distinguishes list workflows from detail workflows', () => {
        expect(getPageHelpMode('product-list')).toBe('list');
        expect(getPageHelpMode('asset-list')).toBe('list');
        expect(getPageHelpMode('product-detail')).toBe('detail');
    });
});
