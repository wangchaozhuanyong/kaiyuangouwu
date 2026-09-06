import { homepageModuleCatalog } from '../../../../storefront-content-plugin/src/homepage-manifest';
import type {
    StorefrontBlockTranslation,
    StorefrontBlockType,
    StorefrontContentBlock,
    StorefrontContentItem,
    StorefrontItemTranslation,
    StorefrontLanguageCode,
    StorefrontLayoutVariant,
} from '../../graphql/storefront.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

export interface StorefrontModuleDescriptor {
    type: StorefrontBlockType;
    name: string;
    description: string;
    defaultEnabled: boolean;
}

export const homepageModuleDescriptors: readonly StorefrontModuleDescriptor[] = homepageModuleCatalog;

export const contentModuleDescriptors: StorefrontModuleDescriptor[] = [
    { type: 'LEGAL', name: '法律条款', description: '服务协议、隐私政策与网站规则', defaultEnabled: true },
    {
        type: 'SUPPORT',
        name: '客服与帮助',
        description: '服务时间、微信二维码和联系方式',
        defaultEnabled: true,
    },
    {
        type: 'AUTH_LOGIN',
        name: '登录页视觉',
        description: '买家端登录页背景与品牌文案',
        defaultEnabled: true,
    },
    {
        type: 'AUTH_REGISTER',
        name: '注册页视觉',
        description: '买家端注册页背景与品牌文案',
        defaultEnabled: true,
    },
    {
        type: 'NAVIGATION',
        name: '客户端导航',
        description: '移动端底部导航，最多 5 项',
        defaultEnabled: true,
    },
];

const defaultSupportSettings = {
    serviceDaysZh: '每日',
    serviceDaysEn: 'Daily',
    serviceStartTime: '09:00',
    serviceEndTime: '18:00',
} as const;

const generatedSupportLinkChannels = new Set(['QQ', 'WHATSAPP', 'TELEGRAM']);

export const navigationTargets = [
    ['/', '首页'],
    ['/category', '商品分类'],
    ['/services', '商业服务'],
    ['/search', '搜索'],
    ['/cart', '购物车'],
    ['/account', '个人中心'],
    ['/orders', '我的订单'],
    ['/coupons', '优惠券中心'],
    ['/favorites', '我的收藏'],
    ['/history', '浏览足迹'],
    ['/notifications', '消息中心'],
    ['/announcements', '系统公告'],
    ['/support', '客服中心'],
    ['/reviews', '评价中心'],
    ['/legal?id=privacy', '隐私政策'],
    ['/legal?id=terms', '使用条款'],
] as const;

export function defaultLayoutForType(type: StorefrontBlockType): StorefrontLayoutVariant {
    if (['HERO', 'AUTH_LOGIN', 'AUTH_REGISTER'].includes(type)) return 'HERO_OVERLAY';
    if (type === 'NOTICE') return 'TICKER';
    if (['QUICK_LINKS', 'TRUST_BAR', 'NAVIGATION'].includes(type)) return 'ICON_GRID';
    if (['CORE_CATEGORIES', 'CATEGORY_AD'].includes(type)) return 'CARD_GRID';
    if (['FLASH_SALE', 'BEST_SELLERS', 'RECOMMENDATIONS'].includes(type)) return 'PRODUCT_GRID';
    if (['STORY', 'LEGAL', 'SUPPORT'].includes(type)) return 'RICH_TEXT';
    if (['CLIENT_PLUGINS', 'CUSTOM'].includes(type)) return 'CUSTOM';
    return 'AUTO';
}

export function emptyBlockTranslation(languageCode: StorefrontLanguageCode): StorefrontBlockTranslation {
    return { languageCode, title: '', subtitle: '', body: '', ctaLabel: '' };
}

export function emptyItemTranslation(languageCode: StorefrontLanguageCode): StorefrontItemTranslation {
    return { languageCode, label: '', description: '' };
}

export function newContentItem(position: number): StorefrontContentItem {
    return {
        enabled: true,
        position,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [emptyItemTranslation('zh_Hans'), emptyItemTranslation('en')],
    };
}

