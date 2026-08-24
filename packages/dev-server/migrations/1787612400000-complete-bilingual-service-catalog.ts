import { MigrationInterface, QueryRunner } from 'typeorm';

export interface ServiceCatalogProductTranslation {
    slug: string;
    sku: string;
    nameEn: string;
}

interface ServiceCatalogCollectionTranslation {
    slug: string;
    nameZh: string;
    nameEn: string;
}

export const serviceCatalogProducts: readonly ServiceCatalogProductTranslation[] = [
    {
        slug: 'chatgpt-go-1m-account-setup',
        sku: 'AI-CHATGPT-GO-1M',
        nameEn: 'ChatGPT Go | 1-Month Setup on Your Account',
    },
    {
        slug: 'chatgpt-plus-1m-account-topup',
        sku: 'AI-CHATGPT-PLUS-1M',
        nameEn: 'ChatGPT Plus | 1-Month Top-up on Your Account',
    },
    {
        slug: 'chatgpt-plus-3m-monthly-topup',
        sku: 'AI-CHATGPT-PLUS-3M',
        nameEn: 'ChatGPT Plus | 3-Month Monthly Top-up Service',
    },
    {
        slug: 'chatgpt-pro-100usd-1m',
        sku: 'AI-CHATGPT-PRO100-1M',
        nameEn: 'ChatGPT Pro | USD 100 Tier, 1 Month',
    },
    {
        slug: 'chatgpt-pro-200usd-1m',
        sku: 'AI-CHATGPT-PRO200-1M',
        nameEn: 'ChatGPT Pro | USD 200 Tier, 1 Month',
    },
    {
        slug: 'chatgpt-business-team-seat',
        sku: 'AI-CHATGPT-BUSINESS',
        nameEn: 'ChatGPT Business | Team Seat Plan',
    },
    {
        slug: 'google-ai-plus-1m-account-setup',
        sku: 'AI-GOOGLE-PLUS-1M',
        nameEn: 'Google AI Plus | 1-Month Setup on Your Account',
    },
    {
        slug: 'google-ai-pro-1m-account-topup',
        sku: 'AI-GOOGLE-PRO-1M',
        nameEn: 'Google AI Pro | 1-Month Top-up on Your Account',
    },
    {
        slug: 'google-ai-pro-3m-monthly-topup',
        sku: 'AI-GOOGLE-PRO-3M',
        nameEn: 'Google AI Pro | 3-Month Monthly Top-up Service',
    },
    {
        slug: 'google-ai-ultra-1m-account-topup',
        sku: 'AI-GOOGLE-ULTRA-1M',
        nameEn: 'Google AI Ultra | 1-Month Top-up on Your Account',
    },
    {
        slug: 'claude-pro-official-gift-1m',
        sku: 'AI-CLAUDE-PRO-GIFT-1M',
        nameEn: 'Claude Pro | 1-Month Official Gift',
    },
    {
        slug: 'claude-pro-official-gift-3m',
        sku: 'AI-CLAUDE-PRO-GIFT-3M',
        nameEn: 'Claude Pro | 3-Month Official Gift',
    },
    {
        slug: 'claude-pro-official-gift-6m',
        sku: 'AI-CLAUDE-PRO-GIFT-6M',
        nameEn: 'Claude Pro | 6-Month Official Gift',
    },
    {
        slug: 'claude-pro-official-gift-12m',
        sku: 'AI-CLAUDE-PRO-GIFT-12M',
        nameEn: 'Claude Pro | 12-Month Official Gift',
    },
    {
        slug: 'claude-max-5x-official-gift-1m',
        sku: 'AI-CLAUDE-MAX5-GIFT-1M',
        nameEn: 'Claude Max 5x | 1-Month Official Gift',
    },
    {
        slug: 'claude-max-20x-official-gift-1m',
        sku: 'AI-CLAUDE-MAX20-GIFT-1M',
        nameEn: 'Claude Max 20x | 1-Month Official Gift',
    },
    {
        slug: 'supergrok-1m-account-topup',
        sku: 'AI-GROK-SUPER-1M',
        nameEn: 'SuperGrok | 1-Month Top-up on Your Account',
    },
    {
        slug: 'supergrok-plus-1m-account-topup',
        sku: 'AI-GROK-PLUS-1M',
        nameEn: 'SuperGrok Plus | 1-Month Top-up on Your Account',
    },
    {
        slug: 'x-premium-plus-1m-account-topup',
        sku: 'AI-X-PREMIUMPLUS-1M',
        nameEn: 'X Premium+ | 1-Month Top-up on Your Account',
    },
    {
        slug: 'perplexity-pro-1m-membership',
        sku: 'AI-PERPLEXITY-PRO-1M',
        nameEn: 'Perplexity Pro | 1-Month Membership Service',
    },
    {
        slug: 'perplexity-max-1m-membership',
        sku: 'AI-PERPLEXITY-MAX-1M',
        nameEn: 'Perplexity Max | 1-Month Membership Service',
    },
    {
        slug: 'yunqiao-cloudbridge-1usd-credit',
        sku: 'CG-CREDIT-1',
        nameEn: 'Yunqiao CloudBridge | USD 1 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-5usd-credit',
        sku: 'CG-CREDIT-5',
        nameEn: 'Yunqiao CloudBridge | USD 5 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-10usd-credit',
        sku: 'CG-CREDIT-10',
        nameEn: 'Yunqiao CloudBridge | USD 10 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-20usd-credit',
        sku: 'CG-CREDIT-20',
        nameEn: 'Yunqiao CloudBridge | USD 20 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-50usd-credit',
        sku: 'CG-CREDIT-50',
        nameEn: 'Yunqiao CloudBridge | USD 50 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-100usd-credit',
        sku: 'CG-CREDIT-100',
        nameEn: 'Yunqiao CloudBridge | USD 100 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-200usd-credit',
        sku: 'CG-CREDIT-200',
        nameEn: 'Yunqiao CloudBridge | USD 200 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-500usd-credit',
        sku: 'CG-CREDIT-500',
        nameEn: 'Yunqiao CloudBridge | USD 500 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-1000usd-credit',
        sku: 'CG-CREDIT-1000',
        nameEn: 'Yunqiao CloudBridge | USD 1,000 Platform Credit',
    },
    {
        slug: 'yunqiao-cloudbridge-business-team-credit',
        sku: 'CG-ENTERPRISE',
        nameEn: 'Yunqiao CloudBridge | Business and Team Credit Plan',
    },
    {
        slug: 'us-apple-id-registration-region-guidance',
        sku: 'APPLE-ID-US-SETUP',
        nameEn: 'US Apple ID | Registration and Region Setup Guidance',
    },
    {
        slug: 'japan-apple-id-registration-region-guidance',
        sku: 'APPLE-ID-JP-SETUP',
        nameEn: 'Japan Apple ID | Registration and Region Setup Guidance',
    },
    {
        slug: 'hong-kong-apple-id-registration-region-guidance',
        sku: 'APPLE-ID-HK-SETUP',
        nameEn: 'Hong Kong Apple ID | Registration and Region Setup Guidance',
    },
    {
        slug: 'singapore-apple-id-registration-region-guidance',
        sku: 'APPLE-ID-SG-SETUP',
        nameEn: 'Singapore Apple ID | Registration and Region Setup Guidance',
    },
    {
        slug: 'malaysia-apple-id-registration-region-guidance',
        sku: 'APPLE-ID-MY-SETUP',
        nameEn: 'Malaysia Apple ID | Registration and Region Setup Guidance',
    },
    {
        slug: 'apple-id-security-migration-guidance',
        sku: 'APPLE-ID-SECURITY',
        nameEn: 'Apple ID | Security Setup and Migration Guidance',
    },
    {
        slug: 'us-apple-balance-10usd-topup',
        sku: 'APPLE-BAL-US-10',
        nameEn: 'US Apple Account Balance USD 10 | Top-up / Redemption Service',
    },
    {
        slug: 'us-apple-balance-20usd-topup',
        sku: 'APPLE-BAL-US-20',
        nameEn: 'US Apple Account Balance USD 20 | Top-up / Redemption Service',
    },
    {
        slug: 'us-apple-balance-50usd-topup',
        sku: 'APPLE-BAL-US-50',
        nameEn: 'US Apple Account Balance USD 50 | Top-up / Redemption Service',
    },
    {
        slug: 'us-apple-balance-100usd-topup',
        sku: 'APPLE-BAL-US-100',
        nameEn: 'US Apple Account Balance USD 100 | Top-up / Redemption Service',
    },
    {
        slug: 'japan-apple-balance-1000jpy-topup',
        sku: 'APPLE-BAL-JP-1000',
        nameEn: 'Japan Apple Account Balance JPY 1,000 | Top-up / Redemption Service',
    },
    {
        slug: 'japan-apple-balance-3000jpy-topup',
        sku: 'APPLE-BAL-JP-3000',
        nameEn: 'Japan Apple Account Balance JPY 3,000 | Top-up / Redemption Service',
    },
    {
        slug: 'japan-apple-balance-5000jpy-topup',
        sku: 'APPLE-BAL-JP-5000',
        nameEn: 'Japan Apple Account Balance JPY 5,000 | Top-up / Redemption Service',
    },
    {
        slug: 'japan-apple-balance-10000jpy-topup',
        sku: 'APPLE-BAL-JP-10000',
        nameEn: 'Japan Apple Account Balance JPY 10,000 | Top-up / Redemption Service',
    },
    {
        slug: 'us-google-account-registration-security-guidance',
        sku: 'ACCOUNT-GOOGLE-US-SETUP',
        nameEn: 'US Google Account | Registration and Security Setup Guidance',
    },
    {
        slug: 'japan-google-account-registration-security-guidance',
        sku: 'ACCOUNT-GOOGLE-JP-SETUP',
        nameEn: 'Japan Google Account | Registration and Security Setup Guidance',
    },
    {
        slug: 'google-account-security-review',
        sku: 'ACCOUNT-GOOGLE-SECURITY',
        nameEn: 'Google Account | Security Setup Review',
    },
    {
        slug: 'us-microsoft-account-registration-security-guidance',
        sku: 'ACCOUNT-MICROSOFT-US',
        nameEn: 'US Microsoft Account | Registration and Security Setup Guidance',
    },
    {
        slug: 'global-account-region-subscription-migration-guidance',
        sku: 'ACCOUNT-REGION-MIGRATION',
        nameEn: 'Global Account | Region and Subscription Migration Guidance',
    },
] as const;

