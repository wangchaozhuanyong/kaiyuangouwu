import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const storefrontAssetDirectory = path.resolve(
    scriptDirectory,
    '../../storefront/src/assets/storefront/damatong',
);
const brandAssetDirectory = path.resolve(
    scriptDirectory,
    '../../storefront/src/assets/brand/damatong-market',
);

export const DAMATONG_AI_PLUGIN_CODE = 'ai-image-studio-entry';

export const damatongStorefront = Object.freeze({
    channelCode: 'my-malaysia',
    sourceChannelCode: '__default_channel__',
    storefrontNameZh: '大马通 DAMATONG',
    storefrontNameEn: 'DAMATONG',
    descriptionZh: '马来西亚华人精选超市与实用服务平台',
    descriptionEn: 'A curated Chinese marketplace and practical services platform for Malaysia.',
    taglineZh: '中国好物与在马服务，一站办妥',
    taglineEn: 'Chinese favourites and Malaysia services, in one place.',
    brandBackgroundColor: '#f5f7fb',
    brandPrimaryColor: '#2f6feb',
    brandAccentColor: '#102d4a',
    brandHighlightColor: '#f28c28',
    heroAutoplayIntervalSeconds: 6,
    supportContactsReadyForProduction: false,
});

export const damatongAssets = Object.freeze([
    {
        key: 'brand-app-icon',
        file: path.join(brandAssetDirectory, 'app-icon.svg'),
        mimeType: 'image/svg+xml',
        nameZh: '大马通应用图标',
        nameEn: 'Damatong app icon',
        profileField: 'logoAssetId',
    },
    {
        key: 'brand-logo-light',
        file: path.join(brandAssetDirectory, 'logo-on-light.svg'),
        mimeType: 'image/svg+xml',
        nameZh: '大马通浅色背景标识',
        nameEn: 'Damatong logo on light',
        profileField: 'logoOnLightAssetId',
    },
    {
        key: 'brand-logo-dark',
        file: path.join(brandAssetDirectory, 'logo-on-dark.svg'),
        mimeType: 'image/svg+xml',
        nameZh: '大马通深色背景标识',
        nameEn: 'Damatong logo on dark',
        profileField: 'logoOnDarkAssetId',
    },
    {
        key: 'hero-marketplace',
        file: path.join(storefrontAssetDirectory, 'hero-marketplace.webp'),
        mimeType: 'image/webp',
        nameZh: '大马通首页精选商品与服务主视觉',
        nameEn: 'Damatong marketplace homepage hero',
    },
    {
        key: 'hero-malaysia-services',
        file: path.join(storefrontAssetDirectory, 'hero-services-v1.webp'),
        mimeType: 'image/webp',
        nameZh: '大马通在马签证与申请服务轮播图',
        nameEn: 'Damatong Malaysia application services hero',
    },
    {
        key: 'hero-ai-subscriptions',
        file: path.join(storefrontAssetDirectory, 'hero-ai-subscriptions-v1.webp'),
        mimeType: 'image/webp',
        nameZh: '大马通 AI 工具与软件订阅轮播图',
        nameEn: 'Damatong AI tools and software subscriptions hero',
    },
    {
        key: 'auth-login',
        file: path.join(storefrontAssetDirectory, 'auth-login.webp'),
        mimeType: 'image/webp',
        nameZh: '大马通登录页主视觉',
        nameEn: 'Damatong login visual',
    },
    {
        key: 'auth-register',
        file: path.join(storefrontAssetDirectory, 'auth-register.webp'),
        mimeType: 'image/webp',
        nameZh: '大马通注册页主视觉',
        nameEn: 'Damatong registration visual',
    },
    {
        key: 'category-authentic-cigarettes',
        file: path.join(storefrontAssetDirectory, 'category-authentic-cigarettes.webp'),
        mimeType: 'image/webp',
        nameZh: '正品香烟分类视觉',
        nameEn: 'Authentic cigarettes category visual',
    },
    {
        key: 'category-authentic-baijiu',
        file: path.join(storefrontAssetDirectory, 'category-authentic-baijiu.webp'),
        mimeType: 'image/webp',
        nameZh: '正品白酒分类视觉',
        nameEn: 'Authentic baijiu category visual',
    },
    {
        key: 'category-authentic-betel-nut',
        file: path.join(storefrontAssetDirectory, 'category-authentic-betel-nut.webp'),
        mimeType: 'image/webp',
        nameZh: '正品槟榔分类视觉',
        nameEn: 'Authentic betel-nut category visual',
    },
    {
        key: 'category-tank-coffee',
        file: path.join(storefrontAssetDirectory, 'category-tank-coffee.webp'),
        mimeType: 'image/webp',
        nameZh: '坦克咖啡分类视觉',
        nameEn: 'Tank coffee category visual',
    },
    {
        key: 'category-business-services',
        file: path.join(storefrontAssetDirectory, 'category-business-services.webp'),
        mimeType: 'image/webp',
        nameZh: '商业服务分类视觉',
        nameEn: 'Business services category visual',
    },
    {
        key: 'category-software-subscriptions',
        file: path.join(storefrontAssetDirectory, 'category-software-subscriptions.webp'),
        mimeType: 'image/webp',
        nameZh: '软件订阅分类视觉',
        nameEn: 'Software subscriptions category visual',
    },
]);