export function newContentBlock(
    type: StorefrontBlockType,
    position: number,
    name?: string,
): StorefrontContentBlock {
    const descriptor = [...homepageModuleDescriptors, ...contentModuleDescriptors].find(
        item => item.type === type,
    );
    const displayName = name ?? descriptor?.name ?? '自定义内容';
    const block: StorefrontContentBlock = {
        code: `storefront-${type.toLowerCase().replaceAll('_', '-')}-${Date.now().toString(36)}`,
        internalName: displayName,
        type,
        layoutVariant: defaultLayoutForType(type),
        enabled: type === 'HERO' ? false : (descriptor?.defaultEnabled ?? false),
        position,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: ['HERO', 'AUTH_LOGIN', 'AUTH_REGISTER'].includes(type) ? '#0f172a' : null,
        textColor: ['HERO', 'AUTH_LOGIN', 'AUTH_REGISTER'].includes(type) ? '#ffffff' : null,
        targetType: 'NONE',
        targetValue: null,
        settings: type === 'NOTICE' ? { scrollIntervalSeconds: 5 } : null,
        translations: [
            { ...emptyBlockTranslation('zh_Hans'), title: displayName },
            { ...emptyBlockTranslation('en'), title: englishDefaultTitle(type) },
        ],
        items: [],
    };

    if (type === 'NAVIGATION') {
        block.code = 'storefront-navigation';
        block.items = [
            navigationItem(0, '/', '首页', 'Home'),
            navigationItem(1, '/category', '商品', 'Shop'),
            navigationItem(2, '/services', '服务', 'Services'),
            navigationItem(3, '/cart', '购物车', 'Cart'),
            navigationItem(4, '/account', '我的', 'Account'),
        ];
    }
    if (type === 'AUTH_LOGIN' || type === 'AUTH_REGISTER') {
        block.code = type === 'AUTH_LOGIN' ? 'auth-login-visual' : 'auth-register-visual';
        block.backgroundColor = '#070B14';
        block.items = [0, 1, 2].map(index => ({
            ...newContentItem(index),
            translations: [
                {
                    languageCode: 'zh_Hans',
                    label: ['工具发现', '高效下单', '统一管理'][index],
                    description: '',
                },
                { languageCode: 'en', label: ['Discover', 'Purchase', 'Manage'][index], description: '' },
            ],
        }));
        block.settings = { authVisualVersion: 1, accentColor: type === 'AUTH_LOGIN' ? '#22D3EE' : '#8B5CF6' };
    }
    if (type === 'SUPPORT') {
        block.settings = { ...defaultSupportSettings };
        block.items = [
            supportItem(0, 'WECHAT', '微信客服', 'WeChat support', false),
            supportItem(1, 'QQ', 'QQ 客服', 'QQ support', false),
            supportItem(2, 'WHATSAPP', 'WhatsApp', 'WhatsApp', false),
            supportItem(3, 'TELEGRAM', 'Telegram', 'Telegram', false),
            supportItem(4, 'QQ_GROUP', 'QQ 群', 'QQ group', false),
        ];
    }
    return block;
}

function navigationItem(
    position: number,
    targetValue: string,
    zh: string,
    en: string,
): StorefrontContentItem {
    return {
        ...newContentItem(position),
        targetType: 'PAGE',
        targetValue,
        translations: [
            { languageCode: 'zh_Hans', label: zh, description: '' },
            { languageCode: 'en', label: en, description: '' },
        ],
    };
}

function supportItem(
    position: number,
    supportChannel: string,
    zh: string,
    en: string,
    enabled: boolean,
): StorefrontContentItem {
    return {
        ...newContentItem(position),
        enabled,
        settings: { supportChannel },
        translations: [
            { languageCode: 'zh_Hans', label: zh, description: '' },
            { languageCode: 'en', label: en, description: '' },
        ],
    };
}

function englishDefaultTitle(type: StorefrontBlockType): string {
    return (
        {
            HERO: 'Homepage hero',
            NOTICE: 'Notice',
            QUICK_LINKS: 'Quick links',
            CORE_CATEGORIES: 'Core categories',
            CATEGORY_AD: 'Category feature',
            FEATURED_COLLECTION: 'Featured collection',
            COUPONS: 'Coupons',
            FLASH_SALE: 'Flash sale',
            BEST_SELLERS: 'Best sellers',
            RECOMMENDATIONS: 'Recommendations',
            STORY: 'Brand story',
            TRUST_BAR: 'Service guarantees',
            LEGAL: 'Legal',
            SUPPORT: 'Support',
            AUTH_LOGIN: 'Login visual',
            AUTH_REGISTER: 'Register visual',
            NAVIGATION: 'Navigation',
            CLIENT_PLUGINS: 'Client plugins',
            CUSTOM: 'Custom content',
        } as Record<StorefrontBlockType, string>
    )[type];
}

