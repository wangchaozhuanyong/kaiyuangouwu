import { CrudPermissionDefinition } from '@vendure/core';

export const storefrontContentPermission = new CrudPermissionDefinition(
    'StorefrontContent',
    operation => `${operation} storefront content for the active sales channel`,
);

export const DEFAULT_HERO_AUTOPLAY_INTERVAL_SECONDS = 5;
export const MIN_HERO_AUTOPLAY_INTERVAL_SECONDS = 3;
export const MAX_HERO_AUTOPLAY_INTERVAL_SECONDS = 30;

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