export const damatongCategories = Object.freeze([
    {
        code: 'authentic-cigarettes',
        assetKey: 'category-authentic-cigarettes',
        translations: [
            {
                languageCode: 'en',
                name: 'Authentic cigarettes',
                slug: 'authentic-cigarettes',
                description: 'Sealed tobacco products for customers who meet local age requirements.',
            },
            {
                languageCode: 'zh_Hans',
                name: '正品香烟',
                slug: 'zhengpin-xiangyan',
                description: '未拆封烟草商品，仅面向符合当地法定年龄与合规要求的顾客。',
            },
        ],
    },
    {
        code: 'authentic-baijiu',
        assetKey: 'category-authentic-baijiu',
        translations: [
            {
                languageCode: 'en',
                name: 'Authentic baijiu',
                slug: 'authentic-baijiu',
                description: 'Sealed Chinese baijiu selections for customers of legal drinking age.',
            },
            {
                languageCode: 'zh_Hans',
                name: '正品白酒',
                slug: 'zhengpin-baijiu',
                description: '中国白酒精选，仅面向符合当地法定饮酒年龄的顾客。',
            },
        ],
    },
    {
        code: 'authentic-betel-nut',
        assetKey: 'category-authentic-betel-nut',
        translations: [
            {
                languageCode: 'en',
                name: 'Authentic betel nut',
                slug: 'authentic-betel-nut',
                description: 'Sealed processed betel-nut products for adults where local sale is permitted.',
            },
            {
                languageCode: 'zh_Hans',
                name: '正品槟榔',
                slug: 'zhengpin-binglang',
                description: '未拆封槟榔商品，仅面向符合当地年龄与销售规定的成年顾客。',
            },
        ],
    },
    {
        code: 'tank-coffee',
        assetKey: 'category-tank-coffee',
        translations: [
            {
                languageCode: 'en',
                name: 'Tank coffee',
                slug: 'tank-coffee',
                description: 'Ready-to-drink coffee and selected coffee products.',
            },
            {
                languageCode: 'zh_Hans',
                name: '坦克咖啡',
                slug: 'tank-kafei',
                description: '即饮咖啡与精选咖啡商品。',
            },
        ],
    },
    {
        code: 'business-services',
        assetKey: 'category-business-services',
        translations: [
            {
                languageCode: 'en',
                name: 'Business services',
                slug: 'business-services',
                description: 'Work, study and Malaysia My Second Home application support services.',
            },
            {
                languageCode: 'zh_Hans',
                name: '商业服务',
                slug: 'shangye-fuwu',
                description: '工作签证、留学签证与马来西亚第二家园申请支持服务。',
            },
        ],
    },
    {
        code: 'software-subscriptions',
        assetKey: 'category-software-subscriptions',
        translations: [
            {
                languageCode: 'en',
                name: 'Software subscriptions',
                slug: 'software-subscriptions',
                description: 'AI software subscriptions, assisted top-ups and digital services.',
            },
            {
                languageCode: 'zh_Hans',
                name: '软件订阅',
                slug: 'ruanjian-dingyue',
                description: 'AI 软件订阅、代充与数字服务。',
            },
        ],
    },
]);

