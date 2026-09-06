// Neutral server defaults for unconfigured stores. Published content blocks override these values.
export const referralPosterCopy = {
    titleZh: '精选商品与服务',
    headlineZh: '精选商品与服务\n发现更多好选择',
    siteIntroZh: '按需求浏览商品，了解详情与服务说明。\n从选购到订单查询，一个网站轻松完成。',
    featureOneTitleZh: '丰富选择',
    featureOneTextZh: '浏览店铺商品与服务分类',
    featureTwoTitleZh: '轻松选购',
    featureTwoTextZh: '查看详情，选择合适方案',
    featureThreeTitleZh: '服务支持',
    featureThreeTextZh: '订单与售后问题均可咨询',
    qrEyebrowZh: '发现更多商品与服务',
    qrTitleZh: '进入店铺看看',
    qrDescriptionZh: '查看商品与服务详情\n了解当前店铺活动',
    rewardTextZh: '邀请好友消费，可获 {rewardRate}% 奖励\n奖励按店铺规则使用',
    sceneOneZh: '浏览商品',
    sceneTwoZh: '查看详情',
    sceneThreeZh: '在线选购',
    sceneFourZh: '订单查询',
    ctaTextZh: '长按识别二维码，进入店铺',
    footerTitleZh: '好选择，从这里开始',
    footerTextZh: '商品选购 · 订单查询 · 服务支持',
    serviceTextZh: '商品选购 · 订单查询 · 服务支持',
    titleEn: 'Curated products & services',
    headlineEn: 'Discover more\nFind your next favourite',
    siteIntroEn:
        'Explore products and services that suit your needs.\nBrowse details, shop and track orders in one place.',
    featureOneTitleEn: 'More choice',
    featureOneTextEn: 'Browse products and services',
    featureTwoTitleEn: 'Easy shopping',
    featureTwoTextEn: 'Find a suitable option',
    featureThreeTitleEn: 'Service support',
    featureThreeTextEn: 'Help with orders and aftercare',
    qrEyebrowEn: 'Explore products and services',
    qrTitleEn: 'Visit our store',
    qrDescriptionEn: 'See products and service details\nExplore current store offers',
    rewardTextEn: 'Invite friends and earn {rewardRate}% rewards\nRewards follow this store’s rules',
    sceneOneEn: 'Browse',
    sceneTwoEn: 'Details',
    sceneThreeEn: 'Shop',
    sceneFourEn: 'Orders',
    ctaTextEn: 'Scan the QR code to visit the store',
    footerTitleEn: 'Good choices start here',
    footerTextEn: 'Shopping · Orders · Service support',
    serviceTextEn: 'Shopping · Orders · Service support',
} as const;

export type ReferralPosterCopyField = keyof typeof referralPosterCopy;
export const referralPosterPresets = [
    {
        id: 'BRAND_MINIMAL',
        nameZh: '清透蓝白',
        nameEn: 'Clear blue',
        foregroundColor: '#152c49',
        accentColor: '#2565ae',
        design: {
            version: 2,
            background: '#f2f6fd',
            muted: '#62758c',
            panel: '#ffffff',
            border: '#d5e2f0',
            number: '#e5effb',
            button: '#2565ae',
            buttonEnd: '#4a93bc',
            buttonInk: '#ffffff',
        },
    },
    {
        id: 'BENEFIT_RED_GOLD',
        nameZh: '暖砂纸艺',
        nameEn: 'Warm paper',
        foregroundColor: '#47362b',
        accentColor: '#a05238',
        design: {
            version: 2,
            background: '#f9f4ec',
            muted: '#887565',
            panel: '#fffdf9',
            border: '#e7d9c9',
            number: '#efe0d2',
            button: '#a05238',
            buttonEnd: '#ba744c',
            buttonInk: '#ffffff',
        },
    },
    {
        id: 'PRODUCT_STORY',
        nameZh: '青绿自然',
        nameEn: 'Jade forms',
        foregroundColor: '#203e35',
        accentColor: '#326c54',
        design: {
            version: 2,
            background: '#f0f5ef',
            muted: '#637c71',
            panel: '#ffffff',
            border: '#d1e3d8',
            number: '#e0eee5',
            button: '#326c54',
            buttonEnd: '#568b70',
            buttonInk: '#ffffff',
        },
    },
    {
        id: 'PREMIUM_DARK',
        nameZh: '墨色香槟',
        nameEn: 'Champagne noir',
        foregroundColor: '#f4ede3',
        accentColor: '#d0b17a',
        design: {
            version: 2,
            background: '#14161b',
            muted: '#b6b1a8',
            panel: '#23272b',
            border: '#48463f',
            number: '#3b372f',
            button: '#d0b17a',
            buttonEnd: '#e8d5b1',
            buttonInk: '#242523',
        },
    },
    {
        id: 'CLOUD_BRIDGE_ORBIT',
        nameZh: '雾紫几何',
        nameEn: 'Lilac geometry',
        foregroundColor: '#34314c',
        accentColor: '#7761a7',
        design: {
            version: 2,
            background: '#f5f1fa',
            muted: '#7e7693',
            panel: '#ffffff',
            border: '#e0d9ee',
            number: '#eee6f7',
            button: '#7761a7',
            buttonEnd: '#947dbb',
            buttonInk: '#ffffff',
        },
    },
] as const;

export function referralPosterContentCode(id: string): string {
    return `referral-poster-${id.toLowerCase().replace(/_/g, '-')}`;
}

export function enabledPosterIds(
    systemIds: readonly string[],
    custom: Array<{ id: string | number; enabled: boolean }>,
): string[] {
    return [...systemIds, ...custom.filter(item => item.enabled).map(item => String(item.id))];
}

export function effectivePosterDefault(preferred: string, enabledIds: string[]): string {
    return enabledIds.includes(preferred) ? preferred : (enabledIds[0] ?? '');
}
