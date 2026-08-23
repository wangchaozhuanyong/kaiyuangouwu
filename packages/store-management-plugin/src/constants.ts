import { CrudPermissionDefinition } from '@vendure/core';

export const storeProfilePermission = new CrudPermissionDefinition(
    'StoreProfile',
    operation => `${operation} the active sales channel store profile`,
);

export const STOREFRONT_PROMOTION_OPTIONS = Symbol('STOREFRONT_PROMOTION_OPTIONS');
export const STOREFRONT_ENTRY_COOKIE = 'storefront-entry';