function translation(languageCode, title, subtitle = '', body = '', ctaLabel = '') {
    return { languageCode, title, subtitle, body, ctaLabel };
}

function itemTranslation(languageCode, label, description = '') {
    return { languageCode, label, description };
}

function assetId(assetIdsByKey, key) {
    const id = assetIdsByKey.get(key);
    if (!id) throw new Error(`Missing Damatong asset ID for ${key}`);
    return id;
}

function collectionId(collectionIdsByCode, code) {
    const id = collectionIdsByCode.get(code);
    if (!id) throw new Error(`Missing Damatong collection ID for ${code}`);
    return id;
}

function syncedAiPluginItem(sourceAiPluginItem, sourceChannelCode) {
    if (!sourceAiPluginItem) {
        throw new Error(`Default Channel is missing ${DAMATONG_AI_PLUGIN_CODE}`);
    }
    return {
        enabled: true,
        position: 0,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: {
            ...(sourceAiPluginItem.settings ?? {}),
            pluginCode: DAMATONG_AI_PLUGIN_CODE,
            placement: 'BUSINESS_SERVICES_MAIN',
            categoryScope: 'ALL',
            categoryIds: [],
            includeChildren: true,
            syncedFromChannel: sourceChannelCode,
        },
        translations: sourceAiPluginItem.translations.map(value => ({
            languageCode: value.languageCode,
            label: value.label,
            description: value.description ?? '',
        })),
    };
}

