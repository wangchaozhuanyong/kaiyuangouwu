// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../core/typings.d.ts" />
import { bootstrap, defaultConfig, JobQueueService, Logger, mergeConfig } from '@vendure/core';
import { populate } from '@vendure/core/cli';
import { clearAllTables, populateCustomers } from '@vendure/testing';
import path from 'path';

import { initialData } from '../core/mock-data/data-sources/initial-data';

import { assertSafeDevPopulateEnvironment } from './populate-safety';

/* eslint-disable no-console */

/**
 * A CLI script which populates the dev database with deterministic random data.
 */
async function populateDevDatabase(): Promise<void> {
    assertSafeDevPopulateEnvironment();
    const { devConfig } = await import('./dev-config');
    const populateConfig = mergeConfig(
        defaultConfig,
        mergeConfig(devConfig, {
            authOptions: {
                tokenMethod: 'bearer',
                requireVerification: false,
            },
            importExportOptions: {
                importAssetsDir: path.join(__dirname, '../core/mock-data/assets'),
            },
            customFields: {},
        }),
    );
    await clearAllTables(populateConfig, true);
    const app = await populate(
        () =>
            bootstrap(populateConfig).then(async bootstrappedApp => {
                await bootstrappedApp.get(JobQueueService).start();
                return bootstrappedApp;
            }),
        initialData,
        path.join(__dirname, '../create/assets/products.csv'),
    );
    console.log('populating customers...');
    await populateCustomers(app, 10, message => Logger.error(message));
    await app.close();
}

if (require.main === module) {
    // Running from command line
    populateDevDatabase().then(
        () => process.exit(0),
        err => {
            console.log(err);
            process.exit(1);
        },
    );
}
