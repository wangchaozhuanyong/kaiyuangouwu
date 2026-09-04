import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    getNextAdminDashboardAlerts,
    getNextAdminDashboardWidgets,
    getNextAdminExtensionLegacyRoutes,
    getNextAdminExtensions,
} from './extension-api';
import './installed-extensions';
import {
    LEGACY_EXTENSION_SURFACES,
    LEGACY_ROUTE_CAPABILITIES,
    LEGACY_SOURCE_SURFACE_CAPABILITIES,
    NATIVE_PARITY_CAPABILITIES,
} from './legacy-capabilities';

const packagesRoot = fileURLToPath(new URL('../../../', import.meta.url));
const legacyDashboardPackages = [
    'catalog-management-plugin',
    'content-translation-plugin',
    'image-generation-plugin',
    'operations-dashboard-plugin',
    'store-domain-plugin',
    'store-management-plugin',
    'storefront-content-plugin',
    'two-factor-dashboard-plugin',
];
const migratedRouteSourceDirectories = [join(packagesRoot, 'store-management-plugin', 'src/admin')];

function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(name) ? [path] : [];
    });
}

function legacyRoutePathsFromSource() {
    const pattern = /\bpath:\s*['"](\/[^'"]+)['"]/g;
    const sourceDirectories = [
        ...legacyDashboardPackages.map(packageName => join(packagesRoot, packageName, 'src/dashboard')),
        ...migratedRouteSourceDirectories,
    ];
    return sourceDirectories
        .flatMap(sourceFiles)
        .flatMap(file => [...readFileSync(file, 'utf8').matchAll(pattern)].map(match => match[1]))
        .sort();
}

describe('legacy capability parity contract', () => {
    it('maps all 28 local plugin routes to the exact new capability', () => {
        const actual = getNextAdminExtensionLegacyRoutes()
            .map(({ path, target }) => ({ legacyPath: path, target }))
            .sort((left, right) => left.legacyPath.localeCompare(right.legacyPath));
        const expected = LEGACY_ROUTE_CAPABILITIES.map(({ legacyPath, target }) => ({
            legacyPath,
            target,
        })).sort((left, right) => left.legacyPath.localeCompare(right.legacyPath));

        expect(LEGACY_ROUTE_CAPABILITIES).toHaveLength(28);
        expect(actual).toEqual(expected);
        expect(new Set(actual.map(item => item.legacyPath)).size).toBe(28);
        expect(legacyRoutePathsFromSource()).toEqual(
            LEGACY_ROUTE_CAPABILITIES.map(item => item.legacyPath).sort(),
        );
    });

    it('requires every declared route and native capability to be migrated', () => {
        expect(LEGACY_ROUTE_CAPABILITIES.every(item => item.status === 'MIGRATED')).toBe(true);
        expect(NATIVE_PARITY_CAPABILITIES.every(item => item.status === 'MIGRATED')).toBe(true);
        expect(LEGACY_SOURCE_SURFACE_CAPABILITIES.every(item => item.status === 'MIGRATED')).toBe(true);
    });

    it('keeps every action, page block, widget, and alert host registered', () => {
        const extensions = getNextAdminExtensions();
        const actions = extensions.flatMap(extension => extension.actions ?? []).map(item => item.id);
        const pageBlocks = extensions.flatMap(extension => extension.pageBlocks ?? []).map(item => item.id);

        expect(actions).toEqual(expect.arrayContaining([...LEGACY_EXTENSION_SURFACES.actions]));
        expect(pageBlocks).toEqual(expect.arrayContaining([...LEGACY_EXTENSION_SURFACES.pageBlocks]));
        expect(getNextAdminDashboardWidgets().map(item => item.id)).toEqual(
            expect.arrayContaining([...LEGACY_EXTENSION_SURFACES.dashboardWidgets]),
        );
        expect(getNextAdminDashboardAlerts().map(item => item.id)).toEqual(
            expect.arrayContaining([...LEGACY_EXTENSION_SURFACES.alerts]),
        );

        const registeredTargets = new Set([
            ...actions,
            ...pageBlocks,
            ...getNextAdminDashboardWidgets().map(item => item.id),
            ...getNextAdminDashboardAlerts().map(item => item.id),
        ]);
        for (const capability of LEGACY_SOURCE_SURFACE_CAPABILITIES) {
            if (!capability.targetId.startsWith('/')) {
                expect(registeredTargets.has(capability.targetId), capability.legacyId).toBe(true);
            }
        }
    });
});