export function buildDamatongContentBlocks({
    assetIdsByKey,
    collectionIdsByCode,
    sourceAiPluginItem,
    sourceChannelCode = damatongStorefront.sourceChannelCode,
}) {
    const quickItems = damatongCategories.map((category, position) => {
        const en = category.translations.find(value => value.languageCode === 'en');
        const zh = category.translations.find(value => value.languageCode === 'zh_Hans');
        return {
            enabled: true,
            position,
            imageAssetId: assetId(assetIdsByKey, category.assetKey),
            imageUrl: null,
            targetType: 'COLLECTION',
            targetValue: collectionId(collectionIdsByCode, category.code),
            settings: { categoryCode: category.code },
            translations: [
                itemTranslation('zh_Hans', zh.name, zh.description),
                itemTranslation('en', en.name, en.description),
            ],
        };
    });

    const heroCampaigns = [
        {
            code: 'damatong-hero-marketplace',
            internalName: '大马通商品选购轮播广告',
            campaign: 'damatong-goods-v2',
            assetKey: 'hero-marketplace',
            targetType: 'PAGE',
            targetValue: '/category',
            zh: {
                title: '中国好物，在马选购',
                subtitle: '大马通严选',
                body: '正品香烟、白酒、槟榔与坦克咖啡，按分类直达。',
                cta: '逛商品',
            },
            en: {
                title: 'Shop Chinese favourites in Malaysia',
                subtitle: 'Selected by Damatong',
                body: 'Browse tobacco, baijiu, betel-nut products and Tank coffee by category.',
                cta: 'Shop goods',
            },
            stats: [
                ['categories', '6', '核心分类', '6', 'Core categories'],
                ['market', 'MY', '在马选购', 'MY', 'Malaysia access'],
                ['languages', '中英', '双语支持', 'ZH/EN', 'Bilingual support'],
            ],
            theme: {
                backgroundColor: '#fff8ee',
                textColor: '#142033',
                secondaryTextColor: '#3f4f63',
                accentColor: '#2f6feb',
                accentSecondaryColor: '#2458bd',
                buttonTextColor: '#ffffff',
            },
        },
        {
            code: 'damatong-hero-malaysia-services',
            internalName: '大马通在马服务轮播广告',
            campaign: 'damatong-malaysia-services-v2',
            assetKey: 'hero-malaysia-services',
            targetType: 'COLLECTION',
            targetValue: collectionId(collectionIdsByCode, 'business-services'),
            zh: {
                title: '在马办服务，更清楚',
                subtitle: '工作·留学·第二家园',
                body: '先看条件与服务范围，再做资料梳理和进度跟进。',
                cta: '了解办理服务',
            },
            en: {
                title: 'Malaysia services, clearly explained',
                subtitle: 'Work · Study · MM2H',
                body: 'Review requirements and scope before document preparation and progress support.',
                cta: 'Explore services',
            },
            stats: [
                ['service-types', '3', '办理方向', '3', 'Service paths'],
                ['preparation', '清单', '条件梳理', 'Plan', 'Requirement check'],
                ['follow-up', '跟进', '进度协助', 'Track', 'Progress support'],
            ],
            theme: {
                backgroundColor: '#f1f7ff',
                textColor: '#142033',
                secondaryTextColor: '#3f4f63',
                accentColor: '#2f6feb',
                accentSecondaryColor: '#2458bd',
                buttonTextColor: '#ffffff',
            },
        },
        {
            code: 'damatong-hero-ai-subscriptions',
            internalName: '大马通 AI 与软件订阅轮播广告',
            campaign: 'damatong-ai-subscriptions-v2',
            assetKey: 'hero-ai-subscriptions',
            targetType: 'PAGE',
            targetValue: '/services',
            zh: {
                title: 'AI 与订阅，一站开通',
                subtitle: '数字服务专区',
                body: 'AI 工具、软件订阅与代充入口，集中查看更省心。',
                cta: '查看 AI 服务',
            },
            en: {
                title: 'AI tools and subscriptions in one place',
                subtitle: 'Digital services',
                body: 'Open AI tools, software subscriptions and assisted top-up services from one hub.',
                cta: 'View AI services',
            },
            stats: [
                ['ai-tools', 'AI', '创作工具', 'AI', 'Creative tools'],
                ['subscriptions', '订阅', '数字服务', 'Plans', 'Digital access'],
                ['account', '统一', '账户入口', 'One', 'Account hub'],
            ],
            theme: {
                backgroundColor: '#f7f8fc',
                textColor: '#142033',
                secondaryTextColor: '#3f4f63',
                accentColor: '#2f6feb',
                accentSecondaryColor: '#2458bd',
                buttonTextColor: '#ffffff',
            },
        },
    ];
    const heroBlocks = heroCampaigns.map((campaign, position) => ({
        code: campaign.code,
        internalName: campaign.internalName,
        type: 'HERO',
        layoutVariant: 'HERO_OVERLAY',
        enabled: true,
        position: 10 + position,
        startsAt: null,
        endsAt: null,
        imageAssetId: assetId(assetIdsByKey, campaign.assetKey),
        imageUrl: null,
        backgroundColor: campaign.theme.backgroundColor,
        textColor: campaign.theme.textColor,
        targetType: campaign.targetType,
        targetValue: campaign.targetValue,
        settings: {
            heroTheme: 'standard',
            heroOverlay: true,
            contrastMode: 'high',
            campaign: campaign.campaign,
            accentColor: campaign.theme.accentColor,
            accentSecondaryColor: campaign.theme.accentSecondaryColor,
            secondaryTextColor: campaign.theme.secondaryTextColor,
            buttonTextColor: campaign.theme.buttonTextColor,
        },
        translations: [
            translation(
                'zh_Hans',
                campaign.zh.title,
                campaign.zh.subtitle,
                campaign.zh.body,
                campaign.zh.cta,
            ),
            translation('en', campaign.en.title, campaign.en.subtitle, campaign.en.body, campaign.en.cta),
        ],
        items: campaign.stats.map(([key, zhValue, zhLabel, enValue, enLabel], statPosition) => ({
            enabled: true,
            position: statPosition,
            targetType: 'NONE',
            targetValue: null,
            settings: { metricKey: key },
            translations: [
                itemTranslation('zh_Hans', zhValue, zhLabel),
                itemTranslation('en', enValue, enLabel),
            ],
        })),
    }));

    return [
        ...heroBlocks,
        {
            code: 'damatong-trust-bar',
            internalName: '大马通服务保障栏',
            type: 'TRUST_BAR',
            layoutVariant: 'ICON_GRID',
            enabled: true,
            position: 20,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#ffffff',
            textColor: '#334155',
            targetType: 'NONE',
            targetValue: null,
            settings: { trustBarVersion: 3, visualStyle: 'damatong-balanced' },
            translations: [translation('zh_Hans', '服务保障'), translation('en', 'Service standards')],
            items: [
                ['信息清晰', 'Clear information'],
                ['订单可查', 'Trackable orders'],
                ['在马客服', 'Malaysia support'],
                ['人工跟进', 'Human follow-up'],
            ].map(([zh, en], position) => ({
                enabled: true,
                position,
                targetType: 'NONE',
                targetValue: null,
                settings: { trustKey: ['details', 'orders', 'support', 'follow-up'][position] },
                translations: [itemTranslation('zh_Hans', zh), itemTranslation('en', en)],
            })),
        },
        {
            code: 'damatong-quick-links',
            internalName: '大马通六大分类入口',
            type: 'QUICK_LINKS',
            layoutVariant: 'ICON_GRID',
            enabled: true,
            position: 30,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#ffffff',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: { quickLinksVersion: 4, visualStyle: 'damatong-balanced' },
            translations: [
                translation('zh_Hans', '精选分类', '按需直达'),
                translation('en', 'Shop by category', 'Go straight to what you need'),
            ],
            items: quickItems,
        },
        {
            code: 'damatong-notice',
            internalName: '大马通首页公告',
            type: 'NOTICE',
            layoutVariant: 'TICKER',
            enabled: true,
            position: 40,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#fff8e8',
            textColor: '#654012',
            targetType: 'SUPPORT',
            targetValue: '/support',
            settings: { rotationIntervalSeconds: 6 },
            translations: [
                translation(
                    'zh_Hans',
                    '服务提醒',
                    '',
                    '商品价格、库存与服务办理条件以详情页和客服确认为准。',
                    '联系客服',
                ),
                translation(
                    'en',
                    'Service notice',
                    '',
                    'Confirm current price, stock and application requirements on the detail page or with support.',
                    'Contact support',
                ),
            ],
            items: [],
        },
        {
            code: 'damatong-business-services-feature',
            internalName: '大马通商业服务专区',
            type: 'CATEGORY_AD',
            layoutVariant: 'PRODUCT_GRID',
            enabled: true,
            position: 50,
            startsAt: null,
            endsAt: null,
            imageAssetId: assetId(assetIdsByKey, 'hero-malaysia-services'),
            imageUrl: null,
            backgroundColor: '#f1f7ff',
            textColor: '#142033',
            targetType: 'COLLECTION',
            targetValue: collectionId(collectionIdsByCode, 'business-services'),
            settings: { productIds: [], count: 4, visualStyle: 'damatong-balanced' },
            translations: [
                translation(
                    'zh_Hans',
                    '在马生活与签证服务',
                    '工作·留学·第二家园',
                    '从资料梳理到进度跟进，先了解条件与服务范围再提交。',
                    '查看服务',
                ),
                translation(
                    'en',
                    'Malaysia application support',
                    'Work, study and MM2H',
                    'Review requirements and service scope before submitting an application.',
                    'View services',
                ),
            ],
            items: [],
        },
        {
            code: 'damatong-story',
            internalName: '大马通品牌介绍',
            type: 'STORY',
            layoutVariant: 'RICH_TEXT',
            enabled: true,
            position: 110,
            startsAt: null,
            endsAt: null,
            imageAssetId: assetId(assetIdsByKey, 'category-software-subscriptions'),
            imageUrl: null,
            backgroundColor: '#ffffff',
            textColor: '#142033',
            targetType: 'PAGE',
            targetValue: '/services',
            settings: { storyVersion: 2 },
            translations: [
                translation(
                    'zh_Hans',
                    '不只是商品，还有在马需要的服务',
                    '大马通·一个账户统一管理',
                    '实物商品、签证服务、软件订阅与 AI 工具入口，购买记录和售后进度集中查看。',
                    '打开服务中心',
                ),
                translation(
                    'en',
                    'Goods and practical services in one account',
                    'Damatong for everyday needs in Malaysia',
                    'Manage physical goods, application support, software subscriptions and AI tools together.',
                    'Open services',
                ),
            ],
            items: [],
        },
        {
            code: 'damatong-legal',
            internalName: '大马通条款与隐私',
            type: 'LEGAL',
            layoutVariant: 'RICH_TEXT',
            enabled: true,
            position: 1000,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#f5f7fb',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: { legalDraftVersion: 1, merchantReviewRequired: true },
            translations: [
                translation('zh_Hans', '大马通条款与隐私'),
                translation('en', 'Damatong terms and privacy'),
            ],
            items: [
                {
                    enabled: true,
                    position: 0,
                    targetType: 'PAGE',
                    targetValue: 'privacy',
                    settings: { documentKind: 'privacy' },
                    translations: [
                        itemTranslation(
                            'zh_Hans',
                            '隐私政策',
                            '我们仅为账号、订单、客服与服务申请收集必要信息。资料仅用于完成所选服务、履行法定义务与处理售后。请勿通过普通客服聊天发送密码、验证码或支付密钥。需要更新或删除个人资料时，请从客服中心联系我们。',
                        ),
                        itemTranslation(
                            'en',
                            'Privacy policy',
                            'We collect only the information needed for accounts, orders, support ' +
                                'and service applications. It is used to fulfil the selected service, ' +
                                'meet legal duties and handle after-sales requests. Do not send passwords, ' +
                                'verification codes or payment keys through ordinary support chat. ' +
                                'Contact support to request access, correction or deletion.',
                        ),
                    ],
                },
                {
                    enabled: true,
                    position: 1,
                    targetType: 'PAGE',
                    targetValue: 'terms',
                    settings: { documentKind: 'terms' },
                    translations: [
                        itemTranslation(
                            'zh_Hans',
                            '使用条款',
                            '下单前请核对商品、价格、库存、交付方式与售后范围。烟酒商品仅限符合当地法定年龄与合规要求的顾客；签证与第二家园服务不保证审批结果；软件订阅和代充需遵守对应平台规则。大马通可以拒绝不符合法律、支付或交付要求的订单。',
                        ),
                        itemTranslation(
                            'en',
                            'Terms of use',
                            'Review the product, price, stock, delivery method and after-sales scope ' +
                                'before ordering. Tobacco and alcohol are limited to customers who meet ' +
                                'local age and compliance requirements. Application services do not ' +
                                'guarantee approval. Software subscriptions and assisted top-ups remain ' +
                                'subject to the relevant platform rules. Damatong may reject orders that ' +
                                'do not meet legal, payment or delivery requirements.',
                        ),
                    ],
                },
            ],
        },
        {
            code: 'damatong-support',
            internalName: '大马通客服配置',
            type: 'SUPPORT',
            layoutVariant: 'RICH_TEXT',
            enabled: true,
            position: 1010,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#f5f7fb',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: {
                serviceDaysZh: '每日',
                serviceDaysEn: 'Daily',
                serviceStartTime: '09:00',
                serviceEndTime: '21:00',
                placeholderContacts: true,
            },
            translations: [
                translation(
                    'zh_Hans',
                    '客服中心',
                    '商品、订单与服务办理问题都可以在这里咨询',
                    '当前联系方式为临时占位，上线前请在后台替换为正式账号。',
                ),
                translation(
                    'en',
                    'Customer support',
                    'Ask about products, orders and service applications.',
                    'These contact links are placeholders and must be replaced in the Dashboard before launch.',
                ),
            ],
            items: [
                {
                    enabled: false,
                    position: 0,
                    targetType: 'NONE',
                    targetValue: null,
                    settings: { supportChannel: 'WECHAT' },
                    translations: [
                        itemTranslation('zh_Hans', '微信客服', '上传正式二维码后启用'),
                        itemTranslation(
                            'en',
                            'WeChat support',
                            'Enable after uploading the official QR code',
                        ),
                    ],
                },
                {
                    enabled: true,
                    position: 1,
                    targetType: 'URL',
                    targetValue: 'https://wa.me/00000000000',
                    settings: { supportChannel: 'WHATSAPP', supportAccount: '00000000000' },
                    translations: [
                        itemTranslation('zh_Hans', 'WhatsApp', '临时入口，上线前请替换'),
                        itemTranslation('en', 'WhatsApp', 'Placeholder link - replace before launch'),
                    ],
                },
                {
                    enabled: true,
                    position: 2,
                    targetType: 'URL',
                    targetValue: 'https://t.me/damatong_placeholder_contact',
                    settings: {
                        supportChannel: 'TELEGRAM',
                        supportAccount: 'damatong_placeholder_contact',
                    },
                    translations: [
                        itemTranslation('zh_Hans', 'Telegram', '临时入口，上线前请替换'),
                        itemTranslation('en', 'Telegram', 'Placeholder link - replace before launch'),
                    ],
                },
                {
                    enabled: false,
                    position: 3,
                    targetType: 'NONE',
                    targetValue: null,
                    settings: { supportChannel: 'QQ' },
                    translations: [
                        itemTranslation('zh_Hans', 'QQ客服', '填写正式跳转链接后启用'),
                        itemTranslation('en', 'QQ support', 'Enable after adding the official link'),
                    ],
                },
                {
                    enabled: false,
                    position: 4,
                    targetType: 'NONE',
                    targetValue: null,
                    settings: { supportChannel: 'QQ_GROUP' },
                    translations: [
                        itemTranslation('zh_Hans', 'QQ群', '填写正式群链接后启用'),
                        itemTranslation('en', 'QQ group', 'Enable after adding the official group link'),
                    ],
                },
            ],
        },
        {
            code: 'auth-login-visual',
            internalName: '大马通登录页主视觉',
            type: 'AUTH_LOGIN',
            layoutVariant: 'HERO_OVERLAY',
            enabled: true,
            position: 1020,
            startsAt: null,
            endsAt: null,
            imageAssetId: assetId(assetIdsByKey, 'auth-login'),
            imageUrl: null,
            backgroundColor: '#f1f7ff',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: { authVisualVersion: 3, accentColor: '#2f6feb' },
            translations: [
                translation(
                    'zh_Hans',
                    '欢迎回到大马通',
                    '订单、收藏、售后与服务进度，登录后集中管理',
                    '',
                    '一个账户·五类服务',
                ),
                translation(
                    'en',
                    'Welcome back to Damatong',
                    'Manage orders, favourites, after-sales requests and service progress in one place.',
                    '',
                    'ONE ACCOUNT, FIVE CATEGORIES',
                ),
            ],
            items: [
                ['订单可查', 'Track orders'],
                ['服务进度', 'Service progress'],
                ['在马客服', 'Malaysia support'],
            ].map(([zh, en], position) => ({
                enabled: true,
                position,
                targetType: 'NONE',
                targetValue: null,
                settings: { authTag: ['orders', 'progress', 'support'][position] },
                translations: [itemTranslation('zh_Hans', zh), itemTranslation('en', en)],
            })),
        },
        {
            code: 'auth-register-visual',
            internalName: '大马通注册页主视觉',
            type: 'AUTH_REGISTER',
            layoutVariant: 'HERO_OVERLAY',
            enabled: true,
            position: 1030,
            startsAt: null,
            endsAt: null,
            imageAssetId: assetId(assetIdsByKey, 'auth-register'),
            imageUrl: null,
            backgroundColor: '#fff8ee',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: { authVisualVersion: 3, accentColor: '#2f6feb' },
            translations: [
                translation(
                    'zh_Hans',
                    '创建你的大马通账户',
                    '从中国好物到在马服务，购买与跟进记录统一保存',
                    '',
                    '加入大马通',
                ),
                translation(
                    'en',
                    'Create your Damatong account',
                    'Keep purchases and service follow-ups together, from Chinese goods to Malaysia services.',
                    '',
                    'JOIN DAMATONG',
                ),
            ],
            items: [
                ['快速注册', 'Quick signup'],
                ['统一管理', 'One place'],
                ['专人跟进', 'Human follow-up'],
            ].map(([zh, en], position) => ({
                enabled: true,
                position,
                targetType: 'NONE',
                targetValue: null,
                settings: { authTag: ['signup', 'manage', 'follow-up'][position] },
                translations: [itemTranslation('zh_Hans', zh), itemTranslation('en', en)],
            })),
        },
        {
            code: 'storefront-navigation',
            internalName: '大马通客户端导航',
            type: 'NAVIGATION',
            layoutVariant: 'ICON_GRID',
            enabled: true,
            position: 1040,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#ffffff',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: { navigationVersion: 1 },
            translations: [translation('zh_Hans', '客户端导航'), translation('en', 'Storefront navigation')],
            items: [
                ['home', '/', '首页', 'Home'],
                ['category', '/category', '分类', 'Shop'],
                ['services', '/services', 'AI服务', 'AI services'],
                ['cart', '/cart', '购物车', 'Cart'],
                ['account', '/account', '我的', 'Account'],
            ].map(([key, targetValue, zh, en], position) => ({
                enabled: true,
                position,
                targetType: 'PAGE',
                targetValue,
                settings: { navigationKey: key },
                translations: [itemTranslation('zh_Hans', zh), itemTranslation('en', en)],
            })),
        },
        {
            code: 'storefront-client-plugins',
            internalName: '大马通客户端插件配置',
            type: 'CLIENT_PLUGINS',
            layoutVariant: 'CUSTOM',
            enabled: true,
            position: 1050,
            startsAt: null,
            endsAt: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: '#f7f8fc',
            textColor: '#142033',
            targetType: 'NONE',
            targetValue: null,
            settings: {
                version: 1,
                page: 'category',
                businessServicesCopyVersion: 1,
                syncedPluginCodes: [DAMATONG_AI_PLUGIN_CODE],
                syncedFromChannel: sourceChannelCode,
            },
            translations: [
                translation(
                    'zh_Hans',
                    '大马通 AI 服务',
                    '与默认站使用同一插件版本',
                    '在这里使用已开放的 AI 工具与数字服务。',
                    '',
                ),
                translation(
                    'en',
                    'Damatong AI services',
                    'Uses the same plugin version as the default site',
                    'Use the AI tools and digital services enabled for this store.',
                    '',
                ),
            ],
            items: [syncedAiPluginItem(sourceAiPluginItem, sourceChannelCode)],
        },
    ];
}
