import { CrudPermissionDefinition } from '@vendure/core';

export const storeProfilePermission = new CrudPermissionDefinition(
    'StoreProfile',
    operation => `${operation} the active sales channel store profile`,
);
