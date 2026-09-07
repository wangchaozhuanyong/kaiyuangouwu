import { ConfigService, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { NextAdminPlugin } from '../src/next-admin.plugin';

// Isolated loopback bootstrap verifies that removing DashboardPlugin preserves the real API contract.
const directory = mkdtempSync(join(tmpdir(), 'next-admin-host-'));
const appDir = join(directory, 'app');
mkdirSync(appDir);
writeFileSync(join(appDir, 'index.html'), '<!doctype html><div>Next admin host fixture</div>');
registerInitializer('sqljs', new SqljsInitializer(directory));
const { server, adminClient } = createTestEnvironment(
    mergeConfig(testConfig, {
        apiOptions: { hostname: '127.0.0.1', port: 5297 },
        plugins: [NextAdminPlugin.init({ route: 'dashboard', appDir, serveStatic: true })],
    }),
);
const metrics = gql`
    query {
        dashboardMetricSummary(
            input: {
                types: [OrderCount, OrderTotal, AverageOrderValue]
                startDate: "2026-09-01T12:00:00.000Z"
                endDate: "2026-09-01T12:00:00.000Z"
            }
        ) {
            type
            entries {
                label
                value
            }
        }
    }
`;

beforeAll(async () => {
    await server.init({ initialData });
}, 60_000);
afterAll(async () => {
    await server.destroy();
    rmSync(directory, { recursive: true, force: true });
});

describe('standalone next-admin host bootstrap', () => {
    it('serves deep admin routes and returns a real 404 for stale chunks', async () => {
        const page = await fetch('http://127.0.0.1:5297/dashboard/catalog/list');
        expect(page.status).toBe(200);
        expect(page.headers.get('cache-control')).toBe('no-store');
        expect(await page.text()).toContain('Next admin host fixture');
        const chunk = await fetch('http://127.0.0.1:5297/dashboard/assets/stale.js');
        expect(chunk.status).toBe(404);
        expect(await chunk.text()).not.toContain('Next admin host fixture');
    });

    it('retains authenticated metric queries and denies anonymous access', async () => {
        await adminClient.asAnonymousUser();
        await expect(adminClient.query(metrics)).rejects.toThrow(/permission|authoriz|Forbidden/i);
        await adminClient.asSuperAdmin();
        const data = await adminClient.query(metrics);
        expect(data.dashboardMetricSummary.map((metric: { type: string }) => metric.type)).toEqual([
            'OrderCount',
            'OrderTotal',
            'AverageOrderValue',
        ]);
        for (const metric of data.dashboardMetricSummary) {
            expect(metric.entries).toHaveLength(1);
            expect(metric.entries[0].value).toBe(0);
        }
        const fields = server.app.get(ConfigService).settingsStoreFields['vendure.dashboard'];
        expect(fields?.map(field => field.name)).toEqual([
            'userSettings',
            'globalSavedViews',
            'userSavedViews',
        ]);
    });
});