export function cloneContentBlock(block: StorefrontContentBlock): StorefrontContentBlock {
    return {
        ...block,
        settings:
            block.type === 'SUPPORT'
                ? structuredClone({ ...defaultSupportSettings, ...(block.settings ?? {}) })
                : block.settings
                  ? structuredClone(block.settings)
                  : null,
        translations: (['zh_Hans', 'en'] as const).map(languageCode => ({
            ...emptyBlockTranslation(languageCode),
            ...block.translations.find(translation => translation.languageCode === languageCode),
            languageCode,
        })),
        items: block.items.map((item, position) => {
            const clonedItem: StorefrontContentItem = {
                ...item,
                position,
                settings: item.settings ? structuredClone(item.settings) : null,
                translations: (['zh_Hans', 'en'] as const).map(languageCode => ({
                    ...emptyItemTranslation(languageCode),
                    ...item.translations.find(translation => translation.languageCode === languageCode),
                    languageCode,
                })),
            };
            if (block.type !== 'SUPPORT') return clonedItem;
            const channel =
                typeof clonedItem.settings?.supportChannel === 'string'
                    ? clonedItem.settings.supportChannel
                    : '';
            const configuredAccount =
                typeof clonedItem.settings?.supportAccount === 'string'
                    ? clonedItem.settings.supportAccount
                    : '';
            const supportAccount = normalizeSupportAccount(
                channel,
                configuredAccount || supportAccountFromTarget(channel, clonedItem.targetValue),
            );
            const generatedTarget = supportLinkFromAccount(channel, supportAccount);
            return {
                ...clonedItem,
                settings: supportAccount
                    ? { ...(clonedItem.settings ?? {}), supportAccount }
                    : clonedItem.settings,
                targetType:
                    channel === 'WECHAT'
                        ? 'NONE'
                        : generatedTarget || clonedItem.targetValue?.trim()
                          ? 'URL'
                          : clonedItem.targetType,
                targetValue: channel === 'WECHAT' ? null : (generatedTarget ?? clonedItem.targetValue),
            };
        }),
    };
}

export function blockTranslation(block: StorefrontContentBlock, languageCode: StorefrontLanguageCode) {
    return (
        block.translations.find(value => value.languageCode === languageCode) ??
        emptyBlockTranslation(languageCode)
    );
}

export function itemTranslation(item: StorefrontContentItem, languageCode: StorefrontLanguageCode) {
    return (
        item.translations.find(value => value.languageCode === languageCode) ??
        emptyItemTranslation(languageCode)
    );
}

export function storefrontBlockInput(block: StorefrontContentBlock) {
    return {
        code: block.code.trim(),
        internalName: block.internalName.trim(),
        type: block.type,
        layoutVariant: block.layoutVariant,
        enabled: block.enabled,
        position: block.position,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        imageAssetId: block.imageAsset?.id ?? block.imageAssetId ?? null,
        imageUrl: block.imageUrl?.trim() || null,
        backgroundColor: block.backgroundColor?.trim() || null,
        textColor: block.textColor?.trim() || null,
        targetType: block.targetType,
        targetValue: block.targetType === 'NONE' ? null : block.targetValue?.trim() || null,
        settings: block.settings,
        translations: block.translations
            .map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
                languageCode,
                title: title.trim(),
                subtitle: subtitle.trim(),
                body: body.trim(),
                ctaLabel: ctaLabel.trim(),
            }))
            .filter(translation => Boolean(translation.title)),
        items: block.items.map((item, position) => {
            const channel =
                typeof item.settings?.supportChannel === 'string' ? item.settings.supportChannel : '';
            const generatedTarget =
                block.type === 'SUPPORT'
                    ? supportLinkFromAccount(channel, item.settings?.supportAccount)
                    : null;
            const targetType = generatedTarget ? 'URL' : item.targetType;
            return {
                ...(item.id ? { id: item.id } : {}),
                enabled: item.enabled,
                position,
                imageAssetId: item.imageAsset?.id ?? item.imageAssetId ?? null,
                imageUrl: item.imageUrl?.trim() || null,
                targetType,
                targetValue:
                    targetType === 'NONE' ? null : (generatedTarget ?? (item.targetValue?.trim() || null)),
                settings: item.settings,
                translations: item.translations
                    .map(({ languageCode, label, description }) => ({
                        languageCode,
                        label: label.trim(),
                        description: description.trim(),
                    }))
                    .filter(translation => Boolean(translation.label)),
            };
        }),
    };
}

