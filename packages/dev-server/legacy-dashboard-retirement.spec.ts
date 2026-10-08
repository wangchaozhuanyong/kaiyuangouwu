import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CatalogManagementPlugin } from '../catalog-management-plugin/src/catalog-management.plugin';
import { getPluginAPIExtensions, getPluginDashboardExtensions } from '../core/src/plugin/plugin-metadata';
import { IcloudRelayPlugin } from '../icloud-relay-plugin/src/icloud-relay.plugin';
import { OperationsDashboardPlugin } from '../operations-dashboard-plugin/src/operations-dashboard.plugin';

describe('retired Dashboard registration', () => {
    it.each(['catalog-management-plugin', 'icloud-relay-plugin', 'operations-dashboard-plugin'])(
        'keeps the retired %s UI source absent',
        name => {
            expect(existsSync(fileURLToPath(new URL(`../${name}/src/dashboard/`, import.meta.url)))).toBe(
                false,
            );
        },
    );
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
