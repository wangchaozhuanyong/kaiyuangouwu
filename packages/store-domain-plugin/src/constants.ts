import { CrudPermissionDefinition } from '@vendure/core';

export const STORE_DOMAIN_PLUGIN_OPTIONS = Symbol('STORE_DOMAIN_PLUGIN_OPTIONS');

export const storeDomainPermission = new CrudPermissionDefinition(
    'StoreDomain',
    operation => `${operation} custom domains for the active sales channel`,
);
