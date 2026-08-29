export const STOREFRONT_CLIENT_PLUGINS_CODE = 'storefront-client-plugins';
export const MAX_STOREFRONT_CLIENT_PLUGINS = 50;

export const storefrontClientPluginPlacements = [
    'AFTER_HEADER',
    'AFTER_CATEGORY_NAVIGATION',
    'BEFORE_PRODUCT_LIST',
    'AFTER_PRODUCT_LIST',
    'BUSINESS_SERVICES_MAIN',
] as const;

export type StorefrontClientPluginPlacement = (typeof storefrontClientPluginPlacements)[number];

export interface StorefrontClientPluginDefinition {
    code: string;
    name: string;
    englishName: string;
    description: string;
    englishDescription: string;
    version: string;
    defaultPlacement: StorefrontClientPluginPlacement;
}

/** 平台自研客户端插件目录。只有这里发布的插件才能写入店铺配置。 */
export const storefrontClientPluginCatalog: readonly StorefrontClientPluginDefinition[] = [
    {
        code: 'category-coupon-entry',
        name: '优惠券快捷入口',
        englishName: 'Coupon shortcut',
        description: '在商品分类页或商业服务页展示优惠券快捷入口。',
        englishDescription: 'Shows a coupon shortcut on category or business-services pages.',
        version: '1.0.0',
        defaultPlacement: 'BEFORE_PRODUCT_LIST',
    },
    {
        code: 'category-support-entry',
        name: '客服快捷入口',
        englishName: 'Support shortcut',
        description: '在商品分类页或商业服务页展示客服快捷入口。',
        englishDescription: 'Shows a support shortcut on category or business-services pages.',
        version: '1.0.0',
        defaultPlacement: 'AFTER_PRODUCT_LIST',
    },
    {
        code: 'ai-image-studio-entry',
        name: 'AI 图片工坊',
        englishName: 'AI Image Studio',
        description: '在商业服务页提供提示词优化、文生图和单参考图生图入口。',
        englishDescription: 'Adds prompt optimization, text-to-image, and one-reference image generation.',
        version: '1.0.0',
        defaultPlacement: 'BUSINESS_SERVICES_MAIN',
    },
] as const;

export const storefrontClientPluginCodes = storefrontClientPluginCatalog.map(plugin => plugin.code);