export function storefrontBlockValidation(block: StorefrontContentBlock): string | null {
    if (!block.internalName.trim()) return '请填写内部管理名称';
    if (!block.code.trim()) return '缺少区块编码';
    if (!blockTranslation(block, 'zh_Hans').title.trim()) return '请填写中文标题';
    if (block.enabled && block.type === 'HERO' && !block.imageAsset && !block.imageUrl?.trim()) {
        return '启用首页主视觉前必须选择图片';
    }
    if (block.targetType !== 'NONE' && !block.targetValue?.trim()) return '请填写跳转目标';
    const startsAt = block.startsAt ? new Date(block.startsAt).getTime() : null;
    const endsAt = block.endsAt ? new Date(block.endsAt).getTime() : null;
    if (startsAt !== null && Number.isNaN(startsAt)) return '开始展示时间无效';
    if (endsAt !== null && Number.isNaN(endsAt)) return '结束展示时间无效';
    if (startsAt !== null && endsAt !== null && startsAt >= endsAt) return '结束展示时间必须晚于开始展示时间';
    if (block.type === 'NAVIGATION' && (block.items.length < 1 || block.items.length > 5)) {
        return '客户端导航必须保留 1 至 5 项';
    }
    if (block.type === 'SUPPORT') {
        const startTime = supportSetting(
            block.settings?.serviceStartTime,
            defaultSupportSettings.serviceStartTime,
        );
        const endTime = supportSetting(block.settings?.serviceEndTime, defaultSupportSettings.serviceEndTime);
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) {
            return '请填写有效的客服服务时间';
        }
        if (!block.items.some(item => item.enabled)) return '请至少启用一种客服联系方式';
    }
    for (const [index, item] of block.items.entries()) {
        if (!(block.type === 'SUPPORT' && !item.enabled) && !itemTranslation(item, 'zh_Hans').label.trim()) {
            return `请填写第 ${index + 1} 个子项的中文名称`;
        }
        if (block.type !== 'SUPPORT' && item.targetType !== 'NONE' && !item.targetValue?.trim()) {
            return `请填写第 ${index + 1} 个子项的跳转目标`;
        }
        if (block.type === 'SUPPORT' && item.enabled) {
            const channel =
                typeof item.settings?.supportChannel === 'string' ? item.settings.supportChannel : '';
            if (!channel) return `请选择第 ${index + 1} 个客服项的渠道`;
            if (channel === 'WECHAT' && !item.imageAsset && !item.imageUrl?.trim())
                return '启用微信客服前请选择二维码素材';
            if (
                generatedSupportLinkChannels.has(channel) &&
                !supportLinkFromAccount(channel, item.settings?.supportAccount)
            ) {
                return channel === 'QQ'
                    ? '请填写有效的 QQ 号'
                    : channel === 'WHATSAPP'
                      ? '请填写带国家码的 WhatsApp 手机号'
                      : '请填写有效的 Telegram 用户名';
            }
            if (
                channel !== 'WECHAT' &&
                !generatedSupportLinkChannels.has(channel) &&
                (item.targetType !== 'URL' || !isHttpUrl(item.targetValue))
            ) {
                return `请为${itemTranslation(item, 'zh_Hans').label}配置有效的 http(s) 网址`;
            }
        }
    }
    return null;
}

export function normalizeSupportAccount(channel: string, value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (channel === 'QQ' || channel === 'WHATSAPP') return trimmed.replace(/\D/g, '');
    if (channel === 'TELEGRAM') {
        return trimmed
            .replace(/^https?:\/\/(?:www\.)?t\.me\//i, '')
            .replace(/^@/, '')
            .split(/[/?#]/, 1)[0];
    }
    return trimmed;
}

export function supportLinkFromAccount(channel: string, value: unknown): string | null {
    const account = normalizeSupportAccount(channel, value);
    if (!account) return null;
    if (channel === 'QQ' && /^\d{5,20}$/.test(account)) {
        return `https://wpa.qq.com/msgrd?v=3&uin=${account}&site=qq&menu=yes`;
    }
    if (channel === 'WHATSAPP' && /^\d{7,15}$/.test(account)) {
        return `https://wa.me/${account}`;
    }
    if (channel === 'TELEGRAM' && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(account)) {
        return `https://t.me/${account}`;
    }
    return null;
}

function supportAccountFromTarget(channel: string, value: string | null): string {
    if (!value?.trim()) return '';
    try {
        const url = new URL(value.trim());
        if (channel === 'QQ' && url.hostname === 'wpa.qq.com') return url.searchParams.get('uin') ?? '';
        if (channel === 'WHATSAPP' && url.hostname === 'wa.me') return url.pathname.slice(1);
        if (channel === 'TELEGRAM' && ['t.me', 'telegram.me'].includes(url.hostname)) {
            return url.pathname.split('/').filter(Boolean)[0] ?? '';
        }
    } catch {
        return '';
    }
    return '';
}

function supportSetting(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isHttpUrl(value: string | null): boolean {
    if (!value?.trim()) return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function toLocalDateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromLocalDateTime(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function errorText(error: unknown): string {
    return toUserFacingError(error, '店铺内容操作失败，请稍后重试');
}