export const serviceCatalogCollections: readonly ServiceCatalogCollectionTranslation[] = [
    { slug: 'ai-subscription-topup', nameZh: 'AI 软件代充', nameEn: 'AI Subscription Top-up' },
    { slug: 'api-gateway-credit', nameZh: '中转站订阅', nameEn: 'API Gateway Credit' },
    { slug: 'apple-id-services', nameZh: 'Apple ID 服务', nameEn: 'Apple ID Services' },
    { slug: 'apple-account-balance', nameZh: 'Apple 账户余额', nameEn: 'Apple Account Balance' },
    { slug: 'google-global-accounts', nameZh: 'Google 及海外账号', nameEn: 'Google & Global Accounts' },
    { slug: 'more-ai-tools', nameZh: '更多 AI 工具', nameEn: 'More AI Tools' },
    { slug: 'chatgpt', nameZh: 'ChatGPT', nameEn: 'ChatGPT' },
    { slug: 'gemini-google-ai', nameZh: 'Gemini / Google AI', nameEn: 'Gemini / Google AI' },
    { slug: 'claude', nameZh: 'Claude', nameEn: 'Claude' },
    { slug: 'grok', nameZh: 'Grok', nameEn: 'Grok' },
    { slug: 'ai-search-productivity', nameZh: 'AI 搜索与效率', nameEn: 'AI Search & Productivity' },
    { slug: 'teams-business', nameZh: '团队与企业', nameEn: 'Teams & Business' },
    { slug: 'gateway-starter-credit', nameZh: '入门额度', nameEn: 'Starter Credit' },
    { slug: 'gateway-standard-credit', nameZh: '标准额度', nameEn: 'Standard Credit' },
    { slug: 'gateway-high-volume-credit', nameZh: '大额额度', nameEn: 'High-volume Credit' },
    { slug: 'gateway-business-credit', nameZh: '企业额度', nameEn: 'Business Credit' },
    { slug: 'apple-id-us', nameZh: '美区 Apple ID', nameEn: 'US Apple ID' },
    { slug: 'apple-id-jp', nameZh: '日区 Apple ID', nameEn: 'Japan Apple ID' },
    { slug: 'apple-id-hk', nameZh: '港区 Apple ID', nameEn: 'Hong Kong Apple ID' },
    { slug: 'apple-id-sg-my', nameZh: '新加坡与马来西亚', nameEn: 'Singapore & Malaysia' },
    { slug: 'apple-id-security-migration', nameZh: '安全与迁移', nameEn: 'Security & Migration' },
    { slug: 'apple-balance-us', nameZh: '美区余额', nameEn: 'US Balance' },
    { slug: 'apple-balance-jp', nameZh: '日区余额', nameEn: 'Japan Balance' },
    { slug: 'apple-balance-hk', nameZh: '港区余额', nameEn: 'Hong Kong Balance' },
    { slug: 'apple-balance-other', nameZh: '其他地区', nameEn: 'Other Regions' },
    { slug: 'google-us', nameZh: '美区 Google', nameEn: 'Google US' },
    { slug: 'google-jp', nameZh: '日区 Google', nameEn: 'Google Japan' },
    { slug: 'microsoft-accounts', nameZh: 'Microsoft 账号', nameEn: 'Microsoft Accounts' },
    { slug: 'account-region-security', nameZh: '地区与安全设置', nameEn: 'Region & Security Setup' },
    { slug: 'other-global-services', nameZh: '其他海外服务', nameEn: 'Other Global Services' },
    { slug: 'ai-coding-tools', nameZh: 'AI 编程', nameEn: 'AI Coding' },
    { slug: 'ai-design-tools', nameZh: 'AI 设计', nameEn: 'AI Design' },
    { slug: 'ai-video-tools', nameZh: 'AI 视频', nameEn: 'AI Video' },
    { slug: 'ai-productivity-tools', nameZh: 'AI 效率工具', nameEn: 'AI Productivity' },
    { slug: 'ai-audio-music', nameZh: 'AI 音频与音乐', nameEn: 'AI Audio & Music' },
] as const;

