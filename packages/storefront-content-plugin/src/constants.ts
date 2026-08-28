import { CrudPermissionDefinition } from '@vendure/core';

export {
    MAX_STOREFRONT_CLIENT_PLUGINS,
    STOREFRONT_CLIENT_PLUGINS_CODE,
    storefrontClientPluginCodes,
    storefrontClientPluginPlacements,
} from './client-plugin-manifest';
export type { StorefrontClientPluginPlacement } from './client-plugin-manifest';

export const storefrontContentPermission = new CrudPermissionDefinition(
    'StorefrontContent',
    operation => `${operation} storefront content for the active sales channel`,
);

export const DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS = 5;
export const MIN_HERO_AUTOPLAY_INTERVAL_SECONDS = 3;
export const MAX_HERO_AUTOPLAY_INTERVAL_SECONDS = 30;
export const AUTH_LOGIN_VISUAL_CODE = 'auth-login-visual';
export const AUTH_REGISTER_VISUAL_CODE = 'auth-register-visual';
export const authVisualCodeByType = {
    AUTH_LOGIN: AUTH_LOGIN_VISUAL_CODE,
    AUTH_REGISTER: AUTH_REGISTER_VISUAL_CODE,
} as const;
export const MAX_STOREFRONT_NAVIGATION_ITEMS = 5;
export const STOREFRONT_NAVIGATION_CODE = 'storefront-navigation';
export const storefrontNavigationTargetPaths = [
    '/',
    '/category',
    '/services',
    '/search',
    '/cart',
    '/account',
    '/orders',
    '/coupons',
    '/favorites',
    '/history',
    '/notifications',
    '/announcements',
    '/support',
    '/reviews',
] as const;

export const storefrontContentBlockTypes = [
    'HERO',
    'NOTICE',
    'QUICK_LINKS',
    'CATEGORY_AD',
    'FEATURED_COLLECTION',
    'COUPONS',
    'TRUST_BAR',
    'CORE_CATEGORIES',
    'FLASH_SALE',
    'BEST_SELLERS',
    'RECOMMENDATIONS',
    'STORY',
    'LEGAL',
    'SUPPORT',
    'AUTH_LOGIN',
    'AUTH_REGISTER',
    'NAVIGATION',
    'CLIENT_PLUGINS',
    'CUSTOM',
] as const;

export const storefrontContentLayoutVariants = [
    'AUTO',
    'HERO_OVERLAY',
    'TICKER',
    'ICON_GRID',
    'CARD_GRID',
    'PRODUCT_GRID',
    'RICH_TEXT',
    'CUSTOM',
] as const;

export const storefrontContentTargetTypes = [
    'NONE',
    'URL',
    'PRODUCT',
    'COLLECTION',
    'CATEGORY',
    'SEARCH',
    'PAGE',
    'SUPPORT',
    'COUPON',
] as const;

export type StorefrontContentBlockType = (typeof storefrontContentBlockTypes)[number];
export type StorefrontContentLayoutVariant = (typeof storefrontContentLayoutVariants)[number];
export type StorefrontContentTargetType = (typeof storefrontContentTargetTypes)[number];
