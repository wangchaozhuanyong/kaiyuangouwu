import { describe, expect, it } from 'vitest';

import { CatalogManagementPlugin } from '../catalog-management-plugin/src/catalog-management.plugin';
import { getPluginAPIExtensions, getPluginDashboardExtensions } from '../core/src/plugin/plugin-metadata';
import { IcloudRelayPlugin } from '../icloud-relay-plugin/src/icloud-relay.plugin';
import { OperationsDashboardPlugin } from '../operations-dashboard-plugin/src/operations-dashboard.plugin';

describe('retired Dashboard registration', () => {
    it.each([
        ['catalog management', CatalogManagementPlugin],
        ['mailbox portal', IcloudRelayPlugin],
        ['operations', OperationsDashboardPlugin],
    ] as const)('keeps %s Admin APIs without registering a second UI', (_name, plugin) => {
        // Read actual Vendure decorator metadata, rather than matching source text.
        expect(getPluginDashboardExtensions([plugin])).toEqual([]);
        expect(getPluginAPIExtensions([plugin], 'admin')).toHaveLength(1);
    });
});