export class CompleteBilingualServiceCatalog1787612400000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await this.enableAnsiIdentifierQuotes(queryRunner);
        if (
            !(await queryRunner.hasTable('product_translation')) ||
            !(await queryRunner.hasTable('product_variant')) ||
            !(await queryRunner.hasTable('product_variant_translation'))
        ) {
            return;
        }

        for (const product of serviceCatalogProducts) {
            const [translation] = (await queryRunner.query(
                `SELECT "baseId" FROM "product_translation" WHERE "slug" = ? LIMIT 1`,
                [product.slug],
            )) as Array<{ baseId: string | number }>;
            if (!translation) continue;

            await this.upsertProductLikeTranslation(
                queryRunner,
                'product_translation',
                translation.baseId,
                'en',
                product.slug,
                product.nameEn,
                this.englishProductDescription(product),
            );
            const variants = (await queryRunner.query(
                `SELECT "id" FROM "product_variant" WHERE "productId" = ? AND "sku" = ?`,
                [translation.baseId, product.sku],
            )) as Array<{ id: string | number }>;
            for (const variant of variants) {
                await this.upsertNamedTranslation(
                    queryRunner,
                    'product_variant_translation',
                    variant.id,
                    'en',
                    product.nameEn,
                );
            }
        }

        if (!(await queryRunner.hasTable('collection_translation'))) return;
        for (const collection of serviceCatalogCollections) {
            const [translation] = (await queryRunner.query(
                `SELECT "baseId" FROM "collection_translation" WHERE "slug" = ? LIMIT 1`,
                [collection.slug],
            )) as Array<{ baseId: string | number }>;
            if (!translation) continue;
            await this.upsertProductLikeTranslation(
                queryRunner,
                'collection_translation',
                translation.baseId,
                'zh_Hans',
                collection.slug,
                collection.nameZh,
                this.collectionDescription(collection.nameZh, true),
            );
            await this.upsertProductLikeTranslation(
                queryRunner,
                'collection_translation',
                translation.baseId,
                'en',
                collection.slug,
                collection.nameEn,
                this.collectionDescription(collection.nameEn, false),
            );
        }
    }

    public async down(): Promise<void> {
        // Updated merchant translations are intentionally preserved to avoid deleting catalog content.
    }

    private englishProductDescription(product: ServiceCatalogProductTranslation): string {
        if (product.slug.includes('cloudbridge')) {
            return [
                `<p>${product.nameEn}. This is credit for the CloudBridge platform.`,
                'It is not cash or a balance in an official third-party API account, and it cannot be withdrawn or transferred.',
                "Available models, usage rates, limits and service status follow the platform's current terms.",
                'Please confirm the target account before ordering.</p>',
            ].join(' ');
        }
        if (product.slug.includes('apple-balance')) {
            return [
                `<p>${product.nameEn}. The Apple account region must match the selected balance region and denomination.`,
                'Confirm the account region, current subscriptions and payment details before ordering.',
                'Completed top-ups or redemptions generally cannot be transferred to another region.</p>',
            ].join(' ');
        }
        if (
            product.slug.includes('registration') ||
            product.slug.includes('security') ||
            product.slug.includes('migration')
        ) {
            return [
                `<p>${product.nameEn}. Confirm the target region, existing account, payment method,`,
                'subscription status and possible migration impact before ordering.',
                'Never place passwords, verification codes or recovery keys in a normal order note.',
                'Review signed-in devices and enable two-factor authentication after completion.</p>',
            ].join(' ');
        }
        return [
            `<p>${product.nameEn}. Confirm the account region, current subscription, eligibility`,
            'and any conflicting subscription before ordering.',
            'Service availability, features and taxes may differ by region.',
            'Never place passwords or other sensitive credentials in a normal order note.',
            'Delivery and after-sales eligibility depend on the product details and actual processing status.</p>',
        ].join(' ');
    }

    private collectionDescription(name: string, isChinese: boolean): string {
        return isChinese
            ? `<p>${name}相关商品与服务。下单前请确认地区、账号条件、交付方式和售后规则。</p>`
            : `<p>Products and services for ${name}. Confirm the region, account requirements, delivery method and after-sales terms before ordering.</p>`;
    }

    private async upsertProductLikeTranslation(
        queryRunner: QueryRunner,
        table: 'product_translation' | 'collection_translation',
        baseId: string | number,
        languageCode: 'en' | 'zh_Hans',
        slug: string,
        name: string,
        description: string,
    ): Promise<void> {
        await queryRunner.query(
            `UPDATE "${table}" SET "name" = ?, "slug" = ?, "description" = ? ` +
                `WHERE "baseId" = ? AND "languageCode" = ?`,
            [name, slug, description, baseId, languageCode],
        );
        await queryRunner.query(
            `INSERT INTO "${table}" ("languageCode", "name", "slug", "description", "baseId") ` +
                `SELECT ?, ?, ?, ?, source."baseId" FROM "${table}" source ` +
                `WHERE source."baseId" = ? AND NOT EXISTS (` +
                `SELECT 1 FROM "${table}" existing WHERE existing."baseId" = source."baseId" ` +
                `AND existing."languageCode" = ?) LIMIT 1`,
            [languageCode, name, slug, description, baseId, languageCode],
        );
    }

    private async upsertNamedTranslation(
        queryRunner: QueryRunner,
        table: 'product_variant_translation',
        baseId: string | number,
        languageCode: 'en',
        name: string,
    ): Promise<void> {
        await queryRunner.query(
            `UPDATE "${table}" SET "name" = ? WHERE "baseId" = ? AND "languageCode" = ?`,
            [name, baseId, languageCode],
        );
        await queryRunner.query(
            `INSERT INTO "${table}" ("languageCode", "name", "baseId") ` +
                `SELECT ?, ?, source."baseId" FROM "${table}" source ` +
                `WHERE source."baseId" = ? AND NOT EXISTS (` +
                `SELECT 1 FROM "${table}" existing WHERE existing."baseId" = source."baseId" ` +
                `AND existing."languageCode" = ?) LIMIT 1`,
            [languageCode, name, baseId, languageCode],
        );
    }

    private async enableAnsiIdentifierQuotes(queryRunner: QueryRunner): Promise<void> {
        if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
            await queryRunner.query(
                `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
            );
        }
    }
}
