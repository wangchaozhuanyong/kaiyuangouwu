import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    JobQueueService,
    mergeConfig,
    ProcessContext,
    RequestContextService,
    SettingsStoreService,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreManagementPlugin } from '../src/store-management.plugin';
import { SYSTEM_WORKER_HEARTBEAT_KEY, SystemWorkerHealthService } from '../src/system-worker-health.service';

const config = mergeConfig(testConfig(), {
    authOptions: { requireVerification: false },
    plugins: [
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'worker-health-fixture',
                isConfigured: () => false,
                translate: request =>
                    Promise.resolve({ provider: 'fixture', translations: request.segments }),
            },
        }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'synthetic-worker-health-signing-fixture-32',
        }),
    ],
});
const { server, adminClient } = createTestEnvironment(config);
let worker: SystemWorkerHealthService | undefined;
beforeAll(async () => {
    await server.init({ initialData: { ...initialData, collections: [] }, customerCount: 0 });
    await adminClient.asSuperAdmin();
}, TEST_SETUP_TIMEOUT_MS);
afterAll(async () => {
    await worker?.onApplicationShutdown();
    await server.destroy();
});

it('persists worker state in MySQL and exposes it through the readonly Admin API field', async () => {
    const jobs = server.app.get(JobQueueService);
    const contexts = server.app.get(RequestContextService);
    const settings = server.app.get(SettingsStoreService);
    const query = gql`
        query {
            settingsStoreFieldDefinitions {
                key
                readonly
                currentValue
            }
        }
    `;
    const field = async () =>
        (await adminClient.query(query)).settingsStoreFieldDefinitions.find(
            (item: { key: string }) => item.key === SYSTEM_WORKER_HEARTBEAT_KEY,
        );
    expect(await field()).toMatchObject({ readonly: true, currentValue: null });
    // Exercise the real queue lifecycle and shared database independently of the UI's API-local flag.
    await jobs.start();
    worker = new SystemWorkerHealthService({ isWorker: true } as ProcessContext, jobs, contexts, settings);
    await worker.onApplicationBootstrap();
    const running = await field();
    expect(running.currentValue).toMatchObject({ state: 'RUNNING' });
    expect(running.currentValue.queues.length).toBeGreaterThan(0);
    expect(running.currentValue.queues.every((queue: { running: boolean }) => queue.running)).toBe(true);
    const write = await adminClient.query(
        gql`
            mutation ($input: SettingsStoreInput!) {
                setSettingsStoreValue(input: $input) {
                    result
                    error
                }
            }
        `,
        { input: { key: SYSTEM_WORKER_HEARTBEAT_KEY, value: { state: 'STOPPED' } } },
    );
    expect(write.setSettingsStoreValue.result).toBe(false);
    expect((await field()).currentValue.state).toBe('RUNNING');

    await worker.onApplicationShutdown();
    expect((await field()).currentValue.state).toBe('STOPPED');
});
